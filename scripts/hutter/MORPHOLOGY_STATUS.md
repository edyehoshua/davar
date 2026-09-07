# #127: original scope remains incomplete

PR #136 must remain unmerged. The original target is at most 2,000 unresolved tokens, and the unchanged safety gate requires at least 98% lexical precision over at least 100 accepted reviewed examples. No threshold was lowered and no morphology mapping was applied.

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
