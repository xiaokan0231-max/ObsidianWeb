"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { buildCompanyOverviews, type CompanyOverview } from "@/lib/company-overview";
import { buildCompanyCompareCandidates, COMPANY_COMPARE_LIMIT } from "@/lib/company-compare";
import type { Note } from "@/lib/notes";
import { prefersReducedMotion } from "@/lib/motion";
import { appViewFromPathname, appViewHref } from "./app-route";
import { CompanyCompare, CompanyCompareQuickPicks, CompanyCompareSelector, toggleCompanyComparison } from "./company-overview";
import { resolveCompanyComparisonSelection, updateCompanyComparisonSearch } from "./company-comparison-state";
import { URL_CHANGE_EVENT } from "./use-url-state";

type CompanyComparisonProps = {
  notes: Note[];
  today: string;
  loading?: boolean;
  onOpenCompany: (context: CompanyOverview) => void;
  onOpenWiki: (target: string) => void;
};

function CompanyComparisonReady({ notes, today, onOpenCompany, onOpenWiki }: CompanyComparisonProps) {
  const contexts = useMemo(() => buildCompanyOverviews(notes), [notes]);
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
    <header className="cc-page-header"><div><p className="cc-eyebrow">COMPARE · 机会，放在一起看</p><h1>公司对比</h1><p>从口碑、岗位契合与工作条件里，找到值得继续了解的机会。</p></div><div className="cc-page-actions"><button type="button" aria-expanded={choosing} aria-controls="company-comparison-selection" onClick={() => setChoosing((open) => !open)}>{choosing ? "收起选择" : "选择公司"}<span aria-hidden="true">{selected.length} / {COMPANY_COMPARE_LIMIT}</span></button></div></header>
    <div className="cc-page-summary" aria-live="polite"><span><strong>{selected.length}</strong> 项正在对比</span><span><strong>{relevantCount}</strong> 项有面谈或研究资料</span><span><strong>{ratedCount}</strong> 项有平台评分</span>{message && <span>{message}</span>}</div>
    {!choosing && <CompanyCompareQuickPicks candidates={candidates} onSelect={(paths, preset) => { select(paths); setMessage(`已选入${preset.title} ${paths.length} 家`); }} />}
    {choosing && <div className="cc-selection-region" id="company-comparison-selection"><CompanyCompareSelector embedded contexts={contexts} selected={selected} notes={notes} today={today} onToggle={(path) => select(toggleCompanyComparison(selection, path))} onSelectPaths={select} onClose={() => setChoosing(false)} onCompare={startCompare} /></div>}
    {selected.length >= 2 ? <div className="cc-board-region" ref={boardRef} tabIndex={-1}><CompanyCompare embedded contexts={selected} notes={notes} today={today} onClose={() => {}} onEdit={() => { setChoosing(true); window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "instant" : "smooth" }); }} onDetail={onOpenCompany} onRemove={(path) => select(selection.filter((item) => item !== path))} onOpenWiki={onOpenWiki} /></div>
      : <section className="cc-empty"><span aria-hidden="true">⇄</span><h2>{selected.length ? "再选一家，就能看出差异" : "从几家感兴趣的公司开始"}</h2><p>最多比较 {COMPANY_COMPARE_LIMIT} 项。按近期面谈或平台高分快速选组，也可以搜索岗位和业务。</p>{!choosing && <button type="button" onClick={() => setChoosing(true)}>选择公司</button>}</section>}
  </div>;
}

/** 等面试范围加载后才解析正本，避免冷启动把有效路径误判为失效。 */
export default function CompanyComparison(props: CompanyComparisonProps) {
  return props.loading ? <section className="cc-empty" aria-busy="true"><h1>公司对比</h1><p>正在读取公司、面谈与外部评价…</p></section> : <CompanyComparisonReady {...props} />;
}
