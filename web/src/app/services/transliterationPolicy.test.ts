import { expect, test } from "bun:test";
import { applyTransliterationPolicy } from "../../../../scripts/generate-static-data/transliteration-policy";

test("H3068 policy covers prefixed words, dictionary keys and DSS without hiding H3069", () => {
  const payload = {H3068: {translit_en: "name"}, words: [
    {strong: "Hb/H3068", translit_en: "name", translit_es: "name", dss_translit_en: "name"},
    {strong: "H3069", root_ref: "H3068", translit_en: "other"},
    {strong: "H30680", translit_en: "unrelated"},
    {strong: "H1", dss_strong: "H3068", translit_en: "father", dss_translit_es: "name"},
  ]};
  const result = applyTransliterationPolicy(payload);
  expect(result.H3068).toEqual({});
  expect(result.words[0]).toEqual({strong: "Hb/H3068"});
  expect(result.words[1].translit_en).toBe("other");
  expect(result.words[2].translit_en).toBe("unrelated");
  expect(result.words[3]).toEqual({strong: "H1", dss_strong: "H3068", translit_en: "father"});
  expect(payload.words[0].translit_en).toBe("name");
  expect(applyTransliterationPolicy(result)).toEqual(result);
});
