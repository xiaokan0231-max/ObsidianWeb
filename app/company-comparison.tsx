"use client";

import { useCompanyCopy } from "./company-copy";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { buildCompanyOverviews, type CompanyOverview } from "@/lib/company-overview";
import { buildCompanyCompareCandidates, companyComparePreset, COMPANY_COMPARE_LIMIT, type CompanyCompareCandidate, type CompanyComparePreset } from "@/lib/company-compare";
import type { Note } from "@/lib/notes";
import { prefersReducedMotion } from "@/lib/motion";
import { appViewFromPathname, appViewHref } from "./app-route";
import { CompanyCompare, CompanyCompareSelector, toggleCompanyComparison } from "./company-overview";
import { resolveCompanyComparisonSelection, updateCompanyComparisonSearch } from "./company-comparison-state";
import { URL_CHANGE_EVENT } from "./use-url-state";
import type { InterviewCatalog, InterviewCompareSummary } from "@/lib/interview-read-model";
import ScopeLoading from "./scope-loading";
import { loadInterviewComparisons } from "./interview-catalog-options";
import { CompanyAiAnalysisPanel, useCompanyAiAnalysis } from "./company-ai-analysis";

type CompanyComparisonProps = {
  notes: Note[];
  companyContexts?: CompanyOverview[];
  today: string;
  loading?: boolean;
  onOpenCompany: (context: CompanyOverview) => void;
  onOpenWiki: (target: string) => void;
  catalog?: InterviewCatalog | null;
  comparisonPaths?: string[];
  onSelect?: (paths: string[]) => void;
  onRetry?: () => void;
  analysisAvailable?: boolean;
};

const quickGroups = [
  { id: "upcoming", label: "即将面谈" },
  { id: "recent", label: "最近面过" },
  { id: "openwork", label: "OpenWork 高分" },
  { id: "jobtalk", label: "転職会議 高分" },
] as const;

function ComparisonToolbar({ count, choosing, onToggle, groups, onPick, onAnalyze, analyzeDisabled }: {
  count: number;
  choosing: boolean;
  onToggle: () => void;
  groups: Record<CompanyComparePreset, string[]>;
  onPick: (paths: string[]) => void;
  onAnalyze?: () => void;
  analyzeDisabled?: boolean;
}) {
  const t = useCompanyCopy();
  return <header className="cc-page-header">
    <div className="cc-page-title">
      <h1>{t("公司对比")}</h1>
      <span aria-live="polite">{t("{count} 项", { count })}</span>
    </div>
    <div className="cc-page-actions">
      <button type="button" aria-expanded={choosing} aria-controls={choosing ? "company-comparison-selection" : undefined} onClick={onToggle}>
        {t(choosing ? "收起选择" : "选择公司")}
      </button>
      <select aria-label={t("快捷组")} value="" onChange={(event) => {
        const group = quickGroups.find(({ id }) => id === event.currentTarget.value);
        if (group) onPick(groups[group.id]);
      }}>
        <option value="" disabled>{t("快捷组")}</option>
        {quickGroups.map(({ id, label }) => <option key={id} value={id} disabled={!groups[id].length}>
          {t(label)} · {t("{count} 项", { count: groups[id].length })}
        </option>)}
      </select>
      {onAnalyze && <button type="button" className="cc-analysis-trigger" disabled={analyzeDisabled}
        title={t("使用本机 Codex 和所选公司的公开资料生成分析。")} onClick={onAnalyze}>{t("AI 分析")}</button>}
    </div>
  </header>;
}

function CompanyComparisonReady({ notes, today, onOpenCompany, onOpenWiki, companyContexts }: CompanyComparisonProps) {
  const t = useCompanyCopy();
  const contexts = useMemo(() => companyContexts ?? buildCompanyOverviews(notes), [notes, companyContexts]);
  const candidates = useMemo(() => buildCompanyCompareCandidates(contexts, notes, today), [contexts, notes, today]);
  const [selection, setSelection] = useState(() => resolveCompanyComparisonSelection(contexts, notes, today, typeof window === "undefined" ? "" : window.location.search));
  const [choosing, setChoosing] = useState(selection.length < 2);
  const boardRef = useRef<HTMLDivElement>(null);
  const revealBoard = useRef(false);
  const selected = selection.flatMap((path) => { const context = contexts.find((item) => item.note.path === path); return context ? [context] : []; });
  const groups = useMemo(() => Object.fromEntries(quickGroups.map(({ id }) => [id, companyComparePreset(candidates, id)])) as InterviewCatalog["comparePresets"], [candidates]);

  const syncFromUrl = useEffectEvent(() => {
    if (appViewFromPathname(window.location.pathname) !== "insights") return;
    const paths = resolveCompanyComparisonSelection(contexts, notes, today, window.location.search);
    setSelection(paths);
    setChoosing(paths.length < 2);
  });
  useEffect(() => {
    const sync = () => syncFromUrl();
    window.addEventListener("popstate", sync);
    window.addEventListener(URL_CHANGE_EVENT, sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener(URL_CHANGE_EVENT, sync); };
  }, []);
  useEffect(() => {
    if (choosing || !revealBoard.current) return;
    revealBoard.current = false;
    boardRef.current?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth" });
    boardRef.current?.focus({ preventScroll: true });
  }, [choosing]);

  const select = (paths: string[]) => {
    const valid = new Set(contexts.map((context) => context.note.path));
    const next = [...new Set(paths)].filter((path) => valid.has(path)).slice(0, COMPANY_COMPARE_LIMIT);
    setSelection(next);
    const params = updateCompanyComparisonSearch(window.location.search, next);
    window.history.replaceState(window.history.state, "", `${appViewHref("insights", params)}${window.location.hash}`);
  };
  const startCompare = () => { revealBoard.current = true; setChoosing(false); };

  return <div className="company-comparison-page">
    <ComparisonToolbar count={selected.length} choosing={choosing} groups={groups}
      onToggle={() => setChoosing((open) => !open)} onPick={(paths) => { select(paths); setChoosing(paths.length < 2); }} />
    {choosing && <div className="cc-selection-region" id="company-comparison-selection"><CompanyCompareSelector embedded contexts={contexts} selected={selected} notes={notes} today={today} onToggle={(path) => select(toggleCompanyComparison(selection, path))} onSelectPaths={select} onClose={() => setChoosing(false)} onCompare={startCompare} /></div>}
    {selected.length >= 2 ? <div className="cc-board-region" ref={boardRef} tabIndex={-1}><CompanyCompare embedded contexts={selected} notes={notes} today={today} onClose={() => {}} onDetail={onOpenCompany} onRemove={(path) => select(selection.filter((item) => item !== path))} onOpenWiki={onOpenWiki} /></div>
      : <section className="cc-empty"><h2>{selected.length ? t("再选一家，就能看出差异") : t("从几家感兴趣的公司开始")}</h2></section>}
  </div>;
}

/** 等面试范围加载后才解析正本，避免冷启动把有效路径误判为失效。 */
export default function CompanyComparison(props: CompanyComparisonProps) {
  const t = useCompanyCopy();
  return props.loading && !props.catalog ? <section className="cc-empty" aria-busy="true"><h1>{t("公司对比")}</h1><p>{t("正在读取公司、面谈与外部评价…")}</p></section>
    : props.catalog ? <ProjectedCompanyComparison {...props} catalog={props.catalog} /> : <CompanyComparisonReady {...props} />;
}

function ProjectedCompanyComparison({ notes, today, catalog, comparisonPaths, loading, onSelect, onRetry, onOpenCompany, onOpenWiki, companyContexts, analysisAvailable }: CompanyComparisonProps & { catalog: InterviewCatalog }) {
  const t = useCompanyCopy();
  const selection = comparisonPaths ?? catalog.compareDefaults;
  const [choosingOverride, setChoosing] = useState<boolean | null>(null);
  const choosing = choosingOverride ?? selection.length < 2;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("relevant");
  const [sort, setSort] = useState("relevance");
  const [loadedOptions, setLoadedOptions] = useState<{ revision: string; items: InterviewCompareSummary[] } | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const options = loadedOptions && loadedOptions.revision === catalog.revision ? loadedOptions.items : catalog.comparisons;
  const optionsReady = options.length >= (catalog.comparisonTotal ?? catalog.comparisons.length);
  const loadOptions = useCallback(async () => {
    if (optionsReady || !catalog.revision) return;
    try {
      const items = await loadInterviewComparisons(catalog.revision);
      setOptionsError(""); setLoadedOptions({ revision: catalog.revision, items });
    }
    catch (error) { setOptionsError(error instanceof Error ? error.message : "选择目录读取失败"); }
  }, [optionsReady, catalog.revision]);
  useEffect(() => {
    if (!choosing || optionsReady || !catalog.revision) return;
    let active = true;
    const revision = catalog.revision;
    loadInterviewComparisons(revision).then((items) => {
      if (active) { setOptionsError(""); setLoadedOptions({ revision, items }); }
    }).catch((error) => { if (active) setOptionsError(error instanceof Error ? error.message : "选择目录读取失败"); });
    return () => { active = false; };
  }, [choosing, optionsReady, catalog.revision]);
  const contexts = useMemo(() => companyContexts ?? buildCompanyOverviews(notes), [notes, companyContexts]);
  const selected = selection.flatMap((path) => { const context = contexts.find((item) => item.note.path === path); return context ? [context] : []; });
  const analysisReady = Boolean(analysisAvailable && catalog.revision && !loading && selection.length >= 2 && selected.length === selection.length);
  const analysis = useCompanyAiAnalysis(catalog.revision, selection, analysisReady);
  const startAnalysis = () => {
    setChoosing(false);
    setAnalysisOpen(true);
    if (!analysis.result && analysis.error !== "stale_revision") void analysis.generate();
  };
  const selectedSet = new Set(selection);
  const full = selection.length >= COMPANY_COMPARE_LIMIT;
  const select = (paths: string[]) => {
    if (choosing) setChoosing(true);
    onSelect?.(paths);
  };
  const filters = [{ id: "relevant", label: "有资料或面谈" }, { id: "selected", label: "已选公司" }, { id: "upcoming", label: "即将面谈" },
    { id: "recent", label: "面过的公司" }, { id: "rated", label: "有平台评分" }, { id: "all", label: "全部案件" }];
  const filtered = (id: string) => options.filter((item) => id === "selected" ? selectedSet.has(item.path)
    : id === "upcoming" ? item.eventAt : id === "recent" ? item.lastInterviewAt : id === "rated" ? item.reviews.length
      : id === "relevant" ? item.hasProfile || item.hasAssessment || item.hasInterview || selectedSet.has(item.path) : true);
  const tokens = query.normalize("NFKC").toLocaleLowerCase("ja-JP").trim().split(/\s+/).filter(Boolean);
  const order = new Map(options.map((item, index) => [item.path, index]));
  const visible = filtered(filter).filter((item) => tokens.every((token) => item.haystack.includes(token))).sort((a, b) => {
    if (sort === "recent") return b.lastInterviewAt.localeCompare(a.lastInterviewAt) || order.get(a.path)! - order.get(b.path)!;
    if (sort === "openwork" || sort === "jobtalk") {
      const platform = sort === "openwork" ? "OpenWork" : "転職会議";
      const left = a.reviews.find((item) => item.platform === platform)?.score ?? null;
      const right = b.reviews.find((item) => item.platform === platform)?.score ?? null;
      if (left === null && right !== null) return 1;
      if (left !== null && right === null) return -1;
      if (left !== null && right !== null && left !== right) return right - left;
    }
    return order.get(a.path)! - order.get(b.path)!;
  });
  const candidates: CompanyCompareCandidate[] = selected.flatMap((context) => {
    const item = options.find((item) => item.path === context.note.path);
    return item ? [{ ...item, context }] : [];
  });
  return <div className="company-comparison-page">
    <ComparisonToolbar count={selection.length} choosing={choosing} groups={catalog.comparePresets}
      onAnalyze={analysisAvailable ? startAnalysis : undefined} analyzeDisabled={!analysisReady || analysis.loading}
      onToggle={() => setChoosing(!choosing)} onPick={(paths) => {
        select(paths);
        setChoosing(paths.length < 2);
        setQuery("");
        setFilter("relevant");
        setSort("relevance");
      }} />
    {choosing && <section className="cc-selection-region co-selector-shell" id="company-comparison-selection" aria-label={t("选择公司对比")}>
      <div className="co-selector-tools"><label><span className="sr-only">{t("搜索公司、岗位或业务")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("搜索公司、岗位或业务")} /></label>
        <label>{t("排序")}<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="relevance">{t("面谈与资料优先")}</option><option value="recent">{t("最近面过在前")}</option><option value="openwork">{t("OpenWork 高 → 低")}</option><option value="jobtalk">{t("転職会議 高 → 低")}</option></select></label></div>
      <div className="co-selector-filters">{filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{t(item.label)}<small>{optionsReady ? filtered(item.id).length : "—"}</small></button>)}</div>
      {!optionsReady ? optionsError ? <p role="alert">{optionsError}<button type="button" onClick={() => void loadOptions()}>{t("重试")}</button></p> : <ScopeLoading label={t("选择公司")} /> : <><div className="co-candidate-grid" role="group" aria-label={t("可对比的公司与岗位")}>{visible.map((item) => <label key={item.path} className={`co-candidate-card${selectedSet.has(item.path) ? " selected" : ""}${full && !selectedSet.has(item.path) ? " disabled" : ""}`}>
        <input type="checkbox" checked={selectedSet.has(item.path)} disabled={full && !selectedSet.has(item.path)} onChange={() => select(toggleCompanyComparison(selection, item.path))} aria-label={`${item.shortName} · ${item.displayRole}`} />
        <div className="co-candidate-head"><div className="co-candidate-identity"><h3>{item.shortName}</h3><p>{item.displayRole}</p></div><span className="co-check-indicator">{selectedSet.has(item.path) ? "✓" : "＋"}</span></div>
        <p className="co-candidate-business">{item.business || t("业务资料待补，可先查看岗位与已有评价")}</p><div className="co-candidate-meta"><span>{t(item.status)}</span><span>{t(item.dateLabel)}</span><span>{item.channel}</span></div>
        <div className="co-candidate-ratings">{item.reviews.map((review) => <span key={review.platform}>{review.platform} · {review.score} / 5</span>)}</div><div className="co-readiness"><span>{t(item.readinessLabel)}</span><small>{selectedSet.has(item.path) ? t("已选入对比") : t("点击加入")}</small></div>
      </label>)}</div>
      {!visible.length && <p>{t("这里还没有匹配的公司")}</p>}
      </>}
      <footer className="co-selector-footer"><div className="co-selected-chips">{selection.map((path) => <button key={path} type="button" onClick={() => select(selection.filter((item) => item !== path))}>{options.find((item) => item.path === path)?.shortName} ×</button>)}</div>
        <div className="co-selector-submit"><span>{selection.length} / {COMPANY_COMPARE_LIMIT}</span><button type="button" onClick={() => select([])}>{t("清空")}</button><button type="button" disabled={selection.length < 2} onClick={() => setChoosing(false)}>{t("开始对比 ")}→</button></div></footer>
    </section>}
    {selection.length >= 2 ? selected.length === selection.length ? <CompanyCompare embedded contexts={selected} notes={notes} today={today} projectedCandidates={candidates} onClose={() => {}} onDetail={onOpenCompany} onRemove={(path) => select(selection.filter((item) => item !== path))} onOpenWiki={onOpenWiki}
      analysisTab={analysisAvailable ? { active: analysisOpen, disabled: !analysisReady && !analysisOpen, onToggle: setAnalysisOpen,
        content: <CompanyAiAnalysisPanel analysis={analysis} ready={analysisReady} onReload={onRetry} /> } : undefined} />
      : loading ? <ScopeLoading label={t("公司对比")} /> : <section className="cc-empty" role="alert"><p>{t("对比资料读取失败。")}</p>{onRetry && <button type="button" onClick={onRetry}>{t("重试")}</button>}</section> : <section className="cc-empty"><h2>{selection.length ? t("再选一家，就能看出差异") : t("从几家感兴趣的公司开始")}</h2></section>}
  </div>;
}
