"""
Process lexicon entries for transliteration.

Adds translit_en and translit_es fields to individual lexicon JSON files
using the same LocalTransliterator rules as verse-level transliteration.
"""

from scripts.dict.transliteration_policy import apply_transliteration_policy

import json
import logging
from pathlib import Path
from typing import Optional

from .config import LEXICON_ROOTS_DIR, LEXICON_WORDS_DIR
from .local_translit import LocalTransliterator
from .models import TransliterationStats

logger = logging.getLogger(__name__)


def _transliterate_directory(
    entries_dir: Path,
    label: str,
    dry_run: bool = False,
    strong_number: Optional[str] = None,
    verbose: bool = False,
) -> TransliterationStats:
    transliterator = LocalTransliterator()

    if not entries_dir.exists():
        raise FileNotFoundError(f"{label} directory not found: {entries_dir}")

    if strong_number:
        entry_files = [entries_dir / f"{strong_number}.json"]
        if not entry_files[0].exists():
            raise FileNotFoundError(f"{label} file not found: {entry_files[0]}")
    else:
        entry_files = sorted(entries_dir.glob("H*.json"))

    logger.info(f"Processing {len(entry_files)} {label} files...")

    stats = TransliterationStats(
        book_id=f"lexicon_{label}",
        words=0,
        batches=1,
        input_tokens=0,
        output_tokens=0,
    )

    processed = 0
    skipped_already_done = 0
    skipped_no_lemma = 0

    def insert_transliteration_fields(entry: dict, translit_en: str, translit_es: str) -> dict:
        ordered = {}
        inserted = False
        entry = dict(entry)
        entry.pop("translit_en", None)
        entry.pop("translit_es", None)
        for key, value in entry.items():
            ordered[key] = value
            if key == "transliteration":
                ordered["translit_en"] = translit_en
                ordered["translit_es"] = translit_es
                inserted = True
        if not inserted:
            ordered["translit_en"] = translit_en
            ordered["translit_es"] = translit_es
        return apply_transliteration_policy(ordered)

    for entry_file in entry_files:
        try:
            with open(entry_file, "r", encoding="utf-8") as f:
                entry = json.load(f)

            translit_en = entry.get("translit_en")
            translit_es = entry.get("translit_es")
            lemma = entry.get("lemma")

            if not translit_en or not translit_es:
                if not lemma:
                    skipped_no_lemma += 1
                    logger.warning(f"Skipping {entry_file.stem}: no lemma field")
                    continue
                result = transliterator.transliterate_word(lemma)
                translit_en = translit_en or result.translit_en
                translit_es = translit_es or result.translit_es
            else:
                skipped_already_done += 1

            entry = insert_transliteration_fields(entry, translit_en, translit_es)

            if not dry_run:
                with open(entry_file, "w", encoding="utf-8") as f:
                    json.dump(entry, f, ensure_ascii=False, indent=2)

            processed += 1

            if verbose:
                logger.debug(
                    f"{entry_file.stem}: {lemma} → "
                    f"EN: {result.translit_en}, ES: {result.translit_es}",
                )
        except Exception as e:
            logger.error(f"Error processing {entry_file}: {e}")
            continue

    stats.words = processed

    logger.info(f"✅ Processed: {processed}")
    logger.info(f"⏭️  Skipped (already done): {skipped_already_done}")
    if skipped_no_lemma > 0:
        logger.warning(f"⚠️  Skipped (no lemma): {skipped_no_lemma}")

    return stats


def transliterate_roots(
    dry_run: bool = False,
    strong_number: Optional[str] = None,
    verbose: bool = False,
) -> TransliterationStats:
    """
    Add translit_en and translit_es to root entries.

    Args:
        dry_run: If True, don't write files
        strong_number: Process only this Strong's number (e.g., "H1")
        verbose: Enable verbose logging

    Returns:
        TransliterationStats with processing results
    """
    return _transliterate_directory(
        entries_dir=LEXICON_ROOTS_DIR,
        label="roots",
        dry_run=dry_run,
        strong_number=strong_number,
        verbose=verbose,
    )


def transliterate_words(
    dry_run: bool = False,
    strong_number: Optional[str] = None,
    verbose: bool = False,
) -> TransliterationStats:
    """
    Add translit_en and translit_es to word entries.

    Args:
        dry_run: If True, don't write files
        strong_number: Process only this Strong's number (e.g., "H1")
        verbose: Enable verbose logging

    Returns:
        TransliterationStats with processing results
    """
    return _transliterate_directory(
        entries_dir=LEXICON_WORDS_DIR,
        label="words",
        dry_run=dry_run,
        strong_number=strong_number,
        verbose=verbose,
    )


def estimate_roots_cost() -> float:
    """
    Estimate the cost of transliterating all roots.
    
    Since this uses local rules (not API), cost is always $0.00.
    
    Returns:
        Cost estimate (always 0.0)
    """
    return 0.0


def estimate_words_cost() -> float:
    """
    Estimate the cost of transliterating all words.

    Since this uses local rules (not API), cost is always $0.00.

    Returns:
        Cost estimate (always 0.0)
    """
    return 0.0
