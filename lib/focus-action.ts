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
  /**
   * 失効した待办（イベントが過ぎて、やること自体が意味を失ったもの）。
   * 「締切超過（もっと急ぐ）」とは別物：過去の面接の準備を今日やっても仕方がない。
   * ここに入るのは催促ではなく**収尾**——vault 側で 完了 にして閉じる対象。
   * 実例：最終面接（8/13）が終わって結果待ちに入ったのに、準備 todo が
   * 進行中のまま「已逾期」として hero を占領し続けた。
   */
  stale: FocusAction[];
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

/**
 * 「この日を過ぎたらタスク自体が意味を失う」日付。due（期限：過ぎたらもっと急ぐ）とは
 * 反対向きの概念で、特定のイベントに縛られた待办だけが持つ。
 *
 * 正書きは frontmatter の expires_at。これから起票するものは skill が必ず書く。
 *
 * 無い旧ノート向けの推断は**イベント拘束の明示的な印がある場合だけ**に絞る：
 *   case_id（どの案件か）＋ blocks_next_stage（その案件の次の選考を止める関門か）
 *   ＋ 本人が宣言した集中窗口が丸ごと過去（focus_until < today かつ due ≦ focus_until）。
 *
 * category だけでは足りない——面接対策 には「転職回数の説明」「面接復盤」のような
 * 使い回しの効くタスクが実在し、それらに due と一時的な集中窗口を付けただけで
 * 失効扱いされると、窗口が切れた瞬間に生きたタスクが黙って沈む（Codex レビューの指摘）。
 * case_id ＋ blocks_next_stage は「この案件のこの回の関門」という意味を持つので、
 * 使い回しタスクには原理的に付かない。
 *
 * due しか無い待办（再認証のような「過ぎても今日やれば有効」な真の期限超過）は
 * どのみち巻き込まない。
 */
function expiresAt(note: Note): string {
  const explicit = validDate(getString(note.frontmatter.expires_at));
  if (explicit) return explicit;
  if (!getString(note.frontmatter.case_id)) return "";
  if (!booleanValue(note.frontmatter.blocks_next_stage)) return "";
  if (!booleanValue(note.frontmatter.focus)) return "";
  const focusUntil = validDate(getString(note.frontmatter.focus_until));
  if (!focusUntil) return "";
  const due = validDate(getString(note.frontmatter.due));
  return due && due <= focusUntil ? focusUntil : "";
}

/**
 * 待办が失効しているかの本体。3つの信号を見る：
 * 1. 新鮮な手動 pin（focus_until ≧ 今日）は何よりも強い——本人が「まだやる」と
 *    明示した以上、expires_at があっても失効させない（静かに pin を無効化しない）。
 * 2. case_id の先の job-case が 不採用 なら日付に関係なく死亡。この vault で
 *    最も維持品質が高い機械管理フィールドで、最も確実な死亡信号。
 * 3. expires_at（明示 or 推断）が過去。
 */
function isExpired(
  note: Note,
  today: string,
  terminalCaseIds: ReadonlySet<string>,
): boolean {
  const focusUntil = validDate(getString(note.frontmatter.focus_until));
  if (booleanValue(note.frontmatter.focus) && focusUntil && focusUntil >= today) {
    return false;
  }
  const caseId = getString(note.frontmatter.case_id);
  if (caseId && terminalCaseIds.has(caseId)) return true;
  const expiry = expiresAt(note);
  return Boolean(expiry) && expiry < today;
}

/** 待办を巻き込んで死亡させる案件終態。内定は残す（条件確認などの待办が生きている）。 */
function terminalCaseIdSet(notes: Note[]): Set<string> {
  const ids = new Set<string>();
  for (const note of notes) {
    if (getType(note) !== "job-case") continue;
    if (normalizeJobStatus(getString(note.frontmatter.status)) !== "不採用") continue;
    const caseId = getString(note.frontmatter.case_id);
    if (caseId) ids.add(caseId);
  }
  return ids;
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
  const actions = notes
    .map((note) => (getType(note) === "todo" ? todoAction(note, today) : followUpAction(note, today)))
    .filter((action): action is FocusAction => Boolean(action));

  // 失効した待办は ranked から外す。外さないと dueRank の「已逾期＝最優先」に乗って、
  // 過去のイベントの準備が hero を永久に占領する。催促ではなく収尾の対象として分ける。
  const terminalCases = terminalCaseIdSet(notes);
  const stale = actions
    .filter((action) => isExpired(action.note, today, terminalCases))
    .sort((left, right) => left.note.path.localeCompare(right.note.path));
  const stalePaths = new Set(stale.map((action) => action.note.path));
  const ranked = actions
    .filter((action) => !stalePaths.has(action.note.path))
    .sort((left, right) => compareActions(left, right, today));

  const waiting = notes
    .map(waitingItem)
    .filter((item): item is FocusWaitingItem => Boolean(item))
    .sort(
      (left, right) =>
        (left.followUpAt || "9999-12-31").localeCompare(right.followUpAt || "9999-12-31") ||
        left.company.localeCompare(right.company, "ja"),
    );

  return { primary: ranked[0] ?? null, ranked, waiting, stale };
}

/**
 * 待办が失効しているか（行动清单页の「待收尾」徽章などが使う）。
 * notes を渡すと case_id 経由の死亡判定（案件が 不採用）も効く。
 * 保留 は対象外＝本人が意図して棚上げしたものは急かしも収尾催促もしない（数据字典に明記）。
 */
export function isStaleTodo(
  note: Note,
  today = dateKey(),
  notes: Note[] = [],
): boolean {
  if (getType(note) !== "todo") return false;
  const status = getString(note.frontmatter.status) || "未着手";
  if (!TODO_STATUSES.has(status)) return false;
  return isExpired(note, today, terminalCaseIdSet(notes));
}

export function focusDateLabel(value: string) {
  return value ? monthDay(value) : "";
}
