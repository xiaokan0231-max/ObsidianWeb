import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

function session(id, date, guide = {}, patch = {}) {
  return { id, companyId: `company-${id}`, company: `株式会社テスト${id}`, date, round: "一次面接", outcome: "進行中", outcomeKind: "waiting", hasRaw: true, hasReadable: true, stage: "round-1", position: "開発エンジニア", readingGuide: { featured: false, excerpts: [], blockCount: 4, ...guide }, ...patch };
}
function catalog(sessions) {
  return { sessions, updatedAt: "2026-10-28", companies: sessions.map(item => ({ id: item.companyId, company: item.company, latestDate: item.date, applications: [], sessionIds: [item.id], outcome: item.outcome })) };
}
function startSection(html) { return html.match(/<section class="consultation-reading-start"[^]*?<\/section>/)?.[0] ?? ""; }

test("首页展示最近一周所有场次，保留终面入口和完整目录", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T03:00:00Z") });
  const { ConsultationLibrary } = await loadAppModule("app/consultation/consultation-view.tsx");
  const items = [session("recent", "2026-10-23"), session("second", "2026-10-22", { introduction: "開発経験について話した面談です。" }), session("final", "2026-10-16", {}, { stage: "final", round: "最終面接" }), session("other", "2026-10-19", { example: true })];
  const html = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial: catalog(items) }));
  const start = startSection(html);
  assert.equal((start.match(/<article /g) ?? []).length, 3);
  assert.match(start, /最近1週間の面接・面談/);
  assert.match(start, /2026.10.17–2026.10.23/);
  assert.match(start, /最終面接/);
  assert.doesNotMatch(start, /ほかの面接/);
  assert.match(start, /<h1 id="reading-start-title">面接相談の資料<\/h1>/);
  assert.doesNotMatch(start, /READING START|次の一歩へ|まずは、ここから/);
  assert.match(start, /開発経験について話した面談です。/);
  assert.doesNotMatch(start, /株式会社テストfinal/);
  assert.match(start, /株式会社テストother/);
  assert.equal((start.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((start.match(/aria-pressed="false"/g) ?? []).length, 1);
  for (const item of items) assert.ok(html.includes(item.company), item.company);
  assert.match(html, /選考の進み方|現在の選考状況/);
  assert.match(start, /data-tour="reading-choice"/);
  assert.match(start, /data-tour="all-materials"/);
  assert.match(html, /id="consultation-materials"/);
});

test("资料不足时只展示实际可读起点，不制造空的终面或补充入口", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T03:00:00Z") });
  const { ConsultationLibrary } = await loadAppModule("app/consultation/consultation-view.tsx");
  const html = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial: catalog([session("only", "2026-10-20")]) }));
  const start = startSection(html);
  assert.equal((start.match(/<article /g) ?? []).length, 1);
  assert.match(start, /is-single/);
  assert.match(start, /株式会社テストonly/);
  assert.equal((start.match(/aria-pressed=/g) ?? []).length, 1);
  assert.doesNotMatch(start, /本人からの相談|相談したいこと|おすすめ|AI評価/);
});

test("卡片显示实际轮次和说明，省略重复的分类标签", async () => {
  const { ReadingStartCard } = await loadAppModule("app/consultation/consultation-view.tsx");
  const html = renderToStaticMarkup(React.createElement(ReadingStartCard, { session: session("sample", "2026-09-20", { introduction: "経験について話した面接です。" }, { stage: "final" }), recent: false, label: "最終面接", onOpen() {}, onExcerpt() {} }));
  assert.match(html, /最終面接/);
  assert.match(html, /経験について話した面接です。/);
  assert.doesNotMatch(html, /consultation-reading-start-badges|最近の面接/);
});

test("无原稿终面卡片只提供历史入口，不创建虚构阅读或批注按钮", async () => {
  const { ReadingHistoryCard } = await loadAppModule("app/consultation/consultation-view.tsx");
  const history = { companyId: "company-history", company: "株式会社テスト履歴", interview: { id: "history-final", date: "2026-09-10", round: "最終面接", stage: "final", outcome: "不採用", outcomeKind: "rejected", evidenceKind: "history" } };
  const html = renderToStaticMarkup(React.createElement(ReadingHistoryCard, { history, onBrowse() {} }));
  assert.match(html, /株式会社テスト履歴/);
  assert.match(html, /2026.09.10/);
  assert.match(html, /原稿未登録/);
  assert.match(html, /面接履歴を見る/);
  assert.doesNotMatch(html, /この原稿を読む|data-tour="start-reading"|data-tour="reading-preview"|session=/);
});

test("起点原问句直接带真实场景，显示为文字而不是HTML", async () => {
  const { ReadingStartCard } = await loadAppModule("app/consultation/consultation-view.tsx");
  const item = session("question", "2026-10-20", { excerpts: [{ blockId: "q02", text: "担当した業務を教えてください。" }, { blockId: "q03", text: "<img src=x onerror=alert(1)>" }] });
  const html = renderToStaticMarkup(React.createElement(ReadingStartCard, { session: item, recent: true, onOpen() {}, onExcerpt() {} }));
  assert.match(html, /原稿にある質問/);
  assert.match(html, /担当した業務を教えてください。/);
  assert.equal((html.match(/aria-label="[^"]*このやり取りを見る"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<small>このやり取りを見る/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /data-tour="reading-preview"/);
  assert.match(html, /data-tour="start-reading"/);
});

test("记忆重构和未知日期保持限制，不把重构文字包装为原问句或最新面试", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T03:00:00Z") });
  const { ConsultationLibrary, ReadingStartCard } = await loadAppModule("app/consultation/consultation-view.tsx");
  const memory = session("memory", "", { excerpts: [{ blockId: "q01", text: "不应当作逐字原句" }] }, { recordKind: "memory" });
  const html = renderToStaticMarkup(React.createElement(ReadingStartCard, { session: memory, recent: false, onOpen() {}, onExcerpt() {} }));
  assert.match(html, /記憶から再構成/);
  assert.match(html, /日付未確認/);
  assert.doesNotMatch(html, /原稿にある質問|不应当作逐字原句|最近の面接/);
  const start = startSection(renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial: catalog([memory]) })));
  assert.doesNotMatch(start, /class="reading-start-recent"/);
});

test("场景参数随场次和显示形式往返，批注参数仍独立保留", async () => {
  const { parseConsultationLibraryRoute, consultationLibraryHref, consultationReadingBlockTarget } = await loadAppModule("app/consultation/consultation-view.tsx");
  const route = parseConsultationLibraryRoute("?session=session-test&block=q02&view=readable&feedbackThread=thread-test&tab=sessions");
  assert.equal(route.blockId, "q02");
  assert.deepEqual(parseConsultationLibraryRoute(consultationLibraryHref(route).split("?")[1]), route);
  const transcript = { id: "session-test", blocks: [{ id: "q02", title: "やり取り", turns: [] }] };
  assert.equal(consultationReadingBlockTarget(transcript, "q02", "readable"), "transcript-block-q02");
  assert.equal(consultationReadingBlockTarget(transcript, "q02", "readable", "thread-test"), null);
  assert.equal(consultationReadingBlockTarget(transcript, "missing", "readable"), null);
  assert.equal(consultationReadingBlockTarget(transcript, "../../private", "readable"), null);
  assert.equal(consultationReadingBlockTarget(transcript, "q02", "raw"), null);
});


test("完整目录初次只显示六行，后续资料由分页保留", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T03:00:00Z") });
  const { ConsultationLibrary } = await loadAppModule("app/consultation/consultation-view.tsx");
  const items = Array.from({ length: 8 }, (_, index) => session(`row${index + 1}`, `2026-10-0${index + 1}`));
  const initial = catalog(items);
  const html = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial }));
  assert.equal((html.match(/class="consultation-company-row"/g) ?? []).length, 6);
  assert.match(html, /1–6 \/ 8/);
  assert.match(html, /1 \/ 2 ページ/);
  assert.match(html, /aria-current="page"/);
  assert.doesNotMatch(html, /株式会社テストrow1|株式会社テストrow2/);
  assert.equal(initial.companies.length, 8);
  assert.equal(initial.sessions.length, 8);
});

test("分页说明当前页并禁用首尾边界，数字按钮仍可选择", async () => {
  const { ConsultationPagination } = await loadAppModule("app/consultation/consultation-view.tsx");
  const render = page => renderToStaticMarkup(React.createElement(ConsultationPagination, { page, pageCount: 3, onChange() {} }));
  const first = render(1), middle = render(2), last = render(3);
  assert.match(first, /<button disabled="">← 前へ<\/button>/);
  assert.match(first, /<button>次へ →<\/button>/);
  assert.match(last, /<button>← 前へ<\/button>/);
  assert.match(last, /<button disabled="">次へ →<\/button>/);
  for (const [index, html] of [first, middle, last].entries()) {
    assert.match(html, /aria-label="資料一覧のページ"/);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.ok(html.includes(`aria-label="${index + 1}ページ目" aria-current="page"`));
  }
});

test("本周无记录仍显示零件和空状态，不回退到陈旧记录", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-01T03:00:00Z") });
  const { ConsultationLibrary, ReadingHistoryCard } = await loadAppModule("app/consultation/consultation-view.tsx");
  const start = startSection(renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial: catalog([session("old-final", "2026-10-01", {}, { stage: "final" })]) })));
  assert.match(start, /最近1週間の面接・面談/);
  assert.match(start, /0<small>件/);
  assert.match(start, /最近1週間の面接・面談の記録はまだありません/);
  assert.doesNotMatch(start, /<article /);
  const html = renderToStaticMarkup(React.createElement(ReadingHistoryCard, { history: { companyId: "history", company: "株式会社テスト", interview: { id: "meeting", date: "2026-10-30", round: "カジュアル面談", stage: "casual" } }, onBrowse() {} }));
  assert.match(html, /カジュアル面談/);
  assert.doesNotMatch(html, /最終面接/);
});

test("本周逐字稿与无稿场次合并按日期排序，同公司多场各有入口", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T03:00:00Z") });
  const { ConsultationLibrary } = await loadAppModule("app/consultation/consultation-view.tsx");
  const initial = catalog([session("transcript", "2026-10-21")]);
  initial.companies.push({ id: "company-history", company: "株式会社テスト履歴", applications: [], sessionIds: [], latestDate: "2026-10-23", interviews: [
    { id: "newer", date: "2026-10-23", stage: "round-2", round: "二次面接", outcome: "進行中", outcomeKind: "waiting" },
    { id: "older", date: "2026-10-19", stage: "round-1", round: "一次面接", outcome: "通過", outcomeKind: "passed" },
  ] });
  const start = startSection(renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial })));
  assert.equal((start.match(/<article /g) ?? []).length, 3);
  assert.match(start, /3<small>件/);
  assert.match(start, /2026.10.23[^]*2026.10.21[^]*2026.10.19/);
  assert.equal((start.match(/面接履歴を見る/g) ?? []).length, 2);
  assert.doesNotMatch(start, /最終面接/);
});
