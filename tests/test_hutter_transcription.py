import copy
import hashlib
import json

import pytest

from scripts.hutter.audit_transcription import LEDGER, SOURCE, ROOT, apply_ledger, audit, read, write, verses


def fixture(root):
    image = root / "pages/000002.png"
    image.parent.mkdir()
    image.write_bytes(b"fixture page evidence")
    row = {"book": "john", "chapter": 1, "verse": 1, "source_image": "pages/000002.png",
           "source_image_sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
           "before": "אב", "after": "אבא", "review_status": "image_confirmed", "evidence": "fixture"}
    write(root / LEDGER, {"corrections": [row]})
    write(root / SOURCE / "john.json", {"chapters": [{"number": 1, "verses": [
        {"number": 1, "text_nikud": "אב", "source_files": ["000002.png"]},
        {"number": 2, "text_nikud": "שמור", "source_files": ["000002.png"]}]}]})
    return row


def test_apply_is_selective_and_idempotent(tmp_path):
    fixture(tmp_path)
    assert apply_ledger(tmp_path) == 1
    path = tmp_path / SOURCE / "john.json"
    first = path.read_bytes()
    assert apply_ledger(tmp_path) == 0
    assert path.read_bytes() == first
    assert read(path)["chapters"][0]["verses"][1]["text_nikud"] == "שמור"


def test_stale_text_or_changed_image_blocks_all_writes(tmp_path):
    row = fixture(tmp_path)
    second = copy.deepcopy(row)
    second.update(verse=2, before="stale", after="replacement")
    write(tmp_path / LEDGER, {"corrections": [row, second]})
    path = tmp_path / SOURCE / "john.json"
    original = path.read_bytes()
    with pytest.raises(ValueError, match="Stale transcription"):
        apply_ledger(tmp_path)
    assert path.read_bytes() == original
    (tmp_path / "pages/000002.png").write_bytes(b"changed")
    with pytest.raises(ValueError, match="Source image changed"):
        apply_ledger(tmp_path)
    assert path.read_bytes() == original


def test_unreviewed_ocr_cannot_change_transcription(tmp_path):
    row = fixture(tmp_path)
    row["review_status"] = "ocr_suggestion"
    write(tmp_path / LEDGER, {"corrections": [row]})
    with pytest.raises(ValueError, match="image-confirmed"):
        apply_ledger(tmp_path)


def test_audit_covers_mapped_words_and_is_deterministic(tmp_path):
    fixture(tmp_path)
    mappings = tmp_path / "data/hutter/strong_mappings"
    mappings.mkdir(parents=True)
    # Mapping contents deliberately irrelevant to transcription auditing.
    write(mappings / "john.json", {"strong": "H1"})
    first = audit(tmp_path)
    assert first == audit(tmp_path)
    assert first["totals"]["verses"] == 2
    assert first["finding_counts"]["missing_niqqud"] == 2
    assert first["finding_counts"]["missing_page_evidence"] == 2


def test_review_ledger_spans_all_27_books_and_keeps_verifiable_provenance():
    ledger = read(ROOT / LEDGER)
    assert len({r["book"] for r in ledger["representative_reviews"]}) == 27
    for row in ledger["corrections"]:
        assert row["before"] != row["after"]
        assert len(row["source_image_sha256"]) == 64
        assert row["evidence"] and row["review_status"] == "image_confirmed"
        source = dict(verses(read(ROOT / SOURCE / f"{row['book']}.json")))
        assert source[(row["chapter"], row["verse"])]["text_nikud"] == row["after"]
