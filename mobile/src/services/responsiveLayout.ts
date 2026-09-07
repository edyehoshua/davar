/** Window-based sizing also adapts to iPad split view and Android multi-window. */
export const responsiveBreakpoints = { tablet: 768, largeTablet: 1024 } as const;

export function getResponsiveLayout(width: number, height = width) {
  const isTablet = width >= responsiveBreakpoints.tablet && height >= 600;
  const isLargeTablet = isTablet && width >= responsiveBreakpoints.largeTablet;
  const landscape = width > height;
  const horizontalPadding = isLargeTablet ? 48 : isTablet ? 32 : 24;
  const contentMaxWidth = isTablet ? (landscape ? 1080 : 900) : width;
  const navigationWidth = Math.min(width, isTablet ? (landscape ? 880 : 720) : width);
  const gridColumns = isTablet ? (landscape ? 10 : 8) : Math.max(3, Math.min(5, Math.floor((width - 48 + 12) / 64)));
  return {
    isTablet, isLargeTablet, landscape, horizontalPadding, contentMaxWidth,
    navigationWidth, gridColumns,
    modalWidth: isTablet ? Math.min(width * 0.72, 760) : Math.min(width - 48, 420),
    controlHeight: isTablet ? 48 : 36,
    textScale: isTablet ? 1.1 : 1,
    chapterGap: isTablet ? 40 : 32,
  };
}
