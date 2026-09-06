import { BookOpen, Home, Paintbrush, ScrollText, Settings } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
	SHARED_SETTINGS_ORDER,
	canUseSeferStyle,
	isSeferStyleVisible,
	type SharedSettingId,
} from "@davar/shared/settingsOrder";
import { FaThList } from "react-icons/fa";
import { LuLightbulb } from "react-icons/lu";
import { TbAlphabetHebrew, TbLanguageHiragana } from "react-icons/tb";
import { useTranslation } from "../hooks/useTranslation";
import { formatBookDisplayName } from "../utils/bookNameFormatter";
import { NeumorphCard } from "./NeumorphCard";
import { NeumorphicToggle } from "./NeumorphicToggle";

interface NavigationBarProps {
	book: string;
	bookDisplayName: string;
	bookHebrew: string;
	chapter: number;
	verse: number;
	books: { name: string; hebrew: string; spanish: string }[];
	chapterCount: number;
	verseCount: number;
	onBookChange: (book: string) => void;
	onChapterChange: (chapter: number) => void;
	onVerseChange: (verse: number) => void;
	onHomeClick: () => void;
	onDesignSystemClick?: () => void;
	theme: "light" | "dark";
	onThemeChange: (theme: "light" | "dark") => void;
	language: "en" | "es" | "he";
	onLanguageChange: (language: "en" | "es" | "he") => void;
	besorahTextVersion: "delitzsch" | "hutter";
	onBesorahTextVersionChange: (version: "delitzsch" | "hutter") => void;
	showQumran: boolean;
	onQumranChange: (show: boolean) => void;
	showFullChapter: boolean;
	onFullChapterChange: (show: boolean) => void;
	seferMode: boolean;
	onSeferModeChange: (show: boolean) => void;
	hebrewOnly: boolean;
	onHebrewOnlyChange: (show: boolean) => void;
	showNikud: boolean;
	onNikudChange: (show: boolean) => void;
	showCantillation: boolean;
	onCantillationChange: (show: boolean) => void;
	translationOnly: boolean;
	onTranslationOnlyChange: (show: boolean) => void;
}

export function NavigationBar({
	book,
	bookDisplayName,
	bookHebrew,
	chapter,
	verse,
	books,
	chapterCount,
	verseCount,
	onBookChange,
	onChapterChange,
	onVerseChange,
	onHomeClick,
	onDesignSystemClick,
	theme,
	onThemeChange,
	language,
	onLanguageChange,
	besorahTextVersion,
	onBesorahTextVersionChange,
	showQumran,
	onQumranChange,
	showFullChapter,
	onFullChapterChange,
	seferMode,
	onSeferModeChange,
	hebrewOnly,
	onHebrewOnlyChange,
	showNikud,
	onNikudChange,
	showCantillation,
	onCantillationChange,
	translationOnly,
	onTranslationOnlyChange,
}: NavigationBarProps) {
	const [openMenu, setOpenMenu] = useState<
		"settings" | "book" | "chapter" | "verse" | null
	>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const bookListRef = useRef<HTMLDivElement>(null);
	const bookSearchRef = useRef<HTMLInputElement>(null);
	const chapterSearchRef = useRef<HTMLInputElement>(null);
	const verseSearchRef = useRef<HTMLInputElement>(null);
	const [bookSearch, setBookSearch] = useState("");
	const [chapterSearch, setChapterSearch] = useState("");
	const [verseSearch, setVerseSearch] = useState("");
	const { t } = useTranslation(language);
	const isRTL = language === "he";
	const env =
		(
			import.meta as ImportMeta & {
				env?: { PUBLIC_NODE_ENV?: string };
			}
		).env ?? {};
	const publicNodeEnv = env.PUBLIC_NODE_ENV ?? "production";
	const isDev = publicNodeEnv === "development";

	useEffect(() => {
		const handleClickOutside = (event: PointerEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target as Node)
			) {
				setOpenMenu(null);
			}
		};

		if (openMenu) {
			document.addEventListener("pointerdown", handleClickOutside);
			return () =>
				document.removeEventListener("pointerdown", handleClickOutside);
		}
	}, [openMenu]);

	useEffect(() => {
		const isSelectionMenuOpen =
			openMenu === "book" || openMenu === "chapter" || openMenu === "verse";
		if (!isSelectionMenuOpen) return;

		const previousOverflow = document.body.style.overflow;
		const previousOverscrollBehavior = document.body.style.overscrollBehavior;

		document.body.style.overflow = "hidden";
		document.body.style.overscrollBehavior = "none";

		return () => {
			document.body.style.overflow = previousOverflow;
			document.body.style.overscrollBehavior = previousOverscrollBehavior;
		};
	}, [openMenu]);

	useEffect(() => {
		if (!openMenu) return;

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpenMenu(null);
			}
		};

		document.addEventListener("keydown", handleEscape);
		return () => document.removeEventListener("keydown", handleEscape);
	}, [openMenu]);

	useEffect(() => {
		if (!openMenu) return;
		if (openMenu === "book") {
			setBookSearch("");
			window.setTimeout(() => bookSearchRef.current?.focus(), 0);
		}
		if (openMenu === "chapter") {
			setChapterSearch("");
			window.setTimeout(() => chapterSearchRef.current?.focus(), 0);
		}
		if (openMenu === "verse") {
			setVerseSearch("");
			window.setTimeout(() => verseSearchRef.current?.focus(), 0);
		}
	}, [openMenu]);

	const languages = [
		{ code: "en", label: t("languages.en") },
		{ code: "es", label: t("languages.es") },
		{ code: "he", label: t("languages.he") },
	];
	const besorahTextVersions = [
		{ code: "delitzsch", label: t("settings.besorahTextVersion.delitzsch") },
		{ code: "hutter", label: t("settings.besorahTextVersion.hutter") },
	] as const;

	const chapters = Array.from({ length: chapterCount }, (_, i) => i + 1);
	const verses = Array.from({ length: verseCount }, (_, i) => i + 1);

	const normalizedBookSearch = bookSearch.trim().toLowerCase();
	const filteredBooks = normalizedBookSearch
		? books.filter((item) => {
				const haystack = [item.name, item.spanish, item.hebrew]
					.filter(Boolean)
					.join(" ")
					.toLowerCase();
				return haystack.includes(normalizedBookSearch);
			})
		: books;

	useEffect(() => {
		if (openMenu !== "book") return;

		const rafId = window.requestAnimationFrame(() => {
			const selectedBookButton =
				bookListRef.current?.querySelector<HTMLButtonElement>(
					'[data-current-book="true"]',
				);
			selectedBookButton?.scrollIntoView({
				block: "center",
				inline: "nearest",
			});
		});

		return () => window.cancelAnimationFrame(rafId);
	}, [openMenu]);

	const normalizedChapterSearch = chapterSearch.trim();
	const filteredChapters = normalizedChapterSearch
		? chapters.filter((item) =>
				String(item).startsWith(normalizedChapterSearch),
			)
		: chapters;

	const normalizedVerseSearch = verseSearch.trim();
	const filteredVerses = normalizedVerseSearch
		? verses.filter((item) => String(item).startsWith(normalizedVerseSearch))
		: verses;
	const translationOnlyDisablesHebrewOptions = translationOnly;
	const seferEnabled = canUseSeferStyle({
		showFullChapter,
		hebrewOnly,
		translationOnly,
	});
	const seferDisabled = !seferEnabled;

	useEffect(() => {
		if (seferMode && openMenu === "verse") {
			setOpenMenu(null);
		}
	}, [seferMode, openMenu]);


	const renderSharedSetting = (id: SharedSettingId): ReactNode => {
		switch (id) {
			case "theme":
				return (
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<LuLightbulb className="w-4 h-4 text-[var(--text-secondary)]" />
							<span
								className="text-sm text-[var(--text-primary)]"
								style={{ fontFamily: "'Inter', sans-serif" }}
							>
								{t("settings.theme.title")}
							</span>
						</div>
						<NeumorphicToggle
							enabled={theme === "dark"}
							onToggle={() =>
								onThemeChange(theme === "light" ? "dark" : "light")
							}
							ariaLabel={t("navigation.toggleDarkTheme")}
						/>
					</div>
				);
			case "language":
				return (
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<TbLanguageHiragana className="w-4 h-4 text-[var(--text-secondary)]" />
							<span
								className="text-sm text-[var(--text-primary)]"
								style={{ fontFamily: "'Inter', sans-serif" }}
							>
								{t("settings.language.title")}
							</span>
						</div>
						<select
							value={language}
							onChange={(event) =>
								onLanguageChange(event.target.value as "en" | "es" | "he")
							}
							className="rounded-full px-3 py-2 text-base md:text-xs text-[var(--text-primary)]"
							style={{
								fontFamily: "'Inter', sans-serif",
								backgroundColor: "var(--neomorph-bg)",
								border: "1px solid var(--neomorph-border)",
								boxShadow:
									"inset 3px 3px 6px var(--neomorph-inset-shadow-dark), inset -3px -3px 6px var(--neomorph-inset-shadow-light)",
							}}
						>
							{languages.map((lang) => (
								<option key={lang.code} value={lang.code}>
									{lang.label}
								</option>
							))}
						</select>
					</div>
				);
			case "besorahTextVersion":
				return (
					<div className="flex items-center justify-between gap-4">
						<div className="flex items-center gap-3">
							<ScrollText className="w-4 h-4 text-[var(--text-secondary)]" />
							<div>
								<div className="flex items-center gap-2">
									<div
										className="text-sm text-[var(--text-primary)]"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.besorahTextVersion.title")}
									</div>
									<span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
										{t("settings.besorahTextVersion.new")}
									</span>
								</div>
							</div>
						</div>
						<select
							value={besorahTextVersion}
							onChange={(event) =>
								onBesorahTextVersionChange(
									event.target.value as "delitzsch" | "hutter",
								)
							}
							className="rounded-full px-3 py-2 text-base md:text-xs text-[var(--text-primary)]"
							style={{
								fontFamily: "'Inter', sans-serif",
								backgroundColor: "var(--neomorph-bg)",
								border: "1px solid var(--neomorph-border)",
								boxShadow:
									"inset 3px 3px 6px var(--neomorph-inset-shadow-dark), inset -3px -3px 6px var(--neomorph-inset-shadow-light)",
							}}
						>
							{besorahTextVersions.map((version) => (
								<option key={version.code} value={version.code}>
									{version.label}
								</option>
							))}
						</select>
					</div>
				);
			case "fullChapter":
				return (
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<FaThList className="w-4 h-4 text-[var(--text-secondary)]" />
							<span
								className="text-sm text-[var(--text-primary)]"
								style={{ fontFamily: "'Inter', sans-serif" }}
							>
								{t("settings.fullChapter.title")}
							</span>
						</div>
						<NeumorphicToggle
							enabled={showFullChapter}
							onToggle={() => onFullChapterChange(!showFullChapter)}
							ariaLabel={t("navigation.toggleFullChapter")}
						/>
					</div>
				);
			case "seferStyle":
				if (!isSeferStyleVisible(showFullChapter)) return null;
				return (
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<BookOpen className="w-4 h-4 text-[var(--text-secondary)]" />
							<span
								className="text-sm text-[var(--text-primary)]"
								style={{ fontFamily: "'Inter', sans-serif" }}
							>
								{t("settings.seferStyle.title")}
							</span>
						</div>
						<NeumorphicToggle
							enabled={seferMode}
							onToggle={() => onSeferModeChange(!seferMode)}
							ariaLabel={t("navigation.toggleSeferStyle")}
							disabled={seferDisabled}
							disabledReason={t("settings.seferStyle.warningMessage")}
						/>
					</div>
				);
			case "hebrewOnly":
				return (
					<div
						className={`flex items-center justify-between ${translationOnlyDisablesHebrewOptions ? "opacity-60" : ""}`}
					>
						<div className="flex items-center gap-3">
							<TbAlphabetHebrew className="w-4 h-4 text-[var(--text-secondary)]" />
							<span
								className="text-sm text-[var(--text-primary)]"
								style={{ fontFamily: "'Inter', sans-serif" }}
							>
								{t("settings.hebrewOnly.title")}
							</span>
						</div>
						<NeumorphicToggle
							enabled={hebrewOnly}
							onToggle={() => onHebrewOnlyChange(!hebrewOnly)}
							ariaLabel={t("navigation.toggleHebrewOnly")}
							disabled={translationOnlyDisablesHebrewOptions}
							disabledReason={t(
								"settings.translationOnly.disablesHebrewFeatures",
							)}
						/>
					</div>
				);
			case "qumran":
				return (
					<div
						className={`flex items-center justify-between ${translationOnlyDisablesHebrewOptions ? "opacity-60" : ""}`}
					>
						<div className="flex items-center gap-3">
							<ScrollText className="w-4 h-4 text-[var(--text-secondary)]" />
							<span
								className="text-sm text-[var(--text-primary)]"
								style={{ fontFamily: "'Inter', sans-serif" }}
							>
								{t("settings.qumran.title")}
							</span>
						</div>
						<NeumorphicToggle
							enabled={showQumran}
							onToggle={() => onQumranChange(!showQumran)}
							ariaLabel={t("navigation.toggleQumran")}
							disabled={translationOnlyDisablesHebrewOptions}
							disabledReason={t(
								"settings.translationOnly.disablesHebrewFeatures",
							)}
						/>
					</div>
				);
			default: {
				const _exhaustive: never = id;
				return _exhaustive;
			}
		}
	};

	return (
		<div className="relative" ref={dropdownRef}>
			<NeumorphCard className="w-full md:w-auto px-2 py-2 md:px-3">
				<div className="flex w-full items-center gap-1 md:gap-2">
					<div className="flex min-w-0 flex-1 items-center gap-1 md:gap-2">
						<button
							type="button"
							onClick={onHomeClick}
							className="shrink-0 rounded-full p-2 transition-all md:hover:scale-[1.02] md:active:scale-[0.98]"
							style={{
								fontFamily: "'Inter', sans-serif",
								backgroundColor: "var(--neomorph-bg)",
								border: "1px solid var(--neomorph-border)",
								boxShadow:
									"6px 6px 12px var(--neomorph-shadow-dark), -6px -6px 12px var(--neomorph-shadow-light)",
							}}
							aria-label={t("navigation.goHome")}
						>
							<Home className="w-3 h-3 text-[var(--text-primary)]" />
						</button>

						<button
							type="button"
							onClick={() => setOpenMenu(openMenu === "book" ? null : "book")}
							className="flex min-w-0 flex-1 items-center gap-1 rounded-full px-2 py-1.5 md:gap-2 md:px-3 transition-all md:hover:scale-[1.02] md:active:scale-[0.98]"
							style={{
								fontFamily: "'Inter', sans-serif",
								boxShadow:
									"inset 3px 3px 6px var(--neomorph-inset-shadow-dark), inset -3px -3px 6px var(--neomorph-inset-shadow-light)",
								backgroundColor: "var(--neomorph-bg)",
							}}
							aria-label={t("navigation.selectBook")}
						>
							<BookOpen className="hidden md:block w-3 h-3 text-[var(--text-primary)]" />
							<span className="min-w-0 truncate text-[10px] md:text-[11px] text-[var(--text-primary)]">
								<span className="md:hidden">{bookDisplayName}</span>
								<span className="hidden md:inline">{bookDisplayName} | </span>
								<span
									className="hidden md:inline"
									style={{ fontFamily: "'Suez One', serif" }}
								>
									{bookHebrew}
								</span>
							</span>
						</button>

						<button
							type="button"
							onClick={() =>
								setOpenMenu(openMenu === "chapter" ? null : "chapter")
							}
							className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 md:gap-2 md:px-3 transition-all md:hover:scale-[1.02] md:active:scale-[0.98]"
							style={{
								fontFamily: "'Inter', sans-serif",
								boxShadow:
									"inset 3px 3px 6px var(--neomorph-inset-shadow-dark), inset -3px -3px 6px var(--neomorph-inset-shadow-light)",
								backgroundColor: "var(--neomorph-bg)",
							}}
							aria-label={t("navigation.selectChapter")}
						>
							<span className="text-[9px] md:text-[10px] tracking-[0.15em] md:tracking-[0.2em] uppercase text-[var(--text-primary)]">
								{t("navigation.chapterShort")}
							</span>
							<span className="text-[10px] md:text-[11px] text-[var(--text-primary)]">
								{chapter}
							</span>
						</button>

						{!seferMode && (
							<button
								type="button"
								onClick={() =>
									setOpenMenu(openMenu === "verse" ? null : "verse")
								}
								className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 md:gap-2 md:px-3 transition-all md:hover:scale-[1.02] md:active:scale-[0.98]"
								style={{
									fontFamily: "'Inter', sans-serif",
									boxShadow:
										"inset 3px 3px 6px var(--neomorph-inset-shadow-dark), inset -3px -3px 6px var(--neomorph-inset-shadow-light)",
									backgroundColor: "var(--neomorph-bg)",
								}}
								aria-label={t("navigation.selectVerse")}
							>
								<span className="text-[9px] md:text-[10px] tracking-[0.15em] md:tracking-[0.2em] uppercase text-[var(--text-primary)]">
									{t("navigation.verseShort")}
								</span>
								<span className="text-[10px] md:text-[11px] text-[var(--text-primary)]">
									{verse}
								</span>
							</button>
						)}
					</div>

					<div className="flex shrink-0 items-center gap-1 md:gap-2">
						{isDev && onDesignSystemClick && (
							<button
								type="button"
								onClick={onDesignSystemClick}
								className="shrink-0 rounded-full p-2 transition-all md:hover:scale-[1.05] md:active:scale-[0.98]"
								style={{
									backgroundColor: "var(--neomorph-bg)",
									boxShadow:
										"6px 6px 12px var(--neomorph-shadow-dark), -6px -6px 12px var(--neomorph-shadow-light)",
									border: "1px solid var(--neomorph-border)",
								}}
								aria-label="Design System"
							>
								<Paintbrush className="w-3 h-3 text-[var(--text-primary)]" />
							</button>
						)}

						<button
							type="button"
							onClick={() =>
								setOpenMenu(openMenu === "settings" ? null : "settings")
							}
							className="relative shrink-0 rounded-full p-2 transition-all md:hover:scale-[1.05] md:active:scale-[0.98]"
							style={{
								backgroundColor: "var(--neomorph-bg)",
								boxShadow:
									"6px 6px 12px var(--neomorph-shadow-dark), -6px -6px 12px var(--neomorph-shadow-light)",
								border: "1px solid var(--neomorph-border)",
							}}
							aria-label={t("navigation.openSettings")}
						>
							<Settings className="w-3 h-3 text-[var(--text-primary)]" />
							<span
								aria-hidden="true"
								className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full border border-[var(--neomorph-bg)] bg-[var(--primary)]"
							/>
						</button>
					</div>
				</div>
			</NeumorphCard>

			{openMenu === "settings" && (
				<div className="absolute right-0 mt-4 w-[320px] rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-surface)] backdrop-blur-[16px] shadow-[0_8px_32px_0_var(--glass-shadow)] p-5 z-30">
					<div className="space-y-5">
						{SHARED_SETTINGS_ORDER.map((id) => {
							const row = renderSharedSetting(id);
							if (!row) return null;
							return <div key={id}>{row}</div>;
						})}

						<div
							className={`flex items-center justify-between ${translationOnlyDisablesHebrewOptions ? "opacity-60" : ""}`}
						>
							<div className="flex items-center gap-3">
								<TbAlphabetHebrew className="w-4 h-4 text-[var(--text-secondary)]" />
								<span
									className="text-sm text-[var(--text-primary)]"
									style={{ fontFamily: "'Inter', sans-serif" }}
								>
									{t("settings.nikud.title")}
								</span>
							</div>
							<NeumorphicToggle
								enabled={showNikud}
								onToggle={() => onNikudChange(!showNikud)}
								ariaLabel={t("navigation.toggleNikud")}
								disabled={translationOnlyDisablesHebrewOptions}
								disabledReason={t(
									"settings.translationOnly.disablesHebrewFeatures",
								)}
							/>
						</div>

						<div
							className={`flex items-center justify-between ${translationOnlyDisablesHebrewOptions ? "opacity-60" : ""}`}
						>
							<div className="flex items-center gap-3">
								<TbAlphabetHebrew className="w-4 h-4 text-[var(--text-secondary)]" />
								<span
									className="text-sm text-[var(--text-primary)]"
									style={{ fontFamily: "'Inter', sans-serif" }}
								>
									{t("settings.cantillation.title")}
								</span>
							</div>
							<NeumorphicToggle
								enabled={showCantillation}
								onToggle={() => onCantillationChange(!showCantillation)}
								ariaLabel={t("navigation.toggleCantillation")}
								disabled={translationOnlyDisablesHebrewOptions}
								disabledReason={t(
									"settings.translationOnly.disablesHebrewFeatures",
								)}
							/>
						</div>

						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<TbLanguageHiragana className="w-4 h-4 text-[var(--text-secondary)]" />
								<span
									className="text-sm text-[var(--text-primary)]"
									style={{ fontFamily: "'Inter', sans-serif" }}
								>
									{t("settings.translationOnly.title")}
								</span>
							</div>
							<NeumorphicToggle
								enabled={translationOnly}
								onToggle={() => onTranslationOnlyChange(!translationOnly)}
								ariaLabel={t("navigation.toggleTranslationOnly")}
							/>
						</div>
					</div>
				</div>
			)}

			{openMenu === "book" && (
				<div
					className={`absolute ${isRTL ? "right-0" : "left-0"} mt-4 w-[280px] rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-surface)] backdrop-blur-[16px] shadow-[0_8px_32px_0_var(--glass-shadow)] p-4 z-30`}
					onWheelCapture={(event) => {
						event.stopPropagation();
					}}
					onTouchMoveCapture={(event) => {
						event.stopPropagation();
					}}
				>
					<div className="mb-3">
						<input
							ref={bookSearchRef}
							value={bookSearch}
							onChange={(event) => setBookSearch(event.target.value)}
							placeholder="Search book"
							className="w-full rounded-full px-4 py-2 text-base md:text-xs text-[var(--text-primary)]"
							style={{
								fontFamily: "'Inter', sans-serif",
								backgroundColor: "var(--neomorph-bg)",
								border: "1px solid var(--neomorph-border)",
								boxShadow:
									"inset 3px 3px 6px var(--neomorph-inset-shadow-dark), inset -3px -3px 6px var(--neomorph-inset-shadow-light)",
							}}
						/>
					</div>
					<div
						ref={bookListRef}
						className="max-h-[320px] overflow-y-auto overscroll-contain space-y-2"
					>
						{filteredBooks.map((item) => (
							<button
								type="button"
								key={item.name}
								data-current-book={item.name === book ? "true" : undefined}
								onClick={() => {
									onBookChange(item.name);
									setOpenMenu(null);
								}}
								className={`w-full flex items-center justify-between rounded-xl px-4 py-3 transition-all ${
									item.name === book
										? "bg-[var(--accent-strong)] text-white"
										: "bg-[var(--muted)] text-[var(--text-primary)]"
								}`}
								style={{ fontFamily: "'Inter', sans-serif" }}
							>
								<span className="text-xs tracking-[0.2em] uppercase">
									{language === "es"
										? formatBookDisplayName(item.spanish)
										: formatBookDisplayName(item.name)}
								</span>
								<span
									className="text-sm"
									style={{ fontFamily: "'Suez One', serif" }}
								>
									{item.hebrew}
								</span>
							</button>
						))}
					</div>
				</div>
			)}

			{openMenu === "chapter" && (
				<div
					className={`absolute ${isRTL ? "right-0" : "left-0"} mt-4 w-[280px] rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-surface)] backdrop-blur-[16px] shadow-[0_8px_32px_0_var(--glass-shadow)] p-4 z-30`}
					onWheelCapture={(event) => {
						event.stopPropagation();
					}}
					onTouchMoveCapture={(event) => {
						event.stopPropagation();
					}}
				>
					<div className="mb-3">
						<input
							ref={chapterSearchRef}
							value={chapterSearch}
							onChange={(event) =>
								setChapterSearch(event.target.value.replace(/[^0-9]/g, ""))
							}
							placeholder={t("navigation.chapterShort")}
							inputMode="numeric"
							className="w-full rounded-full px-4 py-2 text-base md:text-xs text-[var(--text-primary)]"
							style={{
								fontFamily: "'Inter', sans-serif",
								backgroundColor: "var(--neomorph-bg)",
								border: "1px solid var(--neomorph-border)",
								boxShadow:
									"inset 3px 3px 6px var(--neomorph-inset-shadow-dark), inset -3px -3px 6px var(--neomorph-inset-shadow-light)",
							}}
						/>
					</div>
					<div className="grid grid-cols-5 gap-2 max-h-[320px] overflow-y-auto overscroll-contain">
						{filteredChapters.map((item) => (
							<button
								type="button"
								key={item}
								onClick={() => {
									onChapterChange(item);
									setOpenMenu(null);
								}}
								className={`rounded-xl px-2 py-2 text-xs transition-all ${
									item === chapter
										? "bg-[var(--accent-strong)] text-white"
										: "bg-[var(--muted)] text-[var(--text-primary)]"
								}`}
								style={{ fontFamily: "'Inter', sans-serif" }}
							>
								{item}
							</button>
						))}
					</div>
				</div>
			)}

			{openMenu === "verse" && (
				<div
					className={`absolute ${isRTL ? "right-0" : "left-0"} mt-4 w-[280px] rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-surface)] backdrop-blur-[16px] shadow-[0_8px_32px_0_var(--glass-shadow)] p-4 z-30`}
					onWheelCapture={(event) => {
						event.stopPropagation();
					}}
					onTouchMoveCapture={(event) => {
						event.stopPropagation();
					}}
				>
					<div className="mb-3">
						<input
							ref={verseSearchRef}
							value={verseSearch}
							onChange={(event) =>
								setVerseSearch(event.target.value.replace(/[^0-9]/g, ""))
							}
							placeholder={t("navigation.verseShort")}
							inputMode="numeric"
							className="w-full rounded-full px-4 py-2 text-base md:text-xs text-[var(--text-primary)]"
							style={{
								fontFamily: "'Inter', sans-serif",
								backgroundColor: "var(--neomorph-bg)",
								border: "1px solid var(--neomorph-border)",
								boxShadow:
									"inset 3px 3px 6px var(--neomorph-inset-shadow-dark), inset -3px -3px 6px var(--neomorph-inset-shadow-light)",
							}}
						/>
					</div>
					<div className="grid grid-cols-5 gap-2 max-h-[320px] overflow-y-auto overscroll-contain">
						{filteredVerses.map((item) => (
							<button
								type="button"
								key={item}
								onClick={() => {
									onVerseChange(item);
									setOpenMenu(null);
								}}
								className={`rounded-xl px-2 py-2 text-xs transition-all ${
									item === verse
										? "bg-[var(--accent-strong)] text-white"
										: "bg-[var(--muted)] text-[var(--text-primary)]"
								}`}
								style={{ fontFamily: "'Inter', sans-serif" }}
							>
								{item}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
