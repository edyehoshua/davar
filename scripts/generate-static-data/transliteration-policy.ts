const displayFields = ["translit_en", "translit_es", "transliteration_en", "transliteration_es"];
const isDivineName = (value: unknown): boolean =>
  Array.isArray(value) ? value.some(isDivineName) :
  typeof value === "string" && value.split("/").some((part) => part.trim() === "H3068");

/** Apply display policy at the data boundary, including offline/static bundles. */
export function applyTransliterationPolicy<T>(value: T, key?: string): T {
  if (Array.isArray(value)) {
    return value.map((item) => applyTransliterationPolicy(item)) as T;
  }
  if (!value || typeof value !== "object") return value;
  const entry = value as Record<string, unknown>;
  const suppress = isDivineName(key) || isDivineName(entry.strong_number) || isDivineName(entry.strong);
  const dssStrong = entry.dss_strong ?? entry.dssStrong;
  const suppressDss = dssStrong == null ? suppress : isDivineName(dssStrong);
  const result: Record<string, unknown> = {};
  for (const [field, child] of Object.entries(entry)) {
    if (suppress && displayFields.includes(field)) continue;
    if (suppressDss && ["dss_translit_en", "dss_translit_es"].includes(field)) continue;
    result[field] = applyTransliterationPolicy(child, field);
  }
  return result as T;
}
