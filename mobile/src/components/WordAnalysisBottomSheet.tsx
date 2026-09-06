import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import type { BottomSheetMethods } from "@gorhom/bottom-sheet/lib/typescript/types";
import { router } from "expo-router";

import { getColors, radii, spacing, typography } from "@/src/theme";
import { useAppStore, type AppState } from "@/src/store/useAppStore";
import { formatVerseRef } from "@davar/shared/formatVerseRef";
import type { DisplayWord } from "@/src/services/scripture";
import {
  stripCantillation,
  stripNikud,
  getPrefixSegments,
  stripMeteg,
  normalizeHebrewDisplay,
  removeMaqafForDisplay,
  removeSofPasukForDisplay,
  splitLeadingHebrewCluster,
} from "@/src/utils/hebrew";
import { staticDataRequest } from "@/src/services/api";
import type { LexiconResponse } from "@/src/types/api";
import { useTranslation } from "@/src/i18n/useTranslation";
import { fetchLexiconEntry, fetchPrefixEntry } from "@/src/services/database";
import { getDssCommentaryForLanguage } from "@/src/utils/translationConfig";

type PrefixResponse = {
  id: string;
  main_form?: string;
  type?: string;
  transliteration_en?: string;
  transliteration_es?: string;
  meanings?: Record<string, string[]>;
  forms?: string[];
  notes?: Record<string, string>;
};

type WordAnalysisBottomSheetProps = {
  currentVerseId?: string;
  isBesorah?: boolean;
  word?:
    | (DisplayWord & {
        meanings?: string[];
        gloss?: string;
        root?: string;
        rootTransliteration?: string;
        rootMeaning?: string;
        instances?: { verse: string; text: string }[];
        strong?: string;
        translit_en?: string;
        translit_es?: string;
        dss_translit_en?: string;
        dss_translit_es?: string;
        dssWord?: string;
        dssStrong?: string;
        dssCommentaryEn?: string;
        dssCommentaryEs?: string;
        dssCommentaryHe?: string;
      })
    | null;
  // Called after the sheet has fully closed and any exit animations have completed
  onClosed?: () => void;
};

type TabType = "masoretic" | "qumran" | "instances";

type StaticDictionaryDefinition = {
  text?: string;
  text_en?: string;
  text_es?: string;
  source?: string;
};

type StaticDictionaryEntry = {
  strong_number?: string;
  lemma?: string;
  translit_en?: string;
  translit_es?: string;
  transliteration_en?: string;
  transliteration_es?: string;
  definitions?: StaticDictionaryDefinition[];
  root_ref?: string;
  root_strong?: string;
  occurrences?: {
    total?: number;
    references?: string[];
  };
};

type StaticCustomDefinition = {
  strong_number?: string;
  hebrew?: string;
  transliteration_en?: string;
  transliteration_es?: string;
  definitions?: StaticDictionaryDefinition[];
  root?: string;
  root_strong?: string;
  manual_instances?: string[];
  nt_instances?: {
    book?: string;
    chapter?: number;
    verse?: number;
    text?: string;
  }[];
};

type StaticDictionaryData = {
  words: Record<string, StaticDictionaryEntry>;
  roots: Record<string, StaticDictionaryEntry>;
  custom: Record<string, StaticCustomDefinition>;
};

const SUFFIX_MORPH_TO_STRONG: Record<string, string> = {
  Sp1cs: "H589",
  Sp1cp: "H587",
  Sp2ms: "H859",
  Sp2fs: "H859",
  Sp2mp: "H859",
  Sp2fp: "H859",
  Sp3ms: "H1931",
  Sp3fs: "H1931",
  Sp3mp: "H1992",
  Sp3fp: "H2007",
};

const resolveStrongNumber = (
  strong?: string,
  morph?: string,
): string | null => {
  if (strong) {
    const parts = strong.split("/").map((part) => part.trim());
    const strongPart = parts.find((part) => /^[HGD]\d+$/.test(part));
    if (strongPart) {
      return strongPart;
    }
  }

  if (!morph) {
    return null;
  }

  const suffixPart = morph
    .split("/")
    .map((part) => part.trim())
    .find((part) => /^Sp\d[cmfp][sp]$/.test(part));

  if (!suffixPart) {
    return null;
  }

  return SUFFIX_MORPH_TO_STRONG[suffixPart] ?? null;
};

const normalizeStrongKey = (value: string): string =>
  value.toUpperCase().replace(/\s+/g, "");

const resolveStrongKey = <T,>(
  dictionary: Record<string, T>,
  lookup: string,
): string | null => {
  if (lookup in dictionary) {
    return lookup;
  }

  const target = normalizeStrongKey(lookup);
  for (const key of Object.keys(dictionary)) {
    if (normalizeStrongKey(key) === target) {
      return key;
    }
  }

  return null;
};

const mapStaticDefinitions = (
  definitions: StaticDictionaryDefinition[] | undefined,
  language: "en" | "es" | "he",
) => {
  const definitionLanguage = language === "es" ? "es" : "en";
  return (definitions ?? [])
    .map((definition) => {
      const text =
        definitionLanguage === "es"
          ? (definition.text_es ?? definition.text_en ?? definition.text)
          : (definition.text_en ?? definition.text_es ?? definition.text);
      if (!text) {
        return null;
      }
      return {
        text,
        source: definition.source ?? "static",
        language: definitionLanguage,
      };
    })
    .filter((value): value is { text: string; source: string; language: string } =>
      value !== null,
    );
};

const mergeUniqueDefinitions = (
  ...groups: { text: string; source: string; language: string }[][]
): { text: string; source: string; language: string }[] => {
  const seen = new Set<string>();
  const merged: { text: string; source: string; language: string }[] = [];

  for (const group of groups) {
    for (const definition of group) {
      const key = `${definition.source}:${definition.text.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(definition);
    }
  }

  return merged;
};

const isRawDictionaryEntry = (
  value: StaticDictionaryEntry | StaticCustomDefinition | undefined,
): value is StaticDictionaryEntry =>
  Boolean(value && ("lemma" in value || "root_ref" in value));

const loadStaticDictionaryData = async (): Promise<StaticDictionaryData> => {
  const [words, roots, custom] = await Promise.all([
    staticDataRequest<Record<string, StaticDictionaryEntry>>("dict/words.json"),
    staticDataRequest<Record<string, StaticDictionaryEntry>>("dict/roots.json"),
    staticDataRequest<Record<string, StaticCustomDefinition>>(
      "dict/custom_definitions.json",
    ),
  ]);

  return { words, roots, custom };
};

const loadLexiconEntryFromStatic = async (
  strong: string,
  language: "en" | "es" | "he",
): Promise<LexiconResponse | null> => {
  const dictionary = await loadStaticDictionaryData();

  const customKey = resolveStrongKey(dictionary.custom, strong);
  const customEntry = customKey ? dictionary.custom[customKey] : undefined;

  const wordKey = resolveStrongKey(dictionary.words, strong);
  const rootDictionaryKey = resolveStrongKey(dictionary.roots, strong);
  const dictionaryEntry = wordKey
    ? dictionary.words[wordKey]
    : rootDictionaryKey
      ? dictionary.roots[rootDictionaryKey]
      : undefined;

  if (!customEntry && !dictionaryEntry) {
    return null;
  }

  const rootStrong =
    customEntry?.root_strong ??
    dictionaryEntry?.root_ref ??
    dictionaryEntry?.root_strong ??
    (dictionaryEntry
      ? (customEntry?.strong_number ?? dictionaryEntry?.strong_number ?? strong)
      : undefined);

  const rootEntry = rootStrong
    ? (() => {
        const rootKey = resolveStrongKey(dictionary.roots, rootStrong);
        if (rootKey) {
          return dictionary.roots[rootKey] as
            | StaticDictionaryEntry
            | StaticCustomDefinition;
        }
        const wordRootKey = resolveStrongKey(dictionary.words, rootStrong);
        if (wordRootKey) {
          return dictionary.words[wordRootKey] as
            | StaticDictionaryEntry
            | StaticCustomDefinition;
        }
        const customRootKey = resolveStrongKey(dictionary.custom, rootStrong);
        if (customRootKey) {
          return dictionary.custom[customRootKey] as
            | StaticDictionaryEntry
            | StaticCustomDefinition;
        }
        return undefined;
      })()
    : undefined;

  const dictionaryDefinitions = mapStaticDefinitions(
    dictionaryEntry?.definitions,
    language,
  );
  const customDefinitions = mapStaticDefinitions(customEntry?.definitions, language);
  const definitions = mergeUniqueDefinitions(customDefinitions, dictionaryDefinitions);

  const occurrenceReferences = dictionaryEntry?.occurrences?.references ?? [];
  const manualInstances = customEntry?.manual_instances ?? [];
  const ntInstances =
    customEntry?.nt_instances
      ?.map((instance) => {
        if (!instance.book || !instance.chapter || !instance.verse) {
          return null;
        }
        const reference = `${instance.book} ${instance.chapter}:${instance.verse}`;
        return instance.text ? `${reference} ${instance.text}` : reference;
      })
      .filter((instance): instance is string => Boolean(instance)) ?? [];
  const instances = [...manualInstances, ...ntInstances, ...occurrenceReferences];
  const hasManualInstances = manualInstances.length > 0;

  const rootText = rootEntry
    ? "lemma" in rootEntry
      ? rootEntry.lemma
      : "hebrew" in rootEntry
        ? rootEntry.hebrew
        : undefined
    : undefined;

  const rootTranslitEn = isRawDictionaryEntry(rootEntry)
    ? rootEntry.translit_en
    : rootEntry?.transliteration_en;

  const rootTranslitEs = isRawDictionaryEntry(rootEntry)
    ? rootEntry.translit_es
    : rootEntry?.transliteration_es;

  return {
    strong_number: customEntry?.strong_number ?? dictionaryEntry?.strong_number ?? strong,
    hebrew: customEntry?.hebrew ?? dictionaryEntry?.lemma,
    translit_en:
      customEntry?.transliteration_en ??
      dictionaryEntry?.translit_en ??
      dictionaryEntry?.transliteration_en,
    translit_es:
      customEntry?.transliteration_es ??
      dictionaryEntry?.translit_es ??
      dictionaryEntry?.transliteration_es,
    definitions,
    root: customEntry?.root ?? rootText,
    root_strong: rootStrong,
    root_translit_en: rootTranslitEn,
    root_translit_es: rootTranslitEs,
    root_definitions: mapStaticDefinitions(rootEntry?.definitions, language),
    occurrences_count: hasManualInstances
      ? instances.length
      : (dictionaryEntry?.occurrences?.total ?? instances.length),
    instances,
  };
};

const loadPrefixEntryFromStatic = async (
  prefixId: string,
): Promise<PrefixResponse | null> => {
  const prefixes = await staticDataRequest<Record<string, PrefixResponse>>(
    "prefixes.json",
  );
  return prefixes[prefixId] ?? null;
};

const createStyles = (
  colors: ReturnType<typeof getColors>,
  hebrewScale: number,
) => {
  const baseHebrewSize = 48 * hebrewScale;
  const baseHebrewLineHeight = 72 * hebrewScale;
  const qumranSize = baseHebrewSize * (1.9 / 1.06);
  const qumranLineHeight = baseHebrewLineHeight * (1.5 / 1.65);

  return StyleSheet.create({
    content: {
      paddingHorizontal: spacing[6],
      paddingTop: spacing[2],
    },
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
    },
    sheetBackgroundDss: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      borderWidth: 1,
      borderColor: `${colors.accentCopper}66`,
    },
    sheetHandle: {
      backgroundColor: colors.border,
    },
    headerSection: {
      alignItems: "center",
      marginBottom: spacing[6],
    },
    headerWordPressable: {
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[1],
      borderRadius: radii.md,
    },
    hebrew: {
      fontFamily: typography.families.hebrewScripture,
      fontSize: baseHebrewSize,
      color: colors.textPrimary,
      textAlign: "center",
      writingDirection: "rtl",
      lineHeight: baseHebrewLineHeight,
    },
    hebrewQumran: {
      fontFamily: typography.families.hebrewQumran,
      fontSize: qumranSize,
      lineHeight: qumranLineHeight,
      color: colors.textPrimary,
      textDecorationLine: "underline",
    },
    qumranText: {
      color: colors.textPrimary,
      textDecorationLine: "underline",
    },
    transliteration: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.bodySmall,
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 2,
      marginTop: spacing[1],
    },
    occurrencesText: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.caption,
      color: colors.textSecondary,
      textAlign: "center",
      marginTop: spacing[1],
    },
    toggleContainer: {
      flexDirection: "row",
      backgroundColor: colors.background,
      borderRadius: radii.full,
      padding: 4,
      marginBottom: spacing[6],
      borderWidth: 1,
      borderColor: colors.border,
    },
    toggleButton: {
      flex: 1,
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[4],
      borderRadius: radii.full,
      alignItems: "center",
    },
    toggleButtonActive: {
      backgroundColor: colors.primary,
    },
    toggleText: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.bodySmall,
      color: colors.textSecondary,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    toggleTextActive: {
      color: colors.surface,
    },
    secondaryToggleContainer: {
      alignItems: "center",
      marginTop: -spacing[2],
      marginBottom: spacing[6],
    },
    secondaryToggleButton: {
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[4],
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    secondaryToggleButtonActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    secondaryToggleText: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.bodySmall,
      color: colors.textSecondary,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    secondaryToggleTextActive: {
      color: colors.surface,
    },
    sectionLabel: {
      fontFamily: typography.families.latinUIBold,
      fontSize: typography.sizes.caption,
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 1.5,
      textAlign: "center",
      marginBottom: spacing[3],
    },
    sectionDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: spacing[6],
    },
    meaningsText: {
      fontFamily: typography.families.latinMeaning,
      fontSize: typography.sizes.h3,
      color: colors.textPrimary,
      textAlign: "center",
      lineHeight: 28,
    },
    meaningsList: {
      alignItems: "center",
      marginBottom: spacing[4],
    },
    meaningsBullet: {
      fontFamily: typography.families.latinMeaning,
      fontSize: typography.sizes.h3,
      color: colors.textPrimary,
      textAlign: "center",
      lineHeight: 28,
      marginBottom: spacing[2],
    },
    rootSection: {
      marginTop: spacing[8],
      alignItems: "center",
    },
    rootHebrew: {
      fontFamily: typography.families.hebrewScripture,
      fontSize: 40 * hebrewScale,
      color: colors.primary,
      textAlign: "center",
      writingDirection: "rtl",
      lineHeight: 56 * hebrewScale,
    },
    rootTransliteration: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.bodySmall,
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 2,
      marginTop: spacing[1],
    },
    rootStrong: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.bodySmall,
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 2,
      marginTop: spacing[1],
    },
    rootMeaning: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      color: colors.textPrimary,
      textAlign: "center",
      marginTop: spacing[2],
    },
    commentaryText: {
      fontFamily: typography.families.latinMeaning,
      fontSize: typography.sizes.body,
      color: colors.textPrimary,
      textAlign: "center",
      lineHeight: 22,
    },
    instancesContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing[2],
    },
    instancePill: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[3],
      borderRadius: radii.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    instancePillPressed: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    instanceRef: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.bodySmall,
      color: colors.textPrimary,
      fontWeight: "500",
    },
    showMoreButton: {
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[3],
      borderRadius: radii.full,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    showMoreText: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.bodySmall,
      color: colors.primary,
      fontWeight: "600",
    },
    emptyText: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      color: colors.textSecondary,
      textAlign: "center",
      fontStyle: "italic",
    },
    prefixesSection: {
      marginTop: spacing[6],
      alignItems: "center",
    },
    prefixItem: {
      alignItems: "center",
      marginBottom: spacing[4],
    },
    prefixHebrew: {
      fontFamily: typography.families.hebrewScripture,
      fontSize: 40 * hebrewScale,
      color: colors.textSecondary,
      textAlign: "center",
      writingDirection: "rtl",
      lineHeight: 56 * hebrewScale,
    },
    prefixTransliteration: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.bodySmall,
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 2,
      marginTop: spacing[1],
    },
    prefixMeaning: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      color: colors.textPrimary,
      textAlign: "center",
      marginTop: spacing[2],
    },
    prefixText: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      color: colors.textPrimary,
      textAlign: "center",
      marginTop: spacing[1],
    },
  });
};

// Map of book abbreviations to book IDs
const bookAbbreviations: Record<string, string> = {
  Gen: "genesis",
  Exod: "exodus",
  Ex: "exodus",
  Lev: "leviticus",
  Num: "numbers",
  Deut: "deuteronomy",
  Josh: "joshua",
  Judg: "judges",
  Ruth: "ruth",
  "1Sam": "samuel1",
  "2Sam": "samuel2",
  "1Kgs": "kings1",
  "2Kgs": "kings2",
  "1Chr": "chronicles1",
  "2Chr": "chronicles2",
  Ezra: "ezra",
  Neh: "nehemiah",
  Esth: "esther",
  Job: "job",
  Ps: "psalms",
  Prov: "proverbs",
  Eccl: "ecclesiastes",
  Song: "songofsolomon",
  Isa: "isaiah",
  Jer: "jeremiah",
  Lam: "lamentations",
  Ezek: "ezekiel",
  Dan: "daniel",
  Hos: "hosea",
  Joel: "joel",
  Amos: "amos",
  Obad: "obadiah",
  Jonah: "jonah",
  Mic: "micah",
  Nah: "nahum",
  Hab: "habakkuk",
  Zeph: "zephaniah",
  Hag: "haggai",
  Zech: "zechariah",
  Mal: "malachi",
  Matt: "matthew",
  Mark: "mark",
  Luke: "luke",
  John: "john",
  Acts: "acts",
  Rom: "romans",
  "1Cor": "corinthians1",
  "2Cor": "corinthians2",
  Gal: "galatians",
  Eph: "ephesians",
  Phil: "philippians",
  Col: "colossians",
  "1Thess": "thessalonians1",
  "2Thess": "thessalonians2",
  "1Tim": "timothy1",
  "2Tim": "timothy2",
  Titus: "titus",
  Phlm: "philemon",
  Heb: "hebrews",
  Jas: "james",
  "1Pet": "peter1",
  "2Pet": "peter2",
  "1John": "john1",
  "2John": "john2",
  "3John": "john3",
  Jude: "jude",
  Rev: "revelation",
};

const normalizedBookAbbreviations: Record<string, string> =
  Object.entries(bookAbbreviations).reduce<Record<string, string>>(
    (acc, [abbr, bookId]) => {
      acc[abbr.toLowerCase()] = bookId;
      return acc;
    },
    {},
  );

// Parse verse reference like "Gen 1:1" to verse ID like "genesis-1-1"
const parseVerseReference = (ref: string): string | null => {
  const normalizedRef = ref.trim();
  if (!normalizedRef) {
    return null;
  }

  // Supported formats:
  // - Dot format from lexicon data: "gen.1.1"
  // - Human-readable format: "Gen 1:1"
  const dotMatch = normalizedRef.match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/);
  const spacedMatch = normalizedRef
    .replace(/\s+/g, " ")
    .match(/^([1-3]?[A-Za-z]+)\s+(\d+):(\d+)$/);

  const match = dotMatch ?? spacedMatch;
  if (!match) {
    return null;
  }

  const [, bookAbbr, chapterValue, verseValue] = match;
  const bookId = normalizedBookAbbreviations[bookAbbr.toLowerCase()];
  if (!bookId) return null;

  const chapter = Number.parseInt(chapterValue, 10);
  const verse = Number.parseInt(verseValue, 10);
  if (
    !Number.isFinite(chapter) ||
    chapter <= 0 ||
    !Number.isFinite(verse) ||
    verse <= 0
  ) {
    return null;
  }

  return `${bookId}-${chapter}-${verse}`;
};

const normalizeOfflineInstances = (occurrences: unknown): string[] => {
  if (Array.isArray(occurrences)) {
    return occurrences
      .map((value) => {
        if (typeof value === "string") {
          return value;
        }
        if (value && typeof value === "object") {
          const verse = (value as { verse?: unknown }).verse;
          return typeof verse === "string" ? verse : null;
        }
        return null;
      })
      .filter((value): value is string => value !== null);
  }

  if (occurrences && typeof occurrences === "object") {
    const references = (occurrences as { references?: unknown }).references;
    if (Array.isArray(references)) {
      return references.filter(
        (value): value is string => typeof value === "string",
      );
    }
  }

  return [];
};

const getOfflineOccurrencesCount = (
  occurrences: unknown,
  instances: string[],
): number => {
  if (occurrences && typeof occurrences === "object") {
    const total = (occurrences as { total?: unknown }).total;
    if (typeof total === "number" && Number.isFinite(total) && total >= 0) {
      return total;
    }
  }

  return instances.length;
};

const WordAnalysisBottomSheetComponent = (
  {
    word,
    currentVerseId,
    isBesorah = false,
    onClosed,
  }: WordAnalysisBottomSheetProps,
  ref: React.ForwardedRef<BottomSheetMethods>,
) => {
  const sheetRef = useRef<BottomSheetMethods | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      expand: () => sheetRef.current?.expand(),
      collapse: () => sheetRef.current?.collapse(),
      close: () => sheetRef.current?.close(),
      forceClose: () => sheetRef.current?.forceClose(),
      snapToIndex: (index: number) => sheetRef.current?.snapToIndex(index),
      snapToPosition: (position: number | string) =>
        sheetRef.current?.snapToPosition(position),
    }),
    [],
  );
  const themeMode = useAppStore((state: AppState) => state.themeMode);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const hebrewFontScale = useAppStore(
    (state: AppState) => state.hebrewFontScale,
  );
  const language = useAppStore((state: AppState) => state.language);
  const { t } = useTranslation();
  const colors = getColors(themeMode);
  const styles = useMemo(
    () => createStyles(colors, hebrewFontScale),
    [colors, hebrewFontScale],
  );
  const snapPoints = useMemo(() => {
    const minHeight = Math.max(0, screenHeight * 0.5);
    const maxHeight = Math.max(0, screenHeight * 0.8);
    if (maxHeight <= minHeight) {
      return [minHeight];
    }
    return [minHeight, maxHeight];
  }, [screenHeight]);
  const [activeTab, setActiveTab] = useState<TabType>("masoretic");
  const [lexiconEntry, setLexiconEntry] = useState<LexiconResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [dssLexiconEntry, setDssLexiconEntry] =
    useState<LexiconResponse | null>(null);
  const [isDssLoading, setIsDssLoading] = useState(false);
  const [showAllInstances, setShowAllInstances] = useState(false);
  const [prefixEntries, setPrefixEntries] = useState<
    Record<string, PrefixResponse | null>
  >({});
  const showNikud = useAppStore((state: AppState) => state.showNikud);
  const showCantillation = useAppStore(
    (state: AppState) => state.showCantillation,
  );
  const hasDssVariant = Boolean(
    word?.dssWord ||
    word?.dssStrong ||
    word?.dssCommentaryEn ||
    word?.dssCommentaryEs ||
    word?.dssCommentaryHe,
  );
  const strongNumber = useMemo(() => {
    return resolveStrongNumber(word?.strong, word?.morph);
  }, [word?.strong, word?.morph]);

  const dssStrongNumber = useMemo(() => {
    return resolveStrongNumber(word?.dssStrong, undefined);
  }, [word?.dssStrong]);
  // Keep in sync with web/src/app/App.tsx transliteration selection logic.
  const wordTransliteration = useMemo(() => {
    const masoreticTranslit =
      language === "en"
        ? (word?.translit_en ?? lexiconEntry?.translit_en)
        : language === "es"
          ? (word?.translit_es ?? lexiconEntry?.translit_es)
          : undefined;

    if (activeTab === "qumran") {
      const qumranTranslitFromWord =
        language === "en"
          ? word?.dss_translit_en
          : language === "es"
            ? word?.dss_translit_es
            : undefined;
      if (qumranTranslitFromWord) return qumranTranslitFromWord;

      if (dssStrongNumber && strongNumber && dssStrongNumber === strongNumber) {
        return masoreticTranslit;
      }
      const strongTranslit =
        language === "en"
          ? dssLexiconEntry?.translit_en
          : language === "es"
            ? dssLexiconEntry?.translit_es
            : undefined;
      if (strongTranslit) return strongTranslit;
    }
    return masoreticTranslit;
  }, [
    activeTab,
    language,
    word?.translit_en,
    word?.translit_es,
    word?.dss_translit_en,
    word?.dss_translit_es,
    lexiconEntry?.translit_en,
    lexiconEntry?.translit_es,
    dssLexiconEntry?.translit_en,
    dssLexiconEntry?.translit_es,
    strongNumber,
    dssStrongNumber,
  ]);

  const displayHebrew = useMemo(() => {
    const baseWord =
      activeTab === "qumran" && word?.dssWord
        ? word.dssWord
        : (word?.text ?? lexiconEntry?.hebrew ?? "—");
    let base = baseWord;
    if (!showNikud) {
      base = stripNikud(base);
    }
    if (!showCantillation) {
      base = stripCantillation(base);
    }
    base = stripMeteg(base);
    base = removeMaqafForDisplay(
      normalizeHebrewDisplay(base).replace(/\//g, ""),
    );
    if (isBesorah) {
      base = removeSofPasukForDisplay(base);
    }
    return base;
  }, [
    activeTab,
    isBesorah,
    lexiconEntry?.hebrew,
    word?.dssWord,
    word?.text,
    showNikud,
    showCantillation,
  ]);

  const prefixSegments = useMemo(() => {
    if (!word?.text || !word?.prefixes?.length) {
      return { prefixes: [], root: word?.text ?? "" };
    }
    let displayBase = normalizeHebrewDisplay(
      stripMeteg(stripCantillation(word.text)),
    );
    if (!showNikud) {
      displayBase = stripNikud(displayBase);
    }
    displayBase = removeMaqafForDisplay(displayBase.replace(/\//g, ""));
    if (isBesorah) {
      displayBase = removeSofPasukForDisplay(displayBase);
    }
    return getPrefixSegments(displayBase, word.prefixes);
  }, [isBesorah, showNikud, word?.text, word?.prefixes]);

  useEffect(() => {
    const loadLexicon = async () => {
      if (!strongNumber) {
        setLexiconEntry(null);
        return;
      }
      setIsLoading(true);
      try {
        let entry: LexiconResponse | null = null;
        try {
          entry = await loadLexiconEntryFromStatic(strongNumber, language);
        } catch {
          entry = null;
        }
        if (!entry) {
          try {
            const offlineEntry = await fetchLexiconEntry(strongNumber);
            if (offlineEntry) {
              const instances = normalizeOfflineInstances(offlineEntry.occurrences);
              entry = {
                strong_number: String(offlineEntry.strong ?? strongNumber),
                hebrew: offlineEntry.hebrew
                  ? String(offlineEntry.hebrew)
                  : undefined,
                definitions: Array.isArray(offlineEntry.definitions)
                  ? (offlineEntry.definitions as LexiconResponse["definitions"])
                  : [],
                root: offlineEntry.root ? String(offlineEntry.root) : undefined,
                root_strong: offlineEntry.root_strong
                  ? String(offlineEntry.root_strong)
                  : undefined,
                root_definitions: [],
                occurrences_count: getOfflineOccurrencesCount(
                  offlineEntry.occurrences,
                  instances,
                ),
                instances,
              };
            }
          } catch {
            entry = null;
          }
        }
        setLexiconEntry(entry);
      } finally {
        setIsLoading(false);
      }
    };
    loadLexicon();
  }, [strongNumber, language, word?.text]);

  useEffect(() => {
    const loadDssLexicon = async () => {
      if (!dssStrongNumber) {
        setDssLexiconEntry(null);
        return;
      }
      setIsDssLoading(true);
      try {
        let entry: LexiconResponse | null = null;
        try {
          entry = await loadLexiconEntryFromStatic(dssStrongNumber, language);
        } catch {
          entry = null;
        }
        if (!entry) {
          try {
            const offlineEntry = await fetchLexiconEntry(dssStrongNumber);
            if (offlineEntry) {
              const instances = normalizeOfflineInstances(offlineEntry.occurrences);
              entry = {
                strong_number: String(offlineEntry.strong ?? dssStrongNumber),
                hebrew: offlineEntry.hebrew
                  ? String(offlineEntry.hebrew)
                  : undefined,
                definitions: Array.isArray(offlineEntry.definitions)
                  ? (offlineEntry.definitions as LexiconResponse["definitions"])
                  : [],
                root: offlineEntry.root ? String(offlineEntry.root) : undefined,
                root_strong: offlineEntry.root_strong
                  ? String(offlineEntry.root_strong)
                  : undefined,
                root_definitions: [],
                occurrences_count: getOfflineOccurrencesCount(
                  offlineEntry.occurrences,
                  instances,
                ),
                instances,
              };
            }
          } catch {
            entry = null;
          }
        }
        setDssLexiconEntry(entry);
      } finally {
        setIsDssLoading(false);
      }
    };
    loadDssLexicon();
  }, [dssStrongNumber, language, word?.dssWord]);

  useEffect(() => {
    // Reset to default tab when a new word is selected
    setActiveTab(hasDssVariant ? "qumran" : "masoretic");
    setShowAllInstances(false);
  }, [word?.strong, word?.dssStrong, hasDssVariant]);

  useEffect(() => {
    if (!hasDssVariant && activeTab === "qumran") {
      setActiveTab("masoretic");
    }
  }, [activeTab, hasDssVariant]);

  useEffect(() => {
    const loadPrefixes = async () => {
      if (!word?.prefixes?.length) {
        setPrefixEntries({});
        return;
      }

      const entries: Record<string, PrefixResponse | null> = {};
      await Promise.all(
        word.prefixes.map(async (prefixId) => {
          try {
            const entry = await loadPrefixEntryFromStatic(prefixId);
            entries[prefixId] = entry;
          } catch {
            // Static fetch failed — try offline SQLite fallback
            try {
              const offlineEntry = await fetchPrefixEntry(prefixId);
              entries[prefixId] = offlineEntry
                ? ({
                    id: prefixId,
                    ...(offlineEntry as object),
                  } as PrefixResponse)
                : null;
            } catch {
              entries[prefixId] = null;
            }
          }
        }),
      );

      setPrefixEntries(entries);
    };

    loadPrefixes();
  }, [word?.prefixes]);

  useEffect(() => {
    // Clear lexicon and prefix entries when the current verse changes to avoid showing stale data
    setLexiconEntry(null);
    setDssLexiconEntry(null);
    setPrefixEntries({});
  }, [currentVerseId]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleSheetClose = useCallback(() => {
    onClosed?.();
  }, [onClosed]);

  const handleCopyWord = useCallback(async () => {
    if (!displayHebrew || displayHebrew === "—") return;
    try {
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(displayHebrew);
      const message = t("wordCard.copiedToClipboard");
      if (Platform.OS === "android") {
        ToastAndroid.show(message, ToastAndroid.SHORT);
        return;
      }
      Alert.alert(message);
    } catch {
      Alert.alert("Clipboard module unavailable on this build.");
    }
  }, [displayHebrew, t]);

  const meaningsList = useMemo(() => {
    const normalizeForDisplay = (t: string) =>
      stripCantillation(stripNikud(t)).replace(/\//g, "").trim();

    const formatMeaning = (text: string) => {
      const cleaned = text.replace(/^[-–—]\s*/, "").trim();
      if (!cleaned) return cleaned;
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    };

    let rawMeanings: string[] = [];
    if (lexiconEntry?.definitions?.length) {
      rawMeanings = lexiconEntry.definitions
        .map((item) => (item.text ? normalizeForDisplay(item.text) : ""))
        .filter(Boolean);
    } else if (!word) {
      return ["—"];
    } else if (word.morph?.includes("Np")) {
      return [t("wordCard.properName")];
    } else if (!word.meanings?.length && !word.gloss) {
      return [t("wordCard.definitionNotAvailable")];
    } else {
      const meanings = word.meanings?.length ? word.meanings : [word.gloss];
      // If user language is not Hebrew, prefer Latin-script meanings to avoid mixing languages
      const preferLatin = language !== "he";
      const isLatin = (s: string) => /[A-Za-zÀ-ž0-9]/.test(s);
      rawMeanings = meanings
        .map((m) => (m ? normalizeForDisplay(m) : ""))
        .filter(Boolean)
        .filter((m) => (preferLatin ? isLatin(m) : true));

      // If filtering removed all items and we have raw ones, fall back to unfiltered normalized list
      if (!rawMeanings.length && meanings) {
        rawMeanings = meanings
          .map((m) => (m ? normalizeForDisplay(m) : ""))
          .filter(Boolean);
      }
    }

    const formatted = rawMeanings.map((item) => formatMeaning(item));
    return formatted.length ? formatted : ["—"];
  }, [lexiconEntry, word, language, t]);

  const dssMeaningsList = useMemo(() => {
    const normalizeForDisplay = (t: string) =>
      stripCantillation(stripNikud(t)).replace(/\//g, "").trim();

    const formatMeaning = (text: string) => {
      const cleaned = text.replace(/^[-–—]\s*/, "").trim();
      if (!cleaned) return cleaned;
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    };

    if (!dssLexiconEntry?.definitions?.length) {
      return ["—"];
    }

    const rawMeanings = dssLexiconEntry.definitions
      .map((item) => (item.text ? normalizeForDisplay(item.text) : ""))
      .filter(Boolean);

    const formatted = rawMeanings.map((item) => formatMeaning(item));
    return formatted.length ? formatted : ["—"];
  }, [dssLexiconEntry]);

  const formatRootMeaningText = (text: string) => {
    if (text === "ALREADY ROOT") {
      return t("wordCard.alreadyRoot");
    }
    if (text === "—") {
      return text;
    }
    const cleaned = text.replace(/^[-–—]\s*/, "").trim();
    if (!cleaned) return cleaned;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  };

  const isDerivedRoot = Boolean(lexiconEntry?.root_strong || word?.root);

  const rootMeaningText = useMemo(() => {
    // If this entry is itself a root, show ALREADY ROOT
    if (!isDerivedRoot) return "ALREADY ROOT";

    if (lexiconEntry?.root_definitions?.length) {
      return (
        lexiconEntry.root_definitions.map((item) => item.text).join(", ") || "—"
      );
    }
    if (!word?.rootMeaning) return "—";
    return word.rootMeaning;
  }, [lexiconEntry, word, isDerivedRoot]);

  const isDssDerivedRoot = Boolean(
    dssLexiconEntry?.root_strong || dssLexiconEntry?.root,
  );

  const dssRootMeaningText = useMemo(() => {
    if (!isDssDerivedRoot) return "ALREADY ROOT";
    if (dssLexiconEntry?.root_definitions?.length) {
      return (
        dssLexiconEntry.root_definitions.map((item) => item.text).join(", ") ||
        "—"
      );
    }
    return "—";
  }, [dssLexiconEntry, isDssDerivedRoot]);

  const dssCommentary = useMemo(() => {
    if (!word) return undefined;
    return getDssCommentaryForLanguage(language, word);
  }, [language, word]);

  const isQumranTab = hasDssVariant && activeTab === "qumran";
  const activeStrongNumber = isQumranTab ? dssStrongNumber : strongNumber;
  const occurrencesCount = lexiconEntry?.occurrences_count ?? 0;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backgroundStyle={
        hasDssVariant ? styles.sheetBackgroundDss : styles.sheetBackground
      }
      handleIndicatorStyle={styles.sheetHandle}
      onClose={handleSheetClose}
      backdropComponent={renderBackdrop}
      animateOnMount={false}
    >
      <BottomSheetScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: spacing[8] + insets.bottom }}
      >
        {/* Show empty state when no word is selected */}
        {!word ? (
          <View style={styles.headerSection}>
            <Text style={styles.emptyText}>
              {t("wordCard.selectWordPrompt")}
            </Text>
          </View>
        ) : (
          <>
            {/* Header: Hebrew word + transliteration */}
            <View style={styles.headerSection}>
              <Pressable
                onPress={handleCopyWord}
                style={styles.headerWordPressable}
              >
                <Text style={[styles.hebrew, isQumranTab && styles.hebrewQumran]}>
                  {prefixSegments.prefixes.length > 0 && !isQumranTab ? (
                    <>
                      <Text style={{ color: colors.textSecondary }}>
                        {prefixSegments.prefixes.join("")}
                      </Text>
                      <Text style={{ color: colors.textPrimary }}>
                        {prefixSegments.root}
                      </Text>
                    </>
                  ) : (
                    displayHebrew
                  )}
                </Text>
              </Pressable>
              {wordTransliteration ? (
                <Text style={styles.transliteration}>
                  {wordTransliteration}
                </Text>
              ) : null}
              {occurrencesCount > 0 && !isQumranTab && (
                <Text style={styles.occurrencesText}>
                  {t("wordCard.appearsCount", {
                    count: occurrencesCount,
                  })}
                </Text>
              )}
              {activeStrongNumber ? (
                <Text style={styles.occurrencesText}>{activeStrongNumber}</Text>
              ) : null}
            </View>

            {/* Toggle: Qumran / Masoretic */}
            <View style={styles.toggleContainer}>
              {hasDssVariant ? (
                <Pressable
                  style={[
                    styles.toggleButton,
                    activeTab === "qumran" && styles.toggleButtonActive,
                  ]}
                  onPress={() => setActiveTab("qumran")}
                >
                  <Text
                    style={[
                      styles.toggleText,
                      activeTab === "qumran" && styles.toggleTextActive,
                    ]}
                  >
                    {t("wordCard.qumran")}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[
                  styles.toggleButton,
                  activeTab === "masoretic" && styles.toggleButtonActive,
                ]}
                onPress={() => setActiveTab("masoretic")}
              >
                <Text
                  style={[
                    styles.toggleText,
                    activeTab === "masoretic" && styles.toggleTextActive,
                  ]}
                >
                  {hasDssVariant
                    ? t("wordCard.masoretic")
                    : t("wordCard.meanings")}
                </Text>
              </Pressable>
              {!hasDssVariant ? (
                <Pressable
                  style={[
                    styles.toggleButton,
                    activeTab === "instances" && styles.toggleButtonActive,
                  ]}
                  onPress={() => setActiveTab("instances")}
                >
                  <Text
                    style={[
                      styles.toggleText,
                      activeTab === "instances" && styles.toggleTextActive,
                    ]}
                  >
                    {t("wordCard.instances")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {hasDssVariant ? (
              <View style={styles.secondaryToggleContainer}>
                <Pressable
                  style={[
                    styles.secondaryToggleButton,
                    activeTab === "instances" &&
                      styles.secondaryToggleButtonActive,
                  ]}
                  onPress={() => setActiveTab("instances")}
                >
                  <Text
                    style={[
                      styles.secondaryToggleText,
                      activeTab === "instances" &&
                        styles.secondaryToggleTextActive,
                    ]}
                  >
                    {t("wordCard.instances")}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* Tab Content */}
            {activeTab === "masoretic" ? (
              <>
                {/* Meanings section */}
                <Text style={styles.sectionLabel}>
                  {t("wordCard.meanings")}
                </Text>
                {isLoading ? (
                  <Text style={styles.emptyText}>
                    {t("wordCard.loadingDefinitions")}
                  </Text>
                ) : null}
                <View style={styles.meaningsList}>
                  {meaningsList.map((meaning, index) => (
                    <Text
                      key={`${meaning}-${index}`}
                      style={styles.meaningsBullet}
                    >
                      {meaning}
                    </Text>
                  ))}
                </View>

                {word?.prefixes?.length ? (
                  <>
                    <View style={styles.sectionDivider} />
                    <View style={styles.prefixesSection}>
                      <Text style={styles.sectionLabel}>
                        {t("wordCard.preposition")}
                      </Text>
                      {word.prefixes.map((prefix, index) => {
                        const entry = prefixEntries[prefix];
                        const meanings =
                          entry?.meanings?.[language] ??
                          entry?.meanings?.en ??
                          entry?.meanings?.es ??
                          [];
                        const transliteration =
                          language === "es"
                            ? entry?.transliteration_es
                            : (entry?.transliteration_en ??
                              entry?.transliteration_es);
                        const prefixText =
                          prefixSegments.prefixes[index]?.replace(/\//g, "") ??
                          entry?.main_form ??
                          "";
                        const { head: prefixHead, tail: prefixTail } =
                          splitLeadingHebrewCluster(prefixText);

                        return (
                          <View
                            key={`${prefix}-${index}`}
                            style={styles.prefixItem}
                          >
                            <Text style={styles.prefixHebrew}>
                              {prefixHead && (
                                <>
                                  <Text style={{ color: colors.textSecondary }}>
                                    {prefixHead}
                                  </Text>
                                  {prefixTail.length > 0 && (
                                    <Text style={{ color: colors.textPrimary }}>
                                      {prefixTail}
                                    </Text>
                                  )}
                                </>
                              )}
                            </Text>
                            {transliteration ? (
                              <Text style={styles.prefixTransliteration}>
                                {transliteration}
                              </Text>
                            ) : null}
                            {meanings.length ? (
                              <Text style={styles.prefixMeaning}>
                                {meanings.join(", ")}
                              </Text>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  </>
                ) : null}

                <View style={styles.sectionDivider} />
                {/* Root section */}
                <View style={styles.rootSection}>
                  <Text style={styles.sectionLabel}>{t("wordCard.root")}</Text>
                  {lexiconEntry?.root ||
                  word?.root ||
                  lexiconEntry?.root_strong ? (
                    <>
                      <Text style={styles.rootHebrew}>
                        {(lexiconEntry?.root ?? word?.root ?? "").replace(
                          /\//g,
                          "",
                        )}
                      </Text>
                      {(language === "en"
                        ? lexiconEntry?.root_translit_en
                        : lexiconEntry?.root_translit_es) ||
                      word?.rootTransliteration ? (
                        <Text style={styles.rootTransliteration}>
                          {(language === "en"
                            ? lexiconEntry?.root_translit_en
                            : lexiconEntry?.root_translit_es) ??
                            word?.rootTransliteration}
                        </Text>
                      ) : null}
                      {lexiconEntry?.root_strong ? (
                        <Text style={styles.rootStrong}>
                          {lexiconEntry.root_strong}
                        </Text>
                      ) : null}
                      {/* Show meaning only if root differs from word */}
                      {lexiconEntry?.root_strong &&
                        strongNumber &&
                        lexiconEntry.root_strong !== strongNumber && (
                          <Text style={styles.rootMeaning}>
                            {formatRootMeaningText(rootMeaningText)}
                          </Text>
                        )}
                    </>
                  ) : (
                    <Text style={styles.rootMeaning}>
                      {t("wordCard.alreadyRoot")}
                    </Text>
                  )}
                </View>
              </>
            ) : activeTab === "qumran" ? (
              <>
                <Text style={styles.sectionLabel}>
                  {t("wordCard.commentary")}
                </Text>
                <Text style={styles.commentaryText}>
                  {dssCommentary ?? "—"}
                </Text>

                <View style={styles.sectionDivider} />
                <Text style={styles.sectionLabel}>
                  {t("wordCard.meanings")}
                </Text>
                {isDssLoading ? (
                  <Text style={styles.emptyText}>
                    {t("wordCard.loadingDefinitions")}
                  </Text>
                ) : null}
                <View style={styles.meaningsList}>
                  {dssMeaningsList.map((meaning, index) => (
                    <Text
                      key={`${meaning}-${index}`}
                      style={styles.meaningsBullet}
                    >
                      {meaning}
                    </Text>
                  ))}
                </View>

                <View style={styles.sectionDivider} />
                <View style={styles.rootSection}>
                  <Text style={styles.sectionLabel}>{t("wordCard.root")}</Text>
                  {dssLexiconEntry?.root || dssLexiconEntry?.root_strong ? (
                    <Text style={styles.rootHebrew}>
                      {(
                        dssLexiconEntry?.root ??
                        dssLexiconEntry?.hebrew ??
                        displayHebrew
                      ).replace(/\//g, "")}
                    </Text>
                  ) : null}
                  {(
                    language === "en"
                      ? dssLexiconEntry?.root_translit_en
                      : dssLexiconEntry?.root_translit_es
                  ) ? (
                    <Text style={styles.rootTransliteration}>
                      {language === "en"
                        ? dssLexiconEntry?.root_translit_en
                        : dssLexiconEntry?.root_translit_es}
                    </Text>
                  ) : null}
                  {dssLexiconEntry?.root_strong ? (
                    <Text style={styles.rootStrong}>
                      {dssLexiconEntry.root_strong}
                    </Text>
                  ) : null}
                  {/* Show meaning only if root differs from word or if no specific DSS root */}
                  {dssLexiconEntry?.root || dssLexiconEntry?.root_strong ? (
                    dssLexiconEntry.root_strong &&
                    dssStrongNumber &&
                    dssLexiconEntry.root_strong !== dssStrongNumber ? (
                      <Text style={styles.rootMeaning}>
                        {formatRootMeaningText(dssRootMeaningText)}
                      </Text>
                    ) : null
                  ) : (
                    <Text style={styles.rootMeaning}>
                      {t("wordCard.alreadyRoot")}
                    </Text>
                  )}
                </View>
              </>
            ) : (
              <>
                {/* Instances section */}
                <Text style={styles.sectionLabel}>
                  {t("wordCard.appearsIn")}
                </Text>
                {lexiconEntry?.instances?.length || word?.instances?.length ? (
                  <View style={styles.instancesContainer}>
                    {(
                      (lexiconEntry?.instances ?? word?.instances ?? []) as (
                        | string
                        | { verse: string; text: string }
                      )[]
                    )
                      .slice(0, showAllInstances ? undefined : 10)
                      .map((instance, index) => {
                        const verseRef =
                          typeof instance === "string"
                            ? instance
                            : instance.verse;
                        return (
                          <Pressable
                            key={`${verseRef}-${index}`}
                            style={({ pressed }) => [
                              styles.instancePill,
                              pressed && styles.instancePillPressed,
                            ]}
                            onPress={() => {
                              const verseId = parseVerseReference(verseRef);
                              if (verseId) {
                                sheetRef.current?.close();
                                router.push({
                                  pathname: "/verse-detail",
                                  params: { id: verseId },
                                });
                              }
                            }}
                          >
                            <Text style={styles.instanceRef}>{formatVerseRef(verseRef, language)}</Text>
                          </Pressable>
                        );
                      })}
                    {!showAllInstances &&
                    (lexiconEntry?.instances?.length ??
                      word?.instances?.length ??
                      0) > 10 ? (
                      <Pressable
                        style={styles.showMoreButton}
                        onPress={() => setShowAllInstances(true)}
                      >
                        <Text style={styles.showMoreText}>
                          {t("wordCard.showMore", {
                            count:
                              (lexiconEntry?.instances?.length ??
                                word?.instances?.length ??
                                0) - 10,
                          })}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.emptyText}>
                    {t("wordCard.noInstances")}
                  </Text>
                )}
              </>
            )}
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
};

export const WordAnalysisBottomSheet = React.forwardRef(
  WordAnalysisBottomSheetComponent,
);
