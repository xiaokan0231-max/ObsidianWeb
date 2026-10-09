"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import MarkdownDocument from "./markdown-document";
import NoteReader, { SnippetText } from "./note-reader";
import {
  captureReadingPosition,
  FONT_KEY,
  readFontSize,
  restoreReadingPosition,
  useReadingProgress,
  type ReadingPosition,
} from "./reading-mode";
import { scanReadingHeadings } from "@/lib/reading-document";
import { NOTE_EXIT_MS } from "@/lib/exit-transition";
import { resolveNoteLink } from "@/lib/wiki-target";
import type { UiLocale } from "@/lib/ui-locale";
import {
  formatDate,
  getString,
  getTitle,
  getType,
  noteBasename,
  type Note,
} from "@/lib/notes";
import {
  backlinkContext,
  findHeadingBySection,
  getGroup,
  GROUPS,
  noteBacklinks,
  noteLinks,
  noteOutlinks,
  trustLayer,
  typeLabel,
} from "@/lib/memory-atlas-data";
import { useDialogFocus } from "./use-dialog-focus";
import { useUiLocale } from "./ui-locale";

const DRAWER_COPY: Record<UiLocale, {
  dialog: string;
  readerMode: string;
  escBack: string;
  close: string;
  fontSize: string;
  smaller: string;
  larger: string;
  toc: string;
  tocLabel: string;
  updated: (date: string) => string;
  outlinks: (count: number) => string;
  backlinks: (count: number) => string;
  properties: (count: number) => string;
  backlinksTitle: string;
  outlinksTitle: string;
}> = {
  "zh-CN": {
    dialog: "记忆详情", readerMode: "阅读模式", escBack: "返回", close: "关闭详情",
    fontSize: "正文字号", smaller: "缩小字号", larger: "放大字号", toc: "目录", tocLabel: "本文目录",
    updated: (date) => `更新于 ${date}`, outlinks: (count) => `${count} 条外链`, backlinks: (count) => `${count} 条反链`,
    properties: (count) => `属性 ${count} 项`, backlinksTitle: "反向链接", outlinksTitle: "本文链接到",
  },
  ja: {
    dialog: "ノート詳細", readerMode: "読書モード", escBack: "戻る", close: "詳細を閉じる",
    fontSize: "本文の文字サイズ", smaller: "文字を小さく", larger: "文字を大きく", toc: "目次", tocLabel: "本文の目次",
    updated: (date) => `${date} 更新`, outlinks: (count) => `発リンク ${count} 件`, backlinks: (count) => `被リンク ${count} 件`,
    properties: (count) => `プロパティ ${count} 件`, backlinksTitle: "被リンク", outlinksTitle: "このノートのリンク先",
  },
};

// 详情页正文比阅读层小一档：阅读层是 688px 净宽的衬线书页（默认 18），
// 详情页两侧还有目录与属性栏、正文是无衬线（默认 16）。字号键共用，所以在任一处调大，两处一起变大。
const DRAWER_FONT_OFFSET = 2;

export default function NoteDrawer({
  note,
  section,
  allNotes,
  onClose,
  onOpenWiki,
  onOpen,
  wikiIndexComplete = false,
  closing = false,
}: {
  note: Note;
  section: string | null;
  allNotes: Note[];
  /** 外壳正在播退场（lib/exit-transition.ts）：只换样式，卸载仍由外壳在计时结束后做。 */
  closing?: boolean;
  onClose: () => void;
  onOpenWiki: (target: string, section?: string) => void;
  onOpen: (note: Note) => void;
  /**
   * allNotes 是不是全库。只载入了岗位、日程等局部范围时，查不到不等于不存在，
   * 不能标成「找不到」，这时双链照旧按普通链接画（点击仍由外壳按需补读）。
   */
  wikiIndexComplete?: boolean;
}) {
  const { locale } = useUiLocale();
  const copy = DRAWER_COPY[locale];
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef);
  const group = getGroup(note.path);
  const trust = trustLayer(note);
  const basename = noteBasename(note.path);
  const backlinks = useMemo(() => noteBacklinks(allNotes, note), [allNotes, note]);
  const outlinks = useMemo(() => noteOutlinks(allNotes, note), [allNotes, note]);
  const frontmatterEntries = Object.entries(note.frontmatter);
  const headings = useMemo(() => scanReadingHeadings(note.content), [note.content]);
  const headingIds = useMemo(() => headings.map((heading) => heading.id), [headings]);
  const resolveWiki = useCallback(
    (target: string, heading?: string) => resolveNoteLink(allNotes, target, heading)?.note ?? null,
    [allNotes],
  );
  const [readerOpen, setReaderOpen] = useState(false);
  const [readerPosition, setReaderPosition] = useState<{ path: string; position: ReadingPosition } | null>(null);
  const [readingSize, setReadingSize] = useState(readFontSize);
  const fontSize = readingSize - DRAWER_FONT_OFFSET;
  const fontAnchorRef = useRef<ReadingPosition | null>(null);

  // 字号变了行会重排；在绘制前按调整前看着的那一段把位置拉回来（与阅读层同一做法），
  // 不用 requestAnimationFrame——那样会先闪一帧错位的内容。
  useLayoutEffect(() => {
    if (scrollRef.current && fontAnchorRef.current) {
      restoreReadingPosition(scrollRef.current, fontAnchorRef.current);
      fontAnchorRef.current = null;
    }
  }, [readingSize]);

  // 在详情里点双链换到另一篇时，别停在上一篇的滚动位置（下面的章节定位、阅读层位置恢复会再覆盖它）。
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [note.path]);

  useLayoutEffect(() => {
    if (!readerOpen && readerPosition?.path === note.path && scrollRef.current) {
      restoreReadingPosition(scrollRef.current, readerPosition.position);
    }
  }, [readerOpen, note.path, readerPosition]);

  // 全屏で読むので背面はスクロールさせない。閉じたときに元の位置へ戻す。
  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
    };
  }, []);

  useEffect(() => {
    if (!section) return;
    const timer = window.setTimeout(() => {
      // 正文的 h4 以下不进目录，但 ?section= 也可能指向它们，所以候选取正文里全部标题。
      const candidates = [...(scrollRef.current?.querySelectorAll<HTMLElement>("[data-md-heading][id]") ?? [])]
        .map((element) => ({ id: element.id, text: element.dataset.mdHeading ?? "", element }));
      findHeadingBySection(candidates, section)?.element.scrollIntoView({ block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [note.path, section]);

  const activeHeading = useReadingProgress(scrollRef, {
    headingIds, hostRef: dialogRef, threshold: 140, resetKey: note.path,
  });

  const jumpToHeading = (id: string) => {
    scrollRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const resizeFont = (delta: number) => {
    const next = Math.min(24, Math.max(16, readingSize + delta));
    if (next === readingSize) return;
    if (scrollRef.current) fontAnchorRef.current = captureReadingPosition(scrollRef.current);
    setReadingSize(next);
    try { window.localStorage.setItem(FONT_KEY, String(next)); } catch { /* 禁用存储时仍可调字号。 */ }
  };

  const hasToc = headings.length > 2;
  const hasAside = frontmatterEntries.length > 0 || backlinks.length > 0 || outlinks.length > 0;

  return (
    // 退场时长经内联变量交给 CSS，和外壳的计时器读同一个常量。
    <div className="drawer-backdrop drawer-backdrop--full" inert={readerOpen} aria-hidden={readerOpen || undefined}
      data-state={closing ? "closing" : "open"} style={{ "--note-exit-duration": `${NOTE_EXIT_MS}ms` } as CSSProperties}>
      <aside ref={dialogRef} tabIndex={-1} className="note-drawer note-drawer--full" aria-label={copy.dialog} aria-modal="true" role="dialog"
        style={{ "--drawer-font-size": `${fontSize}px` } as CSSProperties}>
        <header className="drawer-header">
          <div><span className="accent-ink" style={{ "--accent": GROUPS[group].cssVar } as CSSProperties}>{GROUPS[group].label}</span><small>{note.path}</small></div>
          <div className="drawer-font-controls" role="group" aria-label={copy.fontSize}>
            <button type="button" aria-label={copy.smaller} disabled={readingSize <= 16} onClick={() => resizeFont(-2)}>A−</button>
            <output aria-live="polite">{fontSize}</output>
            <button type="button" aria-label={copy.larger} disabled={readingSize >= 24} onClick={() => resizeFont(2)}>A＋</button>
          </div>
          <button className="reader-entry" onClick={() => {
            if (scrollRef.current) setReaderPosition({ path: note.path, position: captureReadingPosition(scrollRef.current) });
            setReaderOpen(true);
          }}>{copy.readerMode}</button>
          <span className="drawer-esc-hint"><kbd>Esc</kbd> {copy.escBack}</span>
          <button onClick={onClose} aria-label={copy.close}>×</button>
          <i className="drawer-progress" aria-hidden />
        </header>
        <div className="drawer-scroll" ref={scrollRef}>
          {/* 换篇时整块重挂：入场动效对新的一篇重放，旧篇的目录高亮也不会残留。 */}
          <div key={note.path} className={`drawer-reading-shell${hasToc ? " has-toc" : ""}${hasAside ? " has-aside" : ""}`}>
            {hasToc && (
              <nav className="doc-toc" aria-label={copy.tocLabel}>
                <span className="doc-toc-label">{copy.toc}</span>
                <ol>
                  {headings.map((heading) => (
                    <li key={heading.id} className={`doc-toc-item doc-toc-item--h${heading.level}${activeHeading === heading.id ? " is-active" : ""}`}>
                      <button onClick={() => jumpToHeading(heading.id)} aria-current={activeHeading === heading.id ? "location" : undefined}>{heading.text}</button>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            <div className="drawer-reading">
              <div className="drawer-title-row">
                <span className={`trust-badge ${trust.className}`}>{trust.label}</span>
                <span>{typeLabel(getType(note))}</span>
              </div>
              <h1>{getTitle(note)}</h1>
              <div className="drawer-meta">
                <span>{copy.updated(formatDate(note.stat.mtime, true))}</span>
                <span>{Math.round(note.stat.size / 1024 * 10) / 10} KB</span>
                <span>{copy.outlinks(noteLinks(note).length)}</span>
                <span>{copy.backlinks(backlinks.length)}</span>
              </div>
              <MarkdownDocument content={note.content} onWikiLink={onOpenWiki} resolveWiki={wikiIndexComplete ? resolveWiki : undefined} />
            </div>
            {hasAside && (
              <div className="drawer-aside">
                {frontmatterEntries.length > 0 && (
                  // 指纹や schema_version は読む妨げにしかならないので、項目が多いときは畳む。
                  <details className="frontmatter-fold" open={frontmatterEntries.length <= 6}>
                    <summary>{copy.properties(frontmatterEntries.length)}</summary>
                    <div className="frontmatter-grid">
                      {frontmatterEntries.map(([key, value]) => (
                        <div key={key}><span>{key}</span><strong>{Array.isArray(value) ? value.join(" · ") : getString(value) || "—"}</strong></div>
                      ))}
                    </div>
                  </details>
                )}
                {backlinks.length > 0 && (
                  <section className="backlinks" aria-label={copy.backlinksTitle}>
                    <span>{copy.backlinksTitle} · {backlinks.length}</span>
                    {backlinks.map((backlink) => {
                      const context = backlinkContext(backlink, basename);
                      return (
                        <button key={backlink.path} onClick={() => onOpen(backlink)}>
                          <span className="backlinks-head"><strong>{getTitle(backlink)}</strong><small>{GROUPS[getGroup(backlink.path)].label} ↗</small></span>
                          {context && <span className="backlinks-context"><SnippetText parts={context} /></span>}
                        </button>
                      );
                    })}
                  </section>
                )}
                {outlinks.length > 0 && (
                  <section className="backlinks backlinks--out" aria-label={copy.outlinksTitle}>
                    <span>{copy.outlinksTitle} · {outlinks.length}</span>
                    {outlinks.map((linked) => (
                      <button key={linked.path} onClick={() => onOpen(linked)}>
                        <span className="backlinks-head"><strong>{getTitle(linked)}</strong><small>{GROUPS[getGroup(linked.path)].label} ↗</small></span>
                      </button>
                    ))}
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
      {readerOpen && <NoteReader note={note} section={section} backlinks={backlinks} onOpen={onOpen} onOpenWiki={onOpenWiki} allNotes={allNotes} wikiIndexComplete={wikiIndexComplete}
        initialPosition={readerPosition?.path === note.path ? readerPosition.position : undefined}
        onClose={(position) => {
          setReaderPosition({ path: note.path, position });
          setReaderOpen(false);
          // 阅读层里可能调过字号（同一个持久化键），回来时跟上。
          setReadingSize(readFontSize());
        }} />}
    </div>
  );
}
