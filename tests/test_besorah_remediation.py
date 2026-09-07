import copy
import json
from pathlib import Path
import pytest
from scripts.delitzsch.review.remediate import build_plan, apply_plan, digest, encoded, pointed, publication_errors

class Lexicon:
    def get(self, strong):
        return {"lemma":"א"} if strong else None

def corpus(words):
    return {"jude/1.json":[{"chapter":1,"verses":[{"verse":1,"hebrew":" ".join(w["text"] for w in words),"words":words}]}]}

def test_exact_pointing_repairs_pronouns_but_does_not_guess_homographs():
    source=corpus([{"text":t,"strong":s,"prefixes":[]} for t,s in [("לוֹ","H7592"),("לוּ","H3863"),("בִּי","H994"),("בו","H1"),("לִי","H1350")]])
    before=copy.deepcopy(source)
    plan=build_plan(source,Lexicon(),{"jude.1.1.4":{"status":"skipped"}})
    assert source==before
    assert len(plan['changes'])==1
    assert plan['changes'][0]['after']['strong']=='D0266'
    assert plan['baseline']['hebrew_tokens']==plan['final']['hebrew_tokens']

def test_punctuation_is_preserved_without_a_fake_lexical_entry():
    source=corpus([{"text":"חָי","strong":"H2416","prefixes":[]},{"text":"׃","strong":"H539","prefixes":[]}])
    plan=build_plan(source,Lexicon(),{})
    verse=plan['files']['jude/1.json']['after'][0]['verses'][0]
    assert verse['words']==[{"text":"חָי׃","strong":"H2416","prefixes":[]}]
    assert verse['hebrew']==source['jude/1.json'][0]['verses'][0]['hebrew']
    assert plan['quality_gate']['passed']

def test_placeholder_ledger_retains_original_but_unrecognized_latin_text_blocks():
    source=corpus([{"text":"WO","strong":"H2245","prefixes":[]}])
    plan=build_plan(source,Lexicon(),{})
    assert plan['changes'][0]['before']==source['jude/1.json'][0]['verses'][0]
    assert plan['final']['tokens']==0
    other=corpus([{"text":"damaged","strong":"H1","prefixes":[]}])
    assert not build_plan(other,Lexicon(),{})['quality_gate']['passed']

def test_stale_batch_is_not_partially_applied_and_repeat_is_byte_stable(tmp_path):
    source=corpus([{"text":"לוֹ","strong":"H7592","prefixes":[]}])
    source['jude/2.json']=copy.deepcopy(source['jude/1.json'])
    source['jude/2.json'][0]['chapter']=2
    plan=build_plan(source,Lexicon(),{})
    for path,payload in source.items():
        target=tmp_path/path;target.parent.mkdir(exist_ok=True);target.write_bytes(encoded(payload))
    second=tmp_path/'jude/2.json';second.write_text('[]')
    first=(tmp_path/'jude/1.json').read_bytes()
    with pytest.raises(ValueError,match='Stale'):apply_plan(plan,tmp_path)
    assert (tmp_path/'jude/1.json').read_bytes()==first
    second.write_bytes(encoded(source['jude/2.json']))
    assert apply_plan(plan,tmp_path)==2
    written=(tmp_path/'jude/1.json').read_bytes()
    assert apply_plan(plan,tmp_path)==0
    assert (tmp_path/'jude/1.json').read_bytes()==written
    assert digest(plan)==digest(build_plan(source,Lexicon(),{}))

def test_needs_review_candidates_cannot_be_published():
    data=corpus([{"text":"א","strong":"H1","prefixes":[],"mapping_review":{"status":"needs_review"}}])
    assert publication_errors(data,Lexicon())==[['jude.1.1.0','unreviewed_candidate_published']]

def test_custom_instance_sync_preserves_existing_and_is_idempotent(tmp_path):
    from scripts.delitzsch.review.remediate import sync_custom_instances
    source=corpus([{"text":"לוֹ","strong":"H7592","prefixes":[]}])
    plan=build_plan(source,Lexicon(),{})
    target=tmp_path/'custom.json'
    existing={"book":"acts","chapter":1,"verse":1,"word_index":2,"text":"לוֹ"}
    target.write_text(json.dumps({"D0266":{"nt_instances":[existing],"definitions":["retained"]}}))
    assert sync_custom_instances(plan,target)==1
    first=target.read_bytes()
    assert sync_custom_instances(plan,target)==0
    assert target.read_bytes()==first
    entry=json.loads(first)['D0266']
    assert entry['nt_instances'][0]==existing
    assert entry['definitions']==['retained']

def test_checked_in_repairs_match_narrow_rules_and_preserve_scripture():
    import gzip
    from collections import Counter
    from scripts.delitzsch.review.remediate import GRAMMAR
    plan=json.load(gzip.open('data/delitzsch_review/reports/besorah_remediation_v1.json.gz'))
    mappings=[c for c in plan['changes'] if c['kind']=='mapping']
    assert Counter(c['after']['strong'] for c in mappings)=={'D0208':271,'D0265':196,'D0266':539,'D0271':50,'D0277':48,'H1058':1}
    for change in mappings:
        if change['after']['strong']=='H1058':
            assert change['location']=='acts.9.39.12'
            assert change['after']['prefixes']==[]
        else:
            assert GRAMMAR[pointed(change['before']['text'])]==change['after']['strong']
        assert change['before']['text']==change['after']['text']
    assert plan['baseline']['hebrew_character_sha256']==plan['final']['hebrew_character_sha256']
