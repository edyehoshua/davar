# Besorah remediation #43 / #135

The v2 merger previously lost verse identity and confidence and retained stale failed assignments. It now validates book/chapter/verse/index, exact normalized text and previous Strong before writing a staged book. Failed, skipped and low-confidence results clear the prior Strong and retain the candidate for review. Prefix composition is validated and idempotent; accepted prefix metadata is synchronized. The post-merge publication gate cannot be disabled. Static web/offline generation also rejects unapproved candidates and non-Hebrew artifacts.

## Corpus corrections and review

The immutable report `data/delitzsch_review/reports/besorah_remediation_v1.json.gz` records every before/after value, source identity, rationale, file hash and review candidate. Baseline Git revision: `5f8c51eb8`.

All 1,105 mapping corrections were mechanically checked against narrow rules. The first and last two examples in each grammar category were inspected alongside their existing bilingual dictionary definitions and prior references:

| Form | Reviewed target | Changes | Previous mismatch examples |
|---|---|---:|---|
| בּוֹ / בוֹ | D0208, in/with him or it | 271 | H8055 (185 occurrences), H3642 |
| לִי | D0265, to/for me | 196 | H1350 |
| לוֹ | D0266, to/for him | 539 | H7592 |
| בָּהּ | D0271, in her/it | 50 | H892, H3642 |
| בָּהֶם | D0277, in/among them | 48 | H1990, H3642 |
| בּוֹכִיּוֹת, Acts 9:39 word index 12 | H1058, feminine plural participle of בכה | 1 | null, spurious bet prefix |

Matching requires full pointing, protects previously applied/skipped decisions and proper-name flags, and excludes unpointed forms, conditional לוּ and the real בִּי homograph. Confidence .99 describes the rule category, not empirically measured corpus accuracy. Existing grammatical dictionary entries are reused; 1,104 new location references are synchronized without deleting prior evidence.

Three literal WO-only placeholder verses are removed (3 John 1:15, Revelation 12:18, Romans 7:26), with complete original payloads in the ledger. No scripture text is invented. A standalone sof pasuq falsely mapped H539 in John 6:69 is rejoined to the preceding word. Hebrew letter/pointing hashes are identical before and after.

Baseline: 109,771 tokens, two nulls (one Hebrew word and one placeholder). Final: 109,767 Hebrew tokens, zero nulls. This is mapping coverage, **not 100% lexical accuracy**. The report explicitly queues 11,528 existing occurrences for heuristic investigation and 16,084 legacy assignments that lost verse identity. Existing legacy references flagged heuristically are not newly accepted candidates or proven errors; no weak candidate is applied to them.

## Validation

- `python -m pytest -q tests/test_merge_strongs.py tests/test_besorah_remediation.py tests/test_delitzsch_review.py`: 35 passed.
- `python scripts/delitzsch/review/remediate.py plan --baseline-ref 5f8c51eb8 --plan /tmp/besorah-repeat.json.gz`: byte-identical to committed plan (`cmp`).
- `python scripts/delitzsch/review/remediate.py apply`: second application changed zero chapter files and zero custom references.
- `python scripts/delitzsch/review/remediate.py check`: publication invariants and complete final corpus hash pass.
- Checked-in regression asserts all 1,105 mapping rules, character preservation, confidence/stale identity failure handling, atomic prevalidation and repeat stability.

Rerun with the fixed baseline revision to reproduce this historical report. A new remediation run should use its own versioned report and baseline. Full manual verification of the heuristic queue is distinct from the completed workflow and is not claimed here.
