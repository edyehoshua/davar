export type PositioningState = {
  open: boolean;
  bookStep: boolean;
  query: string;
  viewport: number;
  content: number;
  selectedIndex: number;
  positioned: boolean;
};
export function selectedBookScroll(state: PositioningState): number | null {
  if (!state.open || !state.bookStep || state.query.trim() ||
      state.viewport <= 0 || state.content <= 0 ||
      state.selectedIndex < 0 || state.positioned) return null;
  return state.selectedIndex;
}
export function centeredBookOffset(index: number, rowHeight: number, viewport: number): number {
  return Math.max(0, index * rowHeight - (viewport - rowHeight) / 2);
}
