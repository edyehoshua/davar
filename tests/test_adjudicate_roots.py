"""Tests for the lexicon root_ref adjudication pipeline."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.dict.adjudicate_roots import (
    Adjudication,
    apply_decisions,
    audit,
    audit_summary,
    build_review_queue,
    build_root_index,
    load_pair,
    morph_similarity,
    normalize_hebrew,
    write_report,
)


def test_normalize_hebrew_regularizes_final_forms():
    assert normalize_hebrew("מִלָּה") == "מלה"
    assert normalize_hebrew("אָב") == "אב"
    assert normalize_hebrew("") == ""


def test_morph_similarity_identical_is_one():
    assert morph_similarity("אב", "אב") == 1.0
    assert morph_similarity("מלה", "מלה") == 1.0


def test_morph_similarity_affixed_forms_close():
    # מִלִּים (plural of מלה) should be quite close to מלה.
    assert morph_similarity("מלים", "מלה") > 0.5


def test_morph_similarity_unrelated_is_low():
    assert morph_similarity("אבגדה", "כסף") < 0.4


def test_build_root_index_normalizes_keys():
    roots = {"53": {"strong_number": "H53", "lemma": "אָבֵל", "normalized": "אבל"}}
    index = build_root_index(roots)
    assert "H53" in index
    assert index["H53"]["lemma"] == "אָבֵל"


W = {
    "H10": {"strong_number": "H10", "lemma": "אֲבַדֹּה", "normalized": "אבדה", "is_root": False, "root_ref": "H9"},
    "H100": {"strong_number": "H100", "lemma": "אַגְמוֹן", "normalized": "אגמון", "is_root": False, "root_ref": "H98"},
    "H1": {"strong_number": "H1", "lemma": "אָב", "normalized": "אב", "is_root": True},
    "H9": {"strong_number": "H9", "lemma": "אָבַד", "normalized": "אבד", "is_root": True},
}
R = {
    "H1": {"strong_number": "H1", "lemma": "אָב", "normalized": "אב"},
    "H9": {"strong_number": "H9", "lemma": "אָבַד", "normalized": "אבד"},
}


def test_audit_rejects_junk_nonsense_entries():
    adjudications = audit(W, R)
    by_key = {item.strong: item for item in adjudications}
    # H10 אבדה should be aligned well with root אבד (H9) -> keep.
    assert by_key["H10"].proposal == "keep"
    assert by_key["H10"].current_root_ref == "H9"
    # H1 is a root -> excluded.
    assert "H1" not in by_key


def test_audit_routes_unassigned_non_root_to_review():
    words = {
        "H200": {"strong_number": "H200", "lemma": "אָב", "normalized": "אב", "is_root": False},
    }
    adjudications = audit(words, R)
    item = adjudications[0]
    assert item.proposal == "reject"
    assert item.review_status == "review"


def test_audit_proposes_change_for_mismatched_root():
    words = {
        "H100": {
            "strong_number": "H100",
            "lemma": "אַגְמוֹן",
            "normalized": "אגמון",
            "is_root": False,
            "root_ref": "H9",
        },
    }
    roots = {
        "H9": {"strong_number": "H9", "lemma": "אָבַד", "normalized": "אבד"},
        "H98": {"strong_number": "H98", "lemma": "אַגְמוֹן", "normalized": "אגמון"},
    }
    adjudications = audit(words, roots)
    item = adjudications[0]
    assert item.proposal == "change"
    assert item.review_status == "review"
    assert item.proposed_root_ref == "H98"


def test_apply_decisions_only_writes_auto_accepted(tmp_path, monkeypatch):
    words = {
        "H100": {
            "strong_number": "H100",
            "lemma": "אַגְמוֹן",
            "normalized": "אגמון",
            "is_root": False,
            "root_ref": "H9",
        },
    }
    roots = {
        "H9": {"strong_number": "H9", "lemma": "אָבַד", "normalized": "אבד"},
        "H98": {"strong_number": "H98", "lemma": "אַגְמוֹן", "normalized": "אגמון"},
    }
    words_path = tmp_path / "words.json"
    words_path.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")
    monkeypatch.setattr("scripts.dict.adjudicate_roots.WORDS_PATH", words_path)
    roots_path = tmp_path / "roots.json"
    roots_path.write_text(json.dumps({"H9": {}, "H98": {}}))
    monkeypatch.setattr("scripts.dict.adjudicate_roots.ROOTS_PATH", roots_path)

    # Force an auto_accepted change decision.
    forced = [
        Adjudication(
            strong="H100",
            lemma="אַגְמוֹן",
            normalized="אגמון",
            current_root_ref="H9",
            root_lemma="אבד",
            similarity=0.3,
            proposal="change",
            proposed_root_ref="H98",
            confidence=0.9,
            reason="forced",
            review_status="auto_accepted",
        )
    ]
    applied = apply_decisions(forced)
    assert applied == 1
    updated = json.loads(words_path.read_text(encoding="utf-8"))
    assert updated["H100"]["root_ref"] == "H98"


def test_apply_decisions_keeps_auto_accepted_keep(tmp_path, monkeypatch):
    words = {"H10": {"strong_number": "H10", "lemma": "אבדה", "is_root": False, "root_ref": "H9"}}
    words_path = tmp_path / "words.json"
    words_path.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")
    monkeypatch.setattr("scripts.dict.adjudicate_roots.WORDS_PATH", words_path)
    roots_path = tmp_path / "roots.json"
    roots_path.write_text(json.dumps({"H9": {}, "H98": {}}))
    monkeypatch.setattr("scripts.dict.adjudicate_roots.ROOTS_PATH", roots_path)

    keep = Adjudication(
        strong="H10", lemma="אבדה", normalized="אבדה", current_root_ref="H9",
        root_lemma="אבד", similarity=0.9, proposal="keep", proposed_root_ref="H9",
        confidence=0.9, reason="ok", review_status="auto_accepted",
    )
    assert apply_decisions([keep]) == 0  # keep -> no write


def test_build_review_queue_only_includes_review_items():
    adjudications = [
        Adjudication(strong="A", lemma="", normalized="", current_root_ref="R",
                     root_lemma="", similarity=0.9, proposal="keep", proposed_root_ref="R",
                     confidence=0.9, reason="", review_status="auto_accepted"),
        Adjudication(strong="B", lemma="", normalized="", current_root_ref="X",
                     root_lemma="", similarity=0.2, proposal="change", proposed_root_ref="Y",
                     confidence=0.2, reason="low", review_status="review"),
    ]
    queue = build_review_queue(adjudications)
    assert [item["strong"] for item in queue] == ["B"]


def test_write_report_produces_deterministic_json(tmp_path):
    adjudications = [
        Adjudication(strong="A", lemma="א", normalized="א", current_root_ref="R",
                     root_lemma="", similarity=0.9, proposal="keep", proposed_root_ref="R",
                     confidence=0.9, reason="x", review_status="auto_accepted"),
    ]
    out = tmp_path / "report.json"
    write_report(adjudications, out, metadata={"kind": "test"})
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["entries"][0]["strong"] == "A"
    assert payload["summary"]["total"] == 1


def test_audit_deterministic_same_input_same_output():
    a1 = audit(W, R)
    a2 = audit(W, R)
    assert [asdict_sorted(item) for item in a1] == [asdict_sorted(item) for item in a2]


def asdict_sorted(item: Adjudication):
    d = item.__dict__
    return {k: d[k] for k in sorted(d)}


def test_source_chain_requires_unique_unqualified_evidence():
    from scripts.dict.adjudicate_roots import audit_from_derivations
    words = {"H10": {"lemma": "א", "root_ref": "H9"}}
    roots = {"H1": {"lemma": "א"}}
    source = {"H10": {"derivation": "from H9"}, "H9": {"derivation": "from H1"}}
    decision = audit_from_derivations(words, roots, source)[0]
    assert decision.proposed_root_ref == "H1" and decision.review_status == "auto_accepted"
    for derivation in ["perhaps from H1", "from H1 and H2", "from H10", "unused root"]:
        source["H9"]["derivation"] = derivation
        decision = audit_from_derivations(words, roots, source)[0]
        assert decision.review_status == "review" and decision.proposed_root_ref is None


def test_apply_rejects_missing_target_and_is_idempotent(tmp_path, monkeypatch):
    import pytest
    import scripts.dict.adjudicate_roots as module
    path = tmp_path / "words.json"; roots = tmp_path / "roots.json"
    path.write_text(json.dumps({"H10": {"root_ref": "H9"}})); roots.write_text(json.dumps({"H1": {}}))
    monkeypatch.setattr(module, "WORDS_PATH", path); monkeypatch.setattr(module, "ROOTS_PATH", roots)
    decision = Adjudication("H10", "", "", "H9", "", 0, "change", "H404", .99, "test", "auto_accepted")
    before = path.read_bytes()
    with pytest.raises(ValueError): module.apply_decisions([decision])
    assert path.read_bytes() == before
    decision.proposed_root_ref = "H1"
    assert module.apply_decisions([decision]) == 1
    assert module.apply_decisions([decision]) == 0
