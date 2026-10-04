// 回答品質復盤から本人が選んだ「重练キュー」を読むための小さな形式。
// AI の改善回答そのものではなく、それを練習対象に選んだという本人の行為を保存する。

export type InterviewPracticeRating = "smooth" | "stuck" | "unknown";
export type InterviewPracticeAction = "attempt" | "complete" | "snooze";
export type InterviewPracticeStatus = "queued" | "active" | "completed" | "snoozed";

export type InterviewPracticeAttempt = {
  action: InterviewPracticeAction;
  at: string;
  rating?: InterviewPracticeRating;
  dueAt?: string;
};

export type InterviewPracticeEntry = {
  blockId: string;
  status: InterviewPracticeStatus;
  queuedAt: string;
  questionTitle: string;
  improvedAnswerJa: string;
  evidenceSentenceIds: string[];
  attempts: InterviewPracticeAttempt[];
  dueAt?: string;
};

const ENTRY_HEAD = /^-\s+\*\*(q\d+)｜(queued|active|completed|snoozed)｜([^*]+)\*\*\s*$/;
const EVENT_HEAD = /^-\s+\*\*(q\d+)｜(attempt|complete|snooze)｜([^*]+)\*\*\s*$/;
const ENTRY_FIELD = /^\s+-\s+(質問|改善回答|証拠|自評|次回)::\s?(.*)$/;

export function parseInterviewPractice(content: string): InterviewPracticeEntry[] {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const entries: InterviewPracticeEntry[] = [];
  let entry: InterviewPracticeEntry | null = null;
  let attempt: InterviewPracticeAttempt | null = null;

  for (const line of body.split("\n")) {
    const head = line.match(ENTRY_HEAD);
    if (head) {
      entry = {
        blockId: head[1],
        status: head[2] as InterviewPracticeStatus,
        queuedAt: head[3].trim(),
        questionTitle: "",
        improvedAnswerJa: "",
        evidenceSentenceIds: [],
        attempts: [],
      };
      entries.push(entry);
      attempt = null;
      continue;
    }
    const event = line.match(EVENT_HEAD);
    if (event) {
      entry = entries.find((item) => item.blockId === event[1]) ?? null;
      attempt = entry
        ? { action: event[2] as InterviewPracticeAction, at: event[3].trim() }
        : null;
      if (entry && attempt) {
        entry.attempts.push(attempt);
        if (attempt.action === "complete") entry.status = "completed";
        else if (attempt.action === "snooze") entry.status = "snoozed";
        else if (entry.status !== "completed") entry.status = "active";
      }
      continue;
    }
    if (!entry) continue;
    const field = line.match(ENTRY_FIELD);
    if (!field) continue;
    if (field[1] === "質問") entry.questionTitle = field[2].trim();
    else if (field[1] === "改善回答") entry.improvedAnswerJa = field[2].trim();
    else if (field[1] === "証拠") {
      entry.evidenceSentenceIds = field[2]
        .split("·")
        .map((id) => id.trim())
        .filter((id) => /^s\d+[a-z]?$/.test(id));
    } else if (field[1] === "自評" && attempt && /^(smooth|stuck|unknown)$/.test(field[2].trim())) {
      attempt.rating = field[2].trim() as InterviewPracticeRating;
    } else if (field[1] === "次回" && attempt && /^20\d{2}-\d{2}-\d{2}$/.test(field[2].trim())) {
      attempt.dueAt = field[2].trim();
      entry.dueAt = attempt.dueAt;
    }
  }

  return entries;
}

function oneLine(value: string) {
  return value.replace(/\s*\n\s*/g, " ").trim();
}

export function renderInterviewPracticeEntry(entry: InterviewPracticeEntry) {
  const evidence = entry.evidenceSentenceIds.join(" · ") || "なし";
  return `\n- **${entry.blockId}｜queued｜${entry.queuedAt}**\n    - 質問:: ${oneLine(entry.questionTitle)}\n    - 改善回答:: ${oneLine(entry.improvedAnswerJa)}\n    - 証拠:: ${evidence}\n`;
}

export function renderInterviewPracticeAction(options: {
  blockId: string;
  action: InterviewPracticeAction;
  at: string;
  rating?: InterviewPracticeRating;
  dueAt?: string;
}) {
  const fields = [
    options.rating ? `    - 自評:: ${options.rating}` : "",
    options.dueAt ? `    - 次回:: ${options.dueAt}` : "",
  ].filter(Boolean).join("\n");
  return `\n- **${options.blockId}｜${options.action}｜${options.at}**${fields ? `\n${fields}` : ""}\n`;
}

export function interviewPracticeKey(practicePath: string, blockId: string) {
  return `${practicePath}#${blockId}`;
}

const TOKYO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * 記録時刻を東京の暦日へ。追記 route は `+09:00` 付きで書くのでそのまま切り出せるが、
 * 旧データには UTC の ISO が混ざる——それを slice すると JST 未明の練習が前日に数えられる。
 */
export function practiceTokyoDay(at: string) {
  if (/^\d{4}-\d{2}-\d{2}T[^Z]*\+09:00$/.test(at)) return at.slice(0, 10);
  const time = Date.parse(at);
  return Number.isNaN(time) ? at.slice(0, 10) : TOKYO_DAY.format(time);
}

/** 「今日完成した題数」：その日に complete を記録した題。後日やり直しても同じ題は一つと数える。 */
export function practiceCompletedOn(entries: Pick<InterviewPracticeEntry, "attempts">[], day: string) {
  return entries.filter((entry) =>
    entry.attempts.some((attempt) => attempt.action === "complete" && practiceTokyoDay(attempt.at) === day),
  ).length;
}

/** ↑↓ で隣の題へ。端で止める（巡回させると、最後の題で↓を押した人が先頭へ飛ばされて位置を見失う）。 */
export function stepPracticeKey(keys: string[], current: string | null | undefined, delta: 1 | -1) {
  if (keys.length === 0) return null;
  const index = current ? keys.indexOf(current) : -1;
  if (index < 0) return keys[0];
  return keys[Math.max(0, Math.min(keys.length - 1, index + delta))];
}
