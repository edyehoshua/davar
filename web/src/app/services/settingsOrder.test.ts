/**
 * Regression check for #107: shared settings order must match
 * shared/settingsOrder.ts on both platforms.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	SHARED_SETTINGS_ORDER,
	canUseSeferStyle,
	isSeferStyleVisible,
} from "../../../../shared/settingsOrder";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");

const CONSUMERS = [
	"mobile/app/(tabs)/settings.tsx",
	"web/src/app/components/SettingsScreen.tsx",
	"web/src/app/components/NavigationBar.tsx",
] as const;

const SHARED_ID_PATTERN =
	"theme|language|besorahTextVersion|fullChapter|seferStyle|hebrewOnly|qumran";

// Extract settings.* i18n keys in render order from a source file.
function extractOrder(path: string): string[] {
	const src = readFileSync(join(ROOT, path), "utf8");
	const ids: string[] = [];
	for (const m of src.matchAll(
		new RegExp(
			`t\\("settings\\.(${SHARED_ID_PATTERN})\\.title"\\)`,
			"g",
		),
	)) {
		if (ids[ids.length - 1] !== m[1]) ids.push(m[1]);
	}
	return ids;
}

function readConsumer(path: string): string {
	return readFileSync(join(ROOT, path), "utf8");
}

describe("shared settings order", () => {
	test("consumers import and render SHARED_SETTINGS_ORDER", () => {
		for (const path of CONSUMERS) {
			const src = readConsumer(path);
			expect(src.includes("@davar/shared/settingsOrder")).toBe(true);
			expect(src.includes("SHARED_SETTINGS_ORDER")).toBe(true);
			expect(src).toMatch(/SHARED_SETTINGS_ORDER\.map\s*\(/);
		}
	});

	test("mobile settings order matches SHARED_SETTINGS_ORDER", () => {
		expect(extractOrder("mobile/app/(tabs)/settings.tsx")).toEqual([
			...SHARED_SETTINGS_ORDER,
		]);
	});

	test("web settings order matches SHARED_SETTINGS_ORDER", () => {
		expect(
			extractOrder("web/src/app/components/SettingsScreen.tsx"),
		).toEqual([...SHARED_SETTINGS_ORDER]);
	});

	test("web NavigationBar dropdown order matches SHARED_SETTINGS_ORDER", () => {
		expect(
			extractOrder("web/src/app/components/NavigationBar.tsx"),
		).toEqual([...SHARED_SETTINGS_ORDER]);
	});
});

describe("canUseSeferStyle", () => {
	test("requires full chapter and single-text mode", () => {
		expect(
			canUseSeferStyle({
				showFullChapter: true,
				hebrewOnly: true,
				translationOnly: false,
			}),
		).toBe(true);
		expect(
			canUseSeferStyle({
				showFullChapter: true,
				hebrewOnly: false,
				translationOnly: true,
			}),
		).toBe(true);
		expect(
			canUseSeferStyle({
				showFullChapter: true,
				hebrewOnly: false,
				translationOnly: false,
			}),
		).toBe(false);
		expect(
			canUseSeferStyle({
				showFullChapter: false,
				hebrewOnly: true,
				translationOnly: false,
			}),
		).toBe(false);
	});

	test("row visibility depends only on full chapter", () => {
		expect(isSeferStyleVisible(true)).toBe(true);
		expect(isSeferStyleVisible(false)).toBe(false);
	});
});
