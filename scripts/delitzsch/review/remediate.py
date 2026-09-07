"""Deterministic, conservative corpus remediation with immutable before/after evidence.

plan: detect every token, stage narrow grammar repairs and literal WO placeholders.
apply: prevalidate every before state, then write; repeat application is a no-op.
check: verify the planned final corpus and publication invariants.
"""
from __future__ import annotations
import argparse
import copy
import gzip
import hashlib
import json
import re
import sys
import io
import subprocess
import tarfile
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from scripts.delitzsch.review.workflow import LexiconIndex, load_latest_decisions, _refresh_verse_prefix_separators

PARSED = ROOT / "data/delitzsch_parsed"
REPORTS = ROOT / "data/delitzsch_review/reports"
PREFIXES = {"Hb", "Hl", "Hk", "Hc", "Hd", "Hm"}
# Fully pointed forms only. בי is deliberately excluded: H994 is a real homograph.
GRAMMAR = {"בּוֹ": "D0208", "בוֹ": "D0208", "לִי": "D0265", "לוֹ": "D0266", "בָּהּ": "D0271", "בָּהֶם": "D0277"}


def pointed(text):
    return "".join(c for c in unicodedata.normalize("NFD", text) if "\u05d0" <= c <= "\u05ea" or "\u05b0" <= c <= "\u05bd" or c in "\u05c1\u05c2\u05c7")

GRAMMAR = {pointed(k): v for k, v in GRAMMAR.items()}


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def load_corpus(base=PARSED):
    return {str(p.relative_to(base)): json.loads(p.read_text()) for p in sorted(base.glob("*/*.json")) if p.stem.isdigit() and isinstance(json.loads(p.read_text()), (list, dict))}


def chapter(payload):
    return payload[0] if isinstance(payload, list) else payload


def words(corpus):
    for path, payload in corpus.items():
        book = path.split("/")[0]
        for verse in chapter(payload)["verses"]:
            for i, word in enumerate(verse["words"]):
                key = f"{book}.{chapter(payload)['chapter']}.{verse['verse']}.{i}"
                yield path, verse, i, word, key


def metrics(corpus):
    total = mapped = hebrew = lexical_unresolved = verses = 0
    scripture = []
    books = set()
    for path, payload in corpus.items():
        books.add(path.split("/")[0]); verses += len(chapter(payload)["verses"])
    for _, _, _, word, _ in words(corpus):
        total += 1; mapped += bool(word.get("strong"))
        scripture.append(pointed(word["text"]))
        is_hebrew = bool(re.search(r"[א-ת]", word["text"]))
        hebrew += is_hebrew
        lexical_unresolved += is_hebrew and not word.get("strong")
    return dict(books=len(books), verses=verses, tokens=total, mapped=mapped, unresolved=total-mapped, hebrew_tokens=hebrew,
                hebrew_unresolved=lexical_unresolved, mapped_percent=round(100*mapped/total,6) if total else 0,
                hebrew_character_sha256=hashlib.sha256("".join(scripture).encode()).hexdigest())


def publication_errors(corpus, lexicon):
    errors = []
    for _, _, _, word, key in words(corpus):
        strong = word.get("strong")
        if not re.search(r"[א-ת]", word["text"]): errors.append([key,"non_hebrew_placeholder"])
        if strong and (not isinstance(strong,str) or not re.fullmatch(r"(?:H[bclkdm]/)*[HD]\d+", strong) or not lexicon.get(strong)):
            errors.append([key,"invalid_lexical_reference"])
        if strong and word.get("mapping_review",{}).get("status") == "needs_review": errors.append([key,"unreviewed_candidate_published"])
    return errors


def legacy_assignment_audit(corpus, directory=None):
    directory = directory or PARSED / "strongs/v2"
    positions = defaultdict(list)
    for path, _, index, word, key in words(corpus):
        positions[(path.split("/")[0], chapter(corpus[path])["chapter"], index, pointed(word["text"]))].append(key)
    queue = []
    for path in sorted(directory.glob("*.json")):
        data = json.loads(path.read_text())
        for ch in data.get("chapters", []):
            for assignment in ch.get("assignments", []):
                if assignment.get("verse") is not None: continue
                queue.append(dict(book=path.stem, chapter=ch["chapter"], word_index=assignment["word_index"], text=assignment.get("text", ""),
                    candidate=assignment.get("strong"), outcome=assignment.get("type"), confidence=0,
                    matching_locations=positions.get((path.stem,ch["chapter"],assignment["word_index"],pointed(assignment.get("text",""))), []),
                    reason="Historical output lost verse identity and confidence; never auto-apply. Regenerate analysis from current parsed data."))
    return queue


def build_plan(corpus, lexicon, decisions, include_legacy=False):
    after = copy.deepcopy(corpus)
    changes = []
    for path, payload in after.items():
        obj = chapter(payload)
        kept = []
        for verse in obj["verses"]:
            # These literal non-Hebrew sentinels contain no scripture letters.
            # Retain their entire payload in the ledger rather than inventing text.
            if verse.get("hebrew","").strip() == "WO" and len(verse.get("words",[])) == 1 and verse["words"][0].get("text") == "WO":
                changes.append(dict(kind="placeholder_removed", location=f"{path.split('/')[0]}.{obj['chapter']}.{verse['verse']}", before=copy.deepcopy(verse), after=None,
                    evidence="Literal WO-only placeholder; no Hebrew text to publish. Adjacent verse and full original payload retained in the source/ledger."))
            else:
                if len(verse.get("words", [])) > 1 and re.fullmatch(r"[׃־.,!?;:]+", verse["words"][-1].get("text", "")):
                    before = copy.deepcopy(verse)
                    punctuation = verse["words"].pop()
                    verse["words"][-1]["text"] += punctuation["text"]
                    changes.append(dict(kind="punctuation_rejoined", location=f"{path.split('/')[0]}.{obj['chapter']}.{verse['verse']}", before=before, after=copy.deepcopy(verse),
                        evidence="Standalone punctuation had a lexical Strong; join it to the preceding token without changing scripture letters or the verse display text."))
                kept.append(verse)
        obj["verses"] = kept
    for path, verse, index, word, key in words(after):
        before = copy.deepcopy(word)
        target = GRAMMAR.get(pointed(word["text"]))
        prior = decisions.get(key,{})
        if key == "acts.9.39.12" and word["text"] == "בּוֹכִיּוֹת" and word.get("strong") is None:
            word["strong"] = "H1058"; word["prefixes"] = []
            evidence = "בּוֹכִיּוֹת is the feminine plural participle of בכה, agreeing with האלמנות; bet belongs to the root, not the preposition. H1058 BDB: weep/bewail. data/delitzsch/acts.json 9:39 corroborates the intact pointed token."
            method = "context_review_bkh_feminine_plural"
            _refresh_verse_prefix_separators(chapter(after[path])["verses"], {"verse":verse["verse"]})
        elif target and word.get("strong") != target and not word.get("possible_proper_name") and prior.get("status") not in {"applied","already_applied","skipped"}:
            if not lexicon.get(target): raise ValueError(f"Missing reviewed grammatical entry {target}")
            word["strong"] = target
            evidence = f"Fully pointed inseparable-preposition/pronominal form, exact rule; existing reviewed custom entry {target} supplies bilingual grammar definition. No consonant-only or position fallback."
            method = "pointed_grammatical_form_v1"
        else: continue
        word["mapping_review"] = dict(status="accepted", method=method, confidence=.99)
        changes.append(dict(kind="mapping", location=key, before=before, after=copy.deepcopy(word), evidence=evidence))
    queue = []
    for path, verse, index, word, key in words(after):
        strong = word.get("strong")
        reasons = []
        if not strong: reasons.append("unresolved")
        if strong and not strong.startswith("D") and strong.split("/")[:-1] != word.get("prefixes",[]): reasons.append("prefix_metadata_disagreement")
        # Legacy assignment is not a measured confidence claim. Preserve pointers
        # to prior review and explicitly queue lexical plausibility for follow-up.
        entry = lexicon.get(strong) if strong else None
        if entry:
            form = set(re.findall(r"[א-ת]", word["text"]))
            lemma = set(re.findall(r"[א-ת]", entry.get("lemma", entry.get("hebrew",""))))
            if len(form)>=4 and len(lemma)>=3 and len(form & lemma)<=1: reasons.append("lexical_plausibility")
        if reasons:
            queue.append(dict(location=key, book=path.split('/')[0],chapter=chapter(after[path])["chapter"],verse=verse["verse"],word_index=index,text=word["text"],strong=strong,
                reasons=reasons, confidence=0, prior_review_status=decisions.get(key,{}).get("status"), evidence=f"data/delitzsch_parsed/{path}; heuristic only, no automatic lexical change"))
    files = {path:{"before_sha256":digest(corpus[path]),"after_sha256":digest(payload),"after":payload} for path,payload in after.items() if payload != corpus[path]}
    errors = publication_errors(after,lexicon)
    return dict(schema_version=1,method="besorah_remediation_v1",baseline=metrics(corpus),final=metrics(after),changes=changes,files=files,
        legacy_assignment_review=legacy_assignment_audit(corpus) if include_legacy else [],
        corpus_after_sha256=digest(after),quality_gate=dict(passed=not errors,errors=errors),review_queue=queue)


def apply_plan(plan, base=PARSED):
    if not plan["quality_gate"]["passed"]: raise ValueError("Publication gate failed")
    staged = []
    for path, item in plan["files"].items():
        target = base / path
        if not target.resolve().is_relative_to(base.resolve()): raise ValueError("Invalid plan path")
        current = json.loads(target.read_text())
        if digest(item["after"]) != item["after_sha256"]: raise ValueError("Corrupt planned payload")
        if digest(current) == item["after_sha256"]: continue
        if digest(current) != item["before_sha256"]: raise ValueError(f"Stale source: {path}")
        staged.append((target,item["after"]))
    for path,payload in staged: path.write_bytes(encoded(payload))
    return len(staged)


def sync_custom_instances(plan, target=None):
    target = target or ROOT / "data/dict/lexicon/custom_definitions.json"
    entries = json.loads(target.read_text())
    added = 0
    for change in plan["changes"]:
        if change["kind"] != "mapping" or not change["after"]["strong"].startswith("D"): continue
        key = change["after"]["strong"]
        book, ch, verse, index = change["location"].split(".")
        record = dict(book=book, chapter=int(ch), verse=int(verse), word_index=int(index), text=change["after"]["text"])
        records = entries[key].setdefault("nt_instances", [])
        identity = lambda item: (item.get("book"),item.get("chapter"),item.get("verse"),item.get("word_index"))
        if not any(identity(item) == identity(record) for item in records):
            records.append(record); added += 1
    if added: target.write_bytes(encoded(entries))
    return added


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command",choices=["plan","apply","check"])
    parser.add_argument("--plan",type=Path,default=REPORTS/"besorah_remediation_v1.json.gz")
    parser.add_argument("--baseline-ref", help="Reproduce a plan from a local Git revision")
    args=parser.parse_args()
    lexicon=LexiconIndex(ROOT/"data/dict/lexicon/words")
    if args.command=="plan":
        corpus = load_corpus()
        if args.baseline_ref:
            archive = subprocess.check_output(["git", "archive", args.baseline_ref, "data/delitzsch_parsed"], cwd=ROOT)
            with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
                corpus = {str(Path(m.name).relative_to("data/delitzsch_parsed")):json.load(tar.extractfile(m)) for m in tar.getmembers()
                    if m.isfile() and len(Path(m.name).parts)==4 and Path(m.name).stem.isdigit() and m.name.endswith(".json")}
            corpus = dict(sorted(corpus.items()))
        plan=build_plan(corpus,lexicon,load_latest_decisions(ROOT/"data/delitzsch_review/decisions"),include_legacy=True)
        args.plan.parent.mkdir(parents=True,exist_ok=True)
        args.plan.write_bytes(gzip.compress(encoded(plan),mtime=0))
        print(json.dumps({k:plan[k] for k in ['baseline','final','quality_gate']},indent=2));print('changes',len(plan['changes']),'review',len(plan['review_queue']))
        if not plan['quality_gate']['passed']: raise SystemExit(2)
    else:
        plan=json.loads(gzip.decompress(args.plan.read_bytes()))
        if args.command=="apply": print('files_changed',apply_plan(plan))
        corpus=load_corpus()
        errors=publication_errors(corpus,lexicon)
        if errors or digest(corpus)!=plan['corpus_after_sha256']: raise SystemExit('Corpus does not match validated plan')
        if args.command=="apply": print('custom_instances_added',sync_custom_instances(plan))
        print(json.dumps(metrics(corpus),indent=2))

if __name__=="__main__": main()
