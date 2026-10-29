import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const note = {
  path: "20_求職/原文.md", content: "# 完整原文\n\n完整正文第一段。\n\n[[参考#重点|打开参考]]\n\n完整正文末段。", tags: [],
  frontmatter: { type: "material" }, stat: { ctime: 0, mtime: 0, size: 120 },
};
const allNotes = [{ get path() { throw new Error("索引阅读不能扫描全库"); }, get content() { throw new Error("索引阅读不能扫描全文"); } }];
const card = (path, title) => ({
  kind: "note-card", path, title, type: "material", group: "career", mtime: 0, tags: [], folder: "20_求職", summary: "目录摘要",
  trust: { label: "证据层", className: "trust-evidence" }, decision: { semantic: "fact", importance: "资料", when: "—", next: "查看原文", label: "事实" }, links: 1, bodyHash: "hash",
});
const backlink = card("20_求職/反链.md", "提到原文的资料");
const outlink = card("20_求職/参考.md", "引用参考资料");
const links = { page: { revision: "r-reader", items: [backlink], total: 1, outlinks: [outlink] }, items: [backlink], loading: false, error: "", retry() {} };
const locale = { useUiLocale: () => ({ locale: "zh-CN", setLocale() {} }) };
const readingMode = { default: ({ children, footerActions, information }) => React.createElement("article", null, children, footerActions, information) };
const props = { note, allNotes, indexed: true, revision: "r-reader", section: null, wikiIndexComplete: true, onClose() {}, onOpen() { throw new Error("卡片不能冒充完整笔记"); }, onOpenWiki() {} };

test("详情与阅读层从版本化关系目录显示反链、出链，同时保留完整原文", async () => {
  for (const path of ["app/note-drawer.tsx", "app/note-reader.tsx", "app/scene-note-reader.tsx"]) {
    const calls = [];
    const mod = await loadAppModule(path, { stubs: {
      "./ui-locale": locale, "./reading-mode": { ...readingMode, readFontSize: () => 18, useReadingProgress: () => null },
      "./use-read-model-library": { useReadModelBacklinks: (...args) => { calls.push(args); return links; } },
    } });
    const html = renderToStaticMarkup(React.createElement(mod.default, { ...props, scene: "graph" }));
    assert.match(html, /完整正文第一段/);
    assert.match(html, /完整正文末段/);
    assert.match(html, /提到原文的资料/);
    assert.match(html, /引用参考资料/);
    assert.doesNotMatch(html, /wiki-link--missing/);
    assert.deepEqual(calls, [[note.path, true, "r-reader"]]);
  }
});

test("关系索引加载和失败不妨碍全文显示，也不会把未知反链说成零条", async () => {
  for (const state of [{ page: null, items: [], loading: true, error: "" }, { page: null, items: [], loading: false, error: "索引读取失败" }]) {
    const mod = await loadAppModule("app/note-drawer.tsx", { stubs: { "./ui-locale": locale, "./use-read-model-library": { useReadModelBacklinks: () => ({ ...links, ...state }) } } });
    const html = renderToStaticMarkup(React.createElement(mod.default, props));
    assert.match(html, /完整正文末段/);
    assert.match(html, /反链 —/);
    assert.doesNotMatch(html, /0 条反链/);
    assert.match(html, state.loading ? /role="status"[^>]*>正在读取相关笔记/ : /role="alert"/);
  }
});

const hooks = {
  ...React, useEffect() {}, useLayoutEffect() {}, useMemo: (factory) => factory(), useCallback: (callback) => callback,
  useRef: (current) => ({ current }), useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
};
function expand(element) {
  if (Array.isArray(element)) return element.flatMap(expand);
  if (!element || typeof element !== "object") return [];
  const component = typeof element.type === "function" ? element.type : typeof element.type?.type === "function" ? element.type.type : null;
  if (component) return expand(component(element.props));
  return [element, ...expand(element.props?.children)];
}

test("反链、出链按钮只传路径和关系目录版本，正文双链继续按原目标跳转", async () => {
  const opened = [], wiki = [];
  const stubs = {
    react: hooks, "./ui-locale": locale,
    "./reading-mode": { ...readingMode, readFontSize: () => 18, useReadingProgress: () => null },
    "./markdown-document": { default: ({ onWikiLink }) => React.createElement("button", { "data-wiki": true, onClick: () => onWikiLink("参考", "重点") }) },
    "./use-read-model-library": { useReadModelBacklinks: () => links },
  };
  for (const path of ["app/note-drawer.tsx", "app/note-reader.tsx"]) {
    const mod = await loadAppModule(path, { stubs });
    const tree = expand(React.createElement(mod.default, { ...props, onOpenPath: (...args) => opened.push(args), onOpenWiki: (...args) => wiki.push(args) }));
    const buttons = tree.filter((element) => element.type === "button" && typeof element.props?.onClick === "function");
    for (const button of buttons) {
      if (button.props["data-wiki"]) button.props.onClick();
      const text = JSON.stringify(button.props.children);
      if (text?.includes(backlink.title) || text?.includes(outlink.title)) button.props.onClick();
    }
  }
  assert.ok(opened.some(([path, revision]) => path === backlink.path && revision === "r-reader"));
  assert.ok(opened.some(([path, revision]) => path === outlink.path && revision === "r-reader"));
  assert.ok(opened.every(([, revision]) => revision === "r-reader"));
  assert.deepEqual(wiki, [["参考", "重点"], ["参考", "重点"]]);
});
