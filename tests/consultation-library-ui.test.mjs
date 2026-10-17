import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const companies = Array.from({ length: 7 }, (_, index) => ({
  id: `company-${index}`, company: `株式会社テスト${index + 1}`, latestDate: `2026-10-${String(index + 1).padStart(2, "0")}`, outcome: "不採用",
  applications: [{ id: `application-${index}`, position: "開発エンジニア", status: "不採用", appliedOn: "2026-09-01", updatedOn: "2026-10-01", channel: "応募サイト" }],
  sessionIds: [`session-${index}`],
}));
const sessions = companies.map((company, index) => ({ id: `session-${index}`, companyId: company.id, company: company.company, date: company.latestDate, round: "一次面接", outcome: "不採用", outcomeKind: "rejected", hasRaw: true, hasReadable: true }));
const catalog = { companies, sessions, updatedAt: "2026-10-10T00:00:00.000Z" };
function transcript(patch = {}) {
  return { ...sessions[0], blocks: [{ id: "q01", title: "これまでの経験", turns: [
    { id: "s01", speaker: "interviewer", text: "担当した業務を教えてください。", uncertain: false },
    { id: "s02", speaker: "self", text: "開発と品質改善を担当しました。", uncertain: false },
    { id: "s03", speaker: "unknown", text: "こちらは確認が必要です。", uncertain: true },
  ] }], raw: "質問の原始転写\n回答の原始転写", notice: "文字起こしは原音未確認です。", ...patch };
}

test("老师入口默认日语，七家公司完整呈现，每个岗位保留当前状态和应募日期", async () => {
  const { ConsultationLibrary } = await loadAppModule("app/consultation/consultation-view.tsx");
  const initial = structuredClone(catalog);
  initial.companies[6].applications.push({ id: "second-role", position: "品質エンジニア", status: "面接中", appliedOn: "2026-09-15", updatedOn: "2026-10-07", channel: "直接応募" });
  const html = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial }));
  assert.match(html, /lang="ja"/);
  assert.match(html, /面接した企業/);
  assert.match(html, /選考の進み方/);
  assert.match(html, /現在の選考状況/);
  assert.match(html, /面接記録/);
  assert.match(html, /資料の読み方/);
  for (const company of companies) assert.ok(html.includes(company.company), company.company);
  assert.match(html, /品質エンジニア/);
  assert.match(html, /面接中/);
  assert.match(html, /2026\.09\.15/);
  assert.match(html, /企業名・職種で検索/);
  assert.match(html, /href="\/api\/consultation\/export\?format=companies"/);
  assert.doesNotMatch(html, /メモを保存|中文辅助|本機で一緒に読む/);
});

test("原稿阅读按面接官和本人区分，未知话者明确提示，不把额外AI评价投影为原稿", async () => {
  const { ConsultationTranscriptReader } = await loadAppModule("app/consultation/consultation-view.tsx");
  const initial = transcript({ aiEvaluation: "评价秘密不应显示", suggestedAnswer: "改善回答秘密不应显示" });
  const html = renderToStaticMarkup(React.createElement(ConsultationTranscriptReader, { initial }));
  assert.match(html, /担当した業務を教えてください。/);
  assert.match(html, /開発と品質改善を担当しました。/);
  assert.match(html, /話者未確認/);
  assert.match(html, /話者・転写に未確認の箇所があります/);
  assert.match(html, /文字起こしは原音未確認です。/);
  assert.match(html, /session=session-0&amp;view=readable/);
  assert.match(html, /原稿の目次/);
  assert.doesNotMatch(html, /评价秘密|改善回答秘密|質問の原始転写/);
});

test("原始转写视图展示原文，Word下载对应当前选定原稿", async () => {
  const { ConsultationTranscriptReader } = await loadAppModule("app/consultation/consultation-view.tsx");
  const html = renderToStaticMarkup(React.createElement(ConsultationTranscriptReader, { initial: transcript(), view: "raw" }));
  assert.match(html, /質問の原始転写/);
  assert.match(html, /回答の原始転写/);
  assert.match(html, /session=session-0&amp;view=raw/);
  assert.doesNotMatch(html, /開発と品質改善を担当しました。/);
});

test("没有可读稿时明确引导原始转写，不提供空白稿下载", async () => {
  const { ConsultationTranscriptReader } = await loadAppModule("app/consultation/consultation-view.tsx");
  const html = renderToStaticMarkup(React.createElement(ConsultationTranscriptReader, { initial: transcript({ blocks: [], hasReadable: false }) }));
  assert.match(html, /可読整理稿はまだありません/);
  assert.match(html, /原始転写を読む/);
  assert.doesNotMatch(html, /href="\/api\/consultation\/export/);
});

test("记忆重构在企业入口和原稿详情都明确标识，不冒充录音逐字转写", async () => {
  const { ConsultationLibrary, ConsultationTranscriptReader } = await loadAppModule("app/consultation/consultation-view.tsx");
  const initial = structuredClone(catalog);
  initial.sessions[0].recordKind = "memory";
  const libraryHtml = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial }));
  assert.match(libraryHtml, /記憶から再構成/);
  assert.match(libraryHtml, /最新の記録を読む/);
  const readerHtml = renderToStaticMarkup(React.createElement(ConsultationTranscriptReader, { initial: transcript({ recordKind: "memory" }) }));
  assert.match(readerHtml, /面接後の記憶から再構成した資料です/);
  assert.match(readerHtml, /録音の逐語転写ではありません/);
  assert.doesNotMatch(readerHtml, /当日の会話を読みやすく整理した原稿です/);
});

test("保留不混入进行中筛选，无原稿的公司不显示空入口", async () => {
  const { filterConsultationCompanies } = await loadAppModule("app/consultation/consultation-view.tsx");
  const held = { ...companies[0], applications: [{ ...companies[0].applications[0], status: "保留（本人確認待ち）" }] };
  const active = { ...companies[1], applications: [{ ...companies[1].applications[0], status: "面接中" }] };
  const empty = { ...companies[2], applications: [] };
  const data = [held, active, empty];
  const records = [sessions[0], sessions[1], { ...sessions[2], hasRaw: false, hasReadable: false }];
  assert.deepEqual(filterConsultationCompanies(data, records, "", "waiting").map(company => company.id), [active.id]);
  assert.deepEqual(filterConsultationCompanies(data, records, "", "unknown").map(company => company.id), [held.id]);
  assert.deepEqual(filterConsultationCompanies(data, records, "", "all").map(company => company.id), [held.id, active.id]);
  assert.equal(filterConsultationCompanies(data, records, empty.company, "all").length, 0);
});

test("公司进展与各轮结果独立筛选，初面通过后终面落选仍能找到先前通过记录", async () => {
  const { filterConsultationCompanies, filterConsultationSessions } = await loadAppModule("app/consultation/consultation-view.tsx");
  const finalCompany = { ...companies[0], reachedFinal: true, hasPassedInterview: true, applications: [{ ...companies[0].applications[0], position: "品質エンジニア" }] };
  const passedCompany = { ...companies[1], reachedFinal: false, hasPassedInterview: true };
  const unknownCompany = { ...companies[2], reachedFinal: false, hasPassedInterview: false };
  const emptyCompany = { ...companies[3], reachedFinal: true, hasPassedInterview: true };
  const records = [
    { ...sessions[0], id: "first-passed", stage: "round-1", outcome: "一次面接通過", outcomeKind: "passed" },
    { ...sessions[0], id: "final-rejected", stage: "final", round: "最終面接", outcome: "不採用", outcomeKind: "rejected" },
    { ...sessions[1], id: "other-passed", stage: "round-1", outcomeKind: "passed" },
    { ...sessions[2], id: "unknown-record", stage: "round-1", outcomeKind: "unknown" },
    { ...sessions[3], id: "empty-record", stage: "final", hasRaw: false, hasReadable: false },
  ];
  const data = [finalCompany, passedCompany, unknownCompany, emptyCompany];
  const ids = values => values.map(value => value.id);
  assert.deepEqual(ids(filterConsultationCompanies(data, records, "", "all", "final")), [finalCompany.id]);
  assert.deepEqual(ids(filterConsultationCompanies(data, records, "", "rejected", "passed")), [finalCompany.id, passedCompany.id]);
  assert.deepEqual(ids(filterConsultationSessions(data, records, "", "all", "final")), ["first-passed", "final-rejected"]);
  assert.deepEqual(ids(filterConsultationSessions(data, records, "", "positive", "final")), ["first-passed"]);
  assert.deepEqual(ids(filterConsultationSessions(data, records, "", "rejected", "final")), ["final-rejected"]);
  assert.deepEqual(ids(filterConsultationSessions(data, records, "品質", "positive", "passed")), ["first-passed"]);
  assert.deepEqual(ids(filterConsultationSessions(data, records, passedCompany.company, "all", "final")), []);
  assert.deepEqual(ids(filterConsultationSessions(data, records, "", "all", "passed", passedCompany.id)), ["other-passed"]);
});

test("进展筛选与搜索、原稿深链接一起写入URL，刷新解析后保持", async () => {
  const { parseConsultationLibraryRoute, consultationLibraryHref } = await loadAppModule("app/consultation/consultation-view.tsx");
  const route = parseConsultationLibraryRoute("?tab=sessions&progress=final&outcome=positive&q=品質&session=test-session&view=raw");
  assert.equal(route.progress, "final");
  assert.equal(route.query, "品質");
  assert.equal(route.outcome, "positive");
  const href = consultationLibraryHref(route);
  assert.match(href, /progress=final/);
  assert.deepEqual(parseConsultationLibraryRoute(href.slice(href.indexOf("?"))), route);
  assert.equal(parseConsultationLibraryRoute("?progress=invalid").progress, "all");
});

test("公司标记历史终面和通过进展，原稿明确标示本轮结果", async () => {
  const { ConsultationLibrary, ConsultationTranscriptReader } = await loadAppModule("app/consultation/consultation-view.tsx");
  const initial = structuredClone(catalog);
  initial.companies[0].reachedFinal = true;
  initial.companies[0].hasPassedInterview = true;
  const html = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial }));
  assert.match(html, /最終面接に進行/);
  assert.match(html, /面接通過あり/);
  const readerHtml = renderToStaticMarkup(React.createElement(ConsultationTranscriptReader, { initial: transcript({ stage: "final", round: "ラウンド" }) }));
  assert.match(readerHtml, /最終面接/);
  assert.match(readerHtml, /この回の結果/);
});

test("案件关联未确认但有真实面试稿时展示最近面试结果，不冒称公司当前选考状态", async () => {
  const { ConsultationLibrary } = await loadAppModule("app/consultation/consultation-view.tsx");
  const company = { ...companies[0], applications: [] };
  const initial = { companies: [company], sessions: [
    { ...sessions[0], id: "earlier", date: "2026-09-01", outcomeKind: "passed", outcome: "一次面接通過" },
    { ...sessions[0], id: "latest", date: "2026-10-01", outcomeKind: "rejected", outcome: "面接後に不採用" },
  ], updatedAt: catalog.updatedAt };
  const html = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial }));
  assert.match(html, /この面接の応募情報は未確認/);
  assert.match(html, /直近の面接結果/);
  assert.match(html, /面接後に不採用/);
  assert.doesNotMatch(html, /一次面接通過|応募情報は未登録/);
});
