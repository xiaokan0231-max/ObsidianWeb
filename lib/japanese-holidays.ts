import namesByDate from "./japanese-holidays.json" with { type: "json" };

// 使用内閣府已公布的数据，日历首屏不依赖外部请求，也不推算尚未公布的年份。
const dates = Object.keys(namesByDate);
export const japaneseHolidayYears = {
  first: dates[0].slice(0, 4),
  last: dates[dates.length - 1].slice(0, 4),
};

export function japaneseHolidayName(date: string): string | undefined {
  const names: Readonly<Record<string, string | undefined>> = namesByDate;
  return names[date];
}
