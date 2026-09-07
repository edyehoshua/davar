/** Prevent known extraction artifacts and unapproved candidates entering static/offline bundles. */
export function assertBesorahPublishable(verses: unknown, source: string): void {
  if (!Array.isArray(verses)) throw new Error(`Invalid Besorah chapter: ${source}`);
  const identities = new Set<number>();
  for (const verse of verses) {
    if (!Number.isInteger(verse.verse) || verse.verse < 1 || identities.has(verse.verse) || !Array.isArray(verse.words)) {
      throw new Error(`Invalid or duplicate Besorah verse: ${source}`);
    }
    identities.add(verse.verse);
    for (const word of verse.words) {
      if (typeof word.text !== "string" || !/[א-ת]/u.test(word.text)) throw new Error(`Non-Hebrew Besorah token: ${source}:${verse.verse}`);
      if (word.strong && (!/^(?:H[bclkdm]\/)*[HD]\d+$/.test(word.strong) || word.mapping_review?.status === "needs_review")) {
        throw new Error(`Unapproved Besorah assignment: ${source}:${verse.verse}`);
      }
    }
  }
}
