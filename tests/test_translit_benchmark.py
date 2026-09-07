import json
from pathlib import Path

from scripts.translit.benchmark import score_cases


def test_benchmark_is_reproducible_and_reports_metrics():
    path = Path("data/translit/benchmark.json")
    report = score_cases(json.loads(path.read_text(encoding="utf-8")))
    assert report["total"] == 26
    assert report["exact_rate"] == 1.0
    assert report["normalized_rate"] == 1.0


def test_benchmark_detects_regression():
    cases = [{"id": "case", "hebrew": "שַׁבָּת", "expected_en": "wrong", "expected_es": "wrong"}]
    report = score_cases(cases)
    assert report["exact_rate"] == 0.0
    assert report["cases"][0]["exact"] is False


def test_empty_and_duplicate_benchmarks_fail_closed():
    import pytest
    with pytest.raises(ValueError, match="contain"): score_cases([])
    case={"id":"same","hebrew":"שַׁבָּת","expected_en":"shabat","expected_es":"shabat"}
    with pytest.raises(ValueError, match="Duplicate"): score_cases([case,case])

def test_both_corpora_pass_independently():
    cases=json.loads(Path("data/translit/benchmark.json").read_text())
    for corpus in ["tanakh","besorah"]:
        report=score_cases([c for c in cases if c["corpus"]==corpus])
        assert report["exact_rate"]==1

def test_book_generation_is_integrated_and_deterministic(tmp_path, monkeypatch):
    from scripts.translit import local_processor as mod
    for corpus, book in [("tanakh","genesis"),("besorah","matthew")]:
        source=tmp_path/corpus; folder=source/book;folder.mkdir(parents=True)
        (folder/"1.json").write_text(json.dumps([{"chapter":1,"verses":[{"chapter":1,"verse":1,"words":[{"text":"מִצְוָה","strong":"H4687"},{"text":"יְהוָה","strong":"H3068"}]}]}]))
        monkeypatch.setattr(mod,"TANAKH_DIR",source);monkeypatch.setattr(mod,"BESORAH_DIR",source)
        monkeypatch.setattr(mod,"OUTPUT_DIR",tmp_path/"out")
        mod.transliterate_book_local(book,corpus,100)
        path=tmp_path/"out"/(book+".json");before=path.read_bytes()
        mod.transliterate_book_local(book,corpus,100)
        assert path.read_bytes()==before
        words=json.loads(before)["verses"][0]["words"]
        assert words[0]["translit_en"]=="mitzvah"
        assert not words[1].get("translit_en")
