"use client";

import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  compareJobs,
  daysBetween,
  intakeLabel,
  intakeRelative,
  isJobStatus,
  jobIntake,
  jobMatchesQuery,
  jobMatchesRatingBands,
  jobStatusNoteError,
  JOB_INTAKES,
  JOB_RATING_BANDS,
  JOB_SORTS,
  JOB_STATUSES,
  JOB_STATUS_NOTE_MAX,
  normalizeDay,
  OFFICIAL_APPLY_LABEL,
  toJobCard,
  VERIFICATION_LABEL,
  type JobCard,
  type JobIntake,
  type JobRatingBand,
  type JobSort,
  type JobStatus,
  type JobVerification,
} from "@/lib/jobs";
import { parseAppliedLedger } from "@/lib/job-stats.mjs";
import { opportunityAppliedOn } from "@/lib/job-opportunity";
import { JOB_CASE_TYPE } from "@/lib/vault-boundary.mjs";
import {
  formatDate,
  getString,
  getTitle,
  getType,
  noteBasename,
  stripFrontmatter,
  type Note,
} from "@/lib/notes";

const SALARY_STEPS = [0, 600, 700, 800, 900, 1000, 1200];

const VERIFICATIONS: JobVerification[] = ["verified", "warned", "unchecked"];

const COMPARE_LIMIT = 3;

/** 结果区的四种视图。卡片/列表/看板共享同一份筛选结果，周复盘看的是全量笔记。 */
const VIEW_MODES = [
  { id: "card", label: "卡片" },
  { id: "list", label: "列表" },
  { id: "kanban", label: "看板" },
  { id: "weekly", label: "周复盘" },
] as const;

type ViewMode = (typeof VIEW_MODES)[number]["id"];

/** 看板里始终显示的核心列，其余状态列只有有数据时才占位。 */
const KANBAN_CORE_STATUSES: JobStatus[] = ["未応募", "応募済", "書類通過", "面接中", "内定"];

/** 选考推进中 KPI 的口径：书类通过之后的阶段。 */
const SELECTION_STATUSES: string[] = ["書類通過", "面接中", "内定"];

/** 一个筛选维度。算联动 facet 计数时用它指出「这一组先不算」。 */
type FilterKey =
  | "query"
  | "statuses"
  | "rating"
  | "salary"
  | "stacks"
  | "regions"
  | "sources"
  | "verifications"
  | "intakes"
  | "remote";

type Filters = {
  statuses: string[];
  ratings: JobRatingBand[];
  minSalary: number;
  stacks: string[];
  regions: string[];
  sources: string[];
  verifications: JobVerification[];
  intakes: JobIntake[];
  remoteOnly: boolean;
};

const EMPTY_FILTERS: Filters = {
  statuses: [],
  ratings: [],
  minSalary: 0,
  stacks: [],
  regions: [],
  sources: [],
  verifications: [],
  intakes: [],
  remoteOnly: false,
};

/**
 * 「岗位机会」は新しい応募先を選ぶ画面。終了案件まで含む全75件を既定表示すると、
 * 高得点の不採用案件が先頭を占めて「次に投る先」が見えなくなる。
 * 全件は状態 chip を外せば見られるため、入口だけ未応募に絞る。
 */
const DEFAULT_OPPORTUNITY_FILTERS: Filters = {
  ...EMPTY_FILTERS,
  statuses: ["未応募"],
};

/** 別画面の数字カードから「その数字の中身」へ飛ぶ時に渡す初期フィルタ。 */
export type JobsInitialFilters = {
  statuses?: string[];
  ratings?: JobRatingBand[];
};

type JobsUrlState = {
  query: string;
  sort: JobSort;
  filters: Filters;
  viewMode: ViewMode;
  weekOffset: number;
  detailPath: string | null;
};

function csvParam(params: URLSearchParams, key: string) {
  return (params.get(key) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readJobsUrlState(initialFilters?: JobsInitialFilters | null): JobsUrlState {
  const params = typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
  const seeded = initialFilters?.statuses?.length || initialFilters?.ratings?.length;
  const statusParam = params.get("status");
  const baseFilters = seeded
    ? {
        ...EMPTY_FILTERS,
        statuses: initialFilters?.statuses ?? [],
        ratings: initialFilters?.ratings ?? [],
      }
    : DEFAULT_OPPORTUNITY_FILTERS;
  const hasUrlFilters = [
    "status",
    "rating",
    "salary",
    "stack",
    "region",
    "source",
    "verification",
    "intake",
    "remote",
  ].some((key) => params.has(key));
  const ratings = csvParam(params, "rating").filter((value): value is JobRatingBand =>
    JOB_RATING_BANDS.some((band) => band.id === value),
  );
  const verifications = csvParam(params, "verification").filter((value): value is JobVerification =>
    VERIFICATIONS.includes(value as JobVerification),
  );
  const intakes = csvParam(params, "intake").filter((value): value is JobIntake =>
    JOB_INTAKES.some((bucket) => bucket.id === value),
  );
  const salary = Number(params.get("salary") ?? 0);
  const sortParam = params.get("sort");
  const modeParam = params.get("mode");
  const week = Number(params.get("week") ?? 0);

  return {
    query: params.get("q") ?? "",
    sort: JOB_SORTS.some((option) => option.id === sortParam) ? sortParam as JobSort : "rating",
    filters: hasUrlFilters
      ? {
          ...EMPTY_FILTERS,
          statuses: statusParam === "all" ? [] : csvParam(params, "status"),
          ratings,
          minSalary: SALARY_STEPS.includes(salary) ? salary : 0,
          stacks: csvParam(params, "stack"),
          regions: csvParam(params, "region"),
          sources: csvParam(params, "source"),
          verifications,
          intakes,
          remoteOnly: params.get("remote") === "1",
        }
      : baseFilters,
    viewMode: VIEW_MODES.some((mode) => mode.id === modeParam) ? modeParam as ViewMode : "card",
    weekOffset: Number.isInteger(week) && Math.abs(week) <= 52 ? week : 0,
    detailPath: params.get("job") || null,
  };
}

function isDefaultOpportunityFilters(filters: Filters) {
  return filters.statuses.length === 1 &&
    filters.statuses[0] === "未応募" &&
    filters.ratings.length === 0 &&
    filters.minSalary === 0 &&
    filters.stacks.length === 0 &&
    filters.regions.length === 0 &&
    filters.sources.length === 0 &&
    filters.verifications.length === 0 &&
    filters.intakes.length === 0 &&
    !filters.remoteOnly;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function salaryLabel(job: JobCard) {
  const { min, max, estimated } = job.salary;
  if (min === null) return job.salaryText || "薪资未记录";
  const range = max !== null && max !== min ? `${min}〜${max}万` : `${min}万〜`;
  return estimated ? `${range}（月給換算）` : range;
}

/** 匹配度色阶：9+ 橙 / 7+ 绿 / 5+ 琥珀 / 其余灰。CSS 里由 `.rate-*` 提供 `--rate`。 */
function rateTone(rating: number) {
  if (rating >= 9) return "high";
  if (rating >= 7) return "good";
  if (rating >= 5) return "mid";
  return "low";
}

/** 状态配色分组。自定义状态（不在枚举里）走中性色。 */
function statusTone(status: string) {
  if (status === "未応募") return "pending";
  if (status === "応募済" || status === "書類通過" || status === "面接中") return "progress";
  if (status === "内定") return "offer";
  if (status === "不採用") return "reject";
  return "neutral";
}

/**
 * 入库时期的强调档。今天进的必须一眼跳出来 —— 卡片按匹配度排时，
 * 新着は列の途中に埋もれる。ここが霞むと「今日は何が増えたか」を目で拾えない。
 */
function intakeTone(intake: JobIntake) {
  if (intake === "today") return "new";
  if (intake === "d3" || intake === "d7") return "recent";
  return "old";
}

/** 周复盘时间线上的小圆点：面接中要比其它「进行中」更显眼，所以单独给橙色。 */
function eventTone(status: string) {
  if (status === "面接中") return "interview";
  return statusTone(status);
}

function clip(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * 联动计数下，某个值在当前上下文里可能一条都没有，于是根本不在 counts 里。
 * 它要是已经被选中，就必须补回选项列表，否则用户取消不掉这个筛选。
 */
function facetOptions(counts: Map<string, number>, selected: string[]) {
  return Array.from(new Set([...counts.keys(), ...selected]))
    .map((value) => ({ value, label: value, count: counts.get(value) ?? 0 }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "ja"));
}

function pad(value: number) {
  return `${value}`.padStart(2, "0");
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 以周一为起点算出第 offset 周（0 = today 所在周）的闭区间，用于周复盘。 */
function weekBounds(today: string, offset: number) {
  const [year, month, day] = today.split("-").map(Number);
  const base = new Date(year, month - 1, day);
  const mondayIndex = (base.getDay() + 6) % 7;
  const start = new Date(year, month - 1, day - mondayIndex + offset * 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return {
    from: isoDate(start),
    to: isoDate(end),
    label: `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`,
  };
}

function dayInRange(raw: string, from: string, to: string) {
  const day = normalizeDay(raw);
  return day !== null && day >= from && day <= to;
}

function dayLabel(raw: string) {
  const day = normalizeDay(raw);
  return day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : "—";
}

/**
 * 周复盘事件锚定在最近一次状态变化日（status_updated）。
 * `date` 是推薦入库日，拿它当事件日会把 7/21 投的岗位画到 7/20（入库那天）。
 * 未応募的笔记没有 status_updated，此时入库日就是唯一事件（AI 新規推薦）。
 */
function eventDay(job: JobCard) {
  return job.statusUpdated || job.date;
}

/** `2026-07-20` → `7/20`。年は今の運用（数か月単位）では邪魔なだけなので落とす。 */
function shortDay(day: string) {
  const match = day.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : day;
}

/**
 * 応募からの経過。**「何日待っているか」は催促の判断に直結する**ので、
 * 相対表示だけにして絶対日付は title に回す（一覧をスキャンしている時に効くのは日数のほう）。
 */
function elapsedLabel(appliedOn: string, today: string) {
  const days = daysBetween(appliedOn, today);
  if (days === null) return "";
  if (days <= 0) return "今日";
  return `${days}日経過`;
}

/** 时间线上的事件文案由状态推导 —— 状态与日期是笔记里的证据，不是 AI 的假设。 */
function eventLabel(job: JobCard) {
  switch (job.status) {
    case "未応募": return `AI が新規推薦（匹配度 ${job.rating}）`;
    case "応募済": return "応募完了";
    case "書類通過": return "書類選考通過";
    case "面接中": return "面接を実施";
    case "内定": return "内定";
    case "不採用": return "不採用";
    default: return job.status;
  }
}

/** 命中的搜索词在卡片文本里高亮，便于确认为什么这条被搜出来。 */
function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return <>{text}</>;
  // 正则交替是最左优先而不是最长优先，先排长词，`java javascript` 才不会把 JavaScript 切成两半。
  const alternatives = [...tokens]
    .sort((left, right) => right.length - left.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${alternatives.join("|")})`, "gi");
  return (
    <>
      {text.split(pattern).map((piece, index) =>
        tokens.includes(piece.toLowerCase())
          ? <mark key={index}>{piece}</mark>
          : <Fragment key={index}>{piece}</Fragment>,
      )}
    </>
  );
}

/** 技術スタック 有四十多个标签，默认只露出高频的几个，避免筛选栏把结果区挤到屏幕外。 */
function FilterChips({
  label,
  options,
  selected,
  onToggle,
  collapseAfter = 0,
}: {
  label: string;
  options: { value: string; label: string; count: number; hint?: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  collapseAfter?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  // 在当前其它条件下选不出任何东西的值直接不显示 —— 但已选中的要留着，否则取消不掉。
  const available = options.filter((option) => option.count > 0 || selected.includes(option.value));
  if (available.length === 0) return null;

  const collapsible = collapseAfter > 0 && available.length > collapseAfter;
  // 联动筛选会让可选项池剧烈伸缩。池子小到不需要折叠时就把展开态收回来：
  // 否则它会一直挂着，等池子涨回去时这一组突然炸开几百像素，把下面的分组顶走，
  // 用户连点两下取消筛选时第二下就会落到别的组上。
  if (expanded && !collapsible) setExpanded(false);

  const collapsed = collapsible && !expanded;
  const shown = collapsed
    ? available.filter((option, index) => index < collapseAfter || selected.includes(option.value))
    : available;
  const hidden = available.length - shown.length;

  return (
    <div className="job-filter-row">
      <span className="job-filter-label">{label}</span>
      <div className="job-chips">
        {shown.map((option) => (
          <button
            key={option.value}
            type="button"
            className={selected.includes(option.value) ? "job-chip active" : "job-chip"}
            aria-pressed={selected.includes(option.value)}
            // 笔记里的自定义状态可能是一整段说明，截断显示，全文交给 tooltip。
            // hint 是分档本身需要解释时（入库时期的各档互斥）由调用方给的补充说明。
            title={option.hint ?? (option.label.length > 12 ? option.label : undefined)}
            onClick={() => onToggle(option.value)}
          >
            <span>{option.label}</span> <small>{option.count}</small>
          </button>
        ))}
        {/* 溢出项刚好全被选中时 hidden 会是 0，那就没有「+0 更多」可点。 */}
        {(hidden > 0 || expanded) && (
          <button
            type="button"
            className="job-chip job-chip-more"
            aria-expanded={!collapsed}
            onClick={() => setExpanded(!expanded)}
          >
            {collapsed ? `+${hidden} 更多` : "收起"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function JobsView({
  notes,
  onOpen,
  onVaultChanged,
  initialFilters,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  onVaultChanged?: () => void | Promise<void>;
  /**
   * 別画面（求職分析の数字カードなど）から遷移してきた時の初期フィルタ。
   * このコンポーネントは view 切替でアンマウントされるので、初期値として一度読むだけでよい。
   * 呼び出し側はナビで直接来た時に null に戻す責任を持つ（memory-atlas.tsx）。
   *
   * status だけでなく rating も受けるのは、「可応募」＝ `未応募 かつ rating 7以上` のように
   * 数字カードの定義が status 単独では表せないため。カードの数字と遷移先の件数が食い違うと、
   * 画面がそのまま嘘になる。
   */
  initialFilters?: JobsInitialFilters | null;
}) {
  const [initialUrlState] = useState(() => readJobsUrlState(initialFilters));
  const [query, setQuery] = useState(initialUrlState.query);
  const [sort, setSort] = useState<JobSort>(initialUrlState.sort);
  const [filters, setFilters] = useState<Filters>(initialUrlState.filters);
  const [viewMode, setViewMode] = useState<ViewMode>(initialUrlState.viewMode);
  const [weekOffset, setWeekOffset] = useState(initialUrlState.weekOffset);
  // 这个面板常挂着不关，「今天」要在跨天后重新取，否则周复盘会一直停在打开那天的那一周。
  const [today, setToday] = useState(() => isoDate(new Date()));
  const [detailPath, setDetailPath] = useState<string | null>(initialUrlState.detailPath);
  const [comparePaths, setComparePaths] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [savingPaths, setSavingPaths] = useState<string[]>([]);
  /**
   * 🔴 書込み失敗は **path をキーにここへ持つ**。操作部品（StatusPicker）の中に持つと、
   * 応答が返る前に抽屉を閉じられた瞬間に部品ごとアンマウントされ、`setFailure` が
   * React の静かな no-op になってエラーが消える。抽屉は背景クリック・×・Esc の
   * どれでも閉じられ、どれも書込み中を待たない。
   */
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * 応募日の**正本**は `20_求職/_応募日台帳.md`。status から拾えるのは `応募済` の間だけで、
   * 先へ進むと同じ位置が段階の日付に変わる（jobs.ts の `jobAppliedOn` 参照）。
   * 台帳に載っていれば不採用になった後でも応募日が残るので、そちらを優先する。
   * 照合は会社名（台帳の「照合名」列があればそれ）。
   */
  const appliedByCompany = useMemo(() => {
    const ledger = notes.find((note) => note.path.endsWith("_応募日台帳.md"));
    const map = new Map<string, string>();
    for (const row of parseAppliedLedger(ledger?.content ?? "")) {
      // 同一社に複数応募がある場合は**最初の応募日**を残す（経過日数を短く見せない）。
      const key = row.matchName;
      if (!map.has(key) || row.appliedOn < (map.get(key) ?? "")) map.set(key, row.appliedOn);
    }
    return map;
  }, [notes]);

  const jobs = useMemo(() => {
    return notes
      .filter((note) => getType(note) === JOB_CASE_TYPE)
      .map(toJobCard)
      .map((job) => ({
        ...job,
        // 台帳は会社単位の照合なので、同じ会社の別求人へ応募日が移る可能性がある。
        // 未応募に応募日が出るのは論理矛盾なので、この状態では台帳補完を使わない。
        appliedOn: opportunityAppliedOn(
          job.status,
          job.appliedOn,
          appliedByCompany.get(job.company),
        ),
        // 笔记里同一个技術スタック 可能写重复，不去重会撞 React key，facet 计数也会比结果多。
        stack: Array.from(new Set(job.stack)),
      }));
  }, [notes, appliedByCompany]);

  /**
   * facet 计数是「联动」的：每组的数字都算在**其它所有条件已生效**的前提下。
   * 每组要排除自己，否则多选组里没选中的项会全变 0，就再也加不上第二个值了。
   */
  const narrow = useCallback(
    (except?: FilterKey) => {
      const keep = (key: FilterKey, predicate: () => boolean) => key === except || predicate();
      return jobs.filter((job) =>
        keep("query", () => jobMatchesQuery(job, query)) &&
        keep("statuses", () => filters.statuses.length === 0 || filters.statuses.includes(job.status)) &&
        keep("rating", () => jobMatchesRatingBands(job.rating, filters.ratings)) &&
        keep("salary", () => filters.minSalary === 0 || (job.salary.max ?? 0) >= filters.minSalary) &&
        keep("stacks", () => filters.stacks.length === 0 || job.stack.some((tag) => filters.stacks.includes(tag))) &&
        keep("regions", () => filters.regions.length === 0 || job.regions.some((region) => filters.regions.includes(region))) &&
        keep("sources", () => filters.sources.length === 0 || filters.sources.includes(job.sourceGroup)) &&
        keep("verifications", () => filters.verifications.length === 0 || filters.verifications.includes(job.verification)) &&
        keep("intakes", () => filters.intakes.length === 0 || filters.intakes.includes(jobIntake(job.date, today))) &&
        keep("remote", () => !filters.remoteOnly || job.remote),
      );
    },
    // today 进依赖是必须的：跨天后「今日」那一档要重算，否则面板挂一夜就永远停在昨天。
    [jobs, query, filters, today],
  );

  const facets = useMemo(() => {
    const count = (pool: JobCard[], values: (job: JobCard) => string[]) => {
      const map = new Map<string, number>();
      pool.forEach((job) => values(job).forEach((value) => map.set(value, (map.get(value) ?? 0) + 1)));
      return map;
    };
    return {
      statuses: count(narrow("statuses"), (job) => [job.status]),
      stacks: count(narrow("stacks"), (job) => job.stack),
      regions: count(narrow("regions"), (job) => job.regions),
      sources: count(narrow("sources"), (job) => (job.sourceGroup ? [job.sourceGroup] : [])),
      verifications: count(narrow("verifications"), (job) => [job.verification]),
      intakes: count(narrow("intakes"), (job) => [jobIntake(job.date, today)]),
      ratingPool: narrow("rating"),
      salaryPool: narrow("salary"),
      remote: narrow("remote").filter((job) => job.remote).length,
    };
  }, [narrow, today]);

  /**
   * 状态选项：枚举顺序在前、自定义状态在后。
   * 计数归零的项会被 FilterChips 隐藏，但已选中的必须留着，否则取消不掉。
   */
  const statusOptions = useMemo(() => {
    const seen = new Set([...facets.statuses.keys(), ...filters.statuses]);
    const known = JOB_STATUSES.filter((status) => seen.has(status));
    const custom = Array.from(seen)
      .filter((status) => !isJobStatus(status))
      .sort((left, right) => left.localeCompare(right, "ja"));
    return [...known, ...custom].map((status) => ({
      value: status,
      label: status,
      count: facets.statuses.get(status) ?? 0,
    }));
  }, [facets.statuses, filters.statuses]);

  const visible = useMemo(
    () => narrow().sort((left, right) => compareJobs(left, right, sort)),
    [narrow, sort],
  );

  /** 看板列：枚举顺序在前，核心五列常驻；笔记里出现的自定义状态补在末尾，避免岗位被吞掉。 */
  const kanbanColumns = useMemo(() => {
    const custom = Array.from(new Set(visible.map((job) => job.status)))
      .filter((status) => !isJobStatus(status))
      .sort((left, right) => left.localeCompare(right, "ja"));
    return [...JOB_STATUSES, ...custom]
      .map((status) => ({ status, jobs: visible.filter((job) => job.status === status) }))
      .filter((column) => column.jobs.length > 0 || KANBAN_CORE_STATUSES.includes(column.status as JobStatus));
  }, [visible]);

  const week = useMemo(() => weekBounds(today, weekOffset), [today, weekOffset]);

  const weekEvents = useMemo(() => {
    return jobs
      .filter((job) => dayInRange(eventDay(job), week.from, week.to))
      .sort(
        (left, right) =>
          eventDay(right).localeCompare(eventDay(left)) ||
          left.company.localeCompare(right.company, "ja"),
      );
  }, [jobs, week]);

  const weekKpis = useMemo(() => {
    const count = (predicate: (job: JobCard) => boolean) => jobs.filter(predicate).length;
    return [
      {
        label: "本周应募 / 进展",
        tone: "green",
        // 不採用也是这一周真实发生的选考动态（应募次日就书类落ち的会只剩这一条记录），
        // 所以口径是「状态在本周变化到未応募以外」，而不是只数还活着的。
        value: count((job) => job.status !== "未応募" && dayInRange(eventDay(job), week.from, week.to)),
      },
      { label: "面接进行中", tone: "orange", value: count((job) => job.status === "面接中") },
      { label: "选考推进中", tone: "ink", value: count((job) => SELECTION_STATUSES.includes(job.status)) },
      { label: "待投递（8+）", tone: "gold", value: count((job) => job.status === "未応募" && job.rating >= 8) },
    ];
  }, [jobs, week]);

  const nextFocus = useMemo(() => {
    const items: { path: string; company: string; action: string }[] = [];
    const push = (job: JobCard, action: string) => {
      items.push({ path: job.path, company: job.company, action: job.caution ? `${action}${job.caution}` : action });
    };
    jobs.forEach((job) => {
      if (job.status === "面接中") push(job, "面接準備・逆質問の整理。");
      else if (job.status === "書類通過") push(job, "面接日程を調整。");
    });
    jobs
      .filter((job) => job.status === "未応募" && job.rating >= 9)
      .forEach((job) => push(job, "今週中に優先応募。"));
    // 7〜8 分的残弹不该沉默地躺在池子里：要么投掉要么明确弃掉，波次才能宣告投げ切り。
    jobs
      .filter((job) => job.status === "未応募" && job.rating >= 7 && job.rating < 9)
      .forEach((job) => push(job, "応募するか見送るか判断。"));
    return items.slice(0, 4);
  }, [jobs]);

  /** 本周的叙事复盘笔记（80_AI分析/…週次復盤…，type: ai-report）。只认日期落在显示周内的那份。 */
  const weekReview = useMemo(() => {
    const candidates = notes.filter((note) => {
      if (getType(note) !== "ai-report") return false;
      if (!/週次復盤|周复盘|週復盤/.test(noteBasename(note.path))) return false;
      const day = getString(note.frontmatter.date) || noteBasename(note.path);
      return dayInRange(day, week.from, week.to);
    });
    // 同一周写了多份时取文件名最新的一份（文件名以日期开头，字典序即时间序）。
    return candidates.sort((left, right) => right.path.localeCompare(left.path))[0] ?? null;
  }, [notes, week]);

  /** 复盘笔记里的 [[wiki链接]]：能在库里找到目标就打开，找不到就保持纯文本。 */
  const openWikiLink = useCallback(
    (target: string) => {
      const base = target.split("|")[0].split("#")[0].trim();
      const note =
        notes.find((item) => noteBasename(item.path) === base) ??
        notes.find((item) => item.path.endsWith(`/${base}.md`));
      if (note) onOpen(note);
    },
    [notes, onOpen],
  );

  const jobPaths = useMemo(() => new Set(jobs.map((job) => job.path)), [jobs]);
  const detail = jobs.find((job) => job.path === detailPath) ?? null;
  const detailOpen = detail !== null;

  // 笔记被删掉 / 移出 AI 推薦目录后，comparePaths 里会留下失效路径；
  // 一切判断都走这份已对账的 compared，免得幽灵岗位占着对比名额。
  const compared = comparePaths
    .map((path) => jobs.find((job) => job.path === path))
    .filter((job): job is JobCard => Boolean(job));
  const compareFull = compared.length >= COMPARE_LIMIT;

  const activeFilterCount =
    filters.statuses.length +
    filters.stacks.length +
    filters.regions.length +
    filters.sources.length +
    filters.verifications.length +
    filters.intakes.length +
    filters.ratings.length +
    (filters.minSalary > 0 ? 1 : 0) +
    (filters.remoteOnly ? 1 : 0);

  const resetFilters = () => {
    setFilters(DEFAULT_OPPORTUNITY_FILTERS);
    setQuery("");
  };

  const toggleCompare = (path: string) => {
    // 每次都先按现有笔记对账一遍，被删掉的岗位不该继续占着 COMPARE_LIMIT 的名额。
    setComparePaths((current) => {
      const live = current.filter((item) => jobPaths.has(item));
      if (live.includes(path)) return live.filter((item) => item !== path);
      if (live.length >= COMPARE_LIMIT) return live;
      return [...live, path];
    });
    if (compared.length <= 2 && compared.some((job) => job.path === path)) setCompareOpen(false);
  };

  /**
   * 🔴 楽観更新はしない。以前は即座に新 status を当てていたが、既定のフィルタが
   * `statuses: ["未応募"]` なので、その瞬間にカードが `visible` から外れて StatusPicker ごと
   * アンマウントされ、書込みが失敗しても**エラーを出す相手がもう居ない**。
   * 抽屉は `visible` を経由しないので抽屉だけエラーが出る、という非対称が実際に起きた
   * （2026-07-30 ミロク情報サービス）。`saving` が「写入中…」を出すので楽観更新は元々不要。
   *
   * 失敗理由は `statusErrors[path]` に積む（部品ローカルに持てない理由はそこのコメント）。
   * 戻り値は呼び出し元が「注記エディタを閉じてよいか」を判断するためだけのもの。
   */
  const dismissStatusError = useCallback((path: string) => {
    setStatusErrors((current) => {
      if (!(path in current)) return current;
      const next = { ...current };
      delete next[path];
      return next;
    });
  }, []);

  const changeStatus = useCallback(
    async (path: string, status: string, statusNote = ""): Promise<string | null> => {
      setSavingPaths((current) => current.includes(path) ? current : [...current, path]);
      setStatusErrors((current) => {
        if (!(path in current)) return current;
        const next = { ...current };
        delete next[path];
        return next;
      });
      try {
        const response = await fetch("/api/jobs/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, status, statusNote }),
        });
        const payload = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error || "写入 Vault 失败");
        // 再取得が終わるまで savingPaths を落とさない（finally は await の後）。
        // そうしないと一瞬だけ古い値に戻って、書けたのか失敗したのか読めなくなる。
        await onVaultChanged?.();
        return null;
      } catch (error) {
        const message = error instanceof Error ? error.message : "写入 Vault 失败";
        setStatusErrors((current) => ({ ...current, [path]: message }));
        return message;
      } finally {
        setSavingPaths((current) => current.filter((item) => item !== path));
      }
    },
    [onVaultChanged],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (compareOpen) setCompareOpen(false);
        else if (detailOpen) setDetailPath(null);
        return;
      }
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compareOpen, detailOpen]);

  useEffect(() => {
    const sync = () => setToday((current) => {
      const now = isoDate(new Date());
      return now === current ? current : now;
    });
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      const next = readJobsUrlState();
      setQuery(next.query);
      setSort(next.sort);
      setFilters(next.filters);
      setViewMode(next.viewMode);
      setWeekOffset(next.weekOffset);
      setDetailPath(next.detailPath);
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (!isDefaultOpportunityFilters(filters)) {
      params.set("status", filters.statuses.length ? filters.statuses.join(",") : "all");
      if (filters.ratings.length) params.set("rating", filters.ratings.join(","));
      if (filters.minSalary > 0) params.set("salary", String(filters.minSalary));
      if (filters.stacks.length) params.set("stack", filters.stacks.join(","));
      if (filters.regions.length) params.set("region", filters.regions.join(","));
      if (filters.sources.length) params.set("source", filters.sources.join(","));
      if (filters.verifications.length) params.set("verification", filters.verifications.join(","));
      if (filters.intakes.length) params.set("intake", filters.intakes.join(","));
      if (filters.remoteOnly) params.set("remote", "1");
    }
    if (sort !== "rating") params.set("sort", sort);
    if (viewMode !== "card") params.set("mode", viewMode);
    if (viewMode === "weekly" && weekOffset !== 0) params.set("week", String(weekOffset));
    if (detailPath) params.set("job", detailPath);
    const queryString = params.toString();
    window.history.replaceState(
      { ...(window.history.state ?? {}), __echoAppView: "jobs" },
      "",
      `${window.location.pathname}${queryString ? `?${queryString}` : ""}`,
    );
  }, [detailPath, filters, query, sort, viewMode, weekOffset]);

  const notAppliedJobs = jobs.filter((job) => job.status === "未応募");
  const readyJobs = notAppliedJobs
    .filter((job) => job.rating >= 7)
    .sort((left, right) => compareJobs(left, right, "rating"));
  const nextPick =
    readyJobs[0] ??
    [...notAppliedJobs].sort((left, right) => compareJobs(left, right, "rating"))[0] ??
    null;
  const highlightedNextPick =
    viewMode === "card" &&
    sort === "rating" &&
    query.trim() === "" &&
    isDefaultOpportunityFilters(filters)
      ? nextPick
      : null;
  const resultVisible = highlightedNextPick
    ? visible.filter((job) => job.path !== highlightedNextPick.path)
    : visible;
  const recentNotApplied = notAppliedJobs.filter((job) =>
    ["today", "d3", "d7"].includes(jobIntake(job.date, today)),
  ).length;
  const verifiedNotApplied = notAppliedJobs.filter((job) => job.verification === "verified").length;

  const isJobList = viewMode !== "weekly";

  return (
    <section className="jobs-view">
      {highlightedNextPick && (
        <section className="jobs-next-pick" aria-label="下一项応募判断">
          <span className={`jobs-next-score rate-${rateTone(highlightedNextPick.rating)}`}>
            <strong>{highlightedNextPick.rating}</strong>
            <small>/ 10</small>
          </span>
          <div className="jobs-next-copy">
            <span>NEXT DECISION</span>
            <h2>{highlightedNextPick.company}</h2>
            <p>{highlightedNextPick.position}</p>
            <small>
              {readyJobs.length > 0
                ? clip(highlightedNextPick.reason || "达到当前可投线，打开详情确认硬性条件与风险。", 110)
                : "当前没有达到 7 分线的未应募岗位；先复核最高分候选，不自动建议投递。"}
            </small>
          </div>
          <dl className="jobs-next-facts">
            <div>
              <dt>年収</dt>
              <dd>{salaryLabel(highlightedNextPick)}</dd>
            </div>
            <div>
              <dt>原文</dt>
              <dd>{VERIFICATION_LABEL[highlightedNextPick.verification]}</dd>
            </div>
          </dl>
          <button type="button" onClick={() => setDetailPath(highlightedNextPick.path)}>
            判断是否応募 <span aria-hidden="true">→</span>
          </button>
        </section>
      )}

      <div className="jobs-stat page-stat-strip module-stat-strip" aria-label="当前岗位机会摘要">
        <div data-zero={notAppliedJobs.length === 0}><strong>{notAppliedJobs.length}</strong><span>未应募</span></div>
        <div data-zero={readyJobs.length === 0}><strong>{readyJobs.length}</strong><span>7 分以上待判断</span></div>
        <div data-zero={recentNotApplied === 0}><strong>{recentNotApplied}</strong><span>7 日内新增</span></div>
        <div data-zero={verifiedNotApplied === 0}><strong>{verifiedNotApplied}</strong><span>原文已核对</span></div>
      </div>

      <div className="jobs-body">
        <details className="jobs-filter-panel">
          <summary>
            <span>
              <b>筛选条件</b>
              <small>
                {activeFilterCount > 0
                  ? `已启用 ${activeFilterCount} 项${filters.statuses.length === 1 && filters.statuses[0] === "未応募" ? " · 默认只看未応募" : ""}`
                  : "当前显示全部岗位"}
              </small>
            </span>
            <em aria-hidden="true" />
          </summary>
          <div className="jobs-filter-sticky">
            <div className="jobs-filter-head">
              <span>组合筛选 · FILTERS</span>
              <button type="button" className="jobs-filter-reset" onClick={resetFilters}>
                恢复默认
              </button>
            </div>

            <div className="jobs-filter-groups">
              <FilterChips
                label="应募状态"
                options={statusOptions}
                selected={filters.statuses}
                onToggle={(value) => setFilters((current) => ({ ...current, statuses: toggle(current.statuses, value) }))}
              />

              {/* 顺序固定按「新→旧」，不像 facetOptions 那样按计数排 —— 时间轴重排了就读不成时间轴了。 */}
              <FilterChips
                label="入库时期"
                options={JOB_INTAKES.map((bucket) => ({
                  value: bucket.id,
                  label: bucket.label,
                  hint: bucket.hint,
                  count: facets.intakes.get(bucket.id) ?? 0,
                }))}
                selected={filters.intakes}
                onToggle={(value) =>
                  setFilters((current) => ({
                    ...current,
                    intakes: toggle(current.intakes, value as JobIntake),
                  }))
                }
              />

              <FilterChips
                label="匹配度"
                options={JOB_RATING_BANDS.map((band) => ({
                  value: band.id,
                  label: band.label,
                  hint: band.hint,
                  count: facets.ratingPool.filter((job) => jobMatchesRatingBands(job.rating, [band.id])).length,
                }))}
                selected={filters.ratings}
                onToggle={(value) =>
                  setFilters((current) => ({
                    ...current,
                    ratings: toggle(current.ratings, value as JobRatingBand),
                  }))
                }
              />

              {/* 来源在年収より上：応募経路の混在（ワークポート起票以降 6 経路超）で、
                  「どこ由来の求人か」が年収より先に効く絞り込みになった（2026-07-27 本人指示）。 */}
              <FilterChips
                label="来源"
                options={facetOptions(facets.sources, filters.sources)}
                selected={filters.sources}
                onToggle={(value) => setFilters((current) => ({ ...current, sources: toggle(current.sources, value) }))}
              />

              <div className="job-filter-row">
                <span className="job-filter-label">年収上限</span>
                <div className="job-chips">
                  {SALARY_STEPS.map((step) => {
                    const count = facets.salaryPool.filter((job) => (job.salary.max ?? 0) >= step).length;
                    const active = filters.minSalary === step;
                    return (
                      <button
                        key={step}
                        type="button"
                        className={`job-chip${active ? " active" : ""}${count === 0 && !active ? " empty" : ""}`}
                        aria-pressed={active}
                        onClick={() => setFilters((current) => ({ ...current, minSalary: step }))}
                      >
                        <span>{step === 0 ? "全部" : `${step}万+`}</span> <small>{count}</small>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`job-chip${filters.remoteOnly ? " active" : ""}${facets.remote === 0 && !filters.remoteOnly ? " empty" : ""}`}
                    aria-pressed={filters.remoteOnly}
                    onClick={() => setFilters((current) => ({ ...current, remoteOnly: !current.remoteOnly }))}
                  >
                    <span>リモート可</span> <small>{facets.remote}</small>
                  </button>
                </div>
              </div>

              <FilterChips
                label="技術スタック"
                collapseAfter={12}
                options={facetOptions(facets.stacks, filters.stacks)}
                selected={filters.stacks}
                onToggle={(value) => setFilters((current) => ({ ...current, stacks: toggle(current.stacks, value) }))}
              />

              <FilterChips
                label="勤務地"
                options={facetOptions(facets.regions, filters.regions)}
                selected={filters.regions}
                onToggle={(value) => setFilters((current) => ({ ...current, regions: toggle(current.regions, value) }))}
              />

              <FilterChips
                label="原文核对"
                options={VERIFICATIONS.map((key) => ({
                  value: key,
                  label: VERIFICATION_LABEL[key],
                  count: facets.verifications.get(key) ?? 0,
                }))}
                selected={filters.verifications}
                onToggle={(value) =>
                  setFilters((current) => ({
                    ...current,
                    verifications: toggle(current.verifications, value as JobVerification),
                  }))
                }
              />
            </div>
          </div>
        </details>

        <div className="jobs-results">
          <div className="jobs-toolbar">
            <div className="job-search">
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索公司、职位、技术栈、推荐理由…"
                aria-label="搜索推荐岗位"
              />
              {query ? (
                <button type="button" className="job-search-clear" onClick={() => setQuery("")} aria-label="清空搜索">×</button>
              ) : (
                <kbd>/</kbd>
              )}
            </div>
            <label className="job-sort">
              <span>排序</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as JobSort)}>
                {JOB_SORTS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="jobs-view-switch" role="group" aria-label="视图切换">
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={viewMode === mode.id ? "active" : undefined}
                  aria-pressed={viewMode === mode.id}
                  onClick={() => setViewMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {isJobList && (
            <div className="jobs-result-bar">
              <span>
                {highlightedNextPick ? "其余 " : ""}<strong>{resultVisible.length}</strong> / {jobs.length} 条
                {query && <> · 关键词「{query.trim()}」</>}
              </span>
              <span className="jobs-filter-count">已选 {activeFilterCount} 个筛选</span>
            </div>
          )}

          {jobs.length === 0 && (
            <div className="jobs-empty">
              <p>还没有可以展示的岗位机会。</p>
              <small>在 Vault 的 <code>20_求職/</code> 下新建 <code>type: job-case</code> 的应募案件即可显示；AI 推荐只是 <code>origin</code> 的一种。</small>
            </div>
          )}

          {jobs.length > 0 && isJobList && visible.length === 0 && (
            <div className="jobs-empty">
              <p>没有岗位同时满足这些条件。</p>
              <button type="button" className="job-detail" onClick={resetFilters}>清空筛选</button>
            </div>
          )}

          {jobs.length > 0 && highlightedNextPick && resultVisible.length === 0 && (
            <div className="jobs-featured-only">当前筛选下只有上方这一项需要判断。</div>
          )}

          {jobs.length > 0 && viewMode === "card" && resultVisible.length > 0 && (
            <div className="jobs-grid">
              {resultVisible.map((job) => (
                <JobCardView
                  key={job.path}
                  job={job}
                  query={query}
                  today={today}
                  compared={comparePaths.includes(job.path)}
                  compareFull={compareFull}
                  saving={savingPaths.includes(job.path)}
                  onDetail={() => setDetailPath(job.path)}
                  onCompare={() => toggleCompare(job.path)}
                  onStatus={(status, note) => changeStatus(job.path, status, note)}
                />
              ))}
            </div>
          )}

          {jobs.length > 0 && viewMode === "list" && resultVisible.length > 0 && (
            <JobListView jobs={resultVisible} query={query} today={today} onDetail={setDetailPath} />
          )}

          {jobs.length > 0 && viewMode === "kanban" && visible.length > 0 && (
            <JobKanbanView columns={kanbanColumns} query={query} onDetail={setDetailPath} />
          )}

          {jobs.length > 0 && viewMode === "weekly" && (
            <JobWeeklyView
              offset={weekOffset}
              range={week.label}
              kpis={weekKpis}
              events={weekEvents}
              focus={nextFocus}
              review={weekReview}
              onShift={(delta) => setWeekOffset((current) => current + delta)}
              onDetail={setDetailPath}
              onOpenReview={onOpen}
              onWiki={openWikiLink}
            />
          )}
        </div>
      </div>

      {compared.length > 0 && (
        <div className="job-compare-tray" role="region" aria-label="对比候选">
          <span className="job-compare-count">{compared.length} / {COMPARE_LIMIT} 已选</span>
          <div className="job-compare-items">
            {compared.map((job) => (
              <button key={job.path} type="button" onClick={() => toggleCompare(job.path)}>
                {job.company} <i aria-hidden="true">×</i>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="job-compare-open"
            onClick={() => setCompareOpen(true)}
            disabled={compared.length < 2}
          >
            并排对比
          </button>
          <button type="button" className="job-compare-clear" onClick={() => { setComparePaths([]); setCompareOpen(false); }}>清空</button>
        </div>
      )}

      {detail && (
        <JobDrawer
          job={detail}
          today={today}
          saving={savingPaths.includes(detail.path)}
          compared={comparePaths.includes(detail.path)}
          compareFull={compareFull}
          onClose={() => setDetailPath(null)}
          onStatus={(status, note) => changeStatus(detail.path, status, note)}
          onCompare={() => toggleCompare(detail.path)}
          onOpenNote={() => onOpen(detail.note)}
        />
      )}

      {compareOpen && compared.length >= 2 && (
        <JobCompare jobs={compared} onClose={() => setCompareOpen(false)} onDetail={(path) => {
          setCompareOpen(false);
          setDetailPath(path);
        }} />
      )}

      {/*
        🔴 書込み失敗の表示は**ここ一箇所だけ**。操作部品の隣に出す案を2回試して2回とも
        見えなくなった：①部品ローカル state → 応答前に抽屉を閉じるとアンマウントで消える
        ②カードにインライン → そのカードがスクロール外なら結局見えない。
        描画場所を増やすたびに「見えない条件」が増えるので、
        マウント状態にもスクロール位置にもビュー種別にも依存しない固定層に集約する。
        会社名を必ず添えるので、部品から離れてもどの案件か 迷わない。
      */}
      {Object.keys(statusErrors).length > 0 && (
        <div className="job-status-orphan-alerts" role="alert">
          {Object.entries(statusErrors).map(([path, message]) => (
            <p key={path}>
              <b>{jobs.find((job) => job.path === path)?.company ?? noteBasename(path)}</b>
              <span>没有写入。{message}</span>
              <button type="button" onClick={() => dismissStatusError(path)} aria-label="关闭提示">×</button>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 状態と**その理由**を1つの操作にまとめる。7 枚举だけでは「募集終了」「推薦不可」「取扱終了」が
 * 全部ただの `不採用` に潰れ、後から死因を追えなくなる（2026-07-30 ミロク情報サービスの
 * 募集終了で表面化）。プルダウンは今までどおり1操作で確定し、理由は任意で足す形にしてある。
 */
function StatusPicker({
  value,
  note,
  today,
  saving,
  onChange,
}: {
  value: string;
  note: string;
  today: string;
  saving: boolean;
  onChange: (status: string, note: string) => Promise<string | null>;
}) {
  const customValue = value && !isJobStatus(value) ? value : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const draftError = jobStatusNoteError(draft);

  const openEditor = () => {
    // 既存注記があれば編集、無ければ vault 表記（日付が先頭）の書き出しを置いておく。
    setDraft(note || `${today}・`);
    setEditing(true);
  };

  const submit = async () => {
    if (draftError) return;
    if (!(await onChange(value, draft))) setEditing(false);
  };

  return (
    <div className="job-status-control" onClick={(event) => event.stopPropagation()}>
      <div className="job-status-row">
        <label
          className={`job-status-picker tone-${statusTone(value)}${saving ? " saving" : ""}`}
          title={customValue ?? undefined}
        >
          <select
            value={value}
            disabled={saving}
            aria-label="应募状态"
            onChange={(event) => void onChange(event.target.value, "")}
          >
            {customValue && <option value={customValue}>{customValue}</option>}
            {JOB_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <span aria-hidden="true">{saving ? "写入中…" : value}</span>
        </label>
        <button
          type="button"
          className={`job-status-note-toggle${note ? " filled" : ""}`}
          disabled={saving}
          aria-expanded={editing}
          title={note ? `理由：${note}` : "给这个状态补一句理由"}
          onClick={() => (editing ? setEditing(false) : openEditor())}
        >
          {note ? "✎" : "＋"}
        </button>
      </div>

      {note && !editing && <p className="job-status-note">{note}</p>}

      {editing && (
        <div className="job-status-note-edit">
          <input
            type="text"
            value={draft}
            autoFocus
            maxLength={JOB_STATUS_NOTE_MAX}
            placeholder="例：2026-07-30・募集終了で応募機会なし"
            aria-label="状态理由"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); void submit(); }
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <button type="button" disabled={saving || Boolean(draftError)} onClick={() => void submit()}>
            保存
          </button>
          <button type="button" onClick={() => setEditing(false)}>取消</button>
          {draftError && <small className="job-status-note-error">{draftError}</small>}
        </div>
      )}
    </div>
  );
}

function JobCardView({
  job,
  query,
  today,
  compared,
  compareFull,
  saving,
  onDetail,
  onCompare,
  onStatus,
}: {
  job: JobCard;
  query: string;
  today: string;
  compared: boolean;
  compareFull: boolean;
  saving: boolean;
  onDetail: () => void;
  onCompare: () => void;
  onStatus: (status: string, note: string) => Promise<string | null>;
}) {
  return (
    <article className={`job-card${compared ? " compared" : ""}`} onClick={onDetail}>
      <header className="job-card-head">
        <div className="job-card-id">
          <span
            className={`job-rate-badge rate-${rateTone(job.rating)}`}
            role="img"
            aria-label={`匹配度 ${job.rating}，满分 10`}
          >
            {job.rating}
          </span>
          <div className="job-card-titles">
            <h2><Highlight text={job.company} query={query} /></h2>
            {job.position && <p className="job-position"><Highlight text={job.position} query={query} /></p>}
          </div>
        </div>
        <span className={`job-verify verify-${job.verification}`}>{VERIFICATION_LABEL[job.verification]}</span>
      </header>

      <div className="job-salary-row">
        {/* 解析不出年収区间时退回笔记原文，字号跟着降下来，免得一行长文顶掉卡片的层级。 */}
        <span className={`job-salary-figure${job.salary.min === null ? " is-text" : ""}`}>{salaryLabel(job)}</span>
        <span className="job-rate-meta">匹配度 {job.rating}/10</span>
      </div>

      {/* 入库日は常に出す：欠けている（＝「入库日不明」）ことも読み取れる情報なので黙って消さない。 */}
      <div className="job-facts">
        <span
          className={`job-intake tone-${intakeTone(jobIntake(job.date, today))}`}
          title={job.date ? `入库日 ${job.date}` : "笔记 frontmatter 里没有 date"}
        >
          入库 {intakeLabel(job.date, today)}
        </span>
        {/* 応募日は「投げてから何日たったか」を出すために入库日とは別に見せる。
            入库日で代用すると 7/20 に入って 7/24 に投げた案件が4日ずれる。 */}
        {job.appliedOn && (
          <span className="job-applied" title={`応募日 ${job.appliedOn}`}>
            応募 {shortDay(job.appliedOn)}
            <em>{elapsedLabel(job.appliedOn, today)}</em>
          </span>
        )}
        {job.employment && <span>{job.employment}</span>}
        {job.location && <span><Highlight text={job.location} query={query} /></span>}
        {job.remote && <span className="job-remote">リモート可</span>}
      </div>

      {job.stack.length > 0 && (
        <div className="job-stack">
          {job.stack.slice(0, 7).map((tag) => <span key={tag}><Highlight text={tag} query={query} /></span>)}
          {job.stack.length > 7 && <span className="job-stack-more">+{job.stack.length - 7}</span>}
        </div>
      )}

      {job.reason && (
        <div className="job-block">
          <span className="job-block-label">推荐理由</span>
          <p><Highlight text={clip(job.reason, 92)} query={query} /></p>
        </div>
      )}

      <footer className="job-card-foot" onClick={(event) => event.stopPropagation()}>
        <StatusPicker
              value={job.status}
              note={job.statusNote}
              today={today}
              saving={saving}
              onChange={onStatus}
            />
        <button
          type="button"
          className={compared ? "job-compare-toggle active" : "job-compare-toggle"}
          aria-pressed={compared}
          disabled={!compared && compareFull}
          title={!compared && compareFull ? `最多同时对比 ${COMPARE_LIMIT} 个岗位` : "加入对比"}
          onClick={onCompare}
        >
          {compared ? "已加入对比" : "对比"}
        </button>
        <button type="button" className="job-detail" onClick={onDetail}>详情</button>
        {job.officialApplyUrl && (
          <a
            className="job-link job-official-link"
            href={job.officialApplyUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            {job.officialApplyStatus === "exact" ? "官网直投 ↗" : job.officialApplyStatus === "related" ? "官网相近职位 ↗" : "官网招聘 ↗"}
          </a>
        )}
        {job.url && job.url !== job.officialApplyUrl && (
          <a
            className="job-link"
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            求人票 ↗
          </a>
        )}
      </footer>
    </article>
  );
}

/** 列表视图：一行一个岗位，密度最高，用来快速扫全量结果。 */
function JobListView({
  jobs,
  query,
  today,
  onDetail,
}: {
  jobs: JobCard[];
  query: string;
  today: string;
  onDetail: (path: string) => void;
}) {
  return (
    <div className="job-list">
      <div className="job-list-head" aria-hidden="true">
        <span>公司 / 职位</span>
        <span>匹配</span>
        <span>年収</span>
        <span>技術スタック</span>
        <span>入库</span>
        <span>状态</span>
        <span>核对</span>
      </div>
      {jobs.map((job) => (
        <button key={job.path} type="button" className="job-list-row" onClick={() => onDetail(job.path)}>
          <span className="job-list-title">
            <strong><Highlight text={job.company} query={query} /></strong>
            <small><Highlight text={job.position || "—"} query={query} /></small>
          </span>
          <span className={`job-list-rate rate-${rateTone(job.rating)}`}>{job.rating}</span>
          <span className="job-list-salary">{salaryLabel(job)}</span>
          <span className="job-list-stack">
            {job.stack.map((tag) => <i key={tag}>{tag}</i>)}
          </span>
          {/* 「入库时间」で並べ替えても列がないと順序の根拠が読めないので、リストにも出す。 */}
          <span
            className={`job-list-intake tone-${intakeTone(jobIntake(job.date, today))}`}
            title={job.date ? `入库日 ${job.date}` : "笔记 frontmatter 里没有 date"}
          >
            {intakeLabel(job.date, today)}
          </span>
          <span className={`job-status-pill tone-${statusTone(job.status)}`} title={job.status}>{job.status}</span>
          <span className={`job-verify verify-${job.verification}`}>{VERIFICATION_LABEL[job.verification]}</span>
        </button>
      ))}
    </div>
  );
}

/** 看板视图：按 `status` 分列，列顺序即 `JOB_STATUSES`。结构按拖拽改状态预留。 */
function JobKanbanView({
  columns,
  query,
  onDetail,
}: {
  columns: { status: string; jobs: JobCard[] }[];
  query: string;
  onDetail: (path: string) => void;
}) {
  return (
    <div className="job-kanban">
      {columns.map((column) => (
        <section key={column.status} className={`job-kanban-col tone-${statusTone(column.status)}`}>
          <header className="job-kanban-head">
            <strong title={column.status}>{column.status}</strong>
            <span>{column.jobs.length}</span>
          </header>
          <div className="job-kanban-body">
            {column.jobs.map((job) => (
              <button
                key={job.path}
                type="button"
                className={`job-kanban-card rate-${rateTone(job.rating)}`}
                onClick={() => onDetail(job.path)}
              >
                <span className="job-kanban-title">
                  <strong><Highlight text={job.company} query={query} /></strong>
                  <i>{job.rating}</i>
                </span>
                <small><Highlight text={job.position || "—"} query={query} /></small>
                <span className="job-kanban-salary">{salaryLabel(job)}</span>
              </button>
            ))}
            {column.jobs.length === 0 && <span className="job-kanban-empty">—</span>}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * 复盘笔记的轻量 Markdown 渲染。只覆盖复盘实际用到的语法
 * （##〜#### 标题／表格／列表／引用／粗体／行内码／[[wiki链接]]），刻意不引第三方库。
 */
type MdBlock =
  | { kind: "heading"; depth: number; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "para"; text: string };

function parseMdBlocks(content: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = content.split("\n");
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed || /^-{3,}$/.test(trimmed)) {
      index += 1;
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: "heading", depth: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quote.filter(Boolean) });
      continue;
    }
    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        const cells = lines[index].trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
        // |---|---| 是对齐行，不是数据
        if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) rows.push(cells);
        index += 1;
      }
      const [header = [], ...body] = rows;
      blocks.push({ kind: "table", header, rows: body });
      continue;
    }
    if (/^(?:[-*]|\d+\.)\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].trim().match(/^(?:[-*]|\d+\.)\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    const para: string[] = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || /^#{1,4}\s/.test(next) || next.startsWith(">") || next.startsWith("|") || /^(?:[-*]|\d+\.)\s+/.test(next)) break;
      para.push(next);
      index += 1;
    }
    blocks.push({ kind: "para", text: para.join(" ") });
  }
  return blocks;
}

function InlineMd({ text, onWiki }: { text: string; onWiki: (target: string) => void }) {
  const parts = text.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) => {
        const wiki = part.match(/^\[\[([^\]]+)\]\]$/);
        if (wiki) {
          const label = (wiki[1].split("|").pop() ?? wiki[1]).split("#")[0].split("/").pop() ?? wiki[1];
          return (
            <button key={index} type="button" className="job-week-wiki" onClick={() => onWiki(wiki[1])}>
              {label}
            </button>
          );
        }
        if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (/^`[^`]+`$/.test(part)) return <code key={index}>{part.slice(1, -1)}</code>;
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

function MdBlockView({ block, onWiki }: { block: MdBlock; onWiki: (target: string) => void }) {
  if (block.kind === "heading") {
    // H1 是笔记标题，面板头部已经显示过了
    if (block.depth === 1) return null;
    const Tag = block.depth === 2 ? "h3" : block.depth === 3 ? "h4" : "h5";
    return (
      <Tag>
        <InlineMd text={block.text} onWiki={onWiki} />
      </Tag>
    );
  }
  if (block.kind === "quote") {
    return (
      <blockquote>
        {block.lines.map((line, index) => (
          <p key={index}>
            <InlineMd text={line} onWiki={onWiki} />
          </p>
        ))}
      </blockquote>
    );
  }
  if (block.kind === "list") {
    return (
      <ul>
        {block.items.map((item, index) => (
          <li key={index}>
            <InlineMd text={item} onWiki={onWiki} />
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === "table") {
    return (
      <table>
        <thead>
          <tr>
            {block.header.map((cell, index) => (
              <th key={index}>
                <InlineMd text={cell} onWiki={onWiki} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  <InlineMd text={cell} onWiki={onWiki} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <p>
      <InlineMd text={block.text} onWiki={onWiki} />
    </p>
  );
}

/** 周复盘：证据层口径来自笔记的 `status` + `status_updated`（缺则退回 `date`），不掺 AI 打分；叙事层显示本周的週次復盤笔记。 */
function JobWeeklyView({
  offset,
  range,
  kpis,
  events,
  focus,
  review,
  onShift,
  onDetail,
  onOpenReview,
  onWiki,
}: {
  offset: number;
  range: string;
  kpis: { label: string; tone: string; value: number }[];
  events: JobCard[];
  focus: { path: string; company: string; action: string }[];
  review: Note | null;
  onShift: (delta: number) => void;
  onDetail: (path: string) => void;
  onOpenReview: (note: Note) => void;
  onWiki: (target: string) => void;
}) {
  const title = offset === 0 ? "本周复盘" : offset < 0 ? `${-offset} 周前` : `${offset} 周后`;
  return (
    <div className="job-week">
      <div className="job-week-nav">
        <button type="button" onClick={() => onShift(-1)} aria-label="上一周">‹</button>
        <div>
          <strong>{title}</strong>
          <span>{range}</span>
        </div>
        <button type="button" onClick={() => onShift(1)} aria-label="下一周">›</button>
      </div>

      <div className="job-week-kpis">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="job-week-kpi">
            <strong className={`tone-${kpi.tone}`}>{kpi.value}</strong>
            <span>{kpi.label}</span>
          </div>
        ))}
      </div>

      <div className="job-week-split">
        {/* 只有时间线是按周口径的，翻周落空时别把另外三个全量 KPI 和待办也一起藏掉。 */}
        <section className="job-week-panel">
          <span className="job-week-label">本周动态 · TIMELINE</span>
          {events.length === 0 ? (
            <p className="job-week-blank">这一周还没有求职记录。</p>
          ) : (
            <div className="job-week-timeline">
              {events.map((job) => (
                <button key={job.path} type="button" className="job-week-event" onClick={() => onDetail(job.path)}>
                  <time>{dayLabel(eventDay(job))}</time>
                  <span>
                    <i className={`tone-${eventTone(job.status)}`} aria-hidden="true" />
                    <strong>{job.company}</strong>
                    <small>{eventLabel(job)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="job-week-side">
          <section className="job-week-panel">
            <span className="job-week-label">下周重点 · NEXT</span>
            <div className="job-week-focus">
              {focus.length === 0 && <p className="panel-empty">现在没有需要跟进的选考。</p>}
              {focus.map((item) => (
                <button key={item.path} type="button" onClick={() => onDetail(item.path)}>
                  <i aria-hidden="true" />
                  <span>
                    <strong>{item.company}</strong>
                    <small>{item.action}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="job-week-note">
            <span>复盘提醒</span>
            <p>本周动态来自笔记的状态与日期字段，属于「证据层」；AI 匹配度只是假设，投递决定仍由本人做出。</p>
          </section>
        </div>
      </div>

      <section className="job-week-panel job-week-review">
        <span className="job-week-label">本周复盘笔记 · REVIEW</span>
        {review ? (
          <>
            <div className="job-week-review-head">
              <strong>{getTitle(review)}</strong>
              <button type="button" className="job-week-review-open" onClick={() => onOpenReview(review)}>
                在记忆库中打开
              </button>
            </div>
            <div className="job-week-md">
              {parseMdBlocks(stripFrontmatter(review.content)).map((block, index) => (
                <MdBlockView key={index} block={block} onWiki={onWiki} />
              ))}
            </div>
          </>
        ) : (
          <p className="job-week-review-empty">
            这一周还没有叙事复盘。在 <code>80_AI分析/</code> 新建 <code>YYYY-MM-DD_週次復盤_主题.md</code>
            （type: ai-report，date 落在本周），这里就会自动显示。
          </p>
        )}
      </section>
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="job-detail-block">
      <h3>{title}</h3>
      <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </section>
  );
}

function JobDrawer({
  job,
  today,
  saving,
  compared,
  compareFull,
  onClose,
  onStatus,
  onCompare,
  onOpenNote,
}: {
  job: JobCard;
  today: string;
  saving: boolean;
  compared: boolean;
  compareFull: boolean;
  onClose: () => void;
  onStatus: (status: string, note: string) => Promise<string | null>;
  onCompare: () => void;
  onOpenNote: () => void;
}) {
  const intakeAge = intakeRelative(job.date, today);
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="note-drawer job-drawer" aria-label="岗位详情" aria-modal="true" role="dialog">
        <header className="drawer-header">
          <div>
            <span style={{ color: "var(--green)" }}>AI 推荐岗位</span>
            <small>{job.path}</small>
          </div>
          <button onClick={onClose} aria-label="关闭详情">×</button>
        </header>
        <div className="drawer-scroll">
          <div className="job-detail-head">
            <div>
              <h1>{job.company}</h1>
              {job.position && <p className="job-position">{job.position}</p>}
            </div>
            <div className={`job-rating job-rating-large rate-${rateTone(job.rating)}`}>
              <span className="job-score"><b>{job.rating}</b><small>/10</small></span>
              <span className="job-meter"><i style={{ width: `${job.rating * 10}%` }} /></span>
            </div>
          </div>

          <div className="job-detail-actions">
            <StatusPicker
              value={job.status}
              note={job.statusNote}
              today={today}
              saving={saving}
              onChange={onStatus}
            />
            {/* 列表 / 看板 / 周复盘视图里没有对比按钮，都从详情这里加入。 */}
            <button
              type="button"
              className={compared ? "job-compare-toggle active" : "job-compare-toggle"}
              aria-pressed={compared}
              disabled={!compared && compareFull}
              title={!compared && compareFull ? `最多同时对比 ${COMPARE_LIMIT} 个岗位` : "加入对比"}
              onClick={onCompare}
            >
              {compared ? "已加入对比" : "对比"}
            </button>
            {job.officialApplyUrl && (
              <a className="job-link job-official-link" href={job.officialApplyUrl} target="_blank" rel="noopener noreferrer">
                {job.officialApplyStatus === "exact" ? "官网直投 ↗" : job.officialApplyStatus === "related" ? "官网相近职位 ↗" : "官网招聘 ↗"}
              </a>
            )}
            {job.url && job.url !== job.officialApplyUrl && (
              <a className="job-link" href={job.url} target="_blank" rel="noopener noreferrer">求人票 ↗</a>
            )}
            <button type="button" className="job-detail" onClick={onOpenNote}>在记忆库中打开</button>
          </div>

          <dl className="job-detail-facts">
            <div><dt>年収</dt><dd>{job.salaryText || "—"}</dd></div>
            <div><dt>勤務地</dt><dd>{job.location || "—"}</dd></div>
            <div><dt>雇用形態</dt><dd>{job.employment || "—"}</dd></div>
            <div><dt>来源</dt><dd>{job.source || "—"}</dd></div>
            <div><dt>官方渠道</dt><dd>{OFFICIAL_APPLY_LABEL[job.officialApplyStatus]}{job.officialApplyNote ? ` · ${job.officialApplyNote}` : ""}</dd></div>
            {/* 「推荐日期」だと応募日と紛らわしい。frontmatter `date` は AI 推薦が入库した日。 */}
            <div><dt>入库日</dt><dd>{job.date ? `${job.date}${intakeAge && ` · ${intakeAge}`}` : "—"}</dd></div>
            <div><dt>笔记更新</dt><dd>{formatDate(job.updatedAt, true)}</dd></div>
          </dl>

          {job.verification !== "verified" && (
            <p className="job-detail-warning">
              {job.verification === "warned"
                ? "笔记里有未验证 / 需要核对的标记。应募前请自行打开求人原文确认必须要件。"
                : "这条岗位还没有求人原文核对记录。AI 打分只是假设，不能当作事实。"}
            </p>
          )}

          {job.stack.length > 0 && (
            <div className="job-stack">{job.stack.map((tag) => <span key={tag}>{tag}</span>)}</div>
          )}

          {job.reason && (
            <section className="job-detail-block">
              <h3>推荐理由</h3>
              <p>{job.reason}</p>
            </section>
          )}
          <DetailList title="匹配点" items={job.matches} />
          {job.caution && (
            <section className="job-detail-block job-detail-caution">
              <h3>注意点</h3>
              <p>{job.caution}</p>
            </section>
          )}
          <DetailList title="主打材料" items={job.materials} />
        </div>
      </aside>
    </div>
  );
}

const COMPARE_ROWS: { label: string; render: (job: JobCard) => ReactNode }[] = [
  { label: "匹配度", render: (job) => <strong className="job-compare-rating">{job.rating} / 10</strong> },
  { label: "年収", render: (job) => job.salaryText || "—" },
  { label: "勤務地", render: (job) => job.location || "—" },
  { label: "雇用形態", render: (job) => job.employment || "—" },
  { label: "状态", render: (job) => job.status },
  { label: "原文核对", render: (job) => VERIFICATION_LABEL[job.verification] },
  {
    label: "技術スタック",
    render: (job) => <div className="job-stack">{job.stack.map((tag) => <span key={tag}>{tag}</span>)}</div>,
  },
  { label: "推荐理由", render: (job) => job.reason || "—" },
  { label: "注意点", render: (job) => job.caution || "—" },
  {
    label: "主打材料",
    render: (job) => (job.materials.length ? <ul>{job.materials.map((item, index) => <li key={index}>{item}</li>)}</ul> : "—"),
  },
];

function JobCompare({
  jobs,
  onClose,
  onDetail,
}: {
  jobs: JobCard[];
  onClose: () => void;
  onDetail: (path: string) => void;
}) {
  return (
    <div
      className="job-compare-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="job-compare-panel" role="dialog" aria-modal="true" aria-label="岗位并排对比">
        <header>
          <h2>并排对比</h2>
          <button onClick={onClose} aria-label="关闭对比">×</button>
        </header>
        <div className="job-compare-scroll">
          <table className="job-compare-table">
            <thead>
              <tr>
                <th scope="col" />
                {jobs.map((job) => (
                  <th key={job.path} scope="col">
                    <button type="button" onClick={() => onDetail(job.path)}>
                      <strong>{job.company}</strong>
                      <small>{job.position || "—"}</small>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {jobs.map((job) => <td key={job.path}>{row.render(job)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
