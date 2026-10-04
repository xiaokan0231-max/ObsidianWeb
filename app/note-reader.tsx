"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { formatDate, getString, getTitle, getType, noteBasename, type Note } from "@/lib/notes";
import { backlinkContext, findHeadingBySection, getGroup, GROUPS, noteOutlinks, trustLayer, typeLabel } from "@/lib/memory-atlas-data";
import { headingPlainText, scanReadingHeadings } from "@/lib/reading-document";
import { resolveNoteLink } from "@/lib/wiki-target";
import type { SnippetPart } from "@/lib/search-snippet";
import type { UiLocale } from "@/lib/ui-locale";
import MarkdownDocument from "./markdown-document";
import ReadingMode, { type ReadingPosition } from "./reading-mode";
import { useUiLocale } from "./ui-locale";

const RELATED_PREVIEW = 9;

const RELATED_COPY: Record<UiLocale, {
  label: string;
  mentionedBy: (count: number) => string;
  linksTo: (count: number) => string;
  showAll: (count: number) => string;
  collapse: string;
}> = {
  "zh-CN": {
    label: "相关笔记",
    mentionedBy: (count) => `提到这篇的 ${count} 篇`,
    linksTo: (count) => `本文链接到的 ${count} 篇`,
    showAll: (count) => `显示全部 ${count} 篇`,
    collapse: "收起",
  },
  ja: {
    label: "関連ノート",
    mentionedBy: (count) => `このノートに言及している ${count} 件`,
    linksTo: (count) => `本文からリンクしている ${count} 件`,
    showAll: (count) => `すべて表示（${count} 件）`,
    collapse: "折りたたむ",
  },
};

/** 笔记阅读层的入口文案：返回去哪、场景里的眉题、信息面板里的空值。 */
const NOTE_READER_COPY: Record<UiLocale, {
  back: Record<"graph" | "timeline" | "page", string>;
  eyebrow: Record<"graph" | "timeline", string>;
  updated: (date: string) => string;
  sceneNote: string;
  sceneHint: string;
  empty: string;
  mentionedBy: string;
}> = {
  "zh-CN": {
    back: { graph: "返回星图", timeline: "返回时间线", page: "返回详情" },
    eyebrow: { graph: "记忆星图", timeline: "时之航道" },
    updated: (date) => `更新于 ${date}`,
    sceneNote: "场景内阅读",
    sceneHint: "关闭全文，继续探索。",
    empty: "未填写",
    mentionedBy: "提到这篇文章",
  },
  ja: {
    back: { graph: "星図に戻る", timeline: "タイムラインに戻る", page: "詳細に戻る" },
    eyebrow: { graph: "記憶の星図", timeline: "時の航路" },
    updated: (date) => `${date} 更新`,
    sceneNote: "シーン内で読む",
    sceneHint: "全文を閉じて探索を続けます。",
    empty: "未記入",
    mentionedBy: "このノートに言及しているノート",
  },
};

export function SnippetText({ parts }: { parts: readonly SnippetPart[] }) {
  return <>{parts.map((part, index) => part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</>;
}

function RelatedGroup({ title, notes, context, onOpen, copy }: {
  title: string;
  notes: Note[];
  context?: (source: Note) => SnippetPart[] | null;
  onOpen?: (note: Note) => void;
  copy: (typeof RELATED_COPY)[UiLocale];
}) {
  const [expanded, setExpanded] = useState(false);
  if (!notes.length) return null;
  const shown = expanded ? notes : notes.slice(0, RELATED_PREVIEW);
  return (
    <section className="reader-related-group">
      <h3>{title}</h3>
      <div className="reader-related-grid">
        {shown.map((item) => {
          const snippet = context?.(item);
          return (
            <button key={item.path} type="button" onClick={() => onOpen?.(item)}
              style={{ "--related-accent": GROUPS[getGroup(item.path)].color } as CSSProperties}>
              <small>{GROUPS[getGroup(item.path)].label}<span aria-hidden="true"> · </span>{typeLabel(getType(item))}</small>
              <strong>{headingPlainText(getTitle(item))}</strong>
              {snippet && <span className="reader-related-context"><SnippetText parts={snippet} /></span>}
            </button>
          );
        })}
      </div>
      {notes.length > RELATED_PREVIEW && (
        <button type="button" className="reader-related-more" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? copy.collapse : copy.showAll(notes.length)}
        </button>
      )}
    </section>
  );
}

/** 文末的去向：读完一篇，接着去「谁提到了它」或「它提到了谁」，不必退回详情页再找。 */
function ReaderRelated({ note, backlinks, outlinks, onOpen }: {
  note: Note;
  backlinks: Note[];
  outlinks: Note[];
  onOpen?: (note: Note) => void;
}) {
  const { locale } = useUiLocale();
  const copy = RELATED_COPY[locale];
  const basename = noteBasename(note.path);
  if (!backlinks.length && !outlinks.length) return null;
  return (
    <nav className="reader-related" aria-label={copy.label}>
      <RelatedGroup title={copy.mentionedBy(backlinks.length)} notes={backlinks} copy={copy} onOpen={onOpen}
        context={(source) => backlinkContext(source, basename)} />
      <RelatedGroup title={copy.linksTo(outlinks.length)} notes={outlinks} copy={copy} onOpen={onOpen} />
    </nav>
  );
}

export default function NoteReader({ note, section, onClose, onOpenWiki, backlinks = [], onOpen, initialPosition, scene, allNotes, wikiIndexComplete = false }: {
  note: Note;
  section?: string | null;
  onClose: (position: ReadingPosition) => void;
  onOpenWiki: (target: string, section?: string) => void;
  backlinks?: Note[];
  onOpen?: (note: Note) => void;
  initialPosition?: ReadingPosition;
  scene?: "graph" | "timeline";
  /** 给了全库笔记时：双链可悬浮预览，文末列出「本文链接到的笔记」。不给时与以前一样。 */
  allNotes?: Note[];
  /** allNotes 是否为全库：局部范围里查不到的双链不能标成「找不到」，只有全库时才做悬浮预览与断链标记。 */
  wikiIndexComplete?: boolean;
}) {
  const copy = NOTE_READER_COPY[useUiLocale().locale];
  const headings = useMemo(() => scanReadingHeadings(note.content), [note.content]);
  const heading = findHeadingBySection(headings, section);
  const trust = trustLayer(note);
  const outlinks = useMemo(() => (allNotes ? noteOutlinks(allNotes, note) : []), [allNotes, note]);
  const resolveWiki = useCallback(
    (target: string, heading?: string) => (allNotes ? resolveNoteLink(allNotes, target, heading)?.note ?? null : null),
    [allNotes],
  );
  return <ReadingMode key={`${note.path}#${section ?? ""}`} documentKey={`note:${note.path}`}
    presentation={scene ? "scene" : "page"}
    backLabel={copy.back[scene ?? "page"]}
    title={headingPlainText(getTitle(note))} eyebrow={scene ? copy.eyebrow[scene] : typeLabel(getType(note))}
    metadata={[trust.label, copy.updated(formatDate(note.stat.mtime, true))]}
    headerNote={scene ? <p className="nr-reading-note">{copy.sceneNote}<span> / </span>{copy.sceneHint}</p> : undefined}
    headings={headings} initialHeadingId={heading?.id} initialPosition={initialPosition} onClose={onClose}
    footerActions={<ReaderRelated note={note} backlinks={backlinks} outlinks={outlinks} onOpen={onOpen} />}
    information={<>
      <p className="reader-source-path">{note.path}</p>
      <dl>{Object.entries(note.frontmatter).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(" · ") : getString(value) || copy.empty}</dd></div>)}</dl>
      {backlinks.length > 0 && <section className="reader-backlinks"><h3>{copy.mentionedBy}</h3>{backlinks.map((backlink) => <button key={backlink.path} onClick={() => onOpen?.(backlink)}>{headingPlainText(getTitle(backlink))}<span aria-hidden="true">↗</span></button>)}</section>}
    </>}>
    <div className="reader-prose"><MarkdownDocument content={note.content} onWikiLink={onOpenWiki} reading resolveWiki={allNotes && wikiIndexComplete ? resolveWiki : undefined} /></div>
  </ReadingMode>;
}
