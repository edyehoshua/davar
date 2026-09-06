import React, { type ReactNode } from "react";
import {
	SHARED_SETTINGS_ORDER,
	canUseSeferStyle,
	isSeferStyleVisible,
	type SharedSettingId,
} from "@davar/shared/settingsOrder";
import { useTranslation } from "../hooks/useTranslation";

interface SettingsScreenProps {
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
	translationOnly?: boolean;
	onDesignSystemClick?: () => void;
	onMobileDesignGuideClick?: () => void;
}

// 2D Retro Pill Toggle inspired by the copper toggle switch
function RetroPillToggle({
	isOn,
	onToggle,
}: {
	isOn: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className="relative bg-[var(--border)] rounded-full p-0.5 transition-all duration-300 flex-shrink-0"
			style={{
				width: "80px",
				height: "40px",
				boxShadow: "inset 0 2px 4px rgba(0,0,0,0.15)",
			}}
		>
			{/* Sliding pill */}
			<div
				className={`
          absolute top-0.5 h-[36px] w-[38px] rounded-full transition-all duration-300
          ${
						isOn
							? "translate-x-[40px] bg-[var(--primary)]"
							: "translate-x-0.5 bg-[var(--muted)]"
					}
        `}
				style={{
					boxShadow: isOn
						? "0 2px 8px var(--accent-glow), inset 0 -2px 4px rgba(0,0,0,0.2)"
						: "0 2px 4px rgba(0,0,0,0.1), inset 0 -2px 4px rgba(0,0,0,0.1)",
					border: isOn
						? "2px solid var(--accent-deep)"
						: "2px solid var(--border)",
				}}
			/>
		</button>
	);
}

// Retro On/Off Button Component inspired by vintage audio equipment
function RetroOnOffButton({
	isOn,
	onToggle,
	onLabel,
	offLabel,
	disabled = false,
	disabledReason,
}: {
	isOn: boolean;
	onToggle: () => void;
	onLabel: string;
	offLabel: string;
	disabled?: boolean;
	disabledReason?: string;
}) {
	return (
		<button
			type="button"
			onClick={disabled ? undefined : onToggle}
			disabled={disabled}
			aria-disabled={disabled}
			title={disabled ? disabledReason : undefined}
			className={`relative flex flex-col items-center justify-center gap-2 group ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
			style={{ width: "64px" }}
		>
			{/* Large circular button with light indicator */}
			<div
				className={`
          relative w-14 h-14 rounded-full border-3 transition-all duration-300
          ${
						isOn
							? "bg-[var(--primary)] border-[var(--accent-deep)] shadow-lg"
							: "bg-[var(--muted)] border-[var(--border)] shadow-sm"
					}
        `}
				style={{
					boxShadow: isOn
						? "0 0 20px var(--accent-glow), inset 0 2px 4px rgba(0,0,0,0.2)"
						: "inset 0 2px 4px rgba(0,0,0,0.1)",
					borderWidth: "3px",
				}}
			>
				{/* Inner light indicator - glows when on */}
				<div
					className={`
            absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2
            w-6 h-6 rounded-full transition-all duration-300
            ${
							isOn
								? "bg-white opacity-90"
								: "bg-[var(--text-secondary)] opacity-20"
						}
          `}
					style={{
						boxShadow: isOn
							? "0 0 12px rgba(255,255,255,0.8), 0 0 24px var(--accent-glow)"
							: "none",
					}}
				/>
			</div>

			{/* ON/OFF label */}
			<div
				className="text-xs font-bold tracking-wide uppercase"
				style={{
					fontFamily: "'Inter', sans-serif",
					color: isOn ? "var(--primary)" : "var(--text-secondary)",
				}}
			>
				{isOn ? onLabel : offLabel}
			</div>
		</button>
	);
}

// Simple retro-style SVG icons
const RetroIcons = {
	Theme: () => (
		<svg
			aria-hidden="true"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.3" />
			<path d="M12 4 L12 12 L16 8 Z" fill="currentColor" />
		</svg>
	),
	Language: () => (
		<svg
			aria-hidden="true"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<circle
				cx="12"
				cy="12"
				r="8"
				stroke="currentColor"
				strokeWidth="2"
				fill="none"
			/>
			<path
				d="M4 12 H20 M12 4 C14 8 14 16 12 20 M12 4 C10 8 10 16 12 20"
				stroke="currentColor"
				strokeWidth="2"
				fill="none"
			/>
		</svg>
	),
	Qumran: () => (
		<svg
			aria-hidden="true"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect
				x="6"
				y="4"
				width="12"
				height="16"
				stroke="currentColor"
				strokeWidth="2"
				fill="none"
				rx="1"
			/>
			<line
				x1="9"
				y1="8"
				x2="15"
				y2="8"
				stroke="currentColor"
				strokeWidth="2"
			/>
			<line
				x1="9"
				y1="12"
				x2="15"
				y2="12"
				stroke="currentColor"
				strokeWidth="2"
			/>
			<line
				x1="9"
				y1="16"
				x2="13"
				y2="16"
				stroke="currentColor"
				strokeWidth="2"
			/>
		</svg>
	),
	Chapter: () => (
		<svg
			aria-hidden="true"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M7 4 L7 20 M7 4 L14 4 C16 4 17 6 17 8 C17 10 16 12 14 12 L7 12 M7 12 L15 12 C17 12 18 14 18 16 C18 18 17 20 15 20 L7 20"
				stroke="currentColor"
				strokeWidth="2"
				fill="none"
			/>
		</svg>
	),
	Hebrew: () => (
		<svg
			aria-hidden="true"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M8 6 L8 18 M12 6 L12 18 M16 6 L16 12 M8 12 L16 12"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</svg>
	),
	Sefer: () => (
		<svg
			aria-hidden="true"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M5 4 H17 C18.5 4 19 5 19 6.5 V19 C19 17.5 18.5 16.5 17 16.5 H5"
				stroke="currentColor"
				strokeWidth="2"
				fill="none"
			/>
			<path d="M5 4 V19" stroke="currentColor" strokeWidth="2" />
			<path d="M8 8 H15" stroke="currentColor" strokeWidth="2" />
			<path d="M8 12 H15" stroke="currentColor" strokeWidth="2" />
		</svg>
	),
	DesignSystem: () => (
		<svg
			aria-hidden="true"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect
				x="4"
				y="4"
				width="7"
				height="7"
				stroke="currentColor"
				strokeWidth="2"
				fill="none"
			/>
			<rect
				x="13"
				y="4"
				width="7"
				height="7"
				stroke="currentColor"
				strokeWidth="2"
				fill="none"
			/>
			<rect
				x="4"
				y="13"
				width="7"
				height="7"
				stroke="currentColor"
				strokeWidth="2"
				fill="none"
			/>
			<rect
				x="13"
				y="13"
				width="7"
				height="7"
				stroke="currentColor"
				strokeWidth="2"
				fill="none"
			/>
		</svg>
	),
};

const languages = [
	{ code: "en" as const, name: "English", nativeName: "English" },
	{ code: "es" as const, name: "Spanish", nativeName: "Espa\u00f1ol" },
	{ code: "he" as const, name: "Hebrew", nativeName: "\u05e2\u05d1\u05e8\u05d9\u05ea" },
];

export function SettingsScreen({
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
	translationOnly = false,
	onDesignSystemClick,
	onMobileDesignGuideClick,
}: SettingsScreenProps) {
	const [isLanguageOpen, setIsLanguageOpen] = React.useState(false);
	const selectedLanguage =
		languages.find((lang) => lang.code === language) || languages[0];
	const dropdownRef = React.useRef<HTMLDivElement>(null);
	const { t } = useTranslation(language);
	const seferEnabled = canUseSeferStyle({
		showFullChapter,
		hebrewOnly,
		translationOnly,
	});
	const seferDisabled = !seferEnabled;


	// Close dropdown when clicking outside
	React.useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target as Node)
			) {
				setIsLanguageOpen(false);
			}
		};

		if (isLanguageOpen) {
			document.addEventListener("mousedown", handleClickOutside);
			return () =>
				document.removeEventListener("mousedown", handleClickOutside);
		}
	}, [isLanguageOpen]);


	const renderSharedSetting = (id: SharedSettingId): ReactNode => {
		switch (id) {
			case "theme":
				return (
					<div className="px-6 py-6">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-4">
								<div className="text-[var(--text-secondary)]">
									<RetroIcons.Theme />
								</div>
								<div>
									<div
										className="text-lg font-semibold text-[var(--text-primary)]"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.theme.title")}
									</div>
									<div
										className="text-sm text-[var(--text-secondary)] mt-0.5"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.theme.subtitle")}
									</div>
								</div>
							</div>
							<RetroPillToggle
								isOn={theme === "dark"}
								onToggle={() =>
									onThemeChange(theme === "light" ? "dark" : "light")
								}
							/>
						</div>
					</div>
				);
			case "language":
				return (
					<div
						className={`px-6 py-6 relative ${isLanguageOpen ? "z-50" : "z-10"}`}
					>
						<div className="flex items-center justify-between gap-4">
							<div className="flex items-center gap-4">
								<div className="text-[var(--text-secondary)]">
									<RetroIcons.Language />
								</div>
								<div>
									<div
										className="text-lg font-semibold text-[var(--text-primary)]"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.language.title")}
									</div>
								</div>
							</div>

							{/* Custom Dropdown */}
							<div
								className="relative flex-shrink-0"
								ref={dropdownRef}
								style={{ minWidth: "140px" }}
							>
								<button
									type="button"
									onClick={() => setIsLanguageOpen(!isLanguageOpen)}
									className="w-full bg-[var(--muted)] border-2 border-[var(--border)] rounded-[16px] px-4 py-2 flex items-center justify-between hover:bg-[var(--primary)]/10 transition-all"
								>
									<span
										className="text-base text-[var(--foreground)] font-medium"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{selectedLanguage.nativeName}
									</span>
									<svg
										aria-hidden="true"
										className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${isLanguageOpen ? "rotate-180" : ""}`}
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M19 9l-7 7-7-7"
										/>
									</svg>
								</button>

								{isLanguageOpen && (
									<div className="absolute top-full left-0 right-0 mt-2 bg-[var(--background)] border-2 border-[var(--border)] rounded-[16px] shadow-lg overflow-hidden z-[100]">
										{languages.map((lang) => (
											<button
												type="button"
												key={lang.code}
												onClick={() => {
													onLanguageChange(lang.code);
													setIsLanguageOpen(false);
												}}
												className={`w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--muted)] transition-all ${
													lang.code === language ? "bg-[var(--muted)]" : ""
												}`}
											>
												<span
													className="text-base text-[var(--foreground)] font-medium"
													style={{ fontFamily: "'Inter', sans-serif" }}
												>
													{lang.nativeName}
												</span>
												{lang.code === language && (
													<svg
														aria-hidden="true"
														className="w-4 h-4 text-[var(--primary)]"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															strokeLinecap="round"
															strokeLinejoin="round"
															strokeWidth={2}
															d="M5 13l4 4L19 7"
														/>
													</svg>
												)}
											</button>
										))}
									</div>
								)}
							</div>
						</div>
					</div>
				);
			case "besorahTextVersion":
				return (
					<div className="px-6 py-6">
						<div className="flex items-center justify-between gap-4">
							<div className="flex items-center gap-4">
								<div className="text-[var(--text-secondary)]">
									<RetroIcons.Qumran />
								</div>
								<div className="flex items-center gap-2">
									<div
										className="text-lg font-semibold text-[var(--text-primary)]"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.besorahTextVersion.title")}
									</div>
									<span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
										{t("settings.besorahTextVersion.new")}
									</span>
								</div>
							</div>
							<select
								value={besorahTextVersion}
								onChange={(event) =>
									onBesorahTextVersionChange(
										event.target.value as "delitzsch" | "hutter",
									)
								}
								className="min-w-[140px] rounded-[16px] border-2 border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-base font-medium text-[var(--foreground)]"
								style={{ fontFamily: "'Inter', sans-serif" }}
							>
								<option value="delitzsch">
									{t("settings.besorahTextVersion.delitzsch")}
								</option>
								<option value="hutter">
									{t("settings.besorahTextVersion.hutter")}
								</option>
							</select>
						</div>
					</div>
				);
			case "fullChapter":
				return (
					<div className="px-6 py-6">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-4">
								<div className="text-[var(--text-secondary)]">
									<RetroIcons.Chapter />
								</div>
								<div>
									<div
										className="text-lg font-semibold text-[var(--text-primary)]"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.fullChapter.title")}
									</div>
									<div
										className="text-sm text-[var(--text-secondary)] mt-0.5"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.fullChapter.subtitle")}
									</div>
								</div>
							</div>
							<RetroOnOffButton
								isOn={showFullChapter}
								onToggle={() => onFullChapterChange(!showFullChapter)}
								onLabel={t("common.on")}
								offLabel={t("common.off")}
							/>
						</div>
					</div>
				);
			case "seferStyle":
				if (!isSeferStyleVisible(showFullChapter)) return null;
				return (
					<div className="px-6 py-6">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-4">
								<div className="text-[var(--text-secondary)]">
									<RetroIcons.Sefer />
								</div>
								<div>
									<div
										className="text-lg font-semibold text-[var(--text-primary)]"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.seferStyle.title")}
									</div>
									<div
										className="text-sm text-[var(--text-secondary)] mt-0.5"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.seferStyle.subtitle")}
									</div>
								</div>
							</div>
							<div className="relative group">
								<RetroOnOffButton
									isOn={seferMode}
									onToggle={() => onSeferModeChange(!seferMode)}
									onLabel={t("common.on")}
									offLabel={t("common.off")}
									disabled={seferDisabled}
									disabledReason={t("settings.seferStyle.warningMessage")}
								/>
								{seferDisabled && (
									<div className="absolute right-0 mt-2 w-48 rounded-lg bg-[var(--background)] border border-[var(--border)] px-3 py-2 text-[10px] text-[var(--text-secondary)] shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
										{t("settings.seferStyle.warningMessage")}
									</div>
								)}
							</div>
						</div>
					</div>
				);
			case "hebrewOnly":
				return (
					<div className="px-6 py-6">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-4">
								<div className="text-[var(--text-secondary)]">
									<RetroIcons.Hebrew />
								</div>
								<div>
									<div
										className="text-lg font-semibold text-[var(--text-primary)]"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.hebrewOnly.title")}
									</div>
									<div
										className="text-sm text-[var(--text-secondary)] mt-0.5"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.hebrewOnly.subtitle")}
									</div>
								</div>
							</div>
							<RetroOnOffButton
								isOn={hebrewOnly}
								onToggle={() => onHebrewOnlyChange(!hebrewOnly)}
								onLabel={t("common.on")}
								offLabel={t("common.off")}
							/>
						</div>
					</div>
				);
			case "qumran":
				return (
					<div className="px-6 py-6">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-4">
								<div className="text-[var(--text-secondary)]">
									<RetroIcons.Qumran />
								</div>
								<div>
									<div
										className="text-lg font-semibold text-[var(--text-primary)]"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.qumran.title")}
									</div>
									<div
										className="text-sm text-[var(--text-secondary)] mt-0.5"
										style={{ fontFamily: "'Inter', sans-serif" }}
									>
										{t("settings.qumran.subtitle")}
									</div>
								</div>
							</div>
							<RetroOnOffButton
								isOn={showQumran}
								onToggle={() => onQumranChange(!showQumran)}
								onLabel={t("common.on")}
								offLabel={t("common.off")}
							/>
						</div>
					</div>
				);
			default: {
				const _exhaustive: never = id;
				return _exhaustive;
			}
		}
	};

	return (
		<div className="pb-24">
			{/* General Section Header */}
			<h3
				className="text-base text-[var(--text-secondary)] px-6 py-4 uppercase tracking-wider font-bold"
				style={{ fontFamily: "'Inter', sans-serif" }}
			>
				{t("settings.sections.general")}
			</h3>

			{SHARED_SETTINGS_ORDER.map((id) => {
				const row = renderSharedSetting(id);
				if (!row) return null;
				return (
					<React.Fragment key={id}>
						{row}
						<div className="border-t border-[var(--border)]" />
					</React.Fragment>
				);
			})}

			{/* Design System Button */}
			{onDesignSystemClick && (
				<>
					<button
						type="button"
						onClick={onDesignSystemClick}
						className="px-6 py-6 flex items-center justify-between w-full hover:bg-[var(--muted)] transition-all"
					>
						<div className="flex items-center gap-4">
							<div className="text-[var(--text-secondary)]">
								<RetroIcons.DesignSystem />
							</div>
							<div>
								<div
									className="text-lg font-semibold text-[var(--text-primary)]"
									style={{ fontFamily: "'Inter', sans-serif" }}
								>
									{t("settings.designSystemTitle")}
								</div>
								<div
									className="text-sm text-[var(--text-secondary)] mt-0.5"
									style={{ fontFamily: "'Inter', sans-serif" }}
								>
									{t("settings.designSystemDescription")}
								</div>
							</div>
						</div>
					</button>
				</>
			)}

			{/* Mobile Design Guide Button */}
			{onMobileDesignGuideClick && (
				<>
					{/* Divider */}
					<div className="border-t border-[var(--border)]" />

					<button
						type="button"
						onClick={onMobileDesignGuideClick}
						className="px-6 py-6 flex items-center justify-between w-full hover:bg-[var(--muted)] transition-all"
					>
						<div className="flex items-center gap-4">
							<div className="text-[var(--text-secondary)]">
								<RetroIcons.DesignSystem />
							</div>
							<div>
								<div
									className="text-lg font-semibold text-[var(--text-primary)]"
									style={{ fontFamily: "'Inter', sans-serif" }}
								>
									{t("settings.mobileDesignGuideTitle")}
								</div>
								<div
									className="text-sm text-[var(--text-secondary)] mt-0.5"
									style={{ fontFamily: "'Inter', sans-serif" }}
								>
									{t("settings.mobileDesignGuideDescription")}
								</div>
							</div>
						</div>
					</button>
				</>
			)}
		</div>
	);
}
