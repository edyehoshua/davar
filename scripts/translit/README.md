# Transliteration Pipeline (Per-Word)

This module generates per-word transliterations for Tanakh and Besorah source texts using local transliteration rules. It reads word-level verse data and writes per-book JSON outputs.

## Goals

- Transliterate actual verse words (not Strong's entries)
- Output simple, readable English and Spanish transliterations
- Preserve alignment to book, chapter, verse, and word index
- Keep output aligned to the source data

## Output

Each book produces a `book.json` file in [data/translit](data/translit):

- `book_id`, `source`, `language_targets`, `generated_at`
- `verses[]` with `chapter`, `verse`, and `words[]`
- each word includes `id`, original fields, and `translit_en`/`translit_es`

## Input Sources

- Tanakh: [data/oe](data/oe)
- Besorah: [data/delitzsch_parsed](data/delitzsch_parsed)
- DSS variants: [data/dss/books](data/dss/books) (differences only)

DSS output fields

DSS variants are emitted with `dss_translit_en`, `dss_translit_es`,
`dss_translit_source`, and `dss_translit_confidence`. Resolution is
deterministic: complete editorial fields win (`editorial`/`high`), otherwise
the local transliterator runs on the DSS surface form (`local_rule`/`medium`),
with `low` confidence reserved for an empty baseline. The legacy
`translit_en`/`translit_es` aliases remain so existing web and offline clients
continue to read the output. Pass `--use-xai-vocalization` to add a cached AI
vocalization stage before the same deterministic output step; unavailable AI
falls back to the unpointed DSS form.

## Files

- `config.py` - paths, model, pricing, batching defaults
- `models.py` - data structures
- `batcher.py` - mixed batching by verse + token budget
- `local_processor.py` - local per-book orchestration
- `qa.py` - output validation
- `benchmark.py` - reproducible benchmark scorer and exact-match gate
- `main.py` - CLI entry point

## Notes

- Uses local transliteration rules only (no external API calls).
- `data/translit/benchmark.json` is the approved Tanakh baseline. It covers
  vowels/sheva, prefix clusters, proper names, sacred-name policy, final-heh,
  and common study vocabulary. Run `PYTHONPATH=. python -m
  scripts.translit.benchmark data/translit/benchmark.json --fail-under 1.0`.
  The JSON report records every actual output and both exact and normalized
  rates, making regressions reproducible in CI. Besorah cases can be added to
  a separate fixture and scored by the same harness after Tanakh review.

## How to Run

Run commands from the project root: `/Users/jhonny/davar`

### List available books

```bash
python -m scripts.translit.main --corpus tanakh --list-books
python -m scripts.translit.main --corpus besorah --list-books
```

### Transliterate a single book

```bash
# Dry-run (no file written)
python -m scripts.translit.main --corpus tanakh --book genesis --dry-run

# Write output
python -m scripts.translit.main --corpus besorah --book john

# DSS variants (differences only)
python -m scripts.translit.main --corpus dss --book 1samuel

# DSS variants with xAI vocalization (niqqud), then local transliteration
python -m scripts.translit.main --corpus dss --book 1samuel --use-xai-vocalization

# DSS with explicit per-request character budget for lower API call count
python -m scripts.translit.main --corpus dss --book 1samuel --use-xai-vocalization --max-chars-per-request 12000
```

### Local mode (default)

```bash
# Local dry-run
python -m scripts.translit.main --corpus besorah --book john --dry-run
```

### Transliterate all books in a corpus

```bash
# Dry-run entire Tanakh
python -m scripts.translit.main --corpus tanakh --book all --dry-run

# Process entire Besorah
python -m scripts.translit.main --corpus besorah --book all
```

### Control batch size

```bash
python -m scripts.translit.main --corpus tanakh --book genesis --token-budget 8000
```

### Verbose logging

```bash
python -m scripts.translit.main --corpus tanakh --book genesis --verbose
```

DSS transformation v1 also reads the existing cached AI vocalizations without
network calls. A cache value is used only when its ordered Hebrew consonants
match the DSS source; changes to consonants are rejected and retained in the
review report. Unpointed rule-only output is low confidence. This does not
silently replace an ambiguous DSS reading with Masoretic wording.

`data/translit/dss_transformation_report.json` records all 881 variants across
25 books: 721 cached-AI transformations and 160 local fallbacks, including 111
rejected cache uses. Remaining low-confidence forms are enumerated. Generation
uses source/cache hashes instead of a timestamp and reruns byte-identically.
Static export joins on chapter, verse, position AND exact DSS surface; explicit
DSS fields win. Offline SQLite payloads preserve all additive fields. Reader
flows do not fall through to an unrelated Masoretic transliteration. Word
analysis may use the DSS lexicon; the mobile equivalent-Strong fallback remains
explicit rather than unconditional.
