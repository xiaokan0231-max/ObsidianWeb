"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ReadingHeading } from "@/lib/reading-document";
import { useDialogFocus } from "./use-dialog-focus";
import { copySelectionWithoutRuby } from "./ruby-copy";

export type ReadingPosition = { anchor: string | null; offset: number; scrollTop: number };
const positions = new Map<string, ReadingPosition>();
const ANCHORS = "[data-reading-anchor], [data-novel-sentence], [data-md-heading]";
const FONT_KEY = "reading:font-size";

export function captureReadingPosition(scroller: HTMLElement): ReadingPosition {
  const top = scroller.getBoundingClientRect().top;
  const anchor = [...scroller.querySelectorAll<HTMLElement>(ANCHORS)]
    .find((element) => element.getBoundingClientRect().bottom > top + 8);
  return {
    anchor: anchor ? anchor.dataset.readingAnchor || anchor.id : null,
    offset: anchor ? anchor.getBoundingClientRect().top - top : 0,
    scrollTop: scroller.scrollTop,
  };
}

export function restoreReadingPosition(scroller: HTMLElement, position: ReadingPosition) {
  const anchor = position.anchor ? [...scroller.querySelectorAll<HTMLElement>(ANCHORS)]
    .find((element) => (element.dataset.readingAnchor || element.id) === position.anchor) : null;
  if (anchor) scroller.scrollTop += anchor.getBoundingClientRect().top
    - scroller.getBoundingClientRect().top - position.offset;
  else scroller.scrollTop = position.scrollTop;
}

function readFontSize() {
  try {
    const size = Number(window.localStorage.getItem(FONT_KEY));
    return [16, 18, 20, 22, 24].includes(size) ? size : 18;
  } catch { return 18; }
}

/** 阅读工具与文档内容分离；语言选择只由真实存在的对应版本提供。 */
export default function ReadingMode({
  documentKey, title, eyebrow = "长文阅读", metadata = [], headings = [], children,
  onClose, backLabel = "返回详情", presentation = "page", languageSwitch, headerNote, information,
  initialHeadingId, initialPosition, endLabel = "全文完", endNote, footerActions,
}: {
  documentKey: string;
  title: string;
  eyebrow?: string;
  metadata?: string[];
  headings?: ReadingHeading[];
  children: ReactNode;
  onClose: (position: ReadingPosition) => void;
  backLabel?: string;
  presentation?: "page" | "scene";
  languageSwitch?: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void };
  headerNote?: ReactNode;
  information?: ReactNode;
  initialHeadingId?: string;
  initialPosition?: ReadingPosition;
  endLabel?: string;
  endNote?: string;
  footerActions?: ReactNode;
}) {
  const readerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLElement>(null);
  const tocRef = useRef<HTMLButtonElement>(null);
  const infoRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<ReadingPosition | null>(null);
  const initial = useRef({ initialHeadingId, initialPosition });
  // Fullscreen API 只显示舞台的 DOM 子树，阅读层必须属于这个子树，而不是 body。
  const [sceneHost] = useState(() => presentation === "scene" && typeof document !== "undefined"
    ? document.querySelector<HTMLElement>(".space-graph-stage")
    : null);
  const [fontSize, setFontSize] = useState(readFontSize);
  const [menu, setMenu] = useState<"toc" | "info" | null>(null);
  const [progress, setProgress] = useState(0);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const id = useId();
  const hasLanguages = Boolean(languageSwitch && languageSwitch.options.length > 1);

  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    const shell = document.querySelector<HTMLElement>(".app-shell");
    const wasInert = shell?.inert ?? false;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (shell && !sceneHost) shell.inert = true;
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
      if (shell && !sceneHost) shell.inert = wasInert;
    };
  }, [sceneHost]);
  useDialogFocus(readerRef, Boolean(sceneHost));

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const { initialHeadingId: headingId, initialPosition: position } = initial.current;
    const cached = positions.get(documentKey);
    if (position) restoreReadingPosition(scroller, position);
    else if (headingId) scroller.querySelector<HTMLElement>(`#${CSS.escape(headingId)}`)?.scrollIntoView({ block: "start" });
    else if (cached) restoreReadingPosition(scroller, cached);
    // 每篇位置分别保存，正文内打开关联笔记再返回时不会从头开始。
    return () => { positions.set(documentKey, captureReadingPosition(scroller)); };
  }, [documentKey]);

  useLayoutEffect(() => {
    if (scrollRef.current && anchorRef.current) {
      restoreReadingPosition(scrollRef.current, anchorRef.current);
      anchorRef.current = null;
    }
  }, [fontSize, languageSwitch?.value]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const range = scroller.scrollHeight - scroller.clientHeight;
      setProgress(range > 0 ? Math.round(Math.max(0, Math.min(1, scroller.scrollTop / range)) * 100) : 100);
      const threshold = scroller.getBoundingClientRect().top + 120;
      let current = headings[0]?.id ?? null;
      for (const heading of headings) {
        const element = scroller.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`);
        if (element && element.getBoundingClientRect().top <= threshold) current = heading.id;
      }
      setActiveHeading(current);
      positions.set(documentKey, captureReadingPosition(scroller));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    const observer = new ResizeObserver(() => {
      if (toolbarRef.current && readerRef.current) {
        readerRef.current.style.setProperty("--reader-toolbar-height", `${toolbarRef.current.offsetHeight}px`);
      }
      schedule();
    });
    if (toolbarRef.current) observer.observe(toolbarRef.current);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    observer.observe(scroller);
    schedule();
    scroller.addEventListener("scroll", schedule, { passive: true });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
    };
  }, [documentKey, headings]);

  const close = () => {
    const position = scrollRef.current ? captureReadingPosition(scrollRef.current) : { anchor: null, offset: 0, scrollTop: 0 };
    positions.set(documentKey, position);
    onClose(position);
  };
  const remember = () => { if (scrollRef.current) anchorRef.current = captureReadingPosition(scrollRef.current); };
  const resizeFont = (delta: number) => {
    remember();
    const size = Math.min(24, Math.max(16, fontSize + delta));
    setFontSize(size);
    try { window.localStorage.setItem(FONT_KEY, String(size)); } catch { /* 禁用存储时仍可调字号。 */ }
  };
  const closeMenu = () => {
    (menu === "toc" ? tocRef : infoRef).current?.focus({ preventScroll: true });
    setMenu(null);
  };
  const currentIndex = Math.max(0, headings.findIndex((heading) => heading.id === activeHeading));

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={readerRef} className={`novel-reader reading-mode${hasLanguages ? " has-language-switch" : ""}${presentation === "scene" ? " scene-reader" : ""}${sceneHost ? " scene-reader--embedded" : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}
      style={{ "--nr-font-size": `${fontSize}px` } as CSSProperties}
      onCopy={copySelectionWithoutRuby}
      onKeyDown={(event) => {
        // 阅读器位于原详情或准备页之上，快捷键不能穿透并关闭下面那一层。
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); if (menu) closeMenu(); else close(); }
      }}>
      <header ref={toolbarRef} className="nr-toolbar">
        <div className="nr-toolbar-start">
          <button className="nr-exit" onClick={close}><span aria-hidden="true">←</span>{backLabel}</button>
          <span className="nr-toolbar-title">全文阅读</span>
        </div>
        <div className="nr-controls">
          {hasLanguages && languageSwitch && <div className="nr-language" role="group" aria-label="正文语言">
            {languageSwitch.options.map((option) => <button key={option.value} aria-pressed={languageSwitch.value === option.value} onClick={() => {
              if (languageSwitch.value === option.value) return;
              remember();
              languageSwitch.onChange(option.value);
            }}>{option.label}</button>)}
          </div>}
          <div className="nr-font-controls" role="group" aria-label="正文字号">
            <button aria-label="缩小字号" disabled={fontSize <= 16} onClick={() => resizeFont(-2)}>A−</button>
            <span aria-live="polite">{fontSize}</span>
            <button aria-label="放大字号" disabled={fontSize >= 24} onClick={() => resizeFont(2)}>A＋</button>
          </div>
          {information && <button ref={infoRef} className="reader-info-toggle" aria-label="文档信息" aria-expanded={menu === "info"} aria-controls={`${id}-info`} onClick={() => setMenu(menu === "info" ? null : "info")}><span aria-hidden="true">i</span><span>信息</span></button>}
          {headings.length > 0 && <button ref={tocRef} className="nr-toc-toggle" aria-expanded={menu === "toc"} aria-controls={`${id}-toc`} onClick={() => setMenu(menu === "toc" ? null : "toc")}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 3.5h12M2 8h12M2 12.5h12" stroke="currentColor" strokeWidth="1.2" /></svg>目录
          </button>}
          {presentation === "scene" && <button type="button" className="scene-reader-close" aria-label="关闭全文阅读" title={backLabel} onClick={close}>×</button>}
        </div>
      </header>
      <div className="nr-progress-track" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
      {menu === "toc" && <nav id={`${id}-toc`} className="nr-toc reader-menu" aria-label="全文目录">
        <header><span>本文目录</span><button aria-label="关闭目录" onClick={closeMenu}>×</button></header>
        <p>{headings.length} 个章节 · 全文连续呈现</p>
        {headings.map((heading, index) => <button key={heading.id} data-level={heading.level ?? 2} aria-current={activeHeading === heading.id ? "location" : undefined} onClick={() => {
          scrollRef.current?.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`)?.scrollIntoView({ block: "start" });
          closeMenu();
        }}><span>{String(index + 1).padStart(2, "0")}</span><span lang={heading.lang}>{heading.text}</span></button>)}
      </nav>}
      {menu === "info" && <aside id={`${id}-info`} className="nr-toc reader-menu reader-information" aria-label="文档信息">
        <header><span>文档信息</span><button aria-label="关闭文档信息" onClick={closeMenu}>×</button></header>{information}
      </aside>}
      <div ref={scrollRef} className="nr-scroll" tabIndex={0} aria-label="文章全文" onClick={() => { if (menu) setMenu(null); }}>
        <article className="nr-paper">
          <header className="nr-book-heading">
            <p className="nr-eyebrow">{eyebrow}<span>/</span>全文阅读</p>
            <h1 id={`${id}-title`}>{title}</h1>
            {metadata.length > 0 && <p className="nr-book-meta">{metadata.filter(Boolean).map((value, index) => <span key={index}>{value}</span>)}</p>}
            {headerNote}
          </header>
          {children}
          <footer className="nr-colophon"><span className="nr-end-mark" aria-hidden="true">◇</span><p>{endLabel}</p>{endNote && <span>{endNote}</span>}<div><button onClick={close}>{backLabel}</button>{footerActions}</div></footer>
        </article>
      </div>
      <footer className="nr-status"><span>{headings.length > 0 ? `${String(currentIndex + 1).padStart(2, "0")} / ${String(headings.length).padStart(2, "0")}` : "全文"}<i>{headings[currentIndex]?.text ?? title}</i></span><span role="progressbar" aria-label="阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>{progress}%</span></footer>
    </div>, sceneHost ?? document.body,
  );
}
