"""Image-authoritative transcription QA; never infer repairs from Strong IDs.

Alternate OCR disagreements are *candidates*, not confirmed transcription errors.
The correction ledger is separately reviewed against hashed source page images.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from difflib import SequenceMatcher
import hashlib
import gzip
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path("data/hutter/staging/output")
LEDGER = Path("data/hutter/transcription_corrections.json")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if path.suffix == ".gz":
        path.write_bytes(gzip.compress(rendered.encode("utf-8"), mtime=0))
    else:
        path.write_text(rendered, encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def letters(text):
    # Preserve final forms: they are evidence, not interchangeable OCR glyphs.
    return re.sub(r"[^א-ת]", "", unicodedata.normalize("NFD", text))


def verses(payload):
    for chapter in payload.get("chapters", []):
        for verse in chapter.get("verses", []):
            yield (int(chapter["number"]), int(verse["number"])), verse


def apply_ledger(root=ROOT, ledger_path=LEDGER):
    """Validate every precondition before any write; repeated application is inert."""
    ledger = read(root / ledger_path)
    pending = {}
    changed = 0
    for row in ledger["corrections"]:
        if row.get("review_status") != "image_confirmed" or not row.get("evidence"):
            raise ValueError("Only explicit image-confirmed decisions can be applied")
        image = root / row["source_image"]
        if digest(image) != row["source_image_sha256"]:
            raise ValueError(f"Source image changed: {image}")
        book = row["book"]
        payload = pending.setdefault(book, read(root / SOURCE / f"{book}.json"))
        matches = [v for key, v in verses(payload) if key == (row["chapter"], row["verse"])]
        if len(matches) != 1:
            raise ValueError(f"Missing/duplicate verse: {book} {row['chapter']}:{row['verse']}")
        verse = matches[0]
        if Path(row["source_image"]).name not in verse.get("source_files", []):
            raise ValueError("Correction image is not assigned to this verse")
        if verse["text_nikud"] == row["after"]:
            continue
        if verse["text_nikud"] != row["before"]:
            raise ValueError(f"Stale transcription precondition: {book} {row['chapter']}:{row['verse']}")
        verse["text_nikud"] = row["after"]
        changed += 1
    for book, payload in pending.items():
        path = root / SOURCE / f"{book}.json"
        if read(path) != payload:
            write(path, payload)
    return changed


def audit(root=ROOT):
    books = sorted(p.stem for p in (root / "data/hutter/strong_mappings").glob("*.json"))
    findings = []
    totals = Counter()
    hashes = {}
    for book in books:
        source = root / SOURCE / f"{book}.json"
        hashes[str(SOURCE / source.name)] = digest(source)
        payload = read(source)
        manifest = root / f"data/hutter/manifests/{book}_verse_images.json"
        contexts = defaultdict(list)
        if manifest.exists():
            for entry in read(manifest).get("entries", []):
                contexts[(entry["chapter"], entry["verse"])].append(entry)
        alternatives = defaultdict(dict)
        ocr = root / f"data/hutter/api_results_gpt55/{book}/results.jsonl"
        if ocr.exists():
            hashes[str(ocr.relative_to(root))] = digest(ocr)
            for line in ocr.read_text(encoding="utf-8").splitlines():
                row = json.loads(line)
                parts = row.get("id", "").split(".")
                if len(parts) >= 4:
                    alternatives[(int(parts[1]), int(parts[2]))][parts[3]] = row
        seen = set()
        previous = {}
        for key, verse in verses(payload):
            text = verse.get("text_nikud", "")
            totals["verses"] += 1
            totals["tokens"] += sum(bool(letters(p)) for word in text.split() for p in word.split("־"))
            totals["hebrew_letters"] += len(letters(text))
            refs = verse.get("source_files", [])
            base = {"book": book, "chapter": key[0], "verse": key[1], "current_text": text,
                    "page_images": [f"data/hutter/staging/data/images/hebrew_images/{book}/{f}" for f in refs],
                    "crops": [{k: e.get(k) for k in ("source_image", "output_image", "crop_box", "status")} for e in contexts[key]]}

            def add(kind, evidence, proposed=None, confidence="review_required"):
                findings.append({**base, "error_class": kind, "suspected_corrected_transcription": proposed,
                                 "confidence": confidence, "evidence": evidence, "status": "requires_review",
                                 "automatically_fixed": False})

            if key in seen:
                add("duplicate_verse_boundary", "Duplicate chapter/verse reference", confidence="high")
            seen.add(key)
            if not letters(text):
                add("incomplete_extraction", "No Hebrew letters", confidence="high")
            if not refs or any(not (root / p).is_file() for p in base["page_images"]):
                add("missing_page_evidence", "Source-page reference absent or unavailable")
            if not contexts[key]:
                add("missing_crop", "No verse crop manifest entry")
            if re.search(r"\ufffd|[\u0080-\u009f]", text):
                add("encoding_artifact", "Replacement/control character", confidence="high")
            if re.search(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069]", text):
                add("rtl_control", "Explicit directional controls require source-order verification")
            if re.search(r"[A-Za-z0-9]", text):
                add("page_furniture_or_foreign_text", "Latin letters/digits inside Hebrew extraction")
            if text != unicodedata.normalize("NFC", text):
                totals["non_nfc_verses"] += 1  # Encoding equivalence is not a printed-text error.
            if letters(text) and not re.search(r"[\u05b0-\u05bc\u05c1\u05c2]", text):
                add("missing_niqqud", "Pointed transcription contains no Hebrew vowel marks")
            for token in re.split(r"[\s־]+", text):
                if re.search(r"[ךםןףץ][א-ת]", letters(token)):
                    add("final_form_or_joined_words", f"Medial final form in {token}")
                marks = re.findall(r"[\u05b0-\u05bc\u05c1\u05c2]+", unicodedata.normalize("NFD", token))
                if any(len(m) != len(set(m)) for m in marks):
                    add("duplicated_niqqud", f"Repeated identical combining mark in {token}")
            tokens = text.split()
            if any(letters(a) == letters(b) and letters(a) for a, b in zip(tokens, tokens[1:])):
                add("possible_duplicated_word", "Adjacent repeated form; may be genuine rhetoric")
            if letters(text) in previous and len(letters(text)) > 20:
                add("possible_duplicated_verse", f"Same consonants as {previous[letters(text)]}; may be genuine repetition")
            previous[letters(text)] = key
            rows = list(alternatives[key].values())
            if len(refs) == 1 and len(rows) == 1 and rows[0].get("status") == "ok":
                other = rows[0].get("hebrew_text", "")
                if letters(other) and letters(other) != letters(text):
                    similarity = SequenceMatcher(None, letters(text), letters(other), autojunk=False).ratio()
                    add("ocr_disagreement", {"alternate_ocr_id": rows[0]["id"], "similarity": round(similarity, 6),
                         "note": "May be wrong/dropped/duplicated letters or words, order, or a bad crop. Neither OCR nor Delitzsch is authoritative."}, other)
                elif letters(other) and unicodedata.normalize("NFC", other) != unicodedata.normalize("NFC", text):
                    add("pointing_punctuation_or_segmentation_disagreement", "Same consonants; compare marks, punctuation and boundaries with image", other)
            elif rows:
                add("multi_page_extraction_review", "Do not compare a partial-page OCR result to a whole verse")
    return {"schema_version": 1, "books": books, "totals": dict(sorted(totals.items())),
            "finding_counts": dict(sorted(Counter(r["error_class"] for r in findings).items())),
            "source_sha256": hashes, "findings": findings,
            "limitations": "Automated flags are not confirmed errors. Line/column/verse order, missing text and historical variants require page verification. No character/word accuracy is claimed without a representative gold transcription."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply-reviewed", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "data/hutter/review_reports/transcription_audit.json")
    args = parser.parse_args()
    if args.apply_reviewed:
        print(f"Applied {apply_ledger()} image-confirmed verse corrections")
    report = audit()
    write(args.output, report)
    print(json.dumps({k: report[k] for k in ("totals", "finding_counts")}, indent=2))


if __name__ == "__main__":
    main()
