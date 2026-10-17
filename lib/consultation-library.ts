import { interviewNoteTime } from "./calendar-interview.ts";
import { interviewSessionOwner, resolveInterviewOutcomes, type InterviewOutcome } from "./interview-outcome.ts";
import { interviewRound, interviewRoundLabelJa } from "./interview-round.ts";
import { parseAppliedLedger } from "./job-stats.mjs";
import { normalizeJobStatus } from "./job-status.mjs";
import { jobAppliedOn, jobPosition, JOB_CASE_TYPE } from "./jobs.ts";
import { companyIdentity, getString, getType, stripFrontmatter, type Note } from "./notes.ts";
import { joinReviewNotes, type JoinedReviewNotes } from "./review-join.ts";
import { plainSei } from "./review.ts";
import { includeRuntimeNote } from "./vault-boundary.mjs";

export type ConsultationSessionSummary = {
  id: string; companyId: string; company: string; date: string; round: string;
  outcome: string; outcomeKind: "offer" | "passed" | "rejected" | "waiting" | "unknown" | "not-applicable";
  hasRaw: boolean; hasReadable: boolean;
  recordKind?: "transcript" | "memory";
  stage?: string;
};
export type ConsultationCompany = {
  id: string; company: string;
  applications: { id: string; position: string; status: string; appliedOn: string; updatedOn: string; channel: string }[];
  sessionIds: string[]; latestDate: string; outcome: string;
  reachedFinal?: boolean; hasPassedInterview?: boolean;
};
export type ConsultationCatalog = { companies: ConsultationCompany[]; sessions: ConsultationSessionSummary[]; updatedAt: string };
export type ConsultationTranscript = ConsultationSessionSummary & {
  blocks: { id: string; title: string; turns: { id: string; speaker: "interviewer" | "self" | "unknown"; text: string; uncertain: boolean }[] }[];
  raw: string; notice: string;
};

type SourceSession = { note: Note; raw?: Note; readable?: JoinedReviewNotes };

// 页面只拿稳定 ID；查询参数始终在已投影的场次集合里匹配，不解码成任意文件路径。
function stableId(kind: string, value: string) {
  let first = 2166136261;
  let second = 3339675911;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 16777619);
    second = Math.imul(second ^ value.charCodeAt(index), 2246822519);
  }
  return `${kind}-${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function safeText(value: string) {
  return value
    .replace(/<!--[^]*?-->/g, "")
    .replace(/!?\[\[[^\]]*\]\]/g, "［関連資料］")
    .replace(/https?:\/\/[^\s<>「」]+/g, "［リンク非表示］")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "［メール非表示］")
    .replace(/(?:\+81[-\s]?|0)\d{1,4}[-\s]\d{1,4}[-\s]\d{3,4}/g, "［電話非表示］")
    .replace(/\b0\d{9,10}\b/g, "［電話非表示］")
    .replace(/(?:\/Users\/|file:\/\/|(?:20_求職|99_系统|90_归档)\/)[^\s<>「」]*/g, "［内部資料非表示］")
    .trim();
}

const day = (value: unknown) => getString(value).match(/^20\d{2}-\d{2}-\d{2}/)?.[0] ?? "";
const nameOf = (note: Note) => getString(note.frontmatter.company).trim();
const identityOf = (note: Note) => companyIdentity(nameOf(note)) || `unnamed:${note.path}`;
const companyIdOf = (note: Note) => stableId("company", identityOf(note));

function referenceKey(value: string) {
  return value.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].replace(/\.md$/i, "");
}

function referencedRaw(study: Note, raws: Note[]) {
  const reference = referenceKey(getString(study.frontmatter.source_note));
  if (!reference || reference.split("/").includes("..")) return null;
  const folder = study.path.slice(0, study.path.lastIndexOf("/") + 1);
  const exact = raws.filter(raw => referenceKey(raw.path) === reference || referenceKey(raw.path) === `${folder}${reference}`);
  const matches = exact.length ? exact : raws.filter(raw => referenceKey(raw.path).split("/").at(-1) === reference);
  return matches.length === 1 ? matches[0] : null;
}

function sameSession(left: Note, right: Note, notes: Note[]) {
  if (identityOf(left) !== identityOf(right) || !day(left.frontmatter.date) || day(left.frontmatter.date) !== day(right.frontmatter.date)) return false;
  const leftRound = getString(left.frontmatter.round);
  const rightRound = getString(right.frontmatter.round);
  if (!leftRound || !rightRound || (interviewRound(leftRound) || leftRound) !== (interviewRound(rightRound) || rightRound)) return false;
  const leftTime = interviewNoteTime(left, day(left.frontmatter.date));
  const rightTime = interviewNoteTime(right, day(right.frontmatter.date));
  if (leftTime && rightTime && leftTime !== rightTime) return false;
  const leftOwner = interviewSessionOwner(left, notes);
  const rightOwner = interviewSessionOwner(right, notes);
  // 同公司同日可能有多个岗位；只有关联相容，且候选唯一时才合并两种稿件。
  const hasDeclaredOwner = (note: Note) => ["case", "meeting", "case_id"].some(field => getString(note.frontmatter[field]).trim());
  if ((hasDeclaredOwner(left) && !leftOwner) || (hasDeclaredOwner(right) && !rightOwner)) return false;
  return leftOwner?.path === rightOwner?.path;
}

function sourceSessions(notes: Note[]): SourceSession[] {
  const raws = notes.filter(note => getType(note) === "transcript").sort((a, b) => a.path.localeCompare(b.path));
  const readables = joinReviewNotes(notes).sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  const used = new Set<string>();
  const sessions: SourceSession[] = [];
  for (const readable of readables) {
    const study = readable.note;
    const hasReference = Boolean(getString(study.frontmatter.source_note));
    let raw = hasReference ? referencedRaw(study, raws) : null;
    if (!hasReference) {
      const sessionId = getString(study.frontmatter.session_id);
      const matches = (candidate: Note, other: Note) => sessionId
        ? getString(candidate.frontmatter.session_id) === getString(other.frontmatter.session_id)
        : sameSession(candidate, other, notes);
      const candidates = raws.filter(candidate => !used.has(candidate.path) && matches(study, candidate) &&
        readables.filter(other => !getString(other.note.frontmatter.source_note) && matches(other.note, candidate)).length === 1);
      if (candidates.length === 1) raw = candidates[0];
    }
    if (raw) {
      const studyOwner = interviewSessionOwner(study, notes);
      const rawOwner = interviewSessionOwner(raw, notes);
      // 显式原稿链接也不能覆盖互相矛盾的案件归属；有冲突时保留两个独立入口。
      if (studyOwner && rawOwner && studyOwner.path !== rawOwner.path) raw = null;
    }
    if (raw && used.has(raw.path)) raw = null;
    if (raw) used.add(raw.path);
    sessions.push({ note: study, readable, ...(raw ? { raw } : {}) });
  }
  for (const raw of raws) if (!used.has(raw.path)) sessions.push({ note: raw, raw });
  return sessions;
}

function sessionId(source: SourceSession) { return stableId("session", source.raw?.path ?? source.note.path); }

function isMemory(source: SourceSession) {
  return [source.note, source.raw].some(note => note && (note.frontmatter.verbatim === false ||
    getString(note.frontmatter.reconstruction) === "memory" || getString(note.frontmatter.assessment_scope) === "memory"));
}

function rawText(source: SourceSession) {
  return source.raw ? safeText(stripFrontmatter(source.raw.content.replace(/\r\n/g, "\n"))) : "";
}

function hasRawContent(source: SourceSession) {
  // 只有标题、元数据或内部引用的空壳不是原稿，不能生成打不开正文的入口。
  return Boolean(rawText(source).replace(/^#{1,6}\s.*$/gm, "").replace(/［(?:関連資料|内部資料非表示|リンク非表示)］/g, "").replace(/^[-_*\s]+$/gm, "").trim());
}

function hasReadableContent(source: SourceSession) {
  return Boolean(source.readable?.parsed.sentences.some(sentence => safeText(plainSei(sentence)).trim()));
}

function isEnterpriseSession(source: SourceSession, notes: Note[]) {
  const owner = interviewSessionOwner(source.note, notes);
  const labels = [source.note, source.raw, owner].filter((note): note is Note => Boolean(note)).flatMap(note =>
    ["round", "meeting_kind", "session_kind", "purpose", "category"].map(field => getString(note.frontmatter[field])));
  if (labels.some(label => interviewRound(label) === "agent")) return false;
  // 只排除明确的非选考场次语义，不能因企业名、平台来源或结果未知删除真实面试。
  return !labels.some(label => /説明会|说明会|セミナー|\bseminar\b|ユーザーサクセス|選考ではない|非選考|企業選考の対象外|媒体の担当面談|平台服务|非企业面试|^(?:platform-support|career-support|career-consultation)$/i.test(label));
}

function confirmedPrep(note: Note) {
  return getType(note) === "interview-prep" && Boolean(day(note.frontmatter.date)) &&
    ["scheduled", "completed"].includes(getString(note.frontmatter.session_status ?? note.frontmatter.schedule_status));
}

function structuredInvitations(notes: Note[]): Note[] {
  return notes.flatMap(note => {
    if (![JOB_CASE_TYPE, "todo"].includes(getType(note))) return [];
    if (["draft", "preparing", "cancelled", "canceled", "tentative"].includes(getString(note.frontmatter.session_status ?? note.frontmatter.schedule_status))) return [];
    const match = getString(note.frontmatter.next_event_at).match(/^(20\d{2}-\d{2}-\d{2})(?:[ T]((?:[01]?\d|2[0-3]):[0-5]\d))?(?:\s+([^\d].*))?$/u);
    const round = getString(note.frontmatter.next_event_label) || match?.[3] || "";
    if (!match || !interviewRound(round)) return [];
    const owner = interviewSessionOwner(note, notes);
    if (!owner) return [];
    // 结构化确约只作为结果解析候选，不产生页面场次或可打开的虚构稿件。
    return [{ ...note, path: `${note.path}::consultation-invitation`, content: "", frontmatter: {
      type: "interview-prep", company: nameOf(owner), date: match[1], time: match[2]?.padStart(5, "0") ?? "", round,
      session_status: "scheduled", [getType(owner) === JOB_CASE_TYPE ? "case" : "meeting"]: `[[${owner.path}]]`,
    } }];
  });
}

function resultFor(source: SourceSession, result: InterviewOutcome | undefined, notes: Note[]): Pick<ConsultationSessionSummary, "outcome" | "outcomeKind"> {
  if (result?.kind === "not_applicable") return { outcome: "企業選考の対象外", outcomeKind: "not-applicable" };
  if (result?.kind === "rejected") return { outcome: "不採用", outcomeKind: "rejected" };
  if (result?.kind === "no_response") return { outcome: "結果待ち", outcomeKind: "waiting" };
  if (result?.kind === "withdrawn") return { outcome: "本人判断で保留", outcomeKind: "unknown" };
  if (result?.kind === "passed") {
    const owner = interviewSessionOwner(source.note, notes);
    if (result.source === "job-case" && normalizeJobStatus(getString(owner?.frontmatter.status)) === "内定") return { outcome: "内定", outcomeKind: "offer" };
    return { outcome: "次の選考へ進行", outcomeKind: "passed" };
  }
  return { outcome: interviewSessionOwner(source.note, notes) ? "結果は未確認" : "応募との関連は未確認", outcomeKind: "unknown" };
}

function model(notes: Note[]) {
  const available = notes.filter(note => includeRuntimeNote(note));
  const sources = sourceSessions(available).filter(source => (hasRawContent(source) || hasReadableContent(source)) && isEnterpriseSession(source, available));
  const sourcePaths = new Set(sources.flatMap(source => [source.note.path, ...(source.raw ? [source.raw.path] : [])]));
  // 只有原稿的场次也复用同一归属与次轮判定，不从正文或准备稿补造场次。
  const outcomeNotes = [...available.filter(note => !["transcript", "transcript-study"].includes(getType(note)) || sourcePaths.has(note.path)).map(note => {
    if (getType(note) === "transcript" && sources.some(source => !source.readable && source.raw === note)) return { ...note, frontmatter: { ...note.frontmatter, type: "transcript-study" } };
    // 未确认的准备稿仍可用于旧稿归属回退，但不能证明已经通过或进入下一轮。
    if (getType(note) === "interview-prep" && (!confirmedPrep(note) || !isEnterpriseSession({ note }, available))) return { ...note, frontmatter: { ...note.frontmatter, session_status: "draft" } };
    return note;
  }), ...structuredInvitations(available)];
  const outcomes = resolveInterviewOutcomes(outcomeNotes);
  const sessions = sources.map(source => {
    const owner = interviewSessionOwner(source.note, outcomeNotes);
    // 品牌与法人名称可以不同，只有明确案件归属才允许沿用案件公司的分组与显示名。
    const companySource = owner && getType(owner) === JOB_CASE_TYPE ? owner : source.note;
    return {
      id: sessionId(source), companyId: companyIdOf(companySource), company: safeText(nameOf(companySource)) || "会社名は未確認",
      date: day(source.note.frontmatter.date), round: safeText(interviewRoundLabelJa(getString(source.note.frontmatter.round)) || getString(source.note.frontmatter.round)),
      ...resultFor(source, outcomes.get(source.note.path), outcomeNotes), hasRaw: hasRawContent(source),
      hasReadable: hasReadableContent(source), stage: interviewRound(getString(source.note.frontmatter.round)),
      recordKind: isMemory(source) ? "memory" as const : "transcript" as const,
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { available, sources, sessions };
}

export function buildConsultationCatalog(notes: Note[]): ConsultationCatalog {
  const { available, sources, sessions } = model(notes);
  const companyIds = new Set(sessions.map(session => session.companyId));
  const interviewedApplications = new Set(sources.flatMap(source => {
    const owner = interviewSessionOwner(source.note, available);
    return owner && getType(owner) === JOB_CASE_TYPE ? [owner.path] : [];
  }));
  const applications = available.filter(note => getType(note) === JOB_CASE_TYPE &&
    interviewedApplications.has(note.path) && companyIds.has(companyIdOf(note)) &&
    Boolean(normalizeJobStatus(getString(note.frontmatter.status))) && normalizeJobStatus(getString(note.frontmatter.status)) !== "未応募");
  const ledger = available.find(note => note.path.endsWith("/_応募日台帳.md"));
  const appliedDates = new Map<string, string>();
  for (const row of parseAppliedLedger(ledger?.content ?? "")) {
    const identity = companyIdentity(row.matchName);
    const previous = appliedDates.get(identity);
    if (!previous || row.appliedOn < previous) appliedDates.set(identity, row.appliedOn);
  }
  const companies = new Map<string, ConsultationCompany>();
  const ensureCompany = (id: string, company: string) => {
    let item = companies.get(id);
    if (!item) { item = { id, company, applications: [], sessionIds: [], latestDate: "", outcome: "応募結果は未確認", reachedFinal: false, hasPassedInterview: false }; companies.set(id, item); }
    return item;
  };
  for (const note of applications.sort((a, b) => a.path.localeCompare(b.path))) {
    const item = ensureCompany(companyIdOf(note), safeText(nameOf(note)) || "会社名は未確認");
    const status = normalizeJobStatus(getString(note.frontmatter.status))!;
    const explicitDate = jobAppliedOn(note, getString(note.frontmatter.status));
    // 台账按公司记录，不能把同一天移植给多个岗位；案件正本的応募日优先。
    const uniqueCompany = applications.filter(candidate => identityOf(candidate) === identityOf(note)).length === 1;
    const appliedOn = explicitDate || (uniqueCompany ? appliedDates.get(identityOf(note)) ?? "" : "");
    const updatedOn = day(note.frontmatter.status_updated) || day(note.frontmatter.updated);
    item.applications.push({ id: stableId("application", note.path), position: safeText(jobPosition(note)), status, appliedOn, updatedOn, channel: safeText(getString(note.frontmatter.channel)) });
    item.latestDate = [item.latestDate, appliedOn, updatedOn].sort().at(-1) ?? "";
    item.outcome = [...new Set(item.applications.map(application => application.status))].join(" / ");
  }
  for (const session of sessions) {
    const item = ensureCompany(session.companyId, session.company);
    item.sessionIds.push(session.id);
    item.reachedFinal ||= session.stage === "final";
    item.hasPassedInterview ||= session.outcomeKind === "passed" || session.outcomeKind === "offer";
    if (session.date > item.latestDate) item.latestDate = session.date;
  }
  const ownersWithRecords = new Map<string, Set<string>>();
  for (const source of sources) {
    const owner = interviewSessionOwner(source.note, available);
    const summary = sessions.find(session => session.id === sessionId(source));
    if (!owner || !summary) continue;
    ownersWithRecords.set(owner.path, new Set([...(ownersWithRecords.get(owner.path) ?? []), summary.companyId]));
  }
  for (const note of available) {
    const tentative = ["draft", "preparing", "cancelled", "canceled", "tentative"].includes(getString(note.frontmatter.session_status ?? note.frontmatter.schedule_status));
    const structuredInvite = !tentative && [JOB_CASE_TYPE, "todo"].includes(getType(note)) && Boolean(day(note.frontmatter.next_event_at)) &&
      interviewRound(getString(note.frontmatter.next_event_label) || getString(note.frontmatter.next_event_at)) === "final";
    const finalPrep = confirmedPrep(note) && interviewRound(getString(note.frontmatter.round)) === "final";
    if (!structuredInvite && !finalPrep) continue;
    const owner = interviewSessionOwner(note, available);
    if (!owner || !ownersWithRecords.has(owner.path)) continue;
    // 确认邀约只能补同一案件的进展，不能把另一岗位的终面传给这场面试。
    for (const id of ownersWithRecords.get(owner.path) ?? []) {
      const company = companies.get(id);
      if (company) company.reachedFinal = true;
    }
  }
  const mtimes = available.map(note => note.stat?.mtime ?? 0).filter(value => Number.isFinite(value) && value > 0 && value <= 8640000000000000);
  const maximumMtime = Math.max(0, ...mtimes);
  return { companies: [...companies.values()].sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.company.localeCompare(b.company, "ja")), sessions,
    updatedAt: maximumMtime ? new Date(maximumMtime).toISOString() : "" };
}

export function findConsultationTranscript(notes: Note[], id: string): ConsultationTranscript | null {
  const { sources, sessions } = model(notes);
  const summary = sessions.find(session => session.id === id);
  const source = sources.find(candidate => sessionId(candidate) === id);
  if (!summary || !source) return null;
  const tasks = source.readable?.decisionTasks ?? [];
  const blocks = source.readable?.parsed.blocks.map((block, index) => ({ id: block.id, title: `やり取り ${index + 1}`, turns: block.sentences.map(sentence => {
    const decision = tasks.find(task => task.sentenceId === sentence.id && task.target === "speaker");
    const speaker = decision?.resolution === "speaker-interviewer" ? "interviewer" : decision?.resolution === "speaker-self" ? "self"
      : sentence.uncertainSpeaker ? "unknown" : sentence.speaker === "面" ? "interviewer" : "self";
    return { id: sentence.id, speaker: speaker as "interviewer" | "self" | "unknown", text: safeText(plainSei(sentence)), uncertain: speaker === "unknown" };
  }) })) ?? [];
  const notice = isMemory(source) ? "本人の記憶から再構成した資料です。実際の逐語発言とは区別してください。"
    : summary.hasReadable ? "読みやすく整理した記録です。フィラー等が省略されている場合があります。原音は未確認です。"
    : "原始転写のみの記録です。話者の分離や聞き取りには未確認の箇所があります。原音は未確認です。";
  return { ...summary, blocks, raw: summary.hasRaw ? rawText(source) : "", notice };
}
