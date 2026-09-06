#!/usr/bin/env python3
"""Benchmark and determinism check for the dictionary instance policy.

This is intentionally small and dependency-free so release QA can run it in CI
or in a clean checkout. The report is JSON and keeps generated-output evidence
separate from the policy implementation.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from instance_policy import process_instances  # noqa: E402


def make_instances(count: int) -> list[dict[str, object]]:
    return [
        {
            "stable_id": f"benchmark-{index}",
            "book": "Genesis",
            "chapter": index // 50 + 1,
            "verse": index % 50 + 1,
            "word_positions": [index % 8],
            "confidence": (index % 10) / 10,
            "linguistic_signal": (index % 3) / 2,
            "canonical_source_priority": index % 2,
            "display": "sample",
        }
        for index in range(count)
    ]


def run(sizes: list[int]) -> dict[str, object]:
    rows = []
    for size in sizes:
        instances = make_instances(size)
        started = time.perf_counter()
        result = process_instances(instances)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        repeat = process_instances(list(reversed(instances)))
        assert result["is_valid"] and result["instance_total"] == size
        assert result["instances"] == repeat["instances"]
        rows.append(
            {
                "instances": size,
                "elapsed_ms": elapsed_ms,
                "tier": result["tier"],
                "instance_total": result["instance_total"],
                "surface_count": result["instance_surface_count"],
                "omitted_count": result["omitted_count"],
                "validation_errors": len(result["validation_errors"]),
                "deterministic_order": [item["stable_id"] for item in result["instances"]]
                == [item["stable_id"] for item in repeat["instances"]],
            }
        )
    return {"policy_version": "1.1", "sizes": rows}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = run([100, 1_000, 10_000])
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
