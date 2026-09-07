# Navigation positioning QA (#106)

2026-09-06, local Expo Go 54, iPad Pro 11 M4 / iOS 18.6 simulator and
Android Medium Tablet / API 36 emulator. No physical-device QA was performed.

The original failure was reproduced on John: selection was correct but rows
returned to Genesis. Incorrect row geometry and pre-layout scrolling were
not the only causes: Gorhom locks the native scroll offset at a non-extended
snap point. The book picker now opens at its existing 80% extended snap, waits
for sheet completion, viewport and content readiness, and centers once.
Actual fixed row height includes font scaling, padding, borders and spacing.
Native BottomSheetFlatList and its gesture handling remain in control.

Observed: iPad close/reopen repeatedly shows John between Luke and Acts;
Android opens centered on John, a native upward swipe scrolls to Romans /
Corinthians without snapping back, and search John produces John / 1 John /
2 John / 3 John in canonical order. Search does not invoke centering.
The chapter-to-book back path also expands the sheet before positioning.

Automated: `bun test src/services/*.test.ts` passes four tests including
readiness, close/reopen, search suppression, chapter suppression, and offset
clamping checks. `bun run lint` and `bun run typecheck` pass. CI now executes
service tests and installs the frozen lockfile. Temporary readiness logs
used during reproduction were removed.

These simulator observations do not establish universal gesture smoothness
on every iOS device or accessibility font setting.
