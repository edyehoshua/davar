"""Morphology-aware candidate analysis for unresolved Elias Hutter Hebrew forms.

This module implements a bounded, deterministic morphology pass that complements
the exact-surface and prefix-only stages in ``map_strongs``.  It is deliberately
conservative: it never assigns a Strong from word position, and it only
auto-accepts a candidate that is unique and above a documented confidence
threshold with a margin over the runner-up.  Anything ambiguous is routed to a
review queue with all evidence visible.

The exported primitives are pure functions over the same normalized surfaces the
rest of the Hutter pipeline uses, so they are fully unit-testable without a
corpus write.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, asdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable

# Hebrew prefix codes keyed by first consonant (mirrors map_strongs.PREFIX_CODES).
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
HEBREW_MARK_RE = re.compile(r"[\u0591-\u05C7]")
NON_HEBREW_RE = re.compile(r"[^א-ת]")
YHWH_NORMALIZED = "יהוה"


def is_yhwh_surface(surface: str) -> bool:
    """True when the surface is the Tetragrammaton, with or without prefixes."""
    normalized = normalize_hebrew(surface)
    if not normalized:
        return False
    if YHWH_NORMALIZED in normalized:
        return True
    remaining = normalized
    for _ in range(3):
        if remaining and remaining[0] in PREFIX_CODES:
            remaining = remaining[1:]
        else:
            break
    return remaining == YHWH_NORMALIZED


# Pronominal / possessive / objective suffixes and common verbal endings on the
# *normalized (unpointed, final-regularized)* stem.  Stripping these surfaces a
# recognisable root even when the exact pointed form is not attested.
# Each entry: (suffix_consonants, role_label).
INFLECTIONAL_SUFFIXES: tuple[tuple[str, str], ...] = (
    ("הו", "3ms_object"),
    ("הם", "3mp_possessive"),
    ("הן", "3fp_possessive"),
    ("ני", "1cs_object"),
    ("יכם", "2mp_possessive"),
    ("כן", "2fp_possessive"),
    ("נו", "1cp_possessive"),
    ("יך", "2fs_possessive"),
    ("ך", "2ms_possessive"),
    ("כם", "2mp_possessive"),
    ("הם", "3mp_possessive"),
    ("הן", "3fp_possessive"),
    ("ותם", "3mp_plural_possessive"),
    ("ותיך", "2fs_plural_possessive"),
    ("ותינו", "1cp_plural_possessive"),
    ("יה", "3ms_singular_possessive"),
    ("יך", "2fs_singular_possessive"),
    ("י", "1cs_singular_possessive"),
    ("ים", "mp_plural"),
    ("ות", "fp_plural"),
    ("ה", "3ms_suffix_h"),
    ("ו", "3mp_plural_verb"),
    ("ת", "2ms_verb/fem"),
    ("ם", "3mp_object"),
    ("ן", "3fp"),
)

# Weak-root endings that frequently collapse in printed Hutter spelling.
WEAK_ROOT_RE = re.compile(r"([אהע])(ו|י)$")


@dataclass(frozen=True)
class MorphParse:
    """A single morphological parse of a Hutter surface form."""

    prefixes: tuple[str, ...]
    stem: str
    suffixes: tuple[str, ...]
    parse_label: str


@dataclass(frozen=True)
class MorphCandidate:
    """A stem -> Strong candidate with its scoring evidence."""

    strong: str
    prefixes: tuple[str, ...]
    parse: MorphParse
    base_score: float
    suffix_penalty: float
    score: float
    corpus_count: int
    evidence: str


@dataclass(frozen=True)
class MorphDecision:
    """Auto-acceptable or review-routed morphology decision."""

    strong: str | None
    prefixes: tuple[str, ...]
    confidence: str  # high | medium | low | unresolved
    method: str
    evidence: str
    score: float
    review_status: str  # auto_accepted | review | unresolved
    candidates: tuple[MorphCandidate, ...] = ()


def normalize_hebrew(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    normalized = HEBREW_MARK_RE.sub("", normalized)
    normalized = normalized.translate(FINAL_TO_MEDIAL)
    return NON_HEBREW_RE.sub("", normalized)


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


def _strip_suffix(stem: str) -> list[tuple[str, tuple[str, ...], str]]:
    """Return (remaining_stem, suffixes, label) parses for a normalized stem.

    Tries the longest suffixes first so that e.g. ``ותם`` beats ``ת`` + ``ם``.
    A second pass permits bounded chains such as a verbal ``ו`` ending followed
    by an object ``ם`` suffix, while avoiding unbounded over-segmentation.
    """
    ordered = sorted(
        INFLECTIONAL_SUFFIXES,
        key=lambda item: -len(normalize_hebrew(item[0])),
    )
    normalized_suffixes = [
        (suffix, label, normalize_hebrew(suffix))
        for suffix, label in ordered
        if normalize_hebrew(suffix)
    ]
    results: list[tuple[str, tuple[str, ...], str]] = [(stem, (), "lexical")]
    seen: set[tuple[str, tuple[str, ...]]] = {(stem, ())}
    pending: list[tuple[str, tuple[str, ...], str]] = [(stem, (), "lexical")]

    for _ in range(2):
        next_pending: list[tuple[str, tuple[str, ...], str]] = []
        for current, suffixes, label in pending:
            for suffix, suffix_label, normalized_suffix in normalized_suffixes:
                if len(current) - len(normalized_suffix) < 2 or not current.endswith(
                    normalized_suffix
                ):
                    continue
                remaining = current[: -len(normalized_suffix)]
                combined_suffixes = (suffix, *suffixes)
                combined_label = (
                    suffix_label if not suffixes else f"{suffix_label}+{label}"
                )
                key = (remaining, combined_suffixes)
                if key not in seen:
                    seen.add(key)
                    candidate = (remaining, combined_suffixes, combined_label)
                    results.append(candidate)
                    next_pending.append(candidate)
        pending = next_pending

    # Also record weak-root variants for every segmented candidate.
    for remaining, suffixes, label in list(results):
        if not suffixes:
            continue
        weak_match = WEAK_ROOT_RE.search(remaining)
        if weak_match:
            variant = remaining[: weak_match.start()] + weak_match.group(1)
            key = (variant, suffixes)
            if key not in seen:
                seen.add(key)
                results.append((variant, suffixes, label + "_weak_root"))
    return results


def analyze_form(surface: str, max_prefixes: int = 3) -> list[MorphParse]:
    """Generate all prefix+stem+suffix parses for a Hutter surface form."""
    parses: list[MorphParse] = []
    for prefixes, root_surface in prefix_parses(surface, max_prefixes):
        for stem, suffixes, label in _strip_suffix(root_surface):
            parses.append(MorphParse(prefixes=prefixes, stem=stem, suffixes=suffixes, parse_label=label))
    # De-duplicate while preserving order.
    seen: set[tuple[tuple[str, ...], str, tuple[str, ...]]] = set()
    unique: list[MorphParse] = []
    for parse in parses:
        key = (parse.prefixes, parse.stem, parse.suffixes)
        if key in seen:
            continue
        seen.add(key)
        unique.append(parse)
    return unique


def _best_counter(counter: Counter[str]) -> tuple[str | None, int]:
    if not counter:
        return None, 0
    strong, count = counter.most_common(1)[0]
    return strong, count


def morphology_decision(
    surface: str,
    lemma_index: dict[str, Counter[str]],
    base_form_index: dict[str, Counter[str]],
    *,
    auto_accept_threshold: float = 0.86,
    margin: float = 0.12,
) -> MorphDecision | None:
    """Score morphology parses against the lexicon and attested corpus.

    Auto-accepts only when *one* candidate is above ``auto_accept_threshold``
    and beats every other candidate by at least ``margin``.  Otherwise routes to
    review (or unresolved when nothing matches).

    ``lemma_index`` maps normalised lemma -> Counter[Strong] and
    ``base_form_index`` maps attested normalised stem -> Counter[Strong].
    """
    if is_yhwh_surface(surface):
        return MorphDecision(
            strong=None,
            prefixes=(),
            confidence="unresolved",
            method="morphology",
            evidence=f"yhwh_skip; no morphology for {normalize_hebrew(surface)}",
            score=0.0,
            review_status="unresolved",
        )

    parsed = analyze_form(surface)
    if not parsed:
        return None

    candidates: list[MorphCandidate] = []
    for parse in parsed:
        lemmas = lemma_index.get(parse.stem, Counter())
        attested = base_form_index.get(parse.stem, Counter())
        for strong in sorted(set(lemmas) | set(attested)):
            corpus_count = attested.get(strong, 0)
            base_score = 0.98 if strong in lemmas and strong in attested else 0.92 if strong in attested else 0.78
            suffix_penalty = 0.03 * len(parse.suffixes) + (0.05 if parse.parse_label.endswith("_weak_root") else 0)
            score = base_score - suffix_penalty - 0.02 * len(parse.prefixes)
            candidates.append(MorphCandidate(strong=strong, prefixes=parse.prefixes, parse=parse,
                base_score=base_score, suffix_penalty=suffix_penalty, score=score,
                corpus_count=corpus_count, evidence=f"parse={parse.parse_label}; stem={parse.stem}; prefixes={parse.prefixes}; suffixes={parse.suffixes}; attested_count={corpus_count}; lemma_count={lemmas.get(strong, 0)}"))

    if not candidates:
        return MorphDecision(
            strong=None,
            prefixes=(),
            confidence="unresolved",
            method="morphology",
            evidence=f"no_lexical_or_attested_stem_match for {normalize_hebrew(surface)}",
            score=0.0,
            review_status="unresolved",
        )

    candidates.sort(key=lambda item: (-item.score, item.strong, item.prefixes, item.parse.stem, item.parse.suffixes))
    top = candidates[0]

    # Resolve a tie on the same Strong / same prefixes by keeping the best parse.
    best: MorphCandidate = top
    if top.score >= auto_accept_threshold:
        # Count how many *distinct Strongs* are within the margin.
        rival_best = None
        for candidate in candidates[1:]:
            if candidate.strong == best.strong and candidate.prefixes == best.prefixes:
                continue
            rival_best = candidate
            break
        if rival_best and (best.score - rival_best.score) < margin:
            # Ambiguous across distinct roots -> review.
            return MorphDecision(
                strong=best.strong,
                prefixes=best.prefixes,
                confidence="low",
                method="morphology",
                evidence=(
                    f"ambiguous_margin; top={best.strong} score={best.score:.3f}; "
                    f"rival={rival_best.strong} score={rival_best.score:.3f}; {best.evidence}"
                ),
                score=best.score,
                review_status="review", candidates=tuple(candidates),
            )
        return MorphDecision(
            strong=best.strong,
            prefixes=best.prefixes,
            confidence="medium" if best.score >= auto_accept_threshold else "low",
            method="morphology",
            evidence=f"auto_accepted; {best.evidence}",
            score=best.score,
            review_status="auto_accepted", candidates=tuple(candidates),
        )

    # Below the auto-accept threshold: route to image review with the parse.
    return MorphDecision(
        strong=best.strong,
        prefixes=best.prefixes,
        confidence="low",
        method="morphology",
        evidence=f"review; {best.evidence}",
        score=best.score,
        review_status="review", candidates=tuple(candidates),
    )


# --------------------------------------------------------------------------- #
# Review queue
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class ReviewItem:
    strong: str | None
    prefixes: tuple[str, ...]
    score: float
    parse_label: str
    reason: str
    review_status: str


def build_review_queue(
    unresolved: list[dict[str, Any]],
    lemma_index: dict[str, Counter[str]],
    base_form_index: dict[str, Counter[str]],
    *,
    auto_accept_threshold: float = 0.86,
    margin: float = 0.12,
) -> list[dict[str, Any]]:
    """Build an actionable, deduplicated review queue from unresolved tokens."""
    queue = {}
    root = Path(__file__).resolve().parents[2]
    images = {}
    for path in sorted((root / "data/hutter/manifests").glob("*_verse_images.json")):
        for entry in json.loads(path.read_text()).get("entries", []):
            images[(entry.get("book"), entry.get("chapter"), entry.get("verse"))] = entry
    for item in unresolved:
        surface = str(item.get("text") or "")
        normalized = normalize_hebrew(surface)
        decision = morphology_decision(surface, lemma_index, base_form_index,
            auto_accept_threshold=auto_accept_threshold, margin=margin)
        if not normalized or decision is None:
            continue
        row = queue.setdefault(normalized, {"normalized": normalized, "occurrence_count": 0,
            "first_occurrence": f"{item.get('book')} {item.get('chapter')}:{item.get('verse')}#{item.get('position')}",
            "proposed_strongs": sorted({c.strong for c in decision.candidates}),
            "proposed_parse": decision.evidence, "reason": decision.evidence,
            "review_status": decision.review_status, "candidates": [asdict(c) for c in decision.candidates], "occurrences": []})
        row["occurrence_count"] += 1
        evidence = images.get((item.get("book"), item.get("chapter"), item.get("verse")), {})
        row["occurrences"].append({**item, "source_image": evidence.get("source_image"), "crop_image": evidence.get("output_image"), "applied": False})
    return [queue[key] for key in sorted(queue)]


# --------------------------------------------------------------------------- #
# Backtest over already-reviewed mappings
# --------------------------------------------------------------------------- #
def backtest_morphology(
    ground_truth: list[tuple[str, str]],
    lemma_index: dict[str, Counter[str]],
    base_form_index: dict[str, Counter[str]],
    *,
    auto_accept_threshold: float = 0.86,
    margin: float = 0.12,
) -> dict[str, Any]:
    """Backtest the morphology auto-accept rules against reviewed mappings.

    ``ground_truth`` is a list of ``(surface, expected_strong)`` from previously
    image-reviewed Hutter mappings.  Only surfaces that this pass would
    auto-accept are counted as precision contributors; surfaces it would route to
    review reduce recall but are *not* regressions.
    """
    tp = 0
    fp = 0
    reviewed = 0
    mismatches: list[dict[str, str]] = []
    for surface, expected in ground_truth:
        decision = morphology_decision(
            surface,
            lemma_index,
            base_form_index,
            auto_accept_threshold=auto_accept_threshold,
            margin=margin,
        )
        if decision is None or decision.review_status != "auto_accepted":
            reviewed += 1
            continue
        if decision.strong == expected.split("/")[-1]:
            tp += 1
        else:
            fp += 1
            mismatches.append(
                {
                    "surface": surface,
                    "expected": expected,
                    "got": decision.strong or "",
                    "evidence": decision.evidence,
                }
            )
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    return {
        "true_positives": tp,
        "false_positives": fp,
        "routed_to_review": reviewed,
        "precision": round(precision, 4),
        "gate_threshold": 0.98,
        "gate_passed": precision >= 0.98 and tp + fp >= 100,
        "ground_truth_count": len(ground_truth),
        "scope": "previously reviewed manual overrides; lexical Strong precision; prefix correctness is separate",
        "regressions": mismatches,
    }


def write_review_queue(
    queue: list[dict[str, Any]],
    output_path: Path,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "queue": queue,
        "method": "morphology_analysis",
        "note": "morphology candidates for image review, including auto-accepted; no positional borrowing; Tetragrammaton skipped",
    }
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
