import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const tour = await loadAppModule("app/feedback-tour.tsx");

test("分步引导使用实际页面目标，原文点评先介绍可见按钮，再介绍选句", () => {
  const { TEACHER_TOUR_STEPS: steps, TEACHER_TOUR_STORAGE_KEY: key } = tour;
  assert.equal(key, "teacher-tour:seen:v1");
  assert.equal(steps.reader[0].target, '[data-tour="paragraph-comment"]');
  assert.equal(steps.reader[1].target, '[data-feedback-text]');
  assert.ok(steps.library.some(step => step.target === '[data-tour="open-transcript"]'));
  assert.ok(steps.feedback.some(step => step.target.includes("feedback-login")));
  for (const mode of Object.values(steps)) for (const step of mode) {
    assert.ok(step.title[0] && step.title[1] && step.text[0] && step.text[1]);
    assert.doesNotMatch(step.text[0], /スレッド|コンテキスト|アンカー/);
  }
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
