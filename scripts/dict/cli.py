#!/usr/bin/env python3
"""
Unified CLI for Hebrew Scripture Processing Package.

This module provides a professional command-line interface for all Hebrew Scripture
processing operations, replacing the previous collection of individual scripts.
"""

import argparse
import sys
from pathlib import Path

# Add the scripts/dict directory to Python path for imports
sys.path.insert(0, str(Path(__file__).parent))

from config import Config, config
from utils import ProgressTracker


def create_parser():
    """Create the main argument parser with subcommands."""
    parser = argparse.ArgumentParser(
        prog='python -m scripts.dict',
        description='Hebrew Scripture Processing Toolkit',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Build lexicon
  python -m scripts.dict lexicon build lexicon_100_percent_list.json
  python -m scripts.dict lexicon build H7965 --update

  # Build verses
  python -m scripts.dict verses build --book genesis

  # Validate data
  python -m scripts.dict validate --quick

  # Translate definitions
  python -m scripts.dict translate run --language es --batch-size 500

  # Consolidate lexicon files
  python -m scripts.dict lexicon consolidate --preserve-translations

  # Export translation backup
  python -m scripts.dict sync export-translations
        """
    )

    # Global options
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose output'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without saving files'
    )

    # Create subparsers
    subparsers = parser.add_subparsers(
        dest='command',
        help='Available commands',
        metavar='COMMAND'
    )

    # Lexicon commands
    lexicon_parser = subparsers.add_parser(
        'lexicon',
        help='Lexicon building and management operations',
        description='Build, consolidate, and manage Hebrew lexicon data'
    )
    lexicon_subparsers = lexicon_parser.add_subparsers(
        dest='lexicon_command',
        help='Lexicon operations',
        metavar='OPERATION'
    )

    # lexicon build
    build_parser = lexicon_subparsers.add_parser(
        'build',
        help='Build lexicon entries from raw data',
        description='Generate Hebrew lexicon entries with definitions and references'
    )
    build_parser.add_argument(
        'input',
        help='Strong\'s number (e.g., H7965) or JSON file with list of numbers'
    )
    build_parser.add_argument(
        '--update', '-u',
        action='store_true',
        help='Update existing entries instead of skipping them'
    )
    build_parser.add_argument(
        '--testing',
        action='store_true',
        help='Use testing mode (1% of data, saves to testing/ directory)'
    )
    build_parser.add_argument(
        '--fill-missing',
        action='store_true',
        help='Fill missing definitions in existing files'
    )

    # lexicon consolidate
    consolidate_parser = lexicon_subparsers.add_parser(
        'consolidate',
        help='Merge individual lexicon files into consolidated files',
        description='Combine individual JSON files into roots.json and words.json'
    )
    consolidate_parser.add_argument(
        '--preserve-translations',
        action='store_true',
        default=True,
        help='Load translations from translations.json backup (default: True)'
    )
    consolidate_parser.add_argument(
        '--strict',
        action='store_true',
        help='Raise errors instead of continuing on failures'
    )

    # lexicon adjudicate
    adjudicate_parser = lexicon_subparsers.add_parser(
        'adjudicate',
        help='Audit and adjudicate lexicon root_ref assignments',
        description='Deterministic root_ref adjudication with a human review queue'
    )
    adjudicate_parser.add_argument(
        '--report',
        type=str,
        default=None,
        help='Output report JSON path'
    )
    adjudicate_parser.add_argument(
        '--apply',
        action='store_true',
        help='Apply auto_accepted decisions to words.json'
    )
    adjudicate_parser.add_argument(
        '--keep-threshold',
        type=float,
        default=0.5,
        help='Similarity above which a root link is kept (default 0.5)'
    )

    # lexicon custom
    custom_parser = lexicon_subparsers.add_parser(
        'custom',
        help='Integrate custom Hebrew dictionary definitions',
        description='Add custom Hebrew definitions to the lexicon'
    )

    # lexicon transliterate
    transliterate_parser = lexicon_subparsers.add_parser(
        'transliterate',
        help='Add transliteration fields to lexicon entries',
        description='Add translit_en and translit_es fields to lexicon files'
    )

    # Verses commands
    verses_parser = subparsers.add_parser(
        'verses',
        help='Verse processing operations',
        description='Generate and manage verse JSON files'
    )
    verses_subparsers = verses_parser.add_subparsers(
        dest='verses_command',
        help='Verse operations',
        metavar='OPERATION'
    )

    # verses build
    verses_build_parser = verses_subparsers.add_parser(
        'build',
        help='Build verse JSON files from Hebrew text data',
        description='Generate lightweight verse files for Hebrew Scriptures'
    )
    verses_build_parser.add_argument(
        '--book',
        help='Process specific book (e.g., genesis, exodus)'
    )
    verses_build_parser.add_argument(
        '--chapter',
        type=int,
        help='Process specific chapter number'
    )

    # Validate command
    validate_parser = subparsers.add_parser(
        'validate',
        help='Validate lexicon and verse data quality',
        description='Run comprehensive quality assurance checks'
    )
    validate_parser.add_argument(
        '--quick', '-q',
        action='store_true',
        help='Run quick validation checks only'
    )
    validate_parser.add_argument(
        '--fix',
        action='store_true',
        help='Attempt to fix identified issues'
    )

    # Translate commands
    translate_parser = subparsers.add_parser(
        'translate',
        help='Translation operations using xAI Grok API',
        description='Translate lexicon definitions to other languages'
    )
    translate_subparsers = translate_parser.add_subparsers(
        dest='translate_command',
        help='Translation operations',
        metavar='OPERATION'
    )

    # translate run
    translate_run_parser = translate_subparsers.add_parser(
        'run',
        help='Translate lexicon definitions',
        description='Translate English definitions to target languages'
    )
    translate_run_parser.add_argument(
        '--file',
        choices=['roots', 'words'],
        help='Process specific file (default: both)'
    )
    translate_run_parser.add_argument(
        '--language', '--lang',
        dest='language',
        default='es',
        help='Target language code (default: es)'
    )
    translate_run_parser.add_argument(
        '--batch-size',
        type=int,
        default=500,
        help='Definitions per API call (default: 500)'
    )
    translate_run_parser.add_argument(
        '--strong-number',
        help='Process single Strong\'s number (e.g., H1)'
    )

    # translate fix
    translate_fix_parser = translate_subparsers.add_parser(
        'fix',
        help='Fix missing translations',
        description='Fill in missing translations in existing files'
    )
    translate_fix_parser.add_argument(
        '--file',
        choices=['roots', 'words'],
        help='Process specific file (default: both)'
    )
    translate_fix_parser.add_argument(
        '--language', '--lang',
        dest='language',
        default='es',
        help='Target language code (default: es)'
    )
    translate_fix_parser.add_argument(
        '--batch-size',
        type=int,
        default=500,
        help='Definitions per API call (default: 500)'
    )

    # Sync commands
    sync_parser = subparsers.add_parser(
        'sync',
        help='Synchronization operations',
        description='Sync data between different formats and locations'
    )
    sync_subparsers = sync_parser.add_subparsers(
        dest='sync_command',
        help='Sync operations',
        metavar='OPERATION'
    )

    # sync to-individual
    sync_individual_parser = sync_subparsers.add_parser(
        'to-individual',
        help='Sync translations from consolidated to individual files',
        description='Copy translations from roots.json/words.json to individual files'
    )
    sync_individual_parser.add_argument(
        '--file',
        choices=['roots', 'words', 'both'],
        default='both',
        help='Which files to sync (default: both)'
    )

    # sync export-translations
    sync_export_parser = sync_subparsers.add_parser(
        'export-translations',
        help='Export translations to backup file',
        description='Extract all translations into translations.json backup'
    )
    sync_export_parser.add_argument(
        '--output',
        default=str(config.LEXICON_DIR / 'translations.json'),
        help='Output file path (default: data/dict/lexicon/translations.json)'
    )

    return parser


def main():
    """Main CLI entry point."""
    parser = create_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    # Set up logging based on verbose flag
    import logging
    level = logging.DEBUG if getattr(args, 'verbose', False) else logging.INFO
    logging.basicConfig(
        level=level,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )

    try:
        # Route to appropriate command handler
        if args.command == 'lexicon':
            return handle_lexicon_command(args)
        elif args.command == 'verses':
            return handle_verses_command(args)
        elif args.command == 'validate':
            return handle_validate_command(args)
        elif args.command == 'translate':
            return handle_translate_command(args)
        elif args.command == 'sync':
            return handle_sync_command(args)
        else:
            print(f"Unknown command: {args.command}")
            return 1

    except KeyboardInterrupt:
        print("\n\nOperation interrupted by user")
        return 1
    except Exception as e:
        print(f"Error: {e}")
        if getattr(args, 'verbose', False):
            import traceback
            traceback.print_exc()
        return 1


def handle_lexicon_command(args):
    """Handle lexicon subcommands."""
    if args.lexicon_command == 'build':
        return handle_lexicon_build(args)
    elif args.lexicon_command == 'consolidate':
        return handle_lexicon_consolidate(args)
    elif args.lexicon_command == 'custom':
        return handle_lexicon_custom(args)
    elif args.lexicon_command == 'transliterate':
        return handle_lexicon_transliterate(args)
    elif args.lexicon_command == 'adjudicate':
        return handle_lexicon_adjudicate(args)
    else:
        print("Available lexicon commands: build, consolidate, custom, transliterate")
        return 1


def handle_lexicon_build(args):
    """Handle lexicon build command."""
    # Import here to avoid circular imports
    from build_lexicon import main as build_main

    # Convert args to sys.argv format for compatibility
    sys.argv = ['build_lexicon.py', args.input]

    if args.update:
        sys.argv.append('--update')
    if args.testing:
        sys.argv.append('--testing')
    if args.fill_missing:
        sys.argv.append('--fill-missing')
    if args.verbose:
        sys.argv.append('--verbose')
    if args.dry_run:
        sys.argv.append('--dry-run')

    return build_main()


def handle_lexicon_consolidate(args):
    """Handle lexicon consolidate command."""
    # Import here to avoid circular imports
    from lexicon.consolidate import consolidate_lexicon

    return consolidate_lexicon(
        preserve_translations=args.preserve_translations,
        strict=args.strict,
        dry_run=args.dry_run,
        verbose=args.verbose
    )


def handle_lexicon_custom(args):
    """Handle lexicon custom command."""
    # Import here to avoid circular imports
    from integrate_custom_dict import main as custom_main

    # Convert args to sys.argv format for compatibility
    sys.argv = ['integrate_custom_dict.py']

    if args.verbose:
        sys.argv.append('--verbose')
    if args.dry_run:
        sys.argv.append('--dry-run')

    return custom_main()


def handle_lexicon_transliterate(args):
    """Handle lexicon transliterate command."""
    # Import here to avoid circular imports
    from update_transliterations import main as transliterate_main

    # Convert args to sys.argv format for compatibility
    sys.argv = ['update_transliterations.py']

    if args.verbose:
        sys.argv.append('--verbose')
    if args.dry_run:
        sys.argv.append('--dry-run')

    return transliterate_main()


def handle_lexicon_adjudicate(args):
    """Handle lexicon adjudicate command."""
    from scripts.dict.adjudicate_roots import main as adjudicate_main

    # Transfer CLI args onto a fresh argv so the standalone __main__ still works.
    argv = ['adjudicate_roots.py']
    if getattr(args, 'report', None):
        argv += ['--report', args.report]
    if getattr(args, 'apply', False):
        argv.append('--apply')
    if getattr(args, 'keep_threshold', None):
        argv += ['--keep-threshold', str(args.keep_threshold)]

    import sys as _sys
    original = _sys.argv
    _sys.argv = argv
    try:
        return adjudicate_main()
    finally:
        _sys.argv = original


def handle_verses_command(args):
    """Handle verses subcommands."""
    if args.verses_command == 'build':
        return handle_verses_build(args)
    else:
        print("Available verses commands: build")
        return 1


def handle_verses_build(args):
    """Handle verses build command."""
    # Import here to avoid circular imports
    from build_verses import main as verses_main

    # Convert args to sys.argv format for compatibility
    sys.argv = ['build_verses.py']

    if args.book:
        sys.argv.extend(['--book', args.book])
    if args.chapter:
        sys.argv.extend(['--chapter', str(args.chapter)])
    if args.verbose:
        sys.argv.append('--verbose')
    if args.dry_run:
        sys.argv.append('--dry-run')

    return verses_main()


def handle_validate_command(args):
    """Handle validate command."""
    # Import here to avoid circular imports
    from validator import main as validate_main

    # Convert args to sys.argv format for compatibility
    sys.argv = ['validator.py']

    if args.quick:
        sys.argv.append('--quick')
    if args.fix:
        sys.argv.append('--fix')
    if args.verbose:
        sys.argv.append('--verbose')

    return validate_main()


def handle_translate_command(args):
    """Handle translate subcommands."""
    if args.translate_command == 'run':
        return handle_translate_run(args)
    elif args.translate_command == 'fix':
        return handle_translate_fix(args)
    else:
        print("Available translate commands: run, fix")
        return 1


def handle_translate_run(args):
    """Handle translate run command."""
    # Import here to avoid circular imports
    from translation.main import main as translate_main

    # Convert args to sys.argv format for compatibility
    sys.argv = ['translation/main.py']

    if args.file:
        sys.argv.extend(['--file', args.file])
    if args.language:
        sys.argv.extend(['--language', args.language])
    if args.batch_size:
        sys.argv.extend(['--batch-size', str(args.batch_size)])
    if args.strong_number:
        sys.argv.extend(['--strong-number', args.strong_number])
    if args.dry_run:
        sys.argv.append('--dry-run')
    if args.verbose:
        sys.argv.append('--verbose')

    return translate_main()


def handle_translate_fix(args):
    """Handle translate fix command."""
    # Import here to avoid circular imports
    from translation.fix_mismatches import main as fix_main

    # Convert args to sys.argv format for compatibility
    sys.argv = ['translation/fix_mismatches.py']

    if args.file:
        sys.argv.extend(['--file', args.file])
    if args.language:
        sys.argv.extend(['--language', args.language])
    if args.batch_size:
        sys.argv.extend(['--batch-size', str(args.batch_size)])
    if args.dry_run:
        sys.argv.append('--dry-run')
    if args.verbose:
        sys.argv.append('--verbose')

    return fix_main()


def handle_sync_command(args):
    """Handle sync subcommands."""
    if args.sync_command == 'to-individual':
        return handle_sync_to_individual(args)
    elif args.sync_command == 'export-translations':
        return handle_sync_export_translations(args)
    else:
        print("Available sync commands: to-individual, export-translations")
        return 1


def handle_sync_to_individual(args):
    """Handle sync to-individual command."""
    # Import here to avoid circular imports
    from sync_translations_to_individual import main as sync_main

    # Convert args to sys.argv format for compatibility
    sys.argv = ['sync_translations_to_individual.py']

    if args.file:
        sys.argv.extend(['--file', args.file])
    if args.verbose:
        sys.argv.append('--verbose')
    if args.dry_run:
        sys.argv.append('--dry-run')

    return sync_main()


def handle_sync_export_translations(args):
    """Handle sync export-translations command."""
    # Import here to avoid circular imports
    from sync_translations_to_individual import export_translations_backup

    return export_translations_backup(
        output_file=args.output,
        verbose=args.verbose
    )


if __name__ == "__main__":
    sys.exit(main())