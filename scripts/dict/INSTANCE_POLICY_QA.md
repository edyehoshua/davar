# Instance policy integration (v1.1)

PR #151 consolidates the runtime engine with PR #149's lexicon consolidation
and validation hooks. PR #144 remains the separate design contract.

`instance_manifest.json` supplies canonical book order (including source-code
aliases), canonical source priorities and publication independence groups.
Unknown sources cannot gain priority or conflict votes through input ordering,
caller-provided source counts, or aliases. Current missing linguistic signals
are zero. Missing source IDs remain warnings; raw source payloads are retained.

Run:

```bash
.venv/bin/python -m pytest tests/test_instance_policy.py tests/test_delitzsch_review.py -q
.venv/bin/python scripts/dict/apply_instance_policy.py --write
.venv/bin/python scripts/dict/benchmark_instance_policy.py
```

The export updater reads original individual lexicon references so repeated
runs retain the same pre-deduplication audit. It validates every entry before
writing. `data/dict/reports/instance_policy.json.gz` includes every finding and
uses deterministic gzip. Custom source arrays and full lexicon reference sets
are preserved. Stable SHA fallback IDs are tie-breakers, not invented source IDs.

The generated set contains 9,258 entries, with zero error findings: roots have
11 high / 112 medium / 1,191 low; words 22 high / 253 medium / 7,085 low;
custom entries 4 medium / 580 low. Full-set equality and unrelated-field
preservation were checked against the previous exports. Added surface lists
and metadata explain the large generated diff.

Web and mobile use `shared/instanceSurface.ts`: high-volume first-pass displays
are capped at 500, medium custom surfaces retain the generated book-group order,
counts reflect full sets, and original arrays remain available in static exports.
Legacy manual display strings retain their original formatting. They are not
silently parsed into invented token locations. Source-specific manual/OT/NT
arrays remain available for audit.

Regression tests cover reversed input order, score and location validation,
missing IDs, canonical JSON fallback hashes, source alias independence, top
conflict ties, string references, source payload preservation, medium grouping,
and high-tier limits. Web tests execute the same pure helper imported by mobile.
