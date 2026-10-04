"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  ACCESS_STATE_LABEL,
  HARD_GATE_LABEL,
  isJobStatus,
  jobFitAccess,
  jobFitBand,
  jobFitGate,
  jobIntake,
  jobMatchesRatingBands,
  jobTouch,
  jobWaitsOnCounterpart,
  JOB_INTAKES,
  JOB_RATING_BANDS,
  JOB_STATUSES,
  JOB_TOUCHES,
  UNRATED_FIT,
  UNRATED_V2_LABEL,
  VERIFICATION_LABEL,
  type JobCard,
  type JobIntake,
  type JobRatingBand,
  type JobTouch,
  type JobVerification,
} from "@/lib/jobs";
import { useJobMenu, type JobMenuKey } from "./jobs-copy";
import type { FilterKey, Filters } from "./jobs-types";
import {
  ACCESS_FILTER_VALUES,
  BAND_FILTER_VALUES,
  GATE_FILTER_VALUES,
  SALARY_STEPS,
  VERIFICATIONS,
  type ViewMode,
} from "./jobs-url-state";

const fitFilterLabel = (value: string, labels: Record<string, string>) => (value === UNRATED_FIT ? UNRATED_V2_LABEL : labels[value] ?? value);

/** 「去掉后可得 N 条」里每组的名字，与筛选面板的分组标题同一套文案。 */
export const FILTER_GROUP_LABEL: Record<FilterKey, JobMenuKey> = {
  query: "关键词",
  statuses: "应募状态",
  rating: "応募优先度",
  salary: "年収上限",
  stacks: "技術スタック",
  regions: "勤務地",
  sources: "来源",
  verifications: "原文核对",
  intakes: "入库时期",
  touches: "动手状态",
  gates: "Gate（v2）",
  bands: "Band（v2）",
  accesses: "到達（v2）",
  remote: "リモート可",
  waiting: "只看等对方",
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
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
  const { t } = useJobMenu();
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
            {collapsed ? t("+{count} 更多", { count: hidden }) : t("收起")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 左侧的组合筛选面板。facet 计数只有这里用，所以放在面板里算；
 * 结果池（narrow）由视图传进来，计数与结果走同一个判定函数。
 */
export function JobsFilterPanel({
  narrow,
  today,
  filters,
  setFilters,
  viewMode,
  shownFilterCount,
  onReset,
}: {
  narrow: (except?: FilterKey) => JobCard[];
  today: string;
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  viewMode: ViewMode;
  /** 已启用的筛选数（看板不计状态组），由视图算好，与结果条上的数字同一个值。 */
  shownFilterCount: number;
  onReset: () => void;
}) {
  const { t, label: menuLabel } = useJobMenu();

  /**
   * facet 计数是「联动」的：每组的数字都算在**其它所有条件已生效**的前提下。
   * 每组要排除自己，否则多选组里没选中的项会全变 0，就再也加不上第二个值了。
   */
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
      touches: count(narrow("touches"), (job) => {
        const touch = jobTouch(job);
        return touch ? [touch] : [];
      }),
      gates: count(narrow("gates"), (job) => [jobFitGate(job)]),
      bands: count(narrow("bands"), (job) => [jobFitBand(job)]),
      accesses: count(narrow("accesses"), (job) => [jobFitAccess(job)]),
      ratingPool: narrow("rating"),
      salaryPool: narrow("salary"),
      remote: narrow("remote").filter((job) => job.remote).length,
      waiting: narrow("waiting").filter(jobWaitsOnCounterpart).length,
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

  return (
    <details className="jobs-filter-panel">
      <summary>
        <span>
          <b>{t("筛选条件")}</b>
          <small>
            {shownFilterCount > 0
              ? `${t("已启用 {count} 项", { count: shownFilterCount })}${viewMode !== "kanban" && filters.statuses.length === 1 && filters.statuses[0] === "未応募" ? ` · ${t("默认只看未応募")}` : ""}`
              : t("当前显示全部岗位")}
          </small>
        </span>
        <em aria-hidden="true" />
      </summary>
      <div className="jobs-filter-sticky">
        <div className="jobs-filter-head">
          <span>{t("组合筛选 · FILTERS")}</span>
          <button type="button" className="jobs-filter-reset" onClick={onReset}>
            {t("恢复默认")}
          </button>
        </div>

        <div className="jobs-filter-groups">
          {viewMode === "kanban" ? (
            <p className="jobs-filter-note">{t("看板按状态分列，不受状态筛选影响")}</p>
          ) : (
            <FilterChips
              label={t("应募状态")}
              options={statusOptions}
              selected={filters.statuses}
              onToggle={(value) => setFilters((current) => ({ ...current, statuses: toggle(current.statuses, value) }))}
            />
          )}

          {/* 只有未応募才有动手状态；选中后应募済以降会全部落选，与顶部统计格同一口径。 */}
          <FilterChips
            label={t("动手状态")}
            options={JOB_TOUCHES.map((touch) => ({
              value: touch.id,
              label: menuLabel(touch.label),
              hint: menuLabel(touch.hint),
              count: facets.touches.get(touch.id) ?? 0,
            }))}
            selected={filters.touches}
            onToggle={(value) =>
              setFilters((current) => ({ ...current, touches: toggle(current.touches, value as JobTouch) }))
            }
          />

          {/* 等待筛选沿用案件的等待方判定，保留在求职看板中处理跟进。 */}
          {(facets.waiting > 0 || filters.waitingOnly) && (
            <div className="job-filter-row">
              <span className="job-filter-label">{t("等待")}</span>
              <div className="job-chips">
                <button
                  type="button"
                  className={`job-chip${filters.waitingOnly ? " active" : ""}`}
                  aria-pressed={filters.waitingOnly}
                  title={t("已记等待对象、且不是本人的案件（选考中・内定，或未応募但已动手）")}
                  onClick={() => setFilters((current) => ({ ...current, waitingOnly: !current.waitingOnly }))}
                >
                  <span>{t("只看等对方")}</span> <small>{facets.waiting}</small>
                </button>
              </div>
            </div>
          )}

          {/* 顺序固定按「新→旧」，不像 facetOptions 那样按计数排 —— 时间轴重排了就读不成时间轴了。 */}
          <FilterChips
            label={t("入库时期")}
            options={JOB_INTAKES.map((bucket) => ({
              value: bucket.id,
              label: menuLabel(bucket.label),
              hint: menuLabel(bucket.hint),
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
            label={t("応募优先度")}
            options={JOB_RATING_BANDS.map((band) => ({
              value: band.id,
              label: menuLabel(band.label),
              hint: menuLabel(band.hint),
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

          {/* v2 採点は応募优先度とは別軸：rating は求人原文を読んだ上での主観的な優先度、
              Gate / Band は六軸採点の結論。未採点を擬似値として並べるのは、採点待ちの案件を拾うため。 */}
          <FilterChips
            label="Gate（v2）"
            options={GATE_FILTER_VALUES.map((value) => ({ value, label: menuLabel(fitFilterLabel(value, HARD_GATE_LABEL)), count: facets.gates.get(value) ?? 0 }))}
            selected={filters.gates}
            onToggle={(value) => setFilters((current) => ({ ...current, gates: toggle(current.gates, value) }))}
          />
          <FilterChips
            label="Band（v2）"
            options={BAND_FILTER_VALUES.map((value) => ({ value, label: menuLabel(fitFilterLabel(value, {})), count: facets.bands.get(value) ?? 0 }))}
            selected={filters.bands}
            onToggle={(value) => setFilters((current) => ({ ...current, bands: toggle(current.bands, value) }))}
          />
          <FilterChips
            label={t("到達（v2）")}
            options={ACCESS_FILTER_VALUES.map((value) => ({ value, label: menuLabel(fitFilterLabel(value, ACCESS_STATE_LABEL)), count: facets.accesses.get(value) ?? 0 }))}
            selected={filters.accesses}
            onToggle={(value) => setFilters((current) => ({ ...current, accesses: toggle(current.accesses, value) }))}
          />

          {/* 来源在年収より上：応募経路の混在（ワークポート起票以降 6 経路超）で、
              「どこ由来の求人か」が年収より先に効く絞り込みになった（2026-07-27 本人指示）。 */}
          <FilterChips
            label={t("来源")}
            options={facetOptions(facets.sources, filters.sources)}
            selected={filters.sources}
            onToggle={(value) => setFilters((current) => ({ ...current, sources: toggle(current.sources, value) }))}
          />

          <div className="job-filter-row">
            <span className="job-filter-label">{t("年収上限")}</span>
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
                    <span>{step === 0 ? t("全部") : `${step}万+`}</span> <small>{count}</small>
                  </button>
                );
              })}
              <button
                type="button"
                className={`job-chip${filters.remoteOnly ? " active" : ""}${facets.remote === 0 && !filters.remoteOnly ? " empty" : ""}`}
                aria-pressed={filters.remoteOnly}
                onClick={() => setFilters((current) => ({ ...current, remoteOnly: !current.remoteOnly }))}
              >
                <span>{t("リモート可")}</span> <small>{facets.remote}</small>
              </button>
            </div>
          </div>

          <FilterChips
            label={t("技術スタック")}
            collapseAfter={12}
            options={facetOptions(facets.stacks, filters.stacks)}
            selected={filters.stacks}
            onToggle={(value) => setFilters((current) => ({ ...current, stacks: toggle(current.stacks, value) }))}
          />

          <FilterChips
            label={t("勤務地")}
            options={facetOptions(facets.regions, filters.regions)}
            selected={filters.regions}
            onToggle={(value) => setFilters((current) => ({ ...current, regions: toggle(current.regions, value) }))}
          />

          <FilterChips
            label={t("原文核对")}
            options={VERIFICATIONS.map((key) => ({
              value: key,
              label: menuLabel(VERIFICATION_LABEL[key]),
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
  );
}
