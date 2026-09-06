#!/usr/bin/env python3
"""
Custom Dictionary Integration Script
Integrates custom Hebrew definitions from custom_dict.json into the lexicon system.

Handles multiple Strong number patterns:
- Single: H430 (direct lookup)
- Compound: H1121+H430 (consecutive word sequences)
- Alternative: H1/H2 (match any of the listed numbers)
- Mixed: H606/H1121+H120 (alternatives with compounds)

Supports source restrictions (e.g., NT-only entries) and generates
both custom_definitions.json and compound_instances.json files.
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from glob import glob

from config import config
from instance_policy import process_instances


@dataclass
class StrongPattern:
    """Represents a Strong number pattern with its type and components."""
    pattern_type: str  # 'single', 'compound', 'alternative', 'mixed'
    components: List[str]  # Strong numbers involved
    key: str  # Unique key for this pattern

    def __str__(self):
        return f"{self.pattern_type}: {self.key}"


@dataclass
class CustomEntry:
    """Represents a custom dictionary entry."""
    id: int
    hebrew: str
    transliteration_es: str
    transliteration_en: str
    strong_pattern: StrongPattern
    meanings_es: List[str]
    meanings_en: List[str]
    instances: List[str]
    root: Optional[str]
    root_strong: Optional[str]
    source_restriction: Optional[str] = None  # 'nt' for NT-only


class CustomDictParser:
    """Parser for custom_dict.json with pattern detection."""

    def __init__(self):
        self.custom_dict_path = config.DATA_DIR / 'tth' / 'raw' / 'custom_dict.json'

    def parse_strong_pattern(self, strong_field: str) -> StrongPattern:
        """
        Parse Strong number field into pattern type and components.

        Patterns:
        - H430 -> single: ['H430']
        - H1121+H430 -> compound: ['H1121', 'H430']
        - H1 / H2 -> alternative: ['H1', 'H2']
        - H606 / H1121+H120 -> mixed: ['H606', 'H1121', 'H120'] with compound subpattern
        """
        strong_field = strong_field.strip()

        # Handle mixed patterns first (contains both / and +)
        if '/' in strong_field and '+' in strong_field:
            # Mixed: H606 / H1121+H120
            parts = [p.strip() for p in strong_field.split('/')]
            components = []
            for part in parts:
                if '+' in part:
                    # Compound part: H1121+H120 -> ['H1121', 'H120']
                    components.extend([s.strip() for s in part.split('+')])
                else:
                    # Single part: H606
                    components.append(part.strip())

            return StrongPattern(
                pattern_type='mixed',
                components=components,
                key=strong_field
            )

        # Alternative patterns (/)
        if '/' in strong_field:
            components = [s.strip() for s in strong_field.split('/')]
            return StrongPattern(
                pattern_type='alternative',
                components=components,
                key=strong_field
            )

        # Compound patterns (+)
        if '+' in strong_field:
            components = [s.strip() for s in strong_field.split('+')]
            return StrongPattern(
                pattern_type='compound',
                components=components,
                key=strong_field
            )

        # Single pattern
        return StrongPattern(
            pattern_type='single',
            components=[strong_field],
            key=strong_field
        )

    def determine_source_restriction(self, entry_id: int, strong_pattern: StrongPattern) -> Optional[str]:
        """Determine if entry should be restricted to NT only."""
        # Entry 75: אב / אבא (H1/H2) - NT only
        if entry_id == 75 and strong_pattern.pattern_type == 'alternative':
            return 'nt'
        return None

    def parse_entries(self) -> List[CustomEntry]:
        """Parse all entries from custom_dict.json."""
        with open(self.custom_dict_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        entries = []
        for entry_data in data['entries']:
            strong_pattern = self.parse_strong_pattern(entry_data['strong'])
            source_restriction = self.determine_source_restriction(
                entry_data['id'], strong_pattern
            )

            entry = CustomEntry(
                id=entry_data['id'],
                hebrew=entry_data['hebrew'],
                transliteration_es=entry_data['transliteration_es'],
                transliteration_en=entry_data['transliteration_en'],
                strong_pattern=strong_pattern,
                meanings_es=entry_data['meanings_es'],
                meanings_en=entry_data['meanings_en'],
                instances=entry_data['instances'] or [],
                root=entry_data.get('root'),
                root_strong=entry_data.get('root_strong'),
                source_restriction=source_restriction
            )
            entries.append(entry)

        return entries


class LexiconTransformer:
    """Transforms custom entries into lexicon format."""

    def transform_single_entry(self, entry: CustomEntry) -> Dict:
        """Transform single Strong number entry."""
        strong_num = entry.strong_pattern.components[0]
        return {
            "strong_number": strong_num,
            "hebrew": entry.hebrew,
            "transliteration_es": entry.transliteration_es,
            "transliteration_en": entry.transliteration_en,
            "is_custom": True,
            "definitions": self._create_definitions(entry),
            "root": entry.root,
            "root_strong": entry.root_strong,
            "manual_instances": entry.instances
        }

    def transform_compound_entry(self, entry: CustomEntry) -> Dict:
        """Transform compound Strong number entry."""
        key = entry.strong_pattern.key
        return {
            "strong_numbers": entry.strong_pattern.components,
            "compound_key": key,
            "hebrew": entry.hebrew,
            "transliteration_es": entry.transliteration_es,
            "transliteration_en": entry.transliteration_en,
            "is_custom": True,
            "is_compound": True,
            "definitions": self._create_definitions(entry),
            "manual_instances": entry.instances,
            "oe_instances": [],
            "nt_instances": []
        }

    def transform_alternative_entry(self, entry: CustomEntry) -> Dict:
        """Transform alternative Strong number entry."""
        key = entry.strong_pattern.key
        result = {
            "alternative_strongs": entry.strong_pattern.components,
            "hebrew": entry.hebrew,
            "transliteration_es": entry.transliteration_es,
            "transliteration_en": entry.transliteration_en,
            "is_custom": True,
            "is_alternative": True,
            "definitions": self._create_definitions(entry),
            "manual_instances": entry.instances,
            "nt_instances": []
        }

        if entry.source_restriction:
            result["source_restriction"] = entry.source_restriction

        return result

    def transform_mixed_entry(self, entry: CustomEntry) -> Dict:
        """Transform mixed pattern entry."""
        key = entry.strong_pattern.key

        # Parse the pattern structure for mixed entries
        # H606 / H1121+H120 -> single H606 OR compound H1121+H120
        parts = [p.strip() for p in key.split('/')]
        patterns = []

        for part in parts:
            if '+' in part:
                # Compound part
                strongs = [s.strip() for s in part.split('+')]
                patterns.append({
                    "type": "compound",
                    "strongs": strongs
                })
            else:
                # Single part
                patterns.append({
                    "type": "single",
                    "strong": part
                })

        return {
            "patterns": patterns,
            "hebrew": entry.hebrew,
            "transliteration_es": entry.transliteration_es,
            "transliteration_en": entry.transliteration_en,
            "is_custom": True,
            "is_mixed": True,
            "definitions": self._create_definitions(entry),
            "manual_instances": entry.instances,
            "oe_instances": [],
            "nt_instances": []
        }

    def _create_definitions(self, entry: CustomEntry) -> List[Dict]:
        """Create definition objects from meanings."""
        definitions = []
        for i, (es, en) in enumerate(zip(entry.meanings_es, entry.meanings_en)):
            definitions.append({
                "source": "custom",
                "text_es": es,
                "text_en": en,
                "order": i + 1
            })
        return definitions

    def transform_all_entries(self, entries: List[CustomEntry]) -> Dict[str, Dict]:
        """Transform all entries into lexicon format."""
        lexicon_entries = {}

        for entry in entries:
            pattern_type = entry.strong_pattern.pattern_type

            if pattern_type == 'single':
                transformed = self.transform_single_entry(entry)
                key = entry.strong_pattern.components[0]
            elif pattern_type == 'compound':
                transformed = self.transform_compound_entry(entry)
                key = entry.strong_pattern.key
            elif pattern_type == 'alternative':
                transformed = self.transform_alternative_entry(entry)
                key = entry.strong_pattern.key
            elif pattern_type == 'mixed':
                transformed = self.transform_mixed_entry(entry)
                key = entry.strong_pattern.key
            else:
                raise ValueError(f"Unknown pattern type: {pattern_type}")

            lexicon_entries[key] = transformed

        return lexicon_entries


class BiblicalScanner:
    """Scans OE and Delitzsch data for word matches."""

    def __init__(self):
        self.oe_dir = config.OE_DIR
        self.delitzsch_dir = config.DATA_DIR / 'delitzsch_parsed'

    def extract_base_strong(self, strong_field) -> Optional[str]:
        """Extract base Strong number from 'Hc/Hd/H776' -> 'H776'."""
        if strong_field is None:
            return None
        if '/' in strong_field:
            return strong_field.split('/')[-1]
        return strong_field

    def scan_oe_data(self, compound_strongs: List[str]) -> List[Dict]:
        """Scan OE (Tanakh) data for compound matches."""
        matches = []

        # Scan all book directories
        for book_dir in sorted(self.oe_dir.glob('*')):
            if not book_dir.is_dir():
                continue

            # Skip the raw directory which has different structure
            if book_dir.name == 'raw':
                continue

            book_name = book_dir.name.lower()

            # Scan all chapter files in this book
            for chapter_file in sorted(book_dir.glob('*.json')):
                try:
                    with open(chapter_file, 'r', encoding='utf-8') as f:
                        chapter_data = json.load(f)

                    for verse_data in chapter_data:
                        chapter = verse_data['chapter']
                        verse = verse_data['verse']
                        words = verse_data['words']

                        # Find consecutive matches
                        word_positions = self.find_consecutive_matches(words, compound_strongs)
                        if word_positions:
                            for start_pos in word_positions:
                                matches.append({
                                    'book': book_name,
                                    'chapter': chapter,
                                    'verse': verse,
                                    'word_positions': list(range(start_pos, start_pos + len(compound_strongs)))
                                })

                except Exception as e:
                    print(f"Error scanning {chapter_file}: {e}")
                    continue

        return matches

    def scan_delitzsch_data(self, compound_strongs: List[str], single_strongs: Optional[List[str]] = None) -> List[Dict]:
        """
        Scan Delitzsch (NT) data for matches.

        For compounds: look for consecutive sequences
        For alternatives: look for any occurrence of listed Strong numbers
        """
        matches = []

        # Scan all book directories
        for book_dir in sorted(self.delitzsch_dir.glob('*')):
            if not book_dir.is_dir():
                continue

            book_name = book_dir.name.lower()

            # Scan all chapter files in this book
            for chapter_file in sorted(book_dir.glob('*.json')):
                try:
                    with open(chapter_file, 'r', encoding='utf-8') as f:
                        chapter_data = json.load(f)

                    for verse_data in chapter_data:
                        chapter = verse_data['chapter']
                        verses = verse_data['verses']

                        for verse_obj in verses:
                            verse = verse_obj['verse']
                            words = verse_obj['words']

                            # Check for compound matches first
                            if compound_strongs:
                                word_positions = self.find_consecutive_matches(words, compound_strongs)
                                if word_positions:
                                    for start_pos in word_positions:
                                        matches.append({
                                            'book': book_name,
                                            'chapter': chapter,
                                            'verse': verse,
                                            'word_positions': list(range(start_pos, start_pos + len(compound_strongs))),
                                            'match_type': 'compound',
                                            'strongs': compound_strongs.copy()
                                        })

                            # Check for single/alternative matches
                            if single_strongs:
                                for word_idx, word in enumerate(words):
                                    word_strong = self.extract_base_strong(word.get('strong'))
                                    if word_strong and word_strong in single_strongs:
                                        matches.append({
                                            'book': book_name,
                                            'chapter': chapter,
                                            'verse': verse,
                                            'word_positions': [word_idx],
                                            'match_type': 'single',
                                            'strong': word_strong
                                        })

                except Exception as e:
                    print(f"Error scanning {chapter_file}: {e}")
                    continue

        return matches

    def find_consecutive_matches(self, words: List[Dict], target_strongs: List[str]) -> List[int]:
        """Find positions where consecutive words match the target Strong sequence."""
        matches = []
        for i in range(len(words) - len(target_strongs) + 1):
            # Check if all words in sequence have valid strong numbers and match targets
            match = True
            for j in range(len(target_strongs)):
                word_strong = self.extract_base_strong(words[i+j].get('strong'))
                if word_strong != target_strongs[j]:
                    match = False
                    break
            if match:
                matches.append(i)
        return matches


class InstanceMapper:
    """Maps detected instances to lexicon entries."""

    def __init__(self):
        self.scanner = BiblicalScanner()

    def map_instances_for_entry(self, entry: Dict, pattern: StrongPattern) -> Dict:
        """
        Map instances for a lexicon entry based on its pattern type.

        Returns updated entry with oe_instances and/or nt_instances.
        """
        entry_copy = entry.copy()

        if pattern.pattern_type == 'single':
            # Single entries only scan NT if restricted
            if entry.get('source_restriction') == 'nt':
                matches = self.scanner.scan_delitzsch_data(
                    compound_strongs=None,
                    single_strongs=pattern.components
                )
                entry_copy['nt_instances'] = matches
            # Single entries without restriction don't need scanning
            # (they would be handled by manual instances only)

        elif pattern.pattern_type == 'compound':
            # Compound entries scan both sources
            oe_matches = self.scanner.scan_oe_data(pattern.components)
            nt_matches = self.scanner.scan_delitzsch_data(
                compound_strongs=pattern.components,
                single_strongs=None
            )
            entry_copy['oe_instances'] = oe_matches
            entry_copy['nt_instances'] = nt_matches

        elif pattern.pattern_type == 'alternative':
            # Alternative entries scan NT only if restricted, otherwise both
            if entry.get('source_restriction') == 'nt':
                matches = self.scanner.scan_delitzsch_data(
                    compound_strongs=None,
                    single_strongs=pattern.components
                )
                entry_copy['nt_instances'] = matches
            else:
                # Scan both sources for alternatives
                oe_matches = self.scanner.scan_oe_data(pattern.components)
                nt_matches = self.scanner.scan_delitzsch_data(
                    compound_strongs=None,
                    single_strongs=pattern.components
                )
                entry_copy['oe_instances'] = oe_matches
                entry_copy['nt_instances'] = nt_matches

        elif pattern.pattern_type == 'mixed':
            # Mixed entries: H606 / H1121+H120 means:
            # - Single H606 (Aramaic contexts)
            # - OR compound H1121+H120 (Hebrew contexts)
            # Parse the pattern structure
            mixed_matches = []

            # Split on '/' to get alternatives
            alternatives = entry['patterns']

            for alt in alternatives:
                if alt['type'] == 'single':
                    # Scan for single word matches
                    single_strong = alt['strong']
                    alt_oe_matches = self.scanner.scan_oe_data([single_strong])
                    alt_nt_matches = self.scanner.scan_delitzsch_data(
                        compound_strongs=None,
                        single_strongs=[single_strong]
                    )
                    mixed_matches.extend(alt_oe_matches)
                    mixed_matches.extend(alt_nt_matches)
                elif alt['type'] == 'compound':
                    # Scan for compound matches
                    compound_strongs = alt['strongs']
                    alt_oe_matches = self.scanner.scan_oe_data(compound_strongs)
                    alt_nt_matches = self.scanner.scan_delitzsch_data(
                        compound_strongs=compound_strongs,
                        single_strongs=None
                    )
                    mixed_matches.extend(alt_oe_matches)
                    mixed_matches.extend(alt_nt_matches)

            # Remove duplicates (same verse might match multiple alternatives)
            seen = set()
            unique_matches = []
            for match in mixed_matches:
                key = (match['book'], match['chapter'], match['verse'])
                if key not in seen:
                    seen.add(key)
                    unique_matches.append(match)

            entry_copy['oe_instances'] = [m for m in unique_matches if m['book'] not in ['matthew', 'mark', 'luke', 'john', 'acts', 'romans', 'corinthians1', 'corinthians2', 'galatians', 'ephesians', 'philippians', 'colossians', 'thessalonians1', 'thessalonians2', 'timothy1', 'timothy2', 'titus', 'philemon', 'hebrews', 'james', 'peter1', 'peter2', 'john1', 'john2', 'john3', 'jude', 'revelation']]
            entry_copy['nt_instances'] = [m for m in unique_matches if m['book'] in ['matthew', 'mark', 'luke', 'john', 'acts', 'romans', 'corinthians1', 'corinthians2', 'galatians', 'ephesians', 'philippians', 'colossians', 'thessalonians1', 'thessalonians2', 'timothy1', 'timothy2', 'titus', 'philemon', 'hebrews', 'james', 'peter1', 'peter2', 'john1', 'john2', 'john3', 'jude', 'revelation']]

        return entry_copy


class OutputGenerator:
    """Generates output files."""

    def __init__(self):
        self.lexicon_dir = config.LEXICON_DIR

    def generate_custom_definitions(self, lexicon_entries: Dict[str, Dict]) -> Path:
        """Generate custom_definitions.json."""
        # Attach the versioned policy metadata while preserving source-specific
        # arrays.  Surface consumers can use ``surface_instances``; exporters
        # retain the complete, deterministically ranked set in ``instances``.
        for entry in lexicon_entries.values():
            source_instances = [
                instance
                for field in ("oe_instances", "nt_instances")
                for instance in entry.get(field, [])
                if isinstance(instance, dict)
            ]
            if not source_instances:
                continue
            policy = process_instances(source_instances)
            if policy["validation_errors"]:
                codes = ", ".join(sorted({finding["code"] for finding in policy["validation_errors"]}))
                raise ValueError(
                    f"instance policy validation failed for {entry.get('strong_number', 'unknown')}: {codes}"
                )
            entry["instance_policy_version"] = policy["policy_version"]
            entry["instance_total"] = policy["instance_total"]
            entry["instance_surface_count"] = policy["instance_surface_count"]
            entry["instance_tier"] = policy["tier"]
            entry["instance_omitted_count"] = policy["omitted_count"]
            entry["instances"] = policy["instances"]
            entry["surface_instances"] = policy["surface_instances"]
            entry["instance_validation_findings"] = policy["findings"]
            entry["instance_validation_errors"] = policy["validation_errors"]
            entry["instance_policy_valid"] = policy["is_valid"]
        output_file = self.lexicon_dir / 'custom_definitions.json'

        # Create directory if needed
        output_file.parent.mkdir(parents=True, exist_ok=True)

        # Write main file
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(lexicon_entries, f, ensure_ascii=False, indent=2)

        # Write pretty version for human readability
        pretty_file = self.lexicon_dir / 'custom_definitions.pretty.json'
        with open(pretty_file, 'w', encoding='utf-8') as f:
            json.dump(lexicon_entries, f, ensure_ascii=False, indent=2)

        return output_file

    def generate_compound_instances(self, lexicon_entries: Dict[str, Dict]) -> Path:
        """Generate compound_instances.json for quick verse lookup."""
        compound_instances = {
            'oe': {},
            'nt': {}
        }

        for entry_key, entry in lexicon_entries.items():
            # Only include entries that have detected instances
            if 'oe_instances' in entry and entry['oe_instances']:
                for instance in entry['oe_instances']:
                    verse_key = f"{instance['book']}.{instance['chapter']}.{instance['verse']}"
                    if verse_key not in compound_instances['oe']:
                        compound_instances['oe'][verse_key] = []
                    compound_instances['oe'][verse_key].append(entry_key)

            if 'nt_instances' in entry and entry['nt_instances']:
                for instance in entry['nt_instances']:
                    verse_key = f"{instance['book']}.{instance['chapter']}.{instance['verse']}"
                    if verse_key not in compound_instances['nt']:
                        compound_instances['nt'][verse_key] = []
                    compound_instances['nt'][verse_key].append(entry_key)

        output_file = self.lexicon_dir / 'compound_instances.json'
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(compound_instances, f, ensure_ascii=False, indent=2)

        return output_file


def main():
    """Main integration function."""
    print("🔄 Starting Custom Dictionary Integration")
    print("=" * 50)

    # Parse custom dictionary
    print("📖 Parsing custom_dict.json...")
    parser = CustomDictParser()
    entries = parser.parse_entries()
    print(f"   ✅ Parsed {len(entries)} entries")

    # Transform to lexicon format
    print("\n🔄 Transforming entries to lexicon format...")
    transformer = LexiconTransformer()
    lexicon_entries = transformer.transform_all_entries(entries)
    print(f"   ✅ Transformed {len(lexicon_entries)} lexicon entries")

    # Map instances
    print("\n🔍 Scanning biblical texts for instances...")
    mapper = InstanceMapper()
    updated_entries = {}

    for entry_key, entry in lexicon_entries.items():
        # Reconstruct pattern from entry
        if 'is_compound' in entry:
            pattern = StrongPattern('compound', entry['strong_numbers'], entry_key)
        elif 'is_alternative' in entry:
            pattern = StrongPattern('alternative', entry['alternative_strongs'], entry_key)
        elif 'is_mixed' in entry:
            # Extract components from patterns array
            components = []
            for pat in entry['patterns']:
                if pat['type'] == 'single':
                    components.append(pat['strong'])
                elif pat['type'] == 'compound':
                    components.extend(pat['strongs'])
            pattern = StrongPattern('mixed', components, entry_key)
        else:
            pattern = StrongPattern('single', [entry['strong_number']], entry_key)

        updated_entry = mapper.map_instances_for_entry(entry, pattern)
        updated_entries[entry_key] = updated_entry

    print(f"   ✅ Mapped instances for {len(updated_entries)} entries")

    # Generate output files
    print("\n💾 Generating output files...")
    generator = OutputGenerator()

    custom_defs_file = generator.generate_custom_definitions(updated_entries)
    compound_instances_file = generator.generate_compound_instances(updated_entries)

    print(f"   ✅ Generated {custom_defs_file}")
    print(f"   ✅ Generated {compound_instances_file}")

    print("\n🎉 Custom Dictionary Integration Complete!")
    print("=" * 50)


if __name__ == "__main__":
    main()