"""Safety checks for annotated forms and independent validation accounting."""

from scripts.hutter.attested_morphology import load_attestations, propose
from scripts.hutter.evaluate_attested_morphology import split_for, summarize


def corpus(tmp_path, words):
    (tmp_path / "Gen.xml").write_text(
        '<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">'
        + words + '</osis>'
    )
    return load_attestations(tmp_path)


def test_annotated_prefix_and_possessive_suffix_remain_distinct(tmp_path):
    index = corpus(tmp_path,
        '<w lemma="l/4327" morph="HR/Ncmsc/Sp3ms" id="x">לְ/מִינֵ/הוּ</w>')
    prefixed = propose("לְמִינֵהוּ", index, {"H4327"})
    bare = propose("מִינֵהוּ", index, {"H4327"})
    assert prefixed["eligible"] and prefixed["prefixes"] == ["Hl"]
    assert bare["eligible"] and bare["prefixes"] == []
    assert bare["evidence"][0]["morphology"] == "HNcmsc/Sp3ms"
    assert not propose("מִין", index, {"H4327"})["eligible"]


def test_imperfect_marker_is_not_a_lexical_prefix(tmp_path):
    index = corpus(tmp_path,
        '<w lemma="c/3513" morph="HC/Vpi3mp/Sp3mp" id="v">וְ/יִכַבְּדוּ/ם</w>')
    result = propose("וְיִכַבְּדוּם", index, {"H3513"})
    assert result["eligible"] and result["prefixes"] == ["Hc"]
    assert result["evidence"][0]["segments"] == ("וְ", "יִכַבְּדוּ", "ם")


def test_pointing_and_homographs_cannot_be_overruled_by_semantics(tmp_path):
    index = corpus(tmp_path,
        '<w lemma="1696" morph="HVqp3ms" id="a">דָּבָר</w>'
        '<w lemma="1697" morph="HNcmsa" id="b">דָּבָר</w>')
    assert propose("דָּבָר", index, {"H1697"})["reason"] == "competing_lexical_or_prefix_analyses"
    assert not propose("דְּבַר", index, {"H1697"})["eligible"]


def test_excludes_aramaic_ambiguous_lemmas_and_divine_name(tmp_path):
    index = corpus(tmp_path,
        '<w lemma="3068" morph="HNp" id="y">יְהוָה</w>'
        '<w lemma="1" morph="ANcmsa" id="a">אָב</w>'
        '<w lemma="1 2" morph="HNcmsa" id="b">אָב</w>')
    assert not index


def test_cantillation_ignored_but_vowels_retained(tmp_path):
    index = corpus(tmp_path,
        '<w lemma="1254 a" morph="HVqp3ms" id="a">בָּרָ֣א</w>')
    assert propose("בָּרָא", index, {"H1254"})["eligible"]
    assert not propose("בָּרָא", index, set())["eligible"]
    assert not propose("בְּרָא", index, {"H1254"})["eligible"]


def test_same_consonantal_form_is_never_in_both_splits():
    assert split_for("דָּבָר") == split_for("דְּבַר")


def test_repeated_gold_and_wrong_prefix_do_not_pass_gate():
    row = {"text": "וְדָבָר", "expected": "Hc/H1697", "proposal": {
        "eligible": True, "strong": "H1697", "prefixes": [],
    }}
    report = summarize([row] * 200)
    assert report["accepted_form_groups"] == 1
    assert report["lexical_precision"] == 1
    assert report["composite_precision"] == 0
    assert not report["gate_passed"]
