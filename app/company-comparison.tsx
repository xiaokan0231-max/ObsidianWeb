"use client";

import { useCompanyCopy } from "./company-copy";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { buildCompanyOverviews, type CompanyOverview } from "@/lib/company-overview";
import { buildCompanyCompareCandidates, COMPANY_COMPARE_LIMIT, type CompanyCompareCandidate } from "@/lib/company-compare";
import type { Note } from "@/lib/notes";
import { prefersReducedMotion } from "@/lib/motion";
import { appViewFromPathname, appViewHref } from "./app-route";
import { CompanyCompare, CompanyCompareQuickPicks, CompanyCompareSelector, toggleCompanyComparison } from "./company-overview";
import { resolveCompanyComparisonSelection, updateCompanyComparisonSearch } from "./company-comparison-state";
import { URL_CHANGE_EVENT, useInitialUrlSearch } from "./use-url-state";
import type { InterviewCatalog } from "@/lib/interview-read-model";
import type { InterviewSelection } from "./use-interview-context";
import ScopeLoading from "./scope-loading";
import { loadInterviewComparisons } from "./interview-catalog-options";
import type { InterviewCompareSummary } from "@/lib/interview-read-model";

type CompanyComparisonProps = {
  notes: Note[];
  companyContexts?: CompanyOverview[];
  today: string;
  loading?: boolean;
  onOpenCompany: (context: CompanyOverview) => void;
  onOpenWiki: (target: string) => void;
  catalog?: InterviewCatalog | null;
  onRemoteSelect?: (selection: InterviewSelection) => void;
};

function CompanyComparisonReady({ notes, today, onOpenCompany, onOpenWiki, companyContexts }: CompanyComparisonProps) {
  const t = useCompanyCopy();
  const contexts = useMemo(() => companyContexts ?? buildCompanyOverviews(notes), [notes, companyContexts]);
  const candidates = useMemo(() => buildCompanyCompareCandidates(contexts, notes, today), [contexts, notes, today]);
  const [selection, setSelection] = useState(() => resolveCompanyComparisonSelection(contexts, notes, today, typeof window === "undefined" ? "" : window.location.search));
  const [choosing, setChoosing] = useState(selection.length < 2);
  const [message, setMessage] = useState("");
  const boardRef = useRef<HTMLDivElement>(null);
  const revealBoard = useRef(false);
  const selected = selection.flatMap((path) => { const context = contexts.find((item) => item.note.path === path); return context ? [context] : []; });
  const relevantCount = candidates.filter((item) => item.context.profile || item.context.assessment || item.hasInterview).length;
  const ratedCount = candidates.filter((item) => item.reviews.length > 0).length;

  const syncFromUrl = useEffectEvent(() => {
    if (appViewFromPathname(window.location.pathname) !== "insights") return;
    const paths = resolveCompanyComparisonSelection(contexts, notes, today, window.location.search);
    setSelection(paths);
    setChoosing(paths.length < 2);
    setMessage("");
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
    <header className="cc-page-header"><div><p className="cc-eyebrow">{t("COMPARE · 机会，放在一起看")}</p><h1>{t("公司对比")}</h1><p>{t("从口碑、岗位契合与工作条件里，找到值得继续了解的机会。")}</p></div><div className="cc-page-actions"><button type="button" aria-expanded={choosing} aria-controls="company-comparison-selection" onClick={() => setChoosing((open) => !open)}>{choosing ? t("收起选择") : t("选择公司")}<span aria-hidden="true">{selected.length} / {COMPANY_COMPARE_LIMIT}</span></button></div></header>
    <div className="cc-page-summary" aria-live="polite"><span><strong>{selected.length}</strong>{t(" 项正在对比")}</span><span><strong>{relevantCount}</strong>{t(" 项有面谈或研究资料")}</span><span><strong>{ratedCount}</strong>{t(" 项有平台评分")}</span>{message && <span>{message}</span>}</div>
    {!choosing && <CompanyCompareQuickPicks candidates={candidates} onSelect={(paths, preset) => { select(paths); setMessage(t("已选入{preset} {count} 家", { preset: t(preset.title), count: paths.length })); }} />}
    {choosing && <div className="cc-selection-region" id="company-comparison-selection"><CompanyCompareSelector embedded contexts={contexts} selected={selected} notes={notes} today={today} onToggle={(path) => select(toggleCompanyComparison(selection, path))} onSelectPaths={select} onClose={() => setChoosing(false)} onCompare={startCompare} /></div>}
    {selected.length >= 2 ? <div className="cc-board-region" ref={boardRef} tabIndex={-1}><CompanyCompare embedded contexts={selected} notes={notes} today={today} onClose={() => {}} onEdit={() => { setChoosing(true); window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "instant" : "smooth" }); }} onDetail={onOpenCompany} onRemove={(path) => select(selection.filter((item) => item !== path))} onOpenWiki={onOpenWiki} /></div>
      : <section className="cc-empty"><span aria-hidden="true">⇄</span><h2>{selected.length ? t("再选一家，就能看出差异") : t("从几家感兴趣的公司开始")}</h2><p>{t("最多比较 ")}{COMPANY_COMPARE_LIMIT}{t(" 项。按近期面谈或平台高分快速选组，也可以搜索岗位和业务。")}</p>{!choosing && <button type="button" onClick={() => setChoosing(true)}>{t("选择公司")}</button>}</section>}
  </div>;
}

/** 等面试范围加载后才解析正本，避免冷启动把有效路径误判为失效。 */
export default function CompanyComparison(props: CompanyComparisonProps) {
  const t = useCompanyCopy();
  return props.loading && !props.catalog ? <section className="cc-empty" aria-busy="true"><h1>{t("公司对比")}</h1><p>{t("正在读取公司、面谈与外部评价…")}</p></section>
    : props.catalog ? <ProjectedCompanyComparison {...props} catalog={props.catalog} /> : <CompanyComparisonReady {...props} />;
}

function ProjectedCompanyComparison({ notes, today, catalog, onRemoteSelect, onOpenCompany, onOpenWiki, companyContexts }: CompanyComparisonProps & { catalog: InterviewCatalog }) {
  const t = useCompanyCopy();
  const initialSearch = useInitialUrlSearch();
  const selectionFrom = (search: string) => {
    const params = new URLSearchParams(search);
    const valid = new Set(catalog.comparisons.map((item) => item.path));
    return params.has("compare") ? [...new Set(params.getAll("compare"))].filter((path) => valid.has(path)).slice(0, COMPANY_COMPARE_LIMIT) : catalog.compareDefaults;
  };
  const [selection, setSelection] = useState(() => selectionFrom(initialSearch));
  const [choosing, setChoosing] = useState(selection.length < 2);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("relevant");
  const [sort, setSort] = useState("relevance");
  const [loadedOptions, setLoadedOptions] = useState<{ revision: string; items: InterviewCompareSummary[] } | null>(null);
  const [optionsError, setOptionsError] = useState("");
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
  const selectedSet = new Set(selection);
  const full = selection.length >= COMPANY_COMPARE_LIMIT;
  const select = (paths: string[]) => {
    const valid = new Set(options.map((item) => item.path));
    const next = [...new Set(paths)].filter((path) => valid.has(path)).slice(0, COMPANY_COMPARE_LIMIT);
    setSelection(next);
    const params = updateCompanyComparisonSearch(window.location.search, next);
    window.history.replaceState(window.history.state, "", `${appViewHref("insights", params)}${window.location.hash}`);
    onRemoteSelect?.({ paths: next });
  };
  const syncFromUrl = useEffectEvent(() => {
    const paths = selectionFrom(window.location.search);
    setSelection(paths); setChoosing(paths.length < 2); onRemoteSelect?.({ paths });
  });
  useEffect(() => {
    const sync = () => syncFromUrl();
    window.addEventListener("popstate", sync); window.addEventListener(URL_CHANGE_EVENT, sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener(URL_CHANGE_EVENT, sync); };
  }, []);
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
  const presets = [{ id: "upcoming", title: "近期面谈" }, { id: "recent", title: "最近面过" }, { id: "openwork", title: "OpenWork 高分" }, { id: "jobtalk", title: "転職会議 高分" }] as const;
  const picks = <div className="co-quick-picks">{presets.map((preset) => <button key={preset.id} type="button" disabled={!catalog.comparePresets[preset.id].length} onClick={() => {
    select(catalog.comparePresets[preset.id]); setQuery(""); setFilter("selected"); setSort(preset.id === "upcoming" ? "relevance" : preset.id);
  }}>{t(preset.title)}<small>{catalog.comparePresets[preset.id].length}</small></button>)}</div>;
  const candidates: CompanyCompareCandidate[] = selected.flatMap((context) => {
    const item = options.find((item) => item.path === context.note.path);
    return item ? [{ ...item, context }] : [];
  });
  return <div className="company-comparison-page">
    <header className="cc-page-header"><div><p className="cc-eyebrow">{t("COMPARE · 机会，放在一起看")}</p><h1>{t("公司对比")}</h1><p>{t("从口碑、岗位契合与工作条件里，找到值得继续了解的机会。")}</p></div>
      <div className="cc-page-actions"><button type="button" aria-expanded={choosing} aria-controls="company-comparison-selection" onClick={() => setChoosing((open) => !open)}>{choosing ? t("收起选择") : t("选择公司")}<span>{selection.length} / {COMPANY_COMPARE_LIMIT}</span></button></div></header>
    <div className="cc-page-summary" aria-live="polite"><span><strong>{selection.length}</strong>{t(" 项正在对比")}</span><span><strong>{catalog.comparisonCounts?.relevant ?? options.filter((item) => item.hasProfile || item.hasAssessment || item.hasInterview).length}</strong>{t(" 项有面谈或研究资料")}</span><span><strong>{catalog.comparisonCounts?.rated ?? options.filter((item) => item.reviews.length).length}</strong>{t(" 项有平台评分")}</span></div>
    {choosing ? <div className="cc-selection-region co-selector-shell" id="company-comparison-selection">
      <header className="co-selector-hero"><div className="co-selector-heading"><h2>{t("选几家，一起看")}</h2><span>{t("岗位、面谈时间与口碑放在一起，最多选择 ")}{COMPANY_COMPARE_LIMIT}{t(" 项。")}</span></div></header>
      {picks}<div className="co-selector-tools"><label><span className="sr-only">{t("搜索公司、岗位或业务")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("想不起来名字？也可以搜岗位、业务或渠道")} /></label>
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
    </div> : picks}
    {selection.length >= 2 ? selected.length === selection.length ? <CompanyCompare embedded contexts={selected} notes={notes} today={today} projectedCandidates={candidates} onClose={() => {}} onEdit={() => setChoosing(true)} onDetail={onOpenCompany} onRemove={(path) => select(selection.filter((item) => item !== path))} onOpenWiki={onOpenWiki} />
      : <ScopeLoading label={t("公司对比")} /> : <section className="cc-empty"><h2>{selection.length ? t("再选一家，就能看出差异") : t("从几家感兴趣的公司开始")}</h2></section>}
  </div>;
}
