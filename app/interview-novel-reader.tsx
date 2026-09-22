"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { plainSei, type ParsedSeirikou, type ReviewDecisionTask, type ReviewSentence } from "@/lib/review";

type Language = "ja" | "zh";
type ReadingTurn = {
  speaker: ReviewSentence["speaker"];
  uncertain: boolean;
  sentences: ReviewSentence[];
};

export default function InterviewNovelReader({
  company, date, round, parsed, decisionTasks, language, onLanguageChange, onExit, onBack,
}: {
  company: string;
  date: string;
  round: string;
  parsed: ParsedSeirikou;
  decisionTasks: ReviewDecisionTask[];
  language: Language;
  onLanguageChange: (language: Language) => void;
  onExit: () => void;
  onBack: () => void;
}) {
  const readerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const tocRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);
  const [fontSize, setFontSize] = useState(18);
  const [tocOpen, setTocOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeChapter, setActiveChapter] = useState(0);

  const chapters = useMemo(() => {
    const decisions = new Map(decisionTasks
      .filter((task) => task.target === "speaker" && task.resolvedBy)
      .map((task) => [task.sentenceId, task.resolution]));
    return parsed.blocks.map((block) => {
      const turns: ReadingTurn[] = [];
      for (const sentence of block.sentences) {
        const decision = decisions.get(sentence.id);
        const speaker = decision === "speaker-interviewer" ? "面"
          : decision === "speaker-self" ? "私" : sentence.speaker;
        const uncertain = sentence.uncertainSpeaker
          && decision !== "speaker-interviewer" && decision !== "speaker-self";
        const last = turns[turns.length - 1];
        // 注释紧跟对应发言，不能被后续同话者的长段落隔开，也不能混成现场原话。
        if (last && last.speaker === speaker && last.uncertain === uncertain
          && !last.sentences[last.sentences.length - 1].notes.some((note) => note.trim())) {
          last.sentences.push(sentence);
        } else {
          turns.push({ speaker, uncertain, sentences: [sentence] });
        }
      }
      return { ...block, turns };
    });
  }, [parsed, decisionTasks]);
  const sentenceCount = parsed.sentences.length;
  const missingTranslations = parsed.sentences.filter((sentence) => !sentence.yaku?.trim()).length;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    exitRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>("[data-novel-entry]")?.focus({ preventScroll: true });
      });
    };
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const measure = () => {
      const range = scroller.scrollHeight - scroller.clientHeight;
      setProgress(range > 0 ? Math.round(scroller.scrollTop / range * 100) : 100);
      const top = scroller.getBoundingClientRect().top;
      const headings = scroller.querySelectorAll<HTMLElement>(".nr-chapter");
      let current = 0;
      headings.forEach((heading, index) => {
        if (heading.getBoundingClientRect().top <= top + 120) current = index;
      });
      setActiveChapter(current);
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    schedule();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [chapters, language, fontSize]);

  const rememberPosition = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const top = scroller.getBoundingClientRect().top;
    const sentence = [...scroller.querySelectorAll<HTMLElement>("[data-novel-sentence]")]
      .find((item) => item.getBoundingClientRect().bottom > top + 8);
    anchorRef.current = sentence ? { id: sentence.id, offset: sentence.getBoundingClientRect().top - top } : null;
  };

  // 翻译与字号会改变整篇高度，按句子恢复位置，读到中间切换也不会跳回开头。
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const scroller = scrollRef.current;
    if (!anchor || !scroller) return;
    const sentence = document.getElementById(anchor.id);
    if (sentence) scroller.scrollTop += sentence.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top - anchor.offset;
    anchorRef.current = null;
  }, [language, fontSize]);

  const jumpToChapter = (index: number) => {
    document.getElementById(`nr-chapter-${chapters[index].id}`)?.scrollIntoView({ block: "start" });
    setTocOpen(false);
    tocRef.current?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={readerRef}
      className="novel-reader"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nr-title"
      style={{ "--nr-font-size": `${fontSize}px` } as CSSProperties}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          if (tocOpen) {
            setTocOpen(false);
            tocRef.current?.focus();
          } else onExit();
        }
        if (event.key === "Tab") {
          const buttons = [...(readerRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])]
            .filter((button) => button.getClientRects().length > 0);
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className="nr-toolbar">
        <div className="nr-toolbar-start">
          <button ref={exitRef} className="nr-exit" onClick={onExit} title="返回逐句复盘（Esc）">
            <span aria-hidden="true">←</span> 返回复盘
          </button>
          <span className="nr-toolbar-title">全文阅读</span>
        </div>
        <div className="nr-controls">
          <div className="nr-language" role="group" aria-label="正文语言">
            <button aria-pressed={language === "zh"} onClick={() => {
              if (language === "zh") return;
              rememberPosition();
              onLanguageChange("zh");
            }}>中文</button>
            <button aria-pressed={language === "ja"} onClick={() => {
              if (language === "ja") return;
              rememberPosition();
              onLanguageChange("ja");
            }}>日本語</button>
          </div>
          <div className="nr-font-controls" role="group" aria-label="正文字号">
            <button aria-label="缩小字号" disabled={fontSize <= 16} onClick={() => {
              rememberPosition();
              setFontSize((size) => Math.max(16, size - 2));
            }}>A−</button>
            <span aria-live="polite">{fontSize}</span>
            <button aria-label="放大字号" disabled={fontSize >= 24} onClick={() => {
              rememberPosition();
              setFontSize((size) => Math.min(24, size + 2));
            }}>A＋</button>
          </div>
          <button ref={tocRef} className="nr-toc-toggle" aria-expanded={tocOpen} aria-controls="nr-toc" onClick={() => setTocOpen((open) => !open)}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 3.5h12M2 8h12M2 12.5h12" stroke="currentColor" strokeWidth="1.2" /></svg>
            目录
          </button>
        </div>
      </header>
      <div className="nr-progress-track" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>

      {tocOpen && (
        <nav id="nr-toc" className="nr-toc" aria-label="全文目录">
          <header><span>本场目录</span><button aria-label="关闭目录" onClick={() => { setTocOpen(false); tocRef.current?.focus(); }}>×</button></header>
          <p>{chapters.length} 个章节 · 全部连续呈现</p>
          {chapters.map((chapter, index) => (
            <button key={chapter.id} aria-current={activeChapter === index ? "location" : undefined} onClick={() => jumpToChapter(index)}>
              <span>{String(index + 1).padStart(2, "0")}</span><span lang="ja">{chapter.title}</span>
            </button>
          ))}
        </nav>
      )}

      <div ref={scrollRef} className="nr-scroll" tabIndex={0} aria-label="面试全文">
        <article className="nr-paper">
          <header className="nr-book-heading">
            <p className="nr-eyebrow">面试实录 <span>/</span> 全文阅读</p>
            <h1 id="nr-title">{company}</h1>
            <p className="nr-book-meta"><span>{date}</span><span>{round}</span><span>{chapters.length} 章 · {sentenceCount} 句</span></p>
            <p className="nr-reading-note">{language === "zh" ? "中文译文" : "日本語の整理稿"}<span> · </span>按对话顺序，慢慢读完这一场。</p>
            {language === "zh" && missingTranslations > 0 && (
              <p className="nr-translation-note">{missingTranslations} 句暂无中文译文，已标注并保留日语。</p>
            )}
          </header>

          {chapters.map((chapter, chapterIndex) => (
            <section key={chapter.id} id={`nr-chapter-${chapter.id}`} className="nr-chapter" aria-labelledby={`nr-heading-${chapter.id}`}>
              <header>
                <span className="nr-chapter-number">{String(chapterIndex + 1).padStart(2, "0")}</span>
                <h2 id={`nr-heading-${chapter.id}`} lang="ja">{chapter.title}</h2>
              </header>
              {chapter.turns.map((turn) => (
                <div className="nr-turn" key={turn.sentences[0].id}>
                  <p className="nr-speaker">
                    {language === "zh" ? (turn.speaker === "私" ? "我" : "面试官") : (turn.speaker === "私" ? "私" : "面接官")}
                    {turn.uncertain && <span>{language === "zh" ? " · 话者待确认" : " · 話者未確定"}</span>}
                  </p>
                  <p className="nr-paragraph" lang={language === "zh" ? "zh-CN" : "ja"}>
                    {turn.sentences.map((sentence, index) => {
                      const translated = language === "zh" && Boolean(sentence.yaku?.trim());
                      return (
                        <span
                          key={sentence.id}
                          id={`nr-sentence-${sentence.id}`}
                          data-novel-sentence
                          aria-describedby={sentence.notes.some((note) => note.trim()) ? `nr-notes-${sentence.id}` : undefined}
                          lang={translated ? "zh-CN" : "ja"}
                        >
                          {index > 0 ? " " : ""}{translated ? sentence.yaku : plainSei(sentence)}
                          {language === "zh" && !translated && <small className="nr-missing">（暂无译文）</small>}
                        </span>
                      );
                    })}
                  </p>
                  {turn.sentences.filter((sentence) => sentence.notes.some((note) => note.trim())).map((sentence) => (
                    <div key={sentence.id} id={`nr-notes-${sentence.id}`} className="nr-turn-notes" role="note" aria-label={`${language === "zh" ? "补充说明" : "補足注記"} · ${sentence.id}`}>
                      <p className="nr-note-label">{language === "zh" ? "补充说明（非逐字原话）" : "補足注記（逐語録外）"}<span> · {sentence.id}</span></p>
                      {sentence.notes.filter((note) => note.trim()).map((note, index) => <p key={index}>{note}</p>)}
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}

          <footer className="nr-colophon">
            <span className="nr-end-mark" aria-hidden="true">◇</span>
            <p>{sentenceCount > 0 ? "本场全文完" : "这场面试暂时没有可阅读的正文"}</p>
            <span>{sentenceCount} 句对话 · {chapters.length} 个章节</span>
            <div><button onClick={onExit}>返回逐句复盘</button><button onClick={onBack}>选择另一场面试</button></div>
          </footer>
        </article>
      </div>
      <footer className="nr-status">
        <span>{chapters.length > 0 ? `${String(activeChapter + 1).padStart(2, "0")} / ${String(chapters.length).padStart(2, "0")}` : "00 / 00"}<i>{chapters[activeChapter]?.title ?? "全文阅读"}</i></span>
        <span role="progressbar" aria-label="阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>{progress}%</span>
      </footer>
    </div>
  );
}
