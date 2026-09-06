#!/usr/bin/env python3
"""
Hebrew Scripture Lexicon Builder - Main Script

Builds complete lexicon entries with BDB definitions, senses, occurrences, and roots.
This is the main entry point for the lexicon generation pipeline.

Supports testing mode with 1% of data for development and validation.
"""

if __package__:
    from .transliteration_policy import apply_transliteration_policy
else:
    from transliteration_policy import apply_transliteration_policy

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from config import config
from utils import save_json, load_json, load_strongs_data, load_strong_refs, load_bdb_xml

# Import extraction functions
sys.path.insert(0, str(config.OE_DIR))
try:
    from extract_word_osb import extract_from_strongs, extract_from_bdb
    EXTRACTION_AVAILABLE = True
except ImportError:
    EXTRACTION_AVAILABLE = False
    extract_from_strongs = None
    extract_from_bdb = None

NS = {'bdb': 'http://openscriptures.github.com/morphhb/namespace'}

LOG_MAPPING_MISMATCHES = os.getenv('DAVAR_LEXICON_LOG_MAPPING', '').lower() in {'1', 'true', 'yes'}

# Consolidated data storage for new format
consolidated_roots = {}
consolidated_words = {}


def save_consolidated_files(testing_mode: bool = False) -> None:
    """Save consolidated lexicon files in the new format (pretty-printed)."""
    if testing_mode:
        return  # Skip consolidation in testing mode

    lexicon_dir = config.LEXICON_DIR

    # Save consolidated roots (pretty-printed)
    if consolidated_roots:
        roots_file = lexicon_dir / 'roots.json'
        print(f"💾 Saving consolidated roots to {roots_file}...")
        save_json(consolidated_roots, roots_file)
        print(f"✅ Saved {len(consolidated_roots)} root entries")

    # Save consolidated words (pretty-printed)
    if consolidated_words:
        words_file = lexicon_dir / 'words.json'
        print(f"💾 Saving consolidated words to {words_file}...")
        save_json(consolidated_words, words_file)
        print(f"✅ Saved {len(consolidated_words)} word entries")


def create_definition(text_en: str, source: str, order: int, sense: Optional[str] = None) -> Dict:
    """
    Create a definition object

    Args:
        text_en: English definition
        source: Source (bdb, strongs, strongs_kjv)
        order: Order number
        sense: Optional sense number from BDB ("0" for main definitions, "1", "2", etc. for senses)

    Returns:
        Dictionary with text_en, source, order, and sense (if BDB source)
    """
    definition = {
        "text_en": text_en.strip(),
        "source": source,
        "order": order
    }

    # For BDB definitions, always include sense field
    if source == "bdb":
        definition["sense"] = sense if sense else "0"
    elif sense:
        definition["sense"] = sense

    return definition





def load_lexical_index() -> Dict:
    """
    Load LexicalIndex XML and create mappings.

    Returns:
        Dictionary with two keys:
        - 'strong_to_bdb': Maps Strong's numbers to list of BDB ids
        - 'bdb_to_def': Maps BDB ids to LexicalIndex <def> text
        - 'bdb_to_pos': Maps BDB ids to LexicalIndex part of speech
        - 'strong_bdb_to_defs': Maps Strong's+BDB ids to all LexicalIndex defs
    """
    if not config.LEXICAL_INDEX.exists():
        return {"strong_to_bdb": {}, "bdb_to_def": {}, "bdb_to_pos": {}, "strong_bdb_to_defs": {}}

    try:
        tree = ET.parse(config.LEXICAL_INDEX)
        root = tree.getroot()

        li_ns = {'li': 'http://openscriptures.github.com/morphhb/namespace'}
        strong_to_bdb: Dict[str, List[str]] = {}
        bdb_to_def: Dict[str, str] = {}
        bdb_to_pos: Dict[str, str] = {}
        strong_bdb_to_defs: Dict[str, Dict[str, List[str]]] = {}

        for entry in root.findall('.//li:entry', li_ns):
            xref = entry.find('li:xref', li_ns)
            def_elem = entry.find('li:def', li_ns)
            pos_elem = entry.find('li:pos', li_ns)

            if xref is not None:
                strong = xref.get('strong')
                bdb = xref.get('bdb')

                if strong and bdb:
                    strong_key = f"H{strong}"
                    pos = pos_elem.text.strip() if pos_elem is not None and pos_elem.text else ""

                    if pos == "Np":
                        continue

                    # Build strong_to_bdb mapping
                    if strong_key not in strong_to_bdb:
                        strong_to_bdb[strong_key] = []
                    if bdb not in strong_to_bdb[strong_key]:
                        strong_to_bdb[strong_key].append(bdb)

                    # Build bdb_to_def mapping (capture the <def> text for this BDB entry)
                    if def_elem is not None and def_elem.text and bdb:
                        gloss = def_elem.text.strip()
                        bdb_to_def.setdefault(bdb, gloss)
                        strong_bdb_to_defs.setdefault(strong_key, {}).setdefault(bdb, [])
                        if gloss not in strong_bdb_to_defs[strong_key][bdb]:
                            strong_bdb_to_defs[strong_key][bdb].append(gloss)
                    if pos:
                        bdb_to_pos[bdb] = pos

        return {
            "strong_to_bdb": strong_to_bdb,
            "bdb_to_def": bdb_to_def,
            "bdb_to_pos": bdb_to_pos,
            "strong_bdb_to_defs": strong_bdb_to_defs,
        }
    except Exception as e:
        print(f"Error loading lexical index: {e}")
        return {"strong_to_bdb": {}, "bdb_to_def": {}, "bdb_to_pos": {}, "strong_bdb_to_defs": {}}


def normalize_definition_text(text: str) -> str:
    """Normalize definition text for matching"""
    return re.sub(r'\s+', ' ', text.strip().lower())


def find_bdb_entry(hebrew_word: str, root_element, include_roots: bool = False) -> Optional[ET.Element]:
    """
    Find BDB entry for a Hebrew word

    IMPROVED LOGIC (to avoid etymological errors):
    - Skips entries with type="root" (etymological discussions) by default
    - Prioritizes entries where Hebrew word is a direct child (main word)
    - Gives +1000 bonus score to main word entries
    - Falls back to nested mentions if no direct match found
    - If include_roots=True, also searches in root-type entries (for words like H776)

    This prevents selecting etymological root entries that mention the word
    but don't actually define it (e.g., H430 was incorrectly using a.dl.aa
    etymological entry instead of a.dl.ad actual word entry).
    """
    if root_element is None:
        return None

    hebrew_normalized = re.sub(r'[\u0591-\u05C7]', '', hebrew_word)
    entries = root_element.findall('.//bdb:entry', NS)

    best_entry = None
    best_def_count = 0

    for entry in entries:
        # Skip root entries (etymological discussions) unless explicitly requested
        if entry.get('type') == 'root' and not include_roots:
            continue

        # Check direct children first (main word)
        direct_w_elements = entry.findall('./bdb:w', NS)
        is_main_word = False
        for w in direct_w_elements:
            if w.text:
                w_normalized = re.sub(r'[\u0591-\u05C7]', '', w.text)
                if w_normalized == hebrew_normalized:
                    is_main_word = True
                    break

        # Also check nested (mentioned in text)
        if not is_main_word:
            nested_w_elements = entry.findall('.//bdb:w', NS)
            for w in nested_w_elements:
                if w.text:
                    w_normalized = re.sub(r'[\u0591-\u05C7]', '', w.text)
                    if w_normalized == hebrew_normalized:
                        # Count definitions
                        def_elements = entry.findall('./bdb:def', NS)
                        def_count = len([d for d in def_elements if d.text and d.text.strip()])
                        for sense in entry.findall('.//bdb:sense', NS):
                            sense_defs = sense.findall('.//bdb:def', NS)
                            def_count += len([d for d in sense_defs if d.text and d.text.strip()])

                        score = def_count
                        if score > best_def_count:
                            best_entry = entry
                            best_def_count = score
                        break

        if is_main_word:
            # Count definitions
            def_elements = entry.findall('./bdb:def', NS)
            def_count = len([d for d in def_elements if d.text and d.text.strip()])
            for sense in entry.findall('.//bdb:sense', NS):
                sense_defs = sense.findall('.//bdb:def', NS)
                def_count += len([d for d in sense_defs if d.text and d.text.strip()])

            # Main word gets +1000 bonus (unless it's a root entry, then use actual count)
            if entry.get('type') == 'root':
                score = def_count
            else:
                score = 1000 + def_count

            if score > best_def_count:
                best_entry = entry
                best_def_count = score

    return best_entry


def find_bdb_entry_by_id(root_element, bdb_id: Optional[str]) -> Optional[ET.Element]:
    """Find a BDB entry by its id attribute."""
    if root_element is None or not bdb_id:
        return None
    return root_element.find(f'.//bdb:entry[@id="{bdb_id}"]', NS)


def extract_bdb_definitions_with_sense(
    strong_number: str,
    hebrew_word: str,
    bdb_root,
    lexical_index: Dict,
) -> List[Dict]:
    """
    Extract BDB definitions with sense assignment

    IMPROVED EXTRACTION:
    - Extracts ALL definitions from ALL senses (not just main definitions)
    - Extracts text directly from <sense> elements when no <def> tags present
    - Allows duplicate definitions across different senses (uses (sense, text) as key)
    - Recursively processes nested senses to capture complete hierarchy
    - Properly handles sense paths like "1a", "2b" instead of incomplete "a", "b"

    This ensures completeness: "es que la idea de lexicon es que estuvieran todas
    las definiciones para todas las palabras" - all definitions for all words.
    """
    definitions = []

    if not hebrew_word:
        strongs_data = load_strongs_data()
        if strong_number in strongs_data:
            hebrew_word = strongs_data[strong_number].get('lemma', '')
        else:
            return definitions

    if not hebrew_word:
        return definitions

    hebrew_normalized = re.sub(r'[\u0591-\u05C7]', '', hebrew_word)

    bdb_data = None
    using_lexical_mapped_entries = False
    bdb_ids = lexical_index.get("strong_to_bdb", {}).get(strong_number, [])
    bdb_to_def = lexical_index.get("bdb_to_def", {})
    strong_bdb_to_defs = lexical_index.get("strong_bdb_to_defs", {})

    # Prefer LexicalIndex-selected XML entries when available. The legacy
    # extractor can return only top-level <def> fragments and miss nested BDB
    # sense glosses for entries such as H7235.
    if not bdb_ids and EXTRACTION_AVAILABLE and extract_from_bdb:
        bdb_data = extract_from_bdb(hebrew_word)

    # If direct search fails or module not available, search manually in XML
    if not bdb_data or not bdb_data.get('definitions'):
        if bdb_root is not None:
            def build_bdb_entry_data(bdb_entry: ET.Element) -> Dict:
                # Find the correct Hebrew word element (prefer longer/matching one)
                w_elements = bdb_entry.findall('.//bdb:w', NS)
                bdb_hebrew = ''
                hebrew_normalized = re.sub(r'[\u0591-\u05C7]', '', hebrew_word)
                for w_elem in w_elements:
                    if w_elem.text:
                        w_normalized = re.sub(r'[\u0591-\u05C7]', '', w_elem.text)
                        if w_normalized == hebrew_normalized or len(w_normalized) >= len(hebrew_normalized):
                            bdb_hebrew = w_elem.text
                            break
                # Fallback to first if no match found
                if not bdb_hebrew and w_elements:
                    bdb_hebrew = w_elements[0].text if w_elements[0].text else ''

                entry_data = {
                    'id': bdb_entry.get('id', ''),
                    'hebrew': bdb_hebrew,
                    'definitions': [],
                    'senses': []
                }

                def_elements = bdb_entry.findall('./bdb:def', NS)
                entry_data['definitions'] = [d.text for d in def_elements if d.text]

                def extract_text_from_element(elem: ET.Element) -> str:
                    """Extract text content from element, removing child element tags but keeping their text"""
                    if elem.text:
                        text_parts = [elem.text]
                    else:
                        text_parts = []

                    # Get text from all children (def, w, ref, etc.)
                    for child in elem:
                        if child.text:
                            text_parts.append(child.text)
                        if child.tail:
                            text_parts.append(child.tail)

                    # Join and clean up
                    full_text = ''.join(text_parts).strip()
                    # Remove extra whitespace
                    full_text = re.sub(r'\s+', ' ', full_text)
                    return full_text

                def extract_senses_recursive(sense_elem: ET.Element, parent_path: str = ""):
                    """Recursively extract senses with complete paths"""
                    current_path = sense_elem.get('n', '')
                    sense_path = f"{parent_path}{current_path}" if current_path and parent_path else current_path or parent_path

                    # Check if this sense has nested senses
                    nested_senses = sense_elem.findall('./bdb:sense', NS)
                    has_nested = len(nested_senses) > 0

                    # Get direct definitions in this sense (not in nested senses)
                    direct_defs = sense_elem.findall('./bdb:def', NS)
                    sense_texts = []

                    if direct_defs:
                        # Extract from <def> elements
                        sense_texts = [d.text for d in direct_defs if d.text and d.text.strip()]
                    elif not has_nested:
                        # Only extract text from sense element if it has NO nested senses
                        sense_text = extract_text_from_element(sense_elem)
                        if sense_text and len(sense_text) > 1:
                            # Only add if it's meaningful (not just punctuation or single chars)
                            if sense_text.lower() not in ['in', 'on', 'at', 'to', 'of', 'by', 'as', 'with', 'from', 'for']:
                                sense_texts = [sense_text]

                    # Only add this sense if it has definitions and no nested senses,
                    # OR if it has definitions AND nested senses (meaningful parent sense).
                    # Unnumbered stem wrappers (Qal/Pi/Hiph) use sense "0" for direct
                    # defs and pass their parent path through to numbered children.
                    if sense_texts and (not has_nested or direct_defs):
                        entry_data['senses'].append({
                            "number": sense_path or "0",
                            "definitions": sense_texts
                        })

                    # Process nested senses recursively
                    for nested_sense in nested_senses:
                        extract_senses_recursive(nested_sense, sense_path)

                # Process all top-level senses
                top_level_senses = bdb_entry.findall('./bdb:sense', NS)
                for sense in top_level_senses:
                    extract_senses_recursive(sense)

                return entry_data

            bdb_entries: List[ET.Element] = []
            # Try to find exact BDB entries using LexicalIndex mapping
            for bdb_id in bdb_ids:
                entry = find_bdb_entry_by_id(bdb_root, bdb_id)
                if entry is not None:
                    bdb_entries.append(entry)
            using_lexical_mapped_entries = bool(bdb_entries)
            
            # Fallback to old method if not found
            if not bdb_entries:
                # First try without root entries (normal case)
                bdb_entry = find_bdb_entry(hebrew_word, bdb_root, include_roots=False)
                # If not found, try with root entries (for words like H776)
                if bdb_entry is None:
                    bdb_entry = find_bdb_entry(hebrew_word, bdb_root, include_roots=True)
                if bdb_entry is not None:
                    bdb_entries.append(bdb_entry)
            elif LOG_MAPPING_MISMATCHES:
                entry_ids = {entry.get('id', '') for entry in bdb_entries}
                missing_ids = [bdb_id for bdb_id in bdb_ids if bdb_id not in entry_ids]
                if missing_ids:
                    print(
                        f"⚠️  LexicalIndex missing entries for {strong_number}: {', '.join(missing_ids)}"
                    )

            if bdb_entries:
                bdb_data = [build_bdb_entry_data(entry) for entry in bdb_entries]

    if not bdb_data:
        return definitions

    bdb_entries_data = bdb_data if isinstance(bdb_data, list) else [bdb_data]

    # Build sense mapping from BDB XML if available
    sense_mapping: Dict[str, str] = {}
    if bdb_root is not None:
        def add_sense_mapping(xml_entry: Optional[ET.Element]) -> None:
            if xml_entry is None:
                return
            for key, value in build_sense_mapping(xml_entry).items():
                if key not in sense_mapping:
                    sense_mapping[key] = value

        if bdb_ids:
            for bdb_id in bdb_ids:
                add_sense_mapping(find_bdb_entry_by_id(bdb_root, bdb_id))

        if not sense_mapping:
            xml_entry = find_bdb_entry(hebrew_word, bdb_root, include_roots=False)
            if xml_entry is None:
                xml_entry = find_bdb_entry(hebrew_word, bdb_root, include_roots=True)
            add_sense_mapping(xml_entry)

    # Use sense+text as key to allow same word in different senses
    seen = set()
    order = 1

    def is_single_word_fragments(defs: List[str]) -> bool:
        """Check if all definitions are single-word fragments"""
        if not defs:
            return False
        cleaned = [d.strip() for d in defs if d and d.strip()]
        if not cleaned:
            return False
        # Check if all are single words (no spaces, commas, or semicolons)
        return all(len(d.split()) == 1 and ',' not in d and ';' not in d for d in cleaned)

    def collapse_main_definitions(defs: List[str]) -> Optional[str]:
        cleaned = [d.strip() for d in defs if d and d.strip()]
        if len(cleaned) < 3:
            return None
        if any(len(d.split()) > 1 for d in cleaned):
            return None
        return ", ".join(cleaned)

    def definition_represents(gloss: str) -> bool:
        normalized = normalize_definition_text(gloss)
        if not normalized:
            return False

        normalized_parts = {
            part.strip()
            for part in re.split(r"[,;]", normalized)
            if part.strip()
        }
        for existing in definitions:
            current = normalize_definition_text(existing.get("text_en", ""))
            if not current:
                continue
            if normalized == current or normalized in current or current in normalized:
                return True

            current_parts = {
                part.strip()
                for part in re.split(r"[,;]", current)
                if part.strip()
            }
            if normalized_parts and current_parts and normalized_parts <= current_parts:
                return True

        return False

    # Count valid BDB entries to determine if we should use LexicalIndex override
    valid_bdb_count = 0
    for bdb_entry in bdb_entries_data:
        if not bdb_entry:
            continue
        bdb_hebrew = bdb_entry.get('hebrew', '')
        if bdb_hebrew:
            bdb_normalized = re.sub(r'[\u0591-\u05C7]', '', bdb_hebrew)
            if not using_lexical_mapped_entries and bdb_normalized != hebrew_normalized:
                if hebrew_normalized not in bdb_normalized or len(bdb_normalized) > len(hebrew_normalized) + 2:
                    continue
        valid_bdb_count += 1

    for bdb_entry in bdb_entries_data:
        if not bdb_entry:
            continue

        # Verify Hebrew word matches
        bdb_hebrew = bdb_entry.get('hebrew', '')
        if bdb_hebrew:
            bdb_normalized = re.sub(r'[\u0591-\u05C7]', '', bdb_hebrew)
            if not using_lexical_mapped_entries and bdb_normalized != hebrew_normalized:
                if hebrew_normalized not in bdb_normalized or len(bdb_normalized) > len(hebrew_normalized) + 2:
                    continue

        # Extract from definitions list (main definitions)
        if bdb_entry.get('definitions'):
            main_defs = bdb_entry['definitions']
            bdb_id = bdb_entry.get('id', '')

            # Use LexicalIndex gloss when BDB's top-level <def> values are
            # fragment tokens from one gloss (e.g. "be", "become", "much").
            if (
                is_single_word_fragments(main_defs)
                and bdb_id
                and bdb_id in bdb_to_def
                and len(bdb_to_def[bdb_id].split()) > 1
            ):
                # Use LexicalIndex <def> as the single main definition
                lex_gloss = bdb_to_def[bdb_id]
                def_key = ("0", lex_gloss.lower())
                if def_key not in seen:
                    seen.add(def_key)
                    def_text = normalize_definition_text(lex_gloss)
                    sense = sense_mapping.get(def_text, "0")
                    definitions.append(create_definition(lex_gloss, "bdb", order, sense))
                    order += 1
            else:
                # Only collapse definitions when there are MULTIPLE BDB entries
                # For single BDB entries, keep all synonyms separate
                combined_main = None
                if valid_bdb_count > 1:
                    combined_main = collapse_main_definitions(main_defs)

                if combined_main:
                    def_key = ("0", combined_main.lower())
                    if def_key not in seen:
                        seen.add(def_key)
                        def_text = normalize_definition_text(combined_main)
                        sense = sense_mapping.get(def_text, "0")
                        definitions.append(create_definition(combined_main, "bdb", order, sense))
                        order += 1
                else:
                    for defn in main_defs:
                        if defn and defn.strip():
                            if len(defn.strip()) > 1 and defn.strip().lower() not in ['in', 'on', 'at', 'to', 'of', 'by', 'as', 'with', 'from', 'for']:
                                # Use sense "0" as key for main definitions
                                def_key = ("0", defn.lower())
                                if def_key not in seen:
                                    seen.add(def_key)
                                    # Assign sense from mapping or default to "0"
                                    def_text = normalize_definition_text(defn)
                                    sense = sense_mapping.get(def_text, "0")
                                    definitions.append(create_definition(defn, "bdb", order, sense))
                                    order += 1

        # Extract from senses
        if bdb_entry.get('senses'):
            for sense_obj in bdb_entry['senses']:
                sense_num = sense_obj.get('number', '')
                for defn in sense_obj.get('definitions', []):
                    if defn and defn.strip():
                        if len(defn.strip()) > 1 and defn.strip().lower() not in ['in', 'on', 'at', 'to', 'of', 'by', 'as', 'with', 'from', 'for']:
                            # Use sense number + text as key to allow same word in different senses
                            def_key = (sense_num, defn.lower())
                            if def_key not in seen:
                                seen.add(def_key)
                                # Use sense number from sense object, or try mapping
                                def_text = normalize_definition_text(defn)
                                final_sense = sense_num if sense_num else sense_mapping.get(def_text, "0")
                                definitions.append(create_definition(defn, "bdb", order, final_sense))
                                order += 1

        bdb_id = bdb_entry.get('id', '')
        lex_glosses = strong_bdb_to_defs.get(strong_number, {}).get(bdb_id, [])
        if not lex_glosses and bdb_id in bdb_to_def:
            lex_glosses = [bdb_to_def[bdb_id]]
        for lex_gloss in lex_glosses:
            if not using_lexical_mapped_entries or not lex_gloss or definition_represents(lex_gloss):
                continue
            def_key = ("li", normalize_definition_text(lex_gloss))
            if def_key not in seen:
                seen.add(def_key)
                def_text = normalize_definition_text(lex_gloss)
                sense = sense_mapping.get(def_text, "0")
                definitions.append(create_definition(lex_gloss, "bdb", order, sense))
                order += 1

    return definitions


def build_sense_mapping(bdb_entry: ET.Element) -> Dict[str, str]:
    """Build mapping from definition text to sense number"""
    mapping = {}
    if bdb_entry is None:
        return mapping

    # Main definitions - use "0"
    main_defs = bdb_entry.findall('./bdb:def', NS)
    for def_elem in main_defs:
        if def_elem.text and def_elem.text.strip():
            def_text = normalize_definition_text(def_elem.text)
            if def_text not in mapping:
                mapping[def_text] = "0"

    def process_sense_recursive(sense_elem: ET.Element, parent_path: str = ""):
        """Recursively process sense elements to build complete paths"""
        current_n = sense_elem.get('n', '')
        if not current_n:
            return

        sense_path = f"{parent_path}{current_n}" if parent_path else current_n

        # Get direct definitions in this sense (not in nested senses)
        direct_defs = sense_elem.findall('./bdb:def', NS)
        for def_elem in direct_defs:
            if def_elem.text and def_elem.text.strip():
                def_text = normalize_definition_text(def_elem.text)
                if def_text not in mapping:
                    mapping[def_text] = sense_path

        # Process nested senses recursively
        nested_senses = sense_elem.findall('./bdb:sense', NS)
        for nested_sense in nested_senses:
            process_sense_recursive(nested_sense, sense_path)

    # Process all top-level senses
    top_level_senses = bdb_entry.findall('./bdb:sense', NS)
    for sense in top_level_senses:
        process_sense_recursive(sense)

    return mapping


def normalize_references(refs: list) -> list:
    """Normalize references to lowercase and sort"""
    refs_lower = [ref.lower() for ref in refs]

    def sort_key(ref: str) -> tuple:
        parts = ref.split('.')
        if len(parts) < 3:
            return (ref, 0, 0)
        book = parts[0].lower()
        try:
            chapter = int(parts[1])
        except ValueError:
            chapter = 999
        try:
            verse = int(parts[2])
        except ValueError:
            verse = 999
        return (book, chapter, verse)

    return sorted(refs_lower, key=sort_key)


def determine_sources(definitions: list) -> Dict[str, bool]:
    """Determine which sources are available"""
    sources = {"strongs": False, "bdb": False}
    for defn in definitions:
        source = defn.get('source', '')
        if source == 'bdb':
            sources['bdb'] = True
        elif source in ['strongs', 'strongs_kjv']:
            sources['strongs'] = True
    return sources


def _definition_key(definition: Dict) -> tuple:
    """Return a stable identity for matching regenerated definitions."""
    return (
        definition.get('source', ''),
        definition.get('text_en') or definition.get('text') or '',
        definition.get('sense', ''),
    )


def _collapsed_translation(
    definition: Dict,
    existing_definitions: List[Dict],
    language_field: str,
) -> str:
    """Build a translation for comma-collapsed regenerated definitions."""
    text = definition.get('text_en') or definition.get('text') or ''
    if ',' not in text:
        return ''

    parts = [part.strip() for part in text.split(',') if part.strip()]
    if len(parts) < 2:
        return ''

    translations = []
    for part in parts:
        match = next(
            (
                existing
                for existing in existing_definitions
                if existing.get('source') == definition.get('source')
                and existing.get('sense', '') == definition.get('sense', '')
                and (existing.get('text_en') or existing.get('text') or '') == part
                and existing.get(language_field)
            ),
            None,
        )
        if not match:
            return ''
        translations.append(match[language_field])

    return '; '.join(translations)


def preserve_existing_definition_metadata(
    generated_definitions: List[Dict],
    existing_definitions: List[Dict],
) -> List[Dict]:
    """Preserve reviewed definitions and existing translations during rebuilds."""
    existing_by_key = {_definition_key(definition): definition for definition in existing_definitions}
    merged = []

    for definition in generated_definitions:
        updated = definition.copy()
        existing = existing_by_key.get(_definition_key(definition))
        if existing:
            for key, value in existing.items():
                if key.startswith('text_') and key != 'text_en' and value and key not in updated:
                    updated[key] = value
        for key in ('text_es', 'text_pt'):
            if key not in updated:
                collapsed = _collapsed_translation(definition, existing_definitions, key)
                if collapsed:
                    updated[key] = collapsed
        merged.append(updated)

    seen = {
        (
            definition.get('source', ''),
            definition.get('text_en') or definition.get('text') or '',
            definition.get('text_es', ''),
            definition.get('sense', ''),
        )
        for definition in merged
    }
    next_order = max([int(definition.get('order', 0)) for definition in merged] or [0]) + 1

    for definition in existing_definitions:
        if definition.get('source') != 'delitzsch_review':
            continue

        key = (
            definition.get('source', ''),
            definition.get('text_en') or definition.get('text') or '',
            definition.get('text_es', ''),
            definition.get('sense', ''),
        )
        if key in seen:
            continue

        preserved = definition.copy()
        preserved['order'] = next_order
        next_order += 1
        merged.append(preserved)
        seen.add(key)

    return merged


def build_lexicon_entry(strong_number: str, bdb_root, update_existing: bool = False, testing_mode: bool = False) -> Dict:
    """
    Build a complete lexicon entry for a Strong's number

    Args:
        strong_number: Strong's number (e.g., "H7965")
        bdb_root: BDB XML root element
        update_existing: If True, update existing entry
        testing_mode: If True, don't modify existing data

    Returns:
        Complete lexicon entry dictionary
    """
    strongs_data = load_strongs_data()
    strong_refs = load_strong_refs()

    # Determine output directories
    if testing_mode:
        output_draft = config.LEXICON_TESTING_DRAFT_DIR
        output_roots = config.LEXICON_TESTING_ROOTS_DIR
    else:
        output_draft = config.LEXICON_DRAFT_DIR
        output_roots = config.LEXICON_ROOTS_DIR

    # Check if entry exists. Update mode must look in both directories because
    # roots are saved under roots/ and words under words/.
    existing_entry = {}
    if update_existing and not testing_mode:
        for entry_file in (
            output_draft / f"{strong_number}.json",
            output_roots / f"{strong_number}.json",
        ):
            if entry_file.exists():
                with open(entry_file, 'r', encoding='utf-8') as f:
                    existing_entry = json.load(f)
                break

    if strong_number not in strongs_data:
        return {}

    strongs_entry = strongs_data[strong_number]

    # Build entry
    entry = {
        "strong_number": strong_number,
        "lemma": strongs_entry.get('lemma', ''),
        "normalized": existing_entry.get('normalized', re.sub(r'[\u0591-\u05C7]', '', strongs_entry.get('lemma', ''))),
        "pronunciation": strongs_entry.get('pron', ''),
        "transliteration": existing_entry.get('transliteration', strongs_entry.get('xlit', '')),
        "translit_en": existing_entry.get('translit_en', ''),
        "translit_es": existing_entry.get('translit_es', ''),
        "definitions": [],
        "sources": {
            "strongs": False,
            "bdb": False
        }
    }

    # Extract BDB definitions with sense assignment
    hebrew_word = strongs_entry.get('lemma', '')
    lexical_index = load_lexical_index()
    bdb_definitions = extract_bdb_definitions_with_sense(strong_number, hebrew_word, bdb_root, lexical_index)

    if bdb_definitions:
        entry["sources"]["bdb"] = True
        entry["definitions"].extend(bdb_definitions)

    if existing_entry.get("definitions"):
        entry["definitions"] = preserve_existing_definition_metadata(
            entry["definitions"],
            existing_entry.get("definitions", []),
        )
        entry["sources"] = determine_sources(entry["definitions"])

    # Add occurrences
    refs_data = None
    if strong_number in strong_refs:
        refs_data = strong_refs[strong_number]
    else:
        num_part = strong_number[1:]
        padded_formats = [
            f"H{num_part.zfill(4)}",
            f"H{num_part.zfill(3)}",
            f"H{num_part.zfill(2)}",
        ]
        for fmt in padded_formats:
            if fmt in strong_refs:
                refs_data = strong_refs[fmt]
                break

    if refs_data:
        refs = refs_data.get('references', [])
        sorted_refs = normalize_references(refs)
        entry["occurrences"] = {
            "total": len(sorted_refs),
            "references": sorted_refs
        }
    else:
        entry["occurrences"] = {
            "total": 0,
            "references": []
        }

    # Determine if word is a root
    derivation = strongs_entry.get('derivation', '').lower()
    is_root = (
        ('primitive root' in derivation and 'from' not in derivation) or
        ('primitive word' in derivation and 'from' not in derivation) or
        (derivation.strip().endswith('root') and 'from' not in derivation and 'unused' not in derivation) or
        (derivation.strip() == 'root')
    )

    entry["is_root"] = is_root

    if is_root:
        pass  # Root words don't need root_ref
    else:
        # Extract root
        root_match = re.search(r'(?:from\s+)?(H\d+)', derivation, re.IGNORECASE)
        if root_match:
            root_number = root_match.group(1).upper()
            entry["root_ref"] = root_number

    return apply_transliteration_policy(entry)


def save_lexicon_entry(entry: Dict, testing_mode: bool = False, consolidate: bool = True) -> Path:
    """
    Save lexicon entry to file

    IMPROVED: Automatically removes duplicate files from the opposite directory:
    - When saving to roots/, removes from draft/ if exists
    - When saving to draft/, removes from roots/ if exists (prevents duplicates)

    Args:
        entry: Lexicon entry dictionary
        testing_mode: If True, save to testing/ directory

    Returns:
        Path to saved file
    """
    strong_number = entry["strong_number"]

    if testing_mode:
        output_draft = config.LEXICON_TESTING_DRAFT_DIR
        output_roots = config.LEXICON_TESTING_ROOTS_DIR
    else:
        output_draft = config.LEXICON_DRAFT_DIR
        output_roots = config.LEXICON_ROOTS_DIR

    # If this word IS a root, save it ONLY to roots/
    if entry.get('is_root'):
        root_file = output_roots / f"{strong_number}.json"
        root_entry = entry.copy()
        root_entry.pop('root_ref', None)

        # Ensure occurrences and sources are present
        if 'occurrences' not in root_entry:
            root_entry['occurrences'] = {"total": 0, "references": []}
        if 'sources' not in root_entry:
            root_entry['sources'] = determine_sources(root_entry.get('definitions', []))

        output_roots.mkdir(parents=True, exist_ok=True)
        with open(root_file, 'w', encoding='utf-8') as f:
            json.dump(root_entry, f, ensure_ascii=False, indent=2)

        # Remove from draft/ if it exists
        draft_file = output_draft / f"{strong_number}.json"
        if draft_file.exists():
            draft_file.unlink()

        # Add to consolidated data (only in production mode)
        if consolidate and not testing_mode:
            consolidated_roots[strong_number] = root_entry

        return root_file

    # If this word is NOT a root, save it to draft/
    output_draft.mkdir(parents=True, exist_ok=True)

    # Ensure occurrences and sources are present
    if 'occurrences' not in entry:
        entry['occurrences'] = {"total": 0, "references": []}
    if 'sources' not in entry:
        entry['sources'] = determine_sources(entry.get('definitions', []))

    output_file = output_draft / f"{strong_number}.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(entry, f, ensure_ascii=False, indent=2)

    # Remove from roots/ if it exists (since this is NOT a root)
    root_file = output_roots / f"{strong_number}.json"
    if root_file.exists():
        root_file.unlink()

    # Add to consolidated data (only in production mode)
    if consolidate and not testing_mode:
        consolidated_words[strong_number] = entry

    return output_file


def fill_missing_definitions(directories: List[Path] = None, bdb_root = None) -> Dict:
    """
    Fill missing definitions for files that don't have any definitions

    Searches BDB by lemma (including root-type entries) to find definitions
    for entries that were created but don't have definitions yet.

    Args:
        directories: List of directories to search (default: draft/ and testing/)
        bdb_root: BDB XML root element (will load if not provided)

    Returns:
        Dictionary with statistics: {'updated': int, 'failed': int, 'total': int}
    """
    if directories is None:
        directories = [config.LEXICON_DRAFT_DIR, config.LEXICON_TESTING_DRAFT_DIR, config.LEXICON_TESTING_ROOTS_DIR]

    if bdb_root is None:
        bdb_root = load_bdb_xml()
        if bdb_root is None:
            return {'updated': 0, 'failed': 0, 'total': 0, 'error': 'BDB XML not found'}

    lexical_index = load_lexical_index()

    # Find all JSON files without definitions
    files_to_process = []
    for directory in directories:
        if not directory.exists():
            continue
        for json_file in directory.glob('H*.json'):
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                definitions = data.get('definitions', [])
                if not definitions or len(definitions) == 0:
                    files_to_process.append(json_file)
            except Exception:
                pass

    if len(files_to_process) == 0:
        return {'updated': 0, 'failed': 0, 'total': 0}

    updated_count = 0
    failed_count = 0

    # Set batch mode
    build_lexicon_entry._batch_mode = True

    for i, json_file in enumerate(files_to_process, 1):
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            strong_number = data.get('strong_number', json_file.stem)
            lemma = data.get('lemma', '') or data.get('normalized', '')

            if not lemma:
                failed_count += 1
                continue

            # Extract definitions using the same logic as build_lexicon_entry
            bdb_definitions = extract_bdb_definitions_with_sense(strong_number, lemma, bdb_root, lexical_index)

            if bdb_definitions:
                data['definitions'] = bdb_definitions
                data['sources']['bdb'] = True

                with open(json_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)

                updated_count += 1
            else:
                failed_count += 1
        except Exception as e:
            failed_count += 1

    # Remove batch mode
    if hasattr(build_lexicon_entry, '_batch_mode'):
        delattr(build_lexicon_entry, '_batch_mode')

    return {
        'updated': updated_count,
        'failed': failed_count,
        'total': len(files_to_process)
    }


def main():
    """Main function"""
    print("=" * 80)
    print("LEXICON BUILDER - CONSOLIDATED")
    print("=" * 80)

    # Check for fill-missing mode
    if '--fill-missing' in sys.argv or '--fill' in sys.argv:
        print("\n🔍 FILL MISSING DEFINITIONS MODE")
        print("=" * 80)

        bdb_root = load_bdb_xml()
        if bdb_root is None:
            print("❌ Error: BDB XML not found")
            sys.exit(1)

        directories = [config.LEXICON_DRAFT_DIR, config.LEXICON_TESTING_DRAFT_DIR, config.LEXICON_TESTING_ROOTS_DIR]
        if '--testing-only' in sys.argv:
            directories = [config.LEXICON_TESTING_DRAFT_DIR, config.LEXICON_TESTING_ROOTS_DIR]
        elif '--draft-only' in sys.argv:
            directories = [config.LEXICON_DRAFT_DIR]

        print(f"\n📁 Searching in: {', '.join(str(d) for d in directories)}")
        stats = fill_missing_definitions(directories, bdb_root)

        print("\n" + "=" * 80)
        print("FILL MISSING DEFINITIONS SUMMARY")
        print("=" * 80)
        print(f"✅ Updated: {stats['updated']}")
        print(f"❌ Failed: {stats['failed']}")
        print(f"📊 Total processed: {stats['total']}")
        sys.exit(0)

    # Check for testing mode
    testing_mode = '--testing' in sys.argv or '--test' in sys.argv
    if testing_mode:
        print("\n🧪 TESTING MODE: Using 1% of data in testing/ directory")

    # Load BDB XML
    print("\n📚 Loading BDB XML...")
    bdb_root = load_bdb_xml()
    if bdb_root is None:
        print("   ⚠️  BDB XML not found - sense assignment will be limited")
    else:
        print("   ✅ BDB XML loaded")

    # Check if processing batch from JSON file
    if len(sys.argv) >= 2 and sys.argv[1].endswith('.json'):
        list_file = Path(sys.argv[1])
        if not list_file.exists():
            print(f"❌ Error: File not found: {list_file}")
            sys.exit(1)

        with open(list_file, 'r', encoding='utf-8') as f:
            strong_numbers = json.load(f)

        if not isinstance(strong_numbers, list):
            print("❌ Error: JSON file must contain a list of Strong's numbers")
            sys.exit(1)

        # Apply testing mode limit (1% of data)
        if testing_mode:
            original_count = len(strong_numbers)
            limit_count = max(1, int(original_count * 0.01))  # 1% minimum 1
            strong_numbers = strong_numbers[:limit_count]
            print(f"\n🧪 Testing mode: Limited to {limit_count} entries (1% of {original_count})")

        update_existing = '--update' in sys.argv or '-u' in sys.argv

        # Filter out existing files (unless updating or testing)
        existing = []
        missing = []
        for num in strong_numbers:
            num = num.upper()
            if not num.startswith('H'):
                num = 'H' + num

            if testing_mode:
                output_file = config.LEXICON_TESTING_DRAFT_DIR / f"{num}.json"
            else:
                output_file = config.LEXICON_DRAFT_DIR / f"{num}.json"

            if output_file.exists():
                existing.append(num)
            else:
                missing.append(num)

        total = len(strong_numbers)
        existing_count = len(existing)
        missing_count = len(missing)

        print(f"\n📋 Batch Mode: Processing {total} entries")
        if update_existing:
            print(f"   🔄 Update mode: Will update {existing_count} existing entries")
            print(f"   ⏳ To generate: {missing_count} new entries")
            to_process = strong_numbers
        else:
            print(f"   ✅ Already exist: {existing_count} ({existing_count*100/total:.1f}%)")
            print(f"   ⏳ To generate: {missing_count} ({missing_count*100/total:.1f}%)")
            to_process = missing

        if len(to_process) == 0:
            if update_existing:
                print("\n⚠️  No entries to process!")
            else:
                print("\n✅ All entries already exist!")
            sys.exit(0)

        # Set batch mode flag
        build_lexicon_entry._batch_mode = True
        save_lexicon_entry._update_mode = update_existing

        # Process entries
        success = 0
        failed = []

        for i, strong_number in enumerate(to_process, 1):
            progress = (i / len(to_process)) * 100
            print(f"[{i}/{len(to_process)}] ({progress:.1f}%) Processing {strong_number}...", end=' ', flush=True)

            try:
                entry = build_lexicon_entry(strong_number, bdb_root, update_existing=update_existing, testing_mode=testing_mode)

                if entry:
                    save_lexicon_entry(entry, testing_mode=testing_mode)
                    success += 1
                    def_count = len(entry.get('definitions', []))
                    root_info = ""
                    if entry.get('is_root'):
                        root_info = ", IS ROOT"
                    elif entry.get('root_ref'):
                        root_info = f", root: {entry['root_ref']}"
                    print(f"✅ ({def_count} defs{root_info})")
                else:
                    failed.append(strong_number)
                    print("❌ Failed")

            except Exception as e:
                failed.append(strong_number)
                print(f"❌ Error: {str(e)[:50]}")

        # Save consolidated files
        save_consolidated_files(testing_mode=testing_mode)

        # Remove batch mode flag
        if hasattr(build_lexicon_entry, '_batch_mode'):
            delattr(build_lexicon_entry, '_batch_mode')
        if hasattr(save_lexicon_entry, '_update_mode'):
            delattr(save_lexicon_entry, '_update_mode')

        # Summary
        print("\n" + "=" * 80)
        print("BATCH SUMMARY")
        print("=" * 80)
        if update_existing:
            updated = sum(1 for num in existing if num in [e for e in to_process[:success]])
            generated = success - updated
            print(f"✅ Successfully generated: {generated}")
            print(f"🔄 Successfully updated: {updated}")
        else:
            print(f"✅ Successfully generated: {success}/{missing_count}")
        print(f"❌ Failed: {len(failed)}")
        if testing_mode:
            print(f"🧪 Testing mode: Files saved to {config.LEXICON_TESTING_DIR}")

        sys.exit(0)

    # Single entry mode
    print("\nUsage:")
    print("  python3 build_lexicon.py H7965                    # Build single entry")
    print("  python3 build_lexicon.py H7965 --update            # Update existing entry")
    print("  python3 build_lexicon.py list.json                 # Batch process")
    print("  python3 build_lexicon.py list.json --testing       # Testing mode (1% data)")
    print("  python3 build_lexicon.py list.json --update        # Update existing entries")
    print("  python3 build_lexicon.py --fill-missing            # Fill missing definitions")
    print("  python3 build_lexicon.py --fill-missing --draft-only  # Only draft/ directory")
    print("  python3 build_lexicon.py --fill-missing --testing-only  # Only testing/ directory")
    print()

    if len(sys.argv) < 2:
        print("Error: Please provide a Strong's number (e.g., H7965) or JSON file")
        sys.exit(1)

    strong_number = sys.argv[1].upper()
    if not strong_number.startswith('H'):
        strong_number = 'H' + strong_number

    update_existing = '--update' in sys.argv or '-u' in sys.argv

    if testing_mode:
        output_file = config.LEXICON_TESTING_DRAFT_DIR / f"{strong_number}.json"
    else:
        output_file = config.LEXICON_DRAFT_DIR / f"{strong_number}.json"

    if output_file.exists() and not update_existing:
        print(f"⚠️  Entry already exists: {output_file}")
        print("   Use --update flag to regenerate")
        sys.exit(0)

    print(f"\n🔨 Building lexicon entry for {strong_number}...")
    if testing_mode:
        print("   🧪 Testing mode: Will save to testing/ directory")

    entry = build_lexicon_entry(strong_number, bdb_root, update_existing=update_existing, testing_mode=testing_mode)

    if not entry:
        print(f"\n❌ Failed to build entry for {strong_number}")
        sys.exit(1)

    output_file = save_lexicon_entry(entry, testing_mode=testing_mode)

    print(f"\n✅ Entry saved to: {output_file}")
    print(f"\n📊 Summary:")
    print(f"   Total definitions: {len(entry['definitions'])}")
    print(f"   BDB definitions: {sum(1 for d in entry['definitions'] if d['source'] == 'bdb')}")
    print(f"   Occurrences: {entry['occurrences']['total']}")
    print(f"   Is root: {entry.get('is_root', False)}")


if __name__ == "__main__":
    main()
