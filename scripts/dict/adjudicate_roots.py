"""Lexicon root_ref adjudication pipeline.

Deterministic, script-first review of Hebrew lexicon root assignments.  The
pipeline audits ``data/dict/lexicon/words.json`` (every non-root entry and its
``root_ref``), scores each link with explainable heuristics, proposes keep /
change / reject actions, and separates lower-confidence decisions into a human
review queue.  Nothing is mutated on the lexicon until ``--apply`` is run on an
accepted set of decisions.

Confidence is deterministic: the same inputs always produce the same report (no
wall-clock timestamps, no randomness).  An optional ``ai_recommender`` callable
may be supplied to refine proposals, but the report stays deterministic when it
is absent.
"""

from __future__ import annotations

import argparse
import json
import hashlib
import sys
import unicodedata
from collections import Counter
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable
import re

# scripts/dict/adjudicate_roots.py -> project root (3 parents up).
PROJECT_ROOT = Path(__file__).parent.parent.parent
WORDS_PATH = PROJECT_ROOT / "data" / "dict" / "lexicon" / "words.json"
ROOTS_PATH = PROJECT_ROOT / "data" / "dict" / "lexicon" / "roots.json"
REPORT_DIR = PROJECT_ROOT / "data" / "dict" / "lexicon" / "adjudication"

HEBREW_LETTERS = set(range(0x05D0, 0x05EB))
FINAL_TO_REGULAR = {"ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ"}
STRONG_RE = re.compile(r"[HGD](\d+)")


def normalize_hebrew(value: str) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFD", str(value))
    return "".join(
        FINAL_TO_REGULAR.get(char, char)
        for char in normalized
        if ord(char) in HEBREW_LETTERS
    )


def morph_similarity(a: str, b: str) -> float:
    """Orthographic similarity tolerant of derivation affixes.

    Returns 1.0 for identical (or exactly-affixed) forms and near 0.0 for
    unrelated stems.  Combines LCS ratio with a bonus when both surfaces share a
    derivational prefix core.
    """
    norm_a = normalize_hebrew(a)
    norm_b = normalize_hebrew(b)
    if not norm_a or not norm_b:
        return 0.0
    if norm_a == norm_b:
        return 1.0
    shorter, longer = sorted((norm_a, norm_b), key=len)
    ratio = SequenceMatcher(None, shorter, longer).ratio()
    core_bonus = 0.12 if norm_a[:2] == norm_b[:2] else 0.0
    return min(1.0, ratio + core_bonus)


def load_pair(
    words_path: Path = WORDS_PATH,
    roots_path: Path = ROOTS_PATH,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    words = json.loads(words_path.read_text(encoding="utf-8"))
    roots = json.loads(roots_path.read_text(encoding="utf-8"))
    return words, roots


def _upper_key(value: str) -> str:
    m = STRONG_RE.match(str(value))
    if m:
        return str(value).upper()
    return f"H{value}".upper()


def _entry_key(entry: dict[str, Any], fallback: str) -> str:
    return _upper_key(entry.get("strong_number") or fallback)


def build_root_index(roots: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for key, entry in roots.items():
        index[_entry_key(entry, key)] = entry
    return index


@dataclass
class Adjudication:
    strong: str
    lemma: str
    normalized: str
    current_root_ref: str
    root_lemma: str
    similarity: float
    proposal: str  # keep | change | reject
    proposed_root_ref: str | None
    confidence: float
    reason: str
    review_status: str  # auto_accepted | review


def audit(
    words: dict[str, dict[str, Any]],
    roots: dict[str, dict[str, Any]],
    *,
    keep_threshold: float = 0.5,
    ai_recommender: Callable[[Adjudication], Adjudication] | None = None,
) -> list[Adjudication]:
    """Adjudicate every non-root entry's ``root_ref``."""
    root_index = build_root_index(roots)

    # Precompute normalized root lemmas once (called thousands of times below).
    root_lemmas = {
        key: (normalize_hebrew(str((entry or {}).get("lemma") or "")), entry)
        for key, entry in root_index.items()
    }

    # Population per root, to avoid recommending over-used roots.
    child_counts: Counter[str] = Counter()
    for entry in words.values():
        rr = entry.get("root_ref")
        if rr:
            child_counts[_upper_key(rr)] += 1

    results: list[Adjudication] = []
    for strong_key, entry in sorted(words.items()):
        if entry.get("is_root"):
            continue
        strong = _entry_key(entry, strong_key)
        current_root_ref = str(entry.get("root_ref") or "").upper()
        lemma = str(entry.get("lemma") or "")
        normalized = str(entry.get("normalized") or normalize_hebrew(lemma))

        if not current_root_ref:
            results.append(
                Adjudication(
                    strong=strong,
                    lemma=lemma,
                    normalized=normalized,
                    current_root_ref="",
                    root_lemma="",
                    similarity=0.0,
                    proposal="reject",
                    proposed_root_ref=None,
                    confidence=0.0,
                    reason="Non-root entry has no root_ref assigned.",
                    review_status="review",
                )
            )
            continue

        root_lemma = str((root_index.get(current_root_ref) or {}).get("lemma") or "")
        similarity = morph_similarity(normalized, root_lemma)

        if similarity >= keep_threshold:
            confidence = similarity
            reason = (
                f"Morphological and lexical evidence stays aligned with the "
                f"current derivation {current_root_ref} (similarity={similarity:.2f})."
            )
            proposal = "keep"
            proposed = current_root_ref
            review_status = "review"  # Similarity alone never authorizes a semantic decision.
        else:
            # Propose a closer root among those sharing the entry's first letter,
            # skipping already over-populated roots.  Limited to the putatively
            # related bucket to keep the audit O(n) in practice.
            candidate: str | None = None
            candidate_sim = similarity
            first_letter = normalized[:1] if normalized else ""
            for rkey, (rnorm, root_entry) in root_lemmas.items():
                if not rnorm or rnorm[:1] != first_letter:
                    continue
                if child_counts[_upper_key(rkey)] >= 15:
                    continue
                sim = morph_similarity(normalized, rnorm)
                if sim > candidate_sim:
                    candidate_sim = sim
                    candidate = _upper_key(rkey)
            if candidate:
                proposal = "change"
                proposed = candidate
                confidence = candidate_sim
                reason = (
                    f"Low agreement with current root {current_root_ref} "
                    f"(similarity={similarity:.2f}); closer root {candidate} "
                    f"(similarity={candidate_sim:.2f}) proposed."
                )
            else:
                proposal = "review"
                proposed = None
                confidence = similarity
                reason = (
                    f"Low agreement with current root {current_root_ref} "
                    f"(similarity={similarity:.2f}); no clearly better root found."
                )
            review_status = "review"

        adjud = Adjudication(
            strong=strong,
            lemma=lemma,
            normalized=normalized,
            current_root_ref=current_root_ref,
            root_lemma=root_lemma,
            similarity=similarity,
            proposal=proposal,
            proposed_root_ref=proposed,
            confidence=confidence,
            reason=reason,
            review_status=review_status,
        )

        if ai_recommender is not None:
            adjud = ai_recommender(adjud)
            adjud.review_status = "review"  # AI confidence alone is not lexical evidence.

        results.append(adjud)

    return results

def audit_summary(adjudications: list[Adjudication]) -> dict[str, Any]:
    by_proposal: dict[str, int] = {}
    by_status: dict[str, int] = {}
    for item in adjudications:
        by_proposal[item.proposal] = by_proposal.get(item.proposal, 0) + 1
        by_status[item.review_status] = by_status.get(item.review_status, 0) + 1
    return {
        "total": len(adjudications),
        "by_proposal": dict(sorted(by_proposal.items())),
        "by_review_status": dict(sorted(by_status.items())),
    }


def write_report(
    adjudications: list[Adjudication],
    output_path: Path,
    metadata: dict[str, Any] | None = None,
) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "summary": audit_summary(adjudications),
        "metadata": metadata or {},
        "entries": [asdict(item) for item in adjudications],
    }
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return output_path


def build_review_queue(adjudications: list[Adjudication]) -> list[dict[str, Any]]:
    return [
        {
            "strong": item.strong,
            "lemma": item.lemma,
            "current_root_ref": item.current_root_ref,
            "proposed_root_ref": item.proposed_root_ref,
            "similarity": round(item.similarity, 3),
            "reason": item.reason,
        }
        for item in adjudications
        if item.review_status == "review"
    ]


def apply_decisions(adjudications: list[Adjudication]) -> int:
    """Validate the complete plan, then update sources and consolidated output."""
    words = json.loads(WORDS_PATH.read_text(encoding="utf-8"))
    roots = json.loads(ROOTS_PATH.read_text(encoding="utf-8"))
    pending = {}
    applied = 0
    for item in adjudications:
        if item.review_status != "auto_accepted" or item.proposal == "keep":
            continue
        entry = words.get(item.strong)
        if entry is None:
            raise ValueError(f"Missing entry {item.strong}")
        if item.proposal == "change" and item.proposed_root_ref not in roots:
            raise ValueError(f"Missing canonical root {item.proposed_root_ref}")
        target = item.proposed_root_ref if item.proposal == "change" else None
        if entry.get("root_ref") == target:
            continue
        if (entry.get("root_ref") or "") != item.current_root_ref:
            raise ValueError(f"Stale adjudication for {item.strong}")
        if target:
            entry["root_ref"] = target
        else:
            entry.pop("root_ref", None)
        source_path = WORDS_PATH.parent / "words" / (item.strong + ".json")
        if source_path.exists():
            source = json.loads(source_path.read_text())
            if (source.get("root_ref") or "") != item.current_root_ref:
                raise ValueError(f"Stale source adjudication for {item.strong}")
            if target:
                source["root_ref"] = target
            else:
                source.pop("root_ref", None)
            pending[source_path] = source
        applied += 1
    if applied:
        pending[WORDS_PATH] = words
        for path, payload in pending.items():
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    return applied


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--report",
        type=str,
        default=None,
        help="Output report JSON path (default data/dict/lexicon/adjudication/root_adjudication.json).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply auto_accepted decisions to words.json.",
    )
    parser.add_argument(
        "--keep-threshold",
        type=float,
        default=0.5,
        help="Similarity above which a link is kept (default 0.5).",
    )
    args = parser.parse_args()

    words, roots = load_pair()
    raw_path = PROJECT_ROOT / "data/dict/raw/strongs_hebrew_dict_en.json"
    raw = json.loads(raw_path.read_text())
    adjudications = audit_from_derivations(words, roots, raw)
    summary = audit_summary(adjudications)
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    report_path = Path(args.report) if args.report else REPORT_DIR / "root_adjudication.json"
    used = {item.proposed_root_ref or item.current_root_ref for item in adjudications}
    write_report(adjudications, report_path, metadata={
        "method": "unique_cited_derivation_v1", "source": str(raw_path.relative_to(PROJECT_ROOT)),
        "source_sha256": hashlib.sha256(raw_path.read_bytes()).hexdigest(),
        "missing_targets_before": sum(bool(x.current_root_ref) and x.current_root_ref not in roots for x in adjudications),
        "orphan_roots": [{"strong": key, "reason": "Canonical primitive lexeme retained independently of whether this source provides an unambiguous derived child."} for key in sorted(set(roots) - used)]})
    print(f"Report written to {report_path}")

    if args.apply:
        applied = apply_source_adjudications(adjudications, words, roots)
        print(f"Updated {applied} entries with accepted links or explicit unresolved metadata in {WORDS_PATH} and individual sources.")
        print("WARNING: re-run the lexicon build and validator after applying changes.")
    return 0




def audit_from_derivations(words, roots, derivations):
    """Adjudicate from cited lexical derivations, never nearest spelling alone.

    Compound, uncertain, missing and cyclic chains remain explicitly unresolved.
    A unique unqualified chain can terminate only at an existing canonical root.
    """
    results = []
    for strong, entry in sorted(words.items()):
        if entry.get("is_root"):
            continue
        current = str(entry.get("root_adjudication", {}).get("original_root_ref", entry.get("root_ref")) or "")
        node, seen, evidence, target, reason = strong, set(), [], None, ""
        while node not in seen:
            seen.add(node)
            if node != strong and node in roots:
                target = node
                break
            source = derivations.get(node, {}).get("derivation", "")
            evidence.append({"strong": node, "derivation": source})
            refs = sorted(set(re.findall(r"\bH\d+\b", source)))
            if re.search(r"perhaps|probably|uncertain|apparently|doubtful|unused|foreign", source, re.I):
                reason = "Source explicitly qualifies or leaves the derivation uncertain."
                break
            if len(refs) != 1:
                reason = "No unique cited derivation: missing, compound or alternative roots."
                break
            node = refs[0]
        else:
            reason = "Cyclic derivation references require review."
        proposal = "keep" if target == current else "change" if target else "review"
        results.append(Adjudication(strong, entry.get("lemma", ""), normalize_hebrew(entry.get("lemma", "")), current,
            roots.get(target or current, {}).get("lemma", ""), 0.0, proposal, target, 0.99 if target else 0.0,
            json.dumps({"method": "unique_cited_derivation_v1", "conclusion": "Unique source-supported chain to existing root." if target else reason,
                        "evidence": evidence}, ensure_ascii=False, sort_keys=True), "auto_accepted" if target else "review"))
    return results


def apply_source_adjudications(decisions, words, roots):
    """Persist canonical links or explicit unresolved status, preserving evidence."""
    pending = {}
    changed = 0
    for decision in decisions:
        entry = words[decision.strong]
        before = json.dumps(entry, ensure_ascii=False, sort_keys=True)
        target = decision.proposed_root_ref
        if target and target not in roots:
            raise ValueError(f"Nonexistent canonical root {target}")
        metadata = {"method": "unique_cited_derivation_v1", "status": "accepted" if target else "unresolved", "confidence": decision.confidence, "original_root_ref": decision.current_root_ref}
        if target:
            entry["root_ref"] = target
        elif entry.get("root_ref") not in roots:
            entry.pop("root_ref", None)
        entry["root_adjudication"] = metadata
        source_path = WORDS_PATH.parent / "words" / (decision.strong + ".json")
        if source_path.exists():
            source = json.loads(source_path.read_text())
            if target:
                source["root_ref"] = target
            elif source.get("root_ref") not in roots:
                source.pop("root_ref", None)
            source["root_adjudication"] = metadata
            pending[source_path] = source
        changed += before != json.dumps(entry, ensure_ascii=False, sort_keys=True)
    if any(entry.get("root_ref") and entry["root_ref"] not in roots for entry in words.values()):
        raise ValueError("Missing root targets remain; no writes performed")
    pending[WORDS_PATH] = words
    for path, payload in pending.items():
        serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        if path.read_text() != serialized:
            path.write_text(serialized)
    return changed


if __name__ == "__main__":
    raise SystemExit(main())
