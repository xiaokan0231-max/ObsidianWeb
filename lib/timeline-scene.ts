// 时之航道（3D 时间线）的纯数据场景构建：把带日期的笔记与日程事件
// 折算成「站点（日）/ 月门 / 纵深坐标」。这里刻意做到零 import——
// Note → 输入字段的映射放在 memory-atlas 侧（与 buildKnowledgeGraphScene 同分工），
// 使本模块既能被 node --test 直接导入做单测，又不会把 three 拖进主 chunk。
// 日期一律用 Date.UTC 计算，避免单测结果随机器时区漂移。

export type TimelineSceneNoteInput = {
  id: string;
  title: string;
  group: string;
  groupLabel: string;
  color: string;
  path: string;
  kindLabel: string;
  updatedLabel: string;
  // 全文（去 Markdown 后），供舞台内全文搜索与档案卡使用，与星图同口径。
  excerpt: string;
  date: string;
};

export type TimelineSceneEventInput = {
  id: string;
  noteId: string;
  date: string;
  time: string;
  company: string;
  label: string;
  phase: "upcoming" | "past";
};

export type TimelineSceneNote = TimelineSceneNoteInput & {
  dayIndex: number;
  slot: number;
};

export type TimelineSceneEvent = TimelineSceneEventInput & {
  dayIndex: number;
};

export type TimelineSceneStation = {
  date: string;
  dateLabel: string;
  weekdayLabel: string;
  dayIndex: number;
  // 距「当下」的纵深，站 0 为 0，向过去单调递增。渲染层再决定朝向（world z = -z）。
  z: number;
  // 与上一站（更新的那站）相隔的自然日数；站 0 恒为 0。
  gapDays: number;
  noteIds: string[];
  eventIds: string[];
  isMonthStart: boolean;
};

export type TimelineSceneMonth = {
  key: string;
  label: string;
  zStart: number;
  zEnd: number;
  noteCount: number;
  eventCount: number;
  firstDayIndex: number;
};

export type TimelineScene = {
  // dayIndex 升序、slot 升序 = 从当下走向过去的键盘遍历序。
  notes: TimelineSceneNote[];
  stations: TimelineSceneStation[];
  months: TimelineSceneMonth[];
  events: TimelineSceneEvent[];
  totalDepth: number;
};

// 间距模型：相邻日一步 BASE_STEP，空窗期按对数压缩再封顶。
// 均匀间距丢掉「隔了多久」的体感，按日线性又会让稀疏月份完全不可导航，
// 对数是两者的折中：1 天 3.4u、一周 ≈5.5u、一个月以上封顶 ≈6.6u。
export const BASE_STEP = 3.4;
export const GAP_EXTRA_MAX = 3.2;
// 月门悬在该月第一站前方的提前量。
export const GATE_LEAD = 1.5;
// 最深站之后的余量，让镜头能越过最后一站回望。
export const TAIL_PAD = 6;

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

type ParsedDate = { year: number; month: number; day: number; utc: number };

// frontmatter.date 可能是「2026-07-21・書類選考」这类带注记的字符串，
// 只认得出 ISO 日期的部分；完全解析不出的条目从 3D 场景剔除（简洁模式仍显示）。
function parseIsoDate(value: string): ParsedDate | null {
  const matched = /(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(utc);
  if (roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, utc };
}

function stepFromGap(gapDays: number) {
  return BASE_STEP + Math.min(GAP_EXTRA_MAX, Math.log1p(Math.max(0, gapDays - 1)) * 1.15);
}

export function buildTimelineScene(
  notes: TimelineSceneNoteInput[],
  events: TimelineSceneEventInput[],
): TimelineScene {
  const notesByDate = new Map<string, TimelineSceneNoteInput[]>();
  const parsedByDate = new Map<string, ParsedDate>();
  notes.forEach((note) => {
    const parsed = parseIsoDate(note.date);
    if (!parsed) return;
    const key = note.date.match(/\d{4}-\d{2}-\d{2}/)![0];
    parsedByDate.set(key, parsed);
    notesByDate.set(key, [...(notesByDate.get(key) ?? []), note]);
  });
  const eventsByDate = new Map<string, TimelineSceneEventInput[]>();
  events.forEach((event) => {
    const parsed = parseIsoDate(event.date);
    if (!parsed) return;
    const key = event.date.match(/\d{4}-\d{2}-\d{2}/)![0];
    parsedByDate.set(key, parsed);
    eventsByDate.set(key, [...(eventsByDate.get(key) ?? []), event]);
  });

  // 站点 = 笔记日期 ∪ 事件日期，新 → 旧。只有面接、没有笔记的日子也要成站。
  const dates = [...parsedByDate.keys()].toSorted((left, right) => right.localeCompare(left));

  const stations: TimelineSceneStation[] = [];
  const sceneNotes: TimelineSceneNote[] = [];
  const sceneEvents: TimelineSceneEvent[] = [];
  const seenMonths = new Set<string>();
  let depth = 0;

  dates.forEach((date, dayIndex) => {
    const parsed = parsedByDate.get(date)!;
    const previous = dayIndex > 0 ? parsedByDate.get(dates[dayIndex - 1])! : null;
    const gapDays = previous
      ? Math.round((previous.utc - parsed.utc) / 86_400_000)
      : 0;
    if (previous) depth += stepFromGap(gapDays);

    const monthKey = `${parsed.year}-${String(parsed.month).padStart(2, "0")}`;
    const isMonthStart = !seenMonths.has(monthKey);
    seenMonths.add(monthKey);

    const crossedYear = previous === null || previous.year !== parsed.year;
    const dateLabel = crossedYear
      ? `${parsed.year}年${parsed.month}月${parsed.day}日`
      : `${parsed.month}月${parsed.day}日`;

    const dayNotes = notesByDate.get(date) ?? [];
    const dayEvents = eventsByDate.get(date) ?? [];
    dayNotes.forEach((note, slot) => {
      sceneNotes.push({ ...note, date, dayIndex, slot });
    });
    dayEvents.forEach((event) => {
      sceneEvents.push({ ...event, date, dayIndex });
    });

    stations.push({
      date,
      dateLabel,
      weekdayLabel: WEEKDAY_LABELS[new Date(parsed.utc).getUTCDay()],
      dayIndex,
      z: depth,
      gapDays,
      noteIds: dayNotes.map((note) => note.id),
      eventIds: dayEvents.map((event) => event.id),
      isMonthStart,
    });
  });

  const months: TimelineSceneMonth[] = [];
  stations.forEach((station) => {
    const parsed = parsedByDate.get(station.date)!;
    const key = `${parsed.year}-${String(parsed.month).padStart(2, "0")}`;
    const existing = months.at(-1);
    if (existing && existing.key === key) {
      existing.zEnd = station.z;
      existing.noteCount += station.noteIds.length;
      existing.eventCount += station.eventIds.length;
      return;
    }
    months.push({
      key,
      label: `${parsed.year}年${parsed.month}月`,
      zStart: Math.max(0, station.z - GATE_LEAD),
      zEnd: station.z,
      noteCount: station.noteIds.length,
      eventCount: station.eventIds.length,
      firstDayIndex: station.dayIndex,
    });
  });

  return {
    notes: sceneNotes,
    stations,
    months,
    events: sceneEvents,
    totalDepth: stations.length > 0 ? depth + TAIL_PAD : 0,
  };
}
