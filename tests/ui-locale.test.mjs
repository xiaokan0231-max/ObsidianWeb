import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_BRANDING, resolveUiLocale } from "../lib/ui-locale.ts";
import { parseInterviewPrepDoc } from "../lib/interview-prep-doc.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

test("界面语言仅接受中日两种，旧值或无选择时回到中文", () => {
  assert.equal(resolveUiLocale("ja"), "ja");
  assert.equal(resolveUiLocale("zh-CN"), "zh-CN");
  for (const value of [undefined, null, "en", "JA", {}, "<script>"]) {
    assert.equal(resolveUiLocale(value), "zh-CN");
  }
  assert.equal(APP_BRANDING["zh-CN"].name, "求职作战室");
  assert.equal(APP_BRANDING.ja.name, "転職作戦室");
});

test("日语面试章节与案件菜单保留原始公司、岗位和准备稿正文", async () => {
  const localeStub = { "./ui-locale": { useUiLocale: () => ({ locale: "ja", setLocale() {} }) } };
  const picker = await loadAppModule("app/context-picker.tsx", { stubs: localeStub });
  const item = { id: "test-case", kind: "case", company: "株式会社テスト", title: "原始中文岗位", status: "応募済", tone: "progress", eventAt: "", rounds: 1, assessed: true };
  const groups = [{ id: "active", label: "选考进行中", hint: "", collapsible: false, items: [item] }];
  const pickerHtml = renderToStaticMarkup(createElement(picker.ContextPickerPanel, {
    groups, selectedId: item.id, today: "2026-10-03", onSelect() {}, onClose() {},
  }));
  assert.match(pickerHtml, /企業・求人・面談を切り替え/);
  assert.match(pickerHtml, /選択中/);
  assert.match(pickerHtml, /原始中文岗位/);
  assert.match(pickerHtml, /応募済/);

  const note = {
    path: "test-prep.md", tags: [], stat: { ctime: 0, mtime: 0, size: 0 },
    frontmatter: { type: "interview-prep", prep_version: 2, company: "株式会社テスト", date: "2026-10-03" },
    content: "# 原始中文准备稿\n\n## 纵览与建议\n\n原始中文正文保留。\n\n## 志望動機\n\n原始回答\n\n## 逆質問\n\n原始问题\n\n## 研究资料\n\n原始资料\n\n## 临场备用\n\n原始说明",
  };
  const doc = parseInterviewPrepDoc(note, []);
  assert.ok(doc);
  const { default: Session } = await loadAppModule("app/interview-session-v2.tsx", {
    stubs: { ...localeStub, "./prep-material-reader": { default: () => null } },
  });
  const html = renderToStaticMarkup(createElement(Session, {
    doc, series: [], selectedSeries: null, sources: [], today: "2026-10-03",
    onSelect() {}, onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {},
    companyOverview: null, contextPicker: null, companyAction: null,
  }));
  assert.match(html, /aria-label="面接準備の章"/);
  assert.match(html, /企業概要/);
  assert.match(html, /面接の概要/);
  assert.match(html, /当日の補助資料/);
  assert.match(html, /原始中文正文保留。/);
  assert.match(html, /株式会社テスト/);
});

test("切换控件使用服务端初始语言，并始终提供两种语言的可访问选项", async () => {
  const { UiLocaleProvider, LanguageSwitch } = await loadAppModule("app/ui-locale.tsx");
  for (const locale of ["zh-CN", "ja"]) {
    const html = renderToStaticMarkup(createElement(UiLocaleProvider, { initialLocale: locale }, createElement(LanguageSwitch)));
    assert.match(html, new RegExp(`lang="${locale}" aria-pressed="true"`));
    assert.match(html, /lang="zh-CN"[^>]*>中文<\/button>/);
    assert.match(html, /lang="ja"[^>]*>日本語<\/button>/);
    assert.match(html, locale === "ja" ? /aria-label="表示言語"/ : /aria-label="界面语言"/);
  }
});
