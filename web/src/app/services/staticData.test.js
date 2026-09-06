import { describe, expect, test } from "bun:test";
import {
	resolveTranslationLookupKey,
	resolveTranslationTarget,
} from "../../../../shared/translationConfig";
import { getChapterVerses, loadLexiconEntry } from "./staticData";

const readJson = async (relativePath) => {
	const filePath = new URL(`../../../public/${relativePath}`, import.meta.url);
	const file = Bun.file(filePath);
	return file.json();
};

describe("static data integrity", () => {
	test("core metadata has books and chapter map", async () => {
		const metadata = await readJson("data/metadata.json");

		expect(Array.isArray(metadata.books)).toBe(true);
		expect(metadata.books.length > 0).toBe(true);
		expect(typeof metadata.verse_counts).toBe("object");
		expect(metadata.verse_counts).not.toBeNull();
		expect(metadata.verse_counts.Genesis?.["1"] > 0).toBe(true);
	});

	test("versions bundle is available", async () => {
		const versions = await readJson("data/bundles/versions.json");

		expect(typeof versions).toBe("object");
		expect(versions).not.toBeNull();
		expect(typeof versions.tanaj).toBe("number");
		expect(typeof versions.dictionary).toBe("number");
	});

	test("chapter content exists for Torah and Besorah samples", async () => {
		const genesisChapter = await readJson("data/oe/genesis/1.json");
		const matthewChapter = await readJson("data/besorah/matthew/1.json");

		expect(Array.isArray(genesisChapter)).toBe(true);
		expect(genesisChapter.length > 0).toBe(true);
		expect(Array.isArray(matthewChapter)).toBe(true);
		expect(matthewChapter.length > 0).toBe(true);
	});

	test("Hutter New Testament chapters are generated as a selectable source", async () => {
		const delitzschChapter = await readJson("data/besorah/matthew/1.json");
		const hutterChapter = await readJson("data/hutter/matthew/1.json");

		expect(Array.isArray(hutterChapter)).toBe(true);
		expect(hutterChapter.length).toBe(delitzschChapter.length);
		expect(hutterChapter[0]).toMatchObject({
			chapter: 1,
			verse: 1,
		});
		expect(hutterChapter[0].hebrew).not.toBe(delitzschChapter[0].hebrew);
		expect(hutterChapter[0].words[0]).toMatchObject({
			text: "סֵפֶר",
			strong: "H5612",
			translit_en: "sefer",
			translit_es: "sefer",
		});
		expect(hutterChapter[0].words[1]).toMatchObject({
			text: "הַתּוֹלְדוֹת",
			translit_en: "hatoledot",
			translit_es: "hatoledot",
		});
		expect(
			hutterChapter
				.flatMap((verse) => verse.words)
				.every((word) =>
                    word.strong?.split("/").includes("H3068")
                        ? !("translit_en" in word) && !("translit_es" in word)
                        : Boolean(word.translit_en && word.translit_es),
                ),
		).toBe(true);
		expect(
			hutterChapter.flatMap((verse) => verse.words).some((word) => word.strong),
		).toBe(true);
	});

	test("dictionary assets are available", async () => {
		const words = await readJson("data/dict/words.json");
		const roots = await readJson("data/dict/roots.json");

		expect(typeof words).toBe("object");
		expect(words).not.toBeNull();
		expect(Object.keys(words).length > 0).toBe(true);
		expect(typeof roots).toBe("object");
		expect(roots).not.toBeNull();
		expect(Object.keys(roots).length > 0).toBe(true);
	});

	test("Genesis 1:2 keeps H7363 transliteration in translit dataset", async () => {
		const chapter = await readJson("data/oe/genesis/1.json");
		const translit = await readJson("data/translit/genesis.json");

		const verse = chapter.find(
			(item) => item.chapter === 1 && item.verse === 2,
		);
		expect(verse).toBeDefined();

		const verseWord = verse.words.find((word) => word.strong === "H7363");
		expect(verseWord).toBeDefined();
		expect(verseWord.translit_en).toBeUndefined();
		expect(verseWord.translit_es).toBeUndefined();

		const translitVerse = translit.verses.find(
			(item) => item.chapter === 1 && item.verse === 2,
		);
		expect(translitVerse).toBeDefined();

		const translitWord = translitVerse.words.find(
			(word) => word.strong === "H7363",
		);
		expect(translitWord).toBeDefined();
		expect(translitWord.translit_en).toBe("merachefet");
		expect(translitWord.translit_es).toBe("merajefet");
	});

	test("H7363 currently exists in roots and not words", async () => {
		const words = await readJson("data/dict/words.json");
		const roots = await readJson("data/dict/roots.json");

		expect(words.H7363).toBeUndefined();
		expect(roots.H7363).toBeDefined();
	});

	test("lexicon analysis maps entries without root_ref to self-root", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input) => {
			const url = String(input);
			const path = url.startsWith("/") ? url.slice(1) : url;
			const filePath = new URL(`../../../public/${path}`, import.meta.url);
			const file = Bun.file(filePath);
			return new Response(await file.text(), {
				headers: { "content-type": "application/json" },
			});
		};

		try {
			const rootEntry = await loadLexiconEntry("H1730", "en");
			expect(rootEntry).toMatchObject({
				strong_number: "H1730",
				hebrew: "דּוֹד",
				root: "דּוֹד",
				root_strong: "H1730",
			});

			const derivedEntry = await loadLexiconEntry("H1732", "en");
			expect(derivedEntry).toMatchObject({
				strong_number: "H1732",
				hebrew: "דָּוִד",
				root: "דּוֹד",
				root_strong: "H1730",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("QA lexicon examples include Spanish definitions", async () => {
		const words = await readJson("data/dict/words.json");
		const roots = await readJson("data/dict/roots.json");

		expect(words.H4723.definitions.map((definition) => definition.text_es)).toEqual([
			"esperanza",
			"colección",
			"masa reunida",
		]);
		expect(roots.H7235.definitions.at(-1)).toMatchObject({
			text_en: "shoot",
			text_es: "brote",
		});
		expect(words.H1730.definitions.map((definition) => definition.text_es)).toEqual([
			"amado",
			"amor",
			"tío",
		]);
		expect(words.H1732.definitions.slice(0, 5).map((definition) => definition.text_es)).toEqual([
			"olla",
			"jarra",
			"olla",
			"caldera",
			"cesta",
		]);
	});

	test("1 John 1:5 custom D0208 entry has bilingual definitions", async () => {
		const chapter = await readJson("data/besorah/john1/1.json");
		const customDefinitions = await readJson(
			"data/dict/custom_definitions.json",
		);

		const verse = chapter.find(
			(item) => item.chapter === 1 && item.verse === 5,
		);
		expect(verse).toBeDefined();
		expect(verse.words.at(-1)).toMatchObject({
			text: "בּוֹ׃",
			strong: "D0208",
		});

		const entry = customDefinitions.D0208;
		expect(entry).toBeDefined();
		expect(entry.definitions[0].text_en).toContain("in him");
		expect(entry.definitions[0].text_es).toContain("en él");
	});

	test("targeted proper names resolve to custom definitions", async () => {
		const john3Chapter = await readJson("data/besorah/john3/1.json");
		const ephesiansChapter = await readJson("data/besorah/ephesians/1.json");
		const customDefinitions = await readJson(
			"data/dict/custom_definitions.json",
		);

		const john3Verse = john3Chapter.find(
			(item) => item.chapter === 1 && item.verse === 1,
		);
		const ephesiansVerse = ephesiansChapter.find(
			(item) => item.chapter === 1 && item.verse === 1,
		);

		expect(john3Verse.words[2]).toMatchObject({
			text: "גָּיוֹס",
			strong: "D0057",
		});
		expect(ephesiansVerse.words[0]).toMatchObject({
			text: "פּוֹלוֹס",
			strong: "D0024",
		});
		expect(customDefinitions.D0057.definitions[0].text_en).toContain("Gaius");
		expect(customDefinitions.D0057.definitions[0].text_es).toContain("Gayo");
		expect(customDefinitions.D0024.definitions[0].text_en).toContain("Paul");
		expect(customDefinitions.D0024.definitions[0].text_es).toContain("Pablo");
	});

	test("Spanish Psalms superscriptions use chapter titles and keep later verses aligned", async () => {
		const psalms = await readJson("data/bes/psalms.json");
		const chapter = psalms.chapters.find((item) => item.chapter === 3);

		expect(chapter).toBeDefined();
		expect(typeof chapter.title).toBe("string");
		expect(chapter.title.length > 0).toBe(true);

		const verse1Target = resolveTranslationTarget("psalms", 3, 1, {
			language: "es",
		});
		expect(verse1Target.usesPsalmTitle).toBe(true);
		expect(verse1Target.reference).toBeNull();

		const displayedVerse1 = verse1Target.usesPsalmTitle
			? chapter.title
			: chapter.verses.find(
					(item) => item.verse === verse1Target.reference?.verse,
				)?.bes;
		expect(displayedVerse1).toBe(chapter.title);

		const verse2Target = resolveTranslationTarget("psalms", 3, 2, {
			language: "es",
		});
		expect(verse2Target.usesPsalmTitle).toBe(false);
		expect(verse2Target.reference).toEqual({ chapter: 3, verse: 1 });

		const displayedVerse2 = chapter.verses.find(
			(item) => item.verse === verse2Target.reference?.verse,
		)?.bes;
		expect(displayedVerse2).toBe(
			chapter.verses.find((item) => item.verse === 1)?.bes,
		);
	});

	test("Spanish Deuteronomy partial TTH gaps use normalized TTH text", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input) => {
			const url = String(input);
			const path = url.startsWith("/") ? url.slice(1) : url;
			const filePath = new URL(`../../../public/${path}`, import.meta.url);
			const file = Bun.file(filePath);
			return new Response(await file.text(), {
				headers: { "content-type": "application/json" },
			});
		};

		try {
			const verses = await getChapterVerses("deuteronomy", 1, {
				language: "es",
			});
			const verse10 = verses.find((item) => item.verse === 10);

			expect(verse10?.translation).toBe(
				"\u2067יהוה\u2069 su Elohim los ha multiplicado, y he aquí ustedes, hoy <em>son</em> como las estrellas del cielo, por multitud.",
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("English and Spanish both honor versification shifts", () => {
		expect(
			resolveTranslationLookupKey("psalms", 3, 1, { language: "en" }),
		).toBeNull();
		expect(
			resolveTranslationLookupKey("psalms", 3, 2, { language: "en" }),
		).toBe("3-1");
		expect(
			resolveTranslationLookupKey("exodus", 7, 26, { language: "es" }),
		).toBe("8-1");
		expect(
			resolveTranslationLookupKey("exodus", 7, 26, { language: "en" }),
		).toBe("8-1");
		expect(
			resolveTranslationLookupKey("hosea", 2, 25, { language: "es" }),
		).toBe("2-23");
	});
});
