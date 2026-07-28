import { getString, getTitle, stripMarkdown, type Note } from "./notes";
import { jobSectionBody } from "./job-sections";
import { intakeSortKey } from "./job-intake";
import {
  DEFAULT_JOB_STATUS,
  normalizeJobStatus,
} from "./job-status";
import { JOB_CASE_TYPE } from "./vault-boundary.mjs";

export {
  DEFAULT_JOB_STATUS,
  isJobStatus,
  JOB_STATUSES,
  normalizeJobStatus,
  statusRequiresChannel,
  type JobStatus,
} from "./job-status";

export {
  daysBetween,
  intakeLabel,
  intakeRelative,
  jobIntake,
  JOB_INTAKES,
  normalizeDay,
  type JobIntake,
} from "./job-intake";

/** 応募案件は発見経路に関係なく 20_求職 配下に置く。 */
export const JOB_CASE_ROOT = "20_求職/";
export { JOB_CASE_TYPE };

// 10点満点（2026-07-19 に5点満点から移行。ノート側の rating も全件変換済み）
export function jobRating(note: Note) {
  const raw = Number(getString(note.frontmatter.rating));
  return Number.isFinite(raw) ? Math.max(0, Math.min(10, raw)) : 0;
}

/**
 * 採点の帯。**閾値（7+ / 8+）ではなく単独の帯**にしてあるのは、
 * 「5〜6 点だけを見たい」が閾値式では表現できないから（7+ を選ぶと 5-6 が消える）。
 * チップは多選の和集合なので、7・8・9 を全部押せば従来の「7+」と同じ結果になる。
 * 8.5 や 7.5 のような小数は切り捨てて下の帯に入れる（8.5 → 8 の帯）。
 */
export type JobRatingBand = "7plus" | "9" | "8" | "7" | "6" | "5" | "low";

export const JOB_RATING_BANDS: { id: JobRatingBand; label: string; hint: string }[] = [
  { id: "7plus", label: "7+", hint: "7点以上をまとめて・応募すべき帯" },
  { id: "9", label: "9", hint: "9点以上・今週応募すべき" },
  { id: "8", label: "8", hint: "8点台・応募すべき" },
  { id: "7", label: "7", hint: "7点台・応募すべき" },
  { id: "6", label: "6", hint: "6点台・応募可だが優先度低" },
  { id: "5", label: "5", hint: "5点台・応募可だが優先度低" },
  { id: "low", label: "4以下", hint: "4点以下・要確認事項が解消すれば上がる" },
];

/**
 * `7+` だけは排他バンドではなく**しきい値のショートカット**（9/8/7 を3回押す代わりの1クリック）。
 * `jobRatingBand()` には混ぜない —— 混ぜると1件が2つの帯に属することになり、
 * 帯ごとの件数が二重計上される。しきい値はこの表で分離して持つ。
 */
const RATING_THRESHOLDS: Partial<Record<JobRatingBand, number>> = { "7plus": 7 };

export function jobRatingBand(rating: number): JobRatingBand {
  if (rating >= 9) return "9";
  if (rating >= 8) return "8";
  if (rating >= 7) return "7";
  if (rating >= 6) return "6";
  if (rating >= 5) return "5";
  return "low";
}

/** 選択された帯（排他バンドとしきい値が混在しうる）に該当するか。未選択なら全件通す。 */
export function jobMatchesRatingBands(rating: number, selected: JobRatingBand[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((band) => {
    const threshold = RATING_THRESHOLDS[band];
    return threshold === undefined ? jobRatingBand(rating) === band : rating >= threshold;
  });
}

export function jobStatus(note: Note): string {
  const raw = getString(note.frontmatter.status);
  return normalizeJobStatus(raw) ?? (raw || DEFAULT_JOB_STATUS);
}

/**
 * `position` 是 Obsidian metadata cache 的保留键，Local REST API 会把它从 frontmatter 里剥掉，
 * 所以笔记里写了也读不到。改从 H1 的 `会社 — 職位` 或文件名 `会社_職位.md` 兜底取。
 */
export function jobPosition(note: Note): string {
  const declared = getString(note.frontmatter.position);
  if (declared) return declared;

  const heading = note.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const fromHeading = heading.split(/\s[—–-]\s/).slice(1).join(" — ").trim();
  if (fromHeading) return fromHeading;

  const basename = note.path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  const fromFilename = basename.split("_").slice(1).join("_").trim();
  return fromFilename;
}

export function jobStack(note: Note): string[] {
  const value = note.frontmatter.stack;
  if (Array.isArray(value)) return value.map((item) => getString(item)).filter(Boolean);
  const raw = getString(value);
  return raw ? raw.split(/[,、]/).map((item) => item.trim()).filter(Boolean) : [];
}

export function jobSection(note: Note, heading: string) {
  return stripMarkdown(jobSectionBody(note.content, heading)).trim();
}

/** `## 匹配点` / `## 主打材料` 这类小节按条目切开，供详情和对比使用。 */
export function jobSectionItems(note: Note, heading: string): string[] {
  return jobSectionBody(note.content, heading)
    .split("\n")
    .map((line) => line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/)?.[1] ?? "")
    .map((line) => stripMarkdown(line).trim())
    .filter(Boolean);
}

export type SalaryRange = {
  /** 年収下限（万円）。无法解析时为 null。 */
  min: number | null;
  /** 年収上限（万円）。只有单侧数字时与 min 相同。 */
  max: number | null;
  /** 由月給换算而来，数字只是估算。 */
  estimated: boolean;
};

const EMPTY_SALARY: SalaryRange = { min: null, max: null, estimated: false };

/**
 * 把 `年俸 750万〜1,200万円` / `月給 50.0万〜81.7万円` / `月給 53.3万円〜（年収換算 640万〜）`
 * 之类的自由文本解析成年収区间（万円）。月給按 ×12 估算。
 */
export function parseSalary(raw: string): SalaryRange {
  const text = raw.replace(/[,，]/g, "");
  if (!text.trim()) return EMPTY_SALARY;

  const conversion = text.match(/年収換算[^\d]*([\s\S]*)$/)?.[1];
  // 括号里常见的是「別求人は600万〜」这类旁注，会把区间拉歪，先切掉。
  const primary = conversion ?? text.split(/[（(]/)[0];
  const monthly = !conversion && /月給|月収/.test(primary);

  const numbers = Array.from(primary.matchAll(/(\d+(?:\.\d+)?)\s*万/g), (match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return EMPTY_SALARY;

  const scale = monthly ? 12 : 1;
  const min = Math.round(numbers[0] * scale);
  const max = Math.round(numbers[numbers.length - 1] * scale);
  return { min: Math.min(min, max), max: Math.max(min, max), estimated: monthly };
}

/** 从 `東京都港区三田・一部在宅` 里取出「東京都」这类可筛选的行政区划。 */
export function jobRegions(location: string): string[] {
  const matches = Array.from(location.matchAll(/([^\s／/・（(]{2,4}?[都道府県])/g), (match) => match[1]);
  return Array.from(new Set(matches));
}

export function jobRemote(note: Note) {
  const location = getString(note.frontmatter.location);
  return /リモート|在宅|フルリモート|remote/i.test(location);
}

/**
 * 笔记里由本人加的求人原文核对标记。AI 打分本身不是权威事实，
 * 所以这一层要在卡片上单独显示出来，避免拿未验证的分数去做决定。
 */
export type JobVerification = "verified" | "warned" | "unchecked";

export type OfficialApplyStatus = "exact" | "related" | "careers" | "unavailable";

export const OFFICIAL_APPLY_LABEL: Record<OfficialApplyStatus, string> = {
  exact: "同职位官网直投",
  related: "官网相近职位",
  careers: "官网招聘入口",
  unavailable: "未找到公开直投",
};

export function officialApplyStatus(note: Note): OfficialApplyStatus {
  const value = getString(note.frontmatter.official_apply_status);
  return value === "exact" || value === "related" || value === "careers" || value === "unavailable"
    ? value
    : "unavailable";
}

export function jobVerification(note: Note): JobVerification {
  const headings = note.content.match(/^##\s.*$/gm) ?? [];
  // 历史审计记录可能同时包含旧的「✅ 已确认」和更新后的「⚠️ 要确认」。
  // 风险提示必须优先，否则卡片会被下面残留的旧结论错误标成「原文確認済」。
  if (headings.some((line) => /^##\s*⚠️/.test(line)) || /未検証/.test(note.content)) return "warned";
  if (headings.some((line) => /^##\s*✅/.test(line))) return "verified";
  return "unchecked";
}

export const VERIFICATION_LABEL: Record<JobVerification, string> = {
  verified: "原文確認済",
  warned: "要確認",
  unchecked: "未核对",
};

/**
 * source（求人票在哪发现的）的筛选用主值。frontmatter 原文允许带括号补充
 * （「公式採用（HRMOS）」「リクルートエージェント（本永氏おすすめメール）」），
 * 但筛选器若按整串聚合，同一来源会裂成一堆只有 1 件的选项——
 * 所以截掉括号取主值，再吸收英日别名。详情抽屉仍显示原文。
 */
const SOURCE_ALIASES: Record<string, string> = {
  "Recruit Agent": "リクルートエージェント",
  RA: "リクルートエージェント",
};

export function normalizeJobSource(raw: string): string {
  const main = raw.split(/[（(]/)[0].trim();
  if (!main) return "";
  return SOURCE_ALIASES[main] ?? main;
}

/** 卡片、抽屉、对比都用这一份派生数据，避免每处各解析一遍。 */
export type JobCard = {
  note: Note;
  path: string;
  company: string;
  position: string;
  rating: number;
  status: string;
  /** 最近一次状态变化日（frontmatter `status_updated`）。未応募的笔记通常没有。 */
  statusUpdated: string;
  nextAction: string;
  salaryText: string;
  salary: SalaryRange;
  location: string;
  regions: string[];
  remote: boolean;
  employment: string;
  source: string;
  /** normalizeJobSource(source)。筛选/facet 用这个，卡片详情仍显示 source 原文。 */
  sourceGroup: string;
  url: string;
  officialApplyUrl: string;
  officialApplyStatus: OfficialApplyStatus;
  officialApplyNote: string;
  /** 入库日（frontmatter `date`）＝ AI 推薦がキューに乗った日。応募日でも更新日でもない。 */
  date: string;
  stack: string[];
  reason: string;
  caution: string;
  matches: string[];
  materials: string[];
  verification: JobVerification;
  updatedAt: number;
  haystack: string;
};

export function toJobCard(note: Note): JobCard {
  const company = getString(note.frontmatter.company) || getTitle(note).split(/\s[—–-]\s/)[0].trim();
  const position = jobPosition(note);
  const salaryText = getString(note.frontmatter.salary);
  const location = getString(note.frontmatter.location);
  const source = getString(note.frontmatter.source);
  const stack = jobStack(note);
  const reason = jobSection(note, "推荐理由") || jobSection(note, "推荐理由（技術面）");
  const caution = jobSection(note, "注意点");

  return {
    note,
    path: note.path,
    company,
    position,
    rating: jobRating(note),
    status: jobStatus(note),
    statusUpdated: getString(note.frontmatter.status_updated),
    nextAction: getString(note.frontmatter.next_action),
    salaryText,
    salary: parseSalary(salaryText),
    location,
    regions: jobRegions(location),
    remote: jobRemote(note),
    employment: getString(note.frontmatter.employment),
    source,
    sourceGroup: normalizeJobSource(source),
    url: getString(note.frontmatter.url),
    officialApplyUrl: getString(note.frontmatter.official_apply_url),
    officialApplyStatus: officialApplyStatus(note),
    officialApplyNote: getString(note.frontmatter.official_apply_note),
    date: getString(note.frontmatter.date),
    stack,
    reason,
    caution,
    matches: jobSectionItems(note, "匹配点"),
    materials: jobSectionItems(note, "主打材料"),
    verification: jobVerification(note),
    updatedAt: note.stat.mtime,
    haystack: [company, position, salaryText, location, source, stack.join(" "), stripMarkdown(note.content)]
      .join("\n")
      .toLowerCase(),
  };
}

export type JobSort = "rating" | "salary" | "date" | "updated" | "company";

export const JOB_SORTS: { id: JobSort; label: string }[] = [
  { id: "rating", label: "匹配度" },
  { id: "salary", label: "年収上限" },
  { id: "date", label: "入库时间" },
  { id: "updated", label: "更新时间" },
  { id: "company", label: "公司名" },
];

export function compareJobs(left: JobCard, right: JobCard, sort: JobSort) {
  if (sort === "salary") {
    const diff = (right.salary.max ?? -1) - (left.salary.max ?? -1);
    if (diff !== 0) return diff;
  } else if (sort === "date") {
    // 入库日（`date`）と更新时间（ファイル mtime）は別物。
    // 拒信一通で mtime は動くが入库日は動かない —— 「いつ入ってきたか」はこちらでしか出せない。
    const diff = intakeSortKey(right.date).localeCompare(intakeSortKey(left.date));
    if (diff !== 0) return diff;
  } else if (sort === "updated") {
    const diff = right.updatedAt - left.updatedAt;
    if (diff !== 0) return diff;
  } else if (sort === "company") {
    const diff = left.company.localeCompare(right.company, "ja");
    if (diff !== 0) return diff;
  }
  const byRating = right.rating - left.rating;
  if (byRating !== 0) return byRating;
  return left.company.localeCompare(right.company, "ja");
}

/** 搜索按空格切词后 AND 匹配，`公司名 kafka` 这类组合查询才有用。 */
export function jobMatchesQuery(job: JobCard, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  return query.split(/\s+/).every((token) => job.haystack.includes(token));
}
