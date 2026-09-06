import { staticBundlePathRequest, staticBundleRequest } from "@/src/services/api";
import {
  getBundleUpdatePlan,
  type BundleVersions,
} from "@/src/services/offlinePlan";
import type { LexiconResponse } from "@/src/types/api";
import type { TranslationRow } from "@/src/services/database";
import {
  deleteTranslationBookEntries,
  deleteHebrewBookEntries,
  insertLexiconEntries,
  insertTranslationVerses,
  insertHebrewVerses,
  insertDssVariants,
  insertPrefixEntries,
  initializeDatabase,
  setLocalBundleVersion,
  getAllLocalBundleVersions,
} from "@/src/services/database";

export type { BundleVersions } from "@/src/services/offlinePlan";

export type DownloadProgress = {
  stage: string;
  current: number;
  total: number;
};

export type ProgressCallback = (progress: DownloadProgress) => void;

// ── Dictionary Bundle Types ────────────────────────────────────────────────

interface DefinitionItem {
  text_en?: string;
  text_es?: string;
  source?: string;
}

interface CustomDefinitionEntry {
  strong_number: string;
  hebrew?: string;
  transliteration_en?: string;
  transliteration_es?: string;
  definitions: DefinitionItem[];
  root?: string;
  root_strong?: string;
}

interface RootEntry {
  strong_number: string;
  lemma: string;
  transliteration: string;
  definitions: DefinitionItem[];
  root?: string;
  root_strong?: string;
  occurrences_count?: number;
}

interface DictionaryBundle {
  custom_definitions: Record<string, CustomDefinitionEntry>;
  roots: Record<string, RootEntry>;
  prefixes: Record<string, unknown>; // can be refined later if needed
}

// ── Translation Bundle Types ───────────────────────────────────────────────

interface TthVerse {
  verse: number;
  tth: string;
  footnotes?: unknown[];
}

interface TthChapter {
  chapter: number;
  verses: TthVerse[];
}

interface TthBookData {
  chapters: TthChapter[];
}

interface Ts2009Verse {
  chapter: number;
  verse: number;
  text: string;
}

interface Ts2009BookData {
  verses: Ts2009Verse[];
}

interface TranslationBundle {
  books: Record<string, TthBookData | Ts2009BookData>;
}

// ── Hebrew Bundle Types ────────────────────────────────────────────────────

interface HebrewWordData {
  text: string;
  strong?: string;
  morph?: string;
  prefixes?: string[];
  text_no_nikud?: string;
  lemma?: string;
  possible_proper_name?: boolean;
}

interface HebrewVerseData {
  chapter: number;
  verse: number;
  hebrew: string;
  words: HebrewWordData[];
  hebrew_no_nikud?: string;
}

interface HebrewBookBundle {
  chapters: Record<string, HebrewVerseData[]>;
}

interface HebrewBundle {
  books: Record<string, HebrewBookBundle>;
}

interface TanajSplitBundleIndex {
  format?: string;
  books?: string[];
}

// ── DSS Bundle Types ───────────────────────────────────────────────────────

interface DssDifference {
  position: number;
  masoretic_word: string;
  dss_word: string;
  masoretic_strong?: string;
  dss_strong?: string;
  comment_v2_en?: string;
  comment_v2_es?: string;
  comment_v2_he?: string;
}

interface DssVerseData {
  masoretic_text?: string;
  dss_text?: string;
  differences: DssDifference[];
}

interface DssChapterData {
  verses: Record<string, DssVerseData>;
}

interface DssBookData {
  name: string;
  chapters: Record<string, DssChapterData>;
}

type DssBundle = Record<string, DssBookData>;

// ── Remote versions ────────────────────────────────────────────────────────

export const fetchRemoteBundleVersions = async (): Promise<BundleVersions> => {
  return staticBundleRequest<BundleVersions>("versions");
};

export { getAllLocalBundleVersions };

// ── Lexicon builder ────────────────────────────────────────────────────────

const buildLexiconEntries = (bundle: DictionaryBundle): LexiconResponse[] => {
  const entries: LexiconResponse[] = [];

  // Custom definitions
  Object.values(bundle.custom_definitions ?? {}).forEach(
    (entry: CustomDefinitionEntry) => {
      const definitions = (entry.definitions ?? []).flatMap(
        (item: DefinitionItem) => {
          const defs: LexiconResponse["definitions"] = [];
          if (item.text_en) {
            defs.push({
              text: item.text_en,
              source: item.source ?? "custom",
              language: "en",
            });
          }
          if (item.text_es) {
            defs.push({
              text: item.text_es,
              source: item.source ?? "custom",
              language: "es",
            });
          }
          return defs;
        },
      );

      entries.push({
        strong_number:
          entry.strong_number != null ? String(entry.strong_number) : "",
        hebrew: entry.hebrew != null ? String(entry.hebrew) : undefined,
        definitions,
        root: entry.root != null ? String(entry.root) : undefined,
        root_strong:
          entry.root_strong != null ? String(entry.root_strong) : undefined,
        root_definitions: [],
        occurrences_count: 0,
        instances: [],
      });
    },
  );

  // Roots lexicon
  Object.values(bundle.roots ?? {}).forEach((entry: RootEntry) => {
    const definitions = (entry.definitions ?? []).flatMap(
      (item: DefinitionItem) => {
        const defs: LexiconResponse["definitions"] = [];
        if (item.text_en) {
          defs.push({
            text: item.text_en,
            source: item.source ?? "bdb",
            language: "en",
          });
        }
        if (item.text_es) {
          defs.push({
            text: item.text_es,
            source: item.source ?? "bdb",
            language: "es",
          });
        }
        return defs;
      },
    );

    entries.push({
      strong_number:
        entry.strong_number != null ? String(entry.strong_number) : "",
      hebrew: entry.lemma != null ? String(entry.lemma) : undefined,
      definitions,
      root:
        entry.root != null
          ? String(entry.root)
          : entry.lemma != null
            ? String(entry.lemma)
            : undefined,
      root_strong:
        entry.root_strong != null
          ? String(entry.root_strong)
          : entry.strong_number != null
            ? String(entry.strong_number)
            : undefined,
      root_definitions: [],
      occurrences_count: entry.occurrences_count ?? 0,
      instances: [],
    });
  });

  return entries.filter((entry) => entry.strong_number.trim() !== "");
};

export const downloadDictionaryBundle = async (remoteVersion?: number) => {
  await initializeDatabase();
  try {
    const bundle = await staticBundleRequest<DictionaryBundle>("dictionary");

    // Insert lexicon entries
    const entries = buildLexiconEntries(bundle);
    await insertLexiconEntries(entries);

    // Insert prefix entries (previously discarded)
    if (bundle.prefixes && Object.keys(bundle.prefixes).length > 0) {
      await insertPrefixEntries(bundle.prefixes);
    }

    if (remoteVersion != null) {
      await setLocalBundleVersion("dictionary", remoteVersion);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to download dictionary bundle: ${message}`);
  }
};

// ── Translation extractors ─────────────────────────────────────────────────

const extractTthVerses = (bookData: TthBookData): TranslationRow[] => {
  const rows: TranslationRow[] = [];
  for (const chapter of bookData.chapters ?? []) {
    for (const verse of chapter.verses ?? []) {
      rows.push({
        chapter: chapter.chapter,
        verse: verse.verse,
        text: verse.tth ?? "",
        footnotes: verse.footnotes ?? [],
      });
    }
  }
  return rows;
};

export const downloadTranslationBundle = async (
  language: "es" | "en",
  remoteVersion?: number,
) => {
  await initializeDatabase();

  // TS2009 is loaded as static chapter JSON files, not as bundles, so we do
  // not mark it as downloaded here; it remains online-only/streaming.
  if (language === "en") {
    return;
  }

  const insertedBooks: string[] = [];

  try {
    const dataset = "tth"; // Only TTH for Spanish
    const bundle = await staticBundleRequest<TranslationBundle>(dataset);

    for (const [bookId, bookData] of Object.entries(bundle.books ?? {})) {
      const rows = extractTthVerses(bookData as TthBookData);

      await insertTranslationVerses(rows, language, bookId);
      insertedBooks.push(bookId);
    }

    if (remoteVersion != null) {
      await setLocalBundleVersion(dataset, remoteVersion);
    }
  } catch (error: unknown) {
    for (const bookId of insertedBooks) {
      await deleteTranslationBookEntries(bookId, language);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to download translation bundle: ${message}`);
  }
};

// ── Hebrew bundle download ─────────────────────────────────────────────────

const downloadSingleHebrewBundle = async (
  dataset: "tanaj" | "besorah",
  remoteVersion?: number,
) => {
  const insertedBooks: string[] = [];

  try {
    const insertHebrewBook = async (bookId: string, bookData: HebrewBookBundle) => {
      const verses: {
        book: string;
        chapter: number;
        verse: number;
        words: unknown[];
      }[] = [];

      for (const [chapterStr, chapterVerses] of Object.entries(
        bookData.chapters ?? {},
      )) {
        const chapterNum = Number(chapterStr);
        for (const verse of chapterVerses) {
          verses.push({
            book: bookId,
            chapter: chapterNum,
            verse: verse.verse,
            words: verse.words ?? [],
          });
        }
      }

      await insertHebrewVerses(verses);
      insertedBooks.push(bookId);
    };

    if (dataset === "tanaj") {
      const tanajBundle = await staticBundleRequest<HebrewBundle | TanajSplitBundleIndex>(
        "tanaj",
      );

      const splitBookIds =
        Array.isArray((tanajBundle as TanajSplitBundleIndex).books)
          ? (tanajBundle as TanajSplitBundleIndex).books
          : null;

      if (splitBookIds && splitBookIds.length > 0) {
        for (const bookId of splitBookIds) {
          const bookData = await staticBundlePathRequest<HebrewBookBundle>(
            `tanaj/${bookId}.json`,
          );
          await insertHebrewBook(bookId, bookData);
        }
      } else {
        const legacyBundle = tanajBundle as HebrewBundle;
        for (const [bookId, bookData] of Object.entries(legacyBundle.books ?? {})) {
          await insertHebrewBook(bookId, bookData);
        }
      }
    } else {
      const bundle = await staticBundleRequest<HebrewBundle>(dataset);
      for (const [bookId, bookData] of Object.entries(bundle.books ?? {})) {
        await insertHebrewBook(bookId, bookData);
      }
    }

    if (remoteVersion != null) {
      await setLocalBundleVersion(dataset, remoteVersion);
    }
  } catch (error) {
    // Rollback inserted books on failure
    for (const bookId of insertedBooks) {
      try {
        await deleteHebrewBookEntries(bookId);
      } catch {
        // Best effort rollback
      }
    }
    throw error;
  }
};

export const downloadHebrewBundle = async (
  remoteTanajVersion?: number,
  remoteBesorahVersion?: number,
) => {
  await initializeDatabase();

  try {
    await downloadSingleHebrewBundle("tanaj", remoteTanajVersion);
    await downloadSingleHebrewBundle("besorah", remoteBesorahVersion);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to download Hebrew bundle: ${message}`);
  }
};

// ── DSS bundle download ────────────────────────────────────────────────────

export const downloadDssBundle = async (remoteVersion?: number) => {
  await initializeDatabase();

  try {
    const bundle = await staticBundleRequest<DssBundle>("dss");

    const allVariants: {
      book: string;
      chapter: number;
      verse: number;
      position: number;
      data: Record<string, unknown>;
    }[] = [];

    for (const [bookKey, bookData] of Object.entries(bundle)) {
      for (const [chapterStr, chapterData] of Object.entries(
        bookData.chapters ?? {},
      )) {
        const chapterNum = Number(chapterStr);
        for (const [verseStr, verseData] of Object.entries(
          chapterData.verses ?? {},
        )) {
          const verseNum = Number(verseStr);
          for (const diff of verseData.differences ?? []) {
            allVariants.push({
              book: bookKey,
              chapter: chapterNum,
              verse: verseNum,
              position: diff.position ?? 0,
              data: {
                masoretic_word: diff.masoretic_word,
                dss_word: diff.dss_word,
                masoretic_strong: diff.masoretic_strong,
                dss_strong: diff.dss_strong,
                comment_v2_en: diff.comment_v2_en,
                comment_v2_es: diff.comment_v2_es,
                comment_v2_he: diff.comment_v2_he,
              },
            });
          }
        }
      }
    }

    await insertDssVariants(allVariants);

    if (remoteVersion != null) {
      await setLocalBundleVersion("dss", remoteVersion);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to download DSS bundle: ${message}`);
  }
};

// ── Orchestrator ───────────────────────────────────────────────────────────

type BundleStep = {
  name: string;
  bundles: string[];
  download: (versions: BundleVersions) => Promise<void>;
};

export const downloadAllForOffline = async (
  language: "es" | "en",
  onProgress?: ProgressCallback,
) => {
  await initializeDatabase();

  // Fetch remote versions
  const remoteVersions = await fetchRemoteBundleVersions();
  const localVersions = await getAllLocalBundleVersions();

  const plan = getBundleUpdatePlan(language, localVersions, remoteVersions);
  // Define download steps — each checks if it needs updating
  const steps: BundleStep[] = [
    {
      name: "hebrew",
      bundles: ["tanaj", "besorah"],
      download: async (rv) => {
        const needsTanaj = plan.needs.tanaj;
        const needsBesorah = plan.needs.besorah;
        if (needsTanaj || needsBesorah) {
          await downloadHebrewBundle(
            needsTanaj ? rv.tanaj : undefined,
            needsBesorah ? rv.besorah : undefined,
          );
        }
      },
    },
    ...(plan.translationDataset
      ? [
          {
            name: "translation",
            bundles: [plan.translationDataset],
            download: async (rv: BundleVersions) => {
              if (plan.needs.translation) {
                const remoteV = rv[plan.translationDataset!] ?? 0;
                await downloadTranslationBundle(language, remoteV);
              }
            },
          },
        ]
      : []),
    {
      name: "dictionary",
      bundles: ["dictionary"],
      download: async (rv) => {
        if (plan.needs.dictionary) {
          const remoteV = rv.dictionary ?? 0;
          await downloadDictionaryBundle(remoteV);
        }
      },
    },
    {
      name: "dss",
      bundles: ["dss"],
      download: async (rv) => {
        if (plan.needs.dss) {
          const remoteV = rv.dss ?? 0;
          await downloadDssBundle(remoteV);
        }
      },
    },
  ];

  const totalSteps = steps.length;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    onProgress?.({
      stage: step.name,
      current: i + 1,
      total: totalSteps,
    });

    try {
      await step.download(remoteVersions);
    } catch (error) {
      // Log the failure but let already-completed bundles remain usable.
      // Re-throw so the caller knows the download didn't fully complete.
      console.error(`Offline download failed at step "${step.name}":`, error);
      throw error;
    }
  }
};
