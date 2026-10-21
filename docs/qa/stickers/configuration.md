# Telegram configuration and verification

Use an existing DoggyNote account. Link import does not use Telegram Login or a Telegram user session. An optionally connected bot imports only packs from stickers sent to it; it does not enumerate installed Telegram packs.

Copy `apps/server/.dev.vars.example` to ignored `apps/server/.dev.vars` for local development. Set the bot token, bot username without `@`, and an independently generated webhook secret. Local desktop QA also needs its own private `ASSET_TOKEN_SECRET`: cross-origin native image URLs use signed image credentials even when API sign-in succeeds. If that binding is missing, `/api/assets/token` returns500 and sticker images cannot load. Restart the local Worker after adding a new binding, while retaining the same persistence directory. Use a test bot/account for QA. Keep token and webhook secret out of command arguments, logs, screenshots and saved board data. The username must match the token's `getMe` identity.

For a hosted Worker, configure `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET` as Worker secrets through the existing deployment process. Register the bot's HTTPS webhook at `/api/telegram/webhook`, using the same `secret_token` and only message updates. Registration and deployment were not performed by this task. Never replace an existing bot webhook to run a test without checking its owner and purpose.

## Hosting plan

The bot handler lives in DoggyNote's existing Cloudflare Worker. There is no separate continuously running bot process. Telegram posts updates to the public HTTPS webhook; D1 holds pairing/challenge/suggestion state and R2 holds imported sticker bytes. With the current repository domain configuration, the intended endpoint is `https://notepad.dog/api/telegram/webhook`.

Before enabling production: apply the additive sticker D1 migration through the existing deployment process, deploy the Worker/web changes, configure the bot secrets, register the HTTPS webhook with its secret token and message-only updates, then verify Start → authenticated app confirmation → sent sticker → pack suggestion against the hosted environment. Use a dedicated staging bot when testing a staging deployment; a bot has one active webhook.

Local QA used an opt-in polling bridge because localhost is not publicly reachable by Telegram. That bridge is a development aid; normal hosted operation uses the webhook. Pairing, import and recovery actions now return a brief acknowledgement with a randomly selected dog-themed variant from `COPY.telegramBot`. Telegram delivers it through the authenticated webhook response's `sendMessage` method. Replay markers and unchanged pending suggestions suppress duplicate replies. This delivery is best effort; the app's pairing/suggestion state remains authoritative. The local polling bridge does not execute reply payloads. See [release readiness](release-readiness.md) for the full behavior and hosted verification checklist.

The webhook verifies Telegram's secret header and accepts only private user chats. Start links contain an expiring single-use random challenge, whose hash is stored server-side. A Telegram Start only records the incoming identity. Binding requires confirmation in the authenticated app. Sending a sticker with a set name creates a pending pack suggestion; it never adds a pack or places anything automatically. Disconnect removes the pairing, challenges and suggestions, while keeping collection and board assets.

## Deterministic checks

The E2E Worker is seeded with original transparent test artwork and an animation. Its CLI uses an explicit empty environment file, so it cannot accidentally load a developer's real Telegram secrets. Fixture bot values are intentionally nonfunctional outside the isolated test Worker; tests deliver signed fixture updates locally and never open or message that bot.

## Optional live checks

With an already running isolated local Worker on port 8789 and fixture user `rex`, run from `apps/web`:

```sh
pnpm exec node e2e/live-stickers.mjs
```

This drives the real app to resolve/import `hyenafox`, place and adjust an asset, then reload. It never reads the bot token. Results and screenshots go to `docs/qa/stickers/live/`.

`live-sticker-pairing.mjs` is an opt-in local QA bridge for a dedicated test bot **with no registered webhook**. It reads the local secrets privately, polls real Telegram updates via the system TLS client, and forwards only updates from the challenge's matching test identity to the local webhook handler. It does not register/delete a webhook, send replies, or confirm an identity automatically. A person must press Start, confirm their account in the opened authenticated app, and send a `hyenafox` sticker. This verifies real bot updates through the handler; it does not verify public HTTPS webhook delivery. Do not use the bridge while another process polls that bot.

## Storage, conflicts and compatibility

Personal membership and preferences live outside board sync and share snapshots. Favorite and recent updates affect separate columns. Placed objects store immutable asset/pack provenance plus separate x/y/width/angle/order fields. Width alone determines size; height follows intrinsic aspect. Concurrent edits use the existing last-arriving-write rule per changed field, preserving unrelated updates and existing outbox acknowledgments/busy-gesture deferral.

Imported bytes are fetched only from validated Bot API file paths and retained in R2. A cached global manifest is not an asset credential: bytes require collection/preview ownership or a readable board reference. Pack removal never deletes bytes. Assets are retained indefinitely for board/trash/undo references; automated garbage collection is deferred. Older protocol-2 clients can keep patching boards without erasing sticker rows; they do not render unknown sticker kinds. New agent proposals require existing sticker assets visible within that connection's board scope.

Still images are mandatory. Static PNG/WEBP dimensions are bounded to 512. TGS playback is limited to validated, bounded shape-only Lottie data with no external media, fonts, text or expressions; unsupported animation uses the prepared still with an explicit preview notice. WEBM has a still on WebKit/Tauri and optional bounded playback on supported Chromium. Import chunks run two at a time, with at most two asset preparations per Worker request. Completed entries merge safely across concurrent responses; Telegram rate limiting pauses further upstream scheduling while personal metadata remains usable.

Only the selected canvas sticker or one enlarged preview animates, at most two loops; reduced motion, export and overview use stills. Real TGS and WEBM engine verification is recorded separately in the QA checklist; `hyenafox` contains only static assets.

Selection uses a circular control: drag any point around the circumference to rotate and radially inward/outward to scale around a fixed center. The combined transform commits as one undoable change. Drag artwork to move; use Size and Angle for exact keyboard adjustment.

The tray now shows artwork without per-sticker Preview buttons. Hold, right-click, Space or Shift+F10 opens an enlarged preview; Enter/click/tap retains placement. The preview groups the real source pack title into one navigation row and keeps Place sticker plus an icon-only star in a separate action row. Release after a hold is suppressed when the browser retargets it onto a newly mounted action. See [the UX review](ux-review-2026-10-20.md).
