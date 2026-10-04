"use client";

import ScopeLoading from "./scope-loading";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  compareJobs,
  rateText,
  rateTone,
  salaryLabel,
  jobMatchesFilters,
  jobStatTileFilters,
  jobStatTilePools,
  JOB_STAT_TILES,
  JOB_SORTS,
  toJobCard,
  VERIFICATION_LABEL,
  type JobCard,
  type JobSort,
  type JobStatTileId,
  jobFilterRelaxations,
  withoutJobFilter,
} from "@/lib/jobs";
import { isTypingTarget } from "@/lib/keyboard";
import { parseAppliedLedger } from "@/lib/job-stats.mjs";
import { opportunityAppliedOn } from "@/lib/job-opportunity";
import { JOB_CASE_TYPE } from "@/lib/vault-boundary.mjs";
import { getType, type Note } from "@/lib/notes";
import type { UndoAction } from "./undo-flash";
import { URL_CHANGE_EVENT } from "./use-url-state";
import { JobCardView, JobListView } from "./jobs-cards";
import { JobCompare, JobCompareTray } from "./jobs-compare";
import { useJobMenu } from "./jobs-copy";
import { JobDecisionWorkspace } from "./jobs-decision";
import { JobDrawer } from "./jobs-drawer";
import { FILTER_GROUP_LABEL, JobsFilterPanel } from "./jobs-filters";
import { JobKanbanView, kanbanColumnsOf } from "./jobs-kanban";
import { buildMatcher, clip, COMPARE_LIMIT } from "./jobs-shared";
import { JobStatusAlerts, useJobStatusWrites } from "./jobs-status";
import type { FilterKey, Filters, JobsInitialFilters } from "./jobs-types";
import {
  DEFAULT_OPPORTUNITY_FILTERS,
  isDefaultOpportunityFilters,
  jobsUrlParams,
  readJobsUrlState,
  VIEW_MODES,
  type ViewMode,
} from "./jobs-url-state";
import { JobWeeklyView, useJobWeek } from "./jobs-weekly";

/*
 * 岗位机会的入口：持有筛选・视图・选中・对比等页面状态，并把它们同步到 URL。
 * 各视图与部件在 app/jobs-*.tsx：卡片/列表（jobs-cards）、决策台（jobs-decision）、
 * 看板（jobs-kanban）、周复盘（jobs-weekly）、详情抽屉（jobs-drawer）、对比（jobs-compare）、
 * 筛选面板（jobs-filters）、状态控件与写入（jobs-status）、URL 状态（jobs-url-state）、文案（jobs-copy）。
 */

/** 別画面の数字カードから「その数字の中身」へ飛ぶ時に渡す初期フィルタ（定義は jobs-types）。 */
export type { JobsInitialFilters } from "./jobs-types";

function JobsView({
  notes,
  loading = false,
  today,
  onOpen,
  onVaultChanged,
  onNoteWritten,
  initialFilters,
  onFlash,
}: {
  notes: Note[];
  /**
   * 岗位 scope 还没到。外壳只在「一条笔记都没有」时画全屏加载；从别的视图切过来时
   * notes 已非空但不含 job-case，不区分的话会先闪一下「还没有可以展示的岗位机会」。
   */
  loading?: boolean;
  /** 「今日」は殻が持つ（零時の切替も殻が面倒を見る）。ここで new Date() すると跨日後の「今日入库」が前日のまま凍る。 */
  today: string;
  onOpen: (note: Note) => void;
  onVaultChanged?: () => void | Promise<void>;
  /** 写路由が返した更新後の note を1件だけ差し替える。全量再取得（onVaultChanged）の代替。 */
  onNoteWritten?: (note: Note) => void;
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
  /**
   * 状态写入成功后的「已改为 X · 撤销」。条幅由外壳统一渲染（同一时刻只该有一条），
   * 这里只把消息和撤销动作交出去。
   */
  onFlash?: (message: string, undo?: UndoAction) => void;
}) {
  const { t, label: menuLabel } = useJobMenu();
  const [initialUrlState] = useState(() => readJobsUrlState(initialFilters));
  const [query, setQuery] = useState(initialUrlState.query);
  const [sort, setSort] = useState<JobSort>(initialUrlState.sort);
  const [filters, setFilters] = useState<Filters>(initialUrlState.filters);
  const [viewMode, setViewMode] = useState<ViewMode>(initialUrlState.viewMode);
  const [weekOffset, setWeekOffset] = useState(initialUrlState.weekOffset);
  const [detailPath, setDetailPath] = useState<string | null>(initialUrlState.detailPath);
  const [comparePaths, setComparePaths] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  /*
   * 状态写入中・写入失败按 path 记在视图顶层（不放进 StatusPicker，理由见 useJobStatusWrites）。
   * 卡片是 memo 的，这里拿到的回调都是稳定引用。
   */
  const { savingPaths, statusErrors, dismissStatusError, changeStatus, changeFollowUp } = useJobStatusWrites({
    onFlash,
    onNoteWritten,
    onVaultChanged,
  });
  /**
   * 看板拖到「応募済」等列、但案件还没有 channel：不写，打开抽屉并让状态控件直接摊开渠道选择。
   * 只对这一次打开有效，普通打开详情时清掉，免得下次打开同一案件又莫名弹出渠道面板。
   */
  const [channelRequest, setChannelRequest] = useState<{ path: string; status: string } | null>(null);
  /** 决策台里刚改了状态的那一条与它在队列里的位置：写完离开队列时选中原位置的下一条。 */
  const [advanceFrom, setAdvanceFrom] = useState<{ path: string; index: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const openDetail = useCallback((path: string, requestStatus?: string) => {
    setChannelRequest(requestStatus ? { path, status: requestStatus } : null);
    const params = new URLSearchParams(window.location.search);
    params.set("case", path);
    window.history.pushState(
      { ...(window.history.state ?? {}), __echoJob: path },
      "",
      `${window.location.pathname}?${params.toString()}`,
    );
    setDetailPath(path);
  }, []);
  const closeDetail = useCallback(() => {
    setChannelRequest(null);
    if (window.history.state?.__echoJob) {
      window.history.back();
      return;
    }
    setDetailPath(null);
  }, []);

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

  /*
   * 筛选与 facet 计数跟着「延后」的关键词走：输入框本身用 query 即时回显，
   * 几百张卡的重算让到空闲时做，连续打字不卡键。
   */
  const deferredQuery = useDeferredValue(query);
  const matcher = useMemo(() => buildMatcher(deferredQuery), [deferredQuery]);
  const narrow = useCallback(
    (except?: FilterKey) => {
      return jobs.filter((job) => jobMatchesFilters(job, filters, { query: deferredQuery, today, except }));
    },
    // today 进依赖是必须的：跨天后「今日」那一档要重算，否则面板挂一夜就永远停在昨天。
    [jobs, deferredQuery, filters, today],
  );

  const visible = useMemo(
    () => narrow().sort((left, right) => compareJobs(left, right, sort)),
    [narrow, sort],
  );

  /**
   * 看板本身就按状态分列，状态筛选对它没有意义：默认筛选只看未応募，
   * 直接用 visible 的话切到看板只有第一列有卡、其余四列永远是「—」。
   * 所以看板的池子排除状态这一组，其余筛选（关键词・技术栈・地点…）照常生效。
   */
  const kanbanJobs = useMemo(
    () => narrow("statuses").sort((left, right) => compareJobs(left, right, sort)),
    [narrow, sort],
  );

  /** 看板列：枚举顺序在前，核心五列常驻；笔记里出现的自定义状态补在末尾，避免岗位被吞掉。 */
  const kanbanColumns = useMemo(() => kanbanColumnsOf(kanbanJobs), [kanbanJobs]);

  const { week, weekEvents, weekKpis, nextFocus, weekReview, openWikiLink } = useJobWeek({
    jobs,
    notes,
    today,
    weekOffset,
    onOpen,
  });

  const jobPaths = useMemo(() => new Set(jobs.map((job) => job.path)), [jobs]);
  const detail = jobs.find((job) => job.path === detailPath) ?? null;
  const detailOpen = detail !== null;

  // 笔记被删掉 / 移出 AI 推薦目录后，comparePaths 里会留下失效路径；
  // 一切判断都走这份已对账的 compared，免得幽灵岗位占着对比名额。
  const compared = useMemo(
    () => comparePaths
      .map((path) => jobs.find((job) => job.path === path))
      .filter((job): job is JobCard => Boolean(job)),
    [comparePaths, jobs],
  );
  const compareFull = compared.length >= COMPARE_LIMIT;

  const activeFilterCount =
    filters.statuses.length +
    filters.stacks.length +
    filters.regions.length +
    filters.sources.length +
    filters.verifications.length +
    filters.intakes.length +
    filters.touches.length +
    filters.gates.length +
    filters.bands.length +
    filters.accesses.length +
    filters.ratings.length +
    (filters.minSalary > 0 ? 1 : 0) +
    (filters.remoteOnly ? 1 : 0) +
    (filters.waitingOnly ? 1 : 0);

  const resetFilters = () => {
    setFilters(DEFAULT_OPPORTUNITY_FILTERS);
    setQuery("");
  };

  // 稳定引用：卡片是 memo 的，每次渲染都换一个新函数就等于没有 memo。
  const toggleCompare = useCallback((path: string) => {
    // 每次都先按现有笔记对账一遍，被删掉的岗位不该继续占着 COMPARE_LIMIT 的名额。
    setComparePaths((current) => {
      const live = current.filter((item) => jobPaths.has(item));
      if (live.includes(path)) return live.filter((item) => item !== path);
      if (live.length >= COMPARE_LIMIT) return live;
      return [...live, path];
    });
    if (compared.length <= 2 && compared.some((job) => job.path === path)) setCompareOpen(false);
  }, [compared, jobPaths]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (compareOpen) setCompareOpen(false);
        // 决策台没有抽屉，选中项是常驻的右栏：Esc 在这里关不掉任何东西，只会把正在看的岗位重置回队首。
        else if (detailOpen && viewMode !== "decision") closeDetail();
        return;
      }
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDetail, compareOpen, detailOpen, viewMode]);

  useEffect(() => {
    const pathname = window.location.pathname;
    const syncFromUrl = () => {
      // 回到别的页面时本组件马上卸载；别把对方页面的同名参数（mode 等）读进看板。
      if (window.location.pathname !== pathname) return;
      const next = readJobsUrlState();
      setQuery(next.query);
      setSort(next.sort);
      setFilters(next.filters);
      setViewMode(next.viewMode);
      setWeekOffset(next.weekOffset);
      setDetailPath(next.detailPath);
      // 看板「缺渠道」的那次打开只对那一次有效；前进后退回到同一案件时不该再自动摊开渠道面板。
      setChannelRequest(null);
    };
    window.addEventListener("popstate", syncFromUrl);
    // 在看板上再点一次左栏「岗位机会」：外壳 pushState 回到不带参数的 /jobs，筛选要跟着回到默认。
    window.addEventListener(URL_CHANGE_EVENT, syncFromUrl);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
      window.removeEventListener(URL_CHANGE_EVENT, syncFromUrl);
    };
  }, []);

  useEffect(() => {
    const queryString = jobsUrlParams({ query, sort, filters, viewMode, weekOffset, detailPath }).toString();
    window.history.replaceState(
      { ...(window.history.state ?? {}), __echoAppView: "jobs" },
      "",
      `${window.location.pathname}${queryString ? `?${queryString}` : ""}`,
    );
  }, [detailPath, filters, query, sort, viewMode, weekOffset]);

  // 统计格从全部案件数（不随筛选变），口径与点开后的筛选在 lib/jobs.ts 里成对定义、由测试钉住。
  // 已经动过手的不再算「待判断」——本人这边没有下一步，催也没用。
  const tilePools = useMemo(() => jobStatTilePools(jobs, today), [jobs, today]);
  const readyJobs = useMemo(
    () => [...tilePools.ready].sort((left, right) => compareJobs(left, right, "rating")),
    [tilePools],
  );
  const nextPick = useMemo(
    () => readyJobs[0] ??
      [...tilePools.untouched].sort((left, right) => compareJobs(left, right, "rating"))[0] ??
      null,
    [readyJobs, tilePools],
  );
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
  // 统计格＝一次性替换全部筛选：从空条件起步、清掉关键词，只保留排序与视图。
  // 在旧条件上叠加的话，点开后的条数会比格子上的数字少，格子就成了谎话。
  const applyStatTile = (id: JobStatTileId) => {
    setFilters(jobStatTileFilters(id));
    setQuery("");
    // 周复盘不画列表：停在那里的话，点了「只看这 N 条」却什么都看不到。
    if (viewMode === "weekly") setViewMode("decision");
  };
  const statTileActive = (id: JobStatTileId) =>
    query.trim() === "" && JSON.stringify(filters) === JSON.stringify(jobStatTileFilters(id));

  const isJobList = viewMode !== "weekly";
  // 看板不用状态筛选，计数里也不该算它，否则「已选 1 个筛选」指向一个看不见的条件。
  const shownFilterCount = viewMode === "kanban" ? activeFilterCount - filters.statuses.length : activeFilterCount;
  // 结果条的条数和空态都要跟画面上实际画出的那一池对齐：看板用的是不含状态筛选的池子。
  const listedJobs = viewMode === "kanban" ? kanbanJobs : resultVisible;
  const matchedJobs = viewMode === "kanban" ? kanbanJobs : visible;

  /*
   * 决策台里改完状态，这一条多半会因为默认只看未応募而离开队列。不跟着走的话右栏还停在
   * 已经处理完的岗位上，本人得回队列里再找下一条。所以等写入结束（savingPaths 里没有它）再看：
   * 离开了就选原位置上的下一条；还在（写入失败、或新状态仍满足筛选）就什么都不动。
   * 在渲染期按条件 setState（与 FilterChips 收起展开的做法相同），不必等一轮 effect 才跳。
   */
  if (advanceFrom && !savingPaths.includes(advanceFrom.path)) {
    if (detailPath === advanceFrom.path && !visible.some((job) => job.path === advanceFrom.path)) {
      setDetailPath(visible[Math.min(advanceFrom.index, visible.length - 1)]?.path ?? null);
    }
    setAdvanceFrom(null);
  }
  const decisionDetail = viewMode === "decision" ? detail ?? visible[0] ?? null : null;
  const decisionStatus = useCallback(
    (path: string, index: number, status: string, note: string, channel?: string, expectedMtime?: number) => {
      setAdvanceFrom({ path, index });
      return changeStatus(path, status, note, channel, expectedMtime);
    },
    [changeStatus],
  );

  // 筛选把结果清空时，逐组告诉本人「去掉这一组能拿回几条」。看板不受状态筛选影响，这一组不列。
  const relaxations = useMemo(() => {
    if (!isJobList || matchedJobs.length > 0 || jobs.length === 0) return [];
    const base = viewMode === "kanban" ? { ...filters, statuses: [] } : filters;
    // 去掉后仍是 0 条的组也列出（按钮禁用）：「单独放宽这一组没用」本身就是本人要知道的事。
    return jobFilterRelaxations(jobs, base, { query: deferredQuery, today });
  }, [deferredQuery, filters, isJobList, jobs, matchedJobs.length, today, viewMode]);
  const relaxFilter = (key: FilterKey) => {
    if (key === "query") setQuery("");
    else setFilters((current) => withoutJobFilter(current, key));
  };

  return (
    <section className="jobs-view">
      <h1 className="sr-only">{t("岗位机会")}</h1>
      {highlightedNextPick && (
        <section className="jobs-next-pick" aria-label={t("下一项応募判断")}>
          <span className={`jobs-next-score rate-${rateTone(highlightedNextPick.rating)}`}>
            <strong>{rateText(highlightedNextPick)}</strong>
            <small>{highlightedNextPick.rated ? "/ 10" : "未採点"}</small>
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
          <button type="button" onClick={() => openDetail(highlightedNextPick.path)}>
            {t("判断是否応募")} <span aria-hidden="true">→</span>
          </button>
        </section>
      )}

      <div className="jobs-stat page-stat-strip module-stat-strip" role="group" aria-label={t("当前岗位机会摘要（点击查看对应岗位）")}>
        {JOB_STAT_TILES.map((tile) => {
          const count = tilePools[tile.id].length;
          return (
            <button
              key={tile.id}
              type="button"
              data-zero={count === 0}
              aria-pressed={statTileActive(tile.id)}
              title={t("只看这 {count} 条（替换当前全部筛选）", { count })}
              onClick={() => applyStatTile(tile.id)}
            >
              <strong>{count}</strong><span>{menuLabel(tile.label)}</span>
            </button>
          );
        })}
      </div>

      <div className="jobs-body">
        <JobsFilterPanel
          narrow={narrow}
          today={today}
          filters={filters}
          setFilters={setFilters}
          viewMode={viewMode}
          shownFilterCount={shownFilterCount}
          onReset={resetFilters}
        />

        <div className="jobs-results">
          <div className="jobs-toolbar">
            <div className="job-search">
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("搜索公司、职位、技术栈、推荐理由…")}
                aria-label={t("搜索推荐岗位")}
              />
              {query ? (
                <button type="button" className="job-search-clear" onClick={() => setQuery("")} aria-label={t("清空搜索")}>×</button>
              ) : (
                <kbd>/</kbd>
              )}
            </div>
            <label className="job-sort">
              <span>{t("排序")}</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as JobSort)}>
                {JOB_SORTS.map((option) => (
                  <option key={option.id} value={option.id}>{menuLabel(option.label)}</option>
                ))}
              </select>
            </label>
            <div className="jobs-view-switch" role="group" aria-label={t("视图切换")}>
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={viewMode === mode.id ? "active" : undefined}
                  aria-pressed={viewMode === mode.id}
                  onClick={() => setViewMode(mode.id)}
                >
                  {menuLabel(mode.label)}
                </button>
              ))}
            </div>
          </div>

          {isJobList && (
            <div className="jobs-result-bar">
              <span>
                {highlightedNextPick ? `${t("其余")} ` : ""}<strong>{listedJobs.length}</strong> / {jobs.length} {t("条")}
                {query && <> · {t("关键词")}「{query.trim()}」</>}
              </span>
              <span className="jobs-filter-count">{t("已选 {count} 个筛选", { count: shownFilterCount })}</span>
            </div>
          )}

          {jobs.length === 0 && loading && <ScopeLoading label={t("岗位机会")} />}

          {jobs.length === 0 && !loading && (
            <div className="jobs-empty">
              <p>还没有可以展示的岗位机会。</p>
              <small>在 Vault 的 <code>20_求職/</code> 下新建 <code>type: job-case</code> 的应募案件即可显示；AI 推荐只是 <code>origin</code> 的一种。</small>
            </div>
          )}

          {/* 只让结果区随视图重挂并播入场，工具栏不动：整块重挂会把焦点从刚点的视图按钮上弹走。 */}
          <div className="jobs-view-pane" key={viewMode}>
            {jobs.length > 0 && isJobList && matchedJobs.length === 0 && (
              <div className="jobs-empty">
                <p>没有岗位同时满足这些条件。</p>
                {relaxations.length > 0 && (
                  <ul className="jobs-empty-relax" aria-label={t("逐项放宽")}>
                    {relaxations.map((item) => (
                      <li key={item.key}>
                        <button type="button" disabled={item.count === 0} onClick={() => relaxFilter(item.key)}>
                          <b>{t(FILTER_GROUP_LABEL[item.key])}</b>
                          <span>{t("去掉后可得 {count} 条", { count: item.count })}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="job-detail" onClick={resetFilters}>{t("清空筛选")}</button>
              </div>
            )}

            {jobs.length > 0 && highlightedNextPick && resultVisible.length === 0 && (
              <div className="jobs-featured-only">当前筛选下只有上方这一项需要判断。</div>
            )}

            {jobs.length > 0 && viewMode === "card" && resultVisible.length > 0 && (
              <div className="jobs-grid">
                {resultVisible.map((job, index) => (
                  <JobCardView
                    key={job.path}
                    job={job}
                    matcher={matcher}
                    today={today}
                    stagger={index < 12 ? index : undefined}
                    compared={comparePaths.includes(job.path)}
                    compareFull={compareFull}
                    saving={savingPaths.includes(job.path)}
                    onDetail={openDetail}
                    onCompare={toggleCompare}
                    onStatus={changeStatus}
                  />
                ))}
              </div>
            )}

            {jobs.length > 0 && viewMode === "decision" && visible.length > 0 && decisionDetail && (
              <JobDecisionWorkspace
                jobs={visible}
                selected={decisionDetail}
                today={today}
                saving={savingPaths.includes(decisionDetail.path)}
                keyboard={!compareOpen}
                onSelect={setDetailPath}
                onStatus={(status, note, channel) => decisionStatus(
                  decisionDetail.path,
                  visible.findIndex((job) => job.path === decisionDetail.path),
                  status,
                  note,
                  channel,
                  decisionDetail.note.stat.mtime,
                )}
                onOpenNote={() => onOpen(decisionDetail.note)}
              />
            )}

            {jobs.length > 0 && viewMode === "list" && resultVisible.length > 0 && (
              <JobListView jobs={resultVisible} matcher={matcher} today={today} onDetail={openDetail} />
            )}

            {jobs.length > 0 && viewMode === "kanban" && kanbanJobs.length > 0 && (
              <JobKanbanView
                columns={kanbanColumns}
                matcher={matcher}
                savingPaths={savingPaths}
                statusErrors={statusErrors}
                onDetail={openDetail}
                onStatus={changeStatus}
              />
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
                onDetail={openDetail}
                onOpenReview={onOpen}
                onWiki={openWikiLink}
              />
            )}
          </div>
        </div>
      </div>

      {compared.length > 0 && (
        <JobCompareTray
          compared={compared}
          onToggle={toggleCompare}
          onOpen={() => setCompareOpen(true)}
          onClear={() => { setComparePaths([]); setCompareOpen(false); }}
        />
      )}

      {detail && viewMode !== "decision" && (
        <JobDrawer
          key={detail.path}
          job={detail}
          notes={notes}
          today={today}
          saving={savingPaths.includes(detail.path)}
          compared={comparePaths.includes(detail.path)}
          compareFull={compareFull}
          requestedStatus={channelRequest?.path === detail.path ? channelRequest.status : undefined}
          onClose={closeDetail}
          onStatus={(status, note, channel) => changeStatus(
            detail.path,
            status,
            note,
            channel,
            detail.note.stat.mtime,
          )}
          onFollowUp={(values) => changeFollowUp(detail.path, values, detail.note.stat.mtime)}
          onCompare={() => toggleCompare(detail.path)}
          onOpenNote={(note) => onOpen(note ?? detail.note)}
        />
      )}

      {compareOpen && compared.length >= 2 && (
        <JobCompare jobs={compared} onClose={() => setCompareOpen(false)} onDetail={(path) => {
          setCompareOpen(false);
          openDetail(path);
        }} />
      )}

      {/* 書込み失敗の表示は固定層の一箇所だけ（理由は JobStatusAlerts のコメント）。 */}
      <JobStatusAlerts statusErrors={statusErrors} jobs={jobs} onDismiss={dismissStatusError} />
    </section>
  );
}

// 外壳的 UI state（⌘K・overlay）变化时不重渲染整个视圖。props 都是稳定引用。
export default memo(JobsView);
