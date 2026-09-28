import { getString } from "./notes.ts";
import type { CompanyOverview } from "./company-overview.ts";
import { formatContextPickerEvent } from "./context-picker.ts";
import { interviewPrepTemporalStatus } from "./interview-prep-index.ts";
import type { InterviewPrepDoc } from "./interview-prep-doc.ts";
import { IN_PROGRESS_STATUSES } from "./job-case-schema.ts";
import {
  JOB_ORIGIN_LABEL, OFFICIAL_APPLY_LABEL, TERMINAL_STATUSES, VERIFICATION_LABEL, WAITING_FOR_LABEL,
  daysBetween, elapsedLabel, normalizeDay, normalizeJobStatus, rateTone, salaryLabel, shortDay, statusRequiresChannel, statusTone, toJobCard,
  type JobCard, type JobStatusTone,
} from "./jobs.ts";

/**
 * 公司画像页头部的数据层。
 *
 * 头部原来只有公司名和岗位名，案件走到哪一步、条件如何、下一步做什么，
 * 都要翻到看板或案件笔记里才知道。这里把 job-case / 面谈 todo 的 frontmatter
 * 收成「这是哪家 → 什么岗 → 选考走到哪 → 此刻该做什么」四行；
 * 组件只负责画，取舍与空态都在这里决定，好让 node:test 直接验证。
 *
 * 空态分两档：固定格（年収・勤務地・雇用形態・優先度）显示「未記録／不明」——缺失本身是要补的信号；
 * 可变项（応募日・跟进日・面談）缺了就不占位。所有数值来自 toJobCard，不手写。
 * 「哪个状态必须有 channel」不在这里另写一份，引用 job-status 的同一张表——
 * 同一规则的第三份副本正是 schema 文件头部记的事故形状。
 */

export type CompanyHeroFact = {
  id: string;
  /** 空字符串＝无标签（状态注记这类整句）。 */
  label: string;
  value: string;
  /** 显示值被截短或改写时挂到 title，让完整原文可悬停查看。 */
  title?: string;
  /** 未記録／不明这类空态：仍占位，但字色降级。 */
  muted?: boolean;
  /** 附加语义：warn（必须回填）、salary（解析成功的年収）、is-text（年収原文兜底）、rate-*（優先度色阶）。 */
  tone?: string;
};

export type CompanyHeroLink = {
  id: "posting" | "official" | "record";
  label: string;
  /** 外链；没有则由组件回调打开正本笔记。 */
  url?: string;
  title?: string;
  /** 附在链接旁的小标签（求人原文核对状态）。 */
  badge?: string;
  badgeTone?: "ok" | "warn" | "quiet";
  /** 不是链接、只是占位说明（原文未取得）。 */
  muted?: boolean;
};

export type CompanyHeroStatus = {
  label: string;
  tone: JobStatusTone;
  /** status 括号里的补充（日期・经路・备注）；面谈则是 todo 的 status 原文。 */
  note: string;
};

export type CompanyNameParts = {
  /** 法人格前缀（株式会社 等），显示时降级。 */
  prefix: string;
  core: string;
  /** 法人格后缀（◯◯株式会社 / Inc. 等）。 */
  suffix: string;
  /** 法人格与主名之间的原文分隔（空格・逗号）。原样留在 textContent，复制和页内搜索才拿得到完整社名。 */
  separator: string;
};

/** 「此刻」一行：按 下一步 → 等待 → 跟进 → 面談 拼接，缺哪段省哪段。 */
export type CompanyHeroNow = {
  action: string;
  /** 等待企业 · 書類選考結果；waiting_for=self 且已有下一步时省略。 */
  waiting: string;
  followUp: { label: string; overdue: boolean } | null;
  /** 已约定的面談。正本没写（或写的已过期）时借用已关联准备稿的将来日期，borrowedFrom 记下借自谁。 */
  event: { label: string; past: boolean; borrowedFrom: string } | null;
  /** 四段全空但选考进行中时显示的占位（未記録）；有内容则为空串。 */
  placeholder: string;
};

export type CompanyHero = {
  kind: CompanyOverview["kind"];
  /** 「案件」／「面谈」。 */
  kicker: string;
  /** kicker 的悬停说明：入库日与起票来历，不上屏。 */
  kickerTitle: string;
  name: CompanyNameParts;
  /** 岗位名／面谈主题；与公司名相同时为空串（避免社名连出两次）。 */
  title: string;
  status: CompanyHeroStatus;
  /** 整页色调（顶部色条），与胶囊同源。 */
  tone: JobStatusTone;
  /** 进度行：経路・応募・更新・入库兜底・状态注记。缺的不占位。 */
  progress: CompanyHeroFact[];
  /** 条件行四个固定格；面谈天生没有这些，为空数组。 */
  facts: CompanyHeroFact[];
  links: CompanyHeroLink[];
  /** null＝整行不渲染（已终结且没有下一步，或面谈已完了）。 */
  now: CompanyHeroNow | null;
  /** 数据层保留，头部暂不渲染（见 tests 与设计记录）。 */
  stack: string[];
};

const OFFICIAL_LINK_LABEL: Record<JobCard["officialApplyStatus"], string> = {
  exact: "公式応募",
  related: "公式・関連",
  careers: "採用ページ",
  unavailable: "採用ページ",
};


/** todo 的状态已说「结束了」：完了・中止，或本人搁置（保留）。 */
const MEETING_DONE = /完了|完成|done|cancel|中止|取消|保留/i;

/**
 * 面谈算不算已经结束。只认两件事：todo 状态说结束了，或约定的面谈时刻（next_event_at）已过。
 * due 是准备任务的期限，不是面谈日——期限过了只说明任务逾期，面谈本身还开着，
 * 头部要把它标成「期限已过」催一下，而不是灰掉藏起来。
 * 切换面板的分组另有自己的口径（把 due 已过也收进已结束），那是列表降噪，不是这里的事实判断。
 */
function meetingEnded(note: CompanyOverview["note"], today: string) {
  if (MEETING_DONE.test(getString(note.frontmatter.status))) return true;
  const date = DATE.exec(getString(note.frontmatter.next_event_at).trim())?.[0] ?? "";
  return Boolean(date) && date < today;
}

/** 头部胶囊与公司画像页顶部色条共用：案件按七态取色（没写 status 就是中性），面谈用青绿、结束后转中性。 */
export function companyHeroTone(context: CompanyOverview, today: string): JobStatusTone {
  if (context.kind === "meeting") return meetingEnded(context.note, today) ? "neutral" : "meeting";
  const raw = getString(context.note.frontmatter.status).trim();
  return statusTone(normalizeJobStatus(raw) ?? raw);
}

/** 面谈 todo 关闭后的胶囊文字。不把 status 原文直接上屏——todo 的「保留」与案件 7 枚举的「保留」同字，头部会读成案件状态。 */
function closedMeetingLabel(rawStatus: string) {
  if (/中止|取消|cancel/i.test(rawStatus)) return "已中止";
  if (/保留/.test(rawStatus)) return "已搁置";
  if (/完了|完成|done/i.test(rawStatus)) return "已完了";
  return "已结束";
}

const LEGAL_FORMS = [
  "株式会社", "合同会社", "有限会社", "合資会社", "合名会社",
  "一般社団法人", "一般財団法人", "公益社団法人", "公益財団法人",
  "特定非営利活動法人", "学校法人", "医療法人", "社会福祉法人",
  "国立研究開発法人", "独立行政法人", "（株）", "(株)", "（同）", "(同)",
];
const LATIN_SUFFIX = /^(.*?)([\s,，]+)((?:Co\.,?\s*Ltd\.?|Inc\.?|Corp\.?|Corporation|K\.K\.|G\.K\.|LLC|Ltd\.?|GmbH|Limited|Pte\.?\s*Ltd\.?))$/i;

/** 只拆显示层级：prefix + separator + core + suffix 拼回去逐字等于原社名；只剩法人词或拆不出就整个当 core。 */
export function splitCompanyName(name: string): CompanyNameParts {
  const trimmed = name.trim();
  for (const form of LEGAL_FORMS) {
    if (trimmed.startsWith(form) && trimmed.slice(form.length).trim()) {
      const rest = trimmed.slice(form.length);
      const core = rest.trimStart();
      return { prefix: form, separator: rest.slice(0, rest.length - core.length), core, suffix: "" };
    }
    if (trimmed.endsWith(form) && trimmed.slice(0, -form.length).trim()) {
      const rest = trimmed.slice(0, -form.length);
      const core = rest.trimEnd();
      return { prefix: "", separator: rest.slice(core.length), core, suffix: form };
    }
  }
  const latin = trimmed.match(LATIN_SUFFIX);
  if (latin) return { prefix: "", core: latin[1], separator: latin[2], suffix: latin[3] };
  return { prefix: "", core: trimmed, suffix: "", separator: "" };
}

/** 社名里有假名／汉字才给 h1 标 lang="ja"；英文社名和「公司总览」占位不标，免得读屏用日语念中文或英文。 */
export function isJapaneseName(name: string) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]/u.test(name);
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const UNKNOWN = /^(不明|未取得|未記載|未記録|未记录|未確認|未确认|なし|N\/A|TBD|[-—－])(?![\p{L}\p{N}])/u;

/** `9/22 · 4日前`。今天就说今天；未来（预填的日期）说 N日後。 */
function dayWithElapsed(day: string, today: string) {
  const days = daysBetween(day, today);
  if (days === null) return day;
  const stamp = shortDay(day);
  if (days === 0) return `${stamp} · 今日`;
  return days > 0 ? `${stamp} · ${days}日前` : `${stamp} · ${-days}日後`;
}

/** 括号前的主值：`不明（求人原文未取得）` → `不明`。完整原文留给 title。 */
function mainValue(text: string) {
  return text.split(/[（(]/)[0].trim() || text.trim();
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function textFact(id: string, label: string, raw: string): CompanyHeroFact {
  const text = raw.trim();
  if (!text) return { id, label, value: "未記録", muted: true };
  if (UNKNOWN.test(text)) return { id, label, value: mainValue(text), title: text, muted: true };
  return { id, label, value: text };
}

/** 与切换面板同一口径：正本自己写的将来 next_event_at 优先，没有（或已过期）才借用已关联准备稿的将来日期。 */
function upcomingPrepDoc(rounds: InterviewPrepDoc[], today: string) {
  return rounds.reduce<InterviewPrepDoc | null>((earliest, doc) => {
    const temporal = interviewPrepTemporalStatus(doc, today);
    if ((temporal !== "scheduled" && temporal !== "upcoming") || doc.date < today) return earliest;
    return !earliest || doc.date < earliest.date ? doc : earliest;
  }, null);
}

function eventInfo(explicit: string, rounds: InterviewPrepDoc[], today: string): CompanyHeroNow["event"] {
  const raw = explicit.trim();
  const date = DATE.exec(raw)?.[0] ?? "";
  if (date && date >= today) return { label: formatContextPickerEvent(raw, today), past: false, borrowedFrom: "" };
  const doc = upcomingPrepDoc(rounds, today);
  if (doc) return { label: formatContextPickerEvent(doc.date, today), past: false, borrowedFrom: doc.note.path };
  return date ? { label: `${formatContextPickerEvent(raw, today)} · 已过・待更新`, past: true, borrowedFrom: "" } : null;
}

function followUpInfo(followUpAt: string, followUpAction: string, today: string): CompanyHeroNow["followUp"] {
  if (!DATE.test(followUpAt)) return null;
  const days = daysBetween(followUpAt, today) ?? 0;
  const base = days > 0 ? `跟进 ${shortDay(followUpAt)} · 已过 ${days} 天` : days === 0 ? "跟进 今天" : `跟进 ${shortDay(followUpAt)}（${-days}天后）`;
  return { label: followUpAction ? `${base} · ${clip(followUpAction, 30)}` : base, overdue: days > 0 };
}

function caseHero(context: CompanyOverview, rounds: InterviewPrepDoc[], today: string): CompanyHero {
  const card = toJobCard(context.note);
  const fm = context.note.frontmatter;
  // 胶囊文字与色调都从 frontmatter 原文推：toJobCard 对没写 status 的笔记会回退成「未応募」，那是冒充的事实。
  const rawStatus = getString(fm.status).trim();
  const normalized = normalizeJobStatus(rawStatus);
  // 七态之外的自定义状态（選考辞退（…）之类）：胶囊只放括号前的主值，括号里的日期・理由进注记，别让 14ch 截断吞掉。
  const status = normalized ?? mainValue(rawStatus);
  const statusNote = card.statusNote || (!normalized && rawStatus !== status ? rawStatus : "");
  const tone = companyHeroTone(context, today);
  const inProgress = IN_PROGRESS_STATUSES.includes(status);
  const terminal = TERMINAL_STATUSES.includes(status);

  const progress: CompanyHeroFact[] = [];
  const source = mainValue(card.source);
  if (card.channel) {
    // 求人票在哪发现的 ≠ 实际投递渠道；不同也不并列两个平台名，原文进 title 就够。
    progress.push(source && source !== card.channel && card.sourceGroup !== card.channel
      ? { id: "channel", label: "経路", value: card.channel, title: `求人票来源：${card.source}` }
      : { id: "channel", label: "経路", value: card.channel });
  } else if (statusRequiresChannel(rawStatus)) {
    // 応募済以降台帳按经路统计，这一格空着必须能看见。保留・未応募不要求 channel（同 vault:check），不染橙。
    progress.push({ id: "channel", label: "経路", value: "未記録", tone: "warn", title: "応募済以降は台帳が経路別に集計するため channel が必要" });
  } else if (source) {
    progress.push({ id: "source", label: "来源", value: source, title: card.source });
  }
  if (card.appliedOn) progress.push({ id: "applied", label: "応募", value: `${shortDay(card.appliedOn)} · ${elapsedLabel(card.appliedOn, today)}`, title: card.appliedOn });
  if (card.statusUpdated && card.statusUpdated !== card.appliedOn) progress.push({ id: "updated", label: "更新", value: dayWithElapsed(card.statusUpdated, today), title: card.statusUpdated });
  const intake = normalizeDay(card.date) ?? "";
  if (!card.appliedOn && !card.statusUpdated) progress.push(intake ? { id: "intake", label: "入库", value: shortDay(intake), title: intake } : { id: "intake", label: "入库", value: "未記録", muted: true });
  if (statusNote) progress.push({ id: "note", label: "", value: statusNote, title: statusNote });

  const facts: CompanyHeroFact[] = [
    card.salary.min !== null
      ? { id: "salary", label: "年収", value: salaryLabel(card), title: card.salaryText, tone: "salary" }
      : { ...textFact("salary", "年収", card.salaryText), ...(card.salaryText.trim() && !UNKNOWN.test(card.salaryText.trim()) ? { tone: "is-text", title: card.salaryText } : {}) },
    // リモート可否は location 原文そのものが言っている（jobRemote もそこから判定する）ので、別枠の胶囊は同じ語の二度書きになる。
    textFact("location", "勤務地", card.location),
    textFact("employment", "雇用形態", card.employment),
    card.rated
      ? { id: "rating", label: "応募优先度", value: `${card.rating} / 10`, tone: `rate-${rateTone(card.rating)}` }
      : { id: "rating", label: "応募优先度", value: "未採点", muted: true, title: "未採点（求人原文を読んでいない）" },
  ];

  const links: CompanyHeroLink[] = [];
  if (card.url) links.push({ id: "posting", label: "求人原文", url: card.url, badge: VERIFICATION_LABEL[card.verification], badgeTone: card.verification === "verified" ? "ok" : card.verification === "warned" ? "warn" : "quiet" });
  else links.push({ id: "posting", label: "原文未取得", muted: true });
  if (card.officialApplyUrl) {
    // 与看板同口径：有 URL 就给链接；没写 official_apply_status 时只是不知道对应哪种页面，不是没有页面。
    const known = card.officialApplyStatus !== "unavailable";
    links.push({ id: "official", label: OFFICIAL_LINK_LABEL[card.officialApplyStatus], url: card.officialApplyUrl,
      title: `${known ? OFFICIAL_APPLY_LABEL[card.officialApplyStatus] : "official_apply_status 未记录"}${card.officialApplyNote ? ` · ${card.officialApplyNote}` : ""}` });
  }
  links.push({ id: "record", label: "案件记录" });

  const waitingLabel = getString(fm.waiting_label);
  const waiting = terminal ? ""
    : card.waitingFor && card.waitingFor !== "self"
      ? [`等待${WAITING_FOR_LABEL[card.waitingFor] ?? card.waitingFor}`, waitingLabel].filter(Boolean).join(" · ")
      : card.waitingFor === "self" && !card.nextAction ? "待本人行动" : "";
  const followUp = terminal ? null : followUpInfo(card.followUpAt, getString(fm.follow_up_action), today);
  const event = terminal ? null : eventInfo(card.nextEventAt, rounds, today);
  const now: CompanyHeroNow | null = card.nextAction || waiting || followUp || event
    ? { action: card.nextAction, waiting, followUp, event, placeholder: "" }
    : inProgress ? { action: "", waiting: "", followUp: null, event: null, placeholder: "未記録" } : null;

  return {
    kind: "case",
    kicker: "案件",
    kickerTitle: [`入库 ${intake || "未記録"}`, JOB_ORIGIN_LABEL[card.origin] ?? card.origin].filter(Boolean).join(" · "),
    name: splitCompanyName(context.company),
    title: context.title === context.company ? "" : context.title,
    status: { label: status || "未記録", tone, note: statusNote },
    tone,
    progress,
    facts,
    links,
    now,
    stack: card.stack,
  };
}

/** 面谈是 todo 笔记，不走 toJobCard——jobStatus() 对没有 status 的笔记会回退成「未応募」，那是伪造的选考状态。 */
function meetingHero(context: CompanyOverview, rounds: InterviewPrepDoc[], today: string): CompanyHero {
  const fm = context.note.frontmatter;
  const ended = meetingEnded(context.note, today);
  const rawStatus = getString(fm.status).trim();
  const tone = companyHeroTone(context, today);

  const progress: CompanyHeroFact[] = [];
  const eventAt = getString(fm.next_event_at).trim();
  const eventDate = DATE.exec(eventAt)?.[0] ?? "";
  // 正本没写面谈时刻、但已关联的准备稿有将来日期：与切换面板同口径借来，title 写明借自谁。
  const borrowed = !eventAt && !ended ? upcomingPrepDoc(rounds, today) : null;
  if (eventDate && eventDate < today) progress.push({ id: "next", label: "日時", value: `${formatContextPickerEvent(eventAt, today) || eventAt} · 已过`, title: eventAt, muted: true });
  else if (eventAt) progress.push({ id: "next", label: "日時", value: formatContextPickerEvent(eventAt, today) || eventAt, title: eventAt });
  else if (borrowed) progress.push({ id: "next", label: "日時", value: formatContextPickerEvent(borrowed.date, today), title: `借自准备稿 ${borrowed.note.path}` });
  else progress.push({ id: "next", label: "日時", value: "未定", muted: true });
  const due = getString(fm.due).trim();
  const dueDays = DATE.test(due) ? daysBetween(due, today) ?? 0 : 0;
  const overdue = !ended && dueDays > 0;
  if (DATE.test(due)) progress.push(overdue ? { id: "due", label: "期限", value: shortDay(due), title: due, tone: "warn" } : { id: "due", label: "期限", value: shortDay(due), title: due });
  const category = getString(fm.category).trim();
  if (category) progress.push({ id: "category", label: "", value: category });
  const priority = getString(fm.priority).trim();
  if (priority) progress.push({ id: "priority", label: "優先度", value: priority });

  const action = getString(fm.action).trim();
  const followUp = overdue ? { label: `期限已过 ${dueDays} 天`, overdue: true } : null;
  const now: CompanyHeroNow | null = ended ? null
    : action || followUp ? { action, waiting: "", followUp, event: null, placeholder: "" }
      : { action: "", waiting: "", followUp: null, event: null, placeholder: "未記録" };

  return {
    kind: "meeting",
    kicker: "面谈",
    kickerTitle: "",
    name: splitCompanyName(context.company),
    title: context.title === context.company ? "" : context.title,
    status: { label: ended ? closedMeetingLabel(rawStatus) : "面谈", tone, note: rawStatus },
    tone,
    progress,
    facts: [],
    links: [{ id: "record", label: "面谈记录" }],
    now,
    stack: [],
  };
}

/** rounds 是该案件／面谈已关联的准备稿（interview-session 已经按正本分好）。 */
export function buildCompanyHero(context: CompanyOverview, { rounds = [], today }: { rounds?: InterviewPrepDoc[]; today: string }): CompanyHero {
  return context.kind === "meeting" ? meetingHero(context, rounds, today) : caseHero(context, rounds, today);
}
