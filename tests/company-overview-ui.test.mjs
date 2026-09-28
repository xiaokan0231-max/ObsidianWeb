import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as model from "../lib/company-overview.ts";
import * as prepModel from "../lib/interview-prep-doc.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// prep-doc-render 用真组件（总结正文的行内渲染要一起验）；lib 依赖与本文件顶上的 import 是同一实例。
const components = await loadAppModule("app/company-overview.tsx");
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const dimensions = (scores, version = 2) => model.companyFitDimensions(version).map((item, index) => ({ ...item, score: scores[index], rationale: `${item.label}的可核对依据`, evidence: [{ label: "公司原文", url: "https://example.com/evidence" }], unknowns: [] }));
const context = (title, version = 2) => ({ key: `case:${title}`, kind: "case", note: { path: `${title}.md`, frontmatter: { type: "job-case", company: "株式会社テスト" }, content: "", tags: [], stat: { ctime: 0, mtime: 0, size: 0 } }, company: "株式会社テスト", title, profile: null, assessment: { criteriaVersion: version, assessedOn: "2026-01-02", aiAuthor: "Codex", summary: `${title}的独立判断`, dimensions: dimensions([4, 3, null, 4, null, 3], version), strengths: ["发挥已有经验"], questions: ["实际职责待确认"], contextFacts: [] }, issues: [] });

test("公司总结先于事实卡完整呈现自然段，来源可展开但正文不折叠", () => {
  const item = context("数据平台岗位");
  item.summary = { note: { path: "80_AI分析/公司研究.md" }, schemaVersion: 1, assessedOn: "2026-09-20", aiAuthor: "Codex", coveragePeriod: "2023～2026年",
    paragraphs: ["公司以**业务软件**为主。", "[技术博客](https://example.com/tech)披露了系统改造。", "管理者表达了提高交付效率的方向。", "据此推测招聘用于补齐能力，实际分工仍待确认。"].map(prepModel.parseInline),
    sources: [{ label: "公司公开资料", url: "https://example.com/company" }] };
  item.summaryStatus = "available";
  const html = render(components.default, { context: item, onOpenWiki() {} });
  assert.ok(html.indexOf(">公司总结</h2>") < html.indexOf(">公司与岗位</h2>"));
  assert.match(html, /资料截至 <time dateTime="2026-09-20">2026-09-20<\/time>/);
  assert.match(html, /覆盖 2023～2026年/);
  assert.match(html, /Codex/);
  assert.match(html, />研究笔记 ↗<\/button>/);
  const prose = html.match(/<div class="co-summary-prose">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.equal((prose.match(/<p>/g) ?? []).length, 4);
  assert.match(prose, /<strong><span>业务软件<\/span><\/strong>/);
  assert.match(prose, /href="https:\/\/example.com\/tech"/);
  assert.match(prose, /据此推测招聘用于补齐能力，实际分工仍待确认/);
  assert.doesNotMatch(prose, /<details|hidden=|aria-hidden/);
  assert.match(html, /<details class="co-summary-sources"><summary>研究来源 · 1 项<\/summary>/);
  assert.match(html, /href="https:\/\/example.com\/company"/);
  assert.match(html, /数据平台岗位的独立判断/, "岗位契合短评仍独立显示");
});

test("缺失与损坏的总结显示轻量空态，已有岗位画像仍可阅读", () => {
  for (const summaryStatus of ["missing", "invalid"]) {
    const item = { ...context("已有岗位"), summary: null, summaryStatus };
    const html = render(components.default, { context: item, onOpenWiki() {} });
    assert.match(html, summaryStatus === "invalid" ? /公司总结暂不可用/ : /公司总结待整理/);
    assert.match(html, /已有岗位的独立判断/);
    assert.doesNotMatch(html, /co-summary-prose|研究笔记 ↗/);
  }
});

test("未知维度在雷达图保留真实缺口，只有全六维齐全才有面积", () => {
  const incomplete = render(components.CompanyFitRadar, { dimensions: dimensions([4, 3, null, 4, null, 3]), label: "株式会社テスト" });
  assert.doesNotMatch(incomplete, /class="co-radar-fill"/);
  assert.equal((incomplete.match(/class="co-radar-dot"/g) ?? []).length, 4);
  assert.equal((incomplete.match(/class="co-radar-value"/g) ?? []).length, 2, "只连接相邻已知点，不跨越未知轴");
  assert.match(incomplete, /业务方向：资料不足/);
  assert.match(incomplete, /4 \/ 6 维有依据/);
  const complete = render(components.CompanyFitRadar, { dimensions: dimensions([4, 3, 2, 5, 4, 3]), label: "株式会社テスト" });
  assert.equal((complete.match(/class="co-radar-fill"/g) ?? []).length, 1);
  assert.equal((complete.match(/class="co-radar-dot"/g) ?? []).length, 6);
  assert.match(complete, /评分不代表录用概率/);
});

test("总览不以默认分数填缺失资料，历史入口明确展示最新画像", () => {
  const empty = render(components.default, { context: null, onOpenWiki() {} });
  assert.match(empty, /尚未评估/);
  assert.match(empty, /未调查/);
  assert.doesNotMatch(empty, /class="co-radar-(fill|dot)"/);
  const html = render(components.default, { context: context("数据平台岗位"), historical: true, onOpenWiki() {} });
  assert.match(html, /历史面谈正文保持原样/);
  assert.match(html, /2026-01-02/);
  assert.match(html, /经验发挥的可核对依据/);
  assert.match(html, /href="https:\/\/example.com\/evidence"/);
  assert.match(html, /<details class="co-dimension"/);
  assert.match(html, /面试前契合画像/);
  assert.match(html, /面谈核实/);
});

test("面试前评分与面谈核实分开，已知六维不会因真实协作尚未确认而留白", () => {
  const item = context("数据平台岗位");
  item.assessment.dimensions = dimensions([4, 4, 3, 4, 3, 4]);
  item.assessment.questions = ["实际协作支持和在留手续尚需面谈核实"];
  const html = render(components.default, { context: item, onOpenWiki() {} });
  assert.match(html, /class="co-radar-fill"/);
  assert.match(html, /实际协作支持和在留手续尚需面谈核实/);
  assert.match(html, /技术匹配：4 \/ 5/);
  assert.match(html, /已知条件：4 \/ 5/);
  assert.doesNotMatch(html, /协作适配：/);
});

test("历史口径保留原轴原分数，不用面试前标签重解释", () => {
  const item = context("旧岗位", 1);
  item.assessment.dimensions = dimensions([4, 3, 2, 5, 1, 3], 1);
  const html = render(components.default, { context: item, onOpenWiki() {} });
  assert.match(html, /职责与裁量：2 \/ 5/);
  assert.match(html, /协作适配：1 \/ 5/);
  assert.match(html, /成长空间：5 \/ 5/);
  assert.match(html, /这份评价使用旧口径/);
  assert.doesNotMatch(html, /技术匹配|已知条件|成长方向/);
});

test("满三个禁用新加入，但已选项仍可移除；单项托盘不能开始比较", () => {
  const item = context("数据平台岗位");
  assert.match(render(components.CompanyCompareButton, { context: item, compared: false, full: true, onToggle() {} }), /disabled=""/);
  assert.doesNotMatch(render(components.CompanyCompareButton, { context: item, compared: true, full: true, onToggle() {} }), /disabled=/);
  const tray = render(components.CompanyCompareTray, { contexts: [item], onRemove() {}, onClear() {}, onOpen() {} });
  assert.match(tray, /disabled="">再选 1 项即可对比/);
  assert.match(tray, /aria-label="移除株式会社テスト 数据平台岗位"/);
});

test("同公司不同岗位保持分列，比较使用原始平台量尺与独立维度", () => {
  const first = context("平台开发"), second = context("分析工程");
  first.profile = { updatedOn: "2026-01-01", facts: [], reviews: [{ platform: "公开评价平台", url: "https://example.com/reviews", status: "available", score: 3.2, scale: 5, sampleCount: 12, commentPeriod: "2025年", coverage: "全公司", positive: ["协作"], negative: ["分工待核对"], limitations: "样本范围有限", readOn: "2026-01-01" }] };
  const html = render(components.CompanyCompare, { contexts: [first, second], onClose() {}, onDetail() {}, onRemove() {}, onOpenWiki() {} });
  assert.match(html, /平台开发的独立判断/);
  assert.match(html, /分析工程的独立判断/);
  assert.equal((html.match(/class="co-radar compact"/g) ?? []).length, 2);
  assert.match(html, /3\.2<small> \/ 5/);
  assert.match(html, /12 条样本/);
  assert.match(html, /样本范围有限/);
  assert.doesNotMatch(html, /応募优先度|job-compare-rating/);
});

test("新旧口径混选时保留公司事实，禁止并排雷达和维度分数", () => {
  const first = context("旧岗位", 1), second = context("新岗位", 2);
  const html = render(components.CompanyCompare, { contexts: [first, second], onClose() {}, onDetail() {}, onRemove() {}, onOpenWiki() {}, onEdit() {} });
  assert.match(html, /旧口径待更新：所选画像的评价维度不同/);
  assert.match(html, /旧岗位的独立判断/);
  assert.match(html, /新岗位的独立判断/);
  assert.match(html, /更换公司/);
  assert.doesNotMatch(html, /class="co-radar|class="co-dimension/);
});

test("选择器可以一次选择不同岗位；满三项后仅未选项禁用，已选项保持可取消", () => {
  const items = [context("平台开发"), context("分析工程"), context("业务系统"), context("技术支持")];
  const props = { contexts: items, onToggle() {}, onClose() {}, onCompare() {} };
  const empty = render(components.CompanyCompareSelector, { ...props, selected: [] });
  assert.match(empty, /aria-label="选择公司对比"/);
  assert.equal((empty.match(/type="checkbox"/g) ?? []).length, 4);
  assert.match(empty, /disabled="">并排对比/);
  const full = render(components.CompanyCompareSelector, { ...props, selected: items.slice(0, 3) });
  assert.equal((full.match(/checked=""/g) ?? []).length, 3);
  assert.equal((full.match(/disabled=""/g) ?? []).length, 1);
  assert.match(full, /已选满 3 项，可取消一项后更换/);
  assert.doesNotMatch(full, /disabled="">并排对比/);
});

test("加入按钮与选择器的状态切换都遵守三项上限，可取消后替换", () => {
  let paths = [];
  for (const path of ["同公司_平台.md", "同公司_分析.md", "另一公司.md", "第四公司.md"]) paths = components.toggleCompanyComparison(paths, path);
  assert.deepEqual(Array.from(paths), ["同公司_平台.md", "同公司_分析.md", "另一公司.md"]);
  paths = components.toggleCompanyComparison(paths, "同公司_分析.md");
  paths = components.toggleCompanyComparison(paths, "第四公司.md");
  assert.deepEqual(Array.from(paths), ["同公司_平台.md", "另一公司.md", "第四公司.md"]);
});

// 用真实会话入口验证日历已确定「本场没有准备稿」时不会借用同案件旧轮次。
const sessionExports = await loadAppModule("app/interview-session.tsx", { stubs: (specifier) => {
  if (specifier === "./company-overview") return components;
  if (specifier === "./interview-session-v2") return { default: ({ doc, companyAction }) => createElement("div", { "data-selected-prep": doc.note.path }, doc.round, companyAction) };
  if (specifier.startsWith("./")) return { Blocks() {}, Inlines() {}, default() {}, PrepSearchBox() {}, useSlashFocus() {}, copySelectionWithoutRuby() {} };
  return undefined;
} });
const makeNote = (path, frontmatter, content = "# 株式会社テスト — 数据工程") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
const job = makeNote("20_求職/测试/数据工程.md", { type: "job-case", company: "株式会社テスト", case_id: "test-data" });
const oldPrep = makeNote("20_求職/测试/准备_s01.md", { type: "interview-prep", prep_version: 2, company: "株式会社テスト", case: "[[20_求職/测试/数据工程]]", round: "一次面接", session_order: 1, session_status: "completed", date: "2026-01-01" }, "# 株式会社テスト 面接准备\n\n## 纵览与建议\n\n旧轮次正文\n\n## 志望動機\n\n动机\n\n## 逆質問\n\n提问\n\n## 研究资料\n\n资料\n\n## 临场备用\n\n备用\n");
const sessionProps = { notes: [job, oldPrep], today: "2026-01-10", initialContextPath: job.path, onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {} };

test("日历本场无稿：即使同案件已有旧轮次，也只显示公司总览", () => {
  const html = render(sessionExports.default, { ...sessionProps, forceOverviewOnly: true });
  assert.match(html, /公司总览/);
  assert.match(html, /本场尚无准备稿/);
  assert.doesNotMatch(html, /data-selected-prep/);
  assert.match(html, /disabled="" aria-pressed="false">面谈准备/);
  assert.match(html, /class="co-compare-entry">公司对比/);
});

test("普通公司入口仍可选择相关旧稿，精确准备路径始终优先", () => {
  const ordinary = render(sessionExports.default, sessionProps);
  assert.match(ordinary, /data-selected-prep="20_求職\/测试\/准备_s01.md"/);
  assert.match(ordinary, /class="co-compare-entry">公司对比/);
  const exact = render(sessionExports.default, { ...sessionProps, forceOverviewOnly: true, initialPath: oldPrep.path });
  assert.match(exact, /data-selected-prep="20_求職\/测试\/准备_s01.md"/);
  assert.doesNotMatch(exact, /本场尚无准备稿/);
});

test("对比表带「案件 v2 採点」行：无 v2 字段显示未採点文言，有则并排合计与六轴，面谈不读案件", () => {
  const scored = context("已采点岗位");
  scored.note.frontmatter = {
    ...scored.note.frontmatter, rating_version: "v2", fit_score_100: 74, fit_band_final: "B", hard_gate: "hold",
    score_technical_value: 20, score_document_match: 6, score_transferability: 12, score_org_legibility: 16, score_client_deployability: 12, score_role_coherence: 8,
  };
  const meeting = { ...context("面谈"), kind: "meeting", key: "meeting:x" };
  const html = render(components.CompanyCompare, { contexts: [scored, context("未采点岗位"), meeting], onClose() {}, onDetail() {}, onRemove() {}, onOpenWiki() {}, onEdit() {} });
  assert.match(html, /<th scope="row">案件 v2 採点<\/th>/);
  assert.match(html, /<div class="co-case-fit"><strong>Fit 74<\/strong> · Band B · Gate 保留<ul><li>技術価値 20\/25<\/li>/);
  assert.match(html, /<span class="co-muted">未採点（v2）<\/span>/);
  assert.match(html, /<span class="co-muted">面谈 · 无案件采点<\/span>/);
});
