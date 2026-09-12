/** Keep interactive native text bounded, preserving canonical verse order. */
export function groupChapterVerses<T>(verses: readonly T[], continuous: boolean): T[][] {
  const size = continuous ? 4 : 1;
  return Array.from({ length: Math.ceil(verses.length / size) }, (_, i) => verses.slice(i * size, (i + 1) * size));
}
