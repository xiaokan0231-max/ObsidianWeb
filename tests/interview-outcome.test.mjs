import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSignalOutcomeComparison,
  interviewSessionOwner,
  renderSignalOutcomeMarkdown,
  resolveInterviewOutcomes,
} from "../lib/interview-outcome.ts";
import { JAPAN_SIGNAL_KEYS } from "../lib/japan-interview-signals.mjs";

// 公司、岗位都是虚构的；结构照 vault 的真实字段写，保证归属规则与日历同口径。
const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
const DIR = "20_求職/株式会社テスト";
const study = (name, frontmatter) => note(`${DIR}/${name}_整理稿.md`, { type: "transcript-study", company: "株式会社テスト", ...frontmatter });
const prep = (name, frontmatter) => note(`${DIR}/面接準備_${name}.md`, { type: "interview-prep", company: "株式会社テスト", session_status: "completed", ...frontmatter });
const jobCase = (name, frontmatter) => note(`${DIR}/${name}.md`, { type: "job-case", company: "株式会社テスト", ...frontmatter });
const todo = (name, frontmatter) => note(`20_求職/_TODO/${name}.md`, { type: "todo", company: "株式会社テスト", status: "完了", ...frontmatter });

test("同一案件之后还有下一轮的场次记为通过，最后一轮取 job-case 的 status", () => {
  const notes = [
    jobCase("テスト_データエンジニア", { status: "不採用（2026-01-20・最終面接後）" }),
    study("2026-01-05_一次面接", { date: "2026-01-05", round: "一次面接", case: "[[テスト_データエンジニア]]" }),
    // 旧整理稿没有关联字段，只能借同日同轮的准备稿找到案件。
    study("2026-01-12_最終面接", { date: "2026-01-12", round: "最終面接" }),
    prep("s02_最終面接", { date: "2026-01-12", round: "最終面接（オンライン）", case: "[[テスト_データエンジニア]]" }),
  ];
  const outcomes = resolveInterviewOutcomes(notes);
  const first = outcomes.get(`${DIR}/2026-01-05_一次面接_整理稿.md`);
  const last = outcomes.get(`${DIR}/2026-01-12_最終面接_整理稿.md`);
  assert.equal(first.kind, "passed");
  assert.equal(first.source, "next-round");
  assert.match(first.detail, /最終面接（2026-01-12）/);
  assert.equal(last.kind, "rejected");
  assert.equal(last.source, "job-case");
  assert.match(last.detail, /不採用（2026-01-20・最終面接後）/);
});

test("已约定的下一场准备稿也说明通过；未定日程的准备稿不算", () => {
  const base = [
    jobCase("テスト_SRE", { status: "面接中" }),
    study("2026-02-01_カジュアル面談", { date: "2026-02-01", round: "カジュアル面談", case: "[[テスト_SRE]]" }),
  ];
  const scheduled = resolveInterviewOutcomes([...base, prep("s02_一次面接", { date: "2026-02-10", round: "一次面接", session_status: "scheduled", case: "[[テスト_SRE]]" })]);
  assert.equal(scheduled.get(`${DIR}/2026-02-01_カジュアル面談_整理稿.md`).kind, "passed");
  const preparing = resolveInterviewOutcomes([...base, prep("s02_一次面接", { date: "2026-02-10", round: "一次面接", session_status: "preparing", case: "[[テスト_SRE]]" })]);
  const outcome = preparing.get(`${DIR}/2026-02-01_カジュアル面談_整理稿.md`);
  assert.equal(outcome.kind, "no_response");
  assert.match(outcome.detail, /面接中/);
});

test("job-case 的其他状态：内定为通过，保留为本人中止，球在本人手里不算无音", () => {
  const cases = [
    [{ status: "内定" }, "passed"],
    [{ status: "保留（2026-03-02・本人判断で見送り）" }, "withdrawn"],
    [{ status: "書類通過", waiting_for: "company" }, "no_response"],
    [{ status: "面接中", waiting_for: "self" }, "unknown"],
    [{ status: "未応募" }, "unknown"],
    [{ status: "不明な状態" }, "unknown"],
  ];
  for (const [frontmatter, expected] of cases) {
    const outcomes = resolveInterviewOutcomes([
      jobCase("テスト_案件", frontmatter),
      study("2026-03-01_一次面接", { date: "2026-03-01", round: "一次面接", case: "[[テスト_案件]]" }),
    ]);
    assert.equal(outcomes.get(`${DIR}/2026-03-01_一次面接_整理稿.md`).kind, expected, JSON.stringify(frontmatter));
  }
});

test("没有 job-case 的独立面谈读面谈 TODO 的 selection_status", () => {
  const meeting = (selection) => resolveInterviewOutcomes([
    todo("テスト_面談", { ...(selection ? { selection_status: selection } : {}), waiting_label: "社内で検討中" }),
    study("2026-04-01_オンライン面談", { date: "2026-04-01", round: "一次面接（案内名：オンライン面談）", meeting: "[[テスト_面談]]" }),
  ]).get(`${DIR}/2026-04-01_オンライン面談_整理稿.md`);
  assert.equal(meeting("waiting").kind, "no_response");
  assert.match(meeting("waiting").detail, /社内で検討中/);
  assert.equal(meeting("closed").kind, "rejected");
  assert.equal(meeting("closed").source, "todo");
  assert.equal(meeting("").kind, "unknown");
});

test("中介面谈不是企业选考；没有明确关联时不按公司名猜案件", () => {
  const notes = [
    jobCase("テスト_別ポジション", { status: "不採用" }),
    study("2026-05-01_エージェント面談", { date: "2026-05-01", round: "エージェント面談" }),
    study("2026-05-02_一次面接", { date: "2026-05-02", round: "一次面接" }),
    // 写了关联却指向不存在的案件：不能退回同公司另一岗位。
    study("2026-05-03_二次面接", { date: "2026-05-03", round: "二次面接", case: "[[存在しない案件]]" }),
  ];
  const outcomes = resolveInterviewOutcomes(notes);
  assert.equal(outcomes.get(`${DIR}/2026-05-01_エージェント面談_整理稿.md`).kind, "not_applicable");
  assert.equal(outcomes.get(`${DIR}/2026-05-02_一次面接_整理稿.md`).kind, "unknown");
  assert.equal(outcomes.get(`${DIR}/2026-05-03_二次面接_整理稿.md`).kind, "unknown");
  assert.equal(interviewSessionOwner(notes[3], notes), null);
});

const signals = (overrides = {}) => Object.fromEntries(JAPAN_SIGNAL_KEYS.map((key) => [key, {
  verdict: overrides[key] ?? "not_applicable", observationZh: "观察。", fixZh: "", evidence: [],
}]));

test("对照只计数同时有信号和明确结果的场次，旧复盘保留在行里但不进计数", () => {
  const passed = { kind: "passed", label: "通过", detail: "", source: "next-round" };
  const rejected = { kind: "rejected", label: "不採用", detail: "", source: "job-case" };
  const comparison = buildSignalOutcomeComparison([
    { key: "c", company: "株式会社テスト", date: "2026-01-03", round: "最終", outcome: rejected, signals: signals({ motivation: "poor", closing: "poor" }) },
    { key: "a", company: "株式会社テスト", date: "2026-01-01", round: "一次", outcome: passed, signals: signals({ motivation: "good", closing: "mixed" }) },
    { key: "b", company: "株式会社サンプル", date: "2026-01-02", round: "一次", outcome: rejected, signals: null },
    { key: "d", company: "株式会社サンプル", date: "2026-01-04", round: "カジュアル", outcome: { kind: "unknown", label: "未判定", detail: "", source: "none" }, signals: signals({ motivation: "good" }) },
  ]);
  assert.deepEqual(comparison.rows.map((row) => row.key), ["a", "b", "c", "d"]);
  assert.equal(comparison.assessed, 3);
  assert.equal(comparison.comparable, 2);
  assert.deepEqual(comparison.bySignal.motivation.passed, { good: 1, mixed: 0, poor: 0, other: 0 });
  assert.deepEqual(comparison.bySignal.motivation.rejected, { good: 0, mixed: 0, poor: 1, other: 0 });
  assert.deepEqual(comparison.bySignal.concernRecovery.passed, { good: 0, mixed: 0, poor: 0, other: 1 });
  assert.equal(comparison.outcomeCounts.rejected, 2);
  assert.equal(comparison.outcomeCounts.unknown, 1);
  const markdown = renderSignalOutcomeMarkdown(comparison);
  assert.match(markdown, /### 日本面试信号 × 选考结果/);
  assert.match(markdown, /不算比率、不推因果/);
  assert.match(markdown, /\| 志望度・入社意欲 \| 做到 1・部分 0・没做到 0/);
  assert.doesNotMatch(markdown, /%|\d{2}:\d{2}/, "生成笔记不写比率和时间戳");
  assert.equal(renderSignalOutcomeMarkdown(buildSignalOutcomeComparison([])), "");
});
