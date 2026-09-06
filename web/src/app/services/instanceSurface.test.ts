import { expect, test } from "bun:test";
import { instanceSurface } from "../../../../shared/instanceSurface";
test("bounded web/mobile surface retains full background records and counts", () => {
  const full = Array.from({length: 1001}, (_, i) => ({book: "john", chapter: 1, verse: i+1}));
  const entry = { instances: full, surface_instances: full.slice(0, 500), instance_total: 1001 };
  expect(instanceSurface(entry).instances).toHaveLength(500);
  expect(instanceSurface(entry).total).toBe(1001);
  expect(instanceSurface(entry).omitted).toBe(501);
  expect(full).toHaveLength(1001);
  expect(instanceSurface(undefined, {references: full.map(x => `john.1.${x.verse}`)}).instances).toHaveLength(500);
});
test("low volume legacy manual entries and medium generated order survive", () => {
  expect(instanceSurface({manual_instances: ["Ex. 3:15"]}).instances).toEqual(["Ex. 3:15"]);
  expect(instanceSurface(undefined, {references: ["gen.1.1", "exod.2.3"]}).instances).toEqual(["gen 1:1", "exod 2:3"]);
});
