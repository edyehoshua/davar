"""Release audit for image-confirmed Hutter repairs; run from repository root after static generation."""
import json,hashlib,subprocess,tempfile,gzip,sys
from pathlib import Path
sys.path.insert(0,str(Path.cwd()))
from scripts.hutter.audit_transcription import audit,write,ROOT
base='2fdb23cad'
with tempfile.TemporaryDirectory(prefix='davar-hutter-baseline-',dir='/tmp') as td:
 t=Path(td);h=t/'data/hutter';(h/'staging/output').mkdir(parents=True)
 for name in ['strong_mappings','manifests','api_results_gpt55']:(h/name).symlink_to(ROOT/'data/hutter'/name,target_is_directory=True)
 (h/'staging/data').symlink_to(ROOT/'data/hutter/staging/data',target_is_directory=True)
 for f in (ROOT/'data/hutter/strong_mappings').glob('*.json'):
  path='data/hutter/staging/output/'+f.name
  (t/path).write_bytes(subprocess.check_output(['git','show',base+':'+path]))
 before=audit(t)
after=audit()
ledger=json.load(open('data/hutter/transcription_corrections.json'))
old=json.loads(subprocess.check_output(['git','show',base+':data/hutter/review_reports/strong_mapping_report.json']))
new=json.load(open('data/hutter/review_reports/strong_mapping_report.json'))
bundle=json.load(open('web/public/data/bundles/hutter.json'))
for row in ledger['corrections']:
 b,c,v=row['book'],row['chapter'],row['verse']
 mapping=json.load(open(f'data/hutter/strong_mappings/{b}.json'))
 mv=next(vv for cc in mapping['chapters'] if cc['chapter']==c for vv in cc['verses'] if vv['verse']==v)
 assert mv['hebrew']==row['after'],(b,c,v,'mapping')
 web=json.load(open(f'web/public/data/hutter/{b}/{c}.json'))
 wv=next(vv for vv in web if vv['verse']==v)
 assert wv['hebrew']==row['after'],(b,c,v,'web')
 bv=next(vv for vv in bundle['books'][b]['chapters'][str(c)] if vv['verse']==v)
 assert bv==wv,(b,c,v,'offline')
# No transcription changes beyond the explicitly reviewed ledger.
allowed={(r['book'],r['chapter'],r['verse']) for r in ledger['corrections']}
for f in (ROOT/'data/hutter/strong_mappings').glob('*.json'):
 path='data/hutter/staging/output/'+f.name
 a=json.loads(subprocess.check_output(['git','show',base+':'+path]));b=json.load(open(path))
 for ca,cb in zip(a['chapters'],b['chapters'],strict=True):
  for va,vb in zip(ca['verses'],cb['verses'],strict=True):
   if va!=vb:assert (f.stem,ca['number'],va['number']) in allowed
summary={'baseline_ref':base,'books_image_reviewed':len(ledger['representative_reviews']),'image_confirmed_corrected_verses':len(ledger['corrections']),'crop_pages_corrected':4,'before':{k:before[k] for k in ['totals','finding_counts']},'after':{k:after[k] for k in ['totals','finding_counts']},'mapping_before':old['totals'],'mapping_after':new['totals'],'static_and_offline_verified_verses':len(ledger['corrections']),'transcription_accuracy':'Not measured: samples are selected for review and are not a representative gold corpus.'}
write(Path('data/hutter/review_reports/transcription_summary.json'),summary)
print(json.dumps(summary,ensure_ascii=False,indent=2))
