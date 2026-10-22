# iPhone smoke test after deployment

Allow about 5–10 minutes. Reload the deployed release in Safari and use a scratch board. If you normally launch DoggyNote from the Home Screen, repeat the key checks there too. Record the iPhone model, iOS version and launch mode with any issue.

## Normal motion

- [ ] **Fast Add:** tap **+**, tap outside to dismiss, then immediately tap **+** again. Repeat a few times quickly. Every deliberate reopen should work, without a dead tap or surprise dismissal.
- [ ] **Keyboard:** choose **Note** from Add and type immediately. The keyboard should appear on that tap, text should enter the note and the editor should stay reachable above the keyboard. Also zoom out, open an existing note to edit and confirm it frames correctly and accepts typing.
- [ ] **Sheet gestures:** open **Boards**. Pull a small distance slowly from its top grip and release: it should return. Pull farther down or flick down deliberately: it should close cleanly. Try catching a departing sheet and pulling it back up: it should stay open after settling. Scroll inside a long sheet: the contents should scroll normally. Reopen a sheet after each attempt and confirm it is still usable.
- [ ] **Fetch:** open Fetch, type a search, choose a result and close/reopen it several times. The field and results should respond immediately; the keyboard should leave enough space to use the results.
- [ ] **Notification and Undo:** bury a scratch note. Its notification should stay centered near the top, clear of the notch, with no sideways jump. Tap **Undo**: the note should return. Repeat quickly and try a longer notification, such as locking a card's position.

## Reduced motion and layout

- [ ] In iPhone **Settings → Accessibility → Motion**, enable **Reduce Motion**. Return to DoggyNote, use the zoom control's **+ / −**, then open a zoomed-out note to edit. Programmatic camera changes should jump directly to their destination; editing and keyboard focus should still work. Direct finger panning/pinching should remain usable.
- [ ] Repeat fast Add, sheet dismissal and notification/Undo with Reduce Motion enabled. Controls must remain responsive and sheets must settle correctly.
- [ ] Switch between light and dark appearance and briefly rotate to landscape. Check the open sheet, notification and keyboard for clipping or unreachable controls. Restore your preferred motion setting afterward.

**Pass:** no ignored deliberate taps, unexpected sheet closure, lost keyboard focus, sideways notification motion or noticeable new canvas hitching on your usual board.

If something fails, capture a short screen recording with the exact taps, launch mode and Reduce Motion setting. Browser automation passed; this checklist supplies the physical-iPhone verification still outstanding in [the results](motion-results.md). The full macOS native walkthrough remains a separate check.
