#!/usr/bin/env python3
"""Audit Bani transliteration syllable structure against Strong's ``pron``.

The audit is intentionally conservative: it measures only syllable-count
agreement, not scholarly equivalence of every consonant/vowel choice.  Entries
without Hebrew text or a hyphenated ``pron`` reference are excluded and listed
in the report metadata.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from transliterate import BaniTransliterator  # noqa: E402


def pron_syllables(pron: str) -> list[str]:
    """Return non-empty Strong's pronunciation syllables."""
    return [part.strip().replace("'", "") for part in re.split(r"[-\s]+", pron) if part.strip()]


def audit(data: list[dict[str, Any]], language: str = "en") -> dict[str, Any]:
    transliterator = BaniTransliterator(language)
    eligible = 0
    matches = 0
    excluded = 0
    mismatches: list[dict[str, Any]] = []

    for entry in data:
        strongs = entry.get("id", "")
        hebrew = entry.get("hebrew", "")
        pron = entry.get("pron", "")
        syllables = pron_syllables(pron) if pron else []
        if not hebrew or len(syllables) < 2:
            excluded += 1
            continue

        eligible += 1
        translit = transliterator.transliterate(hebrew, strongs)
        actual = transliterator.transliterator.split_into_syllables(translit.lower())
        expected_count = len(syllables)
        actual_count = len(actual)
        if expected_count == actual_count:
            matches += 1
            continue

        mismatches.append(
            {
                "id": strongs,
                "hebrew": hebrew,
                "pron": pron,
                "expected_syllables": syllables,
                "expected_count": expected_count,
                "translit": translit,
                "actual_syllables": actual,
                "actual_count": actual_count,
            }
        )

    rate = (matches / eligible * 100) if eligible else 0.0
    return {
        "language": language,
        "metric": "Strong's pron syllable-count agreement",
        "eligible": eligible,
        "matches": matches,
        "mismatches": len(mismatches),
        "excluded": excluded,
        "agreement_percent": round(rate, 4),
        "threshold_percent": 95.0,
        "threshold_met": rate >= 95.0,
        "mismatch_examples": mismatches,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=HERE / "data" / "strongs.json",
        help="Strong's JSON dataset (default: tools/bani/data/strongs.json)",
    )
    parser.add_argument("--language", choices=("en", "es"), default="en")
    parser.add_argument("--output", type=Path, help="Write the full JSON report here")
    args = parser.parse_args()

    with args.input.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError(f"Expected a list of Strong's entries, got {type(data).__name__}")

    report = audit(data, args.language)
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(serialized, encoding="utf-8")
    print(
        f"{report['language']}: {report['matches']}/{report['eligible']} "
        f"({report['agreement_percent']:.2f}%) syllable-count agreement; "
        f"threshold_met={report['threshold_met']}"
    )
    return 0 if report["threshold_met"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
