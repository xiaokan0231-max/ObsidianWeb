import { IN_FLIGHT_STATUSES } from "@/lib/jobs";
import { formatDate, getString, getType, stripMarkdown, type Note } from "@/lib/notes";
import {
  careerStatus,
  localDateKey,
  notePreview,
  todoAudience,
  trustLayer,
} from "@/lib/memory-atlas-data";

type DecisionSemantic = "fact" | "analysis" | "action" | "waiting" | "risk";

const DECISION_SEMANTICS: Record<DecisionSemantic, { label: string; next: string }> = {
  fact: { label: "事实", next: "打开事实原文" },
  analysis: { label: "分析", next: "核对结论与来源" },
  action: { label: "本人行动", next: "继续执行" },
  waiting: { label: "外部等待", next: "查看跟进条件" },
  risk: { label: "风险", next: "立即确认" },
};

function decisionClip(value: string, limit: number) {
  const text = stripMarkdown(value).replace(/\s+/gu, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export type NoteDecisionMeta = { semantic: DecisionSemantic; importance: string; when: string; next: string; label: string };

// 资料库每次重渲染都会对可见卡片取一次；摘要里有整篇 stripMarkdown。
// 结果依赖「今天」（逾期判定），所以缓存带上日期键，跨过零点自然重算。
const decisionCache = new WeakMap<Note, { day: string; meta: NoteDecisionMeta }>();

export function noteDecisionMeta(note: Note): NoteDecisionMeta {
  const day = localDateKey();
  const cached = decisionCache.get(note);
  if (cached?.day === day) return cached.meta;
  const meta = computeDecisionMeta(note, day);
  decisionCache.set(note, { day, meta });
  return meta;
}

function computeDecisionMeta(note: Note, today: string): NoteDecisionMeta {
  const type = getType(note);
  const status = getString(note.frontmatter.status);
  const nextAction =
    getString(note.frontmatter.next_action) ||
    getString(note.frontmatter.action);
  const scheduled = getString(note.frontmatter.next_event_at);
  const scheduledDate = scheduled.match(/\b20\d{2}-\d{2}-\d{2}\b/u)?.[0] ?? "";
  const overdue = scheduledDate !== "" && scheduledDate < today && status !== "完了";
  const waiting = /(?:待ち|待機|等待|返信|回复|結果待)/u.test(`${nextAction} ${status}`);
  // 「選考が動いている」は lib/job-status.mjs の集合で判定（配色名で判定すると色表を変えた瞬間に壊れる）。
  const activeJob = getType(note) === "job-case" && IN_FLIGHT_STATUSES.includes(careerStatus(status).label);
  let semantic: DecisionSemantic = "fact";
  if (overdue) semantic = "risk";
  else if (waiting) semantic = "waiting";
  else if (type === "todo" && todoAudience(note) === "user" && status !== "完了") semantic = "action";
  else if (activeJob || (type === "interview-prep" && scheduledDate >= today)) semantic = "action";
  else if (trustLayer(note).className === "trust-analysis") semantic = "analysis";

  const structuredWhy = [
    getString(note.frontmatter.reason),
    getString(note.frontmatter.summary),
    getString(note.frontmatter.caution),
    getString(note.frontmatter.result),
  ].find(Boolean);
  const importance = decisionClip(
    structuredWhy || notePreview(note) ||
      (semantic === "analysis"
        ? "这是基于现有材料形成的分析，需要结合来源再判断。"
        : "这是可以回查的事实与证据。"),
    118,
  );
  const when = scheduled ||
    getString(note.frontmatter.status_updated) ||
    getString(note.frontmatter.date) ||
    formatDate(note.stat.mtime);
  const next = decisionClip(nextAction || DECISION_SEMANTICS[semantic].next, 76);
  return { semantic, importance, when, next, label: DECISION_SEMANTICS[semantic].label };
}
