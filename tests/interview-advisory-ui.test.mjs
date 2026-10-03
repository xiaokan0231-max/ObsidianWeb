import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import * as notes from "../lib/notes.ts";
import * as review from "../lib/review.ts";
import * as feedback from "../lib/review-feedback.ts";
import * as paths from "../lib/review-paths.ts";
import * as clientApi from "../lib/client-api.ts";
import * as routes from "../app/app-route.ts";
import * as filters from "../app/interview-insights-state.ts";

async function component(file, additions = {}) {
  const dependencies = { "@/lib/notes": notes, "@/lib/review": review, "@/lib/review-feedback": feedback, "@/lib/review-paths": paths,
    "@/lib/client-api": clientApi, "./app-route": routes, "./interview-insights-state": filters,
    "./interview-advisory-sync": { useInterviewAdvisorySync: () => ({ state: null, busy: false, error: "", revision: 0, synchronize() {} }) }, ...additions };
  return loadAppModule(`app/${file}`, { stubs: dependencies });
}
const advisoryUi = await component("interview-advisory.tsx");
const insightsUi = await component("interview-insights.tsx", { "./interview-advisory": advisoryUi });
const pathA = "20_求職/株式会社テスト/2026-01-01_一次面接_整理稿.md";
const pathB = "20_求職/株式会社サンプル/2026-01-01_一次面接_整理稿.md";
const evidence = [pathA, pathB].map((sourcePath) => ({ sourcePath, blockId: "q01", sentenceIds: ["s001"] }));
const base = { version: 1, generatedAt: "2026-01-02T00:00:00.000Z", model: "test-model", sourceFingerprint: "test-fingerprint" };
const opinion = { id: "observation_a", titleZh: "项目条件的区别", observationZh: "对方说明客户条件。", interpretationZh: "可能在核对参画范围。", alternativeZh: "具体案件尚未确认。", implicationZh: "需要有具体项目再判断。", evidence, contextPaths: [] };
const report = { ...base, stage: "matching", commentaryZh: "本场综合判断。\n\n另一段判断。", fitZh: "能力与需求的匹配。", recommendationZh: "等待具体项目。", changeConditionsZh: "出现具体项目后重新判断。", evidence, contextPaths: [], observations: [opinion], answerOptions: [], nextSteps: [] };
const note = (path, frontmatter, content) => ({ path, frontmatter, content, name: path.split("/").at(-1), stat: { mtime: 1, ctime: 1, size: 0 } });
const sourceNotes = [note(pathA, { company: "株式会社テスト", date: "2026-01-01", round: "一次面接" }, ""), note(pathB, { company: "株式会社サンプル", date: "2026-01-01", round: "一次面接" }, "")];

test("顾问报告显示判断、未知和建议，并以完整路径区分同日同号证据", () => {
  const html = renderToStaticMarkup(createElement(advisoryUi.AdvisoryReportPanel, { report, notes: sourceNotes, notePath: pathA, onOpenEvidence() {}, onFeedbackSaved() {} }));
  for (const text of ["本场综合判断。", "另一段判断。", "能力与需求的匹配。", "出现具体项目后重新判断。", "其他解释与未知", "具体案件尚未确认。", "对你有什么用"]) assert.ok(html.includes(text));
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
  const evidenceLinks = hrefs.map((href) => new URL(href, "https://example.test")).filter((url) => url.pathname === "/interview/review");
  assert.deepEqual(new Set(evidenceLinks.map((url) => url.searchParams.get("review"))), new Set([pathA, pathB]));
  for (const url of evidenceLinks) { assert.equal(url.searchParams.get("panel"), "source"); assert.equal(url.searchParams.get("block"), "q01"); assert.equal(url.searchParams.get("sentence"), "s001"); }
  assert.doesNotMatch(html, /整体评价|录用概率/);
});

test("观点反馈隔离公司和版本，横向批注也能显示", () => {
  const target = { type: "advisory", id: opinion.id, revision: base.generatedAt, snapshot: JSON.stringify(opinion) };
  const make = (text, change = {}) => feedback.renderReviewFeedbackEntry({ id: "f001", blockId: "", kind: "context", date: "2026-01-02", text, target: { ...target, ...change } });
  const feedbackNotes = [
    note(paths.reviewSiblingPath(pathA, "answerFeedback"), { type: "interview-answer-feedback" }, make("本场正确反馈") + make("旧版反馈", { revision: "2025-12-01T00:00:00Z" })),
    note(paths.reviewSiblingPath(pathB, "answerFeedback"), { type: "interview-answer-feedback" }, make("别家相同ID反馈")),
  ];
  const html = renderToStaticMarkup(createElement(advisoryUi.AdvisoryFeedback, { target, notes: feedbackNotes, notePath: pathA, onSaved() {} }));
  assert.match(html, /本场正确反馈/); assert.match(html, /旧版反馈/); assert.match(html, /此前版本的反馈/); assert.doesNotMatch(html, /别家相同ID反馈/);
  const insightTarget = { ...target, type: "insight" };
  const cross = note("20_求職/_素材/面接横断_顧問批注.md", { type: "interview-insights-feedback" }, feedback.renderReviewFeedbackEntry({ id: "f001", blockId: "", kind: "agree", date: "2026-01-02", text: "横向判断已确认", target: insightTarget }));
  const crossHtml = renderToStaticMarkup(createElement(advisoryUi.AdvisoryFeedback, { target: insightTarget, notes: [cross], notePath: "20_求職/_素材/面接横断_顧問分析.md", onSaved() {} }));
  assert.match(crossHtml, /横向判断已确认/);
});

test("横向筛选保留跨场证据，不把总体综述伪装成子样本结论", () => {
  const finding = { id: "finding_a", titleZh: "两家需求不同", bodyZh: "比较两家的实际条件。", boundaryZh: "只能用于本次两场对照。", evidence, contextPaths: [] };
  const insights = { ...base, overviewZh: "仅适用于全体样本的概述", modules: [{ key: "positioning", titleZh: "双方定位", commentaryZh: "全部场次的模块导读", findings: [finding] }] };
  const coverage = sourceNotes.map((item) => ({ sourcePath: item.path, company: item.frontmatter.company, date: "2026-01-01", round: "一次面接", stage: "matching", status: "ready", reason: "" }));
  const html = renderToStaticMarkup(createElement(insightsUi.InsightsReportView, { report: insights, coverage, filter: { ...filters.EMPTY_INSIGHTS_FILTER, company: "株式会社テスト" }, selected: new Set(), notes: sourceNotes, onOpenEvidence() {}, onFeedbackSaved() {} }));
  assert.match(html, /筛选不会重新计算判断/); assert.match(html, /只能用于本次两场对照/); assert.match(html, /株式会社サンプル/);
  assert.doesNotMatch(html, /仅适用于全体样本的概述|全部场次的模块导读/);
});

test("同公司不同轮次各有独立选中项和状态", () => {
  const coverage = [
    { sourcePath: pathA, company: "株式会社テスト", date: "2026-01-01", round: "一次面接", status: "ready", stage: "technical", reason: "" },
    { sourcePath: pathA.replace("一次", "最終"), company: "株式会社テスト", date: "2026-01-01", round: "最終面接", status: "blocked", reason: "一处原文待裁定" },
  ];
  const html = renderToStaticMarkup(createElement(insightsUi.InsightsCoverage, { coverage, selected: new Set([pathA]), onSelect() {}, onOpen() {} }));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2); assert.equal((html.match(/checked=""/g) ?? []).length, 1);
  assert.match(html, /一次面接/); assert.match(html, /最終面接/); assert.match(html, /一处原文待裁定/);
});

test("单场失败可从横向页面重试，旧横向报告明确标记待更新", async () => {
  const ui = await component("interview-insights.tsx", {
    "./interview-advisory": advisoryUi,
    "./interview-advisory-sync": { useInterviewAdvisorySync: () => ({ busy: false, error: "", state: {
      coverage: [{ sourcePath: pathA, company: "株式会社テスト", date: "2026-01-01", round: "一次面接", status: "stale", lastError: "引用需要核对" }],
      report: { ...base, overviewZh: "原报告", modules: [] }, insightsStatus: "stale",
    }, synchronize() {} }) },
  });
  const html = renderToStaticMarkup(createElement(ui.default, { notes: sourceNotes, onOpenEvidence() {}, onOpenReview() {}, onVaultChanged() {} }));
  assert.match(html, /重试更新/);
  assert.match(html, /有 1 场分析更新失败/);
  assert.match(html, /下面保留上一版横向分析/);
  assert.match(html, /原报告/);
});
