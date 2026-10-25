import type { InterviewQuestionCollection } from "./interview-question-collection.ts";
import { questionReviewStatus } from "./interview-question-collection.ts";
import type { LanguageTextbookChapter } from "./language-textbook.ts";
import { normalizeTextbookPosition, textbookPositionKey, type TextbookPosition } from "./language-textbook-position.ts";

export const SPECIAL_MODULES = [
  { id: "questions", title: "真实提问研读", kind: "研读", description: "先理解对方想问什么，再从原句学习敬语、表达、语法与词汇。", action: "浏览提问与用法" },
  { id: "textbook", title: "面谈语言课", kind: "学习", description: "按章学清楚工作表达、助词和句子的组织方式，中文讲解后再看日语例句。", action: "查看学习章节" },
  { id: "practice", title: "情境与表达练习", kind: "练习 · 可选", description: "用情境练习理解、回应与修复，也可单独练词块、句型和改写。", action: "选择练习课程" },
] as const;
export type SpecialModuleId = typeof SPECIAL_MODULES[number]["id"];
export type SpecialTrainingRoute =
  | { kind: "home" }
  | { kind: "module"; module: SpecialModuleId }
  | { kind: "chapter"; module: "textbook"; chapterId: string }
  | { kind: "course"; module: "practice"; courseId: string }
  | { kind: "questions"; module: "questions"; collectionId: string }
  | { kind: "language"; module: "questions"; collectionId: string };

export const SPECIAL_URL_KEYS = ["specialModule", "questionCatalog", "languageReturnCategory", "course", "chapter", "knowledge", "lessonView", "questionSet", "questionTopic", "questionReview", "questionKind", "questionSearch", "questionPage", "questionView", "languageCategory", "languagePoint", "questionId", "note", "section"] as const;

/** 总览和目录只由 URL 决定；缓存只能恢复明确打开的内容，不能替用户选择首页。 */
export function specialTrainingRoute(search: string): SpecialTrainingRoute {
  const params = new URLSearchParams(search);
  const requestedModule = params.get("specialModule");
  if (requestedModule === "home") return { kind: "home" };
  if (SPECIAL_MODULES.some(item => item.id === requestedModule)) return { kind: "module", module: requestedModule as SpecialModuleId };
  const courseId = params.get("course");
  if (courseId) return { kind: "course", module: "practice", courseId };
  const chapterId = params.get("chapter");
  if (chapterId) return { kind: "chapter", module: "textbook", chapterId };
  const collectionId = params.get("questionSet");
  if (collectionId) return { kind: params.get("questionView") === "language" ? "language" : "questions", module: "questions", collectionId };
  // 早期教材链接只有章内位置；继续读首章，但裸入口始终是总览。
  if (params.has("knowledge") || params.has("lessonView")) return { kind: "chapter", module: "textbook", chapterId: "" };
  return { kind: "home" };
}

export function specialTrainingHref(search: string, module?: SpecialModuleId) {
  const params = new URLSearchParams(search);
  for (const key of SPECIAL_URL_KEYS) params.delete(key);
  if (module) params.set("specialModule", module);
  return `/training/topics${params.size ? `?${params}` : ""}`;
}

export function specialCourseHref(search: string, courseId: string) {
  const params = new URL(specialTrainingHref(search), "http://localhost").searchParams;
  params.set("course", courseId);
  return `/training/topics?${params}`;
}

export function specialQuestionModuleHref(search: string, view: "intent" | "language", dimension?: string) {
  const params = new URL(specialTrainingHref(search, "questions"), "http://localhost").searchParams;
  if (view === "language") {
    params.set("questionCatalog", "language");
    if (dimension) params.set("languageCategory", dimension);
  }
  return `/training/topics?${params}`;
}

export function specialQuestionCounts(collection: InterviewQuestionCollection) {
  const sourceIds = new Set(collection.sources.filter(source => source.scope === "primary" && source.transcriptType === "asr").map(source => source.id));
  return { topics: collection.publishedTopicIds.length, acceptedAsr: collection.questions.filter(question => sourceIds.has(question.sourceId)
    && questionReviewStatus(question) === "accepted" && collection.publishedTopicIds.includes(question.topicId)).length };
}

/** 旧记录没有访问时间，只呈现各章保存位置，不声称这是最近阅读顺序。 */
export function specialSavedReadings(chapters: LanguageTextbookChapter[], read: (key: string) => string | null) {
  const readings: { chapter: LanguageTextbookChapter; position: TextbookPosition }[] = [];
  for (const chapter of chapters) {
    if (!chapter.module) continue;
    try {
      const saved = JSON.parse(read(textbookPositionKey(chapter.chapterId)) ?? "null");
      if (!saved || !chapter.module.points.some(point => point.id === saved.knowledge)) continue;
      readings.push({ chapter, position: normalizeTextbookPosition(chapter.module, saved) });
    } catch { /* 单章旧缓存失效不影响其它章节，也不改写存储。 */ }
  }
  return readings;
}
