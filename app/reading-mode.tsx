"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ReadingHeading } from "@/lib/reading-document";
import { isTypingTarget } from "@/lib/keyboard";
import type { UiLocale } from "@/lib/ui-locale";
import { useDialogFocus } from "./use-dialog-focus";
import { copySelectionWithoutRuby } from "./ruby-copy";
import { useUiLocale } from "./ui-locale";

/** 阅读层自带的工具栏与面板文案。调用方传入的标题、返回文字等由调用方自己按语言给。 */
const READER_COPY: Record<UiLocale, {
  eyebrow: string;
  back: string;
  end: string;
  fullText: string;
  language: string;
  fontSize: string;
  smaller: string;
  larger: string;
  information: string;
  informationShort: string;
  closeInformation: string;
  toc: string;
  tocLabel: string;
  tocTitle: string;
  closeToc: string;
  tocSummary: (count: number) => string;
  closeReader: string;
  article: string;
  whole: string;
  progress: string;
}> = {
  "zh-CN": {
    eyebrow: "长文阅读",
    back: "返回详情",
    end: "全文完",
    fullText: "全文阅读",
    language: "正文语言",
    fontSize: "正文字号",
    smaller: "缩小字号",
    larger: "放大字号",
    information: "文档信息",
    informationShort: "信息",
    closeInformation: "关闭文档信息",
    toc: "目录",
    tocLabel: "全文目录",
    tocTitle: "本文目录",
    closeToc: "关闭目录",
    tocSummary: (count) => `${count} 个章节 · 全文连续呈现`,
    closeReader: "关闭全文阅读",
    article: "文章全文",
    whole: "全文",
    progress: "阅读进度",
  },
  ja: {
    eyebrow: "長文",
    back: "詳細に戻る",
    end: "以上",
    fullText: "全文表示",
    language: "本文の言語",
    fontSize: "本文の文字サイズ",
    smaller: "文字を小さく",
    larger: "文字を大きく",
    information: "文書情報",
    informationShort: "情報",
    closeInformation: "文書情報を閉じる",
    toc: "目次",
    tocLabel: "全文の目次",
    tocTitle: "目次",
    closeToc: "目次を閉じる",
    tocSummary: (count) => `${count} 章 · 全文を通して表示`,
    closeReader: "全文表示を閉じる",
    article: "記事の全文",
    whole: "全文",
    progress: "読書の進捗",
  },
};

export type ReadingPosition = { anchor: string | null; offset: number; scrollTop: number };
const positions = new Map<string, ReadingPosition>();
const ANCHORS = "[data-reading-anchor], [data-novel-sentence], [data-md-heading]";
/** 正文字号的持久化键。阅读层与原笔记详情页共用：在一处调大，另一处也跟着变。 */
export const FONT_KEY = "reading:font-size";
const STAGE_LINES = "[data-stage-line]";

/**
 * 临场卡的 ←/→：以「视口中线以上最后一句」为当前句，跳到相邻一句并居中。
 * 不记一个下标 state：读者会自己滚动，记下的下标很快就和眼睛看着的那句对不上。
 */
function stepStageLine(scroller: HTMLElement, delta: 1 | -1) {
  const lines = [...scroller.querySelectorAll<HTMLElement>(STAGE_LINES)];
  if (lines.length === 0) return;
  const middle = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
  let current = -1;
  lines.forEach((line, index) => { if (line.getBoundingClientRect().top <= middle) current = index; });
  const target = lines[Math.max(0, Math.min(lines.length - 1, current < 0 && delta > 0 ? 0 : current + delta))];
  lines.forEach((line) => line.removeAttribute("data-stage-current"));
  target.setAttribute("data-stage-current", "");
  // JS 里显式写 smooth 会绕过 CSS 的减弱动效兜底，所以这里自己问一次。
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
}

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

export function readFontSize() {
  try {
    const size = Number(window.localStorage.getItem(FONT_KEY));
    return [16, 18, 20, 22, 24].includes(size) ? size : 18;
  } catch { return 18; }
}

/**
 * 阅读进度与目录高亮，原笔记详情页（NoteDrawer）与阅读层（ReadingMode，含场景内阅读）共用。
 *
 * 为什么不进 React state：以前每帧 setState 一个浮点进度，整个阅读层（头部、目录、属性、反链）
 * 跟着滚动每帧 diff 一次，还要每帧 querySelectorAll 全部标题量位置。现在进度直接写到
 * hostRef 元素的 --reading-progress（0–1）上，由 CSS 画条；需要显示百分数的地方用 onPercent，
 * 只在整数变化时回调。
 * 目录高亮用 IntersectionObserver：判定区是「滚动容器顶端 + threshold」这条线以上的半无限区域，
 * 标题越线时才回调——快速跳转也不会跨过判定区漏掉（区域没有上界）。
 */
export function useReadingProgress(scrollRef: RefObject<HTMLElement | null>, {
  headingIds, hostRef, threshold = 120, emptyProgress = 0, resetKey, onPercent, onSettle,
}: {
  headingIds: readonly string[];
  /** --reading-progress 写在哪个元素上；省略时写在滚动容器上。 */
  hostRef?: RefObject<HTMLElement | null>;
  /** 标题越过「容器顶端 + threshold」这条线，就算正在读这一节。 */
  threshold?: number;
  /** 内容不足一屏、无从滚动时的进度：阅读层视为读完（1），详情页视为未开始（0）。 */
  emptyProgress?: number;
  /** 换了一篇文档时重新订阅。 */
  resetKey?: string;
  onPercent?: (percent: number) => void;
  /** 滚动停下约 160ms 后回调一次（用来记阅读位置，不必每帧记）。 */
  onSettle?: () => void;
}): string | null {
  const [active, setActive] = useState<string | null>(headingIds[0] ?? null);
  const percentChanged = useEffectEvent((percent: number) => onPercent?.(percent));
  const settled = useEffectEvent(() => onSettle?.());

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const host = hostRef?.current ?? scroller;
    let frame = 0;
    let settleTimer = 0;
    let lastPercent = -1;
    const measure = () => {
      frame = 0;
      const range = scroller.scrollHeight - scroller.clientHeight;
      const ratio = range > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / range)) : emptyProgress;
      host.style.setProperty("--reading-progress", ratio.toFixed(4));
      const percent = Math.round(ratio * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        percentChanged(percent);
      }
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    const onScroll = () => {
      schedule();
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => settled(), 160);
    };

    // 标题元素在订阅时取一次；正文重渲染换掉了节点时，调用方给的 headingIds 也会是新数组，这里随之重订阅。
    const ids = headingIds;
    const marks = ids.flatMap((id) => {
      const element = scroller.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      return element ? [{ id, element }] : [];
    });
    const passed = new Set<Element>();
    const pick = () => {
      let current = ids[0] ?? null;
      for (const mark of marks) if (passed.has(mark.element)) current = mark.id;
      setActive(current);
    };
    let observer: IntersectionObserver | null = null;
    let observedHeight = -1;
    const observe = () => {
      if (!marks.length || typeof IntersectionObserver === "undefined") { pick(); return; }
      if (scroller.clientHeight === observedHeight) return;
      observedHeight = scroller.clientHeight;
      observer?.disconnect();
      passed.clear();
      const bottom = Math.max(0, scroller.clientHeight - threshold);
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) passed.add(entry.target);
          else passed.delete(entry.target);
        }
        pick();
      }, { root: scroller, rootMargin: `100000px 0px -${bottom}px 0px` });
      for (const mark of marks) observer.observe(mark.element);
    };

    const resize = new ResizeObserver(() => { observe(); schedule(); });
    resize.observe(scroller);
    if (scroller.firstElementChild) resize.observe(scroller.firstElementChild);
    observe();
    schedule();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      resize.disconnect();
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [scrollRef, hostRef, headingIds, threshold, emptyProgress, resetKey]);

  return active;
}

/** 阅读工具与文档内容分离；语言选择只由真实存在的对应版本提供。 */
export default function ReadingMode({
  documentKey, title, eyebrow: eyebrowProp, metadata = [], headings = [], children,
  onClose, backLabel: backLabelProp, presentation = "page", languageSwitch, headerNote, information,
  initialHeadingId, initialPosition, endLabel: endLabelProp, endNote, footerActions,
}: {
  documentKey: string;
  title: string;
  eyebrow?: string;
  metadata?: string[];
  headings?: ReadingHeading[];
  children: ReactNode;
  onClose: (position: ReadingPosition) => void;
  backLabel?: string;
  /** stage：临场卡（更宽的纸、放大的台词、←/→ 在台词间跳）。 */
  presentation?: "page" | "scene" | "stage";
  languageSwitch?: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void };
  headerNote?: ReactNode;
  information?: ReactNode;
  initialHeadingId?: string;
  initialPosition?: ReadingPosition;
  endLabel?: string;
  endNote?: string;
  footerActions?: ReactNode;
}) {
  const copy = READER_COPY[useUiLocale().locale];
  // 不传时的默认文字跟界面语言走；默认参数里取不到 hook，所以放到这里补。
  const eyebrow = eyebrowProp ?? copy.eyebrow;
  const backLabel = backLabelProp ?? copy.back;
  const endLabel = endLabelProp ?? copy.end;
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
  // 按 id 内容而不是数组引用记忆：调用方不传 headings（默认参数每次是新数组）或每次现算时，
  // 进度百分数一变就重渲染，若按引用比较会每次都拆掉重建 IntersectionObserver。
  // 键里带上标题文字：章节内容换了（节点随之重建）时仍会重新订阅。
  const headingKey = headings.map((heading) => `${heading.id}\t${heading.text}`).join("\n");
  const headingIds = useMemo(
    () => (headingKey ? headingKey.split("\n").map((line) => line.slice(0, line.indexOf("\t"))) : []),
    [headingKey],
  );
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

  const activeHeading = useReadingProgress(scrollRef, {
    // 切换正文语言会换掉整段正文的节点，按语言重新订阅标题。
    headingIds, hostRef: readerRef, emptyProgress: 1, resetKey: `${documentKey}\n${languageSwitch?.value ?? ""}`,
    onPercent: setProgress,
    onSettle: () => { if (scrollRef.current) positions.set(documentKey, captureReadingPosition(scrollRef.current)); },
  });

  // 工具栏会随语言切换、窄屏换行改变高度；弹出的目录与信息面板按它定位。
  useEffect(() => {
    const toolbar = toolbarRef.current;
    const reader = readerRef.current;
    if (!toolbar || !reader) return;
    const observer = new ResizeObserver(() => {
      reader.style.setProperty("--reader-toolbar-height", `${toolbar.offsetHeight}px`);
    });
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

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
    <div ref={readerRef} className={`novel-reader reading-mode${hasLanguages ? " has-language-switch" : ""}${presentation === "scene" ? " scene-reader" : ""}${presentation === "stage" ? " stage-reader" : ""}${sceneHost ? " scene-reader--embedded" : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}
      style={{ "--nr-font-size": `${fontSize}px` } as CSSProperties}
      onCopy={copySelectionWithoutRuby}
      onKeyDown={(event) => {
        // 阅读器位于原详情或准备页之上，快捷键不能穿透并关闭下面那一层。
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); if (menu) closeMenu(); else close(); }
        else if (presentation === "stage" && !menu && (event.key === "ArrowRight" || event.key === "ArrowLeft")
          && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target) && scrollRef.current) {
          event.preventDefault();
          stepStageLine(scrollRef.current, event.key === "ArrowRight" ? 1 : -1);
        }
      }}>
      <header ref={toolbarRef} className="nr-toolbar">
        <div className="nr-toolbar-start">
          <button className="nr-exit" onClick={close}><span aria-hidden="true">←</span>{backLabel}</button>
          <span className="nr-toolbar-title">{presentation === "stage" ? eyebrow : copy.fullText}</span>
        </div>
        <div className="nr-controls">
          {hasLanguages && languageSwitch && <div className="nr-language" role="group" aria-label={copy.language}>
            {languageSwitch.options.map((option) => <button key={option.value} aria-pressed={languageSwitch.value === option.value} onClick={() => {
              if (languageSwitch.value === option.value) return;
              remember();
              languageSwitch.onChange(option.value);
            }}>{option.label}</button>)}
          </div>}
          <div className="nr-font-controls" role="group" aria-label={copy.fontSize}>
            <button aria-label={copy.smaller} disabled={fontSize <= 16} onClick={() => resizeFont(-2)}>A−</button>
            <span aria-live="polite">{fontSize}</span>
            <button aria-label={copy.larger} disabled={fontSize >= 24} onClick={() => resizeFont(2)}>A＋</button>
          </div>
          {information && <button ref={infoRef} className="reader-info-toggle" aria-label={copy.information} aria-expanded={menu === "info"} aria-controls={`${id}-info`} onClick={() => setMenu(menu === "info" ? null : "info")}><span aria-hidden="true">i</span><span>{copy.informationShort}</span></button>}
          {headings.length > 0 && <button ref={tocRef} className="nr-toc-toggle" aria-expanded={menu === "toc"} aria-controls={`${id}-toc`} onClick={() => setMenu(menu === "toc" ? null : "toc")}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 3.5h12M2 8h12M2 12.5h12" stroke="currentColor" strokeWidth="1.2" /></svg>{copy.toc}
          </button>}
          {presentation === "scene" && <button type="button" className="scene-reader-close" aria-label={copy.closeReader} title={backLabel} onClick={close}>×</button>}
        </div>
      </header>
      <div className="nr-progress-track" aria-hidden="true"><i /></div>
      {menu === "toc" && <nav id={`${id}-toc`} className="nr-toc reader-menu" aria-label={copy.tocLabel}>
        <header><span>{copy.tocTitle}</span><button aria-label={copy.closeToc} onClick={closeMenu}>×</button></header>
        <p>{copy.tocSummary(headings.length)}</p>
        {headings.map((heading, index) => <button key={heading.id} data-level={heading.level ?? 2} aria-current={activeHeading === heading.id ? "location" : undefined} onClick={() => {
          scrollRef.current?.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`)?.scrollIntoView({ block: "start" });
          closeMenu();
        }}><span>{String(index + 1).padStart(2, "0")}</span><span lang={heading.lang}>{heading.text}</span></button>)}
      </nav>}
      {menu === "info" && <aside id={`${id}-info`} className="nr-toc reader-menu reader-information" aria-label={copy.information}>
        <header><span>{copy.information}</span><button aria-label={copy.closeInformation} onClick={closeMenu}>×</button></header>{information}
      </aside>}
      <div ref={scrollRef} className="nr-scroll" tabIndex={0} aria-label={copy.article} onClick={() => { if (menu) setMenu(null); }}>
        <article className="nr-paper">
          <header className="nr-book-heading">
            <p className="nr-eyebrow">{eyebrow}{presentation !== "stage" && <><span>/</span>{copy.fullText}</>}</p>
            <h1 id={`${id}-title`}>{title}</h1>
            {metadata.length > 0 && <p className="nr-book-meta">{metadata.filter(Boolean).map((value, index) => <span key={index}>{value}</span>)}</p>}
            {headerNote}
          </header>
          {children}
          <footer className="nr-colophon"><span className="nr-end-mark" aria-hidden="true">◇</span><p>{endLabel}</p>{endNote && <span>{endNote}</span>}<div><button onClick={close}>{backLabel}</button>{footerActions}</div></footer>
        </article>
      </div>
      <footer className="nr-status"><span>{headings.length > 0 ? `${String(currentIndex + 1).padStart(2, "0")} / ${String(headings.length).padStart(2, "0")}` : copy.whole}<i>{headings[currentIndex]?.text ?? title}</i></span><span role="progressbar" aria-label={copy.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>{progress}%</span></footer>
    </div>, sceneHost ?? document.body,
  );
}
