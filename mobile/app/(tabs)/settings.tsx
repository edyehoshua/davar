import { Fragment, useCallback, useMemo, type ReactNode } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/src/components/ui/AppIcon";
import { PillToggle } from "@/src/components/ui/PillToggle";
import { OnOffButton } from "@/src/components/ui/OnOffButton";
import { SettingsDropdown } from "@/src/components/ui/SettingsDropdown";
import { getColors, radii, spacing, typography } from "@/src/theme";
import { useAppStore, type AppState } from "@/src/store/useAppStore";
import { clearStorage } from "@/src/services/storage";
import { useTranslation } from "@/src/i18n/useTranslation";
import {
  SHARED_SETTINGS_ORDER,
  canUseSeferStyle,
  isSeferStyleVisible,
  type SharedSettingId,
} from "@davar/shared/settingsOrder";

const createStyles = (colors: ReturnType<typeof getColors>, isRTL: boolean) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      paddingHorizontal: spacing[6],
      paddingTop: spacing[4],
      paddingBottom: spacing[8],
    },
    header: {
      alignItems: "center",
      marginBottom: spacing[5],
    },
    title: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.h2,
      fontWeight: typography.weights.semibold,
      color: colors.textPrimary,
      textAlign: isRTL ? "right" : "left",
      writingDirection: isRTL ? "rtl" : "ltr",
    },
    sectionTitle: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.bodySmall,
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 1.5,
      marginBottom: spacing[3],
      textAlign: isRTL ? "right" : "left",
      writingDirection: isRTL ? "rtl" : "ltr",
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: spacing[3],
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing[2],
    },
    rowContent: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
    },
    iconContainer: {
      width: 36,
      height: 36,
      borderRadius: radii.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: spacing[3],
    },
    textContainer: {
      flex: 1,
    },
    label: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.body,
      fontWeight: typography.weights.medium,
      color: colors.textPrimary,
      textAlign: isRTL ? "right" : "left",
      writingDirection: isRTL ? "rtl" : "ltr",
    },
    labelRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
    },
    newBadge: {
      borderRadius: 999,
      backgroundColor: colors.accentCopper,
      paddingHorizontal: spacing[2],
      paddingVertical: 2,
    },
    newBadgeText: {
      fontFamily: typography.families.latinUI,
      fontSize: 10,
      lineHeight: 12,
      fontWeight: typography.weights.semibold,
      color: "#FFFFFF",
      textTransform: "uppercase",
    },
    subtitle: {
      fontFamily: typography.families.latinUI,
      fontSize: typography.sizes.bodySmall,
      color: colors.textSecondary,
      marginTop: 1,
      textAlign: isRTL ? "right" : "left",
      writingDirection: isRTL ? "rtl" : "ltr",
    },
  });

export default function SettingsScreen() {
  const themeMode = useAppStore((state: AppState) => state.themeMode);
  const toggleThemeMode = useAppStore(
    (state: AppState) => state.toggleThemeMode,
  );
  const language = useAppStore((state: AppState) => state.language);
  const setLanguage = useAppStore((state: AppState) => state.setLanguage);
  const besorahTextVersion = useAppStore(
    (state: AppState) => state.besorahTextVersion,
  );
  const setBesorahTextVersion = useAppStore(
    (state: AppState) => state.setBesorahTextVersion,
  );
  const showQumran = useAppStore((state: AppState) => state.showQumran);
  const setShowQumran = useAppStore((state: AppState) => state.setShowQumran);
  const showFullChapter = useAppStore(
    (state: AppState) => state.showFullChapter,
  );
  const setShowFullChapter = useAppStore(
    (state: AppState) => state.setShowFullChapter,
  );
  const seferMode = useAppStore((state: AppState) => state.seferMode);
  const setSeferMode = useAppStore((state: AppState) => state.setSeferMode);
  const hebrewOnly = useAppStore((state: AppState) => state.hebrewOnly);
  const setHebrewOnly = useAppStore((state: AppState) => state.setHebrewOnly);
  const translationOnly = useAppStore(
    (state: AppState) => state.translationOnly,
  );
  const setTranslationOnly = useAppStore(
    (state: AppState) => state.setTranslationOnly,
  );
  const showCantillation = useAppStore(
    (state: AppState) => state.showCantillation,
  );
  const setShowCantillation = useAppStore(
    (state: AppState) => state.setShowCantillation,
  );
  const showNikud = useAppStore((state: AppState) => state.showNikud);
  const setShowNikud = useAppStore((state: AppState) => state.setShowNikud);
  const colors = getColors(themeMode);
  const { t, isRTL } = useTranslation();
  const styles = useMemo(() => createStyles(colors, isRTL), [colors, isRTL]);
  const translationOnlyDisablesHebrewOptions = translationOnly;
  const seferEnabled = canUseSeferStyle({
    showFullChapter,
    hebrewOnly,
    translationOnly,
  });
  const handleBesorahTextVersionChange = useCallback(
    (version: AppState["besorahTextVersion"]) => {
      setBesorahTextVersion(version);
    },
    [setBesorahTextVersion],
  );

  const handleDisabledHebrewOptionPress = () => {
    Alert.alert(t("settings.translationOnly.title"), t("settings.translationOnly.disablesHebrewFeatures"));
  };

  const handleDisabledSeferPress = () => {
    Alert.alert(
      t("settings.seferStyle.warningTitle"),
      t("settings.seferStyle.warningMessage"),
    );
  };

  const renderSharedSetting = (id: SharedSettingId): ReactNode => {
    switch (id) {
      case "theme":
        return (
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <View style={styles.iconContainer}>
                <AppIcon name="idea" size={18} color={colors.textSecondary} />
              </View>
              <View style={styles.textContainer}>
                <Text style={styles.label}>{t("settings.theme.title")}</Text>
                <Text style={styles.subtitle}>
                  {t("settings.theme.subtitle")}
                </Text>
              </View>
            </View>
            <PillToggle value={themeMode === "dark"} onChange={toggleThemeMode} />
          </View>
        );
      case "language":
        return (
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <View style={styles.iconContainer}>
                <AppIcon name="language" size={18} color={colors.textSecondary} />
              </View>
              <View style={styles.textContainer}>
                <Text style={styles.label}>{t("settings.language.title")}</Text>
              </View>
            </View>
            <SettingsDropdown
              value={language}
              onChange={setLanguage}
              options={[
                { label: t("languages.en"), value: "en" },
                { label: t("languages.es"), value: "es" },
                { label: t("languages.he"), value: "he" },
              ]}
            />
          </View>
        );
      case "besorahTextVersion":
        return (
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <View style={styles.iconContainer}>
                <AppIcon name="scroll" size={18} color={colors.textSecondary} />
              </View>
              <View style={styles.textContainer}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>
                    {t("settings.besorahTextVersion.title")}
                  </Text>
                  <View style={styles.newBadge}>
                    <Text style={styles.newBadgeText}>
                      {t("settings.besorahTextVersion.new")}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
            <SettingsDropdown
              value={besorahTextVersion}
              onChange={handleBesorahTextVersionChange}
              options={[
                {
                  label: t("settings.besorahTextVersion.delitzsch"),
                  value: "delitzsch",
                },
                {
                  label: t("settings.besorahTextVersion.hutter"),
                  value: "hutter",
                },
              ]}
            />
          </View>
        );
      case "fullChapter":
        return (
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <View style={styles.iconContainer}>
                <AppIcon name="book" size={18} color={colors.textSecondary} />
              </View>
              <View style={styles.textContainer}>
                <Text style={styles.label}>{t("settings.fullChapter.title")}</Text>
                <Text style={styles.subtitle}>
                  {t("settings.fullChapter.subtitle")}
                </Text>
              </View>
            </View>
            <OnOffButton value={showFullChapter} onChange={setShowFullChapter} />
          </View>
        );
      case "seferStyle":
        if (!isSeferStyleVisible(showFullChapter)) return null;
        return (
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <View style={styles.iconContainer}>
                <AppIcon name="book" size={18} color={colors.textSecondary} />
              </View>
              <View style={styles.textContainer}>
                <Text style={styles.label}>{t("settings.seferStyle.title")}</Text>
                <Text style={styles.subtitle}>
                  {t("settings.seferStyle.subtitle")}
                </Text>
              </View>
            </View>
            <OnOffButton
              value={seferMode}
              onChange={setSeferMode}
              disabled={!seferEnabled}
              onDisabledPress={handleDisabledSeferPress}
            />
          </View>
        );
      case "hebrewOnly":
        return (
          <View
            style={[
              styles.row,
              translationOnlyDisablesHebrewOptions ? { opacity: 0.55 } : null,
            ]}
          >
            <View style={styles.rowContent}>
              <View style={styles.iconContainer}>
                <AppIcon name="hebrew" size={18} color={colors.textSecondary} />
              </View>
              <View style={styles.textContainer}>
                <Text style={styles.label}>{t("settings.hebrewOnly.title")}</Text>
                <Text style={styles.subtitle}>
                  {t("settings.hebrewOnly.subtitle")}
                </Text>
              </View>
            </View>
            <OnOffButton
              value={hebrewOnly}
              onChange={setHebrewOnly}
              disabled={translationOnlyDisablesHebrewOptions}
              onDisabledPress={handleDisabledHebrewOptionPress}
            />
          </View>
        );
      case "qumran":
        return (
          <View
            style={[
              styles.row,
              translationOnlyDisablesHebrewOptions ? { opacity: 0.55 } : null,
            ]}
          >
            <View style={styles.rowContent}>
              <View style={styles.iconContainer}>
                <AppIcon name="scroll" size={18} color={colors.textSecondary} />
              </View>
              <View style={styles.textContainer}>
                <Text style={styles.label}>{t("settings.qumran.title")}</Text>
                <Text style={styles.subtitle}>
                  {t("settings.qumran.subtitle")}
                </Text>
              </View>
            </View>
            <OnOffButton
              value={showQumran}
              onChange={setShowQumran}
              disabled={translationOnlyDisablesHebrewOptions}
              onDisabledPress={handleDisabledHebrewOptionPress}
            />
          </View>
        );
      default: {
        const _exhaustive: never = id;
        return _exhaustive;
      }
    }
  };


  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t("settings.title")}</Text>
        </View>

        {/* General Section */}
        <Text style={styles.sectionTitle}>
          {t("settings.sections.general")}
        </Text>

        {SHARED_SETTINGS_ORDER.map((id) => {
          const row = renderSharedSetting(id);
          if (!row) return null;
          return (
            <Fragment key={id}>
              {row}
              <View style={styles.divider} />
            </Fragment>
          );
        })}

        {/* Translation Only */}
        <View style={styles.row}>
          <View style={styles.rowContent}>
            <View style={styles.iconContainer}>
              <AppIcon name="language" size={18} color={colors.textSecondary} />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.label}>{t("settings.translationOnly.title")}</Text>
              <Text style={styles.subtitle}>
                {t("settings.translationOnly.subtitle")}
              </Text>
            </View>
          </View>
          <OnOffButton value={translationOnly} onChange={setTranslationOnly} />
        </View>

        <View style={styles.divider} />

        {/* Cantillation */}
        <View
          style={[
            styles.row,
            translationOnlyDisablesHebrewOptions ? { opacity: 0.55 } : null,
          ]}
        >
          <View style={styles.rowContent}>
            <View style={styles.iconContainer}>
              <AppIcon name="hebrew" size={18} color={colors.textSecondary} />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.label}>
                {t("settings.cantillation.title")}
              </Text>
              <Text style={styles.subtitle}>
                {t("settings.cantillation.subtitle")}
              </Text>
            </View>
          </View>
          <OnOffButton
            value={showCantillation}
            onChange={setShowCantillation}
            disabled={translationOnlyDisablesHebrewOptions}
            onDisabledPress={handleDisabledHebrewOptionPress}
          />
        </View>

        <View style={styles.divider} />

        {/* Nikud */}
        <View
          style={[
            styles.row,
            translationOnlyDisablesHebrewOptions ? { opacity: 0.55 } : null,
          ]}
        >
          <View style={styles.rowContent}>
            <View style={styles.iconContainer}>
              <AppIcon name="hebrew" size={18} color={colors.textSecondary} />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.label}>{t("settings.nikud.title")}</Text>
              <Text style={styles.subtitle}>
                {t("settings.nikud.subtitle")}
              </Text>
            </View>
          </View>
          <OnOffButton
            value={showNikud}
            onChange={setShowNikud}
            disabled={translationOnlyDisablesHebrewOptions}
            onDisabledPress={handleDisabledHebrewOptionPress}
          />
        </View>

        <View style={styles.divider} />

        {/* Clear Storage */}
        <View style={styles.row}>
          <View style={styles.rowContent}>
            <View style={styles.iconContainer}>
              <AppIcon name="download" size={18} color={colors.textSecondary} />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.label}>
                {t("settings.clearStorage.title")}
              </Text>
              <Text style={styles.subtitle}>
                {t("settings.clearStorage.subtitle")}
              </Text>
            </View>
          </View>
          <OnOffButton
            value={false}
            onChange={() => {
              Alert.alert(
                t("settings.clearStorage.alertTitle"),
                t("settings.clearStorage.alertMessage"),
                [
                  { text: t("settings.clearStorage.cancel"), style: "cancel" },
                  {
                    text: t("settings.clearStorage.confirm"),
                    style: "destructive",
                    onPress: async () => {
                      await clearStorage();
                      useAppStore.getState().setHebrewFontScale(1);
                      useAppStore.getState().setShowQumran(false);
                      useAppStore.getState().setShowFullChapter(false);
                      useAppStore.getState().setSeferMode(false);
                      useAppStore.getState().setHebrewOnly(false);
                      useAppStore.getState().setTranslationOnly(false);
                      useAppStore.getState().setLanguage("en");
                      if (themeMode === "dark") {
                        toggleThemeMode();
                      }
                    },
                  },
                ],
              );
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
