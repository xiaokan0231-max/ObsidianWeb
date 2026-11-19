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

test("本机两项比较可进入 AI 分析，单项或远端页面不发起分析", async () => {
  const { default: CompanyComparison } = await loadAppModule("app/company-comparison.tsx");
  const catalog = buildInterviewReadModelRecords(notes, { today }).find(({ kind }) => kind === INTERVIEW_RECORDS.catalog).value;
  const props = { notes, today, ...callbacks, catalog: { ...catalog, revision: "test-revision" }, companyContexts: buildCompanyOverviews(notes) };
  const local = render(CompanyComparison, { ...props, analysisAvailable: true });
  assert.match(local, /<button type="button" class="cc-analysis-trigger" title=[^>]+>AI 分析<\/button>/);
  assert.match(local, /aria-pressed="false">AI 分析<\/button>/);
  const single = render(CompanyComparison, { ...props, analysisAvailable: true, comparisonPaths: [first.owner.path] });
  assert.match(single, /class="cc-analysis-trigger" disabled/);
  assert.doesNotMatch(render(CompanyComparison, props), /cc-analysis-trigger|>AI 分析<\/button>/);
});

test("AI 比较呈现入职影响、条件式选择和优先追问，证据链接仍可展开", async () => {
  const { CompanyAiAnalysisPanel } = await loadAppModule("app/company-ai-analysis.tsx");
  const left = { path: first.owner.path, label: "测试甲", role: "数据平台",
    advantages: [{ text: "可了解自有产品", implication: "可能持续跟踪产品指标的变化", evidenceIds: ["C1-F1"] }],
    tradeoffs: [], unknowns: ["团队分工待确认"],
    questions: [{ question: "该岗位可负责哪些产品能力？", reason: "决定是否有从设计到上线的职责。", evidenceIds: [] }] };
  const result = {
    companies: [left, { ...left, path: second.owner.path, label: "测试乙", advantages: [],
      tradeoffs: [{ text: "交付范围取决于项目", implication: "前期需要确认配属内容", evidenceIds: ["C2-F1"] }] }],
    differences: [{ axis: "产品与交付", text: "产品与项目交付方式有差异", implication: "项目轮换与长期迭代提供不同的经验", evidenceIds: ["C1-F1", "C2-F1"] }],
    scenarios: [{ priority: "重视产品长期演进", choice: "优先了解测试甲。", verify: "确认岗位是否参与迭代。", evidenceIds: ["C1-F1", "C2-F1"] }],
    evidence: [{ id: "C1-F1", path: left.path, label: "业务", value: "开发自有产品", asOf: today, scope: "单体",
      sourceLabels: ["公司概要"], sources: [{ label: "公司概要", url: "https://example.com/company" }] },
    { id: "C2-F1", path: second.owner.path, label: "业务", value: "按项目交付", asOf: today, scope: "单体", sourceLabels: ["公司概要"] }],
  };
  const html = render(CompanyAiAnalysisPanel, { ready: true, analysis: { result, loading: false, error: null } });
  assert.match(html, /最值得比较的差异[\s\S]*产品与交付[\s\S]*项目轮换与长期迭代提供不同的经验/);
  assert.match(html, /重视产品长期演进[\s\S]*优先了解测试甲[\s\S]*选择前先确认[\s\S]*确认岗位是否参与迭代/);
  assert.match(html, /测试甲[\s\S]*测试乙[\s\S]*优势[\s\S]*短板与取舍[\s\S]*面试优先追问/);
  assert.match(html, /可了解自有产品[\s\S]*href="https:\/\/example.com\/company"/);
  assert.match(html, /交付范围取决于项目[\s\S]*该岗位可负责哪些产品能力[\s\S]*决定是否有从设计到上线的职责/);
  assert.match(html, /class="cc-ai-regenerate">重新分析/);
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
