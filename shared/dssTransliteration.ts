/** A changed DSS surface must not inherit an unrelated Masoretic pronunciation. */
export function selectDssTransliteration(dss?: string, generated?: string, lexicon?: string, masoretic?: string, equivalent = false): string | undefined {
  return [dss, generated, lexicon, equivalent ? masoretic : undefined].find(value => typeof value === "string" && value.trim().length > 0);
}
/** SQLite stores the complete additive variant payload, including future metadata. */
export function offlineDssPayload<T extends object>(difference: T): T & Record<string, unknown> {
  return { ...difference } as T & Record<string, unknown>;
}
