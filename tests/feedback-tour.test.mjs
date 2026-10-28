import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const tour = await loadAppModule("app/feedback-tour.tsx");

test("分步引导使用实际页面目标，原文点评先介绍可见按钮，再介绍选句", () => {
  const { TEACHER_TOUR_STEPS: steps, TEACHER_TOUR_STORAGE_KEY: key } = tour;
  assert.equal(key, "teacher-tour:seen:v3");
  assert.equal(steps.reader[0].target, '[data-tour="paragraph-comment"]');
  assert.equal(steps.reader[1].target, '[data-feedback-text]');
  assert.deepEqual(steps.library.map(step => step.target), ['[data-tour="reading-choice"]', '[data-tour="reading-preview"]', '[data-tour="all-materials"]', '[data-tour="feedback-entry"]']);
  assert.match(steps.library[0].text[0], /最近の面接、最終面接、ほかの面接/);
  assert.ok(steps.feedback.some(step => step.target.includes("feedback-login")));
  for (const mode of Object.values(steps)) for (const step of mode.flatMap(step => step.fallback ? [step, step.fallback] : [step])) {
    assert.ok(step.title[0] && step.title[1] && step.text[0] && step.text[1]);
    assert.doesNotMatch(step.text[0], /スレッド|コンテキスト|アンカー/);
  }
});

test("有真实摘录时引导直接定位原问句，没有摘录时只介绍实际阅读按钮", () => {
  const step = tour.TEACHER_TOUR_STEPS.library[1];
  const preview = tour.teacherTourStepVariant(step, selector => selector === '[data-tour="reading-preview"]' || selector === '[data-tour="start-reading"]');
  assert.equal(preview.target, '[data-tour="reading-preview"]');
  assert.match(preview.text[0], /その部分へ移動/);

  const fallback = tour.teacherTourStepVariant(step, selector => selector === '[data-tour="start-reading"]');
  assert.equal(fallback.target, '[data-tour="start-reading"]');
  assert.match(fallback.text[0], /このボタンから原稿を開けます/);
  assert.doesNotMatch(fallback.text[0], /質問を一部表示|その部分へ移動/);
  assert.equal(tour.teacherTourStepVariant(step, () => false), null);
});

test("大型资料区域的聚焦框受可见范围限制，不把超长列表全部照亮", () => {
  const rect = tour.teacherTourSpotlight({ left: -15, top: 180, width: 1600, height: 18000 }, { width: 1280, height: 900 });
  assert.equal(rect.left, 12);
  assert.equal(rect.height, 244);
  assert.ok(rect.left + rect.width <= 1280 - 12);
  assert.ok(rect.top + rect.height <= 900 - 12);
});

test("浮层优先放在按钮旁，空间不足时放在上方且不覆盖被介绍的按钮", () => {
  const viewport = { width: 1280, height: 900 };
  const card = { width: 376, height: 350 };
  const first = { left: 30, top: 200, width: 180, height: 44 };
  const right = tour.teacherTourPlacement(first, viewport, card);
  assert.equal(right.side, "right");
  assert.ok(right.left > first.left + first.width);
  const last = { left: 24, top: 700, width: 1232, height: 60 };
  const above = tour.teacherTourPlacement(last, viewport, card);
  assert.equal(above.side, "top");
  assert.ok(above.top + card.height < last.top);
  for (const placement of [right, above]) {
    assert.ok(placement.left >= 0 && placement.top >= 0);
    assert.ok(placement.left + card.width <= viewport.width);
    assert.ok(placement.top + card.height <= viewport.height);
  }
});

test("实际浮层变高时，宽入口先移向顶部以便在下方完整介绍", () => {
  const viewport = { width: 1280, height: 720 };
  const entry = { left: 24, top: 367, width: 1232, height: 96 };
  assert.equal(tour.teacherTourNeedsStartScroll(entry, viewport, { width: 376, height: 300 }), false);
  assert.equal(tour.teacherTourNeedsStartScroll(entry, viewport, { width: 376, height: 434 }), true);
  const afterScroll = { ...entry, top: 80 };
  const placement = tour.teacherTourPlacement(afterScroll, viewport, { width: 376, height: 434 });
  assert.equal(placement.side, "bottom");
  assert.ok(placement.top >= afterScroll.top + afterScroll.height);
  assert.ok(placement.top + 434 <= viewport.height - 24);
  assert.equal(tour.teacherTourNeedsStartScroll(afterScroll, viewport, { width: 376, height: 434 }), false);
});

test("首次引导腾出空间后，后续实际尺寸测量不会把可见入口重新居中", () => {
  const viewport = { width: 1280, height: 720 };
  const entry = { left: 42, top: 375, width: 1196, height: 80 };
  assert.equal(tour.teacherTourScrollAlignment(entry, viewport, { width: 376, height: 434 }), "start");
  const atReadingTop = { ...entry, top: 72 };
  for (const height of [462, 434, 425]) {
    assert.equal(tour.teacherTourScrollAlignment(atReadingTop, viewport, { width: 376, height }), null);
    const placement = tour.teacherTourPlacement(tour.teacherTourSpotlight(atReadingTop, viewport), viewport, { width: 376, height });
    assert.equal(placement.side, "bottom");
    assert.ok(placement.top >= atReadingTop.top + atReadingTop.height);
  }
  assert.equal(tour.teacherTourScrollAlignment({ left: 42, top: -20, width: 200, height: 80 }, viewport, { width: 376, height: 434 }), "nearest");
});

test("窗口无法容纳目标与浮层时不反复尝试腾出空间", () => {
  const viewport = { width: 1280, height: 600 };
  const entry = { left: 24, top: 250, width: 1232, height: 244 };
  assert.equal(tour.teacherTourNeedsStartScroll(entry, viewport, { width: 376, height: 434 }), false);
  assert.equal(tour.teacherTourNeedsStartScroll({ left: 30, top: 200, width: 180, height: 44 }, viewport, { width: 376, height: 350 }), false);
});

test("开始和完成提示居中，避免在页面底部留下说明区块", () => {
  assert.deepEqual(tour.teacherTourPlacement(null, { width: 1440, height: 1000 }, { width: 376, height: 380 }), { left: 532, top: 310, side: "center" });
});
