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
  assert.match(html, /応募企業一覧/);
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

test("保留不混入进行中筛选，无应募案件的中介面谈仍可通过对象外筛选找到", async () => {
  const { filterConsultationCompanies } = await loadAppModule("app/consultation/consultation-view.tsx");
  const held = { ...companies[0], applications: [{ ...companies[0].applications[0], status: "保留（本人確認待ち）" }] };
  const active = { ...companies[1], applications: [{ ...companies[1].applications[0], status: "面接中" }] };
  const agency = { ...companies[2], applications: [] };
  const agencySession = { ...sessions[2], outcomeKind: "not-applicable", outcome: "選考対象外" };
  const data = [held, active, agency];
  assert.deepEqual(filterConsultationCompanies(data, [agencySession], "", "waiting").map(company => company.id), [active.id]);
  assert.deepEqual(filterConsultationCompanies(data, [agencySession], "", "unknown").map(company => company.id), [held.id]);
  assert.deepEqual(filterConsultationCompanies(data, [agencySession], "", "not-applicable").map(company => company.id), [agency.id]);
  assert.equal(filterConsultationCompanies(data, [agencySession], "開発エンジニア", "not-applicable").length, 0);
  assert.deepEqual(filterConsultationCompanies(data, [agencySession], agency.company, "not-applicable").map(company => company.id), [agency.id]);
});
