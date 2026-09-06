"""Regression tests for conservative Hebrew syllable shortening."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from transliterate import BaniTransliterator


def test_medial_sheva_is_silent_in_miqveh():
    transliterator = BaniTransliterator("en")

    result = transliterator.transliterate_detailed("מִקְוֶה", "H4723")

    assert result["translit"] == "miqveh"


def test_vocal_sheva_at_word_start_is_preserved():
    transliterator = BaniTransliterator("en")

    result = transliterator.transliterate_detailed("וְ", "H6")

    assert result["translit"] == "ve"


def test_existing_simple_word_remains_unchanged():
    transliterator = BaniTransliterator("en")

    result = transliterator.transliterate_detailed("יוֹם", "H3117")

    assert result["translit"] == "yom"


def test_qof_uses_q_in_both_language_schemas():
    assert BaniTransliterator("en").transliterate("קָוָה", "H6960") == "qaVAh"
    assert BaniTransliterator("es").transliterate("קָוָה", "H6960") == "qaVAh"


def test_distant_prefix_vowel_does_not_make_sheva_silent():
    transliterator = BaniTransliterator("en").transliterator
    text = "מַבְגְדָ"
    sheva_index = text.index("ְ", text.index("ְ") + 1)

    assert transliterator.is_silent_sheva(text, sheva_index) is False


def test_distant_suffix_vowel_does_not_make_sheva_silent():
    transliterator = BaniTransliterator("en").transliterator
    text = "מַבְגְדָ"
    sheva_index = text.index("ְ")

    assert transliterator.is_silent_sheva(text, sheva_index) is False
