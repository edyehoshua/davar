/** Generated policy order is authoritative; full source arrays remain untouched. */
type Instance = { book?: string; chapter?: number; verse?: number; text?: string };
type Custom = {
  instance_total?: number;
  surface_instances?: Instance[];
  instances?: Instance[];
  oe_instances?: Instance[];
  nt_instances?: Instance[];
  manual_instances?: string[];
};
type Occurrences = { references?: string[]; surface_references?: string[]; total?: number };
export function instanceSurface(custom?: Custom, occurrences?: Occurrences) {
  const manual = custom?.manual_instances ?? [];
  const full = custom?.instances ?? [...(custom?.oe_instances ?? []), ...(custom?.nt_instances ?? [])];
  const selected = custom?.surface_instances ?? full;
  const references = occurrences?.surface_references ?? occurrences?.references ?? [];
  const total = manual.length + (custom?.instance_total ?? full.length) + (occurrences?.references?.length ?? occurrences?.total ?? 0);
  const limit = total >= 1000 ? 500 : Infinity;
  const instances: string[] = [];
  const add = (value: string) => { if (instances.length < limit) instances.push(value); };
  manual.slice(0, limit).forEach(add);
  for (const row of selected) {
    if (instances.length >= limit) break;
    if (row.book && row.chapter && row.verse) add(`${row.book} ${row.chapter}:${row.verse}${row.text ? ` ${row.text}` : ""}`);
  }
  for (const reference of references) {
    if (instances.length >= limit) break;
    add(reference.replace(/^([^.]+)\.(\d+)\.(\d+)$/, "$1 $2:$3"));
  }
  return { instances, total, omitted: Math.max(0, total - instances.length) };
}
