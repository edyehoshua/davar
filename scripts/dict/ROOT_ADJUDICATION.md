# Root adjudication v1

The production pass uses the checked-in Strong's derivation text. Spelling
similarity is a review signal, not proof of a semantic relationship. A single
unqualified citation chain must terminate at an existing canonical root before
it can be accepted. Compound/alternative references, uncertain qualifications,
missing references and cycles are explicitly unresolved. The 0.99 confidence
is a rule category, not a measured probability. Optional AI recommendations in
the exploratory audit remain review-only; confidence alone cannot authorize a
root change. No external AI service was invoked for the source-grounded pass.

```bash
.venv/bin/python scripts/dict/adjudicate_roots.py --report data/dict/reports/root_adjudication.json --apply
.venv/bin/python scripts/dict/validator.py
.venv/bin/python -m pytest tests/test_adjudicate_roots.py tests/test_build_lexicon_bdb.py -q
cd web && bun run build
```

The report records every one of the 7,360 non-root entries with evidence,
original link, decision, confidence and rationale. Source SHA pins the lexical
evidence. Individual sources and consolidated output are updated together;
subsequent lexicon builds use the same source-chain rule. Original links remain
in adjudication metadata. Re-running application changes zero entries.

Results: 1,041 links now reach a cited canonical root; 2,090 invalid canonical
links were removed, with explicit unresolved metadata. Missing root targets
fall from 3,131 to zero. There are 3,475 unresolved semantic decisions, including
2,961 entries without a canonical link. Existing valid but uncertain links are
retained for review. Every one of 246 orphan roots is explicitly retained as a
standalone canonical primitive lexeme; having no unambiguously derived child
is not grounds for deleting a lexical entry.

No definitions, instance sets, transliterations or other unrelated fields were
changed. Static served root links match individual sources. The report does
not claim a full scholarly semantic certification of unresolved derivations.
