import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { createQuickSession, quickSessionReducer, summarizeQuickSet } from "../lib/language/quick-session.ts";
import { shiftDay } from "../lib/training-rhythm.ts";
import { tokyoParts } from "../lib/dojo/utils.ts";

/*
 * 快练的组间小结与总览节奏带。小结的数字都来自 summarizeQuickSet（升阶来自服务端应答），这里锁的是「怎么说」：
 * 正确率只算首答的判分题，自评另计、不画 ✓/×；没有服务端应答时不能编一个升阶数。
 * （旧集中训练的结算屏已随三阶段界面移除，lib/training-settlement.ts 的口径由 training-settlement.test.mjs 继续锁定。）
 */
const zh = await loadAppModule("app/japanese-training.tsx");
const ja = await loadAppModule("app/japanese-training.tsx", {
  stubs: { "./ui-locale": { useUiLocale: () => ({ locale: "ja", setLocale() {} }) } },
});

const DAY = "2026-10-01";
const reveal = { ja: "", reading: "", meaning: "", wrong: "", explain: "", evidence: [] };
const choice = (id, answer, options, type = "meaning_choice") => ({
  cardId: `${id}:${type}:${DAY}`, itemId: id, group: "nb_term", type, grading: "auto", reason: "new", stage: "unseen", layer: "R",
  prompt: type === "short_input" ? "input_word" : "meaning", stem: `${id} の題面`, stemLang: "ja", options, answer, accepted: [answer], reveal,
});
const cards = [
  choice("a", "开会", ["开会", "出差", "加班", "请假"]),
  choice("b", "株式会社テスト", ["株式会社テスト", "テスト株式会社"], "natural_choice"),
  choice("c", "に", ["に", "を", "で", "∅"], "cloze_choice"),
  { ...choice("f", "結論から申し上げます", [], "flip"), grading: "self", accepted: [], prompt: "flip_pattern" },
  choice("i", "きょうゆう", [], "short_input"),
];
const progress = (itemId, stage) => ({ itemId, stage, seenCount: 1, successCount: 0, failureCount: 0, successDates: [], rejected: false, postTrainingOccurrences: 0 });

/** 按真实 reducer 走完一组：a 对、b 错（重出改对）、c 不知道（重出仍错）、f 自评模糊（重出记得）、i 打字对。 */
function playSet() {
  let state = createQuickSession({ setId: "set-1", day: DAY, size: 10, cards });
  const step = (action) => { state = quickSessionReducer(state, { elapsedMs: 30_000, ...action }); };
  step({ type: "answer", response: "开会" }); step({ type: "next" });
  step({ type: "answer", response: "テスト株式会社" }); step({ type: "next" });
  step({ type: "gaveUp" }); step({ type: "next" });
  step({ type: "reveal" }); step({ type: "answer", rating: "fuzzy" }); step({ type: "next" });
  step({ type: "answer", response: "きょうゆう" }); step({ type: "next" });
  step({ type: "answer", response: "株式会社テスト" }); step({ type: "next" });
  step({ type: "answer", response: "を" }); step({ type: "next" });
  step({ type: "reveal" }); step({ type: "answer", rating: "remembered" }); step({ type: "next" });
  assert.equal(state.phase, "ended");
  return state;
}
const played = playSet();
const stagesAfter = { a: ["unseen", "correctable"], i: ["recognized", "correctable"], b: ["correctable", "recognized"] };
const serverResults = played.records.map((record) => {
  const [before, after] = record.round === 0 && stagesAfter[record.itemId] ? stagesAfter[record.itemId] : ["unseen", "unseen"];
  return { eventId: record.input.eventId, itemId: record.itemId, status: "recorded", passed: record.passed, first: record.round === 0, stageBefore: before, stageAfter: after };
});

const renderSummary = (module, summary, remaining = { due: 3, fresh: 12 }) => renderToStaticMarkup(createElement(module.QuickSetSummary, {
  summary, remaining, busy: false, onAgain() {}, onLeave() {},
}));

test("小结：正确率只算首答的判分题；自评另计、不画 ✓/×；错题 × 只画判分题；升阶来自服务端应答", () => {
  const html = renderSummary(zh, summarizeQuickSet(played, serverResults));
  assert.match(html, /本组小结/);
  assert.match(html, /2026-10-01 · 5 题快练/);
  assert.match(html, /本次专注 04:00/, "8 次作答（含 3 次重出）× 30 秒");
  assert.match(html, /<strong>50<\/strong><span>%<\/span>/, "判分题首答 a✓ b× c× i✓ → 50%，翻卡与重出都不算");
  assert.match(html, /答对 2 \/ 判分 4/);
  assert.match(html, /自评 1 题另计：记得 0 · 模糊 1 · 忘了 0/);
  assert.match(html, /重出 3 题：改对 2/);
  assert.match(html, /不知道 1 题/);
  const mistakes = html.match(/<section class="quick-summary-mistakes"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.equal((mistakes.match(/<li /g) ?? []).length, 3);
  assert.equal((mistakes.match(/×/g) ?? []).length, 2, "只有判分题的错画 ×");
  const selfRow = mistakes.match(/<li class="is-self">[\s\S]*?<\/li>/)?.[0] ?? "";
  assert.match(selfRow, /自评：需要复习/);
  assert.doesNotMatch(selfRow, /[✓×]/, "自评不画 ✓/×");
  assert.match(mistakes, /你选了 テスト株式会社[\s\S]*?重出后答对/);
  assert.match(mistakes, /你选了 不知道[\s\S]*?重出仍错/);
  assert.match(html, /本组升阶<\/h2><p class="quick-summary-big"><strong>2<\/strong><span>项<\/span>/);
  assert.match(html, /回落 1 项/);
  assert.match(html, /今天还剩<\/span>到期 3 · 新题 12/);
  assert.match(html, /回到总览<kbd aria-hidden="true">Esc<\/kbd>/);
  assert.match(html, /再来一组<kbd aria-hidden="true">Enter<\/kbd>/);
});

test("小结：还有没保存上的题时升阶显示「—」；只有自评题时正确率显示「—」；今天还剩未取到显示「—」", () => {
  const unsaved = renderSummary(zh, summarizeQuickSet(played, serverResults.slice(0, 4)), null);
  assert.match(unsaved, /本组升阶<\/h2><p class="quick-summary-big"><strong>—<\/strong>/);
  assert.match(unsaved, /4 题尚未保存/);
  assert.doesNotMatch(unsaved, /回落/);
  assert.match(unsaved, /今天还剩<\/span>到期 — · 新题 —/);

  let selfOnly = createQuickSession({ setId: "set-2", day: DAY, size: 10, cards: [cards[3]] });
  for (const action of [{ type: "reveal" }, { type: "answer", rating: "remembered" }, { type: "next" }]) selfOnly = quickSessionReducer(selfOnly, action);
  const html = renderSummary(zh, summarizeQuickSet(selfOnly, []));
  assert.match(html, /<div class="language-settle-ring">[\s\S]*?<strong>—<\/strong>/);
  assert.match(html, /答对 0 \/ 判分 0/);
  assert.match(html, /这一组没有错题/);
  assert.doesNotMatch(html, /本次专注/, "没有用时记录就不显示");
});

test("小结日文界面", () => {
  const html = renderSummary(ja, summarizeQuickSet(played, serverResults));
  assert.match(html, /セットの結果/);
  assert.match(html, /正解 2 \/ 採点 4/);
  assert.match(html, /自己評価 1 問は別集計/);
  assert.match(html, /概要に戻る/);
  assert.match(html, /もう1セット/);
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

test("最近练习行带上本组命中数；逐题保存走答案队列；计时在独立组件里", async () => {
  const [overview, drill, sync, shell] = await Promise.all([
    readFile("app/language-quick-overview.tsx", "utf8"),
    readFile("app/language-quick-drill.tsx", "utf8"),
    readFile("app/language-quick-sync.ts", "utf8"),
    readFile("app/japanese-training.tsx", "utf8"),
  ]);
  assert.match(overview, /t\("命中 \{count\}", \{ count: entry\.successCount \}\)/);
  assert.match(sync, /quickApi<QuickAnswerResponse>\(QUICK_ENDPOINTS\.answer, \{ method: "POST", body: JSON\.stringify\(body\) \}\)/);
  assert.match(sync, /headers: \{ "Content-Type": "application\/json" \},\s*body: JSON\.stringify\(body\),\s*keepalive: true/);
  assert.match(shell, /queueRef\.current\?\.enqueue\(next\.setId, fresh\.map\(\(record\) => record\.input\), next\.size\)/);
  // 每秒刷新的计时放在独立组件里，练习屏本身不持有每秒变化的状态。
  assert.doesNotMatch(drill.slice(drill.indexOf("export function QuickDrill")), /setElapsedMs/);
  assert.match(drill, /<QuickClock startedAt=\{startedAt\} \/>/);
  assert.doesNotMatch(sync + shell, /save[A-Za-z]*Percent/, "保存状态不画百分比");
});
