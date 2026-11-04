# Hover-only camera follow-up

User correction: show the account-avatar camera only on hover. Removed automatic visibility for empty photos, focus, open menus and touch. Mouse hover is gated by hover/fine-pointer capability and the existing mouse input mode, preventing sticky touch hover. Keyboard focus outlines, avatar labels and photo options remain operable.

Four existing browser cases passed against the production web build: Chromium/WebKit identity and menu flows, plus iPhone/Pixel touch crop flows. Assertions cover empty and saved photos, hover entry/exit, focus, expanded menus and touch. Desktop and mobile rendered captures were inspected. No backend change or new crop behavior.

The prior stationary-final matrix and independent ship review precede this explicit user correction. Their source fingerprints describe that snapshot and are not fingerprints of this later CSS change. Current screenshots are retained here. No detector or full review was rerun for this narrow correction.

Reproduce with the normal configuration (temporary screenshot configuration was removed after capture):

```sh
E2E_PORT_OFFSET=190 E2E_PERSIST_DIR=/private/tmp/doggynote-avatar-hover-only pnpm --filter web exec playwright test avatars.spec.ts mobile-avatars.spec.ts --grep 'profile photo options|profile photo: touch' --workers=2
```
