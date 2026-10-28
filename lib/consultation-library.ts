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

export { selectConsultationReadingStarts } from "./consultation-reading-start.ts";

export type ConsultationReadingGuide = {
  featured: boolean; introduction?: string; request?: string;
  excerpts: { blockId: string; text: string }[]; blockCount: number;
};

export type ConsultationSessionSummary = {
  id: string; companyId: string; company: string; date: string; round: string;
  outcome: string; outcomeKind: "offer" | "passed" | "rejected" | "waiting" | "unknown" | "not-applicable";
  hasRaw: boolean; hasReadable: boolean;
  recordKind?: "transcript" | "memory";
  stage?: string;
  position?: string;
  readingGuide?: ConsultationReadingGuide;
};
export type ConsultationCompany = {
  id: string; company: string;
  applications: { id: string; position: string; status: string; appliedOn: string; updatedOn: string; channel: string }[];
  sessionIds: string[]; latestDate: string; outcome: string;
  reachedFinal?: boolean; hasPassedInterview?: boolean;
  hasTranscript?: boolean; interviews?: ConsultationInterview[];
};
export type ConsultationInterview = {
  id: string; date: string; round: string; stage: string; outcome: string;
  outcomeKind: ConsultationSessionSummary["outcomeKind"]; sessionId?: string;
  evidenceKind: "transcript" | "review" | "completed-prep" | "job-case" | "history";
  position?: string;
};
export type ConsultationCatalog = { companies: ConsultationCompany[]; sessions: ConsultationSessionSummary[]; updatedAt: string };
export type ConsultationTranscript = ConsultationSessionSummary & {
  blocks: { id: string; title: string; turns: { id: string; speaker: "interviewer" | "self" | "unknown"; text: string; uncertain: boolean }[] }[];
  raw: string; notice: string;
};

type SourceSession = { note: Note; raw?: Note; readable?: JoinedReviewNotes };
type CompletedEvidence = { note: Note; original: Note; date: string; round: string; result: string; position: string; kind: Exclude<ConsultationInterview["evidenceKind"], "transcript"> };

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

function projectBlocks(source: SourceSession): ConsultationTranscript["blocks"] {
  const speakerDecisions = new Map<string, string | undefined>();
  for (const task of source.readable?.decisionTasks ?? []) {
    if (task.target === "speaker" && !speakerDecisions.has(task.sentenceId)) speakerDecisions.set(task.sentenceId, task.resolution);
  }
  return source.readable?.parsed.blocks.map((block, index) => ({
    id: block.id, title: `やり取り ${index + 1}`,
    turns: block.sentences.map(sentence => {
      const decision = speakerDecisions.get(sentence.id);
      const speaker = decision === "speaker-interviewer" ? "interviewer" : decision === "speaker-self" ? "self"
        : sentence.uncertainSpeaker ? "unknown" : sentence.speaker === "面" ? "interviewer" : "self";
      return { id: sentence.id, speaker: speaker as "interviewer" | "self" | "unknown", text: safeText(plainSei(sentence)), uncertain: speaker === "unknown" };
    }),
  })) ?? [];
}

function teacherField(source: SourceSession, key: string): unknown {
  return Object.hasOwn(source.note.frontmatter, key) ? source.note.frontmatter[key] : source.raw?.frontmatter[key];
}

function teacherText(source: SourceSession, key: string, maximum: number): string {
  const value = teacherField(source, key);
  if (typeof value !== "string") return "";
  return [...safeText(value).replace(/[A-Za-z]:[\\/][^\s<>「」]*/g, "［内部資料非表示］")].slice(0, maximum).join("");
}

function readingGuide(source: SourceSession, blocks: ConsultationTranscript["blocks"]): ConsultationReadingGuide {
  const introduction = teacherText(source, "teacher_intro_ja", 300);
  const request = teacherText(source, "teacher_request_ja", 500);
  const excerpts: ConsultationReadingGuide["excerpts"] = [];
  if (!isMemory(source)) {
    for (const block of blocks) {
      for (const turn of block.turns) {
        // 介绍只摘录能核对的面试官问题，不把开场确认、未知话者或内部摘要当成内容提要。
        if (turn.speaker !== "interviewer" || turn.uncertain || turn.text.length < 10 ||
          /録音|録画|文字起こし|ネットワーク|接続|画面|音声|聞こえ|お間違い|お名前|よろしく|よろしいでしょうか/.test(turn.text) ||
          !/[?？]|か[。！？?]?$|教えて|お聞かせ|お伺い|伺って|ご紹介.*(?:ください|お願い)|自己紹介.*(?:ください|お願い)/.test(turn.text)) continue;
        if (!excerpts.some(excerpt => excerpt.text === turn.text)) excerpts.push({ blockId: block.id, text: turn.text });
        if (excerpts.length === 2) break;
      }
      if (excerpts.length === 2) break;
    }
  }
  return { featured: teacherField(source, "teacher_featured") === true,
    ...(introduction ? { introduction } : {}), ...(request ? { request } : {}), excerpts,
    blockCount: blocks.filter(block => block.turns.some(turn => turn.text.trim())).length };
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

function completedEvidence(notes: Note[]): CompletedEvidence[] {
  const entries: CompletedEvidence[] = [];
  const add = (original: Note, date: string, round: string, result: string, kind: CompletedEvidence["kind"], suffix = "", company = nameOf(original), position = "") => {
    if (kind !== "history" && !isEnterpriseSession({ note: original }, notes)) return;
    const owner = kind === "history" ? null : interviewSessionOwner(original, notes);
    const note: Note = { ...original, path: `${original.path}::consultation-history${suffix}`, content: "", frontmatter: {
      type: "transcript-study", company: owner && getType(owner) === JOB_CASE_TYPE ? nameOf(owner) : company,
      date, round, time: kind === "history" ? "" : interviewNoteTime(original, date),
      ...(owner ? { [getType(owner) === JOB_CASE_TYPE ? "case" : "meeting"]: `[[${owner.path}]]` } :
        Object.fromEntries(["case", "meeting", "case_id"].map(field => [field, getString(original.frontmatter[field])]))),
    } };
    if (company.trim() && isEnterpriseSession({ note }, notes)) entries.push({ note, original, date, round, result, kind,
      position: safeText(position || (owner && getType(owner) === JOB_CASE_TYPE ? jobPosition(owner) : "")) });
  };
  for (const note of notes) {
    const type = getType(note);
    if (type === "review") {
      const round = getString(note.frontmatter.round);
      const heading = note.content.match(/^#\s+(.+)$/m)?.[1] ?? note.path.split("/").at(-1) ?? "";
      // review 也用于邮件审阅与报告；只有有日期、轮次且明确是单场面试的复盘才是完成证据。
      if (day(note.frontmatter.date) && (interviewRound(round) || /面接|面談|面试|面谈|\binterview\b|\bmeeting\b/i.test(round)) &&
        !/メール|邮件|审阅|審閱|報告書|レポート|準備|准备|\bmail\b|\breport\b/i.test(heading)) {
        add(note, day(note.frontmatter.date), round, getString(note.frontmatter.result), "review");
      }
    } else if (type === "interview-prep" && getString(note.frontmatter.session_status ?? note.frontmatter.schedule_status) === "completed" && day(note.frontmatter.date)) {
      add(note, day(note.frontmatter.date), getString(note.frontmatter.round), getString(note.frontmatter.result), "completed-prep");
    } else if (type === JOB_CASE_TYPE && note.frontmatter.interview_completed === true) {
      add(note, day(note.frontmatter.interview_date), getString(note.frontmatter.interview_round), getString(note.frontmatter.status), "job-case");
    } else if (type === "material" && note.frontmatter.material_kind === "interview-history" && Array.isArray(note.frontmatter.records)) {
      for (const record of note.frontmatter.records) {
        if (!record || typeof record !== "object" || Array.isArray(record)) continue;
        const fields = record as Record<string, unknown>;
        const company = getString(fields.company);
        if (fields.completed !== true || !company.trim()) continue;
        // result_date 是结果通知日，不能替代未知的面试日期；来源仅参与稳定 ID，不返回内部引用。
        const key = [company, getString(fields.date), getString(fields.round), getString(fields.result_date), getString(fields.position), getString(fields.source)].join("\u0000");
        add(note, day(fields.date), getString(fields.round), getString(fields.result), "history", `:${stableId("record", key)}`, company, getString(fields.position));
      }
    }
  }
  return [...new Map(entries.map(entry => [entry.note.path, entry])).values()].sort((a, b) => a.note.path.localeCompare(b.note.path));
}

function recordedOutcome(value: string): Pick<ConsultationSessionSummary, "outcome" | "outcomeKind"> | null {
  const status = normalizeJobStatus(value);
  if (status === "不採用") return { outcome: "不採用", outcomeKind: "rejected" };
  if (status === "内定") return { outcome: "内定", outcomeKind: "offer" };
  if (/^(?:通過|通过|合格)(?:$|[（(\s・])/.test(value)) return { outcome: "当日の面接を通過", outcomeKind: "passed" };
  if (/^(?:結果待ち|結果未定|等待结果)/.test(value)) return { outcome: "結果待ち", outcomeKind: "waiting" };
  return null;
}

function resultFor(source: SourceSession, result: InterviewOutcome | undefined, notes: Note[]): Pick<ConsultationSessionSummary, "outcome" | "outcomeKind"> {
  if (result?.source === "next-round" && !day(source.note.frontmatter.date)) return { outcome: "面接日が未確認のため当輪結果は未確認", outcomeKind: "unknown" };
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
  const evidence = completedEvidence(available);
  // 只有原稿的场次也复用同一归属与次轮判定，不从正文或准备稿补造场次。
  const outcomeNotes = [...available.filter(note => !["transcript", "transcript-study"].includes(getType(note)) || sourcePaths.has(note.path)).map(note => {
    if (getType(note) === "transcript" && sources.some(source => !source.readable && source.raw === note)) return { ...note, frontmatter: { ...note.frontmatter, type: "transcript-study" } };
    // 未确认的准备稿仍可用于旧稿归属回退，但不能证明已经通过或进入下一轮。
    if (getType(note) === "interview-prep" && (!confirmedPrep(note) || !isEnterpriseSession({ note }, available))) return { ...note, frontmatter: { ...note.frontmatter, session_status: "draft" } };
    return note;
  }), ...structuredInvitations(available), ...evidence.filter(entry => entry.date).map(entry => entry.note)];
  const outcomes = resolveInterviewOutcomes(outcomeNotes);
  const blocksBySession = new Map(sources.map(source => [sessionId(source), projectBlocks(source)]));
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
      ...(owner && getType(owner) === JOB_CASE_TYPE && safeText(jobPosition(owner)) ? { position: safeText(jobPosition(owner)) } : {}),
      readingGuide: readingGuide(source, blocksBySession.get(sessionId(source))!),
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  for (const entry of evidence.filter(item => item.kind === "review")) {
    const explicit = recordedOutcome(entry.result);
    if (!explicit || !entry.date) continue;
    const owner = interviewSessionOwner(entry.note, outcomeNotes);
    const companyId = companyIdOf(owner && getType(owner) === JOB_CASE_TYPE ? owner : entry.note);
    const time = interviewNoteTime(entry.note, entry.date);
    const stage = interviewRound(entry.round);
    const matches = sessions.filter(session => {
      const source = sources.find(item => sessionId(item) === session.id)!;
      const sourceOwner = interviewSessionOwner(source.note, outcomeNotes);
      const sourceTime = interviewNoteTime(source.note, session.date);
      return session.companyId === companyId && session.date === entry.date && (sourceOwner?.path ?? "") === (owner?.path ?? "") &&
        !(time && sourceTime && time !== sourceTime) && !(stage && session.stage && stage !== session.stage);
    });
    // 同场明确复盘结果在共同模型里判定，目录、详情和导出必须读到同一个当轮结果。
    if (matches.length === 1 && !["offer", "passed"].includes(matches[0].outcomeKind)) Object.assign(matches[0], explicit);
  }
  return { available, sources, sessions, evidence, outcomes, outcomeNotes, blocksBySession };
}

export function buildConsultationCatalog(notes: Note[]): ConsultationCatalog {
  const { available, sources, sessions, evidence, outcomes, outcomeNotes } = model(notes);
  const completed: { companyId: string; company: string; ownerPath: string; time: string; interview: ConsultationInterview }[] = [];
  for (const session of sessions) {
    const source = sources.find(item => sessionId(item) === session.id)!;
    const owner = interviewSessionOwner(source.note, available);
    completed.push({ companyId: session.companyId, company: session.company, ownerPath: owner?.path ?? "", time: interviewNoteTime(source.note, session.date),
      interview: { id: session.id, date: session.date, round: session.round, stage: session.stage ?? "", outcome: session.outcome,
        outcomeKind: session.outcomeKind, sessionId: session.id, evidenceKind: "transcript", position: owner && getType(owner) === JOB_CASE_TYPE ? safeText(jobPosition(owner)) : "" } });
  }
  for (const entry of evidence) {
    const owner = interviewSessionOwner(entry.note, outcomeNotes);
    const companySource = owner && getType(owner) === JOB_CASE_TYPE ? owner : entry.note;
    const companyId = companyIdOf(companySource);
    const explicit = ["review", "history"].includes(entry.kind) || !entry.date ? recordedOutcome(entry.result) : null;
    const result = explicit ?? resultFor({ note: entry.note }, outcomes.get(entry.note.path), outcomeNotes);
    const stage = interviewRound(entry.round);
    const projected: ConsultationInterview = { id: stableId("interview", entry.note.path), date: entry.date,
      round: safeText(interviewRoundLabelJa(entry.round) || entry.round), stage, ...result, evidenceKind: entry.kind, position: entry.position };
    if (completed.some(item => item.interview.id === projected.id)) continue;
    const time = interviewNoteTime(entry.note, entry.date);
    const matches = entry.date && entry.kind !== "history" ? completed.filter(item => item.companyId === companyId && item.interview.date === entry.date &&
      (owner?.path ?? "") === item.ownerPath && !(time && item.time && time !== item.time) &&
      !(stage && item.interview.stage && stage !== item.interview.stage)) : [];
    if (matches.length === 1) {
      const existing = matches[0].interview;
      // 多版准备稿和同场复盘只算一次；当轮明确结果可补历史判断，但不修改案件的当前状态。
      if (explicit && !existing.sessionId && !["offer", "passed"].includes(existing.outcomeKind)) { existing.outcome = explicit.outcome; existing.outcomeKind = explicit.outcomeKind; }
      if (!existing.stage && stage) { existing.stage = stage; existing.round = projected.round; }
      continue;
    }
    completed.push({ companyId, company: safeText(nameOf(companySource)) || "会社名は未確認", ownerPath: owner?.path ?? "", time, interview: projected });
  }
  const companyIds = new Set(completed.map(item => item.companyId));
  const interviewedApplications = new Set([...sources.map(source => source.note), ...evidence.map(entry => entry.note)].flatMap(note => {
    const owner = interviewSessionOwner(note, outcomeNotes);
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
    if (!item) { item = { id, company, applications: [], sessionIds: [], latestDate: "", outcome: "応募結果は未確認", reachedFinal: false, hasPassedInterview: false, hasTranscript: false, interviews: [] }; companies.set(id, item); }
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
    item.outcome = [...new Set(item.applications.map(application => application.status))].join(" / ");
  }
  for (const record of completed) {
    const item = ensureCompany(record.companyId, record.company);
    item.interviews!.push(record.interview);
    if (record.interview.sessionId) { item.sessionIds.push(record.interview.sessionId); item.hasTranscript = true; }
    item.reachedFinal ||= record.interview.stage === "final";
    item.hasPassedInterview ||= record.interview.outcomeKind === "passed" || record.interview.outcomeKind === "offer";
    if (record.interview.date > item.latestDate) item.latestDate = record.interview.date;
  }
  for (const company of companies.values()) {
    company.interviews!.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    if (!company.applications.length) company.outcome = company.interviews![0]?.outcome ?? "応募結果は未確認";
  }
  const ownersWithRecords = new Map<string, Set<string>>();
  for (const record of completed) {
    if (record.ownerPath) ownersWithRecords.set(record.ownerPath, new Set([...(ownersWithRecords.get(record.ownerPath) ?? []), record.companyId]));
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
  const { sources, sessions, blocksBySession } = model(notes);
  const summary = sessions.find(session => session.id === id);
  const source = sources.find(candidate => sessionId(candidate) === id);
  if (!summary || !source) return null;
  const blocks = blocksBySession.get(id) ?? [];
  const notice = isMemory(source) ? "本人の記憶から再構成した資料です。実際の逐語発言とは区別してください。"
    : summary.hasReadable ? "読みやすく整理した記録です。フィラー等が省略されている場合があります。原音は未確認です。"
    : "原始転写のみの記録です。話者の分離や聞き取りには未確認の箇所があります。原音は未確認です。";
  return { ...summary, blocks, raw: summary.hasRaw ? rawText(source) : "", notice };
}
