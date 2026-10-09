import type { Commitment } from "./memory-atlas-data.ts";
import { companyIdentity, getString, getType, type Note } from "./notes.ts";
import { calendarRoundBadge, interviewRound, type CalendarRoundBadge } from "./interview-round.ts";

export type CalendarInterviewTarget = {
  view: "session" | "review";
  path: string | null;
  company: string;
  date: string;
  label: string;
  sourcePath: string;
  caseId: string;
  time?: string;
};

type InterviewContext = {
  caseId: string;
  ownerKind: "case" | "meeting" | "";
  owner: string;
  invalid: boolean;
};

function referencePath(value: string) {
  return value.trim().replace(/^["']|["']$/g, "")
    .replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0]
    .trim().replace(/\.md$/i, "").normalize("NFKC");
}

// 每篇笔记的关联解析都要扫一遍全部笔记（日历为每篇算 interviewContext → O(N×M)）。
// notes 数组在两次刷新之间是同一个引用，按数组建一次索引即可；数组换了索引自然作废。
type ReferenceIndex = { byPath: Map<string, Note[]>; byBasename: Map<string, Note[]> };
const referenceIndexes = new WeakMap<Note[], ReferenceIndex>();

function referenceIndex(notes: Note[]): ReferenceIndex {
  const cached = referenceIndexes.get(notes);
  if (cached) return cached;
  const byPath = new Map<string, Note[]>();
  const byBasename = new Map<string, Note[]>();
  for (const note of notes) {
    const path = referencePath(note.path);
    byPath.set(path, [...(byPath.get(path) ?? []), note]);
    const basename = path.slice(path.lastIndexOf("/") + 1);
    byBasename.set(basename, [...(byBasename.get(basename) ?? []), note]);
  }
  const index = { byPath, byBasename };
  referenceIndexes.set(notes, index);
  return index;
}

function resolveReference(value: string, notes: Note[]) {
  const reference = referencePath(value);
  const index = referenceIndex(notes);
  const exact = index.byPath.get(reference) ?? [];
  const basename = reference.slice(reference.lastIndexOf("/") + 1);
  const matches = exact.length ? exact : (index.byBasename.get(basename) ?? []).filter((note) =>
    referencePath(note.path).endsWith(`/${reference}`),
  );
  return { note: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
}

export function interviewContext(note: Note, notes: Note[], source = false): InterviewContext {
  const context: InterviewContext = {
    caseId: getString(note.frontmatter.case_id), ownerKind: "", owner: "", invalid: false,
  };
  const fields = (["case", "meeting"] as const).filter((field) =>
    Boolean(getString(note.frontmatter[field]).trim()),
  );
  if (fields.length > 1) return { ...context, invalid: true };
  const field = fields[0];
  if (field) {
    const value = getString(note.frontmatter[field]);
    const resolved = resolveReference(value, notes);
    context.ownerKind = field;
    context.owner = referencePath(resolved.note?.path ?? value);
    context.invalid = resolved.ambiguous;
    if (resolved.note) {
      const linkedId = getString(resolved.note.frontmatter.case_id);
      context.invalid ||= getType(resolved.note) !== (field === "case" ? "job-case" : "todo");
      context.invalid ||= Boolean(context.caseId && linkedId && context.caseId !== linkedId);
      context.caseId ||= linkedId;
    }
  } else if (source && (getType(note) === "job-case" || (getType(note) === "todo" && !context.caseId))) {
    context.ownerKind = getType(note) === "job-case" ? "case" : "meeting";
    context.owner = referencePath(note.path);
  } else if (context.caseId) {
    // case_id 本身已表明是案件；局部加载没拿到正本，也不能把它当作独立面谈。
    context.ownerKind = "case";
    const owners = notes.filter((candidate) => getType(candidate) === "job-case" &&
      getString(candidate.frontmatter.case_id) === context.caseId);
    if (owners.length === 1) {
      context.owner = referencePath(owners[0].path);
    }
  }
  return context;
}

/** 进展只从明确关联的正本读取；同公司的另一岗位不能替这场面谈给出结果。 */
export function resolveInterviewOwner(note: Note, notes: Note[], eventCaseId = ""): Note | null {
  const context = interviewContext(note, notes, true);
  if (context.invalid || (context.caseId && eventCaseId && context.caseId !== eventCaseId)) return null;
  const caseId = context.caseId || eventCaseId;
  if (context.ownerKind === "case" && context.owner) {
    const resolved = resolveReference(context.owner, notes);
    if (resolved.ambiguous) return null;
    const owner = resolved.note ?? (getType(note) === "job-case" &&
      referencePath(note.path) === context.owner ? note : null);
    if (!owner || getType(owner) !== "job-case") return null;
    const ownerId = getString(owner.frontmatter.case_id);
    return caseId && ownerId && caseId !== ownerId ? null : owner;
  }
  if (caseId) {
    const owners = notes.filter((candidate) => getType(candidate) === "job-case" &&
      getString(candidate.frontmatter.case_id) === caseId);
    // 明确挂着案件、但正本缺失时，不降级读取 TODO 上的独立面谈状态。
    return owners.length === 1 ? owners[0] : null;
  }
  if (context.ownerKind === "meeting" && context.owner) {
    const resolved = resolveReference(context.owner, notes);
    if (resolved.ambiguous) return null;
    const owner = resolved.note ?? (getType(note) === "todo" &&
      referencePath(note.path) === context.owner ? note : null);
    return owner && getType(owner) === "todo" ? owner : null;
  }
  return null;
}

function contextScore(candidate: InterviewContext, expected: InterviewContext): number | null {
  if (candidate.invalid || expected.invalid) return null;
  if (candidate.caseId && expected.caseId && candidate.caseId !== expected.caseId) return null;
  if (candidate.ownerKind && expected.ownerKind &&
    (candidate.ownerKind !== expected.ownerKind ||
      (candidate.owner && expected.owner && candidate.owner !== expected.owner))) return null;
  // 明确写了另一个案件、但链接已经断掉时，也不能退回仅按公司和日期猜测。
  if (expected.caseId && candidate.ownerKind === "case" && !candidate.caseId &&
    candidate.owner !== expected.owner) return null;
  return (candidate.caseId && candidate.caseId === expected.caseId ? 8 : 0) +
    (candidate.owner && candidate.owner === expected.owner ? 8 : 0);
}

function normalizedTime(value: string) {
  const match = value.normalize("NFKC").match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?:\D|$)/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

export function interviewNoteTime(note: Note, date: string) {
  for (const key of ["time", "start_time", "starts_at", "next_event_at"]) {
    const value = getString(note.frontmatter[key]);
    const embeddedDate = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (embeddedDate && embeddedDate !== date) continue;
    const time = normalizedTime(value);
    if (time) return time;
  }
  return "";
}

type MatchingNote = { note: Note; score: number };

/** 日历的中文轮次只是显示名；公司、日期、案件和已知轮次冲突都不能靠分数抵消。 */
function matchingNotes(event: Commitment, notes: Note[]): MatchingNote[] {
  const expectedCompany = companyIdentity(event.company);
  const expectedContext = interviewContext(event.note, notes, true);
  expectedContext.caseId ||= event.caseId;
  const expectedRound = interviewRound(event.label) ||
    (getString(event.note.frontmatter.date) === event.date ? interviewRound(getString(event.note.frontmatter.round)) : "");
  const expectedTime = normalizedTime(event.time);
  const matches: MatchingNote[] = [];
  for (const note of notes) {
    if (!["interview-prep", "transcript-study", "transcript"].includes(getType(note)) ||
      getString(note.frontmatter.date) !== event.date) continue;
    const company = getString(note.frontmatter.company);
    const context = contextScore(interviewContext(note, notes), expectedContext);
    if (context === null) continue;
    // 明确的同一案件关联优先于公司别名；无关联时仍须严格匹配公司。
    if (!context && (expectedCompany ? companyIdentity(company) !== expectedCompany : company !== event.company)) continue;
    const round = interviewRound(getString(note.frontmatter.round));
    if (round && expectedRound && round !== expectedRound) continue;
    const time = interviewNoteTime(note, event.date);
    if (time && expectedTime && time !== expectedTime) continue;
    matches.push({
      note,
      score: context + (round && round === expectedRound ? 4 : 0) +
        (time && time === expectedTime ? 2 : 0) + (note.path === event.note.path ? 16 : 0),
    });
  }
  matches.sort((left, right) => right.score - left.score);
  return matches;
}

function selectMatchingNote(candidates: MatchingNote[], type: string): Note | null {
  const matches = candidates.filter((candidate) => getType(candidate.note) === type);
  // 同分时保留空状态；按文件顺序取第一份，会把歧义伪装成精确定位。
  return matches.length && (matches.length === 1 || matches[0].score > matches[1].score)
    ? matches[0].note : null;
}

/** 旧复盘没有案件关联时，只能由唯一匹配的场次补足，不能按公司猜案件。 */
export function matchingInterviewPrep(event: Commitment, notes: Note[]): Note | null {
  return selectMatchingNote(matchingNotes(event, notes), "interview-prep");
}

/** 多份准备稿可能属于同一场；稿件版本有歧义，不等于所属案件也有歧义。 */
export function matchingInterviewContext(event: Commitment, notes: Note[]): InterviewContext | null {
  const contexts = matchingNotes(event, notes)
    .filter(({ note }) => getType(note) === "interview-prep")
    .map(({ note }) => interviewContext(note, notes));
  if (!contexts.length || contexts.some((context) => context.invalid || !context.ownerKind)) return null;
  const identities = new Set(contexts.map((context) => `${context.caseId}|${context.ownerKind}|${context.owner}`));
  return identities.size === 1 ? contexts[0] : null;
}

function conflictingInterviews(candidates: MatchingNote[], notes: Note[], date: string) {
  const rounds = new Set<string>();
  const times = new Set<string>();
  const cases = new Set<string>();
  const ownerKinds = new Set<string>();
  const owners = new Set<string>();
  for (const { note } of candidates) {
    const round = interviewRound(getString(note.frontmatter.round));
    const time = interviewNoteTime(note, date);
    const context = interviewContext(note, notes);
    if (round) rounds.add(round);
    if (time) times.add(time);
    if (context.caseId) cases.add(context.caseId);
    if (context.ownerKind) ownerKinds.add(context.ownerKind);
    if (context.owner) owners.add(context.owner);
  }
  return [rounds, times, cases, ownerKinds, owners].some((values) => values.size > 1);
}

function compatibleInterviewNotes(event: Commitment, notes: Note[]): MatchingNote[] {
  const matches = matchingNotes(event, notes);
  const strongest = matches.filter((candidate) => candidate.score === matches[0]?.score);
  // 必须跨资料种类一起消歧：两轮准备稿 + 一轮逐字稿，不能因逐字稿只有一份就认定本场已结束。
  return conflictingInterviews(strongest, notes, event.date) ? [] : matches.filter((candidate) =>
    !conflictingInterviews([...strongest, candidate], notes, event.date),
  );
}

/**
 * 日历上的这一项是不是一场面试・面谈（有问答、值得准备与复盘）。说明会・研讨会也会进日历，但不是。
 * 日历进准备稿／复盘页的入口、首页「待整理稿」提醒共用这一条。
 */
export function isInterviewEvent(event: Pick<Commitment, "kind" | "label">) {
  if (event.kind !== "event" || /说明会|説明会|說明會|セミナー|seminar/i.test(event.label)) return false;
  return /面试|面試|面接|面谈|面談|interview|meeting/i.test(event.label);
}

/** 泛称标签可能盖过当轮资料的明确阶段；只补这一场，不从公司历史或当前行动推算。 */
export function resolveCalendarRoundBadge(event: Commitment, notes: Note[]): CalendarRoundBadge | null {
  if (!isInterviewEvent(event) || interviewRound(event.label) === "agent") return null;
  const labeled = calendarRoundBadge(event.label);
  if (labeled) return labeled;
  const context = interviewContext(event.note, notes, true);
  if (context.invalid || (context.caseId && event.caseId && context.caseId !== event.caseId)) return null;
  context.caseId ||= event.caseId;
  const eventTime = normalizedTime(event.time);
  if (["interview-prep", "review", "transcript", "transcript-study"].includes(getType(event.note)) &&
    getString(event.note.frontmatter.date) === event.date) {
    const sourceTime = interviewNoteTime(event.note, event.date);
    if (sourceTime && eventTime && sourceTime !== eventTime) return null;
    const sourceRound = getString(event.note.frontmatter.round);
    if (interviewRound(sourceRound)) return calendarRoundBadge(sourceRound);
  }
  const candidates = compatibleInterviewNotes(event, notes).filter(({ note }) => {
    // 公司与日期相同不足以证明是同一场；旧稿无关联或缺少已知时刻时不借数字。
    if ((contextScore(interviewContext(note, notes), context) ?? 0) <= 0) return false;
    return !eventTime || interviewNoteTime(note, event.date) === eventTime;
  });
  // 多份同轮资料仍可说明阶段，但同分资料的时间、案件或轮次冲突必须保留未知。
  if (conflictingInterviews(candidates, notes, event.date)) return null;
  const rounds = candidates.map(({ note }) => getString(note.frontmatter.round)).filter((round) => interviewRound(round));
  return rounds.length ? calendarRoundBadge(rounds[0]) : null;
}

export function resolveCalendarInterview(event: Commitment, notes: Note[]): CalendarInterviewTarget | null {
  if (!isInterviewEvent(event)) return null;
  const compatible = compatibleInterviewNotes(event, notes);
  const prep = selectMatchingNote(compatible, "interview-prep");
  const review = selectMatchingNote(compatible, "transcript-study");
  const transcript = selectMatchingNote(compatible, "transcript");
  const completedPrep = prep && getString(prep.frontmatter.session_status ?? prep.frontmatter.schedule_status) === "completed";
  const sourceReview = getType(event.note) === "review" && getString(event.note.frontmatter.date) === event.date;
  // 当天只知道开场时间不代表已结束；必须有完成状态或实际面谈记录才转复盘。
  const view = event.phase === "past" || completedPrep || review || transcript || sourceReview ? "review" : "session";
  return {
    view,
    path: (view === "review" ? review : prep)?.path ?? null,
    company: event.company,
    date: event.date,
    label: event.label,
    sourcePath: event.note.path,
    caseId: event.caseId || getString(event.note.frontmatter.case_id),
    time: event.time || undefined,
  };
}
