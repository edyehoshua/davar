#!/usr/bin/env python3
"""
Script to update Strong's entries with translit_en and translit_es fields
positioned immediately after the transliteration field.

If the fields already exist elsewhere in the JSON, they will be moved.
If they don't exist, they will be created based on the transliteration field.
"""

if __package__:
    from .transliteration_policy import apply_transliteration_policy
else:
    from transliteration_policy import apply_transliteration_policy

import json
import argparse
import sys
import os
from pathlib import Path
from typing import Dict, Any
import re


def simplify_transliteration(translit: str) -> str:
    """
    Convert a transliteration with special characters to a simple ASCII version.
    Removes diacritics and special characters.
    """
    if not translit:
        return ""

    # Remove common diacritics and convert to ASCII equivalents
    char_map = {
        'ʼ': '', 'ʻ': '', 'ʾ': '', 'ʿ': '',
        'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u',
        'ā': 'a', 'ē': 'e', 'ī': 'i', 'ō': 'o', 'ū': 'u',
        'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
        'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u',
        'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o', 'ü': 'u',
        'ã': 'a', 'õ': 'o', 'ñ': 'n',
        'ç': 'ts', 'ṣ': 's', 'ṭ': 't', 'ḥ': 'h',
        'š': 'sh', 'ś': 's', 'ž': 'z',
    }

    result = translit
    for old_char, new_char in char_map.items():
        result = result.replace(old_char, new_char)

    # Remove any remaining non-ASCII characters
    result = re.sub(r'[^a-zA-Z\- ]', '', result)

    return result.strip()


def update_strong_entry(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Update a Strong's entry to include translit_en and translit_es
    immediately after the transliteration field.

    Returns a new dictionary with the correct field order.
    """
    # Get the transliteration value
    transliteration = data.get('transliteration', '')

    # Get or create the simplified transliterations
    translit_en = data.get('translit_en', '')
    translit_es = data.get('translit_es', '')

    # If they don't exist, create them from the transliteration
    if not translit_en:
        translit_en = simplify_transliteration(transliteration)
    if not translit_es:
        translit_es = simplify_transliteration(transliteration)

    # Build the new dictionary with correct field order
    new_data = {}

    # Define the desired field order
    field_order = [
        'strong_number',
        'lemma',
        'normalized',
        'pronunciation',
        'transliteration',
        'translit_en',      # Add right after transliteration
        'translit_es',      # Add right after transliteration
        'definitions',
        'sources',
        'occurrences',
        'is_root'
    ]

    # Add fields in order
    for field in field_order:
        if field == 'translit_en':
            new_data[field] = translit_en
        elif field == 'translit_es':
            new_data[field] = translit_es
        elif field in data:
            new_data[field] = data[field]

    # Add any remaining fields that weren't in our order list
    for key, value in data.items():
        if key not in new_data and key not in ['translit_en', 'translit_es']:
            new_data[key] = value

    return apply_transliteration_policy(new_data)


def regenerate_bani_fields(data: Dict[str, Any]) -> Dict[str, Any]:
    """Regenerate display fields from pointed Hebrew, retaining source metadata."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from tools.bani.transliterate import BaniTransliterator
    updated = dict(data)
    hebrew = data.get("lemma") or data.get("hebrew")
    if hebrew:
        strong = data.get("strong_number", "")
        updated.update({"translit_" + language: BaniTransliterator(language).transliterate_detailed(hebrew, strong)["translit"]
                        for language in ("en", "es")})
    return apply_transliteration_policy(updated)


def process_lexicon_file(file_path: Path, bani: bool = False) -> bool:
    """
    Process a single lexicon JSON file.
    Returns True if successful, False otherwise.
    """
    try:
        # Read the file
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Update the entry
        updated_data = regenerate_bani_fields(data) if bani else update_strong_entry(data)

        # Write back to file with proper formatting
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(updated_data, f, ensure_ascii=False, indent=2)

        return True
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return False


def process_lexicon_dir(lexicon_dir: Path, label: str, bani: bool = False) -> None:
    if not lexicon_dir.exists():
        print(f"Error: Lexicon {label} directory not found at {lexicon_dir}")
        return

    json_files = sorted(lexicon_dir.glob('H*.json'))

    if not json_files:
        print(f"No JSON files found in {lexicon_dir}")
        return

    print(f"Found {len(json_files)} lexicon {label} files to process")

    success_count = 0
    error_count = 0

    for json_file in json_files:
        if process_lexicon_file(json_file, bani):
            success_count += 1
        else:
            error_count += 1

    print(f"\nProcessing complete for {label}:")
    print(f"  Successfully updated: {success_count}")
    print(f"  Errors: {error_count}")


def main():
    """Main function to process all lexicon files."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bani", action="store_true", help="Regenerate from Hebrew with Bani instead of filling missing ASCII fields")
    args = parser.parse_args()
    script_dir = Path(__file__).parent
    project_root = script_dir.parent.parent
    lexicon_root_dir = project_root / 'data' / 'dict' / 'lexicon' / 'roots'
    lexicon_words_dir = project_root / 'data' / 'dict' / 'lexicon' / 'words'

    process_lexicon_dir(lexicon_root_dir, 'roots', args.bani)
    process_lexicon_dir(lexicon_words_dir, 'words', args.bani)


if __name__ == '__main__':
    main()
