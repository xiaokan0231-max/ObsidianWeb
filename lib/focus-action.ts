import { normalizeJobStatus } from "./job-status.ts";
import {
  getString,
  getTitle,
  getType,
  stripMarkdown,
  type Note,
} from "./notes.ts";

export type FocusAction = {
  note: Note;
  source: "todo" | "follow-up";
  action: string;
  context: string;
  status: string;
  priority: string;
  due: string;
  focusUntil: string;
  detail: string;
  cta: string;
  reason: string;
  caseId: string;
  blocksNextStage: boolean;
};

export type FocusWaitingItem = {
  note: Note;
  company: string;
  label: string;
  waitingFor: string;
  followUpAt: string;
};

export type FocusBrief = {
  primary: FocusAction | null;
  ranked: FocusAction[];
  waiting: FocusWaitingItem[];
};

const TODO_STATUSES = new Set(["未着手", "進行中"]);
const ACTIVE_JOB_STATUSES = new Set(["応募済", "書類通過", "面接中"]);
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const WAITING_FOR_LABEL: Record<string, string> = {
  company: "企业",
  agent: "中介",
  platform: "平台",
};

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? ""
    : value;
}

function daysFrom(today: string, target: string) {
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = Date.parse(`${target}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function booleanValue(value: unknown) {
  return value === true || value === "true";
}

function compactText(value: string, limit = 88) {
  const plain = stripMarkdown(value).replace(/^⭐\s*/, "").trim();
  const characters = Array.from(plain);
  return characters.length > limit
    ? `${characters.slice(0, limit - 1).join("")}…`
    : plain;
}

function monthDay(value: string) {
  const [, month, day] = value.split("-").map(Number);
  return `${month}月${day}日`;
}

function dueRank(due: string, today: string) {
  if (!due) return 5;
  const days = daysFrom(today, due);
  if (days < 0) return 0;
  if (days === 0) return 1;
  if (days <= 3) return 2;
  if (days <= 7) return 3;
  return 4;
}

function focusReason(action: Omit<FocusAction, "reason">, today: string) {
  const reasons: string[] = [];
  const manuallyFocused =
    Boolean(action.focusUntil) && action.focusUntil >= today;
  if (manuallyFocused) reasons.push("人工聚焦");

  if (action.due) {
    const days = daysFrom(today, action.due);
    if (days < 0) reasons.push("已逾期");
    else if (days === 0) reasons.push("今天到期");
    else if (days === 1) reasons.push("明天到期");
    else reasons.push(`${monthDay(action.due)} 前`);
  }
  if (action.blocksNextStage) reasons.push("影响下一轮");
  if (reasons.length === 0 && action.priority === "high") reasons.push("高优先");
  return reasons.join(" · ") || "当前可推进";
}

function todoAction(note: Note, today: string): FocusAction | null {
  if (getString(note.frontmatter.audience) === "system") return null;
  const status = getString(note.frontmatter.status) || "未着手";
  if (!TODO_STATUSES.has(status)) return null;

  const actionText =
    getString(note.frontmatter.action) || getTitle(note);
  const action = compactText(actionText);
  if (!action) return null;

  const due = validDate(getString(note.frontmatter.due));
  const focusUntil = booleanValue(note.frontmatter.focus)
    ? validDate(getString(note.frontmatter.focus_until))
    : "";
  const company = getString(note.frontmatter.company);
  const category = getString(note.frontmatter.category);
  const context = [company, category].filter(Boolean).join(" · ") || "待办事项";
  const priority = getString(note.frontmatter.priority).toLowerCase() || "medium";
  const source: FocusAction["source"] = "todo";
  const base = {
    note,
    source,
    action,
    context,
    status,
    priority,
    due,
    focusUntil,
    detail: compactText(getString(note.frontmatter.focus_reason), 150),
    cta: getString(note.frontmatter.cta) || (status === "進行中" ? "继续处理" : "开始处理"),
    caseId: getString(note.frontmatter.case_id),
    blocksNextStage: booleanValue(note.frontmatter.blocks_next_stage),
  };
  return { ...base, reason: focusReason(base, today) };
}

function followUpAction(note: Note, today: string): FocusAction | null {
  if (getType(note) !== "job-case") return null;
  const status = normalizeJobStatus(getString(note.frontmatter.status)) ?? "";
  if (!ACTIVE_JOB_STATUSES.has(status)) return null;

  const waitingFor = getString(note.frontmatter.waiting_for);
  const followUpAt = validDate(getString(note.frontmatter.follow_up_at));
  if (!waitingFor || waitingFor === "self" || !followUpAt || followUpAt > today) {
    return null;
  }

  const company = getString(note.frontmatter.company);
  const base = {
    note,
    source: "follow-up" as const,
    action: compactText(
      getString(note.frontmatter.follow_up_action) ||
        `${company || "该案件"}に進捗を確認する`,
    ),
    context: [company, status].filter(Boolean).join(" · "),
    status: "未着手",
    priority: "high",
    due: followUpAt,
    focusUntil: "",
    detail: `${WAITING_FOR_LABEL[waitingFor] || waitingFor}的回复已到跟进日。`,
    cta: "打开案件并跟进",
    caseId: getString(note.frontmatter.case_id),
    blocksNextStage: true,
  };
  return { ...base, reason: focusReason(base, today) };
}

function waitingItem(note: Note): FocusWaitingItem | null {
  if (getType(note) !== "job-case") return null;
  const status = normalizeJobStatus(getString(note.frontmatter.status)) ?? "";
  if (!ACTIVE_JOB_STATUSES.has(status)) return null;

  const waitingFor = getString(note.frontmatter.waiting_for);
  if (!waitingFor || waitingFor === "self") return null;
  const company = getString(note.frontmatter.company);
  return {
    note,
    company,
    label:
      compactText(getString(note.frontmatter.waiting_label) || getString(note.frontmatter.next_action), 72) ||
      `${WAITING_FOR_LABEL[waitingFor] || waitingFor}の対応待ち`,
    waitingFor: WAITING_FOR_LABEL[waitingFor] || waitingFor,
    followUpAt: validDate(getString(note.frontmatter.follow_up_at)),
  };
}

function compareActions(left: FocusAction, right: FocusAction, today: string) {
  const leftFocused = Boolean(left.focusUntil && left.focusUntil >= today);
  const rightFocused = Boolean(right.focusUntil && right.focusUntil >= today);
  if (leftFocused !== rightFocused) return leftFocused ? -1 : 1;

  const byDue = dueRank(left.due, today) - dueRank(right.due, today);
  if (byDue) return byDue;
  if (left.blocksNextStage !== right.blocksNextStage) {
    return left.blocksNextStage ? -1 : 1;
  }

  const byPriority =
    (PRIORITY_RANK[left.priority] ?? 9) - (PRIORITY_RANK[right.priority] ?? 9);
  if (byPriority) return byPriority;
  if (left.status !== right.status) return left.status === "進行中" ? -1 : 1;

  const leftUpdated = getString(left.note.frontmatter.updated) || "9999-12-31";
  const rightUpdated = getString(right.note.frontmatter.updated) || "9999-12-31";
  return leftUpdated.localeCompare(rightUpdated) || left.note.path.localeCompare(right.note.path);
}

export function buildFocusBrief(
  notes: Note[],
  today = dateKey(),
): FocusBrief {
  const ranked = notes
    .map((note) => (getType(note) === "todo" ? todoAction(note, today) : followUpAction(note, today)))
    .filter((action): action is FocusAction => Boolean(action))
    .sort((left, right) => compareActions(left, right, today));

  const waiting = notes
    .map(waitingItem)
    .filter((item): item is FocusWaitingItem => Boolean(item))
    .sort(
      (left, right) =>
        (left.followUpAt || "9999-12-31").localeCompare(right.followUpAt || "9999-12-31") ||
        left.company.localeCompare(right.company, "ja"),
    );

  return { primary: ranked[0] ?? null, ranked, waiting };
}

export function focusDateLabel(value: string) {
  return value ? monthDay(value) : "";
}
