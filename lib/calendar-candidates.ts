export function parseCalendarCandidateStart(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(20\d{2}-\d{2}-\d{2})(?: ((?:[01]\d|2[0-3]):[0-5]\d))?$/u);
  if (!match) return null;
  const [, date, time = ""] = match;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return null;
  return { date, time };
}

/** 日期本身表示全天可调整，不能补成某个具体时刻。 */
export function earliestCalendarCandidate(value: unknown) {
  if (!Array.isArray(value)) return null;
  let earliest: ReturnType<typeof parseCalendarCandidateStart> = null;
  for (const item of value) {
    const start = parseCalendarCandidateStart(item);
    if (start && (!earliest || start.date < earliest.date || (start.date === earliest.date && start.time < earliest.time))) {
      earliest = start;
    }
  }
  return earliest;
}
