import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.delitzsch.review.workflow import (
    LexiconIndex,
    apply_decisions,
    iter_occurrences,
    load_latest_decisions,
    partition_reviewed_issues,
    scan_issues,
    summarize_reviewed_issues,
)


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def test_occurrence_identity_includes_verse(tmp_path):
    parsed = tmp_path / "data" / "delitzsch_parsed"
    write_json(
        parsed / "matthew" / "1.json",
        [
            {
                "chapter": 1,
                "verses": [
                    {
                        "chapter": 1,
                        "verse": 1,
                        "hebrew": "WORD ONE",
                        "words": [{"text": "אָדָם", "strong": None, "prefixes": []}],
                    },
                    {
                        "chapter": 1,
                        "verse": 2,
                        "hebrew": "WORD TWO",
                        "words": [{"text": "דָּוִד", "strong": "H1732", "prefixes": []}],
                    },
                ],
            }
        ],
    )

    occurrences = list(iter_occurrences(parsed, ["matthew"]))

    assert [item.key for item in occurrences] == ["matthew.1.1.0", "matthew.1.2.0"]
    assert occurrences[0].verse == 1
    assert occurrences[1].verse == 2


def test_apply_dry_run_does_not_modify_chapter_or_write_log(tmp_path):
    parsed = tmp_path / "data" / "delitzsch_parsed"
    lexicon_dir = tmp_path / "data" / "dict" / "lexicon" / "words"
    log_dir = tmp_path / "data" / "delitzsch_review" / "decisions"
    chapter_path = parsed / "matthew" / "1.json"
    write_json(
        chapter_path,
        [
            {
                "chapter": 1,
                "verses": [
                    {
                        "chapter": 1,
                        "verse": 1,
                        "hebrew": "WORD",
                        "words": [{"text": "אָדָם", "strong": None, "prefixes": []}],
                    }
                ],
            }
        ],
    )
    write_json(
        lexicon_dir / "H120.json",
        {"strong_number": "H120", "lemma": "אָדָם", "normalized": "אדמ", "definitions": []},
    )
    decisions_path = tmp_path / "batch.json"
    write_json(
        decisions_path,
        {
            "decisions": [
                {
                    "action": "set_strong",
                    "occurrence": {
                        "book": "matthew",
                        "chapter": 1,
                        "verse": 1,
                        "word_index": 0,
                        "text": "אָדָם",
                        "strong": None,
                    },
                    "previous_strong": None,
                    "new_strong": "H120",
                    "confidence": 1.0,
                    "reason": "test",
                    "evidence": ["test"],
                }
            ]
        },
    )

    before = chapter_path.read_text(encoding="utf-8")
    stats = apply_decisions(
        decisions_path,
        parsed,
        LexiconIndex(lexicon_dir),
        log_dir,
        dry_run=True,
    )

    assert stats.word_updates == 1
    assert stats.files_changed == 1
    assert chapter_path.read_text(encoding="utf-8") == before
    assert not log_dir.exists()


def test_apply_set_strong_updates_reviewed_word_metadata(tmp_path):
    parsed = tmp_path / "data" / "delitzsch_parsed"
    lexicon_dir = tmp_path / "data" / "dict" / "lexicon" / "words"
    log_dir = tmp_path / "data" / "delitzsch_review" / "decisions"
    chapter_path = parsed / "matthew" / "1.json"
    write_json(
        chapter_path,
        [
            {
                "chapter": 1,
                "verses": [
                    {
                        "chapter": 1,
                        "verse": 1,
                        "hebrew": "לָ/חֶם",
                        "words": [
                            {
                                "text": "לָחֶם",
                                "strong": "Hl/H3433",
                                "prefixes": ["Hl"],
                                "possible_proper_name": True,
                            }
                        ],
                    }
                ],
            }
        ],
    )
    write_json(
        lexicon_dir / "H3899.json",
        {"strong_number": "H3899", "lemma": "לֶחֶם", "definitions": []},
    )
    decisions_path = tmp_path / "batch.json"
    write_json(
        decisions_path,
        {
            "decisions": [
                {
                    "action": "set_strong",
                    "occurrence": {
                        "book": "matthew",
                        "chapter": 1,
                        "verse": 1,
                        "word_index": 0,
                        "text": "לָחֶם",
                        "strong": "Hl/H3433",
                    },
                    "previous_strong": "Hl/H3433",
                    "new_strong": "H3899",
                    "new_prefixes": [],
                    "new_possible_proper_name": False,
                }
            ]
        },
    )

    stats = apply_decisions(
        decisions_path,
        parsed,
        LexiconIndex(lexicon_dir),
        log_dir,
    )

    word = json.loads(chapter_path.read_text(encoding="utf-8"))[0]["verses"][0][
        "words"
    ][0]
    verse = json.loads(chapter_path.read_text(encoding="utf-8"))[0]["verses"][0]
    assert stats.word_updates == 1
    assert word == {
        "text": "לָחֶם",
        "strong": "H3899",
        "prefixes": [],
        "possible_proper_name": False,
    }
    assert verse["hebrew"] == "לָחֶם"


def test_apply_create_custom_entry_updates_word_and_custom_dictionary(tmp_path):
    parsed = tmp_path / "data" / "delitzsch_parsed"
    lexicon_dir = tmp_path / "data" / "dict" / "lexicon" / "words"
    custom_path = tmp_path / "data" / "dict" / "lexicon" / "custom_definitions.json"
    log_dir = tmp_path / "data" / "delitzsch_review" / "decisions"
    chapter_path = parsed / "acts" / "1.json"
    write_json(
        chapter_path,
        [
            {
                "chapter": 1,
                "verses": [
                    {
                        "chapter": 1,
                        "verse": 13,
                        "hebrew": "פֶּטְרוֹס",
                        "words": [{"text": "פֶּטְרוֹס", "strong": None, "prefixes": []}],
                    }
                ],
            }
        ],
    )
    write_json(custom_path, {})
    decisions_path = tmp_path / "batch.json"
    write_json(
        decisions_path,
        {
            "decisions": [
                {
                    "action": "create_custom_entry",
                    "custom_key": "D0001",
                    "occurrence": {
                        "book": "acts",
                        "chapter": 1,
                        "verse": 13,
                        "word_index": 0,
                        "text": "פֶּטְרוֹס",
                        "strong": None,
                    },
                    "previous_strong": None,
                    "definition": {
                        "text_en": "Peter",
                        "text_es": "Pedro",
                    },
                    "confidence": 0.9,
                    "reason": "Greek proper name in Delitzsch text",
                    "evidence": ["Acts 1:13"],
                }
            ]
        },
    )

    stats = apply_decisions(
        decisions_path,
        parsed,
        LexiconIndex(lexicon_dir),
        log_dir,
        dry_run=False,
    )

    updated_chapter = json.loads(chapter_path.read_text(encoding="utf-8"))
    custom = json.loads(custom_path.read_text(encoding="utf-8"))
    assert stats.word_updates == 1
    assert stats.definition_updates == 1
    assert updated_chapter[0]["verses"][0]["words"][0]["strong"] == "D0001"
    assert custom["D0001"]["definitions"][0]["text_en"] == "Peter"
    assert custom["D0001"]["nt_instances"][0]["book"] == "acts"
    assert custom["D0001"]["mapping_scope"] == "instances_only"


def test_apply_upsert_custom_definition_for_existing_strong(tmp_path):
    parsed = tmp_path / "data" / "delitzsch_parsed"
    lexicon_dir = tmp_path / "data" / "dict" / "lexicon" / "words"
    custom_path = tmp_path / "data" / "dict" / "lexicon" / "custom_definitions.json"
    log_dir = tmp_path / "data" / "delitzsch_review" / "decisions"
    write_json(
        lexicon_dir / "H3442.json",
        {
            "strong_number": "H3442",
            "lemma": "יֵשׁוּעַ",
            "normalized": "ישוע",
            "translit_en": "yeshua",
            "translit_es": "yeshua",
            "definitions": [],
        },
    )
    write_json(custom_path, {})
    decisions_path = tmp_path / "definitions.json"
    write_json(
        decisions_path,
        {
            "decisions": [
                {
                    "action": "upsert_custom_definition",
                    "strong": "H3442",
                    "definition": {
                        "text_en": "YHVH saves",
                        "text_es": "YHVH salva",
                    },
                    "confidence": 0.95,
                    "reason": "Name meaning review",
                    "evidence": ["custom review"],
                }
            ]
        },
    )

    stats = apply_decisions(
        decisions_path,
        parsed,
        LexiconIndex(lexicon_dir),
        log_dir,
        dry_run=False,
    )

    custom = json.loads(custom_path.read_text(encoding="utf-8"))
    assert stats.definition_updates == 1
    assert custom["H3442"]["hebrew"] == "יֵשׁוּעַ"
    assert custom["H3442"]["definitions"][0]["text_es"] == "YHVH salva"


def test_custom_entry_hebrew_is_available_as_normalized_lemma(tmp_path):
    lexicon_dir = tmp_path / "data" / "dict" / "lexicon" / "words"
    write_json(
        lexicon_dir.parent / "custom_definitions.json",
        {
            "D0001": {
                "strong_number": "D0001",
                "hebrew": "תְּאוֹפִילוֹס",
                "definitions": [{"text_en": "Theophilus"}],
            }
        },
    )

    lexicon = LexiconIndex(lexicon_dir)

    assert lexicon.normalized_lemma("D0001") == "תאופילוס"


def test_reviewed_manual_flags_are_not_remaining_issues(tmp_path):
    parsed = tmp_path / "data" / "delitzsch_parsed"
    lexicon_dir = tmp_path / "data" / "dict" / "lexicon" / "words"
    log_dir = tmp_path / "data" / "delitzsch_review" / "decisions"
    write_json(
        parsed / "acts" / "1.json",
        [
            {
                "chapter": 1,
                "verses": [
                    {
                        "chapter": 1,
                        "verse": 1,
                        "hebrew": "בּוֹ",
                        "words": [{"text": "בּוֹ", "strong": None, "prefixes": []}],
                    }
                ],
            }
        ],
    )
    log_dir.mkdir(parents=True)
    (log_dir / "acts.jsonl").write_text(
        json.dumps(
            {
                "status": "needs_manual_review",
                "action": "needs_manual_review",
                "occurrence": {
                    "book": "acts",
                    "chapter": 1,
                    "verse": 1,
                    "word_index": 0,
                    "text": "בּוֹ",
                },
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    issues = scan_issues(parsed, LexiconIndex(lexicon_dir))
    latest = load_latest_decisions(log_dir)
    remaining, reviewed = partition_reviewed_issues(issues, latest)

    assert remaining == []
    assert summarize_reviewed_issues(reviewed)["by_review_status"] == {
        "reviewed_manual": 1
    }


def test_john1_custom_grammar_entries_have_definitions():
    root = Path(__file__).resolve().parents[1]
    custom_path = root / "data" / "dict" / "lexicon" / "custom_definitions.json"
    custom = json.loads(custom_path.read_text(encoding="utf-8"))

    assert custom["D0208"]["definitions"][0]["text_en"]
    assert custom["D0208"]["definitions"][0]["text_es"]
    assert custom["D0209"]["definitions"][0]["text_en"]
    assert custom["D0209"]["definitions"][0]["text_es"]


def test_issue_119_grammar_policy_resolves_safe_null_forms():
    root = Path(__file__).resolve().parents[1]
    custom = json.loads(
        (root / "data" / "dict" / "lexicon" / "custom_definitions.json").read_text(
            encoding="utf-8"
        )
    )
    expected_instances = {
        "D0208": 293,
        "D0265": 204,
        "D0266": 545,
        "D0267": 2,
        "D0268": 1,
        "D0269": 1,
        "D0270": 1,
        "D0271": 81,
    }
    for key, instance_count in expected_instances.items():
        assert custom[key]["definitions"][0]["text_en"]
        assert custom[key]["definitions"][0]["text_es"]
        assert len(custom[key]["nt_instances"]) == instance_count

    for key in ("D0265", "D0266", "D0267", "D0268", "D0269", "D0270", "D0271"):
        assert custom[key]["mapping_scope"] == "exact"

    issues = scan_issues(
        root / "data" / "delitzsch_parsed",
        LexiconIndex(root / "data" / "dict" / "lexicon" / "words"),
    )
    nulls = [issue.occurrence.text for issue in issues if issue.issue_type == "null_strong"]
    custom_warnings = [
        issue
        for issue in issues
        if issue.issue_type == "suspicious_strong"
        and (issue.current_strong or "").split("/")[-1].startswith("D")
    ]

    assert nulls == []  # #43 resolves בוכיות and removes non-Hebrew WO placeholders
    assert custom_warnings == []


def test_issue_119_proper_name_review_has_no_remaining_scan_flags():
    root = Path(__file__).resolve().parents[1]
    parsed = root / "data" / "delitzsch_parsed"
    lexicon = LexiconIndex(root / "data" / "dict" / "lexicon" / "words")
    log_dir = root / "data" / "delitzsch_review" / "decisions"

    issues = scan_issues(parsed, lexicon)
    remaining, reviewed = partition_reviewed_issues(
        issues, load_latest_decisions(log_dir)
    )

    assert remaining == []
    assert summarize_reviewed_issues(reviewed)["by_review_status"] == {}
    assert all(issue.issue_type == "null_strong" for issue in issues)


def test_issue_119_false_name_assignments_use_contextual_lexemes():
    root = Path(__file__).resolve().parents[1]

    def word(book, chapter, verse_number, word_index):
        chapter_data = json.loads(
            (root / "data" / "delitzsch_parsed" / book / f"{chapter}.json").read_text(
                encoding="utf-8"
            )
        )[0]
        verse = next(
            item for item in chapter_data["verses"] if item["verse"] == verse_number
        )
        return verse["words"][word_index]

    assert word("acts", 8, 30, 5)["strong"] == "H7121"
    assert word("acts", 10, 10, 4) == {
        "text": "לָחֶם",
        "strong": "H3899",
        "prefixes": [],
        "possible_proper_name": False,
    }
    assert word("james", 1, 6, 6)["strong"] == "H1167"
    assert word("john1", 2, 7, 15)["strong"] == "Hd/H3465"
    assert word("mark", 9, 39, 10)["strong"] == "Hc/H3201"
    assert word("matthew", 5, 13, 1)["strong"] == "H4417"
    assert word("revelation", 2, 17, 18)["strong"] == "H3836"


def test_issue_119_genuine_name_entries_have_definitions():
    root = Path(__file__).resolve().parents[1]
    lexicon = LexiconIndex(root / "data" / "dict" / "lexicon" / "words")

    for strong in ("H3110", "H3141", "H3568", "H4023", "H4287", "H7410", "H8012"):
        entry = lexicon.get(strong)
        assert entry
        assert entry["definitions"][0]["text_en"]
        assert entry["definitions"][0]["text_es"]


def test_john1_has_no_null_strongs_after_custom_grammar_pass():
    root = Path(__file__).resolve().parents[1]
    parsed_dir = root / "data" / "delitzsch_parsed" / "john1"
    nulls = []

    for chapter_path in sorted(parsed_dir.glob("*.json"), key=lambda path: int(path.stem)):
        chapter_data = json.loads(chapter_path.read_text(encoding="utf-8"))
        chapter = chapter_data[0]
        for verse in chapter["verses"]:
            for word_index, word in enumerate(verse["words"]):
                if word.get("strong") is None:
                    nulls.append(
                        (
                            chapter["chapter"],
                            verse["verse"],
                            word_index,
                            word.get("text"),
                        )
                    )

    assert nulls == []


def test_targeted_proper_names_use_custom_definitions():
    root = Path(__file__).resolve().parents[1]
    custom_path = root / "data" / "dict" / "lexicon" / "custom_definitions.json"
    custom = json.loads(custom_path.read_text(encoding="utf-8"))

    john3 = json.loads(
        (root / "data" / "delitzsch_parsed" / "john3" / "1.json").read_text(
            encoding="utf-8"
        )
    )
    ephesians = json.loads(
        (root / "data" / "delitzsch_parsed" / "ephesians" / "1.json").read_text(
            encoding="utf-8"
        )
    )

    assert john3[0]["verses"][0]["words"][2]["text"] == "גָּיוֹס"
    assert john3[0]["verses"][0]["words"][2]["strong"] == "D0057"
    assert ephesians[0]["verses"][0]["words"][0]["text"] == "פּוֹלוֹס"
    assert ephesians[0]["verses"][0]["words"][0]["strong"] == "D0024"

    assert custom["D0057"]["definitions"][0]["text_en"]
    assert custom["D0057"]["definitions"][0]["text_es"]
    assert custom["D0024"]["definitions"][0]["text_en"]
    assert custom["D0024"]["definitions"][0]["text_es"]
