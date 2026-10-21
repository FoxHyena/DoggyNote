# Native sticker QA follow-up

2026-10-20. Scope: only the isolated `DoggyNote Stickers QA.app`, bundle ID `dog.doggynote.stickersqa`, local Worker on 8789. Existing product changes and prior evidence are preserved.

The fresh child Computer Use connection succeeded. Quit the isolated app with Cmd-Q, observed it absent from the next app inventory, then reopened its rebuilt full bundle path. Dismissed the update offer with Later. The current artwork-first tray is present. Ordinary installed DoggyNote was not controlled.

Initial board and tray artwork displayed emoji placeholders, with board AX labels `Sticker image unavailable`. Refreshed the disposable local `rex` sign-in successfully; unavailable artwork persisted. This is not a native rendering pass.

Scoped local API diagnosis confirmed Worker health 200 and valid CORS for `tauri://localhost`, but `/api/assets/token` returned **500**, `Image tokens are not configured on this server`. Thumbnail requests without that unavailable image credential returned **401**. The diagnosis printed only status, error, format, byte count and CORS; no token or private configuration was printed. The diagnostic session was logged out.

Parent restored the local QA image-token configuration and restarted only Worker 8789 with the same persisted database. The diagnostic then returned 200 for token generation and representative thumbnails. Remounting the tray displayed actual artwork. No product code was changed by this QA agent.

## Native format observations

Created the nested board **Native sticker QA 2026-10-20**, ID `14b96e07-6a7f-4e25-a754-85d773f8e831`. The first fixture paw and first fixture bone are TGS and WEBM respectively (`seed-stickers.mjs`, indices 1 and 2).

- Right-clicked the first paw through its native accessibility button. The enlarged preview showed the pink paw still, transparent around its silhouette, with usable Place and source-pack actions. [Native TGS paw preview](native/tgs-paw-preview.png).
- Returned to the fixture grid and right-clicked its first bone. The enlarged preview showed the transparent green-bone still. Continuous WEBM animation is not claimed or required for this native fallback check. [Native WEBM bone preview](native/webm-bone-preview.png).
- Used Place sticker, then a native canvas click at screenshot `[1550,850]`. AX showed exactly one `Select 🦴 from DoggyFixture` and size 144 / angle 0 controls. The dotted canvas remained visible through the asset's empty corners and around the silhouette; no opaque rectangular background appeared. [Native bone placement](native/webm-bone-placed.png). Undid this placement and observed the empty-board message again.
- After the second unsuccessful drag below, an explicit native canvas click at `[1600,1000]` placed the pink paw. AX changed from armed placement to one image, one `Select 🐾 from DoggyFixture`, and size 144 / angle 0 controls. The subsequent screenshot call failed with `Computer Use server error -10005: cgWindowNotFound`, so there is **no retained screenshot of the placed paw**. Its preview is retained; paw canvas transparency is not asserted from a missing image.

The native TGS/WEBM transparent-still preview requirement was directly observed. These observations do not claim native frame-by-frame alpha measurement, perpetual animation, or a GPU benchmark.

## Native tray drag remains unresolved

Both attempts began with an empty board, using fresh 2800 × 1800 native screenshots. Inputs used screenshot pixels, consistent with earlier native 2× Retina observations; they were not divided into logical coordinates. Native coordinate clicks and right-clicks hit the expected controls throughout this session.

The complete documented drag signature is:

```ts
type Vec2 = [x: number, y: number];
interface Target {
  drag(from: Vec2, to: Vec2): Promise<void>;
}
```

The returned documentation exposes **no options**, duration, intermediate points, or separate mouse-down/move/up methods for this API.

1. `await qaApp.drag([285,540], [1450,700]);` — from the first Recent hyenafox tile to empty canvas. Outcome: tray closed, `Tap your board to place` / Place at center / Cancel appeared, and zero board sticker selectors existed. [Empty before](native/tray-drag-before.png), [armed, zero commits](native/tray-drag-armed-no-commit.png). Cancelled before continuing.
2. After undoing the explicit bone placement and observing the empty-board message, `await qaApp.drag([450,620], [1600,1000]);` — from the fixture's pink paw tile to empty canvas. Outcome again: tray closed and placement became armed, with zero committed board stickers. The later explicit canvas click is the separate paw placement described above; it is not relabeled as a drag pass.

The cursor displayed near the source tile after each drag. The armed outcome is consistent with the application receiving a click without a recognized pressed movement beyond its threshold, but no native event trace was collected. Input synthesis versus product failure is **undetermined**. Native exactly-one-commit drag acceptance therefore remains **unverified**, with observed attempts yielding zero commits.

## Tool interruption and limits

Opening the new board and tray in one call stalled for 118 seconds despite a 10-second requested tool timeout, then returned `Computer Use server error -10005: cgWindowNotFound`. Parent authorized one scoped recovery; reacquiring the isolated app by its same rebuilt full path succeeded and returned fresh native state. The final paw screenshot produced the same error. Native calls stopped after that second missing-window failure; no further drag retries, daemon resets, permission-mode changes, or provider switching occurred.

The retained new screenshots are all native 2800 × 1800 PNGs. No browser screenshot substitutes for native evidence. No production deployment, webhook registration, Telegram message, ordinary DoggyNote app control, or full regression rerun was performed. Parent retains responsibility for requirement-audit reconciliation.
