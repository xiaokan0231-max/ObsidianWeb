import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCompanyOverviews, COMPANY_FIT_DIMENSIONS } from "../lib/company-overview.ts";
import { buildCompanyCompareCandidates } from "../lib/company-compare.ts";
import { hydrateInterviewCompany, projectInterviewCompany } from "../lib/interview-read-model.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const today = "2026-10-29";
const note = (path, frontmatter, content = "# 架空资料") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: content.length } });
function fixture(key) {
  const root = `20_求職/テスト${key}`;
  const evidence = note(`10_关于我/证据${key}.md`, { type: "material" }, "# 本人事实\n\n## 项目\n\n已确认项目原文。\n");
  const sources = [{ label: "本人事实", wiki: `[[${evidence.path}#项目]]` }];
  const owner = note(`${root}/案件.md`, { type: "job-case", company: `株式会社テスト${key}`, case_id: `test-${key}`, status: "面接中",
    company_dossier: `[[${root}/会社]]`, fit_assessment: `[[80_AI分析/契合${key}]]`, next_event_at: `${today} 15:00`, next_event_label: "一次面接" }, `# 株式会社テスト${key} — 数据岗位`);
  const dossier = note(`${root}/会社.md`, { type: "company", company: `株式会社テスト${key}`, company_summary: `[[80_AI分析/总结${key}]]`, company_profile: { version: 1, updated_on: today, facts: [], reviews: [] } });
  const summary = note(`80_AI分析/总结${key}.md`, { type: "ai-report", report_kind: "company-summary", schema_version: 1, company_dossier: `[[${dossier.path}]]`,
    assessed_on: today, ai_author: "Codex", coverage_period: "2025～2026年", sources }, `# 架空公司研究${key}\n\n## 公司总结\n\n已采用公司故事${key}，以明确来源说明业务与岗位。\n\n## 资料与边界\n\n未确认事实不外推。\n`);
  const assessment = note(`80_AI分析/契合${key}.md`, { type: "ai-report", report_kind: "company-fit", schema_version: 1, criteria_version: 2, assessed_on: today, ai_author: "Codex",
    case: `[[${owner.path}]]`, company_dossier: `[[${dossier.path}]]`, fit_assessment: { summary: `已核对的六维判断${key}`, strengths: ["有可核对的经历"], questions: ["面谈核实实际配属"], context_facts: [],
      dimensions: Object.fromEntries(COMPANY_FIT_DIMENSIONS.map(({ key }) => [key, { score: 4, rationale: "已确认经历与公开岗位任务相符", evidence: sources, unknowns: ["实际配属待面谈确认"] }])) } });
  return { owner, dossier, summary, assessment, evidence, full: [owner, dossier, summary, assessment, evidence], partial: [owner, dossier, summary, assessment] };
}
const a = fixture("甲"), b = fixture("乙");
const partial = [...a.partial, ...b.partial];
const validated = buildCompanyOverviews([...a.full, ...b.full]);
const companyContexts = validated.map((context) => hydrateInterviewCompany(JSON.parse(JSON.stringify(projectInterviewCompany(context))), partial));
const catalog = {
  kind: "interview-catalog", today, revision: "r-company", pickerGroups: [], preps: [], reviews: [], comparisons: [], defaults: {}, libraryPaths: [], practicePaths: [],
  compareDefaults: companyContexts.map((context) => context.note.path), comparePresets: { upcoming: [], recent: [], openwork: [], jobtalk: [] },
};
catalog.comparisons = buildCompanyCompareCandidates(companyContexts, partial, today).map(({ context, ...candidate }) => ({ ...candidate, path: context.note.path, company: context.company, title: context.title, hasProfile: Boolean(context.profile), hasAssessment: Boolean(context.assessment), business: "架空业务" }));
const locale = { useUiLocale: () => ({ locale: "zh-CN", setLocale() {} }) };
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const walk = (tree) => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(walk) : [tree, ...walk(tree.props?.children)];

test("全源已验证的六维和公司故事在局部正文集合中保持可用，正文字段只来自实际来源", async () => {
  assert.ok(validated.every((context) => context.assessmentStatus === "available" && context.summaryStatus === "available"));
  assert.ok(buildCompanyOverviews(partial).every((context) => context.assessmentStatus === "invalid" && context.summaryStatus === "invalid"), "缺少证据正文会使旧客户端重新校验失败");
  for (const context of companyContexts) {
    assert.equal(context.assessment.dimensions.filter((dimension) => dimension.score !== null).length, 6);
    assert.ok(partial.includes(context.note));
    assert.ok(partial.includes(context.assessment.note));
    assert.ok(partial.includes(context.summary.note));
  }
  const { default: InterviewSession } = await loadAppModule("app/interview-session.tsx", { stubs: { "./ui-locale": locale } });
  const html = render(InterviewSession, { notes: a.partial, companyContexts: [companyContexts[0]], today, initialContextPath: a.owner.path, forceOverviewOnly: true, catalog,
    onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {} });
  assert.match(html, /已核对的六维判断甲/);
  assert.match(html, /已采用公司故事甲/);
  assert.equal((html.match(/class="co-radar-dot"/g) ?? []).length, 6);
  assert.doesNotMatch(html, /公司总结暂不可用|资料不足，未评分|不存在/);
  assert.equal(a.evidence.content.includes("已确认项目原文"), true);
  assert.equal(a.partial.includes(a.evidence), false, "无须把引用证据正文放进场次依赖");
});

test("公司对比沿用投影的两组六维，旧界面和目录界面都不重新判空", async () => {
  const { default: CompanyComparison } = await loadAppModule("app/company-comparison.tsx", { stubs: { "./ui-locale": locale } });
  for (const remote of [false, true]) {
    const html = render(CompanyComparison, { notes: partial, today, companyContexts, catalog: remote ? catalog : undefined, onOpenCompany() {}, onOpenWiki() {} });
    assert.match(html, /已核对的六维判断甲/);
    assert.match(html, /已核对的六维判断乙/);
    assert.equal((html.match(/class="co-fit-pips"/g) ?? []).length, 12);
    assert.doesNotMatch(html, /class="co-fit-pips unknown"/);
  }
});

test("复盘公司分析无论持有整理稿还是仅持有contextPath，都采用已验证公司投影", async () => {
  const source = note("20_求職/テスト甲/整理稿.md", { type: "transcript-study", company: "株式会社テスト甲", case: `[[${a.owner.path}]]` }, "## q01\n- **s001｜私**\n    - 正:: 開発を担当しました。\n");
  const url = new URL(`http://localhost:3000/interview/review?${new URLSearchParams({ review: source.path, companyAnalysis: a.owner.path })}`);
  const { default: ReviewCompanyAnalysis } = await loadAppModule("app/review-company-analysis.tsx", { stubs: {
    "./ui-locale": locale, react: { ...React, useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() }, "react-dom": { createPortal: (children) => children },
  }, globals: { window: { location: url }, document: { body: {}, querySelector: () => null } } });
  for (const withSource of [false, true]) {
    const html = render(ReviewCompanyAnalysis, { notes: [...a.partial, source], source: withSource ? source : undefined, sourcePath: source.path, contextPath: a.owner.path, company: "株式会社テスト甲", companyContexts: [companyContexts[0]], revision: "r-company" });
    assert.match(html, /class="rv-company-entry"/);
    assert.match(html, /已核对的六维判断甲/);
    assert.match(html, /已采用公司故事甲/);
    assert.equal((html.match(/class="co-radar-dot"/g) ?? []).length, 6);
    assert.doesNotMatch(html, /公司总结暂不可用|company-status="missing"/);
  }
});

test("公司分析中的证据仅在点击后请求同版单篇，焦点仍留在分析层内", async () => {
  let cursor = 0;
  const states = [], requests = [];
  const url = new URL(`http://localhost:3000/interview/review?${new URLSearchParams({ companyAnalysis: a.owner.path })}`);
  const { default: ReviewCompanyAnalysis } = await loadAppModule("app/review-company-analysis.tsx", { stubs: {
    "./ui-locale": locale, "react-dom": { createPortal: (children) => children },
    react: { ...React, useMemo: (factory) => factory(), useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], (next) => { states[index] = next; }]; },
    },
    "./use-interview-overlay-notes": { useInterviewOverlayNotes(input) { requests.push(input); return { notes: [], sharedNote: input.asset ? a.evidence : null, loading: false, error: "", retry() {} }; } },
  }, globals: { window: { location: url }, document: { body: {}, querySelector: () => null } } });
  const tree = ReviewCompanyAnalysis({ notes: a.partial, contextPath: a.owner.path, company: "株式会社テスト甲", companyContexts: [companyContexts[0]], revision: "r-company" });
  const content = walk(tree).find((element) => element.type?.name === "AnalysisContent");
  cursor = 0; let view = content.type(content.props);
  assert.equal(requests.at(-1).asset, null);
  const overview = walk(view).find((element) => element.props?.context === companyContexts[0]);
  overview.props.onOpenWiki(`${a.evidence.path}#项目`);
  cursor = 0; view = content.type(content.props);
  assert.equal(requests.at(-1).asset.note, `${a.evidence.path}#项目`);
  assert.equal(requests.at(-1).revision, "r-company");
  assert.equal(requests.at(-1).seed, a.partial);
  assert.ok(walk(view).some((element) => element.props?.content === a.evidence.content));
});

test("重复的同源问题只渲染一次且不改写投影本身", async () => {
  const context = { ...companyContexts[0], issues: ["同一来源待核实", "同一来源待核实"] };
  const { default: CompanyOverviewContent } = await loadAppModule("app/company-overview.tsx", { stubs: { "./ui-locale": locale } });
  const html = render(CompanyOverviewContent, { context, onOpenWiki() {} });
  assert.equal((html.match(/<li>同一来源待核实<\/li>/g) ?? []).length, 1);
  assert.equal(context.issues.length, 2);
});
