import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const note = {
  path: "20_求職/株式会社テスト.md",
  frontmatter: { title: "原始中文资料", type: "job-case", company: "株式会社テスト" },
  content: "# 原始中文资料\n\n这段中文正文保留原样。",
  tags: [],
  stat: { ctime: 0, mtime: 0, size: 0 },
};

async function renderPalette(locale) {
  const { default: SearchPalette } = await loadAppModule("app/search-palette.tsx", {
    stubs: { "./ui-locale": { useUiLocale: () => ({ locale, setLocale() {} }) } },
  });
  return renderToStaticMarkup(createElement(SearchPalette, {
    notes: [note], onOpen() {}, onQuery() {}, onClose() {}, onNavigate() {},
  }));
}

test("全库搜索使用当前菜单语言，原始笔记标题和正文仍原样显示", async () => {
  const chinese = await renderPalette("zh-CN");
  const japanese = await renderPalette("ja");
  assert.match(chinese, /aria-label="搜索资料库"/);
  assert.match(chinese, /快捷查询/);
  assert.match(chinese, /进行中的选考/);
  assert.match(japanese, /aria-label="資料ライブラリを検索"/);
  assert.match(japanese, /aria-label="検索キーワード"/);
  assert.match(japanese, /aria-label="検索を閉じる"/);
  assert.match(japanese, /クイック検索/);
  assert.match(japanese, /進行中の選考/);
  assert.match(japanese, /<strong>今回の面接<\/strong>/);
  assert.match(japanese, /<strong>求人・応募先<\/strong>/);
  assert.doesNotMatch(japanese, /快捷查询|进行中的选考|搜索关键词/);
  for (const html of [chinese, japanese]) {
    assert.match(html, /<strong>原始中文资料<\/strong>/);
    assert.match(html, /这段中文正文保留原样。/);
    assert.match(html, /<code>type:<\/code>/);
    assert.match(html, /<code>status:<\/code>/);
    assert.match(html, /<code>folder:<\/code>/);
  }
});
