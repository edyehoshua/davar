import { FullChapterView } from "@/src/components/FullChapterView";
import {
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  FlatList,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useLocalSearchParams, useNavigation } from "expo-router";
import type { BottomSheetMethods } from "@gorhom/bottom-sheet/lib/typescript/types";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { ParamListBase } from "@react-navigation/native";
import { VerseCard } from "@/src/components/VerseCard";
import { VerseCardSkeleton } from "@/src/components/VerseCardSkeleton";
import { WordAnalysisBottomSheet } from "@/src/components/WordAnalysisBottomSheet";
import {
  NavigationSheet,
  type NavigationSheetMethods,
} from "@/src/components/NavigationSheet";
import { BookChapterPill } from "@/src/components/ui/BookChapterPill";
import { getColors, getResponsiveLayout, spacing, typography } from "@/src/theme";
import { fetchMetadata } from "@/src/services/metadata";
import type { BookResponse, TranslationFootnote } from "@/src/types/api";
import {
  fetchChapterVerses,
  type DisplayVerse,
} from "@/src/services/scripture";
import { useAppStore, type AppState } from "@/src/store/useAppStore";
import { useTranslation } from "@/src/i18n/useTranslation";
import {
  loadBesorahDisclaimerCount,
  loadHutterAnnouncementSeen,
  loadSwipeUpHintCount,
  saveBesorahDisclaimerCount,
  saveHutterAnnouncementSeen,
  saveSwipeUpHintCount,
} from "@/src/services/storage";
import { formatBookDisplayName } from "../utils/bookNameFormatter";
import {
  sanitizeEmTags,
  buildMarkerRegex,
  createFootnoteLookup,
  DEFAULT_FOOTNOTE_MARKER_COLOR,
  collectMarkerMatches,
  resolveFootnoteForMarker,
  formatMarkerForDisplay,
} from "@/src/utils/footnoteUtils";
import { stripCantillation, stripMeteg, stripNikud } from "@/src/utils/hebrew";

const SWIPE_HINT_MAX_SHOWS = 5;

const renderTranslationSegment = (
  text: string,
  keyPrefix: string,
  markerRegex: RegExp | null,
  footnoteLookup: Map<string, TranslationFootnote>,
  onFootnotePress?: (footnote: TranslationFootnote) => void,
  isItalic = false,
  markerColor = DEFAULT_FOOTNOTE_MARKER_COLOR,
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
    return isItalic
      ? [
          <Text key={`${keyPrefix}-italic`} style={{ fontStyle: "italic" }}>
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
      if (isItalic) {
        nodes.push(
          <Text key={`${keyPrefix}-text-${i}`} style={{ fontStyle: "italic" }}>
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
        style={{
          color: markerColor,
          fontSize: typography.sizes.caption,
          lineHeight: typography.sizes.caption + 2,
          includeFontPadding: false,
          transform: [{ translateY: -5 }],
        }}
      >
        {markerText}
      </Text>,
    );

    lastIndex = markerMatch.end;
  }

  const trailingText = sanitized.slice(lastIndex);
  if (trailingText) {
    if (isItalic) {
      nodes.push(
        <Text key={`${keyPrefix}-text-tail`} style={{ fontStyle: "italic" }}>
          {trailingText}
        </Text>,
      );
    } else {
      nodes.push(trailingText);
    }
  }

  return nodes;
};

const renderTranslationFlowText = (
  translation: string,
  footnotes?: TranslationFootnote[],
  onFootnotePress?: (footnote: TranslationFootnote) => void,
  markerColor = DEFAULT_FOOTNOTE_MARKER_COLOR,
  renderUnmappedSuperscripts = false,
): ReactNode[] => {
  const footnoteLookup = createFootnoteLookup(footnotes);
  const markerRegex = buildMarkerRegex(footnoteLookup);

  const segments: ReactNode[] = [];
  const emPattern = /<em>(.*?)<\/em>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = emPattern.exec(translation)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    const plainText = translation.slice(lastIndex, start);
    if (plainText) {
      segments.push(
        ...renderTranslationSegment(
          plainText,
          `plain-${index}`,
          markerRegex,
          footnoteLookup,
          onFootnotePress,
          false,
          markerColor,
          renderUnmappedSuperscripts,
        ),
      );
    }

    segments.push(
      ...renderTranslationSegment(
        match[1],
        `em-${index}`,
        markerRegex,
        footnoteLookup,
        onFootnotePress,
        true,
        markerColor,
        renderUnmappedSuperscripts,
      ),
    );

    lastIndex = end;
    index += 1;
  }

  const trailingText = translation.slice(lastIndex);
  if (trailingText) {
    segments.push(
      ...renderTranslationSegment(
        trailingText,
        "trailing",
        markerRegex,
        footnoteLookup,
        onFootnotePress,
        false,
        markerColor,
        renderUnmappedSuperscripts,
      ),
    );
  }

  return segments;
};

type TabPressEvent = {
  preventDefault: () => void;
};

const createStyles = (colors: ReturnType<typeof getColors>, layout: ReturnType<typeof getResponsiveLayout>) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
    },
    navigationRow: {
      position: "absolute",
      top: spacing[16],
      left: 0,
      right: 0,
      alignItems: "center",
      zIndex: 10,
      elevation: 10,
    },
    swipeHintRow: {
      position: "absolute",
      left: spacing[4],
      right: spacing[4],
      alignItems: "center",
      zIndex: 12,
      elevation: 12,
    },
    swipeHintText: {
      fontFamily: typography.families.latinUI,
      fontSize: 10,
      color: colors.textSecondary,
      textAlign: "center",
    },
    chapterTranslationScroll: {
      flex: 1,
      paddingHorizontal: layout.horizontalPadding,
      paddingBottom: spacing[8],
    },
    chapterTranslationContent: {
      width: "100%",
      maxWidth: layout.contentMaxWidth,
      alignSelf: "center",
      paddingTop: spacing[16],
      paddingBottom: spacing[16],
    },
    chapterVerseList: {
      rowGap: layout.chapterGap,
    },
    chapterTranslationFlowText: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body + 1,
      lineHeight: (typography.sizes.body + 1) * typography.lineHeights.body,
      color: colors.textPrimary,
      opacity: 0.84,
    },
    chapterTranslationVerseNumber: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.caption + 1,
      color: colors.textPrimary,
      opacity: 0.68,
      letterSpacing: 0.8,
      marginRight: spacing[1],
    },
    chapterHebrewFlowText: {
      fontFamily: typography.families.hebrewScripture,
      fontSize: typography.sizes.hebrewVerseMedium * 1.06,
      lineHeight:
        typography.sizes.hebrewVerseMedium * typography.lineHeights.hebrewScripture,
      color: colors.textPrimary,
      textAlign: "right",
      writingDirection: "rtl",
      letterSpacing: 0.3,
    },
    chapterHebrewVerseNumber: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.caption + 1,
      color: colors.textPrimary,
      opacity: 0.68,
      letterSpacing: 0.8,
    },
    chapterFootnoteOverlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.35)",
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing[6],
    },
    chapterFootnoteCard: {
      width: "100%",
      // Percentage width prevents phone-sized dialogs on iPad and split view.
      maxWidth: layout.modalWidth,
      borderRadius: 14,
      paddingHorizontal: spacing[5],
      paddingVertical: spacing[4],
      backgroundColor: colors.neomorphBg,
      borderWidth: 1,
      borderColor: colors.neomorphBorder,
    },
    hutterAnnouncementOverlay: {
      flex: 1,
      backgroundColor: "rgba(20, 16, 12, 0.45)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing[6],
    },
    hutterAnnouncementCard: {
      width: "100%",
      // Percentage width prevents phone-sized dialogs on iPad and split view.
      maxWidth: layout.modalWidth,
      borderRadius: 28,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: spacing[6],
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.18,
      shadowRadius: 24,
      elevation: 10,
    },
    hutterAnnouncementClose: {
      position: "absolute",
      right: spacing[4],
      top: spacing[4],
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    hutterAnnouncementCloseText: {
      color: colors.textSecondary,
      fontSize: 24,
      lineHeight: 26,
    },
    hutterAnnouncementTitle: {
      paddingRight: spacing[10],
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.h2,
      fontWeight: typography.weights.semibold,
      color: colors.textPrimary,
    },
    hutterAnnouncementMessage: {
      marginTop: spacing[3],
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      lineHeight: typography.sizes.body * 1.55,
      color: colors.textSecondary,
    },
    hutterAnnouncementButton: {
      marginTop: spacing[5],
      borderRadius: 999,
      backgroundColor: colors.accentCopper,
      paddingHorizontal: spacing[5],
      paddingVertical: spacing[4],
      alignItems: "center",
    },
    hutterAnnouncementButtonText: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      fontWeight: typography.weights.semibold,
      color: "#FFFFFF",
    },
    chapterFootnoteHeading: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.caption,
      color: colors.textSecondary,
      marginBottom: spacing[2],
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    chapterFootnoteWord: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      color: colors.textPrimary,
      fontWeight: "600",
      marginBottom: spacing[2],
    },
    chapterFootnoteText: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      lineHeight: typography.sizes.body * typography.lineHeights.body,
      color: colors.textPrimary,
    },
  });

type VersePageProps = {
  item: DisplayVerse;
  pageHeight: number;
  topPadding: number;
  showWordHint: boolean;
  isActive: boolean;
  isSelectedVerse: boolean;
  canSwipePrevious: boolean;
  canSwipeNext: boolean;
  isBesorah: boolean;
  onVersePress: () => void;
  selectedWord: DisplayVerse["words"][number] | null;
  onWordPress: (
    word: DisplayVerse["words"][number] | null,
    verseId: string,
  ) => void;
  onNonHebrewPress: () => void;
  onMetricsChange: (
    verseId: string,
    metrics: {
      canScroll: boolean;
      offsetY: number;
      contentHeight: number;
      viewportHeight: number;
    },
  ) => void;
  onEdgeSwipe: (verseId: string, direction: "previous" | "next") => void;
  onScrollBegin?: () => void;
};

const EDGE_EPSILON = 2;
const SWIPE_VELOCITY_THRESHOLD = 0.55;
const PAN_SWIPE_VELOCITY_THRESHOLD = 600;
const HEBREW_PRESS_SUPPRESSION_MS = 250;

const VersePageComponent = ({
  item,
  pageHeight,
  topPadding,
  showWordHint,
  isActive,
  isSelectedVerse,
  canSwipePrevious,
  canSwipeNext,
  isBesorah,
  onVersePress,
  selectedWord,
  onWordPress,
  onNonHebrewPress,
  onMetricsChange,
  onEdgeSwipe,
  onScrollBegin,
}: VersePageProps) => {
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const { width, height } = useWindowDimensions();
  const layout = getResponsiveLayout(width, height);
  const horizontalPadding = layout.isTablet ? layout.horizontalPadding : spacing[4];
  const bottomPadding = spacing[8];
  const canScroll = contentHeight > viewportHeight + EDGE_EPSILON;
  const effectiveTopPadding = canScroll ? topPadding : spacing[6];
  const lastHebrewPressInRef = useRef(0);

  const markHebrewPressIn = useCallback(() => {
    lastHebrewPressInRef.current = Date.now();
  }, []);

  const handleNonHebrewAreaPress = useCallback(() => {
    // Ignore bubbling taps immediately following Hebrew word/verse interactions.
    if (Date.now() - lastHebrewPressInRef.current < HEBREW_PRESS_SUPPRESSION_MS) {
      return;
    }
    onNonHebrewPress();
  }, [onNonHebrewPress]);

  useEffect(() => {
    onMetricsChange(item.id, {
      canScroll,
      offsetY: 0,
      contentHeight,
      viewportHeight,
    });
  }, [canScroll, contentHeight, item.id, onMetricsChange, viewportHeight]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!isActive) {
        return;
      }

      onMetricsChange(item.id, {
        canScroll,
        offsetY: event.nativeEvent.contentOffset.y,
        contentHeight: event.nativeEvent.contentSize.height,
        viewportHeight: event.nativeEvent.layoutMeasurement.height,
      });
    },
    [canScroll, isActive, item.id, onMetricsChange],
  );

  const handleScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!isActive) {
        return;
      }

      const velocityY = event.nativeEvent.velocity?.y ?? 0;
      if (Math.abs(velocityY) < SWIPE_VELOCITY_THRESHOLD) {
        return;
      }

      const nextCanScroll =
        event.nativeEvent.contentSize.height >
        event.nativeEvent.layoutMeasurement.height + EDGE_EPSILON;
      const maxOffset = Math.max(
        0,
        event.nativeEvent.contentSize.height -
          event.nativeEvent.layoutMeasurement.height,
      );
      const offsetY = event.nativeEvent.contentOffset.y;
      const atTop = offsetY <= EDGE_EPSILON;
      const atBottom = offsetY >= maxOffset - EDGE_EPSILON;

      if (velocityY > SWIPE_VELOCITY_THRESHOLD && (!nextCanScroll || atBottom)) {
        onEdgeSwipe(item.id, "next");
        return;
      }

      if (
        velocityY < -SWIPE_VELOCITY_THRESHOLD &&
        (!nextCanScroll || atTop)
      ) {
        onEdgeSwipe(item.id, "previous");
      }
    },
    [isActive, item.id, onEdgeSwipe],
  );

  const swipeTranslateY = useSharedValue(0);

  useEffect(() => {
    swipeTranslateY.value = 0;
  }, [item.id, isActive, swipeTranslateY]);

  const animatedSwipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: swipeTranslateY.value }],
  }));

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!canScroll && isActive)
        .onBegin(() => {
          cancelAnimation(swipeTranslateY);
          swipeTranslateY.value = 0;
          if (onScrollBegin) runOnJS(onScrollBegin)();
        })
        .onUpdate((event) => {
          swipeTranslateY.value = event.translationY * 0.2;
        })
        .onEnd((event) => {
          if (event.velocityY < -PAN_SWIPE_VELOCITY_THRESHOLD) {
            if (!canSwipeNext) {
              swipeTranslateY.value = withSpring(0, {
                damping: 20,
                stiffness: 300,
              });
              runOnJS(onEdgeSwipe)(item.id, "next");
              return;
            }
            runOnJS(onEdgeSwipe)(item.id, "next");
          } else if (event.velocityY > PAN_SWIPE_VELOCITY_THRESHOLD) {
            if (!canSwipePrevious) {
              swipeTranslateY.value = withSpring(0, {
                damping: 20,
                stiffness: 300,
              });
              runOnJS(onEdgeSwipe)(item.id, "previous");
              return;
            }
            runOnJS(onEdgeSwipe)(item.id, "previous");
          } else {
            swipeTranslateY.value = withSpring(0, {
              damping: 20,
              stiffness: 300,
            });
          }
        }),
    [
      canScroll,
      canSwipeNext,
      canSwipePrevious,
      isActive,
      item.id,
      onEdgeSwipe,
      onScrollBegin,
      swipeTranslateY,
    ],
  );

  const verseContent = (
    <View
      style={{
        minHeight: pageHeight,
        width: "100%",
        maxWidth: layout.contentMaxWidth,
        alignSelf: "center",
        justifyContent: canScroll ? "flex-start" : "center",
        paddingHorizontal: horizontalPadding,
        paddingTop: effectiveTopPadding,
        paddingBottom: bottomPadding,
      }}
      onTouchEnd={handleNonHebrewAreaPress}
    >
      <VerseCard
        verse={item}
        variant="detail"
        showWordHint={showWordHint && isSelectedVerse}
        selectedWord={isSelectedVerse ? selectedWord : null}
        isBesorah={isBesorah}
        onVersePress={onVersePress}
        onWordPress={(word) => onWordPress(word, item.id)}
        onHebrewPressIn={markHebrewPressIn}
      />
    </View>
  );

  return (
    <GestureDetector gesture={panGesture}>
      <Reanimated.View
        pointerEvents={isActive ? "auto" : "none"}
        style={[
          {
            height: pageHeight,
            width: "100%",
          },
          canScroll ? undefined : animatedSwipeStyle,
        ]}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces={false}
          alwaysBounceVertical={false}
          overScrollMode="never"
          nestedScrollEnabled={canScroll}
          scrollEnabled={canScroll}
          scrollEventThrottle={16}
          onLayout={(event) => {
            setViewportHeight(event.nativeEvent.layout.height);
          }}
          onContentSizeChange={(_, height) => {
            setContentHeight(height);
          }}
          onScrollBeginDrag={onScrollBegin}
          onScroll={handleScroll}
          onScrollEndDrag={handleScrollEndDrag}
          contentContainerStyle={{
            minHeight: pageHeight,
          }}
        >
          {verseContent}
        </ScrollView>
      </Reanimated.View>
    </GestureDetector>
  );
};

const VersePage = memo(
  VersePageComponent,
  (prevProps, nextProps) =>
    prevProps.item.id === nextProps.item.id &&
    prevProps.pageHeight === nextProps.pageHeight &&
    prevProps.showWordHint === nextProps.showWordHint &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isSelectedVerse === nextProps.isSelectedVerse &&
    prevProps.canSwipePrevious === nextProps.canSwipePrevious &&
    prevProps.canSwipeNext === nextProps.canSwipeNext &&
    prevProps.isBesorah === nextProps.isBesorah &&
    (prevProps.isSelectedVerse ? prevProps.selectedWord : null) ===
      (nextProps.isSelectedVerse ? nextProps.selectedWord : null) &&
    prevProps.onVersePress === nextProps.onVersePress &&
    prevProps.onWordPress === nextProps.onWordPress &&
    prevProps.onNonHebrewPress === nextProps.onNonHebrewPress &&
    prevProps.onMetricsChange === nextProps.onMetricsChange &&
    prevProps.onEdgeSwipe === nextProps.onEdgeSwipe &&
    prevProps.onScrollBegin === nextProps.onScrollBegin,
);

export const VerseDetailContent = () => {
  const themeMode = useAppStore((state: AppState) => state.themeMode);
  const colors = getColors(themeMode);
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const layout = useMemo(() => getResponsiveLayout(screenWidth, screenHeight), [screenWidth, screenHeight]);
  const styles = useMemo(() => createStyles(colors, layout), [colors, layout]);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const pageHeight =
    measuredHeight > 0
      ? measuredHeight
      : Math.max(0, screenHeight - insets.top - tabBarHeight);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const currentVerseId = useAppStore((state: AppState) => state.currentVerseId);
  const setCurrentVerseId = useAppStore(
    (state: AppState) => state.setCurrentVerseId,
  );
  const language = useAppStore((state: AppState) => state.language);
  const besorahTextVersion = useAppStore(
    (state: AppState) => state.besorahTextVersion,
  );
  const setBesorahTextVersion = useAppStore(
    (state: AppState) => state.setBesorahTextVersion,
  );
  const showQumran = useAppStore((state: AppState) => state.showQumran);
  const translationOnly = useAppStore(
    (state: AppState) => state.translationOnly,
  );
  const hebrewOnly = useAppStore((state: AppState) => state.hebrewOnly);
  const showFullChapter = useAppStore(
    (state: AppState) => state.showFullChapter,
  );
  const seferMode = useAppStore((state: AppState) => state.seferMode);
  const showNikud = useAppStore((state: AppState) => state.showNikud);
  const showCantillation = useAppStore(
    (state: AppState) => state.showCantillation,
  );
  const hebrewFontScale = useAppStore(
    (state: AppState) => state.hebrewFontScale,
  );
  const isConnected = useAppStore((state: AppState) => state.isConnected);
  const DEFAULT_VERSE_ID = "genesis-1-1";
  const normalizeVerseId = (value?: string | null) => {
    if (!value) return DEFAULT_VERSE_ID;
    const [bookId, chapterValue, verseValue] = value.split("-");
    const chapterNumber = Number(chapterValue);
    const verseNumber = Number(verseValue);
    if (
      !bookId ||
      !Number.isFinite(chapterNumber) ||
      chapterNumber <= 0 ||
      !Number.isFinite(verseNumber) ||
      verseNumber <= 0
    ) {
      return DEFAULT_VERSE_ID;
    }
    return `${bookId}-${chapterNumber}-${verseNumber}`;
  };

  const paramId = Array.isArray(params.id) ? params.id[0] : params.id;
  const isStandaloneVerseDetailRoute = Boolean(paramId);

  // Standalone screens use local state so they never touch the global store
  const [localVerseId, setLocalVerseId] = useState(
    () => normalizeVerseId(paramId),
  );
  const effectiveVerseId = isStandaloneVerseDetailRoute
    ? localVerseId
    : normalizeVerseId(currentVerseId);
  const setEffectiveVerseId = isStandaloneVerseDetailRoute
    ? setLocalVerseId
    : setCurrentVerseId;

  // Keep refs current for the onViewableItemsChanged closure
  const effectiveVerseIdRef = useRef(effectiveVerseId);
  const setEffectiveVerseIdRef = useRef(setEffectiveVerseId);
  // Pending verse number to scroll to after cross-book/chapter data loads
  const pendingScrollVerseRef = useRef<number | null>(null);
  useEffect(() => {
    effectiveVerseIdRef.current = effectiveVerseId;
    setEffectiveVerseIdRef.current = setEffectiveVerseId;
  });

  const verseId = effectiveVerseId;
  const navigationRowTop = isStandaloneVerseDetailRoute
    ? spacing[1]
    : spacing[16];
  const contentTopPadding = navigationRowTop + layout.controlHeight + spacing[6];

  const chapterScrollOffsets = useRef(new Map<string, number>());
  const chapterMeasurements = useRef(new Map<string, Map<number, number>>());
  const [chapterVerses, setChapterVerses] = useState<DisplayVerse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [booksMeta, setBooksMeta] = useState<BookResponse[]>([]);
  const [activeFlowFootnote, setActiveFlowFootnote] =
    useState<TranslationFootnote | null>(null);
  const [showHutterAnnouncement, setShowHutterAnnouncement] = useState(false);
  const hutterAnnouncementHandledRef = useRef(false);

  const parseVerseId = (id: string) => {
    const [bookId, chapterValue, verseValue] = id.split("-");
    return {
      bookId,
      chapter: Number(chapterValue || 1),
      verse: Number(verseValue || 1),
    };
  };

  const { bookId, chapter, verse: verseNumber } = parseVerseId(verseId);
  const verse =
    chapterVerses.find((item) => item.verse === verseNumber) ??
    chapterVerses[0];
  const previousTranslationOnlyRef = useRef(translationOnly);

  useEffect(() => {
    if (
      previousTranslationOnlyRef.current &&
      !translationOnly &&
      verse
    ) {
      setEffectiveVerseId(
        `${verse.bookId}-${verse.sourceChapter}-${verse.sourceVerse}`,
      );
    }

    previousTranslationOnlyRef.current = translationOnly;
  }, [setEffectiveVerseId, translationOnly, verse]);

  const bookMeta = useMemo(
    () =>
      booksMeta.find((book) => book.id === (verse?.bookId ?? bookId)) ?? null,
    [bookId, booksMeta, verse?.bookId],
  );
  const isBesorah = bookMeta?.section === "besorah";
  const previousBookSectionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isBesorah || hutterAnnouncementHandledRef.current) {
      return;
    }

    let isMounted = true;
    void (async () => {
      const hasSeenAnnouncement = await loadHutterAnnouncementSeen();
      if (isMounted && !hasSeenAnnouncement) {
        hutterAnnouncementHandledRef.current = true;
        setShowHutterAnnouncement(true);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isBesorah]);

  const dismissHutterAnnouncement = useCallback(() => {
    hutterAnnouncementHandledRef.current = true;
    setShowHutterAnnouncement(false);
    void saveHutterAnnouncementSeen();
  }, []);

  const activateHutter = useCallback(() => {
    setBesorahTextVersion("hutter");
    dismissHutterAnnouncement();
  }, [dismissHutterAnnouncement, setBesorahTextVersion]);

  const bookVerses = useMemo(() => chapterVerses, [chapterVerses]);
  const orderedVerses = useMemo(
    () =>
      [...bookVerses].sort(
        (a, b) => a.chapter - b.chapter || a.verse - b.verse,
      ),
    [bookVerses],
  );
  const currentIndex = useMemo(
    () => (verse ? orderedVerses.findIndex((item) => item.id === verse.id) : 0),
    [orderedVerses, verse],
  );
  const isChapterFlowMode =
    showFullChapter && seferMode && (translationOnly || hebrewOnly);

  const normalizeFlowHebrew = useCallback(
    (text: string) => {
      let normalized = text;
      if (!showNikud) {
        normalized = stripNikud(normalized);
      }
      if (!showCantillation) {
        normalized = stripCantillation(normalized);
      }
      normalized = stripMeteg(normalized);
      return normalized.replace(/\//g, "");
    },
    [showCantillation, showNikud],
  );

  const [showWordHint] = useState(false);
  const pageHeightRef = useRef(pageHeight);
  pageHeightRef.current = pageHeight;
  const swipeSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<(typeof orderedVerses)[number]>>(null);
  const verseScrollMetricsRef = useRef<
    Record<
      string,
      {
        canScroll: boolean;
        offsetY: number;
        contentHeight: number;
        viewportHeight: number;
      }
    >
  >({});
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 70 });
  const onViewableItemsChanged = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: { item: (typeof orderedVerses)[number] }[];
    }) => {
      // Skip updates while waiting for cross-book/chapter data to load
      if (pendingScrollVerseRef.current !== null) return;
      const next = viewableItems[0]?.item;
      if (next && next.id !== effectiveVerseIdRef.current) {
        setEffectiveVerseIdRef.current(next.id);
      }
    },
  );
  const sheetRef = useRef<BottomSheetMethods>(null!);
  const navigationSheetRef = useRef<NavigationSheetMethods>(null!);
  const [selectedWord, setSelectedWord] = useState<
    (typeof orderedVerses)[number]["words"][number] | null
  >(null);
  const [selectedWordVerseId, setSelectedWordVerseId] = useState<string | null>(
    null,
  );
  const pillVisibility = useRef(new Animated.Value(1)).current;
  const [pillVisible, setPillVisible] = useState(true);
  const [swipeHintCount, setSwipeHintCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const loadHintCount = async () => {
      const count = await loadSwipeUpHintCount();
      if (!mounted) {
        return;
      }
      setSwipeHintCount(count);
    };

    void loadHintCount();

    return () => {
      mounted = false;
    };
  }, []);

  const animatePill = useCallback(
    (nextVisible: boolean) => {
      setPillVisible(nextVisible);
      Animated.timing(pillVisibility, {
        toValue: nextVisible ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    },
    [pillVisibility],
  );

  // Listen for tab press to open navigation sheet
  const navigation = useNavigation<BottomTabNavigationProp<ParamListBase>>();
  useEffect(() => {
    const unsubscribe = navigation.addListener(
      "tabPress",
      (e: TabPressEvent) => {
        // If we're already on this tab, open the navigation sheet
        if (navigation.isFocused()) {
          e.preventDefault();
          // Close word analysis sheet if it's open
          sheetRef.current?.close();
          navigationSheetRef.current?.snapToIndex(0);
        }
      },
    );
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    let isMounted = true;
    const loadBooks = async () => {
      try {
        const metadata = await fetchMetadata();
        if (!isMounted) return;
        setBooksMeta(metadata.books);
      } catch (error) {
        if (!isMounted) return;
        console.error("Failed to load books metadata:", error);
        setBooksMeta([]);
      }
    };
    loadBooks();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const currentSection = bookMeta?.section ?? null;
    const previousSection = previousBookSectionRef.current;
    const enteredBesorahFromTanaj =
      Boolean(previousSection) &&
      previousSection !== "besorah" &&
      currentSection === "besorah";

    if (enteredBesorahFromTanaj) {
      void (async () => {
        const hasSeenHutterAnnouncement = await loadHutterAnnouncementSeen();
        if (!hasSeenHutterAnnouncement) {
          return;
        }

        const shownCount = await loadBesorahDisclaimerCount();
        if (shownCount >= 3) {
          return;
        }

        Alert.alert(
          t("verse.besorahDisclaimer.modalTitle"),
          t("verse.besorahDisclaimer.modalMessage"),
          [{ text: t("verse.besorahDisclaimer.modalConfirm") }],
          { cancelable: true },
        );

        await saveBesorahDisclaimerCount(shownCount + 1);
      })();
    }

    if (currentSection) {
      previousBookSectionRef.current = currentSection;
    }
  }, [bookMeta?.section, t]);

  const handleNavigationSelect = useCallback(
    (nextBookId: string, nextChapter: number, verseNum: number) => {
      const targetId = `${nextBookId}-${nextChapter}-${verseNum}`;
      setEffectiveVerseId(targetId);
      if (nextBookId === bookId && nextChapter === chapter) {
        // Same book+chapter: data is already loaded, scroll immediately
        const nextIndex = orderedVerses.findIndex(
          (item) => item.verse === verseNum,
        );
        if (nextIndex >= 0) {
          listRef.current?.scrollToOffset({
            offset: nextIndex * pageHeight,
            animated: true,
          });
        }
      } else {
        // Different book/chapter: defer scroll until new data loads
        pendingScrollVerseRef.current = verseNum;
      }
    },
    [orderedVerses, setEffectiveVerseId, bookId, chapter, pageHeight],
  );

  // Track when a word was just selected to prevent race condition with sheet's onClose
  const justSelectedWordRef = useRef(false);

  const handleWordPress = useCallback(
    (word: typeof selectedWord, verseIdForWord: string) => {
      if (!word) return;
      if (isBesorah && besorahTextVersion === "hutter" && !word.strong) {
        return;
      }

      const isSameWord =
        selectedWordVerseId === verseIdForWord &&
        selectedWord?.position === word.position &&
        selectedWord?.text === word.text &&
        selectedWord?.strong === word.strong;

      navigationSheetRef.current?.close();

      if (isSameWord) {
        justSelectedWordRef.current = false;
        setSelectedWord(null);
        setSelectedWordVerseId(null);
        sheetRef.current?.close();
        return;
      }

      justSelectedWordRef.current = true;
      setSelectedWord(word);
      setSelectedWordVerseId(verseIdForWord);
      if (sheetRef.current) {
        sheetRef.current.snapToIndex(0);
      }
    },
    [besorahTextVersion, isBesorah, selectedWord, selectedWordVerseId],
  );

  // Open the word analysis sheet whenever a word is selected
  useEffect(() => {
    if (selectedWord && sheetRef.current) {
      sheetRef.current.snapToIndex(0);
    }
  }, [selectedWord]);

  // Handle sheet close - only clear selectedWord if it wasn't just set
  const handleSheetClosed = useCallback(() => {
    if (justSelectedWordRef.current) {
      // A new word was just selected, don't clear it
      justSelectedWordRef.current = false;
      return;
    }
    // Normal close (user swiped down or tapped backdrop) - clear the selection
    setSelectedWord(null);
    setSelectedWordVerseId(null);
  }, []);

  const handleTogglePills = useCallback(() => {
    animatePill(!pillVisible);
  }, [animatePill, pillVisible]);

  const handleScrollBegin = useCallback(() => {
    if (pillVisible) {
      animatePill(false);
    }
  }, [animatePill, pillVisible]);

  const showSwipeUpHintIfEligible = useCallback(() => {
    setSwipeHintCount((currentCount) => {
      if (currentCount >= SWIPE_HINT_MAX_SHOWS) {
        return currentCount;
      }

      const nextHintCount = currentCount + 1;
      void saveSwipeUpHintCount(nextHintCount);
      return nextHintCount;
    });
  }, []);

  const handleOpenNavigationSheet = useCallback(() => {
    navigationSheetRef.current?.snapToIndex(0);
  }, []);

  const showBoundaryToast = useCallback(
    (direction: "previous" | "next") => {
      const message =
        direction === "previous"
          ? t("verse.firstVerseToast")
          : t("verse.lastVerseToast");

      if (Platform.OS === "android") {
        ToastAndroid.show(message, ToastAndroid.SHORT);
        return;
      }

      Alert.alert(message);
    },
    [t],
  );

  const handleVerseMetricsChange = useCallback(
    (
      verseIdFromPage: string,
      metrics: {
        canScroll: boolean;
        offsetY: number;
        contentHeight: number;
        viewportHeight: number;
      },
    ) => {
      verseScrollMetricsRef.current[verseIdFromPage] = metrics;
    },
    [],
  );

  const handleEdgeSwipe = useCallback(
    (verseIdFromPage: string, direction: "previous" | "next") => {
      const activeIndex = orderedVerses.findIndex(
        (item) => item.id === verseIdFromPage,
      );
      if (activeIndex < 0) {
        return;
      }

      const nextIndex = direction === "next" ? activeIndex + 1 : activeIndex - 1;
      if (nextIndex < 0) {
        showBoundaryToast("previous");
        return;
      }
      if (nextIndex >= orderedVerses.length) {
        showBoundaryToast("next");
        return;
      }

      listRef.current?.scrollToOffset({
        offset: nextIndex * pageHeight,
        animated: true,
      });
      const nextVerse = orderedVerses[nextIndex];
      if (nextVerse) {
        if (swipeSyncTimeoutRef.current) {
          clearTimeout(swipeSyncTimeoutRef.current);
        }
        swipeSyncTimeoutRef.current = setTimeout(() => {
          setEffectiveVerseId(nextVerse.id);
          swipeSyncTimeoutRef.current = null;
        }, 140);
      }

      if (direction === "next" && swipeHintCount < SWIPE_HINT_MAX_SHOWS) {
        showSwipeUpHintIfEligible();
      }
    },
    [
      orderedVerses,
      pageHeight,
      setEffectiveVerseId,
      showBoundaryToast,
      showSwipeUpHintIfEligible,
      swipeHintCount,
    ],
  );

  useEffect(() => {
    return () => {
      if (swipeSyncTimeoutRef.current) {
        clearTimeout(swipeSyncTimeoutRef.current);
      }
    };
  }, []);

  const keyExtractor = useCallback(
    (item: (typeof orderedVerses)[number]) => item.id,
    [],
  );
  const shouldShowSwipeHint = swipeHintCount < SWIPE_HINT_MAX_SHOWS;

  const renderVersePage = useCallback(
    ({
      item,
      index,
    }: {
      item: (typeof orderedVerses)[number];
      index: number;
    }) => (
      <VersePage
        item={item}
        pageHeight={pageHeight}
        topPadding={contentTopPadding}
        showWordHint={showWordHint}
        isActive={item.id === verse?.id}
        isSelectedVerse={item.id === verse?.id}
        canSwipePrevious={index > 0}
        canSwipeNext={index < orderedVerses.length - 1}
        isBesorah={isBesorah}
        selectedWord={item.id === selectedWordVerseId ? selectedWord : null}
        onVersePress={handleOpenNavigationSheet}
        onWordPress={handleWordPress}
        onNonHebrewPress={handleTogglePills}
        onMetricsChange={handleVerseMetricsChange}
        onEdgeSwipe={handleEdgeSwipe}
        onScrollBegin={handleScrollBegin}
      />
    ),
    [
      pageHeight,
      contentTopPadding,
      showWordHint,
      verse?.id,
      orderedVerses.length,
      isBesorah,
      selectedWord,
      selectedWordVerseId,
      handleOpenNavigationSheet,
      handleWordPress,
      handleTogglePills,
      handleVerseMetricsChange,
      handleEdgeSwipe,
      handleScrollBegin,
    ],
  );

  // Clear selectedWord immediately when verse changes to prevent stale word display
  const prevVerseIdRef = useRef(effectiveVerseId);
  useEffect(() => {
    if (prevVerseIdRef.current !== effectiveVerseId) {
      const prevBookId = prevVerseIdRef.current?.split("-")[0];
      const newBookId = effectiveVerseId?.split("-")[0];
      // Only clear if book actually changed (not just verse within same chapter)
      if (prevBookId !== newBookId) {
        setSelectedWord(null);
        setSelectedWordVerseId(null);
        sheetRef.current?.close();
      }
      prevVerseIdRef.current = effectiveVerseId;
    }
  }, [effectiveVerseId]);

  const currentLoadRef = useRef({
    bookId: "",
    chapter: 0,
    language: "en" as AppState["language"],
    showQumran: false,
    translationOnly: false,
    besorahTextVersion: "delitzsch" as AppState["besorahTextVersion"],
    isConnected: true,
  });
  useEffect(() => {
    if (!bookId) return;
    if (
      currentLoadRef.current.bookId === bookId &&
      currentLoadRef.current.chapter === chapter &&
      currentLoadRef.current.language === language &&
      currentLoadRef.current.showQumran === showQumran &&
      currentLoadRef.current.translationOnly === translationOnly &&
      currentLoadRef.current.besorahTextVersion === besorahTextVersion &&
      currentLoadRef.current.isConnected === isConnected
    ) {
      return;
    }

    let isMounted = true;
    currentLoadRef.current = {
      bookId,
      chapter,
      language,
      showQumran,
      translationOnly,
      besorahTextVersion,
      isConnected,
    };

    const loadVerses = async () => {
      setChapterVerses([]);
      setSelectedWord(null);
      setSelectedWordVerseId(null);
      setIsLoading(true);
      setErrorMessage(null);
      sheetRef.current?.close();

      try {
        const hideTranslations = !translationOnly && language === "he";
        const translationLanguage: "en" | "es" | undefined = translationOnly
          ? language === "es"
            ? "es"
            : "en"
          : hideTranslations
            ? undefined
            : language === "es"
              ? "es"
              : "en";
        const verses = await fetchChapterVerses(bookId, chapter, {
          language: translationLanguage,
          showDss: showQumran,
          hebrewOnly: hideTranslations,
          isConnected,
          referenceMode: translationOnly ? "translation" : "source",
          besorahTextVersion,
        });
        if (!isMounted) return;
        if (
          currentLoadRef.current.bookId !== bookId ||
          currentLoadRef.current.chapter !== chapter ||
          currentLoadRef.current.language !== language ||
          currentLoadRef.current.showQumran !== showQumran ||
          currentLoadRef.current.translationOnly !== translationOnly ||
          currentLoadRef.current.besorahTextVersion !== besorahTextVersion ||
          currentLoadRef.current.isConnected !== isConnected
        ) {
          return;
        }
        setChapterVerses(verses);
        // Scroll to the pending target verse after cross-book/chapter navigation
        if (pendingScrollVerseRef.current !== null) {
          const targetVerse = pendingScrollVerseRef.current;
          pendingScrollVerseRef.current = null;
          const sorted = [...verses].sort(
            (a, b) => a.chapter - b.chapter || a.verse - b.verse,
          );
          const targetIndex = sorted.findIndex(
            (item) => item.verse === targetVerse,
          );
          if (targetIndex >= 0) {
            // Use requestAnimationFrame to ensure FlatList has updated with new data
            requestAnimationFrame(() => {
              listRef.current?.scrollToOffset({
                offset: targetIndex * pageHeightRef.current,
                animated: false,
              });
            });
          }
        }
      } catch {
        if (!isMounted) return;
        setErrorMessage(t("errors.loadVerses"));
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadVerses();
    return () => {
      isMounted = false;
    };
  }, [
    besorahTextVersion,
    bookId,
    chapter,
    language,
    showQumran,
    translationOnly,
    isConnected,
    t,
  ]);

  return (
    <>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <View
          style={styles.container}
          onLayout={(event) => {
            const nextHeight = event.nativeEvent.layout.height;
            setMeasuredHeight((currentHeight) =>
              Math.abs(currentHeight - nextHeight) > EDGE_EPSILON
                ? nextHeight
                : currentHeight,
            );
          }}
        >
          <View
            style={[styles.navigationRow, { top: navigationRowTop }]}
            pointerEvents="box-none"
          >
            <Animated.View
              pointerEvents={pillVisible ? "auto" : "none"}
              style={{
                opacity: pillVisibility,
                transform: [
                  {
                    translateY: pillVisibility.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-12, 0],
                    }),
                  },
                ],
              }}
            >
              <BookChapterPill
                bookLabel={formatBookDisplayName(
                  language === "es"
                    ? (bookMeta?.spanish_name ?? t("common.loading"))
                    : (bookMeta?.name ?? t("common.loading")),
                )}
                hebrewLabel={bookMeta?.hebrew_name ?? ""}
                chapter={verse?.chapter ?? chapter}
                onBookPress={() => navigationSheetRef.current?.snapToIndex(0)}
                onChapterPress={() =>
                  navigationSheetRef.current?.openAtChapter()
                }
              />
            </Animated.View>
          </View>
          {isLoading ? <VerseCardSkeleton pageHeight={pageHeight} /> : null}
          {errorMessage ? (
            <View
              style={{ paddingHorizontal: spacing[6], paddingTop: spacing[12] }}
            >
              <Text
                style={{ textAlign: "center", color: colors.textSecondary }}
              >
                {errorMessage}
              </Text>
            </View>
          ) : null}
          {showFullChapter ? (
            !isLoading && orderedVerses[0]?.id.startsWith(`${bookId}-${chapter}-`) && (
            <FullChapterView
              verses={orderedVerses}
              locationKey={`${bookId}-${chapter}:${screenWidth}:${hebrewFontScale}:${hebrewOnly}:${translationOnly}:${language}:${besorahTextVersion}:${showNikud}:${showCantillation}`}
              targetId={effectiveVerseId}
              offsets={chapterScrollOffsets.current}
              measurements={chapterMeasurements.current}
              topPadding={contentTopPadding}
              style={styles.chapterTranslationScroll}
              contentStyle={[styles.chapterTranslationContent, { paddingTop: contentTopPadding }]}
              gap={layout.chapterGap}
              renderVerse={item => (
                <VerseCard verse={item} variant="detail" showWordHint={false}
                  selectedWord={item.id === selectedWordVerseId ? selectedWord : null}
                  isBesorah={isBesorah} onVersePress={handleOpenNavigationSheet}
                  onWordPress={word => handleWordPress(word, item.id)} />
              )}
              renderFlow={isChapterFlowMode ? (flowItems) => (
                <Pressable onPress={handleTogglePills}>
                  {translationOnly ? (
                    <Text style={styles.chapterTranslationFlowText}>
                      {flowItems.map((item, index) => (
                        <Text key={item.id}>
                          <Text style={styles.chapterTranslationVerseNumber}>
                            [{item.verse}]
                          </Text>{" "}
                          {renderTranslationFlowText(
                            language === "es" && !(item.translation ?? "").trim()
                              ? t("verse.missingSpanishTranslation")
                              : (item.translation ?? ""),
                            language === "es" ? item.translation_footnotes : undefined,
                            language === "es" ? setActiveFlowFootnote : undefined,
                            colors.accentCopper,
                            language === "es",
                          )}
                          {index < flowItems.length - 1 ? "\u200E " : ""}
                        </Text>
                      ))}
                    </Text>
                  ) : (
                    <Text
                      style={[
                        styles.chapterHebrewFlowText,
                        {
                          fontSize: typography.sizes.hebrewVerseMedium * hebrewFontScale * 1.06 * layout.textScale,
                          lineHeight:
                            typography.sizes.hebrewVerseMedium *
                            hebrewFontScale * layout.textScale *
                            typography.lineHeights.hebrewScripture,
                        },
                      ]}
                    >
                      {flowItems.flatMap(item => item.words.length
                        ? item.words.map((word, wordIndex) => (
                          <Text key={`${item.id}-${word.position}-${wordIndex}`}
                            testID={`sefer-${item.id}-${word.position}`}
                            accessibilityRole="button"
                            accessibilityLabel={normalizeFlowHebrew(word.text)}
                            onPress={() => handleWordPress(word, item.id)}
                            style={selectedWordVerseId === item.id && selectedWord?.position === word.position
                              ? { backgroundColor: colors.primaryLight } : undefined}
                          >{normalizeFlowHebrew(word.text)} </Text>
                        ))
                        : <Text key={item.id}>{normalizeFlowHebrew(item.hebrew)} </Text>)}
                    </Text>
                  )}
                </Pressable>
              ) : undefined}
            />
            )
          ) : (
            <FlatList
              ref={listRef}
              data={orderedVerses}
              keyExtractor={keyExtractor}
              renderItem={renderVersePage}
              directionalLockEnabled
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={pageHeight}
              snapToAlignment="start"
              windowSize={5}
              initialNumToRender={3}
              maxToRenderPerBatch={4}
              updateCellsBatchingPeriod={50}
              initialScrollIndex={Math.max(currentIndex, 0)}
              getItemLayout={(_, index) => ({
                length: pageHeight,
                offset: pageHeight * index,
                index,
              })}
              viewabilityConfig={viewabilityConfigRef.current}
              onViewableItemsChanged={onViewableItemsChanged.current}
            />
          )}
          {shouldShowSwipeHint && !showFullChapter ? (
            <View
              pointerEvents="none"
              style={[
                styles.swipeHintRow,
                { bottom: spacing[1] },
              ]}
            >
              <Text style={styles.swipeHintText}>
                {t("verse.swipeUpNextVerseHint")}
              </Text>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
      <WordAnalysisBottomSheet
        ref={sheetRef}
        word={selectedWord}
        currentVerseId={selectedWordVerseId ?? effectiveVerseId}
        isBesorah={isBesorah}
        onClosed={handleSheetClosed}
      />
      <NavigationSheet
        ref={navigationSheetRef}
        currentBookId={verse?.bookId ?? bookId}
        currentChapter={verse?.chapter ?? chapter}
        currentVerse={verse?.verse ?? verseNumber}
        translationOnly={translationOnly}
        currentChapterVerseNumbers={orderedVerses.map((item) => item.verse)}
        onSelectVerse={handleNavigationSelect}
      />
      <Modal
        animationType="fade"
        transparent
        visible={showHutterAnnouncement}
        onRequestClose={dismissHutterAnnouncement}
      >
        <View style={styles.hutterAnnouncementOverlay}>
          <View style={styles.hutterAnnouncementCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("verse.hutterAnnouncement.close")}
              onPress={dismissHutterAnnouncement}
              style={styles.hutterAnnouncementClose}
            >
              <Text style={styles.hutterAnnouncementCloseText}>×</Text>
            </Pressable>
            <Text style={styles.hutterAnnouncementTitle}>
              {t("verse.hutterAnnouncement.title")}
            </Text>
            <Text style={styles.hutterAnnouncementMessage}>
              {t("verse.hutterAnnouncement.message")}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={activateHutter}
              style={styles.hutterAnnouncementButton}
            >
              <Text style={styles.hutterAnnouncementButtonText}>
                {t("verse.hutterAnnouncement.activate")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={Boolean(activeFlowFootnote)}
        onRequestClose={() => setActiveFlowFootnote(null)}
      >
        <Pressable
          style={styles.chapterFootnoteOverlay}
          onPress={() => setActiveFlowFootnote(null)}
        >
          <Pressable
            style={styles.chapterFootnoteCard}
            onPress={(event) => event.stopPropagation()}
          >
            {activeFlowFootnote?.word ? (
              <Text style={styles.chapterFootnoteWord}>
                {activeFlowFootnote.word}
              </Text>
            ) : null}
            <Text style={styles.chapterFootnoteText}>
              {activeFlowFootnote?.explanation ?? ""}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};
