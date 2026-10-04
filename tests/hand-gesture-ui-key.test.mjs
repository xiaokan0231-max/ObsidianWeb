import assert from "node:assert/strict";
import test from "node:test";
import { handUiFrameKey } from "../lib/hand-gesture.mjs";

function hand(overrides = {}) {
  return {
    id: "hand-1",
    role: "primary",
    visible: true,
    grabbed: false,
    pinching: false,
    pinchConfident: true,
    gesture: "Open_Palm",
    x: 0.4,
    y: 0.5,
    pinchProgress: 0,
    rawPinchRatio: 0.6,
    ...overrides,
  };
}

function frame(overrides = {}) {
  return {
    mode: "single-aim",
    primaryHandId: "hand-1",
    transform: null,
    hands: [hand()],
    diagnostics: {
      pinchRatio: 0.6,
      closeThreshold: 0.4,
      pinchPose: false,
      gesture: "Open_Palm",
      suppressed: false,
      targetKind: "space",
      lastEvent: "none",
      travel: 0.01,
      moveThreshold: 0.08,
    },
    ...overrides,
  };
}

test("连续量（位置、捏合进度、读数）变化不改键，React 不必重渲染", () => {
  const base = handUiFrameKey(frame());
  assert.equal(
    handUiFrameKey(frame({
      hands: [hand({ x: 0.7, y: 0.2, pinchProgress: 0.6, rawPinchRatio: 0.52 })],
      diagnostics: { ...frame().diagnostics, pinchRatio: 0.55, travel: 0.04, moveThreshold: 0.09 },
    })),
    base,
  );
});

test("离散状态（模式、手数、捏合／抓取、诊断判定）变化才改键", () => {
  const base = handUiFrameKey(frame());
  assert.notEqual(handUiFrameKey(frame({ mode: "single-pinch" })), base);
  assert.notEqual(handUiFrameKey(frame({ hands: [hand({ pinching: true })] })), base);
  assert.notEqual(handUiFrameKey(frame({ hands: [hand({ grabbed: true })] })), base);
  assert.notEqual(handUiFrameKey(frame({ hands: [hand(), hand({ id: "hand-2", role: "secondary" })] })), base);
  assert.notEqual(
    handUiFrameKey(frame({ diagnostics: { ...frame().diagnostics, pinchRatio: 0.3 } })),
    base,
    "捏合度跨过触发线时诊断行要换颜色",
  );
  assert.notEqual(handUiFrameKey(frame({ hands: [hand({ pinchConfident: false })] })), base, "读数要从「触发」换成「学习中」");
  assert.equal(handUiFrameKey(null), "none");
});

test("「双手分开一点」提示跟着两只手的距离进键", () => {
  const close = frame({
    hands: [
      hand({ pinching: true, x: 0.5, y: 0.5 }),
      hand({ id: "hand-2", role: "secondary", pinching: true, x: 0.55, y: 0.5 }),
    ],
  });
  const apart = frame({
    hands: [
      hand({ pinching: true, x: 0.3, y: 0.5 }),
      hand({ id: "hand-2", role: "secondary", pinching: true, x: 0.7, y: 0.5 }),
    ],
  });
  assert.notEqual(handUiFrameKey(close, 0.12), handUiFrameKey(apart, 0.12));
});
