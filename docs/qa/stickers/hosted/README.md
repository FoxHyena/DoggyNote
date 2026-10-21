# Hosted Telegram QA

The user authorized this isolated deployment on 2026-10-20 (“Sweet, let’s do it”) after reviewing the test-first hosting plan. Production has not been deployed, migrated, merged or assigned this bot.

## Deployed environment

| Resource | Dedicated QA value |
| --- | --- |
| Web/API | https://doggynote-stickers-qa.oreothehyena.workers.dev |
| Webhook | https://doggynote-stickers-qa.oreothehyena.workers.dev/api/telegram/webhook |
| Worker | `doggynote-stickers-qa` |
| Active version after secret upload (live walkthrough) | `f6f10a55-34d7-4887-9f22-be873007edfd` |
| Current version (import redesign + user rounds 1–5, manual review pending) | `c844279a-a0a3-4a54-9b62-a6c2b6dc4109` (migration 0011 applied here only) |
| Initial code upload | `0cda3506-f7ac-4a7f-9d18-0c73cd7a919b` |
| D1 | `doggynote-stickers-qa`, `3a8f1877-769d-433c-9e81-320e48d8cdeb` |
| R2 | `doggynote-stickers-qa-assets` |
| Config | [wrangler.stickers-qa.toml](../../../../apps/server/wrangler.stickers-qa.toml) |
| Bot | `@DoggyNoteBot`, verified against `getMe` and private configuration |

This configuration has no production routes or bindings and no `DEV_DIAG`. All ten migrations, including `0010_stickers.sql`, applied to the new empty QA database. The same-origin web build uses `VITE_APP_VERSION=0.0.1`, a separate ignored output directory, and the already verified application source. A random-password, non-admin QA account was provisioned privately; no publicly known local fixture password was deployed.

## Verification so far

- Web build and explicit-config Worker dry run passed. The upload completed successfully with the dedicated D1/R2 bindings.
- Public HTTPS health: 200 and `ok:true`.
- Unauthenticated personal collection: 401. Missing webhook secret: 403.
- Private non-admin sign-in: 200. Authenticated image-token endpoint: 200. Hosted Telegram configuration is available.
- Actual Paseo browser fill/click sign-in succeeded, created the private home board and opened Stickers → Add pack → Send a sticker in Telegram → Connect. This is successful browser input evidence; the earlier local browser paint failure remains historical.
- Before registration, `getWebhookInfo` had no webhook and three queued updates. Registration used the exact QA URL, a new independent secret supplied privately, `allowed_updates:["message"]`, four connections, and `drop_pending_updates:false`.
- Subsequent Telegram status confirmed the exact QA webhook, zero pending updates and no delivery error. This proves webhook receipt/acceptance; it does not prove that a person saw an acknowledgement.
- The user pressed Start, explicitly confirmed the identity in the app and sent a real sticker from `miniswizzyeen` (SwizzYeen ministicks). The user explicitly reported receiving both the Start reply and sticker acknowledgement. The authenticated app showed the confirmed connection and pending pack.
- Before explicit Add, the collection was empty and the board had no stickers. The pack reached **96/96 ready, zero preparation errors**. The agent inspected the actual hosted preview and clicked Add in Paseo's browser. The resulting collection has exactly one pack with all 96 stickers; the board still has zero stickers. [Preview](pack-preview.png), [added collection](collection-added.png), [before import counts](before-import-counts.json), [final counts](final-counts.json).
- Two direct HTTP replay checks used the handler-relevant sticker fields and an already processed real test update ID. Both returned `200 {ok:true}` with no reply request; connection and pending state were unchanged. The original full Telegram body was not retained, and these checks did not execute a Bot API send. [Replay evidence](replay.json).
- Final webhook status remained at zero pending updates with no error. **The hosted positive pairing/reply/suggestion/explicit-Add flow passed.** Missing-metadata, timeout, expiry and wrong-account paths retain their existing deterministic integration/E2E evidence; no additional live delivery claim is made for those recovery paths.

Sanitized API evidence: [registration](register.json), [webhook status](status.json), [pairing state](state.json). Reports contain no bot token, webhook secret, passwords, session token, Telegram user ID or connection link. Browser evaluation of the connection input was blocked by CSP; CSP was preserved and the user was directed to the ordinary Open bot link.

The user then requested a new visual cleanup of the connection/add/pack-preview screens and asked to perform the manual walkthrough after those changes. The captures and [deployment source](deployment-source.json) above prove the **pre-cleanup hosted test**; they must not be represented as a manual pass of a later UI build.

**Redesign deployment.** The redesigned import screens were deployed to this same QA Worker as version `01cc968d-6d20-48d4-b7e7-994a2ae9a3c6` ([source manifest](deployment-source-redesign.json)); secrets, pairing, webhook and the 96-sticker pack were unchanged afterwards. The user reviewed it and requested five changes, deployed as `67a3811b`, then a second round as `c1af5bd0-a57f-4f61-a12b-b2524ee8bdc7` with migration `0011_telegram_suggestions` applied to the QA database only, then round 3 as `cc5ff8c3-b871-498f-86c3-b7bc524f0619` round 4 as `bc4ad37f-f1c2-4fb0-b406-ba669ec7dd59` and round 5 as `81ad6525-3c74-42fe-b9ef-81feeb0679be`, then with the tighter group ring as `c844279a-a0a3-4a54-9b62-a6c2b6dc4109`; manual review of that build is **pending**. See the [design record](../import-flow-design.md).

## Operational notes

Run QA Wrangler commands from `apps/server` with `--config wrangler.stickers-qa.toml`. The default `wrangler.toml`, `deploy:all`, database name `doggynote` and merge-to-main workflow target production and are not QA commands.

Secrets are hosted Worker secrets, supplied through an ignored mode-600 private input file. The bot token/username came from the explicitly configured test bot; webhook and asset signing secrets are independent from the local environment. Private account/bootstrap files are under ignored `.wrangler/stickers-hosted-qa/`; do not print, commit, attach or use secret values as command arguments. The temporary diagnostic reads these files internally and supplies sensitive HTTP fields through curl stdin.

The bot currently belongs to this QA webhook. Do not run the old local polling bridge (`getUpdates`) while the webhook is registered. Before changing its destination, recheck bot identity and current webhook. Preserve pending updates unless an explicitly reviewed test requires otherwise. When QA is finished, decide whether to retain this test environment or unregister this webhook and remove only its dedicated resources; production requires a separate reviewed release and intended bot configuration.
