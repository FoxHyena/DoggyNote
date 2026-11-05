# DoggyNote Clipper — private Chrome test

Hover an image → Save → preview and choose a board → Save to that board’s Inbox.
The DoggyNote website and Mac app can be closed while you collect images.

## Install

The server and web app must first be released with migration `0021_clipper.sql` using the repository’s normal release workflow. This extension uses the new clipper API; it cannot connect to a server that has not been updated. Deployment is a separate release action.

1. Unzip `doggynote-clipper-0.1.0.zip` into a folder you will keep.
2. Open `chrome://extensions`, turn on **Developer mode**, and choose **Load unpacked**.
3. Select the unzipped folder containing `manifest.json`.
4. Open the extension from Chrome’s Extensions menu. Choose **Connect DoggyNote**, sign in at `notepad.dog` if needed, and approve **Connect Chrome**.
5. Refresh web pages that were open before installation. Hover an image and choose **Save**, or use the image’s right-click menu.

Chrome asks for access to websites so the extension can show its hover button and download the image you select. No browsing history is collected. The selected image is downloaded into local extension storage for its preview; it is uploaded to DoggyNote only when you confirm Save. The extension does not request cookies, browsing history, clipboard access, or native-app access.

## Using your collection

The panel remembers your last successfully used board. Search or choose another editable board before saving. Board paths distinguish boards with the same name.

Choose **Open board** after saving, or open that board in DoggyNote and select **Inbox → This board**. Drag an image onto the canvas or choose **Place**. Editors can discard clips and use the toast’s Undo action. **Private** retains your existing personal Inbox.

Signed-in members of the destination board can see pending images. Anonymous share-link visitors see them only after placement. Saved images are copied into DoggyNote’s storage, so deleting the original page does not remove your copy. The source-page link remains on the placed image, independently of its editable caption.

Connections expire after 90 days. Use **Account → Chrome connections → Revoke** in DoggyNote to revoke one immediately, or **Disconnect** in the extension. Password recovery, password changes, and account-wide session revocation also revoke these connections.

## Limits and recovery

- Chrome 116 or later; private unpacked testing, with no automatic extension updates. To update, replace the files and choose Reload on `chrome://extensions`.
- JPEG, PNG, WebP, and GIF images up to 15 MB. GIF animation is preserved at full size. Canvas content, CSS backgrounds, videos, screenshots, selected text, links, and bulk capture are not included.
- Chrome’s internal pages and the Chrome Web Store cannot run the hover button. DoggyNote’s own pages do not show it. Refresh an ordinary page if it was open during installation.
- The extension stores one current image draft. Selecting another image replaces that draft; completed saves remain on the server.
- Online access is required to save. If a download or upload fails, keep or reopen the panel and retry. Prepared bytes, image IDs, and destination survive panel closure and worker restarts. Choose **Resume interrupted save** after an interrupted upload. Retrying the same save does not duplicate it.
- Reconnect to the same account to finish a capture after a connection expires. Connecting to a different account clears the previous account’s local draft. A different account never inherits the remembered destination.
- Some sites block direct image downloads or require their own login cookies. The extension downloads without those cookies; it will explain the failure rather than saving a broken image or capturing a screenshot. Try opening the image itself or use DoggyNote’s regular upload feature.

## Build and test

From the repository root:

```sh
pnpm install
pnpm --filter extension package
```

The unpacked build is `apps/extension/dist`; the versioned ZIP is under `apps/extension/release`.
The checked-in public manifest key fixes the private-test ID to `alhopgfihkeokgjmmplgjamgolaancnf`. The server accepts only its `https://alhopgfihkeokgjmmplgjamgolaancnf.chromiumapp.org/clipper` callback. Do not remove the key. A future Web Store release must register its actual ID explicitly; wildcard callbacks are not supported.

For a local extension integration run:

```sh
DOGGYNOTE_URL=http://localhost:5215 pnpm --filter extension build
E2E_PORT_OFFSET=40 pnpm --filter extension test:e2e
```

Then rebuild the production package before sharing it:

```sh
pnpm --filter extension package
```

The extension test starts the same real Worker and production web builds as the app tests. Its database is isolated at `.wrangler/extension-e2e`. Run it separately from app browser tests because both build the web app into the same output folders.

App coverage: `pnpm --filter web exec playwright test board-inbox --project=chromium --project=webkit`.
Server coverage: `pnpm exec vitest run apps/server/src/clipper.integration.test.ts`.

Interface changes are additive: pending clips live outside canvas sync, and placement creates a normal image card using existing sync counters and realtime notifications. Older apps continue to work but need an update to show the board Inbox. The extension has no access to normal session-authenticated APIs or agent-approval endpoints.
