// 按场记录选考结果，并和整场「日本面试信号」并排对照。
//
// 为什么要有：复盘分数和选考结果对不上，高分场次被拒、低分场次反而通过，本人「看不出问题」。
// 把每场做到/没做到的整场信号和实际结果放在一起，至少能看见哪些行为在通过的场次里出现过。
// 但场次只有十几场，结果又受岗位、时机、竞争者影响——这里只并排、只计数，不算比率、不推因果。
//
// 结果从哪来（2026-10-15 指示）：最后一轮取关联 job-case 的 status；没有 job-case 的独立面谈，
// 取面谈 TODO 的 selection_status。同一案件之后还有下一轮的场次记为通过。
// 归属沿用日历的规则（lib/calendar-interview.ts）：先读本场的明确关联，再借唯一匹配的当轮准备稿，
// 不按公司名猜案件——同公司的另一岗位不能替这场面谈给出结果。

import { interviewNoteTime, matchingInterviewContext, matchingInterviewPrep, resolveInterviewOwner } from "./calendar-interview.ts";
import { interviewRound } from "./interview-round.ts";
import { IN_FLIGHT_STATUSES, normalizeJobStatus } from "./job-status.mjs";
import type { CalendarEvent } from "./memory-atlas-data.ts";
import { getString, getType, type Note } from "./notes.ts";
import {
  JAPAN_SIGNAL_KEYS,
  JAPAN_SIGNAL_META,
  JAPAN_SIGNAL_VERDICT_SHORT,
  readJapanSignals,
  type JAPAN_SIGNAL_VERDICTS,
} from "./japan-interview-signals.mjs";

/** 整场日本面试信号的形状。正本在 japan-interview-signals.mjs；复盘 JSON 的类型也从这里取。 */
export type JapanSignalKey = (typeof JAPAN_SIGNAL_KEYS)[number];
export type JapanSignalVerdict = (typeof JAPAN_SIGNAL_VERDICTS)[number];
export type JapanSignalItem = {
  verdict: JapanSignalVerdict;
  observationZh: string;
  fixZh: string;
  evidence: { blockId: string; sentenceIds: string[] }[];
};
export type JapanSignals = Record<JapanSignalKey, JapanSignalItem>;

export type InterviewOutcomeKind = "passed" | "rejected" | "no_response" | "withdrawn" | "not_applicable" | "unknown";

/** 对照只比较这三种企业结果。本人中止、中介面谈、未判定单列，不混进分组。 */
export const COMPARABLE_OUTCOMES = ["passed", "rejected", "no_response"] as const;
export type ComparableOutcome = (typeof COMPARABLE_OUTCOMES)[number];

export const INTERVIEW_OUTCOME_LABELS: Record<InterviewOutcomeKind, string> = {
  passed: "通过",
  rejected: "不採用",
  no_response: "无音",
  withdrawn: "本人中止",
  not_applicable: "不适用",
  unknown: "未判定",
};

export type InterviewOutcome = {
  kind: InterviewOutcomeKind;
  label: string;
  /** 依据的白话说明：界面提示与生成笔记共用，让人能回到原始记录核对。 */
  detail: string;
  source: "next-round" | "job-case" | "todo" | "none";
  sourcePath?: string;
};

/** 已持久化的信号层；旧复盘返回 null，不能当成「全部做到」。 */
export function interviewJapanSignals(review: unknown): JapanSignals | null {
  return (readJapanSignals(review)?.signals as JapanSignals | undefined) ?? null;
}

const VALID_DATE = /^20\d{2}-\d{2}-\d{2}$/;

function sessionEvent(note: Note): CalendarEvent {
  const date = getString(note.frontmatter.date);
  return {
    id: note.path, note, kind: "event", date, time: interviewNoteTime(note, date),
    company: getString(note.frontmatter.company), label: getString(note.frontmatter.round),
    phase: "past", caseId: getString(note.frontmatter.case_id), prepPath: "",
  };
}

/** 场次材料（整理稿或准备稿）归属的案件／面谈正本。显式关联写错时不再降级猜测。 */
export function interviewSessionOwner(note: Note, notes: Note[]): Note | null {
  const direct = resolveInterviewOwner(note, notes);
  if (direct) return direct;
  if (getType(note) === "interview-prep") return null;
  if (["case", "meeting", "case_id"].some((field) => getString(note.frontmatter[field]).trim())) return null;
  const event = sessionEvent(note);
  // 旧整理稿多半没有关联字段，只能借当轮准备稿；同轮多版准备稿全部指向同一正本时归属仍然明确。
  const prep = matchingInterviewPrep(event, notes);
  if (prep) return resolveInterviewOwner(prep, notes);
  const context = matchingInterviewContext(event, notes);
  if (!context) return null;
  return resolveInterviewOwner({ ...note, frontmatter: {
    type: getType(note), case_id: context.caseId,
    ...(context.ownerKind && context.owner ? { [context.ownerKind]: `[[${context.owner}]]` } : {}),
  } }, notes);
}

function ownerKey(owner: Note) {
  return getType(owner) === "job-case" ? `case:${getString(owner.frontmatter.case_id) || owner.path}` : `meeting:${owner.path}`;
}

type Session = { note: Note; date: string; time: string; round: string };

function session(note: Note): Session {
  const date = getString(note.frontmatter.date);
  return { note, date, time: interviewNoteTime(note, date), round: getString(note.frontmatter.round) };
}

/** 只有日期更晚、或同日且明确更晚开始的场次才是「下一轮」；同一场的多份资料不算。 */
function isLater(candidate: Session, current: Session) {
  if (candidate.date !== current.date) return candidate.date > current.date;
  return Boolean(candidate.time && current.time && candidate.time > current.time);
}

function ownerOutcome(owner: Note): InterviewOutcome {
  const sourcePath = owner.path;
  const raw = getString(owner.frontmatter.status).trim();
  if (getType(owner) === "job-case") {
    const status = normalizeJobStatus(raw);
    const evidence = `案件状态：${raw || "未记录"}`;
    if (status === "不採用") return { kind: "rejected", label: INTERVIEW_OUTCOME_LABELS.rejected, detail: evidence, source: "job-case", sourcePath };
    if (status === "内定") return { kind: "passed", label: INTERVIEW_OUTCOME_LABELS.passed, detail: `${evidence}（已内定）`, source: "job-case", sourcePath };
    if (status === "保留") return { kind: "withdrawn", label: INTERVIEW_OUTCOME_LABELS.withdrawn, detail: `${evidence}（暂停推进，不是企业结果）`, source: "job-case", sourcePath };
    if (status && IN_FLIGHT_STATUSES.includes(status)) {
      // 球在本人手里时还谈不上企业没回音。
      if (getString(owner.frontmatter.waiting_for) === "self") {
        return { kind: "unknown", label: INTERVIEW_OUTCOME_LABELS.unknown, detail: `${evidence}；当前等待本人行动`, source: "job-case", sourcePath };
      }
      return { kind: "no_response", label: INTERVIEW_OUTCOME_LABELS.no_response, detail: `${evidence}；这场之后尚未记录企业结果`, source: "job-case", sourcePath };
    }
    return { kind: "unknown", label: INTERVIEW_OUTCOME_LABELS.unknown, detail: `${evidence}；不能据此判断这场的结果`, source: "job-case", sourcePath };
  }
  const selection = getString(owner.frontmatter.selection_status).trim();
  const waiting = getString(owner.frontmatter.waiting_label).trim() || getString(owner.frontmatter.action).trim();
  const note = waiting ? `：${waiting}` : "";
  if (selection === "closed") return { kind: "rejected", label: INTERVIEW_OUTCOME_LABELS.rejected, detail: `面谈记录已结束、未推进${note}`, source: "todo", sourcePath };
  if (selection === "waiting") return { kind: "no_response", label: INTERVIEW_OUTCOME_LABELS.no_response, detail: `面谈记录仍在等待后续${note}`, source: "todo", sourcePath };
  return { kind: "unknown", label: INTERVIEW_OUTCOME_LABELS.unknown, detail: "面谈记录没有写后续结果（selection_status 未填）", source: "todo", sourcePath };
}

/**
 * 每份整理稿（transcript-study）这一场的选考结果，键为整理稿路径。
 * 只读已有记录，不从「已经过了多少天」推断不採用——那是 vault 规则明令禁止的推断。
 */
export function resolveInterviewOutcomes(notes: Note[]): Map<string, InterviewOutcome> {
  const studies = notes.filter((note) => getType(note) === "transcript-study");
  // 已约定或已完成的准备稿也说明「有下一轮」；还没定日程的准备稿不算。
  const preps = notes.filter((note) => getType(note) === "interview-prep" &&
    VALID_DATE.test(getString(note.frontmatter.date)) &&
    ["", "scheduled", "completed"].includes(getString(note.frontmatter.session_status ?? note.frontmatter.schedule_status)));
  const groups = new Map<string, Session[]>();
  const owners = new Map<string, Note>();
  for (const note of [...studies, ...preps]) {
    const owner = interviewSessionOwner(note, notes);
    if (!owner) continue;
    const key = ownerKey(owner);
    owners.set(note.path, owner);
    groups.set(key, [...(groups.get(key) ?? []), session(note)]);
  }
  const outcomes = new Map<string, InterviewOutcome>();
  for (const note of studies) {
    const current = session(note);
    if (interviewRound(current.round) === "agent") {
      outcomes.set(note.path, { kind: "not_applicable", label: INTERVIEW_OUTCOME_LABELS.not_applicable, detail: "中介面谈不是企业选考", source: "none" });
      continue;
    }
    const owner = owners.get(note.path);
    if (!owner) {
      outcomes.set(note.path, { kind: "unknown", label: INTERVIEW_OUTCOME_LABELS.unknown, detail: "这场没有明确关联的 job-case 或面谈 TODO", source: "none" });
      continue;
    }
    const later = (groups.get(ownerKey(owner)) ?? [])
      .filter((candidate) => isLater(candidate, current))
      .sort((left, right) => left.date.localeCompare(right.date) || left.time.localeCompare(right.time))[0];
    outcomes.set(note.path, later
      ? { kind: "passed", label: INTERVIEW_OUTCOME_LABELS.passed, detail: `同一案件之后还有${later.round || "下一轮"}（${later.date}）`, source: "next-round", sourcePath: later.note.path }
      : ownerOutcome(owner));
  }
  return outcomes;
}

export type SignalOutcomeRow = {
  key: string;
  company: string;
  date: string;
  round: string;
  outcome: InterviewOutcome | null;
  signals: JapanSignals | null;
};

type VerdictTally = { good: number; mixed: number; poor: number; other: number };

export type SignalOutcomeComparison = {
  /** 全部有复盘的场次，旧到新。没有信号的场次也保留：结果本身就是要按场记录的事实。 */
  rows: SignalOutcomeRow[];
  /** 按新口径评了信号的场次数。 */
  assessed: number;
  /** 既评了信号、又有通过／不採用／无音结果的场次数，才进入下面的计数。 */
  comparable: number;
  outcomeCounts: Record<InterviewOutcomeKind, number>;
  bySignal: Record<JapanSignalKey, Record<ComparableOutcome, VerdictTally>>;
};

const isComparable = (kind: InterviewOutcomeKind | undefined): kind is ComparableOutcome =>
  (COMPARABLE_OUTCOMES as readonly string[]).includes(kind ?? "");

export function buildSignalOutcomeComparison(rows: SignalOutcomeRow[]): SignalOutcomeComparison {
  const sorted = [...rows].sort((left, right) => (left.date || "").localeCompare(right.date || "") || left.key.localeCompare(right.key));
  const outcomeCounts = Object.fromEntries(Object.keys(INTERVIEW_OUTCOME_LABELS).map((kind) => [kind, 0])) as Record<InterviewOutcomeKind, number>;
  for (const row of sorted) outcomeCounts[row.outcome?.kind ?? "unknown"] += 1;
  const tally = (): VerdictTally => ({ good: 0, mixed: 0, poor: 0, other: 0 });
  const bySignal = Object.fromEntries(JAPAN_SIGNAL_KEYS.map((key) => [key,
    Object.fromEntries(COMPARABLE_OUTCOMES.map((kind) => [kind, tally()])),
  ])) as SignalOutcomeComparison["bySignal"];
  let comparable = 0;
  for (const row of sorted) {
    if (!row.signals || !isComparable(row.outcome?.kind)) continue;
    comparable += 1;
    for (const key of JAPAN_SIGNAL_KEYS) {
      const verdict = row.signals[key].verdict;
      const cell = bySignal[key][row.outcome.kind];
      if (verdict === "good" || verdict === "mixed" || verdict === "poor") cell[verdict] += 1;
      else cell.other += 1;
    }
  }
  return { rows: sorted, assessed: sorted.filter((row) => row.signals).length, comparable, outcomeCounts, bySignal };
}

/** 样本说明与结果来源，界面和生成笔记共用同一段话。 */
export function signalOutcomeCaveat(comparison: SignalOutcomeComparison) {
  const counts = COMPARABLE_OUTCOMES.map((kind) => `${INTERVIEW_OUTCOME_LABELS[kind]} ${comparison.outcomeCounts[kind]}`).join("・");
  return `样本很小：${comparison.rows.length} 场复盘里 ${comparison.assessed} 场按新口径评了日本面试信号，`
    + `其中 ${comparison.comparable} 场有明确结果（全部场次：${counts}）。这里只把信号和结果并排、只计数，`
    + "不算比率、不推因果——选考结果还受岗位匹配、时机、竞争者和企业状况影响。";
}

export const SIGNAL_OUTCOME_SOURCE_NOTE = "结果来源：同一案件之后还有下一轮的场次记为通过；最后一轮取关联 job-case 的 status，"
  + "没有 job-case 的独立面谈取面谈 TODO 的 selection_status（closed 记为不採用、waiting 记为无音）。中介面谈不是企业选考，记为不适用。";

export function verdictTallyText(cell: VerdictTally) {
  const parts = [`${JAPAN_SIGNAL_VERDICT_SHORT.good} ${cell.good}`, `${JAPAN_SIGNAL_VERDICT_SHORT.mixed} ${cell.mixed}`, `${JAPAN_SIGNAL_VERDICT_SHORT.poor} ${cell.poor}`];
  return cell.other ? `${parts.join("・")}・未判断 ${cell.other}` : parts.join("・");
}

function markdownTable(head: string[], rows: string[][]) {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

const SOURCE_TAG: Record<InterviewOutcome["source"], string> = { "next-round": "次轮", "job-case": "案件", todo: "面谈记录", none: "—" };

/** vault 生成区块里的对照节。不写时间戳与天数，否则 vault:stats --check 会一直判为漂移。 */
export function renderSignalOutcomeMarkdown(comparison: SignalOutcomeComparison) {
  if (comparison.rows.length === 0) return "";
  const out = ["### 日本面试信号 × 选考结果", "", `> ${signalOutcomeCaveat(comparison)}`, ">", `> ${SIGNAL_OUTCOME_SOURCE_NOTE}`, ""];
  if (comparison.assessed === 0) {
    out.push("> 尚无场次按新口径评了日本面试信号：历史复盘不改写，新生成或本人要求重评的场次才会出现。信号列暂以 — 表示。", "");
  }
  out.push(markdownTable(
    ["日付", "会社", "回", "結果", ...JAPAN_SIGNAL_KEYS.map((key) => JAPAN_SIGNAL_META[key].short)],
    comparison.rows.map((row) => [
      row.date, row.company, row.round,
      row.outcome ? `${row.outcome.label}（${SOURCE_TAG[row.outcome.source]}）` : INTERVIEW_OUTCOME_LABELS.unknown,
      ...JAPAN_SIGNAL_KEYS.map((key) => row.signals ? JAPAN_SIGNAL_VERDICT_SHORT[row.signals[key].verdict] : "—"),
    ]),
  ));
  if (comparison.comparable > 0) {
    out.push("", markdownTable(
      ["信号", ...COMPARABLE_OUTCOMES.map((kind) => INTERVIEW_OUTCOME_LABELS[kind])],
      JAPAN_SIGNAL_KEYS.map((key) => [JAPAN_SIGNAL_META[key].label, ...COMPARABLE_OUTCOMES.map((kind) => verdictTallyText(comparison.bySignal[key][kind]))]),
    ));
  }
  return out.join("\n");
}
