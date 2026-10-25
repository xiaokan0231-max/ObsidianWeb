import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { uiCopy } from "../lib/ui-copy.ts";
import { buildCompanyOverviews } from "../lib/company-overview.ts";
import { buildCompanyHero } from "../lib/company-hero.ts";
import { countdownLabel } from "../lib/memory-atlas-data.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const today = "2026-10-26";
const originalBody = "选择公司。这是原始资料的正文，不随菜单语言改变。";
const originalRole = "数据工程（原始岗位）";
const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
const companyNote = note("20_求職/株式会社テスト/案件.md", { type: "job-case", company: "株式会社テスト", case_id: "test-data", company_dossier: "[[20_求職/株式会社テスト/_会社]]", status: "面接中", channel: "テスト経路", next_event_at: `${today} 13:00`, waiting_for: "company", waiting_label: originalBody, follow_up_at: "2026-10-25", follow_up_action: originalBody }, `# 株式会社テスト ${originalRole}`);
const dossier = note("20_求職/株式会社テスト/_会社.md", { type: "company", company: "株式会社テスト", company_profile: { version: 1, updated_on: today, facts: [{ id: "business", label: "业务", value: originalBody, as_of: today, scope: "测试资料", sources: [{ label: "测试来源", url: "https://example.com/company" }] }], reviews: [] } });
const notes = [companyNote, dossier];
const localized = (file, locale = "ja", extras = {}) => loadAppModule(file, { ...extras, stubs: { "./ui-locale": { useUiLocale: () => ({ locale, setLocale() {} }) }, ...extras.stubs } });
const render = (component, props = {}) => renderToStaticMarkup(createElement(component, props));

test("界面模板仅替换指定参数，原始字段、占位符和外侧空白不被再次翻译", () => {
  const t = uiCopy("ja", { "选择{company}": "{company}を選択" });
  assert.equal(t(" 选择{company} ", { company: "选择公司 {query} $&" }), " 选择公司 {query} $&を選択 ");
  assert.equal(t("未配置的原文"), "未配置的原文");
  assert.equal(t(" \n"), " \n");
  assert.equal(uiCopy("zh-CN", { "选择{company}": "unused" })("选择{company}", { company: "株式会社テスト" }), "选择株式会社テスト");
});

test("公司选择器翻译操作，保持公司、岗位、资料正文、筛选值和选中状态", async () => {
  const { CompanyCompareSelector } = await localized("app/company-overview.tsx");
  const contexts = buildCompanyOverviews(notes);
  const html = render(CompanyCompareSelector, { embedded: true, contexts, selected: contexts, notes, today, onToggle() {}, onClose() {}, onCompare() {} });
  assert.match(html, /企業・職種から比較対象を選択|企業を選択|企業比較/);
  assert.match(html, /比較を始める/);
  assert.match(html, /value="relevance"/);
  assert.match(html, /type="checkbox"[^>]*checked=""/);
  assert.ok(html.includes(originalRole));
  assert.ok(html.includes(originalBody));
  assert.ok(html.includes("株式会社テスト"));
  assert.doesNotMatch(html, />开始对比</);
});

test("独立公司对比加载态和中文回退正常，原始 URL 不因语言变化", async () => {
  for (const [locale, title] of [["ja", "企業比較"], ["zh-CN", "公司对比"]]) {
    const { default: Comparison } = await localized("app/company-comparison.tsx", locale);
    const loading = render(Comparison, { notes: [], today, loading: true, onOpenCompany() {}, onOpenWiki() {} });
    assert.ok(loading.includes(title));
    assert.match(loading, /aria-busy="true"/);
  }
});

test("公司页头按日语生成等待与逾期提示，动作原文和案件数据保持不变", () => {
  const context = buildCompanyOverviews(notes)[0];
  const before = JSON.stringify(companyNote);
  const hero = buildCompanyHero(context, { today, locale: "ja" });
  assert.match(hero.now.waiting, /企業の返答待ち/);
  assert.ok(hero.now.waiting.includes(originalBody));
  assert.match(hero.now.followUp.label, /1日経過/);
  assert.ok(hero.now.followUp.label.endsWith(originalBody.slice(0, 29) + "…") || hero.now.followUp.label.includes(originalBody));
  assert.equal(hero.now.event.label, "今日 13:00");
  assert.equal(JSON.stringify(companyNote), before);
  assert.equal(countdownLabel("2026-10-28", new Date("2026-10-26T00:00:00"), "ja"), "2 日後");
});

test("共通素材的目录与复制操作翻译，原始标题和回答保持原文", async () => {
  const { default: Shared } = await localized("app/interview-shared-asset.tsx");
  const asset = note("20_求職/_素材/测试.md", { type: "material" }, `# 原始材料标题\n\n## 原始章节\n\n【あなた】${originalBody}`);
  const html = render(Shared, { note: asset, target: { note: "测试", label: "素材の原名" }, onOpenCard() {}, onOpenWiki() {} });
  assert.match(html, /セクション 1件/);
  assert.match(html, /コピー/);
  assert.match(html, /aria-label="素材の原名のセクション"/);
  assert.ok(html.includes("原始章节"));
  assert.ok(html.includes(originalBody));
});

test("复盘的操作翻译，诊断、证据、评分和来源路径保持原文", async () => {
  const { InterviewReassessmentEntry } = await localized("app/interview-reassessment-entry.tsx");
  const report = note("80_AI分析/テスト.md", { type: "ai-report", report_kind: "interview-reassessment", report_role: "session", source_path: "source.md", method_version: "2026-10-v3", evaluation_mode: "scored_evidence", assessment_scope: "full_available_text", overall_score: 60, diagnostic_conclusion: originalBody, dimension_scores: { questionUnderstanding: 85, coverage: 50, directness: 85 }, score_basis: [originalBody] });
  const html = render(InterviewReassessmentEntry, { notes: [report], sourcePath: "source.md", onOpenNote() {} });
  assert.match(html, /60 \/ 100/);
  assert.match(html, /評価/);
  assert.ok(html.includes(originalBody));
  assert.doesNotMatch(html, />查看评价与建议/);
});

test("错误恢复、加载状态和正文表格提供日语界面，错误与正文原文保持不变", async () => {
  const { default: ErrorPage } = await localized("app/error.tsx");
  const error = render(ErrorPage, { error: new Error(originalBody), reset() {} });
  assert.match(error, /再試行/);
  assert.ok(error.includes(originalBody));
  const { default: Loading } = await localized("app/scope-loading.tsx");
  assert.match(render(Loading, { label: "資料" }), /資料を読み込んでいます/);
  const { default: Markdown } = await localized("app/markdown-document.tsx");
  const html = render(Markdown, { reading: true, content: `| 原始表头 |\n| --- |\n| ${originalBody} |`, onWikiLink() {} });
  assert.match(html, /aria-label="本文の表、横にスクロールできます"/);
  assert.ok(html.includes(originalBody));
});

test("发布提示直接订阅当前语言，双语文案都能渲染", async () => {
  const { PublishedReadOnlyNotice: Notice, UiLocaleProvider: Provider } = await loadAppModule("app/ui-locale.tsx");
  assert.match(renderToStaticMarkup(createElement(Provider, { initialLocale: "ja" }, createElement(Notice))), /公開済みの内容 · 閲覧専用/);
  assert.match(renderToStaticMarkup(createElement(Provider, { initialLocale: "zh-CN" }, createElement(Notice))), /已发布内容 · 仅供浏览/);
});
