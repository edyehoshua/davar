#!/usr/bin/env python3
"""Apply versioned metadata to existing dictionary exports without rescanning sources."""
import argparse
import gzip
import json
from pathlib import Path
from instance_policy import process_instances, MANIFEST

ROOT = Path(__file__).resolve().parents[2]

def apply(root: Path = ROOT, write: bool = False):
    report = {"policy_version": MANIFEST["version"], "manifest_version": MANIFEST["version"], "linguistic_signal_extractor_version": MANIFEST["linguistic_signal_extractor_version"], "entries": {}, "errors": 0}
    outputs = []
    for name in ("roots", "words", "custom_definitions"):
        path = root / "data/dict/lexicon" / (name + ".json")
        entries = json.loads(path.read_text())
        for key, entry in entries.items():
            records = ([*entry.get("oe_instances", []), *entry.get("nt_instances", [])] if name == "custom_definitions" else entry.get("occurrences", {}).get("references", []))
            source_file = path.parent / name / (key + ".json")
            if name != "custom_definitions" and source_file.exists():
                records = json.loads(source_file.read_text()).get("occurrences", {}).get("references", [])
            result = process_instances(records)
            report["entries"][f"{name}/{key}"] = {k: result[k] for k in ("tier", "instance_total", "instance_surface_count", "omitted_count", "findings", "is_valid")}
            report["errors"] += len(result["validation_errors"])
            for target, source in (("instance_policy_version", "policy_version"), ("instance_tier", "tier"), ("instance_total", "instance_total"), ("instance_surface_count", "instance_surface_count"), ("instance_omitted_count", "omitted_count")):
                entry[target] = result[source]
            entry["instance_source_manifest_version"] = MANIFEST["version"]
            entry["instance_signal_extractor_version"] = MANIFEST["linguistic_signal_extractor_version"]
            if name == "custom_definitions":
                entry["instances"] = result["instances"]
                entry["surface_instances"] = result["surface_instances"]
            elif "occurrences" in entry:
                entry["occurrences"]["references"] = [x["reference"] for x in result["instances"]]
                entry["occurrences"]["surface_references"] = [x["reference"] for x in result["surface_instances"]]
        outputs.append((path, json.dumps(entries, ensure_ascii=False, indent=2) + "\n"))
    if report["errors"]:
        raise ValueError(f"Policy rejected {report['errors']} invalid records; no data written")
    report_path = root / "data/dict/reports/instance_policy.json.gz"
    if write:
        for path, payload in outputs:
            path.write_text(payload)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_bytes(gzip.compress((json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode(), mtime=0))
    print(f"{len(report['entries'])} entries; {report['errors']} errors; write={write}")
    return report

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    apply(write=parser.parse_args().write)
