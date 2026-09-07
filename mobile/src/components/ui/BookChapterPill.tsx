import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import {
  getColors,
  getResponsiveLayout,
  getNeumorphHighlightStyle,
  getNeumorphShadowStyle,
  radii,
  spacing,
  typography,
} from "@/src/theme";
import { useAppStore, type AppState } from "@/src/store/useAppStore";

type BookChapterPillProps = {
  bookLabel: string;
  hebrewLabel: string;
  chapter: number;
  onBookPress?: () => void;
  onChapterPress?: () => void;
};

const stripNikud = (value: string) =>
  value.normalize("NFD").replace(/[\u0591-\u05C7]/g, "");

const createStyles = (colors: ReturnType<typeof getColors>, tablet: boolean) =>
  StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing[3],
    },
    pill: {
      borderRadius: radii.xl,
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[4],
      borderWidth: 0,
      backgroundColor: colors.surface,
      minHeight: tablet ? 48 : 36,
      alignItems: "center",
      justifyContent: "center",
    },
    highlight: {
      ...StyleSheet.absoluteFillObject,
      ...getNeumorphHighlightStyle(colors),
    },
    bookLabel: {
      fontFamily: typography.families.latinUI,
      fontSize: tablet ? typography.sizes.bodySmall : typography.sizes.caption,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: colors.textSecondary,
    },
    bookRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    hebrewLabel: {
      fontFamily: typography.families.hebrewUI,
      fontSize: tablet ? typography.sizes.bodySmall : typography.sizes.caption,
      color: colors.textSecondary,
      marginLeft: spacing[2],
    },
    separator: {
      fontFamily: typography.families.latinUI,
      fontSize: tablet ? typography.sizes.bodySmall : typography.sizes.caption,
      color: colors.textSecondary,
      marginLeft: spacing[2],
      fontWeight: "200",
    },
    chapterLabel: {
      fontFamily: typography.families.latinUI,
      fontSize: tablet ? typography.sizes.bodySmall : typography.sizes.caption,
      letterSpacing: 0.6,
      color: colors.textSecondary,
    },
  });

export const BookChapterPill = ({
  bookLabel,
  hebrewLabel,
  chapter,
  onBookPress,
  onChapterPress,
}: BookChapterPillProps) => {
  const themeMode = useAppStore((state: AppState) => state.themeMode);
  const colors = getColors(themeMode);
  const { width, height } = useWindowDimensions();
  const { isTablet } = getResponsiveLayout(width, height);
  const styles = useMemo(() => createStyles(colors, isTablet), [colors, isTablet]);
  const hebrewLabelPlain = useMemo(
    () => stripNikud(hebrewLabel),
    [hebrewLabel],
  );

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onBookPress}
        style={({ pressed }) => [
          styles.pill,
          pressed
            ? getNeumorphShadowStyle("pressed", colors)
            : getNeumorphShadowStyle("raised", colors),
        ]}
      >
        <View pointerEvents="none" style={styles.highlight} />
        <View pointerEvents="none" style={styles.bookRow}>
          <Text style={styles.bookLabel}>{bookLabel}</Text>
          <Text style={styles.separator}>|</Text>
          <Text style={styles.hebrewLabel}>{hebrewLabelPlain}</Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onChapterPress}
        style={({ pressed }) => [
          styles.pill,
          pressed
            ? getNeumorphShadowStyle("pressed", colors)
            : getNeumorphShadowStyle("raised", colors),
        ]}
      >
        <View pointerEvents="none" style={styles.highlight} />
        <Text style={styles.chapterLabel}>{chapter}</Text>
      </Pressable>
    </View>
  );
};
