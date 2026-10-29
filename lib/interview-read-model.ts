import { buildCompanyOverviews, resolveCompanyOverviewFrom, resolveCompanyReference, type CompanyOverview, type CompanySummary, type CompanyFitAssessment } from "./company-overview.ts";
import { buildCompanyCompareCandidates, companyComparePreset } from "./company-compare.ts";
import { buildContextPickerGroups, type ContextPickerGroup } from "./context-picker.ts";
import { findInterviewPrepDocs, findInterviewPrepReplay, prepWikiTarget } from "./interview-prep-doc.ts";
import { groupInterviewPrepDocs, selectRelevantInterviewPrepDoc } from "./interview-prep-index.ts";
import { buildCardCoverage, buildInterviewTrends, reviewTrendEntry, type InterviewTrends } from "./interview-trends.mjs";
import { interviewSessionOwner, resolveInterviewOutcomes, type InterviewOutcome } from "./interview-outcome.ts";
import { getString, getTitle, getType, stripNonLinkRegions, type Frontmatter, type Note } from "./notes.ts";
import { computeStats, type ReviewAnnotation, type ReviewBlock, type ReviewDecisionTask, type ReviewSentence, type ReviewStats } from "./review.ts";
import { findDayNote, findRoundNote, joinReviewNotes } from "./review-join.ts";
import { parseInterviewAnswerReview, type InterviewAnswerBlockReview, type InterviewAnswerReview } from "./review-deep.ts";
import { parseInterviewPractice, type InterviewPracticeEntry } from "./review-practice.ts";
import { parseReviewFeedback, uniqueReviewFeedback, type ReviewFeedbackEntry } from "./review-feedback.ts";
import { reviewDisplayScore, type DimensionAverages } from "./review-visual.ts";
import { historicalDimensionAverages } from "./review-visual.ts";
import { reviewSiblingPath } from "./review-paths.ts";
import type { ReadModelRecord } from "./read-model.ts";
import { selectionNoticesForSession, type SelectionNotice } from "./selection-notice.ts";

export const INTERVIEW_RECORDS = {
  catalog: "interview-catalog", context: "interview-context", review: "interview-review",
  block: "interview-review-block", section: "interview-review-section", practice: "interview-practice",
  company: "interview-company",
} as const;

/** 目录引用不能加入完整正文缓存；它没有 content，也不冒充 Note。 */
export type InterviewSourceRef = {
  kind: "interview-source"; path: string; title: string; type: string;
  company: string; date: string; round: string; mtime: number;
};
export type InterviewPrepSummary = InterviewSourceRef & {
  contextPath: string | null; pickerId: string; sessionStatus: string; sessionOrder: number | null;
};
export type InterviewReviewSummary = InterviewSourceRef & {
  result?: string; score: ReturnType<typeof reviewDisplayScore>; insight: string;
  stats: Omit<ReviewStats, "patterns">; annotations: number; openAnnotations: number;
  decisionTotal: number; decisionResolved: number; decisionPendingSentences: number;
  outcome: InterviewOutcome | null; reviewed: boolean;
};
export type InterviewCompareSummary = {
  path: string; company: string; title: string; shortName: string; displayRole: string;
  status: string; channel: string; eventAt: string; lastInterviewAt: string; dateLabel: string;
  hasInterview: boolean; hasProfile: boolean; hasAssessment: boolean; readinessLabel: string;
  reviews: ReturnType<typeof buildCompanyCompareCandidates>[number]["reviews"]; haystack: string;
  originKind: ReturnType<typeof buildCompanyCompareCandidates>[number]["originKind"]; originLabel: string; business: string;
};
export type InterviewCatalog = {
  kind: "interview-catalog"; today: string; pickerGroups: ContextPickerGroup[];
  preps: InterviewPrepSummary[]; reviews: InterviewReviewSummary[];
  comparisons: InterviewCompareSummary[]; defaults: Record<string, string>;
  libraryPaths: string[]; practicePaths: string[];
  compareDefaults: string[]; comparePresets: Record<"upcoming" | "recent" | "openwork" | "jobtalk", string[]>;
  revision?: string; pickerTotal?: number; comparisonTotal?: number; comparisonCounts?: { relevant: number; rated: number };
};
export type InterviewContext = {
  kind: "interview-context"; source: InterviewSourceRef; contextPath: string | null;
  /** 只取本轮原稿、对照稿、明确的公司材料及实际嵌入依赖。 */
  paths: string[];
};
/** 公司图景在完整资料上验证；证据只保留引用，不能为了验证存在而下载所有证据正文。 */
export type InterviewCompanyProjection = Omit<CompanyOverview, "kind" | "note" | "dossier" | "summary" | "assessment"> & {
  kind: "interview-company"; contextKind: CompanyOverview["kind"]; sourcePath: string; dossierPath: string | null;
  summary: { sourcePath: string; data: Omit<CompanySummary, "note"> } | null;
  assessment: { sourcePath: string; data: Omit<CompanyFitAssessment, "note"> } | null;
};
export type InterviewSentenceIndex = Pick<ReviewSentence, "id" | "speaker" | "uncertainSpeaker"> & {
  errors: Pick<ReviewSentence["errors"][number], "index" | "kind" | "pattern">[]; goCount: number;
};
export type InterviewReviewProjection = {
  kind: "interview-review"; source: InterviewSourceRef; frontmatter: Frontmatter;
  result?: string; contextPath: string | null; stats: Omit<ReviewStats, "patterns"> & { patterns: [string, { learner: number; uncertain: number }][] };
  blocks: { id: string; title: string; summary?: string; sentences: InterviewSentenceIndex[] }[];
  annotationPath: string; annotationExists: boolean; annotations: ReviewAnnotation[];
  decisionTasks: ReviewDecisionTask[]; practiceBlockIds: string[]; feedback: ReviewFeedbackEntry[];
  outcome: InterviewOutcome | null; historicalAverages: DimensionAverages | null;
  hasQuality: boolean; hasAdvisory: boolean;
  notices: SelectionNotice[];
};
export type InterviewReviewBlock = { kind: "interview-review-block"; sourcePath: string; block: ReviewBlock };
export type InterviewQualitySection = {
  review: Omit<InterviewAnswerReview, "blocks" | "advisory">;
  blocks: (Pick<InterviewAnswerBlockReview, "blockId" | "questionTitle" | "comprehension" | "relevance" | "quality" | "strategyTags" | "evidenceSentenceIds"> & { missedCount: number })[];
};
export type InterviewPracticeItem = InterviewPracticeEntry & { key: string; practicePath: string; company: string; date: string; round: string };
export const interviewBlockKey = (path: string, id: string) => JSON.stringify([path, id]);
const parsedQuality = new WeakMap<Note, { content: string; review: InterviewAnswerReview | null }>();
const sourceStats = new WeakMap<object, ReviewStats>();
const qualitySections = new WeakMap<Note, { content: string; sections: Map<string, ReadModelRecord[]> }>();

function cachedQuality(note: Note) {
  const cached = parsedQuality.get(note);
  if (cached?.content === note.content) return cached.review;
  const value = parseInterviewAnswerReview(note.content);
  parsedQuality.set(note, { content: note.content, review: value });
  return value;
}

export function interviewSourceRef(note: Note): InterviewSourceRef {
  return { kind: "interview-source", path: note.path, title: getTitle(note), type: getType(note),
    company: getString(note.frontmatter.company), date: getString(note.frontmatter.date),
    round: getString(note.frontmatter.round), mtime: note.stat?.mtime ?? 0 };
}
const sourceRef = interviewSourceRef;

export function projectInterviewCompany(context: CompanyOverview): InterviewCompanyProjection {
  const { kind, note, dossier, summary, assessment, ...fields } = context;
  const summaryFields = summary ? (({ note, ...data }) => ({ data, sourcePath: note.path }))(summary) : null;
  const assessmentFields = assessment ? (({ note, ...data }) => ({ data, sourcePath: note.path }))(assessment) : null;
  return { ...fields, kind: "interview-company", contextKind: kind, sourcePath: note.path, dossierPath: dossier?.path ?? null,
    summary: summaryFields, assessment: assessmentFields };
}

/** 只用真正取回的完整笔记还原 Note 字段；目录和证据引用不会冒充正文。 */
export function hydrateInterviewCompany(projection: InterviewCompanyProjection, notes: Note[]): CompanyOverview | null {
  const byPath = new Map(notes.map((note) => [note.path, note]));
  const note = byPath.get(projection.sourcePath);
  const dossier = projection.dossierPath ? byPath.get(projection.dossierPath) : null;
  const summaryNote = projection.summary ? byPath.get(projection.summary.sourcePath) : null;
  const assessmentNote = projection.assessment ? byPath.get(projection.assessment.sourcePath) : null;
  if (!note || (projection.dossierPath && !dossier) || (projection.summary && !summaryNote) || (projection.assessment && !assessmentNote)) return null;
  return { key: projection.key, kind: projection.contextKind, company: projection.company, title: projection.title, caseId: projection.caseId,
    profile: projection.profile, profileStatus: projection.profileStatus, summaryStatus: projection.summaryStatus, assessmentStatus: projection.assessmentStatus,
    issues: projection.issues, note, dossier: dossier ?? null,
    summary: projection.summary && summaryNote ? { ...projection.summary.data, note: summaryNote } : null,
    assessment: projection.assessment && assessmentNote ? { ...projection.assessment.data, note: assessmentNote } : null };
}

function reassessment(notes: Note[], path: string) {
  return notes.filter((note) => getType(note) === "ai-report" && note.frontmatter.report_kind === "interview-reassessment"
    && note.frontmatter.report_role === "session" && note.frontmatter.source_path === path)
    .sort((a, b) => getString(b.frontmatter.generated_at).localeCompare(getString(a.frontmatter.generated_at))
      || getString(b.frontmatter.method_version).localeCompare(getString(a.frontmatter.method_version)))[0];
}

/** 重名时只认唯一的完整／后缀路径，与公司关系解析保持同一消歧规则。 */
function resolveDependency(notes: Note[], raw: string) {
  const target = prepWikiTarget(raw);
  return target ? resolveCompanyReference(notes, `[[${target}]]`) : null;
}

function embeddedDependencies(note: Note, notes: Note[], visited: Set<string>) {
  if (visited.has(note.path)) return;
  visited.add(note.path);
  for (const match of stripNonLinkRegions(note.content).matchAll(/!\[\[([^\]]+)\]\]/g)) {
    const dependency = resolveDependency(notes, match[1]);
    if (dependency) embeddedDependencies(dependency, notes, visited);
  }
}

function companyPaths(context: ReturnType<typeof buildCompanyOverviews>[number] | null, notes: Note[]) {
  if (!context) return [];
  const paths = [context.note.path, context.dossier?.path, context.assessment?.note.path, context.summary?.note.path].filter((path): path is string => Boolean(path));
  // 不完整报告仍保留明确的原稿入口；只加载正本采用的材料，不递归读取所有证据正文。
  for (const reference of [context.note.frontmatter.company_dossier, context.note.frontmatter.fit_assessment, context.dossier?.frontmatter.company_summary]) {
    const referenced = typeof reference === "string" ? resolveDependency(notes, reference) : null;
    if (referenced) paths.push(referenced.path);
  }
  // 独立面谈借用案件的日程时，不能丢掉这份明确关联的正本。
  if (context.kind === "meeting" && context.caseId) {
    const matches = notes.filter((note) => getType(note) === "job-case" && getString(note.frontmatter.case_id) === context.caseId);
    if (matches.length === 1) paths.push(matches[0].path);
  }
  return paths;
}

/** 所有昂贵解析只在同步／发布时执行，查询阶段直接读取同一版本的投影。 */
export function buildInterviewReadModelRecords(notes: Note[], options: { today?: string } = {}): ReadModelRecord[] {
  const today = options.today ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const records: ReadModelRecord[] = [];
  const put = (kind: string, key: string, value: unknown) => records.push({ kind, key, value });
  const contexts = buildCompanyOverviews(notes);
  const docs = findInterviewPrepDocs(notes);
  const series = groupInterviewPrepDocs(docs);
  const docContexts = new Map(docs.map((doc) => [doc.note.path, resolveCompanyOverviewFrom(contexts, notes, doc.note)]));
  const pickerGroups = buildContextPickerGroups({ contexts, docs, series, docContexts, today });
  const defaults: Record<string, string> = {};
  const preps: InterviewPrepSummary[] = docs.map((doc) => {
    const context = docContexts.get(doc.note.path);
    const ownerSeries = series.find((item) => item.rounds.some((round) => round.note.path === doc.note.path));
    return { ...sourceRef(doc.note), contextPath: context?.note.path ?? null,
      pickerId: context ? `context:${context.note.path}` : `series:${ownerSeries?.key ?? doc.note.path}`,
      sessionStatus: doc.sessionStatus, sessionOrder: doc.sessionOrder };
  });
  for (const group of pickerGroups) for (const item of group.items) {
    const eligible = docs.filter((doc) => preps.find((summary) => summary.path === doc.note.path)?.pickerId === item.id);
    const selected = selectRelevantInterviewPrepDoc(eligible, today);
    if (selected) defaults[item.id] = selected.note.path;
  }
  const next = selectRelevantInterviewPrepDoc(docs, today);
  if (next) defaults.session = next.note.path;

  for (const context of contexts) {
    put(INTERVIEW_RECORDS.company, context.note.path, projectInterviewCompany(context));
    put(INTERVIEW_RECORDS.context, context.note.path, { kind: "interview-context", source: sourceRef(context.note),
      contextPath: context.note.path, paths: [...new Set(companyPaths(context, notes))] } satisfies InterviewContext);
  }
  for (const doc of docs) {
    const context = docContexts.get(doc.note.path) ?? null;
    const paths = new Set(companyPaths(context, notes));
    embeddedDependencies(doc.note, notes, paths);
    const replay = findInterviewPrepReplay(notes, doc);
    if (replay) embeddedDependencies(replay.note, notes, paths);
    const projection: InterviewContext = { kind: "interview-context", source: sourceRef(doc.note), contextPath: context?.note.path ?? null, paths: [...paths] };
    put(INTERVIEW_RECORDS.context, doc.note.path, projection);
    if (replay) put(INTERVIEW_RECORDS.context, replay.note.path, { ...projection, source: sourceRef(replay.note) });
  }

  const joined = joinReviewNotes(notes);
  const reviews = new Map(joined.map((item) => [item.key, item.deepReviewNote ? cachedQuality(item.deepReviewNote) : null]));
  const outcomes = resolveInterviewOutcomes(notes);
  const visual = joined.map((item) => ({ key: item.key, company: item.company, date: item.date, round: item.round,
    review: reviews.get(item.key), reassessment: reassessment(notes, item.key) }));
  const reviewIndex: InterviewReviewSummary[] = [];
  for (const item of joined) {
    let stats = sourceStats.get(item.parsed);
    if (!stats) { stats = computeStats(item.parsed.sentences); sourceStats.set(item.parsed, stats); }
    const { patterns, ...counts } = stats;
    const review = reviews.get(item.key);
    const result = getString(findDayNote(notes, "review", item)?.frontmatter.result) || undefined;
    const practice = findRoundNote(notes, "interview-answer-practice", item);
    const feedback = findRoundNote(notes, "interview-answer-feedback", item);
    const owner = interviewSessionOwner(item.note, notes);
    const context = owner ? contexts.find((candidate) => candidate.note.path === owner.path) ?? null : null;
    const report = reassessment(notes, item.key);
    const paths = new Set(companyPaths(context, notes));
    for (const note of [item.annotationNote, practice, feedback, report]) if (note) paths.add(note.path);
    // 日后裁定或重练只让这些关联项失效，不回读整个 interview 范围。
    const method = report?.frontmatter.method_version;
    for (const note of notes) {
      if (note.frontmatter.report_kind === "interview-reassessment" && note.frontmatter.report_role === "actions" && note.frontmatter.method_version === method) paths.add(note.path);
      if (getType(note) === "selection-notice" && owner && interviewSessionOwner(note, notes)?.path === owner.path) paths.add(note.path);
    }
    const projection: InterviewReviewProjection = { kind: "interview-review", source: sourceRef(item.note), frontmatter: item.note.frontmatter,
      contextPath: context?.note.path ?? null, result, stats: { ...counts, patterns: [...patterns] },
      blocks: item.parsed.blocks.map((block) => ({ id: block.id, title: block.title, summary: block.summary,
        sentences: block.sentences.map((sentence) => ({ id: sentence.id, speaker: sentence.speaker, uncertainSpeaker: sentence.uncertainSpeaker,
          errors: sentence.errors.map(({ index, kind, pattern }) => ({ index, kind, pattern })), goCount: sentence.go.length })) })),
      annotationPath: item.annotationNote?.path ?? reviewSiblingPath(item.note.path, "annotation"), annotationExists: Boolean(item.annotationNote),
      annotations: item.annotations, decisionTasks: item.decisionTasks,
      practiceBlockIds: practice ? parseInterviewPractice(practice.content).map((entry) => entry.blockId) : [],
      feedback: feedback ? uniqueReviewFeedback(parseReviewFeedback(feedback.content)) : [],
      outcome: outcomes.get(item.key) ?? null, historicalAverages: historicalDimensionAverages(visual, item.key),
      hasQuality: Boolean(review), hasAdvisory: Boolean(review?.advisory), notices: selectionNoticesForSession(item.note, notes) };
    put(INTERVIEW_RECORDS.review, item.key, projection);
    put(INTERVIEW_RECORDS.context, item.key, { kind: "interview-context", source: sourceRef(item.note), contextPath: context?.note.path ?? null, paths: [...paths] } satisfies InterviewContext);
    for (const block of item.parsed.blocks) put(INTERVIEW_RECORDS.block, interviewBlockKey(item.key, block.id),
      { kind: "interview-review-block", sourcePath: item.key, block } satisfies InterviewReviewBlock);
    if (review) {
      const cached = item.deepReviewNote && qualitySections.get(item.deepReviewNote);
      const cachedSections = cached?.content === item.deepReviewNote?.content ? cached?.sections.get(item.key) : undefined;
      if (cachedSections) records.push(...cachedSections);
      else {
      const start = records.length;
      const { advisory, blocks, ...header } = review;
      put(INTERVIEW_RECORDS.section, interviewBlockKey(item.key, "quality"), { review: header,
        blocks: blocks.map(({ blockId, questionTitle, comprehension, relevance, quality, strategyTags, evidenceSentenceIds, missedPoints }) => ({
          blockId, questionTitle, comprehension, relevance, quality, strategyTags, evidenceSentenceIds, missedCount: missedPoints.length,
        })) } satisfies InterviewQualitySection);
      if (advisory) put(INTERVIEW_RECORDS.section, interviewBlockKey(item.key, "advisory"), advisory);
      for (const block of blocks) put(INTERVIEW_RECORDS.section, interviewBlockKey(item.key, block.blockId), block satisfies InterviewAnswerBlockReview);
      if (item.deepReviewNote) {
        const previous = qualitySections.get(item.deepReviewNote);
        const sections = previous?.content === item.deepReviewNote.content ? previous.sections : new Map<string, ReadModelRecord[]>();
        sections.set(item.key, records.slice(start)); qualitySections.set(item.deepReviewNote, { content: item.deepReviewNote.content, sections });
      }
      }
    }
    const unresolved = item.decisionTasks.filter((task) => !task.resolvedBy);
    const priority = Array.isArray(report?.frontmatter.priority_issues) ? getString(report.frontmatter.priority_issues[0]) : "";
    const insight = priority || getString(report?.frontmatter.diagnostic_conclusion) || review?.evaluation?.conclusionZh || review?.weaknesses[0] || "";
    reviewIndex.push({ ...sourceRef(item.note), result, score: reviewDisplayScore(visual.find((entry) => entry.key === item.key)!),
      insight: insight.split(/[。；]/)[0], stats: counts, annotations: item.annotations.length,
      openAnnotations: item.annotations.filter((entry) => entry.status === "open").length,
      decisionTotal: item.decisionTasks.length, decisionResolved: item.decisionTasks.length - unresolved.length,
      decisionPendingSentences: new Set(unresolved.map((entry) => entry.sentenceId)).size,
      outcome: outcomes.get(item.key) ?? null, reviewed: Boolean(review) });
  }
  const libraryPaths = notes.filter((note) => getType(note) === "interview-prep-library").map((note) => note.path);
  const practicePaths = notes.filter((note) => getType(note) === "interview-answer-practice").map((note) => note.path);
  for (const path of [...libraryPaths, ...practicePaths]) {
    const note = notes.find((candidate) => candidate.path === path)!;
    const paths = new Set<string>();
    embeddedDependencies(note, notes, paths);
    put(INTERVIEW_RECORDS.context, path, { kind: "interview-context", source: sourceRef(note), contextPath: null, paths: [...paths] } satisfies InterviewContext);
  }
  const library = notes.find((note) => getType(note) === "interview-prep-library");
  const trendEntries = notes.filter((note) => getType(note) === "interview-answer-review").map((note) => ({ ...reviewTrendEntry(note.path, note.frontmatter, ""), review: cachedQuality(note) }));
  const digest: InterviewTrends | null = trendEntries.length ? buildInterviewTrends(trendEntries, buildCardCoverage(library?.content ?? "")) : null;
  put(INTERVIEW_RECORDS.section, "digest", digest);
  put(INTERVIEW_RECORDS.section, "review-trends", buildInterviewTrends(visual.filter((entry) => entry.review).map((entry) => ({
    ...entry, review: entry.review ?? null, outcome: outcomes.get(entry.key) ?? null,
  })), buildCardCoverage(library?.content ?? "")));
  const compareCandidates = buildCompanyCompareCandidates(contexts, notes, today);
  const comparePresets = Object.fromEntries((["upcoming", "recent", "openwork", "jobtalk"] as const).map((preset) => [preset, companyComparePreset(compareCandidates, preset, 4)])) as InterviewCatalog["comparePresets"];
  const compareDefaults = [comparePresets.upcoming, comparePresets.recent, comparePresets.openwork].find((paths) => paths.length >= 2)
    ?? compareCandidates.filter((item) => item.context.profile || item.context.assessment || item.hasInterview).slice(0, 2).map((item) => item.context.note.path);
  const comparisons: InterviewCompareSummary[] = compareCandidates.map((candidate) => ({
    path: candidate.context.note.path, company: candidate.context.company, title: candidate.context.title,
    shortName: candidate.shortName, displayRole: candidate.displayRole, status: candidate.status,
    channel: candidate.channel, eventAt: candidate.eventAt, lastInterviewAt: candidate.lastInterviewAt,
    dateLabel: candidate.dateLabel, hasInterview: candidate.hasInterview, hasProfile: Boolean(candidate.context.profile),
    hasAssessment: Boolean(candidate.context.assessment), readinessLabel: candidate.readinessLabel,
    reviews: candidate.reviews, haystack: candidate.haystack,
    originKind: candidate.originKind, originLabel: candidate.originLabel,
    business: candidate.context.profile?.facts.find((fact) => fact.id === "business")?.value ?? "",
  }));
  put(INTERVIEW_RECORDS.catalog, "root", { kind: "interview-catalog", today, pickerGroups, preps,
    reviews: reviewIndex, comparisons, defaults, libraryPaths, practicePaths, compareDefaults, comparePresets } satisfies InterviewCatalog);
  return records;
}

export function interviewDefaultSource(catalog: InterviewCatalog, target: { sourcePath?: string; contextPath?: string; company?: string }) {
  if (target.sourcePath) return target.sourcePath;
  if (target.contextPath) return catalog.defaults[`context:${target.contextPath}`] ?? target.contextPath;
  if (target.company) {
    const candidates = catalog.preps.filter((item) => item.company === target.company);
    if (candidates.length) return candidates.find((item) => item.date >= catalog.today)?.path ?? candidates[0].path;
    const contexts = catalog.comparisons.filter((item) => item.company === target.company);
    if (contexts.length === 1) return contexts[0].path;
    const items = catalog.pickerGroups.flatMap((group) => group.items).filter((item) => item.company === target.company && item.id.startsWith("context:"));
    return items.length === 1 ? items[0].id.slice(8) : "";
  }
  return catalog.defaults.session ?? "";
}
