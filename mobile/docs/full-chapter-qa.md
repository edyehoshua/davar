# Full Chapter and Sefer QA

Issue #23 was partly implemented before this change. Existing localized settings and storage were retained, following the newer shared settings policy (Full Chapter in every display mode; Book Style with a single language). This supersedes the older issue's Hebrew-only visibility restriction.

The reader now virtualizes verse cards. Sefer presents adjoining native RTL text sections of four verses, with no verse labels or paragraph margins. Bounded sections keep native interactive text layout responsive on long chapters; wrapping can end a line at a section boundary. Each Hebrew word retains its original word object, pointing/cantillation display policy, and analysis callback. No corpus text is changed.

Measured row heights and scroll offsets are retained per chapter, target, display mode, source, width and font settings. Navigation does not render stale chapter data. Settings hydration restores Translation Only before explicit Full Chapter and Sefer preferences, fixing a cold-start reset.

## Actual emulator checks (2026-09-06)

Android Nexus 9 AVD, API 36 ARM64, Expo Go SDK 54, landscape 2048×1536; development JavaScript and local static data. This is not a production binary benchmark or physical-device QA.

- Psalm 119, all 176 verses: card initial React render 109.70 ms. Sefer cold-start React render 13.91 ms after bounding native text sections. These timings exclude downloads/native drawing and are not end-to-end launch times.
- An initial single-text implementation stalled and took 1,706.52 ms; it was replaced, not accepted. Final Sefer updates observed after reducing concurrent simulators were approximately 7–18 ms.
- RTL Hebrew and niqqud visually checked; no verse numbers in Sefer. Tap אַשְׁרֵי opened H835 with meanings and 42 instances.
- Full Chapter and Hebrew Only survived cold restart after hydration fix. A subsequent cold restart retained Sefer too.
- Native scrolling advanced through Psalm 119. Chapter picker navigated to Psalm 1 and back to Psalm 119. After retaining measured row heights, the same visible Hebrew section returned within one physical pixel (bottom bound 409 before, 410 after).
- NavigationSheet uses its constant closed initial index; imperative opening remains responsible for positioning. This removes the controlled-index render write introduced during tablet work.

Automated checks: `bun run lint`, `bun run typecheck`, `bun test src/services/*.test.ts`; chapter tests preserve all 176 verses in order and bound section size, including empty/short chapters.
