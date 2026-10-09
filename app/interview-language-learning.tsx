"use client";

import { trainingDimensionCopy } from "@/lib/special-training-i18n";
import { useInterviewStudyCopy } from "./interview-study-copy";

import type { ReactNode } from "react";
import { LANGUAGE_DIMENSIONS, type InterviewLanguageIndex, type LanguageHighlight } from "@/lib/interview-language";
import type { InterviewQuestionCollection } from "@/lib/interview-question-collection";
import "./styles/interview-language-learning.css";

const ROLE_LABELS = { polite: "礼貌表达", core: "核心任务", qualifier: "范围限定", term: "词语搭配" };
const SOURCE_KINDS = { employer: "企业", agency: "中介", platform: "平台" };

/** 按 UTF-16 区间保留整句，标签另列；原文中的尖括号也只作为文字。 */
export function HighlightedQuestion({ quote, highlights, labelPrefix }: { quote: string; highlights: LanguageHighlight[]; labelPrefix: string }) {
  const pieces: ReactNode[] = [];
  let cursor = 0;
  [...highlights].sort((a, b) => a.start - b.start).forEach(highlight => {
    pieces.push(quote.slice(cursor, highlight.start));
    pieces.push(<strong key={highlight.start} className={`language-highlight role-${highlight.role}`} aria-describedby={`${labelPrefix}-${highlight.start}`}>{quote.slice(highlight.start, highlight.end)}</strong>);
    cursor = highlight.end;
  });
  pieces.push(quote.slice(cursor));
  return <p className="language-original" lang="ja">{pieces}</p>;
}

export default function InterviewLanguageLearning({ collection, index, dimensionId = "all", pointId, questionId, onSelectPoint, onSelectQuestion, onBrowseQuestions, onOpenQuestion, onBack, onOpenWiki }: {
  collection: InterviewQuestionCollection; index: InterviewLanguageIndex; dimensionId?: string; pointId?: string; questionId?: string;
  onSelectPoint: (dimensionId: string, pointId?: string) => void;
  onSelectQuestion: (questionId: string, dimensionId: string, pointId: string) => void;
  onBrowseQuestions: () => void; onOpenQuestion: (questionId: string) => void; onBack: () => void;
  onOpenWiki: (target: string, section?: string) => void;
}) {
  const { t, label, date, locale } = useInterviewStudyCopy();
  const requested = index.points.find(point => point.id === pointId);
  const activeDimension = requested?.dimension ?? LANGUAGE_DIMENSIONS.find(item => item.id === dimensionId)?.id ?? index.points[0]?.dimension;
  const points = index.points.filter(point => point.dimension === activeDimension);
  const point = requested ?? points[0];
  const occurrenceIndex = point ? Math.max(0, point.occurrences.findIndex(item => item.questionId === questionId)) : 0;
  const occurrence = point?.occurrences[occurrenceIndex];
  const question = collection.questions.find(item => item.id === occurrence?.questionId);
  const source = collection.sources.find(item => item.id === question?.sourceId);
  const labels = point && occurrence ? `language-mark-${point.id}-${occurrence.questionId}` : "language-mark";
  const dimension = LANGUAGE_DIMENSIONS.find(item => item.id === activeDimension);
  return <section className="interview-language-learning" aria-label={t("面试提问语言学习")} lang={locale}>
    <header className="language-learning-heading"><div><small>{t("面试官问题集 · 从真实提问学语言")}</small><h1>{t("读懂面试里的日语")}</h1><p>{t("先看这一句在问什么，再学它的表达方式。精选用法不代表全部问题，也不判断本人能力。")}</p></div><div><button type="button" onClick={onBrowseQuestions}>{t("按提问主题浏览 ↗")}</button><button type="button" onClick={onBack}>{t("返回研读目录")}</button></div></header>
    <p className="language-material-note">{t("languageNote")}</p>
    <nav className="language-dimensions" aria-label={t("语言学习分类")}>{LANGUAGE_DIMENSIONS.map(item => <button type="button" key={item.id} aria-current={item.id === activeDimension ? "page" : undefined} onClick={() => onSelectPoint(item.id)}><strong>{trainingDimensionCopy(item, locale).title}</strong><small>{trainingDimensionCopy(item, locale).summary}</small></button>)}</nav>
    <div className="language-learning-layout"><nav className="language-point-nav" aria-label={t("语言知识点")}><h2>{dimension && trainingDimensionCopy(dimension, locale).title} · {t("pointCount", {count: points.length})}</h2>{points.map(item => <button type="button" key={item.id} aria-current={point?.id === item.id ? "page" : undefined} onClick={() => onSelectPoint(item.dimension, item.id)}><strong lang="zh-CN">{item.titleZh}</strong><small>{t("occurrenceCount", {count: item.occurrences.length})}</small></button>)}{points.length === 0 && <p>{t("这个分类尚未整理知识点，可切换其他分类。")}</p>}</nav>
      {point && occurrence && question && source ? <div className="language-point-content" key={`${point.id}-${occurrence.questionId}`}>
        <header><small>{dimension && trainingDimensionCopy(dimension, locale).title} · {t("先读原句")}</small><h2 lang="zh-CN">{point.titleZh}</h2><p lang="zh-CN">{point.meaningZh}</p></header>
        <article className="language-real-example">
          <div className="language-example-toolbar"><strong>{t("原场引用 · ASR 转写")}</strong><nav aria-label={t("同类真实原句")}><button type="button" disabled={occurrenceIndex === 0} onClick={() => onSelectQuestion(point.occurrences[occurrenceIndex - 1].questionId, point.dimension, point.id)}>{t("← 上一条")}</button><span>{t("occurrencePosition", {current: occurrenceIndex + 1, count: point.occurrences.length})}</span><button type="button" disabled={occurrenceIndex === point.occurrences.length - 1} onClick={() => onSelectQuestion(point.occurrences[occurrenceIndex + 1].questionId, point.dimension, point.id)}>{t("下一条 →")}</button></nav></div>
          <HighlightedQuestion quote={occurrence.quote} highlights={occurrence.highlights} labelPrefix={labels} />
          <ul className="language-highlight-labels" aria-label={t("句中作用标记")}>{[...occurrence.highlights].sort((a, b) => a.start - b.start).map(mark => <li key={mark.start} id={`${labels}-${mark.start}`}><b className={`role-${mark.role}`}>{label(ROLE_LABELS[mark.role])}</b><span lang="zh-CN">{mark.labelZh} <span lang="ja">「{mark.text}」</span></span></li>)}</ul>
          <p className="language-mark-note">{t("颜色表示句子中的作用，不表示错误；转写未据此视为已核验原音。")}</p>
          <section className="language-task"><h3>{t("这句要回答什么")}</h3><p lang="zh-CN">{occurrence.coreMeaningZh}</p></section>
          {occurrence.limitsZh.length > 0 && <section className="language-limits"><h3>{t("易漏的范围与限定")}</h3><ul>{occurrence.limitsZh.map(item => <li lang="zh-CN" key={item}>{item}</li>)}</ul></section>}
          <p className="language-context-explanation" lang="zh-CN">{occurrence.explanationZh}</p>
          {question.uncertaintyZh && <p className="language-material-note">{t("转写提示：")}<span lang="zh-CN">{question.uncertaintyZh}</span></p>}
          <footer className="language-source-line"><span>{date(source.date)} · {source.company} · {label(SOURCE_KINDS[source.kind])} · L{question.lineStart}{question.lineEnd !== question.lineStart && `–${question.lineEnd}`}</span><button type="button" onClick={() => onOpenQuestion(question.id)}>{t("查看完整原问与上下文 →")}</button><button type="button" onClick={() => onOpenWiki(source.path)}>{t("来源笔记 ↗")}</button></footer>
        </article>
        <section className="language-teaching"><h3>{t("用法归纳")} <small>{t("教学整理，非原问")}</small></h3><p className="language-pattern" lang="ja">{point.patternJa}</p>{point.readingJa && <p className="language-reading">{t("读音：")}<span lang="ja">{point.readingJa}</span></p>}<p lang="zh-CN">{point.explanationZh[0]}</p>
          {point.explanationZh.length > 1 && <details><summary>{t("继续看接续与使用条件")}</summary>{point.explanationZh.slice(1).map(item => <p lang="zh-CN" key={item}>{item}</p>)}</details>}
          {point.pitfallsZh.length > 0 && <details><summary>{t("容易混淆的地方")}</summary><ul>{point.pitfallsZh.map(item => <li lang="zh-CN" key={item}>{item}</li>)}</ul></details>}
          {!!point.teachingExamples?.length && <details><summary>{t("拓展教学例句 · 非实见原问、非本人经历")}</summary>{point.teachingExamples.map((example, i) => <article className="language-teaching-example" key={i}><p lang="ja">{example.ja}</p><p lang="zh-CN">{example.zh}</p><small lang="zh-CN">{example.noteZh}</small></article>)}</details>}
        </section>
        <section className="language-optional-practice"><h3>{t("试着理解一句")} <small>{t("可跳过，也可直接看参考")}</small></h3><p className="language-material-note">{t("以下是教学练习，非实见原问；不代替本人经历或意愿，不计能力结果。")}</p><p lang="zh-CN">{point.practice.promptZh}</p><details><summary>{t("查看参考与理由")}</summary><p lang="zh-CN">{point.practice.answerZh}</p>{point.practice.simpleJa && <p lang="ja">{point.practice.simpleJa}</p>}<p lang="zh-CN">{point.practice.noteZh}</p></details></section>
        <nav className="language-point-navigation" aria-label={t("知识点顺序")}><button type="button" disabled={points.indexOf(point) <= 0} onClick={() => onSelectPoint(point.dimension, points[points.indexOf(point) - 1].id)}>{t("← 上一知识点")}</button><span>{t("position", {current: points.indexOf(point) + 1, count: points.length})}</span><button type="button" disabled={points.indexOf(point) >= points.length - 1} onClick={() => onSelectPoint(point.dimension, points[points.indexOf(point) + 1].id)}>{t("下一知识点 →")}</button></nav>
      </div> : <div className="language-empty">{t("选择一个已有知识点开始阅读。")}</div>}
    </div>
    {index.auditNotes.length > 0 && <details className="language-index-notes"><summary>{t("语言材料范围与整理说明")}</summary>{index.auditNotes.map(item => <p lang="zh-CN" key={item}>{item}</p>)}</details>}
  </section>;
}
