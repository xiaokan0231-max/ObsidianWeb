import {
  EMPTY_JOB_FILTERS,
  JOB_INTAKES,
  JOB_RATING_BANDS,
  JOB_SORTS,
  JOB_TOUCHES,
  UNRATED_FIT,
  type JobIntake,
  type JobRatingBand,
  type JobSort,
  type JobTouch,
  type JobVerification,
} from "@/lib/jobs";
import { ACCESS_STATE_VALUES, FIT_BANDS, HARD_GATE_VALUES } from "@/lib/job-case-schema";
import type { Filters, JobsInitialFilters } from "./jobs-types";

/*
 * 岗位机会的 URL 状态：读（readJobsUrlState）与写（jobsUrlParams）放在一起，
 * 两边的键名和取值域必须成对改，分开放就会出现「写得进 URL、读不回来」。
 * 筛选面板的选项也从这里取值域，chip 列出的值与 URL 能接受的值是同一份。
 */

export const SALARY_STEPS = [0, 600, 700, 800, 900, 1000, 1200];

export const VERIFICATIONS: JobVerification[] = ["verified", "warned", "unchecked"];

/**
 * v2 採点の絞り込み値。`none`（UNRATED_FIT）は「未採点（v2）」の擬似値で frontmatter には無い——
 * 採点待ちの案件を拾えるようにするために置く。枚举本体は lib/job-case-schema.ts と共有し、ここで書き直さない。
 */
export const GATE_FILTER_VALUES: readonly string[] = [...HARD_GATE_VALUES, UNRATED_FIT];
export const BAND_FILTER_VALUES: readonly string[] = [...FIT_BANDS, UNRATED_FIT];
export const ACCESS_FILTER_VALUES: readonly string[] = [...ACCESS_STATE_VALUES, UNRATED_FIT];
const TOUCH_VALUES: readonly JobTouch[] = JOB_TOUCHES.map((touch) => touch.id);

/** 结果区的四种视图。卡片/列表/看板共享同一份筛选结果，周复盘看的是全量笔记。 */
export const VIEW_MODES = [
  { id: "decision", label: "决策台" },
  { id: "card", label: "卡片" },
  { id: "list", label: "列表" },
  { id: "kanban", label: "看板" },
  { id: "weekly", label: "周复盘" },
] as const;

export type ViewMode = (typeof VIEW_MODES)[number]["id"];

const EMPTY_FILTERS: Filters = EMPTY_JOB_FILTERS;

/**
 * 「岗位机会」は新しい応募先を選ぶ画面。終了案件まで含む全件を既定表示すると、
 * 高得点の不採用案件が先頭を占めて「次に投る先」が見えなくなる。
 * 全件は状態 chip を外せば見られるため、入口だけ未応募に絞る。
 */
export const DEFAULT_OPPORTUNITY_FILTERS: Filters = {
  ...EMPTY_FILTERS,
  statuses: ["未応募"],
};

export type JobsUrlState = {
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

export function readJobsUrlState(initialFilters?: JobsInitialFilters | null): JobsUrlState {
  const params = typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
  const seeded = initialFilters?.statuses?.length || initialFilters?.ratings?.length || initialFilters?.touch?.length || initialFilters?.waiting;
  const statusParam = params.get("status");
  const baseFilters = seeded
    ? {
        ...EMPTY_FILTERS,
        statuses: [...(initialFilters?.statuses ?? [])],
        ratings: [...(initialFilters?.ratings ?? [])],
        touches: (initialFilters?.touch ?? []).filter((value) => TOUCH_VALUES.includes(value)),
        waitingOnly: Boolean(initialFilters?.waiting),
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
    "touch",
    "gate",
    "band",
    "access",
    "remote",
    "waiting",
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
  const touches = csvParam(params, "touch").filter((value): value is JobTouch =>
    TOUCH_VALUES.includes(value as JobTouch),
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
          touches,
          gates: csvParam(params, "gate").filter((value) => GATE_FILTER_VALUES.includes(value)),
          bands: csvParam(params, "band").filter((value) => BAND_FILTER_VALUES.includes(value)),
          accesses: csvParam(params, "access").filter((value) => ACCESS_FILTER_VALUES.includes(value)),
          remoteOnly: params.get("remote") === "1",
          waitingOnly: params.get("waiting") === "1",
        }
      : baseFilters,
    viewMode: VIEW_MODES.some((mode) => mode.id === modeParam) ? modeParam as ViewMode : "decision",
    weekOffset: Number.isInteger(week) && Math.abs(week) <= 52 ? week : 0,
    detailPath: params.get("case") || null,
  };
}

export function isDefaultOpportunityFilters(filters: Filters) {
  return filters.statuses.length === 1 &&
    filters.statuses[0] === "未応募" &&
    filters.ratings.length === 0 &&
    filters.minSalary === 0 &&
    filters.stacks.length === 0 &&
    filters.regions.length === 0 &&
    filters.sources.length === 0 &&
    filters.verifications.length === 0 &&
    filters.intakes.length === 0 &&
    filters.touches.length === 0 &&
    filters.gates.length === 0 &&
    filters.bands.length === 0 &&
    filters.accesses.length === 0 &&
    !filters.remoteOnly &&
    !filters.waitingOnly;
}

/** 当前状态 → URL 查询参数。默认值一律不写，地址栏只留真正偏离默认的条件。 */
export function jobsUrlParams({ query, sort, filters, viewMode, weekOffset, detailPath }: JobsUrlState) {
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
    if (filters.touches.length) params.set("touch", filters.touches.join(","));
    if (filters.gates.length) params.set("gate", filters.gates.join(","));
    if (filters.bands.length) params.set("band", filters.bands.join(","));
    if (filters.accesses.length) params.set("access", filters.accesses.join(","));
    if (filters.remoteOnly) params.set("remote", "1");
    if (filters.waitingOnly) params.set("waiting", "1");
  }
  if (sort !== "rating") params.set("sort", sort);
  if (viewMode !== "decision") params.set("mode", viewMode);
  if (viewMode === "weekly" && weekOffset !== 0) params.set("week", String(weekOffset));
  if (detailPath) params.set("case", detailPath);
  return params;
}
