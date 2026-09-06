import { expect, test } from "bun:test";
import { attachDssTransliteration } from "../../../../scripts/generate-static-data/dss-transformation";
import { offlineDssPayload, selectDssTransliteration } from "../../../../shared/dssTransliteration";
test("DSS order and article changes reach static and offline records unchanged", () => {
  const differences = [{position: 1, dss_word: "ואבשלום יעשה לו", masoretic_word: "ויעש לו אבשלום", dss_strong: "H53"}, {position: 2, dss_word: "אל המשפט", masoretic_word: "למשפט"}];
  const source = {chapters: {15: {verses: {2: {differences}}}}};
  const generated = {variants: differences.map((row, i) => ({...row, chapter:15, verse:2, dss_translit_en:["veavshalom yaaseh lo", "el hammishpat"][i], dss_translit_es:"dss-es", dss_translit_source:"cached_ai_vocalization"}))};
  const result = attachDssTransliteration(source, generated);
  const rows = result.chapters[15].verses[2].differences;
  expect(rows[0].dss_translit_en).toBe("veavshalom yaaseh lo");
  expect(rows[1].dss_translit_en).toBe("el hammishpat");
  expect(offlineDssPayload(rows[0])).toEqual(rows[0]);
  expect(differences[0]).not.toHaveProperty("dss_translit_en");
  expect(rows[0].masoretic_word).toBe(differences[0].masoretic_word);
  expect(attachDssTransliteration(source, {variants:[{...generated.variants[0],dss_word:"wrong"}]}).chapters[15].verses[2].differences[0]).not.toHaveProperty("dss_translit_en");
});
test("DSS fields outrank generated/lexicon and unrelated Masoretic values never leak", () => {
  expect(selectDssTransliteration("editorial","generated","lexicon","mt",true)).toBe("editorial");
  expect(selectDssTransliteration(undefined,undefined,"lexicon","mt",true)).toBe("lexicon");
  expect(selectDssTransliteration(undefined,undefined,undefined,"mt",false)).toBeUndefined();
  expect(selectDssTransliteration(undefined,undefined,undefined,"mt",true)).toBe("mt");
});
