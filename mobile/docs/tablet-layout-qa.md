# Responsive tablet QA (#105, #85)

The shared window-based utility in `src/services/responsiveLayout.ts`, exported
through the theme, drives reading width, chapter spacing, font scaling, dialog
width, controls and book/chapter/verse grids. Tablet windows start at 768 dp
and at least 600 dp tall; a short phone landscape window stays compact.
Portrait reading measure is capped at 900 dp; landscape at 1080 dp. Navigation
uses 8/10 tablet columns and responsive width, with cells at least 44 dp wide.
Phone portrait metrics are retained except the verified deep-link safe-area fix.

PR #148's useful chapter width, padding, gap and font changes are consolidated
here. Hebrew font and line height scale together, including continuous chapter
text; the previous isolated font-size increase is not retained.

## Actual local QA, 2026-09-06

Expo Go 54 with local Metro and generated static data served over loopback:

- iPad Pro 11 M4 / iOS 18.6: portrait and landscape reader, Hebrew wrapping,
  selected book positioning, and 10-column landscape chapter grid.
- iPhone 16 Pro / iOS 18.6: portrait and landscape reader. Found and fixed book
  controls hidden under the notch on deep links; safe-area screenshot verified.
- Android Nexus 9 profile (8.9 inch), API 36: 1536×2048 portrait and 2048×1536
  landscape; reader, selected-book picker, and rotation with picker open/closed.
- Android Medium Tablet profile, API 36: 1600×2560 portrait and 2560×1600
  landscape; Hebrew/translation wrapping and reading composition.
- Rotating a closed Gorhom sheet exposed stale snap geometry and a blank sheet.
  The native sheet is recreated for the new window and the transient picker
  closes on resize. The reading location remains unchanged; reopening centers
  the current book with fresh geometry. Verified on Nexus 9.

PASS: six mobile service tests, mobile lint (no warnings), TypeScript, diff check.
Automated width checks cover 320/390/600 dp compact windows and both tablet
orientations, grid overflow and minimum targets. Actual iPad Split View dragging
and physical-device testing were not performed; do not treat those as passed.

## Native release impact

The old native configuration locked portrait. `orientation: default` now enables
both orientations, including phones; compact phone styling remains unchanged.
Runtime version moves from 1.0.0 to 1.0.1 so this native behavior is not advertised
as compatible with old installed binaries. `expo config --type introspect`
verified Android MainActivity `screenOrientation=unspecified` and all four iOS
orientations. No native dependencies were added. Expo Go QA is not a production
binary test. A new Android native build is required; no release was executed.
