"use client";

import { useMemo, useState } from "react";
import type { AdvisoryEvidenceRef, InterviewInsights as InsightsReport } from "@/lib/interview-advisory";
import type { Note } from "@/lib/notes";
import { AdvisoryEvidence, AdvisoryFeedback, AdvisoryParagraphs } from "./interview-advisory";
import { useInterviewAdvisorySync } from "./interview-advisory-sync";
import { ADVISORY_STAGE_LABELS, EMPTY_INSIGHTS_FILTER, filterAdvisoryCoverage, filterInsightModules, type AdvisoryCoverage, type InsightsFilter } from "./interview-insights-state";
import { useUiLocale } from "./ui-locale";

const INSIGHTS_MENU_JA: Record<string, string> = {
  "横向分析模块": "比較分析の項目",
  "重试更新": "更新を再試行",
  "检查并更新": "確認して更新",
  "公司": "企業",
  "全部公司": "すべての企業",
  "开始日期": "開始日",
  "结束日期": "終了日",
  "阶段": "選考段階",
  "全部阶段": "すべての段階",
  "清除筛选": "絞り込みを解除",
  "中介面谈": "エージェント面談",
  "条件与岗位匹配": "条件・職種のマッチング",
  "技术面试": "技術面接",
  "最终面试": "最終面接",
  "其他阶段": "その他の段階",
  "显示 {visible} / {total} 场 · 已选 {selected} 场对照": "表示 {visible} / {total} 件 · 比較対象 {selected} 件",
};

const INSIGHTS_NOTE = "20_求職/_素材/面接横断_顧問分析.md";
const STATUS_LABELS: Record<string, string> = { ready: "已纳入", stale: "材料已更新", missing: "待分析", blocked: "待裁定" };
const EMPTY_COVERAGE: AdvisoryCoverage[] = [];

export function InsightsCoverage({ coverage, selected, onSelect, onOpen }: {
  coverage: AdvisoryCoverage[]; selected: Set<string>; onSelect: (path: string) => void; onOpen: (path: string) => void;
}) {
  const companies = [...new Set(coverage.map((item) => item.company))];
  return <div className="ii-coverage" aria-label="场次范围与多轮对照">
    {companies.map((company) => <section key={company}><h3>{company || "公司未命名"}</h3><ul>
      {coverage.filter((item) => item.company === company).sort((a, b) => a.date.localeCompare(b.date) || a.sourcePath.localeCompare(b.sourcePath)).map((item) => <li key={item.sourcePath}>
        <label><input type="checkbox" checked={selected.has(item.sourcePath)} onChange={() => onSelect(item.sourcePath)} aria-label={`对照 ${company} ${item.date} ${item.round}`} />
          <span><b>{item.date || "日期未定"} · {item.round || "轮次未定"}</b><small>{ADVISORY_STAGE_LABELS[item.stage ?? ""] || "阶段待分析"}</small></span></label>
        <span className={`ii-status ${item.status}`}>{STATUS_LABELS[item.status]}</span><button type="button" onClick={() => onOpen(item.sourcePath)}>本场复盘 ↗</button>
        {(item.reason || item.lastError) && <p>{item.lastError || item.reason}</p>}
      </li>)}
    </ul></section>)}
  </div>;
}

export function InsightsReportView({ report, coverage, filter, selected, notes, onOpenEvidence, onFeedbackSaved }: {
  report: InsightsReport; coverage: AdvisoryCoverage[]; filter: InsightsFilter; selected: Set<string>; notes: Note[];
  onOpenEvidence: (ref: AdvisoryEvidenceRef) => void; onFeedbackSaved: (note?: Note) => void | Promise<void>;
}) {
  const { locale } = useUiLocale();
  const filtering = Object.values(filter).some(Boolean) || selected.size > 0;
  const modules = filterInsightModules(report, coverage, filter).map((module) => ({ ...module,
    findings: selected.size ? module.findings.filter((finding) => finding.evidence.some((ref) => selected.has(ref.sourcePath))) : module.findings,
  }));
  return <div className="ii-report">
    {!filtering && <section className="ia-overview"><span className="ia-eyebrow">跨场综合判断</span><h2>这些面谈放在一起，说明了什么</h2><AdvisoryParagraphs text={report.overviewZh} /></section>}
    {filtering && <p className="ii-filter-note" role="status">正在定位与所选场次相关的已有发现。每条发现保留完整对照来源；筛选不会重新计算判断。</p>}
    <nav className="ii-modules-nav" aria-label={locale === "ja" ? INSIGHTS_MENU_JA["横向分析模块"] : "横向分析模块"}>{modules.map((module) => <a key={module.key} href={`#insight-${module.key}`}>{module.titleZh}<small>{module.findings.length}</small></a>)}</nav>
    {modules.map((module) => <section className="ia-section" id={`insight-${module.key}`} key={module.key}>
      <header><h2>{module.titleZh}</h2>{!filtering && <AdvisoryParagraphs text={module.commentaryZh} />}</header>
      {!module.findings.length && <p className="ii-no-match">{filtering ? "当前筛选没有对应发现。" : "目前还没有足够证据形成这一类横向判断。"}</p>}
      {/* 正文限宽 42em 保证好读；适用范围、证据与反馈放进右栏，宽屏上不留半张卡的空白。 */}
      {module.findings.map((finding) => <article className="ii-finding" key={finding.id}>
        <div className="ii-finding-main"><h3>{finding.titleZh}</h3><AdvisoryParagraphs text={finding.bodyZh} /></div>
        <div className="ii-finding-side">
          <div className="ii-boundary"><h4>这项判断的适用范围</h4><AdvisoryParagraphs text={finding.boundaryZh} /></div>
          <AdvisoryEvidence {...finding} notes={notes} onOpenEvidence={onOpenEvidence} />
          <AdvisoryFeedback key={`${report.generatedAt}:${finding.id}`} notePath={INSIGHTS_NOTE} notes={notes}
            target={{ type: "insight", id: finding.id, revision: report.generatedAt, snapshot: JSON.stringify(finding) }} onSaved={onFeedbackSaved} />
        </div>
      </article>)}
    </section>)}
    <p className="ia-report-meta">分析更新于 {report.generatedAt.replace("T", " ").slice(0, 16)} · {report.model}</p>
  </div>;
}

export default function InterviewInsights({ notes, onOpenEvidence, onOpenReview, onNoteWritten, onVaultChanged }: {
  notes: Note[]; onOpenEvidence: (ref: AdvisoryEvidenceRef) => void; onOpenReview: (path: string) => void;
  onNoteWritten?: (note: Note) => void; onVaultChanged: () => void | Promise<void>;
}) {
  const { locale } = useUiLocale();
  const ui = (label: string, values: Record<string, string | number> = {}) =>
    (locale === "ja" ? INSIGHTS_MENU_JA[label] ?? label : label).replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
  const sync = useInterviewAdvisorySync(notes);
  const [filter, setFilter] = useState<InsightsFilter>(EMPTY_INSIGHTS_FILTER);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const coverage = sync.state?.coverage ?? EMPTY_COVERAGE;
  const visible = useMemo(() => filterAdvisoryCoverage(coverage, filter), [coverage, filter]);
  const active = sync.state?.active;
  const error = sync.error || sync.state?.error;
  const failedSources = coverage.filter((item) => item.lastError);
  const needsRetry = Boolean(error) || failedSources.length > 0;
  return <div className="interview-insights-view">
    <header className="ii-hero"><span className="ia-eyebrow">面试横向对照</span><h1>把不同公司的对话放在一起看</h1>
      <p>比较企业关注、双方匹配、有效表达和机会条件，找到下一阶段值得采取的行动。</p>
      <div className="ii-hero-actions"><span role="status">{active ? `正在更新${active.sourcePath ? `：${active.sourcePath.split("/").at(-1)?.replace(/\.md$/, "")}` : "横向分析"}` : sync.busy ? "正在更新分析…" : coverage.length ? `已记录 ${coverage.length} 场面谈` : "正在读取面谈材料…"}</span>
        <button type="button" disabled={sync.busy || Boolean(active)} onClick={() => void sync.synchronize(needsRetry)}>{needsRetry ? ui("重试更新") : ui("检查并更新")}</button></div>
    </header>
    {error && <p className="ia-error" role="alert">{error} 已生成的内容仍然保留。</p>}
    {failedSources.length > 0 && <p className="ia-error" role="status">有 {failedSources.length} 场分析更新失败，原因列在对照范围中。其他场次可以继续阅读，点击重试更新可重新处理失败场次。</p>}
    {sync.state?.report && sync.state.insightsStatus !== "ready" && <p className="ii-filter-note" role="status">依据已有变化，下面保留上一版横向分析，完成更新后替换。</p>}
    <section className="ii-scope"><header><h2>对照范围</h2><p>同一公司多轮可以一起查看；未完成裁定的场次会显示原因。可用场次纳入生成材料，具体发现按主题选择证据，并非每场都在横向结论中被引用。</p></header>
      <div className="ii-filters"><label>{ui("公司")}<select value={filter.company} onChange={(event) => setFilter({ ...filter, company: event.target.value })}><option value="">{ui("全部公司")}</option>{[...new Set(coverage.map((item) => item.company))].sort().map((company) => <option key={company}>{company}</option>)}</select></label>
        <label>{ui("开始日期")}<input type="date" value={filter.from} onChange={(event) => setFilter({ ...filter, from: event.target.value })} /></label>
        <label>{ui("结束日期")}<input type="date" value={filter.to} onChange={(event) => setFilter({ ...filter, to: event.target.value })} /></label>
        <label>{ui("阶段")}<select value={filter.stage} onChange={(event) => setFilter({ ...filter, stage: event.target.value })}><option value="">{ui("全部阶段")}</option>{Object.entries(ADVISORY_STAGE_LABELS).map(([key, label]) => <option key={key} value={key}>{ui(label)}</option>)}</select></label>
        <button type="button" onClick={() => { setFilter(EMPTY_INSIGHTS_FILTER); setSelected(new Set()); }}>{ui("清除筛选")}</button>
      </div>
      <details open={selected.size > 0}><summary>{ui("显示 {visible} / {total} 场 · 已选 {selected} 场对照", { visible: visible.length, total: coverage.length, selected: selected.size })}</summary>
        <InsightsCoverage coverage={visible} selected={selected} onSelect={(path) => setSelected((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; })} onOpen={onOpenReview} />
      </details>
    </section>
    {sync.state?.report ? <InsightsReportView report={sync.state.report} coverage={coverage} filter={filter} selected={selected} notes={notes} onOpenEvidence={onOpenEvidence}
      onFeedbackSaved={async (note) => { if (note && onNoteWritten) onNoteWritten(note); else await onVaultChanged(); void sync.synchronize(); }} />
      : <section className="ia-empty"><h2>{sync.busy || active ? "正在整理跨场证据" : "横向分析尚未生成"}</h2><p>系统会先补齐已完成裁定的单场顾问分析，再统一生成横向结论。你可以继续阅读已有复盘。</p>{coverage.length === 0 && !sync.busy && <p>有可用的面谈整理稿后，这里会显示纳入范围。</p>}</section>}
  </div>;
}
