import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const forbiddenNote = Object.fromEntries(["path", "content", "frontmatter"].map((key) => [key, "unread"]));
for (const key of Object.keys(forbiddenNote)) Object.defineProperty(forbiddenNote, key, { get() { throw new Error("目录不应读取完整 Note"); } });
const notes = [forbiddenNote];
const cards = Array.from({ length: 24 }, (_, index) => ({
  kind: "note-card", path: `20_求職/资料${index}.md`, title: `资料${index}`, type: "material", group: "career",
  mtime: 0, tags: ["练习"], folder: "20_求職", summary: "服务端摘要", trust: { label: "证据层", className: "trust-evidence" },
  decision: { semantic: "fact", importance: "资料", when: "未指定", next: "查看原文", label: "事实" }, links: 2, bodyHash: "body-hash",
  titleParts: [{ text: `目录标题${index}`, hit: false }], snippetParts: [{ text: "服务端命中片段", hit: true }], hits: { total: 1 },
}));
const page = {
  revision: "r-index", items: cards, total: 31, nextCursor: "r-index-next", effectiveSort: "recent", sourceUpdatedAt: 0, indexedAt: 0,
  facets: { groups: { all: 31, self: 1, career: 30, study: 0, analysis: 0, system: 0 }, scopes: { all: 31, evidence: 5, action: 6, interview: 7, language: 8, analysis: 9 }, tags: [{ tag: "练习", count: 12 }] },
};
const result = (overrides = {}) => ({ page, items: page.items, loading: false, error: "", more() {}, retry() {}, ...overrides });
const locale = { useUiLocale: () => ({ locale: "zh-CN", setLocale() {} }) };
const libraryProps = { notes, indexed: true, filter: "all", query: "", onFilter() {}, onQuery() {}, onOpen() { throw new Error("目录不能冒充完整 Note"); } };
const searchProps = { notes, indexed: true, onOpen() { throw new Error("搜索不能冒充完整 Note"); }, onQuery() {}, onClose() {}, onNavigate() {} };

async function renderLibrary(remote) {
  const mod = await loadAppModule("app/library-view.tsx", { stubs: { "./ui-locale": locale, "./use-read-model-library": { useReadModelLibrary: () => remote } } });
  return renderToStaticMarkup(React.createElement(mod.default, libraryProps));
}

test("目录使用服务端总数、筛选和24张卡片，不读取完整笔记", async () => {
  const html = await renderLibrary(result());
  assert.equal((html.match(/data-library-card=""/g) ?? []).length, 24);
  assert.match(html, /<h2>31 篇资料<\/h2>/);
  assert.match(html, /<span>#练习<\/span><strong>12<\/strong>/);
  assert.match(html, /<span>面试资料<\/span><strong>7<\/strong>/);
  assert.match(html, /再显示 7 篇/);
  assert.match(html, /还有 7 篇/);
  assert.match(html, /<mark class="note-hit">服务端命中片段<\/mark>/);
  assert.doesNotMatch(html, /unread/);
});

test("索引读取中及失败时不显示虚假零值，失败后提供重试", async () => {
  const loading = await renderLibrary(result({ page: null, items: [], loading: true }));
  assert.match(loading, /正在读取资料/);
  assert.match(loading, /<strong>—<\/strong>/);
  assert.doesNotMatch(loading, /0 篇资料|没有符合当前条件/);
  const failed = await renderLibrary(result({ page: null, items: [], error: "index unavailable" }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /重试/);
  assert.doesNotMatch(failed, /0 篇资料|没有符合当前条件/);
});

test("搜索直接显示8条服务端短片段，不扫描传入的正文集合", async () => {
  const remote = result({ items: cards.slice(0, 8), page: { ...page, items: cards.slice(0, 8) } });
  const mod = await loadAppModule("app/search-palette.tsx", { stubs: { "./ui-locale": locale, "./use-read-model-library": { useReadModelSearch: () => remote } } });
  const html = renderToStaticMarkup(React.createElement(mod.default, searchProps));
  assert.equal((html.match(/class="result-copy"/g) ?? []).length, 8);
  assert.equal((html.match(/<mark>服务端命中片段<\/mark>/g) ?? []).length, 8);
  assert.doesNotMatch(html, /unread|正在载入全部/);
});

const hooks = {
  ...React, useEffect() {}, useMemo: (factory) => factory(), useRef: (current) => ({ current }), useId: () => "test-id",
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}], useSyncExternalStore: (_subscribe, _get, getServer) => getServer(),
};
function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

test("卡片和搜索打开路径携带目录版本，更多按钮仅请求下一页", async () => {
  const opened = [];
  let more = 0;
  const remote = result({ more() { more++; } });
  const stubs = {
    react: hooks, "./ui-locale": locale,
    "./use-url-state": { enumCodec: () => ({}), useUrlState: (_key, initial) => [initial, () => {}] },
    "./use-read-model-library": { useReadModelLibrary: () => remote, useReadModelSearch: () => remote },
  };
  const library = await loadAppModule("app/library-view.tsx", { stubs });
  const tree = library.default.type({ ...libraryProps, onOpenPath: (...args) => opened.push(args) });
  const cardElement = elements(tree).find((element) => element.props?.card?.kind === "note-card");
  const renderedCard = cardElement.type.type(cardElement.props);
  renderedCard.props.onClick();
  elements(tree).find((element) => element.props?.className === "library-load-more").props.onClick();
  assert.equal(more, 1);
  const search = await loadAppModule("app/search-palette.tsx", { stubs });
  const searchTree = search.default({ ...searchProps, onOpenPath: (...args) => opened.push(args) });
  const noteButton = elements(searchTree).find((element) => element.type === "button" && elements(element).some((child) => child.props?.className === "result-copy"));
  noteButton.props.onClick();
  assert.deepEqual(opened, [[cards[0].path, "r-index"], [cards[0].path, "r-index"]]);
});

test("多标签通过重复参数保持AND筛选，逗号属于标签原文", async () => {
  const { libraryReadModelUrl } = await loadAppModule("app/use-read-model-library.ts");
  const url = new URL(libraryReadModelUrl({ query: "面接", tags: ["复盘", "C#,CI"], group: "career", scope: "interview" }), "https://example.test");
  assert.deepEqual(url.searchParams.getAll("tags"), ["复盘", "C#,CI"]);
  assert.equal(url.searchParams.get("limit"), "24");
  assert.equal(url.searchParams.get("q"), "面接");
});

test("构建或失败时保留目录并显示同步状态，不把旧版当空库", async () => {
  for (const [syncState, message] of [["building", "资料索引正在同步"], ["failed", "资料索引同步失败"]]) {
    const html = await renderLibrary(result({ syncState }));
    assert.match(html, new RegExp(message));
    assert.match(html, /显示上次完整资料/);
    assert.match(html, /31 篇资料/);
  }
});
