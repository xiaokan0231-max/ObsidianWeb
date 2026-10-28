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

test("起点只展示最近场次和本人明确指定的重点，完整目录仍保留全部公司", async () => {
  const { ConsultationLibrary } = await loadAppModule("app/consultation/consultation-view.tsx");
  const items = [session("recent", "2026-10-23"), session("focus-a", "2026-10-20", { featured: true, introduction: "経験の伝え方について相談したい面接です。", request: "この説明で意図が伝わるか教えてください。" }), session("focus-b", "2026-10-18", { featured: true }), session("other", "2026-10-19")];
  const html = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial: catalog(items) }));
  const start = startSection(html);
  assert.equal((start.match(/<article /g) ?? []).length, 3);
  assert.match(start, /最近の面接/);
  assert.match(start, /本人からの相談/);
  assert.match(start, /経験の伝え方について相談したい面接です。/);
  assert.match(start, /この説明で意図が伝わるか教えてください。/);
  assert.doesNotMatch(start, /株式会社テストother/);
  for (const item of items) assert.ok(html.includes(item.company), item.company);
  assert.match(html, /選考の進み方|現在の選考状況/);
  assert.match(html, /data-tour="all-materials"/);
  assert.match(html, /id="consultation-materials"/);
});

test("没有指定重点时只给一个真实起点，不补占位或替本人编造咨询意图", async () => {
  const { ConsultationLibrary } = await loadAppModule("app/consultation/consultation-view.tsx");
  const html = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial: catalog([session("old", "2026-10-01"), session("new", "2026-10-20")]) }));
  const start = startSection(html);
  assert.equal((start.match(/<article /g) ?? []).length, 1);
  assert.match(start, /is-single/);
  assert.match(start, /株式会社テストnew/);
  assert.doesNotMatch(start, /本人からの相談|相談したいこと|おすすめ|AI評価/);
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
  assert.doesNotMatch(start, /最近の面接/);
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
