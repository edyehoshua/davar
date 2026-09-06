"""Display transliteration policy shared by lexicon generation and backfill."""
DISPLAY_FIELDS = ("translit_en", "translit_es", "transliteration_en", "transliteration_es", "dss_translit_en", "dss_translit_es")


def apply_transliteration_policy(entry):
    strong = str(entry.get("strong_number") or entry.get("strong") or "")
    if "H3068" in strong.split("/"):
        return {key: value for key, value in entry.items() if key not in DISPLAY_FIELDS}
    return entry
