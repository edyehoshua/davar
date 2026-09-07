"""
Book and chapter processing orchestration
Coordinates SQLite loading, text parsing, word matching, and result formatting
"""

from typing import Dict, List
import logging

try:
    from .sqlite_loader import get_sqlite_loader
    from .text_parser import get_text_parser
    from .word_matcher import WordMatcher
    from .result_formatter import ResultFormatter
    from .hebrew_utils import tokenize_verse
except ImportError:
    from sqlite_loader import get_sqlite_loader
    from text_parser import get_text_parser
    from word_matcher import WordMatcher
    from result_formatter import ResultFormatter
    from hebrew_utils import tokenize_verse


class BookProcessor:
    """
    High-level orchestration for processing Delitzsch books.

    Coordinates:
    - SQLite data loading
    - Text parsing (removing tags)
    - Word matching (via WordMatcher)
    - Result formatting (via ResultFormatter)
    """

    def __init__(self, word_matcher: WordMatcher, result_formatter: ResultFormatter):
        """
        Initialize book processor.

        Args:
            word_matcher: Word matcher instance
            result_formatter: Result formatter instance
        """
        self.sqlite_loader = get_sqlite_loader()
        self.parser = get_text_parser()
        self.matcher = word_matcher
        self.formatter = result_formatter

    def process_book_from_sqlite(self, book_name: str) -> List[Dict]:
        """
        Process an entire Delitzsch book from SQLite database.

        Args:
            book_name: Name of the book (e.g., "matthew", "acts", "john1")

        Returns:
            List of chapter dictionaries ready for JSON output
        """
        chapters_output = []

        # Get book number from name
        book_number = self.sqlite_loader.get_book_number(book_name)
        if not book_number:
            raise ValueError(f"Unknown book name: {book_name}")

        # Get all verses for this book
        book_verses = self.sqlite_loader.get_book_verses(book_number)

        for chapter_num, verses in book_verses.items():
            verses_output = []

            for verse_data in verses:
                verse_num = verse_data['verse']
                verse_text_with_tags = verse_data['text']

                # Clean text for display (remove tags)
                clean_verse_text = self.parser.clean_verse_text_for_display(
                    verse_text_with_tags)

                if clean_verse_text.strip() == "WO":
                    logging.getLogger(__name__).warning("Skipping non-Hebrew WO placeholder at chapter %s verse %s", chapter_num, verse_num)
                    continue

                # Process the verse with SQLite data
                words = self._process_verse_from_sqlite(verse_text_with_tags)

                # Add "/" separators for prefixes in the Hebrew text
                hebrew_with_separators = self.formatter.add_prefix_separators(
                    clean_verse_text, words)

                verse_output = self.formatter.format_verse(
                    verse_num=verse_num,
                    chapter_num=chapter_num,
                    hebrew=hebrew_with_separators,
                    words=words
                )
                verses_output.append(verse_output)

            # Group by chapter
            chapter_output = {
                'chapter': chapter_num,
                'verses': verses_output
            }
            chapters_output.append(chapter_output)

        return chapters_output

    def process_book_legacy(self, book_data: Dict, book_name: str) -> List[Dict]:
        """
        Process an entire Delitzsch book from legacy JSON format.
        LEGACY METHOD - kept for backward compatibility.

        Args:
            book_data: Delitzsch book JSON data
            book_name: Name of the book

        Returns:
            List of chapter dictionaries ready for JSON output
        """
        chapters_output = []

        for chapter_data in book_data.get('chapters', []):
            chapter_num = chapter_data.get('number')
            verses_output = []

            for verse_data in chapter_data.get('verses', []):
                verse_num = verse_data.get('number')
                verse_text = verse_data.get('text_nikud', '')

                # Process the verse using legacy method
                words = self._process_verse_legacy(verse_text)

                verse_output = self.formatter.format_verse(
                    verse_num=verse_num,
                    chapter_num=chapter_num,
                    hebrew=verse_text,
                    words=words
                )
                verses_output.append(verse_output)

            # Group by chapter
            chapter_output = {
                'chapter': chapter_num,
                'hebrew_letter': chapter_data.get('hebrew_letter', ''),
                'verses': verses_output
            }
            chapters_output.append(chapter_output)

        return chapters_output

    def _process_verse_from_sqlite(self, verse_text: str) -> List[Dict]:
        """
        Process all words in a verse from SQLite text with embedded Strong's tags.

        Args:
            verse_text: Full Hebrew verse text with <S>NNNN</S> tags

        Returns:
            List of word dictionaries with text, strong, prefixes
        """
        parsed_words = self.parser.parse_verse_text(verse_text)
        processed_words = []

        for word_data in parsed_words:
            processed_word = self.matcher.match_word_with_strong(word_data)
            processed_words.append(processed_word)

        return processed_words

    def _process_verse_legacy(self, verse_text: str) -> List[Dict]:
        """
        Process all words in a verse (legacy method without SQLite tags).
        LEGACY METHOD - kept for backward compatibility.

        Args:
            verse_text: Full Hebrew verse text with nikud

        Returns:
            List of word dictionaries with text, strong, prefixes
        """
        words = tokenize_verse(verse_text)
        processed_words = []

        for word in words:
            processed_word = self.matcher.match_word(word)
            processed_words.append(processed_word)

        return processed_words
