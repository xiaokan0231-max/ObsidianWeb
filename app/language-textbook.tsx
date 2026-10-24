"use client";

import "./styles/language-textbook.css";
import { useEffect, useRef } from "react";
import { languageChapterHref, type LanguageTextbookChapter } from "@/lib/language-textbook";
import { readTextbookPosition, resolveTextbookPosition, textbookChapterLink, type TextbookPosition } from "@/lib/language-textbook-position";
import { scanReadingHeadings } from "@/lib/reading-document";
import MarkdownDocument from "./markdown-document";
import TextbookLearningModule from "./language-textbook-module";

export default function LanguageTextbook({ chapters, chapter, onSelectChapter, onPractice, onOpenWiki, hasPractice, hasChapterPractice }: {
  chapters: LanguageTextbookChapter[];
  chapter: LanguageTextbookChapter;
  onSelectChapter: (id: string, position?: TextbookPosition) => void;
  onPractice: (courseId?: string) => void;
  onOpenWiki: (target: string, section?: string) => void;
  hasPractice: boolean;
  hasChapterPractice: boolean;
}) {
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

  return <section className="language-textbook" aria-label="面谈日语学习">
    <header className="textbook-heading">
      <div><small>面谈日语 · 先学再练</small><h1>面谈日语：语法、助词与自然表达</h1><p>先看重点，选一个知识点，弄清原句、改法和理由。</p></div>
      {hasPractice && <button type="button" onClick={() => onPractice()}>课后练习（可选）／旧课程 <span aria-hidden="true">↗</span></button>}
    </header>
    <div className="textbook-layout">
      <nav className="textbook-catalog" aria-label="学习章节目录">
        <h2>学习章节 <span>{chapters.length}</span></h2>
        {groups.map((group) => <section key={group}>
          <h3>{group}</h3>
          {chapters.filter((item) => item.group === group).map((item) => <button type="button" key={item.chapterId}
            aria-current={item.chapterId === chapter.chapterId ? "page" : undefined}
            onClick={() => onSelectChapter(item.chapterId)}>
            <strong>{item.title}</strong>
            <small>{item.module ? `${item.module.points.length} 个知识点` : "完整课文"}</small>
          </button>)}
        </section>)}
      </nav>
      <article ref={articleRef} className="textbook-chapter" aria-labelledby="textbook-chapter-title">
        <header className="textbook-chapter-heading"><small>{chapter.group} · 第 {index + 1} / {chapters.length} 章{chapter.studyMinutes ? ` · 约 ${chapter.studyMinutes} 分钟` : ""}</small>
          <h2 id="textbook-chapter-title">{chapter.title}</h2>{!chapter.module && chapter.summary && <p>{chapter.summary}</p>}
        </header>
        {chapter.module ? <>
          <TextbookLearningModule key={chapter.chapterId} chapterId={chapter.chapterId} chapterIds={chapters.map(item => item.chapterId)} module={chapter.module} onOpenWiki={onOpenWiki} />
          <details key={`full-${chapter.chapterId}`} className="textbook-full-lesson"><summary><span>完整课文与原场上下文</span><small>需要深入时再展开</small></summary>
            {headings.length > 0 && <nav className="textbook-section-nav" aria-label="完整课文目录">{headings.map((heading) => <a key={heading.id} href={`#${heading.id}`}>{heading.text}</a>)}</nav>}
            <div className="reader-prose textbook-prose"><MarkdownDocument content={chapter.note.content} onWikiLink={onOpenWiki} resolveInternalLink={resolveInternalLink} reading /></div>
          </details>
        </> : <>
          {headings.length > 0 && <nav className="textbook-section-nav" aria-label="本章目录">{headings.map((heading) => <a key={heading.id} href={`#${heading.id}`}>{heading.text}</a>)}</nav>}
          <div className="reader-prose textbook-prose"><MarkdownDocument content={chapter.note.content} onWikiLink={onOpenWiki} resolveInternalLink={resolveInternalLink} reading /></div>
        </>}
        {hasChapterPractice && <section className="textbook-practice"><h3>课后练习（可选）</h3><p>想检验这一章的理解时，再进入练习。阅读不需要作答或自评。</p><button type="button" onClick={() => onPractice(chapter.exerciseCourseId)}>进入本章练习 <span aria-hidden="true">↗</span></button></section>}
        <nav className="textbook-pagination" aria-label="章节导航">
          {previous ? <button type="button" onClick={() => onSelectChapter(previous.chapterId)}><small>← 上一章</small><strong>{previous.title}</strong></button> : <span />}
          {next ? <button type="button" onClick={() => onSelectChapter(next.chapterId)}><small>下一章 →</small><strong>{next.title}</strong></button> : <p>已读到最后一章。可以从目录重读需要的内容。</p>}
        </nav>
      </article>
    </div>
  </section>;
}
