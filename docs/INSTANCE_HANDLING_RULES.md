# Dictionary Instance Handling Rules

Status: design specification for issue #94
Version: 1.1

This document defines deterministic handling for dictionary entries with many
attested instances. It is a contract for a later implementation; it does not
change generated data or runtime behavior by itself.

## 1. Volume tiers

The tier is based on the number of valid, deduplicated instances attached to an
entry after normalization.

| Tier | Count | First-pass surface set | Full-set policy |
| --- | ---: | ---: | --- |
| low | 0-99 | all instances | retain all |
| medium | 100-999 | all instances, grouped by book | retain all |
| high | 1,000+ | deterministic top 500 | retain all for background/export use |

The limits are product and implementation constants. A later implementation
must expose them in one configuration object and include the configuration
version in generated reports.

## 2. Normalization and deduplication

Before ranking, each instance is normalized without changing its source value:

1. Require a stable reference key (`book`, `chapter`, and `verse`). Token/index
   is optional; missing values use the explicit ordering fallback in section 3.
2. Trim surrounding whitespace from display fields and normalize Unicode to
   NFC for comparison.
3. Preserve the original source payload for display and audit.
4. Collapse duplicate reference keys by retaining the record with the highest
   confidence; ties use the deterministic source key (lexicographic order).
5. Reject records with missing book/chapter/verse or invalid numeric ranges and
   report them as validation findings rather than silently dropping them.

### 2.1 Source key and canonical serialization

The source key is a tuple serialized as a canonical JSON array:
`[source_manifest_id, source_record_id, book, chapter, verse, token_or_index]`.
`source_manifest_id` identifies the entry in the versioned source manifest;
`source_record_id` is the source's stable record identifier and is `null` when
the source does not provide one. `book` is trimmed and NFC-normalized text;
`source_manifest_id` and `source_record_id` are trimmed ASCII identifiers;
`chapter`, `verse`, and a present `token_or_index` are non-negative integers.
The reference portion (`book`, `chapter`, `verse`, `token_or_index`) is the
stable reference used for deduplication; the source fields make ties between
otherwise identical references deterministic. Missing `source_record_id` is a
validation finding, not permission to invent one for the source key.

Canonical JSON for source keys and fallback identifiers is defined as follows:
object keys are sorted by Unicode scalar value; strings are NFC-normalized and
encoded as JSON strings; arrays retain their specified order; integers use
base-10 notation; negative zero, non-finite numbers, insignificant whitespace,
and trailing data are forbidden. The resulting UTF-8 JSON has no whitespace
between tokens and no final newline. Implementations in every language must
produce byte-identical output for the same normalized values. The fallback
identifier is the lowercase hexadecimal SHA-256 digest of those UTF-8 bytes
for the canonical object `{ "payload": normalized_source_payload,
"reference": [book, chapter, verse, token_or_index] }` (with the same `null`
and normalization rules above), not of a language-native object representation.

The linguistic signal is a normalized number in the inclusive range `[0, 1]`.
It is supplied by the versioned linguistic-signal extractor for the build (the
extractor version is part of the generated report); missing or unavailable
signals default to `0`. Implementations must not substitute an unversioned
model score or a source-specific score without changing this policy version.

## 3. Ranking and ordering

Ranking is stable and deterministic. Sort by this tuple, using descending order
for the first three fields and ascending order for the remaining fields:

1. confidence score (missing confidence is `0`),
2. linguistic signal score,
3. canonical-source priority,
4. earliest canonical reference (`book_order`, chapter, verse, token/index),
5. stable instance identifier.

Canonical-source priority is an explicit integer from the versioned source
manifest: primary canonical text = `3`, approved secondary canonical text =
`2`, non-canonical corroborating source = `1`, and unknown/unlisted source =
`0`. Higher values sort first; a source is never promoted merely because it
appears earlier in a file. `book_order` is the zero-based position in the
versioned canonical-book manifest used by the build. Books absent from that
manifest sort after known books by normalized NFC book name, then by the
remaining reference fields.

For a missing token/index, use the stable sentinel `2^31 - 1` (after all
present non-negative values). For an absent stable identifier, derive
`sha256` of the canonical NFC JSON serialization of the normalized source
payload plus its reference; retain the missing-identifier validation finding.
This fallback is a tie-breaker only and is not a replacement for fixing the
source data.

No filesystem order, insertion order, random value, or wall-clock value may
participate in ranking. Medium-tier presentation groups instances by canonical
book order, then applies the same ordering within each group. High-tier
presentation uses the first 500 ranked records and reports the omitted count.

## 4. Conflict resolution

When multiple rules produce different assignments for one instance:

1. Select the result with the highest confidence.
2. If tied, select the result with the strongest linguistic signal.
3. If still tied, prefer the result supported by more independent sources.
4. If still tied, choose the lexicographically smallest normalized candidate
   and mark the instance `needs_review`.

The source manifest defines `source_manifest_id` for every source and an
`independence_group` for each source. IDs that are aliases or mirrors of the
same underlying publication share one `independence_group`; genuinely
independent publications have different groups. For a candidate, its
independent-source count is the cardinality of the distinct, non-null
`independence_group` values attached to the candidate's supporting source
references after normalization and deduplication. Multiple records, rules, or
manifest aliases in one group count once; an unknown/unlisted source counts
zero and cannot break a tie. The count is computed from the versioned source
manifest and recorded for every conflict candidate in the audit report.

Every conflict must be retained in a machine-readable audit report with all
candidates and the reason the winner was selected.

## 5. Validation and quality gates

The validator must report, at minimum:

- duplicate reference keys before deduplication,
- missing or malformed location fields,
- invalid confidence values (outside 0-1),
- missing stable identifiers,
- conflicting assignments,
- repeated identical payloads at different references,
- high-tier entries whose surface set is not exactly 500 or the full count when
  fewer than 500 valid records exist.

A build fails on malformed locations, invalid confidence values, or unstable
ordering. Duplicates and conflicts are warnings only when they are fully
represented in the audit report; unresolved conflicts remain `needs_review`.

## 6. Performance safeguards

- Load high-tier entries in bounded batches rather than constructing repeated
  full-size intermediate lists.
- Keep the full set available to background/export consumers, while returning
  only the surface set to interactive clients.
- Do not change the public entry shape without a versioned migration. Add
  `instance_policy_version`, `instance_total`, and `instance_surface_count` to
  generated metadata.
- Add a regression benchmark for parsing, ranking, and serialization at 100,
  1,000, and 10,000 instances.

## 7. Canonical examples

- 42 instances: `low`; all 42 are shown in deterministic rank order.
- 400 instances across three books: `medium`; all are retained and grouped by
  canonical book order.
- 4,200 instances: `high`; all 4,200 remain available to export/background
  processing, while the interactive surface contains the top 500 and reports
  `instance_total=4200`, `instance_surface_count=500`.
- Two candidates with equal confidence and signal: choose the stable
  lexicographic fallback and mark the record for review.

## 8. Follow-up implementation plan

The concrete execution issue is [#152](https://github.com/jhonnyisaacc/davar/issues/152),
linked to this design by [PR #144](https://github.com/jhonnyisaacc/davar/pull/144).
It owns implementation and release verification; this document remains the
policy contract. Its milestones are:

1. Policy core: shared versioned constants, normalization, validation,
   deduplication, ranking, conflict resolution, and audit findings.
2. Fixtures and tests: deterministic low/medium/high fixtures, fallback and
   conflict cases, and threshold/ordering regression tests.
3. Generation/export: integrate policy and emit version, total, and surface
   count metadata while preserving the full instance set.
4. Client surfaces: implement bounded interactive surfaces and full
   background/export access through a versioned migration.
5. Performance and release QA: benchmark 100, 1,000, and 10,000 instances,
   run web/mobile regression QA, review report diffs, and publish only after
   generated output is verified.

Each phase must preserve the full instance set and include a report diff before
any generated data is committed.
