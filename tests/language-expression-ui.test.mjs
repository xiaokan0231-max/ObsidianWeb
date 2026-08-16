import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readAppCss } from "./css-source.mjs";

test("专项训练作为独立入口接入五种自由表达练习", async () => {
  const [ui, atlas, css] = await Promise.all([
    readFile("app/language-expression-courses.tsx", "utf8"),
    readFile("app/memory-atlas.tsx", "utf8"),
    readAppCss(),
  ]);

  assert.ok(atlas.includes('id: "topics", label: "专项训练"'));
  assert.ok(atlas.includes("<LanguageExpressionCourses"));
  assert.ok(atlas.indexOf('id: "language"') < atlas.indexOf('id: "topics"'));

  for (const mode of ["recall", "collocation", "substitution", "improv", "rewrite"]) {
    assert.ok(ui.includes(`id: "${mode}"`), `缺少 ${mode} 练习`);
  }

  assert.ok(ui.includes('"/api/language/topics/progress"'));
  assert.ok(ui.includes("findLanguageExpressionCourses(notes)"));
  assert.ok(ui.includes("完成一次表达"));
  assert.equal(ui.includes("标记已练并下一条"), false);
  assert.ok(ui.includes("NextQuestionButton"));
  assert.ok(ui.includes("自动把当前题标记为已练"));
  assert.ok(ui.includes("currentSequentialQuestion"));
  assert.ok(ui.includes("上一题"));
  assert.ok(ui.includes("下一题"));
  assert.ok(ui.includes('aria-keyshortcuts="ArrowLeft"'));
  assert.ok(ui.includes('aria-keyshortcuts="ArrowRight"'));
  assert.ok(ui.includes('aria-keyshortcuts="Space"'));
  assert.ok(ui.includes('event.key === "ArrowLeft"'));
  assert.ok(ui.includes('event.key === "ArrowRight"'));
  assert.ok(ui.includes('event.code === "Space"'));
  assert.ok(ui.includes('echo:language-expression-position:v1'));
  assert.ok(ui.includes("window.localStorage.getItem"));
  assert.ok(ui.includes("window.localStorage.setItem"));
  assert.ok(ui.includes("系统会记住上次位置"));
  assert.equal(ui.includes(">下一条 <span>"), false);
  assert.ok(ui.includes('recipe.id === "r04"'));
  assert.ok(ui.includes("还可换用的句型"));
  assert.ok(ui.includes("真实错误"));
  assert.ok(ui.includes("基础解释"));
  assert.ok(ui.includes("更自然"));
  assert.ok(ui.includes("来自面试稿"));
  assert.ok(ui.includes("<Inlines nodes={parseInline(item)} />"));
  assert.ok(ui.includes('completionKey("collocation", chunk.id)'));
  assert.ok(css.includes(".expression-courses-view"));
  assert.ok(css.includes(".expression-improv-draw"));
  assert.ok(css.includes(".expression-learning-note"));
  assert.ok(css.includes(".expression-contrast"));
  assert.ok(css.includes(".expression-mini-columns ruby"));
  assert.ok(css.includes(".expression-question-navigation"));
  assert.ok(css.includes(".expression-reveal-button kbd"));
});

test("专项训练只展示短素材，不接入背诵和自动评价功能", async () => {
  const ui = await readFile("app/language-expression-courses.tsx", "utf8");
  const forbidden = [
    "MediaRecorder",
    "SpeechRecognition",
    "microphone",
    "invokeCodex",
    "setTimeout",
    "标准答案",
    "標準回答",
    "20秒",
    "60秒",
    "已掌握",
    "mastered",
  ];

  for (const term of forbidden) {
    assert.equal(ui.includes(term), false, `专项训练不应包含 ${term}`);
  }
  assert.ok(ui.includes("不背整段台本"));
  assert.ok(ui.includes("是否把建议和本人已有经历区分开"));
});
