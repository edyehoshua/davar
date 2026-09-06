/// <reference path="../../web/node_modules/@types/node/index.d.ts" />

import { applyTransliterationPolicy } from "./transliteration-policy";
import { createHash } from "crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { extname, join } from "path";
import {
  BUNDLE_VERSIONS,
  CANONICAL_BOOK_ORDER,
  DATA_ROOT,
  DELITZSCH_TO_ENGLISH,
  OE_TO_ENGLISH,
  WEB_PUBLIC_DATA_ROOT,
} from "./config";
import { VERSIFICATION_DATA } from "../../shared/versificationData";

type Ts2009BookPayload = {
  chapters?: unknown;
};

type Ts2009BookVerse = {
  number?: number;
  verse?: number;
  translation?: unknown;
  text?: unknown;
};

type Ts2009ChapterFile = {
  book: string;
  chapter: number;
  verses: Record<string, string>;
};

type Ts2009ExportStats = {
  books: number;
  chapters: number;
  verses: number;
  skippedBooks: string[];
};

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

const TS2009_LEGACY_BOOK_FILE_MAP: Record<string, string> = {
  genesis: "bereshit_genesis",
  exodus: "shemoth_exodus",
  leviticus: "wayyiqra_leviticus",
  numbers: "bemidbar_numbers",
  deuteronomy: "debarim_deuteronomy",
  joshua: "yehoshua_joshua",
  judges: "shophetim_judges",
  ruth: "ruth",
  samuel1: "shemuel_aleph_1_samuel",
  samuel2: "shemuel_bet_2_samuel",
  kings1: "melakim_aleph_1_kings",
  kings2: "melakim_bet_2_kings",
  chronicles1: "dibre_hayamim_aleph_1_chronicles",
  chronicles2: "dibre_hayamim_bet_2_chronicles",
  ezra: "ezra",
  nehemiah: "nehemyah_nehemiah",
  esther: "ester_esther",
  job: "iyob_job",
  psalms: "tehillim_psalms",
  proverbs: "mishle_proverbs",
  ecclesiastes: "qoheleth_ecclesiastes",
  songofsolomon: "shir_hashirim_song_of_songs",
  isaiah: "yeshayahu_isaiah",
  jeremiah: "yirmeyahu_jeremiah",
  lamentations: "ekah_lamentations",
  ezekiel: "yehezqel_ezekiel",
  daniel: "daniel_daniel",
  hosea: "hoshea_hosea",
  joel: "yoel_joel",
  amos: "amos",
  obadiah: "obadyah_obadiah",
  jonah: "yonah_jonah",
  micah: "mikah_micah",
  nahum: "nahum_nahum",
  habakkuk: "habaqqugq_habakkuk",
  zephaniah: "tsephanyah_zephaniah",
  haggai: "haggai_haggai",
  zechariah: "zekaryah_zechariah",
  malachi: "malaki_malachi",
};

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

type BookMetadata = {
  id: string;
  name: string;
  section: "torah" | "neviim" | "ketuvim" | "besorah";
  chapters: number;
  order: number;
  hebrew_name: string;
  hebrew_transliteration: string;
  spanish_name: string;
};

type CanonicalBookLabels = {
  hebrew_name: string;
  hebrew_transliteration: string;
  spanish_name: string;
};

const readJson = async <T>(path: string): Promise<T> => {
  const raw = await readFile(path, "utf-8");
  return applyTransliterationPolicy(JSON.parse(raw) as T);
};

const loadCanonicalBookLabels = async (): Promise<Record<string, CanonicalBookLabels>> => {
  const sourcePath = join(DATA_ROOT, "..", "scripts", "bes", "config.py");
  const source = await readFile(sourcePath, "utf-8");

  const mapping: Record<string, CanonicalBookLabels> = {};

  // Parse the mirrored backend BOOK_METADATA entries from scripts/bes/config.py.
  const entryPattern = /"([^"]+)":\s*\{[^}]*"hebrew_name":\s*"([^"]+)",\s*"hebrew_transliteration":\s*"([^"]+)",\s*"spanish_name":\s*"([^"]+)"[^}]*\}/g;

  for (const match of source.matchAll(entryPattern)) {
    const [, bookName, hebrewName, hebrewTransliteration, spanishName] = match;
    mapping[bookName] = {
      hebrew_name: hebrewName,
      hebrew_transliteration: hebrewTransliteration,
      spanish_name: spanishName,
    };
  }

  return mapping;
};

const sha256OfJson = (value: JsonValue): string => {
  const payload = JSON.stringify(value);
  const hash = createHash("sha256").update(payload).digest("hex");
  return `sha256:${hash}`;
};

const listJsonFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name) === ".json")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
};

const asSection = (order: number): BookMetadata["section"] => {
  if (order <= 5) return "torah";
  if (order <= 26) return "neviim";
  if (order <= 39) return "ketuvim";
  return "besorah";
};

const toCanonicalBook = (name: string, source: "oe" | "delitzsch"): string => {
  const lower = name.toLowerCase();
  if (source === "oe") return OE_TO_ENGLISH[lower] ?? name;
  return DELITZSCH_TO_ENGLISH[lower] ?? name;
};

const hasCanonicalBook = (name: string, source: "oe" | "delitzsch"): boolean => {
  const lower = name.toLowerCase();
  if (source === "oe") return Boolean(OE_TO_ENGLISH[lower]);
  return Boolean(DELITZSCH_TO_ENGLISH[lower]);
};

const bookOrderMap = CANONICAL_BOOK_ORDER.reduce<Record<string, number>>(
  (acc, name, index) => {
    acc[name] = index + 1;
    return acc;
  },
  {},
);

const generateHebrewChapters = async (
  sourceDir: string,
  outDir: string,
  source: "oe" | "delitzsch",
): Promise<{ bundle: { books: Record<string, { chapters: Record<string, JsonValue> }> }; counts: Record<string, Record<string, number>> }> => {
  const folderNames = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));

  const booksBundle: Record<string, { chapters: Record<string, JsonValue> }> = {};
  const verseCounts: Record<string, Record<string, number>> = {};

  for (const folderName of folderNames) {
    if (!hasCanonicalBook(folderName, source)) {
      continue;
    }

    const canonical = toCanonicalBook(folderName, source);
    const bookId = canonical.toLowerCase();
    const chapterFiles = await listJsonFiles(join(sourceDir, folderName));

    const chapters: Record<string, JsonValue> = {};
    const chapterVerseCounts: Record<string, number> = {};

    for (const chapterFile of chapterFiles) {
      const chapterNum = chapterFile.replace(/\.json$/i, "");
      const inputPath = join(sourceDir, folderName, chapterFile);
      const data = await readJson<JsonValue>(inputPath);

      // Delitzsch parsed chapters are wrapped in an array with {chapter, verses}.
      const normalized =
        source === "delitzsch" && Array.isArray(data)
          ? (data as Array<{ verses?: JsonValue[] }>)[0]?.verses ?? []
          : data;

      chapters[chapterNum] = normalized;

      const versesLength = Array.isArray(normalized) ? normalized.length : 0;
      chapterVerseCounts[chapterNum] = versesLength;

      await mkdir(join(outDir, bookId), { recursive: true });
      await writeFile(
        join(outDir, bookId, `${chapterNum}.json`),
        JSON.stringify(normalized),
        "utf-8",
      );
    }

    booksBundle[bookId] = { chapters };
    verseCounts[canonical] = chapterVerseCounts;
  }

  return {
    bundle: { books: booksBundle },
    counts: verseCounts,
  };
};

type HutterVerse = {
  number?: number;
  text_nikud?: string;
};

type HutterChapter = {
  number?: number;
  verses?: HutterVerse[];
};

type HutterBook = {
  chapters?: HutterChapter[];
};

type HutterMappedWord = {
  text?: string;
  translit_en?: string;
  translit_es?: string;
  strong?: string;
  prefixes?: string[];
};

type HutterMappedVerse = {
  chapter?: number;
  verse?: number;
  hebrew?: string;
  words?: HutterMappedWord[];
};

type HutterMappedChapter = {
  chapter?: number;
  verses?: HutterMappedVerse[];
};

type HutterMappingBook = {
  chapters?: HutterMappedChapter[];
};

const generateHutterChapters = async (): Promise<{
  books: Record<string, { chapters: Record<string, JsonValue> }>;
}> => {
  const sourceDir = join(DATA_ROOT, "hutter", "staging", "output");
  const mappingsDir = join(DATA_ROOT, "hutter", "strong_mappings");
  const outDir = join(WEB_PUBLIC_DATA_ROOT, "hutter");
  const files = await listJsonFiles(sourceDir);
  const books: Record<string, { chapters: Record<string, JsonValue> }> = {};

  for (const file of files) {
    const sourceBookId = file.replace(/\.json$/i, "").toLowerCase();
    const canonical = DELITZSCH_TO_ENGLISH[sourceBookId];
    if (!canonical) {
      continue;
    }

    const bookId = canonical.toLowerCase();
    const data = await readJson<HutterBook>(join(sourceDir, file));
    const mapping = await readJson<HutterMappingBook>(
      join(mappingsDir, file),
    );
    const chapters: Record<string, JsonValue> = {};

    const sourceChapterNumbers = new Set(
      (data.chapters ?? []).map((chapter) => Number(chapter.number)),
    );

    for (const chapter of mapping.chapters ?? []) {
      const chapterNumber = Number(chapter.chapter);
      if (!Number.isFinite(chapterNumber) || chapterNumber <= 0) {
        continue;
      }
      if (!sourceChapterNumbers.has(chapterNumber)) {
        throw new Error(
          `Hutter mapping chapter ${sourceBookId} ${chapterNumber} is not present in the source text`,
        );
      }

      const verses = (chapter.verses ?? [])
        .map((verse) => {
          const verseNumber = Number(verse.verse);
          const hebrew = verse.hebrew?.trim() ?? "";
          if (!Number.isFinite(verseNumber) || verseNumber <= 0 || !hebrew) {
            return null;
          }

          return {
            chapter: chapterNumber,
            verse: verseNumber,
            hebrew,
            words: (verse.words ?? [])
              .filter((word) => Boolean(word.text?.trim()))
              .map((word) => ({
                text: word.text!.trim(),
                ...(word.translit_en
                  ? { translit_en: word.translit_en }
                  : {}),
                ...(word.translit_es
                  ? { translit_es: word.translit_es }
                  : {}),
                ...(word.strong ? { strong: word.strong } : {}),
                prefixes: word.prefixes ?? [],
              })),
          };
        })
        .filter((verse): verse is NonNullable<typeof verse> => verse !== null);

      chapters[String(chapterNumber)] = verses as unknown as JsonValue;
      await mkdir(join(outDir, bookId), { recursive: true });
      await writeFile(
        join(outDir, bookId, `${chapterNumber}.json`),
        JSON.stringify(verses),
        "utf-8",
      );
    }

    books[bookId] = { chapters };
  }

  return { books };
};

const generateDictionary = async (): Promise<{
  dictionaryBundle: JsonValue;
  prefixesById: JsonValue;
}> => {
  const customDefinitions = await readJson<JsonValue>(
    join(DATA_ROOT, "dict", "lexicon", "custom_definitions.json"),
  );
  const roots = await readJson<JsonValue>(
    join(DATA_ROOT, "dict", "lexicon", "roots.json"),
  );
  const words = await readJson<JsonValue>(
    join(DATA_ROOT, "dict", "lexicon", "words.json"),
  );

  const prefixEntriesDir = join(DATA_ROOT, "dict", "prefixes", "entries");
  const prefixFiles = await listJsonFiles(prefixEntriesDir);
  const prefixes: Record<string, JsonValue> = {};

  for (const file of prefixFiles) {
    const id = file.replace(/\.json$/i, "");
    prefixes[id] = await readJson<JsonValue>(join(prefixEntriesDir, file));
  }

  const dictOutDir = join(WEB_PUBLIC_DATA_ROOT, "dict");
  await mkdir(dictOutDir, { recursive: true });
  await writeFile(
    join(dictOutDir, "custom_definitions.json"),
    JSON.stringify(customDefinitions),
    "utf-8",
  );
  await writeFile(join(dictOutDir, "roots.json"), JSON.stringify(roots), "utf-8");
  await writeFile(join(dictOutDir, "words.json"), JSON.stringify(words), "utf-8");

  const prefixesById = prefixes as JsonValue;
  await writeFile(
    join(WEB_PUBLIC_DATA_ROOT, "prefixes.json"),
    JSON.stringify(prefixesById),
    "utf-8",
  );

  return {
    dictionaryBundle: {
      custom_definitions: customDefinitions,
      roots,
      prefixes,
    },
    prefixesById,
  };
};

const copyFolderJsonFiles = async (sourceDir: string, outDir: string): Promise<{ books: Record<string, JsonValue> }> => {
  await mkdir(outDir, { recursive: true });
  const files = await listJsonFiles(sourceDir);
  const books: Record<string, JsonValue> = {};

  for (const file of files) {
    const data = await readJson<JsonValue>(join(sourceDir, file));
    const stem = file.replace(/\.json$/i, "");
    books[stem] = data;
    await writeFile(join(outDir, file), JSON.stringify(data), "utf-8");
  }

  return { books };
};

const generateMetadata = (
  tanajVerseCounts: Record<string, Record<string, number>>,
  besorahVerseCounts: Record<string, Record<string, number>>,
  bookLabels: Record<string, CanonicalBookLabels>,
): { books: BookMetadata[]; chapter_counts: Record<string, number[]>; verse_counts: Record<string, Record<string, number>> } => {
  const verseCounts = { ...tanajVerseCounts, ...besorahVerseCounts };

  const books = Object.keys(verseCounts)
    .map((bookName) => {
      const order = bookOrderMap[bookName] ?? 999;
      const chapterCount = Object.keys(verseCounts[bookName] ?? {}).length;
      const section = asSection(order);
      const id = bookName.toLowerCase();
      const canonicalLabels = bookLabels[bookName];

      return {
        id,
        name: bookName,
        section,
        chapters: chapterCount,
        order,
        hebrew_name: canonicalLabels?.hebrew_name ?? bookName,
        hebrew_transliteration: canonicalLabels?.hebrew_transliteration ?? bookName,
        spanish_name: canonicalLabels?.spanish_name ?? bookName,
      } satisfies BookMetadata;
    })
    .sort((a, b) => a.order - b.order);

  const chapterCounts: Record<string, number[]> = {};
  for (const [bookName, perChapter] of Object.entries(verseCounts)) {
    chapterCounts[bookName] = Object.keys(perChapter)
      .map((n) => Number(n))
      .sort((a, b) => a - b);
  }

  return {
    books,
    chapter_counts: chapterCounts,
    verse_counts: verseCounts,
  };
};

const getJsonSize = (value: JsonValue): number => Buffer.byteLength(JSON.stringify(value), "utf-8");

const MAX_CLOUDFLARE_PAGES_ASSET_SIZE_BYTES = 25 * 1024 * 1024;

type SplitBundlePart = {
  size: number;
  checksum: string;
};

type TanajSplitIndex = {
  format: "split-by-book-v1";
  books: string[];
  parts: Record<string, SplitBundlePart>;
  total_size: number;
};

const assertBundleFileSize = (relativePath: string, size: number): void => {
  if (size <= MAX_CLOUDFLARE_PAGES_ASSET_SIZE_BYTES) {
    return;
  }

  const limitMiB = (MAX_CLOUDFLARE_PAGES_ASSET_SIZE_BYTES / (1024 * 1024)).toFixed(0);
  const actualMiB = (size / (1024 * 1024)).toFixed(1);
  throw new Error(
    `Generated bundle file exceeds Cloudflare Pages ${limitMiB} MiB limit: ${relativePath} (${actualMiB} MiB)`,
  );
};

const parseTs2009VerseText = (verse: Ts2009BookVerse): string | null => {
  if (typeof verse.translation === "string") return verse.translation;
  if (typeof verse.text === "string") return verse.text;
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const extractTs2009Chapters = (chaptersRaw: unknown): Record<number, Ts2009BookVerse[]> => {
  const chapters: Record<number, Ts2009BookVerse[]> = {};

  if (Array.isArray(chaptersRaw)) {
    for (const [index, chapterEntry] of chaptersRaw.entries()) {
      const chapterNumberFromIndex = index + 1;

      if (Array.isArray(chapterEntry)) {
        chapters[chapterNumberFromIndex] = chapterEntry as Ts2009BookVerse[];
        continue;
      }

      if (!isRecord(chapterEntry)) continue;

      const chapterNumber = Number(
        chapterEntry.number ?? chapterEntry.chapter ?? chapterNumberFromIndex,
      );
      if (!Number.isFinite(chapterNumber)) continue;

      if (Array.isArray(chapterEntry.verses)) {
        chapters[chapterNumber] = chapterEntry.verses as Ts2009BookVerse[];
      }
    }

    return chapters;
  }

  if (!isRecord(chaptersRaw)) {
    return chapters;
  }

  for (const [chapterKey, chapterEntry] of Object.entries(chaptersRaw)) {
    const chapterNumber = Number(chapterKey);
    if (!Number.isFinite(chapterNumber)) continue;

    if (Array.isArray(chapterEntry)) {
      chapters[chapterNumber] = chapterEntry as Ts2009BookVerse[];
      continue;
    }

    if (isRecord(chapterEntry) && Array.isArray(chapterEntry.verses)) {
      chapters[chapterNumber] = chapterEntry.verses as Ts2009BookVerse[];
    }
  }

  return chapters;
};

const getTs2009BookFileCandidates = (bookId: string): string[] => {
  const mapped = TS2009_BOOK_FILE_MAP[bookId];
  const legacyMapped = TS2009_LEGACY_BOOK_FILE_MAP[bookId];
  const underscoreVariant = bookId.replace(/(\D)(\d+)$/, "$1_$2");
  const stems = [mapped, legacyMapped, bookId, underscoreVariant].filter(
    (value): value is string => Boolean(value),
  );

  const candidates: string[] = [];
  for (const stem of stems) {
    candidates.push(`${stem}.json`);
    candidates.push(`ts2009/${stem}.json`);
  }

  return [...new Set(candidates)];
};

const downloadTs2009BookPayload = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
): Promise<Ts2009BookPayload | null> => {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/ts2009/${path}`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(
      `TS2009 download failed for ${path} (status ${response.status})`,
    );
  }

  const payload = (await response.json()) as Ts2009BookPayload;
  return payload;
};

const readLocalTs2009BookPayload = async (
  path: string,
): Promise<Ts2009BookPayload | null> => {
  const normalizedPath = path.replace(/^ts2009\//, "");
  const localPath = join(DATA_ROOT, "ts2009", normalizedPath);

  try {
    return await readJson<Ts2009BookPayload>(localPath);
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "";

    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }
};

/**
 * For Psalms chapters that have superscription verses in the Hebrew text,
 * the TS2009 Supabase data stores verses with Hebrew numbering (superscription
 * as verse 1, first real verse as verse 2, etc.). The versification system
 * expects English numbering (verse 1 = first real verse). This function
 * detects and corrects Hebrew-numbered verse maps for Psalms chapters.
 */
const normalizePsalmsVerseMap = (
  chapter: number,
  verseMap: Record<string, string>,
): Record<string, string> => {
  const psaMap = VERSIFICATION_DATA["PSA"]?.simple_map;
  if (!psaMap) return verseMap;

  const chapterMap = (psaMap as Record<string, Record<string, string>>)[String(chapter)];
  if (!chapterMap) return verseMap;

  // Find the target Hebrew verse for English verse 1 (source key "1")
  const targetForEnglishVerse1 = chapterMap["1"];
  if (!targetForEnglishVerse1) return verseMap;

  const [, targetVerseToken] = targetForEnglishVerse1.split(":");
  const firstRealHebrewVerse = Number(targetVerseToken);
  if (!Number.isFinite(firstRealHebrewVerse) || firstRealHebrewVerse <= 1) return verseMap;

  // superscriptionCount = number of leading Hebrew verses that are superscriptions
  const superscriptionCount = firstRealHebrewVerse - 1;

  // Count expected English verses (source keys > 0)
  const englishVerseCount = Object.keys(chapterMap).filter(
    (k) => Number(k) > 0,
  ).length;

  const existingKeys = Object.keys(verseMap)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  // Only renumber if the data looks Hebrew-numbered:
  // total verses = englishVerseCount + superscriptionCount
  if (existingKeys.length !== englishVerseCount + superscriptionCount) {
    return verseMap;
  }

  // Renumber: drop the first superscriptionCount verses, re-key from 1
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

const generateTs2009Chapters = async (): Promise<{
  bundle: { books: Record<string, { chapters: number; verses: number }> };
  stats: Ts2009ExportStats;
} | null> => {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasSupabaseBuildAccess = Boolean(supabaseUrl && serviceRoleKey);

  if (!hasSupabaseBuildAccess) {
    console.warn(
      "TS2009 static export running from local data files only (missing SUPABASE_URL/PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)",
    );
  }

  const ts2009OutDir = join(WEB_PUBLIC_DATA_ROOT, "ts2009");
  await mkdir(ts2009OutDir, { recursive: true });

  const stats: Ts2009ExportStats = {
    books: 0,
    chapters: 0,
    verses: 0,
    skippedBooks: [],
  };

  const bundleBooks: Record<string, { chapters: number; verses: number }> = {};

  for (const canonicalBook of CANONICAL_BOOK_ORDER) {
    const bookId = canonicalBook.toLowerCase();
    const candidates = getTs2009BookFileCandidates(bookId);
    let payload: Ts2009BookPayload | null = null;

    for (const candidate of candidates) {
      try {
        payload = await readLocalTs2009BookPayload(candidate);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `Skipping TS2009 static export due to local file parse/access error: ${message}`,
        );
        return null;
      }

      if (payload) break;
    }

    if (!payload && hasSupabaseBuildAccess) {
      for (const candidate of candidates) {
        try {
          payload = await downloadTs2009BookPayload(
            supabaseUrl as string,
            serviceRoleKey as string,
            candidate,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `Skipping TS2009 static export due to Supabase access error: ${message}`,
          );
          return null;
        }
        if (payload) break;
      }
    }

    if (!payload) {
      stats.skippedBooks.push(bookId);
      continue;
    }

    const mappedBookFile = TS2009_BOOK_FILE_MAP[bookId] ?? bookId;
    await writeFile(
      join(ts2009OutDir, `${mappedBookFile}.json`),
      JSON.stringify(payload),
      "utf-8",
    );

    const chapters = extractTs2009Chapters(payload.chapters);
    const chapterNumbers = Object.keys(chapters)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);

    let bookVerseCount = 0;
    let writtenChapterCount = 0;
    for (const chapterNumber of chapterNumbers) {
      const verses = chapters[chapterNumber] ?? [];
      const verseMap: Record<string, string> = {};

      for (const [index, verseEntry] of verses.entries()) {
        const verseNumber = Number(
          verseEntry.number ?? verseEntry.verse ?? index + 1,
        );
        if (!Number.isFinite(verseNumber)) continue;
        const text = parseTs2009VerseText(verseEntry);
        if (!text) continue;
        verseMap[String(verseNumber)] = text;
      }

      if (Object.keys(verseMap).length === 0) {
        continue;
      }

      // For Psalms, normalize Hebrew-numbered verses to English numbering
      const normalizedVerseMap = bookId === "psalms"
        ? normalizePsalmsVerseMap(chapterNumber, verseMap)
        : verseMap;

      const chapterPayload: Ts2009ChapterFile = {
        book: bookId,
        chapter: chapterNumber,
        verses: normalizedVerseMap,
      };

      await mkdir(join(ts2009OutDir, bookId), { recursive: true });
      await writeFile(
        join(ts2009OutDir, bookId, `${chapterNumber}.json`),
        JSON.stringify(chapterPayload),
        "utf-8",
      );

      const verseCount = Object.keys(normalizedVerseMap).length;
      stats.chapters += 1;
      stats.verses += verseCount;
      bookVerseCount += verseCount;
      writtenChapterCount += 1;
    }

    if (bookVerseCount > 0) {
      stats.books += 1;
      bundleBooks[bookId] = {
        chapters: writtenChapterCount,
        verses: bookVerseCount,
      };
    }
  }

  return {
    bundle: { books: bundleBooks },
    stats,
  };
};

const DSS_WORD_TOKEN_SPLIT_RE = /[\s\u05BE/-]+/u;

const tokenizeDssWords = (value: unknown): string[] => {
  if (typeof value !== "string") return [];

  return value
    .trim()
    .replace(/[\u05C3.,;:!?()[\]{}'"`]/g, " ")
    .split(DSS_WORD_TOKEN_SPLIT_RE)
    .filter(Boolean);
};

const enrichDssBookForSpanReplacement = (bookData: JsonValue): JsonValue => {
  if (!isRecord(bookData) || !isRecord(bookData.chapters)) {
    return bookData;
  }

  const chapters = bookData.chapters as Record<string, unknown>;
  const nextChapters: Record<string, unknown> = {};

  for (const [chapterKey, chapterValue] of Object.entries(chapters)) {
    if (!isRecord(chapterValue) || !isRecord(chapterValue.verses)) {
      nextChapters[chapterKey] = chapterValue;
      continue;
    }

    const verses = chapterValue.verses as Record<string, unknown>;
    const nextVerses: Record<string, unknown> = {};

    for (const [verseKey, verseValue] of Object.entries(verses)) {
      if (!isRecord(verseValue) || !Array.isArray(verseValue.differences)) {
        nextVerses[verseKey] = verseValue;
        continue;
      }

      const nextDifferences = verseValue.differences.map((difference) => {
        if (!isRecord(difference)) {
          return difference;
        }

        const masoreticTokenCount = tokenizeDssWords(
          difference.masoretic_word,
        ).length;
        const tokenCount = tokenizeDssWords(difference.dss_word).length;
        const replacementSpan = Math.max(
          masoreticTokenCount > 0 ? masoreticTokenCount : tokenCount,
          1,
        );

        return {
          ...difference,
          token_count: tokenCount,
          masoretic_token_count: masoreticTokenCount,
          replacement_span: replacementSpan,
        };
      });

      nextVerses[verseKey] = {
        ...verseValue,
        differences: nextDifferences,
      };
    }

    nextChapters[chapterKey] = {
      ...chapterValue,
      verses: nextVerses,
    };
  }

  return {
    ...bookData,
    chapters: nextChapters,
  } as JsonValue;
};

const main = async (): Promise<void> => {
  const generationStartedAt = Date.now();
  const shouldExportTs2009Static = process.env.EXPORT_TS2009_STATIC === "1";
  console.log("[davar-static-data] phase=generate start");

  await rm(WEB_PUBLIC_DATA_ROOT, { recursive: true, force: true });
  await mkdir(WEB_PUBLIC_DATA_ROOT, { recursive: true });

  const tanaj = await generateHebrewChapters(
    join(DATA_ROOT, "oe"),
    join(WEB_PUBLIC_DATA_ROOT, "oe"),
    "oe",
  );

  const besorah = await generateHebrewChapters(
    join(DATA_ROOT, "delitzsch_parsed"),
    join(WEB_PUBLIC_DATA_ROOT, "besorah"),
    "delitzsch",
  );
  const hutter = await generateHutterChapters();

  const tthBundle = await copyFolderJsonFiles(
    join(DATA_ROOT, "tth_2", "json"),
    join(WEB_PUBLIC_DATA_ROOT, "tth"),
  );

  const besBundle = await copyFolderJsonFiles(
    join(DATA_ROOT, "bes", "json"),
    join(WEB_PUBLIC_DATA_ROOT, "bes"),
  );

  const translitBundle = await copyFolderJsonFiles(
    join(DATA_ROOT, "translit"),
    join(WEB_PUBLIC_DATA_ROOT, "translit"),
  );

  // Publish DSS transliteration variants for web Qumran mode.
  try {
    await copyFolderJsonFiles(
      join(DATA_ROOT, "translit", "dss"),
      join(WEB_PUBLIC_DATA_ROOT, "translit", "dss"),
    );
  } catch {
    // DSS transliteration files are optional in some environments.
  }

  const { dictionaryBundle } = await generateDictionary();

  const booksDir = join(DATA_ROOT, "dss", "books");
  const dssFiles = await listJsonFiles(booksDir);
  const dssBooks: Record<string, JsonValue> = {};
  await mkdir(join(WEB_PUBLIC_DATA_ROOT, "dss"), { recursive: true });
  for (const file of dssFiles) {
    const stem = file.replace(/\.json$/i, "");
    const dssBookData = await readJson<JsonValue>(join(booksDir, file));
    const enrichedDssBook = enrichDssBookForSpanReplacement(dssBookData);
    dssBooks[stem] = enrichedDssBook;
    await writeFile(
      join(WEB_PUBLIC_DATA_ROOT, "dss", file),
      JSON.stringify(enrichedDssBook),
      "utf-8",
    );
  }
  const dssBundle = dssBooks as JsonValue;

  const canonicalBookLabels = await loadCanonicalBookLabels();
  const metadata = generateMetadata(tanaj.counts, besorah.counts, canonicalBookLabels);
  await writeFile(
    join(WEB_PUBLIC_DATA_ROOT, "metadata.json"),
    JSON.stringify(metadata),
    "utf-8",
  );

  const bundlesDir = join(WEB_PUBLIC_DATA_ROOT, "bundles");
  await mkdir(bundlesDir, { recursive: true });

  const tanajSplitDir = join(bundlesDir, "tanaj");
  await mkdir(tanajSplitDir, { recursive: true });

  const tanajBookIds = Object.keys(tanaj.bundle.books).sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const tanajParts: Record<string, SplitBundlePart> = {};
  let tanajTotalSize = 0;

  for (const bookId of tanajBookIds) {
    const bookBundle = tanaj.bundle.books[bookId] as JsonValue;
    const relativePath = `data/bundles/tanaj/${bookId}.json`;
    const size = getJsonSize(bookBundle);
    assertBundleFileSize(relativePath, size);

    tanajTotalSize += size;
    tanajParts[bookId] = {
      size,
      checksum: sha256OfJson(bookBundle),
    };

    await writeFile(
      join(tanajSplitDir, `${bookId}.json`),
      JSON.stringify(bookBundle),
      "utf-8",
    );
  }

  const tanajIndex: TanajSplitIndex = {
    format: "split-by-book-v1",
    books: tanajBookIds,
    parts: tanajParts,
    total_size: tanajTotalSize,
  };
  assertBundleFileSize("data/bundles/tanaj.json", getJsonSize(tanajIndex as unknown as JsonValue));
  await writeFile(
    join(bundlesDir, "tanaj.json"),
    JSON.stringify(tanajIndex),
    "utf-8",
  );
  await writeFile(
    join(bundlesDir, "besorah.json"),
    JSON.stringify(besorah.bundle),
    "utf-8",
  );
  await writeFile(
    join(bundlesDir, "hutter.json"),
    JSON.stringify({ books: hutter.books }),
    "utf-8",
  );
  await writeFile(join(bundlesDir, "tth.json"), JSON.stringify(tthBundle), "utf-8");
  const ts2009Bundle = shouldExportTs2009Static
    ? await generateTs2009Chapters()
    : null;
  if (ts2009Bundle) {
    await writeFile(
      join(bundlesDir, "ts2009.json"),
      JSON.stringify(ts2009Bundle.bundle),
      "utf-8",
    );
  }
  await writeFile(
    join(bundlesDir, "dictionary.json"),
    JSON.stringify(dictionaryBundle),
    "utf-8",
  );
  await writeFile(join(bundlesDir, "dss.json"), JSON.stringify(dssBundle), "utf-8");
  await writeFile(
    join(bundlesDir, "versions.json"),
    JSON.stringify(BUNDLE_VERSIONS),
    "utf-8",
  );

  const manifest = {
    version: `${new Date().toISOString().slice(0, 10).replace(/-/g, ".")}-1`,
    generated_at: new Date().toISOString(),
    bundles: {
      metadata: {
        size: getJsonSize(metadata),
        checksum: sha256OfJson(metadata),
      },
      tanaj: {
        size: tanajTotalSize,
        checksum: sha256OfJson(tanajIndex as unknown as JsonValue),
      },
      besorah: {
        size: getJsonSize(besorah.bundle),
        checksum: sha256OfJson(besorah.bundle),
      },
      hutter: {
        size: getJsonSize({ books: hutter.books } as unknown as JsonValue),
        checksum: sha256OfJson({ books: hutter.books } as unknown as JsonValue),
      },
      tth: {
        size: getJsonSize(tthBundle as unknown as JsonValue),
        checksum: sha256OfJson(tthBundle as unknown as JsonValue),
      },
      bes: {
        size: getJsonSize(besBundle as unknown as JsonValue),
        checksum: sha256OfJson(besBundle as unknown as JsonValue),
      },
      translit: {
        size: getJsonSize(translitBundle as unknown as JsonValue),
        checksum: sha256OfJson(translitBundle as unknown as JsonValue),
      },
      dictionary: {
        size: getJsonSize(dictionaryBundle),
        checksum: sha256OfJson(dictionaryBundle),
      },
      dss: {
        size: getJsonSize(dssBundle),
        checksum: sha256OfJson(dssBundle),
      },
      versions: {
        size: getJsonSize(BUNDLE_VERSIONS as unknown as JsonValue),
        checksum: sha256OfJson(BUNDLE_VERSIONS as unknown as JsonValue),
      },
      ...(ts2009Bundle
        ? {
            ts2009: {
              size: getJsonSize(ts2009Bundle.bundle as unknown as JsonValue),
              checksum: sha256OfJson(ts2009Bundle.bundle as unknown as JsonValue),
            },
          }
        : {}),
    },
  };

  await writeFile(
    join(WEB_PUBLIC_DATA_ROOT, "manifest.json"),
    JSON.stringify(manifest),
    "utf-8",
  );

  console.log("Generated static data in web/public/data");
  console.log(`books: tanaj=${Object.keys(tanaj.bundle.books).length}, besorah=${Object.keys(besorah.bundle.books).length}`);
  if (!shouldExportTs2009Static) {
    console.log("ts2009: static export disabled; serving through private API only");
  }
  if (ts2009Bundle) {
    console.log(
      `ts2009: books=${ts2009Bundle.stats.books}, chapters=${ts2009Bundle.stats.chapters}, verses=${ts2009Bundle.stats.verses}`,
    );
    if (ts2009Bundle.stats.skippedBooks.length > 0) {
      console.warn(
        `ts2009 skipped books: ${ts2009Bundle.stats.skippedBooks.join(", ")}`,
      );
    }
  }
  console.log(`bundles: ${Object.keys(manifest.bundles).join(", ")}`);
  console.log(
    `[davar-static-data] phase=generate done duration=${((Date.now() - generationStartedAt) / 1000).toFixed(1)}s`,
  );
};

main().catch((error) => {
  console.error("generate-static-data failed", error);
  process.exit(1);
});
