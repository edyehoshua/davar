type RecordValue = Record<string, any>;
/** Join on the source location AND exact DSS surface, never on Masoretic wording. */
export function attachDssTransliteration(book: RecordValue, generated?: RecordValue): RecordValue {
  const output = structuredClone(book);
  const rows = new Map<string, RecordValue[]>();
  for (const row of generated?.variants ?? []) {
    const key = `${row.chapter}:${row.verse}:${row.position}`;
    rows.set(key, [...(rows.get(key) ?? []), row]);
  }
  for (const [chapter, chapterData] of Object.entries(output.chapters ?? {}) as [string, RecordValue][]) {
    for (const [verse, verseData] of Object.entries(chapterData.verses ?? {}) as [string, RecordValue][]) {
      for (const difference of verseData.differences ?? []) {
        const matches = (rows.get(`${chapter}:${verse}:${difference.position}`) ?? []).filter(row => String(row.dss_word).normalize("NFC") === String(difference.dss_word).normalize("NFC"));
        if (matches.length !== 1) continue;
        const row = matches[0];
        for (const field of ["dss_translit_en", "dss_translit_es", "dss_translit_source", "dss_translit_confidence", "dss_word_niqqud", "dss_vocalization_rejected"]) {
          if (difference[field] == null && row[field] != null) difference[field] = row[field];
        }
      }
    }
  }
  return output;
}
