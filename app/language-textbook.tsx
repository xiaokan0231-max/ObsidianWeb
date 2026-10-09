"use client";

import "./styles/language-textbook.css";
import { useEffect, useRef } from "react";
import { languageChapterHref, type LanguageTextbookChapter } from "@/lib/language-textbook";
import { readTextbookPosition, resolveTextbookPosition, textbookChapterLink, type TextbookPosition } from "@/lib/language-textbook-position";
import { scanReadingHeadings } from "@/lib/reading-document";
import MarkdownDocument from "./markdown-document";
import TextbookLearningModule from "./language-textbook-module";
import { useTextbookCopy } from "./language-textbook-copy";

export default function LanguageTextbook({ chapters, chapter, onSelectChapter, onPractice, onOpenWiki, hasPractice, hasChapterPractice }: {
  chapters: LanguageTextbookChapter[];
  chapter: LanguageTextbookChapter;
  onSelectChapter: (id: string, position?: TextbookPosition) => void;
  onPractice: (courseId?: string) => void;
  onOpenWiki: (target: string, section?: string) => void;
  hasPractice: boolean;
  hasChapterPractice: boolean;
}) {
  const { t, number, locale } = useTextbookCopy();
  const articleRef = useRef<HTMLElement>(null);
  const previousChapter = useRef(chapter.chapterId);
  useEffect(() => {
    if (previousChapter.current !== chapter.chapterId) {
      articleRef.current?.scrollIntoView({ block: "start" });
      previousChapter.current = chapter.chapterId;
    }
  }, [chapter.chapterId]);
  const index = chapters.findIndex((item) => item.chapterId === chapter.chapterId);
  const previous = chapters[index - 1];
  const next = chapters[index + 1];
  const headings = scanReadingHeadings(chapter.note.content).filter((heading) => heading.level === 2);
  const groups = [...new Set(chapters.map((item) => item.group))];
  const resolveInternalLink = (href: string) => {
    const origin = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin || "http://localhost:3000";
    const link = textbookChapterLink(href, origin, chapters.map(item => item.chapterId));
    if (!link) return null;
    const target = chapters.find(item => item.chapterId === link.chapterId)!;
    const position = target.module ? resolveTextbookPosition(target.module, link.search, readTextbookPosition(link.chapterId)) : undefined;
    return { href: languageChapterHref(link.search, link.chapterId, position), onNavigate: () => onSelectChapter(link.chapterId, position) };
  };

  return <section className="language-textbook" aria-label={t("面谈日语学习")} lang={locale}>
    <header className={`textbook-heading${chapter.module ? " textbook-heading-module" : ""}`}>
      <div><small>{t("面谈日语 · 先学再练")}</small><h1>{t("面谈日语：语法、助词与自然表达")}</h1><p>{t(chapter.module ? "一次学一个用法：看懂、辨别，再说一句。" : "先看原场表达和改动性质，再逐步弄清用法、区别与例句。")}</p><p>{t("教材讲解为中文，引用与例句保留日语。")}</p></div>
      {hasPractice && <button type="button" onClick={() => onPractice()}>{t("查看可选练习")} <span aria-hidden="true">↗</span></button>}
    </header>
    <div className="textbook-layout">
      <nav className="textbook-catalog" aria-label={t("学习章节目录")}>
        <h2>{t("学习章节")} <span>{number(chapters.length)}</span></h2>
        {groups.map((group) => <section key={group}>
          <h3 lang="zh-CN">{group}</h3>
          {chapters.filter((item) => item.group === group).map((item) => <button type="button" key={item.chapterId}
            aria-current={item.chapterId === chapter.chapterId ? "page" : undefined}
            onClick={() => onSelectChapter(item.chapterId)}>
            <strong lang="zh-CN">{item.title}</strong>
            <small>{item.module ? t("{count} 个知识点", { count: item.module.points.length }) : t("完整课文")}</small>
          </button>)}
        </section>)}
      </nav>
      <article ref={articleRef} className="textbook-chapter" aria-labelledby="textbook-chapter-title">
        <header className="textbook-chapter-heading"><small><span lang="zh-CN">{chapter.group}</span> · {t("第 {current} / {total} 章", { current: index + 1, total: chapters.length })}{chapter.studyMinutes ? ` · ${t("约 {minutes} 分钟", { minutes: chapter.studyMinutes })}` : ""}</small>
          <h2 id="textbook-chapter-title" lang="zh-CN">{chapter.title}</h2>{!chapter.module && chapter.summary && <p lang="zh-CN">{chapter.summary}</p>}
        </header>
        {chapter.module ? <>
          <TextbookLearningModule key={chapter.chapterId} chapterId={chapter.chapterId} chapterIds={chapters.map(item => item.chapterId)} module={chapter.module} onOpenWiki={onOpenWiki} />
          <details key={`full-${chapter.chapterId}`} className="textbook-full-lesson"><summary><span>{t("完整课文与原场上下文")}</span><small>{t("需要深入时再展开")}</small></summary>
            {headings.length > 0 && <nav className="textbook-section-nav" aria-label={t("完整课文目录")}>{headings.map((heading) => <a key={heading.id} href={`#${heading.id}`} lang="zh-CN">{heading.text}</a>)}</nav>}
            <div className="reader-prose textbook-prose" lang="zh-CN"><MarkdownDocument content={chapter.note.content} onWikiLink={onOpenWiki} resolveInternalLink={resolveInternalLink} reading /></div>
          </details>
        </> : <>
          {headings.length > 0 && <nav className="textbook-section-nav" aria-label={t("本章目录")}>{headings.map((heading) => <a key={heading.id} href={`#${heading.id}`} lang="zh-CN">{heading.text}</a>)}</nav>}
          <div className="reader-prose textbook-prose" lang="zh-CN"><MarkdownDocument content={chapter.note.content} onWikiLink={onOpenWiki} resolveInternalLink={resolveInternalLink} reading /></div>
        </>}
        {hasChapterPractice && <section className="textbook-practice"><h3>{t("课后练习（可选）")}</h3><p>{t("想检验这一章的理解时，再进入练习。阅读不需要作答或自评。")}</p><button type="button" onClick={() => onPractice(chapter.exerciseCourseId)}>{t("进入本章练习")} <span aria-hidden="true">↗</span></button></section>}
        <nav className="textbook-pagination" aria-label={t("章节导航")}>
          {previous ? <button type="button" onClick={() => onSelectChapter(previous.chapterId)}><small>{t("← 上一章")}</small><strong lang="zh-CN">{previous.title}</strong></button> : <span />}
          {next ? <button type="button" onClick={() => onSelectChapter(next.chapterId)}><small>{t("下一章 →")}</small><strong lang="zh-CN">{next.title}</strong></button> : <p>{t("已读到最后一章。可以从目录重读需要的内容。")}</p>}
        </nav>
      </article>
    </div>
  </section>;
}
