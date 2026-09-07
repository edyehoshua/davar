"""
Processor module for batch processing Delitzsch books.

Scans parsed JSON files, matches null-strong words, and generates output.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict

from .config import PARSED_DIR, OUTPUT_DIR, ALL_BOOKS
from .dictionary_index import DictionaryIndex
from .matcher import StrongMatcher, MatchResult
from .normalizer import normalize_hebrew

logger = logging.getLogger(__name__)


@dataclass
class WordAssignment:
    """Single word assignment result."""
    word_index: int
    text: str
    prefixes: List[str]
    type: str  # 'strong', 'failed', 'skipped'
    verse: Optional[int] = None
    previous_strong: Optional[str] = None
    strong: Optional[str] = None
    error: Optional[str] = None
    confidence: float = 0.0
    reason: str = ""


@dataclass
class ChapterResult:
    """Results for a single chapter."""
    chapter: int
    assignments: List[WordAssignment]


@dataclass
class BookResult:
    """Complete results for a book."""
    book: str
    total_null_words: int
    total_assigned: int
    total_failed: int
    total_skipped: int
    chapters: List[ChapterResult]


class StrongsProcessorV2:
    """
    Processes Delitzsch parsed books and assigns Strong's numbers.
    
    Uses pure dictionary-based matching without API calls.
    """
    
    def __init__(self):
        self.dictionary = DictionaryIndex()
        self.matcher: Optional[StrongMatcher] = None
        self._initialized = False
    
    def initialize(self) -> None:
        """Load dictionary and initialize matcher."""
        if self._initialized:
            return
        
        logger.info("Initializing processor...")
        self.dictionary.load()
        self.matcher = StrongMatcher(self.dictionary)
        self._initialized = True
        
        stats = self.dictionary.get_stats()
        logger.info(f"Dictionary loaded: {stats}")
    
    def process_book(self, book_name: str, force: bool = False) -> BookResult:
        """
        Process a single book.
        
        Args:
            book_name: Name of the book (e.g., 'jude')
            force: Re-process even if output exists
            
        Returns:
            BookResult with all assignments
        """
        self.initialize()
        
        output_file = OUTPUT_DIR / f"{book_name}.json"
        
        if output_file.exists() and not force:
            logger.info(f"Output already exists for {book_name}, loading...")
            return self._load_result(output_file)
        
        logger.info(f"Processing book: {book_name}")
        
        book_dir = PARSED_DIR / book_name
        if not book_dir.exists():
            raise FileNotFoundError(f"Book directory not found: {book_dir}")
        
        total_null = 0
        total_assigned = 0
        total_failed = 0
        total_skipped = 0
        chapter_results = []
        
        # Process each chapter file
        chapter_files = sorted(book_dir.glob("*.json"))
        
        for chapter_file in chapter_files:
            chapter_num = int(chapter_file.stem)
            logger.debug(f"Processing chapter {chapter_num}")
            
            chapter_result = self._process_chapter(
                book_name, chapter_num, chapter_file
            )
            chapter_results.append(chapter_result)
            
            # Update totals
            for assignment in chapter_result.assignments:
                total_null += 1
                if assignment.type == 'strong':
                    total_assigned += 1
                elif assignment.type == 'failed':
                    total_failed += 1
                else:  # skipped
                    total_skipped += 1
        
        result = BookResult(
            book=book_name,
            total_null_words=total_null,
            total_assigned=total_assigned,
            total_failed=total_failed,
            total_skipped=total_skipped,
            chapters=chapter_results
        )
        
        # Save output
        self._save_result(result, output_file)
        
        logger.info(
            f"Book {book_name} complete: {total_assigned} assigned, "
            f"{total_failed} failed, {total_skipped} skipped"
        )
        
        return result
    
    def _process_chapter(
        self, 
        book_name: str, 
        chapter_num: int, 
        chapter_file: Path
    ) -> ChapterResult:
        """Process a single chapter file."""
        with open(chapter_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        assignments = []
        
        # Handle the nested structure
        if isinstance(data, list) and len(data) > 0:
            chapter_data = data[0]
        else:
            chapter_data = data
        
        verses = chapter_data.get('verses', [])
        
        for verse_data in verses:
            verse_num = verse_data.get('verse', 0)
            words = verse_data.get('words', [])
            
            for word_idx, word in enumerate(words):
                # Only process words with null strong
                if word.get('strong') is not None:
                    continue
                
                text = word.get('text', '')
                prefixes = word.get('prefixes', [])
                is_proper = word.get('possible_proper_name', False)
                
                # Match the word
                match_result = self.matcher.match(text, prefixes, is_proper)
                
                # Create assignment
                if match_result.strong:
                    assignment = WordAssignment(
                        verse=verse_num,
                        previous_strong=word.get("strong"),
                        word_index=word_idx,
                        text=text,
                        prefixes=prefixes,
                        type='strong',
                        strong=match_result.strong,
                        confidence=match_result.confidence,
                        reason=match_result.reason
                    )
                elif match_result.match_type == 'pronominal':
                    assignment = WordAssignment(
                        verse=verse_num,
                        previous_strong=word.get("strong"),
                        word_index=word_idx,
                        text=text,
                        prefixes=prefixes,
                        type='skipped',
                        reason=match_result.reason
                    )
                else:
                    assignment = WordAssignment(
                        verse=verse_num,
                        previous_strong=word.get("strong"),
                        word_index=word_idx,
                        text=text,
                        prefixes=prefixes,
                        type='failed',
                        error='no_match',
                        reason=match_result.reason
                    )
                
                assignments.append(assignment)
        
        return ChapterResult(chapter=chapter_num, assignments=assignments)
    
    def _save_result(self, result: BookResult, output_file: Path) -> None:
        """Save result to JSON file."""
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        
        # Convert to dict format matching the existing output structure
        output_data = {
            'book': result.book,
            'total_null_words': result.total_null_words,
            'total_assigned': result.total_assigned,
            'total_failed': result.total_failed,
            'total_skipped': result.total_skipped,
            'chapters': []
        }
        
        for chapter in result.chapters:
            chapter_data = {
                'chapter': chapter.chapter,
                'assignments': []
            }
            
            for assignment in chapter.assignments:
                assign_dict = {
                    'verse': assignment.verse,
                    'previous_strong': assignment.previous_strong,
                    'confidence': assignment.confidence,
                    'word_index': assignment.word_index,
                    'text': assignment.text,
                    'prefixes': assignment.prefixes,
                    'type': assignment.type,
                }
                
                if assignment.strong:
                    assign_dict['strong'] = assignment.strong
                if assignment.error:
                    assign_dict['error'] = assignment.error
                if assignment.reason:
                    assign_dict['reason'] = assignment.reason
                
                chapter_data['assignments'].append(assign_dict)
            
            output_data['chapters'].append(chapter_data)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
        
        logger.info(f"Saved results to {output_file}")
    
    def _load_result(self, output_file: Path) -> BookResult:
        """Load result from existing JSON file."""
        with open(output_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        chapters = []
        for ch_data in data.get('chapters', []):
            assignments = []
            for assign_data in ch_data.get('assignments', []):
                assignment = WordAssignment(
                    verse=assign_data.get('verse'),
                    previous_strong=assign_data.get('previous_strong'),
                    confidence=assign_data.get('confidence', 0.0),
                    word_index=assign_data['word_index'],
                    text=assign_data['text'],
                    prefixes=assign_data['prefixes'],
                    type=assign_data['type'],
                    strong=assign_data.get('strong'),
                    error=assign_data.get('error'),
                    reason=assign_data.get('reason', '')
                )
                assignments.append(assignment)
            
            chapters.append(ChapterResult(
                chapter=ch_data['chapter'],
                assignments=assignments
            ))
        
        return BookResult(
            book=data['book'],
            total_null_words=data['total_null_words'],
            total_assigned=data['total_assigned'],
            total_failed=data['total_failed'],
            total_skipped=data.get('total_skipped', 0),
            chapters=chapters
        )
    
    def process_all_books(self, force: bool = False) -> List[BookResult]:
        """
        Process all books.
        
        Args:
            force: Re-process even if output exists
            
        Returns:
            List of BookResults
        """
        results = []
        for book_name in ALL_BOOKS:
            try:
                result = self.process_book(book_name, force)
                results.append(result)
            except Exception as e:
                logger.error(f"Failed to process {book_name}: {e}")
        
        return results
    
    def get_stats(self) -> Dict[str, Any]:
        """Get processing statistics."""
        if not self.matcher:
            return {}
        
        return {
            'dictionary': self.dictionary.get_stats(),
            'matching': self.matcher.get_stats()
        }