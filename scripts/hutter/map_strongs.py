from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable, TypeVar


T = TypeVar("T")

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.translit.local_translit import LocalTransliterator


HUTTER_ROOT = REPO_ROOT / "data" / "hutter" / "staging" / "output"
DELITZSCH_ROOT = REPO_ROOT / "data" / "delitzsch_parsed"
TANAJ_ROOT = REPO_ROOT / "data" / "oe"
LEXICON_WORDS_ROOT = REPO_ROOT / "data" / "dict" / "lexicon" / "words"
LEXICON_ROOTS_ROOT = REPO_ROOT / "data" / "dict" / "lexicon" / "roots"
CUSTOM_DEFINITIONS_PATH = (
    REPO_ROOT / "data" / "dict" / "lexicon" / "custom_definitions.json"
)
MANUAL_OVERRIDES_PATH = REPO_ROOT / "data" / "hutter" / "strong_overrides.json"
OCR_RESULTS_ROOT = REPO_ROOT / "data" / "hutter" / "api_results_gpt55"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "data" / "hutter" / "strong_mappings"
DEFAULT_REPORT_PATH = (
    REPO_ROOT / "data" / "hutter" / "review_reports" / "strong_mapping_report.json"
)

HEBREW_MARK_RE = re.compile(r"[\u0591-\u05C7]")
HEBREW_CANTILLATION_RE = re.compile(r"[\u0591-\u05AF\u05BD\u05BF\u05C0\u05C3-\u05C7]")
NON_HEBREW_RE = re.compile(r"[^א-ת]")
NON_POINTED_HEBREW_RE = re.compile(r"[^א-ת\u05B0-\u05BC\u05C1\u05C2]")
MAQAF = "\u05BE"
PREFIX_CODES = {
    "ו": "Hc",
    "ה": "Hd",
    "ב": "Hb",
    "כ": "Hk",
    "ל": "Hl",
    "מ": "Hm",
    "ש": "Hs",
}
FINAL_TO_MEDIAL = str.maketrans({"ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ"})


@dataclass(frozen=True)
class StrongCandidate:
    strong: str
    prefixes: tuple[str, ...]


@dataclass(frozen=True)
class MappingDecision:
    strong: str | None
    prefixes: tuple[str, ...]
    confidence: str
    method: str
    evidence: str
    score: float


@dataclass(frozen=True)
class CustomFormMatch:
    strong: str
    prefixes: tuple[str, ...]
    hutter_surface: str
    custom_surface: str
    similarity: float
    runner_up_similarity: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Map Strong numbers onto Hutter Hebrew words using reviewed "
            "Delitzsch/Tanakh forms, lexicon lemmas, and conservative verse alignment."
        )
    )
    parser.add_argument(
        "books",
        nargs="*",
        help="Optional Hutter book ids. Defaults to every New Testament Hutter book.",
    )
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH)
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write per-book mappings and the aggregate review report.",
    )
    parser.add_argument(
        "--include-low-confidence",
        action="store_true",
        help="Keep low-confidence fuzzy candidates as assigned mappings.",
    )
    parser.add_argument(
        "--allow-coverage-regression",
        action="store_true",
        help="Allow --write to replace a report with a lower mapped-word count.",
    )
    parser.add_argument(
        "--morphology",
        action="store_true",
        help=(
            "Analyse unresolved Hutter forms with the morphology-aware candidate "
            "generator and write a review queue + backtest report (no mapping writes)."
        ),
    )
    parser.add_argument(
        "--morphology-queue",
        type=Path,
        default=REPO_ROOT / "data" / "hutter" / "review_reports" / "morphology_review_queue.json",
        help="Path to write the morphology review queue (default: data/hutter/review_reports/morphology_review_queue.json).",
    )
    parser.add_argument(
        "--morphology-backtest",
        type=Path,
        default=REPO_ROOT / "data" / "hutter" / "review_reports" / "morphology_backtest.json",
        help="Path to write the morphology backtest report.",
    )
    return parser.parse_args()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_hebrew(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    normalized = HEBREW_MARK_RE.sub("", normalized)
    normalized = normalized.translate(FINAL_TO_MEDIAL)
    return NON_HEBREW_RE.sub("", normalized)


def normalize_pointed_hebrew(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    normalized = HEBREW_CANTILLATION_RE.sub("", normalized)
    return NON_POINTED_HEBREW_RE.sub("", normalized)


def split_hutter_words(text: str) -> list[str]:
    words: list[str] = []
    for whitespace_token in text.split():
        parts = whitespace_token.split(MAQAF)
        for index, part in enumerate(parts):
            cleaned = part.strip()
            if not normalize_hebrew(cleaned):
                continue
            if index < len(parts) - 1:
                cleaned += MAQAF
            words.append(cleaned)
    return words


def base_strong(strong: str | None) -> str | None:
    if not strong:
        return None
    parts = [part for part in strong.split("/") if part]
    return parts[-1] if parts else None


def composite_strong(prefixes: Iterable[str], strong: str) -> str:
    prefix_list = list(prefixes)
    return "/".join([*prefix_list, strong]) if prefix_list else strong


def candidate_from_word(word: dict[str, Any]) -> StrongCandidate | None:
    strong = str(word.get("strong") or "").strip()
    if not strong:
        return None
    prefixes = tuple(str(item) for item in word.get("prefixes") or [])
    return StrongCandidate(strong=strong, prefixes=prefixes)


def strip_known_prefixes(surface: str, prefixes: Iterable[str]) -> str:
    normalized = normalize_hebrew(surface)
    remaining = normalized
    reverse_codes = {code: letter for letter, code in PREFIX_CODES.items()}
    for prefix in prefixes:
        letter = reverse_codes.get(prefix)
        if letter and remaining.startswith(letter) and len(remaining) > 1:
            remaining = remaining[1:]
    return remaining


def iter_source_words() -> Iterable[dict[str, Any]]:
    for book_dir in sorted(TANAJ_ROOT.iterdir()):
        if not book_dir.is_dir():
            continue
        for chapter_path in sorted(book_dir.glob("*.json")):
            data = load_json(chapter_path)
            if not isinstance(data, list):
                continue
            for verse in data:
                if not isinstance(verse, dict):
                    continue
                yield from verse.get("words") or []

    for book_dir in sorted(DELITZSCH_ROOT.iterdir()):
        if not book_dir.is_dir():
            continue
        for chapter_path in sorted(book_dir.glob("*.json")):
            data = load_json(chapter_path)
            if not isinstance(data, list) or not data:
                continue
            chapter = data[0] if isinstance(data[0], dict) else {}
            for verse in chapter.get("verses") or []:
                yield from verse.get("words") or []


def load_lexicon_lemmas() -> dict[str, Counter[str]]:
    index: dict[str, Counter[str]] = defaultdict(Counter)
    for root in (LEXICON_WORDS_ROOT, LEXICON_ROOTS_ROOT):
        for path in root.glob("*.json"):
            entry = load_json(path)
            strong = str(entry.get("strong_number") or path.stem)
            lemma = normalize_hebrew(str(entry.get("lemma") or ""))
            if lemma:
                index[lemma][strong] += 1

    custom = load_json(CUSTOM_DEFINITIONS_PATH)
    for strong, entry in custom.items():
        # Custom entries created for reviewed occurrences can be deliberately
        # context-only.  Treating short inflected forms such as לִי or לוֹ as
        # global lemmas lets them outrank well-attested Hebrew forms throughout
        # Hutter, even though their evidence belongs to specific Delitzsch
        # verses.  Context-only entries remain available through
        # load_contextual_custom_forms().
        if entry.get("mapping_scope", "global") != "global":
            continue
        lemma = normalize_hebrew(str(entry.get("hebrew") or ""))
        if lemma:
            index[lemma][str(strong)] += 2
    return index


def load_exact_custom_lemmas() -> dict[str, Counter[str]]:
    """Load reviewed custom forms that may match only a complete pointed token."""

    index: dict[str, Counter[str]] = defaultdict(Counter)
    custom = load_json(CUSTOM_DEFINITIONS_PATH)
    for strong, entry in custom.items():
        if entry.get("mapping_scope") != "exact":
            continue
        raw_forms = {
            str(entry.get("hebrew") or ""),
            *(str(form) for form in entry.get("mapping_forms") or []),
            *(
                str(instance.get("text") or "")
                for instance in entry.get("nt_instances") or []
            ),
        }
        for raw_form in sorted(raw_forms):
            pointed = normalize_pointed_hebrew(raw_form)
            if pointed:
                index[pointed][str(strong)] += 1
    return index


def load_manual_overrides() -> tuple[
    dict[str, dict[str, Any]],
    dict[tuple[str, int, int, str], dict[str, Any]],
]:
    if not MANUAL_OVERRIDES_PATH.exists():
        return {}, {}
    entries = load_json(MANUAL_OVERRIDES_PATH)
    overrides: dict[str, dict[str, Any]] = {}
    contextual: dict[tuple[str, int, int, str], dict[str, Any]] = {}
    for entry in entries:
        references = entry.get("references") or []
        for form in entry.get("forms") or []:
            normalized = normalize_hebrew(str(form))
            if not normalized:
                continue
            if references:
                for reference in references:
                    key = (
                        str(reference["book"]),
                        int(reference["chapter"]),
                        int(reference["verse"]),
                        normalized,
                    )
                    contextual[key] = entry
            else:
                overrides[normalized] = entry
    return overrides, contextual


def manual_override_decision(override: dict[str, Any] | None) -> MappingDecision | None:
    if not override:
        return None
    prefixes = tuple(str(item) for item in override.get("prefixes") or [])
    return MappingDecision(
        strong=str(override["strong"]),
        prefixes=prefixes,
        confidence="high",
        method="manual_override",
        evidence=str(override.get("reason") or "Reviewed Hutter lexical assignment"),
        score=1.0,
    )


def load_custom_name_forms() -> dict[str, set[str]]:
    custom = load_json(CUSTOM_DEFINITIONS_PATH)
    forms: dict[str, set[str]] = defaultdict(set)
    for strong, entry in custom.items():
        transliteration = str(entry.get("transliteration_en") or "")
        if (
            not str(strong).startswith("D")
            or not transliteration
            or not transliteration[0].isupper()
            or not entry.get("nt_instances")
        ):
            continue
        raw_forms = [
            str(entry.get("hebrew") or ""),
            *[
                str(instance.get("text") or "")
                for instance in entry.get("nt_instances") or []
            ],
        ]
        for raw_form in raw_forms:
            for _, normalized in prefix_parses(raw_form):
                if len(normalized) >= 4:
                    forms[str(strong)].add(normalized)
    return forms


def load_contextual_custom_forms() -> dict[tuple[str, int, int], dict[str, set[str]]]:
    custom = load_json(CUSTOM_DEFINITIONS_PATH)
    contextual: dict[tuple[str, int, int], dict[str, set[str]]] = defaultdict(
        lambda: defaultdict(set)
    )
    for strong, entry in custom.items():
        if not str(strong).startswith("D"):
            continue
        lemma = normalize_hebrew(str(entry.get("hebrew") or ""))
        for instance in entry.get("nt_instances") or []:
            book = str(instance.get("book") or "")
            chapter = int(instance.get("chapter") or 0)
            verse = int(instance.get("verse") or 0)
            if not book or not chapter or not verse:
                continue
            forms = contextual[(book, chapter, verse)][str(strong)]
            if len(lemma) >= 4:
                forms.add(lemma)
            for _, normalized in prefix_parses(str(instance.get("text") or "")):
                if len(normalized) >= 4:
                    forms.add(normalized)
    return contextual


def best_contextual_custom_match(
    text: str,
    candidates: dict[str, set[str]],
    minimum_similarity: float = 0.75,
) -> CustomFormMatch | None:
    matches: list[CustomFormMatch] = []
    for strong, custom_forms in candidates.items():
        best: tuple[float, tuple[str, ...], str, str] | None = None
        for prefixes, hutter_surface in prefix_parses(text):
            if len(hutter_surface) < 4:
                continue
            for custom_surface in sorted(custom_forms):
                similarity = SequenceMatcher(
                    None, hutter_surface, custom_surface
                ).ratio()
                candidate = (similarity, prefixes, hutter_surface, custom_surface)
                if best is None or candidate[0] > best[0]:
                    best = candidate
        if best:
            matches.append(
                CustomFormMatch(
                    strong=strong,
                    prefixes=best[1],
                    hutter_surface=best[2],
                    custom_surface=best[3],
                    similarity=best[0],
                    runner_up_similarity=0.0,
                )
            )

    matches.sort(key=lambda item: (-item.similarity, item.strong))
    if not matches or matches[0].similarity < minimum_similarity:
        return None
    runner_up = matches[1].similarity if len(matches) > 1 else 0.0
    winner = matches[0]
    if winner.similarity < 0.9 and winner.similarity - runner_up < 0.05:
        return None
    return CustomFormMatch(
        strong=winner.strong,
        prefixes=winner.prefixes,
        hutter_surface=winner.hutter_surface,
        custom_surface=winner.custom_surface,
        similarity=winner.similarity,
        runner_up_similarity=runner_up,
    )


def contextual_custom_decision(
    text: str,
    candidates: dict[str, set[str]],
) -> MappingDecision | None:
    match = best_contextual_custom_match(text, candidates)
    if not match:
        return None
    return MappingDecision(
        strong=composite_strong(match.prefixes, match.strong),
        prefixes=match.prefixes,
        confidence="high" if match.similarity >= 0.86 else "medium",
        method="verse_context_custom",
        evidence=(
            f"hutter={match.hutter_surface}; custom={match.custom_surface}; "
            f"strong={match.strong}; similarity={match.similarity:.3f}; "
            "evidence=same book/chapter/verse custom instance (not word position)"
        ),
        score=min(0.99, 0.78 + 0.2 * match.similarity),
    )


def build_contextual_custom_variant_index(
    books: Iterable[str],
    contextual_custom_forms: dict[tuple[str, int, int], dict[str, set[str]]],
) -> dict[str, Counter[str]]:
    variants: dict[str, Counter[str]] = defaultdict(Counter)
    for book in sorted(books):
        hutter = load_json(HUTTER_ROOT / f"{book}.json")
        for chapter in hutter.get("chapters") or []:
            chapter_number = int(chapter.get("number") or 0)
            for verse in chapter.get("verses") or []:
                verse_number = int(verse.get("number") or 0)
                candidates = contextual_custom_forms.get(
                    (book, chapter_number, verse_number), {}
                )
                if not candidates:
                    continue
                for text in split_hutter_words(str(verse.get("text_nikud") or "")):
                    match = best_contextual_custom_match(text, candidates)
                    if match:
                        variants[match.hutter_surface][match.strong] += 1
    return variants


def contextual_custom_variant_decision(
    text: str,
    variant_index: dict[str, Counter[str]],
) -> MappingDecision | None:
    best: MappingDecision | None = None
    for prefixes, root_surface in prefix_parses(text):
        strong, count, quality = best_counter_value(
            variant_index.get(root_surface, Counter())
        )
        if not strong or quality < 0.72:
            continue
        decision = MappingDecision(
            strong=composite_strong(prefixes, strong),
            prefixes=prefixes,
            confidence="high" if count >= 2 else "medium",
            method="contextual_custom_variant",
            evidence=(
                f"root_surface={root_surface}; strong={strong}; "
                f"same-verse supporting occurrences={count}; quality={quality:.3f}"
            ),
            score=min(0.96, 0.88 + 0.06 * quality),
        )
        if best is None or decision.score > best.score:
            best = decision
    return best


def build_indexes() -> tuple[
    dict[str, Counter[StrongCandidate]],
    dict[str, Counter[StrongCandidate]],
    dict[str, Counter[str]],
    dict[str, Counter[str]],
    dict[str, Counter[str]],
]:
    pointed_surface_index: dict[str, Counter[StrongCandidate]] = defaultdict(Counter)
    surface_index: dict[str, Counter[StrongCandidate]] = defaultdict(Counter)
    base_form_index: dict[str, Counter[str]] = defaultdict(Counter)

    for word in iter_source_words():
        candidate = candidate_from_word(word)
        surface = normalize_hebrew(str(word.get("text") or ""))
        if not candidate or not surface:
            continue
        pointed_surface = normalize_pointed_hebrew(str(word.get("text") or ""))
        if pointed_surface:
            pointed_surface_index[pointed_surface][candidate] += 1
        surface_index[surface][candidate] += 1
        base = base_strong(candidate.strong)
        root_surface = strip_known_prefixes(
            str(word.get("text") or ""), candidate.prefixes
        )
        if base and root_surface:
            base_form_index[root_surface][base] += 1

    return (
        pointed_surface_index,
        surface_index,
        base_form_index,
        load_lexicon_lemmas(),
        load_exact_custom_lemmas(),
    )


def best_counter_value(counter: Counter[T]) -> tuple[T | None, int, float]:
    if not counter:
        return None, 0, 0.0
    (value, count), *rest = counter.most_common(2)
    total = sum(counter.values())
    runner_up = rest[0][1] if rest else 0
    dominance = count / max(total, 1)
    separation = (count - runner_up) / max(count, 1)
    return value, count, dominance * 0.7 + separation * 0.3


def prefix_parses(surface: str, max_prefixes: int = 3) -> Iterable[tuple[tuple[str, ...], str]]:
    normalized = normalize_hebrew(surface)
    yield (), normalized

    def walk(remaining: str, prefixes: tuple[str, ...]) -> Iterable[tuple[tuple[str, ...], str]]:
        if len(prefixes) >= max_prefixes or len(remaining) <= 2:
            return
        code = PREFIX_CODES.get(remaining[0])
        if not code or code in prefixes:
            return
        next_prefixes = (*prefixes, code)
        next_remaining = remaining[1:]
        yield next_prefixes, next_remaining
        yield from walk(next_remaining, next_prefixes)

    yield from walk(normalized, ())


def decide_from_indexes(
    text: str,
    manual_overrides: dict[str, dict[str, Any]],
    pointed_surface_index: dict[str, Counter[StrongCandidate]],
    surface_index: dict[str, Counter[StrongCandidate]],
    base_form_index: dict[str, Counter[str]],
    lemma_index: dict[str, Counter[str]],
    exact_custom_lemma_index: dict[str, Counter[str]],
) -> MappingDecision | None:
    surface = normalize_hebrew(text)
    override = manual_overrides.get(surface)
    override_decision = manual_override_decision(override)
    if override_decision:
        return override_decision

    pointed_surface = normalize_pointed_hebrew(text)
    custom_exact, custom_count, custom_quality = best_counter_value(
        exact_custom_lemma_index.get(pointed_surface, Counter())
    )
    exact_prefixes: tuple[str, ...] = ()
    exact_root_surface = pointed_surface
    if not custom_exact and pointed_surface.startswith("ו"):
        # Permit only an outer conjunction around an exact reviewed clitic.
        # This handles forms such as וּבוֹ without reopening generic
        # prefix stripping for short lemmas (בְּלִי must not become
        # Hb/D0265, for example).
        index = 1
        while index < len(pointed_surface) and unicodedata.combining(
            pointed_surface[index]
        ):
            index += 1
        exact_root_surface = pointed_surface[index:]
        custom_exact, custom_count, custom_quality = best_counter_value(
            exact_custom_lemma_index.get(exact_root_surface, Counter())
        )
        if custom_exact:
            exact_prefixes = ("Hc",)
    if custom_exact and custom_quality >= 0.9:
        return MappingDecision(
            strong=composite_strong(exact_prefixes, custom_exact),
            prefixes=exact_prefixes,
            confidence="high",
            method="exact_custom_lemma",
            evidence=(
                f"pointed_surface={pointed_surface}; root_surface={exact_root_surface}; "
                f"reviewed_custom={custom_exact}; "
                f"forms={custom_count}; quality={custom_quality:.3f}; "
                "scope=exact-token-only"
            ),
            score=1.0,
        )

    pointed_exact, pointed_count, pointed_quality = best_counter_value(
        pointed_surface_index.get(pointed_surface, Counter())
    )
    if pointed_exact and pointed_quality >= 0.65:
        return MappingDecision(
            strong=pointed_exact.strong,
            prefixes=pointed_exact.prefixes,
            confidence="high" if pointed_quality >= 0.86 else "medium",
            method="attested_pointed_surface",
            evidence=(
                f"pointed_surface={pointed_surface}; occurrences={pointed_count}; "
                f"quality={pointed_quality:.3f}"
            ),
            score=min(1.0, pointed_quality + 0.08),
        )

    exact, count, quality = best_counter_value(surface_index.get(surface, Counter()))
    if exact and quality >= 0.72:
        return MappingDecision(
            strong=exact.strong,
            prefixes=exact.prefixes,
            confidence="high" if quality >= 0.9 else "medium",
            method="attested_surface",
            evidence=f"surface={surface}; occurrences={count}; quality={quality:.3f}",
            score=quality,
        )

    best: MappingDecision | None = None
    for prefixes, root_surface in prefix_parses(text):
        if not root_surface:
            continue

        attested_candidate, attested_count, attested_quality = best_counter_value(
            base_form_index.get(root_surface, Counter())
        )
        lemma_candidate, lemma_count, lemma_quality = best_counter_value(
            lemma_index.get(root_surface, Counter())
        )

        candidate = attested_candidate
        candidate_count = attested_count
        candidate_quality = attested_quality
        method = "attested_prefixed_form"
        if lemma_candidate and (
            candidate is None or lemma_quality > candidate_quality + 0.08
        ):
            candidate = lemma_candidate
            candidate_count = lemma_count
            candidate_quality = lemma_quality
            method = "lexicon_lemma"
        if not candidate:
            continue

        prefix_penalty = 0.035 * len(prefixes)
        score = candidate_quality - prefix_penalty
        decision = MappingDecision(
            strong=composite_strong(prefixes, candidate),
            prefixes=prefixes,
            confidence="high" if score >= 0.88 else "medium",
            method=method,
            evidence=(
                f"root_surface={root_surface}; occurrences={candidate_count}; "
                f"quality={candidate_quality:.3f}"
            ),
            score=score,
        )
        if best is None or decision.score > best.score:
            best = decision

    return best if best and best.score >= 0.62 else None


def load_delitzsch_verses(book: str) -> dict[tuple[int, int], dict[str, Any]]:
    verses: dict[tuple[int, int], dict[str, Any]] = {}
    book_dir = DELITZSCH_ROOT / book
    if not book_dir.exists():
        return verses
    for chapter_path in sorted(book_dir.glob("*.json")):
        data = load_json(chapter_path)
        if not isinstance(data, list) or not data:
            continue
        chapter = data[0] if isinstance(data[0], dict) else {}
        for verse in chapter.get("verses") or []:
            key = (int(verse.get("chapter") or 0), int(verse.get("verse") or 0))
            verses[key] = verse
    return verses


def load_ocr_verses(book: str) -> dict[tuple[int, int], dict[str, Any]]:
    path = OCR_RESULTS_ROOT / book / "results.jsonl"
    if not path.exists():
        return {}
    verses: dict[tuple[int, int], dict[str, Any]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        parts = str(row.get("id") or "").split(".")
        if len(parts) < 3:
            continue
        try:
            key = (int(parts[1]), int(parts[2]))
        except ValueError:
            continue
        if str(row.get("hebrew_text") or "").strip():
            verses[key] = row
    return verses


def align_similar_words(
    source_words: list[str],
    alternate_words: list[str],
) -> dict[int, int]:
    """Globally align two transcriptions of the same verse.

    This is deliberately separate from Delitzsch translation alignment. Both inputs
    represent the same Hutter source image, so token order is evidence here even when
    an OCR pass split or omitted a word.
    """
    source = [normalize_hebrew(word) for word in source_words]
    alternate = [normalize_hebrew(word) for word in alternate_words]
    source_count = len(source)
    alternate_count = len(alternate)
    gap_penalty = -0.45
    scores = [
        [0.0 for _ in range(alternate_count + 1)]
        for _ in range(source_count + 1)
    ]
    trace: list[list[str | None]] = [
        [None for _ in range(alternate_count + 1)]
        for _ in range(source_count + 1)
    ]
    for index in range(1, source_count + 1):
        scores[index][0] = index * gap_penalty
        trace[index][0] = "source_gap"
    for index in range(1, alternate_count + 1):
        scores[0][index] = index * gap_penalty
        trace[0][index] = "alternate_gap"

    for source_index in range(1, source_count + 1):
        for alternate_index in range(1, alternate_count + 1):
            similarity = SequenceMatcher(
                None,
                source[source_index - 1],
                alternate[alternate_index - 1],
            ).ratio()
            options = [
                (
                    scores[source_index - 1][alternate_index - 1]
                    + 2.0 * similarity
                    - 1.0,
                    "match",
                ),
                (
                    scores[source_index - 1][alternate_index] + gap_penalty,
                    "source_gap",
                ),
                (
                    scores[source_index][alternate_index - 1] + gap_penalty,
                    "alternate_gap",
                ),
            ]
            scores[source_index][alternate_index], trace[source_index][alternate_index] = (
                max(options, key=lambda item: item[0])
            )

    aligned: dict[int, int] = {}
    source_index = source_count
    alternate_index = alternate_count
    while source_index or alternate_index:
        operation = trace[source_index][alternate_index]
        if operation == "match":
            aligned[source_index - 1] = alternate_index - 1
            source_index -= 1
            alternate_index -= 1
        elif operation == "source_gap":
            source_index -= 1
        elif operation == "alternate_gap":
            alternate_index -= 1
        else:
            break
    return aligned


def same_verse_spelling_decision(
    hutter_word: str,
    delitzsch_words: list[dict[str, Any]],
) -> MappingDecision | None:
    matches: dict[str, tuple[float, tuple[str, ...], str, str]] = {}
    for delitzsch_word in delitzsch_words:
        strong = base_strong(str(delitzsch_word.get("strong") or ""))
        if not strong:
            continue
        delitzsch_surface = strip_known_prefixes(
            str(delitzsch_word.get("text") or ""),
            delitzsch_word.get("prefixes") or [],
        )
        if len(delitzsch_surface) < 4:
            continue
        for prefixes, hutter_surface in prefix_parses(hutter_word):
            if len(hutter_surface) < 4:
                continue
            similarity = SequenceMatcher(
                None, hutter_surface, delitzsch_surface
            ).ratio() - 0.02 * len(prefixes)
            previous = matches.get(strong)
            if previous is None or similarity > previous[0]:
                matches[strong] = (
                    similarity,
                    prefixes,
                    hutter_surface,
                    delitzsch_surface,
                )
    ranked = sorted(
        ((match[0], strong, *match[1:]) for strong, match in matches.items()),
        reverse=True,
    )
    if not ranked or ranked[0][0] < 0.9:
        return None
    runner_up = ranked[1][0] if len(ranked) > 1 else 0.0
    similarity, strong, prefixes, hutter_surface, delitzsch_surface = ranked[0]
    if runner_up >= 0.9 and similarity - runner_up < 0.08:
        return None
    return MappingDecision(
        strong=composite_strong(prefixes, strong),
        prefixes=prefixes,
        confidence="high" if similarity >= 0.97 else "medium",
        method="same_verse_spelling",
        evidence=(
            f"hutter={hutter_surface}; delitzsch={delitzsch_surface}; "
            f"strong={strong}; similarity={similarity:.3f}; "
            "evidence=same verse spelling (not word position)"
        ),
        score=min(0.97, 0.88 + 0.09 * similarity),
    )


def ocr_crosscheck_decision(
    hutter_word: str,
    ocr_word: str,
    ocr_confidence: str,
    delitzsch_words: list[dict[str, Any]],
    manual_overrides: dict[str, dict[str, Any]],
    pointed_surface_index: dict[str, Counter[StrongCandidate]],
    surface_index: dict[str, Counter[StrongCandidate]],
    base_form_index: dict[str, Counter[str]],
    lemma_index: dict[str, Counter[str]],
    exact_custom_lemma_index: dict[str, Counter[str]],
    custom_name_forms: dict[str, set[str]],
    verse_custom_forms: dict[str, set[str]],
    contextual_custom_variants: dict[str, Counter[str]],
) -> MappingDecision | None:
    if ocr_confidence not in {"medium", "high"}:
        return None
    hutter_surface = normalize_hebrew(hutter_word)
    ocr_surface = normalize_hebrew(ocr_word)
    if not hutter_surface or not ocr_surface:
        return None
    similarity = SequenceMatcher(None, hutter_surface, ocr_surface).ratio()
    if similarity < 0.5:
        return None

    candidates = [
        decide_from_indexes(
            ocr_word,
            manual_overrides,
            pointed_surface_index,
            surface_index,
            base_form_index,
            lemma_index,
            exact_custom_lemma_index,
        ),
        contextual_custom_decision(ocr_word, verse_custom_forms),
        contextual_custom_variant_decision(ocr_word, contextual_custom_variants),
    ]
    decision = max(
        (candidate for candidate in candidates if candidate is not None),
        key=lambda candidate: candidate.score,
        default=None,
    )
    if not decision or decision.confidence == "low":
        return None

    delitzsch_strongs = {
        base_strong(str(word.get("strong") or "")) for word in delitzsch_words
    }
    decision_strong = base_strong(decision.strong)
    verse_supported = decision_strong in delitzsch_strongs
    custom_name_ocr_similarity = max(
        (
            SequenceMatcher(None, ocr_surface, custom_surface).ratio()
            for custom_surface in custom_name_forms.get(decision_strong, set())
        ),
        default=0.0,
    )
    custom_name_supported = (
        decision_strong in custom_name_forms
        and verse_supported
        and min(len(hutter_surface), len(ocr_surface)) >= 4
        and custom_name_ocr_similarity >= 0.86
    )
    if similarity < 0.8 and not custom_name_supported:
        return None
    if min(len(hutter_surface), len(ocr_surface)) < 3 and similarity < 0.9:
        return None
    if similarity < 0.9 and not verse_supported:
        return None
    confidence = (
        "high"
        if similarity >= 0.9 and decision.confidence == "high"
        else "medium"
    )
    return MappingDecision(
        strong=decision.strong,
        prefixes=decision.prefixes,
        confidence=confidence,
        method="ocr_crosscheck",
        evidence=(
            f"hutter={hutter_surface}; alternate_ocr={ocr_surface}; "
            f"similarity={similarity:.3f}; ocr_confidence={ocr_confidence}; "
            f"candidate_method={decision.method}; "
            f"same_verse_delitzsch_support={str(verse_supported).lower()}"
        ),
        score=(
            min(0.98, 0.91 + 0.07 * similarity)
            if verse_supported
            else min(0.95, 0.86 + 0.09 * similarity)
        ),
    )


def aligned_spelling_decision(
    hutter_word: str,
    delitzsch_word: dict[str, Any] | None,
) -> MappingDecision | None:
    if not delitzsch_word:
        return None
    hutter_surface = normalize_hebrew(hutter_word)
    delitzsch_surface = normalize_hebrew(str(delitzsch_word.get("text") or ""))
    if not hutter_surface or not delitzsch_surface:
        return None
    ratio = SequenceMatcher(None, hutter_surface, delitzsch_surface).ratio()
    if ratio < 0.78:
        return None
    candidate = candidate_from_word(delitzsch_word)
    if not candidate:
        return None
    return MappingDecision(
        strong=candidate.strong,
        prefixes=candidate.prefixes,
        confidence="medium" if ratio >= 0.86 else "low",
        method="aligned_spelling_variant",
        evidence=(
            f"hutter={hutter_surface}; delitzsch={delitzsch_surface}; "
            f"similarity={ratio:.3f}"
        ),
        score=ratio,
    )


def aligned_custom_name_decision(
    hutter_word: str,
    delitzsch_word: dict[str, Any] | None,
    custom_name_forms: dict[str, set[str]],
) -> MappingDecision | None:
    if not delitzsch_word:
        return None
    strong = base_strong(str(delitzsch_word.get("strong") or ""))
    if not strong or strong not in custom_name_forms:
        return None

    best_score = 0.0
    best_prefixes: tuple[str, ...] = ()
    best_surface = ""
    for prefixes, hutter_surface in prefix_parses(hutter_word):
        if len(hutter_surface) < 4:
            continue
        for custom_surface in sorted(custom_name_forms[strong]):
            score = SequenceMatcher(None, hutter_surface, custom_surface).ratio()
            if score > best_score:
                best_score = score
                best_prefixes = prefixes
                best_surface = custom_surface

    if best_score < 0.72:
        return None
    return MappingDecision(
        strong=composite_strong(best_prefixes, strong),
        prefixes=best_prefixes,
        confidence="high" if best_score >= 0.86 else "medium",
        method="aligned_custom_name",
        evidence=(
            f"hutter={normalize_hebrew(hutter_word)}; custom={best_surface}; "
            f"strong={strong}; similarity={best_score:.3f}"
        ),
        score=min(1.0, best_score + 0.08),
    )


def align_words(
    hutter_words: list[str],
    delitzsch_words: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    hutter_surfaces = [normalize_hebrew(word) for word in hutter_words]
    delitzsch_surfaces = [
        normalize_hebrew(str(word.get("text") or "")) for word in delitzsch_words
    ]
    matcher = SequenceMatcher(None, hutter_surfaces, delitzsch_surfaces, autojunk=False)
    aligned: dict[int, dict[str, Any]] = {}
    for tag, h_start, h_end, d_start, d_end in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(h_end - h_start):
                aligned[h_start + offset] = delitzsch_words[d_start + offset]
            continue
        if tag == "replace" and h_end - h_start == d_end - d_start:
            for offset in range(h_end - h_start):
                aligned[h_start + offset] = delitzsch_words[d_start + offset]
    return aligned


def map_book(
    book: str,
    manual_overrides: dict[str, dict[str, Any]],
    contextual_manual_overrides: dict[
        tuple[str, int, int, str], dict[str, Any]
    ],
    custom_name_forms: dict[str, set[str]],
    contextual_custom_forms: dict[tuple[str, int, int], dict[str, set[str]]],
    contextual_custom_variants: dict[str, Counter[str]],
    pointed_surface_index: dict[str, Counter[StrongCandidate]],
    surface_index: dict[str, Counter[StrongCandidate]],
    base_form_index: dict[str, Counter[str]],
    lemma_index: dict[str, Counter[str]],
    exact_custom_lemma_index: dict[str, Counter[str]],
    include_low_confidence: bool,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    hutter = load_json(HUTTER_ROOT / f"{book}.json")
    delitzsch = load_delitzsch_verses(book)
    ocr_verses = load_ocr_verses(book)
    transliterator = LocalTransliterator()
    chapters: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []

    for chapter in hutter.get("chapters") or []:
        chapter_number = int(chapter.get("number") or 0)
        mapped_verses: list[dict[str, Any]] = []
        for verse in chapter.get("verses") or []:
            verse_number = int(verse.get("number") or 0)
            text = str(verse.get("text_nikud") or "").strip()
            hutter_words = split_hutter_words(text)
            delitzsch_verse = delitzsch.get((chapter_number, verse_number), {})
            delitzsch_words = delitzsch_verse.get("words") or []
            aligned = align_words(hutter_words, delitzsch_words)
            ocr_row = ocr_verses.get((chapter_number, verse_number), {})
            ocr_words = split_hutter_words(str(ocr_row.get("hebrew_text") or ""))
            ocr_alignment = align_similar_words(hutter_words, ocr_words)
            verse_custom_forms = contextual_custom_forms.get(
                (book, chapter_number, verse_number), {}
            )
            mapped_words: list[dict[str, Any]] = []

            for index, word_text in enumerate(hutter_words):
                transliteration = transliterator.transliterate_word(word_text)
                decision = manual_override_decision(
                    contextual_manual_overrides.get(
                        (
                            book,
                            chapter_number,
                            verse_number,
                            normalize_hebrew(word_text),
                        )
                    )
                ) or decide_from_indexes(
                    word_text,
                    manual_overrides,
                    pointed_surface_index,
                    surface_index,
                    base_form_index,
                    lemma_index,
                    exact_custom_lemma_index,
                )
                aligned_decision = aligned_spelling_decision(
                    word_text, aligned.get(index)
                )
                custom_name_decision = aligned_custom_name_decision(
                    word_text, aligned.get(index), custom_name_forms
                )
                verse_custom_decision = contextual_custom_decision(
                    word_text, verse_custom_forms
                )
                custom_variant_decision = contextual_custom_variant_decision(
                    word_text, contextual_custom_variants
                )
                same_verse_decision = same_verse_spelling_decision(
                    word_text, delitzsch_words
                )
                ocr_index = ocr_alignment.get(index)
                ocr_decision = (
                    ocr_crosscheck_decision(
                        word_text,
                        ocr_words[ocr_index],
                        str(ocr_row.get("confidence") or ""),
                        delitzsch_words,
                        manual_overrides,
                        pointed_surface_index,
                        surface_index,
                        base_form_index,
                        lemma_index,
                        exact_custom_lemma_index,
                        custom_name_forms,
                        verse_custom_forms,
                        contextual_custom_variants,
                    )
                    if ocr_index is not None
                    else None
                )
                for custom_decision in (
                    verse_custom_decision,
                    custom_variant_decision,
                    custom_name_decision,
                ):
                    if custom_decision and (
                        decision is None or custom_decision.score > decision.score + 0.04
                    ):
                        decision = custom_decision
                if aligned_decision and (
                    decision is None or aligned_decision.score > decision.score + 0.08
                ):
                    decision = aligned_decision
                if decision is None or (
                    decision.confidence == "low" and not include_low_confidence
                ):
                    decision = ocr_decision or same_verse_decision

                if decision and (
                    decision.confidence != "low" or include_low_confidence
                ):
                    mapped_words.append(
                        {
                            "text": word_text,
                            "translit_en": transliteration.translit_en,
                            "translit_es": transliteration.translit_es,
                            "strong": decision.strong,
                            "prefixes": list(decision.prefixes),
                            "mapping_confidence": decision.confidence,
                            "mapping_method": decision.method,
                            "mapping_evidence": decision.evidence,
                        }
                    )
                    continue

                mapped_words.append(
                    {
                        "text": word_text,
                        "translit_en": transliteration.translit_en,
                        "translit_es": transliteration.translit_es,
                        "prefixes": [],
                        "mapping_confidence": "unresolved",
                        "mapping_method": "unresolved",
                        "mapping_evidence": unresolved_reason(aligned.get(index)),
                    }
                )
                unresolved.append(
                    {
                        "book": book,
                        "chapter": chapter_number,
                        "verse": verse_number,
                        "position": index + 1,
                        "text": word_text,
                        "normalized": normalize_hebrew(word_text),
                        "aligned_delitzsch_word": aligned.get(index),
                        "reason": unresolved_reason(aligned.get(index)),
                    }
                )

            mapped_verses.append(
                {
                    "chapter": chapter_number,
                    "verse": verse_number,
                    "hebrew": text,
                    "words": mapped_words,
                }
            )

        chapters.append({"chapter": chapter_number, "verses": mapped_verses})

    return (
        {
            "book": book,
            "source": "Elias Hutter",
            "mapping_source": "Davar corpus and lexicon alignment",
            "chapters": chapters,
        },
        unresolved,
    )


def unresolved_reason(delitzsch_word: dict[str, Any] | None) -> str:
    if not delitzsch_word:
        return (
            "No reliable attested form, lexicon lemma, custom verse-context match, "
            "or aligned Delitzsch token; automatic assignment would be unsupported."
        )
    if not candidate_from_word(delitzsch_word):
        return (
            "The aligned Delitzsch token has no reviewed mapping, and no independent "
            "lexical or custom evidence supports this Hutter form."
        )
    return (
        "The available Delitzsch token is not a sufficiently similar spelling; "
        "positional borrowing was rejected because wording or word order may differ."
    )


def build_unresolved_queue(unresolved: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in unresolved:
        grouped[str(item["normalized"])].append(item)
    queue: list[dict[str, Any]] = []
    for normalized, occurrences in grouped.items():
        forms = sorted({str(item["text"]) for item in occurrences})
        reasons = Counter(str(item["reason"]) for item in occurrences)
        queue.append(
            {
                "normalized": normalized,
                "forms": forms,
                "occurrence_count": len(occurrences),
                "books": sorted({str(item["book"]) for item in occurrences}),
                "reason_counts": dict(sorted(reasons.items())),
                "first_occurrence": (
                    f"{occurrences[0]['book']} {occurrences[0]['chapter']}:"
                    f"{occurrences[0]['verse']}#{occurrences[0]['position']}"
                ),
            }
        )
    return sorted(
        queue,
        key=lambda item: (-int(item["occurrence_count"]), str(item["normalized"])),
    )


def main() -> int:
    args = parse_args()
    available_books = sorted(
        path.stem
        for path in HUTTER_ROOT.glob("*.json")
        if (DELITZSCH_ROOT / path.stem).is_dir()
    )
    books = args.books or available_books
    missing = [book for book in books if book not in available_books]
    if missing:
        raise SystemExit(f"Unknown or non-New-Testament Hutter books: {', '.join(missing)}")

    (
        pointed_surface_index,
        surface_index,
        base_form_index,
        lemma_index,
        exact_custom_lemma_index,
    ) = build_indexes()
    manual_overrides, contextual_manual_overrides = load_manual_overrides()
    custom_name_forms = load_custom_name_forms()
    contextual_custom_forms = load_contextual_custom_forms()
    contextual_custom_variants = build_contextual_custom_variant_index(
        books, contextual_custom_forms
    )
    output_root = args.output_root.expanduser().resolve()
    report_path = args.report.expanduser().resolve()
    all_unresolved: list[dict[str, Any]] = []
    book_summaries: list[dict[str, Any]] = []
    mapping_method_counts: Counter[str] = Counter()
    pending_payloads: dict[str, dict[str, Any]] = {}

    for book in books:
        payload, unresolved = map_book(
            book,
            manual_overrides,
            contextual_manual_overrides,
            custom_name_forms,
            contextual_custom_forms,
            contextual_custom_variants,
            pointed_surface_index,
            surface_index,
            base_form_index,
            lemma_index,
            exact_custom_lemma_index,
            args.include_low_confidence,
        )
        words = [
            word
            for chapter in payload["chapters"]
            for verse in chapter["verses"]
            for word in verse["words"]
        ]
        confidence_counts = Counter(
            str(word.get("mapping_confidence") or "unresolved") for word in words
        )
        book_method_counts = Counter(
            str(word.get("mapping_method") or "unresolved") for word in words
        )
        mapping_method_counts.update(book_method_counts)
        book_summaries.append(
            {
                "book": book,
                "verse_count": sum(
                    len(chapter["verses"]) for chapter in payload["chapters"]
                ),
                "word_count": len(words),
                "mapped_count": len(words) - len(unresolved),
                "unresolved_count": len(unresolved),
                "coverage": (
                    (len(words) - len(unresolved)) / len(words) if words else 0.0
                ),
                "confidence_counts": dict(sorted(confidence_counts.items())),
                "mapping_method_counts": dict(sorted(book_method_counts.items())),
            }
        )
        all_unresolved.extend(unresolved)

        if args.write:
            pending_payloads[book] = payload

    total_words = sum(item["word_count"] for item in book_summaries)
    total_unresolved = len(all_unresolved)

    if args.morphology:
        from scripts.hutter.morphology import (
            backtest_morphology,
            build_review_queue,
            write_review_queue,
        )

        queue = build_review_queue(
            all_unresolved,
            lemma_index,
            base_form_index,
        )

        # Backtest only explicit reviewed overrides; ordinary automatic mappings
        # are not a gold standard. Never label the entire output reviewed.
        ground_truth: list[tuple[str, str]] = []
        for book in books:
            mapping = load_json(DEFAULT_OUTPUT_ROOT / f"{book}.json")
            for chapter in mapping.get("chapters") or []:
                for verse in chapter.get("verses") or []:
                    for word in verse.get("words") or []:
                        strong = word.get("strong")
                        if strong and word.get("text") and word.get("mapping_method") == "manual_override":
                            ground_truth.append((word["text"], strong))
        backtest = backtest_morphology(
            ground_truth,
            lemma_index,
            base_form_index,
        )
        backtest["proposed_auto_accept_forms"] = sum(row["review_status"] == "auto_accepted" for row in queue)
        backtest["applied_mappings"] = 0
        for row in queue:
            row["backtest_gate_passed"] = backtest["gate_passed"]
            if row["review_status"] == "auto_accepted":
                row["review_status"] = "review"
                row["reason"] = "precision_gate_failed" if not backtest["gate_passed"] else "requires_same_verse_and_prefix_validation_before_application"
        write_review_queue(queue, args.morphology_queue)
        args.morphology_backtest.parent.mkdir(parents=True, exist_ok=True)
        args.morphology_backtest.write_text(
            json.dumps(backtest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps({"morphology_queue": len(queue), "backtest": {k: v for k, v in backtest.items() if k != "regressions"}}, ensure_ascii=False, indent=2))
        print(f"  queue: {args.morphology_queue}")
        print(f"  backtest: {args.morphology_backtest}")
        return 0 if backtest["gate_passed"] else 2

    report = {
        "books": book_summaries,
        "totals": {
            "book_count": len(book_summaries),
            "word_count": total_words,
            "mapped_count": total_words - total_unresolved,
            "unresolved_count": total_unresolved,
            "coverage": (
                (total_words - total_unresolved) / total_words if total_words else 0.0
            ),
            "mapping_method_counts": dict(sorted(mapping_method_counts.items())),
        },
        "unresolved": all_unresolved,
        "unresolved_queue": build_unresolved_queue(all_unresolved),
    }

    if args.write:
        if report_path.exists() and not args.allow_coverage_regression:
            previous = load_json(report_path)
            previous_mapped = int(previous.get("totals", {}).get("mapped_count") or 0)
            if report["totals"]["mapped_count"] < previous_mapped:
                raise SystemExit(
                    "Refusing coverage regression: "
                    f"{report['totals']['mapped_count']} mapped words would replace "
                    f"the existing {previous_mapped}. Pass --allow-coverage-regression "
                    "only after review."
                )
        output_root.mkdir(parents=True, exist_ok=True)
        for book, payload in pending_payloads.items():
            (output_root / f"{book}.json").write_text(
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    print(json.dumps(report["totals"], ensure_ascii=False, indent=2))
    for summary in book_summaries:
        print(
            f"{summary['book']}: {summary['mapped_count']}/{summary['word_count']} "
            f"({summary['coverage']:.1%}) unresolved={summary['unresolved_count']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
