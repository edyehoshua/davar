import * as SQLite from "expo-sqlite";
import type { LexiconResponse } from "@/src/types/api";

export type TranslationRow = {
  chapter: number;
  verse: number;
  text: string;
  footnotes?: unknown[];
};

const db = SQLite.openDatabaseSync("davar.db");

const CURRENT_SCHEMA_VERSION = 3;

// ── Custom error for better debugging ──────────────────────────────────────

class DatabaseError extends Error {
  constructor(
    message: string,
    public query: string,
    public params: (string | number)[],
    public originalError: unknown,
  ) {
    const originalMsg =
      originalError instanceof Error
        ? originalError.message
        : String(originalError);
    super(`${message}: ${originalMsg}`);
    this.name = "DatabaseError";
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      query: this.query.trim().replace(/\s+/g, " "),
      params: this.params,
      original:
        this.originalError instanceof Error
          ? this.originalError.message
          : String(this.originalError),
    };
  }
}

// ── Low-level executors with error context ─────────────────────────────────

const executeRead = async (
  query: string,
  params: (string | number)[] = [],
): Promise<unknown[]> => {
  try {
    const rows = await (
      db as unknown as {
        getAllAsync: (sql: string, params?: unknown[]) => Promise<unknown[]>;
      }
    ).getAllAsync(query, params);

    if (!Array.isArray(rows)) {
      throw new Error("SQLite read returned non-array rows.");
    }

    return rows;
  } catch (error) {
    const wrappedError = new DatabaseError(
      `SQLite read failed`,
      query,
      params,
      error,
    );
    throw wrappedError;
  }
};

/**
 * Coerce any value to a SQLite-safe primitive.
 * Objects/arrays are JSON-stringified; undefined becomes null.
 */
/**
 * Coerce any value to a SQLite-safe primitive.
 * Returns "" instead of null — expo-sqlite v15's Kotlin/JSI bridge on Android
 * cannot convert JS null in bind param arrays, throwing:
 *   "Cannot convert '[object Object]' to a Kotlin type."
 */
const sanitizeParam = (value: unknown): string | number => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "" : serialized;
  } catch {
    return String(value);
  }
};

const executeWrite = async (
  query: string,
  params: unknown[] = [],
): Promise<void> => {
  // Sanitize ALL params to prevent "[object Object]" crashes on Android
  const safeParams = params.map(sanitizeParam);
  try {
    await (
      db as unknown as {
        runAsync: (sql: string, params?: unknown[]) => Promise<unknown>;
      }
    ).runAsync(query, safeParams);
  } catch (error) {
    const wrappedError = new DatabaseError(
      `SQLite write failed`,
      query,
      safeParams,
      error,
    );
    const paramTypes = safeParams.map((param) => typeof param);
    console.error("SQLite write error", {
      ...wrappedError.toJSON(),
      paramTypes,
    });
    throw wrappedError;
  }
};

// ── Initialization ──────────────────────────────────────────────────────────

export const initializeDatabase = async () => {
  // Enable WAL mode for better concurrent access and write performance
  await executeWrite("PRAGMA journal_mode = WAL;");

  const versionResult = await executeRead("PRAGMA user_version;");
  const currentVersion =
    Number((versionResult?.[0] as Record<string, unknown>)?.user_version) || 0;

  await executeWrite(
    `CREATE TABLE IF NOT EXISTS verses (
      id TEXT PRIMARY KEY,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      text TEXT NOT NULL,
      language TEXT NOT NULL,
      footnotes TEXT
    );`,
  );

  await executeWrite(
    `CREATE INDEX IF NOT EXISTS idx_verses_book_chapter 
     ON verses(book, chapter);`,
  );

  if (currentVersion < 2) {
    const lexiconInfo = await executeRead("PRAGMA table_info(lexicon);");
    const lexiconExists = (lexiconInfo.length ?? 0) > 0;

    if (lexiconExists) {
      await executeWrite(
        `CREATE TABLE IF NOT EXISTS lexicon_new (
          strong TEXT PRIMARY KEY,
          hebrew TEXT,
          definitions TEXT NOT NULL,
          root TEXT,
          root_strong TEXT,
          occurrences TEXT
        );`,
      );

      await executeWrite(
        `INSERT OR REPLACE INTO lexicon_new (
          strong, hebrew, definitions, root, root_strong, occurrences
        )
        SELECT strong, hebrew, definitions, root, root_strong, occurrences
        FROM lexicon;`,
      );

      await executeWrite("DROP TABLE lexicon;");
      await executeWrite("ALTER TABLE lexicon_new RENAME TO lexicon;");
    } else {
      await executeWrite(
        `CREATE TABLE IF NOT EXISTS lexicon (
          strong TEXT PRIMARY KEY,
          hebrew TEXT,
          definitions TEXT NOT NULL,
          root TEXT,
          root_strong TEXT,
          occurrences TEXT
        );`,
      );
    }

    await executeWrite(
      `CREATE INDEX IF NOT EXISTS idx_lexicon_hebrew 
       ON lexicon(hebrew);`,
    );
  } else {
    await executeWrite(
      `CREATE TABLE IF NOT EXISTS lexicon (
        strong TEXT PRIMARY KEY,
        hebrew TEXT,
        definitions TEXT NOT NULL,
        root TEXT,
        root_strong TEXT,
        occurrences TEXT
      );`,
    );

    await executeWrite(
      `CREATE INDEX IF NOT EXISTS idx_lexicon_hebrew 
       ON lexicon(hebrew);`,
    );
  }

  // ── Schema v3: offline tables for Hebrew, DSS, prefixes, bundle versions ──
  if (currentVersion < 3) {
    await executeWrite(
      `CREATE TABLE IF NOT EXISTS hebrew_verses (
        id TEXT PRIMARY KEY,
        book TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        words TEXT NOT NULL
      );`,
    );
    await executeWrite(
      `CREATE INDEX IF NOT EXISTS idx_hebrew_verses_book_chapter
       ON hebrew_verses(book, chapter);`,
    );

    await executeWrite(
      `CREATE TABLE IF NOT EXISTS dss_variants (
        id TEXT PRIMARY KEY,
        book TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        position INTEGER NOT NULL,
        data TEXT NOT NULL
      );`,
    );
    await executeWrite(
      `CREATE INDEX IF NOT EXISTS idx_dss_variants_book_chapter
       ON dss_variants(book, chapter);`,
    );

    await executeWrite(
      `CREATE TABLE IF NOT EXISTS prefixes (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );`,
    );

    await executeWrite(
      `CREATE TABLE IF NOT EXISTS bundle_versions (
        bundle TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        downloaded_at TEXT NOT NULL
      );`,
    );
  }

  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    await executeWrite(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
  }
};

// ── Bulk inserts with transaction safety ───────────────────────────────────

const BATCH_SIZE = 500;

export const insertLexiconEntries = async (entries: LexiconResponse[]) => {
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await executeWrite("BEGIN TRANSACTION;");
    try {
      for (const entry of batch) {
        const strong = String(entry.strong_number ?? "").trim();
        if (strong === "") {
          continue;
        }
        await executeWrite(
          `INSERT OR REPLACE INTO lexicon (
            strong, hebrew, definitions, root, root_strong, occurrences
          ) VALUES (?, ?, ?, ?, ?, ?);`,
          [
            strong,
            entry.hebrew ?? "",
            JSON.stringify(entry.definitions ?? []),
            entry.root ?? "",
            entry.root_strong ?? "",
            JSON.stringify(entry.root_definitions ?? []),
          ],
        );
      }
      await executeWrite("COMMIT;");
    } catch (error) {
      try {
        await executeWrite("ROLLBACK;");
      } catch {
        // Best-effort rollback
      }
      throw error;
    }
  }
};

export const insertTranslationVerses = async (
  verses: TranslationRow[],
  language: "en" | "es",
  bookId: string,
) => {
  for (let i = 0; i < verses.length; i += BATCH_SIZE) {
    const batch = verses.slice(i, i + BATCH_SIZE);
    await executeWrite("BEGIN TRANSACTION;");
    try {
      for (const verse of batch) {
        const id = `${bookId}-${verse.chapter}-${verse.verse}`;
        await executeWrite(
          `INSERT OR REPLACE INTO verses (
            id, book, chapter, verse, text, language, footnotes
          ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [
            id,
            bookId,
            verse.chapter,
            verse.verse,
            verse.text,
            language,
            JSON.stringify(verse.footnotes ?? []),
          ],
        );
      }
      await executeWrite("COMMIT;");
    } catch (error) {
      try {
        await executeWrite("ROLLBACK;");
      } catch {
        // Best-effort rollback
      }
      throw error;
    }
  }
};

export const deleteTranslationBookEntries = async (
  bookId: string,
  language: "en" | "es",
) => {
  await executeWrite("DELETE FROM verses WHERE book = ? AND language = ?;", [
    bookId,
    language,
  ]);
};

// ── Queries ────────────────────────────────────────────────────────────────

export const fetchTranslationVerses = async (
  bookId: string,
  chapter: number,
  language: "en" | "es",
): Promise<TranslationRow[]> => {
  const result = await executeRead(
    `SELECT chapter, verse, text, footnotes 
     FROM verses 
     WHERE book = ? AND chapter = ? AND language = ? 
     ORDER BY verse ASC;`,
    [bookId, chapter, language],
  );

  // Parse footnotes back to TranslationRow array
  return result.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      chapter: Number(r.chapter ?? 0),
      verse: Number(r.verse ?? 0),
      text: String(r.text ?? ""),
      footnotes: r.footnotes ? JSON.parse(String(r.footnotes)) : undefined,
    } as TranslationRow;
  });
};

export type LexiconRow = {
  strong: string;
  hebrew: string | null;
  definitions: unknown[];
  root: string | null;
  root_strong: string | null;
  occurrences: unknown[];
};

export const fetchLexiconEntry = async (
  strong: string,
): Promise<LexiconRow | null> => {
  const result = await executeRead(
    `SELECT * FROM lexicon WHERE strong = ? LIMIT 1;`,
    [strong],
  );

  const row = result[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    strong: String(row.strong ?? ""),
    hebrew: row.hebrew ? String(row.hebrew) : null,
    definitions: row.definitions ? JSON.parse(String(row.definitions)) : [],
    root: row.root ? String(row.root) : null,
    root_strong: row.root_strong ? String(row.root_strong) : null,
    occurrences: row.occurrences ? JSON.parse(String(row.occurrences)) : [],
  };
};

// ── Hebrew verses ──────────────────────────────────────────────────────────

export type HebrewVerseRow = {
  book: string;
  chapter: number;
  verse: number;
  words: unknown[];
};

export const insertHebrewVerses = async (
  verses: { book: string; chapter: number; verse: number; words: unknown[] }[],
) => {
  for (let i = 0; i < verses.length; i += BATCH_SIZE) {
    const batch = verses.slice(i, i + BATCH_SIZE);
    await executeWrite("BEGIN TRANSACTION;");
    try {
      for (const v of batch) {
        const id = `${v.book}-${v.chapter}-${v.verse}`;
        await executeWrite(
          `INSERT OR REPLACE INTO hebrew_verses (id, book, chapter, verse, words)
           VALUES (?, ?, ?, ?, ?);`,
          [id, v.book, v.chapter, v.verse, JSON.stringify(v.words)],
        );
      }
      await executeWrite("COMMIT;");
    } catch (error) {
      try {
        await executeWrite("ROLLBACK;");
      } catch {
        // Best-effort rollback
      }
      throw error;
    }
  }
};

export const fetchHebrewVerses = async (
  bookId: string,
  chapter: number,
): Promise<HebrewVerseRow[]> => {
  const result = await executeRead(
    `SELECT book, chapter, verse, words
     FROM hebrew_verses
     WHERE book = ? AND chapter = ?
     ORDER BY verse ASC;`,
    [bookId, chapter],
  );
  return result.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      book: String(r.book),
      chapter: Number(r.chapter),
      verse: Number(r.verse),
      words: r.words ? JSON.parse(String(r.words)) : [],
    };
  });
};

export const deleteHebrewBookEntries = async (bookId: string) => {
  await executeWrite("DELETE FROM hebrew_verses WHERE book = ?;", [bookId]);
};

// ── DSS variants ───────────────────────────────────────────────────────────

export type DssVariantRow = {
  book: string;
  chapter: number;
  verse: number;
  position: number;
  data: Record<string, unknown>;
};

export const insertDssVariants = async (
  variants: {
    book: string;
    chapter: number;
    verse: number;
    position: number;
    data: Record<string, unknown>;
  }[],
) => {
  for (let i = 0; i < variants.length; i += BATCH_SIZE) {
    const batch = variants.slice(i, i + BATCH_SIZE);
    await executeWrite("BEGIN TRANSACTION;");
    try {
      for (const v of batch) {
        const id = `${v.book}-${v.chapter}-${v.verse}-${v.position}`;
        await executeWrite(
          `INSERT OR REPLACE INTO dss_variants (id, book, chapter, verse, position, data)
           VALUES (?, ?, ?, ?, ?, ?);`,
          [id, v.book, v.chapter, v.verse, v.position, JSON.stringify(v.data)],
        );
      }
      await executeWrite("COMMIT;");
    } catch (error) {
      try {
        await executeWrite("ROLLBACK;");
      } catch {
        // Best-effort rollback
      }
      throw error;
    }
  }
};

export const fetchDssVariants = async (
  bookId: string,
  chapter: number,
): Promise<DssVariantRow[]> => {
  const result = await executeRead(
    `SELECT book, chapter, verse, position, data
     FROM dss_variants
     WHERE book = ? AND chapter = ?
     ORDER BY verse ASC, position ASC;`,
    [bookId, chapter],
  );
  return result.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      book: String(r.book),
      chapter: Number(r.chapter),
      verse: Number(r.verse),
      position: Number(r.position),
      data: r.data ? JSON.parse(String(r.data)) : {},
    };
  });
};

// ── Prefixes ───────────────────────────────────────────────────────────────

export const insertPrefixEntries = async (
  prefixes: Record<string, unknown>,
) => {
  const entries = Object.entries(prefixes);
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await executeWrite("BEGIN TRANSACTION;");
    try {
      for (const [id, data] of batch) {
        await executeWrite(
          `INSERT OR REPLACE INTO prefixes (id, data) VALUES (?, ?);`,
          [id, JSON.stringify(data)],
        );
      }
      await executeWrite("COMMIT;");
    } catch (error) {
      try {
        await executeWrite("ROLLBACK;");
      } catch {
        // Best-effort rollback
      }
      throw error;
    }
  }
};

export const fetchPrefixEntry = async (
  prefixId: string,
): Promise<Record<string, unknown> | null> => {
  const result = await executeRead(
    `SELECT data FROM prefixes WHERE id = ? LIMIT 1;`,
    [prefixId],
  );
  const row = result[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return row.data ? JSON.parse(String(row.data)) : null;
};

// ── Bundle versions ────────────────────────────────────────────────────────

export const getLocalBundleVersion = async (
  bundle: string,
): Promise<number | null> => {
  const result = await executeRead(
    `SELECT version FROM bundle_versions WHERE bundle = ? LIMIT 1;`,
    [bundle],
  );
  const row = result[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return Number(row.version);
};

export const getAllLocalBundleVersions = async (): Promise<
  Record<string, number>
> => {
  const result = await executeRead(
    `SELECT bundle, version FROM bundle_versions;`,
  );
  const versions: Record<string, number> = {};
  for (const row of result) {
    const r = row as Record<string, unknown>;
    // TS2009 is streamed from static chapter JSON, never an offline bundle.
    if (String(r.bundle) !== "ts2009") {
      versions[String(r.bundle)] = Number(r.version);
    }
  }
  return versions;
};

export const setLocalBundleVersion = async (
  bundle: string,
  version: number,
) => {
  await executeWrite(
    `INSERT OR REPLACE INTO bundle_versions (bundle, version, downloaded_at)
     VALUES (?, ?, ?);`,
    [bundle, version, new Date().toISOString()],
  );
};

// ── Clear all offline data ─────────────────────────────────────────────────

export const clearAllOfflineData = async () => {
  await executeWrite("DELETE FROM verses;");
  await executeWrite("DELETE FROM lexicon;");
  await executeWrite("DELETE FROM hebrew_verses;");
  await executeWrite("DELETE FROM dss_variants;");
  await executeWrite("DELETE FROM prefixes;");
  await executeWrite("DELETE FROM bundle_versions;");
};
