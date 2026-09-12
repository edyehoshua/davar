"""Pointed, segmented candidates from the checked-in OSHB corpus.

OSHB annotations are CC BY 4.0 (Open Scriptures Hebrew Bible contributors).
The XML source, word id and morphology are retained for each analysis. This
module proposes analyses only; Hutter transcription is never rewritten.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from scripts.hutter.map_strongs import normalize_pointed_hebrew
from scripts.hutter.morphology import is_yhwh_surface

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data/dict/raw/morphus"
NS = {"o": "http://www.bibletechnologies.net/2003/OSIS/namespace"}
PREFIXES = {"c": "Hc", "d": "Hd", "b": "Hb", "k": "Hk", "l": "Hl", "m": "Hm", "s": "Hs"}


@dataclass(frozen=True, order=True)
class Attestation:
    strong: str
    prefixes: tuple[str, ...]
    morphology: str
    segments: tuple[str, ...]
    source: str
    word_id: str


def load_attestations(source: Path = SOURCE) -> dict[str, tuple[Attestation, ...]]:
    """Index complete forms and explicitly annotated prefix-free inflections.

    Pronominal suffixes stay attached to the lexical segment. In particular,
    conjugation markers are never converted into Davar preposition prefixes.
    Ambiguous lemma annotations and Aramaic forms are excluded.
    """
    index: dict[str, set[Attestation]] = defaultdict(set)
    for path in sorted(source.glob("*.xml")):
        for word in ET.parse(path).findall(".//o:w", NS):
            morph = word.get("morph", "")
            if not morph.startswith("H"):
                continue
            lemma = word.get("lemma", "").split("/")
            match = re.fullmatch(r"([0-9]+)(?: [a-z])?", lemma[-1])
            if not match or any(part not in PREFIXES for part in lemma[:-1]):
                continue
            segments = tuple("".join(word.itertext()).split("/"))
            codes = morph[1:].split("/")
            prefix_count = len(lemma) - 1
            if len(segments) != len(codes) or len(segments) <= prefix_count:
                continue
            prefixes = tuple(PREFIXES[p] for p in lemma[:-1])
            # Retain only segmentation explicitly present in the source.
            for drop in range(prefix_count + 1):
                surface = normalize_pointed_hebrew("".join(segments[drop:]))
                if not surface or is_yhwh_surface(surface):
                    continue
                index[surface].add(Attestation(
                    "H" + str(int(match[1])), prefixes[drop:],
                    "H" + "/".join(codes[drop:]), segments[drop:],
                    path.name, word.get("id", ""),
                ))
    return {key: tuple(sorted(value)) for key, value in sorted(index.items())}


def propose(surface: str, index: dict[str, tuple[Attestation, ...]],
            semantic_support: set[str] | None = None) -> dict:
    """Require a unique full Strong/prefix analysis and same-verse support.

    Semantic support cannot eliminate a pointed homograph: every rival is
    retained, even when it does not occur in the Delitzsch verse.
    """
    matches = index.get(normalize_pointed_hebrew(surface), ())
    analyses = {(item.strong, item.prefixes) for item in matches}
    unique = len(analyses) == 1
    strong, prefixes = next(iter(analyses)) if unique else (None, ())
    supported = strong is not None and strong in (semantic_support or set())
    reason = ("no_pointed_attestation" if not matches else
              "competing_lexical_or_prefix_analyses" if not unique else
              "missing_same_verse_support" if not supported else
              "requires_held_out_validation")
    grouped = defaultdict(list)
    for item in matches:
        grouped[(item.strong, item.prefixes, item.morphology, item.segments)].append(item)
    evidence = []
    for (candidate, codes, morphology, segments), attestations in sorted(grouped.items()):
        evidence.append({
            "strong": candidate, "prefixes": list(codes), "morphology": morphology,
            "segments": segments, "attestation_count": len(attestations),
            "source_examples": [{"source": a.source, "word_id": a.word_id} for a in attestations[:3]],
        })
    return {
        "strong": strong, "prefixes": list(prefixes),
        "method": "pointed_oshb_attestation", "confidence": "review",
        "score": 1.0 if unique else 0.0,
        "score_definition": "exact pointed match and unique composite analysis; not a calibrated probability",
        "eligible": unique and supported, "reason": reason,
        "evidence": evidence, "applied": False,
    }
