"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import type { LanguageExpressionCourse } from "@/lib/language-expression-course";
import type { LanguageTextbookChapter } from "@/lib/language-textbook";
import type { TextbookPosition } from "@/lib/language-textbook-position";
import { QUESTION_TOPICS, type QuestionCollectionResource } from "@/lib/interview-question-collection";
import { LANGUAGE_DIMENSIONS, type InterviewLanguageIndex } from "@/lib/interview-language";
import { SPECIAL_MODULES, specialQuestionCounts, specialQuestionModuleHref, specialSavedReadings, specialTrainingHref, type SpecialModuleId } from "@/lib/special-training-navigation";
import { trainingTopicCopy, trainingDimensionCopy } from "@/lib/special-training-i18n";
import { useSpecialTrainingCopy } from "./special-training-copy";
import "./styles/special-training.css";

type CatalogProps = {
  chapters: LanguageTextbookChapter[];
  courses: LanguageExpressionCourse[];
  questionCollections: QuestionCollectionResource[];
  languageIndexes: Map<string, InterviewLanguageIndex | null>;
  search: string;
  onNavigate: (href: string) => void;
  onSelectChapter: (id: string, position?: TextbookPosition) => void;
  onSelectCourse: (id: string) => void;
  onSelectQuestionTopic: (id: string, topic?: string) => void;
  onSelectLanguagePoint: (id: string, dimension?: string, point?: string) => void;
};

function TrainingLink({ href, onNavigate, children, className }: { href: string; onNavigate: (href: string) => void; children: ReactNode; className?: string }) {
  return <a className={className} href={href} onClick={event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); onNavigate(href);
  }}>{children}</a>;
}

export function SpecialTrainingBreadcrumbs({ search, module, moduleHref, title, titleLang, onNavigate }: { search: string; module?: SpecialModuleId; moduleHref?: string; title?: string; titleLang?: string; onNavigate: (href: string) => void }) {
  const { t } = useSpecialTrainingCopy();
  const item = SPECIAL_MODULES.find(item => item.id === module);
  return <nav className="special-breadcrumbs" aria-label={t("专项训练导航")}>
    {item ? <TrainingLink href={specialTrainingHref(search)} onNavigate={onNavigate}>{t("专项总览")}</TrainingLink> : <span aria-current="page">{t("专项总览")}</span>}
    {item && <><span aria-hidden="true">/</span>{title ? <TrainingLink href={moduleHref ?? specialTrainingHref(search, item.id)} onNavigate={onNavigate}>{t(item.title)}</TrainingLink> : <span aria-current="page">{t(item.title)}</span>}</>}
    {title && <><span aria-hidden="true">/</span><span aria-current="page" lang={titleLang}>{title}</span></>}
  </nav>;
}

const subscribeReadings = (listener: () => void) => {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
};
const noReadings = () => "[]";

export function SpecialTrainingDashboard(props: CatalogProps) {
  const { t } = useSpecialTrainingCopy();
  const { chapters, courses, questionCollections, languageIndexes, search, onNavigate, onSelectChapter } = props;
  // 只读缓存且不挂载教材，避免总览生成默认首章的访问记录。
  const saved = useSyncExternalStore(subscribeReadings, () => JSON.stringify(specialSavedReadings(chapters, key => window.localStorage.getItem(key)).map(item => ({ id: item.chapter.chapterId, position: item.position }))), noReadings);
  const readings = JSON.parse(saved) as { id: string; position: TextbookPosition }[];
  const questionCount = questionCollections.reduce((sum, { collection }) => sum + specialQuestionCounts(collection).acceptedAsr, 0);
  const topicCount = questionCollections.reduce((sum, { collection }) => sum + specialQuestionCounts(collection).topics, 0);
  const languageCount = [...languageIndexes.values()].reduce((sum, index) => sum + (index?.points.length ?? 0), 0);
  const scenarioCount = courses.filter(course => course.scenario).length;
  const counts = {
    questions: t("{topics} 个提问主题 · {questions} 条已审核 ASR 记录 · {points} 个语言知识点", { topics: topicCount, questions: questionCount, points: languageCount }),
    textbook: t("{chapters} 章 · {points} 个教材知识点", { chapters: chapters.length, points: chapters.reduce((sum, chapter) => sum + (chapter.module?.points.length ?? 0), 0) }),
    practice: t("{scenario} 门情境练习 · {expression} 门表达练习", { scenario: scenarioCount, expression: courses.length - scenarioCount }),
  };
  return <section className="special-overview" aria-label={t("专项训练总览")}>
    <header className="special-page-heading"><small>{t("按需要选一个模块")}</small><h1>{t("专项训练")}</h1><p>{t("读懂真实提问，学清语言用法，再选择需要的练习。")}</p></header>
    <div className="special-module-grid">{SPECIAL_MODULES.map(item => <TrainingLink key={item.id} className={`special-module-card module-${item.id}`} href={specialTrainingHref(search, item.id)} onNavigate={onNavigate}>
      <span className="special-module-kind">{t(item.kind)}</span><h2>{t(item.title)}</h2><p>{t(item.description)}</p><small>{counts[item.id]}</small><strong>{t(item.action)} <span aria-hidden="true">→</span></strong>
    </TrainingLink>)}</div>
    {readings.length > 0 && <section className="special-resume" aria-label={t("已保存阅读位置")}><div><h2>{t("继续阅读")}</h2><p>{t("按章恢复已保存的位置。")}</p></div><div className="special-resume-list">{readings.map(({ id, position }) => {
      const chapter = chapters.find(item => item.chapterId === id)!;
      const point = chapter.module?.points.find(item => item.id === position.knowledge);
      return <button type="button" key={id} onClick={() => onSelectChapter(id, position)}><strong lang="zh-CN">{chapter.title}</strong><span lang="zh-CN">{point?.titleZh} <i aria-hidden="true">→</i></span></button>;
    })}</div></section>}
    <p className="special-overview-note">{t("先阅读中文解释，也可以直接查用法。练习由你选择，不影响阅读。")}</p>
  </section>;
}

export function SpecialTrainingModule({ module, ...props }: CatalogProps & { module: SpecialModuleId }) {
  const { t, locale, number, date } = useSpecialTrainingCopy();
  const { chapters, courses, questionCollections, languageIndexes, search, onNavigate, onSelectChapter, onSelectCourse, onSelectQuestionTopic, onSelectLanguagePoint } = props;
  const item = SPECIAL_MODULES.find(item => item.id === module)!;
  const params = new URLSearchParams(search);
  const languageView = params.get("questionCatalog") === "language";
  const dimension = params.get("languageCategory") ?? "all";
  return <section className="special-module-page" aria-label={t("{module}目录", { module: t(item.title) })}>
    <header className="special-page-heading"><small>{t(item.kind)}</small><h1>{t(item.title)}</h1><p>{t(item.description)}</p></header>
    <p className="special-content-language-note">{t("解说保留中文，日语引用与资料标题保留原文。")}</p>
    {module === "textbook" && <div className="special-chapter-list">{chapters.map((chapter, index) => <button type="button" key={chapter.chapterId} onClick={() => onSelectChapter(chapter.chapterId)}>
      <span className="special-list-number">{number(index + 1).padStart(2, "0")}</span><div lang="zh-CN"><small>{chapter.group}</small><h2>{chapter.title}</h2><p>{chapter.summary || chapter.module?.summaryZh}</p></div><span className="special-list-meta">{chapter.module ? t("{count} 个知识点", { count: chapter.module.points.length }) : t("完整课文")}<i aria-hidden="true">→</i></span>
    </button>)}{chapters.length === 0 && <p>{t("尚未载入学习章节。")}</p>}</div>}
    {module === "practice" && <>{[{ title: "情境练习", description: "先辨认提问，再做中文复述、日语回应、修复和迁移。", courses: courses.filter(course => course.scenario) }, { title: "表达练习", description: "单独巩固词块、搭配、句型和改写。", courses: courses.filter(course => !course.scenario) }].map(group => <section key={group.title} className="special-catalog-group"><header><h2>{t(group.title as "情境练习" | "表达练习")} <span>{number(group.courses.length)}</span></h2><p>{t(group.description as "先辨认提问，再做中文复述、日语回应、修复和迁移。" | "单独巩固词块、搭配、句型和改写。")}</p></header><div className="special-item-grid">{group.courses.map(course => <button type="button" key={course.courseId} onClick={() => onSelectCourse(course.courseId)}><small lang="und">{course.topic}</small><h3 lang="und">{course.title}</h3><p>{course.scenario ? t("约 {minutes} 分钟 · {steps} 个步骤", { minutes: course.scenario.durationMinutes, steps: course.scenario.steps.length }) : t("{chunks} 个词块 · {patterns} 个句型", { chunks: course.chunks.length, patterns: course.patterns.length })}</p><strong>{t("进入练习")} <span aria-hidden="true">→</span></strong></button>)}</div></section>)}{courses.length === 0 && <p>{t("尚未载入练习课程。")}</p>}</>}
    {module === "questions" && <>
      <nav className="special-question-views" aria-label={t("真实提问研读方式")}>{[{ id: "intent", title: "按提问意图", text: "比较同一个任务的不同问法" }, { id: "language", title: "按语言用法", text: "从原句学习敬语、表达、语法和词汇" }].map(view => <TrainingLink key={view.id} href={specialQuestionModuleHref(search, view.id as "intent" | "language")} onNavigate={onNavigate} className={(languageView ? "language" : "intent") === view.id ? "active" : undefined}><strong>{t(view.title as "按提问意图" | "按语言用法")}</strong><small>{t(view.text as "比较同一个任务的不同问法" | "从原句学习敬语、表达、语法和词汇")}</small></TrainingLink>)}</nav>
      <p className="special-relation-note">{t("两个视角引用同一批原问题；用法页可返回完整原问与上下文。")}</p>
      {languageView && <nav className="special-language-filters" aria-label={t("语言用法分类")}>{[{ id: "all", titleZh: "全部" }, ...LANGUAGE_DIMENSIONS].map(category => <TrainingLink key={category.id} href={specialQuestionModuleHref(search, "language", category.id)} onNavigate={onNavigate} className={dimension === category.id ? "active" : undefined}>{category.id === "all" ? t("全部") : trainingDimensionCopy(category as typeof LANGUAGE_DIMENSIONS[number], locale).title}</TrainingLink>)}</nav>}
      {questionCollections.map(({ collection }) => {
        const index = languageIndexes.get(collection.collectionId);
        const points = index?.points.filter(point => dimension === "all" || point.dimension === dimension) ?? [];
        return <section className="special-catalog-group" key={collection.collectionId}><header><h2 lang="zh-CN">{collection.title}</h2><p><time dateTime={collection.window.start}>{date(collection.window.start)}</time> — <time dateTime={collection.window.end}>{date(collection.window.end)}</time> · JST · {languageView ? t("{count} 个用法", { count: points.length }) : t("{count} 条已审核 ASR 记录", { count: specialQuestionCounts(collection).acceptedAsr })}</p></header><div className="special-item-grid">
          {languageView ? points.map(point => <button type="button" key={point.id} onClick={() => onSelectLanguagePoint(collection.collectionId, point.dimension, point.id)}><small>{trainingDimensionCopy(LANGUAGE_DIMENSIONS.find(category => category.id === point.dimension)!, locale).title} · {t("{count} 条原场引用", { count: point.occurrences.length })}</small><h3 lang="zh-CN">{point.titleZh}</h3><p lang="zh-CN">{point.meaningZh}</p><strong>{t("学习这个用法")} <span aria-hidden="true">→</span></strong></button>) : QUESTION_TOPICS.filter(topic => collection.publishedTopicIds.includes(topic.id)).map(topic => <button type="button" key={topic.id} onClick={() => onSelectQuestionTopic(collection.collectionId, topic.id)}><h3>{trainingTopicCopy(topic, locale).title}</h3><p>{trainingTopicCopy(topic, locale).summary}</p><strong>{t("查看真实问法")} <span aria-hidden="true">→</span></strong></button>)}
        </div>{!languageView && <button type="button" className="special-browse-all" onClick={() => onSelectQuestionTopic(collection.collectionId, "all")}>{t("浏览全部提问与来源审核")} →</button>}{languageView && !index && <p>{t("语言索引尚未载入或需要核对，按提问意图仍可阅读原问题。")}</p>}{languageView && index && points.length === 0 && <p>{t("这个分类尚未整理用法，可切换其它分类。")}</p>}</section>;
      })}
      {questionCollections.length === 0 && <p>{t("尚未载入问题集。")}</p>}
    </>}
  </section>;
}
