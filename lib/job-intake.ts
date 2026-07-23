/**
 * 入库日 = frontmatter `date`，AI 推薦がキューに乗った日。**応募日ではない**。
 * 单独成模块是为了不依赖 Note：日期这点数学要能单测（tests/job-intake.test.mjs）。
 */

/** 笔记里手写的日期不一定补零，也可能用 `/` 分隔，这里都认。 */
const ISO_DATE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;

function pad(value: number) {
  return `${value}`.padStart(2, "0");
}

/**
 * 只取日期前缀并补零成 `YYYY-MM-DD`，`2026-07-20（本人応募）` / `2026-7-5` 都落到同一把尺子上。
 * 补零不是洁癖：不补的话字典序就不等于时间序，`2026-7-5` 会排到 `2026-12-01` 后面去。
 */
export function normalizeDay(raw: string): string | null {
  const parts = ISO_DATE.exec(raw.trim());
  return parts ? `${parts[1]}-${pad(Number(parts[2]))}-${pad(Number(parts[3]))}` : null;
}

/**
 * 本地时区的当天 0 时。`new Date("2026-07-22")` 会被当成 UTC 午夜，
 * 日本时间下整天都会算少一天 —— 「今日入库」于是永远点不亮。
 */
function localMidnight(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).getTime();
}

/** 相隔天数（today − day）。任一侧解析不出日期就是 null。 */
export function daysBetween(day: string, today: string): number | null {
  const from = normalizeDay(day);
  const to = normalizeDay(today);
  if (!from || !to) return null;
  // 夏令时会让某一天只有 23 小时或多到 25 小时，所以四舍五入而不是整除。
  return Math.round((localMidnight(to) - localMidnight(from)) / 86_400_000);
}

export type JobIntake = "today" | "d3" | "d7" | "older" | "unknown";

/**
 * 各档**互不重叠**。chip 是多选取并集，档位一旦重叠，计数加起来就不等于总条数，
 * 而这里的数字正是用来回答「今天进了几条」的 —— 数不准就没有存在意义。
 * 于是 `3日以内` 实际是「1〜3 天前」，靠 hint 说清楚，别让人以为它含今天。
 */
export const JOB_INTAKES: { id: JobIntake; label: string; hint: string }[] = [
  { id: "today", label: "今日", hint: "今天入库" },
  { id: "d3", label: "3日以内", hint: "1〜3 天前入库" },
  { id: "d7", label: "7日以内", hint: "4〜7 天前入库" },
  { id: "older", label: "それ以前", hint: "8 天以上之前" },
  { id: "unknown", label: "不明", hint: "笔记里没写 date" },
];

export function jobIntake(date: string, today: string): JobIntake {
  const days = daysBetween(date, today);
  if (days === null) return "unknown";
  // 先に起票した未来日付も「最新」側に寄せる。専用の档を作るほどの件数ではない。
  if (days <= 0) return "today";
  if (days <= 3) return "d3";
  if (days <= 7) return "d7";
  return "older";
}

/** 相对说法だけ：`NEW`（今天入库）/ `3日前`。日付が読めなければ空文字。 */
export function intakeRelative(date: string, today: string): string {
  const days = daysBetween(date, today);
  if (days === null) return "";
  return days <= 0 ? "NEW" : `${days}日前`;
}

/**
 * `7/22 · NEW` / `7/19 · 3日前` / `不明`。
 * 日期是笔记里的事实，照抄；变的只有右半边那个相对说法。
 * 「入库」の語は付けない —— リストは列見出しで既に言っており、二度言うと列が潰れる。
 */
export function intakeLabel(date: string, today: string): string {
  const day = normalizeDay(date);
  if (!day) return "不明";
  const stamp = `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
  const relative = intakeRelative(day, today);
  return relative ? `${stamp} · ${relative}` : stamp;
}

/** 排序用的键。未记入的排最后 —— 空字符串当「最古」的话，新着順的头部会被空白占掉。 */
export function intakeSortKey(date: string) {
  return normalizeDay(date) ?? "";
}
