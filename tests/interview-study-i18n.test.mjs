import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const source = (id, extra = {}) => ({ id, path: `20_求職/株式会社テスト/${id}.md`, date: "2026-09-01", company: "株式会社テスト", kind: "employer", transcriptType: "asr", scope: "primary", sha256: "a".repeat(64), lineCount: 1000, readCoverage: "full", limitations: ["材料限制中文原文。"], ...extra });
const question = (id, extra = {}) => ({
  id, sourceId: "company", topicId: "introduction", intentId: "summary", intentZh: "原材料意图标题",
  questionText: `経歴${id}を説明してください。`, originalText: `経歴${id}を説明してください。続く回答も残します。`, readableJa: "経歴を説明してください。",
  meaningZh: "中文意译保持原文。", answerScopeZh: "具体回答范围保持原文。", detailsZh: ["限定解释保持中文。"], structureZh: ["结构解释保持中文。"],
  lineStart: 10, lineEnd: 12, locator: "原场定位中文", questionKind: "request", confidence: "high", reviewStatus: "accepted", reviewReasonZh: "审核理由保持中文。", speakerBasisZh: "话者依据保持中文。", uncertaintyZh: "转写局限保持中文。",
  contextBefore: "これまでの経験について聞きます。", contextAfter: "具体的には何をしましたか。",
  duplicateLocators: [{ lineStart: 14, lineEnd: 16 }], annotations: [{ path: "20_求職/株式会社テスト/批注.md", lineStart: 2, lineEnd: 3, excerpt: "本人批注原文。", nature: "self-note" }, { path: "20_求職/株式会社テスト/整理.md", lineStart: 4, lineEnd: 5, excerpt: "整理批注原文。", nature: "ai-note" }], ...extra,
});
function fixture() {
  const questions = Array.from({ length: 21 }, (_, i) => question(`q-${i}`));
  questions[1].continuationOf = questions[0].id;
  questions.push(question("pending", { sourceId: "agency", reviewStatus: "pending", confidence: "low" }));
  questions.push(question("memory", { sourceId: "memory" }));
  const occurrence = q => ({ questionId: q.id, quote: q.questionText, highlights: [{ start: q.questionText.indexOf("説明"), end: q.questionText.indexOf("説明") + 2, text: "説明", role: "core", labelZh: "动作标签保持中文。" }], coreMeaningZh: "核心任务保持中文。", limitsZh: ["范围限定保持中文。"], explanationZh: "本句解释保持中文。" });
  const point = {
    id: "test-point", dimension: "honorific", titleZh: "待核候选", patternJa: "〜を説明してください", meaningZh: "知识点意义保持中文。", readingJa: "せつめい", explanationZh: ["第一条说明保持中文。", "第二条说明保持中文。"], pitfallsZh: ["易混解释保持中文。"],
    occurrences: questions.slice(0, 2).map(occurrence), teachingExamples: [{ ja: "手順を説明してください。", zh: "教学例句解释保持中文。", noteZh: "教学说明保持中文。" }],
    practice: { promptZh: "练习要求保持中文。", answerZh: "参考理由保持中文。", simpleJa: "はい、説明します。", noteZh: "练习补充保持中文。" },
  };
  return {
    collection: { schemaVersion: 1, collectionId: "test-questions", title: "原材料标题不得翻译", phase: "complete", window: { start: "2026-07-03", end: "2026-10-04", timezone: "Asia/Tokyo" }, publishedTopicIds: ["introduction"],
      sources: [source("company"), source("agency", { kind: "agency" }), source("memory", { kind: "platform", transcriptType: "memory", scope: "nonverbatim" }), source("background", { date: "2026-06-25", scope: "background", readCoverage: "pending" })], questions,
      excludedCandidates: [{ id: "excluded", sourceId: "company", lineStart: 30, lineEnd: 31, excerpt: "こちらから質問してもよろしいですか。", reason: "排除依据中文原文。", reviewReasonZh: "排除审核原文。" }], auditNotes: ["覆盖说明保持中文。"] },
    index: { schemaVersion: 1, sourceCollectionId: "test-questions", points: [point], auditNotes: ["语言资料说明保持中文。"] },
  };
}
const noops = { onSelectTopic() {}, onFilterChange() {}, onBack() {}, onOpenWiki() {}, onSelectPoint() {}, onSelectQuestion() {}, onBrowseQuestions() {}, onOpenQuestion() {} };
const walk = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
const button = (tree, label) => { const found = walk(tree).find(node => node.type === "button" && text(node).includes(label)); assert.ok(found, label); return found; };
const render = (View, props) => renderToStaticMarkup(React.createElement(View, { ...noops, ...fixture(), topicId: "all", ...props }));
async function load(file, locale = "ja", direct = false) {
  return loadAppModule(file, { stubs: { "./ui-locale": { useUiLocale: () => ({ locale }) }, ...(direct ? { react: { ...React, useMemo: fn => fn(), useEffect() {} } } : {}) } });
}

test("日语问题集翻译界面、日期、来源与计数，教学解释及来源证据保留原文语言", async () => {
  const { default: View } = await load("app/interview-question-collection.tsx");
  const data = fixture(); const before = JSON.stringify(data);
  const html = render(View, data);
  for (const value of ["面接官の質問集", "対象期間内の確認済み記録 21 件", "実際の言い方 21 種", "意図 1 グループ", "2026年7月3日", "2026年10月4日", "2026年9月1日", "企業", "紹介会社", "プラットフォーム", "全 1,000 行", "本人の注記", "AI の整理注記", "質問・意図の特定", "高め", "ASR 原文の正確さではありません", "対象期間前の参考資料", "追加確認待ち", "ページを選択", "原文（主に中国語）のまま"]) assert.ok(html.includes(value), value);
  assert.match(html, /aria-label="質問の意味別テーマ"/);
  assert.match(html, /<p class="question-japanese" lang="ja">経歴q-0を説明してください。<\/p>/);
  for (const value of ["中文意译保持原文。", "具体回答范围保持原文。", "限定解释保持中文。", "结构解释保持中文。", "审核理由保持中文。", "话者依据保持中文。", "转写局限保持中文。", "材料限制中文原文。", "覆盖说明保持中文。"]) assert.match(html, new RegExp(`lang="zh-CN">${value}`));
  for (const value of ["本人批注原文。", "整理批注原文。"]) assert.match(html, new RegExp(`lang="und">${value}`));
  assert.ok(html.includes("株式会社テスト")); assert.ok(html.includes("L10–12")); assert.ok(html.includes("L14–16"));
  assert.equal(html.includes("表示できません"), false); assert.equal(html.includes("<details open"), false);
  assert.equal(JSON.stringify(data), before);
});

test("日语分页、审核切换及来源筛选保持原始参数；各状态和空态可读", async () => {
  const { default: View } = await load("app/interview-question-collection.tsx", "ja", true);
  const changes = []; const opened = [];
  const props = { ...fixture(), ...noops, topicId: "all", onFilterChange: (...args) => changes.push(args), onSelectTopic: id => opened.push(id) };
  const tree = View(props);
  button(tree, "次のページ").props.onClick();
  button(tree, "確認待ち").props.onClick();
  const kinds = walk(tree).find(node => node.type === "select" && node.props.value === "all");
  kinds.props.onChange({ target: { value: "agency" } });
  button(tree, "自己紹介").props.onClick();
  assert.deepEqual(changes, [[{ page: 2 }], [{ review: "pending" }], [{ sourceKind: "agency" }]]); assert.deepEqual(opened, ["introduction"]);
  const second = render(View, { page: 2 }); assert.ok(second.includes("経歴q-20")); assert.ok(second.includes("表現 21–21 件目を表示")); assert.equal(second.includes("経歴q-0"), false);
  const pending = render(View, { review: "pending" }); assert.ok(pending.includes("確認待ち記録 1 件")); assert.ok(pending.includes("確認が必要な理由：")); assert.ok(pending.includes("低め"));
  const memory = render(View, { review: "memory" }); assert.ok(memory.includes("記憶・振り返り記録 1 件")); assert.ok(memory.includes("記憶に基づく内容・原発言ではありません"));
  const excluded = render(View, { review: "excluded" }); assert.ok(excluded.includes("対象外記録 1 件")); assert.match(excluded, /lang="zh-CN">排除依据中文原文。/);
  const empty = render(View, { query: "no-match" }); assert.ok(empty.includes("この条件に一致する記録はありません")); assert.ok(empty.includes("検索をクリア"));
  const unpublished = render(View, { topicId: "career" }); assert.ok(unpublished.includes("このテーマは未公開です"));
});

test("日语用法页翻译四维目录和练习操作，知识标题、教学内容及精确高亮不被翻译", async () => {
  const { default: View } = await load("app/interview-language-learning.tsx");
  const html = render(View);
  for (const value of ["敬語", "よく使う表現", "文法", "語彙", "言語学習ポイント", "1 個の学習ポイント", "実際の引用 2 件", "1 / 2 件目", "求められること", "文の中での役割", "学習用の整理・実際の質問ではありません", "読み方：", "省略も、参考を直接読むこともできます", "参考と理由を見る", "2026年9月1日", "株式会社テスト", "L10–12"]) assert.ok(html.includes(value), value);
  assert.match(html, /<h2 lang="zh-CN">待核候选<\/h2>/);
  for (const value of ["知识点意义保持中文。", "核心任务保持中文。", "范围限定保持中文。", "本句解释保持中文。", "动作标签保持中文。", "第一条说明保持中文。", "第二条说明保持中文。", "易混解释保持中文。", "教学例句解释保持中文。", "教学说明保持中文。", "练习要求保持中文。", "参考理由保持中文。", "练习补充保持中文。", "语言资料说明保持中文。"]) assert.match(html, new RegExp(`lang="zh-CN">${value}`));
  assert.match(html, /lang="ja">せつめい/); assert.match(html, /lang="ja">手順を説明してください。/);
  assert.match(html, /<p class="language-original" lang="ja">経歴q-0を<strong[^>]+>説明<\/strong>してください。<\/p>/);
  assert.equal(html.includes("<input"), false); assert.equal(html.includes("<textarea"), false); assert.equal(html.includes("<details open"), false); assert.equal(html.includes("表示できません"), false);
});

test("语言界面切换不改引用ID或导航回调，分类空态使用所选语言", async () => {
  let locale = "zh-CN"; const selected = [];
  const { default: View } = await loadAppModule("app/interview-language-learning.tsx", { stubs: { "./ui-locale": { useUiLocale: () => ({ locale }) } } });
  const props = { ...fixture(), ...noops, onSelectQuestion: (...args) => selected.push(args), onSelectPoint: (...args) => selected.push(args) };
  assert.ok(render(View, props).includes("读懂面试里的日语"));
  locale = "ja";
  const tree = View(props); button(tree, "次の引用").props.onClick(); button(tree, "文法").props.onClick();
  assert.deepEqual(selected, [["q-1", "honorific", "test-point"], ["grammar"]]);
  const second = render(View, { ...props, questionId: "q-1" }); assert.ok(second.includes("2 / 2 件目")); assert.ok(second.includes("経歴q-1"));
  const empty = render(View, { ...props, dimensionId: "grammar" }); assert.ok(empty.includes("この分類の学習ポイントはまだありません")); assert.equal(empty.includes("language-real-example"), false);
  locale = "zh-CN"; assert.ok(render(View, { ...props, questionId: "q-1" }).includes("第 2 / 2 条"));
});
