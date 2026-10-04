import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isTypingTarget } from "../lib/keyboard.ts";

test("输入场景判定：input/textarea/select 与 contentEditable 都算，其它元素和空目标不算", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "textarea" }), true);
  assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: false }), false);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
  assert.equal(isTypingTarget({}), false);
});

test("全仓只有一份判定；全局 R 让位给 3D 舞台已处理过的按键", async () => {
  const files = ["app/prep-search.tsx", "app/three-stage-chrome.tsx", "app/language-expression-courses.tsx", "app/jobs-view.tsx", "app/jobs-decision.tsx", "app/interview-review.tsx", "app/language-quick-drill.tsx"];
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /instanceof HTMLInputElement|\["INPUT", "TEXTAREA", "SELECT"\]|\(INPUT\|TEXTAREA\|SELECT\)/, `${file} 不再自带一份输入场景判定`);
    assert.match(source, /@\/lib\/keyboard/, `${file} 改用 lib/keyboard`);
  }
  const atlas = await readFile(new URL("../app/memory-atlas.tsx", import.meta.url), "utf8");
  assert.match(atlas, /event\.key\.toLowerCase\(\) === "r" &&[\s\S]{0,200}!event\.defaultPrevented &&/, "全局 R 检查 defaultPrevented");
  assert.doesNotMatch(atlas, /"calendar" : "calendar"/, "顶栏的死三元已删");
});
