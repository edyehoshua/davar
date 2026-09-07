"""Tests for Besorah Strong merge_strongs prefix composition and post-merge validation."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.delitzsch.strongs.v2.merge_strongs import (
    _report_payload,
    compose_strong,
    create_assignment_map,
    merge_strongs_for_book,
    run_post_merge_validation,
    write_deterministic_report,
)


# --------------------------------------------------------------------------- #
# compose_strong
# --------------------------------------------------------------------------- #
def test_compose_strong_with_single_prefix():
    assert compose_strong("H7223", ["Hd"]) == "Hd/H7223"


def test_compose_strong_with_multiple_prefixes_order_preserved():
    assert compose_strong("H5826", ["Hc", "Hd"]) == "Hc/Hd/H5826"


def test_compose_strong_without_prefixes():
    assert compose_strong("H120", []) == "H120"
    assert compose_strong("H120", None) == "H120"


def test_compose_strong_ignores_blank_prefixes():
    assert compose_strong("H120", ["", "Hd"]) == "Hd/H120"


def test_compose_strong_none_or_empty_strong():
    assert compose_strong(None, ["Hd"]) is None
    assert compose_strong("", ["Hd"]) is None


# --------------------------------------------------------------------------- #
# merge_strongs_for_book composes prefixes on write
# --------------------------------------------------------------------------- #
def test_merge_strongs_for_book_composes_prefixes(tmp_path, monkeypatch):
    parsed_dir = tmp_path / "data" / "delitzsch_parsed"
    v2_dir = parsed_dir / "strongs" / "v2"

    chapter_path = parsed_dir / "philemon" / "1.json"
    chapter_path.parent.mkdir(parents=True)
    chapter_path.write_text(
        json.dumps(
            [
                {
                    "chapter": 1,
                    "verses": [
                        {
                            "chapter": 1,
                            "verse": 1,
                            "hebrew": "REISHIT",
                            "words": [
                                {
                                    "text": "הַמָּשִׁיחַ",
                                    "strong": None,
                                    "prefixes": ["Hd"],
                                },
                                {
                                    "text": "אָדָם",
                                    "strong": None,
                                    "prefixes": [],
                                },
                            ],
                        }
                    ],
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    v2_file = v2_dir / "philemon.json"
    v2_file.parent.mkdir(parents=True)
    v2_file.write_text(
        json.dumps(
            {
                "book": "philemon",
                "chapters": [
                    {
                        "chapter": 1,
                        "assignments": [
                            {
                                "verse": 1, "previous_strong": None, "confidence": 0.99,
                                "word_index": 0,
                                "text": "הַמָּשִׁיחַ",
                                "prefixes": ["Hd"],
                                "type": "strong",
                                "strong": "H4899",
                            },
                            {
                                "verse": 1, "previous_strong": None, "confidence": 0.99,
                                "word_index": 1,
                                "text": "אָדָם",
                                "prefixes": [],
                                "type": "strong",
                                "strong": "H120",
                            },
                        ],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    import scripts.delitzsch.strongs.v2.merge_strongs as mod

    monkeypatch.setattr(mod, "PARSED_DIR", parsed_dir)
    monkeypatch.setattr(mod, "V2_DIR", v2_dir)

    stats = merge_strongs_for_book("philemon", dry_run=False)

    written = json.loads(chapter_path.read_text(encoding="utf-8"))
    words = written[0]["verses"][0]["words"]

    assert stats["updated"] == 2
    assert words[0]["strong"] == "Hd/H4899"
    assert words[1]["strong"] == "H120"


def test_merge_strongs_for_book_dry_run_does_not_modify(tmp_path, monkeypatch):
    parsed_dir = tmp_path / "data" / "delitzsch_parsed"
    v2_dir = parsed_dir / "strongs" / "v2"

    chapter_path = parsed_dir / "philemon" / "1.json"
    chapter_path.parent.mkdir(parents=True)
    chapter_path.write_text(
        json.dumps(
            [
                {
                    "chapter": 1,
                    "verses": [
                        {
                            "chapter": 1,
                            "verse": 1,
                            "hebrew": "REISHIT",
                            "words": [{"text": "הַמָּשִׁיחַ", "strong": None, "prefixes": ["Hd"]}],
                        }
                    ],
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    v2_file = v2_dir / "philemon.json"
    v2_file.parent.mkdir(parents=True)
    v2_file.write_text(
        json.dumps(
            {
                "book": "philemon",
                "chapters": [
                    {
                        "chapter": 1,
                        "assignments": [
                            {
                                "verse": 1, "previous_strong": None, "confidence": 0.99,
                                "word_index": 0,
                                "text": "הַמָּשִׁיחַ",
                                "prefixes": ["Hd"],
                                "type": "strong",
                                "strong": "H4899",
                            }
                        ],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    import scripts.delitzsch.strongs.v2.merge_strongs as mod

    monkeypatch.setattr(mod, "PARSED_DIR", parsed_dir)
    monkeypatch.setattr(mod, "V2_DIR", v2_dir)

    before = chapter_path.read_text(encoding="utf-8")
    stats = merge_strongs_for_book("philemon", dry_run=True)

    assert stats["updated"] == 1
    assert chapter_path.read_text(encoding="utf-8") == before


# --------------------------------------------------------------------------- #
# create_assignment_map keeps prefixes alongside strong
# --------------------------------------------------------------------------- #
def test_create_assignment_map_preserves_prefixes():
    v2_data = {
        "chapters": [
            {
                "chapter": 1,
                "assignments": [
                    {
                        "verse": 1, "previous_strong": None, "confidence": 0.99,
                                "word_index": 0,
                        "text": "x",
                        "prefixes": ["Hd"],
                        "type": "strong",
                        "strong": "H4899",
                    },
                    {"verse": 1, "previous_strong": None, "confidence": 0.99,
                                "word_index": 1, "text": "y", "prefixes": [], "type": "failed"},
                ],
            }
        ]
    }
    result = create_assignment_map(v2_data)
    assert result[1][(1, 0)]["strong"] == "H4899"
    assert result[1][(1, 0)]["prefixes"] == ["Hd"]
    assert result[1][(1, 1)]["type"] == "failed"  # retained so stale Strong can be cleared


# --------------------------------------------------------------------------- #
# Deterministic rerun report
# --------------------------------------------------------------------------- #
def test_report_payload_is_deterministic():
    total_stats = {"updated": 5, "failed": 0, "skipped": 1, "chapters_processed": 2, "books_processed": 1}
    validation = {"total_issues": 2, "by_type": {"null_strong": 2}, "by_book": {"philemon": {"null_strong": 2}}}

    a = _report_payload(total_stats, validation, ["b", "a"], False)
    b = _report_payload(total_stats, validation, ["b", "a"], False)

    assert a == b
    assert a["books"] == ["a", "b"]
    assert a["report_hash"] == b["report_hash"]
    assert a["report_hash"]


def test_write_deterministic_report_writes_file(tmp_path, monkeypatch):
    import scripts.delitzsch.strongs.v2.merge_strongs as mod

    report_dir = tmp_path / "reports"
    monkeypatch.setattr(mod, "REPORT_DIR", report_dir)
    report_path = write_deterministic_report(
        {"updated": 5, "failed": 0, "skipped": 0, "chapters_processed": 1, "books_processed": 1},
        {"total_issues": 0, "by_type": {}, "by_book": {}},
        ["philemon"],
        dry_run=False,
    )
    assert report_path.exists()
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    assert payload["stats"]["updated"] == 5
    assert "report_hash" in payload


def test_identity_required_and_duplicate_positions_do_not_collide():
    import pytest
    with pytest.raises(ValueError, match="verse identity"):
        create_assignment_map({"chapters":[{"chapter":1,"assignments":[{"word_index":0,"text":"א"}]}]})
    data = {"chapters":[{"chapter":1,"assignments":[{"verse":1,"word_index":0,"text":"א"},{"verse":2,"word_index":0,"text":"ב"}]}]}
    assert len(create_assignment_map(data)[1]) == 2
    data["chapters"][0]["assignments"].append(data["chapters"][0]["assignments"][0])
    with pytest.raises(ValueError, match="Duplicate"):
        create_assignment_map(data)


def test_composite_prefix_idempotence_and_conflicts():
    import pytest
    assert compose_strong("Hb/H7225", ["Hb"]) == "Hb/H7225"
    with pytest.raises(ValueError):
        compose_strong("Hl/H7225", ["Hb"])
    with pytest.raises(ValueError):
        compose_strong("not-a-reference", [])


def test_failed_skipped_and_low_confidence_clear_stale_values(tmp_path, monkeypatch):
    import scripts.delitzsch.strongs.v2.merge_strongs as mod
    parsed = tmp_path / "parsed"
    v2 = tmp_path / "v2"
    (parsed / "jude").mkdir(parents=True)
    v2.mkdir()
    words = [{"text":text,"strong":"H120","prefixes":[]} for text in ["א","ב","ג"]]
    path = parsed / "jude" / "1.json"
    path.write_text(json.dumps([{"chapter":1,"verses":[{"verse":1,"words":words}]}]))
    assignments = [{"verse":1,"word_index":i,"text":w["text"],"previous_strong":"H120","type":kind,"strong":"H121","confidence":.5} for i,(w,kind) in enumerate(zip(words,["failed","skipped","strong"]))]
    (v2 / "jude.json").write_text(json.dumps({"chapters":[{"chapter":1,"assignments":assignments}]}))
    monkeypatch.setattr(mod,"PARSED_DIR",parsed)
    monkeypatch.setattr(mod,"V2_DIR",v2)
    assert merge_strongs_for_book("jude")["updated"] == 3
    assert all(w["strong"] is None and w["mapping_review"]["status"] == "needs_review" for w in json.loads(path.read_text())[0]["verses"][0]["words"])
    before = path.read_bytes()
    assert merge_strongs_for_book("jude")["updated"] == 0
    assert path.read_bytes() == before
    assignments[0]["text"] = "ד"
    (v2 / "jude.json").write_text(json.dumps({"chapters":[{"chapter":1,"assignments":assignments}]}))
    import pytest
    with pytest.raises(ValueError, match="Stale"):
        merge_strongs_for_book("jude")
    assert path.read_bytes() == before

def test_publication_validation_rejects_queued_candidate(tmp_path, monkeypatch):
    import scripts.delitzsch.strongs.v2.merge_strongs as mod
    path=tmp_path/'jude/1.json'
    path.parent.mkdir()
    path.write_text(json.dumps([{'chapter':1,'verses':[{'verse':1,'hebrew':'אָדָם','words':[{'text':'אָדָם','strong':'H120','prefixes':[],'mapping_review':{'status':'needs_review'}}]}]}]))
    monkeypatch.setattr(mod,'PARSED_DIR',tmp_path)
    result=mod.run_post_merge_validation(['jude'])
    assert not result['passed']
    assert result['publication_errors']==[['jude.1.1.0','unreviewed_candidate_published']]
