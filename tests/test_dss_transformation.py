from scripts.translit.dss_processor import resolve_dss_transliteration
from scripts.translit.local_translit import LocalTransliterator


def test_editorial_dss_transliteration_wins_over_local_fallback():
    result = resolve_dss_transliteration(
        {
            "dss_word": "אל המשפט",
            "dss_translit_en": "el hammishpat",
            "dss_translit_es": "el hammishpat",
        },
        LocalTransliterator(),
    )
    assert result == ("el hammishpat", "el hammishpat", "editorial", "high")


def test_reordered_mult_word_dss_variant_is_transliterated_as_dss_surface():
    en, es, source, confidence = resolve_dss_transliteration(
        {"dss_word": "ואבשלום יעשה לו"}, LocalTransliterator()
    )
    # The local baseline is intentionally conservative for unpointed forms;
    # an editorial or xAI-vocalized value can replace it deterministically.
    assert en == "vvshlvm yshh lv"
    assert es == "vvshlvm yshh lv"
    assert source == "local_rule"
    assert confidence == "low"

def test_cached_vocalization_never_changes_dss_consonants(tmp_path, monkeypatch):
    import json
    from scripts.translit import dss_processor as processor
    books = tmp_path / "books"; books.mkdir()
    cache = tmp_path / "cache.json"; cache.write_text(json.dumps({"ולוא": "וְלֹא", "אל המשפט": "אֶל־הַמִּשְׁפָּט"}))
    source = {"chapters": {"15": {"verses": {"2": {"differences": [{"position": 1, "dss_word": "אל המשפט"}, {"position": 2, "dss_word": "ולוא"}]}}}}}
    (books / "2samuel.json").write_text(json.dumps(source))
    monkeypatch.setattr(processor, "DSS_BOOKS_DIR", books)
    monkeypatch.setattr(processor, "DSS_TRANSLIT_DIR", tmp_path / "out")
    monkeypatch.setattr(processor, "DSS_VOCALIZATION_CACHE_PATH", cache)
    processor.transliterate_dss_book("2samuel")
    output = tmp_path / "out/2samuel.json"; first = output.read_bytes()
    variants = json.loads(first)["variants"]
    assert variants[0]["dss_translit_source"] == "cached_ai_vocalization"
    assert variants[1]["dss_vocalization_rejected"]
    assert variants[1]["dss_word_niqqud"] == "ולוא"
    processor.transliterate_dss_book("2samuel")
    assert output.read_bytes() == first
