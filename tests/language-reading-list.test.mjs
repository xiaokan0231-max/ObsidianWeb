import assert from "node:assert/strict";
import test from "node:test";
import {
  LANGUAGE_READING_LIST_CATEGORIES,
  LANGUAGE_READING_LIST_MARKER,
  LANGUAGE_READING_LIST_TYPE,
  parseLanguageReadingList,
} from "../lib/language-reading-list.ts";

function payload() {
  return { version: 1, description: "原话与建议说法逐项对照。", period: { start: "2026-01-01", end: "2026-01-31" }, items: [{
    id: "expression-01", number: 1, category: "语法", priority: "先改", pattern: "参加に",
    original: "説明会を参加しました。", suggested: "説明会に参加しました。", reminder: "参加的对象接に。",
    sources: [{ path: "20_求職/株式会社テスト/面談_整理稿.md", locator: "q01/s002", label: "株式会社テスト 面談" }],
  }] };
}

function note(data = payload(), extra = {}) {
  return { path: "30_日本語学習/阅读专题/表达清单.md", stat: { ctime: 1, mtime: 1, size: 1 }, tags: [],
    frontmatter: { type: LANGUAGE_READING_LIST_TYPE, title: "表达复习", date: "2026-02-01", publish: false },
    content: `# 备用标题\n\n${LANGUAGE_READING_LIST_MARKER}\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`, ...extra };
}

test("阅读清单保留条目顺序与原话，不把来源引用冒充完整笔记", () => {
  const data = payload();
  data.items.push({ ...structuredClone(data.items[0]), id: "expression-02", number: 2, category: "语体", priority: "顺手改" });
  data.items[0].original = "  説明会を参加しました。  ";
  const input = note(data), before = structuredClone(input);
  const result = parseLanguageReadingList(input);
  assert.equal(result.path, input.path);
  assert.equal(result.title, "表达复习");
  assert.equal(result.date, "2026-02-01");
  assert.equal(result.items[0].original, data.items[0].original);
  assert.deepEqual(result.items.map((entry) => entry.id), ["expression-01", "expression-02"]);
  assert.deepEqual(result.period, data.period);
  assert.deepEqual(result.items[0].sources, data.items[0].sources);
  assert.deepEqual(input, before);
  assert.deepEqual(LANGUAGE_READING_LIST_CATEGORIES, ["语体", "含义", "搭配", "语法"]);
});

test("只认专属类型和标记后紧接的JSON，不从其他代码块猜清单", () => {
  const valid = note();
  for (const input of [
    { ...valid, frontmatter: { ...valid.frontmatter, type: "transcript" } },
    { ...valid, content: valid.content.replace(LANGUAGE_READING_LIST_MARKER, "") },
    { ...valid, content: valid.content.replace("```json", "```javascript") },
    { ...valid, content: valid.content.replace("```json", "一段无关说明\n```json") },
    { ...valid, content: valid.content + `\n${LANGUAGE_READING_LIST_MARKER}` },
    { ...valid, content: valid.content.replace('"version":1', '"version":2') },
    { ...valid, content: valid.content.replace('"version":1', '"version":') },
  ]) assert.equal(parseLanguageReadingList(input), null);
  assert.ok(parseLanguageReadingList({ ...valid, content: valid.content.replaceAll("\n", "\r\n") }));
});

test("任一坏条目、重复身份或空清单均拒绝整篇，不悄悄漏项", () => {
  for (const fields of [
    { id: "" }, { id: " expression-01" }, { number: 0 }, { number: 1.5 }, { number: "1" },
    { category: "未分类" }, { priority: "推荐" }, { pattern: " " }, { original: " " },
    { suggested: "" }, { reminder: null }, { sources: [] }, { sources: null },
  ]) {
    const data = payload();
    data.items.push({ ...structuredClone(data.items[0]), id: "expression-02", number: 2, ...fields });
    assert.equal(parseLanguageReadingList(note(data)), null, JSON.stringify(fields));
  }
  for (const duplicate of [{ id: "expression-01", number: 2 }, { id: "expression-02", number: 1 }]) {
    const data = payload();
    data.items.push({ ...structuredClone(data.items[0]), ...duplicate });
    assert.equal(parseLanguageReadingList(note(data)), null);
  }
  assert.equal(parseLanguageReadingList(note({ ...payload(), items: [] })), null);
});

test("来源只接受可打开的Vault相对Markdown路径与非空定位标签", () => {
  for (const fields of [
    { path: "/tmp/source.md" }, { path: "../source.md" }, { path: "20_求職/../source.md" },
    { path: "20_求職/./source.md" }, { path: "20_求職\\source.md" }, { path: "https://example.test/source.md" },
    { path: "20_求職/source.html" }, { path: "20_求職/source.md\u0000" }, { path: ".obsidian/source.md" },
    { path: "99_系统/模板/source.md" }, { path: "90_归档/source.md" }, { path: "20_求職//source.md" },
    { path: " source.md" }, { locator: " " }, { label: "" }, { available: "false" },
  ]) {
    const data = payload();
    Object.assign(data.items[0].sources[0], fields);
    assert.equal(parseLanguageReadingList(note(data)), null, JSON.stringify(fields));
  }
});

test("覆盖日期有效且有序，标题按元数据、运行时标题、正文依次回落", () => {
  for (const period of [{ start: "2026-02-30", end: "2026-03-01" }, { start: "2026-02-01", end: "2026-01-31" },
    { start: "2026-1-1", end: "2026-01-31" }, { start: "2026-01-01", end: null }]) {
    assert.equal(parseLanguageReadingList(note({ ...payload(), period })), null);
  }
  const source = note();
  const noTitle = { ...source, frontmatter: { type: LANGUAGE_READING_LIST_TYPE }, title: "运行时标题" };
  assert.equal(parseLanguageReadingList(noTitle).title, "运行时标题");
  assert.equal(parseLanguageReadingList(noTitle).date, "");
  delete noTitle.title;
  assert.equal(parseLanguageReadingList(noTitle).title, "备用标题");
  assert.equal(parseLanguageReadingList({ ...source, frontmatter: { ...source.frontmatter, date: "2026-02-30" } }), null);
});

test("语法专题声明自己的目录，保留纠正、可选句式和转写疑点的区别", () => {
  const data = payload();
  data.sections = ["句子结构", "可选句式"];
  Object.assign(data.items[0], { category: "可选句式", finding: "alternative", rule: "AもBも → AとBの両方", boundary: "原句也成立，不增加工作范围。" });
  const result = parseLanguageReadingList(note(data));
  assert.deepEqual(result.sections, data.sections);
  assert.equal(result.items[0].finding, "alternative");
  assert.equal(result.items[0].rule, data.items[0].rule);
  assert.equal(result.items[0].boundary, data.items[0].boundary);
  assert.equal("sections" in parseLanguageReadingList(note()), false);
  for (const fields of [{ finding: "error" }, { finding: null }, { rule: " " }, { boundary: 7 }, { category: "语法" }]) {
    const invalid = structuredClone(data);
    Object.assign(invalid.items[0], fields);
    assert.equal(parseLanguageReadingList(note(invalid)), null);
  }
  for (const sections of [[], ["句子结构", "句子结构"], [" 可选句式"], [null], Array.from({ length: 13 }, (_, i) => `目录${i}`)]) {
    assert.equal(parseLanguageReadingList(note({ ...data, sections })), null);
  }
});
