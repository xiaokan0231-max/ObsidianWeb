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

test("起点以最近两场开始，终面和补充例子有独立入口，完整目录保留全部公司", async () => {
  const { ConsultationLibrary } = await loadAppModule("app/consultation/consultation-view.tsx");
  const items = [session("recent", "2026-10-23"), session("second", "2026-10-22", { introduction: "開発経験について話した面談です。" }), session("final", "2026-10-18", {}, { stage: "final", round: "最終面接" }), session("other", "2026-10-19", { example: true })];
  const html = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial: catalog(items) }));
  const start = startSection(html);
  assert.equal((start.match(/<article /g) ?? []).length, 2);
  assert.match(start, /最近の面接/);
  assert.match(start, /最終面接/);
  assert.match(start, /ほかの面接/);
  assert.match(start, /開発経験について話した面談です。/);
  assert.doesNotMatch(start, /株式会社テストfinal|株式会社テストother/);
  assert.equal((start.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((start.match(/aria-pressed="false"/g) ?? []).length, 2);
  for (const item of items) assert.ok(html.includes(item.company), item.company);
  assert.match(html, /選考の進み方|現在の選考状況/);
  assert.match(start, /data-tour="reading-choice"/);
  assert.match(start, /data-tour="all-materials"/);
  assert.match(html, /id="consultation-materials"/);
});

test("资料不足时只展示实际可读起点，不制造空的终面或补充入口", async () => {
  const { ConsultationLibrary } = await loadAppModule("app/consultation/consultation-view.tsx");
  const html = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial: catalog([session("only", "2026-10-20")]) }));
  const start = startSection(html);
  assert.equal((start.match(/<article /g) ?? []).length, 1);
  assert.match(start, /is-single/);
  assert.match(start, /株式会社テストonly/);
  assert.equal((start.match(/aria-pressed=/g) ?? []).length, 1);
  assert.doesNotMatch(start, /本人からの相談|相談したいこと|おすすめ|AI評価/);
});

test("终面和补充卡片使用所选入口标签，不误标成最近面试", async () => {
  const { ReadingStartCard } = await loadAppModule("app/consultation/consultation-view.tsx");
  for (const label of ["最終面接", "ほかの面接"]) {
    const html = renderToStaticMarkup(React.createElement(ReadingStartCard, { session: session("sample", "2026-09-20"), recent: false, label, onOpen() {}, onExcerpt() {} }));
    assert.ok(html.includes(label));
    assert.doesNotMatch(html, /最近の面接/);
  }
});

test("起点原问句直接带真实场景，显示为文字而不是HTML", async () => {
  const { ReadingStartCard } = await loadAppModule("app/consultation/consultation-view.tsx");
  const item = session("question", "2026-10-20", { excerpts: [{ blockId: "q02", text: "担当した業務を教えてください。" }, { blockId: "q03", text: "<img src=x onerror=alert(1)>" }] });
  const html = renderToStaticMarkup(React.createElement(ReadingStartCard, { session: item, recent: true, onOpen() {}, onExcerpt() {} }));
  assert.match(html, /原稿にある質問/);
  assert.match(html, /担当した業務を教えてください。/);
  assert.equal((html.match(/このやり取りを見る/g) ?? []).length, 2);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /data-tour="reading-preview"/);
  assert.match(html, /data-tour="start-reading"/);
});

test("记忆重构和未知日期保持限制，不把重构文字包装为原问句或最新面试", async () => {
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
