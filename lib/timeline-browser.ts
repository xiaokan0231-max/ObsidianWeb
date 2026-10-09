// 列表与航道共用日期口径。未知日期保留在列表里，不让坏日期静默吞掉笔记。
export function timelineDate(value: string): string {
  const match = /\d{4}-\d{2}-\d{2}/.exec(value);
  if (!match) return "";
  const date = new Date(`${match[0]}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[0] ? match[0] : "";
}

export function localTimelineToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export type TimelineEntry = {
  id: string;
  sourceId: string;
  kind: "note" | "event";
  date: string;
  title: string;
  excerpt: string;
  // 搜索保留代码与元数据，预览则可以去掉这些内容。
  searchText?: string;
  group: string;
  groupLabel: string;
  color: string;
  kindLabel: string;
  time?: string;
  phase?: "upcoming" | "past";
};

export type TimelineFilters = {
  query?: string;
  group?: string;
  kind?: "all" | "note" | "event";
  month?: string;
  date?: string;
  oldestFirst?: boolean;
};

const searchText = (value: string) => value.normalize("NFKC").toLocaleLowerCase();

export function compareTimelineTimes(left = "", right = ""): number {
  const minutes = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(value.normalize("NFKC").trim());
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return 1440;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  return minutes(left) - minutes(right);
}

export function filterTimelineEntries(entries: TimelineEntry[], filters: TimelineFilters = {}): TimelineEntry[] {
  const terms = searchText(filters.query ?? "").trim().split(/\s+/u).filter(Boolean);
  return entries.filter((entry) => {
    if (filters.group && filters.group !== "all" && entry.group !== filters.group) return false;
    if (filters.kind && filters.kind !== "all" && entry.kind !== filters.kind) return false;
    if (filters.month && filters.month !== "all" && (entry.date.slice(0, 7) || "undated") !== filters.month) return false;
    if (filters.date && entry.date !== filters.date) return false;
    if (!terms.length) return true;
    const haystack = searchText(`${entry.title} ${entry.searchText ?? entry.excerpt} ${entry.kindLabel} ${entry.groupLabel} ${entry.date} ${entry.time ?? ""}`);
    return terms.every((term) => haystack.includes(term));
  }).toSorted((left, right) => {
    // 未知日期始终放最后；同一天先放有时间的日程，再放笔记。
    if (!left.date || !right.date) return left.date ? -1 : right.date ? 1 : left.id.localeCompare(right.id);
    const dateOrder = filters.oldestFirst ? left.date.localeCompare(right.date) : right.date.localeCompare(left.date);
    return dateOrder || (left.kind === right.kind ? compareTimelineTimes(left.time, right.time) : left.kind === "event" ? -1 : 1) || left.id.localeCompare(right.id);
  });
}

export function timelineMonths(entries: TimelineEntry[]) {
  const months = new Map<string, { key: string; noteCount: number; eventCount: number }>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 7) || "undated";
    const month = months.get(key) ?? { key, noteCount: 0, eventCount: 0 };
    if (entry.kind === "note") month.noteCount += 1;
    else month.eventCount += 1;
    months.set(key, month);
  }
  return [...months.values()].toSorted((left, right) => left.key === "undated" ? 1 : right.key === "undated" ? -1 : right.key.localeCompare(left.key));
}

export function nearestTimelineDate(dates: string[], target: string): string {
  const valid = dates.filter(Boolean).toSorted();
  if (!valid.length) return "";
  // 无当日记录时落在最近的过去；只有未来记录时才前往未来。
  return valid.findLast((date) => date <= target) ?? valid[0];
}
