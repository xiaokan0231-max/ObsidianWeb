import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { SPECIAL_MODULES, specialTrainingRoute } from "../lib/special-training-navigation.ts";
import { textbookPositionKey } from "../lib/language-textbook-position.ts";

const point = (id, title) => ({
  id, titleZh: title, patternJa: "条件を確認する", meaningZh: "确认条件",
  explanationZh: ["先说明要确认的对象。"], examples: [{ ja: "条件を確認します。", zh: "我确认一下条件。" }],
  contrasts: [{ leftJa: "条件を確認します。", leftZh: "确认条件", rightJa: "条件を説明します。", rightZh: "说明条件", explanationZh: "动作不同。" }],
  cautionZh: "教学例句不代表本人经历。",
});
const chapter = (id, order, title, body) => ({
  path: `20_求職/_素材/${id}.md`, tags: [], stat: { ctime: 1, mtime: 1, size: 1 },
  frontmatter: {
    type: "material", material_kind: "language-textbook-chapter", chapter_id: id, chapter_order: order,
    title, chapter_group: "工作表达", chapter_summary: "学习如何说明工作。", study_minutes: 18,
    learning_module: { summaryZh: "区分动作。", points: [point("object", "先说动作对象"), point("role", "再说负责角色")], recapZh: ["只陈述真实事实。"] },
  },
  content: `# ${title}\n\n${body}`,
});
const first = chapter("test-first", 10, "测试章节一：动作与对象", "FIRST_CHAPTER_PRIVATE_BODY_SENTINEL");
const second = chapter("test-second", 20, "测试章节二：顺序与理由", "SECOND_CHAPTER_PRIVATE_BODY_SENTINEL");
const lesson = {
  durationMinutes: 20, introZh: "先理解提问，再说自己的想法。",
  evidence: [{ kind: "transcript", path: "20_求職/株式会社テスト/原稿.md", locator: "L1", excerpt: "経歴を教えてください。" }],
  observationsZh: ["测试素材。"], hypotheses: [{ kind: "asr-uncertain", confidence: "low", detailZh: "测试素材不诊断本人。" }], counterexamplesZh: ["不能据此推定个人能力。"],
  steps: ["listen", "verify", "stance", "respond", "repair", "transfer", "reflect"].map((kind, i) => ({
    id: `step-${i}`, kind, titleZh: `测试步骤 ${i + 1}`, instructionZh: "先自行理解。",
    ...(kind === "listen" ? { promptJa: "経歴を教えてください。" } : {}), expectedZh: ["被问到的内容。"], hintsZh: [], examplesJa: [],
  })),
};
const course = {
  path: "20_求職/_素材/测试情境.md", tags: [], stat: { ctime: 1, mtime: 1, size: 1 },
  frontmatter: { type: "material", material_kind: "language-expression-course", schema_version: 2, course_id: "test-scenario", title: "测试情境：听清后回应", topic: "测试练习" },
  content: `<!-- language-scenario-json:start -->\n\`\`\`json\n${JSON.stringify(lesson)}\n\`\`\`\n<!-- language-scenario-json:end -->`,
};
const source = { id: "test-source", path: "20_求職/株式会社テスト/原稿.md", date: "2026-09-01", company: "株式会社テスト", kind: "employer", transcriptType: "asr", scope: "primary", sha256: "a".repeat(64), lineCount: 10, readCoverage: "full", limitations: ["虚构测试材料。"] };
const question = {
  id: "test-question", sourceId: source.id, topicId: "introduction", intentId: "summary", intentZh: "介绍经历", originalText: "経歴を教えてください。", meaningZh: "请介绍经历。", answerScopeZh: "介绍被问到的经历。", detailsZh: [], structureZh: [], lineStart: 1, lineEnd: 1,
  questionKind: "request", confidence: "high", reviewStatus: "accepted", reviewReasonZh: "虚构已审核测试记录。", speakerBasisZh: "测试指定话者。", annotations: [],
};
const languagePoint = {
  id: "test-request", dimension: "honorific", titleZh: "测试用法：请对方说明", patternJa: "教えてください", meaningZh: "请说明。", explanationZh: ["动作由被请求的人完成。"], pitfallsZh: ["先找说明对象。"],
  occurrences: [{ questionId: question.id, quote: question.originalText, highlights: [{ start: 0, end: 2, text: "経歴", labelZh: "说明对象", role: "core" }], coreMeaningZh: "说明经历。", limitsZh: ["不追加未被问到的内容。"], explanationZh: "请求说明经历。" }],
  practice: { promptZh: "要介绍什么？", answerZh: "经历。", noteZh: "教学问题，不代填个人事实。" },
};
const collection = {
  schemaVersion: 1, collectionId: "test-questions", title: "测试真实提问集", window: { start: "2026-07-03", end: "2026-10-04", timezone: "Asia/Tokyo" }, phase: "complete", publishedTopicIds: ["introduction"], sources: [source],
  questions: [question, { ...question, id: "test-pending", originalText: "確認…", confidence: "low", reviewStatus: "pending", reviewReasonZh: "原句待核对。" }], excludedCandidates: [], auditNotes: [],
  languageIndex: { schemaVersion: 1, sourceCollectionId: "test-questions", points: [languagePoint], auditNotes: [] },
};
const questionNote = {
  path: "20_求職/_素材/测试提问集.md", tags: [], stat: { ctime: 1, mtime: 1, size: 1 },
  frontmatter: { type: "material", material_kind: "interview-question-collection", collection_id: collection.collectionId },
  content: `<!-- interview-questions-json:start -->\n\`\`\`json\n${JSON.stringify(collection)}\n\`\`\`\n<!-- interview-questions-json:end -->`,
};
const notes = [second, course, questionNote, first];
const walk = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
const textOf = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(textOf).join("") : value?.props ? textOf(value.props.children) : "";

// 只展开被测导航组件；详情工作台由探针代替，能直接发现列表是否误挂了工作台。
function surface(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(surface);
  const fn = typeof value.type === "function" ? value.type : value.type?.type;
  if (typeof fn === "function" && (/^SpecialTraining/.test(fn.name) || fn.name === "TrainingLink")) return surface(fn(value.props));
  return value.props ? { ...value, props: { ...value.props, children: surface(value.props.children) } } : value;
}
function button(tree, label) {
  const found = walk(surface(tree)).find(node => node.type === "button" && textOf(node.props.children).includes(label));
  assert.ok(found, `缺少按钮：${label}`);
  return found;
}
function moduleButton(tree, id) {
  const descriptor = SPECIAL_MODULES.find(item => item.id === id);
  return link(tree, descriptor.title);
}
function link(tree, label) {
  const found = walk(surface(tree)).find(node => node.type === "a" && textOf(node.props.children).includes(label));
  assert.ok(found, `缺少链接：${label}`);
  return found;
}
function click(node) {
  node.props.onClick({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault() {} });
}
function inBrowser(browser, run) {
  // lib/ 的真实 ESM 读取 global window；app/ 加载器的注入只覆盖组件模块。
  const previous = globalThis.window;
  globalThis.window = browser;
  try { return run(); }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
}
function createBrowser(search = "", initialStorage = {}) {
  const saved = new Map(Object.entries(initialStorage));
  const writes = [];
  const entries = [`http://localhost:3000/training/topics${search}`];
  let cursor = 0;
  const browser = {
    location: new URL(entries[0]),
    localStorage: { getItem: key => saved.get(key) ?? null, setItem(key, value) { writes.push([key, value]); saved.set(key, value); } },
    dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
    history: {
      state: { preserved: true },
      pushState(state, _title, href) { this.state = state; entries.splice(cursor + 1); entries.push(new URL(href, browser.location).href); cursor += 1; browser.location = new URL(entries[cursor]); },
      replaceState(state, _title, href) { this.state = state; entries[cursor] = new URL(href, browser.location).href; browser.location = new URL(entries[cursor]); },
      back() { if (cursor > 0) browser.location = new URL(entries[--cursor]); },
      forward() { if (cursor + 1 < entries.length) browser.location = new URL(entries[++cursor]); },
    },
  };
  return { browser, saved, writes, entries };
}
async function harness(search = "", options = {}) {
  const state = options.state ?? createBrowser(search, options.storage);
  const mounts = { textbook: 0, scenario: 0, questions: 0, language: 0 };
  const network = [];
  const leaf = (kind, render) => props => { mounts[kind] += 1; return render(props); };
  const { default: Page } = await loadAppModule("app/language-expression-courses.tsx", {
    globals: { window: state.browser, localStorage: state.browser.localStorage, fetch: (...args) => { network.push(args); throw new Error("目录导航不能发起写入请求"); } },
    stubs: {
      react: { ...React, useMemo: fn => fn(), useCallback: fn => fn, useSyncExternalStore: (subscribe, snapshot) => { const unsubscribe = subscribe(() => {}); const value = snapshot(); unsubscribe?.(); return value; }, useEffect() {}, useState: initial => [typeof initial === "function" ? initial() : initial, () => {}], useRef: initial => ({ current: initial }) },
      "./ui-locale": { useUiLocale: () => ({ locale: "zh" }) },
      "./language-textbook": { default: leaf("textbook", props => React.createElement("article", { "data-test-leaf": "textbook" }, props.chapter.note.content)) },
      "./language-scenario-course": { default: leaf("scenario", props => React.createElement("article", { "data-test-leaf": "scenario" }, props.course.title, React.createElement("textarea", { defaultValue: "SCENARIO_ANSWER_SENTINEL" }))) },
      "./interview-question-collection": { default: leaf("questions", () => React.createElement("article", { "data-test-leaf": "questions" }, "QUESTION_DETAIL_SENTINEL")) },
      "./interview-language-learning": { default: leaf("language", () => React.createElement("article", { "data-test-leaf": "language" }, "LANGUAGE_DETAIL_SENTINEL")) },
      "@/lib/client-api": { postJson: (...args) => { network.push(args); throw new Error("目录导航不能保存练习"); } },
    },
  });
  const props = { notes: options.notes ?? notes, onOpen() {}, onOpenWiki() {}, onVaultChanged: async () => {} };
  return { ...state, mounts, network, view: () => Page.type(props), html: () => renderToStaticMarkup(React.createElement(Page, props)) };
}

function assertNoDetails(h) {
  const html = h.html();
  for (const marker of ["FIRST_CHAPTER_PRIVATE_BODY_SENTINEL", "SECOND_CHAPTER_PRIVATE_BODY_SENTINEL", "SCENARIO_ANSWER_SENTINEL", "QUESTION_DETAIL_SENTINEL", "LANGUAGE_DETAIL_SENTINEL", "<textarea"]) assert.equal(html.includes(marker), false, marker);
  assert.deepEqual(h.mounts, { textbook: 0, scenario: 0, questions: 0, language: 0 });
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.network, []);
  return html;
}

test("裸专项入口显示三个模块总览，旧练习缓存不能自动打开教材或作答", async () => {
  const h = await harness("", { storage: { "echo:language-expression-position:v1": JSON.stringify({ version: 1, activeCourseId: "test-scenario", positions: {} }) } });
  const html = assertNoDetails(h);
  assert.match(html, /<h1[^>]*>专项训练<\/h1>/);
  for (const item of SPECIAL_MODULES) assert.ok(html.includes(item.title), item.title);
  assert.equal((html.match(/class="special-module-card /g) ?? []).length, 3);
  assert.ok(html.includes("1 条已审核 ASR 记录"));
  assert.equal(html.includes("2 条已审核 ASR 记录"), false);
  assert.deepEqual(specialTrainingRoute(h.browser.location.search), { kind: "home" });
});

test("显式总览覆盖旧详情参数，三个模块按钮清理互斥选择并保留ui", async () => {
  for (const item of SPECIAL_MODULES) {
    const h = await harness("?specialModule=home&chapter=test-first&course=test-scenario&questionSet=test-questions&knowledge=role&lessonView=examples&questionId=test-question&ui=ja");
    assertNoDetails(h);
    click(moduleButton(h.view(), item.id));
    assert.equal(h.browser.location.pathname, "/training/topics");
    assert.equal(h.browser.location.searchParams.get("specialModule"), item.id);
    assert.equal(h.browser.location.searchParams.get("ui"), "ja");
    for (const key of ["chapter", "course", "questionSet", "knowledge", "lessonView", "questionId"]) assert.equal(h.browser.location.searchParams.has(key), false, key);
    assert.equal(h.entries.length, 2);
    assert.equal(h.browser.history.state.preserved, true);
    assertNoDetails(h);
  }
});

test("教材模块列出章名但不挂正文，选择第一章才push进入正确详情", async () => {
  const h = await harness("?specialModule=textbook&ui=ja");
  const html = assertNoDetails(h);
  assert.ok(html.includes(first.frontmatter.title));
  assert.ok(html.includes(second.frontmatter.title));
  button(h.view(), first.frontmatter.title).props.onClick();
  assert.equal(h.browser.location.searchParams.get("chapter"), "test-first");
  assert.equal(h.browser.location.searchParams.has("specialModule"), false);
  assert.equal(h.browser.location.searchParams.get("ui"), "ja");
  assert.equal(h.entries.length, 2);
  assert.match(h.html(), /FIRST_CHAPTER_PRIVATE_BODY_SENTINEL/);
  assert.equal(h.mounts.scenario, 0);
  assert.deepEqual(h.network, []);
});

test("练习列表不恢复草稿或写作答，明确选择课程才挂工作台", async () => {
  const h = await harness("?specialModule=practice&ui=ja");
  const html = assertNoDetails(h);
  assert.ok(html.includes(course.frontmatter.title));
  button(h.view(), course.frontmatter.title).props.onClick();
  assert.equal(h.browser.location.searchParams.get("course"), "test-scenario");
  assert.equal(h.browser.location.searchParams.has("specialModule"), false);
  assert.equal(h.browser.location.searchParams.get("ui"), "ja");
  assert.match(h.html(), /SCENARIO_ANSWER_SENTINEL/);
  assert.equal(h.mounts.textbook, 0);
  assert.deepEqual(h.network, []);
});

test("旧chapter/course/questionSet及语言详情链接直接恢复，不被新首页截走", async () => {
  const cases = [
    ["?chapter=test-second&knowledge=role&lessonView=examples", "SECOND_CHAPTER_PRIVATE_BODY_SENTINEL", "chapter"],
    ["?chapter=test-first&course=test-scenario", "SCENARIO_ANSWER_SENTINEL", "course"],
    ["?questionSet=test-questions&questionTopic=introduction", "QUESTION_DETAIL_SENTINEL", "questions"],
    ["?questionSet=test-questions&questionView=language&languageCategory=honorific&languagePoint=test-request&questionId=test-question", "LANGUAGE_DETAIL_SENTINEL", "language"],
  ];
  for (const [search, marker, kind] of cases) {
    const h = await harness(search);
    assert.equal(specialTrainingRoute(h.browser.location.search).kind, kind);
    assert.ok(h.html().includes(marker), search);
    assert.deepEqual(h.network, []);
  }
});

test("模块与详情导航进入history，刷新、back和forward恢复同一内容", async () => {
  const h = await harness("?specialModule=textbook&ui=ja");
  button(h.view(), second.frontmatter.title).props.onClick();
  const deepLink = h.browser.location.href;
  const refreshed = await harness("", { state: h });
  assert.ok(refreshed.html().includes("SECOND_CHAPTER_PRIVATE_BODY_SENTINEL"));
  h.browser.history.back();
  assert.deepEqual(specialTrainingRoute(h.browser.location.search), { kind: "module", module: "textbook" });
  assert.equal(h.html().includes("SECOND_CHAPTER_PRIVATE_BODY_SENTINEL"), false);
  h.browser.history.forward();
  assert.equal(h.browser.location.href, deepLink);
  assert.ok(h.html().includes("SECOND_CHAPTER_PRIVATE_BODY_SENTINEL"));
});

test("教材已存位置保持章内知识点和页签，首页读取不得改写为首章默认值", async () => {
  const saved = { knowledge: "role", lessonView: "contrast" };
  const storage = { [textbookPositionKey("test-second")]: JSON.stringify(saved) };
  const h = await harness("?specialModule=textbook", { storage });
  assertNoDetails(h);
  inBrowser(h.browser, () => button(h.view(), second.frontmatter.title).props.onClick());
  assert.equal(h.browser.location.searchParams.get("chapter"), "test-second");
  assert.equal(h.browser.location.searchParams.get("knowledge"), "role");
  assert.equal(h.browser.location.searchParams.get("lessonView"), "contrast");
  assert.equal(h.saved.get(textbookPositionKey("test-second")), JSON.stringify(saved));
  assert.deepEqual(h.writes, []);
});

test("过期章节或课程链接显示未载入，不能跳到另一份教材或已存练习", async () => {
  for (const search of ["?course=removed-course", "?chapter=removed-chapter"]) {
    const h = await harness(search, { storage: { "echo:language-expression-position:v1": JSON.stringify({ version: 1, activeCourseId: "test-scenario", positions: {} }) } });
    const html = assertNoDetails(h);
    assert.match(html, /尚未载入或已调整/);
    assert.equal(h.browser.location.search, search);
    assert.equal(html.includes(course.frontmatter.title), false);
    assert.equal(html.includes(first.frontmatter.title), false);
  }
});

test("真实提问模块先列意图或语言点，选择条目才进入详情", async () => {
  const h = await harness("?specialModule=questions&ui=ja");
  const html = assertNoDetails(h);
  assert.ok(html.includes("自我介绍"));
  assert.ok(html.includes("按提问意图"));
  assert.ok(html.includes("按语言用法"));
  button(h.view(), "自我介绍").props.onClick();
  assert.equal(h.browser.location.searchParams.get("questionSet"), "test-questions");
  assert.equal(h.browser.location.searchParams.get("questionTopic"), "introduction");
  assert.equal(h.browser.location.searchParams.has("specialModule"), false);
  assert.ok(h.html().includes("QUESTION_DETAIL_SENTINEL"));

  h.browser.history.back();
  click(link(h.view(), "按语言用法"));
  assert.equal(h.browser.location.searchParams.get("specialModule"), "questions");
  assert.equal(h.browser.location.searchParams.get("questionCatalog"), "language");
  assert.ok(h.html().includes(languagePoint.titleZh));
  assert.equal(h.html().includes("LANGUAGE_DETAIL_SENTINEL"), false);
  button(h.view(), languagePoint.titleZh).props.onClick();
  assert.equal(h.browser.location.searchParams.get("questionView"), "language");
  assert.equal(h.browser.location.searchParams.get("languagePoint"), "test-request");
  assert.equal(h.browser.location.searchParams.has("specialModule"), false);
  assert.equal(h.browser.location.searchParams.has("questionCatalog"), false);
  assert.ok(h.html().includes("LANGUAGE_DETAIL_SENTINEL"));
  assert.deepEqual(h.network, []);
});

test("从语言目录全部进入敬语后切换知识点，详情返回和面包屑均保留目录全部筛选", async () => {
  const expanded = structuredClone(collection);
  const nextPoint = { ...structuredClone(languagePoint), id: "test-followup", titleZh: "测试用法：追问说明" };
  expanded.languageIndex.points.push(nextPoint);
  const material = { ...questionNote, content: `<!-- interview-questions-json:start -->\n\`\`\`json\n${JSON.stringify(expanded)}\n\`\`\`\n<!-- interview-questions-json:end -->` };

  for (const exit of ["detail-back", "breadcrumb"]) {
    const h = await harness("?specialModule=questions&questionCatalog=language&languageCategory=all&ui=ja", { notes: [material] });
    button(h.view(), languagePoint.titleZh).props.onClick();
    const detail = () => {
      const node = walk(h.view()).find(item => item.props?.index?.sourceCollectionId === collection.collectionId);
      assert.ok(node, "应已进入语言知识点详情");
      return node;
    };
    const assertReturnHint = () => {
      assert.equal(h.browser.location.searchParams.get("languageCategory"), "honorific");
      assert.equal(h.browser.location.searchParams.get("languageReturnCategory"), "all");
      assert.equal(h.browser.location.searchParams.get("ui"), "ja");
    };
    assertReturnHint();
    detail().props.onSelectPoint("honorific", nextPoint.id);
    assert.equal(h.browser.location.searchParams.get("languagePoint"), nextPoint.id);
    assertReturnHint();
    detail().props.onSelectPoint("honorific", languagePoint.id);
    detail().props.onSelectQuestion(question.id, "honorific", languagePoint.id);
    assert.equal(h.browser.location.searchParams.get("questionId"), question.id);
    assertReturnHint();

    if (exit === "detail-back") detail().props.onBack();
    else click(link(h.view(), SPECIAL_MODULES.find(item => item.id === "questions").title));
    assert.deepEqual(specialTrainingRoute(h.browser.location.search), { kind: "module", module: "questions" });
    assert.equal(h.browser.location.searchParams.get("questionCatalog"), "language");
    assert.equal(h.browser.location.searchParams.get("languageCategory"), "all");
    assert.equal(h.browser.location.searchParams.get("ui"), "ja");
    for (const key of ["questionSet", "questionView", "languagePoint", "questionId", "languageReturnCategory"]) assert.equal(h.browser.location.searchParams.has(key), false, `${exit}: ${key}`);
    assertNoDetails(h);
  }
});

test("四种旧详情都有返回所属模块和总览的导航，不留下互斥详情参数", async () => {
  const cases = [
    ["?chapter=test-first&knowledge=role&lessonView=contrast&ui=ja", "textbook"],
    ["?course=test-scenario&ui=ja", "practice"],
    ["?questionSet=test-questions&questionTopic=introduction&questionId=test-question&ui=ja", "questions"],
    ["?questionSet=test-questions&questionView=language&languagePoint=test-request&ui=ja", "questions"],
  ];
  for (const [search, module] of cases) {
    const h = await harness(search);
    const title = SPECIAL_MODULES.find(item => item.id === module).title;
    click(link(h.view(), title));
    assert.deepEqual(specialTrainingRoute(h.browser.location.search), { kind: "module", module });
    for (const key of ["chapter", "knowledge", "lessonView", "course", "questionSet", "questionId", "questionView", "languagePoint"]) assert.equal(h.browser.location.searchParams.has(key), false, key);
    assert.equal(h.browser.location.searchParams.get("ui"), "ja");
    click(link(h.view(), "专项总览"));
    assert.deepEqual(specialTrainingRoute(h.browser.location.search), { kind: "home" });
    assert.equal(h.browser.location.searchParams.get("ui"), "ja");
    assert.equal(h.browser.location.searchParams.has("specialModule"), false);
    assertNoDetails(h);
  }
});

test("总览继续阅读只呈现有效章内位置，不将过期缓存当最近访问或完成", async () => {
  const storage = {
    [textbookPositionKey("test-first")]: "{broken",
    [textbookPositionKey("test-second")]: JSON.stringify({ knowledge: "role", lessonView: "examples" }),
    [textbookPositionKey("removed-chapter")]: JSON.stringify({ knowledge: "object", lessonView: "explain" }),
  };
  const h = await harness("?ui=ja", { storage });
  const html = assertNoDetails(h);
  assert.match(html, /aria-label="已保存阅读位置"/);
  assert.ok(html.includes(second.frontmatter.title));
  assert.equal(html.includes(first.frontmatter.title), false);
  assert.equal(html.includes("最近阅读"), false);
  assert.equal(html.includes("已掌握"), false);
  button(h.view(), second.frontmatter.title).props.onClick();
  assert.equal(h.browser.location.searchParams.get("chapter"), "test-second");
  assert.equal(h.browser.location.searchParams.get("knowledge"), "role");
  assert.equal(h.browser.location.searchParams.get("lessonView"), "examples");
  assert.deepEqual(h.writes, []);
});
