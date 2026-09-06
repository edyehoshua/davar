import { staticDataRequest, ts2009Request } from "@/src/services/api";
import type { TranslationFootnote, WordResponse } from "@/src/types/api";
import {
  fetchHebrewVerses,
  fetchTranslationVerses,
  fetchDssVariants,
  type HebrewVerseRow,
  type TranslationRow,
  type DssVariantRow,
} from "@/src/services/database";
import { removeMaqafForDisplay } from "@/src/utils/hebrew";
import {
  type BesorahTextVersion,
  getMissingSpanishTranslationNotice,
  getPsalmsSuperscriptionNotice,
  resolveTranslationSource,
  resolveTranslationLookupKey,
  resolveTranslationTarget,
  TTH_BOOK_MAPPING,
} from "@davar/shared/translationConfig";
import { getSourceChaptersForTranslationChapter } from "@davar/shared/versification";

// Chapter-level cache for TS2009 static JSON (matches web approach)
const ts2009ChapterCache = new Map<string, Promise<Map<number, string> | null>>();

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

type Ts2009BookVerse = {
  number?: number;
  verse?: number;
  text?: unknown;
  translation?: unknown;
};

type Ts2009BookChapter = {
  number?: number;
  chapter?: number;
  verses?: Ts2009BookVerse[];
};

type Ts2009BookPayload = {
  chapters?: Ts2009BookChapter[] | Record<string, Ts2009BookChapter | Ts2009BookVerse[]>;
};

const parseTs2009VerseText = (verse: Ts2009BookVerse): string | null => {
  if (typeof verse.text === "string") return verse.text;
  if (typeof verse.translation === "string") return verse.translation;
  return null;
};

const extractTs2009ChapterFromBook = (
  payload: Ts2009BookPayload,
  chapter: number,
): Ts2009BookVerse[] | null => {
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

const fetchTs2009ChapterFromBookFile = async (
  bookId: string,
  chapter: number,
): Promise<Map<number, string> | null> => {
  for (const fileStem of getTs2009BookFileCandidates(bookId)) {
    try {
      let staticBook: Ts2009BookPayload;
      try {
        staticBook = await ts2009Request<Ts2009BookPayload>(
          `${fileStem}.json`,
        );
      } catch {
        staticBook = await staticDataRequest<Ts2009BookPayload>(
          `ts2009/${fileStem}.json`,
        );
      }

      const chapterVerses = extractTs2009ChapterFromBook(staticBook, chapter);
      if (!chapterVerses || chapterVerses.length === 0) {
        continue;
      }

      const verseMap = new Map<number, string>();
      for (const [index, verse] of chapterVerses.entries()) {
        const verseNumber = Number(verse.number ?? verse.verse ?? index + 1);
        const verseText = parseTs2009VerseText(verse);

        if (!Number.isFinite(verseNumber) || !verseText) {
          continue;
        }

        verseMap.set(verseNumber, verseText);
      }

      if (verseMap.size > 0) {
        return verseMap;
      }
    } catch {
      // Keep probing candidate names.
    }
  }

  return null;
};

const fetchTs2009ChapterStatic = (
  bookId: string,
  chapter: number,
): Promise<Map<number, string> | null> => {
  const cacheKey = `${bookId}:${chapter}`;

  const cached = ts2009ChapterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = (async (): Promise<Map<number, string> | null> => {
    let chapterMap: Map<number, string> | null = null;

    try {
      const staticChapter = await staticDataRequest<{
        verses?: Record<string, string>;
      }>(`ts2009/${bookId}/${chapter}.json`);

      const verses = staticChapter.verses ?? {};
      const verseMap = new Map<number, string>();
      for (const [verseKey, translation] of Object.entries(verses)) {
        const verseNumber = Number(verseKey);
        if (Number.isFinite(verseNumber) && typeof translation === "string") {
          verseMap.set(verseNumber, translation);
        }
      }

      chapterMap = verseMap.size > 0 ? verseMap : null;
    } catch {
      // Fall back to TS2009 book files below.
    }

    if (chapterMap) {
      return chapterMap;
    }

    return fetchTs2009ChapterFromBookFile(bookId, chapter);
  })();

  ts2009ChapterCache.set(cacheKey, promise);
  return promise;
};

export type DisplayWord = {
  position: number;
  text: string;
  strong?: string;
  prefixes?: string[];
  hasQumranVariant?: boolean;
  /** Number of Masoretic tokens this DSS variant replaces (>=1). */
  qumranSpan?: number;
  morph?: string;
  translit_en?: string;
  translit_es?: string;
  dss_translit_en?: string;
  dss_translit_es?: string;
  dssWord?: string;
  dssStrong?: string;
  dssCommentaryEn?: string;
  dssCommentaryEs?: string;
  dssCommentaryHe?: string;
};

export type DisplayVerse = {
  id: string;
  book: string;
  bookId: string;
  chapter: number;
  verse: number;
  sourceChapter: number;
  sourceVerse: number;
  hebrew: string;
  translation: string;
  words: DisplayWord[];
  qumranVariants?: { position: number; dssWord: string }[];
  translation_footnotes?: TranslationFootnote[];
};

type ReferenceMode = "source" | "translation";

const formatBookName = (bookId: string) =>
  bookId.charAt(0).toUpperCase() + bookId.slice(1);

const normalizeBookToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const TTH_BOOK_KEY_BY_NORMALIZED_TOKEN: Record<string, string> =
  Object.fromEntries(
    Object.keys(TTH_BOOK_MAPPING).map((bookKey) => [
      normalizeBookToken(bookKey),
      bookKey,
    ]),
  );

const resolveTthBookId = (bookId: string): string | undefined => {
  const canonicalKey = TTH_BOOK_KEY_BY_NORMALIZED_TOKEN[normalizeBookToken(bookId)];

  if (!canonicalKey) {
    return undefined;
  }

  return TTH_BOOK_MAPPING[canonicalKey];
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
  language?: "en" | "es";
  mappedTranslationKey: string | null;
  translationTitle?: string;
  translationText?: string;
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

type StaticChapterWord = {
  text?: string;
  strong?: string;
  morph?: string;
  prefixes?: string[];
  translit_en?: string;
  translit_es?: string;
};

type StaticChapterVerse = {
  chapter: number;
  verse: number;
  hebrew?: string;
  words?: StaticChapterWord[];
};

type StaticTranslationVerse = {
  verse: number;
  bes?: string;
  tth?: string;
  text?: string;
  footnotes?: unknown[];
};

type StaticTranslationChapter = {
  chapter: number;
  verses?: StaticTranslationVerse[];
  title?: string;
};

type StaticTranslationBook = {
  chapters?: StaticTranslationChapter[];
};

type StaticDssDifference = {
  position: number;
  dss_word?: string;
  translit_en?: string;
  translit_es?: string;
  masoretic_word?: string;
  dss_strong?: string;
  comment_v2_en?: string;
  comment_v2_es?: string;
  comment_v2_he?: string;
};

type StaticDssTranslitVariant = {
  chapter?: number;
  verse?: number;
  position?: number;
  translit_en?: string;
  translit_es?: string;
};

type StaticDssTranslitBook = {
  variants?: StaticDssTranslitVariant[];
};

type StaticDssVerse = {
  differences?: StaticDssDifference[];
};

type StaticDssChapter = {
  verses?: Record<string, StaticDssVerse>;
};

type StaticDssBook = {
  chapters?: Record<string, StaticDssChapter>;
};

type StaticTranslitWord = {
  text?: string;
  strong?: string;
  translit_en?: string;
  translit_es?: string;
};

type StaticTranslitBook = {
  verses?: {
    chapter: number;
    verse: number;
    words?: StaticTranslitWord[];
  }[];
};

type TranslationEntry = {
  text: string;
  footnotes?: TranslationFootnote[];
};

type LoadedStaticTranslations = {
  verses: Map<string, TranslationEntry>;
  titles: Map<number, string>;
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

const countDssWordTokens = (value?: string): number => {
  if (!value) return 0;

  return value
    .trim()
    .replace(/[/:]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
};

/**
 * Multi-word DSS variants are renderable: they replace the N Masoretic
 * tokens counted from their masoretic_word (span-aware replacement).
 * Only empty/"note" placeholders stay hidden (#103).
 */
const isRenderableDssWord = (value?: string): value is string => {
  if (!value) return false;

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "note") {
    return false;
  }

  return countDssWordTokens(trimmed) > 0;
};

/** Number of Masoretic tokens a DSS variant replaces (its span). */
const getDssMasoreticSpan = (
  masoreticWord?: string,
  fallback = 1,
): number => {
  const span = countDssWordTokens(masoreticWord);
  return span > 0 ? span : fallback;
};

const getTranslationLookupKey = (
  bookId: string,
  chapter: number,
  verse: number,
  language?: "en" | "es",
): string | null => {
  return resolveTranslationLookupKey(bookId, chapter, verse, { language });
};

const getRequiredTranslationChapters = (
  bookId: string,
  sourceVerses: { chapter: number; verse: number }[],
  language?: "en" | "es",
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
  language: "en" | "es" | undefined,
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

const toDssBookKey = (bookId: string): string => {
  const dssMap: Record<string, string> = {
    samuel1: "1samuel",
    samuel2: "2samuel",
    songofsolomon: "songs",
    hosea: "hoseah",
  };

  return dssMap[bookId] ?? bookId;
};

const parseTranslationFootnotes = (
  rawFootnotes: unknown,
): TranslationFootnote[] | undefined => {
  if (!Array.isArray(rawFootnotes) || rawFootnotes.length === 0) {
    return undefined;
  }

  const parsed = rawFootnotes
    .map((footnote): TranslationFootnote | null => {
      if (typeof footnote === "string") {
        const match = /^\[([a-z0-9]+)\]\s*(.*)$/i.exec(footnote);
        if (!match) {
          return {
            marker: "",
            number: "",
            word: "",
            explanation: footnote,
          };
        }

        return {
          marker: match[1],
          number: "",
          word: "",
          explanation: match[2],
        };
      }

      if (footnote && typeof footnote === "object") {
        const typed = footnote as Record<string, unknown>;
        return {
          marker: String(typed.marker ?? ""),
          number: String(typed.number ?? ""),
          word: String(typed.word ?? ""),
          explanation: String(typed.explanation ?? ""),
        };
      }

      return null;
    })
    .filter((footnote): footnote is TranslationFootnote => Boolean(footnote));

  return parsed.length > 0 ? parsed : undefined;
};

const loadStaticTranslationsForChapter = async (
  bookId: string,
  sourceVerses: StaticChapterVerse[],
  language?: "en" | "es",
  hebrewOnly?: boolean,
): Promise<LoadedStaticTranslations> => {
  const translationMap = new Map<string, TranslationEntry>();
  const translationTitleMap = new Map<number, string>();
  const hasTranslationText = (entry?: TranslationEntry): boolean =>
    Boolean(entry?.text.trim());
  const requiredTranslationChapters = getRequiredTranslationChapters(
    bookId,
    sourceVerses.map((verse) => ({ chapter: verse.chapter, verse: verse.verse })),
    language,
  );

  if (!language || hebrewOnly) {
    return {
      verses: translationMap,
      titles: translationTitleMap,
    };
  }

  if (language === "es") {
    // Try TTH_2 first (official Spanish translation)
    const tthBookId = resolveTthBookId(bookId);
    if (tthBookId) {
      try {
        const translationBook = await staticDataRequest<StaticTranslationBook>(
          `tth/${tthBookId}.json`,
        );

        for (const translationChapter of requiredTranslationChapters) {
          const chapterData = (translationBook.chapters ?? []).find(
            (item) => item.chapter === translationChapter,
          );

          if (!chapterData?.verses) {
            continue;
          }

          if (typeof chapterData.title === "string" && chapterData.title.trim()) {
            translationTitleMap.set(translationChapter, chapterData.title.trim());
          }

          for (const verse of chapterData.verses) {
            const text = verse.tth ?? "";
            translationMap.set(`${translationChapter}-${verse.verse}`, {
              text,
              footnotes: parseTranslationFootnotes(verse.footnotes),
            });
          }
        }
      } catch {
        // TTH_2 not available for this book, try BES fallback below
      }
    }

    // Fill genuinely missing TTH verses from BES.
    try {
      const translationBook = await staticDataRequest<StaticTranslationBook>(
        `bes/${bookId}.json`,
      );

      for (const translationChapter of requiredTranslationChapters) {
        const chapterData = (translationBook.chapters ?? []).find(
          (item) => item.chapter === translationChapter,
        );

        if (!chapterData?.verses) {
          continue;
        }

        if (
          !translationTitleMap.has(translationChapter) &&
          typeof chapterData.title === "string" &&
          chapterData.title.trim()
        ) {
          translationTitleMap.set(translationChapter, chapterData.title.trim());
        }

        for (const verse of chapterData.verses) {
          const key = `${translationChapter}-${verse.verse}`;
          if (!hasTranslationText(translationMap.get(key))) {
            const text = verse.bes ?? "";
            translationMap.set(key, {
              text,
              footnotes: parseTranslationFootnotes(verse.footnotes),
            });
          }
        }
      }
    } catch {
      // Translation is optional; return SQLite fallback below when available.
    }
  } else if (language === "en") {
    // Load TS2009 from static chapter JSON (same source as web)
    try {
      const chapterMaps = await Promise.all(
        requiredTranslationChapters.map(async (translationChapter) => ({
          translationChapter,
          chapterMap: await fetchTs2009ChapterStatic(bookId, translationChapter),
        })),
      );

      for (const { translationChapter, chapterMap } of chapterMaps) {
        if (!chapterMap) {
          continue;
        }

        for (const [verseNumber, translation] of chapterMap) {
          translationMap.set(`${translationChapter}-${verseNumber}`, {
            text: translation,
            footnotes: undefined,
          });
        }
      }
    } catch (error) {
      console.warn(
        `Failed to load TS2009 translations for ${bookId} chapters ${requiredTranslationChapters.join(",")}:`,
        error,
      );
      // Fall back to SQLite below
    }
  }

  if (translationMap.size === 0) {
    try {
      const rowsByChapter = await Promise.all(
        requiredTranslationChapters.map((translationChapter) =>
          fetchTranslationVerses(bookId, translationChapter, language),
        ),
      );

      for (const offlineRows of rowsByChapter) {
        for (const row of offlineRows) {
          translationMap.set(`${row.chapter}-${row.verse}`, {
            text: row.text ?? "",
            footnotes: parseTranslationFootnotes(row.footnotes),
          });
        }
      }
    } catch {
      // Leave translation map empty when offline translation isn't available.
    }
  }

  return {
    verses: translationMap,
    titles: translationTitleMap,
  };
};

const loadStaticDssForChapter = async (
  bookId: string,
  chapter: number,
  showDss?: boolean,
): Promise<Map<string, StaticDssDifference[]>> => {
  const dssMap = new Map<string, StaticDssDifference[]>();

  if (!showDss) {
    return dssMap;
  }

  try {
    const dssBook = await staticDataRequest<StaticDssBook>(
      `dss/${toDssBookKey(bookId)}.json`,
    );
    const chapterData = dssBook.chapters?.[String(chapter)];
    const verseEntries = chapterData?.verses ?? {};

    for (const [verseKey, verseData] of Object.entries(verseEntries)) {
      const verseNumber = Number(verseKey);
      if (!Number.isFinite(verseNumber)) {
        continue;
      }

      const differences = (verseData.differences ?? []).filter(
        (difference) => difference.position > 0,
      );

      if (differences.length > 0) {
        dssMap.set(`${chapter}:${verseNumber}`, differences);
      }
    }
  } catch {
    // DSS variants are optional; return no variants when unavailable.
  }

  return dssMap;
};

const loadStaticTranslitForChapter = async (
  bookId: string,
  chapter: number,
): Promise<Map<string, StaticTranslitWord[]>> => {
  try {
    const translitBook = await staticDataRequest<StaticTranslitBook>(
      `translit/${bookId}.json`,
    );

    const translitMap = new Map<string, StaticTranslitWord[]>();
    for (const verseEntry of translitBook.verses ?? []) {
      if (verseEntry.chapter !== chapter) {
        continue;
      }
      translitMap.set(`${chapter}:${verseEntry.verse}`, verseEntry.words ?? []);
    }

    return translitMap;
  } catch {
    return new Map<string, StaticTranslitWord[]>();
  }
};

const loadStaticDssTranslitForChapter = async (
  bookId: string,
  chapter: number,
  showDss?: boolean,
): Promise<Map<string, StaticDssTranslitVariant>> => {
  const dssTranslitMap = new Map<string, StaticDssTranslitVariant>();

  if (!showDss) {
    return dssTranslitMap;
  }

  try {
    const translitBook = await staticDataRequest<StaticDssTranslitBook>(
      `translit/dss/${toDssBookKey(bookId)}.json`,
    );

    for (const variant of translitBook.variants ?? []) {
      if (variant.chapter !== chapter) {
        continue;
      }

      const verse = Number(variant.verse);
      const position = Number(variant.position);
      if (!Number.isFinite(verse) || !Number.isFinite(position) || position <= 0) {
        continue;
      }

      dssTranslitMap.set(`${chapter}:${verse}:${position}`, variant);
    }
  } catch {
    // DSS transliteration data is optional; fall back to standard transliteration.
  }

  return dssTranslitMap;
};

const findFallbackTranslitWord = (
  word: StaticChapterWord,
  translitWords: StaticTranslitWord[],
): StaticTranslitWord | undefined => {
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
      normalizedText && candidateText ? normalizedText === candidateText : false;

    if (baseStrong && !strongMatches) return false;
    if (normalizedText && !textMatches) return false;

    return strongMatches || textMatches;
  });
};

const mapStaticVersesToDisplay = (
  bookId: string,
  verses: StaticChapterVerse[],
  translationMap: Map<string, TranslationEntry>,
  translationTitleMap: Map<number, string>,
  dssMap: Map<string, StaticDssDifference[]>,
  translitMap: Map<string, StaticTranslitWord[]>,
  dssTranslitMap: Map<string, StaticDssTranslitVariant>,
  language?: "en" | "es",
  showDss?: boolean,
  referenceMode: ReferenceMode = "source",
  requestedChapter?: number,
): DisplayVerse[] => {
  const mappedVerses = verses.map((verse) => {
    const dssKey = `${verse.chapter}:${verse.verse}`;
    const dssVariants = showDss ? (dssMap.get(dssKey) ?? []) : [];
    const dssVariantMap = new Map(
      dssVariants.map((variant) => [variant.position, variant]),
    );

    const sourceWords = Array.isArray(verse.words) ? verse.words : [];
    const translitWords = translitMap.get(dssKey) ?? [];
    const canMapTranslitByPosition = translitWords.length === sourceWords.length;
    const words: DisplayWord[] = sourceWords.map((word, index) => {
      const position = index + 1;
      const dssVariant = dssVariantMap.get(position);
      const hasRenderableQumranVariant = Boolean(
        dssVariant && isRenderableDssWord(dssVariant.dss_word),
      );
      const translitWord = canMapTranslitByPosition
        ? translitWords[index]
        : findFallbackTranslitWord(word, translitWords);
      const dssTranslit = dssTranslitMap.get(`${verse.chapter}:${verse.verse}:${position}`);
      const prefersDssTranslit = Boolean(showDss && hasRenderableQumranVariant);
      const dssTranslitEn = dssTranslit?.translit_en ?? dssVariant?.translit_en;
      const dssTranslitEs = dssTranslit?.translit_es ?? dssVariant?.translit_es;

      return {
        position,
        text: word.text ?? "",
        strong: word.strong,
        prefixes: word.prefixes ?? [],
        hasQumranVariant: hasRenderableQumranVariant,
        qumranSpan: hasRenderableQumranVariant
          ? getDssMasoreticSpan(dssVariant?.masoretic_word)
          : undefined,
        morph: word.morph,
        translit_en: prefersDssTranslit
          ? dssTranslitEn ?? word.translit_en ?? translitWord?.translit_en
          : word.translit_en ?? translitWord?.translit_en,
        translit_es: prefersDssTranslit
          ? dssTranslitEs ?? word.translit_es ?? translitWord?.translit_es
          : word.translit_es ?? translitWord?.translit_es,
        dss_translit_en: dssTranslitEn,
        dss_translit_es: dssTranslitEs,
        dssWord: hasRenderableQumranVariant ? dssVariant?.dss_word : undefined,
        dssStrong: dssVariant?.dss_strong,
        dssCommentaryEn: dssVariant?.comment_v2_en,
        dssCommentaryEs: dssVariant?.comment_v2_es,
        dssCommentaryHe: dssVariant?.comment_v2_he,
      };
    });

    const hebrewText =
      verse.hebrew ??
      sourceWords
        .map((word) => word.text ?? "")
        .filter(Boolean)
        .join(" ");

    const translationTarget = resolveTranslationTarget(
      bookId,
      verse.chapter,
      verse.verse,
      { language },
    );

    const translationKey = translationTarget.reference
      ? `${translationTarget.reference.chapter}-${translationTarget.reference.verse}`
      : null;
    const translationEntry = translationKey
      ? translationMap.get(translationKey)
      : undefined;
    const translationText = resolveTranslationText({
      bookId,
      language,
      mappedTranslationKey: translationKey,
      translationTitle: translationTarget.usesPsalmTitle
        ? translationTitleMap.get(verse.chapter)
        : undefined,
      translationText: translationEntry?.text,
    });

    const outputChapter =
      referenceMode === "translation"
        ? (translationTarget.reference?.chapter ?? 0)
        : verse.chapter;
    const outputVerse =
      referenceMode === "translation"
        ? (translationTarget.reference?.verse ?? 0)
        : verse.verse;

    return {
      id: `${bookId}-${outputChapter}-${outputVerse}`,
      book: formatBookName(bookId),
      bookId,
      chapter: outputChapter,
      verse: outputVerse,
      sourceChapter: verse.chapter,
      sourceVerse: verse.verse,
      hebrew: removeMaqafForDisplay(hebrewText),
      translation: translationText,
      words,
      qumranVariants:
        dssVariants.length > 0
          ? dssVariants
              .filter((variant) => isRenderableDssWord(variant.dss_word))
              .map((variant) => ({
                position: Math.max(variant.position, 0),
                dssWord: variant.dss_word ?? "",
              }))
          : undefined,
      translation_footnotes: translationEntry?.footnotes,
    };
  });

  if (referenceMode === "translation" && language && Number.isFinite(requestedChapter)) {
    return mappedVerses
      .filter((verse) => verse.chapter === requestedChapter)
      .sort((a, b) => a.verse - b.verse || a.sourceChapter - b.sourceChapter || a.sourceVerse - b.sourceVerse);
  }

  return mappedVerses.sort((a, b) => a.sourceChapter - b.sourceChapter || a.sourceVerse - b.sourceVerse);
};

const loadStaticSourceChapterVerses = async (
  bookId: string,
  chapter: number,
  besorahTextVersion: BesorahTextVersion = "delitzsch",
): Promise<StaticChapterVerse[]> => {
  const besorahSource =
    besorahTextVersion === "hutter" ? "hutter" : "besorah";
  const chapterSources = [
    `oe/${bookId}/${chapter}.json`,
    `${besorahSource}/${bookId}/${chapter}.json`,
  ];
  const sourceErrors: string[] = [];

  for (const source of chapterSources) {
    try {
      const verses = await staticDataRequest<StaticChapterVerse[]>(source);
      if (Array.isArray(verses) && verses.length > 0) {
        return verses;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      sourceErrors.push(`${source}: ${reason}`);
    }
  }

  const details =
    sourceErrors.length > 0 ? sourceErrors.join(" | ") : chapterSources.join(", ");
  throw new Error(
    `No static verse data found for ${bookId} chapter ${chapter}. Sources tried: ${details}`,
  );
};

const fetchChapterVersesStatic = async (
  bookId: string,
  chapter: number,
  options?: {
    language?: "en" | "es";
    showDss?: boolean;
    hebrewOnly?: boolean;
    referenceMode?: ReferenceMode;
    besorahTextVersion?: BesorahTextVersion;
  },
): Promise<DisplayVerse[]> => {
  const referenceMode = options?.referenceMode ?? "source";
  const sourceChapters = getSourceChaptersForRequest(
    bookId,
    chapter,
    options?.language,
    referenceMode,
  );

  const sourceVerseChunks = await Promise.all(
    sourceChapters.map((sourceChapter) =>
      loadStaticSourceChapterVerses(
        bookId,
        sourceChapter,
        options?.besorahTextVersion ?? "delitzsch",
      ),
    ),
  );
  const sourceVerses = sourceVerseChunks.flat();

  const [translations, dssMap, translitMap, dssTranslitMap] = await Promise.all([
    loadStaticTranslationsForChapter(
      bookId,
      sourceVerses,
      options?.language,
      options?.hebrewOnly,
    ),
    Promise.all(
      sourceChapters.map((sourceChapter) =>
        loadStaticDssForChapter(bookId, sourceChapter, options?.showDss),
      ),
    ).then((maps) => {
      const merged = new Map<string, StaticDssDifference[]>();
      for (const map of maps) {
        for (const [key, value] of map.entries()) {
          merged.set(key, value);
        }
      }
      return merged;
    }),
    Promise.all(
      sourceChapters.map((sourceChapter) => loadStaticTranslitForChapter(bookId, sourceChapter)),
    ).then((maps) => {
      const merged = new Map<string, StaticTranslitWord[]>();
      for (const map of maps) {
        for (const [key, value] of map.entries()) {
          merged.set(key, value);
        }
      }
      return merged;
    }),
    Promise.all(
      sourceChapters.map((sourceChapter) =>
        loadStaticDssTranslitForChapter(bookId, sourceChapter, options?.showDss),
      ),
    ).then((maps) => {
      const merged = new Map<string, StaticDssTranslitVariant>();
      for (const map of maps) {
        for (const [key, value] of map.entries()) {
          merged.set(key, value);
        }
      }
      return merged;
    }),
  ]);

  const { verses: translationMap, titles: translationTitleMap } = translations;

  return mapStaticVersesToDisplay(
    bookId,
    sourceVerses,
    translationMap,
    translationTitleMap,
    dssMap,
    translitMap,
    dssTranslitMap,
    options?.language,
    options?.showDss,
    referenceMode,
    chapter,
  );
};

// ── Offline mapping: SQLite rows → DisplayVerse[] ──────────────────────────

const mapOfflineDataToDisplay = (
  bookId: string,
  hebrewRows: HebrewVerseRow[],
  translationRows: TranslationRow[],
  dssRows: DssVariantRow[],
  language?: "en" | "es",
  referenceMode: ReferenceMode = "source",
  requestedChapter?: number,
): DisplayVerse[] => {
  // Index translations by verse number
  const translationMap = new Map<string, TranslationRow>();
  for (const tr of translationRows) {
    translationMap.set(`${tr.chapter}-${tr.verse}`, tr);
  }

  // Group DSS variants by chapter-verse
  const dssMap = new Map<string, DssVariantRow[]>();
  for (const dss of dssRows) {
    const key = `${dss.chapter}-${dss.verse}`;
    const existing = dssMap.get(key) ?? [];
    existing.push(dss);
    dssMap.set(key, existing);
  }

  const mappedVerses = hebrewRows.map((hv) => {
    const verseKey = `${hv.chapter}-${hv.verse}`;
    const translationTarget = resolveTranslationTarget(
      bookId,
      hv.chapter,
      hv.verse,
      { language },
    );
    const mappedTranslationKey = translationTarget.reference
      ? `${translationTarget.reference.chapter}-${translationTarget.reference.verse}`
      : null;
    const translation = mappedTranslationKey
      ? translationMap.get(mappedTranslationKey)
      : undefined;
    const translationText = resolveTranslationText({
      bookId,
      language,
      mappedTranslationKey,
      translationTitle: undefined,
      translationText: translation?.text,
    });
    const dssVariants = dssMap.get(verseKey) ?? [];

    // Build DSS variant lookup by position
    const dssPositionMap = new Map<number, DssVariantRow>();
    for (const dss of dssVariants) {
      dssPositionMap.set(dss.position, dss);
    }

    const wordObjects = Array.isArray(hv.words) ? hv.words : [];
    const words: DisplayWord[] = wordObjects
      .filter((word) => word && typeof word === "object")
      .map((word, index) => {
        const typedWord = word as WordResponse;
        const position = typedWord.position ?? index + 1;
        const dssVariant = dssPositionMap.get(position);
        const dssData = dssVariant?.data as
          | Record<string, string | undefined>
          | undefined;
        const hasRenderableQumranVariant = Boolean(
          dssData && isRenderableDssWord(dssData.dss_word),
        );
        const dssTranslitEn = dssData?.translit_en ?? dssData?.dss_translit_en;
        const dssTranslitEs = dssData?.translit_es ?? dssData?.dss_translit_es;
        const prefersDssTranslit = hasRenderableQumranVariant;

        return {
          position,
          text: typedWord.text ?? "",
          strong: typedWord.strong,
          prefixes: typedWord.prefixes ?? [],
          hasQumranVariant: hasRenderableQumranVariant,
          qumranSpan: hasRenderableQumranVariant
            ? getDssMasoreticSpan(
                (dssVariant?.data as Record<string, string | undefined> | undefined)?.masoretic_word,
              )
            : undefined,
          morph: typedWord.morph,
          translit_en: prefersDssTranslit
            ? dssTranslitEn ?? typedWord.translit_en
            : typedWord.translit_en,
          translit_es: prefersDssTranslit
            ? dssTranslitEs ?? typedWord.translit_es
            : typedWord.translit_es,
          dss_translit_en: dssTranslitEn,
          dss_translit_es: dssTranslitEs,
          dssWord: hasRenderableQumranVariant ? dssData?.dss_word : undefined,
          dssStrong: dssData?.dss_strong,
          dssCommentaryEn: dssData?.comment_v2_en,
          dssCommentaryEs: dssData?.comment_v2_es,
          dssCommentaryHe: dssData?.comment_v2_he,
        };
      });

    const qumranVariants = dssVariants
      .filter((dss) =>
        isRenderableDssWord((dss.data as Record<string, string>)?.dss_word),
      )
      .map((dss) => ({
        position: Math.max(dss.position, 0),
        dssWord: (dss.data as Record<string, string>)?.dss_word ?? "",
      }));

    // Reconstruct hebrew text from words if not stored directly
    const hebrew = words
      .map((word) => removeMaqafForDisplay(word.text))
      .filter(Boolean)
      .join(" ");

    // Parse footnotes from translation row
    let translationFootnotes: TranslationFootnote[] | undefined;
    if (translation?.footnotes && Array.isArray(translation.footnotes)) {
      translationFootnotes = translation.footnotes as TranslationFootnote[];
    }

    const outputChapter =
      referenceMode === "translation"
        ? (translationTarget.reference?.chapter ?? 0)
        : hv.chapter;
    const outputVerse =
      referenceMode === "translation"
        ? (translationTarget.reference?.verse ?? 0)
        : hv.verse;

    return {
      id: `${bookId}-${outputChapter}-${outputVerse}`,
      book: formatBookName(bookId),
      bookId,
      chapter: outputChapter,
      verse: outputVerse,
      sourceChapter: hv.chapter,
      sourceVerse: hv.verse,
      hebrew,
      translation: translationText,
      words,
      qumranVariants: qumranVariants.length > 0 ? qumranVariants : undefined,
      translation_footnotes: translationFootnotes,
    };
  });

  if (referenceMode === "translation" && language && Number.isFinite(requestedChapter)) {
    return mappedVerses
      .filter((verse) => verse.chapter === requestedChapter)
      .sort((a, b) => a.verse - b.verse || a.sourceChapter - b.sourceChapter || a.sourceVerse - b.sourceVerse);
  }

  return mappedVerses.sort((a, b) => a.sourceChapter - b.sourceChapter || a.sourceVerse - b.sourceVerse);
};

// ── Offline fetch from SQLite ──────────────────────────────────────────────

const fetchChapterVersesOffline = async (
  bookId: string,
  chapter: number,
  options?: {
    language?: "en" | "es";
    showDss?: boolean;
    referenceMode?: ReferenceMode;
  },
): Promise<DisplayVerse[]> => {
  const referenceMode = options?.referenceMode ?? "source";
  const sourceChapters = getSourceChaptersForRequest(
    bookId,
    chapter,
    options?.language,
    referenceMode,
  );

  const hebrewRows = (
    await Promise.all(
      sourceChapters.map((sourceChapter) => fetchHebrewVerses(bookId, sourceChapter)),
    )
  ).flat();
  if (hebrewRows.length === 0) {
    throw new Error(`No offline Hebrew data for ${bookId} chapter ${chapter}`);
  }

  const translationLanguage = options?.language;
  const translationRows = translationLanguage
    ? (
        await Promise.all(
          getRequiredTranslationChapters(
            bookId,
            hebrewRows.map((row) => ({ chapter: row.chapter, verse: row.verse })),
            translationLanguage,
          ).map((translationChapter) =>
            fetchTranslationVerses(bookId, translationChapter, translationLanguage),
          ),
        )
      ).flat()
    : [];

  const dssRows = options?.showDss
    ? (
        await Promise.all(
          sourceChapters.map((sourceChapter) => fetchDssVariants(bookId, sourceChapter)),
        )
      ).flat()
    : [];

  return mapOfflineDataToDisplay(
    bookId,
    hebrewRows,
    translationRows,
    dssRows,
    translationLanguage,
    referenceMode,
    chapter,
  );
};

export const fetchChapterVerses = async (
  bookId: string,
  chapter: number,
  options?: {
    language?: "en" | "es";
    showDss?: boolean;
    hebrewOnly?: boolean;
    isConnected?: boolean;
    referenceMode?: ReferenceMode;
    besorahTextVersion?: BesorahTextVersion;
  },
): Promise<DisplayVerse[]> => {
  // If explicitly offline, go straight to SQLite
  if (options?.isConnected === false) {
    return fetchChapterVersesOffline(bookId, chapter, options);
  }

  // Try static data first, fall back to SQLite on failure
  try {
    return await fetchChapterVersesStatic(bookId, chapter, options);
  } catch (staticError) {
    // Static fetch failed — try offline data as fallback
    console.debug(
      `Static fetch failed for ${bookId}/${chapter}, trying offline:`,
      staticError,
    );
    try {
      return await fetchChapterVersesOffline(bookId, chapter, options);
    } catch (offlineError) {
      const staticMessage =
        staticError instanceof Error ? staticError.message : String(staticError);
      const offlineMessage =
        offlineError instanceof Error ? offlineError.message : String(offlineError);
      throw new Error(
        `${staticMessage} | Offline fallback failed: ${offlineMessage}`,
      );
    }
  }
};
