import { I18nManager, Platform, type ViewStyle } from "react-native";

export type ThemeMode = "light" | "dark";

export const getColors = (mode: ThemeMode) => {
  if (mode === "dark") {
    return {
      primary: "#92B5E8",
      primaryDark: "#7B9ED1",
      primaryDeep: "#4C72A8",
      primaryLight: "#BCD8FF",
      primaryDarker: "#3D5A8C",
      secondary: "#A06C35",
      accentCopper: "#C68F55",
      qumranText: "#B5814A",
      background: "#0F0E12",
      surface: "#17161A",
      surfaceElevated: "#1F1E23",
      surfaceLightest: "#2A292E",
      textPrimary: "#ebdbb2",
      textSecondary: "#a89984",
      textTertiary: "#d5d5d5",
      border: "rgba(255,255,255,0.1)",
      neomorphBg: "#17161A",
      shadowDark: "rgba(0, 0, 0, 0.5)",
      shadowLight: "rgba(40, 40, 50, 0.3)",
      neomorphShadowDark: "rgba(0, 0, 0, 0.5)",
      neomorphShadowLight: "rgba(40, 40, 50, 0.35)",
      neomorphCopperGlow: "rgba(198, 143, 85, 0.16)",
      neomorphBorder: "rgba(70, 80, 110, 0.15)",
      aboutBackground: "#3D3D3D",
    };
  }

  return {
    primary: "#7AA0D6",
    primaryDark: "#6389BF",
    primaryDeep: "#4C72A8",
    primaryLight: "#A8C8F0",
    primaryDarker: "#3D5A8C",
    secondary: "#B07A3C",
    accentCopper: "#C68F55",
    qumranText: "#C68F55",
    background: "#E7E7E7",
    surface: "#E9E9E9",
    surfaceElevated: "#ECECEC",
    surfaceLightest: "#F5F5F5",
    textPrimary: "#1a1a1a",
    textSecondary: "#707070",
    textTertiary: "#9a9a9a",
    border: "rgba(0,0,0,0.08)",
    neomorphBg: "#E7E7E7",
    shadowDark: "rgba(190, 190, 200, 0.4)",
    shadowLight: "rgba(255, 255, 255, 0.8)",
    neomorphShadowDark: "rgba(174, 174, 192, 0.75)",
    neomorphShadowLight: "rgba(255, 255, 255, 0.95)",
    neomorphCopperGlow: "rgba(198, 143, 85, 0.16)",
    neomorphBorder: "rgba(200, 200, 210, 0.25)",
    aboutBackground: "#5C5C5C",
  };
};

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  safeArea: {
    top: {
      ios: 44,
      android: 24,
    },
    bottom: {
      ios: 34,
      android: 0,
    },
  },
};

export { getResponsiveLayout, responsiveBreakpoints } from "./services/responsiveLayout";

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const typography = {
  families: {
    hebrewScripture: "Cardo_400Regular",
    hebrewQumran: "DeadSeaScrolls_400Regular",
    hebrewUI: "SuezOne_400Regular",
    latinMeaning: "Jost_400Regular",
    latinUI: "Inter_400Regular",
    latinUIMedium: "Inter_500Medium",
    latinUISemiBold: "Inter_600SemiBold",
    latinUIBold: "Inter_700Bold",
    logo: "SuezOne_400Regular",
  },
  sizes: {
    h1: 28,
    h2: 24,
    h3: 20,
    hebrewVerse: 40,
    hebrewVerseMedium: 35,
    hebrewVerseLarge: 52,
    body: 16,
    bodySmall: 14,
    caption: 12,
  },
  weights: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
  lineHeights: {
    hebrewScripture: 2,
    body: 1.5,
    tight: 1.3,
  },
};

export const getNeumorphShadowStyle = (
  variant: "raised" | "pressed",
  colors?: ReturnType<typeof getColors>,
): ViewStyle => {
  const rtlFactor = I18nManager.isRTL ? -1 : 1;
  const shadowOffset = variant === "raised" ? 10 : 3;
  const shadowRadius = variant === "raised" ? 28 : 10;
  const shadowOpacity = variant === "raised" ? 0.95 : 0.25;
  const shadowColor = colors?.neomorphShadowDark ?? "rgba(174, 174, 192, 0.85)";

  return (
    Platform.select<ViewStyle>({
      ios: {
        shadowColor,
        shadowOffset: { width: shadowOffset * rtlFactor, height: shadowOffset },
        shadowOpacity,
        shadowRadius,
      },
      android: variant === "raised" ? { elevation: 6 } : { elevation: 2 },
      default: {},
    }) ?? {}
  );
};

export const getNeumorphHighlightStyle = (
  colors?: ReturnType<typeof getColors>,
): ViewStyle => {
  const rtlFactor = I18nManager.isRTL ? -1 : 1;
  const shadowColor =
    colors?.neomorphShadowLight ?? "rgba(255, 255, 255, 0.95)";

  return (
    Platform.select<ViewStyle>({
      ios: {
        shadowColor,
        shadowOffset: { width: -10 * rtlFactor, height: -10 },
        shadowOpacity: 0.9,
        shadowRadius: 28,
      },
      android: {},
      default: {},
    }) ?? {}
  );
};
