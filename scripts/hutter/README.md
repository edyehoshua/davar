# Hutter Hebrew Pipeline

This package contains Davar-side tooling for the Elias Hutter Hebrew extraction work.

## Current State

- Migrated Shafan assets live under `data/hutter/staging/`.
- Existing JSON output is page-oriented: each verse includes `source_files`, usually one cropped page image like `000002.png`.
- The new experiment starts from that JSON and divides each page image into verse-level image candidates.

## Verse Image Experiment

Create a manifest only:

```bash
python -m scripts.hutter.verse_images matthew --manifest-only
```

Audit source mappings and structural edge cases without reading image pixels:

```bash
python -m scripts.hutter.verse_images all --audit-only
```

Create verse crops and a manifest:

```bash
python -m scripts.hutter.verse_images matthew
```

Preview one source page:

```bash
python -m scripts.hutter.verse_images matthew --source-files 000002.png
```

Compute crop boxes without writing cropped image files:

```bash
python -m scripts.hutter.verse_images all --crop-plan-only
```

Process every Hutter book that has both images and JSON:

```bash
python -m scripts.hutter.verse_images all
```

Outputs:

```text
data/hutter/verse_images/<book>/*.png
data/hutter/manifests/<book>_verse_images.json
```

Build the repeatable review report and local contact sheets:

```bash
python -m scripts.hutter.review_verse_images
```

Review outputs:

```text
data/hutter/review_reports/verse_image_review.json
data/hutter/review_reports/sheets/shortest_crops.png
data/hutter/review_reports/sheets/highest_edge_crops.png
data/hutter/review_reports/sheets/first_last_by_book.png
```

The review report also records source availability. As of this pass, the only
books processable by the verse-image pipeline are the books that have both
`staging/output/<book>.json` and `staging/data/images/hebrew_images/<book>/`.
The Old Testament JSON files currently have no local Hutter image folders in
this staging tree, and `laodikim` currently has local images but no matching
JSON source mapping.

The cropper currently uses the existing transcription JSON as the verse/page assignment source of truth. It does not call external OCR. It reads PNG pixels locally, detects the Hebrew column's vertical ruling lines, detects horizontal whitespace gaps in that Hebrew column area, and cuts column-width verse bands with padding so Hebrew content is not clipped. Pages that begin at verse 1 get extra header handling; pages that begin mid-chapter keep the top scan permissive so early verse text is preserved. Crop manifests also record structural notes for first verses, last verses, chapter-transition pages, and basic scan-quality metrics when pixel analysis is enabled.

Important limitation: this removes neighboring side columns, but some Hutter pages also include a Latin/Spanish gloss directly inside the Hebrew column under the Hebrew text. Those in-column gloss lines are still present in the current crops. Do not treat these as strict Hebrew-only crops until a second pass trims each verse band down to the Hebrew glyph block itself.

Use `--manifest-only` when reviewing source mappings without checking file existence. Use `--audit-only` when reviewing source mappings, missing images, first/last verse cases, and chapter transitions without reading image pixels. Use `--crop-plan-only` when validating segmentation on targeted pages before generating cropped PNGs.

## API OCR Pilot

Run a small dry run before spending API tokens:

```bash
.venv/bin/python -m scripts.hutter.process_verses_api colossians --limit 6 --batch-size 3 --dry-run
```

Process a small batch with checkpointing:

```bash
.venv/bin/python -m scripts.hutter.process_verses_api colossians --limit 6 --batch-size 3
```

The runner loads `OPENAI_API_KEY` from the environment or repo `.env`, compresses verse crops before upload, writes raw batch responses plus normalized per-verse rows, and skips already completed verse ids on later runs. Use `--ocr-preprocess --scale 2 --image-format png` only for targeted retries where niqqud fidelity is poor; it can cost materially more tokens per image.

Review the API output:

```bash
.venv/bin/python -m scripts.hutter.review_api_results colossians
```

Summarize all processed GPT OCR books and compare them to their manifests:

```bash
.venv/bin/python -m scripts.hutter.summarize_api_results --results-root data/hutter/api_results_gpt55
```

Outputs:

```text
data/hutter/api_results/<book>/batches.jsonl
data/hutter/api_results/<book>/results.jsonl
data/hutter/api_results/<book>/review.json
data/hutter/api_results_gpt55/summary.json
```

## Image-authoritative transcription QA (#155)

The transcription audit scans every verse, including words already assigned a
Strong number. It does not use Strong candidates to change Hebrew spelling.

```bash
.venv/bin/python -m scripts.hutter.audit_transcription --output data/hutter/review_reports/transcription_audit.json.gz
.venv/bin/python -m scripts.hutter.audit_transcription --apply-reviewed --output data/hutter/review_reports/transcription_audit.json.gz
.venv/bin/python -m scripts.hutter.map_strongs --write
bun run --cwd web generate-data
.venv/bin/python -m scripts.hutter.verify_transcription
.venv/bin/python -m pytest -q tests/test_hutter_transcription.py tests/test_hutter_map_strongs.py tests/test_hutter_verse_images.py
```

`transcription_corrections.json` stores exact before/after verses, reviewed spans,
page/crop locations, image SHA-256 hashes and evidence. Apply validates all image
and text preconditions before writing; repeat application changes nothing.
The report is gzip-compressed with a fixed timestamp for deterministic bytes;
inspect it using `gzip -dc data/hutter/review_reports/transcription_audit.json.gz`.
`transcription_summary.json` records the before/after metrics and export checks.

This pass inspected representative images in all 27 books, repaired 23 verses,
and corrected crop boundaries on four source pages. It does **not** establish
corpus-wide character accuracy. The remaining OCR disagreements, repeated-word
candidates and multi-page cases are explicitly queued for image review.
Alternate OCR sometimes contradicts the printed page: Galatians 3:9, Matthew
6:4, Revelation 12:8 and 2 Thessalonians 3:4 retain the printed Hutter forms.
NFC-equivalent sequences are counted separately from transcription errors.
Historical defective spellings are not normalized to Delitzsch.

The verifier compares the pre-pass snapshot `2fdb23cad` with this ledger, checks
that other verses are unchanged, and checks all repaired verses in mappings,
web chapter JSON and the mobile offline Hutter bundle. Generated bundles are
not tracked; regenerate them before running the verifier. Source images are
local archive assets and are needed for applying corrections, not CI fixture tests.
