// Bun supplies this runtime module; Expo lint does not resolve it.
// eslint-disable-next-line import/no-unresolved
import { expect, test } from "bun:test";
import { getResponsiveLayout } from "./responsiveLayout";

test("phone and narrow split view keep compact sizing", () => {
  for (const width of [320, 390, 600]) {
    const layout = getResponsiveLayout(width, 900);
    expect(layout.isTablet).toBe(false);
    expect(layout.modalWidth).toBeLessThanOrEqual(width - 48);
    expect(layout.controlHeight).toBe(36);
    expect(layout.gridColumns * 52 + (layout.gridColumns - 1) * 12).toBeLessThanOrEqual(width - 48);
  }
});
test("tablet orientation changes reading measure and grid density without overflow", () => {
  const portrait = getResponsiveLayout(834, 1210);
  const landscape = getResponsiveLayout(1210, 834);
  expect(portrait.isTablet).toBe(true);
  expect(portrait.landscape).toBe(false);
  expect(landscape.landscape).toBe(true);
  expect(landscape.gridColumns).toBeGreaterThan(portrait.gridColumns);
  expect(landscape.contentMaxWidth).toBeGreaterThan(portrait.contentMaxWidth);
  for (const layout of [portrait, landscape, getResponsiveLayout(800, 1280), getResponsiveLayout(1280, 800)]) {
    expect(layout.modalWidth).toBeGreaterThan(420);
    expect(layout.controlHeight).toBeGreaterThanOrEqual(44);
    const cell = Math.floor((layout.navigationWidth - 48 - 12 * (layout.gridColumns - 1)) / layout.gridColumns);
    expect(cell).toBeGreaterThanOrEqual(44);
    expect(cell * layout.gridColumns + 12 * (layout.gridColumns - 1)).toBeLessThanOrEqual(layout.navigationWidth - 48);
  }
});
