// eslint-disable-next-line import/no-unresolved
import { expect, test } from "bun:test";
import { groupChapterVerses } from "./chapterPositioning";

test("Psalm 119 has bounded interactive sections with every verse in canonical order", () => {
  const verses = Array.from({length:176}, (_,i) => ({id:`psalms-119-${i+1}`,text:"אַשְׁרֵי"}));
  for (const continuous of [false,true]) {
    const rows = groupChapterVerses(verses,continuous);
    expect(rows.flat()).toEqual(verses);
    expect(Math.max(...rows.map(r=>r.length))).toBe(continuous ? 4 : 1);
    expect(rows.findIndex(row=>row.some(v=>v.id === "psalms-119-176"))).toBe(rows.length-1);
  }
});
test("empty and short chapters do not create empty or duplicated rows", () => {
  expect(groupChapterVerses([],true)).toEqual([]);
  expect(groupChapterVerses([1,2,3,4,5],true)).toEqual([[1,2,3,4],[5]]);
});
