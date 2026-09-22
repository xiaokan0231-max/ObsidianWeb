"use client";

import { memo, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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

import {
  compareTimelineTimes,
  filterTimelineEntries,
  localTimelineToday,
  nearestTimelineDate,
  timelineDate,
  timelineMonths,
  type TimelineEntry,
} from "@/lib/timeline-browser";

const ThreeTimeCorridor = lazy(() => import("./timeline-three"));

// 时间线视图：默认可扫描列表；3D 保留为探索模式并记住本人选择。
// 场景数据在这里由 Note 映射为纯数据（与 buildKnowledgeGraphScene 同分工），
// 传给 lazy 的 ThreeTimeCorridor；WebGL 失败时退回原来的 2D 列表。
function TimelineView({
  today = localTimelineToday(),
  items,
  events,
  onOpen,
}: {
  today?: string;
  items: { note: Note; date: string }[];
  events: CalendarEvent[];
  onOpen: (note: Note) => void;
}) {
  const [renderer, setRenderer] = useState<"corridor" | "list">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("echo.timeline.renderer") === "corridor"
      ? "corridor"
      : "list",
  );
  useEffect(() => window.localStorage.setItem("echo.timeline.renderer", renderer), [renderer]);
  const scene = useMemo(() => renderer === "corridor" ? buildTimelineScene(
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
        searchText: note.content,
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
      searchText: event.note.content,
    })),
  ) : null, [renderer, events, items]);
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
    <section className={`timeline-view${renderer === "corridor" ? " stage-immersive" : ""}`}>
      <h1 className="sr-only">时间线</h1>
      <div className="stage-toolbar">
        <div className="graph-renderer-toggle" role="group" aria-label="时间线显示方式">
          <span aria-hidden="true">视图</span>
          <button
            type="button"
            className={renderer === "corridor" ? "active" : ""}
            aria-pressed={renderer === "corridor"}
            onClick={() => setRenderer("corridor")}
          >
            探索模式 · 3D
          </button>
          <button
            type="button"
            className={renderer === "list" ? "active" : ""}
            aria-pressed={renderer === "list"}
            onClick={() => setRenderer("list")}
          >
            时间列表
          </button>
        </div>
      </div>
      {renderer === "corridor" && scene ? (
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
              today={today}
              onOpen={openSceneNote}
              onFallback={fallBackToList}
            />
          </Suspense>
        </div>
      ) : (
        <TimelineListView today={today} items={items} events={events} onOpen={onOpen} />
      )}
    </section>
  );
}

function monthLabel(key: string) {
  if (key === "all") return "全部时间";
  if (key === "undated") return "日期待确认";
  const [year, month] = key.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

function TimelineListView({ today, items, events, onOpen }: {
  today: string;
  items: { note: Note; date: string }[];
  events: CalendarEvent[];
  onOpen: (note: Note) => void;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [kind, setKind] = useState<"all" | "note" | "event">("all");
  const [monthChoice, setMonthChoice] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [oldestFirst, setOldestFirst] = useState(false);
  const [visibleDays, setVisibleDays] = useState(14);
  const searchRef = useRef<HTMLInputElement>(null);
  const sourceNotes = useMemo(() => new Map([
    ...items.map(({ note }) => [note.path, note] as const),
    ...events.map(({ note }) => [note.path, note] as const),
  ]), [items, events]);
  const entries = useMemo<TimelineEntry[]>(() => {
    const notes: TimelineEntry[] = items.map(({ note, date }) => {
      const group = getGroup(note.path);
      return {
        id: `note:${note.path}`, sourceId: note.path, kind: "note", date: timelineDate(date), searchText: note.content,
        title: getTitle(note), excerpt: stripMarkdown(stripFrontmatter(note.content).replace(/<!--[\s\S]*?-->/g, "")).trim(),
        group, groupLabel: GROUPS[group].label, color: GROUPS[group].color, kindLabel: typeLabel(getType(note)),
      };
    });
    const schedules: TimelineEntry[] = events.map((event) => {
      const group = getGroup(event.note.path);
      return {
        id: `event:${event.id}`, sourceId: event.note.path, kind: "event", date: timelineDate(event.date), searchText: event.note.content,
        title: `${event.company} · ${event.label}`, excerpt: stripMarkdown(stripFrontmatter(event.note.content)),
        group, groupLabel: GROUPS[group].label, color: GROUPS[group].color, kindLabel: "日程",
        time: event.time, phase: event.phase,
      };
    });
    return [...notes, ...schedules];
  }, [items, events]);
  const months = useMemo(() => timelineMonths(entries), [entries]);
  const nearestDate = nearestTimelineDate(entries.map((entry) => entry.date), today);
  const initialMonth = nearestDate.slice(0, 7) || "all";
  const month = monthChoice ?? initialMonth;
  const matchingEntries = useMemo(() => filterTimelineEntries(entries, { query, group, kind }), [entries, query, group, kind]);
  const matchingMonths = useMemo(() => new Map(timelineMonths(matchingEntries).map((item) => [item.key, item])), [matchingEntries]);
  const monthEntries = useMemo(() => filterTimelineEntries(matchingEntries, { month }), [matchingEntries, month]);
  const filtered = useMemo(() => filterTimelineEntries(monthEntries, { date: selectedDate, oldestFirst }), [monthEntries, selectedDate, oldestFirst]);
  const days = useMemo(() => {
    const groups = new Map<string, TimelineEntry[]>();
    for (const entry of filtered) {
      const day = groups.get(entry.date) ?? [];
      day.push(entry);
      groups.set(entry.date, day);
    }
    return [...groups.entries()];
  }, [filtered]);
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of monthEntries) counts.set(entry.date, (counts.get(entry.date) ?? 0) + 1);
    return counts;
  }, [monthEntries]);
  const upcoming = events.filter((event) => event.phase === "upcoming" && timelineDate(event.date) >= today)
    .toSorted((a, b) => a.date.localeCompare(b.date) || compareTimelineTimes(a.time, b.time))[0];
  const noteCount = filtered.filter((entry) => entry.kind === "note").length;
  const eventCount = filtered.length - noteCount;
  const activeFilters = Boolean(query || group !== "all" || kind !== "all" || selectedDate);
  const setMonth = (key: string) => { setMonthChoice(key); setSelectedDate(""); setVisibleDays(14); };
  const resetFilters = () => { setQuery(""); setGroup("all"); setKind("all"); setSelectedDate(""); setVisibleDays(14); };
  const jumpToDate = (date: string) => {
    if (!date) { setSelectedDate(""); return; }
    setMonthChoice(date.slice(0, 7)); setSelectedDate(date); setVisibleDays(14);
  };
  const openEntry = (entry: TimelineEntry) => {
    const note = sourceNotes.get(entry.sourceId);
    if (note) onOpen(note);
  };
  const calendarDays = /^\d{4}-\d{2}$/.test(month) ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() : 0;
  const maxDayCount = Math.max(1, ...dayCounts.values());

  return (
    <div className="chronicle">
      <div className="chronicle-tools">
        <label className="chronicle-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input ref={searchRef} type="search" value={query} placeholder="搜索记录、日程与全文…" aria-label="搜索时间线记录与日程"
            onChange={(event) => { setQuery(event.target.value); setMonthChoice("all"); setSelectedDate(""); setVisibleDays(14); }} />
          {query && <button type="button" aria-label="清空搜索" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>×</button>}
        </label>
        <label className="chronicle-jump">跳到日期<input type="date" value={selectedDate} aria-label="跳到日期" onChange={(event) => jumpToDate(event.target.value)} /></label>
        <button type="button" className="chronicle-today" onClick={() => { resetFilters(); jumpToDate(today); }}>今天 <span aria-hidden="true">↗</span></button>
      </div>
      <div className="chronicle-workspace">
        <aside className="chronicle-sidebar">
          <nav className="chronicle-months" aria-label="时间线月份">
            <div className="chronicle-rail-heading"><span>时间索引</span><small>{months.filter((item) => item.key !== "undated").length} 个月</small></div>
            <button type="button" aria-current={month === "all" ? "true" : undefined} onClick={() => setMonth("all")}><span>全部时间</span><small>{matchingEntries.length}</small></button>
            {months.map((item, index) => {
              const match = matchingMonths.get(item.key);
              const count = (match?.noteCount ?? 0) + (match?.eventCount ?? 0);
              const showYear = item.key !== "undated" && (index === 0 || item.key.slice(0, 4) !== months[index - 1].key.slice(0, 4));
              return <div key={item.key}>
                {showYear && <div className="chronicle-year">{item.key.slice(0, 4)}</div>}
                <button type="button" aria-label={`${monthLabel(item.key)}，${count} 条记录`} aria-current={month === item.key ? "true" : undefined} onClick={() => setMonth(item.key)}>
                  <span>{item.key === "undated" ? "日期待确认" : `${Number(item.key.slice(5, 7))} 月`}</span>
                  <i aria-hidden="true" style={{ "--month-density": `${100 * (item.noteCount + item.eventCount) / Math.max(1, ...months.map((m) => m.noteCount + m.eventCount))}%` } as CSSProperties} />
                  <small>{count}</small>
                </button>
              </div>;
            })}
          </nav>
          {upcoming && <div className="chronicle-upcoming">
            <span><i /> 近期日程</span>
            <time dateTime={upcoming.date}>{formatDate(upcoming.date)}{upcoming.time ? ` · ${upcoming.time}` : " · 时间待定"}</time>
            <strong>{upcoming.company}</strong><p>{upcoming.label}</p>
            <button type="button" onClick={() => onOpen(upcoming.note)}>查看安排 <span aria-hidden="true">↗</span></button>
          </div>}
          <p className="chronicle-source-note">笔记按记录日期归档<br />日程按发生日期排列</p>
        </aside>
        <div className="chronicle-main">
          <header className="chronicle-month-head">
            <div><span className="chronicle-kicker">CHRONOLOGY / {month === "all" ? "ALL" : month === "undated" ? "UNDATED" : month.replace("-", ".")}</span><h2>{selectedDate ? formatDate(selectedDate, true) : monthLabel(month)}</h2></div>
            <div className="chronicle-totals" role="status" aria-live="polite"><span><strong>{noteCount}</strong> 篇笔记</span><span><strong>{eventCount}</strong> 场日程</span></div>
          </header>
          <div className="chronicle-filters">
            <div className="chronicle-kind" role="group" aria-label="记录类型">
              {([['all', '全部'], ['note', '笔记'], ['event', '日程']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setVisibleDays(14); }}>{label}</button>)}
            </div>
            <label><span className="sr-only">主题</span><select aria-label="按主题筛选" value={group} onChange={(event) => { setGroup(event.target.value); setVisibleDays(14); }}><option value="all">全部主题</option>{Object.entries(GROUPS).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}</select></label>
            <button type="button" className="chronicle-sort" onClick={() => { setOldestFirst((value) => !value); setVisibleDays(14); }}><span aria-hidden="true">↕</span> {oldestFirst ? "从早到晚" : "从近到远"}</button>
          </div>
          {calendarDays > 0 && <div className="chronicle-density">
            <div className="chronicle-density-heading"><span>本月记录分布</span><small>点击日期查看{selectedDate && <button type="button" onClick={() => setSelectedDate("")}>查看整月 ×</button>}</small></div>
            <div className="chronicle-day-strip" role="group" aria-label="本月每日记录分布">
              {Array.from({ length: calendarDays }, (_, index) => {
                const date = `${month}-${String(index + 1).padStart(2, "0")}`;
                const count = dayCounts.get(date) ?? 0;
                return <button type="button" key={date} aria-pressed={selectedDate === date} data-today={date === today} data-empty={count === 0} title={`${formatDate(date)} · ${count} 条`} aria-label={`${formatDate(date)}，${count} 条记录${date === today ? '，今天' : ''}`} onClick={() => { setSelectedDate(selectedDate === date ? "" : date); setVisibleDays(14); }}>
                  <i aria-hidden="true" style={{ "--day-density": `${count ? 14 + count / maxDayCount * 86 : 5}%` } as CSSProperties} /><span>{index + 1}</span>
                </button>;
              })}
            </div>
          </div>}
          {activeFilters && <div className="chronicle-filter-summary"><span>{query && `“${query}” · `}{filtered.length} 条匹配记录{selectedDate && ` · ${selectedDate}`}</span><button type="button" onClick={resetFilters}>清除筛选 ×</button></div>}
          {days.length === 0 ? <div className="chronicle-empty"><span aria-hidden="true">◷</span><h3>{selectedDate ? "这一天没有匹配的记录" : "没有找到匹配的记录"}</h3><p>{entries.length ? "换一个日期，或清除筛选继续回看。" : "带日期的笔记与日程会出现在这里。"}</p>{entries.length > 0 && <button type="button" onClick={() => { resetFilters(); setMonth("all"); }}>查看全部记录 →</button>}</div> : <div className="chronicle-feed">
            {days.slice(0, visibleDays).map(([date, records]) => <section className="chronicle-day" key={date || "undated"} aria-label={date || "日期待确认"}>
              <div className="chronicle-date"><strong>{date ? date.slice(8) : "—"}</strong><span>{date ? `${Number(date.slice(5, 7))} 月 · ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T00:00:00`).getDay()]}` : "日期待确认"}</span>{date === today && <b>今天</b>}{date > today && <b data-future="true">未来</b>}</div>
              <div className="chronicle-day-content"><div className="chronicle-day-rule"><i /><span>{records.filter((entry) => entry.kind === "note").length} 篇笔记 · {records.filter((entry) => entry.kind === "event").length} 场日程</span></div>
                {records.map((entry) => <button type="button" className="chronicle-entry" data-kind={entry.kind} key={entry.id} onClick={() => openEntry(entry)} style={{ "--entry-accent": entry.color } as CSSProperties}>
                  <span className="chronicle-entry-icon" aria-hidden="true">{entry.kind === "event" ? "◷" : "≡"}</span>
                  <span className="chronicle-entry-body"><span className="chronicle-entry-meta"><span>{entry.kindLabel}</span><span>{entry.groupLabel}</span>{entry.kind === "event" && <b>{entry.time || "时间待定"} · {entry.date === today ? "今天" : entry.phase === "upcoming" ? "待进行" : "已过时间"}</b>}</span><strong>{entry.title}</strong>{entry.kind === "note" && <span className="chronicle-excerpt">{entry.excerpt || "暂无正文"}</span>}</span>
                  <span className="chronicle-entry-open">{entry.kind === "event" ? "查看安排" : "阅读笔记"}<span aria-hidden="true"> ↗</span></span>
                </button>)}
              </div>
            </section>)}
          </div>}
          {days.length > visibleDays && <button type="button" className="chronicle-load-more" onClick={() => setVisibleDays((value) => value + 14)}>继续查看 · 还有 {days.length - visibleDays} 天 <span aria-hidden="true">↓</span></button>}
          {days.length > 0 && days.length <= visibleDays && <div className="chronicle-end">{selectedDate ? "当日记录已全部显示" : "这段时间的记录已全部显示"}</div>}
        </div>
      </div>
    </div>
  );
}

// 外壳的 UI state（⌘K・overlay・移动端菜单）变化时不重渲染整个视圖。
// props 都是稳定引用（notes 整体替换・useCallback 回调・原始值），memo 直接命中。
export default memo(TimelineView);
