# #127: original scope remains incomplete

PR #136 must remain unmerged. The original target is at most 2,000 unresolved tokens, and the unchanged safety gate requires at least 98% lexical precision over at least 100 accepted reviewed examples. No threshold was lowered and no automatic morphology mapping was applied. The current count is **3,723 unresolved tokens** after two image-confirmed verse repairs, still 1,723 above target. Four verse-specific manual lexical/prefix corrections accompany these repairs and are not extra coverage gains.

The experiments below retain their original 3,734-token baseline; current repair accounting is in `data/hutter/review_reports/issue_127_repair_progress.json`.

The starting backtest contains 2,948 explicit manual overrides: 102 TP / 66 FP = 60.71%, with 452 proposed unresolved forms. False positives include custom vocabulary misread as common Hebrew, suffix-stripped nouns confused with verbs, and short stems promoted from sparse corpus evidence.

## Bounded experiments

`python scripts/hutter/evaluate_morphology.py --legacy-parses` measures the existing parses with independent same-verse Strong *sets*, not positional alignment. Semantic support improves to 48 TP / 4 FP = 92.31%, proposing only 39 unresolved tokens. Minimum-three-letter stems do not remove those four false positives. Requiring both semantic support and lexicon-lemma evidence leaves 3 TP / 0 FP and two proposed unresolved tokens: far below the unchanged minimum sample, so this does not constitute a passing precision result. Score thresholds .90/.94/.98 likewise fail the safety/sample gates.

Added bounded verbal parses cover imperfect prefixes, niphal-like forms, hitpael, participles and weak final-he candidates. Conjugation markers are kept separate from actual preposition/conjunction prefix codes. Tests cover ויכבדום, נצדקים and ויתחנקו. These unvalidated parses are review-only, capped below auto-accept score, and remain visible as competing analyses. They expose additional ambiguity rather than increasing accepted coverage: direct backtest 63 TP / 54 FP (53.85%); with same-verse support 34 TP / 3 FP (91.89%), only 22 proposed unresolved tokens. This is not claimed as a precision improvement; it is retained as useful candidate coverage with a failed application gate.

Both experiment reports retain regressions and counts. All are exploratory results on the existing reviewed set, not independent held-out accuracy. Zero candidates are applied, including configurations with a misleading 100% score on only one or three examples.

## Why this cannot complete the issue by threshold tuning

The source remains 3,734 unresolved tokens and needs at least 1,734 justified mappings to meet the original target. Even the legacy unfiltered 452 proposed forms (at most 461 tokens, given only nine repeated-form occurrences) cannot reach the target if all were correct. Semantic constraints reduce that already insufficient ceiling to 39 tokens, while still failing precision. More aggressive unpointed stripping produces new rival interpretations instead of validated paradigms.

The next bounded implementation belongs to this same open issue: pointed, part-of-speech-aware inflection paradigms and independently reviewed historical/custom vocabulary, with a held-out image-reviewed validation set, separate prefix-composition precision and corpus coverage reporting. No separate issue is created to disguise unfinished original scope.

Reproduce with `python scripts/hutter/map_strongs.py --morphology`, `python scripts/hutter/evaluate_morphology.py`, and `python -m pytest -q tests/test_hutter_morphology.py tests/test_hutter_map_strongs.py`. The morphology command exits 2 when the precision gate fails; this is expected blocking evidence, not a green release check. Printed Hutter text is unchanged.

Main was independently rechecked at `572bfa6c95c8d5121122fc7cb43796c28acccb3b`: counting all 27 mapping JSON files gives 107,730 tokens, 103,996 mapped and 3,734 unresolved (96.533927% coverage), exactly matching main's report. Previous merged PRs have not already satisfied the target.

## Pointed attestation follow-up

`python scripts/hutter/evaluate_attested_morphology.py` now measures a separate
source-annotated approach using the checked-in Open Scriptures Hebrew Bible XML
(CC BY 4.0). The analyzer retains exact pointing, part-of-speech/morphology codes,
explicit prefix boundaries and attached pronominal suffixes. It does not guess
conjugation markers from initial letters. Competing lexical or prefix analyses
remain ambiguous even if just one has same-verse Delitzsch support. Each analysis
includes source word IDs and attestation counts; the report hashes all source XML
files and includes source/crop references for every unresolved occurrence.

The deterministic development/validation split groups consonantal forms, so
repeated occurrences and alternative pointing cannot inflate the minimum sample
or appear in both splits. Both lexical and full prefix-composition precision
must reach the unchanged 98% threshold over at least 100 accepted form groups
per split. The validation labels are existing manual overrides, not a newly
commissioned independent image review. Neither split trains the source index.

Results: development accepts 14 groups (12 lexical and composite matches);
validation accepts 20 groups (12 lexical matches, 10 composite matches). Both
gates fail. Exact pointed attestations cover only 21 unresolved tokens; two also
have unique analyses and same-verse support. Zero mappings are applied. The full
regression evidence is retained in `attested_morphology.json`, including noun/verb
label disagreements and incorrect prefix composition. These disagreements must
be adjudicated, not silently treated as equivalent Strong numbers to pass a gate.

This independently sourced method also cannot achieve the remaining 1,734-token
gain. Transcription review must accompany further morphology work: direct visual
inspection of the John 18:4 crop (`john/018_004_000216.png`) found extra OCR text
in the current transcription near the printed `יקרהו יצא`. No transcription
repair is applied by this experiment; it requires a complete pointed reading and
the existing image-hashed correction-ledger workflow. The report continues to
count 3,734 unresolved tokens and does not claim completion of #127.


## Image-confirmed repair batch

Direct crop review corrected 2 Corinthians 11:27 and Revelation 17:3 using the
hashed correction ledger. This is not wholesale OCR replacement: the alternate
OCR disagreed with visible source words, including Revelation's `ארגמן` and
`וראיתי`. The two source verses were transcribed from the images. The first verse
falls from seven unresolved tokens to one, and the second from five to zero.
The corpus remains 107,730 tokens with 104,007 mapped and **3,723 unresolved**.
The remaining `בִּשְׁקֵדוֹת` is deliberately unresolved pending lexical review.

Four contextual overrides retain detailed noun/weak-verb parses and correct
prefix composition: `ביגיעה` (Hb/H3018), `בקר` (Hb/H7120), `בעירום` (Hb/H5903),
and `ויוליכני` (Hc/H3212, hiphil plus 1cs object suffix). Whole-form lexical
mappings retain their actual attested-form evidence without inventing internal
inflections. Verse mappings link back to the source image hash and correction
ledger. The four corrections do not add four to the eleven-token coverage gain.

A full regeneration exposed unrelated drift in existing corpus inputs, including
an existing clitic regression (`לובה` incorrectly acquiring Hl/Hc/D0271). Those
broad outputs were discarded. `--reviewed-transcriptions-only` regenerates only
issue-127 image-reviewed verses, validates the published before/after text and
source image hashes, and preserves all other published mappings and their
unresolved evidence. This mode does not approve general corpus regeneration.

Reproduce this batch with:

```sh
python scripts/hutter/map_strongs.py --reviewed-transcriptions-only --write
bun run --cwd web generate-data
python scripts/hutter/verify_transcription.py
python scripts/hutter/map_strongs.py --reviewed-transcriptions-only --morphology
```

Two regeneration runs were byte-identical across all 27 mapping files and the
aggregate report. A structural comparison confirmed exactly the two reviewed
verses changed. Static/offline verification passed for all 25 ledger corrections.
The automatic morphology precision gate remains blocking; image-confirmed manual
repairs do not authorize unvalidated automatic morphology assignments.
