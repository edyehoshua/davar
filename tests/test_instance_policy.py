import sys
import hashlib
import json
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "dict"))

from instance_policy import (  # noqa: E402
    InstancePolicyConfig,
    classify_tier,
    process_instances,
    resolve_conflict,
)
from instance_policy import MISSING_POSITION, _stable_id  # noqa: E402


def instance(number, confidence=0.5, signal=0, source_priority=0):
    return {
        "stable_id": f"id-{number}",
        "book": " Genesis ",
        "chapter": 1,
        "verse": number + 1,
        "word_positions": [0],
        "confidence": confidence,
        "linguistic_signal": signal,
        "canonical_source_priority": source_priority,
        "display": "  café  ",
    }


def test_tiers_and_high_surface_are_bounded_and_retain_full_set():
    config = InstancePolicyConfig()
    assert [classify_tier(n, config) for n in (0, 99, 100, 999, 1000)] == [
        "low", "low", "medium", "medium", "high"
    ]
    result = process_instances((instance(i) for i in range(1001)), config)
    assert result["instance_total"] == 1001
    assert result["instance_surface_count"] == 500
    assert result["omitted_count"] == 501
    assert len(result["instances"]) == 1001
    assert len(result["surface_instances"]) == 500
    assert result["instances"][0]["display"] == "café"


def test_duplicates_keep_highest_confidence_and_findings_are_machine_readable():
    low = instance(1, confidence=0.2)
    high = instance(1, confidence=0.9)
    malformed = {"stable_id": "bad", "book": "Genesis", "chapter": 0, "verse": 2, "confidence": 2}
    result = process_instances([low, high, malformed])
    assert result["instance_total"] == 1
    assert result["instances"][0]["confidence"] == 0.9
    assert {finding["code"] for finding in result["findings"]} >= {
        "duplicate_reference", "malformed_location", "invalid_confidence"
    }


def test_ranking_is_independent_of_input_order_and_conflicts_are_deterministic():
    a = instance(1, 0.7, 1, 0)
    b = instance(2, 0.7, 1, 0)
    first = process_instances([a, b])["instances"]
    second = process_instances([b, a])["instances"]
    assert [x["stable_id"] for x in first] == [x["stable_id"] for x in second]
    winner, needs_review, reason = resolve_conflict([
        {"candidate": "zeta", "confidence": 0.8, "linguistic_signal": 1, "independent_sources": 1},
        {"candidate": "alfa", "confidence": 0.8, "linguistic_signal": 1, "independent_sources": 1},
    ])
    assert winner["candidate"] == "alfa"
    assert needs_review is True
    assert reason == "lexicographic_fallback"


def test_missing_token_sorts_after_present_and_missing_id_uses_canonical_nfc_sha256():
    present = instance(1)
    present["word_positions"] = [2]
    missing = instance(1)
    missing.pop("word_positions")
    missing["stable_id"] = ""
    present["stable_id"] = ""
    missing["stable_id"] = ""
    result = process_instances([missing, present])
    assert result["instances"][0]["word_positions"] == [2]
    assert "word_positions" not in result["instances"][1]
    assert MISSING_POSITION == 2**31 - 1

    payload = {key: value for key, value in present.items() if key not in {"stable_id", "id", "_reference_key"}}
    payload["book"] = payload["book"].strip()
    payload["display"] = unicodedata.normalize("NFC", payload["display"].strip())
    reference = ("Genesis", 1, 2, 2)
    canonical = json.dumps(
        {"payload": payload, "reference": reference},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    expected = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    assert _stable_id(present, reference) == expected


def test_unknown_books_use_nfc_name_as_deterministic_tie_break():
    first = instance(1)
    second = instance(2)
    first.update({"book": "Zeta", "verse": 1, "stable_id": "z"})
    second.update({"book": "Cafe\u0301", "verse": 1, "stable_id": "a"})
    ranked = process_instances([first, second])["instances"]
    assert ranked[0]["book"] == unicodedata.normalize("NFC", "Cafe\u0301")

def test_top_tie_requires_review_even_with_lower_ranked_candidates():
    winner, review, reason = resolve_conflict([
        {"candidate": "z", "confidence": .9},
        {"candidate": "a", "confidence": .9},
        {"candidate": "other", "confidence": .1},
    ])
    assert winner["candidate"] == "a"
    assert review and reason == "lexicographic_fallback"


def test_reference_strings_share_policy_with_custom_records():
    result = process_instances(["john.1.2", "john.1.2", "john.1.1"])
    assert result["is_valid"]
    assert [x["reference"] for x in result["instances"]] == ["john.1.1", "john.1.2"]
    assert any(x["code"] == "duplicate_reference" for x in result["findings"])
    assert not process_instances(["john.0.1"])["is_valid"]


def test_lexicon_export_preserves_full_references_and_bounds_surface(tmp_path):
    from scripts.dict.lexicon.consolidate import consolidate_directory
    references = [f"john.1.{i}" for i in range(1, 1002)]
    (tmp_path / "H1.json").write_text(json.dumps({"strong_number": "H1", "occurrences": {"references": references}}))
    entries, skipped, errors = consolidate_directory(tmp_path, {}, True, False)
    assert (skipped, errors) == (0, 0)
    assert entries["H1"]["occurrences"]["references"] == references
    assert len(entries["H1"]["occurrences"]["surface_references"]) == 500


def test_manifest_order_source_independence_and_source_key():
    config = InstancePolicyConfig(sources={"a": {"priority": 3, "independence_group": "one"}, "mirror": {"priority": 3, "independence_group": "one"}, "b": {"priority": 1, "independence_group": "two"}})
    winner, review, _ = resolve_conflict([
        {"candidate": "mirror-count", "supporting_sources": ["a", "mirror", "unknown"], "source_count": 999},
        {"candidate": "independent", "supporting_sources": ["a", "b"]},
    ], config)
    assert winner["candidate"] == "independent" and winner["independent_sources"] == 2 and not review
    rows = [{"reference": "exod.1.1", "source_manifest_id": "a", "source_record_id": " z "}, {"reference": "gen.1.1", "source_manifest_id": "a"}]
    result = process_instances(rows, config)
    assert result["instances"][0]["book"] == "gen"
    assert result["instances"][1]["source_payload"]["source_record_id"] == " z "
    assert json.loads(result["instances"][1]["source_key"]) == ["a", "z", "exod", 1, 1, None]


def test_medium_groups_and_invalid_nonfinite_scores():
    rows = [dict(instance(i, confidence=i/100), book="genesis" if i%2 else "exodus") for i in range(100)]
    result = process_instances(rows)
    assert [r["book"] for r in result["surface_instances"]] == ["genesis"]*50+["exodus"]*50
    assert not process_instances([dict(instance(0), linguistic_signal=float("inf"))])["is_valid"]
    assert not process_instances([dict(instance(0), token=-1, word_positions=[])])["is_valid"]
