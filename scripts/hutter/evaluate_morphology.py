"""Bounded, read-only morphology experiments; never applies candidates."""
import sys,json,argparse
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from scripts.hutter.map_strongs import build_indexes,load_delitzsch_verses,DEFAULT_OUTPUT_ROOT,base_strong
from scripts.hutter.morphology import morphology_decision
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--legacy-parses',action='store_true')
args=parser.parse_args()
if args.legacy_parses:
 import scripts.hutter.morphology as morphology
 original=morphology.analyze_form
 morphology.analyze_form=lambda *a,**kw:[p for p in original(*a,**kw) if not p.parse_label.startswith('verbal_')]
_,_,base,lemma,_=build_indexes()
rows=[]
for p in sorted(DEFAULT_OUTPUT_ROOT.glob('*.json')):
 d=json.load(open(p)); context=load_delitzsch_verses(p.stem)
 for ch in d['chapters']:
  for v in ch['verses']:
   support={base_strong(w.get('strong')) for w in context.get((ch['chapter'],v['verse']),{}).get('words',[]) if w.get('strong')}
   for i,w in enumerate(v['words']):
    if w.get('strong') and w.get('mapping_method')!='manual_override':continue
    dec=morphology_decision(w['text'],lemma,base)
    if not dec:continue
    top=dec.candidates[0] if dec.candidates else None
    rows.append(dict(location=f'{p.stem}.{ch["chapter"]}.{v["verse"]}.{i}',text=w['text'],expected=w.get('strong'),auto=dec.review_status=='auto_accepted',got=dec.strong,prefixes=list(dec.prefixes),score=dec.score,stem=top.parse.stem if top else '',suffixes=list(top.parse.suffixes) if top else [],attested=top.corpus_count if top else 0,lemma=bool(top and lemma.get(top.parse.stem,{}).get(top.strong)),support=dec.strong in support,candidates=len(set(c.strong for c in dec.candidates)),evidence=dec.evidence))

filters={'baseline':lambda r:r['auto'],'same_verse':lambda r:r['auto'] and r['support'],'same_verse_3letters':lambda r:r['auto'] and r['support'] and len(r['stem'])>=3,'same_verse_lemma':lambda r:r['auto'] and r['support'] and r['lemma'],'same_verse_lemma_count2':lambda r:r['auto'] and r['support'] and r['lemma'] and r['attested']>=2,'same_verse_no_suffix':lambda r:r['auto'] and r['support'] and not r['suffixes']}
results={}
for name,rule in filters.items():
 gold=[r for r in rows if r['expected'] and rule(r)]
 tp=sum(r['got']==r['expected'].split('/')[-1] for r in gold);fp=len(gold)-tp
 precision=tp/len(gold) if gold else 0
 proposals=sum(not r['expected'] and rule(r) for r in rows)
 results[name]=dict(true_positives=tp,false_positives=fp,precision=precision,proposed_unresolved_tokens=proposals,
  gate_passed=precision>=.98 and len(gold)>=100,
  regressions=[r for r in gold if r['got']!=r['expected'].split('/')[-1]])
# Increasing the score threshold cannot repair insufficient coverage; quantify it.
for threshold in [.90,.94,.98]:
 for semantic in [False,True]:
  gold=[r for r in rows if r['expected'] and r['auto'] and r['score']>=threshold and (not semantic or r['support'])]
  tp=sum(r['got']==r['expected'].split('/')[-1] for r in gold);fp=len(gold)-tp
  precision=tp/len(gold) if gold else 0
  results[f"threshold_{threshold}_semantic_{semantic}"]=dict(true_positives=tp,false_positives=fp,precision=precision,
   proposed_unresolved_tokens=sum(not r['expected'] and r['auto'] and r['score']>=threshold and (not semantic or r['support']) for r in rows),
   gate_passed=precision>=.98 and len(gold)>=100)
report=dict(schema_version=1,gate_threshold=.98,minimum_reviewed_acceptances=100,unresolved_tokens=sum(not r['expected'] for r in rows),
 target=2000,applied_mappings=0,experiments=results,
 limitation="Exploratory measurements on reviewed overrides, not independent linguistic accuracy. No experiment authorizes application; thresholds are not weakened.",
 next_method="Pointed, part-of-speech-aware paradigms plus independently reviewed custom vocabulary; validate on a held-out image-reviewed set and prefix composition before any write.")
output=ROOT/'data/hutter/review_reports'/('morphology_experiments_legacy.json' if args.legacy_parses else 'morphology_experiments.json')
output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:{a:b for a,b in v.items() if a!='regressions'} for k,v in results.items()},indent=2))
