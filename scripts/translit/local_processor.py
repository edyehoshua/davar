"""
Local processing pipeline for per-word transliteration (no API calls).
"""

from scripts.dict.transliteration_policy import apply_transliteration_policy

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

from .config import BESORAH_DIR, OUTPUT_DIR, TANAKH_DIR
from .local_translit import LocalTransliterator
from .models import TransliterationResult, WordItem

logger = logging.getLogger(__name__)

EXCLUDED_WORD_FIELDS = ("lemma", "text_no_nikud")


@dataclass
class BookStats:
    book_id: str
    input_tokens: int = 0
    output_tokens: int = 0
    batches: int = 0
    words: int = 0


def _iter_chapter_files(book_dir: Path) -> List[Path]:
    return sorted(
        [p for p in book_dir.iterdir() if p.suffix == ".json"],
        key=lambda p: int(p.stem),
    )


def _normalize_verses(data: List[Dict]) -> Iterable[Dict]:
    for item in data:
        if isinstance(item, dict) and "verses" in item:
            for verse in item.get("verses", []):
                yield verse
        else:
            yield item


def _word_items_from_verse(
    book_id: str,
    source: str,
    verse_obj: Dict,
) -> Tuple[List[WordItem], Dict]:
    chapter_raw = verse_obj.get("chapter")
    verse_raw = verse_obj.get("verse")
    if chapter_raw is None or verse_raw is None:
        raise ValueError(f"Missing chapter or verse in {book_id}: {verse_obj}")
    chapter = int(chapter_raw)
    verse = int(verse_raw)

    words = verse_obj.get("words", [])
    word_items: List[WordItem] = []
    output_words: List[Dict] = []

    for idx, word in enumerate(words, start=1):
        text = word.get("text") or word.get("hebrew") or ""
        if not text:
            continue

        item = WordItem(
            book_id=book_id,
            chapter=chapter,
            verse=verse,
            word_index=idx,
            text=text,
            source=source,
        )
        word_items.append(item)

        output_word = dict(word)
        # Remove fields not needed in transliteration output to keep files lean
        # and avoid duplicating lemma/normalized text already present in lexicon data.
        for field in EXCLUDED_WORD_FIELDS:
            output_word.pop(field, None)
        output_word["id"] = item.word_id
        output_word["translit_en"] = ""
        output_word["translit_es"] = ""
        output_words.append(output_word)

    output_verse = {
        "chapter": chapter,
        "verse": verse,
        "words": output_words,
    }

    for key in ("hebrew", "hebrew_no_nikud", "text"):
        if key in verse_obj:
            output_verse[key] = verse_obj[key]

    return word_items, output_verse


def _load_book_words(
    book_id: str,
    source_dir: Path,
    source_name: str,
) -> Tuple[List[List[WordItem]], List[Dict]]:
    book_dir = source_dir / book_id
    if not book_dir.exists():
        raise FileNotFoundError(f"Book not found: {book_id} in {source_dir}")

    all_word_items: List[List[WordItem]] = []
    output_verses: List[Dict] = []

    chapter_files = _iter_chapter_files(book_dir)
    logger.info("Loading %s chapters from %s...",
                len(chapter_files), book_dir.name)

    for chapter_file in chapter_files:
        with open(chapter_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        for verse in _normalize_verses(data):
            word_items, output_verse = _word_items_from_verse(
                book_id, source_name, verse
            )
            if word_items:
                all_word_items.append(word_items)
            output_verses.append(output_verse)

    total_words = sum(len(v) for v in all_word_items)
    logger.info("Loaded %s verses, %s words", len(output_verses), total_words)

    return all_word_items, output_verses


def _apply_results(
    verses: List[Dict],
    results: Dict[str, TransliterationResult],
) -> None:
    for verse in verses:
        for word in verse.get("words", []):
            word_id = word.get("id")
            if not word_id:
                continue
            translit = results.get(word_id)
            if not translit:
                continue
            word["translit_en"] = translit.translit_en
            word["translit_es"] = translit.translit_es
            cleaned = apply_transliteration_policy(word)
            word.clear()
            word.update(cleaned)


def transliterate_book_local(
    book_id: str,
    corpus: str,
    token_budget: int,
    dry_run: bool = False,
) -> BookStats:
    source_dir = TANAKH_DIR if corpus == "tanakh" else BESORAH_DIR
    source_name = "tanakh" if corpus == "tanakh" else "besorah"

    verses_word_items, output_verses = _load_book_words(
        book_id, source_dir, source_name)

    transliterator = LocalTransliterator()
    stats = BookStats(book_id=book_id)
    merged_results: Dict[str, TransliterationResult] = {}

    for verse_items in verses_word_items:
        batch_result = transliterator.translate_batch(verse_items)
        merged_results.update(batch_result.results)
        stats.words += len(verse_items)
        stats.batches += 1

    _apply_results(output_verses, merged_results)

    output = {
        "book_id": book_id,
        "source": source_name,
        "language_targets": ["en", "es"],
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "verses": output_verses,
    }

    if not dry_run:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out_file = OUTPUT_DIR / f"{book_id}.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
        logger.info("Wrote output to %s", out_file)
    else:
        logger.info("Dry run - skipping file write")

    return stats


def estimate_book_cost(stats: BookStats) -> float:
    return 0.0
