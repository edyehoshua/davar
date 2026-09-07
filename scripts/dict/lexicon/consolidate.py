#!/usr/bin/env python3
"""
Consolidate individual lexicon entry files into consolidated roots.json and words.json.

This script merges all individual JSON files from lexicon/roots/ and lexicon/words/
into consolidated files. It can optionally preserve translations from a backup file
or existing consolidated files.

Usage:
    python -m scripts.dict lexicon consolidate --preserve-translations
    python -m scripts.dict lexicon consolidate --strict --dry-run
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config
from instance_policy import process_instances


def consolidate_lexicon(
    preserve_translations: bool = True,
    strict: bool = False,
    dry_run: bool = False,
    verbose: bool = False
) -> int:
    """
    Consolidate individual lexicon files into consolidated JSON files.

    Args:
        preserve_translations: Load translations from translations.json backup
        strict: Raise errors instead of continuing on failures
        dry_run: Preview without saving files
        verbose: Enable verbose output

    Returns:
        Exit code (0 for success)
    """
    config = Config()
    lexicon_dir = config.LEXICON_DIR
    roots_dir = config.LEXICON_ROOTS_DIR
    words_dir = config.LEXICON_WORDS_DIR

    if not roots_dir.exists():
        error_msg = f"Roots directory not found: {roots_dir}"
        if strict:
            raise FileNotFoundError(error_msg)
        print(f"❌ {error_msg}")
        return 1

    if not words_dir.exists():
        error_msg = f"Words directory not found: {words_dir}"
        if strict:
            raise FileNotFoundError(error_msg)
        print(f"❌ {error_msg}")
        return 1

    # Load translation backup if requested
    translations_backup = {}
    if preserve_translations:
        translations_file = lexicon_dir / "translations.json"
        if translations_file.exists():
            if verbose:
                print(f"📖 Loading translations from {translations_file}")
            try:
                with translations_file.open("r", encoding="utf-8") as f:
                    translations_backup = json.load(f)
                print(f"   ✅ Loaded {len(translations_backup)} translation entries")
            except (json.JSONDecodeError, IOError) as e:
                error_msg = f"Failed to load translations backup: {e}"
                if strict:
                    raise ValueError(error_msg)
                print(f"⚠️  {error_msg}")
        else:
            print(f"⚠️  Translations backup not found: {translations_file}")

    if verbose:
        print("🔄 Consolidating lexicon entries...")

    # Consolidate roots
    roots, roots_skipped, roots_errors = consolidate_directory(
        roots_dir, translations_backup, strict, verbose
    )

    # Consolidate words
    words, words_skipped, words_errors = consolidate_directory(
        words_dir, translations_backup, strict, verbose
    )

    total_errors = roots_errors + words_errors

    print(f"\n📊 Consolidation Summary:")
    print(f"   Roots: {len(roots)} entries ({roots_skipped} skipped, {roots_errors} errors)")
    print(f"   Words: {len(words)} entries ({words_skipped} skipped, {words_errors} errors)")

    if total_errors > 0 and not strict:
        print(f"⚠️  {total_errors} files had errors but were skipped (use --strict to fail)")

    if dry_run:
        print("🔍 Dry run - no files written")
        return 0

    # Write consolidated files
    roots_file = lexicon_dir / "roots.json"
    words_file = lexicon_dir / "words.json"

    if verbose:
        print(f"💾 Writing {roots_file}...")

    roots_file.parent.mkdir(parents=True, exist_ok=True)
    with roots_file.open("w", encoding="utf-8") as f:
        json.dump(roots, f, ensure_ascii=False, indent=2)

    if verbose:
        print(f"💾 Writing {words_file}...")

    with words_file.open("w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=2)

    print(f"✅ Consolidated {len(roots)} roots and {len(words)} words")
    return 0


def consolidate_directory(
    entries_dir: Path,
    translations_backup: Dict[str, dict],
    strict: bool,
    verbose: bool
) -> Tuple[Dict[str, dict], int, int]:
    """
    Consolidate all JSON files from a directory.

    Args:
        entries_dir: Directory containing individual JSON files
        translations_backup: Translation backup data
        strict: Whether to raise errors
        verbose: Enable verbose output

    Returns:
        Tuple of (entries_dict, skipped_count, error_count)
    """
    entries = {}
    skipped = 0
    errors = 0

    for entry_path in sorted(entries_dir.glob("*.json")):
        try:
            with entry_path.open("r", encoding="utf-8") as f:
                entry = json.load(f)
        except json.JSONDecodeError as e:
            error_msg = f"Invalid JSON in {entry_path}: {e}"
            if strict:
                raise ValueError(error_msg)
            if verbose:
                print(f"⚠️  {error_msg}")
            errors += 1
            continue

        # Apply the shared issue #94 policy at the export boundary.  The full
        # ranked set remains available; only the explicit surface set is bounded.
        occurrences = entry.get("occurrences")
        if isinstance(occurrences, dict) and isinstance(occurrences.get("references"), list):
            policy = process_instances(occurrences["references"])
            if policy["validation_errors"]:
                message = f"{entry_path.name}: invalid instance records: {policy['findings']}"
                if strict:
                    raise ValueError(message)
                if verbose:
                    print(f"⚠️  {message}")
                errors += 1
                continue
            occurrences["references"] = [item["reference"] for item in policy["instances"]]
            occurrences["surface_references"] = [item["reference"] for item in policy["surface_instances"]]
            entry["instance_policy_version"] = policy["policy_version"]
            entry["instance_tier"] = policy["tier"]
            entry["instance_total"] = policy["instance_total"]
            entry["instance_surface_count"] = policy["instance_surface_count"]
            entry["instance_omitted_count"] = policy["omitted_count"]
            if [finding for finding in policy["findings"] if finding["code"] == "duplicate_reference"]:
                entry["instance_validation"] = {
                    "duplicate_reference_keys": [finding for finding in policy["findings"] if finding["code"] == "duplicate_reference"]
                }

        strong_number = entry.get("strong_number") or entry_path.stem
        if not strong_number:
            if verbose:
                print(f"⚠️  No strong_number in {entry_path}")
            skipped += 1
            continue

        if strong_number in entries:
            error_msg = f"Duplicate entry for {strong_number} in {entry_path}"
            if strict:
                raise ValueError(error_msg)
            if verbose:
                print(f"⚠️  {error_msg}")
            errors += 1
            continue

        # Apply translations from backup if available
        if translations_backup and "definitions" in entry:
            entry["definitions"] = apply_translations_to_definitions(
                entry["definitions"], strong_number, translations_backup
            )

        entries[strong_number] = entry

    return entries, skipped, errors


def apply_translations_to_definitions(
    definitions: List[dict],
    strong_number: str,
    translations_backup: Dict[str, dict]
) -> List[dict]:
    """
    Apply translations from backup to definitions.

    Args:
        definitions: List of definition dictionaries
        strong_number: Strong's number for the entry
        translations_backup: Translation backup data

    Returns:
        Updated definitions with translations applied
    """
    updated_definitions = []

    for i, definition in enumerate(definitions):
        updated_def = definition.copy()
        key = f"{strong_number}:{i+1}"

        if key in translations_backup:
            trans_data = translations_backup[key]
            # Apply available translations
            for lang, text in trans_data.items():
                field_name = f"text_{lang}"
                if field_name not in updated_def:
                    updated_def[field_name] = text

        updated_definitions.append(updated_def)

    return updated_definitions


def main():
    """Command-line interface."""
    parser = argparse.ArgumentParser(
        description="Consolidate individual lexicon files into consolidated JSON files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Consolidate with translations preserved
  python -m scripts.dict lexicon consolidate --preserve-translations

  # Clean rebuild without translations
  python -m scripts.dict lexicon consolidate --no-preserve-translations

  # Strict mode (fail on errors)
  python -m scripts.dict lexicon consolidate --strict

  # Dry run to preview
  python -m scripts.dict lexicon consolidate --dry-run --verbose
        """
    )
    parser.add_argument(
        '--preserve-translations',
        action='store_true',
        default=True,
        help='Load translations from translations.json backup (default: True)'
    )
    parser.add_argument(
        '--no-preserve-translations',
        action='store_false',
        dest='preserve_translations',
        help='Do not preserve translations'
    )
    parser.add_argument(
        '--strict',
        action='store_true',
        help='Raise errors instead of continuing on failures'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview counts without writing output files'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose output'
    )

    args = parser.parse_args()

    return consolidate_lexicon(
        preserve_translations=args.preserve_translations,
        strict=args.strict,
        dry_run=args.dry_run,
        verbose=args.verbose
    )


if __name__ == "__main__":
    sys.exit(main())