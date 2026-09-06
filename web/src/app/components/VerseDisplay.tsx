import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "../hooks/useTranslation";
import type {
	DssVariant,
	TranslationFootnote,
	VerseResponse,
	WordResponse,
} from "../services/verseService";
import {
	getPrefixSegments,
	removeMaqafForDisplay,
	removeSofPasukForDisplay,
	stripCantillation,
	stripMeteg,
	stripNikud,
} from "../utils/hebrew";
import {
	getTranslationKey,
	shouldHideSuperscripts,
	shouldHideTranslationText,
} from "../utils/translationConfig";
import { renderTranslation } from "../utils/translationFormatter";
import { FullChapterView } from "./FullChapterView";
import { OnboardingWordHint } from "./OnboardingWordHint";
import { SwipeIndicator } from "./SwipeIndicator";

interface VerseDisplayProps {
	hebrewText: string;
	translation: string;
	verseRef: string;
	verseNumber: number;
	bookName: string;
	bookNameHebrew: string;
	book: string;
	chapter: number;
	language: "en" | "es" | "he";
	onWordClick: (
		word: WordResponse,
		context?: { chapter: number; verse: number },
	) => void;
	previousVerseSnippet?: string;
	nextVerseSnippet?: string;
	showOnboardingHint?: boolean;
	showQumran?: boolean;
	showFullChapter?: boolean;
	seferMode?: boolean;
	hebrewOnly?: boolean;
	translationOnly?: boolean;
	showNikud?: boolean;
	showCantillation?: boolean;
	chapterVerses?: VerseResponse[];
	words: WordResponse[];
	dssVariants?: DssVariant[];
	selectedWord?: Pick<WordResponse, "text" | "position" | "strong"> | null;
	selectedWordContext?: { chapter: number; verse: number } | null;
	onSwipeUp?: () => void;
	onSwipeDown?: () => void;
	canNavigatePrevious?: boolean;
	canNavigateNext?: boolean;
	translation_footnotes?: TranslationFootnote[];
	isBesorah?: boolean;
}

export function VerseDisplay({
	hebrewText,
	translation,
	verseNumber,
	bookName,
	bookNameHebrew,
	chapter,
	language,
	onWordClick,
	showOnboardingHint = false,
	showQumran = false,
	showFullChapter = false,
	seferMode = false,
	hebrewOnly = false,
	translationOnly = false,
	showNikud = true,
	showCantillation = false,
	chapterVerses,
	words,
	dssVariants,
	selectedWord,
	selectedWordContext,
	onSwipeUp,
	onSwipeDown,
	canNavigatePrevious = false,
	canNavigateNext = false,
	translation_footnotes,
	isBesorah = false,
}: VerseDisplayProps) {
	const { t } = useTranslation(language);
	const spanishMissingTranslation = t("verse.missingSpanishTranslation");
	const hideSuperscripts = shouldHideSuperscripts(getTranslationKey(language));
	const hideTranslationText =
		shouldHideTranslationText(language, hebrewOnly) && !translationOnly;
	const translationRenderOptions = {
		hideSuperscripts,
		footnotes: translation_footnotes ?? [],
	};
	const showHebrewText = !translationOnly;
	const dssInlineFontScale = "1.70em";
	const dssInlineBaselineShift = "-0.08em";
	const isRenderableDssWord = (value?: string): value is string => {
		if (!value) return false;
		const normalized = value.trim();
		if (!normalized || normalized.toLowerCase() === "note") {
			return false;
		}

		// Multi-word DSS variants are renderable: they replace the N
		// Masoretic tokens counted from their masoretic_word via the
		// span logic below (#103).
		return countMasoreticVariantSpan(normalized) > 0;
	};

	const countMasoreticVariantSpan = (masoreticWord?: string): number => {
		if (!masoreticWord) return 1;

		const cleaned = removeMaqafForDisplay(masoreticWord)
			.replace(/[/:]/g, " ")
			.trim();
		if (!cleaned) return 1;

		const tokenCount = cleaned.split(/\s+/).filter(Boolean).length;
		return tokenCount > 0 ? tokenCount : 1;
	};

	// Function to render Hebrew text with DSS variants
	const renderHebrewText = () => {
		const dssMap = new Map<
			number,
			{
				text: string;
				span: number;
			}
		>();
		dssVariants?.forEach((variant) => {
			if (
				typeof variant.position !== "number" ||
				variant.position < 0 ||
				!isRenderableDssWord(variant.dss_word)
			) {
				return;
			}
			dssMap.set(variant.position, {
				text: variant.dss_word,
				span: countMasoreticVariantSpan(variant.masoretic_word),
			});
		});

		const sourceWords =
			words.length > 0
				? words
				: removeMaqafForDisplay(hebrewText)
						.split(" ")
						.filter(Boolean)
						.map((word, index) => ({
							position: index,
							text: word,
							text_no_nikud: word,
							prefixes: [],
							has_dss_variant: false,
						}));

		const normalizeForMatch = (text: string) => {
			let normalized = stripNikud(text);
			normalized = stripCantillation(normalized);
			normalized = stripMeteg(normalized);
			normalized = normalized.replace(/\//g, "");
			return normalized.replace(/\u05BE/g, "");
		};

		const isSelectionInCurrentVerse = selectedWordContext
			? selectedWordContext.chapter === chapter &&
				selectedWordContext.verse === verseNumber
			: true;
		const normalizedSelected =
			selectedWord && isSelectionInCurrentVerse
				? normalizeForMatch(selectedWord.text)
				: null;
		const selectedPosition =
			selectedWord && isSelectionInCurrentVerse ? selectedWord.position : null;

		let skipUntilIndex = -1;

		return sourceWords.map((word, index) => {
			if (index <= skipUntilIndex) {
				return null;
			}

			const variantEntry = showQumran ? dssMap.get(word.position) : undefined;
			if (variantEntry) {
				skipUntilIndex = Math.max(
					skipUntilIndex,
					index + variantEntry.span - 1,
				);
			}
			const rawText = variantEntry?.text ?? word.text;

			// DSS replacements are rendered unpointed to avoid glyph-level
			// font fallback that appears as mixed DSS/Masoretic styling.
			let displayText = rawText;
			if (variantEntry) {
				displayText = displayText.replace(/[\u05BE-]/g, " ");
				displayText = stripNikud(stripCantillation(stripMeteg(displayText)));
			} else {
				if (!showNikud) {
					displayText = stripNikud(displayText);
				}
				if (!showCantillation) {
					displayText = stripCantillation(displayText);
				}
				displayText = stripMeteg(displayText);
			}
			// Remove "/" separators from display
			displayText = displayText.replace(/\//g, "");
			displayText = removeMaqafForDisplay(displayText);
			displayText = displayText.replace(/\s+/g, " ").trim();
			if (isBesorah) {
				displayText = removeSofPasukForDisplay(displayText);
			}

			// Always compare against the original Masoretic word text, not the
			// display text which may be a DSS variant.
			const normalizedWord = normalizeForMatch(word.text);
			const isSelected =
				typeof selectedPosition === "number"
					? selectedPosition === word.position
					: Boolean(normalizedSelected) &&
						normalizedSelected === normalizedWord;

			// Prefix segmentation is only valid for original Masoretic words.
			const prefixSegments =
				!variantEntry && word.prefixes?.length
					? getPrefixSegments(displayText, word.prefixes)
					: null;

			const shouldShowHintButton =
				showOnboardingHint &&
				!variantEntry &&
				(isSelected || (!normalizedSelected && index === 0));

			if (shouldShowHintButton) {
				return (
					<span key={word.position}>
						<OnboardingWordHint
							word={displayText}
							isActive={showOnboardingHint}
							isPressed={isSelected}
							onClick={() =>
								onWordClick(word, {
									chapter,
									verse: verseNumber,
								})
							}
						/>
						{index < sourceWords.length - 1 && " "}
					</span>
				);
			}

			return (
				<span key={word.position}>
					<button
						type="button"
						onClick={() =>
							onWordClick(word, {
								chapter,
								verse: verseNumber,
							})
						}
						className={`word-interactive cursor-pointer ${isSelected ? "verse-highlight" : ""}`}
						style={
							variantEntry
								? {
										color: "var(--text-hebrew)",
										fontFamily: "'DeadSeaScrolls-Regular', 'Cardo', serif",
										fontSize: dssInlineFontScale,
										display: "inline-block",
										verticalAlign: "middle",
										transform: `translateY(${dssInlineBaselineShift})`,
									}
								: undefined
						}
					>
						{prefixSegments?.prefixes?.length ? (
							<>
								<span
									style={{ color: "var(--text-secondary)" }}
									className="cursor-pointer hover:opacity-80"
									title={t("verse.prefixLabel", {
										prefix: word.prefixes?.join(", ") ?? "",
									})}
								>
									{prefixSegments.prefixes.join("")}
								</span>
								<span style={{ color: "var(--text-hebrew)" }}>
									{prefixSegments.root}
								</span>
							</>
						) : (
							displayText
						)}
					</button>
					{index < sourceWords.length - 1 && " "}
				</span>
			);
		});
	};

	// If full chapter mode is enabled and we have verses, show the full chapter view
	if (showFullChapter && chapterVerses && chapterVerses.length > 0) {
		return (
			<div className="transition-opacity duration-500">
				<FullChapterView
					verses={chapterVerses}
					bookName={bookName}
					bookNameHebrew={bookNameHebrew}
					chapter={chapter}
					language={language}
					hebrewOnly={hebrewOnly}
					translationOnly={translationOnly}
					seferMode={seferMode}
					onWordClick={onWordClick}
					showQumran={showQumran}
					selectedWord={selectedWord}
					selectedWordContext={selectedWordContext}
					showNikud={showNikud}
					showCantillation={showCantillation}
					isBesorah={isBesorah}
				/>
			</div>
		);
	}

	// Otherwise show the single verse view
	return (
		<div className="space-y-10 relative pt-12 sm:pt-14">
			{/* Hebrew Text with Verse Number and Onboarding Hint - Large and Centered */}
			{showHebrewText && (
				<div
					className="text-center leading-[2] tracking-[0.01em] relative"
					style={{
						fontFamily: "'Cardo', serif",
						fontSize: "48px",
						direction: "rtl",
						color: "var(--text-hebrew)",
						lineHeight: 1.85,
						wordSpacing: "0.24em",
					}}
				>
					<span
						className="text-[var(--text-secondary)] opacity-50 ml-2"
						style={{
							fontFamily: "'Inter', sans-serif",
							fontSize: "14px",
						}}
					>
						[{verseNumber}]
					</span>
					{renderHebrewText()}
				</div>
			)}

			{/* Translation - Only show if not Hebrew Only mode */}
			{!hideTranslationText && (
				<SwipeIndicator>
					<div
						className="text-center leading-relaxed px-4 transition-all duration-500 text-[var(--text-primary)]"
						style={{
							fontFamily: "'Inter', sans-serif",
							fontSize: translationOnly ? "26px" : "17px",
							color: translationOnly
								? "var(--text-hebrew)"
								: "var(--text-primary)",
							opacity: 1,
							fontWeight: translationOnly ? 400 : undefined,
						}}
					>
						{translationOnly && (
							<div
								className="mb-2"
								style={{
									fontFamily: "'Inter', sans-serif",
									fontSize: "16px",
									letterSpacing: "0.08em",
									textTransform: "uppercase",
									color: "var(--text-hebrew)",
									opacity: 0.7,
								}}
							>
								[{verseNumber}]
							</div>
						)}
						{language === "es" && !translation.trim()
							? spanishMissingTranslation
							: renderTranslation(translation || "", translationRenderOptions)}
					</div>
				</SwipeIndicator>
			)}

			{(canNavigatePrevious || canNavigateNext) && (
				<div
					className={`md:hidden flex items-center justify-center gap-3 px-4 ${hideTranslationText ? "mt-8" : "mt-4"}`}
				>
					{canNavigatePrevious && (
						<button
							type="button"
							onClick={onSwipeUp}
							aria-label={t("verse.previousVerse")}
							className="inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[12px] font-medium transition-colors"
							style={{
								background: "var(--neomorph-bg)",
								borderColor: "var(--neomorph-border)",
								color: "var(--text-secondary)",
								boxShadow:
									"2px 2px 6px var(--neomorph-shadow-dark), -2px -2px 6px var(--neomorph-shadow-light)",
								minHeight: "36px",
							}}
						>
							<ChevronUp size={14} strokeWidth={2.25} aria-hidden="true" />
							<span>{t("verse.previousVerse")}</span>
						</button>
					)}

					{canNavigateNext && (
						<button
							type="button"
							onClick={onSwipeDown}
							aria-label={t("verse.nextVerse")}
							className="inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[12px] font-medium transition-colors"
							style={{
								background: "var(--neomorph-bg)",
								borderColor: "var(--neomorph-border)",
								color: "var(--text-secondary)",
								boxShadow:
									"2px 2px 6px var(--neomorph-shadow-dark), -2px -2px 6px var(--neomorph-shadow-light)",
								minHeight: "36px",
							}}
						>
							<ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" />
							<span>{t("verse.nextVerse")}</span>
						</button>
					)}
				</div>
			)}
		</div>
	);
}
