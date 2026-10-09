import assert from "node:assert/strict";
import test from "node:test";
import { findLanguageTextbookChapters, languageChapterHref, languageTextbookSelection, parseLanguageTextbookChapter } from "../lib/language-textbook.ts";
import { noteInVaultScope } from "../lib/vault-scope.ts";
import { parseTextbookModule } from "../lib/language-textbook-module.ts";

const note = (id = "question-focus", order = 10, extra = {}) => ({
  path: `20_求職/_素材/${id}.md`, tags: [], stat: { ctime: 1, mtime: 1, size: 1 },
  frontmatter: { type: "material", material_kind: "language-textbook-chapter", chapter_id: id, chapter_order: order,
    chapter_group: "语法与助词", title: "が与は：主语和话题", chapter_summary: "先认识两种作用", study_minutes: 18, ...extra },
  content: "# が与は：主语和话题\n\n## 知识点\n\n原文与例句直接可读。",
});

test("学习章节读固定ID与教学元数据，只在training载入指定材料", () => {
  const source = note("particles", 20, { exercise_course_id: "practice-a" });
  const chapter = parseLanguageTextbookChapter(source);
  assert.equal(chapter.chapterId, "particles");
  assert.equal(chapter.exerciseCourseId, "practice-a");
  assert.equal(chapter.studyMinutes, 18);
  assert.equal(chapter.note, source);
  assert.equal(noteInVaultScope(source, "training"), true);
  assert.equal(noteInVaultScope(source, "jobs"), false);
  assert.equal(noteInVaultScope(note("a", 1, { material_kind: "unrelated" }), "training"), false);
  for (const fields of [{ chapter_id: "../bad" }, { chapter_order: "NaN" }, { chapter_order: null }, { title: "" }, { type: "transcript" }]) {
    assert.equal(parseLanguageTextbookChapter(note("bad", 1, fields)), null);
  }
});

test("章节排序稳定，重复ID不悄悄打开别章，不修改原数组", () => {
  const sources = [note("second", 20), note("duplicate", 30), note("first", 10), note("duplicate", 40)];
  const original = structuredClone(sources);
  assert.deepEqual(findLanguageTextbookChapters(sources).map((chapter) => chapter.chapterId), ["first", "second"]);
  assert.deepEqual(sources, original);
});

test("默认首章可读，章节URL可恢复，所有旧course链接优先旧课", () => {
  const chapters = findLanguageTextbookChapters([note("second", 20), note("first", 10)]);
  assert.equal(languageTextbookSelection(chapters, "", "").chapter.chapterId, "first");
  assert.equal(languageTextbookSelection(chapters, "second", "").chapter.chapterId, "second");
  assert.equal(languageTextbookSelection(chapters, "missing", "").chapter.chapterId, "first");
  assert.equal(languageTextbookSelection(chapters, "second", "legacy-course").mode, "practice");
  assert.equal(languageTextbookSelection(chapters, "second", "removed-course").mode, "practice");
  assert.equal(languageTextbookSelection([], "", "").mode, "practice");
});

test("章节导航清除旧练习与来源浮层参数，保留其他页面参数", () => {
  const href = languageChapterHref("?chapter=first&course=old&note=source.md&section=旧节&knowledge=old-point&lessonView=source&ui=ja", "second");
  const url = new URL(href, "http://localhost:3000");
  assert.equal(url.pathname, "/training/topics");
  assert.equal(url.searchParams.get("chapter"), "second");
  assert.equal(url.searchParams.get("ui"), "ja");
  for (const key of ["course", "note", "section", "knowledge", "lessonView"]) assert.equal(url.searchParams.has(key), false);
});

const point = id => ({id,titleZh:"说明负责范围",patternJa:"設計を担当する",meaningZh:"负责设计",explanationZh:["由动词决定助词。"],
  examples:[{ja:"設計を担当しました。",zh:"负责设计。"}],contrasts:[{leftJa:"設計を担当しました。",leftZh:"负责设计",rightJa:"設計について説明しました。",rightZh:"说明设计",explanationZh:"动作不同。"}],cautionZh:"保留真实范围。"});
const learningData = () => ({summaryZh:"先找动作。",points:[point("object"),point("role")],recapZh:["助词跟着动作走。"]});

test("模块保留语言内容及证据两轴，错误元数据回落课文而不猜用户错误", () => {
  const value=learningData();
  value.points[0].source={originalJa:"設計を担当して",revisionJa:"設計を担当しました。",explanationZh:"整理成独立句。",reliabilityZh:"仅转写，未核原音。",natureZh:"原句可接受。",refs:["[[20_求職/株式会社テスト/原稿|原稿]]"]};
  assert.equal(parseTextbookModule(value),value);
  assert.equal(parseLanguageTextbookChapter(note("module",10,{learning_module:value})).module,value);
  for (const bad of [{...value,points:[value.points[0]]},{...value,points:[value.points[0],value.points[0]]},{...value,points:[{...value.points[0],source:{...value.points[0].source,reliabilityZh:""}},value.points[1]]}]) {
    assert.equal(parseTextbookModule(bad),undefined);
    const chapter=parseLanguageTextbookChapter(note("fallback",10,{learning_module:bad}));
    assert.ok(chapter);
    assert.equal(chapter.module,undefined);
    assert.match(chapter.note.content,/原文与例句/);
  }
});

test("专业教材可附读音、搭配和口语层次，旧教材仍直接可读", () => {
  const value = learningData();
  assert.equal(parseTextbookModule(value), value);
  value.points[0].readingJa = "たんとうする";
  value.points[0].collocationsJa = ["設計を担当する", "条件を確認する"];
  value.points[0].examples[0].labelZh = "最小口语";
  assert.equal(parseTextbookModule(value), value);
  for (const fields of [{ readingJa: "" }, { collocationsJa: [] }, { collocationsJa: ["有効", ""] },
    { examples: [{ ja: "確認します。", zh: "核对。", labelZh: "" }] }]) {
    assert.equal(parseTextbookModule({ ...value, points: [{ ...value.points[0], ...fields }, value.points[1]] }), undefined);
  }
});

test("原场对方用语标明话者，不冒充本人表达", () => {
  const value = learningData();
  value.points[0].source = { speaker: "interviewer", originalJa: "ご検討ください。", revisionJa: "ご検討ください。",
    explanationZh: "对方邀请考虑。", reliabilityZh: "仅转写。", natureZh: "对方用语；不诊断本人错误。", refs: ["[[株式会社テスト/原稿]]"] };
  assert.equal(parseTextbookModule(value), value);
  value.points[0].source.speaker = "unknown";
  assert.equal(parseTextbookModule(value), undefined);
});
