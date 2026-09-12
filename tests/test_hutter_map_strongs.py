from __future__ import annotations

from collections import Counter
import json
from pathlib import Path

from scripts.hutter.map_strongs import (
    StrongCandidate,
    align_similar_words,
    best_contextual_custom_match,
    build_unresolved_queue,
    contextual_custom_decision,
    contextual_custom_variant_decision,
    decide_from_indexes,
    load_exact_custom_lemmas,
    load_lexicon_lemmas,
    ocr_crosscheck_decision,
    same_verse_spelling_decision,
    unresolved_reason,
)


def test_context_only_custom_entries_are_not_global_hutter_lemmas(
    tmp_path, monkeypatch
) -> None:
    lexicon_words = tmp_path / "words"
    lexicon_roots = tmp_path / "roots"
    lexicon_words.mkdir()
    lexicon_roots.mkdir()
    custom_definitions = tmp_path / "custom_definitions.json"
    custom_definitions.write_text(
        json.dumps(
            {
                "D0001": {"hebrew": "לִי", "mapping_scope": "instances_only"},
                "D0002": {"hebrew": "מָרְתָה", "mapping_scope": "global"},
                # Missing scope preserves compatibility for existing reviewed
                # corpus entries created before scoping was introduced.
                "D0003": {"hebrew": "תַּלְמוּד"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr("scripts.hutter.map_strongs.LEXICON_WORDS_ROOT", lexicon_words)
    monkeypatch.setattr("scripts.hutter.map_strongs.LEXICON_ROOTS_ROOT", lexicon_roots)
    monkeypatch.setattr(
        "scripts.hutter.map_strongs.CUSTOM_DEFINITIONS_PATH", custom_definitions
    )

    lemmas = load_lexicon_lemmas()

    assert "לי" not in lemmas
    assert lemmas["מרתה"] == Counter({"D0002": 2})
    assert lemmas["תלמוד"] == Counter({"D0003": 2})


def test_exact_custom_lemma_matches_whole_pointed_token_without_prefix_leakage() -> None:
    exact_custom = {"לִי": Counter({"D0265": 3})}

    exact = decide_from_indexes("לִי", {}, {}, {}, {}, {}, exact_custom)
    longer = decide_from_indexes("בְּלִי", {}, {}, {}, {}, {}, exact_custom)
    conjoined = decide_from_indexes("וּלִי", {}, {}, {}, {}, {}, exact_custom)

    assert exact is not None
    assert exact.strong == "D0265"
    assert exact.method == "exact_custom_lemma"
    assert longer is None
    assert conjoined is not None
    assert conjoined.strong == "Hc/D0265"
    assert conjoined.prefixes == ("Hc",)


def test_exact_custom_lemma_loads_explicit_pointed_mapping_forms(
    tmp_path, monkeypatch
) -> None:
    custom_definitions = tmp_path / "custom_definitions.json"
    custom_definitions.write_text(
        json.dumps(
            {
                "D0001": {
                    "hebrew": "לָנוּ",
                    "mapping_scope": "exact",
                    "mapping_forms": ["לָּנוּ", "לְנוּ"],
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "scripts.hutter.map_strongs.CUSTOM_DEFINITIONS_PATH", custom_definitions
    )

    forms = load_exact_custom_lemmas()

    assert forms == {
        "לָנוּ": Counter({"D0001": 1}),
        "לָּנוּ": Counter({"D0001": 1}),
        "לְנוּ": Counter({"D0001": 1}),
    }


def test_contextual_custom_mapping_handles_hutter_name_spelling_without_position() -> None:
    decision = contextual_custom_decision(
        "לְטִימוֹתֵאוֹס",
        {"D0093": {"טימותיוס"}},
    )

    assert decision is not None
    assert decision.strong == "Hl/D0093"
    assert decision.prefixes == ("Hl",)
    assert decision.method == "verse_context_custom"
    assert "not word position" in decision.evidence


def test_contextual_custom_mapping_rejects_ambiguous_fuzzy_names() -> None:
    match = best_contextual_custom_match(
        "אבגדו",
        {
            "D0001": {"אבגדה"},
            "D0002": {"אבגדי"},
        },
    )

    assert match is None


def test_contextual_custom_mapping_breaks_same_entry_form_ties_deterministically() -> None:
    match = best_contextual_custom_match(
        "הקנא",
        {"D0086": {"קנאי", "הקני"}},
    )

    assert match is not None
    assert match.custom_surface == "הקני"


def test_contextual_variant_propagates_reviewed_form_with_prefix() -> None:
    decision = contextual_custom_variant_decision(
        "וְסְטֶפָנוֹס",
        {"סטפנוס": Counter({"D0015": 2})},
    )

    assert decision is not None
    assert decision.strong == "Hc/D0015"
    assert decision.confidence == "high"
    assert decision.method == "contextual_custom_variant"


def test_unresolved_items_explain_why_positional_mapping_was_rejected() -> None:
    reason = unresolved_reason(
        {"text": "מִלָּה", "strong": "H4405", "prefixes": []}
    )
    queue = build_unresolved_queue(
        [
            {
                "book": "acts",
                "chapter": 1,
                "verse": 4,
                "position": 1,
                "text": "וַיִּקָּהֲלֵם",
                "normalized": "ויקהלמ",
                "reason": reason,
            },
            {
                "book": "acts",
                "chapter": 2,
                "verse": 1,
                "position": 2,
                "text": "וַיִּקָּהֲלֵם",
                "normalized": "ויקהלמ",
                "reason": reason,
            },
        ]
    )

    assert "positional borrowing was rejected" in reason
    assert queue[0]["occurrence_count"] == 2
    assert queue[0]["first_occurrence"] == "acts 1:4#1"


def test_alternate_ocr_alignment_handles_an_inserted_word() -> None:
    aligned = align_similar_words(
        ["ראשון", "אחרון"],
        ["ראשון", "נוסף", "אחרון"],
    )

    assert aligned == {0: 0, 1: 2}


def test_same_verse_spelling_rejects_ambiguous_strongs() -> None:
    decision = same_verse_spelling_decision(
        "מִלִּים",
        [
            {"text": "מלימ", "strong": "H4405", "prefixes": []},
            {"text": "מלימ", "strong": "H4406", "prefixes": []},
        ],
    )

    assert decision is None


def test_same_verse_spelling_accepts_unique_nonpositional_match() -> None:
    decision = same_verse_spelling_decision(
        "מִלִּים",
        [
            {"text": "אחרת", "strong": "H312", "prefixes": []},
            {"text": "מלימ", "strong": "H4405", "prefixes": []},
        ],
    )

    assert decision is not None
    assert decision.strong == "H4405"


def ocr_decision(
    hutter_word: str,
    alternate_word: str,
    *,
    ocr_confidence: str = "medium",
    strong: str = "H1234",
    delitzsch_strongs: tuple[str, ...] = ("H1234",),
    custom_name_forms: dict[str, set[str]] | None = None,
    verse_custom_forms: dict[str, set[str]] | None = None,
):
    candidate = StrongCandidate(strong=strong, prefixes=())
    return ocr_crosscheck_decision(
        hutter_word,
        alternate_word,
        ocr_confidence,
        [
            {"text": f"word-{index}", "strong": item, "prefixes": []}
            for index, item in enumerate(delitzsch_strongs)
        ],
        {},
        {},
        {alternate_word: Counter({candidate: 2})},
        {},
        {},
        {},
        custom_name_forms or {},
        verse_custom_forms or {},
        {},
    )


def test_ocr_crosscheck_rejects_low_confidence_transcription() -> None:
    assert (
        ocr_decision("אבגדה", "אבגדי", ocr_confidence="low")
        is None
    )


def test_ocr_crosscheck_rejects_weak_ordinary_similarity() -> None:
    assert ocr_decision("אבגדה", "אזחטי") is None


def test_ocr_crosscheck_accepts_close_transcription_without_verse_support() -> None:
    decision = ocr_decision(
        "אבגדהוזחטי",
        "אבגדהוזחתי",
        delitzsch_strongs=("H9999",),
    )

    assert decision is not None
    assert decision.strong == "H1234"
    assert decision.method == "ocr_crosscheck"


def test_ocr_crosscheck_accepts_reviewed_proper_name_with_weaker_ocr_spelling() -> None:
    decision = ocr_decision(
        "כשפנוס",
        "סטפנוס",
        strong="D0015",
        delitzsch_strongs=("D0015",),
        custom_name_forms={"D0015": {"סטפנוס"}},
        verse_custom_forms={"D0015": {"סטפנוס"}},
    )

    assert decision is not None
    assert decision.strong == "D0015"


def test_ocr_crosscheck_rejects_different_name_from_same_verse() -> None:
    decision = ocr_decision(
        "פובלים",
        "פובליוס",
        strong="D0024",
        delitzsch_strongs=("D0024",),
        custom_name_forms={"D0024": {"פולוס"}},
        verse_custom_forms={"D0024": {"פולוס"}},
    )

    assert decision is None


def test_image_reviewed_hutter_names_have_lexicon_definitions() -> None:
    definitions = json.loads(
        Path("data/dict/lexicon/custom_definitions.json").read_text()
    )

    assert definitions["D0210"]["transliteration_en"] == "Martha"
    assert definitions["D0211"]["transliteration_en"] == "Caesar"
    assert definitions["D0212"]["transliteration_en"] == "Artemas"
    assert definitions["D0213"]["transliteration_en"] == "Nicopolis"
    assert definitions["D0214"]["transliteration_en"] == "twelve"
    assert definitions["D0215"]["transliteration_en"] == "onah"
    assert definitions["D0216"]["transliteration_en"] == "eizeh"
    assert definitions["D0217"]["transliteration_en"] == "othon"
    assert definitions["D0218"]["transliteration_en"] == "naor"
    assert definitions["D0219"]["transliteration_en"] == "shel"
    assert definitions["D0220"]["transliteration_en"] == "talmud"
    assert definitions["D0284"]["transliteration_en"] == "Cappadocia"


def test_image_reviewed_titus_names_use_custom_mappings() -> None:
    mapping = json.loads(
        Path("data/hutter/strong_mappings/titus.json").read_text()
    )
    chapter = next(item for item in mapping["chapters"] if item["chapter"] == 3)
    verse = next(item for item in chapter["verses"] if item["verse"] == 12)
    mapped = {word["text"]: word.get("strong") for word in verse["words"]}

    assert mapped["אַרְטֵמָא"] == "D0212"
    assert mapped["בְּנִיקוֹפּוֹלִיס"] == "D0213"


def test_short_custom_clitics_map_exactly_without_leaking_into_longer_words() -> None:
    assert mapped_words("acts", 1, 6)["לוֹ"] == "D0266"
    assert mapped_words("romans", 2, 12)["בְּלִי"] == "H1097"
    assert mapped_words("romans", 12, 1)["לוֹבָה"] is None


def test_image_reviewed_pronominal_forms_use_exact_custom_mappings() -> None:
    assert mapped_words("acts", 6, 2)["לָנוּ"] == "D0273"
    assert mapped_words("luke", 4, 34)["לָּנוּ"] == "D0273"
    assert mapped_words("acts", 16, 12)["לְנוּ"] == "D0273"
    assert mapped_words("acts", 4, 29)["לְךָ"] == "D0274"
    assert mapped_words("acts", 3, 6)["לָךְ"] == "D0275"
    assert mapped_words("acts", 5, 8)["לָהּ"] == "D0276"
    assert mapped_words("acts", 4, 17)["בָּהֶם"] == "D0277"
    assert mapped_words("acts", 1, 2)["בָּם"] == "D0278"
    assert mapped_words("acts", 22, 19)["בָּךְ"] == "D0279"


def test_continued_image_review_maps_verified_inflections_and_nt_terms() -> None:
    cases = [
        ("acts", 14, 22, "וְהִפְקִידוּם", "Hc/H6485"),
        ("corinthians1", 8, 1, "מִפִּיחָה", "H5301"),
        ("galatians", 5, 6, "פּוֹעֲלָה", "H6466"),
        ("hebrews", 10, 35, "מִבְטַחֲכֶם", "H4009"),
        ("john", 6, 23, "מִטִּבֶרְיָס", "D0281"),
        ("john", 11, 8, "לְרָגְמֵם", "Hl/H7275"),
        ("john", 19, 39, "נִיקְדֵם", "D0280"),
        ("luke", 8, 37, "וַיִּשְׁאֲלוּהוּ", "Hc/H7592"),
        ("mark", 4, 21, "הַנִּיר", "Hd/H5369"),
        ("matthew", 9, 25, "טַלְיָא", "D0282"),
        ("matthew", 28, 17, "סָפֵקוּ", "D0232"),
        ("revelation", 17, 6, "שֵׁכֹּר", "H7937"),
        ("thessalonians1", 5, 12, "לְדַעְתְּכֶם", "Hl/H3045"),
        ("titus", 3, 12, "לְחוֹרֵף", "Hl/H2778"),
    ]

    for book, chapter, verse, text, strong in cases:
        assert mapped_words(book, chapter, verse)[text] == strong


def test_substantial_image_review_maps_verified_suffix_forms() -> None:
    cases = [
        ("acts", 14, 5, "נַגִּידֵיהֶם", "H5057"),
        ("acts", 25, 7, "לְהַרְאוֹתָֽן", "Hl/H7200"),
        ("acts", 26, 31, "בְּיֵינוֹתָם", "H996"),
        ("colossians", 2, 5, "סִדְרְכֶם", "H5468"),
        ("corinthians1", 6, 15, "גְוִיּוֹתֵיכֶם", "H1472"),
        ("corinthians2", 8, 2, "מִסְכְּנוּתָם", "H4542"),
        ("hebrews", 7, 6, "מֵתּוֹלְדוֹתָם", "Hm/H8435"),
        ("john", 17, 19, "וּלְמַעֲנֵיהֶם", "Hc/Hl/H4616"),
        ("luke", 12, 35, "וְנֵרוֹתֵיכֶם", "Hc/H5369"),
        ("luke", 13, 10, "הָעֲדוֹתֵיהֶם", "Hd/H5712"),
        ("matthew", 16, 13, "קֵיסַרִיָּה", "D0283"),
        ("peter2", 1, 10, "בַּמְאַדְכֶם", "Hb/H3966"),
        ("revelation", 4, 10, "עִטְרוֹתָם", "H5850"),
        ("romans", 1, 24, "גְּוִיּוֹתָם", "H1472"),
        ("timothy1", 6, 15, "בְּעִתּוֹתָיו", "Hb/H6256"),
    ]

    for book, chapter, verse, text, strong in cases:
        assert mapped_words(book, chapter, verse)[text] == strong


def test_substantial_image_review_maps_additional_lexical_inflections() -> None:
    cases = [
        ("acts", 4, 37, "מְחִירוֹ", "H4242"),
        ("acts", 20, 15, "בָּאֳנִיָּם", "Hb/H591"),
        ("ephesians", 4, 26, "כַּעַסְכֶם", "H3708"),
        ("galatians", 6, 5, "סִבְלוֹ׃", "H5447"),
        ("john", 5, 6, "מִמַּחֲלָתֶךָ", "Hm/H4244"),
        ("luke", 2, 28, "זְרוֹעָיו", "H2220"),
        ("luke", 19, 8, "רְכוּשִׁי", "H7399"),
        ("matthew", 3, 12, "מִזְרֵהוּ", "H4214"),
        ("matthew", 28, 19, "וְטָבְלוּ", "Hc/H2881"),
        ("philippians", 1, 3, "זִכְרְכֶם", "H2143"),
        ("revelation", 18, 11, "מִקְחוֹתָם", "H4727"),
    ]

    for book, chapter, verse, text, strong in cases:
        assert mapped_words(book, chapter, verse)[text] == strong


def test_scan_review_repairs_hutter_transcriptions_and_maps_restored_forms() -> None:
    cases = [
        ("hebrews", 7, 14, "אֲדוֹנֵינוּ", "H113"),
        ("hebrews", 8, 7, "הָרִאשׁוֹנָה", "Hd/H7223"),
        ("mark", 2, 14, "וַיַּעֲבֹר", "Hc/H5674"),
        ("mark", 2, 14, "וַיַּרְא", "Hc/H7200"),
        ("mark", 2, 18, "הַפְּרוּשִׁים", "Hd/H6566"),
        ("matthew", 26, 22, "וַיִּתְעַצְּבוּ", "Hc/H6087"),
        ("philippians", 2, 4, "יוֹעִיל", "H3276"),
        ("revelation", 8, 13, "בְּתוֹךְ", "Hb/H8432"),
        ("revelation", 16, 13, "נָבִיא", "H5030"),
        ("revelation", 17, 4, "וְאַרְגָּמָן", "Hc/H713"),
        ("romans", 1, 18, "רִשְׁעָה", "H7564"),
        ("romans", 9, 5, "וְהַמָּשִׁיחַ", "Hc/Hd/H4899"),
        ("thessalonians1", 1, 5, "בְּשׂוֹרָתֵנוּ", "Hb/H1309"),
    ]

    for book, chapter, verse, text, strong in cases:
        assert mapped_words(book, chapter, verse)[text] == strong


def test_continued_scan_review_maps_restored_words_and_clauses() -> None:
    cases = [
        ("acts", 28, 4, "רֵעֵהוּ", "H7453"),
        ("acts", 28, 4, "רוֹצֵחַ", "H7523"),
        ("corinthians2", 10, 5, "הַמִּתְרוֹמֵם", "Hd/H3035"),
        ("corinthians2", 11, 31, "הַמְבֹרָךְ", "Hd/H1288"),
        ("john1", 1, 6, "נֹאמַר", "H559"),
        ("luke", 21, 24, "הַגּוֹיִם", "Hd/H1471"),
        ("mark", 1, 11, "מִשָּׁמַיִם", "Hm/H8064"),
        ("mark", 9, 17, "הַקָּהָל", "Hd/H6951"),
        ("mark", 16, 16, "וְנִטְבַּל", "H2881"),
        ("mark", 16, 16, "יִשָּׁפֵט", "H8199"),
        ("matthew", 19, 10, "הָאָדָם", "Hd/H120"),
        ("matthew", 26, 63, "בֶּן־", "H1121"),
        ("peter1", 1, 3, "הֶחֱזִיר", "Hd/H2386"),
        ("peter1", 1, 3, "אוֹתָנוּ", "H853"),
        ("romans", 11, 36, "הַכָּבוֹד", "Hd/H3519"),
    ]

    for book, chapter, verse, text, strong in cases:
        assert mapped_words(book, chapter, verse)[text] == strong


def test_expanded_clause_review_maps_image_confirmed_inflections_and_names() -> None:
    cases = [
        ("ephesians", 4, 16, "נֶעֶרְכָה", "H6186"),
        ("ephesians", 4, 18, "הַחֲשׁוּכִים", "Hd/H2821"),
        ("ephesians", 4, 18, "בְּעָרְלַת", "Hb/H6190"),
        ("galatians", 6, 14, "הוּקַעְתִּי", "H3363"),
        ("jude", 1, 6, "הָאֹפֶל", "Hd/H652"),
        ("jude", 1, 6, "נְצָרָם", "H5341"),
        ("peter1", 1, 1, "כַּפָּדוֹקְיָא", "D0284"),
        ("philippians", 4, 1, "וַעֲטָרָתִי", "Hc/H5850"),
        ("revelation", 14, 8, "הַתַּעֲנוּגוֹת", "Hd/H8588"),
        ("romans", 16, 18, "וּבִבְרָכוֹתָם", "Hc/Hb/H1293"),
        ("timothy1", 5, 17, "הַיֹּגְעִים", "Hd/H3021"),
        ("timothy2", 2, 12, "נִתְעוֹדֵד", "H5749"),
        ("timothy2", 2, 12, "נְכַחֵשׁ", "H3584"),
        ("timothy2", 2, 12, "יְכַחֲשֵׁנוּ", "H3584"),
    ]

    for book, chapter, verse, text, strong in cases:
        assert mapped_words(book, chapter, verse)[text] == strong


def test_scan_review_maps_verified_hutter_inflections() -> None:
    cases = [
        ("acts", 3, 10, "וַיִּדְעוּהוּ", "Hc/H3045"),
        ("acts", 20, 35, "הַחֲלוּשִׁים", "Hd/H2523"),
        ("acts", 28, 31, "נִכְלָא", "H3607"),
        ("corinthians1", 9, 18, "שְׁלוּטוֹן", "H7983"),
        ("galatians", 3, 1, "לְבִלְתִּיכֶם", "Hl/H1115"),
        ("john", 7, 34, "תִמְצָאוּנִי", "H4672"),
        ("john", 19, 19, "כְּתוֹבֶת", "H3793"),
        ("mark", 4, 7, "וַיְּחַנְּקוּהוּ", "Hc/H2614"),
        ("mark", 6, 8, "צִלְקוֹן", "D0233"),
        ("peter1", 3, 9, "תַּנְחִילוּ", "H5157"),
        ("philemon", 1, 20, "רַחֲמַי", "H7356"),
        ("revelation", 3, 19, "קְנָא", "H7065"),
        ("romans", 7, 20, "עוֹשֶׂהוּ", "H6213"),
    ]

    for book, chapter, verse, text, strong in cases:
        assert mapped_words(book, chapter, verse)[text] == strong


def test_image_review_corrects_second_peter_hearts_transcription() -> None:
    words = mapped_words("peter2", 1, 19)

    assert "כּֽוֹכְבֵיכֶֽם" not in words
    assert words["בִּלְבַבְכֶֽם"] == "Hb/H3824"


def test_regeneration_safety_review_repairs_clitics_and_false_inner_matches() -> None:
    assert mapped_words("john", 4, 46)["וּבְנוֹ"] == "Hc/H1121"
    assert mapped_words("matthew", 28, 13)["בְּשָׁכְבֵּנוּ"] == "Hb/H7901"
    assert mapped_words("thessalonians1", 5, 11)["וּבְנוּ"] == "Hc/H1129"
    assert mapped_words("corinthians2", 10, 2)["הָלַכְנוּ"] == "H1980"


def test_regeneration_safety_review_uses_image_corrected_matthew_forms() -> None:
    assert mapped_words("matthew", 17, 20)["כְּמוֹ"] == "H3644"
    assert mapped_words("matthew", 17, 20)["גַרְעִין"] == "D0272"
    assert mapped_words("matthew", 19, 13)["הוּגְשׁוּ"] == "H5066"
    assert mapped_words("thessalonians1", 2, 6)["כְּמוֹ"] == "H3644"
    assert mapped_words("titus", 1, 10)["וּבְחוֹ"] is None


def mapped_words(
    book: str, chapter_number: int, verse_number: int
) -> dict[str, str | None]:
    mapping = json.loads(
        Path(f"data/hutter/strong_mappings/{book}.json").read_text()
    )
    chapter = next(
        item for item in mapping["chapters"] if item["chapter"] == chapter_number
    )
    verse = next(
        item for item in chapter["verses"] if item["verse"] == verse_number
    )
    return {word["text"]: word.get("strong") for word in verse["words"]}


def test_contextual_overrides_disambiguate_identical_hutter_spellings() -> None:
    assert mapped_words("john", 14, 8)["דִּינוּ"] == "H1767"
    assert mapped_words("mark", 14, 64)["דִּינוּ"] == "H1777"
    assert mapped_words("mark", 15, 26)["דִּינוֹ"] == "H1779"


def test_image_reviewed_numeral_abbreviation_is_mapped() -> None:
    words = mapped_words("revelation", 7, 8)

    assert words["(י״ב)"] == "D0214"


def test_repeated_forms_reviewed_against_images_are_mapped() -> None:
    assert mapped_words("luke", 24, 37)["וַיִּבָּהֲלוּ"] == "Hc/H926"
    assert mapped_words("mark", 11, 8)["וַיַּצִּיעוּ"] == "Hc/H3331"
    assert mapped_words("jude", 1, 21)["וְנִצְרוּ"] == "Hc/H5341"
    assert mapped_words("luke", 17, 14)["נִטְהֲרוּ"] == "H2891"
    assert mapped_words("mark", 11, 29)["תַּעֲנוּ"] == "H6030"
    assert mapped_words("matthew", 21, 33)["שֶׁל"] == "D0219"
    assert mapped_words("galatians", 4, 19)["יֻצַּר"] == "H3335"
    assert mapped_words("luke", 24, 11)["יָצֵר"] == "H3336"
    assert mapped_words("revelation", 22, 7)["יִצֹּר"] == "H5341"
    assert mapped_words("peter2", 3, 16)["נָדִים"] == "H5074"
    assert mapped_words("mark", 14, 44)["אֶשַּׁק"] == "H5401"
    assert mapped_words("john", 5, 14)["נִרְפֵּאתָ"] == "H7495"
    assert mapped_words("mark", 2, 12)["נִבְהָלִים"] == "H926"
    assert mapped_words("romans", 13, 2)["הַשִׁלְטוֹן"] == "Hd/H7983"
    assert mapped_words("matthew", 7, 28)["תַּלְמוּדוֹ׃"] == "D0220"
    assert mapped_words("ephesians", 5, 15)["תִּתְהַלְּכוּ"] == "H1980"


def test_false_repeated_forms_are_removed_by_image_corrections() -> None:
    assert "וַיְבֹהֲלוּ" not in mapped_words("luke", 24, 5)
    assert "וְנַצְרוּ" not in mapped_words("peter2", 3, 17)
    assert "שֶׁל־" not in mapped_words("hebrews", 8, 6)
    assert "יִכְלֶה" not in mapped_words("timothy1", 1, 17)
    assert "נֹדִים" not in mapped_words("john1", 5, 6)
    assert "יִשֶּׁה" not in mapped_words("timothy1", 3, 1)
    assert "לִגְּלוֹת" not in mapped_words("corinthians1", 7, 5)
    assert "נִבְהָלִים" not in mapped_words("john", 5, 21)
    assert "הַבְּחִירִים" not in mapped_words("john", 12, 18)


def test_image_review_provenance_requires_exact_reviewed_text():
    import pytest
    from scripts.hutter.map_strongs import annotate_image_review

    payload = {'book': 'revelation', 'chapters': [{'chapter': 17, 'verses': [{
        'verse': 3, 'hebrew': 'וְרָאִיתִי', 'words': [{
            'text': 'וְרָאִיתִי', 'strong': 'Hc/H7200', 'prefixes': ['Hc'],
        }],
    }]}]}
    review = {'issue': 127, 'book': 'revelation', 'chapter': 17, 'verse': 3,
              'review_status': 'image_confirmed', 'after': 'וְרָאִיתִי',
              'source_image': 'page.png', 'source_image_sha256': 'a' * 64,
              'output_image': 'crop.png'}
    annotate_image_review(payload, [review])
    verse = payload['chapters'][0]['verses'][0]
    assert verse['transcription_review']['source_image_sha256'] == 'a' * 64
    assert verse['words'][0]['mapping_parse']['stem_surface'] == 'ראיתי'
    assert verse['words'][0]['mapping_parse']['prefixes'] == ['Hc']
    review['after'] = 'different text'
    with pytest.raises(ValueError, match='does not match'):
        annotate_image_review(payload, [review])


def test_reviewed_morphology_is_preserved_in_override_decision():
    from scripts.hutter.map_strongs import manual_override_decision
    parse = {'binyan': 'hiphil', 'prefixes': ['Hc'], 'suffixes': ['1cs_object_ני']}
    decision = manual_override_decision({'strong': 'Hc/H3212', 'prefixes': ['Hc'],
                                         'morphology': parse, 'reason': 'image-reviewed'})
    assert decision.morphology == parse
    assert decision.strong == 'Hc/H3212' and decision.prefixes == ('Hc',)


def test_reviewed_regeneration_preserves_other_verses_and_rejects_stale_baseline():
    import copy
    import pytest
    from scripts.hutter.map_strongs import replace_reviewed_verses

    old = {'book': 'john', 'chapters': [{'chapter': 1, 'verses': [
        {'verse': 1, 'hebrew': 'before', 'words': [{'strong': 'original'}]},
        {'verse': 2, 'hebrew': 'untouched', 'words': [{'strong': 'reviewed'}]},
    ]}]}
    new = copy.deepcopy(old)
    new['chapters'][0]['verses'][0] = {'verse': 1, 'hebrew': 'after', 'words': []}
    new['chapters'][0]['verses'][1]['words'] = [{'strong': 'regression'}]
    review = {'issue': 127, 'book': 'john', 'chapter': 1, 'verse': 1,
              'before': 'before', 'after': 'after', 'review_status': 'image_confirmed'}
    assert replace_reviewed_verses(old, new, [review]) == {(1, 1)}
    assert old['chapters'][0]['verses'][1]['words'] == [{'strong': 'reviewed'}]
    assert replace_reviewed_verses(old, new, [review]) == {(1, 1)}
    old['chapters'][0]['verses'][0]['hebrew'] = 'stale'
    with pytest.raises(ValueError, match='Stale or unreviewed'):
        replace_reviewed_verses(old, new, [review])


def test_image_reviewed_hardship_and_hiphil_forms_keep_correct_lexemes():
    assert mapped_words('corinthians2', 11, 27)['בְּקֹר'] == 'Hb/H7120'
    assert mapped_words('corinthians2', 11, 27)['בְּעֵירוֹם'] == 'Hb/H5903'
    assert mapped_words('corinthians2', 11, 27)['בִּשְׁקֵדוֹת'] is None
    assert mapped_words('revelation', 17, 3)['וַיוֹלִיכֵנִי'] == 'Hc/H3212'
    mapping = json.loads(Path('data/hutter/strong_mappings/revelation.json').read_text())
    verse = next(v for c in mapping['chapters'] if c['chapter'] == 17
                 for v in c['verses'] if v['verse'] == 3)
    assert verse['transcription_review']['status'] == 'image_confirmed'
    word = verse['words'][0]
    assert word['mapping_parse']['binyan'] == 'hiphil'
    assert word['mapping_parse']['suffixes'] == ['1cs_object_ני']
