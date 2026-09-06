/**
 * Regression checks for #103: multi-word DSS variants must render as
 * span-aware replacements (replacing N Masoretic tokens) instead of
 * being hidden.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { removeMaqafForDisplay } from "../utils/hebrew";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const verseDisplaySrc = readFileSync(
	join(ROOT, "web/src/app/components/VerseDisplay.tsx"),
	"utf8",
);
const fullChapterViewSrc = readFileSync(
	join(ROOT, "web/src/app/components/FullChapterView.tsx"),
	"utf8",
);
const verseCardSrc = readFileSync(
	join(ROOT, "mobile/src/components/VerseCard.tsx"),
	"utf8",
);
const scriptureSrc = readFileSync(
	join(ROOT, "mobile/src/services/scripture.ts"),
	"utf8",
);

type DssDifference = {
	position: number;
	dss_word: string;
	masoretic_word: string;
};

type WordToken = {
	position: number;
	text: string;
};

/** Mirrors VerseDisplay / FullChapterView countMasoreticVariantSpan. */
const countMasoreticVariantSpan = (masoreticWord?: string): number => {
	if (!masoreticWord) return 1;

	const cleaned = removeMaqafForDisplay(masoreticWord)
		.replace(/[/:]/g, " ")
		.trim();
	if (!cleaned) return 1;

	const tokenCount = cleaned.split(/\s+/).filter(Boolean).length;
	return tokenCount > 0 ? tokenCount : 1;
};

/** Mirrors the post-#103 isRenderableDssWord (no single-token hide). */
const isRenderableDssWord = (value?: string): value is string => {
	if (!value) return false;
	const normalized = value.trim();
	if (!normalized || normalized.toLowerCase() === "note") {
		return false;
	}
	return countMasoreticVariantSpan(normalized) > 0;
};

const isRenderableDssWordOldGuard = (value?: string): value is string => {
	if (!value) return false;
	const normalized = value.trim();
	if (!normalized || normalized.toLowerCase() === "note") {
		return false;
	}
	const tokenCount = normalized
		.replace(/[/:]/g, " ")
		.split(/\s+/)
		.filter(Boolean).length;
	return tokenCount === 1;
};

const dssTokenCount = (value: string): number =>
	removeMaqafForDisplay(value)
		.replace(/[/:]/g, " ")
		.split(/\s+/)
		.filter(Boolean).length;

/**
 * Same skip-until replacement used by VerseDisplay and FullChapterView.
 * Positions are zero-based, matching staticData.mapDssDifferences.
 */
const applySpanReplacement = (
	words: WordToken[],
	variants: DssDifference[],
	isRenderable: (value?: string) => boolean = isRenderableDssWord,
): string[] => {
	const dssMap = new Map<number, { text: string; span: number }>();
	for (const variant of variants) {
		if (
			typeof variant.position !== "number" ||
			variant.position < 0 ||
			!isRenderable(variant.dss_word)
		) {
			continue;
		}
		dssMap.set(variant.position, {
			text: variant.dss_word,
			span: countMasoreticVariantSpan(variant.masoretic_word),
		});
	}

	let skipUntilIndex = -1;
	const displayed: string[] = [];
	words.forEach((word, wordIdx) => {
		if (wordIdx <= skipUntilIndex) {
			return;
		}
		const variantEntry = dssMap.get(word.position);
		if (variantEntry) {
			skipUntilIndex = Math.max(
				skipUntilIndex,
				wordIdx + variantEntry.span - 1,
			);
		}
		displayed.push(variantEntry?.text ?? word.text);
	});
	return displayed;
};

const loadJson = (relativePath: string) =>
	JSON.parse(readFileSync(join(ROOT, relativePath), "utf8")) as {
		chapters: Record<
			string,
			{ verses: Record<string, { differences: DssDifference[] }> }
		>;
	};

const SPAN_FIXTURES = [
	{
		label: "1 Sam 1:22",
		path: "data/dss/books/1samuel.json",
		chapter: "1",
		verse: "22",
	},
	{
		label: "Isa 4:5",
		path: "data/dss/books/isaiah/isaiah_002.json",
		chapter: "4",
		verse: "5",
	},
	{
		label: "Isa 60:20",
		path: "data/dss/books/isaiah/isaiah_035.json",
		chapter: "60",
		verse: "20",
	},
] as const;

const loadFixtureVariant = (fixture: (typeof SPAN_FIXTURES)[number]) => {
	const book = loadJson(fixture.path);
	const differences =
		book.chapters[fixture.chapter]?.verses[fixture.verse]?.differences ?? [];
	const variant = differences.find(
		(item) => dssTokenCount(item.dss_word ?? "") > 1,
	);
	if (!variant) {
		throw new Error(`No multi-token DSS variant in ${fixture.label}`);
	}
	return {
		...variant,
		// Align with WordResponse.position which is zero-based on web.
		position: Math.max(0, Math.trunc(variant.position - 1)),
	};
};

describe("DSS span-aware replacement (#103)", () => {
	test("web render paths keep skip-until span skipping", () => {
		for (const [name, src] of [
			["VerseDisplay.tsx", verseDisplaySrc],
			["FullChapterView.tsx", fullChapterViewSrc],
		] as const) {
			expect(src.includes("skipUntilIndex"), name).toBe(true);
			expect(src.includes("countMasoreticVariantSpan"), name).toBe(true);
			expect(src.includes("countMasoreticVariantSpan(normalized) > 0"), name).toBe(
				true,
			);
		}
	});

	test("single-token guard removed from web and mobile render paths", () => {
		for (const [name, src] of [
			["VerseDisplay.tsx", verseDisplaySrc],
			["FullChapterView.tsx", fullChapterViewSrc],
			["VerseCard.tsx", verseCardSrc],
			["scripture.ts", scriptureSrc],
		] as const) {
			expect(src.includes("tokenCount === 1"), name).toBe(false);
			expect(src.includes("countDssWordTokens(trimmed) === 1"), name).toBe(
				false,
			);
		}
	});

	test("mobile carries qumranSpan through DisplayWord", () => {
		expect(scriptureSrc).toContain("qumranSpan");
		expect(verseCardSrc).toContain("word.qumranSpan ?? 1");
	});

	test("multi-token DSS spans actually replace Masoretic tokens", () => {
		for (const fixture of SPAN_FIXTURES) {
			const variant = loadFixtureVariant(fixture);
			const dssTokens = dssTokenCount(variant.dss_word);
			const span = countMasoreticVariantSpan(variant.masoretic_word);

			expect(dssTokens, fixture.label).toBeGreaterThan(1);
			expect(isRenderableDssWord(variant.dss_word), fixture.label).toBe(true);
			expect(isRenderableDssWordOldGuard(variant.dss_word), fixture.label).toBe(
				false,
			);
			expect(span, fixture.label).toBeGreaterThanOrEqual(1);

			const pad = 3;
			const wordCount = variant.position + span + pad;
			const words: WordToken[] = Array.from({ length: wordCount }, (_, i) => ({
				position: i,
				text: `token-${i}`,
			}));

			const displayed = applySpanReplacement(words, [variant]);
			const hiddenByOldGuard = applySpanReplacement(
				words,
				[variant],
				isRenderableDssWordOldGuard,
			);

			expect(displayed, fixture.label).toContain(variant.dss_word);
			expect(hiddenByOldGuard, fixture.label).not.toContain(variant.dss_word);
			expect(displayed.length, fixture.label).toBe(wordCount - (span - 1));

			for (let i = 1; i < span; i += 1) {
				expect(displayed, `${fixture.label} skipped ${i}`).not.toContain(
					`token-${variant.position + i}`,
				);
			}

			if (variant.position > 0) {
				expect(displayed, fixture.label).toContain(
					`token-${variant.position - 1}`,
				);
			}
			expect(displayed, fixture.label).toContain(
				`token-${variant.position + span}`,
			);
		}
	});
});
