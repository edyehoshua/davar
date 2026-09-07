"""
Delitzsch Strong's Number Assignment Module.

Assigns Strong's numbers to Hebrew words in Delitzsch NT translation
that currently have null Strong's values, using xAI Grok API.
"""

from .config import (
    XAI_API_KEY,
    GROK_MODEL,
    GROK_BASE_URL,
    GROK_TIMEOUT,
    MAX_RETRIES,
    RETRY_BACKOFF_BASE,
    RATE_LIMIT_DELAY,
    MAX_CONCURRENT,
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
    MIN_BATCH_SIZE,
    PARSED_DIR,
    OUTPUT_DIR,
    ALL_BOOKS,
    validate_grok_api_key,
    get_language_name,
)
def __getattr__(name):
    # Offline remediation must not import the optional network SDK.
    if name == "GrokStrongsAssigner":
        from .assigner import GrokStrongsAssigner
        return GrokStrongsAssigner
    if name == "StrongsProcessor":
        from .processor import StrongsProcessor
        return StrongsProcessor
    raise AttributeError(name)


__all__ = [
    # Config
    'XAI_API_KEY',
    'GROK_MODEL',
    'GROK_BASE_URL',
    'GROK_TIMEOUT',
    'MAX_RETRIES',
    'RETRY_BACKOFF_BASE',
    'RATE_LIMIT_DELAY',
    'MAX_CONCURRENT',
    'DEFAULT_BATCH_SIZE',
    'MAX_BATCH_SIZE',
    'MIN_BATCH_SIZE',
    'PARSED_DIR',
    'OUTPUT_DIR',
    'ALL_BOOKS',
    'validate_grok_api_key',
    'get_language_name',
    # Classes
    'GrokStrongsAssigner',
    'StrongsProcessor',
]