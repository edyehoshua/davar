"""Reproducible benchmark and regression gate for transliteration outputs."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from .local_translit import LocalTransliterator


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def score_cases(cases: list[dict[str, Any]]) -> dict[str, Any]:
    if not cases:
        raise ValueError("Benchmark must contain reviewed cases")
    if len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Duplicate benchmark identity")
    transliterator = LocalTransliterator()
    results = []
    exact = 0
    normalized = 0
    for case in cases:
        result = transliterator.transliterate_word(case["hebrew"])
        expected_en = case["expected_en"]
        expected_es = case["expected_es"]
        is_exact = result.translit_en == expected_en and result.translit_es == expected_es
        is_normalized = _normalize(result.translit_en) == _normalize(expected_en) and _normalize(result.translit_es) == _normalize(expected_es)
        exact += int(is_exact)
        normalized += int(is_normalized)
        results.append({"id": case["id"], "exact": is_exact, "normalized": is_normalized, "actual_en": result.translit_en, "actual_es": result.translit_es})
    total = len(cases)
    return {"total": total, "exact_matches": exact, "normalized_matches": normalized, "exact_rate": exact / total if total else 1.0, "normalized_rate": normalized / total if total else 1.0, "cases": results}


def main() -> int:
    parser = argparse.ArgumentParser(description="Score deterministic transliteration against approved benchmark cases")
    parser.add_argument("benchmark", type=Path)
    parser.add_argument("--fail-under", type=float, default=1.0, help="Minimum exact-match rate")
    parser.add_argument("--report", type=Path, help="Write the JSON report to this path")
    args = parser.parse_args()
    report = score_cases(json.loads(args.benchmark.read_text(encoding="utf-8")))
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if report["exact_rate"] >= args.fail_under else 1


if __name__ == "__main__":
    raise SystemExit(main())
