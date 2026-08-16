"use client";

import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import {
  buildTimelineScene,
  type TimelineSceneEventInput,
  type TimelineSceneNoteInput,
} from "@/lib/timeline-scene";
import {
  formatDate,
  getTitle,
  getType,
  stripFrontmatter,
  stripMarkdown,
  type Note,
} from "@/lib/notes";
import {
  getGroup,
  GROUPS,
  typeLabel,
  type CalendarEvent,
} from "@/lib/memory-atlas-data";

const ThreeTimeCorridor = lazy(() => import("./timeline-three"));

// 时间线视图：默认 3D「时之航道」，与关系图同一套「3D / 简洁」切换与降级路径。
// 场景数据在这里由 Note 映射为纯数据（与 buildKnowledgeGraphScene 同分工），
// 传给 lazy 的 ThreeTimeCorridor；WebGL 失败时退回原来的 2D 列表。
export default function TimelineView({
  items,
  events,
  onOpen,
}: {
  items: { note: Note; date: string }[];
  events: CalendarEvent[];
  onOpen: (note: Note) => void;
}) {
  const [renderer, setRenderer] = useState<"corridor" | "list">("corridor");
  const scene = useMemo(() => buildTimelineScene(
    items.map(({ note, date }): TimelineSceneNoteInput => {
      const group = getGroup(note.path);
      return {
        id: note.path,
        title: getTitle(note),
        group,
        groupLabel: GROUPS[group].label,
        color: GROUPS[group].color,
        path: note.path.replace(/\.md$/i, ""),
        kindLabel: typeLabel(getType(note)),
        updatedLabel: formatDate(note.stat.mtime, true),
        excerpt: stripMarkdown(stripFrontmatter(note.content))
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim(),
        date,
      };
    }),
    events.map((event): TimelineSceneEventInput => ({
      id: event.id,
      noteId: event.note.path,
      date: event.date,
      time: event.time,
      company: event.company,
      label: event.label,
      phase: event.phase,
    })),
  ), [events, items]);
  const noteByPath = useMemo(() => {
    const map = new Map<string, Note>();
    items.forEach(({ note }) => map.set(note.path, note));
    events.forEach((event) => map.set(event.note.path, event.note));
    return map;
  }, [events, items]);
  const openSceneNote = useCallback((id: string) => {
    const note = noteByPath.get(id);
    if (note) onOpen(note);
  }, [noteByPath, onOpen]);
  const fallBackToList = useCallback(() => setRenderer("list"), []);

  return (
    <section className="timeline-view">
      <div className="module-control-row">
        <div className="graph-renderer-toggle" aria-label="时间线显示方式">
          <button
            type="button"
            className={renderer === "corridor" ? "active" : ""}
            aria-pressed={renderer === "corridor"}
            onClick={() => setRenderer("corridor")}
          >
            3D 航道
          </button>
          <button
            type="button"
            className={renderer === "list" ? "active" : ""}
            aria-pressed={renderer === "list"}
            onClick={() => setRenderer("list")}
          >
            简洁模式
          </button>
        </div>
      </div>
      {renderer === "corridor" ? (
        <div className="time-corridor-layout">
          <Suspense
            fallback={(
              <div className="space-graph-loading space-graph-loading-shell" role="status">
                <i />
                <span>正在铺设时间航道</span>
              </div>
            )}
          >
            <ThreeTimeCorridor
              scene={scene}
              onOpen={openSceneNote}
              onFallback={fallBackToList}
            />
          </Suspense>
        </div>
      ) : (
        <TimelineListView items={items} onOpen={onOpen} />
      )}
    </section>
  );
}

function TimelineListView({ items, onOpen }: { items: { note: Note; date: string }[]; onOpen: (note: Note) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, { note: Note; date: string }[]>();
    items.forEach((item) => map.set(item.date, [...(map.get(item.date) ?? []), item]));
    return Array.from(map.entries());
  }, [items]);
  // 外层 section 由 TimelineView 壳负责，这里只渲染列表本体，DOM 结构与改造前一致。
  return (
    <div className="timeline">
        {groups.map(([date, dateItems]) => (
          <div className="timeline-day" key={date}>
            <div className="timeline-date"><strong>{formatDate(date)}</strong><span>{date}</span></div>
            <div className="timeline-line"><i /></div>
            <div className="timeline-items">
              {dateItems.map(({ note }) => (
                <button key={note.path} onClick={() => onOpen(note)}>
                  <span className="timeline-type" style={{ color: GROUPS[getGroup(note.path)].color }}>{typeLabel(getType(note))}</span>
                  <strong>{getTitle(note)}</strong>
                  <p>{stripMarkdown(note.content).slice(0, 150)}</p>
                  <span className="timeline-link">阅读原文 ↗</span>
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
