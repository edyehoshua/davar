import { type ReactNode, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { NeumorphCard } from "@/src/components/ui/NeumorphCard";
import { getColors, spacing, typography } from "@/src/theme";
import { useAppStore, type AppState } from "@/src/store/useAppStore";
import type { DisplayVerse } from "@/src/services/scripture";
import type { TranslationFootnote } from "@/src/types/api";
import {
  getPrefixSegments,
  stripCantillation,
  stripNikud,
  stripMeteg,
  removeMaqafForDisplay,
  removeSofPasukForDisplay,
} from "@/src/utils/hebrew";
import { useTranslation } from "@/src/i18n/useTranslation";
import { shouldHideTranslationText } from "@/src/utils/translationConfig";
import { getTranslationDisplayText } from "@/src/utils/translationDisplay";
import {
  sanitizeEmTags,
  buildMarkerRegex,
  createFootnoteLookup,
  collectMarkerMatches,
  resolveFootnoteForMarker,
  formatMarkerForDisplay,
} from "@/src/utils/footnoteUtils";

type RenderTranslationOptions = {
  italicStyle: StyleProp<TextStyle>;
  footnoteMarkerStyle: StyleProp<TextStyle>;
  footnoteLookup: Map<string, TranslationFootnote>;
  onFootnotePress?: (footnote: TranslationFootnote) => void;
  renderUnmappedSuperscripts?: boolean;
};

const renderTextSegment = (
  text: string,
  keyPrefix: string,
  markerRegex: RegExp | null,
  footnoteLookup: Map<string, TranslationFootnote>,
  footnoteMarkerStyle: StyleProp<TextStyle>,
  onFootnotePress?: (footnote: TranslationFootnote) => void,
  baseStyle?: StyleProp<TextStyle>,
  renderUnmappedSuperscripts = false,
): ReactNode[] => {
  const sanitized = sanitizeEmTags(text);
  if (!sanitized) {
    return [];
  }

  const markerMatches = collectMarkerMatches(
    sanitized,
    markerRegex,
    renderUnmappedSuperscripts,
  );

  if (markerMatches.length === 0) {
    return baseStyle
      ? [
          <Text key={`${keyPrefix}-text`} style={baseStyle}>
            {sanitized}
          </Text>,
        ]
      : [sanitized];
  }
  const nodes: ReactNode[] = [];

  let lastIndex = 0;

  for (let i = 0; i < markerMatches.length; i += 1) {
    const markerMatch = markerMatches[i];
    const plainText = sanitized.slice(lastIndex, markerMatch.start);
    if (plainText) {
      if (baseStyle) {
        nodes.push(
          <Text key={`${keyPrefix}-text-${i}`} style={baseStyle}>
            {plainText}
          </Text>,
        );
      } else {
        nodes.push(plainText);
      }
    }

    const marker = markerMatch.content;
    const footnote = resolveFootnoteForMarker(footnoteLookup, marker);
    const markerText = formatMarkerForDisplay(marker);

    nodes.push(
      <Text
        key={`${keyPrefix}-marker-${i}`}
        onPress={
          footnote && onFootnotePress
            ? () => onFootnotePress(footnote)
            : undefined
        }
        style={[baseStyle, footnoteMarkerStyle]}
      >
        {markerText}
      </Text>,
    );

    lastIndex = markerMatch.end;
  }

  const trailingText = sanitized.slice(lastIndex);
  if (trailingText) {
    if (baseStyle) {
      nodes.push(
        <Text key={`${keyPrefix}-text-tail`} style={baseStyle}>
          {trailingText}
        </Text>,
      );
    } else {
      nodes.push(trailingText);
    }
  }

  return nodes;
};

const renderTranslationWithItalics = (
  translation: string,
  {
    italicStyle,
    footnoteMarkerStyle,
    footnoteLookup,
    onFootnotePress,
    renderUnmappedSuperscripts = false,
  }: RenderTranslationOptions,
) => {
  const segments: ReactNode[] = [];
  const emPattern = /<em>(.*?)<\/em>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  const markerRegex = buildMarkerRegex(footnoteLookup);

  while ((match = emPattern.exec(translation)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const plainText = translation.slice(lastIndex, start);

    if (plainText) {
      segments.push(
        ...renderTextSegment(
          plainText,
          `plain-${index}`,
          markerRegex,
          footnoteLookup,
          footnoteMarkerStyle,
          onFootnotePress,
          undefined,
          renderUnmappedSuperscripts,
        ),
      );
    }

    segments.push(
      ...renderTextSegment(
        match[1],
        `em-${index}`,
        markerRegex,
        footnoteLookup,
        footnoteMarkerStyle,
        onFootnotePress,
        italicStyle,
        renderUnmappedSuperscripts,
      ),
    );

    lastIndex = end;
    index += 1;
  }

  const trailingText = translation.slice(lastIndex);
  if (trailingText) {
    segments.push(
      ...renderTextSegment(
        trailingText,
        "trailing",
        markerRegex,
        footnoteLookup,
        footnoteMarkerStyle,
        onFootnotePress,
        undefined,
        renderUnmappedSuperscripts,
      ),
    );
  }

  return segments;
};

const normalizeQumranHebrewForDisplay = (value: string): string => {
  const spaced = value.replace(/[\u05BE-]/g, " ");
  const unpointed = stripNikud(stripMeteg(stripCantillation(spaced)));
  const normalized = removeMaqafForDisplay(unpointed.replace(/\//g, ""));
  return normalized
    .replace(/[^\u05D0-\u05EA\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

type VerseCardProps = {
  verse: DisplayVerse;
  onWordPress?: (word: DisplayVerse["words"][number]) => void;
  onVersePress?: () => void;
  onHebrewPressIn?: () => void;
  showWordHint?: boolean;
  selectedWord?: DisplayVerse["words"][number] | null;
  variant?: "card" | "detail";
  isBesorah?: boolean;
};

// Font-specific calibration keeps Cardo and DSS glyph metrics visually aligned
// with the shared hebrewVerseMedium baseline across iOS and Android.
const DETAIL_VARIANT_FONT_SCALE = 0.93;
const HEBREW_SCRIPTURE_FONT_SIZE_MULTIPLIER = 1.0248;
const HEBREW_SCRIPTURE_LINE_HEIGHT_MULTIPLIER = 1.5568;
const HEBREW_QUMRAN_FONT_SIZE_MULTIPLIER = 1.87264;
const HEBREW_QUMRAN_LINE_HEIGHT_MULTIPLIER = 1.4784;

const createStyles = (
  colors: ReturnType<typeof getColors>,
  hebrewScale: number,
  isDetailVariant: boolean,
) => {
  const isDarkMode = colors.background === "#0F0E12";
  const androidPressedBackground = isDarkMode ? "#4A3A2C" : "#D8C6B2";
  const androidPressedBorder = isDarkMode ? "#9A7048" : "#B4834D";
  const androidSelectedBackground = isDarkMode ? "#4F3D2D" : "#DCCBB8";
  const androidSelectedPressedBackground = isDarkMode ? "#5D4631" : "#DAC4AC";

  return StyleSheet.create({
    containerDetail: {
      alignItems: "center",
    },
    translation: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      lineHeight: typography.sizes.body * typography.lineHeights.body,
      color: colors.textPrimary,
      marginTop: spacing[6],
      textAlign: "center",
    },
    translationItalic: {
      fontStyle: "italic",
    },
    translationFootnoteMarker: {
      color: colors.accentCopper,
      fontSize: typography.sizes.caption,
      lineHeight: typography.sizes.caption + 2,
      includeFontPadding: false,
      transform: [{ translateY: -5 }],
    },
    footnoteModalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.35)",
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing[6],
    },
    footnoteModalCard: {
      width: "100%",
      maxWidth: 420,
      borderRadius: 14,
      paddingHorizontal: spacing[5],
      paddingVertical: spacing[4],
      backgroundColor: colors.neomorphBg,
      borderWidth: 1,
      borderColor: colors.neomorphBorder,
    },
    footnoteModalHeading: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.caption,
      color: colors.textSecondary,
      marginBottom: spacing[2],
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    footnoteModalWord: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      color: colors.textPrimary,
      fontWeight: "600",
      marginBottom: spacing[2],
    },
    footnoteModalText: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      lineHeight: typography.sizes.body * typography.lineHeights.body,
      color: colors.textPrimary,
    },
    hebrewRow: {
      flexDirection: "row-reverse",
      flexWrap: "wrap",
      justifyContent: "center",
      columnGap: spacing[2],
      rowGap: spacing[2],
    },
    firstWordRow: {
      flexDirection: "row-reverse",
      alignItems: "center",
    },
    hebrewPrefixRow: {
      flexDirection: "row-reverse",
      alignItems: "center",
    },
    verseNumberPressable: {
      paddingHorizontal: spacing[1],
      paddingVertical: 0,
      marginHorizontal: 0,
    },
    verseNumber: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.caption,
      color: colors.textSecondary,
      letterSpacing: 0.6,
    },
    hebrewWord: {
      fontFamily: typography.families.hebrewScripture,
      fontSize:
        typography.sizes.hebrewVerseMedium *
        hebrewScale *
        HEBREW_SCRIPTURE_FONT_SIZE_MULTIPLIER *
        (isDetailVariant ? DETAIL_VARIANT_FONT_SCALE : 1),
      lineHeight:
        typography.sizes.hebrewVerseMedium *
        hebrewScale *
        HEBREW_SCRIPTURE_LINE_HEIGHT_MULTIPLIER *
        (isDetailVariant ? DETAIL_VARIANT_FONT_SCALE : 1),
      color: colors.textPrimary,
      textAlign: "right",
      writingDirection: "rtl",
      includeFontPadding: false,
    },
    hebrewWordQumran: {
      fontFamily: typography.families.hebrewQumran,
      fontSize:
        typography.sizes.hebrewVerseMedium *
        hebrewScale *
        HEBREW_QUMRAN_FONT_SIZE_MULTIPLIER *
        (isDetailVariant ? DETAIL_VARIANT_FONT_SCALE : 1),
      lineHeight:
        typography.sizes.hebrewVerseMedium *
        hebrewScale *
        HEBREW_QUMRAN_LINE_HEIGHT_MULTIPLIER *
        (isDetailVariant ? DETAIL_VARIANT_FONT_SCALE : 1),
      color: colors.textPrimary,
    },
    hebrewWordPressable: {
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[1],
      marginHorizontal: 2,
      marginVertical: 1,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.neomorphBorder,
      backgroundColor: colors.neomorphBg,
      shadowColor: colors.neomorphShadowDark,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: colors.background === "#0F0E12" ? 0.28 : 0.14,
      shadowRadius: 2,
      elevation: 1,
    },
    wordHintPressable: {
      backgroundColor: "rgba(198, 143, 85, 0.08)",
      borderColor: "rgba(198, 143, 85, 0.26)",
    },
    hebrewWordPressed: {
      backgroundColor: "rgba(198, 143, 85, 0.14)",
      borderColor: "rgba(198, 143, 85, 0.5)",
      shadowColor: colors.accentCopper,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.26,
      shadowRadius: 6,
      ...Platform.select({
        ios: {
          elevation: 3,
          transform: [{ translateY: -1 }],
        },
        android: {
          elevation: 1,
          backgroundColor: androidPressedBackground,
          borderColor: androidPressedBorder,
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          transform: [{ translateY: 0 }],
        },
        default: {},
      }),
    },
    selectedWordPressable: {
      backgroundColor: "rgba(198, 143, 85, 0.32)",
      borderColor: "rgba(198, 143, 85, 0.75)",
      shadowColor: colors.accentCopper,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.34,
      shadowRadius: 7,
      ...Platform.select({
        ios: { elevation: 3 },
        android: {
          elevation: 1,
          backgroundColor: androidSelectedBackground,
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
        },
        default: {},
      }),
    },
    selectedWordPressed: {
      backgroundColor: "rgba(198, 143, 85, 0.4)",
      borderColor: "rgba(198, 143, 85, 0.9)",
      shadowOpacity: 0.4,
      ...Platform.select({
        android: {
          elevation: 1,
          backgroundColor: androidSelectedPressedBackground,
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
        },
        default: {},
      }),
    },
  });
};

export const VerseCard = ({
  verse,
  onWordPress,
  onVersePress,
  onHebrewPressIn,
  showWordHint = false,
  selectedWord = null,
  variant = "card",
  isBesorah = false,
}: VerseCardProps) => {
  const themeMode = useAppStore((state: AppState) => state.themeMode);
  const hebrewFontScale = useAppStore(
    (state: AppState) => state.hebrewFontScale,
  );
  const showQumran = useAppStore((state: AppState) => state.showQumran);
  const hebrewOnly = useAppStore((state: AppState) => state.hebrewOnly);
  const translationOnly = useAppStore(
    (state: AppState) => state.translationOnly,
  );
  const language = useAppStore((state: AppState) => state.language);
  const showCantillation = useAppStore(
    (state: AppState) => state.showCantillation,
  );
  const showNikud = useAppStore((state: AppState) => state.showNikud);
  const { t } = useTranslation();
  const [activeFootnote, setActiveFootnote] = useState<TranslationFootnote | null>(
    null,
  );
  const colors = getColors(themeMode);
  const styles = useMemo(
    () => createStyles(colors, hebrewFontScale, variant === "detail"),
    [colors, hebrewFontScale, variant],
  );
  // Spanish fallback: when the user's language is Spanish but the verse has no
  // Spanish translation available yet, we show a localised placeholder message
  // ("verse.missingSpanishTranslation") instead of an empty string so the user
  // knows the translation is pending rather than missing by error.
  const missingSpanishTranslation = t("verse.missingSpanishTranslation");
  const effectiveTranslationLanguage =
    translationOnly && language === "he" ? "en" : language;
  const translationText = getTranslationDisplayText({
    language: effectiveTranslationLanguage,
    translation: verse.translation,
    missingTranslationText: missingSpanishTranslation,
    hebrewOnly: hebrewOnly && !translationOnly,
  });
  const hideTranslationText = shouldHideTranslationText(
    effectiveTranslationLanguage,
    hebrewOnly && !translationOnly,
  );
  const showHebrewText = !translationOnly;
  const translationFootnoteLookup = useMemo(
    () => createFootnoteLookup(verse.translation_footnotes),
    [verse.translation_footnotes],
  );
  const canShowInteractiveFootnotes =
    effectiveTranslationLanguage === "es" &&
    translationFootnoteLookup.size > 0;
  const translationStyleOverrides = translationOnly
    ? {
        color: colors.textPrimary,
        opacity: 0.84,
        fontSize: typography.sizes.body + 1,
        lineHeight: (typography.sizes.body + 1) * typography.lineHeights.body,
      }
    : null;

  const content = (
    <View style={variant === "detail" ? styles.containerDetail : undefined}>
      {showHebrewText ? (
        <View style={styles.hebrewRow}>
          {(() => {
            let skipUntilIndex = -1;
            return verse.words.map((word, index) => {
            // Multi-word Qumran variants replace the following N-1 Masoretic
            // tokens (span-aware replacement, #103).
            if (index <= skipUntilIndex) {
              return null;
            }
            const wordKey = `${verse.id}-${word.position ?? index}`;
            const isFirst = index === 0;
            const shouldHighlight = showWordHint && isFirst;
            const currentWordPosition = word.position ?? index;
            const selectedWordPosition = selectedWord?.position;
            const isSelectedWord =
              Boolean(selectedWord) &&
              selectedWordPosition === currentWordPosition &&
              selectedWord?.text === word.text &&
              selectedWord?.strong === word.strong;

            const hasVisibleQumranVariant =
              showQumran && Boolean(word.hasQumranVariant);
            const qumranWord = hasVisibleQumranVariant
              ? word.dssWord
              : undefined;
            if (hasVisibleQumranVariant) {
              skipUntilIndex = Math.max(
                skipUntilIndex,
                index + Math.max(word.qumranSpan ?? 1, 1) - 1,
              );
            }

            let displayText =
              typeof qumranWord === "string" && qumranWord.length > 0
                ? qumranWord
                : word.text;
            if (hasVisibleQumranVariant) {
              displayText = normalizeQumranHebrewForDisplay(displayText);
            } else {
              if (!showNikud) {
                displayText = stripNikud(displayText);
              }
              if (!showCantillation) {
                displayText = stripCantillation(displayText);
              }
              displayText = stripMeteg(displayText);
              displayText = displayText.replace(/\//g, "");
              displayText = removeMaqafForDisplay(displayText);
            }
            if (isBesorah) {
              displayText = removeSofPasukForDisplay(displayText);
            }

            const prefixSegments =
              hasVisibleQumranVariant || !word.prefixes?.length
                ? null
                : getPrefixSegments(displayText, word.prefixes);

            const wordStyles: StyleProp<ViewStyle>[] = [
              styles.hebrewWordPressable,
            ];
            if (isSelectedWord) {
              wordStyles.push(styles.selectedWordPressable);
            } else if (shouldHighlight) {
              wordStyles.push(styles.wordHintPressable);
            }

            const renderWordContent = () => {
              if (prefixSegments?.prefixes?.length) {
                return (
                  <View style={styles.hebrewPrefixRow}>
                    <Text
                      style={[styles.hebrewWord, { color: colors.textSecondary }]}
                    >
                      {prefixSegments.prefixes.join("")}
                    </Text>
                    <Text
                      style={[styles.hebrewWord, { color: colors.textPrimary }]}
                    >
                      {prefixSegments.root}
                    </Text>
                  </View>
                );
              }
              return (
                <Text
                  style={
                    hasVisibleQumranVariant
                      ? [styles.hebrewWord, styles.hebrewWordQumran]
                      : styles.hebrewWord
                  }
                >
                  {displayText}
                </Text>
              );
            };

            if (isFirst) {
              return (
                <View key={wordKey} style={styles.firstWordRow}>
                  <Pressable
                    onPressIn={onHebrewPressIn}
                    onPress={onVersePress}
                    style={styles.verseNumberPressable}
                  >
                    <Text style={styles.verseNumber}>[{verse.verse}]</Text>
                  </Pressable>
                  <Pressable
                    onPressIn={onHebrewPressIn}
                    onPress={() => onWordPress?.(word)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      ...wordStyles,
                      pressed ? styles.hebrewWordPressed : null,
                      pressed && isSelectedWord
                        ? styles.selectedWordPressed
                        : null,
                    ]}
                  >
                    {renderWordContent()}
                  </Pressable>
                </View>
              );
            }

            return (
              <Pressable
                key={wordKey}
                onPressIn={onHebrewPressIn}
                onPress={() => onWordPress?.(word)}
                hitSlop={8}
                style={({ pressed }) => [
                  ...wordStyles,
                  pressed ? styles.hebrewWordPressed : null,
                  pressed && isSelectedWord ? styles.selectedWordPressed : null,
                ]}
              >
                {renderWordContent()}
              </Pressable>
            );
            });
          })()}
        </View>
      ) : null}

      {hideTranslationText ? null : (
        <Text style={[styles.translation, translationStyleOverrides]}>
          {translationOnly ? `[${verse.verse}] ` : ""}
          {renderTranslationWithItalics(translationText, {
            italicStyle: styles.translationItalic,
            footnoteMarkerStyle: styles.translationFootnoteMarker,
            footnoteLookup: translationFootnoteLookup,
            onFootnotePress: canShowInteractiveFootnotes
              ? setActiveFootnote
              : undefined,
            renderUnmappedSuperscripts:
              effectiveTranslationLanguage === "es",
          })}
        </Text>
      )}
    </View>
  );

  const wrappedContent =
    variant === "detail" ? content : <NeumorphCard>{content}</NeumorphCard>;

  return (
    <>
      {wrappedContent}
      <Modal
        animationType="fade"
        transparent
        visible={Boolean(activeFootnote)}
        onRequestClose={() => setActiveFootnote(null)}
      >
        <Pressable
          style={styles.footnoteModalOverlay}
          onPress={() => setActiveFootnote(null)}
        >
          <Pressable
            style={styles.footnoteModalCard}
            onPress={(event) => event.stopPropagation()}
          >
            {activeFootnote?.word ? (
              <Text style={styles.footnoteModalWord}>{activeFootnote.word}</Text>
            ) : null}
            <Text style={styles.footnoteModalText}>
              {activeFootnote?.explanation ?? ""}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};
