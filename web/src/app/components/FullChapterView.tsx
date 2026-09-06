import { useTranslation } from "../hooks/useTranslation";
import type { VerseResponse, WordResponse } from "../services/verseService";
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

interface FullChapterViewProps {
	verses: VerseResponse[];
	bookName: string;
	bookNameHebrew: string;
	chapter: number;
	language: "en" | "es" | "he";
	hebrewOnly: boolean;
	translationOnly?: boolean;
	seferMode?: boolean;
	onWordClick: (
		word: WordResponse,
		context?: { chapter: number; verse: number },
	) => void;
	showQumran?: boolean;
	selectedWord?: Pick<WordResponse, "text" | "position" | "strong"> | null;
	selectedWordContext?: { chapter: number; verse: number } | null;
	showNikud?: boolean;
	showCantillation?: boolean;
	isBesorah?: boolean;
}

export function FullChapterView({
	verses,
	language,
	hebrewOnly,
	translationOnly = false,
	seferMode = false,
	onWordClick,
	showQumran,
	selectedWord,
	selectedWordContext,
	showNikud = true,
	showCantillation = true,
	isBesorah = false,
}: FullChapterViewProps) {
	const { t } = useTranslation(language);
	const shouldShowSefer = seferMode && (hebrewOnly || translationOnly);
	const spanishMissingTranslation = t("verse.missingSpanishTranslation");
	const hideSuperscripts = shouldHideSuperscripts(getTranslationKey(language));
	const hideTranslationText =
		shouldHideTranslationText(language, hebrewOnly) && !translationOnly;
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

	const normalizeForMatch = (text: string) => {
		let normalized = stripNikud(text);
		normalized = stripCantillation(normalized);
		normalized = stripMeteg(normalized);
		normalized = normalized.replace(/\//g, "");
		return normalized.replace(/\u05BE/g, "");
	};

	const normalizedSelected = selectedWord
		? normalizeForMatch(selectedWord.text)
		: null;

	const renderVerseTranslation = (verse: VerseResponse) =>
		renderTranslation(verse.translation ?? "", {
			hideSuperscripts,
			footnotes: verse.translation_footnotes ?? [],
		});

	const renderVerseWords = (verse: VerseResponse) => {
		const dssMap = new Map<
			number,
			{
				text: string;
				span: number;
			}
		>();
		verse.dss?.forEach((variant) => {
			if (
				typeof variant.position !== "number" ||
				variant.position < 0 ||
				!isRenderableDssWord(variant.dss_word)
			)
				return;
			dssMap.set(variant.position, {
				text: variant.dss_word,
				span: countMasoreticVariantSpan(variant.masoretic_word),
			});
		});

		let skipUntilIndex = -1;

		return verse.words.map((word, wordIdx) => {
			if (wordIdx <= skipUntilIndex) {
				return null;
			}

			const variantEntry = showQumran ? dssMap.get(word.position) : undefined;
			if (variantEntry) {
				skipUntilIndex = Math.max(
					skipUntilIndex,
					wordIdx + variantEntry.span - 1,
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
			const isContextMatch = Boolean(
				selectedWordContext &&
					selectedWordContext.chapter === verse.chapter &&
					selectedWordContext.verse === verse.verse,
			);
			const isSelected =
				isContextMatch &&
				(typeof selectedWord?.position === "number"
					? selectedWord.position === word.position
					: Boolean(normalizedSelected) &&
						normalizedSelected === normalizedWord);

			const prefixSegments =
				!variantEntry && word.prefixes?.length
					? getPrefixSegments(displayText, word.prefixes)
					: null;

			return (
				<span key={`${verse.chapter}-${verse.verse}-${word.position}`}>
					<button
						type="button"
						onClick={() =>
							onWordClick(word, {
								chapter: verse.chapter,
								verse: verse.verse,
							})
						}
						className={`word-interactive cursor-pointer ${isSelected ? "verse-highlight" : ""}`}
						style={
							variantEntry
								? {
										color: "var(--text-hebrew)",
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
					{wordIdx < verse.words.length - 1 && " "}
				</span>
			);
		});
	};

	return (
		<div className="space-y-6 transition-all duration-500 full-chapter-scroll">
			{/* Chapter Verses */}
			{shouldShowSefer ? (
				<div className="px-2">
					{translationOnly ? (
						<div className="leading-relaxed" style={{ direction: "ltr" }}>
							{verses.map((verse, idx) => (
								<span key={verse.verse}>
									<span
										style={{
											fontFamily: "'Inter', sans-serif",
											fontSize: "16px",
											letterSpacing: "0.08em",
											textTransform: "uppercase",
											color: "var(--text-hebrew)",
											opacity: 0.68,
											marginRight: "8px",
										}}
									>
										[{verse.verse}]
									</span>
									<span
										style={{
											fontFamily: "'Inter', sans-serif",
											fontSize: "26px",
											color: "var(--text-hebrew)",
											opacity: 1,
											fontWeight: 400,
											direction: "ltr",
										}}
									>
										{language === "es" && !(verse.translation ?? "").trim()
											? spanishMissingTranslation
											: renderVerseTranslation(verse)}
									</span>
									{idx < verses.length - 1 && "\u200E "}
								</span>
							))}
						</div>
					) : (
						<div
							className="leading-relaxed tracking-[0.01em]"
							style={{
								fontFamily: "'Cardo', serif",
								fontSize: "48px",
								direction: "rtl",
								color: "var(--text-hebrew)",
								lineHeight: 1.9,
								letterSpacing: "0.01em",
							}}
						>
							{verses.map((verse, idx) => (
								<span key={verse.verse}>
									<span
										className="text-[var(--text-secondary)] opacity-40 ml-2"
										style={{
											fontFamily: "'Inter', sans-serif",
											fontSize: "14px",
										}}
									>
										[{idx + 1}]
									</span>
									{renderVerseWords(verse)}
									{idx < verses.length - 1 && " "}
								</span>
							))}
						</div>
					)}
				</div>
			) : (
				<div className="space-y-8 px-2">
					{verses.map((verse, idx) => (
						<div
							key={verse.verse}
							className="space-y-3 transition-all duration-300 verse-block"
						>
							{/* Hebrew Text with Verse Number */}
							{!translationOnly && (
								<div
									className="leading-relaxed tracking-[0.01em]"
									style={{
										fontFamily: "'Cardo', serif",
										fontSize: "48px",
										direction: "rtl",
										color: "var(--text-hebrew)",
										lineHeight: 1.85,
									}}
								>
									<span
										className="text-[var(--text-secondary)] opacity-40 ml-2"
										style={{
											fontFamily: "'Inter', sans-serif",
											fontSize: "14px",
										}}
									>
										[{idx + 1}]
									</span>
									{renderVerseWords(verse)}
								</div>
							)}

							{/* Translation - only show if not Hebrew Only mode */}
							{!hideTranslationText && (
								<div
									className="leading-relaxed"
									style={{
										fontFamily: "'Inter', sans-serif",
										fontSize: translationOnly ? "22px" : "15px",
										color: translationOnly
											? "var(--text-hebrew)"
											: "var(--text-secondary)",
										opacity: 1,
									}}
								>
									{translationOnly ? (
										<>
											<span
												style={{
													fontSize: "15px",
													letterSpacing: "0.08em",
													textTransform: "uppercase",
													color: "var(--text-hebrew)",
													opacity: 0.68,
													marginRight: "8px",
												}}
											>
												[{verse.verse}]
											</span>
											{language === "es" && !(verse.translation ?? "").trim()
												? spanishMissingTranslation
												: renderVerseTranslation(verse)}
										</>
									) : language === "es" && !(verse.translation ?? "").trim() ? (
										spanishMissingTranslation
									) : (
										renderVerseTranslation(verse)
									)}
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
