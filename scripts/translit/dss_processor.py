"""
Local processing pipeline for DSS variant transliteration (no API calls).
"""

from __future__ import annotations

import json
import hashlib
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .config import DSS_BOOKS_DIR, DSS_TRANSLIT_DIR, DSS_VOCALIZATION_CACHE_PATH
from .local_translit import LocalTransliterator

logger = logging.getLogger(__name__)

MAQAF = "\u05BE"
HEBREW_MARKS_RE = "[\u0591-\u05C7]"
TETRAGRAMMATON = "יהוה"


def _normalize_divine_name_translit(text: str) -> str:
    if not text:
        return text
    # Ensure all transliterated forms of the tetragrammaton are normalized.
    return text.replace("yehvah", "YHWH").replace("yhvah", "YHWH")


@dataclass
class DssBookStats:
    book_id: str
    variants: int = 0
    failed: int = 0


def _load_dss_book(book_id: str) -> Dict:
    book_path = DSS_BOOKS_DIR / f"{book_id}.json"
    if not book_path.exists():
        raise FileNotFoundError(f"DSS book not found: {book_path}")

    with open(book_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _transliterate_phrase(
    transliterator: LocalTransliterator,
    text: str,
) -> Tuple[str, str]:
    if not text:
        return "", ""

    en_tokens: List[str] = []
    es_tokens: List[str] = []

    for token in text.split():
        if not token:
            continue
        parts = [p for p in token.split(MAQAF) if p]
        en_parts: List[str] = []
        es_parts: List[str] = []
        for part in parts:
            normalized_part = part.replace("/", "")
            # Remove Hebrew combining marks so pointed/unpointed forms match.
            normalized_part = re.sub(HEBREW_MARKS_RE, "", normalized_part)
            if normalized_part == TETRAGRAMMATON:
                en_parts.append("YHWH")
                es_parts.append("YHWH")
                continue
            result = transliterator.transliterate_word(part)
            en_parts.append(result.translit_en)
            es_parts.append(result.translit_es)
        if en_parts:
            en_tokens.append("-".join(en_parts))
        if es_parts:
            es_tokens.append("-".join(es_parts))

    en_text = " ".join(en_tokens)
    es_text = " ".join(es_tokens)
    return _normalize_divine_name_translit(en_text), _normalize_divine_name_translit(es_text)


def resolve_dss_transliteration(difference: Dict, transliterator: LocalTransliterator) -> Tuple[str, str, str, str]:
    """Resolve DSS fields without inheriting a Masoretic transliteration.

    Editorial values are preferred, followed by generated values and finally
    the local consonantal transliterator.  The source/confidence pair makes
    the fallback auditable for clients and downstream review tooling.
    """
    editorial_en = str(difference.get("dss_translit_en", "")).strip()
    editorial_es = str(difference.get("dss_translit_es", "")).strip()
    if editorial_en and editorial_es:
        return editorial_en, editorial_es, "editorial", "high"

    dss_word = str(difference.get("dss_word", "")).strip()
    generated_en, generated_es = _transliterate_phrase(transliterator, dss_word)
    if editorial_en or editorial_es:
        return editorial_en or generated_en, editorial_es or generated_es, "editorial_with_local_fallback", "low"
    if generated_en and generated_es:
        return generated_en, generated_es, "local_rule", "medium" if re.search(r"[\u05b0-\u05bb\u05c7]", dss_word) else "low"
    return generated_en, generated_es, "local_rule", "low"


def transliterate_dss_book(
    book_id: str,
    dry_run: bool = False,
    use_xai_vocalization: bool = False,
    max_chars_per_request: Optional[int] = None,
) -> DssBookStats:
    data = _load_dss_book(book_id)
    transliterator = LocalTransliterator()
    stats = DssBookStats(book_id=book_id)

    differences_payload: List[Tuple[str, str, Dict]] = []
    chapters = data.get("chapters", {})
    for chapter_key, chapter_data in chapters.items():
        verses = chapter_data.get("verses", {})
        for verse_key, verse_data in verses.items():
            differences = verse_data.get("differences", []) or []
            for difference in differences:
                differences_payload.append((chapter_key, verse_key, difference))

    vocalized_map: Dict[str, str] = json.loads(DSS_VOCALIZATION_CACHE_PATH.read_text()) if DSS_VOCALIZATION_CACHE_PATH.exists() else {}
    if use_xai_vocalization and differences_payload:
        dss_phrases = [
            str(difference.get("dss_word", "")).strip()
            for _, _, difference in differences_payload
            if str(difference.get("dss_word", "")).strip()
        ]

        if dss_phrases:
            try:
                from .xai_vocalizer import XaiDssVocalizer

                vocalizer = XaiDssVocalizer(
                    max_chars_per_request=max_chars_per_request,
                )
                vocalized_map = vocalizer.vocalize_phrases(dss_phrases)
                if not dry_run:
                    vocalizer.save_cache()

                vocalizer_stats = vocalizer.get_stats()
                logger.info(
                    "DSS xAI vocalization stats for %s: %s",
                    book_id,
                    vocalizer_stats,
                )
            except Exception as exc:
                logger.warning(
                    "xAI vocalization unavailable for %s, using unpointed DSS text: %s",
                    book_id,
                    exc,
                )

    variants: List[Dict] = []
    for chapter_key, verse_key, difference in differences_payload:
        dss_word = str(difference.get("dss_word", ""))
        proposed = vocalized_map.get(dss_word, dss_word)
        letters = lambda value: re.sub(r"[^א-ת]", "", value)
        cache_rejected = letters(proposed) != letters(dss_word)
        vocalized_word = dss_word if cache_rejected else proposed
        translit_source, translit_confidence = "failed", "low"
        try:
            generated_difference = dict(difference)
            generated_difference["dss_word"] = vocalized_word
            translit_en, translit_es, translit_source, translit_confidence = resolve_dss_transliteration(
                generated_difference, transliterator
            )
            if vocalized_word != dss_word and translit_source == "local_rule":
                translit_source = "cached_ai_vocalization"
        except Exception as exc:
            logger.warning(
                "Failed to transliterate DSS word '%s' in %s %s:%s: %s",
                dss_word,
                book_id,
                chapter_key,
                verse_key,
                exc,
            )
            stats.failed += 1
            translit_en, translit_es = "", ""

        variants.append(
            {
                "book": data.get("name", book_id),
                "chapter": int(chapter_key),
                "verse": int(verse_key),
                "position": difference.get("position", 0),
                "dss_word": dss_word,
                "dss_word_niqqud": vocalized_word,
                "dss_translit_en": translit_en,
                "dss_translit_es": translit_es,
                "dss_translit_source": translit_source,
                "dss_vocalization_rejected": cache_rejected,
                "dss_translit_confidence": translit_confidence,
                # Keep legacy keys for existing static/offline consumers.
                "translit_en": translit_en,
                "translit_es": translit_es,
            }
        )
        stats.variants += 1

    output = {
        "book_id": book_id,
        "source": "dss",
        "language_targets": ["en", "es"],
        "generator_version": "dss-transform-1",
        "vocalization_cache_sha256": hashlib.sha256(json.dumps(vocalized_map, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
        "source_sha256": hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
        "variants": variants,
    }

    if not dry_run:
        DSS_TRANSLIT_DIR.mkdir(parents=True, exist_ok=True)
        out_file = DSS_TRANSLIT_DIR / f"{book_id}.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
        logger.info("Wrote DSS transliteration output to %s", out_file)
    else:
        logger.info("Dry run - skipping DSS transliteration file write")

    return stats


def get_available_dss_books() -> List[str]:
    if not DSS_BOOKS_DIR.exists():
        return []
    return sorted(
        path.stem
        for path in DSS_BOOKS_DIR.glob("*.json")
        if path.is_file()
    )
