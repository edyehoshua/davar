import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomSheet } from "./components/BottomSheet";
import { ConnectionErrorPage } from "./components/ConnectionErrorPage";
import { DesignSystemExport } from "./components/DesignSystemExport";
import { DonateScreen } from "./components/DonateScreen";
import { FeaturesScreen } from "./components/FeaturesScreen";
import { FeedbackScreen } from "./components/FeedbackScreen";
import { HomeScreen } from "./components/HomeScreen";
import { LegalScreen } from "./components/LegalScreen";
import { MobileDesignSystemGuide } from "./components/MobileDesignSystemGuide";
import { NavigationBar } from "./components/NavigationBar";
import { NeumorphCard } from "./components/NeumorphCard";
import { NotFoundPage } from "./components/NotFoundPage";
import { SettingsScreen } from "./components/SettingsScreen";
import { Skeleton } from "./components/ui/skeleton";
import { VerseDisplay } from "./components/VerseDisplay";
import { WordCard } from "./components/WordCard";
import { useDocumentTitle } from "./hooks/useDocumentTitle";
import { usePersistedState } from "./hooks/usePersistedState";
import { translate, useTranslation } from "./hooks/useTranslation";
import {
	type BookResponse,
	getBooks,
	getChapterCount,
	getChapterVerses,
	getVerseCount,
	loadLexiconEntry,
	lookupBook,
	type VerseResponse,
	type WordAnalysis,
	type WordResponse,
} from "./services/staticData";
import { formatBookDisplayName } from "./utils/bookNameFormatter";
import { stripCantillation, stripMeteg } from "./utils/hebrew";
import {
	createDefaultReadingState,
	getLastPositionForBook,
	getStoredReadingState,
	saveReadingState,
	updateLastPositionForBook,
} from "./utils/storageHelpers";
import {
	getDssCommentaryForLanguage,
	HUTTER_ANNOUNCEMENT_RELEASE,
} from "./utils/translationConfig";
import { useVerseScrollNavigation } from "./utils/useVerseScrollNavigation";

type Screen =
	| "home"
	| "verse"
	| "settings"
	| "donate"
	| "features"
	| "terms"
	| "privacy"
	| "feedback"
	| "notFound"
	| "connectionError";

type RouteState = {
	screen: Screen;
	book?: string;
	chapter?: number;
	verse?: number;
};

type WordSelectionContext = {
	chapter: number;
	verse: number;
};

const BOOK_ABBREVIATIONS: Record<string, string> = {
	gen: "Genesis",
	exod: "Exodus",
	ex: "Exodus",
	lev: "Leviticus",
	num: "Numbers",
	deut: "Deuteronomy",
	josh: "Joshua",
	judg: "Judges",
	ruth: "Ruth",
	"1sam": "Samuel1",
	"2sam": "Samuel2",
	"1kgs": "Kings1",
	"2kgs": "Kings2",
	"1chr": "Chronicles1",
	"2chr": "Chronicles2",
	ezra: "Ezra",
	neh: "Nehemiah",
	esth: "Esther",
	job: "Job",
	ps: "Psalms",
	prov: "Proverbs",
	eccl: "Ecclesiastes",
	song: "SongOfSolomon",
	isa: "Isaiah",
	jer: "Jeremiah",
	ezek: "Ezekiel",
	dan: "Daniel",
	hos: "Hosea",
	joel: "Joel",
	amos: "Amos",
	obad: "Obadiah",
	jonah: "Jonah",
	mic: "Micah",
	nah: "Nahum",
	hab: "Habakkuk",
	zeph: "Zephaniah",
	hag: "Haggai",
	zech: "Zechariah",
	mal: "Malachi",
	matt: "Matthew",
	mark: "Mark",
	luke: "Luke",
	john: "John",
	acts: "Acts",
	rom: "Romans",
	"1cor": "Corinthians1",
	"2cor": "Corinthians2",
	gal: "Galatians",
	eph: "Ephesians",
	phil: "Philippians",
	col: "Colossians",
	"1thess": "Thessalonians1",
	"2thess": "Thessalonians2",
	"1tim": "Timothy1",
	"2tim": "Timothy2",
	tit: "Titus",
	phlm: "Philemon",
	phlm2: "Philemon",
	heb: "Hebrews",
	jas: "James",
	"1pet": "Peter1",
	"2pet": "Peter2",
	"1john": "John1",
	"2john": "John2",
	"3john": "John3",
	jude: "Jude",
	rev: "Revelation",
};

export default function App() {
	// Initialize persisted state from localStorage or defaults
	const initialState = getStoredReadingState() ?? createDefaultReadingState();

	// Use persisted state hooks for all settings
	const [currentScreen, setCurrentScreen] = useState<Screen>("verse");
	const currentScreenRef = useRef(currentScreen);
	const [theme, setTheme] = usePersistedState("theme", initialState.theme);
	const [language, setLanguage] = usePersistedState(
		"language",
		initialState.language,
	);
	const [besorahTextVersion, setBesorahTextVersion] = usePersistedState(
		"besorahTextVersion",
		initialState.besorahTextVersion,
	);
	const [hutterAnnouncementRelease, setHutterAnnouncementRelease] =
		usePersistedState(
			"hutterAnnouncementRelease",
			initialState.hutterAnnouncementRelease,
		);
	const { t, isRTL } = useTranslation(language);
	const [showHutterAnnouncement, setShowHutterAnnouncement] = useState(false);

	useEffect(() => {
		currentScreenRef.current = currentScreen;
	}, [currentScreen]);
	const [showQumran, setShowQumran] = usePersistedState(
		"showQumran",
		initialState.showQumran,
	);
	const [showFullChapter, setShowFullChapter] = usePersistedState(
		"showFullChapter",
		initialState.showFullChapter,
	);
	const [seferMode, setSeferMode] = usePersistedState(
		"seferMode",
		initialState.seferMode ?? false,
	);
	const [hebrewOnly, setHebrewOnly] = usePersistedState(
		"hebrewOnly",
		initialState.hebrewOnly,
	);
	const [translationOnly, setTranslationOnly] = usePersistedState(
		"translationOnly",
		initialState.translationOnly,
	);
	const [showNikud, setShowNikud] = usePersistedState(
		"showNikud",
		initialState.showNikud,
	);
	const [showCantillation, setShowCantillation] = usePersistedState(
		"showCantillation",
		initialState.showCantillation,
	);
	const [scrollHintCount, setScrollHintCount] = usePersistedState(
		"scrollNavHintCount",
		initialState.scrollNavHintCount,
	);
	const [desktopScrollHintCount, setDesktopScrollHintCount] = usePersistedState(
		"desktopScrollHintCount",
		initialState.desktopScrollHintCount,
	);

	// Navigation state - also persisted but with special logic for per-book tracking
	const [currentBook, setCurrentBook] = useState(initialState.book);
	const [currentChapter, setCurrentChapter] = useState(initialState.chapter);
	const [currentVerse, setCurrentVerse] = useState(initialState.verse);
	const prevBookRef = useRef(currentBook);

	// Non-persisted UI state
	const [scrollJumpActive, setScrollJumpActive] = useState(false);
	const [isWordPanelHovered, setIsWordPanelHovered] = useState(false);
	const versePanelRef = useRef<HTMLDivElement | null>(null);

	const [selectedWord, setSelectedWord] = useState<WordResponse | null>(null);
	const [selectedWordContext, setSelectedWordContext] =
		useState<WordSelectionContext | null>(null);
	const [isWordSheetOpen, setIsWordSheetOpen] = useState(false);
	const wordSheetClosingRef = useRef(false);
	const [isWordPanelDismissed, setIsWordPanelDismissed] = useState(true);
	const [showWordHint, _setShowWordHint] = useState(true);
	const [isNavigatingWordPanel, setIsNavigatingWordPanel] = useState(false);
	const [showWordSkeleton, setShowWordSkeleton] = useState(false);
	const navigationKeyRef = useRef<string | null>(null);
	const wordSkeletonTimerRef = useRef<number | null>(null);
	const wordPanelDismissedRef = useRef(true);
	const [lastSelectedWord, setLastSelectedWord] = useState<WordResponse | null>(
		null,
	);
	const [lastSelectedWordContext, setLastSelectedWordContext] =
		useState<WordSelectionContext | null>(null);
	const [lastSelectedWordAnalysis, setLastSelectedWordAnalysis] =
		useState<WordAnalysis | null>(null);
	const [showMobileDesignGuide, setShowMobileDesignGuide] = useState(false);
	const [showDesignSystem, setShowDesignSystem] = useState(false);
	const [isMobile, setIsMobile] = useState(false);

	const [books, setBooks] = useState<BookResponse[]>([]);
	const booksRef = useRef<BookResponse[]>([]);
	const [chapterVerses, setChapterVerses] = useState<VerseResponse[]>([]);
	const [chapterCount, setChapterCount] = useState(1);
	const [verseCount, setVerseCount] = useState(1);
	const [isLoading, setIsLoading] = useState(false);
	const [_errorMessage, setErrorMessage] = useState<string | null>(null);
	const [selectedWordAnalysis, setSelectedWordAnalysis] =
		useState<WordAnalysis | null>(null);
	const [isWordAnalysisLoading, setIsWordAnalysisLoading] = useState(false);
	const [selectedDssAnalysis, setSelectedDssAnalysis] =
		useState<WordAnalysis | null>(null);
	const [lastSelectedDssAnalysis, setLastSelectedDssAnalysis] =
		useState<WordAnalysis | null>(null);
	const [isDssAnalysisLoading, setIsDssAnalysisLoading] = useState(false);
	const lastUrlRef = useRef<string | null>(null);
	const pendingRouteRef = useRef<RouteState | null>(null);
	const isHandlingPopStateRef = useRef(false);
	const preserveWordRef = useRef(false);
	const pendingWordTextRef = useRef<string | null>(null);
	const pendingWordStrongRef = useRef<string | null>(null);
	const pendingWordRef = useRef<WordResponse | null>(null);
	const [wordCardTabKey, setWordCardTabKey] = useState(0);
	const [hideNavOnScroll, setHideNavOnScroll] = useState(false);
	const lastScrollYRef = useRef(0);

	const getTransliterationForLanguage = useCallback(
		(word?: WordResponse | null) => {
			if (!word) return undefined;
			if (language === "en") return word.translit_en;
			if (language === "es") return word.translit_es;
			return undefined;
		},
		[language],
	);

	const getAnalysisTransliterationForLanguage = useCallback(
		(analysis?: WordAnalysis | null) => {
			if (!analysis) return undefined;
			if (language === "en") return analysis.translit_en;
			if (language === "es") return analysis.translit_es;
			return undefined;
		},
		[language],
	);

	const resolveRenderableDssWord = useCallback((value?: string) => {
		if (!value) return undefined;
		const trimmed = value.trim();
		if (!trimmed || trimmed.toLowerCase() === "note") {
			return undefined;
		}

		// Multi-word DSS variants are renderable now that replacement is
		// span-aware in VerseDisplay (#103).
		const tokenCount = trimmed
			.replace(/[/:]/g, " ")
			.split(/\s+/)
			.filter(Boolean).length;
		if (tokenCount < 1) {
			return undefined;
		}

		return trimmed;
	}, []);

	useEffect(() => {
		if (!showFullChapter && seferMode) {
			setSeferMode(false);
		}
	}, [showFullChapter, seferMode, setSeferMode]);

	useEffect(() => {
		if (!translationOnly) return;

		if (hebrewOnly) {
			setHebrewOnly(false);
		}
		if (showQumran) {
			setShowQumran(false);
		}
		if (showNikud) {
			setShowNikud(false);
		}
		if (showCantillation) {
			setShowCantillation(false);
		}
	}, [
		translationOnly,
		hebrewOnly,
		showQumran,
		showNikud,
		showCantillation,
		setHebrewOnly,
		setShowQumran,
		setShowNikud,
		setShowCantillation,
	]);

	const handleSeferModeChange = useCallback(
		(nextSeferMode: boolean) => {
			if (nextSeferMode) {
				if (!showFullChapter) {
					setShowFullChapter(true);
				}
				if (!hebrewOnly && !translationOnly) {
					setTranslationOnly(true);
				}
			}

			setSeferMode(nextSeferMode);
		},
		[
			showFullChapter,
			hebrewOnly,
			translationOnly,
			setShowFullChapter,
			setTranslationOnly,
			setSeferMode,
		],
	);

	const handleHebrewOnlyChange = useCallback(
		(nextHebrewOnly: boolean) => {
			setHebrewOnly(nextHebrewOnly);
			if (!nextHebrewOnly && !translationOnly && seferMode) {
				setSeferMode(false);
			}
		},
		[seferMode, setHebrewOnly, setSeferMode, translationOnly],
	);

	const handleTranslationOnlyChange = useCallback(
		(nextTranslationOnly: boolean) => {
			setTranslationOnly(nextTranslationOnly);
			const activeVerse =
				chapterVerses.find((item) => item.verse === currentVerse) ??
				chapterVerses[0];

			if (!nextTranslationOnly && activeVerse) {
				setCurrentChapter(activeVerse.sourceChapter);
				setCurrentVerse(activeVerse.sourceVerse);
			}

			if (nextTranslationOnly) {
				if (!showFullChapter) {
					setShowFullChapter(true);
				}
				if (!seferMode) {
					setSeferMode(true);
				}
				return;
			}

			setShowNikud(true);
			setShowQumran(true);
			setShowFullChapter(false);
			setSeferMode(false);
		},
		[
			chapterVerses,
			currentVerse,
			showFullChapter,
			seferMode,
			setTranslationOnly,
			setShowNikud,
			setShowQumran,
			setShowFullChapter,
			setSeferMode,
		],
	);

	const buildRoutePath = useCallback((route: RouteState) => {
		switch (route.screen) {
			case "home":
				return "/home";
			case "terms":
				return "/terms";
			case "privacy":
				return "/privacy";
			case "feedback":
				return "/feedback";
			case "donate":
				return "/donate";
			case "features":
				return "/features";
			case "settings":
				return "/settings";
			case "verse": {
				const book = route.book ? encodeURIComponent(route.book) : "";
				const chapter = route.chapter ?? 1;
				const verse = route.verse ?? 1;
				return book ? `/verse/${book}/${chapter}/${verse}` : "/";
			}
			default:
				return "/";
		}
	}, []);

	const parseRoutePath = useCallback((pathname: string): RouteState | null => {
		const trimmed = pathname.replace(/\/+$/, "") || "/";
		const parts = trimmed.split("/").filter(Boolean);

		if (parts.length === 0) {
			return { screen: "verse" };
		}

		const [root, book, chapter, verse] = parts;
		if (root === "home") return { screen: "home" };
		if (root === "terms") return { screen: "terms" };
		if (root === "privacy") return { screen: "privacy" };
		if (root === "feedback") return { screen: "feedback" };
		if (root === "donate") return { screen: "donate" };
		if (root === "features") return { screen: "features" };
		if (root === "settings") return { screen: "settings" };

		if (root === "verse") {
			const decodedBook = book ? decodeURIComponent(book) : undefined;
			const parsedChapter = chapter ? Number.parseInt(chapter, 10) : undefined;
			const parsedVerse = verse ? Number.parseInt(verse, 10) : undefined;
			return {
				screen: "verse",
				book: decodedBook,
				chapter: Number.isNaN(parsedChapter) ? undefined : parsedChapter,
				verse: Number.isNaN(parsedVerse) ? undefined : parsedVerse,
			};
		}

		// Handle invalid routes - return null to trigger 404
		return null;
	}, []);
	const parseRoutePathRef = useRef(parseRoutePath);

	useEffect(() => {
		booksRef.current = books;
	}, [books]);

	useEffect(() => {
		parseRoutePathRef.current = parseRoutePath;
	}, [parseRoutePath]);

	const getHebrewBookName = useCallback(
		(book: string): string => {
			const found = books.find(
				(item) => item.name.toLowerCase() === book.toLowerCase(),
			);
			return found?.hebrew_name ?? book;
		},
		[books],
	);

	const getDisplayBookName = useCallback(
		(book: string): string => {
			const found = books.find(
				(item) => item.name.toLowerCase() === book.toLowerCase(),
			);
			if (language === "es") {
				return formatBookDisplayName(found?.spanish_name || book);
			}
			return formatBookDisplayName(book);
		},
		[books, language],
	);

	const tabTitle = useMemo(() => {
		if (currentScreen === "terms") {
			return `${t("home.aboutItems.terms")} | ${t("common.appName")}`;
		}

		if (currentScreen === "privacy") {
			return `${t("home.aboutItems.privacy")} | ${t("common.appName")}`;
		}

		if (currentScreen !== "verse" || !currentBook || !currentChapter) {
			return t("common.appName");
		}

		const hebrewBookName = getHebrewBookName(currentBook);
		const chapterVerse = `${currentChapter}:${currentVerse}`;

		if (language === "he") {
			return `${hebrewBookName} ${chapterVerse} ${hebrewBookName}`;
		}

		const displayBookName = getDisplayBookName(currentBook);

		return `${displayBookName} ${chapterVerse} ${hebrewBookName}`;
	}, [
		currentBook,
		currentChapter,
		currentVerse,
		currentScreen,
		language,
		t,
		getHebrewBookName,
		getDisplayBookName,
	]);

	useDocumentTitle(tabTitle);

	useEffect(() => {
		if (theme === "dark") {
			document.documentElement.classList.add("dark");
		} else {
			document.documentElement.classList.remove("dark");
		}
	}, [theme]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		pendingRouteRef.current = parseRoutePathRef.current(
			window.location.pathname,
		);
	}, []);

	useEffect(() => {
		document.documentElement.dir = isRTL ? "rtl" : "ltr";
		document.documentElement.lang = language;
	}, [isRTL, language]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		// Save navigation state and per-book position to localStorage
		const stored = getStoredReadingState();
		if (stored) {
			let updated = {
				...stored,
				book: currentBook,
				chapter: currentChapter,
				verse: currentVerse,
			};
			updated = updateLastPositionForBook(
				updated,
				currentBook,
				currentChapter,
				currentVerse,
			);
			saveReadingState(updated);
		}
	}, [currentBook, currentChapter, currentVerse]);

	// Clear selected word and chapter verses when book changes to prevent showing stale data
	useEffect(() => {
		if (prevBookRef.current !== currentBook) {
			setSelectedWord(null);
			setSelectedWordContext(null);
			setSelectedWordAnalysis(null);
			setChapterVerses([]); // Clear old verses so currentVerseData becomes null
			prevBookRef.current = currentBook;
		}
	}, [currentBook]);

	useEffect(() => {
		if (currentScreen === "verse") return;

		wordSheetClosingRef.current = false;
		setIsWordSheetOpen(false);
		setIsWordPanelHovered(false);
		setIsNavigatingWordPanel(false);
		setShowWordSkeleton(false);
		setSelectedWord(null);
		setSelectedWordContext(null);
	}, [currentScreen]);

	const closeWordSheet = useCallback(() => {
		wordSheetClosingRef.current = true;
		setIsWordSheetOpen(false);
	}, []);

	const logWordDebug = useCallback((...args: unknown[]) => {
		if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) {
			console.debug("[word-debug]", ...args);
		}
	}, []);

	const handleWordSheetAfterClose = useCallback(() => {
		if (isWordSheetOpen) return;
		wordSheetClosingRef.current = false;
		setSelectedWord(null);
		setSelectedWordContext(null);
	}, [isWordSheetOpen]);

	const handleWordClick = useCallback(
		(word: WordResponse, context?: WordSelectionContext) => {
			if (besorahTextVersion === "hutter" && !word.strong) {
				return;
			}
			const resolvedContext = context ?? {
				chapter: currentChapter,
				verse: currentVerse,
			};
			logWordDebug("click", {
				text: word.text,
				strong: word.strong ?? null,
				position: word.position,
				context: resolvedContext,
				selected: selectedWord
					? {
							text: selectedWord.text,
							strong: selectedWord.strong ?? null,
							position: selectedWord.position,
							context: selectedWordContext,
						}
					: null,
			});

			// If same word is clicked again, close the word card
			if (
				selectedWord?.text === word.text &&
				selectedWord?.strong === word.strong &&
				selectedWord?.position === word.position &&
				selectedWordContext?.chapter === resolvedContext.chapter &&
				selectedWordContext?.verse === resolvedContext.verse
			) {
				logWordDebug("click-same-word-close", {
					text: word.text,
					strong: word.strong ?? null,
					position: word.position,
					context: resolvedContext,
				});
				if (isMobile) {
					closeWordSheet();
				} else {
					setIsWordPanelDismissed(true);
					setSelectedWord(null);
					setSelectedWordContext(null);
					setLastSelectedWordAnalysis(null);
					setLastSelectedDssAnalysis(null);
				}
				return;
			}
			setIsWordPanelDismissed(false);
			setSelectedWord(word);
			setSelectedWordContext(resolvedContext);
			logWordDebug("click-select-word", {
				text: word.text,
				strong: word.strong ?? null,
				position: word.position,
				context: resolvedContext,
				isMobile,
			});
			if (isMobile) {
				wordSheetClosingRef.current = false;
				setIsWordSheetOpen(true);
			}
		},
		[
			besorahTextVersion,
			closeWordSheet,
			currentChapter,
			currentVerse,
			isMobile,
			logWordDebug,
			selectedWord,
			selectedWordContext,
		],
	);

	const handleNavigateToVerse = async (verseRef: string) => {
		const wordToPreserve = selectedWord ?? lastSelectedWord;
		if (wordToPreserve) {
			preserveWordRef.current = true;
			pendingWordTextRef.current = wordToPreserve.text;
			pendingWordStrongRef.current = wordToPreserve.strong ?? null;
			pendingWordRef.current = wordToPreserve;
			setIsWordPanelDismissed(false);
			setWordCardTabKey((previous) => previous + 1);
		}
		const cleanedRef = verseRef.replace(/\s+/g, " ").trim();
		const lastSpaceIndex = cleanedRef.lastIndexOf(" ");
		if (lastSpaceIndex <= 0) return;

		const bookLabel = cleanedRef.slice(0, lastSpaceIndex).trim();
		const chapterVerse = cleanedRef.slice(lastSpaceIndex + 1).trim();
		const match = chapterVerse.match(/^(\d+):(\d+)$/);
		if (!match) return;

		const chapter = Number.parseInt(match[1], 10);
		const verse = Number.parseInt(match[2], 10);
		if (Number.isNaN(chapter) || Number.isNaN(verse)) return;

		const normalizedBookLabel = bookLabel.toLowerCase().replace(/\./g, "");
		const abbreviationMatch = BOOK_ABBREVIATIONS[normalizedBookLabel];

		const matchedBook = books.find((item) => {
			const label = normalizedBookLabel;
			return (
				item.name.toLowerCase() === label ||
				item.hebrew_name?.toLowerCase() === label ||
				item.spanish_name?.toLowerCase() === label
			);
		});

		let resolvedBookName = matchedBook?.name ?? abbreviationMatch ?? bookLabel;
		if (!matchedBook && !abbreviationMatch) {
			try {
				const resolved = await lookupBook(bookLabel);
				resolvedBookName = resolved.name;
			} catch (error) {
				console.error("Failed to normalize book label:", error);
			}
		}

		setCurrentBook(resolvedBookName);
		setCurrentChapter(chapter);
		setCurrentVerse(verse);
		if (isMobile) {
			closeWordSheet();
		} else {
			setIsWordPanelDismissed(false);
		}
	};

	const currentVerseData = useMemo(
		() => chapterVerses.find((item) => item.verse === currentVerse) ?? null,
		[chapterVerses, currentVerse],
	);

	const currentVerseIndex = useMemo(
		() => chapterVerses.findIndex((item) => item.verse === currentVerse),
		[chapterVerses, currentVerse],
	);

	const selectedWordVerseData = useMemo(() => {
		const context = selectedWordContext ?? lastSelectedWordContext;
		if (!context) return currentVerseData;

		return (
			chapterVerses.find(
				(item) =>
					item.chapter === context.chapter && item.verse === context.verse,
			) ?? currentVerseData
		);
	}, [
		chapterVerses,
		currentVerseData,
		lastSelectedWordContext,
		selectedWordContext,
	]);

	const highlightedWord = useMemo(
		() => selectedWord ?? lastSelectedWord,
		[selectedWord, lastSelectedWord],
	);

	const highlightedWordContext = useMemo(() => {
		if (selectedWord && selectedWordContext) {
			return selectedWordContext;
		}

		if (!selectedWord && lastSelectedWordContext) {
			return lastSelectedWordContext;
		}

		return null;
	}, [selectedWord, selectedWordContext, lastSelectedWordContext]);

	const selectedDssVariant = useMemo(
		() =>
			selectedWordVerseData?.dss?.find(
				(variant) => variant.position === selectedWord?.position,
			) ?? null,
		[selectedWord, selectedWordVerseData],
	);

	const bookOptions = useMemo(
		() =>
			[...books]
				.sort((a, b) => a.order - b.order)
				.map((book) => ({
					name: book.name,
					hebrew: book.hebrew_name,
					spanish: book.spanish_name,
				})),
		[books],
	);
	const currentBookMeta = useMemo(
		() =>
			books.find(
				(item) => item.name.toLowerCase() === currentBook.toLowerCase(),
			) ?? null,
		[books, currentBook],
	);
	const isBesorah = currentBookMeta?.section === "besorah";
	const besorahDisclaimerText = t("verse.besorahDisclaimer.short");

	useEffect(() => {
		if (
			currentScreen === "verse" &&
			isBesorah &&
			hutterAnnouncementRelease !== HUTTER_ANNOUNCEMENT_RELEASE
		) {
			setShowHutterAnnouncement(true);
		}
	}, [currentScreen, hutterAnnouncementRelease, isBesorah]);

	const dismissHutterAnnouncement = useCallback(() => {
		setShowHutterAnnouncement(false);
		setHutterAnnouncementRelease(HUTTER_ANNOUNCEMENT_RELEASE);
	}, [setHutterAnnouncementRelease]);

	const activateHutter = useCallback(() => {
		setBesorahTextVersion("hutter");
		dismissHutterAnnouncement();
	}, [dismissHutterAnnouncement, setBesorahTextVersion]);

	const handleBesorahTextVersionChange = useCallback(
		(version: "delitzsch" | "hutter") => {
			setBesorahTextVersion(version);
		},
		[setBesorahTextVersion],
	);

	useEffect(() => {
		let isMounted = true;
		const loadBooks = async () => {
			try {
				const response = await getBooks();
				if (!isMounted) return;
				setBooks(response);
				if (response.length > 0) {
					const hasCurrent = response.some(
						(item) => item.name.toLowerCase() === currentBook.toLowerCase(),
					);
					if (!hasCurrent) {
						setCurrentBook(response[0].name);
						setCurrentChapter(1);
						setCurrentVerse(1);
					}
				}
			} catch (error) {
				if (!isMounted) return;
				if (error instanceof Error && error.name === "NetworkError") {
					setCurrentScreen("connectionError");
				} else {
					setErrorMessage(translate(language, "errors.loadBooks"));
				}
			}
		};
		loadBooks();
		return () => {
			isMounted = false;
		};
	}, [currentBook, language]);

	useEffect(() => {
		const pending = pendingRouteRef.current;
		if (!pending) return;

		// Handle invalid routes (null)
		if (pending === null) {
			setCurrentScreen("notFound");
			pendingRouteRef.current = null;
			return;
		}

		if (pending.screen !== "verse") {
			setCurrentScreen(pending.screen);
			pendingRouteRef.current = null;
			return;
		}

		// Wait for books to load before processing verse routes with a book
		// This prevents showing 404 when the page reloads before books are fetched
		if (pending.book && books.length === 0) {
			return;
		}

		if (pending.book) {
			const matchedBook = books.find(
				(item) => item.name.toLowerCase() === pending.book?.toLowerCase(),
			);
			if (matchedBook) {
				setCurrentBook(matchedBook.name);
			} else {
				// Book not found - show 404 page
				setCurrentScreen("notFound");
				pendingRouteRef.current = null;
				return;
			}
		}

		if (pending.chapter) {
			setCurrentChapter(pending.chapter);
		}

		if (pending.verse) {
			setCurrentVerse(pending.verse);
		}

		setCurrentScreen("verse");
		pendingRouteRef.current = null;
	}, [books]);

	useEffect(() => {
		let isMounted = true;
		const loadChapterData = async () => {
			setIsLoading(true);
			setErrorMessage(null);
			const translationLanguage = translationOnly
				? language === "es"
					? "es"
					: "en"
				: language === "he"
					? undefined
					: language;
			try {
				const [chapterCountValue, verses] = await Promise.all([
					getChapterCount(currentBook.toLowerCase()),
					getChapterVerses(currentBook.toLowerCase(), currentChapter, {
						language: translationLanguage,
						showDss: showQumran,
						hebrewOnly: false, // Always load translations; UI will control display
						referenceMode: translationOnly ? "translation" : "source",
						besorahTextVersion,
					}),
				]);

				const verseCountValue = translationOnly
					? verses.length
					: await getVerseCount(currentBook.toLowerCase(), currentChapter);
				if (!isMounted) return;
				setChapterCount(chapterCountValue);
				setVerseCount(verseCountValue);
				setChapterVerses(verses);
				if (verses.length > 0) {
					const availableVerseNumbers = verses
						.map((verse) => verse.verse)
						.filter(
							(verseNumber) => Number.isFinite(verseNumber) && verseNumber > 0,
						);

					if (availableVerseNumbers.length > 0) {
						const availableVerseSet = new Set(availableVerseNumbers);
						const fallbackVerse = availableVerseNumbers[0];
						setCurrentVerse((prevVerse) =>
							availableVerseSet.has(prevVerse) ? prevVerse : fallbackVerse,
						);
					}
				}
			} catch (error) {
				if (!isMounted) return;
				console.error("Failed to load chapter data", error);
				if (error instanceof Error && error.name === "NetworkError") {
					setCurrentScreen("connectionError");
				} else {
					setErrorMessage(translate(language, "errors.loadVerses"));
				}
			} finally {
				if (isMounted) setIsLoading(false);
			}
		};
		if (currentBook) {
			loadChapterData();
		}
		return () => {
			isMounted = false;
		};
	}, [
		besorahTextVersion,
		currentBook,
		currentChapter,
		language,
		showQumran,
		translationOnly,
	]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const handlePopState = () => {
			isHandlingPopStateRef.current = true;
			const route = parseRoutePathRef.current(window.location.pathname);

			// Handle invalid routes (null)
			if (!route) {
				setCurrentScreen("notFound");
				window.setTimeout(() => {
					isHandlingPopStateRef.current = false;
				}, 0);
				return;
			}

			if (route.screen !== "verse") {
				setCurrentScreen(route.screen);
			} else {
				// If we're coming back from terms/privacy/feedback, go to home instead of verse
				if (
					["terms", "privacy", "feedback"].includes(currentScreenRef.current)
				) {
					setCurrentScreen("home");
				} else {
					if (route.book) {
						const matchedBook = booksRef.current.find(
							(item) => item.name.toLowerCase() === route.book?.toLowerCase(),
						);
						if (matchedBook) {
							setCurrentBook(matchedBook.name);
						} else {
							// Book not found - show 404 page
							setCurrentScreen("notFound");
							window.setTimeout(() => {
								isHandlingPopStateRef.current = false;
							}, 0);
							return;
						}
					}
					if (route.chapter) {
						setCurrentChapter(route.chapter);
					}
					if (route.verse) {
						setCurrentVerse(route.verse);
					}
					setCurrentScreen("verse");
				}
			}
			window.setTimeout(() => {
				isHandlingPopStateRef.current = false;
			}, 0);
		};

		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;
		if (isHandlingPopStateRef.current) return;

		const path = buildRoutePath({
			screen: currentScreen,
			book: currentBook,
			chapter: currentChapter,
			verse: currentVerse,
		});

		if (lastUrlRef.current === path) return;
		window.history.pushState(null, "", path);
		lastUrlRef.current = path;
	}, [
		buildRoutePath,
		currentBook,
		currentChapter,
		currentScreen,
		currentVerse,
	]);

	useEffect(() => {
		let isMounted = true;
		const loadWordAnalysis = async () => {
			if (!selectedWord?.strong) {
				logWordDebug("analysis-skip-no-strong", {
					text: selectedWord?.text ?? null,
					strong: selectedWord?.strong ?? null,
					position: selectedWord?.position ?? null,
				});
				setSelectedWordAnalysis(null);
				setLastSelectedWordAnalysis(null);
				setIsWordAnalysisLoading(false);
				return;
			}

			const strongPart = selectedWord.strong
				.split("/")
				.map((part) => part.trim())
				.find((part) => /^[HGD]\d+$/.test(part));

			if (!strongPart) {
				logWordDebug("analysis-skip-invalid-strong", {
					strong: selectedWord.strong,
				});
				setSelectedWordAnalysis(null);
				setLastSelectedWordAnalysis(null);
				setIsWordAnalysisLoading(false);
				return;
			}

			setIsWordAnalysisLoading(true);
			logWordDebug("analysis-load-start", {
				strong: strongPart,
				language,
			});
			try {
				const analysis = await loadLexiconEntry(
					strongPart,
					language === "he" ? "en" : language,
				);
				if (isMounted) {
					setSelectedWordAnalysis(analysis);
					setIsWordAnalysisLoading(false);
					logWordDebug("analysis-load-success", {
						strong: strongPart,
						hasDefinitions: Boolean(analysis?.definitions?.length),
					});
				}
			} catch (error) {
				if (isMounted) {
					logWordDebug("analysis-load-error", {
						strong: strongPart,
						error,
					});
					console.error("Failed to load word analysis", error);
					setSelectedWordAnalysis(null);
					setLastSelectedWordAnalysis(null);
					setIsWordAnalysisLoading(false);
				}
			}
		};
		loadWordAnalysis();
		return () => {
			isMounted = false;
		};
	}, [selectedWord, language, logWordDebug]);

	useEffect(() => {
		let isMounted = true;
		const loadDssAnalysis = async () => {
			const dssStrong = selectedDssVariant?.dss_strong ?? null;
			if (!dssStrong) {
				setSelectedDssAnalysis(null);
				setLastSelectedDssAnalysis(null);
				setIsDssAnalysisLoading(false);
				return;
			}

			const strongPart = dssStrong
				.split("/")
				.map((part) => part.trim())
				.find((part) => /^[HGD]\d+$/.test(part));

			if (!strongPart) {
				setSelectedDssAnalysis(null);
				setLastSelectedDssAnalysis(null);
				setIsDssAnalysisLoading(false);
				return;
			}

			setIsDssAnalysisLoading(true);
			try {
				const analysis = await loadLexiconEntry(
					strongPart,
					language === "he" ? "en" : language,
				);
				if (isMounted) {
					setSelectedDssAnalysis(analysis);
					setIsDssAnalysisLoading(false);
				}
			} catch (error) {
				if (isMounted) {
					console.error("Failed to load DSS analysis", error);
					setSelectedDssAnalysis(null);
					setLastSelectedDssAnalysis(null);
					setIsDssAnalysisLoading(false);
				}
			}
		};
		loadDssAnalysis();
		return () => {
			isMounted = false;
		};
	}, [selectedDssVariant, language]);

	useEffect(() => {
		if (selectedWord) {
			setLastSelectedWord(selectedWord);
		}
	}, [selectedWord]);

	useEffect(() => {
		if (selectedWordContext) {
			setLastSelectedWordContext(selectedWordContext);
		}
	}, [selectedWordContext]);

	useEffect(() => {
		if (selectedWordAnalysis) {
			setLastSelectedWordAnalysis(selectedWordAnalysis);
		}
	}, [selectedWordAnalysis]);

	useEffect(() => {
		if (selectedDssAnalysis) {
			setLastSelectedDssAnalysis(selectedDssAnalysis);
		}
	}, [selectedDssAnalysis]);

	const isSplitView = Boolean(
		!isMobile && (selectedWord || isNavigatingWordPanel),
	);
	const [isWordPanelVisible, setIsWordPanelVisible] = useState(false);
	const isWordPanelActive =
		!isMobile &&
		!isWordPanelDismissed &&
		(selectedWord || isNavigatingWordPanel);
	const shouldShowWordSkeleton =
		isWordPanelActive &&
		isNavigatingWordPanel &&
		showWordSkeleton &&
		!selectedWord;

	useEffect(() => {
		if (isWordPanelActive) {
			setIsWordPanelVisible(true);
			return undefined;
		}

		if (isWordPanelVisible) {
			const timeout = window.setTimeout(
				() => setIsWordPanelVisible(false),
				300,
			);
			return () => window.clearTimeout(timeout);
		}

		return undefined;
	}, [isWordPanelActive, isWordPanelVisible]);

	useEffect(() => {
		wordPanelDismissedRef.current = isWordPanelDismissed;
	}, [isWordPanelDismissed]);

	useEffect(() => {
		if (wordSkeletonTimerRef.current) {
			window.clearTimeout(wordSkeletonTimerRef.current);
			wordSkeletonTimerRef.current = null;
		}
		setShowWordSkeleton(false);

		if (isMobile) {
			setIsNavigatingWordPanel(false);
			return;
		}

		const navigationKey = `${currentBook}-${currentChapter}-${currentVerse}`;
		if (navigationKeyRef.current === navigationKey) return;
		navigationKeyRef.current = navigationKey;

		if (preserveWordRef.current) {
			setIsNavigatingWordPanel(false);
			setIsWordPanelDismissed(false);
			return;
		}

		setIsNavigatingWordPanel(false);
		setIsWordPanelDismissed(true);
		setSelectedWord(null);
		setSelectedWordContext(null);
	}, [currentBook, currentChapter, currentVerse, isMobile]);

	useEffect(() => {
		if (!currentVerseData || !preserveWordRef.current) return;

		const targetText = pendingWordTextRef.current;
		const targetStrong = pendingWordStrongRef.current;
		const fallbackWord = pendingWordRef.current;

		const normalize = (text: string) =>
			stripMeteg(stripCantillation(text)).replace(/\//g, "");

		let matchedWord: WordResponse | undefined;

		if (targetStrong) {
			matchedWord = currentVerseData.words?.find(
				(word) => word.strong === targetStrong,
			);
		}

		if (!matchedWord && targetText) {
			const normalizedTarget = normalize(targetText);
			matchedWord = currentVerseData.words?.find(
				(word) => normalize(word.text) === normalizedTarget,
			);
		}

		if (matchedWord) {
			setSelectedWord(matchedWord);
			setSelectedWordContext({
				chapter: currentVerseData.chapter,
				verse: currentVerseData.verse,
			});
			setIsWordPanelDismissed(false);
		} else if (fallbackWord) {
			setSelectedWord(fallbackWord);
			setSelectedWordContext({
				chapter: currentVerseData.chapter,
				verse: currentVerseData.verse,
			});
			setIsWordPanelDismissed(false);
		}

		preserveWordRef.current = false;
		pendingWordTextRef.current = null;
		pendingWordStrongRef.current = null;
		pendingWordRef.current = null;
	}, [currentVerseData]);

	useEffect(() => {
		if (!selectedWord) return;
		setIsNavigatingWordPanel(false);
		setShowWordSkeleton(false);
		if (wordSkeletonTimerRef.current) {
			window.clearTimeout(wordSkeletonTimerRef.current);
			wordSkeletonTimerRef.current = null;
		}
	}, [selectedWord]);

	useEffect(() => {
		return () => {
			if (wordSkeletonTimerRef.current) {
				window.clearTimeout(wordSkeletonTimerRef.current);
				wordSkeletonTimerRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		const media = window.matchMedia("(max-width: 767px)");
		const update = () => setIsMobile(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);

	// Online/offline event listeners
	useEffect(() => {
		const handleOnline = () => {
			if (currentScreen === "connectionError") {
				window.location.reload();
			}
		};

		const handleOffline = () => {
			setCurrentScreen("connectionError");
		};

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);

		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, [currentScreen]);

	useEffect(() => {
		if (!isMobile) {
			wordSheetClosingRef.current = false;
			setIsWordSheetOpen(false);
			return;
		}

		if (!selectedWord) {
			setIsWordSheetOpen(false);
			return;
		}

		if (!wordSheetClosingRef.current) {
			setIsWordSheetOpen(true);
		}
	}, [isMobile, selectedWord]);

	useEffect(() => {
		if (!selectedWord || isMobile) {
			setIsWordPanelHovered(false);
		}
	}, [isMobile, selectedWord]);

	useEffect(() => {
		if (!scrollJumpActive) return undefined;
		const timeout = window.setTimeout(() => setScrollJumpActive(false), 240);
		return () => window.clearTimeout(timeout);
	}, [scrollJumpActive]);

	const triggerScrollJump = useCallback(() => {
		if (scrollHintCount < 5) {
			setScrollJumpActive(true);
			setScrollHintCount(scrollHintCount + 1);
		}

		if (desktopScrollHintCount < 5) {
			setDesktopScrollHintCount(desktopScrollHintCount + 1);
		}
	}, [
		desktopScrollHintCount,
		scrollHintCount,
		setDesktopScrollHintCount,
		setScrollHintCount,
	]);

	const handlePreviousVerse = useCallback(async () => {
		if (translationOnly) {
			if (currentVerseIndex > 0) {
				setCurrentVerse(chapterVerses[currentVerseIndex - 1].verse);
				return true;
			}

			if (currentChapter > 1) {
				try {
					const previousChapter = currentChapter - 1;
					const translationLanguage = language === "es" ? "es" : "en";
					const previousChapterVerses = await getChapterVerses(
						currentBook.toLowerCase(),
						previousChapter,
						{
							language: translationLanguage,
							showDss: showQumran,
							hebrewOnly: false,
							referenceMode: "translation",
						},
					);
					const lastVerse = previousChapterVerses.at(-1)?.verse ?? 1;
					setCurrentChapter(previousChapter);
					setCurrentVerse(lastVerse);
					return true;
				} catch {
					return false;
				}
			}

			return false;
		}

		if (currentVerse > 1) {
			setCurrentVerse(currentVerse - 1);
			return true;
		}

		if (currentChapter > 1) {
			try {
				const previousChapter = currentChapter - 1;
				const previousVerseCount = await getVerseCount(
					currentBook.toLowerCase(),
					previousChapter,
				);
				setCurrentChapter(previousChapter);
				setCurrentVerse(previousVerseCount);
				return true;
			} catch {
				return false;
			}
		}
		return false;
	}, [
		chapterVerses,
		currentBook,
		currentChapter,
		currentVerse,
		currentVerseIndex,
		language,
		showQumran,
		translationOnly,
	]);

	const handleNextVerse = useCallback(async () => {
		if (translationOnly) {
			if (
				currentVerseIndex >= 0 &&
				currentVerseIndex < chapterVerses.length - 1
			) {
				setCurrentVerse(chapterVerses[currentVerseIndex + 1].verse);
				return true;
			}

			if (currentChapter < chapterCount) {
				try {
					const nextChapter = currentChapter + 1;
					const translationLanguage = language === "es" ? "es" : "en";
					const nextChapterVerses = await getChapterVerses(
						currentBook.toLowerCase(),
						nextChapter,
						{
							language: translationLanguage,
							showDss: showQumran,
							hebrewOnly: false,
							referenceMode: "translation",
						},
					);
					const firstVerse = nextChapterVerses[0]?.verse ?? 1;
					setCurrentChapter(nextChapter);
					setCurrentVerse(firstVerse);
					return true;
				} catch {
					return false;
				}
			}

			return false;
		}

		if (currentVerse < verseCount) {
			setCurrentVerse(currentVerse + 1);
			return true;
		}

		if (currentChapter < chapterCount) {
			setCurrentChapter(currentChapter + 1);
			setCurrentVerse(1);
			return true;
		}
		return false;
	}, [
		chapterCount,
		chapterVerses,
		currentBook,
		currentChapter,
		currentVerse,
		currentVerseIndex,
		language,
		showQumran,
		translationOnly,
		verseCount,
	]);

	const isScrollNavigationActive =
		currentScreen === "verse" && !showFullChapter && !isMobile;

	useEffect(() => {
		if (isMobile) {
			const threshold = 24;
			lastScrollYRef.current = window.scrollY;

			const handleMobileScroll = () => {
				const currentY = window.scrollY;
				const delta = currentY - lastScrollYRef.current;

				if (currentY <= threshold) {
					setHideNavOnScroll(false);
				} else if (delta > 4) {
					setHideNavOnScroll(true);
				} else if (delta < -4) {
					setHideNavOnScroll(false);
				}

				lastScrollYRef.current = currentY;
			};

			handleMobileScroll();
			window.addEventListener("scroll", handleMobileScroll, { passive: true });
			return () => window.removeEventListener("scroll", handleMobileScroll);
		}

		if (!(currentScreen === "verse" && showFullChapter && seferMode)) {
			setHideNavOnScroll(false);
			return;
		}

		const handleScroll = () => {
			setHideNavOnScroll(window.scrollY > 40);
		};

		handleScroll();
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, [currentScreen, isMobile, showFullChapter, seferMode]);

	useVerseScrollNavigation({
		containerRef: versePanelRef,
		isEnabled: isScrollNavigationActive,
		isBlocked: isWordPanelHovered,
		threshold: 36,
		cooldownMs: 500,
		onNavigateNext: handleNextVerse,
		onNavigatePrevious: handlePreviousVerse,
		onNavigateFeedback: triggerScrollJump,
	});

	return (
		<div
			className="min-h-screen"
			style={{
				backgroundColor: "var(--background)",
				minHeight: isMobile ? "100dvh" : undefined,
				height: isScrollNavigationActive ? "100vh" : undefined,
				overflow: isScrollNavigationActive ? "hidden" : undefined,
			}}
		>
			<div
				className={`sticky top-0 z-40 px-2 pt-4 pb-4 sm:px-4 sm:pt-5 sm:pb-5 md:px-6 md:pt-6 md:pb-6 transition-transform duration-300 ${
					hideNavOnScroll
						? "-translate-y-full opacity-0 pointer-events-none"
						: "translate-y-0 opacity-100"
				}`}
			>
				<div className="mx-auto flex justify-center">
					<NavigationBar
						book={currentBook}
						bookDisplayName={getDisplayBookName(currentBook)}
						bookHebrew={getHebrewBookName(currentBook)}
						chapter={currentChapter}
						verse={currentVerse}
						books={bookOptions}
						chapterCount={chapterCount}
						verseCount={verseCount}
						onBookChange={(selectedBook) => {
							if (selectedBook === currentBook) {
								// Same book - retrieve last position for this book
								const stored = getStoredReadingState();
								if (stored) {
									const position = getLastPositionForBook(stored, selectedBook);
									setCurrentChapter(position.chapter);
									setCurrentVerse(position.verse);
								}
							} else {
								// Different book - reset to 1:1
								setCurrentBook(selectedBook);
								setCurrentChapter(1);
								setCurrentVerse(1);
							}
							setCurrentScreen("verse");
						}}
						onChapterChange={(chapter) => {
							setCurrentChapter(chapter);
							setCurrentVerse(1);
						}}
						onVerseChange={(verse) => setCurrentVerse(verse)}
						onHomeClick={() => setCurrentScreen("home")}
						onDesignSystemClick={() => setShowDesignSystem(true)}
						theme={theme}
						onThemeChange={setTheme}
						language={language}
						onLanguageChange={setLanguage}
						besorahTextVersion={besorahTextVersion}
						onBesorahTextVersionChange={handleBesorahTextVersionChange}
						showQumran={showQumran}
						onQumranChange={setShowQumran}
						showFullChapter={showFullChapter}
						onFullChapterChange={setShowFullChapter}
						seferMode={seferMode}
						onSeferModeChange={handleSeferModeChange}
						hebrewOnly={hebrewOnly}
						onHebrewOnlyChange={handleHebrewOnlyChange}
						showNikud={showNikud}
						onNikudChange={setShowNikud}
						showCantillation={showCantillation}
						onCantillationChange={setShowCantillation}
						translationOnly={translationOnly}
						onTranslationOnlyChange={handleTranslationOnlyChange}
					/>
				</div>
			</div>

			{currentScreen === "verse" && isBesorah && !translationOnly && (
				<div
					className="fixed left-6 top-6 z-50 pointer-events-none max-w-[280px] rounded-md px-3 py-1.5 text-xs leading-snug"
					style={{
						backgroundColor: "var(--surface)",
						color: "var(--text-secondary)",
						border: "1px solid var(--border-color)",
					}}
				>
					{besorahDisclaimerText}
				</div>
			)}

			{showHutterAnnouncement && (
				<div
					className="fixed inset-0 z-[120] flex items-center justify-center px-5"
					style={{ background: "rgba(20, 16, 12, 0.45)" }}
					role="dialog"
					aria-modal="true"
					aria-labelledby="hutter-announcement-title"
				>
					<div
						className="relative w-full max-w-md rounded-[28px] border p-7"
						style={{
							background: "var(--neomorph-bg)",
							borderColor: "var(--neomorph-border)",
							boxShadow:
								"12px 12px 28px var(--neomorph-shadow-dark), -8px -8px 24px var(--neomorph-shadow-light)",
						}}
					>
						<button
							type="button"
							onClick={dismissHutterAnnouncement}
							aria-label={t("verse.hutterAnnouncement.close")}
							className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-xl text-[var(--text-secondary)] hover:bg-[var(--muted)]"
						>
							×
						</button>
						<h2
							id="hutter-announcement-title"
							className="pr-8 text-2xl font-semibold text-[var(--text-primary)]"
							style={{ fontFamily: "'Inter', sans-serif" }}
						>
							{t("verse.hutterAnnouncement.title")}
						</h2>
						<p
							className="mt-3 text-sm leading-6 text-[var(--text-secondary)]"
							style={{ fontFamily: "'Inter', sans-serif" }}
						>
							{t("verse.hutterAnnouncement.message")}
						</p>
						<button
							type="button"
							onClick={activateHutter}
							className="mt-6 w-full rounded-full bg-[var(--primary)] px-5 py-3.5 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.01] active:scale-[0.99]"
							style={{ fontFamily: "'Inter', sans-serif" }}
						>
							{t("verse.hutterAnnouncement.activate")}
						</button>
					</div>
				</div>
			)}

			<div className="px-6 pb-10 md:pb-32 pt-6">
				<div className="max-w-7xl mx-auto">
					{currentScreen === "home" && (
						<HomeScreen
							language={language}
							onFeaturesClick={() => setCurrentScreen("features")}
							onDonateClick={() => setCurrentScreen("donate")}
						/>
					)}
					{currentScreen === "terms" && (
						<LegalScreen
							kind="terms"
							language={language}
							onBack={() => setCurrentScreen("home")}
						/>
					)}
					{currentScreen === "privacy" && (
						<LegalScreen
							kind="privacy"
							language={language}
							onBack={() => setCurrentScreen("home")}
						/>
					)}
					{currentScreen === "feedback" && (
						<FeedbackScreen
							language={language}
							onBack={() => setCurrentScreen("home")}
						/>
					)}
					{currentScreen === "donate" && <DonateScreen language={language} />}
					{currentScreen === "features" && (
						<FeaturesScreen language={language} />
					)}
					{currentScreen === "settings" && (
						<SettingsScreen
							theme={theme}
							onThemeChange={setTheme}
							language={language}
							onLanguageChange={setLanguage}
							besorahTextVersion={besorahTextVersion}
							onBesorahTextVersionChange={handleBesorahTextVersionChange}
							showQumran={showQumran}
							onQumranChange={setShowQumran}
							showFullChapter={showFullChapter}
							onFullChapterChange={setShowFullChapter}
							seferMode={seferMode}
							onSeferModeChange={handleSeferModeChange}
							hebrewOnly={hebrewOnly}
							onHebrewOnlyChange={handleHebrewOnlyChange}
							onDesignSystemClick={() => setShowDesignSystem(true)}
							onMobileDesignGuideClick={() => setShowMobileDesignGuide(true)}
						/>
					)}

					{currentScreen === "notFound" && (
						<NotFoundPage
							language={language}
							onGoBack={() => setCurrentScreen("verse")}
						/>
					)}

					{currentScreen === "connectionError" && (
						<ConnectionErrorPage onRetry={() => window.location.reload()} />
					)}

					{currentScreen === "verse" && (
						<div className="grid gap-6 items-start md:grid-cols-[7fr_3fr]">
							<div
								ref={versePanelRef}
								className={`min-h-[70vh] ${
									showFullChapter
										? isMobile
											? "pt-8"
											: ""
										: isMobile
											? "flex items-start pt-8"
											: "flex items-center justify-center"
								} w-full max-w-3xl md:max-w-4xl justify-self-center verse-panel-shell ${
									isSplitView
										? "verse-panel-split md:col-span-1"
										: "verse-panel-centered md:col-span-2"
								} ${scrollJumpActive ? "verse-panel-jump" : ""}`}
								style={
									showFullChapter
										? undefined
										: isMobile
											? undefined
											: { height: "70vh" }
								}
							>
								<div className="verse-panel-inner relative">
									{currentVerseData ? (
										<VerseDisplay
											hebrewText={currentVerseData.hebrew}
											translation={currentVerseData.translation ?? ""}
											verseRef={`${currentBook} ${currentChapter}:${currentVerse}`}
											verseNumber={currentVerseData.verse}
											bookName={getDisplayBookName(currentBook)}
											bookNameHebrew={getHebrewBookName(currentBook)}
											book={currentBook}
											chapter={currentChapter}
											language={language}
											onWordClick={handleWordClick}
											showOnboardingHint={showWordHint}
											showQumran={showQumran}
											showFullChapter={showFullChapter}
											seferMode={seferMode}
											hebrewOnly={hebrewOnly}
											showNikud={showNikud}
											showCantillation={showCantillation}
											translationOnly={translationOnly}
											chapterVerses={chapterVerses}
											words={currentVerseData.words}
											dssVariants={currentVerseData.dss}
											selectedWord={highlightedWord ?? null}
											selectedWordContext={highlightedWordContext}
											isBesorah={isBesorah}
											translation_footnotes={
												currentVerseData.translation_footnotes
											}
											previousVerseSnippet={
												currentVerseIndex > 0
													? t("verse.previousSnippet")
													: undefined
											}
											nextVerseSnippet={
												currentVerseIndex >= 0 &&
												currentVerseIndex < chapterVerses.length - 1
													? t("verse.nextSnippet")
													: undefined
											}
											onSwipeUp={() => {
												void handlePreviousVerse();
											}}
											onSwipeDown={() => {
												void handleNextVerse();
											}}
											canNavigatePrevious={
												currentVerseIndex > 0 || currentChapter > 1
											}
											canNavigateNext={
												(currentVerseIndex >= 0 &&
													currentVerseIndex < chapterVerses.length - 1) ||
												currentChapter < chapterCount
											}
										/>
									) : (
										<NeumorphCard>
											{isLoading ? (
												<div className="mx-auto w-fit space-y-3">
													<Skeleton className="h-3 w-56" />
													<Skeleton className="h-3 w-56" />
													<Skeleton className="h-3 w-56" />
													<Skeleton className="h-3 w-56" />
												</div>
											) : (
												<p className="text-sm text-gray-500">
													{t("verse.selectBookPrompt")}
												</p>
											)}
										</NeumorphCard>
									)}
								</div>
							</div>

							{/* Word panel - in full chapter mode, only render when active to avoid blocking clicks */}
							{(!showFullChapter || isWordPanelActive) && (
								<div
									className={`hidden md:block ${showFullChapter ? "word-panel-fixed-wrapper" : ""}`}
									style={showFullChapter ? undefined : { height: "70vh" }}
								>
									{(() => {
										const wordForCard =
											selectedWord ??
											(!isNavigatingWordPanel && !showWordSkeleton
												? lastSelectedWord
												: null);
										const wordContextForCard =
											selectedWord && selectedWordContext
												? selectedWordContext
												: !selectedWord && lastSelectedWordContext
													? lastSelectedWordContext
													: null;
										const wordAnalysisForCard = selectedWord
											? selectedWordAnalysis
											: lastSelectedWordAnalysis;
										const dssAnalysisForCard = selectedWord
											? selectedDssAnalysis
											: lastSelectedDssAnalysis;
										const verseDataForWordCard = wordContextForCard
											? (chapterVerses.find(
													(item) =>
														item.chapter === wordContextForCard.chapter &&
														item.verse === wordContextForCard.verse,
												) ?? currentVerseData)
											: currentVerseData;
										const dssVariantForCard =
											verseDataForWordCard?.dss?.find(
												(variant) => variant.position === wordForCard?.position,
											) ?? null;
										const qumranWordForCard = resolveRenderableDssWord(
											dssVariantForCard?.dss_word,
										);
										const wordMeanings =
											wordAnalysisForCard?.definitions?.map(
												(item) => item.text,
											) ?? [];
										const wordTransliteration =
											getTransliterationForLanguage(wordForCard) ??
											getAnalysisTransliterationForLanguage(
												wordAnalysisForCard,
											);
										const qumranTransliterationFromWord = wordForCard
											? language === "en"
												? wordForCard.dss_translit_en
												: language === "es"
													? wordForCard.dss_translit_es
													: undefined
											: undefined;
										const qumranTransliteration =
											qumranTransliterationFromWord ??
											(dssAnalysisForCard
												? language === "en"
													? dssAnalysisForCard.translit_en
													: language === "es"
														? dssAnalysisForCard.translit_es
														: undefined
												: undefined);
										const dssCommentary = getDssCommentaryForLanguage(
											language,
											dssVariantForCard,
										);
										const dssMeanings =
											dssAnalysisForCard?.definitions?.map(
												(item) => item.text,
											) ?? [];
										const hasQumranVariant = Boolean(qumranWordForCard);

										return (
											<NeumorphCard
												className={`p-6 ${
													isWordPanelActive
														? "word-panel-open"
														: "word-panel-closed"
												} ${showFullChapter ? "" : "sticky top-24"} word-panel-shell ${
													hasQumranVariant ? "word-card-qumran" : ""
												}`}
												onMouseEnter={() => setIsWordPanelHovered(true)}
												onMouseLeave={() => setIsWordPanelHovered(false)}
											>
												{shouldShowWordSkeleton ? (
													<div className="space-y-5">
														<div className="flex justify-end">
															<Skeleton className="h-9 w-9 rounded-full" />
														</div>
														<Skeleton className="h-16 w-40 mx-auto" />
														<Skeleton className="h-3 w-32 mx-auto" />
														<Skeleton className="h-4 w-full" />
														<Skeleton className="h-4 w-4/5" />
														<Skeleton className="h-4 w-3/4" />
													</div>
												) : wordForCard && isWordPanelVisible ? (
													<WordCard
														word={wordForCard.text}
														wordFromVerse={wordForCard.text}
														strongNumber={wordAnalysisForCard?.strong_number}
														qumranWord={qumranWordForCard}
														qumranStrong={dssVariantForCard?.dss_strong}
														qumranTransliteration={qumranTransliteration}
														qumranMeanings={dssMeanings}
														qumranCommentary={dssCommentary}
														qumranRoot={dssAnalysisForCard?.root}
														qumranRootTransliteration={
															language === "en"
																? dssAnalysisForCard?.root_translit_en
																: dssAnalysisForCard?.root_translit_es
														}
														qumranRootMeaning={
															dssAnalysisForCard?.root_definitions
																?.map((item) => item.text)
																.filter(Boolean)
																.join(", ") || undefined
														}
														qumranRootStrongNumber={
															dssAnalysisForCard?.root_strong
														}
														hasQumranVariant={hasQumranVariant}
														showQumran={showQumran}
														transliteration={wordTransliteration}
														meanings={wordMeanings}
														root={wordAnalysisForCard?.root}
														rootTransliteration={
															language === "en"
																? wordAnalysisForCard?.root_translit_en
																: wordAnalysisForCard?.root_translit_es
														}
														rootMeaning={
															wordAnalysisForCard?.root_definitions
																?.map((item) => item.text)
																.filter(Boolean)
																.join(", ") || undefined
														}
														rootStrongNumber={wordAnalysisForCard?.root_strong}
														prefixes={wordForCard.prefixes}
														language={language}
														showNikud={showNikud}
														instances={(
															wordAnalysisForCard?.instances ?? []
														).map((instance) =>
															typeof instance === "string"
																? { verse: instance, text: "" }
																: instance,
														)}
														onInstanceClick={handleNavigateToVerse}
														tabResetKey={wordCardTabKey}
														onClose={() => {
															if (!isMobile) {
																setIsWordPanelDismissed(true);
															}
															setSelectedWord(null);
															setSelectedWordContext(null);
															setIsNavigatingWordPanel(false);
															setShowWordSkeleton(false);
															if (wordSkeletonTimerRef.current) {
																window.clearTimeout(
																	wordSkeletonTimerRef.current,
																);
																wordSkeletonTimerRef.current = null;
															}
														}}
														isLoading={Boolean(
															selectedWord && isWordAnalysisLoading,
														)}
														isQumranLoading={Boolean(
															selectedWord && isDssAnalysisLoading,
														)}
														isBesorah={isBesorah}
													/>
												) : isNavigatingWordPanel ? (
													<div className="h-40" />
												) : (
													<div
														className="text-sm text-[var(--text-secondary)]"
														style={{ fontFamily: "'Inter', sans-serif" }}
													>
														{t("wordCard.selectWord")}
													</div>
												)}
											</NeumorphCard>
										);
									})()}
								</div>
							)}
						</div>
					)}
				</div>
			</div>

			<div className="md:hidden">
				<div className="h-10" />
			</div>

			{isScrollNavigationActive && desktopScrollHintCount < 5 && (
				<div className="scroll-nav-hint" aria-live="polite">
					<p>{t("verse.scrollNextHint")}</p>
					{currentVerse > 1 && <p>{t("verse.scrollPreviousHint")}</p>}
				</div>
			)}

			{isMobile && currentScreen === "verse" && (
				<BottomSheet
					isOpen={isWordSheetOpen}
					onClose={closeWordSheet}
					onAfterClose={handleWordSheetAfterClose}
					title=""
				>
					{(() => {
						if (!selectedWord) return null;

						const selectedWordVerseDataForSheet = selectedWordContext
							? (chapterVerses.find(
									(item) =>
										item.chapter === selectedWordContext.chapter &&
										item.verse === selectedWordContext.verse,
								) ?? currentVerseData)
							: currentVerseData;

						const dssVariantForCard =
							selectedWordVerseDataForSheet?.dss?.find(
								(variant) => variant.position === selectedWord.position,
							) ?? null;
						const qumranWordForCard = resolveRenderableDssWord(
							dssVariantForCard?.dss_word,
						);
						const dssCommentary = getDssCommentaryForLanguage(
							language,
							dssVariantForCard,
						);
						const dssMeanings =
							selectedDssAnalysis?.definitions?.map((item) => item.text) ?? [];
						const hasQumranVariant = Boolean(qumranWordForCard);
						const qumranTransliterationFromWord =
							language === "en"
								? selectedWord.dss_translit_en
								: language === "es"
									? selectedWord.dss_translit_es
									: undefined;
						const qumranTransliteration = selectedDssAnalysis
							? (qumranTransliterationFromWord ??
								(language === "en"
									? selectedDssAnalysis.translit_en
									: language === "es"
										? selectedDssAnalysis.translit_es
										: undefined))
							: qumranTransliterationFromWord;

						const selectedWordMeanings =
							selectedWordAnalysis?.definitions?.map((item) => item.text) ?? [];
						const selectedWordTransliteration =
							getTransliterationForLanguage(selectedWord) ??
							getAnalysisTransliterationForLanguage(selectedWordAnalysis);

						return (
							<WordCard
								word={selectedWord.text}
								wordFromVerse={selectedWord.text}
								strongNumber={selectedWordAnalysis?.strong_number}
								qumranWord={qumranWordForCard}
								qumranStrong={dssVariantForCard?.dss_strong}
								qumranTransliteration={qumranTransliteration}
								qumranMeanings={dssMeanings}
								qumranCommentary={dssCommentary}
								qumranRoot={selectedDssAnalysis?.root}
								qumranRootTransliteration={
									language === "en"
										? selectedDssAnalysis?.root_translit_en
										: selectedDssAnalysis?.root_translit_es
								}
								qumranRootMeaning={
									selectedDssAnalysis?.root_definitions
										?.map((item) => item.text)
										.filter(Boolean)
										.join(", ") || undefined
								}
								qumranRootStrongNumber={selectedDssAnalysis?.root_strong}
								hasQumranVariant={hasQumranVariant}
								showQumran={showQumran}
								transliteration={selectedWordTransliteration}
								meanings={selectedWordMeanings}
								root={selectedWordAnalysis?.root}
								rootTransliteration={
									language === "en"
										? selectedWordAnalysis?.root_translit_en
										: selectedWordAnalysis?.root_translit_es
								}
								rootMeaning={
									selectedWordAnalysis?.root_definitions
										?.map((item) => item.text)
										.filter(Boolean)
										.join(", ") || undefined
								}
								rootStrongNumber={selectedWordAnalysis?.root_strong}
								prefixes={selectedWord.prefixes}
								language={language}
								showNikud={showNikud}
								instances={(selectedWordAnalysis?.instances ?? []).map(
									(instance) =>
										typeof instance === "string"
											? { verse: instance, text: "" }
											: instance,
								)}
								onInstanceClick={handleNavigateToVerse}
								tabResetKey={wordCardTabKey}
								onClose={closeWordSheet}
								isLoading={Boolean(selectedWord && isWordAnalysisLoading)}
								isQumranLoading={Boolean(isDssAnalysisLoading)}
								isBesorah={isBesorah}
							/>
						);
					})()}
				</BottomSheet>
			)}

			{showDesignSystem && (
				<div className="fixed inset-0 z-50 overflow-auto">
					<DesignSystemExport
						theme={theme}
						onThemeChange={setTheme}
						onClose={() => setShowDesignSystem(false)}
					/>
				</div>
			)}

			{showMobileDesignGuide && (
				<div className="fixed inset-0 z-50 overflow-auto bg-[var(--background)]">
					<div className="min-h-screen p-8">
						<div className="max-w-7xl mx-auto">
							<button
								type="button"
								onClick={() => setShowMobileDesignGuide(false)}
								className="mb-8 px-6 py-3 bg-[var(--primary)] text-white rounded-full hover:scale-105 transition-all"
								style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600 }}
							>
								{t("navigation.backToApp")}
							</button>
							<MobileDesignSystemGuide />
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
