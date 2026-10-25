import { getString, getType, type Note } from "./notes.ts";

export const QUESTION_TOPICS = [
  { id: "introduction", titleZh: "自我介绍", summaryZh: "同是自我介绍，有的只要概览，有的同时要求职历或当前求职状况。" },
  { id: "career", titleZh: "职历与经历", summaryZh: "分清哪段经历、哪家公司，以及从何时到何时。" },
  { id: "leaving-japan", titleZh: "离职、来日与申请理由", summaryZh: "离职原因、来日原因和申请这家公司是不同问题。" },
  { id: "responsibility", titleZh: "职责、职位与负责范围", summaryZh: "确认是在问过去职位、当前分工，还是希望承担的职责。" },
  { id: "projects-technology", titleZh: "项目与技术", summaryZh: "留意实际使用、学习了解、设计判断和具体项目的区别。" },
  { id: "team-collaboration", titleZh: "团队与协作", summaryZh: "团队规模、个人分工、推动方式和合作对象分别回答。" },
  { id: "aspirations-preferences", titleZh: "方向、意愿与偏好", summaryZh: "想做什么、愿不愿接受和做过什么不能互相替代。" },
  { id: "conditions-start", titleZh: "工作条件与入职", summaryZh: "条件、时间、程度和前提要一起听清。" },
  { id: "job-search", titleZh: "求职进展与渠道", summaryZh: "其他选考、渠道和优先次序有各自的时间范围。" },
  { id: "background-life", titleZh: "生活背景与个人情况", summaryZh: "保留问题实际范围，不由关键词扩写私人事实。" },
  { id: "language-learning", titleZh: "日语、学习与日本经验", summaryZh: "资格、交流情况、学习方式和日本实务经验分别理解。" },
  { id: "interaction", titleZh: "确认、修复与逆问邀请", summaryZh: "确认式、听取意见和邀请反问，也属于实际提问。" },
  { id: "company-role", titleZh: "公司与岗位理解", summaryZh: "说明自己理解了什么，与直接表态接受岗位不同。" },
  { id: "other", titleZh: "其他提问", summaryZh: "保留暂不能归入共同意图的真实问题。" },
] as const;

export type QuestionTopicId = typeof QUESTION_TOPICS[number]["id"];
export type QuestionSource = {
  id: string;
  path: string;
  date: string;
  company: string;
  kind: "employer" | "agency" | "platform";
  transcriptType: "asr" | "memory" | "review";
  scope: "primary" | "nonverbatim" | "background";
  sha256: string;
  lineCount: number;
  readCoverage: "full" | "pending";
  limitations: string[];
};
export type QuestionAnnotation = {
  path: string;
  lineStart: number;
  lineEnd: number;
  excerpt: string;
  nature: "self-note" | "ai-note";
};
export type InterviewQuestion = {
  id: string;
  sourceId: string;
  topicId: QuestionTopicId;
  intentId: string;
  intentZh: string;
  originalText: string;
  questionText?: string;
  readableJa?: string;
  meaningZh: string;
  answerScopeZh: string;
  detailsZh: string[];
  structureZh: string[];
  lineStart: number;
  lineEnd: number;
  locator?: string;
  questionKind: "question" | "request" | "confirmation" | "follow-up";
  confidence: "high" | "medium" | "low";
  reviewStatus?: "accepted" | "pending";
  reviewReasonZh?: string;
  speakerBasisZh: string;
  contextBefore?: string;
  contextAfter?: string;
  annotations: QuestionAnnotation[];
  uncertaintyZh?: string;
  continuationOf?: string;
  duplicateLocators?: { lineStart: number; lineEnd: number }[];
};
export type ExcludedQuestionCandidate = {
  id?: string;
  sourceId: string;
  lineStart: number;
  lineEnd: number;
  excerpt: string;
  reason: string;
  originalQuestionId?: string;
  reviewReasonZh?: string;
};
export type InterviewQuestionCollection = {
  schemaVersion: 1;
  collectionId: string;
  title: string;
  window: { start: string; end: string; timezone: "Asia/Tokyo" };
  phase: "phase-one" | "complete";
  publishedTopicIds: QuestionTopicId[];
  sources: QuestionSource[];
  questions: InterviewQuestion[];
  excludedCandidates: ExcludedQuestionCandidate[];
  auditNotes: string[];
  /** 语言索引独立校验；索引失效不应让已经审核的问题集消失。 */
  languageIndex?: unknown;
};
export type QuestionCollectionResource = { note: Note; collection: InterviewQuestionCollection };
export type QuestionVariant = { key: string; question: InterviewQuestion; occurrences: InterviewQuestion[] };
export type QuestionIntentGroup = { id: string; titleZh: string; variants: QuestionVariant[] };

const ID = /^[a-z][a-z0-9_-]{0,119}$/;
const TOPICS = new Set<string>(QUESTION_TOPICS.map(topic => topic.id));
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty);
const inList = (value: unknown, choices: readonly string[]) => typeof value === "string" && choices.includes(value);
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const lineRange = (value: Record<string, unknown>) => Number.isInteger(value.lineStart) && Number.isInteger(value.lineEnd)
  && Number(value.lineStart) > 0 && Number(value.lineEnd) >= Number(value.lineStart);
const optionalString = (value: Record<string, unknown>, key: string) => value[key] === undefined || nonempty(value[key]);
const vaultPath = (value: unknown) => nonempty(value) && value.startsWith("20_求職/") && !value.split("/").includes("..");

export function isInterviewQuestionResource(note: Note) {
  return getType(note) === "material" && note.frontmatter.material_kind === "interview-question-collection";
}

export function parseInterviewQuestionCollection(value: unknown): InterviewQuestionCollection | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !ID.test(getString(value.collectionId)) || !nonempty(value.title)
    || !isRecord(value.window) || !date(value.window.start) || !date(value.window.end) || value.window.start > value.window.end
    || value.window.timezone !== "Asia/Tokyo" || !inList(value.phase, ["phase-one", "complete"])
    || !Array.isArray(value.publishedTopicIds) || !value.publishedTopicIds.every(topic => TOPICS.has(String(topic)))
    || new Set(value.publishedTopicIds).size !== value.publishedTopicIds.length
    || !Array.isArray(value.sources) || !Array.isArray(value.questions) || value.questions.length > 5000
    || !Array.isArray(value.excludedCandidates) || !strings(value.auditNotes)) return null;
  const sourceIds = new Set<string>();
  const sources = new Map<string, Record<string, unknown>>();
  for (const source of value.sources) {
    if (!isRecord(source) || !ID.test(getString(source.id)) || sourceIds.has(String(source.id)) || !vaultPath(source.path)
      || !date(source.date) || !nonempty(source.company) || !inList(source.kind, ["employer", "agency", "platform"])
      || !inList(source.transcriptType, ["asr", "memory", "review"]) || !inList(source.scope, ["primary", "nonverbatim", "background"])
      || !/^[a-f0-9]{64}$/.test(getString(source.sha256)) || !Number.isInteger(source.lineCount) || Number(source.lineCount) <= 0
      || !inList(source.readCoverage, ["full", "pending"]) || !strings(source.limitations)) return null;
    // 回忆与窗口前背景单列；范围标记不能把它们变成窗口内逐字原问。
    if (source.scope === "primary" && (source.transcriptType !== "asr" || source.date < value.window.start || source.date > value.window.end)) return null;
    if (source.scope === "nonverbatim" && source.transcriptType === "asr") return null;
    sourceIds.add(String(source.id));
    sources.set(String(source.id), source);
  }
  const questionIds = new Set<string>();
  for (const question of value.questions) {
    if (!isRecord(question) || !ID.test(getString(question.id)) || questionIds.has(String(question.id)) || !sourceIds.has(String(question.sourceId))
      || !TOPICS.has(getString(question.topicId)) || !ID.test(getString(question.intentId)) || !nonempty(question.intentZh)
      || !nonempty(question.originalText) || !nonempty(question.meaningZh) || !nonempty(question.answerScopeZh)
      || !strings(question.detailsZh) || !strings(question.structureZh) || !lineRange(question)
      || Number(question.lineEnd) > Number(sources.get(String(question.sourceId))!.lineCount)
      || !inList(question.questionKind, ["question", "request", "confirmation", "follow-up"])
      || !inList(question.confidence, ["high", "medium", "low"]) || !nonempty(question.speakerBasisZh)
      || !["questionText", "readableJa", "locator", "contextBefore", "contextAfter", "uncertaintyZh", "continuationOf", "reviewReasonZh"].every(key => optionalString(question, key))
      || (question.reviewStatus !== undefined && (!inList(question.reviewStatus, ["accepted", "pending"]) || !nonempty(question.reviewReasonZh)))
      || (value.phase === "complete" && question.reviewStatus === undefined)
      || (question.questionText !== undefined && !(question.originalText as string).includes(question.questionText as string))
      || !Array.isArray(question.annotations)) return null;
    for (const annotation of question.annotations) {
      if (!isRecord(annotation) || !vaultPath(annotation.path) || !lineRange(annotation) || !nonempty(annotation.excerpt)
        || !inList(annotation.nature, ["self-note", "ai-note"])) return null;
    }
    if (question.duplicateLocators !== undefined && (!Array.isArray(question.duplicateLocators)
      || !question.duplicateLocators.every(item => isRecord(item) && lineRange(item)))) return null;
    questionIds.add(String(question.id));
  }
  for (const question of value.questions) {
    if (question.continuationOf !== undefined && !questionIds.has(question.continuationOf)) return null;
  }
  for (const candidate of value.excludedCandidates) {
    if (!isRecord(candidate) || !sourceIds.has(getString(candidate.sourceId)) || !lineRange(candidate)
      || !nonempty(candidate.excerpt) || !nonempty(candidate.reason)
      || !["id", "originalQuestionId", "reviewReasonZh"].every(key => optionalString(candidate, key))) return null;
  }
  return value as InterviewQuestionCollection;
}

export function questionReviewStatus(question: InterviewQuestion): "accepted" | "pending" {
  return question.reviewStatus ?? (question.confidence === "low" ? "pending" : "accepted");
}

export function findInterviewQuestionCollections(notes: Note[]): QuestionCollectionResource[] {
  const parsed: QuestionCollectionResource[] = [];
  for (const note of notes.filter(isInterviewQuestionResource)) {
    const match = note.content.match(/<!--\s*interview-questions-json:start\s*-->\s*```json\s*([\s\S]*?)\s*```\s*<!--\s*interview-questions-json:end\s*-->/);
    if (!match) continue;
    try {
      const collection = parseInterviewQuestionCollection(JSON.parse(match[1]));
      if (collection && collection.collectionId === getString(note.frontmatter.collection_id)) parsed.push({ note, collection });
    } catch { /* 原始材料可通过笔记入口复核；坏 JSON 不伪装成完整问题集。 */ }
  }
  const counts = new Map<string, number>();
  for (const item of parsed) counts.set(item.collection.collectionId, (counts.get(item.collection.collectionId) ?? 0) + 1);
  return parsed.filter(item => counts.get(item.collection.collectionId) === 1);
}

export function groupInterviewQuestions(questions: InterviewQuestion[]): QuestionIntentGroup[] {
  const groups = new Map<string, QuestionIntentGroup>();
  for (const question of questions) {
    const id = `${question.topicId}:${question.intentId}`;
    const group = groups.get(id) ?? { id, titleZh: question.intentZh, variants: [] };
    // 只折叠相同原句且限定/含义一致的条目。整理句相同不能证明现场问法相同。
    const key = JSON.stringify([question.questionText ?? question.originalText, question.meaningZh, question.answerScopeZh,
      question.detailsZh, question.uncertaintyZh ?? ""]);
    const variant = group.variants.find(item => item.key === key);
    if (variant) variant.occurrences.push(question);
    else group.variants.push({ key, question, occurrences: [question] });
    groups.set(id, group);
  }
  return [...groups.values()];
}

export function questionMatchesSearch(question: InterviewQuestion, query: string, source?: QuestionSource) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [question.originalText, question.questionText, question.readableJa, question.meaningZh, question.answerScopeZh,
    question.intentZh, ...question.detailsZh, source?.company, source?.date].filter(Boolean).join(" ").toLocaleLowerCase();
  return words.every(word => text.includes(word));
}

export function questionCollectionHref(search: string, collectionId: string, topicId?: string) {
  const params = new URLSearchParams(search);
  for (const key of ["chapter", "course", "knowledge", "lessonView", "note", "section"]) params.delete(key);
  params.set("questionSet", collectionId);
  if (topicId) params.set("questionTopic", topicId);
  else params.delete("questionTopic");
  return `/training/topics?${params.toString()}`;
}
