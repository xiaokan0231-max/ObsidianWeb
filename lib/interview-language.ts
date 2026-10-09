import { groupInterviewQuestions, questionReviewStatus, type InterviewQuestionCollection } from "./interview-question-collection.ts";

export const LANGUAGE_DIMENSIONS = [
  { id: "honorific", titleZh: "敬语", summaryZh: "先辨谁做动作，再把礼貌外壳和真正请求分开。" },
  { id: "expression", titleZh: "常见表达", summaryZh: "理解面谈中常用的铺垫、确认、比较和开放邀请。" },
  { id: "grammar", titleZh: "语法", summaryZh: "抓住并列、条件、时间和范围，读懂这句要求什么。" },
  { id: "vocabulary", titleZh: "词汇", summaryZh: "把词放回实际问题，留意搭配、对象和不同含义。" },
] as const;
export type LanguageDimension = typeof LANGUAGE_DIMENSIONS[number]["id"];
export type LanguageHighlight = { start: number; end: number; text: string; labelZh: string; role: "polite" | "core" | "qualifier" | "term" };
export type LanguageOccurrence = {
  questionId: string; quote: string; highlights: LanguageHighlight[];
  coreMeaningZh: string; limitsZh: string[]; explanationZh: string;
};
export type LanguagePoint = {
  id: string; dimension: LanguageDimension; titleZh: string; patternJa: string; meaningZh: string;
  explanationZh: string[]; pitfallsZh: string[]; occurrences: LanguageOccurrence[]; readingJa?: string;
  practice: { promptZh: string; answerZh: string; simpleJa?: string; noteZh: string };
  teachingExamples?: { ja: string; zh: string; noteZh: string }[];
};
export type InterviewLanguageIndex = {
  schemaVersion: 1; sourceCollectionId: string; points: LanguagePoint[]; auditNotes: string[];
};
const ID = /^[a-z][a-z0-9-]{0,119}$/;
const DIMENSIONS = new Set<string>(LANGUAGE_DIMENSIONS.map(item => item.id));
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty);

/** 区间使用 JS UTF-16 下标，按原文拼接；不把 HTML 或重写句注入实际引用。 */
export function validLanguageHighlights(quote: string, value: unknown): value is LanguageHighlight[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return false;
  const sorted = [...value].sort((a, b) => Number(a?.start) - Number(b?.start));
  let end = 0;
  for (const highlight of sorted) {
    if (!isRecord(highlight) || !Number.isInteger(highlight.start) || !Number.isInteger(highlight.end)
      || Number(highlight.start) < end || Number(highlight.end) <= Number(highlight.start) || Number(highlight.end) > quote.length
      || !nonempty(highlight.text) || quote.slice(Number(highlight.start), Number(highlight.end)) !== highlight.text
      || !nonempty(highlight.labelZh) || !["polite", "core", "qualifier", "term"].includes(String(highlight.role))) return false;
    end = Number(highlight.end);
  }
  return true;
}

export function parseInterviewLanguageIndex(value: unknown, collection: InterviewQuestionCollection): InterviewLanguageIndex | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.sourceCollectionId !== collection.collectionId
    || !Array.isArray(value.points) || value.points.length === 0 || value.points.length > 300 || !strings(value.auditNotes)) return null;
  const questions = new Map(collection.questions.map(question => [question.id, question]));
  const sources = new Map(collection.sources.map(source => [source.id, source]));
  const pointIds = new Set<string>();
  for (const point of value.points) {
    if (!isRecord(point) || !ID.test(String(point.id)) || pointIds.has(String(point.id)) || !DIMENSIONS.has(String(point.dimension))
      || !["titleZh", "patternJa", "meaningZh"].every(key => nonempty(point[key]))
      || !strings(point.explanationZh) || point.explanationZh.length === 0 || !strings(point.pitfallsZh)
      || (point.readingJa !== undefined && !nonempty(point.readingJa))
      || !Array.isArray(point.occurrences) || point.occurrences.length === 0 || point.occurrences.length > 500
      || !isRecord(point.practice) || !["promptZh", "answerZh", "noteZh"].every(key => nonempty((point.practice as Record<string, unknown>)[key]))
      || (point.practice.simpleJa !== undefined && !nonempty(point.practice.simpleJa))) return null;
    if (point.teachingExamples !== undefined && (!Array.isArray(point.teachingExamples)
      || !point.teachingExamples.every(example => isRecord(example) && ["ja", "zh", "noteZh"].every(key => nonempty(example[key]))))) return null;
    const occurrences = new Set<string>();
    for (const occurrence of point.occurrences) {
      if (!isRecord(occurrence) || !nonempty(occurrence.questionId) || !nonempty(occurrence.quote)
        || !nonempty(occurrence.coreMeaningZh) || !strings(occurrence.limitsZh) || !nonempty(occurrence.explanationZh)
        || !validLanguageHighlights(occurrence.quote, occurrence.highlights)) return null;
      const question = questions.get(occurrence.questionId);
      const source = question ? sources.get(question.sourceId) : undefined;
      if (!question || !source || source.scope !== "primary" || source.transcriptType !== "asr"
        || questionReviewStatus(question) !== "accepted" || !collection.publishedTopicIds.includes(question.topicId)
        || !(question.questionText ?? question.originalText).includes(occurrence.quote)) return null;
      // 一点内一题只出现一次，多处重点用同一条引用的多个区间表达。
      const key = occurrence.questionId;
      if (occurrences.has(key)) return null;
      occurrences.add(key);
    }
    pointIds.add(String(point.id));
  }
  return value as InterviewLanguageIndex;
}

export const languageIndexOf = (collection: InterviewQuestionCollection) => parseInterviewLanguageIndex(collection.languageIndex, collection);
export const languagePointsForQuestion = (index: InterviewLanguageIndex, questionId: string) =>
  index.points.filter(point => point.occurrences.some(occurrence => occurrence.questionId === questionId));

export function languageIndexHref(search: string, collectionId: string, dimensionId = "all", pointId?: string) {
  const params = new URLSearchParams(search);
  for (const key of ["chapter", "course", "knowledge", "lessonView", "note", "section", "questionTopic", "questionReview", "questionKind", "questionSearch", "questionPage", "questionId", "languagePoint"]) params.delete(key);
  params.set("questionSet", collectionId);
  params.set("questionView", "language");
  params.set("languageCategory", DIMENSIONS.has(dimensionId) ? dimensionId : "all");
  if (pointId) params.set("languagePoint", pointId);
  return `/training/topics?${params.toString()}`;
}

/** 从来源 ID 找实际展示页，避免把后页或同问法的其他来源错误地拼成 hash。 */
export function questionLocation(collection: InterviewQuestionCollection, questionId: string, pageSize = 20) {
  const question = collection.questions.find(item => item.id === questionId);
  const source = question && collection.sources.find(item => item.id === question.sourceId);
  if (!question || !source || source.scope !== "primary" || source.transcriptType !== "asr" || questionReviewStatus(question) !== "accepted"
    || !collection.publishedTopicIds.includes(question.topicId) || !Number.isInteger(pageSize) || pageSize <= 0) return null;
  const sourceIds = new Set(collection.sources.filter(item => item.scope === "primary" && item.transcriptType === "asr").map(item => item.id));
  const records = collection.questions.filter(item => item.topicId === question.topicId && sourceIds.has(item.sourceId) && questionReviewStatus(item) === "accepted");
  const rows = groupInterviewQuestions(records).flatMap(group => group.variants);
  const offset = rows.findIndex(variant => variant.occurrences.some(item => item.id === questionId));
  return offset < 0 ? null : { topicId: question.topicId, page: Math.floor(offset / pageSize) + 1, representativeQuestionId: rows[offset].question.id };
}
