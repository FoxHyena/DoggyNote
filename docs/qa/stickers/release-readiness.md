# Sticker release readiness

The implementation remains a reviewable local diff. The user separately authorized an isolated hosted Telegram QA deployment, now available with its own D1/R2 and dedicated test-bot webhook; see [hosted evidence](hosted/README.md). Production publishing/migration and release publication remain outside the authorized test scope.

## Release contents

- Independent board stickers, personal collections, link import, bounded concurrent asset preparation, bot-assisted pack suggestions, favorites/recents/search, circular resize/rotation, undo/sync/share/export and transparent format fallbacks.
- Artwork-only tray with hold/right-click/Space previews, deliberate source-pack navigation and a separate Place/star action row. Final design evidence is in [the UX review](ux-review-2026-10-20.md).
- Mobile bottom-right launcher and horizontal collection shelf: swipe to browse, pull upward to place at the lifted preview center, hold to preview, tap fallback and per-pack position memory.
- Pairing/import/recovery acknowledgements, with three randomly chosen dog-themed variants per stage. Copy lives in [COPY.telegramBot](../../../packages/theme/src/copy.ts).

## Bot behavior ready for review

| Incoming private action | Reply and resulting state |
| --- | --- |
| Start without a connection link, or Help while unpaired | Explain the Stickers → Add pack → Send a sticker in Telegram route. Does not pair anything. |
| Valid, unclaimed connection link | Ask the person to confirm their Telegram account back in DoggyNote. Does not bind the account. |
| Expired, invalid or already claimed connection link | Explain that the link is unavailable and give the cancel/start-again recovery path. |
| Sticker before app confirmation | Remind the person to confirm in DoggyNote. Does not suggest/import a pack yet. |
| Start/Help after pairing | Explain sending one sticker from the desired pack. |
| Paired sticker with set metadata | Acknowledge receipt and direct the person to preview/Add in DoggyNote. Creates only the pending suggestion. |
| Paired sticker without set metadata | Explain the missing pack information and the paste-link alternative. |
| Replayed update or unchanged pending pack/notice | No additional reply, suggestion or import. |
| Group chat, bot sender, mismatched chat/user, invalid user ID or unrelated text | No reply. Invalid webhook credentials are rejected. |

Replies use Telegram's documented [webhook response method](https://core.telegram.org/bots/api#making-requests-when-getting-updates): the authenticated webhook returns JSON requesting `sendMessage` to the validated incoming private chat. There is no separate outgoing fetch, bot-token URL in the response, background message job or automatic import. Telegram's API does not return the delivery result for this mechanism, so acknowledgements are best effort; app pairing/suggestion state stays authoritative. Replayed updates return only `ok`, even if acknowledgement delivery was interrupted.

Local fixture tests inspect those JSON payloads. The opt-in local polling bridge deliberately does not execute them or send messages. On the authorized QA webhook the user received the actual Start and sticker acknowledgements (2026-10-20). Recovery-path replies remain fixture-verified only.

## Before publishing

1. Review the local diff and [requirement audit](completion-audit.md), retaining the user-waived native tray-drag limitation as unverified, not passed. Delegated native TGS/WEBM transparent-still previews and bone placement are verified; the two native drag attempts armed placement and committed zero objects. The mobile shelf passed its final strict439-test suite and inspected light/dark/landscape captures; retain those checks when integrating subsequent work.
2. Use the existing coordinated release workflow in `.github/workflows/release.yml`. It tests, stages the compatible desktop artifacts, applies D1 migrations, deploys Worker/web together, and publishes the updater/release afterward. A merge to `main` triggers publishing; do not use it as a local QA command.
3. Configure the intended hosted bot's `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and independent `TELEGRAM_WEBHOOK_SECRET` through Worker secret input. Do not place values in command arguments, release notes, chat or CI output. Local `.dev.vars` is not production configuration. Verify that the username matches the token's bot identity and that this bot is intended for this deployment.
4. Apply migration `0010_stickers.sql` through the release workflow's existing migration step. Keep the additive tables and stored assets during recovery; removing a pack or disconnecting a bot must not delete placed artwork.
5. After the intended deployment is healthy, register its exact canonical HTTPS webhook (`https://notepad.dog/api/telegram/webhook` with the current repository domain), matching the secret token and message-only updates. First inspect whether the bot already has a webhook; do not replace another deployment's endpoint. Use a separate bot for staging.
6. Verify on the explicitly configured test identity: app connection link → Start acknowledgement → account visible in app → explicit confirmation → sent sticker acknowledgement → pending pack preview → explicit Add. Test a duplicate delivery and missing metadata; confirm nothing was automatically added or placed. Inspect webhook status and app state rather than treating a sent acknowledgement as proof of successful import.

A continuously running polling service is not part of hosted operation. The existing Cloudflare Worker receives webhook requests; D1 stores connection/suggestion state and R2 retains imported bytes. No new hosting service is required.

## Local verification

Final local source passed package typecheck,14 unit/integration files /162 tests, web and desktop app/DMG builds, and the complete439-test browser suite with four intentional skips, retries disabled and no failures (4.9min). Both phone engines verify the new shelf's exact lifted-preview/drop alignment and unobstructed landscape Favorite action. The earlier affected-case repeat passed27/27. The previously built isolated QA app supplied direct TGS/WEBM transparent-still evidence, but native exactly-one tray drag remains unverified. A local-only Worker dry run passed after the bot implementation; it used an empty environment file and performed no deployment, real-message delivery or webhook registration. Exact gates, qualified earlier failures and final source hashes are in the latest [QA checkpoint](README.md).
