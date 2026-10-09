/** 周一开头的完整自然周，避免短月份留下整行空白。 */
export function calendarMonthDays(month: Date): Date[] {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDayOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.ceil((firstDayOffset + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) =>
    new Date(year, monthIndex, index - firstDayOffset + 1),
  );
}
