import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { summarizeBatch, summarizeHistory } from "../lib/training-settlement.ts";
import { shiftDay } from "../lib/training-rhythm.ts";
import { tokyoParts } from "../lib/dojo/utils.ts";

/*
 * 集中训练的结算屏与总览节奏带。数字都来自服务端判过分的批次，这里锁的是「怎么说」：
 * Codex 没批改的题不能画成 ×，没有比较基准时不能编一个升阶数。
 */
const zh = await loadAppModule("app/japanese-training.tsx");
const ja = await loadAppModule("app/japanese-training.tsx", {
  stubs: { "./ui-locale": { useUiLocale: () => ({ locale: "ja", setLocale() {} }) } },
});

const item = (id, kind, targetJa) => ({ id, kind, targetJa, meaningZh: `${id} 的功能`, promptZh: "", correctedJa: "" });
const items = [
  item("c", "technical_term", "テスト基盤"),
  item("o1", "answer_strategy", "結論から申し上げます"),
  item("o2", "answer_strategy", "具体例で説明します"),
  item("a", "active_chunk", "株式会社テストで担当しました"),
];
const kindOf = (id) => items.find((value) => value.id === id)?.kind;
const act = (itemId, phase, at, extra) => ({ actionId: `${phase}-${itemId}`, itemId, phase, at, ...extra });
const progress = (itemId, stage) => ({ itemId, stage, seenCount: 1, successCount: 0, failureCount: 0, successDates: [], rejected: false, postTrainingOccurrences: 0 });

const fullSettlement = summarizeBatch({
  batch: {
    id: "batch-1", date: "2026-10-01", createdAt: "", updatedAt: "", curriculumFingerprint: "fp", targetSize: 100,
    phase: "completed", cursor: 0, signature: "",
    scanItemIds: ["a", "c", "o1", "o2"], compileItemIds: ["a"], stressItemIds: ["c", "o1", "o2"],
    actions: [
      act("a", "scan", "2026-10-01T00:00:01Z", { judgment: "unknown" }),
      act("a", "compile", "2026-10-01T00:01:00Z", { answer: "株式会社テストで担当しました", passed: true }),
      act("c", "stress", "2026-10-01T00:02:00Z", { answer: "違う", passed: false }),
      act("o1", "stress", "2026-10-01T00:03:00Z", { answer: "結論から申し上げます。", passed: true }),
      act("o2", "stress", "2026-10-01T00:04:00Z", { answer: "例えば……", passed: false }),
    ],
  },
  kindOf,
  before: { scope: "batch", stages: { a: "unseen", c: "recognized" } },
  after: [progress("a", "correctable"), progress("c", "recognized")],
});

const renderSettlement = (module, settlement) => renderToStaticMarkup(createElement(module.BatchSettlementScreen, {
  settlement, elapsedMs: 754_000, items, leaving: false, onLeave() {},
}));

test("结算屏：命中率、用时、升阶数都是真实统计；Codex 未通过的回答题画成待确认而不是 ×", () => {
  const html = renderSettlement(zh, fullSettlement);
  assert.match(html, /本轮结算/);
  assert.match(html, /本次专注 12:34/);
  assert.match(html, /<strong>50<\/strong><span>%<\/span>/, "4 题作答 2 题命中 → 50%");
  assert.match(html, /命中 2 \/ 作答 4/);
  const reveal = html.match(/<section class="language-settle-reveal">[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(reveal, /class="mark-pass"[\s\S]*?<em>命中<\/em>/);
  assert.match(reveal, /class="mark-fail"[\s\S]*?<b aria-hidden="true">×<\/b>/);
  assert.match(reveal, /class="mark-unconfirmed"[^>]*>[\s\S]*?<b aria-hidden="true">\?<\/b>[\s\S]*?<em>待确认<\/em>/);
  assert.equal((reveal.match(/×/g) ?? []).length, 1, "只有本地判定未通过的普通题画 ×");
  assert.match(reveal, /Codex 离线时接口同样返回未通过/);
  assert.match(html, /本轮升阶[\s\S]*?<strong>1<\/strong>/);
  assert.match(html, /与本批开始时相比/);
  assert.match(html, /回到总览/);
});

test("结算屏：没有比较基准时升阶显示「—」；重复提交只给简版汇总", () => {
  const noBaseline = { ...fullSettlement, baseline: "none", promoted: [], demoted: [] };
  const html = renderSettlement(zh, noBaseline);
  assert.match(html, /本轮升阶<\/h2><p class="language-settle-big"><strong>—<\/strong>/);
  assert.match(html, /无法比较升阶/);

  const brief = renderSettlement(zh, summarizeHistory({ id: "b", date: "2026-10-02", targetSize: 150, completedCount: 120, successCount: 18 }));
  assert.match(brief, /接口只返回汇总行/);
  assert.match(brief, /<dd>120<\/dd>[\s\S]*<dd>18<\/dd>/);
  assert.doesNotMatch(brief, /language-settle-reveal/);
});

test("结算屏日文界面", () => {
  const html = renderSettlement(ja, fullSettlement);
  assert.match(html, /今回の結果/);
  assert.match(html, /正答 2 \/ 回答 4/);
  assert.match(html, /採点未確認/);
  assert.match(html, /概要に戻る/);
});

test("节奏带：今天没练但昨天练过显示保持中；热度 14 格；阶段分布六段", () => {
  const today = tokyoParts().date;
  const at = (day) => `${day}T03:00:00Z`; // JST 正午
  const state = {
    ready: true, stale: false,
    progress: [progress("a", "unseen"), progress("b", "stable"), progress("c", "recognized")],
    history: [
      { id: "1", date: shiftDay(today, -1), targetSize: 100, completedCount: 100, successCount: 9, completedAt: at(shiftDay(today, -1)) },
      { id: "2", date: shiftDay(today, -2), targetSize: 100, completedCount: 100, successCount: 7, completedAt: at(shiftDay(today, -2)) },
    ],
  };
  const html = renderToStaticMarkup(createElement(zh.TrainingPulse, { state, today }));
  assert.match(html, /focus-pulse-streak holding/);
  assert.match(html, /<strong>2<\/strong><span>天<\/span>/);
  assert.match(html, /保持中 · 今天还没练/);
  assert.equal((html.match(/<li class="level-/g) ?? []).length, 14);
  assert.match(html, /class="level-0 today"/);
  assert.match(html, /近 7 天 2 天 · 近 14 天 2 天/);
  assert.equal((html.match(/<li><i style="background:/g) ?? []).length, 6);

  // 不传 today 时走订阅：服务端快照为空，SSR 不读时钟、不铺热度格，水合前后一致。
  const ssr = renderToStaticMarkup(createElement(zh.TrainingPulse, { state }));
  assert.equal((ssr.match(/<li class="level-/g) ?? []).length, 0);
  assert.match(ssr, /focus-pulse-streak none/);
});

test("最近批次行带上本批命中数，结算等待按真实请求分步", async () => {
  const source = await readFile("app/japanese-training.tsx", "utf8");
  assert.match(source, /t\("命中 \{count\}", \{ count: entry\.successCount \}\)/);
  assert.match(source, /"\/api\/language\/v2\/batch\/checkpoint",\s*\{ method: "POST", body: JSON\.stringify\(\{ batchId: batch\.id, actions: unsaved/);
  assert.match(source, /setSettleStep\("remote"\);\s*const result = await api/);
  // 每秒刷新的计时放在独立组件里，工作区本身不再持有每秒变化的状态。
  assert.doesNotMatch(source, /function LanguageBatchWorkspace[\s\S]*?setElapsedMs[\s\S]*?\nfunction BatchClock/);
  assert.match(source, /<BatchClock startedAt=\{activeSessionStartedAt\} \/>/);
  assert.doesNotMatch(source, /settle[A-Za-z]*Percent/, "结算等待不画百分比");
});
