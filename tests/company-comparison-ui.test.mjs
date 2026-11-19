import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCompanyOverviews } from "../lib/company-overview.ts";
import { buildInterviewReadModelRecords, INTERVIEW_RECORDS } from "../lib/interview-read-model.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const today = "2026-10-25";
const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
function fixture(key, score, day) {
  const company = `株式会社テスト${key}`;
  const owner = note(`20_求職/テスト${key}/案件.md`, { type: "job-case", company, case_id: `test-${key}`, status: "面接中",
    company_dossier: `[[20_求職/テスト${key}/_会社]]`, next_event_at: `${day} 13:00`, next_event_label: "一次面接" }, `# ${company} データ基盤エンジニア`);
  const dossier = note(`20_求職/テスト${key}/_会社.md`, { type: "company", company, company_profile: {
    version: 1, updated_on: today, facts: key === "甲" ? [
      { id: "employees", label: "员工人数", value: "120 人", scope: "单体", as_of: today, sources: [{ label: "会社概要", url: "https://example.com/about" }] },
      { id: "revenue", label: "年营收", value: "20 億円", scope: "集团・2026年3月期", as_of: today, sources: [{ label: "財務報告", url: "https://example.com/results" }] },
    ] : [], reviews: [{ platform: "OpenWork", status: "available", score, scale: 5,
      sample_count: 12, sample_unit: "名回答者", read_on: today, comment_period: "2026年", url: `https://example.com/${key}/reviews`, coverage: "工程师样本", limitations: "不代表全体员工", positive: [], negative: [] }],
  } });
  return { owner, notes: [owner, dossier] };
}
const first = fixture("甲", 4.2, "2026-10-28");
const second = fixture("乙", 2.8, "2026-10-29");
const notes = [...first.notes, ...second.notes];
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const callbacks = { onOpenCompany() {}, onOpenWiki() {} };

test("公司对比两种资料入口共用紧凑工具栏，默认先显示核心数字，保留公司顺序", async () => {
  const { default: CompanyComparison } = await loadAppModule("app/company-comparison.tsx");
  const records = buildInterviewReadModelRecords(notes, { today });
  const catalog = records.find(({ kind }) => kind === INTERVIEW_RECORDS.catalog).value;
  for (const source of [{}, { catalog, companyContexts: buildCompanyOverviews(notes) }]) {
    const html = render(CompanyComparison, { notes, today, ...callbacks, ...source });
    assert.match(html, /<h1>公司对比<\/h1>/);
    assert.match(html, /class="company-comparison-page"/);
    assert.match(html, /aria-live="polite">2 项/);
    assert.match(html, /<select aria-label="快捷组"/);
    const table = html.slice(html.indexOf("<table"));
    assert.match(table, /テスト甲[\s\S]*テスト乙/);
    assert.match(table, /员工人数[\s\S]*年营收[\s\S]*资本金/);
    assert.match(table, /<strong>120<\/strong><small>人<\/small>/);
    assert.match(table, /集团・2026年3月期/);
    assert.doesNotMatch(table, /4\.20<small>|2\.80<small>/);
    assert.doesNotMatch(html, /role="dialog"|aria-modal=|co-compare-backdrop|关闭对比|关闭公司选择/);
  }
});

test("内嵌选择器和对比表正常参与页面，不生成弹框语义或关闭按钮", async () => {
  const { CompanyCompareSelector, CompanyCompare } = await loadAppModule("app/company-overview.tsx");
  const contexts = buildCompanyOverviews(notes);
  const selector = render(CompanyCompareSelector, { embedded: true, contexts, selected: [contexts[0]], notes, today,
    onToggle() {}, onClose() {}, onCompare() {} });
  const board = render(CompanyCompare, { embedded: true, contexts, notes, today, onClose() {}, onDetail() {}, onRemove() {}, onOpenWiki() {} });
  for (const html of [selector, board]) {
    assert.match(html, /<section class="co-compare-panel/);
    assert.match(html, /co-compare-embedded/);
    assert.doesNotMatch(html, /role="dialog"|aria-modal=|co-compare-backdrop|关闭对比|关闭公司选择/);
  }
  assert.match(selector, /aria-label="可对比的公司与岗位"/);
  assert.match(board, /<table/);
});

test("加载期间不解析空资料中的路径，资料齐备后仍保留链接明确指定的一家公司", async () => {
  let reads = 0;
  const location = { pathname: "/interview/compare", hash: "" };
  Object.defineProperty(location, "search", { get() { reads++; return `?${new URLSearchParams({ compare: first.owner.path })}`; } });
  const { default: CompanyComparison } = await loadAppModule("app/company-comparison.tsx", { globals: { window: { location } } });
  const loading = render(CompanyComparison, { notes: [], today, loading: true, ...callbacks });
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /正在读取公司、面谈与外部评价/);
  assert.equal(reads, 0, "加载占位不把合法链接按空notes过滤掉");
  const ready = render(CompanyComparison, { notes, today, ...callbacks });
  assert.ok(reads > 0);
  assert.match(ready, /再选一家，就能看出差异/);
  assert.match(ready, /1 \/ 8 已选/);
  assert.doesNotMatch(ready, /<table|role="dialog"|co-compare-backdrop/);
});

test("公司页的实际模块依赖不启动旧横向分析同步", async () => {
  const imports = [];
  const { default: CompanyComparison } = await loadAppModule("app/company-comparison.tsx", { stubs(specifier) { imports.push(specifier); return undefined; } });
  render(CompanyComparison, { notes, today, ...callbacks });
  assert.ok(imports.some((specifier) => specifier.includes("company-overview")), "检查的是真实公司页依赖图");
  assert.ok(imports.every((specifier) => !/interview-advisory-sync|interview-insights(?:$|[.])/u.test(specifier)), "比较公司时不触发旧跨场分析的读取或生成");
});

test("准备页的公司对比入口携带当前案件正本路径", async () => {
  const entries = [];
  const intercept = (create) => (type, props, key) => {
    if (type === "button" && props.className === "co-compare-entry") entries.push(props);
    return create(type, props, key);
  };
  const { default: InterviewSession } = await loadAppModule("app/interview-session.tsx", { stubs: {
    "react/jsx-runtime": { ...jsxRuntime, jsx: intercept(jsxRuntime.jsx), jsxs: intercept(jsxRuntime.jsxs) },
    "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) },
  } });
  const opened = [];
  const html = render(InterviewSession, { notes, today, initialContextPath: first.owner.path, forceOverviewOnly: true,
    onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {}, onOpenInsights: (path) => opened.push(path) });
  assert.match(html, /公司对比/);
  assert.doesNotMatch(html, /role="dialog"|co-compare-backdrop/);
  assert.equal(entries.length, 1, "当前公司只提供一个对比入口");
  entries[0].onClick();
  assert.deepEqual(opened, [first.owner.path], "从当前准备页进入时保留同一案件，不能按显示公司名重猜");
});
