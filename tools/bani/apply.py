#!/usr/bin/env python3
"""
Bani Schema Applier - Core transliteration engine

Applies transliteration schema to Hebrew word dataset.
Used by build.py for batch processing.

Usage:
    python tools/bani/apply.py schemas/es.json --words 100 --output results.json
"""

import json
import re
import argparse
from pathlib import Path
from typing import Dict, Any, List, Optional
import unicodedata


# Hebrew character constants
SHEVA_CHAR = "ְ"
DAGESH_CHAR = "ּ"


def load_jsonc(file_path: Path) -> Dict[str, Any]:
    """Load JSONC (JSON with comments) file by removing comments."""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Remove only full-line comments; stripping every ``//`` would corrupt
    # JSON string values such as ``https://...`` in the schema metadata.
    content = re.sub(r'^[ \t]*//.*$', '', content, flags=re.MULTILINE)

    # Remove multi-line comments (/* ... */)
    content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)

    return json.loads(content)


class Transliterator:
    def __init__(self, schema: Dict[str, Any]):
        self.schema = schema
        self.consonants = schema['rules']['consonants']
        self.vowels = schema['rules']['vowels_nikud']
        self.composite = schema.get('rules', {}).get('composite', {})
        self.post_processing = schema['rules'].get('post_processing', [])
        self.stress_default = schema['stress']['default']
        self.stress_exceptions = schema['stress']['exceptions']

    def normalize_hebrew(self, hebrew: str) -> str:
        """Normalize Hebrew text for processing."""
        # Decompose and recompose to normalize
        return unicodedata.normalize('NFD', hebrew)

    def is_silent_sheva(self, text: str, index: int) -> bool:
        """Return whether a sheva is a medial, silent sheva.

        This deliberately implements the conservative case only: a sheva
        following a vowel-bearing consonant and preceding another
        vowel-bearing consonant.  Word-initial and ambiguous sheva cases
        remain vocalized by the schema's normal rules.
        """
        def adjacent_letter(start: int, step: int) -> Optional[int]:
            """Find the nearest Hebrew letter in one direction."""
            i = start + step
            while 0 <= i < len(text):
                if unicodedata.category(text[i]).startswith('L'):
                    return i
                i += step
            return None

        def attached_marks(letter_index: int) -> List[str]:
            """Return only marks in the combining run attached to a letter."""
            marks = []
            i = letter_index + 1
            while i < len(text) and unicodedata.category(text[i]).startswith('M'):
                marks.append(text[i])
                i += 1
            return marks

        previous_index = adjacent_letter(index, -1)
        next_index = adjacent_letter(index, 1)
        if previous_index is None or next_index is None:
            return False

        previous_marks = attached_marks(previous_index)
        next_marks = attached_marks(next_index)

        # In מִקְוֶה, the sheva is attached to ק while the vowel that
        # licenses the closed preceding syllable is attached to מ.  Inspect
        # that one immediately preceding consonant, but never the whole
        # prefix (which could contain an unrelated, distant vowel).
        if not any(mark in self.vowels and mark != SHEVA_CHAR for mark in previous_marks):
            preceding_index = adjacent_letter(previous_index, -1)
            previous_marks = (
                attached_marks(preceding_index)
                if preceding_index is not None
                else []
            )

        vowel_marks = set(self.vowels)
        return (
            any(mark in vowel_marks and mark != SHEVA_CHAR for mark in previous_marks)
            and any(mark in vowel_marks and mark != SHEVA_CHAR for mark in next_marks)
        )

    def split_into_syllables(self, translit: str) -> List[str]:
        """Simple syllable splitting based on vowels."""
        # This is a basic implementation - could be improved
        syllables = []
        current = ""

        for char in translit:
            current += char
            # Split on vowels (very basic)
            if char in 'aeiouAEIOU':
                syllables.append(current)
                current = ""

        if current:
            syllables.append(current)

        return syllables if syllables else [translit]

    def apply_stress(self, translit: str, strongs_num: str, stress_syllable: Optional[int] = None) -> str:
        """Apply stress marking to transliteration."""
        if stress_syllable is None:
            # Use exception or default
            if strongs_num in self.stress_exceptions:
                stress_syllable = self.stress_exceptions[strongs_num]
            else:
                # Calculate based on default rule
                syllables = self.split_into_syllables(translit)
                if self.stress_default == 'penultimate':
                    stress_syllable = max(1, len(syllables) - 1)
                elif self.stress_default == 'ultimate':
                    stress_syllable = len(syllables)
                elif self.stress_default == 'antepenultimate':
                    stress_syllable = max(1, len(syllables) - 2)
                else:
                    stress_syllable = len(syllables)

        syllables = self.split_into_syllables(translit)
        if stress_syllable > len(syllables):
            stress_syllable = len(syllables)

        # Apply uppercase stress marking
        if 1 <= stress_syllable <= len(syllables):
            syllables[stress_syllable - 1] = syllables[stress_syllable - 1].upper()

        return ''.join(syllables)

    def transliterate_word(self, hebrew: str, strongs_num: str = "") -> Dict[str, Any]:
        """Transliterate a single Hebrew word."""
        result = {
            'hebrew': hebrew,
            'translit': '',
            'stress_syllable': None,
            'guide': '',
            'guide_full': {
                'reference': '',
                'stress_note': '',
                'phonetic_notes': []
            }
        }

        try:
            # Normalize Hebrew
            normalized = self.normalize_hebrew(hebrew)

            # Basic character-by-character transliteration
            translit = ""
            i = 0
            while i < len(normalized):
                char = normalized[i]

                # Check for composite characters first (longer matches)
                found_composite = False
                for comp, replacement in self.composite.items():
                    if normalized.startswith(comp, i):
                        translit += replacement
                        i += len(comp)
                        found_composite = True
                        break

                if not found_composite:
                    # Skip combining marks that aren't vowels
                    if unicodedata.category(char).startswith('M'):
                        # It's a combining mark (diacritic)
                        if char in self.vowels:
                            # Known vowel - transliterate it
                            if char != SHEVA_CHAR or not self.is_silent_sheva(normalized, i):
                                translit += self.vowels[char]
                        # Otherwise skip it (dagesh, meteg, etc. are handled separately)
                        i += 1
                        continue

                    # Single character mapping
                    if char in self.consonants:
                        # Check if dagesh or shin/sin dots appear in the combining marks that follow
                        # (after normalization, combining marks come after base character)
                        has_dagesh = False
                        has_sin_dot = False
                        has_shin_dot = False
                        j = i + 1
                        # Look ahead through combining marks to find dagesh or shin/sin dots
                        while j < len(normalized):
                            next_char = normalized[j]
                            # Stop if we hit another base character (letter)
                            if unicodedata.category(next_char)[0] == 'L':
                                break
                            # Check for special combining marks
                            if next_char == DAGESH_CHAR:
                                has_dagesh = True
                            elif next_char == 'ׁ':  # Shin dot
                                has_shin_dot = True
                            elif next_char == 'ׂ':  # Sin dot
                                has_sin_dot = True
                            # Stop if we hit a non-combining character
                            if not unicodedata.category(next_char).startswith('M'):
                                break
                            j += 1
                        
                        # Apply special rules for ש (shin) with dots
                        if char == 'ש':
                            if has_sin_dot:
                                translit += 's'  # Shin with sin dot = 's'
                            else:
                                translit += self.consonants[char]  # Shin or shin with shin dot = 'sh'
                        # Apply dagesh rules for ב, כ, פ
                        elif has_dagesh and char in {'ב', 'כ', 'פ'}:
                            if char == 'ב':
                                translit += 'b'
                            elif char == 'כ':
                                translit += 'k'
                            elif char == 'פ':
                                translit += 'p'
                        else:
                            translit += self.consonants[char]
                        i += 1
                    elif char in self.vowels:
                        translit += self.vowels[char]
                        i += 1
                    else:
                        # Skip unknown characters (Hebrew punctuation, other marks, etc.)
                        # Only process known consonants and vowels
                        i += 1

            # Apply post-processing
            for rule in self.post_processing:
                if rule == 'apply_dagesh_rules':
                    # Dagesh rules are already handled during transliteration
                    # This is a no-op but kept for schema compatibility
                    pass
                elif rule == 'normalize_composites':
                    # Composites are already handled during transliteration
                    # This is a no-op but kept for schema compatibility
                    pass
                elif rule == 'remove_duplicate_consonants':
                    translit = re.sub(r'(.)\1+', r'\1', translit)
                elif rule == 'apply_stress_uppercase':
                    translit = self.apply_stress(translit, strongs_num)
                elif rule == 'lowercase_rest':
                    # Keep only the stressed syllable uppercase
                    pass  # Handled in apply_stress

            result['translit'] = translit.lower()

            # Generate guide (with stress)
            result['guide'] = self.apply_stress(translit.lower(), strongs_num)

            # Calculate stress syllable for guide_full
            syllables = self.split_into_syllables(translit.lower())
            stressed_idx = None
            for idx, syll in enumerate(syllables):
                if any(c.isupper() for c in syll):
                    stressed_idx = idx + 1
                    break

            result['stress_syllable'] = stressed_idx or len(syllables)

            # Generate stress note
            if stressed_idx:
                syllables_lower = [s.lower() for s in syllables]
                if stressed_idx <= len(syllables_lower):
                    stressed_syll = syllables_lower[stressed_idx - 1]
                    result['guide_full']['stress_note'] = f"stress on {stressed_syll.upper()}"

        except Exception as e:
            print(f"Warning: Error transliterating '{hebrew}': {e}")

        return result

    def apply_to_dataset(self, words: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Apply transliteration to a dataset of words."""
        result = {}

        for word_data in words:
            strongs_num = word_data.get('strongs', '')
            hebrew = word_data.get('hebrew', '')

            if not hebrew:
                continue

            transliterated = self.transliterate_word(hebrew, strongs_num)
            result[strongs_num] = transliterated

        return result




def main():
    """Command-line interface for testing transliteration schemas."""
    parser = argparse.ArgumentParser(description='Apply Bani transliteration schema to Hebrew words')
    parser.add_argument('schema_file', help='Path to schema file (e.g., schemas/es.json)')
    parser.add_argument('--words', type=int, default=100, help='Number of words to process')
    parser.add_argument('--output', help='Output JSON file path')
    parser.add_argument('--test', action='store_true', help='Test mode - show results without saving')

    args = parser.parse_args()

    schema_path = Path(args.schema_file)

    if not schema_path.exists():
        print(f"Error: Schema file not found: {schema_path}")
        return 1

    try:
        schema = load_jsonc(schema_path)
    except Exception as e:
        print(f"Error loading schema: {e}")
        return 1

    # Validate schema first
    try:
        from .validate import SchemaValidator
        validator = SchemaValidator(schema)
        is_valid, errors, warnings = validator.validate(3)

        if not is_valid:
            print("Schema validation failed:")
            for error in errors:
                print(f"  ❌ {error}")
            return 1

        if warnings:
            print("Schema warnings:")
            for warning in warnings:
                print(f"  ⚠️  {warning}")

    except ImportError:
        print("Warning: Schema validation not available")

    # Create sample words for testing
    sample_words = [
        {'strongs': 'H7965', 'hebrew': 'שָׁלוֹם'},
        {'strongs': 'H1', 'hebrew': 'אָב'},
        {'strongs': 'H2', 'hebrew': 'בֵּן'},
        {'strongs': 'H8', 'hebrew': 'חַי'},
    ][:args.words]

    print(f"Processing {len(sample_words)} sample words")

    # Apply transliteration
    transliterator = Transliterator(schema)
    result = transliterator.apply_to_dataset(sample_words)

    if args.test:
        print("\nResults:")
        for strongs, data in result.items():
            print(f"  {strongs}: {data['hebrew']} → {data['guide']}")
        return 0

    # Set default output path
    if not args.output:
        lang_code = schema['language']['code']
        args.output = f"bani-{lang_code}-test.json"

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Save JSON
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"Transliterations saved to: {output_path}")
    except Exception as e:
        print(f"Error saving JSON: {e}")
        return 1

    print(f"Successfully processed {len(result)} words")
    return 0


if __name__ == '__main__':
    exit(main())








