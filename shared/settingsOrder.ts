/**
 * Canonical cross-platform settings order (#107).
 *
 * Single source of truth for the sequence of settings options that are
 * shared between web and mobile. Platform-specific options live in
 * clearly separated platform sections at the end of each screen:
 *
 *   - Mobile only: Translation Only, Cantillation, Nikud, Clear Storage
 *   - Web only:    Design System, Mobile Design Guide
 *
 * Dependency rules (rendered state may gate visibility/disabled):
 *   - Sefer Style requires Full Chapter enabled.
 *   - Sefer Style is enabled only in single-text mode
 *     (Hebrew Only or Translation Only).
 *   - Hebrew-dependent controls (Qumran, Hebrew Only, Cantillation,
 *     Nikud) are dimmed/disabled when Translation Only is active.
 */
export type SharedSettingId =
	| "theme"
	| "language"
	| "besorahTextVersion"
	| "fullChapter"
	| "seferStyle"
	| "hebrewOnly"
	| "qumran";

export const SHARED_SETTINGS_ORDER: readonly SharedSettingId[] = [
	"theme",
	"language",
	"besorahTextVersion",
	"fullChapter",
	"seferStyle",
	"hebrewOnly",
	"qumran",
] as const;

export type SeferStyleGate = {
	showFullChapter: boolean;
	hebrewOnly: boolean;
	translationOnly: boolean;
};

/** Row is shown only when Full Chapter is on. */
export function isSeferStyleVisible(showFullChapter: boolean): boolean {
	return showFullChapter;
}

/**
 * Canonical Sefer enablement: full-chapter single-text mode.
 * Matches locale copy ("Hebrew Only or Translation Only") and the
 * mobile store gate.
 */
export function canUseSeferStyle({
	showFullChapter,
	hebrewOnly,
	translationOnly,
}: SeferStyleGate): boolean {
	return showFullChapter && (hebrewOnly || translationOnly);
}
