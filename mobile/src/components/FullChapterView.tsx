import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { FlatList, View, type StyleProp, type ViewStyle } from "react-native";
import type { DisplayVerse } from "@/src/services/scripture";

import { groupChapterVerses } from "@/src/services/chapterPositioning";

type Props = {
  verses: DisplayVerse[];
  locationKey: string;
  targetId: string;
  offsets: Map<string, number>;
  renderVerse: (verse: DisplayVerse) => ReactNode;
  renderFlow?: (verses: DisplayVerse[]) => ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  gap: number;
  topPadding: number;
  measurements: Map<string, Map<number, number>>;
};

/** Bound native interactive text size as well as React work for long chapters. */
export function FullChapterView(props: Props) {
  const { locationKey, targetId, renderFlow } = props;
  // A target change is an explicit navigation; remount to position it reliably.
  return <ChapterList key={`${locationKey}:${renderFlow ? "flow" : "cards"}:${targetId}`} {...props} />;
}

function ChapterList({ verses, locationKey, targetId, offsets, renderVerse, renderFlow, style, contentStyle, gap, topPadding, measurements }: Props) {
  const list = useRef<FlatList<DisplayVerse[]>>(null);
  const modeKey = `${locationKey}:${renderFlow ? "flow" : "cards"}`;
  const continuous = !!renderFlow;
  const rows = useMemo(() => groupChapterVerses(verses, continuous), [verses, continuous]);
  const heights = useMemo(() => {
    const existing = measurements.get(modeKey) ?? new Map<number, number>();
    measurements.set(modeKey, existing);
    return existing;
  }, [measurements, modeKey]);
  const targetIndex = Math.max(0, rows.findIndex(row => row.some(v => v.id === targetId)));
  const pendingIndex = useRef<number | null>(null);
  const retryCount = useRef(0);
  const restored = useRef(false);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const restore = useCallback(() => {
    if (restored.current || !rows.length) return;
    const saved = offsets.get(`${modeKey}:${targetId}`);
    // VirtualizedList measures its initial batch first. Restoring before enough
    // content exists clamps the saved offset to zero.
    if (saved !== undefined && saved > 0 && contentHeight.current < saved + viewportHeight.current) return;
    restored.current = true;
    if (saved !== undefined) list.current?.scrollToOffset({ offset: saved, animated: false });
    else if (targetIndex > 0) list.current?.scrollToIndex({ index: targetIndex, animated: false });
  }, [rows.length, offsets, modeKey, targetId, targetIndex]);

  return <FlatList ref={list} data={rows} style={style}
    contentContainerStyle={[contentStyle, { rowGap: renderFlow ? 0 : gap }]}
    keyExtractor={row => row[0].id}
    renderItem={({ item, index }) => <View onLayout={e => heights.set(index, e.nativeEvent.layout.height)}>
      {renderFlow ? renderFlow(item) : renderVerse(item[0])}
    </View>}
    getItemLayout={(_, index) => {
      const average = heights.size ? [...heights.values()].reduce((a,b) => a+b,0) / heights.size : 400;
      let offset = topPadding;
      for (let i = 0; i < index; i++) offset += (heights.get(i) ?? average) + (continuous ? 0 : gap);
      return { index, offset, length: heights.get(index) ?? average };
    }}
    initialNumToRender={renderFlow ? 1 : 3} maxToRenderPerBatch={2} windowSize={3}
    onContentSizeChange={(_, height) => { contentHeight.current = height; restore(); }}
    onLayout={e => { viewportHeight.current = e.nativeEvent.layout.height; restore(); }}
    scrollEventThrottle={100}
    onScroll={e => { if (restored.current) offsets.set(`${modeKey}:${targetId}`, e.nativeEvent.contentOffset.y); }}
    onScrollToIndexFailed={({ index, averageItemLength }) => {
      if (retryCount.current >= 3) return;
      retryCount.current += 1;
      pendingIndex.current = index;
      list.current?.scrollToOffset({ offset: index * (averageItemLength + (renderFlow ? 0 : gap)), animated: false });
    }}
    onViewableItemsChanged={() => {
      const index = pendingIndex.current;
      if (index === null) return;
      pendingIndex.current = null;
      list.current?.scrollToIndex({ index, animated: false });
    }}
  />;
}
