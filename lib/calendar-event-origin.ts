import type { CalendarEvent } from "./memory-atlas-data.ts";
import { interviewContext, resolveInterviewOwner } from "./calendar-interview.ts";
import { getString, getType, type Note } from "./notes.ts";
import { normalizeJobStatus } from "./job-status.mjs";
import type { UiLocale } from "./ui-locale.ts";

export const CALENDAR_ORIGIN_KINDS = ["ai", "self", "invited", "unknown"] as const;
export type CalendarOriginKind = typeof CALENDAR_ORIGIN_KINDS[number];
export type CalendarEventOrigin = {
  kind: CalendarOriginKind;
  evidence: "application-ai" | "application-user" | "scout-origin" | "scout-channel" |
    "owner-missing" | "owner-conflict" | "submission-unconfirmed" | "actor-unconfirmed" | "agent-submitted";
  sourcePath: string;
  channel: string;
  agent: string;
  appliedOn: string;
};

export const UNKNOWN_CALENDAR_ORIGIN: CalendarEventOrigin = {
  kind: "unknown", evidence: "owner-missing", sourcePath: "", channel: "", agent: "", appliedOn: "",
};

const COPY = {
  "zh-CN": {
    heading: "机会来源",
    labels: { ai: "AI 代投", self: "自主投递", invited: "主动邀约", unknown: "来源待核实" },
    short: { ai: "AI", self: "自投", invited: "邀约", unknown: "待核" },
    invited: "企业或猎头先发来明确邀约；后续由谁代办不改变机会来源。",
    submitted: (actor: string, date: string) => `已确认由${actor}于 ${date} 提交申请。`,
    self: "本人", ai: "AI",
    channel: (channel: string) => `渠道：${channel}。`,
    unknown: {
      "owner-missing": "尚未找到本场明确关联的申请或面谈来源记录。",
      "owner-conflict": "本场关联的来源记录存在冲突，暂不推定。",
      "submission-unconfirmed": "申请提交日期或成功证据尚不完整，暂不推定执行者。",
      "actor-unconfirmed": "尚未明确记录谁提交了申请；推荐作者、预约者和面谈类型不能代替来源证据。",
      "agent-submitted": "已记录由中介提交申请，但尚不能确认是主动邀约还是本人先委托。",
    },
  },
  ja: {
    heading: "機会のきっかけ",
    labels: { ai: "AI 代行応募", self: "本人応募", invited: "先方からの招待", unknown: "きっかけ未確認" },
    short: { ai: "AI", self: "本人", invited: "招待", unknown: "未確認" },
    invited: "企業または紹介会社からの明確な招待がきっかけです。その後の手続きの代行者とは区別します。",
    submitted: (actor: string, date: string) => `${date} に${actor}が応募を提出した記録を確認しています。`,
    self: "本人", ai: "AI",
    channel: (channel: string) => `経路：${channel}。`,
    unknown: {
      "owner-missing": "この回に明確に関連する応募・面談の出典が見つかっていません。",
      "owner-conflict": "この回に関連する出典が一致していないため、推定していません。",
      "submission-unconfirmed": "応募日または提出成功の記録が不十分なため、提出者を推定していません。",
      "actor-unconfirmed": "応募の提出者が未記録です。推薦の作成者・予約者・面談の種類からは推定しません。",
      "agent-submitted": "紹介会社による提出の記録はありますが、先方からの招待か本人の依頼かは未確認です。",
    },
  },
} as const;

export function calendarOriginLabel(kind: CalendarOriginKind, locale: UiLocale = "zh-CN", compact = false) {
  return (compact ? COPY[locale].short : COPY[locale].labels)[kind];
}

export function calendarOriginDescription(origin: CalendarEventOrigin, locale: UiLocale = "zh-CN") {
  const copy = COPY[locale];
  const reason = origin.kind === "invited" ? copy.invited : origin.kind === "ai" || origin.kind === "self"
    ? copy.submitted(origin.kind === "self" ? copy.self : origin.agent || copy.ai, origin.appliedOn)
    : copy.unknown[origin.evidence as keyof typeof copy.unknown] ?? copy.unknown["actor-unconfirmed"];
  return `${copy.heading}：${copy.labels[origin.kind]}。${reason}${origin.channel ? copy.channel(origin.channel) : ""}`;
}

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function explicitScoutChannel(value: string) {
  // 普通媒体名、猎头渠道都不证明是对方先邀约；只有带肯定 scout 标记的渠道才有这一含义。
  if (/[?？]|未確認|未确认|不明|ではない|なし|not\s|unverified/iu.test(value)) return false;
  return /(?:^|[（(\/／・：:\s])(?:企業直?|エージェント|ヘッドハンター|company|recruiter)?[ -]?(?:スカウト|scout)(?:$|[）)\/／・：:\s])/iu.test(value);
}

function unknown(evidence: CalendarEventOrigin["evidence"], owner?: Note): CalendarEventOrigin {
  return {
    kind: "unknown", evidence, sourcePath: owner?.path ?? "",
    channel: getString(owner?.frontmatter.channel), agent: "", appliedOn: "",
  };
}

function originForOwner(owner: Note, eventDate: string): CalendarEventOrigin {
  const fm = owner.frontmatter;
  const base = { sourcePath: owner.path, channel: getString(fm.channel), agent: "", appliedOn: "" };
  // 来源与提交执行者是两个事实。先有 scout，再由 AI 办手续，仍是先方邀约带来的机会。
  if (getString(fm.origin) === "scout") return { ...base, kind: "invited", evidence: "scout-origin" };
  if (explicitScoutChannel(base.channel)) return { ...base, kind: "invited", evidence: "scout-channel" };
  const actor = getString(fm.application_actor);
  if (actor === "agent") return unknown("agent-submitted", owner);
  if (actor !== "ai" && actor !== "user") return unknown("actor-unconfirmed", owner);
  const appliedOn = getString(fm.applied_on);
  const status = normalizeJobStatus(getString(fm.status));
  const agent = getString(fm.application_agent).trim();
  if (getType(owner) !== "job-case" || !validDay(appliedOn) || appliedOn > eventDate ||
    !status || status === "未応募" || getString(fm.formal_application_status) === "unverified" ||
    (actor === "ai" && !agent)) return unknown("submission-unconfirmed", owner);
  return { ...base, appliedOn, agent: actor === "ai" ? agent : "", kind: actor === "ai" ? "ai" : "self",
    evidence: actor === "ai" ? "application-ai" : "application-user" };
}

/** 与本场的案件／独立面谈正本关联，不按公司名、AI 作者、推荐来源或面谈名称猜机会来源。 */
export function buildCalendarEventOrigins(events: CalendarEvent[], notes: Note[]): Map<string, CalendarEventOrigin> {
  const byPath = new Map(notes.map((note) => [note.path, note]));
  const caseCounts = new Map<string, number>();
  for (const note of notes) {
    const id = getString(note.frontmatter.case_id);
    if (getType(note) === "job-case" && id) caseCounts.set(id, (caseCounts.get(id) ?? 0) + 1);
  }
  return new Map(events.map((event) => {
    const prep = byPath.get(event.prepPath);
    const sources = prep && prep.path !== event.note.path ? [event.note, prep] : [event.note];
    const contexts = sources.map((source) => interviewContext(source, notes, true));
    const owners = sources.map((source) => resolveInterviewOwner(source, notes, event.caseId));
    const ids = [event.caseId, ...contexts.map((context) => context.caseId)].filter(Boolean);
    if (ids.some((id) => (caseCounts.get(id) ?? 0) > 1) || new Set(ids).size > 1 ||
      contexts.some((context) => context.invalid) ||
      new Set(owners.filter((owner): owner is Note => Boolean(owner)).map((owner) => owner.path)).size > 1) {
      return [event.id, unknown("owner-conflict")];
    }
    const owner = owners.find((value) => value !== null);
    return [event.id, owner ? originForOwner(owner, event.date) : unknown("owner-missing")];
  }));
}
