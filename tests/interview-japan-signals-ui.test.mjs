import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { JAPAN_SIGNALS_VERSION, JAPAN_SIGNAL_KEYS, JAPAN_SIGNAL_META } from "../lib/japan-interview-signals.mjs";
import { buildSignalOutcomeComparison } from "../lib/interview-outcome.ts";

const ui = await loadAppModule("app/interview-japan-signals.tsx");

const item = (verdict, evidence = []) => ({ verdict, observationZh: `观察：${verdict}`, fixZh: verdict === "poor" || verdict === "mixed" ? "下一场先说一句志望。" : "", evidence });
const signals = {
  motivation: item("poor", [{ blockId: "q01", sentenceIds: ["s002"] }]),
  closing: item("mixed", [{ blockId: "q09", sentenceIds: ["s040", "s041"] }]),
  concernRecovery: item("not_applicable"),
  unpromptedNegative: item("good", [{ blockId: "q02", sentenceIds: ["s010"] }]),
  registerConsistency: item("insufficient_material"),
  salaryVisaLine: item("not_applicable"),
  reverseQuestions: item("poor", [{ blockId: "q08", sentenceIds: ["s035"] }]),
};
const review = { generatedAt: "", model: "", overallScore: null, summaryZh: "", strengths: [], weaknesses: [], priorityBlockIds: [], blocks: [], japanSignalsVersion: JAPAN_SIGNALS_VERSION, japanSignals: signals };
const rejected = { kind: "rejected", label: "不採用", detail: "案件状态：不採用（2026-01-20・最終面接後）", source: "job-case" };

test("单场信号区块：七项各有结论、观察、下一步和原句入口，并标明与五维分开", () => {
  const clicks = [];
  const element = ui.JapanSignalsPanel({ review, outcome: rejected, onEvidence: (blockId, ids) => clicks.push([blockId, ids]) });
  const html = renderToStaticMarkup(element);
  assert.match(html, /日本面试信号/);
  assert.match(html, /与五维分开，不进总分/);
  for (const key of JAPAN_SIGNAL_KEYS) assert.ok(html.includes(JAPAN_SIGNAL_META[key].label), key);
  assert.match(html, /收尾表态<\/h3><span class="js-verdict v-mixed">部分<\/span>/);
  assert.match(html, /只有礼貌收尾/);
  assert.match(html, /q09 · s040・s041/);
  assert.match(html, /不採用/);
  assert.match(html, /不採用（2026-01-20・最終面接後）/);
  assert.match(html, /无原音不评发音和语速/);
  assert.doesNotMatch(html, /\d+ ?分|\/ 100/, "信号不折算成分数");
});

test("旧复盘明确显示未评估，不把缺失当成全部做到", () => {
  const html = renderToStaticMarkup(ui.JapanSignalsPanel({ review: { ...review, japanSignals: undefined, japanSignalsVersion: undefined }, outcome: null, onEvidence() {} }));
  assert.match(html, /还没有评日本面试信号，不代表这些方面都做到了/);
  assert.match(html, /未判定/);
  assert.doesNotMatch(html, /js-signal-grid/);
});

test("跨场对照表：每场一行并排结果和信号，样本说明先行，有可比场次时才给计数", () => {
  const comparison = buildSignalOutcomeComparison([
    { key: "20_求職/株式会社テスト/2026-01-12_最終面接_整理稿.md", company: "株式会社テスト", date: "2026-01-12", round: "最終面接", outcome: rejected, signals },
    { key: "20_求職/株式会社サンプル/2026-01-05_一次面接_整理稿.md", company: "株式会社サンプル", date: "2026-01-05", round: "一次面接", outcome: { kind: "passed", label: "通过", detail: "同一案件之后还有最終面接（2026-01-12）", source: "next-round" }, signals: null },
  ]);
  const html = renderToStaticMarkup(ui.SignalOutcomeTable({ comparison, onSelect() {} }));
  assert.match(html, /日本面试信号 × 选考结果/);
  assert.match(html, /样本很小/);
  assert.match(html, /不推因果/);
  assert.ok(html.indexOf("株式会社テスト") < html.indexOf("株式会社サンプル"), "新的场次在前");
  assert.match(html, /js-cell v-none/, "旧复盘的信号列显示 —");
  assert.match(html, /只计数：1 场/);
  assert.match(html, /没做到 1/);
  assert.match(html, /结果来源：同一案件之后还有下一轮的场次记为通过/);
  assert.equal(renderToStaticMarkup(ui.SignalOutcomeTable({ comparison: buildSignalOutcomeComparison([]) })), "");
});

test("横向对照页从笔记组装同一份对照：结果按整理稿路径解析，信号取自复盘 JSON", () => {
  const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
  const studyPath = "20_求職/株式会社テスト/2026-01-12_最終面接_整理稿.md";
  const reviewNote = `# 復盤\n\n<!-- interview-answer-review-data -->\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\`\n`;
  const notes = [
    note(studyPath, { type: "transcript-study", company: "株式会社テスト", date: "2026-01-12", round: "最終面接", case: "[[テスト_案件]]" }, "## q01 志望\n- **s002｜私**\n    - 正:: はい。\n"),
    note("20_求職/株式会社テスト/2026-01-12_最終面接_回答品質復盤.md", { type: "interview-answer-review", company: "株式会社テスト", date: "2026-01-12", round: "最終面接" }, reviewNote),
    note("20_求職/株式会社テスト/テスト_案件.md", { type: "job-case", company: "株式会社テスト", status: "不採用（2026-01-20・最終面接後）" }),
  ];
  const comparison = ui.signalOutcomeFromNotes(notes);
  assert.equal(comparison.rows.length, 1);
  assert.equal(comparison.rows[0].outcome.kind, "rejected");
  assert.equal(comparison.rows[0].signals.closing.verdict, "mixed");

});
