import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { LANGUAGE_READING_LIST_MARKER } from "../lib/language-reading-list.ts";

const documentPath = "30_日本語学習/阅读专题/测试专题25.md";
const firstPage = Array.from({ length: 24 }, (_, index) => ({
  kind: "note-card", path: `30_日本語学習/阅读专题/测试专题${index + 1}.md`,
  title: `测试专题${index + 1}`, mtime: 0,
}));
const item = {
  id: "expression-01", number: 1, category: "搭配", priority: "先改", pattern: "SQL查询的说明",
  original: "ＳＱＬの結果を確認します。", suggested: "SQLの実行結果を確認します。", reminder: "说明需要确认的结果。",
  sources: [{ path: "20_求職/株式会社テスト/测试面談_整理稿.md", locator: "q01/s002", label: "株式会社テスト 面談" }],
};
const note = {
  path: documentPath, stat: { ctime: 0, mtime: 0, size: 1 }, tags: [],
  frontmatter: { type: "language-reading-list", title: "第25份测试专题", date: "2026-02-01" },
  content: `${LANGUAGE_READING_LIST_MARKER}\n\n\`\`\`json\n${JSON.stringify({
    version: 1, description: "独立于目录分页恢复明确的阅读路径。",
    period: { start: "2026-01-01", end: "2026-01-31" }, items: [item],
  })}\n\`\`\`\n`,
};

function catalog(items = firstPage, syncState = "ready") {
  return {
    page: { revision: "r-complete", items, total: 25, nextCursor: items.length ? "page-two" : null },
    items, syncState, loading: false, error: "", more() {}, retry() {},
  };
}

async function harness(remote, search = "", documentNote = note) {
  const values = [], requests = [], opened = [];
  let cursor = 0;
  let effects = [];
  const params = new URLSearchParams(search);
  const readingModule = await loadAppModule("app/reading-view.tsx", {
    stubs: {
      react: {
        ...React,
        useMemo: (factory) => factory(),
        useState(initial) {
          const index = cursor++;
          if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
          return [values[index], (next) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
        },
        useEffect(effect) { effects.push(effect); },
      },
      "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) },
      "./use-url-state": {
        textCodec: {}, enumCodec: () => ({}),
        useUrlState: (key, initial) => [params.get(key) ?? initial, () => {}],
      },
      "./use-read-model-library": { useReadModelLibrary: () => remote },
      "./read-model-resource": {
        ReadModelFetchError: class ReadModelFetchError extends Error {},
        readReadModelJSON: async (url, signal) => { requests.push({ url, signal }); return { note: documentNote }; },
      },
    },
  });
  function render() {
    cursor = 0;
    effects = [];
    const tree = readingModule.default({ onOpenSource: (...args) => opened.push(args) });
    return { tree, html: renderToStaticMarkup(tree) };
  }
  return {
    render, requests, opened,
    async runEffects() {
      const cleanups = effects.map(effect => effect());
      // 让真实的正文解析与组件请求回调完成后再检查下一帧，而非只检查URL拼接。
      await new Promise(resolve => setImmediate(resolve));
      return () => cleanups.forEach(cleanup => cleanup?.());
    },
  };
}

function elements(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(elements);
  return [value, ...elements(value.props?.children)];
}

function textOf(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("");
  return value?.props ? textOf(value.props.children) : "";
}

test("后续目录页的明确阅读链接刷新后仍用目录版本请求并呈现同一篇正文", async () => {
  assert.equal(firstPage.some(card => card.path === documentPath), false);
  const h = await harness(catalog(), new URLSearchParams({ readingList: documentPath }).toString());
  const initial = h.render();
  assert.match(initial.html, /正在读取专题资料/);
  assert.doesNotMatch(initial.html, /没有找到这份专题|还没有阅读专题/);
  const cleanup = await h.runEffects();
  try {
    assert.equal(h.requests.length, 1);
    const request = new URL(h.requests[0].url, "https://example.test");
    assert.equal(request.pathname, "/api/note");
    assert.equal(request.searchParams.get("path"), documentPath);
    assert.equal(request.searchParams.get("revision"), "r-complete");
    const loaded = h.render();
    assert.match(loaded.html, /<h1>第25份测试专题<\/h1>/);
    assert.match(loaded.html, /SQLの実行結果を確認します。/);
    assert.doesNotMatch(loaded.html, /没有找到这份专题|这份专题暂时无法打开/);
    const sourceButton = elements(loaded.tree).find(element => element.type === "button"
      && textOf(element.props.children).includes("打开资料原笔记"));
    assert.ok(sourceButton);
    sourceButton.props.onClick();
    assert.deepEqual(h.opened, [[documentPath, "r-complete"]]);
  } finally { cleanup(); }
});

test("清单检索统一全半角与大小写，多个关键词取交集，优先筛选不放过可选项", async () => {
  const { readingListMatches } = await loadAppModule("app/reading-view.tsx");
  assert.equal(readingListMatches(item, "sql 結果", false), true);
  assert.equal(readingListMatches(item, "ＳＱＬ　q01/S002", true), true);
  assert.equal(readingListMatches(item, "sql 不存在的词", false), false);
  assert.equal(readingListMatches(item, "", true), true);
  const optional = { ...item, priority: "顺手改" };
  assert.equal(readingListMatches(optional, "sql", false), true);
  assert.equal(readingListMatches(optional, "sql", true), false);
  assert.equal(readingListMatches(optional, "", true), false);
});

test("索引构建中的空目录显示读取状态，只有完整空目录才显示暂无专题", async () => {
  const building = await harness(catalog([], "building"));
  const loading = building.render().html;
  assert.match(loading, /role="status"/);
  assert.match(loading, /正在读取专题资料/);
  assert.doesNotMatch(loading, /还没有阅读专题|没有找到这份专题/);
  const cleanup = await building.runEffects();
  cleanup();
  assert.deepEqual(building.requests, []);
  const ready = await harness(catalog([]));
  assert.match(ready.render().html, /还没有阅读专题/);
});

test("语法专题按自定目录展示并能只读原句可用的改写，旧清单不受分类参数影响", async () => {
  const data = {
    version: 1, description: "保留判断与适用边界。", period: { start: "2026-01-01", end: "2026-01-31" }, sections: ["句子结构", "可选句式"],
    items: [
      { ...item, category: "句子结构", finding: "correction" },
      { ...item, id: "alternative-02", number: 2, category: "可选句式", finding: "alternative", suggested: "設計と開発の両方を担当しました。", rule: "AもBも → AとBの両方", boundary: "原句也成立。", sources: [{ ...item.sources[0], available: false }] },
    ],
  };
  const richNote = { ...note, content: `${LANGUAGE_READING_LIST_MARKER}\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n` };
  const selected = new URLSearchParams({ readingList: documentPath, readingFinding: "alternative" }).toString();
  const h = await harness(catalog(), selected, richNote);
  h.render();
  const cleanup = await h.runEffects();
  try {
    const html = h.render().html;
    assert.match(html, /原句可用/);
    assert.match(html, /可选句式/);
    assert.match(html, /設計と開発の両方を担当しました。/);
    assert.match(html, /原句也成立。/);
    assert.match(html, /原稿未公开/);
    assert.equal(elements(h.render().tree).some(element => element.type === "button" && textOf(element.props.children).includes(item.sources[0].label)), false);
    assert.doesNotMatch(html, /reading-expression-01|语体与句尾/);
  } finally { cleanup(); }
  const old = await harness(catalog(), selected);
  old.render();
  const oldCleanup = await old.runEffects();
  try { assert.match(old.render().html, /SQLの実行結果を確認します。/); } finally { oldCleanup(); }
  const { readingListMatches } = await loadAppModule("app/reading-view.tsx");
  assert.equal(readingListMatches(data.items[1], "両方 原句", false, "alternative"), true);
  assert.equal(readingListMatches(data.items[1], "", false, "correction"), false);
});
