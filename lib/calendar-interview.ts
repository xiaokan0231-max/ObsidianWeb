import type { Commitment } from "./memory-atlas-data.ts";
import { companyIdentity, getString, getType, type Note } from "./notes.ts";

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

function resolveReference(value: string, notes: Note[]) {
  const reference = referencePath(value);
  const exact = notes.filter((note) => referencePath(note.path) === reference);
  const matches = exact.length ? exact : notes.filter((note) =>
    referencePath(note.path).endsWith(`/${reference}`),
  );
  return { note: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
}

function interviewContext(note: Note, notes: Note[], source = false): InterviewContext {
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

function interviewRound(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
  if (/最終|最终|終面|终面|final|役員/.test(normalized)) return "final";
  if (/エージェント|猎头|獵頭|recruiter/.test(normalized)) return "agent";
  if (/カジュアル|轻松|輕鬆|casual/.test(normalized)) return "casual";
  const number = normalized.match(/(?:第)?([一二三四五六1-6])(?:次|回|輪|轮)?(?:面接|面试|面試|面談|面谈|面)/)?.[1];
  if (number) return `round-${({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 } as Record<string, number>)[number] ?? number}`;
  const ordinal = normalized.match(/first|second|third|fourth|fifth|sixth/)?.[0];
  if (ordinal) return `round-${["first", "second", "third", "fourth", "fifth", "sixth"].indexOf(ordinal) + 1}`;
  return "";
}

function normalizedTime(value: string) {
  const match = value.normalize("NFKC").match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?:\D|$)/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function noteTime(note: Note, date: string) {
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
    if (expectedCompany ? companyIdentity(company) !== expectedCompany : company !== event.company) continue;
    const context = contextScore(interviewContext(note, notes), expectedContext);
    if (context === null) continue;
    const round = interviewRound(getString(note.frontmatter.round));
    if (round && expectedRound && round !== expectedRound) continue;
    const time = noteTime(note, event.date);
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

function conflictingInterviews(candidates: MatchingNote[], notes: Note[], date: string) {
  const rounds = new Set<string>();
  const times = new Set<string>();
  const cases = new Set<string>();
  const ownerKinds = new Set<string>();
  const owners = new Set<string>();
  for (const { note } of candidates) {
    const round = interviewRound(getString(note.frontmatter.round));
    const time = noteTime(note, date);
    const context = interviewContext(note, notes);
    if (round) rounds.add(round);
    if (time) times.add(time);
    if (context.caseId) cases.add(context.caseId);
    if (context.ownerKind) ownerKinds.add(context.ownerKind);
    if (context.owner) owners.add(context.owner);
  }
  return [rounds, times, cases, ownerKinds, owners].some((values) => values.size > 1);
}

export function resolveCalendarInterview(event: Commitment, notes: Note[]): CalendarInterviewTarget | null {
  if (event.kind !== "event" || /说明会|説明会|說明會|セミナー|seminar/.test(event.label)) return null;
  if (!/面试|面試|面接|面谈|面談|interview|meeting/i.test(event.label)) return null;
  const matches = matchingNotes(event, notes);
  const strongest = matches.filter((candidate) => candidate.score === matches[0]?.score);
  // 必须跨资料种类一起消歧：两轮准备稿 + 一轮逐字稿，不能因逐字稿只有一份就认定本场已结束。
  const compatible = conflictingInterviews(strongest, notes, event.date) ? [] : matches.filter((candidate) =>
    !conflictingInterviews([...strongest, candidate], notes, event.date),
  );
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
