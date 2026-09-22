"use client";

import { useMemo } from "react";
import { formatDate, getString, getTitle, getType, type Note } from "@/lib/notes";
import { normalizeHeading, trustLayer, typeLabel } from "@/lib/memory-atlas-data";
import { headingPlainText, scanReadingHeadings } from "@/lib/reading-document";
import MarkdownDocument from "./markdown-document";
import ReadingMode, { type ReadingPosition } from "./reading-mode";

export default function NoteReader({ note, section, onClose, onOpenWiki, backlinks = [], onOpen, initialPosition, scene }: {
  note: Note;
  section?: string | null;
  onClose: (position: ReadingPosition) => void;
  onOpenWiki: (target: string, section?: string) => void;
  backlinks?: Note[];
  onOpen?: (note: Note) => void;
  initialPosition?: ReadingPosition;
  scene?: "graph" | "timeline";
}) {
  const headings = useMemo(() => scanReadingHeadings(note.content), [note.content]);
  const wanted = section ? normalizeHeading(section) : null;
  const heading = wanted ? headings.find((item) => {
    const actual = normalizeHeading(item.text);
    return actual === wanted || actual.startsWith(wanted) || wanted.startsWith(actual);
  }) : undefined;
  const trust = trustLayer(note);
  return <ReadingMode key={`${note.path}#${section ?? ""}`} documentKey={`note:${note.path}`}
    presentation={scene ? "scene" : "page"}
    backLabel={scene === "graph" ? "返回星图" : scene === "timeline" ? "返回时间线" : "返回详情"}
    title={headingPlainText(getTitle(note))} eyebrow={scene === "graph" ? "记忆星图" : scene === "timeline" ? "时之航道" : typeLabel(getType(note))}
    metadata={[trust.label, `更新于 ${formatDate(note.stat.mtime, true)}`]}
    headerNote={scene ? <p className="nr-reading-note">场景内阅读<span> / </span>关闭全文，继续探索。</p> : undefined}
    headings={headings} initialHeadingId={heading?.id} initialPosition={initialPosition} onClose={onClose}
    information={<>
      <p className="reader-source-path">{note.path}</p>
      <dl>{Object.entries(note.frontmatter).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(" · ") : getString(value) || "未填写"}</dd></div>)}</dl>
      {backlinks.length > 0 && <section className="reader-backlinks"><h3>提到这篇文章</h3>{backlinks.map((backlink) => <button key={backlink.path} onClick={() => onOpen?.(backlink)}>{headingPlainText(getTitle(backlink))}<span aria-hidden="true">↗</span></button>)}</section>}
    </>}>
    <div className="reader-prose"><MarkdownDocument content={note.content} onWikiLink={onOpenWiki} reading /></div>
  </ReadingMode>;
}
