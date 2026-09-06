import { instanceSurface } from "../../../../shared/instanceSurface";
import {
	type BesorahTextVersion,
	getMissingSpanishTranslationNotice,
	getPsalmsSuperscriptionNotice,
	resolveTranslationLookupKey,
	resolveTranslationSource,
	resolveTranslationTarget,
	TTH_BOOK_MAPPING,
} from "../../../../shared/translationConfig";
import { getSourceChaptersForTranslationChapter } from "../../../../shared/versification";
import { VERSIFICATION_DATA } from "../../../../shared/versificationData";

export interface WordResponse {
	position: number;
	text: string;
	strong?: string;
	morph?: string;
	prefixes: string[];
	has_dss_variant: boolean;
	translit_en?: string;
	translit_es?: string;
	dss_translit_en?: string;
	dss_translit_es?: string;
}

export interface DssVariant {
	position: number;
	dss_word: string;
	masoretic_word: string;
	dss_translit_en?: string;
	dss_translit_es?: string;
	comment_v2_en?: string;
	comment_v2_es?: string;
	comment_v2_he?: string;
	masoretic_strong?: string;
	dss_strong?: string;
}

export interface TranslationFootnote {
	marker: string;
	number: string;
	word: string;
	explanation: string;
}

export interface VerseResponse {
	chapter: number;
	verse: number;
	sourceChapter: number;
	sourceVerse: number;
	hebrew: string;
	words: WordResponse[];
	translation?: string;
	translation_language?: string;
	translation_footnotes?: TranslationFootnote[];
	dss?: DssVariant[];
}

type ReferenceMode = "source" | "translation";

export interface BookResponse {
	id: string;
	name: string;
	section: "torah" | "neviim" | "ketuvim" | "besorah";
	chapters: number;
	order: number;
	hebrew_name: string;
	hebrew_transliteration: string;
	spanish_name: string;
}

type MetadataPayload = {
	books: BookResponse[];
	verse_counts?: Record<string, Record<string, number>>;
};

type RawWord = {
	text: string;
	strong?: string;
	morph?: string;
	prefixes?: string[];
	translit_en?: string;
	translit_es?: string;
};

type RawVerse = {
	chapter: number;
	verse: number;
	hebrew: string;
	words?: RawWord[];
};

type RawTranslationFootnote = {
	marker?: string;
	number?: string;
	word?: string;
	explanation?: string;
};

type RawTranslationVerse = {
	verse: number;
	bes?: string;
	tth?: string;
	footnotes?: RawTranslationFootnote[];
};

type RawTranslationBook = {
	book_info?: {
		hebrew_name?: string;
		spanish_name?: string;
	};
	chapters?: Array<{
		chapter: number;
		title?: string;
		verses: RawTranslationVerse[];
	}>;
};

type LoadedTranslationChapter = {
	verses: Record<string, RawTranslationVerse>;
	titles: Record<number, string>;
};

type RawDssDifference = {
	position?: number;
	dss_word?: string;
	translit_en?: string;
	translit_es?: string;
	masoretic_word?: string;
	commentary?: string;
	comment_v2_en?: string;
	comment_v2_es?: string;
	comment_v2_he?: string;
	masoretic_strong?: string;
	dss_strong?: string;
};

type RawDssVerse = {
	differences?: RawDssDifference[];
};

type RawDssBook = {
	chapters?: Record<
		string,
		{
			verses?: Record<string, RawDssVerse>;
		}
	>;
};

type RawTranslitWord = {
	text?: string;
	strong?: string;
	translit_en?: string;
	translit_es?: string;
};

type RawTranslitBook = {
	verses?: Array<{
		chapter: number;
		verse: number;
		words?: RawTranslitWord[];
	}>;
};

type RawDssTranslitVariant = {
	chapter?: number;
	verse?: number;
	position?: number;
	translit_en?: string;
	translit_es?: string;
};

type RawDssTranslitBook = {
	variants?: RawDssTranslitVariant[];
};

const MAX_CACHE_SIZE = 100;
const jsonCache = new Map<string, Promise<unknown>>();

// In-memory cache for TS2009 translations to avoid repeated private API reads.
// Keys: `${bookId}:${chapter}:${verse}`, Values: string | null
const ts2009Cache = new Map<string, string | null>();
const ts2009ChapterCache = new Map<
	string,
	Promise<Map<number, string> | null>
>();
const ts2009BookFileCache = new Map<
	string,
	Promise<RawTs2009BookPayload | null>
>();

const TS2009_BOOK_FILE_MAP: Record<string, string> = {
	genesis: "bereshit",
	exodus: "shemoth",
	leviticus: "wayyiqra",
	numbers: "bemidbar",
	deuteronomy: "debarim",
	joshua: "yehoshua",
	judges: "shophetim",
	samuel1: "samuel_1",
	samuel2: "samuel_2",
	kings1: "kings_1",
	kings2: "kings_2",
	chronicles1: "chronicles_1",
	chronicles2: "chronicles_2",
	nehemiah: "nehemyah",
	esther: "ester",
	job: "iyob",
	psalms: "tehillim",
	ecclesiastes: "qoheleth",
	songofsolomon: "shir_hashirim",
	isaiah: "yeshayahu",
	jeremiah: "yirmeyahu",
	lamentations: "ekah",
	ezekiel: "yehezqel",
	obadiah: "obadyah",
	jonah: "yonah",
	ruth: "ruth",
	ezra: "ezra",
	proverbs: "mishlei",
	daniel: "daniel",
	hosea: "hosea",
	joel: "yoel",
	amos: "amos",
	micah: "micah",
	nahum: "nahum",
	habakkuk: "habakkuk",
	zephaniah: "zephaniah",
	haggai: "haggai",
	zechariah: "zechariah",
	malachi: "malachi",
	matthew: "mattithyahu",
	mark: "marqos",
	luke: "lugqas",
	john: "yohanan",
	acts: "maasei",
	romans: "romiyim",
	corinthians1: "corinthians_1",
	corinthians2: "corinthians_2",
	galatians: "galatiyim",
	ephesians: "ephsiyim",
	philippians: "pilipiyim",
	colossians: "qolasim",
	thessalonians1: "thessalonians_1",
	thessalonians2: "thessalonians_2",
	timothy1: "timothy_1",
	timothy2: "timothy_2",
	titus: "titos",
	philemon: "pileymon",
	hebrews: "ibrim",
	james: "yaaqob",
	peter1: "peter_1",
	peter2: "peter_2",
	john1: "john_1",
	john2: "john_2",
	john3: "john_3",
	jude: "yehudah",
	revelation: "hazon",
};

type RawTs2009BookVerse = {
	number?: number;
	verse?: number;
	translation?: unknown;
	text?: unknown;
};

type RawTs2009BookChapter = {
	number?: number;
	chapter?: number;
	verses?: RawTs2009BookVerse[];
};

type RawTs2009BookPayload = {
	chapters?:
		| RawTs2009BookChapter[]
		| Record<string, RawTs2009BookChapter | RawTs2009BookVerse[]>;
};

const parseTs2009BookVerseText = (verse: RawTs2009BookVerse): string | null => {
	if (typeof verse.translation === "string") return verse.translation;
	if (typeof verse.text === "string") return verse.text;
	return null;
};

const extractTs2009ChapterVersesFromBook = (
	payload: RawTs2009BookPayload,
	chapter: number,
): RawTs2009BookVerse[] | null => {
	const chapters = payload.chapters;
	if (!chapters) return null;

	if (Array.isArray(chapters)) {
		const chapterMatch = chapters.find((entry) => {
			const chapterNumber = Number(entry.number ?? entry.chapter ?? Number.NaN);
			return Number.isFinite(chapterNumber) && chapterNumber === chapter;
		});

		return Array.isArray(chapterMatch?.verses) ? chapterMatch.verses : null;
	}

	const chapterEntry = chapters[String(chapter)];
	if (Array.isArray(chapterEntry)) {
		return chapterEntry;
	}

	return Array.isArray(chapterEntry?.verses) ? chapterEntry.verses : null;
};

const getTs2009BookFileCandidates = (bookId: string): string[] => {
	const normalized = bookId.toLowerCase();
	const mapped = TS2009_BOOK_FILE_MAP[normalized];
	const underscoreVariant = normalized.replace(/(\D)(\d+)$/, "$1_$2");
	const stems = [mapped, normalized, underscoreVariant].filter(
		(stem): stem is string => Boolean(stem),
	);

	return [...new Set(stems)];
};

const normalizePsalmsTs2009VerseMap = (
	chapter: number,
	verseMap: Record<string, string>,
): Record<string, string> => {
	const psaMap = VERSIFICATION_DATA.PSA?.simple_map;
	if (!psaMap) return verseMap;

	const chapterMap = (psaMap as Record<string, Record<string, string>>)[
		String(chapter)
	];
	if (!chapterMap) return verseMap;

	const targetForEnglishVerse1 = chapterMap["1"];
	if (!targetForEnglishVerse1) return verseMap;

	const [, targetVerseToken] = targetForEnglishVerse1.split(":");
	const firstRealHebrewVerse = Number(targetVerseToken);
	if (!Number.isFinite(firstRealHebrewVerse) || firstRealHebrewVerse <= 1) {
		return verseMap;
	}

	const superscriptionCount = firstRealHebrewVerse - 1;
	const englishVerseCount = Object.keys(chapterMap).filter(
		(verseKey) => Number(verseKey) > 0,
	).length;
	const existingKeys = Object.keys(verseMap)
		.map(Number)
		.filter((value) => Number.isFinite(value))
		.sort((a, b) => a - b);

	if (existingKeys.length !== englishVerseCount + superscriptionCount) {
		return verseMap;
	}

	const normalized: Record<string, string> = {};
	const realVerseKeys = existingKeys.slice(superscriptionCount);
	for (const [index, hebrewKey] of realVerseKeys.entries()) {
		const englishVerse = index + 1;
		const text = verseMap[String(hebrewKey)];
		if (text !== undefined) {
			normalized[String(englishVerse)] = text;
		}
	}

	return normalized;
};

const loadTs2009BookFile = (
	fileStem: string,
): Promise<RawTs2009BookPayload | null> => {
	let bookPromise = ts2009BookFileCache.get(fileStem);
	if (!bookPromise) {
		bookPromise = (async () => {
			const candidatePaths = [
				`/api/ts2009/${fileStem}.json`,
				`/data/ts2009/${fileStem}.json`,
			];

			for (const candidatePath of candidatePaths) {
				try {
					return await fetchJson<RawTs2009BookPayload>(candidatePath);
				} catch {
					continue;
				}
			}

			return null;
		})();
		ts2009BookFileCache.set(fileStem, bookPromise);
	}

	return bookPromise;
};

const loadTs2009ChapterFromBookFile = async (
	bookId: string,
	chapter: number,
): Promise<Map<number, string> | null> => {
	for (const fileStem of getTs2009BookFileCandidates(bookId)) {
		const staticBook = await loadTs2009BookFile(fileStem);
		if (!staticBook) {
			continue;
		}

		const chapterVerses = extractTs2009ChapterVersesFromBook(
			staticBook,
			chapter,
		);
		if (!chapterVerses || chapterVerses.length === 0) {
			continue;
		}

		const rawVerseMap: Record<string, string> = {};
		for (const [index, verse] of chapterVerses.entries()) {
			const verseNumber = Number(verse.number ?? verse.verse ?? index + 1);
			const verseText = parseTs2009BookVerseText(verse);
			if (!Number.isFinite(verseNumber) || !verseText) {
				continue;
			}

			rawVerseMap[String(verseNumber)] = verseText;
		}

		const normalizedVerseMap =
			bookId.toLowerCase() === "psalms"
				? normalizePsalmsTs2009VerseMap(chapter, rawVerseMap)
				: rawVerseMap;

		const verseMap = new Map<number, string>();
		for (const [verseKey, verseText] of Object.entries(normalizedVerseMap)) {
			const verseNumber = Number(verseKey);
			if (!Number.isFinite(verseNumber)) {
				continue;
			}

			verseMap.set(verseNumber, verseText);
		}

		if (verseMap.size > 0) {
			return verseMap;
		}
	}

	return null;
};

type StaticBase = "" | "/public" | "/web" | "/web/public";

const staticUrlPrefix = (
	(
		import.meta as ImportMeta & {
			env?: Record<string, string | undefined>;
		}
	).env?.PUBLIC_STATIC_URL ?? ""
).replace(/\/+$/, "");

let preferredStaticBase: StaticBase = "";
const STATIC_BASE_CANDIDATES: StaticBase[] = [
	"",
	"/public",
	"/web",
	"/web/public",
];

const normalizeStaticPath = (path: string): string =>
	path.startsWith("/") ? path : `/${path}`;

const buildCandidatePaths = (path: string): string[] => {
	const normalizedPath = normalizeStaticPath(path);
	if (normalizedPath.startsWith("/api/")) {
		return [normalizedPath];
	}

	const orderedBases = [
		preferredStaticBase,
		...STATIC_BASE_CANDIDATES.filter((base) => base !== preferredStaticBase),
	];
	const localPaths = orderedBases.map((base) => `${base}${normalizedPath}`);

	if (!staticUrlPrefix) {
		return localPaths;
	}

	const prefixedPaths = localPaths.map(
		(candidatePath) => `${staticUrlPrefix}${candidatePath}`,
	);

	return [...new Set([...prefixedPaths, ...localPaths])];
};

const inferStaticBaseFromResolvedPath = (
	resolvedPath: string,
	originalPath: string,
): StaticBase => {
	const normalizedPath = normalizeStaticPath(originalPath);

	if (!resolvedPath.endsWith(normalizedPath)) {
		return "";
	}

	const base = resolvedPath.slice(
		0,
		resolvedPath.length - normalizedPath.length,
	);
	if (
		base === "" ||
		base === "/public" ||
		base === "/web" ||
		base === "/web/public"
	) {
		return base;
	}

	return "";
};

const parseStaticJson = async <T>(
	response: Response,
	resolvedPath: string,
): Promise<T> => {
	if (!response.ok) {
		throw new Error(
			`Failed to load static data: ${resolvedPath} (status ${response.status})`,
		);
	}

	const contentType = response.headers.get("content-type") || "";
	const payload = await response.text();
	const normalizedPayload = payload.trimStart().toLowerCase();
	const looksLikeHtml =
		normalizedPayload.startsWith("<!doctype") ||
		normalizedPayload.startsWith("<html");

	if (looksLikeHtml) {
		throw new Error(
			`Static data endpoint returned HTML instead of JSON: ${resolvedPath}`,
		);
	}

	try {
		return JSON.parse(payload) as T;
	} catch {
		const contentTypeLabel = contentType || "unknown";
		throw new Error(
			`Invalid JSON for static data: ${resolvedPath} (content-type: ${contentTypeLabel})`,
		);
	}
};

const fetchJson = async <T>(path: string): Promise<T> => {
	// If already cached, move to end (mark as recently used)
	if (jsonCache.has(path)) {
		// biome-ignore lint/style/noNonNullAssertion: safe — guarded by .has() check above
		const promise = jsonCache.get(path)!;
		jsonCache.delete(path);
		jsonCache.set(path, promise);
		return promise as Promise<T>;
	}

	const promise = (async () => {
		const errors: string[] = [];
		const troubleshootingHint = normalizeStaticPath(path).startsWith("/api/")
			? "Verify the local Bun server or deployed Pages Function serves this API route."
			: "Verify the web app is launched from the web/ directory (bun run dev) or served from a build that includes copied public data.";

		for (const resolvedPath of buildCandidatePaths(path)) {
			try {
				const response = await fetch(resolvedPath, { cache: "no-cache" });
				const parsed = await parseStaticJson<T>(response, resolvedPath);
				preferredStaticBase = inferStaticBaseFromResolvedPath(
					resolvedPath,
					path,
				);
				return parsed;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				errors.push(message);
			}
		}

		throw new Error(
			`Failed to load static data from all candidates for ${normalizeStaticPath(path)}: ${errors.join(" | ")}. ${troubleshootingHint}`,
		);
	})().catch((error) => {
		jsonCache.delete(path); // Remove failed entry to allow retry
		throw error;
	});

	// Evict oldest if at capacity
	if (jsonCache.size >= MAX_CACHE_SIZE) {
		const firstKey = jsonCache.keys().next().value;
		if (firstKey !== undefined) {
			jsonCache.delete(firstKey);
		}
	}

	jsonCache.set(path, promise);
	return promise as Promise<T>;
};

let metadataPromise: Promise<MetadataPayload> | null = null;
let booksPromise: Promise<BookResponse[]> | null = null;

/**
 * Fetches TS2009 translation with client-side caching to avoid repeated API requests.
 * Uses in-memory cache with keys formatted as `${bookId}:${chapter}:${verse}`.
 */
const fetchCachedTs2009Translation = async (
	bookId: string,
	chapter: number,
	verse: number,
): Promise<string | null> => {
	const cacheKey = `${bookId}:${chapter}:${verse}`;

	// Return cached value if available
	if (ts2009Cache.has(cacheKey)) {
		// biome-ignore lint/style/noNonNullAssertion: safe — guarded by .has() check above
		return ts2009Cache.get(cacheKey)!;
	}

	const chapterKey = `${bookId}:${chapter}`;

	let chapterPromise = ts2009ChapterCache.get(chapterKey);
	if (!chapterPromise) {
		chapterPromise = loadTs2009ChapterFromBookFile(bookId, chapter);

		ts2009ChapterCache.set(chapterKey, chapterPromise);
	}

	const staticChapterTranslations = await chapterPromise;
	const staticTranslation = staticChapterTranslations?.get(verse) ?? null;
	if (staticTranslation) {
		ts2009Cache.set(cacheKey, staticTranslation);
		return staticTranslation;
	}

	ts2009Cache.set(cacheKey, null);
	return null;
};

export const loadMetadata = async (): Promise<MetadataPayload> => {
	if (!metadataPromise) {
		metadataPromise = fetchJson<MetadataPayload>("/data/metadata.json").catch(
			(error) => {
				metadataPromise = null;
				throw error;
			},
		);
	}
	return metadataPromise;
};

const normalizeBookToken = (value: string): string =>
	value.toLowerCase().replace(/[^a-z0-9]/g, "");

const findBook = (
	books: BookResponse[],
	bookName: string,
): BookResponse | undefined => {
	const target = normalizeBookToken(bookName);
	return books.find((book) => {
		const candidates = [
			book.id,
			book.name,
			book.hebrew_name,
			book.hebrew_transliteration,
			book.spanish_name,
		];

		return candidates.some(
			(candidate) => normalizeBookToken(candidate) === target,
		);
	});
};

const TTH_BOOK_KEY_BY_NORMALIZED_TOKEN: Record<string, string> =
	Object.fromEntries(
		Object.keys(TTH_BOOK_MAPPING).map((bookKey) => [
			normalizeBookToken(bookKey),
			bookKey,
		]),
	);

const resolveTthBookId = (bookId: string): string | undefined => {
	const canonicalKey =
		TTH_BOOK_KEY_BY_NORMALIZED_TOKEN[normalizeBookToken(bookId)];

	if (!canonicalKey) {
		return undefined;
	}

	return TTH_BOOK_MAPPING[canonicalKey];
};

const toDssBookKey = (bookId: string): string => {
	const dssMap: Record<string, string> = {
		samuel1: "1samuel",
		samuel2: "2samuel",
		songofsolomon: "songs",
		hosea: "hoseah",
	};

	return dssMap[bookId] ?? bookId;
};

const HEBREW_MARKS_RE = /[\u0591-\u05C7]/g;

const normalizeSurfaceWord = (value?: string): string =>
	(value ?? "").replaceAll("/", "").replace(HEBREW_MARKS_RE, "");

const extractBaseStrong = (value?: string): string | undefined => {
	if (!value) return undefined;

	const parts = value
		.toUpperCase()
		.replace(/\s+/g, "")
		.split("/")
		.filter(Boolean);

	for (let index = parts.length - 1; index >= 0; index -= 1) {
		if (/^[HGD]\d+$/.test(parts[index])) {
			return parts[index];
		}
	}

	return parts.length > 0 ? parts[parts.length - 1] : undefined;
};

const getTranslationLookupKey = (
	bookId: string,
	chapter: number,
	verse: number,
	language?: "es" | "en",
): string | null => {
	return resolveTranslationLookupKey(bookId, chapter, verse, { language });
};

const getRequiredTranslationChapters = (
	bookId: string,
	sourceVerses: Array<{ chapter: number; verse: number }>,
	language?: "es" | "en",
): number[] => {
	if (!language) {
		return [];
	}

	const mappedChapters = new Set<number>();

	for (const sourceVerse of sourceVerses) {
		const mappedKey = getTranslationLookupKey(
			bookId,
			sourceVerse.chapter,
			sourceVerse.verse,
			language,
		);
		if (!mappedKey) {
			continue;
		}

		const [mappedChapterToken] = mappedKey.split("-");
		const mappedChapter = Number(mappedChapterToken);
		if (Number.isFinite(mappedChapter) && mappedChapter > 0) {
			mappedChapters.add(mappedChapter);
		}
	}

	if (mappedChapters.size === 0) {
		for (const sourceVerse of sourceVerses) {
			mappedChapters.add(sourceVerse.chapter);
		}
	}

	return [...mappedChapters].sort((a, b) => a - b);
};

const getSourceChaptersForRequest = (
	bookId: string,
	chapter: number,
	language: "es" | "en" | undefined,
	referenceMode: ReferenceMode,
): number[] => {
	if (!Number.isFinite(chapter) || chapter <= 0) {
		return [];
	}

	if (!language || referenceMode !== "translation") {
		return [chapter];
	}

	const source = resolveTranslationSource(bookId, { language });
	if (!source) {
		return [chapter];
	}

	const chapters = getSourceChaptersForTranslationChapter(bookId, chapter);
	return chapters.length > 0 ? chapters : [chapter];
};

const isPsalmsBook = (bookId: string): boolean =>
	normalizeBookToken(bookId) === "psalms";

const HEBREW_RUN_RE = /[\u0590-\u05FF]+/g;

const isolateHebrewRuns = (value: string): string =>
	value.replace(HEBREW_RUN_RE, (token) => `\u2067${token}\u2069`);

const finalizeTranslationDisplayText = (value: string): string =>
	value.trim().length > 0 ? isolateHebrewRuns(value) : value;

const resolveTranslationText = (params: {
	bookId: string;
	language?: "es" | "en";
	mappedTranslationKey: string | null;
	translationTitle?: string | null;
	translationText?: string | null;
}): string => {
	const {
		bookId,
		language,
		mappedTranslationKey,
		translationTitle,
		translationText,
	} = params;

	if (!language) {
		return finalizeTranslationDisplayText(translationText ?? "");
	}

	if (translationTitle && translationTitle.trim().length > 0) {
		return finalizeTranslationDisplayText(translationTitle);
	}

	if (isPsalmsBook(bookId) && mappedTranslationKey === null) {
		return finalizeTranslationDisplayText(
			getPsalmsSuperscriptionNotice(language),
		);
	}

	if (translationText && translationText.trim().length > 0) {
		return finalizeTranslationDisplayText(translationText);
	}

	return finalizeTranslationDisplayText(
		getMissingSpanishTranslationNotice(language),
	);
};

const mapDssDifferences = (differences?: RawDssDifference[]): DssVariant[] => {
	if (!differences?.length) return [];

	return differences.map((difference, index) => {
		const normalizedPosition =
			typeof difference.position === "number"
				? Math.max(0, Math.trunc(difference.position - 1))
				: index;

		return {
			position: normalizedPosition,
			dss_word: difference.dss_word ?? "",
			masoretic_word: difference.masoretic_word ?? "",
			dss_translit_en: difference.translit_en,
			dss_translit_es: difference.translit_es,
			comment_v2_en: difference.comment_v2_en ?? difference.commentary,
			comment_v2_es: difference.comment_v2_es,
			comment_v2_he: difference.comment_v2_he,
			masoretic_strong: difference.masoretic_strong,
			dss_strong: difference.dss_strong,
		};
	});
};

const mapTranslationFootnotes = (
	footnotes?: RawTranslationFootnote[],
): TranslationFootnote[] => {
	if (!footnotes?.length) return [];

	return footnotes
		.map((footnote): TranslationFootnote | null => {
			if (!footnote.marker && !footnote.number && !footnote.explanation) {
				return null;
			}

			return {
				marker: footnote.marker ?? "",
				number: footnote.number ?? "",
				word: footnote.word ?? "",
				explanation: footnote.explanation ?? "",
			};
		})
		.filter((footnote): footnote is TranslationFootnote => footnote !== null);
};

const loadCoreChapter = async (
	book: BookResponse,
	chapter: number,
	besorahTextVersion: BesorahTextVersion = "delitzsch",
): Promise<RawVerse[]> => {
	const chapterPath =
		book.section === "besorah"
			? `/data/${besorahTextVersion === "hutter" ? "hutter" : "besorah"}/${book.id}/${chapter}.json`
			: `/data/oe/${book.id}/${chapter}.json`;

	try {
		return await fetchJson<RawVerse[]>(chapterPath);
	} catch {
		return [];
	}
};

const SHIR_HASHIRIM_ARTIFACT_RE =
	/\s*Final del cántico\.\s*Inicio del cántico\.?/gi;

const sanitizeShirHashirimTth = (text?: string): string | undefined => {
	if (!text) return text;

	const withoutArtifacts = text
		.replace(SHIR_HASHIRIM_ARTIFACT_RE, "")
		.replace(/\s{2,}/g, " ")
		.replace(/\s+([,.;:!?])/g, "$1")
		.trim();

	// Keep emphasis only for single-token spans.
	return withoutArtifacts.replace(/<em>([^<]+)<\/em>/g, (_match, content) => {
		const trimmed = String(content).trim();
		if (!trimmed) return trimmed;
		return trimmed.split(/\s+/).length > 1 ? trimmed : `<em>${trimmed}</em>`;
	});
};

const loadTranslationChapter = async (
	bookId: string,
	requiredChapters: number[],
): Promise<LoadedTranslationChapter> => {
	const translationMap: Record<string, RawTranslationVerse> = {};
	const translationTitles: Record<number, string> = {};
	const hasTranslationText = (verse?: RawTranslationVerse): boolean =>
		Boolean(verse?.tth?.trim() || verse?.bes?.trim());

	// Try TTH_2 first (official Spanish translation)
	const tthBookId = resolveTthBookId(bookId);
	if (tthBookId) {
		try {
			const translationBook = await fetchJson<RawTranslationBook>(
				`/data/tth/${tthBookId}.json`,
			);

			for (const translationChapter of requiredChapters) {
				const chapterData = translationBook.chapters?.find(
					(item) => item.chapter === translationChapter,
				);

				if (!chapterData) {
					continue;
				}

				if (typeof chapterData.title === "string" && chapterData.title.trim()) {
					translationTitles[translationChapter] = chapterData.title.trim();
				}

				const verses =
					tthBookId === "shir_hashirim"
						? chapterData.verses.map((verse) => ({
								...verse,
								tth: sanitizeShirHashirimTth(verse.tth),
							}))
						: chapterData.verses;

				for (const verse of verses) {
					translationMap[`${translationChapter}-${verse.verse}`] = verse;
				}
			}
		} catch {
			// TTH_2 not available for this book, try BES fallback below
		}
	}

	// Fill genuinely missing TTH verses from BES.
	try {
		const translationBook = await fetchJson<RawTranslationBook>(
			`/data/bes/${bookId}.json`,
		);

		for (const translationChapter of requiredChapters) {
			const chapterData = translationBook.chapters?.find(
				(item) => item.chapter === translationChapter,
			);

			if (!chapterData) {
				continue;
			}

			if (
				!translationTitles[translationChapter] &&
				typeof chapterData.title === "string" &&
				chapterData.title.trim()
			) {
				translationTitles[translationChapter] = chapterData.title.trim();
			}

			for (const verse of chapterData.verses) {
				const key = `${translationChapter}-${verse.verse}`;
				if (!hasTranslationText(translationMap[key])) {
					translationMap[key] = verse;
				}
			}
		}

		return {
			verses: translationMap,
			titles: translationTitles,
		};
	} catch {
		return {
			verses: translationMap,
			titles: translationTitles,
		};
	}
};

const loadDssChapter = async (
	bookId: string,
	chapter: number,
): Promise<Record<string, RawDssVerse>> => {
	const dssBookKey = toDssBookKey(bookId);

	try {
		const dssBook = await fetchJson<RawDssBook>(`/data/dss/${dssBookKey}.json`);
		const chapterData = dssBook.chapters?.[String(chapter)];

		if (!chapterData?.verses) return {};

		return Object.entries(chapterData.verses).reduce(
			(acc, [verseKey, verseValue]) => {
				acc[`${chapter}:${Number.parseInt(verseKey, 10)}`] = verseValue;
				return acc;
			},
			{} as Record<string, RawDssVerse>,
		);
	} catch {
		return {};
	}
};

const loadTranslitChapter = async (
	bookId: string,
	chapter: number,
): Promise<Record<string, RawTranslitWord[]>> => {
	try {
		const translitBook = await fetchJson<RawTranslitBook>(
			`/data/translit/${bookId}.json`,
		);

		const verseMap: Record<string, RawTranslitWord[]> = {};
		for (const verseEntry of translitBook.verses ?? []) {
			if (verseEntry.chapter !== chapter) continue;
			verseMap[`${chapter}:${verseEntry.verse}`] = verseEntry.words ?? [];
		}

		return verseMap;
	} catch {
		return {};
	}
};

const loadDssTranslitChapter = async (
	bookId: string,
	chapter: number,
): Promise<Record<string, Record<number, RawDssTranslitVariant>>> => {
	const dssBookKey = toDssBookKey(bookId);

	try {
		const translitBook = await fetchJson<RawDssTranslitBook>(
			`/data/translit/dss/${dssBookKey}.json`,
		);
		const verseMap: Record<string, Record<number, RawDssTranslitVariant>> = {};

		for (const variant of translitBook.variants ?? []) {
			if (variant.chapter !== chapter) continue;

			const verse = Number(variant.verse);
			const position = Number(variant.position);
			if (
				!Number.isFinite(verse) ||
				!Number.isFinite(position) ||
				position <= 0
			) {
				continue;
			}

			const key = `${chapter}:${verse}`;
			if (!verseMap[key]) {
				verseMap[key] = {};
			}

			// Align with WordResponse.position which is zero-based on web.
			verseMap[key][position - 1] = variant;
		}

		return verseMap;
	} catch {
		return {};
	}
};

const findFallbackTranslitWord = (
	word: RawWord,
	translitWords: RawTranslitWord[],
): RawTranslitWord | undefined => {
	const baseStrong = extractBaseStrong(word.strong);
	const normalizedText = normalizeSurfaceWord(word.text);

	if (!baseStrong && !normalizedText) {
		return undefined;
	}

	return translitWords.find((candidate) => {
		const candidateStrong = extractBaseStrong(candidate.strong);
		const candidateText = normalizeSurfaceWord(candidate.text);

		const strongMatches =
			baseStrong && candidateStrong ? baseStrong === candidateStrong : false;
		const textMatches =
			normalizedText && candidateText
				? normalizedText === candidateText
				: false;

		if (baseStrong && !strongMatches) return false;
		if (normalizedText && !textMatches) return false;

		return strongMatches || textMatches;
	});
};

const mapVerse = (
	bookId: string,
	rawVerse: RawVerse,
	outputChapter: number,
	outputVerse: number,
	translationVerse?: RawTranslationVerse,
	translationTitle?: string | null,
	dssVerse?: RawDssVerse,
	translitWords?: RawTranslitWord[],
	dssTranslitByPosition?: Record<number, RawDssTranslitVariant>,
	options?: {
		language?: "es" | "en";
		showDss?: boolean;
		hebrewOnly?: boolean;
	},
	ts2009Translation?: string | null,
	mappedTranslationKey?: string | null,
): VerseResponse => {
	const dssVariants = mapDssDifferences(dssVerse?.differences);
	const dssVariantMap = new Map(
		dssVariants.map((variant) => [variant.position, variant]),
	);
	const sourceWords = rawVerse.words ?? [];
	const canMapTranslitByPosition = translitWords
		? translitWords.length === sourceWords.length
		: false;

	const words: WordResponse[] = sourceWords.map((word, index) => {
		const dssVariant = dssVariantMap.get(index);
		const dssTranslit = dssTranslitByPosition?.[index];
		const prefersDssTranslit = Boolean(options?.showDss && dssVariant);
		const dssTranslitEn =
			dssTranslit?.translit_en ?? dssVariant?.dss_translit_en;
		const dssTranslitEs =
			dssTranslit?.translit_es ?? dssVariant?.dss_translit_es;
		const translitWord = canMapTranslitByPosition
			? translitWords?.[index]
			: translitWords
				? findFallbackTranslitWord(word, translitWords)
				: undefined;

		return {
			position: index,
			text: word.text,
			strong: word.strong,
			morph: word.morph,
			prefixes: word.prefixes ?? [],
			has_dss_variant: dssVariantMap.has(index),
			translit_en: prefersDssTranslit
				? (dssTranslitEn ?? word.translit_en ?? translitWord?.translit_en)
				: (word.translit_en ?? translitWord?.translit_en),
			translit_es: prefersDssTranslit
				? (dssTranslitEs ?? word.translit_es ?? translitWord?.translit_es)
				: (word.translit_es ?? translitWord?.translit_es),
			dss_translit_en: dssTranslitEn,
			dss_translit_es: dssTranslitEs,
		};
	});

	const response: VerseResponse = {
		chapter: outputChapter,
		verse: outputVerse,
		sourceChapter: rawVerse.chapter,
		sourceVerse: rawVerse.verse,
		hebrew: rawVerse.hebrew,
		words,
	};

	// Handle translation based on language
	if (!options?.hebrewOnly) {
		const language = options?.language;
		const baseTranslationText =
			language === "en"
				? ts2009Translation
				: (translationVerse?.bes ?? translationVerse?.tth);
		const translationText = resolveTranslationText({
			bookId,
			language,
			mappedTranslationKey: mappedTranslationKey ?? null,
			translationTitle,
			translationText: baseTranslationText,
		});

		if (options?.language === "en") {
			response.translation = translationText;
			response.translation_language = "en";
		} else if (options?.language === "es") {
			response.translation = translationText;
			response.translation_language = "es";
			if (translationVerse?.bes || translationVerse?.tth) {
				const translationFootnotes = mapTranslationFootnotes(
					translationVerse.footnotes,
				);
				if (translationFootnotes.length > 0) {
					response.translation_footnotes = translationFootnotes;
				}
			}
		}
	}

	if (options?.showDss && dssVariants.length > 0) {
		response.dss = dssVariants;
	}

	return response;
};

export const getBooks = async (): Promise<BookResponse[]> => {
	if (!booksPromise) {
		booksPromise = (async () => {
			const metadata = await loadMetadata();
			const books = metadata.books;

			const hasPlaceholderLabels = books.some(
				(book) =>
					book.hebrew_name === book.name ||
					book.spanish_name === book.name ||
					book.hebrew_transliteration === book.name,
			);

			if (!hasPlaceholderLabels) {
				return books;
			}

			const hydrated = await Promise.all(
				books.map(async (book) => {
					try {
						const translationBook = await fetchJson<RawTranslationBook>(
							`/data/bes/${book.id}.json`,
						);
						const bookInfo = translationBook.book_info;

						return {
							...book,
							hebrew_name: bookInfo?.hebrew_name || book.hebrew_name,
							spanish_name: bookInfo?.spanish_name || book.spanish_name,
						};
					} catch {
						return book;
					}
				}),
			);

			return hydrated;
		})().catch((error) => {
			booksPromise = null;
			throw error;
		});
	}

	return booksPromise;
};

export const lookupBook = async (bookName: string): Promise<BookResponse> => {
	const metadata = await loadMetadata();
	const match = findBook(metadata.books, bookName);

	if (!match) {
		throw new Error(`Book not found: ${bookName}`);
	}

	return match;
};

export const getChapterCount = async (book: string): Promise<number> => {
	const metadata = await loadMetadata();
	const bookEntry = findBook(metadata.books, book);

	if (!bookEntry) return 1;
	return bookEntry.chapters;
};

export const getVerseCount = async (
	book: string,
	chapter: number,
): Promise<number> => {
	const metadata = await loadMetadata();
	const bookEntry = findBook(metadata.books, book);

	if (!bookEntry) return 1;

	const verseCounts = metadata.verse_counts?.[bookEntry.name];
	if (verseCounts?.[String(chapter)]) {
		return verseCounts[String(chapter)];
	}

	const chapterVerses = await getChapterVerses(bookEntry.id, chapter, {
		hebrewOnly: true,
	});
	return chapterVerses.length;
};

export const getChapterVerses = async (
	book: string,
	chapter: number,
	options?: {
		language?: "es" | "en";
		showDss?: boolean;
		hebrewOnly?: boolean;
		referenceMode?: ReferenceMode;
		besorahTextVersion?: BesorahTextVersion;
	},
): Promise<VerseResponse[]> => {
	const metadata = await loadMetadata();
	const bookEntry = findBook(metadata.books, book);

	if (!bookEntry) return [];
	const referenceMode = options?.referenceMode ?? "source";
	const sourceChapters = getSourceChaptersForRequest(
		bookEntry.id,
		chapter,
		options?.language,
		referenceMode,
	);
	const coreVerseChunks = await Promise.all(
		sourceChapters.map((sourceChapter) =>
			loadCoreChapter(
				bookEntry,
				sourceChapter,
				options?.besorahTextVersion ?? "delitzsch",
			),
		),
	);
	const coreVerses = coreVerseChunks.flat();

	if (coreVerses.length === 0) {
		return [];
	}

	const requiredTranslationChapters = options?.hebrewOnly
		? []
		: getRequiredTranslationChapters(
				bookEntry.id,
				coreVerses.map((verse) => ({
					chapter: verse.chapter,
					verse: verse.verse,
				})),
				options?.language,
			);

	const [translations, dssVerses, transliterations, dssTransliterations] =
		await Promise.all([
			options?.hebrewOnly
				? Promise.resolve<LoadedTranslationChapter>({ verses: {}, titles: {} })
				: loadTranslationChapter(bookEntry.id, requiredTranslationChapters),
			options?.showDss
				? Promise.all(
						sourceChapters.map((sourceChapter) =>
							loadDssChapter(bookEntry.id, sourceChapter),
						),
					).then((records) => Object.assign({}, ...records))
				: Promise.resolve<Record<string, RawDssVerse>>({}),
			Promise.all(
				sourceChapters.map((sourceChapter) =>
					loadTranslitChapter(bookEntry.id, sourceChapter),
				),
			).then((records) => Object.assign({}, ...records)),
			options?.showDss
				? Promise.all(
						sourceChapters.map((sourceChapter) =>
							loadDssTranslitChapter(bookEntry.id, sourceChapter),
						),
					).then((records) => Object.assign({}, ...records))
				: Promise.resolve<
						Record<string, Record<number, RawDssTranslitVariant>>
					>({}),
		]);

	// If language is English, load TS2009 translations from the private API.
	let ts2009Translations: Record<string, string> = {};
	if (options?.language === "en") {
		const uniqueTranslationKeys = [
			...new Set(
				coreVerses
					.map((verse) =>
						getTranslationLookupKey(
							bookEntry.id,
							verse.chapter,
							verse.verse,
							"en",
						),
					)
					.filter((key): key is string => Boolean(key)),
			),
		];

		const ts2009Results = await Promise.all(
			uniqueTranslationKeys.map(async (translationKey) => {
				const [mappedChapterToken, mappedVerseToken] =
					translationKey.split("-");
				const mappedChapter = Number(mappedChapterToken);
				const mappedVerse = Number(mappedVerseToken);

				if (!Number.isFinite(mappedChapter) || !Number.isFinite(mappedVerse)) {
					return [translationKey, null] as const;
				}

				const translation = await fetchCachedTs2009Translation(
					bookEntry.id,
					mappedChapter,
					mappedVerse,
				);

				return [translationKey, translation] as const;
			}),
		);

		ts2009Translations = Object.fromEntries(
			ts2009Results.flatMap(([translationKey, translation]) =>
				translation === null ? [] : [[translationKey, translation]],
			),
		);
	}

	const mappedVerses = coreVerses.map((rawVerse) => {
		const translationTarget = resolveTranslationTarget(
			bookEntry.id,
			rawVerse.chapter,
			rawVerse.verse,
			{ language: options?.language },
		);
		const translationKey = translationTarget.reference
			? `${translationTarget.reference.chapter}-${translationTarget.reference.verse}`
			: null;
		const outputChapter =
			referenceMode === "translation"
				? (translationTarget.reference?.chapter ?? 0)
				: rawVerse.chapter;
		const outputVerse =
			referenceMode === "translation"
				? (translationTarget.reference?.verse ?? 0)
				: rawVerse.verse;
		const verseKey = `${rawVerse.chapter}:${rawVerse.verse}`;

		return mapVerse(
			bookEntry.id,
			rawVerse,
			outputChapter,
			outputVerse,
			translationKey ? translations.verses[translationKey] : undefined,
			translationTarget.usesPsalmTitle
				? (translations.titles[rawVerse.chapter] ?? null)
				: null,
			dssVerses[verseKey],
			transliterations[verseKey],
			dssTransliterations[verseKey],
			options,
			translationKey ? ts2009Translations[translationKey] : undefined,
			translationKey,
		);
	});

	if (referenceMode === "translation" && options?.language) {
		return mappedVerses
			.filter((verse) => verse.chapter === chapter)
			.sort(
				(a, b) =>
					a.verse - b.verse ||
					a.sourceChapter - b.sourceChapter ||
					a.sourceVerse - b.sourceVerse,
			);
	}

	return mappedVerses.sort(
		(a, b) =>
			a.sourceChapter - b.sourceChapter || a.sourceVerse - b.sourceVerse,
	);
};

export const getVerse = async (
	book: string,
	chapter: number,
	verse: number,
	options?: {
		language?: "es" | "en";
		showDss?: boolean;
		hebrewOnly?: boolean;
	},
): Promise<VerseResponse | null> => {
	const verses = await getChapterVerses(book, chapter, options);
	return verses.find((item) => item.verse === verse) ?? null;
};

// ── Lexicon Service ───────────────────────────────────────────────────────

export interface DefinitionItem {
	text: string;
	source: "custom" | "strong" | "bdb" | string;
	language: "en" | "es" | string;
}

export interface WordAnalysis {
	strong_number: string;
	hebrew?: string;
	translit_en?: string;
	translit_es?: string;
	definitions: DefinitionItem[];
	root?: string;
	root_strong?: string;
	root_definitions?: DefinitionItem[];
	root_translit_en?: string;
	root_translit_es?: string;
	occurrences_count: number;
	instances?: Array<string | { verse: string; text: string }>;
	instance_policy_version?: string;
	instance_total?: number;
	instance_surface_count?: number;
	instance_tier?: "low" | "medium" | "high";
	instance_omitted_count?: number;
}

type RawDefinition = {
	text?: string;
	text_en?: string;
	text_es?: string;
	source?: string;
};

type RawOccurrence = {
	total?: number;
	references?: string[];
	surface_references?: string[];
};

type RawWordEntry = {
	strong_number?: string;
	lemma?: string;
	hebrew?: string;
	translit_en?: string;
	translit_es?: string;
	transliteration_en?: string;
	transliteration_es?: string;
	definitions?: RawDefinition[];
	occurrences?: RawOccurrence;
	root_ref?: string;
	root_strong?: string;
};

type RawCustomInstance = {
	book: string;
	chapter: number;
	verse: number;
	word_positions?: number[] | number;
	stable_id?: string;
	confidence?: number;
	[key: string]: unknown;
};

type RawCustomEntry = {
	strong_number?: string;
	compound_key?: string;
	hebrew?: string;
	transliteration_en?: string;
	transliteration_es?: string;
	definitions?: RawDefinition[];
	root?: string;
	root_strong?: string;
	manual_instances?: string[];
	oe_instances?: RawCustomInstance[];
	nt_instances?: RawCustomInstance[];
	instances?: RawCustomInstance[];
	surface_instances?: RawCustomInstance[];
	instance_policy_version?: string;
	instance_total?: number;
	instance_surface_count?: number;
	instance_tier?: "low" | "medium" | "high";
	instance_omitted_count?: number;
};

let wordsPromise: Promise<Record<string, RawWordEntry>> | null = null;
let rootsPromise: Promise<Record<string, RawWordEntry>> | null = null;
let customPromise: Promise<Record<string, RawCustomEntry>> | null = null;

const loadWords = async (): Promise<Record<string, RawWordEntry>> => {
	if (!wordsPromise) {
		wordsPromise = fetchJson<Record<string, RawWordEntry>>(
			"/data/dict/words.json",
		);
	}
	return wordsPromise;
};

const loadRoots = async (): Promise<Record<string, RawWordEntry>> => {
	if (!rootsPromise) {
		rootsPromise = fetchJson<Record<string, RawWordEntry>>(
			"/data/dict/roots.json",
		);
	}
	return rootsPromise;
};

const loadCustomDefinitions = async (): Promise<
	Record<string, RawCustomEntry>
> => {
	if (!customPromise) {
		customPromise = fetchJson<Record<string, RawCustomEntry>>(
			"/data/dict/custom_definitions.json",
		);
	}
	return customPromise;
};

const normalizeStrong = (strong?: string): string | null => {
	if (!strong) return null;
	const cleaned = strong.trim().toUpperCase();
	if (/^[HGD]\d+$/.test(cleaned)) return cleaned;
	return null;
};

export const getPolicyInstances = (entry: RawCustomEntry): RawCustomInstance[] =>
	entry.surface_instances ??
	entry.instances ?? [
		...(entry.oe_instances ?? []),
		...(entry.nt_instances ?? []),
	];

const mapDefinitions = (
	definitions: RawDefinition[] | undefined,
	language: "en" | "es",
): DefinitionItem[] => {
	if (!definitions?.length) return [];

	const mapped: Array<DefinitionItem | null> = definitions.map((definition) => {
		const text =
			language === "es"
				? (definition.text_es ?? definition.text)
				: (definition.text_en ?? definition.text);

		if (!text) return null;

		return {
			text,
			source: definition.source ?? "strong",
			language,
		};
	});

	return mapped.filter((item): item is DefinitionItem => Boolean(item));
};

const mergeUniqueDefinitions = (
	...groups: DefinitionItem[][]
): DefinitionItem[] => {
	const seen = new Set<string>();
	const merged: DefinitionItem[] = [];

	for (const group of groups) {
		for (const definition of group) {
			const key = `${definition.source}:${definition.text.toLowerCase()}`;
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(definition);
		}
	}

	return merged;
};

const getRootEntry = (
	rootStrong: string | undefined,
	words: Record<string, RawWordEntry>,
	roots: Record<string, RawWordEntry>,
	custom: Record<string, RawCustomEntry>,
): RawWordEntry | RawCustomEntry | null => {
	const normalizedRoot = normalizeStrong(rootStrong);
	if (!normalizedRoot) return null;

	return (
		roots[normalizedRoot] ??
		words[normalizedRoot] ??
		custom[normalizedRoot] ??
		null
	);
};

const isRawWordEntry = (
	value: RawWordEntry | RawCustomEntry | null,
): value is RawWordEntry =>
	Boolean(value && ("lemma" in value || "root_ref" in value));

const isRawCustomEntry = (
	value: RawWordEntry | RawCustomEntry | null,
): value is RawCustomEntry =>
	Boolean(value && ("root" in value || "compound_key" in value));

const toWordAnalysis = (
	strong: string,
	language: "en" | "es",
	words: Record<string, RawWordEntry>,
	roots: Record<string, RawWordEntry>,
	custom: Record<string, RawCustomEntry>,
): WordAnalysis | null => {
	const wordEntry = words[strong];
	const rootsEntry = roots[strong];
	const customEntry = custom[strong];
	const dictionaryEntry = wordEntry ?? rootsEntry;

	if (!dictionaryEntry && !customEntry) {
		return null;
	}

	const strongNumber =
		customEntry?.strong_number ?? dictionaryEntry?.strong_number ?? strong;
	const hebrew =
		customEntry?.hebrew ?? dictionaryEntry?.lemma ?? dictionaryEntry?.hebrew;
	const translit_en =
		customEntry?.transliteration_en ??
		dictionaryEntry?.translit_en ??
		dictionaryEntry?.transliteration_en;
	const translit_es =
		customEntry?.transliteration_es ??
		dictionaryEntry?.translit_es ??
		dictionaryEntry?.transliteration_es;

	const definitions = mergeUniqueDefinitions(
		mapDefinitions(customEntry?.definitions, language),
		mapDefinitions(dictionaryEntry?.definitions, language),
	);

	const rootStrong =
		customEntry?.root_strong ??
		dictionaryEntry?.root_ref ??
		dictionaryEntry?.root_strong ??
		(dictionaryEntry ? strongNumber : undefined);
	const rootEntry = getRootEntry(rootStrong, words, roots, custom);

	const rootDefinitions = mergeUniqueDefinitions(
		mapDefinitions(rootEntry?.definitions, language),
	);

	const surface = instanceSurface(customEntry, dictionaryEntry?.occurrences);
	const instances = surface.instances;
	const occurrencesCount = surface.total;

	return {
		strong_number: strongNumber,
		hebrew,
		translit_en,
		translit_es,
		definitions,
		root:
			customEntry?.root ??
			(isRawWordEntry(rootEntry) ? rootEntry.lemma : undefined) ??
			(isRawCustomEntry(rootEntry) ? rootEntry.hebrew : undefined),
		root_strong: rootStrong,
		root_definitions: rootDefinitions.length > 0 ? rootDefinitions : undefined,
		root_translit_en: isRawWordEntry(rootEntry)
			? rootEntry.translit_en
			: rootEntry?.transliteration_en,
		root_translit_es: isRawWordEntry(rootEntry)
			? rootEntry.translit_es
			: rootEntry?.transliteration_es,
		occurrences_count: occurrencesCount,
		instances: instances.length > 0 ? instances : undefined,
		instance_policy_version: customEntry?.instance_policy_version,
		instance_total: customEntry?.instance_total,
		instance_surface_count: customEntry?.instance_surface_count,
		instance_tier: customEntry?.instance_tier,
		instance_omitted_count: customEntry?.instance_omitted_count,
	};
};

export const loadLexiconEntry = async (
	strong?: string,
	language?: "en" | "es",
): Promise<WordAnalysis | null> => {
	const normalizedStrong = normalizeStrong(strong);
	if (!normalizedStrong) return null;

	const selectedLanguage = language ?? "en";
	const [words, roots, custom] = await Promise.all([
		loadWords(),
		loadRoots(),
		loadCustomDefinitions(),
	]);

	return toWordAnalysis(
		normalizedStrong,
		selectedLanguage,
		words,
		roots,
		custom,
	);
};

export const searchLexicon = async (
	query: string,
	options?: { limit?: number; offset?: number },
): Promise<WordAnalysis[]> => {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];

	const [words, roots, custom] = await Promise.all([
		loadWords(),
		loadRoots(),
		loadCustomDefinitions(),
	]);

	const strongKeys = new Set<string>([
		...Object.keys(words),
		...Object.keys(custom),
	]);

	const matches: WordAnalysis[] = [];

	for (const strong of strongKeys) {
		const word = words[strong];
		const customEntry = custom[strong];

		const haystack = [
			strong,
			word?.lemma,
			word?.translit_en,
			word?.translit_es,
			customEntry?.hebrew,
			customEntry?.transliteration_en,
			customEntry?.transliteration_es,
			...(word?.definitions?.flatMap((definition) => [
				definition.text_en,
				definition.text_es,
			]) ?? []),
			...(customEntry?.definitions?.flatMap((definition) => [
				definition.text_en,
				definition.text_es,
				definition.text,
			]) ?? []),
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();

		if (!haystack.includes(needle)) continue;

		const analysis = toWordAnalysis(strong, "en", words, roots, custom);
		if (analysis) {
			matches.push(analysis);
		}
	}

	const offset = options?.offset ?? 0;
	const limit = options?.limit ?? 20;
	return matches.slice(offset, offset + limit);
};

// ── Prefix Service ───────────────────────────────────────────────────────

let prefixesPromise: Promise<Record<string, unknown>> | null = null;

const loadPrefixes = async (): Promise<Record<string, unknown>> => {
	if (!prefixesPromise) {
		prefixesPromise = fetchJson<Record<string, unknown>>("/data/prefixes.json");
	}
	return prefixesPromise;
};

export const loadPrefix = async (prefixId: string): Promise<unknown> => {
	const prefixes = await loadPrefixes();
	return prefixes[prefixId] ?? null;
};
