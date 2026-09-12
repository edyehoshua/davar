"""Read-only, form-grouped validation of pointed OSHB Hutter candidates."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.hutter.attested_morphology import SOURCE, load_attestations, propose
from scripts.hutter.map_strongs import DEFAULT_OUTPUT_ROOT, base_strong, load_delitzsch_verses
from scripts.hutter.morphology import normalize_hebrew


def split_for(surface: str) -> str:
    """Keep every occurrence and pointing variant of a consonantal form together."""
    digest = hashlib.sha256(normalize_hebrew(surface).encode()).digest()
    return "validation" if digest[0] % 2 else "development"


def summarize(rows: list[dict]) -> dict:
    # A frequently repeated override must not inflate the 100-example gate.
    groups = {}
    for row in rows:
        groups.setdefault(normalize_hebrew(row["text"]), []).append(row)
    accepted = [group for group in groups.values() if any(r["proposal"]["eligible"] for r in group)]
    lexical_tp = composite_tp = 0
    regressions = []
    for group in accepted:
        eligible = [r for r in group if r["proposal"]["eligible"]]
        lexical_ok = all(r["proposal"]["strong"] == base_strong(r["expected"]) for r in eligible)
        composite_ok = all("/".join([*r["proposal"]["prefixes"], r["proposal"]["strong"]]) == r["expected"] for r in eligible)
        lexical_tp += lexical_ok
        composite_tp += composite_ok
        regressions.extend(r for r in eligible if
            "/".join([*r["proposal"]["prefixes"], r["proposal"]["strong"]]) != r["expected"])
    n = len(accepted)
    return {
        "reviewed_occurrences": len(rows), "reviewed_form_groups": len(groups),
        "accepted_form_groups": n,
        "lexical_true_positives": lexical_tp, "lexical_false_positives": n - lexical_tp,
        "composite_true_positives": composite_tp, "composite_false_positives": n - composite_tp,
        "lexical_precision": lexical_tp / n if n else 0,
        "composite_precision": composite_tp / n if n else 0,
        "gate_passed": n >= 100 and lexical_tp / n >= .98 and composite_tp / n >= .98,
        "regressions": regressions,
    }


def evaluate() -> dict:
    index = load_attestations()
    reviewed = []
    unresolved = []
    images = {}
    for path in sorted((ROOT / "data/hutter/manifests").glob("*_verse_images.json")):
        for entry in json.loads(path.read_text()).get("entries", []):
            images.setdefault((entry.get("book"), entry.get("chapter"), entry.get("verse")), []).append(entry)
    for path in sorted(DEFAULT_OUTPUT_ROOT.glob("*.json")):
        mapping = json.loads(path.read_text())
        context = load_delitzsch_verses(path.stem)
        for chapter in mapping["chapters"]:
            for verse in chapter["verses"]:
                key = (chapter["chapter"], verse["verse"])
                support = {base_strong(w.get("strong")) for w in context.get(key, {}).get("words", []) if w.get("strong")}
                image_entries = images.get((path.stem, *key), [])
                for position, word in enumerate(verse["words"], 1):
                    if word.get("strong") and word.get("mapping_method") != "manual_override":
                        continue
                    row = {
                        "book": path.stem, "chapter": key[0], "verse": key[1],
                        "position": position, "text": word["text"], "expected": word.get("strong"),
                        "split": split_for(word["text"]),
                        "images": [{"source_image": image.get("source_image"), "crop_image": image.get("output_image")}
                                   for image in image_entries],
                        "semantic_support": sorted(support),
                        "proposal": propose(word["text"], index, support),
                    }
                    (reviewed if word.get("strong") else unresolved).append(row)
    splits = {split: summarize([r for r in reviewed if r["split"] == split])
              for split in ("development", "validation")}
    return {
        "schema_version": 1, "source": "data/dict/raw/morphus (OSHB, CC BY 4.0)",
        "source_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(SOURCE.glob("*.xml"))},
        "method": "Exact pointed, explicitly segmented attestation; same-verse Strong set support",
        "split_method": "SHA256 of consonantal form, first byte parity; fixed before measurement",
        "validation_scope": "Existing manual overrides; no Hutter labels are used to build the OSHB index. This is a form holdout, not a separately commissioned image review.",
        "gate_threshold": .98, "minimum_reviewed_acceptances": 100,
        "splits": splits, "gate_passed": all(s["gate_passed"] for s in splits.values()),
        "unresolved_tokens": len(unresolved), "target": 2000,
        "proposed_unresolved_tokens": sum(r["proposal"]["eligible"] for r in unresolved),
        "pointed_attested_unresolved_tokens": sum(bool(r["proposal"]["evidence"]) for r in unresolved),
        "applied_mappings": 0, "review_queue": unresolved,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "data/hutter/review_reports/attested_morphology.json")
    args = parser.parse_args()
    report = evaluate()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    summary = {k: v for k, v in report.items() if k != "review_queue"}
    summary["splits"] = {k: {a: b for a, b in v.items() if a != "regressions"} for k, v in report["splits"].items()}
    print(json.dumps(summary, indent=2))
    return 0 if report["gate_passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
