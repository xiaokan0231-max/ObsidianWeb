"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarkdownDocument, { headingAnchor } from "./markdown-document";
import {
  formatDate,
  getString,
  getTitle,
  getType,
  noteBasename,
  stripFrontmatter,
  type Note,
} from "@/lib/notes";
import {
  getGroup,
  GROUPS,
  normalizeHeading,
  noteLinks,
  trustLayer,
  typeLabel,
} from "@/lib/memory-atlas-data";

/** 目次用の見出しだけを拾う。**強調** や [[リンク]] の記号は目次では邪魔なので落とす。 */
function headingPlainText(text: string) {
  return text
    .replace(/!?\[\[([^\]]+)\]\]/g, (_, body: string) => {
      const [targetWithHeading, alias] = String(body).split("|");
      return alias || targetWithHeading.split("#")[0];
    })
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/**
 * MarkdownDocument と同じ順序で本文を舐めて見出しを集める。
 * 走査規則（コードフェンス内は無視・冒頭 H1 はノート題名なので捨てる）を
 * 本文レンダラと揃えていないと、目次のリンク先がずれる。
 */
function scanHeadings(content: string) {
  const found: { id: string; level: number; text: string }[] = [];
  let inCode = false;
  let seenTitle = false;
  stripFrontmatter(content).split("\n").forEach((line, index) => {
    if (line.startsWith("```")) { inCode = !inCode; return; }
    if (inCode || line.startsWith(">")) return;
    const heading = line.match(/^(#{1,4})\s+(.+)/);
    if (!heading) return;
    const level = heading[1].length;
    if (level === 1 && !seenTitle) { seenTitle = true; return; }
    if (level > 3) return;
    found.push({ id: headingAnchor(index), level: level === 1 ? 2 : level, text: headingPlainText(heading[2]) });
  });
  return found;
}

export default function NoteDrawer({
  note,
  section,
  allNotes,
  onClose,
  onOpenWiki,
  onOpen,
}: {
  note: Note;
  section: string | null;
  allNotes: Note[];
  onClose: () => void;
  onOpenWiki: (target: string, section?: string) => void;
  onOpen: (note: Note) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const group = getGroup(note.path);
  const trust = trustLayer(note);
  const basename = noteBasename(note.path);
  const backlinks = allNotes.filter((candidate) => noteLinks(candidate).includes(basename));
  const frontmatterEntries = Object.entries(note.frontmatter);
  const headings = useMemo(() => scanHeadings(note.content), [note.content]);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

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
      const wanted = normalizeHeading(section);
      const target = [...(scrollRef.current?.querySelectorAll<HTMLElement>("[data-md-heading]") ?? [])]
        .find((heading) => {
          const actual = heading.dataset.mdHeading ?? "";
          return actual === wanted || actual.startsWith(wanted) || wanted.startsWith(actual);
        });
      target?.scrollIntoView({ block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [note.path, section]);

  // 読書位置：進捗バーと目次のハイライトは同じ1回の計測から作る。
  // 別々に scroll を購読すると、長文でフレームを2回食う。
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const travel = scroller.scrollHeight - scroller.clientHeight;
      setProgress(travel > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / travel)) : 0);
      const marks = [...scroller.querySelectorAll<HTMLElement>("[data-md-heading][id]")];
      // 見出しが画面上端の少し下を通過した時点で「その節を読んでいる」とみなす。
      const threshold = scroller.getBoundingClientRect().top + 140;
      let current = marks[0]?.id ?? null;
      for (const mark of marks) {
        if (mark.getBoundingClientRect().top > threshold) break;
        current = mark.id;
      }
      setActiveHeading(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [note.path]);

  const jumpToHeading = (id: string) => {
    scrollRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="drawer-backdrop drawer-backdrop--full">
      <aside className="note-drawer note-drawer--full" aria-label="记忆详情" aria-modal="true" role="dialog">
        <header className="drawer-header">
          <div><span style={{ color: GROUPS[group].color }}>{GROUPS[group].label}</span><small>{note.path}</small></div>
          <span className="drawer-esc-hint"><kbd>Esc</kbd> 返回</span>
          <button onClick={onClose} aria-label="关闭详情">×</button>
          <i className="drawer-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden />
        </header>
        <div className="drawer-scroll" ref={scrollRef}>
          <div className="drawer-reading-shell">
          {headings.length > 2 && (
            <nav className="doc-toc" aria-label="本文目录">
              <span className="doc-toc-label">目录</span>
              <ol>
                {headings.map((heading) => (
                  <li key={heading.id} className={`doc-toc-item doc-toc-item--h${heading.level}${activeHeading === heading.id ? " is-active" : ""}`}>
                    <button onClick={() => jumpToHeading(heading.id)}>{heading.text}</button>
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
              <span>更新于 {formatDate(note.stat.mtime, true)}</span>
              <span>{Math.round(note.stat.size / 1024 * 10) / 10} KB</span>
              <span>{noteLinks(note).length} 条外链</span>
              <span>{backlinks.length} 条反链</span>
            </div>
            {frontmatterEntries.length > 0 && (
              // 指纹や schema_version は読む妨げにしかならないので、既定では畳む。
              <details className="frontmatter-fold" open={frontmatterEntries.length <= 4}>
                <summary>属性 {frontmatterEntries.length} 项</summary>
                <div className="frontmatter-grid">
                  {frontmatterEntries.map(([key, value]) => (
                    <div key={key}><span>{key}</span><strong>{Array.isArray(value) ? value.join(" · ") : getString(value) || "—"}</strong></div>
                  ))}
                </div>
              </details>
            )}
            <MarkdownDocument content={note.content} onWikiLink={onOpenWiki} />
            {backlinks.length > 0 && (
              <section className="backlinks">
                <span>BACKLINKS · 反向链接</span>
                {backlinks.map((backlink) => (
                  <button key={backlink.path} onClick={() => onOpen(backlink)}><strong>{getTitle(backlink)}</strong><small>{GROUPS[getGroup(backlink.path)].label} ↗</small></button>
                ))}
              </section>
            )}
          </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
