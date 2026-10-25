import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as model from "../lib/company-overview.ts";
import * as prepModel from "../lib/interview-prep-doc.ts";
import { toJobCard } from "../lib/jobs.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// prep-doc-render 用真组件（总结正文的行内渲染要一起验）；lib 依赖与本文件顶上的 import 是同一实例。
const components = await loadAppModule("app/company-overview.tsx");
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const dimensions = (scores, version = 2) => model.companyFitDimensions(version).map((item, index) => ({ ...item, score: scores[index], rationale: `${item.label}的可核对依据`, evidence: [{ label: "公司原文", url: "https://example.com/evidence" }], unknowns: [] }));
const context = (title, version = 2) => ({ key: `case:${title}`, kind: "case", note: { path: `${title}.md`, frontmatter: { type: "job-case", company: "株式会社テスト" }, content: "", tags: [], stat: { ctime: 0, mtime: 0, size: 0 } }, company: "株式会社テスト", title, profile: null, assessment: { criteriaVersion: version, assessedOn: "2026-01-02", aiAuthor: "Codex", summary: `${title}的独立判断`, dimensions: dimensions([4, 3, null, 4, null, 3], version), strengths: ["发挥已有经验"], questions: ["实际职责待确认"], contextFacts: [] }, issues: [] });
const review = (platform, score, overrides = {}) => ({ platform, url: "https://example.com/reviews", status: "available", score, scale: 5, sampleCount: 12, sampleUnit: "名回答者", commentPeriod: "2025年", coverage: "全公司，未确认本岗位团队", positive: [], negative: [], limitations: "样本范围有限", readOn: "2026-01-01", insights: [], ...overrides });
const profile = (reviews = []) => ({ version: 1, updatedOn: "2026-01-01", facts: [], reviews });
const compareProps = { onClose() {}, onDetail() {}, onRemove() {}, onOpenWiki() {} };

test("结论优先，公司故事首段可读、余文可展开且全部来源保留", () => {
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
  assert.ok(html.indexOf("数据平台岗位的独立判断") < html.indexOf(">公司总结</h2>"));
  const prose = [...html.matchAll(/<div class="co-summary-prose">([\s\S]*?)<\/div>/g)].map((match) => match[1]).join("");
  assert.equal((prose.match(/<p>/g) ?? []).length, 4);
  assert.match(html, /<details class="co-summary-continuation"><summary>展开公司故事与招聘背景/);
  assert.ok(html.indexOf("业务软件") < html.indexOf("co-summary-continuation"), "正文开头无需展开即可阅读");
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

test("面谈核实优先呈现三项，余下问题可展开且保持原顺序", () => {
  const item = context("数据平台岗位");
  item.assessment.questions = ["职责范围", "项目安排", "学习支援", "评价机制", "报酬构成"];
  const html = render(components.default, { context: item, onOpenWiki() {} });
  assert.match(html, /<ol><li>职责范围<\/li><li>项目安排<\/li><li>学习支援<\/li><\/ol>/);
  assert.match(html, /<details class="co-more-questions"><summary>其他核实事项 · 2<\/summary><ol start="4"><li>评价机制<\/li><li>报酬构成<\/li><\/ol><\/details>/);
  assert.match(html, /<h2 id="[^"]+-reviews-title" tabindex="-1">外部评价<\/h2>/);
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

test("满八个禁用新加入，但已选项仍可移除；单项托盘不能开始比较", () => {
  const item = context("数据平台岗位");
  assert.match(render(components.CompanyCompareButton, { context: item, compared: false, full: true, onToggle() {} }), /disabled=""/);
  assert.doesNotMatch(render(components.CompanyCompareButton, { context: item, compared: true, full: true, onToggle() {} }), /disabled=/);
  const tray = render(components.CompanyCompareTray, { contexts: [item], onRemove() {}, onClear() {}, onOpen() {} });
  assert.match(tray, /disabled="">再选 1 项即可对比/);
  assert.match(tray, /aria-label="移除株式会社テスト 数据平台岗位"/);
  assert.match(tray, /1 \/ 8 已选/);
  assert.match(render(components.CompanyCompareButton, { context: item, compared: false, full: true, onToggle() {} }), /已选满 8 项/);
});

test("同公司不同岗位保持分列，比较使用原始平台量尺与独立维度", () => {
  const first = context("平台开发"), second = context("分析工程");
  first.profile = profile([review("OpenWork", 3.2), review("転職会議", 4.1, { sampleCount: 28, sampleUnit: "条分类评论" })]);
  const html = render(components.CompanyCompare, { contexts: [first, second], onClose() {}, onDetail() {}, onRemove() {}, onOpenWiki() {} });
  assert.match(html, /平台开发的独立判断/);
  assert.match(html, /分析工程的独立判断/);
  assert.equal((html.match(/class="co-fit-pips(?: unknown)?"/g) ?? []).length, 12);
  assert.doesNotMatch(html, /class="co-radar/);
  assert.match(html, /3\.20<small> \/ 5/);
  assert.match(html, /4\.10<small> \/ 5/);
  assert.match(html, /12 名回答者/);
  assert.match(html, /28 条分类评论/);
  assert.match(html, /样本范围有限/);
  assert.match(html, /style="width:64%"/, "平台分通过自己的五分量尺显示刻度");
  assert.match(html, /aria-label="资料不足，未评分"/);
  assert.match(html, /aria-label="从对比移除株式会社テスト 平台开发"/);
  assert.match(html, /aria-label="从对比移除株式会社テスト 分析工程"/);
  assert.match(html, /aria-label="关闭对比"/);
  assert.doesNotMatch(html, /応募优先度|job-compare-rating/);
});

test("平台别名使用同一最新评分及样本来源，不把旧记录元数据拼到新分数上", () => {
  const item = context("别名平台岗位");
  item.profile = profile([
    review("転職会議", 2.1, { readOn: "2026-01-01", sampleCount: 4, sampleUnit: "条旧样本", url: "https://example.com/reviews/old", coverage: "旧记录范围", limitations: "旧记录限制", commentPeriod: "2024年旧期间" }),
    review("JobTalk", 4.6, { readOn: "2026-01-09", sampleCount: 37, sampleUnit: "条分类评论", url: "https://example.com/reviews/latest", coverage: "最新工程师样本范围", limitations: "最新样本限制", commentPeriod: "2025～2026年最新期间" }),
  ]);
  const conflicted = { ...context("同日冲突岗位"), profile: profile([
    review("転職会議", 3.7, { readOn: "2026-01-09" }),
    review("TenshokuKaigi", 4.1, { readOn: "2026-01-09" }),
  ]) };
  const html = render(components.CompanyCompare, { ...compareProps, contexts: [item, conflicted] });
  assert.match(html, /4\.60<small> \/ 5/);
  assert.match(html, /37 条分类评论/);
  assert.match(html, /href="https:\/\/example.com\/reviews\/latest"/);
  assert.match(html, /最新工程师样本范围/);
  assert.match(html, /最新样本限制/);
  assert.match(html, /2026-01-09 读取 · 2025～2026年最新期间/);
  assert.match(html, /style="width:92/);
  assert.doesNotMatch(html, /2\.10|条旧样本|reviews\/old|旧记录范围|旧记录限制|2024年旧期间/);
  assert.match(html, /评分记录待核对/);
  assert.doesNotMatch(html, /3\.70<small>|4\.10<small>/, "同日别名记录冲突时不能任意取一个分数展示");

  const selector = render(components.CompanyCompareSelector, { contexts: [item], selected: [], onToggle() {}, onClose() {}, onCompare() {} });
  assert.match(selector, />4\.60<\/strong>/);
  assert.match(selector, /title="転職会議 · 37 条分类评论 · 2026-01-09\n最新工程师样本范围"/);
  assert.doesNotMatch(selector, /2\.10|条旧样本|旧记录范围/);
});

test("评价保留原话、中文解释、员工来源及岗位启示，比较中可展开阅读", () => {
  const item = context("数据平台岗位");
  item.profile = { updatedOn: "2026-01-03", facts: [], reviews: [{ platform: "员工评价平台", url: "https://example.com/reviews", status: "available", score: 3.8, scale: 5, sampleCount: 20, sampleUnit: "名回答者", commentPeriod: "2025～2026年", coverage: "内部营业员工，不能外推客户项目", positive: ["旧主题摘要"], negative: [], limitations: "抽读两名员工，不代表全部回答者", readOn: "2026-01-03", insights: [{ title: "自主性与支援要一起看", kind: "mixed", summary: "一名员工描述了自主决定的空间，也提到支援因项目而异。", implication: "确认首个项目如何分配，以及遇到问题时的支援负责人。", evidence: [{ url: "https://example.com/reviews/one", publishedOn: "2026-01-02", role: "营业／在职／中途入社", quote: "相談しやすい環境です。", paraphrase: "这名员工认为日常沟通比较方便。" }, { url: "https://example.com/reviews/two", publishedOn: "2025-12-03", role: "营业／已离职", paraphrase: "另一名员工的体验取决于所在项目。" }] }] }] };
  const html = render(components.default, { context: item, onOpenWiki() {} });
  assert.match(html, /20 名回答者/);
  assert.match(html, /内部营业员工，不能外推客户项目/);
  assert.match(html, /<blockquote lang="ja" cite="https:\/\/example.com\/reviews\/one">相談しやすい環境です。<\/blockquote>/);
  assert.match(html, /营业／在职／中途入社/);
  assert.match(html, /<time dateTime="2026-01-02">/);
  assert.match(html, /这名员工认为日常沟通比较方便/);
  assert.match(html, /确认首个项目如何分配/);
  assert.match(html, /href="https:\/\/example.com\/reviews\/two"/);
  assert.doesNotMatch(html, /旧主题摘要/, "完整主题取代短摘要，避免重复");
  assert.equal((html.match(/<blockquote /g) ?? []).length, 1, "没有原句的来源只显示释义，不伪装成引述");
  const compared = render(components.CompanyCompare, { contexts: [item, context("另一个岗位")], onClose() {}, onDetail() {}, onRemove() {}, onOpenWiki() {} });
  assert.match(compared, /<details class="co-signal mixed"><summary>/);
  assert.match(compared, /自主性与支援要一起看/);
  assert.match(compared, /一名员工描述了自主决定的空间，也提到支援因项目而异/);
  assert.match(compared, /href="https:\/\/example.com\/reviews\/one"/);
  assert.match(compared, /确认首个项目如何分配/);
  assert.match(compared, /aria-pressed="false">外部口碑/);
  assert.doesNotMatch(compared, /co-review-readings|相談しやすい環境です。/, "默认概览只提炼关键信号，原文在口碑页按需阅读");
});

test("外部总结先于平台与摘录，正文连续可读，阅读边界、日期、署名及来源可核对", () => {
  const item = context("数据平台岗位");
  item.profile = { updatedOn: "2026-01-03", facts: [], reviews: [{ platform: "员工评价平台", status: "available", score: 3.5, scale: 5, sampleCount: 8,
    commentPeriod: "2025年", coverage: "两个部门", positive: [], negative: [], readOn: "2026-01-03", limitations: "员工个人经历", insights: [] }],
    reviewSynthesis: { asOf: "2026-01-03", aiAuthor: "Codex", coverage: "抽读两个部门；旧评价不能代表当前项目。", paragraphs: ["综合来看，**项目差异**比平台均分更需要关注。", "[员工原文](https://example.com/reviews/one)反映沟通方式有所不同。", "<script>alert(1)</script>只是文字；需要在面谈核实。"].map(prepModel.parseInline),
      sources: [{ label: "员工回答", url: "https://example.com/reviews/one" }, { label: "研究记录", wiki: "[[80_AI分析/外部评价研究]]" }] } };
  const html = render(components.default, { context: item, onOpenWiki() {} });
  assert.ok(html.indexOf("外部评价总结") < html.indexOf("员工评价平台"));
  const synthesis = html.match(/<section class="co-review-synthesis"[\s\S]*?<\/section>/)?.[0];
  assert.ok(synthesis);
  assert.match(synthesis, /<strong><span>项目差异<\/span><\/strong>/);
  assert.match(synthesis, /href="https:\/\/example.com\/reviews\/one"/);
  assert.match(synthesis, /<time dateTime="2026-01-03">2026-01-03<\/time> · Codex/);
  assert.match(synthesis, /抽读两个部门；旧评价不能代表当前项目/);
  assert.match(synthesis, /<details class="co-review-synthesis-sources"><summary>总结依据 · 2 项<\/summary>/);
  assert.match(synthesis, />研究记录 ↗<\/button>/);
  assert.match(synthesis, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(synthesis, /<script>|co-review-synthesis-more|hidden=|aria-hidden/);
  assert.equal((synthesis.match(/<p>/g) ?? []).length, 3, "所有保存的正文自然段均显示");

  const compared = render(components.CompanyCompare, { contexts: [item, context("另一岗位")], onClose() {}, onDetail() {}, onRemove() {}, onOpenWiki() {} });
  assert.match(compared, /aria-pressed="true">一眼看差异/);
  assert.match(compared, /aria-pressed="false">外部口碑/);
  assert.match(compared, /aria-pressed="false">职责与条件/);
  assert.doesNotMatch(compared, /co-review-synthesis compact|co-review-synthesis-more|反映沟通方式有所不同|需要在面谈核实/, "长篇总结不堆在默认概览，完整阅读仍由独立口碑视图承接");
});

// SSR 没有交互点击；只把真实组件的初始标签设为口碑，其他 React 状态与正文渲染照常执行。
const reactForReviewTab = await import("react");
const reviewTabComponents = await loadAppModule("app/company-overview.tsx", { stubs: {
  react: { ...reactForReviewTab, useState: (initial) => reactForReviewTab.useState(initial === "overview" ? "reviews" : initial) },
} });
const renderReviewCompare = (contexts) => render(reviewTabComponents.CompanyCompare, { ...compareProps, contexts, embedded: true });

test("并排口碑总结默认显示两段，余文、范围和来源仍完整保留", () => {
  const item = context("两段概要岗位");
  item.profile = { ...profile(), reviewSynthesis: { asOf: "2026-01-03", aiAuthor: "Codex", coverage: "仅覆盖两名测试员工，部门未确认。",
    paragraphs: ["第一段说明已有机会。", "第二段说明具体代价与[资料](https://example.com/context)。", "第三段保留需要进一步核实的条件。"].map(prepModel.parseInline),
    sources: [{ label: "员工资料", url: "https://example.com/source" }] } };
  const html = renderReviewCompare([item, context("另一岗位")]);
  assert.match(html, /aria-pressed="true">外部口碑/);
  const synthesis = html.match(/<section class="co-review-synthesis compact"[\s\S]*?<\/section>/)?.[0];
  assert.ok(synthesis);
  const lead = synthesis.split('<details class="co-review-synthesis-more">')[0];
  assert.match(lead, /第一段说明已有机会/);
  assert.match(lead, /第二段说明具体代价/);
  assert.match(lead, /href="https:\/\/example.com\/context"/);
  assert.equal((lead.match(/<p>/g) ?? []).length, 2);
  assert.doesNotMatch(lead, /第三段/);
  assert.match(synthesis, /<details class="co-review-synthesis-more"><summary>展开完整总结<\/summary>[\s\S]*第三段保留需要进一步核实的条件/);
  assert.match(synthesis, /仅覆盖两名测试员工，部门未确认/);
  assert.match(synthesis, /2026-01-03<\/time> · Codex/);
  assert.match(synthesis, /总结依据 · 1 项/);
  assert.match(synthesis, /href="https:\/\/example.com\/source"/);
  const sources = synthesis.match(/<details class="co-review-synthesis-sources">[\s\S]*?<\/details>/)?.[0];
  assert.ok(sources);
  assert.match(sources, /<summary>总结依据 · 1 项<\/summary><p class="co-review-synthesis-coverage">仅覆盖两名测试员工，部门未确认。<\/p>/);
  assert.match(sources, /href="https:\/\/example.com\/source"/);
  assert.doesNotMatch(synthesis.split('<details class="co-review-synthesis-sources">')[0], /仅覆盖两名测试员工，部门未确认/, "紧凑对比默认先展示判断，范围与依据一起展开");
  item.profile.reviewSynthesis.paragraphs = item.profile.reviewSynthesis.paragraphs.slice(0, 2);
  assert.doesNotMatch(renderReviewCompare([item]), /co-review-synthesis-more/, "只有两段时不生成空的继续阅读入口");
});

const theme = (title, kind, index) => ({ title, kind, summary: `${title}的已有员工说明。`, implication: "核对当前项目的实际安排。",
  evidence: [{ url: `https://example.com/theme/${index}`, publishedOn: "2026-01-02", role: "测试工程师／在职", quote: "相談する機会があります。", paraphrase: "这位测试员工描述了讨论机会。" }] });

test("主题预览优先展示已有机会和顾虑，标题去重，完整主题与原文仍可展开", () => {
  const item = context("主题预览岗位");
  item.profile = profile([
    review("OpenWork", 3.6, { insights: [theme("专业交流的机会", "positive", 1), theme("其他成长方式", "positive", 2), theme("机会也取决于安排", "mixed", 3)] }),
    review("転職会議", 3.4, { insights: [theme("专业交流的机会", "positive", 4), theme("配属支持需要核实", "concern", 5), theme("其他工时问题", "concern", 6)] }),
  ]);
  const html = renderReviewCompare([item]);
  const preview = html.match(/<ul class="co-theme-preview"[^>]*>[\s\S]*?<\/ul>/)?.[0];
  assert.ok(preview);
  assert.equal((preview.match(/<li /g) ?? []).length, 2);
  assert.match(preview, /<li[^>]*class="positive"><span>OpenWork<\/span><strong>专业交流的机会<\/strong>/);
  assert.match(preview, /<li[^>]*class="concern"><span>転職会議<\/span><strong>配属支持需要核实<\/strong>/);
  assert.equal((preview.match(/专业交流的机会/g) ?? []).length, 1, "同标题跨平台重复时预览只显示一次");
  assert.doesNotMatch(preview, /其他成长方式|机会也取决于安排|其他工时问题/);
  assert.match(html, /class="co-theme-cell">[\s\S]*<details class="co-board-expand"><summary>6 个主题 · 查看原文与阅读边界/);
  for (const title of ["其他成长方式", "机会也取决于安排", "其他工时问题"]) assert.match(html, new RegExp(title));
  assert.match(html, /href="https:\/\/example.com\/theme\/6"/);
  assert.match(html, /<blockquote lang="ja" cite="https:\/\/example.com\/theme\/5">相談する機会があります。/);
  assert.match(html, /样本范围有限/);
});

test("主题类别不齐时按已有顺序补足，无结构化主题时不从短摘要造预览", () => {
  const item = context("缺少顾虑主题的岗位");
  item.profile = profile([review("OpenWork", 3.8, { insights: [theme("先看到的两面线索", "mixed", 1), theme("后看到的具体机会", "positive", 2), theme("额外线索", "positive", 3)] })]);
  const html = renderReviewCompare([item]);
  const preview = html.match(/<ul class="co-theme-preview"[^>]*>[\s\S]*?<\/ul>/)?.[0];
  assert.ok(preview);
  assert.ok(preview.indexOf("先看到的两面线索") < preview.indexOf("后看到的具体机会"));
  assert.doesNotMatch(preview, /class="concern"|额外线索/);
  item.profile = profile([review("OpenWork", 3.8, { insights: [], positive: ["旧的正面短摘要"], negative: ["旧的顾虑短摘要"] })]);
  const legacy = renderReviewCompare([item]);
  assert.doesNotMatch(legacy, /co-theme-preview/);
  assert.match(legacy, /0 个主题 · 查看原文与阅读边界/);
  assert.match(legacy, /旧的正面短摘要|旧的顾虑短摘要/, "旧资料仍保留在完整评价中");
});

test("未保存外部总结时不从平台均分或正负主题拼出总结，也不影响旧评价", () => {
  const item = context("数据平台岗位");
  item.profile = { updatedOn: "2026-01-03", facts: [], reviews: [] };
  for (const reviewSynthesis of [undefined, null]) {
    item.profile.reviewSynthesis = reviewSynthesis;
    const html = render(components.default, { context: item, onOpenWiki() {} });
    assert.doesNotMatch(html, /co-review-synthesis|外部评价总结/);
    assert.match(html, /尚未收录可核对的外部评价/);
  }
});

function storyAndReviewContext() {
  const item = context("数据平台岗位");
  item.summary = { note: { path: "80_AI分析/公司研究.md" }, schemaVersion: 1, assessedOn: "2026-01-03", aiAuthor: "Codex", coveragePeriod: "2025年资料",
    paragraphs: ["企业业务故事。", "公司故事里原有的员工观察仍完整保留。"].map(prepModel.parseInline), sources: [{ label: "企业业务原文", url: "https://example.com/business" }] };
  item.profile = { updatedOn: "2026-01-03", facts: [{ id: "business", label: "业务", value: "业务软件开发", asOf: "2026-01-03", scope: "公司公开资料", sources: [{ label: "业务资料", url: "https://example.com/business" }] }],
    reviewSynthesis: { asOf: "2026-01-03", aiAuthor: "Codex", paragraphs: ["员工评价的总体综合判断。"].map(prepModel.parseInline), coverage: "实读两名工程师，部门未知。", sources: [{ label: "员工原文", url: "https://example.com/reviews/one" }] },
    reviews: [{ platform: "员工评价平台", url: "https://example.com/reviews", status: "available", score: 3.7, scale: 5, sampleCount: 9, sampleUnit: "名回答者", commentPeriod: "2025年", coverage: "定向阅读工程师个体体验", positive: [], negative: [], readOn: "2026-01-03", limitations: "不代表当前岗位安排", insights: [{ title: "机会与支持需要一起看", kind: "mixed", summary: "员工描述了交流机会和项目差异。", implication: "核对具体配属与资源。", evidence: [{ url: "https://example.com/reviews/one", publishedOn: "2025-12-01", role: "工程师／中途／在职", quote: "相談する機会があります。", paraphrase: "该回答者认为可以找同事讨论。" }] }] }] };
  return item;
}

test("故事模式保留公司总结、事实与契合画像，外部评价详情由独立入口承接", () => {
  const item = storyAndReviewContext();
  const html = render(components.default, { context: item, view: "story", onOpenWiki() {}, onOpenReviews() {} });
  assert.match(html, /class="company-overview co-view-story"/);
  assert.match(html, /数据平台岗位的独立判断/);
  assert.match(html, /企业业务故事/);
  assert.match(html, /公司故事里原有的员工观察仍完整保留/);
  assert.match(html, /业务软件开发/);
  assert.match(html, /class="co-radar"/);
  assert.match(html, /<button type="button">查看外部评价 →<\/button>/);
  assert.doesNotMatch(html, /class="co-external"|class="co-review-synthesis"|class="co-review-platform"|员工评价的总体综合判断|3\.7<small>/);
  assert.doesNotMatch(html, /href="#[^"]+-reviews"/);
  const fallback = render(components.default, { context: item, view: "story", onOpenWiki() {} });
  assert.match(fallback, /href="#[^"]+-reviews">查看外部评价 ↓<\/a>/);
});

test("独立外部评价模式完整展示总结、平台、主题、员工论据与范围，不混入故事和岗位结论", () => {
  const html = render(components.default, { context: storyAndReviewContext(), view: "reviews", onOpenWiki() {} });
  assert.match(html, /class="company-overview co-view-reviews"/);
  assert.match(html, /<h2 id="[^"]+-reviews-title" tabindex="-1">外部评价<\/h2>/);
  assert.match(html, /员工评价的总体综合判断/);
  assert.match(html, /实读两名工程师，部门未知/);
  assert.match(html, /员工评价平台/);
  assert.match(html, /3\.7<small> \/ 5/);
  assert.match(html, /9 名回答者/);
  assert.match(html, /机会与支持需要一起看/);
  assert.match(html, /相談する機会があります。/);
  assert.match(html, /不代表当前岗位安排/);
  assert.match(html, /总结依据 · 1 项/);
  assert.doesNotMatch(html, /co-dates|co-fit-section|co-radar|co-company-context|企业业务故事|业务软件开发|数据平台岗位的独立判断|<span>03<\/span>/);
});

test("默认full兼容完整页面；独立评价模式在未关联或无口碑时保留轻量空态", () => {
  for (const view of [undefined, "full"]) {
    const html = render(components.default, { context: storyAndReviewContext(), view, onOpenWiki() {} });
    assert.match(html, /class="company-overview"/);
    assert.match(html, /co-fit-section/);
    assert.match(html, /企业业务故事/);
    assert.match(html, /业务软件开发/);
    assert.match(html, /员工评价的总体综合判断/);
    assert.match(html, /class="co-external"/);
    assert.match(html, /<span>03<\/span>/);
    assert.match(html, /href="#[^"]+-reviews">查看外部评价 ↓<\/a>/);
  }
  for (const item of [null, context("资料未补齐")]) {
    const html = render(components.default, { context: item, view: "reviews", onOpenWiki() {} });
    assert.match(html, /尚未收录可核对的外部评价/);
    assert.match(html, /co-external/);
    assert.doesNotMatch(html, /co-fit-section|co-radar|公司总结待整理|co-summary-empty|资料未补齐的独立判断/);
  }
});

test("新旧口径混选保留平台口碑和独立判断，禁止把不同契合维度混画", () => {
  const first = context("旧岗位", 1), second = context("新岗位", 2);
  first.profile = profile([review("OpenWork", 4.2)]);
  second.profile = profile([review("転職会議", 2.8)]);
  const html = render(components.CompanyCompare, { ...compareProps, contexts: [first, second], onEdit() {} });
  assert.match(html, /所选画像的评价维度不同，暂不并排比较六维契合刻度。/);
  assert.match(html, /旧岗位的独立判断/);
  assert.match(html, /新岗位的独立判断/);
  assert.match(html, /更换公司/);
  assert.match(html, /4\.20<small> \/ 5/);
  assert.match(html, /2\.80<small> \/ 5/);
  assert.doesNotMatch(html, /class="co-radar|class="co-dimension|class="co-fit-pips|契合刻度 · 满分 5/);
});

test("选择器满八项后仅第九项禁用，已选项和清空入口仍可使用", () => {
  const items = Array.from({ length: 9 }, (_, index) => context(`测试岗位${index + 1}`));
  const props = { contexts: items, onToggle() {}, onClose() {}, onCompare() {} };
  const empty = render(components.CompanyCompareSelector, { ...props, selected: [] });
  assert.match(empty, /aria-label="选择公司对比"/);
  assert.equal((empty.match(/type="checkbox"/g) ?? []).length, 9);
  assert.match(empty, /disabled="">开始对比/);
  const full = render(components.CompanyCompareSelector, { ...props, selected: items.slice(0, 8) });
  const checkboxes = full.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
  assert.equal(checkboxes.length, 9);
  assert.equal(checkboxes.filter((input) => /checked=""/.test(input)).length, 8);
  assert.equal(checkboxes.filter((input) => /disabled=""/.test(input)).length, 1);
  assert.ok(checkboxes.filter((input) => /checked=""/.test(input)).every((input) => !/disabled=/.test(input)));
  assert.match(full, /8 \/ 8 已选 · 已选满，可移除后更换/);
  assert.match(full, /class="co-selection-clear">清空/);
  assert.match(full, /aria-label="关闭公司选择"/);
  assert.doesNotMatch(full, /disabled="">开始对比/);
});

test("选择器提供四组明确快捷选择，公司资料不完整也不隐藏已有关联资料的公司", () => {
  const prepared = context("已评估平台开发");
  const researched = { ...context("仅有资料的分析工程"), assessment: null, profile: profile([review("OpenWork", 4.4), review("転職会議", 3.3)]) };
  researched.company = "株式会社テスト研究";
  researched.note.frontmatter = { ...researched.note.frontmatter, company: researched.company, case_id: "test-research", status: "面接中", channel: "测试媒体", next_event_at: "2026-01-12 13:00", next_event_label: "一次面接", origin: "scout" };
  researched.profile.facts = [{ id: "business", label: "业务", value: "制造数据分析与传感器运用", asOf: "2026-01-01", scope: "公司公开资料", sources: [] }];
  const unrelated = { ...context("尚无资料的其他岗位"), assessment: null };
  const props = { contexts: [unrelated, prepared, researched], selected: [], notes: [researched.note], today: "2026-01-10", onToggle() {}, onClose() {}, onCompare() {} };
  const html = render(components.CompanyCompareSelector, props);
  const presets = html.match(/<div class="co-quick-picks"[\s\S]*?<\/div>/)?.[0];
  assert.ok(presets);
  assert.equal((presets.match(/<button /g) ?? []).length, 4);
  for (const label of ["即将面谈", "最近面过", "OpenWork 高分", "転職会議 高分"]) assert.match(presets, new RegExp(label));
  assert.match(presets, /替换当前所选，之后仍可增删/);
  assert.match(html, /aria-pressed="true">相关公司/);
  assert.match(html, /placeholder="想不起来名字？也可以搜岗位、业务或渠道"/);
  assert.match(html, /<h3 title="株式会社テスト研究">テスト研究<\/h3>/);
  assert.match(html, /制造数据分析与传感器运用/);
  assert.match(html, /下次 2026-01-12 13:00/);
  assert.match(html, /data-origin="invited">主动邀约/);
  assert.match(html, /测试媒体/);
  assert.match(html, /面接中/);
  assert.match(html, /公司资料已整理/);
  assert.match(html, /已有契合评价/);
  assert.match(html, />4\.40<\/strong>/);
  assert.match(html, />3\.30<\/strong>/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /aria-label="テスト · 尚无资料的其他岗位"/);
  assert.ok(html.indexOf('aria-label="テスト研究 · 仅有资料的分析工程"') < html.indexOf('aria-label="テスト · 已评估平台开发"'), "已确认近期面谈先于仅有旧画像的公司");
  const selected = render(components.CompanyCompareSelector, { ...props, selected: [unrelated] });
  assert.match(selected, /aria-label="テスト · 尚无资料的其他岗位"/);
  assert.match(selected, /资料待补 · 仍可对比/);
});

test("外部平台缺分按真实原因留空，资料独立存在时仍能对比", () => {
  const items = [
    { ...context("未调查岗位"), assessment: null, profile: profile() },
    { ...context("无员工样本岗位"), assessment: null, profile: profile([review("OpenWork", null, { status: "no_samples", scale: null, sampleCount: 0 })]) },
    { ...context("仅面试体验岗位"), assessment: null, profile: profile([review("転職会議", null, { sampleUnit: "条面试体验" })]) },
    { ...context("访问受限岗位"), assessment: null, profile: profile([review("OpenWork", null, { status: "restricted" })]) },
  ];
  const html = render(components.CompanyCompare, { ...compareProps, contexts: items });
  for (const label of ["尚未调查", "无有效员工样本", "仅面试体验", "正文访问受限"]) assert.match(html, new RegExp(label));
  assert.equal((html.match(/class="co-company-detail"/g) ?? []).length, 4);
  assert.equal((html.match(/class="co-score-number">—<\/strong>/g) ?? []).length, 8);
  assert.doesNotMatch(html, /0\.00|style="width:0%"/);
  assert.match(html, /向右滚动查看更多公司/);
  assert.match(html, /没有足够证据判断岗位契合；外部口碑仍可独立比较/);
});

test("加入按钮与选择器的状态切换共用八项上限，取消后可替换且不重复加入", () => {
  let paths = [];
  const candidates = Array.from({ length: 9 }, (_, index) => `测试岗位${index + 1}.md`);
  for (const path of candidates) paths = components.toggleCompanyComparison(paths, path);
  assert.equal(components.COMPANY_COMPARE_LIMIT, 8);
  assert.deepEqual(Array.from(paths), candidates.slice(0, 8));
  paths = components.toggleCompanyComparison(paths, candidates[1]);
  paths = components.toggleCompanyComparison(paths, candidates[8]);
  assert.deepEqual(Array.from(paths), [...candidates.slice(0, 1), ...candidates.slice(2)]);
  paths = components.toggleCompanyComparison(paths, candidates[8]);
  assert.equal(paths.length, 7);
  assert.ok(!paths.includes(candidates[8]));
});

// 用真实会话入口验证日历已确定「本场没有准备稿」时不会借用同案件旧轮次。
const sessionExports = await loadAppModule("app/interview-session.tsx", { stubs: (specifier) => {
  if (specifier === "./company-overview") return components;
  if (specifier === "./interview-session-v2") return { default: ({ doc, companyAction }) => createElement("div", { "data-selected-prep": doc.note.path }, doc.round, companyAction) };
  if (specifier === "./ui-locale") return undefined;
  if (specifier.startsWith("./")) return { Blocks() {}, Inlines() {}, default() {}, PrepSearchBox() {}, useSlashFocus() {}, copySelectionWithoutRuby() {} };
  return undefined;
} });
const makeNote = (path, frontmatter, content = "# 株式会社テスト — 数据工程") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
const job = makeNote("20_求職/测试/数据工程.md", { type: "job-case", company: "株式会社テスト", case_id: "test-data" });
const oldPrep = makeNote("20_求職/测试/准备_s01.md", { type: "interview-prep", prep_version: 2, company: "株式会社テスト", case: "[[20_求職/测试/数据工程]]", round: "一次面接", session_order: 1, session_status: "completed", date: "2026-01-01" }, "# 株式会社テスト 面接准备\n\n## 纵览与建议\n\n旧轮次正文\n\n## 志望動機\n\n动机\n\n## 逆質問\n\n提问\n\n## 研究资料\n\n资料\n\n## 临场备用\n\n备用\n");
const sessionProps = { notes: [job, oldPrep], today: "2026-01-10", initialContextPath: job.path, onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {}, onOpenInsights() {} };

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

test("默认概览区分平台口碑与案件百分制采点，详细案件条件留在独立入口", () => {
  const scored = context("已采点岗位");
  scored.note.frontmatter = {
    ...scored.note.frontmatter, rating_version: "v2", fit_score_100: 74, fit_band_final: "B", hard_gate: "hold",
    score_technical_value: 20, score_document_match: 6, score_transferability: 12, score_org_legibility: 16, score_client_deployability: 12, score_role_coherence: 8,
  };
  scored.profile = profile([review("OpenWork", 4.2)]);
  scored.profile.facts = [{ id: "compensation", label: "报酬条件", value: "待双方确认的测试条件", asOf: "2026-01-01", scope: "测试岗位", sources: [] }];
  const meeting = { ...context("面谈"), kind: "meeting", key: "meeting:x" };
  const unscored = context("未采点岗位");
  assert.equal(toJobCard(scored.note).fit?.score, 74, "案件自身的百分制采点仍有独立正本");
  assert.equal(toJobCard(scored.note).fit?.band, "B");
  assert.equal(toJobCard(unscored.note).fit, null);
  const html = render(components.CompanyCompare, { ...compareProps, contexts: [scored, unscored, meeting], onEdit() {} });
  assert.match(html, /aria-pressed="true">一眼看差异/);
  assert.match(html, /aria-pressed="false">职责与条件/);
  assert.match(html, /4\.20<small> \/ 5/);
  assert.match(html, /class="co-fit-pips" aria-label="4 \/ 5"/);
  assert.doesNotMatch(html, /co-case-fit|co-jobfit-meter|Fit 74|74%|案件 v2 採点|报酬条件|待双方确认的测试条件/, "概览不能把百分彩点、条件长文和平台五分评分铺成一张大表");
});
