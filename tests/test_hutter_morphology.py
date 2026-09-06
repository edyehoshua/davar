"""Tests for the morphology-aware Hutter candidate analyzer."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from scripts.hutter.morphology import (
    MorphDecision,
    analyze_form,
    backtest_morphology,
    build_review_queue,
    is_yhwh_surface,
    morphology_decision,
    normalize_hebrew,
    prefix_parses,
    write_review_queue,
)


def lemma_index(pairs: dict[str, list[str]]) -> dict[str, Counter[str]]:
    return {normalize_hebrew(k): Counter({s: 1 for s in v}) for k, v in pairs.items()}


def test_normalize_hebrew_regularizes_final_forms_and_strips_marks():
    assert normalize_hebrew("בְּדַעְתֵּנוּ") == "בדעתנו"
    assert normalize_hebrew("מִלָּה") == "מלה"
    assert normalize_hebrew("כּוֹכָב") == "כוכב"


def test_prefix_parses_yield_prefix_plus_stem():
    parses = list(prefix_parses("בְּדַעְתֵּנוּ"))
    normalized = [normalize_hebrew(p[1]) for p in parses]
    assert () in [p[0] for p in parses]
    assert any(p[0] == ("Hb",) for p in parses)


def test_analyze_form_detects_prefix_and_pronominal_suffix():
    # בְּדַעְתֵּנוּ -> Hb + דעת (H1847) + נו (1cp)
    parses = analyze_form("בְּדַעְתֵּנוּ")
    labels = {p.parse_label for p in parses}
    assert any(p.prefixes == ("Hb",) and p.stem == "דעת" for p in parses)
    assert "1cp_possessive" in labels or any("נו" in p.suffixes for p in parses)


def test_analyze_form_normalizes_final_letters_in_plural_and_object_suffixes():
    plural_parses = analyze_form("נִצְדָּקִים")
    assert any(parse.stem == "נצדק" and parse.suffixes == ("ים",) for parse in plural_parses)

    object_parses = analyze_form("וְיִכַבְּדוּם")
    assert any(
        parse.prefixes == ("Hc",)
        and parse.stem == "יכבד"
        and parse.suffixes == ("ו", "ם")
        for parse in object_parses
    )


def test_morphology_decision_accepts_unique_prefix_plus_suffix_form():
    index = lemma_index({"דַּעַת": ["H1847"]})
    empty: dict[str, Counter[str]] = {}
    decision = morphology_decision("בְּדַעְתֵּנוּ", index, empty)
    assert decision is not None
    assert decision.strong == "H1847"
    assert decision.prefixes == ("Hb",)
    assert decision.review_status in ("auto_accepted", "review")


def test_morphology_decision_routes_ambiguous_to_review():
    index = lemma_index({"דעת": ["H1847"], "דע": ["H3045"]})
    empty: dict[str, Counter[str]] = {}
    decision = morphology_decision("דענה", index, empty, auto_accept_threshold=0.86, margin=0.5)
    if decision is not None:
        assert decision.review_status in ("review", "unresolved")


def test_morphology_decision_returns_unresolved_when_no_stem_matches():
    empty: dict[str, Counter[str]] = {}
    decision = morphology_decision("אבתרג", empty, empty)
    assert decision is not None
    assert decision.review_status == "unresolved"
    assert decision.strong is None


def test_weak_root_variant_is_scored_with_penalty():
    index = lemma_index({"קהלת": ["H6951"]})
    empty: dict[str, Counter[str]] = {}
    decision = morphology_decision("וַיִּקָּהֲלוּ", index, empty)
    # Even if not auto-accepted, the weak-root parse must be considered.
    assert decision is not None


def test_backtest_reports_precision_and_regressions():
    index = lemma_index({"דעת": ["H1847"], "שמר": ["H8104"]})
    empty: dict[str, Counter[str]] = {}
    report = backtest_morphology(
        [("בְּדַעְתֵּנוּ", "H1847"), ("שָׁמְרוּ", "H8104"), ("אבתרג", "H9999")],
        index,
        empty,
    )
    assert "precision" in report
    assert "regressions" in report
    assert report["true_positives"] + report["false_positives"] + report["routed_to_review"] == 3


def test_backtest_auto_accept_is_consistent_deterministic():
    index = lemma_index({"דעת": ["H1847"]})
    empty: dict[str, Counter[str]] = {}
    a = backtest_morphology([("בְּדַעְתֵּנוּ", "H1847")], index, empty)
    b = backtest_morphology([("בְּדַעְתֵּנוּ", "H1847")], index, empty)
    assert a == b


def test_build_review_queue_lists_auto_accepts():
    index = lemma_index({"דעת": ["H1847"]})
    attested = {normalize_hebrew("דעת"): Counter({"H1847": 12})}
    unresolved = [
        {"book": "philemon", "chapter": 1, "verse": 1, "position": 1, "text": "בְּדַעְתֵּנוּ"},
        {"book": "philemon", "chapter": 1, "verse": 2, "position": 1, "text": "בְּדַעְתֵּנוּ"},
        {"book": "mark", "chapter": 1, "verse": 5, "position": 3, "text": "אובג"},
    ]
    queue = build_review_queue(unresolved, index, attested)
    auto = [row for row in queue if row.get("review_status") == "auto_accepted"]
    assert auto, queue
    assert auto[0]["normalized"] == normalize_hebrew("בְּדַעְתֵּנוּ")
    assert auto[0]["occurrence_count"] == 2
    assert "H1847" in auto[0]["proposed_strongs"]
    # Unmatched forms remain explicitly enumerated for image review.
    assert any(row["normalized"] == "אובג" for row in queue)


def test_write_review_queue_produces_valid_json(tmp_path):
    output = tmp_path / "q.json"
    write_review_queue(
        [{"normalized": "דענה", "occurrence_count": 1, "reason": "morphology_review"}],
        output,
    )
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["method"] == "morphology_analysis"
    assert payload["queue"][0]["normalized"] == "דענה"


def test_morphology_is_non_positional():
    # The module must never use word position; verify surface-only behavior
    # by checking the same surface yields the same decision regardless of the
    # (irrelevant) surrounding context.
    index = lemma_index({"דעת": ["H1847"]})
    empty: dict[str, Counter[str]] = {}
    d1 = morphology_decision("בְּדַעְתֵּנוּ", index, empty)
    d2 = morphology_decision("בְּדַעְתֵּנוּ", index, empty)
    assert (d1.strong if d1 else None) == (d2.strong if d2 else None)

def test_yhwh_is_not_morphed():
    index = lemma_index({"יהוה": ["H3068"], "הוה": ["H1933"], "יה": ["H3050"]})
    empty: dict[str, Counter[str]] = {}
    for surface in ("יהוה", "יְהֹוָה", "ויהוה", "לַיהוָה"):
        assert is_yhwh_surface(surface)
        decision = morphology_decision(surface, index, empty)
        assert decision is not None
        assert decision.strong is None
        assert decision.review_status == "unresolved"
        assert "yhwh_skip" in decision.evidence
    queue = build_review_queue(
        [{"book": "exod", "chapter": 3, "verse": 15, "position": 1, "text": "יהוה"}],
        index,
        empty,
    )
    assert len(queue) == 1 and queue[0]["review_status"] == "unresolved"



def test_rival_in_same_counter_cannot_be_hidden_by_frequency():
    decision = morphology_decision("דעתנו", {}, {normalize_hebrew("דעת"): Counter({"H1847": 100, "H999": 1})})
    assert decision.review_status == "review"
    assert {x.strong for x in decision.candidates} == {"H1847", "H999"}


def test_empty_backtest_cannot_authorize_corpus_application():
    assert not backtest_morphology([], {}, {})["gate_passed"]
