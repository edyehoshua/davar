// Bun supplies this runtime module; Expo lint does not resolve it.
// eslint-disable-next-line import/no-unresolved
import { expect, test } from "bun:test";
import { selectedBookScroll, centeredBookOffset, type PositioningState } from "./navigationPositioning";
test("book positioning waits for both readiness signals and an open sheet", () => {
  const state: PositioningState = {open:false,bookStep:true,query:"",viewport:0,content:0,selectedIndex:42,positioned:false};
  expect(selectedBookScroll(state)).toBeNull();
  state.viewport=500; state.content=5000;
  expect(selectedBookScroll(state)).toBeNull();
  state.open=true;
  expect(selectedBookScroll(state)).toBe(42);
  state.positioned=true;
  expect(selectedBookScroll(state)).toBeNull();
  state.open=false;state.positioned=false;
  expect(selectedBookScroll(state)).toBeNull();
  state.open=true;
  expect(selectedBookScroll(state)).toBe(42);
  state.query="John";
  expect(selectedBookScroll(state)).toBeNull();
  state.query="";state.bookStep=false;
  expect(selectedBookScroll(state)).toBeNull();
});
test("fallback centers using actual fixed row geometry and clamps first book", () => {
  expect(centeredBookOffset(0,80,500)).toBe(0);
  expect(centeredBookOffset(42,80,500)).toBe(3150);
});
