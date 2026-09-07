#!/usr/bin/env python3
"""
Script to merge Strong's numbers from v2 analysis files into the original verse data.

This script reads the v2 JSON files (which contain successful strong number assignments)
and updates the original verse data files with those strong numbers.

Usage:
    python scripts/delitzsch/strongs/v2/merge_strongs.py [--book BOOK_NAME] [--dry-run]
"""

import json
import argparse
import logging
import sys
import hashlib
import math
import re
import unicodedata
from pathlib import Path
from typing import Dict, List, Any, Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Paths - use absolute path from the project root
# File: scripts/delitzsch/strongs/v2/merge_strongs.py
# parent chain: v2 -> strong/s -> delitzsch -> scripts -> project_root
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
PARSED_DIR = DATA_DIR / "delitzsch_parsed"
V2_DIR = PARSED_DIR / "strongs" / "v2"
REPORT_DIR = DATA_DIR / "delitzsch_review" / "reports"

# All 27 NT books
ALL_BOOKS = [
    'matthew', 'mark', 'luke', 'john', 'acts',
    'romans', 'corinthians1', 'corinthians2', 'galatians',
    'ephesians', 'philippians', 'colossians', 'thessalonians1',
    'thessalonians2', 'timothy1', 'timothy2', 'titus',
    'philemon', 'hebrews', 'james', 'peter1', 'peter2',
    'john1', 'john2', 'john3', 'jude', 'revelation'
]


def load_v2_strongs(book_name: str) -> Optional[Dict[str, Any]]:
    """Load the v2 strongs file for a book."""
    v2_file = V2_DIR / f"{book_name}.json"
    if not v2_file.exists():
        logger.warning(f"V2 file not found: {v2_file}")
        return None
    
    with open(v2_file, 'r', encoding='utf-8') as f:
        return json.load(f)


def create_assignment_map(v2_data: Dict[str, Any]) -> Dict[int, Dict[tuple, Dict[str, Any]]]:
    """Never collapse verse-local word indexes or silently accept old identity-less output."""
    result = {}
    for chapter in v2_data.get("chapters", []):
        assignments = result.setdefault(chapter["chapter"], {})
        for assignment in chapter.get("assignments", []):
            if not isinstance(assignment.get("verse"), int) or assignment["verse"] < 1:
                raise ValueError("Legacy assignment has no verse identity; regenerate v2 output before merging")
            key = (assignment["verse"], assignment["word_index"])
            if key in assignments:
                raise ValueError(f"Duplicate assignment identity: {chapter['chapter']}:{key}")
            assignments[key] = dict(assignment)
    return result


def compose_strong(strong: Optional[str], prefixes: Optional[List[str]]) -> Optional[str]:
    """Compose validated prefix codes exactly once; reject conflicting composite inputs."""
    if not strong:
        return None
    codes = [code for code in (prefixes or []) if code]
    if any(code not in {"Hb", "Hl", "Hk", "Hc", "Hd", "Hm"} for code in codes):
        raise ValueError("Invalid prefix code")
    bits = strong.split("/")
    if not re.fullmatch(r"[HD][0-9]+", bits[-1]):
        raise ValueError("Invalid lexical reference")
    if len(bits) > 1 and bits[:-1] != codes:
        raise ValueError("Conflicting prefix composition")
    return "/".join(codes + [bits[-1]])


def merge_strongs_for_book(book_name: str, dry_run: bool = False) -> Dict[str, int]:
    """Stage a whole book before writing. Low confidence clears stale candidates, never publishes them."""
    stats = dict(updated=0, skipped=0, failed=0, chapters_processed=0, books_processed=1)
    data = load_v2_strongs(book_name)
    if not data:
        stats["failed"] = 1
        return stats
    assignments = create_assignment_map(data)
    staged = []
    for chapter, mapping in assignments.items():
        path = PARSED_DIR / book_name / f"{chapter}.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        verses = (payload[0] if isinstance(payload, list) else payload)["verses"]
        words = {(v["verse"], i): w for v in verses for i, w in enumerate(v["words"])}
        for key, assignment in mapping.items():
            word = words.get(key)
            if word is None or unicodedata.normalize("NFC", word["text"]) != unicodedata.normalize("NFC", assignment.get("text", "")):
                raise ValueError(f"Stale assignment text/identity: {book_name}.{chapter}.{key}")
            if "previous_strong" not in assignment:
                raise ValueError("Assignment lacks prior-state evidence; regenerate before merging")
            confidence = assignment.get("confidence", 0)
            accepted = (assignment.get("type") == "strong" and isinstance(confidence, (int, float))
                        and math.isfinite(confidence) and .98 <= confidence <= 1)
            desired = compose_strong(assignment.get("strong"), assignment.get("prefixes")) if accepted else None
            if word.get("strong") not in (assignment["previous_strong"], desired):
                raise ValueError(f"Mapping changed since analysis: {book_name}.{chapter}.{key}")
            if word.get("strong") != desired:
                word["strong"] = desired
                stats["updated"] += 1
            if desired:
                word["prefixes"] = [code for code in (assignment.get("prefixes") or []) if code]
            status = "accepted" if desired else "needs_review"
            word["mapping_review"] = {"status": status, "method": "v2_confidence_gate", "confidence": confidence if isinstance(confidence, (int,float)) and math.isfinite(confidence) else 0,
                "candidate": assignment.get("strong"), "reason": assignment.get("reason", assignment.get("type", "unknown"))}
            if not accepted:
                stats["skipped"] += 1
        staged.append((path, payload))
        stats["chapters_processed"] += 1
    if not dry_run:
        for path, payload in staged:
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    return stats


def run_post_merge_validation(books: List[str]) -> Dict[str, Any]:
    """
    Validate merged verse data with the existing ``scan_issues`` review gate.

    Reuses the shared Delitzsch review workflow so the merge step reports the
    same quality signals (null Strongs, suspicious assignments) that the review
    pipeline itself uses. This is the "quality gate" that must pass before
    refreshed Besorah mappings are considered shippable.

    Returns:
        A deterministic summary keyed by issue type, with per-book counts.
    """
    sys.path.insert(0, str(PROJECT_ROOT))
    try:
        from scripts.delitzsch.review.workflow import LexiconIndex, scan_issues
    except ImportError as exc:  # pragma: no cover - defensive
        logger.error(f"Could not import review workflow for validation: {exc}")
        return {"error": "import_failed"}

    lexicon = LexiconIndex(DATA_DIR / "dict" / "lexicon" / "words")
    issues = scan_issues(PARSED_DIR, lexicon, books=books or None)

    by_type: Dict[str, int] = {}
    by_book: Dict[str, Dict[str, int]] = {}
    for issue in issues:
        by_type[issue.issue_type] = by_type.get(issue.issue_type, 0) + 1
        book_counts = by_book.setdefault(issue.occurrence.book, {})
        book_counts[issue.issue_type] = book_counts.get(issue.issue_type, 0) + 1

    from scripts.delitzsch.review.remediate import load_corpus, publication_errors
    corpus = {path: value for path, value in load_corpus(PARSED_DIR).items() if not books or path.split("/")[0] in books}
    errors = publication_errors(corpus, lexicon)
    return {
        "passed": not errors,
        "publication_errors": errors,
        "total_issues": len(issues),
        "by_type": dict(sorted(by_type.items())),
        "by_book": {book: dict(sorted(counts.items())) for book, counts in sorted(by_book.items())},
    }


def _report_payload(
    total_stats: Dict[str, int],
    validation: Dict[str, Any],
    books: List[str],
    dry_run: bool,
) -> Dict[str, Any]:
    """
    Build a deterministic report payload independent of clock/ordering.

    The report is intentionally free of wall-clock timestamps so that re-running
    the merge on identical inputs produces byte-identical output (deterministic
    rerun report). A content hash over the stats and validation is included as a
    stable fingerprint.
    """
    books_sorted = sorted(books)
    payload = {
        "books": books_sorted,
        "dry_run": dry_run,
        "stats": {key: total_stats[key] for key in sorted(total_stats)},
        "post_merge_validation": {
            "passed": validation.get("passed", False),
            "publication_errors": validation.get("publication_errors", []),
            "total_issues": validation.get("total_issues", 0),
            "by_type": validation.get("by_type", {}),
            "by_book": validation.get("by_book", {}),
        },
    }
    fingerprint = hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]
    payload["report_hash"] = fingerprint
    return payload


def write_deterministic_report(
    total_stats: Dict[str, int],
    validation: Dict[str, Any],
    books: List[str],
    dry_run: bool,
) -> Path:
    """
    Write the deterministic post-merge report to ``data/delitzsch_review/reports/``.

    Returns the path of the written report file.
    """
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    payload = _report_payload(total_stats, validation, books, dry_run)
    report_path = REPORT_DIR / "merge_strongs_report.json"
    with report_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    logger.info(f"Deterministic report written to {report_path}")
    return report_path


def main():
    parser = argparse.ArgumentParser(
        description="Merge Strong's numbers from v2 analysis into verse data"
    )
    parser.add_argument(
        '--book', 
        type=str, 
        help='Specific book to process (e.g., colossians). If not provided, processes all books.'
    )
    parser.add_argument(
        '--dry-run', 
        action='store_true',
        help='Show what would be updated without making changes'
    )
    parser.add_argument(
        '--report',
        type=str,
        default=None,
        help='Path to write the deterministic report (default: data/delitzsch_review/reports/merge_strongs_report.json)'
    )
    
    args = parser.parse_args()
    
    books_to_process = [args.book] if args.book else ALL_BOOKS
    
    total_stats = {
        'updated': 0,
        'skipped': 0,
        'failed': 0,
        'chapters_processed': 0,
        'books_processed': 0
    }
    
    for book in books_to_process:
        logger.info(f"\n{'='*50}")
        logger.info(f"Processing: {book}")
        logger.info(f"{'='*50}")
        
        if args.dry_run:
            logger.info("  [DRY RUN - No changes will be made]")
        
        stats = merge_strongs_for_book(book, dry_run=args.dry_run)
        
        for key in total_stats:
            total_stats[key] += stats[key]
        
        if stats['failed'] > 0:
            logger.error(f"  Failed to process {book}")
    
    logger.info(f"\n{'='*50}")
    logger.info(f"SUMMARY")
    logger.info(f"{'='*50}")
    logger.info(f"  Books processed: {total_stats['books_processed']}")
    logger.info(f"  Chapters processed: {total_stats['chapters_processed']}")
    logger.info(f"  Words updated: {total_stats['updated']}")
    logger.info(f"  Skipped (no v2 data): {total_stats['skipped']}")
    logger.info(f"  Failed: {total_stats['failed']}")
    
    validation = run_post_merge_validation(books_to_process)
    logger.info(f"\n  Post-merge validation: {validation.get('total_issues', 0)} issues flagged")

    if args.report or not args.dry_run:
        target = Path(args.report) if args.report else None
        if target and not target.is_absolute():
            target = PROJECT_ROOT / target
        report_path = write_deterministic_report(
            total_stats, validation or {}, books_to_process, dry_run=args.dry_run
        )
        if target:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(report_path.read_text(encoding="utf-8"), encoding="utf-8")
            report_path = target

    if total_stats["failed"] or validation.get("error") or not validation.get("passed"):
        raise SystemExit(2)

    if args.dry_run:
        logger.info("\n  [DRY RUN COMPLETE - No files were modified]")
    else:
        logger.info("\n  Merge complete!")


if __name__ == '__main__':
    main()
