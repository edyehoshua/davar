import { selectedBookScroll, centeredBookOffset } from "@/src/services/navigationPositioning";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import type { BottomSheetMethods } from "@gorhom/bottom-sheet/lib/typescript/types";
import type { BottomSheetFlatListMethods } from "@gorhom/bottom-sheet/lib/typescript/components/bottomSheetScrollable";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getColors,
  getResponsiveLayout,
  getNeumorphShadowStyle,
  radii,
  spacing,
  typography,
} from "@/src/theme";
import { fetchMetadata } from "@/src/services/metadata";
import { useAppStore, type AppState } from "@/src/store/useAppStore";
import { useTranslation } from "@/src/i18n/useTranslation";
import { formatBookDisplayName } from "../utils/bookNameFormatter";

type NavigationSheetProps = {
  currentBookId: string;
  currentChapter: number;
  currentVerse: number;
  translationOnly?: boolean;
  currentChapterVerseNumbers?: number[];
  onSelectVerse: (bookId: string, chapter: number, verse: number) => void;
  onClose?: () => void;
};

type Step = "book" | "chapter" | "verse";

export type NavigationSheetMethods = BottomSheetMethods & {
  openAtChapter: () => void;
};

type BookMeta = {
  id: string;
  name: string;
  spanishName: string;
  hebrewName: string;
};


const stripNikud = (value: string) =>
  value.normalize("NFD").replace(/[\u0591-\u05C7]/g, "");

const createStyles = (colors: ReturnType<typeof getColors>, layout: ReturnType<typeof getResponsiveLayout>) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
    },
    sheetHandle: {
      backgroundColor: colors.border,
    },
    header: {
      width: "100%",
      maxWidth: layout.navigationWidth,
      alignSelf: "center",
      paddingHorizontal: spacing[6],
      paddingTop: spacing[4],
      paddingBottom: spacing[4],
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing[4],
    },
    backButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    backButtonHidden: {
      opacity: 0,
    },
    title: {
      flex: 1,
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.h3,
      color: colors.textPrimary,
      fontWeight: typography.weights.semibold,
      textAlign: "center",
    },
    closeButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.neomorphBg,
      borderRadius: radii.full,
      paddingHorizontal: spacing[4],
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.neomorphBorder,
    },
    searchIcon: {
      marginRight: spacing[2],
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      color: colors.textPrimary,
      paddingVertical: spacing[3],
    },
    clearButton: {
      padding: spacing[1],
    },
    content: {
      flex: 1,
    },
    list: {
      flex: 1,
    },
    listContent: {
      width: "100%",
      maxWidth: layout.navigationWidth,
      alignSelf: "center",
      paddingHorizontal: spacing[6],
      paddingBottom: spacing[8],
    },
    bookItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing[4],
      paddingHorizontal: spacing[4],
      marginBottom: spacing[3],
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    bookItemSelected: {
      backgroundColor: colors.primaryDeep,
      borderColor: colors.primary,
    },
    bookEnglish: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      color: colors.textPrimary,
      fontWeight: typography.weights.medium,
    },
    bookHebrew: {
      fontFamily: typography.families.hebrewUI,
      fontSize: typography.sizes.h3,
      color: colors.textPrimary,
      textAlign: "right",
      writingDirection: "rtl",
    },
    gridScroll: {
      flex: 1,
    },
    gridContainer: {
      width: "100%",
      maxWidth: layout.navigationWidth,
      alignSelf: "center",
      paddingHorizontal: spacing[6],
      paddingBottom: spacing[8],
    },
    gridTitle: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.bodySmall,
      color: colors.textSecondary,
      letterSpacing: 1,
      textTransform: "uppercase",
      textAlign: "center",
      marginBottom: spacing[4],
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: spacing[3],
    },
    cell: {
      width: layout.isTablet ? Math.floor((layout.navigationWidth - 48 - spacing[3] * (layout.gridColumns - 1)) / layout.gridColumns) : 52,
      height: layout.isTablet ? 60 : 52,
      borderRadius: radii.md,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    cellPlaceholder: {
      opacity: 0,
    },
    cellSelected: {
      backgroundColor: colors.primaryDeep,
      borderColor: colors.primaryDeep,
    },
    cellLabel: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      color: colors.textPrimary,
    },
    cellLabelSelected: {
      color: colors.background,
      fontWeight: typography.weights.medium,
    },
    emptyContainer: {
      alignItems: "center",
      paddingVertical: spacing[8],
    },
    emptyText: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      color: colors.textSecondary,
    },
  });

const NavigationSheetComponent = (
  {
    currentBookId,
    currentChapter,
    currentVerse,
    translationOnly = false,
    currentChapterVerseNumbers,
    onSelectVerse,
    onClose,
  }: NavigationSheetProps,
  ref: React.ForwardedRef<NavigationSheetMethods>,
) => {
  const sheetRef = useRef<BottomSheetMethods | null>(null);
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("book");
  const directionRef = useRef<"forward" | "back">("forward");
  const [selectedBookId, setSelectedBookId] = useState(currentBookId);

  useImperativeHandle(
    ref,
    () => ({
      expand: () => sheetRef.current?.expand(),
      collapse: () => sheetRef.current?.collapse(),
      close: () => sheetRef.current?.close(),
      forceClose: () => sheetRef.current?.forceClose(),
      // BottomSheet locks scroll offsets at non-extended snap points. Open
      // the book list at the existing extended snap so native scrolling owns it.
      snapToIndex: (index: number) => sheetRef.current?.snapToIndex(index >= 0 && step === "book" ? 1 : index),
      snapToPosition: (position: number | string) =>
        sheetRef.current?.snapToPosition(position),
      openAtChapter: () => {
        setSelectedBookId(currentBookId);
        setSelectedChapter(currentChapter);
        setStep("chapter");
        sheetRef.current?.snapToIndex(0);
      },
    }),
    [currentBookId, currentChapter, step],
  );
  const themeMode = useAppStore((state: AppState) => state.themeMode);
  const language = useAppStore((state: AppState) => state.language);
  const colors = getColors(themeMode);
  const { width, height, fontScale } = useWindowDimensions();
  const layout = useMemo(() => getResponsiveLayout(width, height), [width, height]);
  const styles = useMemo(() => createStyles(colors, layout), [colors, layout]);
  const contentBottomPadding = spacing[8] + spacing[4] + insets.bottom;
  const snapPoints = useMemo(() => ["60%", "80%"], []);
  const { t } = useTranslation();

  const [selectedChapter, setSelectedChapter] = useState(currentChapter);
  const [searchQuery, setSearchQuery] = useState("");
  const [booksMeta, setBooksMeta] = useState<BookMeta[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chapterCounts, setChapterCounts] = useState<Record<string, number[]>>(
    {},
  );
  const [verseCounts, setVerseCounts] = useState<
    Record<string, Record<string, number>>
  >({});

  useEffect(() => {
    let isMounted = true;
    const loadMetadata = async () => {
      try {
        const metadata = await fetchMetadata();
        if (!isMounted) return;
        const mappedBooks = metadata.books.map((book) => ({
          id: book.id,
          name: book.name,
          spanishName: book.spanish_name,
          hebrewName: book.hebrew_name,
        }));
        setBooksMeta(mappedBooks);
        setLoadError(null);
        setChapterCounts(metadata.chapter_counts ?? {});
        setVerseCounts(metadata.verse_counts ?? {});
      } catch {
        if (!isMounted) return;
        setBooksMeta([]);
        setChapterCounts({});
        setVerseCounts({});
        setLoadError(t("errors.loadBooks"));
      }
    };
    loadMetadata();
    return () => {
      isMounted = false;
    };
  }, [t]);

  // Get selected book info
  const selectedBook = useMemo(
    () => booksMeta.find((b) => b.id === selectedBookId),
    [booksMeta, selectedBookId],
  );

  const getBookDisplayName = useCallback(
    (book: BookMeta) => {
      const localizedName =
        language === "es" && book.spanishName.trim().length > 0
          ? book.spanishName
          : book.name;
      return formatBookDisplayName(localizedName);
    },
    [language],
  );

  // Filter books by search
  const filteredBooks = useMemo(() => {
    if (!searchQuery.trim()) {
      return booksMeta;
    }
    const query = searchQuery.toLowerCase();
    return booksMeta.filter(
      (book) =>
        getBookDisplayName(book).toLowerCase().includes(query) ||
        formatBookDisplayName(book.name).toLowerCase().includes(query) ||
        formatBookDisplayName(book.spanishName).toLowerCase().includes(query) ||
        stripNikud(book.hebrewName).includes(query) ||
        book.hebrewName.includes(query),
    );
  }, [booksMeta, searchQuery, getBookDisplayName]);

  // Get chapters for selected book
  const chapterNumbers = useMemo(() => {
    const chapters = chapterCounts[selectedBookId];
    if (chapters?.length) return chapters;
    return [];
  }, [chapterCounts, selectedBookId]);

  // Get verses for selected chapter
  const verseNumbers = useMemo(() => {
    if (
      translationOnly &&
      selectedBookId === currentBookId &&
      selectedChapter === currentChapter &&
      Array.isArray(currentChapterVerseNumbers) &&
      currentChapterVerseNumbers.length > 0
    ) {
      return Array.from(
        new Set(
          currentChapterVerseNumbers.filter(
            (value) => Number.isFinite(value) && value > 0,
          ),
        ),
      ).sort((a, b) => a - b);
    }

    const count = verseCounts[selectedBookId]?.[String(selectedChapter)];
    if (count) return Array.from({ length: count }, (_, i) => i + 1);
    return [];
  }, [
    currentBookId,
    currentChapter,
    currentChapterVerseNumbers,
    selectedBookId,
    selectedChapter,
    translationOnly,
    verseCounts,
  ]);

  // Pad numbers for grid
  const padNumbers = useCallback((numbers: number[]) => {
    const remainder = numbers.length % layout.gridColumns;
    if (remainder === 0) return numbers;
    const fillerCount = layout.gridColumns - remainder;
    return numbers.concat(Array.from({ length: fillerCount }, () => -1));
  }, [layout.gridColumns]);

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

  const [isOpen, setIsOpen] = useState(false);
  const [sheetReady, setSheetReady] = useState(false);
  const bookListRef = useRef<BottomSheetFlatListMethods | null>(null);
  useEffect(() => {
    if (!isOpen) {
      setSelectedBookId(currentBookId);
      setSelectedChapter(currentChapter);
    }
  }, [currentBookId, currentChapter, isOpen]);
  const bookItemHeight = Math.ceil(Math.max(typography.sizes.h3, typography.sizes.body) * fontScale * 1.4) + spacing[4] * 2 + 2;
  const bookRowHeight = bookItemHeight + spacing[3];
  const [listViewport, setListViewport] = useState(0);
  const [listContent, setListContent] = useState(0);
  const [listPositioned, setListPositioned] = useState(false);
  const fallbackUsed = useRef(false);
  const selectedBookIndex = filteredBooks.findIndex(book => book.id === selectedBookId);

  useEffect(() => {
    if (!isOpen || step !== "book") {
      setListPositioned(false);
      setListViewport(0);
      setListContent(0);
      fallbackUsed.current = false;
    }
  }, [isOpen, step]);

  useEffect(() => {
    // A resized native sheet has stale snap/scroll geometry. Close the transient
    // picker; the current reading location is retained and reopening remeasures.
    setIsOpen(false);
    setSheetReady(false);
    setListPositioned(false);
    fallbackUsed.current = false;
  }, [width, height]);

  useEffect(() => {
    const index = selectedBookScroll({
      open: sheetReady,
      bookStep: step === "book",
      query: searchQuery,
      viewport: listViewport,
      content: listContent,
      selectedIndex: selectedBookIndex,
      positioned: listPositioned,
    });
    if (index === null || !bookListRef.current) return;
    bookListRef.current.scrollToIndex({index, viewPosition: 0.5, animated: false});
    setListPositioned(true);
  }, [sheetReady, step, searchQuery, listViewport, listContent, selectedBookIndex, listPositioned]);


  const handleSheetChanges = useCallback(
    (index: number) => {
      setSheetReady(index >= 0);
      if (index === -1) {
        // Reset state when closed
        setStep("book");
        setSearchQuery("");
        setSelectedBookId(currentBookId);
        setSelectedChapter(currentChapter);
        setIsOpen(false);
        onClose?.();
      } else {
        setIsOpen(true);
      }
    },
    [onClose, currentBookId, currentChapter],
  );

  const handleBack = useCallback(() => {
    directionRef.current = "back";
    if (step === "verse") {
      setStep("chapter");
    } else if (step === "chapter") {
      setStep("book");
      sheetRef.current?.expand();
    }
  }, [step]);

  const handleSelectBook = useCallback(
    (bookId: string) => {
      const firstChapter = chapterCounts[bookId]?.[0] ?? 1;
      setSelectedBookId(bookId);
      setSelectedChapter(firstChapter);
      setSearchQuery("");
      directionRef.current = "forward";
      setStep("chapter");
    },
    [chapterCounts],
  );

  const handleSelectChapter = useCallback((chapter: number) => {
    setSelectedChapter(chapter);
    directionRef.current = "forward";
    setStep("verse");
  }, []);

  const handleSelectVerse = useCallback(
    (verse: number) => {
      onSelectVerse(selectedBookId, selectedChapter, verse);
      sheetRef.current?.close();
    },
    [selectedBookId, selectedChapter, onSelectVerse],
  );

  const renderBookItem = useCallback(
    ({ item }: { item: BookMeta }) => {
      const isSelected = item.id === selectedBookId;
      return (
        <Pressable
          onPress={() => handleSelectBook(item.id)}
          style={({ pressed }) => [
            styles.bookItem,
            { height: bookItemHeight },
            isSelected && styles.bookItemSelected,
            pressed
              ? getNeumorphShadowStyle("pressed", colors)
              : getNeumorphShadowStyle("raised", colors),
          ]}
        >
          <Text style={styles.bookEnglish}>{getBookDisplayName(item)}</Text>
          <Text style={styles.bookHebrew}>{stripNikud(item.hebrewName)}</Text>
        </Pressable>
      );
    },
    [selectedBookId, handleSelectBook, styles, colors, getBookDisplayName, bookItemHeight],
  );

  const renderNumberGrid = useCallback(
    (numbers: number[], selected: number, onSelect: (n: number) => void) => {
      const paddedNumbers = padNumbers(numbers);
      return (
        <View style={styles.grid}>
          {paddedNumbers.map((value, index) => {
            if (value === -1) {
              return (
                <View
                  key={`empty-${index}`}
                  style={[styles.cell, styles.cellPlaceholder]}
                />
              );
            }
            const isSelected = value === selected;
            return (
              <Pressable
                key={value}
                onPress={() => onSelect(value)}
                style={[styles.cell, isSelected && styles.cellSelected]}
              >
                <Text
                  style={[
                    styles.cellLabel,
                    isSelected && styles.cellLabelSelected,
                  ]}
                >
                  {value}
                </Text>
              </Pressable>
            );
          })}
        </View>
      );
    },
    [padNumbers, styles],
  );

  const getTitle = () => {
    const selectedBookName = selectedBook
      ? getBookDisplayName(selectedBook)
      : "";

    switch (step) {
      case "book":
        return t("navigation.selectBook");
      case "chapter":
        return selectedBookName || t("navigation.selectChapter");
      case "verse":
        return `${selectedBookName} ${selectedChapter}`;
    }
  };

  const enteringAnim =
    directionRef.current === "forward" ? FadeIn.duration(200) : undefined;

  return (
    <BottomSheet
      key={`${width}-${height}`}
      ref={sheetRef}
      index={isOpen ? (step === "book" ? 1 : 0) : -1}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.sheetHandle}
      onChange={handleSheetChanges}
      onAnimate={(_from, to) => {
        setSheetReady(false);
        if (to >= 0) setIsOpen(true);
      }}
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      animateOnMount={false}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Pressable
            style={[
              styles.backButton,
              step === "book" && styles.backButtonHidden,
            ]}
            onPress={handleBack}
            disabled={step === "book"}
          >
            <Ionicons
              name="arrow-back"
              size={18}
              color={colors.textSecondary}
            />
          </Pressable>
          <Text style={styles.title}>{getTitle()}</Text>
          {isOpen && (
            <Pressable
              style={styles.closeButton}
              onPress={() => sheetRef.current?.close()}
              testID="navigation-close-button"
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Search - only for books */}
        {step === "book" && (
          <View
            style={[
              styles.searchContainer,
              getNeumorphShadowStyle("pressed", colors),
            ]}
          >
            <Ionicons
              name="search"
              size={18}
              color={colors.textSecondary}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder={t("navigation.searchBooks")}
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable
                style={styles.clearButton}
                onPress={() => setSearchQuery("")}
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>
            )}
          </View>
        )}
      </View>

      {/* Content based on step */}
      {step === "book" && isOpen && (
        <Animated.View
          key="book-list"
          entering={enteringAnim}
          style={styles.content}
        >
          <BottomSheetFlatList
            ref={bookListRef}
            data={filteredBooks}
            keyExtractor={(item: BookMeta) => item.id}
            renderItem={renderBookItem}
            style={[styles.list, { opacity: listPositioned || searchQuery.trim() || !filteredBooks.length ? 1 : 0 }]}
            initialNumToRender={12}
            initialScrollIndex={!searchQuery.trim() && selectedBookIndex >= 0 ? Math.max(0, selectedBookIndex - 2) : undefined}
            getItemLayout={(_data, index) => ({length: bookRowHeight, offset: bookRowHeight * index, index})}
            onLayout={event => setListViewport(event.nativeEvent.layout.height)}
            onContentSizeChange={(_width, height) => setListContent(height)}
            onScrollBeginDrag={() => setListPositioned(true)}
            onScrollToIndexFailed={({index}) => {
              if (fallbackUsed.current || searchQuery.trim() || !isOpen) return;
              fallbackUsed.current = true;
              bookListRef.current?.scrollToOffset({offset: centeredBookOffset(index, bookRowHeight, listViewport), animated: false});
              setListPositioned(true);
            }}
            contentContainerStyle={[
              styles.listContent,
              {
                paddingBottom: contentBottomPadding,
              },
            ]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {loadError ?? t("navigation.noBooksFound")}
                </Text>
              </View>
            }
            keyboardShouldPersistTaps="handled"
          />
        </Animated.View>
      )}

      {step === "chapter" && (
        <Animated.View
          key="chapter-grid"
          entering={enteringAnim}
          style={styles.content}
        >
          <BottomSheetScrollView
            style={styles.gridScroll}
            contentContainerStyle={[
              styles.gridContainer,
              {
                paddingBottom: contentBottomPadding,
              },
            ]}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.gridTitle}>
              {t("navigation.selectChapter")}
            </Text>
            {chapterNumbers.length ? (
              renderNumberGrid(
                chapterNumbers,
                selectedChapter,
                handleSelectChapter,
              )
            ) : (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {t("navigation.noChapters")}
                </Text>
              </View>
            )}
          </BottomSheetScrollView>
        </Animated.View>
      )}

      {step === "verse" && (
        <Animated.View
          key="verse-grid"
          entering={enteringAnim}
          style={styles.content}
        >
          <BottomSheetScrollView
            style={styles.gridScroll}
            contentContainerStyle={[
              styles.gridContainer,
              {
                paddingBottom: contentBottomPadding,
              },
            ]}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.gridTitle}>{t("navigation.selectVerse")}</Text>
            {verseNumbers.length ? (
              renderNumberGrid(
                verseNumbers,
                currentBookId === selectedBookId &&
                  currentChapter === selectedChapter
                  ? currentVerse
                  : 0,
                handleSelectVerse,
              )
            ) : (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>{t("navigation.noVerses")}</Text>
              </View>
            )}
          </BottomSheetScrollView>
        </Animated.View>
      )}
    </BottomSheet>
  );
};

export const NavigationSheet = React.forwardRef<
  NavigationSheetMethods,
  NavigationSheetProps
>(NavigationSheetComponent);
