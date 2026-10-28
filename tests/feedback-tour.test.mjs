import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const tour = await loadAppModule("app/feedback-tour.tsx");

test("分步引导使用实际页面目标，原文点评先介绍可见按钮，再介绍选句", () => {
  const { TEACHER_TOUR_STEPS: steps, TEACHER_TOUR_STORAGE_KEY: key } = tour;
  assert.equal(key, "teacher-tour:seen:v2");
  assert.equal(steps.reader[0].target, '[data-tour="paragraph-comment"]');
  assert.equal(steps.reader[1].target, '[data-feedback-text]');
  assert.deepEqual(steps.library.map(step => step.target), ['[data-tour="reading-start"]', '[data-tour="reading-preview"]', '[data-tour="all-materials"]', '[data-tour="feedback-entry"]']);
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

test("开始和完成提示居中，避免在页面底部留下说明区块", () => {
  assert.deepEqual(tour.teacherTourPlacement(null, { width: 1440, height: 1000 }, { width: 376, height: 380 }), { left: 532, top: 310, side: "center" });
});
