import { formatVerseRef } from "@davar/shared/formatVerseRef";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import {
	getPrefixSegments,
	normalizeHebrew,
	normalizeHebrewDisplay,
	removeMaqafForDisplay,
	removeSofPasukForDisplay,
	splitLeadingHebrewCluster,
	stripNikud,
	stripCantillation,
	stripMeteg,
} from "../utils/hebrew";

interface WordInstance {
	verse: string;
	text: string;
}

interface WordCardProps {
	word: string;
	wordFromVerse?: string;
	strongNumber?: string;
	qumranWord?: string;
	qumranStrong?: string;
	qumranTransliteration?: string;
	qumranMeanings?: string[];
	qumranRoot?: string;
	qumranRootTransliteration?: string;
	qumranRootMeaning?: string;
	qumranRootStrongNumber?: string;
	qumranCommentary?: string;
	hasQumranVariant?: boolean;
	showQumran?: boolean;
	transliteration?: string;
	meanings: string[];
	root?: string;
	rootTransliteration?: string;
	rootMeaning?: string;
	rootStrongNumber?: string;
	prefixes?: string[];
	language?: "en" | "es" | "he";
	instances: WordInstance[];
	onInstanceClick: (verse: string) => void;
	isLoading?: boolean;
	isQumranLoading?: boolean;
	showNikud?: boolean;
	onClose?: () => void;
	tabResetKey?: number;
	isBesorah?: boolean;
}

interface PrefixEntry {
	id: string;
	main_form?: string;
	type?: string;
	transliteration_en?: string;
	transliteration_es?: string;
	meanings?: Record<string, string[]>;
	forms?: string[];
	notes?: Record<string, string>;
}

let prefixesPromise: Promise<Record<string, PrefixEntry>> | null = null;

const loadPrefixesData = async (): Promise<Record<string, PrefixEntry>> => {
	if (!prefixesPromise) {
		prefixesPromise = fetch("/data/prefixes.json", {
			cache: "force-cache",
		}).then(async (response) => {
			if (!response.ok) {
				throw new Error("Failed to load prefixes data");
			}
			return response.json() as Promise<Record<string, PrefixEntry>>;
		});
	}

	return prefixesPromise;
};

export function WordCard({
	word,
	wordFromVerse,
	strongNumber,
	qumranWord,
	qumranStrong,
	qumranMeanings = [],
	qumranRoot,
	qumranRootTransliteration,
	qumranRootMeaning,
	qumranTransliteration,
	qumranRootStrongNumber,
	qumranCommentary,
	hasQumranVariant = false,
	showQumran = false,
	transliteration,
	meanings,
	root,
	rootTransliteration,
	rootMeaning,
	rootStrongNumber,
	prefixes,
	language = "en",
	instances,
	onInstanceClick,
	isLoading = false,
	isQumranLoading = false,
	showNikud = true,
	onClose,
	tabResetKey,
	isBesorah = false,
}: WordCardProps) {
	const { t } = useTranslation(language);
	const [activeTab, setActiveTab] = useState<
		"masoretic" | "qumran" | "instances"
	>("masoretic");
	const [isTransitioning, setIsTransitioning] = useState(false);
	const [displayedData, setDisplayedData] = useState({
		word,
		wordFromVerse,
		transliteration,
		meanings,
		root,
		rootTransliteration,
		rootMeaning,
		prefixes,
		instances,
		qumranWord,
		qumranStrong,
		qumranTransliteration,
		qumranMeanings,
		qumranRoot,
		qumranRootTransliteration,
		qumranRootMeaning,
		qumranCommentary,
	});
	const headerWord =
		activeTab === "qumran" && displayedData.qumranWord
			? displayedData.qumranWord
			: displayedData.word;
	let displayWord =
		activeTab === "qumran"
			? removeMaqafForDisplay(
					normalizeHebrewDisplay(
						stripNikud(
							stripMeteg(
								stripCantillation(headerWord.replace(/[\u05BE-]/g, " ")),
							),
						),
					),
				)
			: showNikud
				? removeMaqafForDisplay(
						normalizeHebrewDisplay(stripMeteg(stripCantillation(headerWord))),
					)
				: removeMaqafForDisplay(
						normalizeHebrewDisplay(normalizeHebrew(headerWord)),
					);
	if (isBesorah) {
		displayWord = removeSofPasukForDisplay(displayWord);
	}
	const [prefixEntries, setPrefixEntries] = useState<
		Record<string, PrefixEntry | null>
	>({});

	const meaningItems = useMemo(() => {
		const counts = new Map<string, number>();
		return displayedData.meanings
			.filter((m) => m?.trim())
			.map((value) => {
				const occurrence = (counts.get(value) ?? 0) + 1;
				counts.set(value, occurrence);
				return { key: `meaning-${value}-${occurrence}`, value };
			});
	}, [displayedData.meanings]);

	const qumranMeaningItems = useMemo(() => {
		const counts = new Map<string, number>();
		return (displayedData.qumranMeanings ?? [])
			.filter((m) => m?.trim())
			.map((value) => {
				const occurrence = (counts.get(value) ?? 0) + 1;
				counts.set(value, occurrence);
				return { key: `qumran-meaning-${value}-${occurrence}`, value };
			});
	}, [displayedData.qumranMeanings]);

	const prefixItems = useMemo(() => {
		const counts = new Map<string, number>();
		return (displayedData.prefixes ?? []).map((prefixId) => {
			const occurrence = (counts.get(prefixId) ?? 0) + 1;
			counts.set(prefixId, occurrence);
			return { key: `prefix-${prefixId}-${occurrence}`, value: prefixId };
		});
	}, [displayedData.prefixes]);

	const instanceItems = useMemo(() => {
		const counts = new Map<string, number>();
		return displayedData.instances.map((instance) => {
			const token = `${instance.verse}:${instance.text}`;
			const occurrence = (counts.get(token) ?? 0) + 1;
			counts.set(token, occurrence);
			return {
				key: `instance-${instance.verse}-${instance.text}-${occurrence}`,
				value: instance,
			};
		});
	}, [displayedData.instances]);

	const formatMeaning = (text: string) => {
		const cleaned = stripMeteg(stripCantillation(text))
			.replace(/^[-–—]\s*/, "")
			.trim();
		if (!cleaned) return cleaned;
		return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	};

	const prefixSegments = useMemo(() => {
		if (!displayedData.wordFromVerse || !displayedData.prefixes?.length) {
			return { prefixes: [], root: displayedData.wordFromVerse ?? "" };
		}
		let displayBase = normalizeHebrewDisplay(
			stripMeteg(stripCantillation(displayedData.wordFromVerse)),
		);
		if (!showNikud) {
			displayBase = normalizeHebrew(displayBase);
		}
		if (isBesorah) {
			displayBase = removeSofPasukForDisplay(displayBase);
		}
		return getPrefixSegments(displayBase, displayedData.prefixes);
	}, [
		displayedData.prefixes,
		displayedData.wordFromVerse,
		isBesorah,
		showNikud,
	]);

	const hasRootInfo = Boolean(
		displayedData.root ||
			displayedData.rootTransliteration ||
			displayedData.rootMeaning ||
			rootStrongNumber,
	);
	const hasQumranRootInfo = Boolean(
		displayedData.qumranRoot ||
			displayedData.qumranRootTransliteration ||
			displayedData.qumranRootMeaning ||
			qumranRootStrongNumber,
	);
	const showQumranTab = hasQumranVariant;
	const defaultTab = showQumran && showQumranTab ? "qumran" : "masoretic";
	const isQumranTab = showQumranTab && activeTab === "qumran";
	const activeStrongNumber = isQumranTab
		? displayedData.qumranStrong
		: strongNumber;
	const activeTransliteration = isQumranTab
		? (displayedData.qumranTransliteration ?? displayedData.transliteration)
		: displayedData.transliteration;
	const qumranTextColor = "var(--qumran-text)";
	const qumranFontFamily = "'DeadSeaScrolls-Regular', 'Cardo', serif";
	const masoreticWordFontSizePx = 64;
	const masoreticWordFontSize = `${masoreticWordFontSizePx}px`;
	const qumranWordFontSize = `${Math.round(masoreticWordFontSizePx * 1.5)}px`;
	const hasMultiWordDisplay = /\s/.test(displayWord);

	useEffect(() => {
		const loadPrefixEntries = async () => {
			if (!displayedData.prefixes?.length) {
				setPrefixEntries({});
				return;
			}

			try {
				const allPrefixes = await loadPrefixesData();
				const entries = Object.fromEntries(
					displayedData.prefixes.map((prefixId) => [
						prefixId,
						allPrefixes[prefixId] ?? null,
					]),
				) as Record<string, PrefixEntry | null>;
				setPrefixEntries(entries);
			} catch {
				setPrefixEntries({});
			}
		};

		loadPrefixEntries();
	}, [displayedData.prefixes]);

	useEffect(() => {
		const hasChanged =
			displayedData.word !== word ||
			displayedData.wordFromVerse !== wordFromVerse ||
			displayedData.transliteration !== transliteration ||
			displayedData.qumranTransliteration !== qumranTransliteration ||
			displayedData.root !== root ||
			displayedData.rootMeaning !== rootMeaning ||
			displayedData.rootTransliteration !== rootTransliteration ||
			displayedData.meanings.join("|") !== meanings.join("|") ||
			(displayedData.qumranMeanings ?? []).join("|") !==
				(qumranMeanings ?? []).join("|") ||
			displayedData.qumranWord !== qumranWord ||
			displayedData.qumranStrong !== qumranStrong ||
			displayedData.qumranRoot !== qumranRoot ||
			displayedData.qumranRootMeaning !== qumranRootMeaning ||
			displayedData.qumranRootTransliteration !== qumranRootTransliteration ||
			displayedData.qumranCommentary !== qumranCommentary ||
			(displayedData.prefixes ?? []).join("|") !== (prefixes ?? []).join("|") ||
			displayedData.instances
				.map((item) => `${item.verse}:${item.text}`)
				.join("|") !==
				instances.map((item) => `${item.verse}:${item.text}`).join("|");

		if (!hasChanged) return undefined;

		if (isLoading) {
			// Only transition when loading new word analysis
			setIsTransitioning(true);
			const timeout = window.setTimeout(() => {
				setDisplayedData({
					word,
					wordFromVerse,
					transliteration,
					meanings,
					root,
					rootTransliteration,
					rootMeaning,
					prefixes,
					instances,
					qumranWord,
					qumranStrong,
					qumranTransliteration,
					qumranMeanings,
					qumranRoot,
					qumranRootTransliteration,
					qumranRootMeaning,
					qumranCommentary,
				});
				setIsTransitioning(false);
			}, 140);
			return () => window.clearTimeout(timeout);
		} else {
			// Update immediately without transition for word switching
			setDisplayedData({
				word,
				wordFromVerse,
				transliteration,
				meanings,
				root,
				rootTransliteration,
				rootMeaning,
				prefixes,
				instances,
				qumranWord,
				qumranStrong,
				qumranTransliteration,
				qumranMeanings,
				qumranRoot,
				qumranRootTransliteration,
				qumranRootMeaning,
				qumranCommentary,
			});
		}
	}, [
		displayedData,
		instances,
		isLoading,
		meanings,
		qumranMeanings,
		prefixes,
		root,
		rootMeaning,
		rootTransliteration,
		transliteration,
		word,
		wordFromVerse,
		qumranWord,
		qumranStrong,
		qumranTransliteration,
		qumranRoot,
		qumranRootMeaning,
		qumranRootTransliteration,
		qumranCommentary,
	]);

	useEffect(() => {
		if (tabResetKey === undefined) return;
		setActiveTab(defaultTab);
	}, [defaultTab, tabResetKey]);

	useEffect(() => {
		setActiveTab(defaultTab);
	}, [defaultTab]);

	useEffect(() => {
		if (showQumran && showQumranTab) {
			setActiveTab("qumran");
		}
	}, [showQumran, showQumranTab]);

	useEffect(() => {
		if (!hasQumranVariant && activeTab === "qumran") {
			setActiveTab("masoretic");
		}
	}, [activeTab, hasQumranVariant]);

	return (
		<div
			className="space-y-6 py-2"
			style={{
				opacity: isTransitioning ? 0.8 : 1,
				transition: "opacity 160ms ease",
			}}
		>
			<div className="flex justify-end">
				{onClose && (
					<button
						type="button"
						onClick={onClose}
						className="rounded-full p-2 transition-all hover:scale-105 active:scale-95"
						style={{
							backgroundColor: "var(--neomorph-bg)",
							border: "1px solid var(--neomorph-border)",
							boxShadow:
								"6px 6px 12px var(--neomorph-shadow-dark), -6px -6px 12px var(--neomorph-shadow-light)",
						}}
						aria-label={t("wordCard.close")}
					>
						<X className="w-4 h-4 text-[var(--text-secondary)]" />
					</button>
				)}
			</div>

			{/* Word - Large centered */}
			<div className="text-center space-y-2 pb-6">
				<div
					style={{
						fontFamily: isQumranTab ? qumranFontFamily : "'Cardo', serif",
						fontSize: isQumranTab ? qumranWordFontSize : masoreticWordFontSize,
						direction: "rtl",
						lineHeight: isQumranTab && hasMultiWordDisplay ? 1.35 : 1.8,
						letterSpacing:
							isQumranTab && hasMultiWordDisplay ? "0.015em" : "0.05em",
						fontWeight: 400,
						wordSpacing:
							isQumranTab && hasMultiWordDisplay ? "0.02em" : "0.1em",
					}}
				>
					{prefixSegments.prefixes.length > 0 && !isQumranTab ? (
						<>
							<span style={{ color: "var(--text-secondary)" }}>
								{normalizeHebrewDisplay(prefixSegments.prefixes.join(""))}
							</span>
							<span style={{ color: "var(--text-hebrew)" }}>
								{normalizeHebrewDisplay(prefixSegments.root)}
							</span>
						</>
					) : (
						<span
							style={{
								color: isQumranTab ? qumranTextColor : "var(--text-hebrew)",
							}}
						>
							{normalizeHebrewDisplay(displayWord.replace(/\//g, ""))}
						</span>
					)}
				</div>

				{activeStrongNumber && (
					<div
						style={{
							fontFamily: "'Inter', sans-serif",
							fontSize: "11px",
							color: "var(--text-secondary)",
							textTransform: "uppercase",
							letterSpacing: "0.12em",
							fontWeight: 500,
							marginTop: "8px",
						}}
					>
						{activeStrongNumber}
					</div>
				)}

				{/* Transliteration */}
				{activeTransliteration && (
					<div
						style={{
							fontFamily: "'Inter', sans-serif",
							fontSize: "11px",
							color: "var(--text-secondary)",
							textTransform: "uppercase",
							letterSpacing: "0.15em",
							fontWeight: 500,
							marginTop: "12px",
						}}
					>
						{activeTransliteration}
					</div>
				)}
			</div>

			{/* Segmented Control - Pill style with border */}
			<div
				className={`grid ${showQumranTab ? "grid-cols-3" : "grid-cols-2"} gap-2 border-2 border-[var(--primary)] rounded-full p-1`}
				style={{ overflow: "hidden" }}
			>
				{showQumranTab && (
					<button
						type="button"
						onClick={() => setActiveTab("qumran")}
						className="py-3 transition-all rounded-full"
						style={{
							fontFamily: "'Inter', sans-serif",
							fontWeight: 700,
							fontSize: "11px",
							letterSpacing: "0.12em",
							textTransform: "uppercase",
							backgroundColor:
								activeTab === "qumran" ? "var(--accent-strong)" : "transparent",
							color:
								activeTab === "qumran" ? "#ffffff" : "var(--text-secondary)",
						}}
					>
						{t("wordCard.qumran")}
					</button>
				)}
				<button
					type="button"
					onClick={() => setActiveTab("masoretic")}
					className="py-3 transition-all rounded-full"
					style={{
						fontFamily: "'Inter', sans-serif",
						fontWeight: 700,
						fontSize: "11px",
						letterSpacing: "0.12em",
						textTransform: "uppercase",
						backgroundColor:
							activeTab === "masoretic"
								? "var(--accent-strong)"
								: "transparent",
						color:
							activeTab === "masoretic" ? "#ffffff" : "var(--text-secondary)",
					}}
				>
					{showQumranTab ? t("wordCard.masoretic") : t("wordCard.meanings")}
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("instances")}
					className="py-3 transition-all rounded-full"
					style={{
						fontFamily: "'Inter', sans-serif",
						fontWeight: 700,
						fontSize: "11px",
						letterSpacing: "0.12em",
						textTransform: "uppercase",
						backgroundColor:
							activeTab === "instances"
								? "var(--accent-strong)"
								: "transparent",
						color:
							activeTab === "instances" ? "#ffffff" : "var(--text-secondary)",
					}}
				>
					{t("wordCard.instances")}
				</button>
			</div>

			{/* Tab Content */}
			{activeTab === "masoretic" ? (
				<div className="space-y-6 text-center">
					{/* Meanings Section */}
					<div className="pb-6">
						<h3
							className="mb-4"
							style={{
								fontFamily: "'Inter', sans-serif",
								fontSize: "11px",
								color: "var(--text-secondary)",
								fontWeight: 700,
								letterSpacing: "0.15em",
								textTransform: "uppercase",
							}}
						>
							{t("wordCard.meanings")}
						</h3>
						<div
							style={{
								fontFamily: "'Jost', sans-serif",
								fontSize: "18px",
								lineHeight: 1.5,
								fontWeight: 400,
							}}
							className="dark:text-[var(--text-secondary)]"
						>
							{displayedData.meanings.length > 0 ? (
								<div className="space-y-2 text-center">
									{meaningItems.map((item) => (
										<div key={item.key} style={{ whiteSpace: "normal" }}>
											{formatMeaning(item.value).replace(/\//g, "")}
										</div>
									))}
								</div>
							) : (
								t("wordCard.noMeanings")
							)}
						</div>
					</div>

					{displayedData.prefixes?.length ? (
						<div className="text-center space-y-4 pb-6">
							<h3
								className="mb-2"
								style={{
									fontFamily: "'Inter', sans-serif",
									fontSize: "11px",
									color: "var(--text-secondary)",
									fontWeight: 700,
									letterSpacing: "0.15em",
									textTransform: "uppercase",
								}}
							>
								{t("wordCard.preposition")}
							</h3>
							{prefixItems.map((prefixItem, index) => {
								const prefixId = prefixItem.value;
								const entry = prefixEntries[prefixId];
								const meanings =
									entry?.meanings?.[language] ??
									entry?.meanings?.en ??
									entry?.meanings?.es ??
									[];
								const translit =
									language === "es"
										? entry?.transliteration_es
										: (entry?.transliteration_en ?? entry?.transliteration_es);
								const prefixText = stripMeteg(
									prefixSegments.prefixes[index]?.replace(/\//g, "") ??
										entry?.main_form ??
										"",
								);
								const { head: prefixHead, tail: prefixTail } =
									splitLeadingHebrewCluster(prefixText);

								return (
									<div key={prefixItem.key} className="space-y-2">
										<div
											style={{
												fontFamily: "'Cardo', serif",
												fontSize: "48px",
												direction: "rtl",
												lineHeight: 1,
												fontWeight: 600,
											}}
										>
											{prefixHead && (
												<>
													<span style={{ color: "var(--text-secondary)" }}>
														{normalizeHebrewDisplay(prefixHead)}
													</span>
													{prefixTail.length > 0 && (
														<span style={{ color: "var(--text-hebrew)" }}>
															{normalizeHebrewDisplay(prefixTail)}
														</span>
													)}
												</>
											)}
										</div>
										{translit ? (
											<div
												style={{
													fontFamily: "'Inter', sans-serif",
													fontSize: "11px",
													color: "var(--text-secondary)",
													textTransform: "uppercase",
													letterSpacing: "0.15em",
													fontWeight: 500,
												}}
											>
												{translit}
											</div>
										) : null}
										{meanings.length ? (
											<div
												style={{
													fontFamily: "'Jost', sans-serif",
													fontSize: "15px",
													lineHeight: 1.5,
												}}
												className="dark:text-[var(--text-secondary)]"
											>
												{meanings.join(", ")}
											</div>
										) : null}
									</div>
								);
							})}
						</div>
					) : null}

					{/* Root Section */}
					{/* Root Section — always show; if no root, show ALREADY ROOT */}
					<div className="pb-6">
						<h3
							className="mb-4"
							style={{
								fontFamily: "'Inter', sans-serif",
								fontSize: "11px",
								color: "var(--text-secondary)",
								fontWeight: 700,
								letterSpacing: "0.15em",
								textTransform: "uppercase",
							}}
						>
							{t("wordCard.root")}
						</h3>
						<div className="space-y-2">
							{hasRootInfo ? (
								<>
									{displayedData.root ? (
										<div
											style={{
												fontFamily: "'Cardo', serif",
												fontSize: "48px",
												direction: "rtl",
												color: "var(--primary)",
												fontWeight: 600,
												lineHeight: 1.4,
											}}
										>
											{normalizeHebrewDisplay(
												normalizeHebrew(displayedData.root).replace(/\//g, ""),
											)}
										</div>
									) : (
										<div
											style={{
												fontFamily: "'Inter', sans-serif",
												fontSize: "13px",
												color: "var(--text-secondary)",
												textTransform: "uppercase",
												letterSpacing: "0.12em",
												fontWeight: 600,
											}}
										>
											—
										</div>
									)}

									{rootStrongNumber && (
										<div
											style={{
												fontFamily: "'Inter', sans-serif",
												fontSize: "11px",
												color: "var(--text-secondary)",
												textTransform: "uppercase",
												letterSpacing: "0.12em",
												fontWeight: 500,
												marginTop: "6px",
											}}
										>
											{rootStrongNumber}
										</div>
									)}

									{displayedData.rootTransliteration && (
										<div
											style={{
												fontFamily: "'Inter', sans-serif",
												fontSize: "11px",
												color: "var(--text-secondary)",
												textTransform: "uppercase",
												letterSpacing: "0.12em",
												fontWeight: 500,
												marginTop: "8px",
											}}
										>
											{displayedData.rootTransliteration}
										</div>
									)}

									{/* Show meaning only if root differs from word */}
									{rootStrongNumber &&
										strongNumber &&
										rootStrongNumber !== strongNumber && (
											<div
												style={{
													fontFamily: "'Inter', sans-serif",
													fontSize: "15px",
													lineHeight: 1.5,
													marginTop: "12px",
												}}
												className="dark:text-[var(--text-secondary)]"
											>
												{displayedData.rootMeaning
													? formatMeaning(displayedData.rootMeaning)
													: "—"}
											</div>
										)}
								</>
							) : (
								<div
									style={{
										fontFamily: "'Inter', sans-serif",
										lineHeight: 1.5,
										textAlign: "center",
									}}
									className="dark:text-[var(--text-secondary)]"
								>
									<strong>{t("wordCard.alreadyRoot")}</strong>
								</div>
							)}
						</div>
					</div>
				</div>
			) : activeTab === "qumran" ? (
				<div className="space-y-6 text-center">
					<div className="pb-6">
						<h3
							className="mb-4"
							style={{
								fontFamily: "'Inter', sans-serif",
								fontSize: "11px",
								color: "var(--text-secondary)",
								fontWeight: 700,
								letterSpacing: "0.15em",
								textTransform: "uppercase",
							}}
						>
							{t("wordCard.commentary")}
						</h3>
						<div
							style={{
								fontFamily: "'Jost', sans-serif",
								fontSize: "15px",
								lineHeight: 1.6,
								fontWeight: 400,
								color: "var(--text-primary)",
							}}
							className="dark:text-[var(--text-secondary)]"
						>
							{displayedData.qumranCommentary || "—"}
						</div>
					</div>

					<div className="pb-6">
						<h3
							className="mb-4"
							style={{
								fontFamily: "'Inter', sans-serif",
								fontSize: "11px",
								color: "var(--text-secondary)",
								fontWeight: 700,
								letterSpacing: "0.15em",
								textTransform: "uppercase",
							}}
						>
							{t("wordCard.meanings")}
						</h3>
						<div
							style={{
								fontFamily: "'Jost', sans-serif",
								fontSize: "18px",
								lineHeight: 1.5,
								fontWeight: 400,
								color: "var(--text-primary)",
							}}
							className="dark:text-[var(--text-secondary)]"
						>
							{isQumranLoading ? (
								t("wordCard.loadingDefinitions")
							) : displayedData.qumranMeanings?.length ? (
								<div className="space-y-2 text-center">
									{qumranMeaningItems.map((item) => (
										<div key={item.key} style={{ whiteSpace: "normal" }}>
											{formatMeaning(item.value).replace(/\//g, "")}
										</div>
									))}
								</div>
							) : (
								t("wordCard.noMeanings")
							)}
						</div>
					</div>

					<div className="pb-6">
						<h3
							className="mb-4"
							style={{
								fontFamily: "'Inter', sans-serif",
								fontSize: "11px",
								color: "var(--text-secondary)",
								fontWeight: 700,
								letterSpacing: "0.15em",
								textTransform: "uppercase",
							}}
						>
							{t("wordCard.root")}
						</h3>
						<div className="space-y-2">
							{hasQumranRootInfo ? (
								<>
									{displayedData.qumranRoot ? (
										<div
											style={{
												fontFamily: qumranFontFamily,
												fontSize: "48px",
												direction: "rtl",
												color: "var(--text-hebrew)",
												fontWeight: 600,
												lineHeight: 1.4,
											}}
										>
											{normalizeHebrewDisplay(
												normalizeHebrew(displayedData.qumranRoot).replace(
													/\//g,
													"",
												),
											)}
										</div>
									) : (
										<div
											style={{
												fontFamily: "'Inter', sans-serif",
												fontSize: "13px",
												color: "var(--text-secondary)",
												textTransform: "uppercase",
												letterSpacing: "0.12em",
												fontWeight: 600,
											}}
										>
											—
										</div>
									)}

									{qumranRootStrongNumber && (
										<div
											style={{
												fontFamily: "'Inter', sans-serif",
												fontSize: "11px",
												color: "var(--text-secondary)",
												textTransform: "uppercase",
												letterSpacing: "0.12em",
												fontWeight: 500,
												marginTop: "6px",
											}}
										>
											{qumranRootStrongNumber}
										</div>
									)}

									{displayedData.qumranRootTransliteration && (
										<div
											style={{
												fontFamily: "'Inter', sans-serif",
												fontSize: "11px",
												color: "var(--text-secondary)",
												textTransform: "uppercase",
												letterSpacing: "0.12em",
												fontWeight: 500,
												marginTop: "8px",
											}}
										>
											{displayedData.qumranRootTransliteration}
										</div>
									)}

									{/* Show meaning only if root differs from word */}
									{qumranRootStrongNumber &&
										qumranStrong &&
										qumranRootStrongNumber !== qumranStrong && (
											<div
												style={{
													fontFamily: "'Inter', sans-serif",
													fontSize: "15px",
													lineHeight: 1.5,
													marginTop: "12px",
													color: "var(--text-primary)",
												}}
												className="dark:text-[var(--text-secondary)]"
											>
												{displayedData.qumranRootMeaning
													? formatMeaning(displayedData.qumranRootMeaning)
													: "—"}
											</div>
										)}
								</>
							) : (
								<div
									style={{
										fontFamily: "'Inter', sans-serif",
										lineHeight: 1.5,
										textAlign: "center",
									}}
									className="dark:text-[var(--text-secondary)]"
								>
									<strong>{t("wordCard.alreadyRoot")}</strong>
								</div>
							)}
						</div>
					</div>
				</div>
			) : (
				<div className="space-y-6 text-center pb-6">
					{/* Instances Section */}
					<div className="pb-6">
						<h3
							className="mb-4"
							style={{
								fontFamily: "'Inter', sans-serif",
								fontSize: "11px",
								color: "var(--text-secondary)",
								fontWeight: 700,
								letterSpacing: "0.15em",
								textTransform: "uppercase",
							}}
						>
							{t("wordCard.tapToNavigate")}
						</h3>
						<div className="grid grid-cols-3 gap-2">
							{displayedData.instances.length > 0 ? (
								instanceItems.map((item) => (
									<button
										type="button"
										key={item.key}
										onClick={() => onInstanceClick(item.value.verse)}
										className="py-4 transition-all hover:bg-[var(--primary)] hover:text-white rounded-[20px]"
										style={{
											backgroundColor: "var(--muted)",
											fontFamily: "'Inter', sans-serif",
											fontSize: "13px",
											fontWeight: 600,
											color: "var(--foreground)",
										}}
									>
										{formatVerseRef(item.value.verse, language)}
									</button>
								))
							) : (
								<div
									className="col-span-3 text-sm text-[var(--text-secondary)]"
									style={{ fontFamily: "'Inter', sans-serif" }}
								>
									{t("wordCard.noInstances")}
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
