import { getString, noteBasename, type Note } from "./notes.ts";
import { normalizeJobStatus } from "./job-status.ts";
import type { CompanyOverview } from "./company-overview.ts";
import { interviewPrepTemporalStatus, type InterviewPrepSeries } from "./interview-prep-index.ts";
import type { InterviewPrepDoc } from "./interview-prep-doc.ts";

/**
 * 「公司／岗位或面谈」选择器的数据层。
 *
 * 原来是一个原生 <select>，把上百条案件、面谈、历史准备稿按公司名平铺，
 * 64 条不採用和此刻要看的两三条混在一起，读不出谁是谁。这里先算「此刻关心程度」再分组：
 * 即将面谈 → 选考进行中 → 待判断 → 已结束（默认折叠）→ 历史准备稿。
 * 组件只负责画；分组、排序、搜索都在这里，好让 node:test 直接验证。
 */

export type ContextPickerKind = "case" | "meeting" | "series";
/** 与看板 .tone-* 同一套色，外加面谈专用的 meeting（面谈没有应募状态）。 */
export type ContextPickerTone = "interview" | "progress" | "offer" | "pending" | "reject" | "neutral" | "meeting";
export type ContextPickerItem = {
  /** 与旧 select 的 option value 同形：context:<path> / series:<key>，切换逻辑不用改。 */
  id: string;
  kind: ContextPickerKind;
  company: string;
  title: string;
  /** 案件：七态之一，或原样保留的自定义状态；面谈、历史准备稿为空。 */
  status: string;
  /** status 括号里的补充（日期・经路等），只进悬停提示，不占行内空间。 */
  detail: string;
  tone: ContextPickerTone;
  assessed: boolean;
  /** 下一场面谈："YYYY-MM-DD" 或 "YYYY-MM-DD HH:mm"，没有则空。 */
  eventAt: string;
  rounds: number;
  updatedOn: string;
  haystack: string;
};
/** current 只由 pinCurrentContextPickerGroup 生成：当前项钉在顶部，不必为了找到它展开已结束。 */
export type ContextPickerGroupId = "current" | "upcoming" | "active" | "undecided" | "hold" | "closed" | "legacy";
export type ContextPickerGroup = {
  id: ContextPickerGroupId;
  label: string;
  hint: string;
  /** 保留与已结束默认折叠：33 条保留加 64 条不採用是最大的噪音源，但搜索时仍要能命中。 */
  collapsible: boolean;
  items: ContextPickerItem[];
};

const GROUP_META: Record<ContextPickerGroupId, Omit<ContextPickerGroup, "items">> = {
  current: { id: "current", label: "当前", hint: "正在看的", collapsible: false },
  upcoming: { id: "upcoming", label: "即将面谈", hint: "按日期先后", collapsible: false },
  active: { id: "active", label: "选考进行中", hint: "面接中 · 内定 · 書類通過 · 応募済", collapsible: false },
  undecided: { id: "undecided", label: "待判断", hint: "未応募 · 未归类状态", collapsible: false },
  hold: { id: "hold", label: "保留", hint: "暂缓的案件", collapsible: true },
  closed: { id: "closed", label: "已结束", hint: "不採用与已完成的面谈", collapsible: true },
  legacy: { id: "legacy", label: "历史准备稿", hint: "尚未关联案件或面谈正本", collapsible: false },
};
/** 分组时只会落到这几组；current 是展示层钉出来的。 */
type BuiltGroupId = Exclude<ContextPickerGroupId, "current">;
const GROUP_ORDER: BuiltGroupId[] = ["upcoming", "active", "undecided", "hold", "closed", "legacy"];
/** 选考进行中的组内顺序：越接近结果越靠前。开放中的面谈夹在書類通過与応募済之间。 */
const ACTIVE_RANK: Record<string, number> = { "面接中": 0, "内定": 1, "書類通過": 2, "面谈": 3, "応募済": 4 };
const UNDECIDED_RANK: Record<string, number> = { "未応募": 0 };
const DATE = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/;

export function statusTone(status: string): ContextPickerTone {
  if (status === "面接中") return "interview";
  if (status === "応募済" || status === "書類通過") return "progress";
  if (status === "内定") return "offer";
  if (status === "未応募") return "pending";
  if (status === "不採用") return "reject";
  return "neutral";
}

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function parseEvent(value: string) {
  const match = DATE.exec(value.trim());
  if (!match) return null;
  const time = match[2] ? match[2].padStart(5, "0") : "";
  return { date: match[1], time, eventAt: time ? `${match[1]} ${time}` : match[1] };
}

/** 面谈 todo 一旦记为完了或日期已过，就不再是「进行中」。 */
function meetingClosed(note: Note, today: string) {
  const status = getString(note.frontmatter.status);
  if (/完了|完成|done|cancelled|中止|取消/i.test(status)) return true;
  const event = parseEvent(getString(note.frontmatter.next_event_at) || getString(note.frontmatter.due));
  return Boolean(event && event.date < today);
}

function upcomingPrepDate(docs: InterviewPrepDoc[], today: string) {
  return docs.reduce((earliest, doc) => {
    const temporal = interviewPrepTemporalStatus(doc, today);
    if ((temporal !== "scheduled" && temporal !== "upcoming") || doc.date < today) return earliest;
    return !earliest || doc.date < earliest ? doc.date : earliest;
  }, "");
}

function latestPrepDate(docs: InterviewPrepDoc[]) {
  return docs.reduce((latest, doc) => (/^\d{4}-\d{2}-\d{2}$/.test(doc.date) && doc.date > latest ? doc.date : latest), "");
}

function haystack(parts: string[]) {
  return normalize(parts.filter(Boolean).join(" "));
}

function contextItem(context: CompanyOverview, rounds: InterviewPrepDoc[], today: string): { item: ContextPickerItem; group: BuiltGroupId } {
  const note = context.note;
  const updatedOn = getString(note.frontmatter.status_updated) || getString(note.frontmatter.updated) || latestPrepDate(rounds);
  const prepDate = upcomingPrepDate(rounds, today);
  const base = {
    id: `context:${note.path}`,
    company: context.company,
    title: context.title,
    assessed: Boolean(context.assessment),
    rounds: rounds.length,
    updatedOn,
  };
  if (context.kind === "meeting") {
    // 面谈时刻只认 next_event_at。due 是任务期限，拿它当面谈日，一条「准备问题」的 todo
    // 就会冒充一场面谈，和同一案件的案件行在「即将面谈」里并排出现两次。
    // 同理，已完了的准备任务不再是一场待办面谈——即使它的期限还没到。
    const closed = meetingClosed(note, today);
    const event = parseEvent(getString(note.frontmatter.next_event_at));
    const eventAt = closed ? "" : event && event.date >= today ? event.eventAt : prepDate;
    const item: ContextPickerItem = { ...base, kind: "meeting", status: "", detail: "", tone: "meeting", eventAt,
      haystack: haystack([context.company, context.title, "面谈 面談", noteBasename(note.path)]) };
    return { item, group: eventAt ? "upcoming" : closed ? "closed" : "active" };
  }
  const raw = getString(note.frontmatter.status);
  const status = normalizeJobStatus(raw) ?? raw;
  const detail = raw === status ? "" : raw;
  // 案件正本自己写的 next_event_at 优先（带时刻）；没有才用已关联准备稿的日期兜底。
  const event = parseEvent(getString(note.frontmatter.next_event_at));
  const eventAt = event && event.date >= today ? event.eventAt : prepDate;
  const item: ContextPickerItem = { ...base, kind: "case", status, detail, tone: statusTone(status), eventAt,
    haystack: haystack([context.company, context.title, status, context.caseId, noteBasename(note.path)]) };
  const group: BuiltGroupId = eventAt ? "upcoming"
    : status in ACTIVE_RANK ? "active"
      : status === "不採用" ? "closed"
        : status === "保留" ? "hold"
          : "undecided";
  return { item, group };
}

function seriesItem(series: InterviewPrepSeries, today: string): { item: ContextPickerItem; group: BuiltGroupId } {
  const eventAt = upcomingPrepDate(series.rounds, today);
  const title = series.caseLink || series.meetingLink || "历史准备";
  const item: ContextPickerItem = {
    id: `series:${series.key}`, kind: "series", company: series.company, title, status: "", detail: "", tone: "neutral",
    assessed: false, eventAt, rounds: series.rounds.length, updatedOn: latestPrepDate(series.rounds),
    haystack: haystack([series.company, title, "历史准备稿", ...series.rounds.map((doc) => doc.round)]),
  };
  return { item, group: eventAt ? "upcoming" : "legacy" };
}

const collator = new Intl.Collator("ja");
function byCompany(left: ContextPickerItem, right: ContextPickerItem) {
  return collator.compare(left.company, right.company) || collator.compare(left.title, right.title) || left.id.localeCompare(right.id);
}
function byRecent(left: ContextPickerItem, right: ContextPickerItem) {
  return right.updatedOn.localeCompare(left.updatedOn) || byCompany(left, right);
}
function activeRank(item: ContextPickerItem) {
  return ACTIVE_RANK[item.kind === "meeting" ? "面谈" : item.status] ?? 9;
}
const SORTERS: Record<BuiltGroupId, (left: ContextPickerItem, right: ContextPickerItem) => number> = {
  upcoming: (left, right) => left.eventAt.localeCompare(right.eventAt) || byCompany(left, right),
  active: (left, right) => activeRank(left) - activeRank(right) || byRecent(left, right),
  undecided: (left, right) => (UNDECIDED_RANK[left.status] ?? 9) - (UNDECIDED_RANK[right.status] ?? 9) || byRecent(left, right),
  hold: byRecent,
  closed: byRecent,
  legacy: byRecent,
};

export function buildContextPickerGroups({ contexts, series, docs, docContexts, today }: {
  contexts: CompanyOverview[];
  series: InterviewPrepSeries[];
  docs: InterviewPrepDoc[];
  /** 准备稿路径 → 它关联的正本（interview-session 已经算好，直接复用）。 */
  docContexts: Map<string, CompanyOverview | null>;
  today: string;
}): ContextPickerGroup[] {
  const roundsByContext = new Map<string, InterviewPrepDoc[]>();
  for (const doc of docs) {
    const context = docContexts.get(doc.note.path);
    if (!context) continue;
    roundsByContext.set(context.key, [...(roundsByContext.get(context.key) ?? []), doc]);
  }
  const buckets = new Map<BuiltGroupId, ContextPickerItem[]>();
  const push = ({ item, group }: { item: ContextPickerItem; group: BuiltGroupId }) => buckets.set(group, [...(buckets.get(group) ?? []), item]);
  for (const context of contexts) push(contextItem(context, roundsByContext.get(context.key) ?? [], today));
  // 有正本的准备稿已经挂在案件／面谈之下；只有完全没有正本的系列才单独列出。
  for (const item of series) if (!item.rounds.some((doc) => docContexts.get(doc.note.path))) push(seriesItem(item, today));
  return GROUP_ORDER.flatMap((id) => {
    const items = buckets.get(id);
    return items?.length ? [{ ...GROUP_META[id], items: [...items].sort(SORTERS[id]) }] : [];
  });
}

/** 每个词都要命中；全角半角、大小写不计。空查询原样返回。 */
export function filterContextPickerGroups(groups: ContextPickerGroup[], query: string): ContextPickerGroup[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return groups;
  return groups.flatMap((group) => {
    const items = group.items.filter((item) => tokens.every((token) => item.haystack.includes(token)));
    return items.length ? [{ ...group, items }] : [];
  });
}

/**
 * 当前项钉到最上面、从原组里拿掉。正在看的若是某条不採用，
 * 不这样做就得展开 64 条已结束才能看见自己在哪。搜索时不钉，命中项回到原组。
 */
export function pinCurrentContextPickerGroup(groups: ContextPickerGroup[], selectedId: string): ContextPickerGroup[] {
  const current = selectedId ? findContextPickerItem(groups, selectedId) : null;
  if (!current) return groups;
  const rest = groups.flatMap((group) => {
    const items = group.items.filter((item) => item.id !== selectedId);
    return items.length ? [{ ...group, items }] : [];
  });
  return [{ ...GROUP_META.current, items: [current] }, ...rest];
}

export function findContextPickerItem(groups: ContextPickerGroup[], id: string) {
  for (const group of groups) for (const item of group.items) if (item.id === id) return item;
  return null;
}

function dayIndex(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** 列表右侧的短日期：今天／明天直说，其余只给月日，跨年才带年。 */
export function formatContextPickerEvent(eventAt: string, today: string) {
  const event = parseEvent(eventAt);
  if (!event) return "";
  const days = dayIndex(event.date) - dayIndex(today);
  const [year, month, day] = event.date.split("-").map(Number);
  const dayLabel = days === 0 ? "今天" : days === 1 ? "明天" : year === Number(today.slice(0, 4)) ? `${month}/${day}` : `${year}/${month}/${day}`;
  return event.time ? `${dayLabel} ${event.time}` : dayLabel;
}
