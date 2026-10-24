"use client";

import { type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { buildProgressDashboard, type ProgressSegment } from "@/lib/recent-progress-dashboard";
import type { RecentProgressOverview } from "@/lib/recent-progress-overview";
import type { RecentProgressEntry } from "@/lib/recent-progress";
import "./styles/progress-dashboard.css";

const zh = {
  eyebrow: "YOUR MOMENTUM", headline: "每一步，都看得见。", description: "看看机会走到了哪里，把注意力留给值得推进的事。",
  companies: "有动态的公司", advancing: "已确认的推进", waiting: "申请与保留", rejected: "未采用", companyUnit: "家", caseUnit: "个案件",
  trend: "企业动态趋势", trendNote: "按事件日期统计有动态的公司", daily: "每日去重", monthly: "每月去重", trendUnit: "家公司",
  trendHint: "点击柱形，查看对应公司", noEvents: "这段时间还没有已确认的企业动态。", period: "所选时段", clear: "清除选择", records: "条记录", dateRecords: "企业动态明细",
  distribution: "本期案件分布", distributionNote: "本期有记录的案件 · 每个案件取最新记录", distributionHint: "按岗位计数，点击分类查看明细", applied: "已申请", held: "保留", noCases: "暂无案件记录", latest: "本期最新记录",
  actionTitle: "需要你处理", actionClear: "当前没有已核实的本人必要动作", actionClearNote: "有新进展时，再把注意力放到这里。", actionUnit: "项", actionLink: "查看事项", actionNote: "不受所选时间范围限制",
  countNote: "公司按名称去重；同一公司可涉及多个案件。各类公司数可能重叠，不宜相加。", basis: "根据已记录的事件日期回看，不代表完整历史或转化率。",
};
const ja: typeof zh = {
  eyebrow: "YOUR MOMENTUM", headline: "一歩ずつ、動きが見える。", description: "選考の現在地を確かめて、次に進めたい機会へ。",
  companies: "動きのあった会社", advancing: "確認できた進展", waiting: "応募・保留", rejected: "不採用", companyUnit: "社", caseUnit: "案件",
  trend: "企業の動き", trendNote: "発生日に基づく、動きのあった会社数", daily: "日ごとに集約", monthly: "月ごとに集約", trendUnit: "社",
  trendHint: "棒をクリックして会社を確認", noEvents: "この期間には確認済みの企業の動きがありません。", period: "選択期間", clear: "選択を解除", records: "件の記録", dateRecords: "企業の動きの明細",
  distribution: "期間内の案件内訳", distributionNote: "期間内に記録がある案件の最新の記録", distributionHint: "職種別に集計・分類をクリックして明細へ", applied: "応募済", held: "保留", noCases: "案件の記録はありません", latest: "期間内の最新記録",
  actionTitle: "あなたの対応が必要", actionClear: "現在、確認済みの本人対応はありません", actionClearNote: "新しい動きがあれば、ここから確認できます。", actionUnit: "件", actionLink: "事項を確認", actionNote: "選択した期間に関係なく表示",
  countNote: "会社名の表記を統一して集計。同じ会社が複数の案件・分類に含まれるため、各社数は合計できません。", basis: "記録された発生日に基づきます。完全な履歴や選考の転換率ではありません。",
};

type Copy = typeof zh;
type Dashboard = ReturnType<typeof buildProgressDashboard>;
type Props = {
  overview: RecentProgressOverview;
  locale: string;
  onToggle: (key: string) => void;
  selection?: string;
  onSelection: (selection: string | undefined) => void;
  renderRow: (entry: RecentProgressEntry) => ReactNode;
};
const segmentLabel = (key: ProgressSegment, copy: Copy) => ({ advancing: copy.advancing, applied: copy.applied, held: copy.held, rejected: copy.rejected })[key];
const shortDate = (date: string, monthly: boolean) => monthly ? date.slice(0, 7).replace("-", "/") : `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function ProgressDistribution({ data, copy, selectedSegment, onSelect }: { data: Dashboard; copy: Copy; selectedSegment: ProgressSegment | null; onSelect: (key: ProgressSegment) => void }) {
  const arcs = data.segments.map((segment, index) => ({ ...segment,
    size: data.caseCount ? segment.entries.length / data.caseCount * 100 : 0,
    start: data.caseCount ? data.segments.slice(0, index).reduce((sum, previous) => sum + previous.entries.length, 0) / data.caseCount * 100 : 0,
  }));
  return <section className="momentum-panel momentum-distribution" aria-labelledby="momentum-distribution-title">
    <header><div><h2 id="momentum-distribution-title">{copy.distribution}</h2><p>{copy.distributionNote}</p></div><span className="momentum-panel-number">02</span></header>
    <div className="momentum-distribution-content">
      <div className="momentum-ring">
        <svg viewBox="0 0 160 160" role="img" aria-label={`${copy.distribution} · ${data.caseCount} ${copy.caseUnit}`}>
          <circle className="momentum-ring-track" cx="80" cy="80" r="65" pathLength="100" />
          {arcs.filter((segment) => segment.entries.length > 0).map((segment) => <circle key={segment.key} className="momentum-ring-segment" data-segment={segment.key} cx="80" cy="80" r="65" pathLength="100" strokeDasharray={`${segment.size} ${100 - segment.size}`} strokeDashoffset={-segment.start} transform="rotate(-90 80 80)"><title>{`${segmentLabel(segment.key, copy)} · ${segment.entries.length}`}</title></circle>)}
        </svg>
        <div className="momentum-ring-label"><strong>{data.caseCount}</strong><span>{copy.caseUnit}</span></div>
      </div>
      <div className="momentum-legend">{data.segments.map((segment) => <button type="button" key={segment.key} data-segment={segment.key} aria-pressed={selectedSegment === segment.key} onClick={() => onSelect(segment.key)} disabled={!segment.entries.length}><i aria-hidden="true" /><span>{segmentLabel(segment.key, copy)}</span><strong>{segment.entries.length}</strong><span aria-hidden="true">↗</span></button>)}</div>
    </div>
    <p className="momentum-chart-hint">{data.caseCount ? copy.distributionHint : copy.noCases}</p>
  </section>;
}

export default function ProgressDashboard({ overview, locale, onToggle, selection, onSelection, renderRow }: Props) {
  const copy = locale === "ja" ? ja : zh;
  const data = buildProgressDashboard(overview);
  const selectedDate = selection?.startsWith("day:") ? selection.slice(4) : null;
  const selectedSegment = data.segments.find((segment) => selection === `segment:${segment.key}`)?.key ?? null;
  const selected = data.buckets.find((bucket) => bucket.date === selectedDate);
  const selectedCases = selection === "group:waiting" ? { key: "waiting" as const, entries: data.segments.filter((segment) => segment.key === "applied" || segment.key === "held").flatMap((segment) => segment.entries) } : data.segments.find((segment) => segment.key === selectedSegment);
  const metrics = [
    { key: "all", label: copy.companies, value: data.companies, glyph: "↗" },
    { key: "advancing", label: copy.advancing, value: data.advancingCompanies, glyph: "↑" },
    { key: "waiting", label: copy.waiting, value: data.waitingCompanies, glyph: "◷" },
    { key: "rejected", label: copy.rejected, value: data.rejectedCompanies, glyph: "−" },
  ];
  const tickStep = Math.max(1, Math.ceil(data.peak / 4));
  const ceiling = tickStep * 4;

  return <div className="momentum-dashboard">
    <section className="momentum-summary" aria-label={copy.period}>
      <div className="momentum-intro"><span>{copy.eyebrow}</span><h2>{copy.headline}</h2><p>{copy.description}</p><svg viewBox="0 0 200 80" aria-hidden="true"><path d="M0 75 35 63 70 65 105 39 140 44 175 13 200 0" /></svg></div>
      <div className="momentum-metrics">{metrics.map((metric) => <button className="momentum-metric" type="button" key={metric.key} data-metric={metric.key} onClick={() => {
        if (metric.key === "all") document.getElementById("momentum-trend-title")?.scrollIntoView({ behavior: "smooth", block: "center" });
        else if (metric.key === "waiting") onSelection(selection === "group:waiting" ? undefined : "group:waiting");
        else onToggle(metric.key);
      }}><span className="momentum-metric-title">{metric.label}<span aria-hidden="true">{metric.glyph}</span></span><span className="momentum-metric-value"><strong>{metric.value}</strong><span>{copy.companyUnit}</span></span><span className="momentum-metric-foot">{metric.key === "all" ? copy.period : copy.latest}<span aria-hidden="true">↗</span></span></button>)}</div>
    </section>
    <div className="momentum-charts">
      <section className="momentum-panel momentum-trend" aria-labelledby="momentum-trend-title">
        <header><div><h2 id="momentum-trend-title">{copy.trend}</h2><p>{copy.trendNote} · {data.monthly ? copy.monthly : copy.daily}</p></div><span className="momentum-panel-number">01</span></header>
        <div className="momentum-chart-area">
          <div className="momentum-y-axis" aria-hidden="true">{[4, 3, 2, 1, 0].map((step) => <span key={step}>{step * tickStep}</span>)}</div>
          <div className="momentum-plot">
            <div className="momentum-grid" aria-hidden="true">{[0, 1, 2, 3, 4].map((line) => <i key={line} />)}</div>
            <div className="momentum-bars" style={{ "--bucket-count": data.buckets.length } as CSSProperties}>{data.buckets.map((bucket, index) => {
              const label = `${shortDate(bucket.date, data.monthly)} · ${bucket.companies} ${copy.trendUnit}`;
              const showLabel = data.buckets.length <= 10 || index % Math.ceil(data.buckets.length / 7) === 0 || index === data.buckets.length - 1;
              return <button type="button" className="momentum-bar" key={bucket.date} aria-label={label} aria-pressed={selectedDate === bucket.date} disabled={!bucket.entries.length} onClick={() => onSelection(selectedDate === bucket.date ? undefined : `day:${bucket.date}`)} style={{ "--bar-height": `${bucket.companies / ceiling * 100}%` } as CSSProperties}>
                <span className="momentum-bar-tooltip">{label}</span><span className="momentum-bar-fill">{bucket.companies > 0 && data.buckets.length <= 10 && <b>{bucket.companies}</b>}</span><span className={`momentum-x-label${showLabel ? "" : " momentum-x-label-hidden"}`}>{shortDate(bucket.date, data.monthly)}</span>
              </button>;
            })}</div>
          </div>
        </div>
        <p className="momentum-chart-hint"><i aria-hidden="true" />{data.companies ? copy.trendHint : copy.noEvents}</p>
      </section>
      <ProgressDistribution data={data} copy={copy} selectedSegment={selectedSegment} onSelect={(key) => onSelection(selectedSegment === key ? undefined : `segment:${key}`)} />
    </div>
    {selected && <section className="momentum-day-detail" aria-label={copy.dateRecords} aria-live="polite"><header><div><h3>{shortDate(selected.date, data.monthly)}{data.monthly && ` — ${shortDate(selected.end, false)}`} <span>{selected.companies} {copy.trendUnit} · {selected.entries.length} {copy.records}</span></h3></div><button type="button" onClick={() => onSelection(undefined)}>{copy.clear} ×</button></header><ul className="recent-progress-list">{selected.entries.map(renderRow)}</ul></section>}
    {selectedCases && <section className="momentum-day-detail" aria-label={copy.distribution} aria-live="polite"><header><h3>{selectedCases.key === "waiting" ? copy.waiting : segmentLabel(selectedCases.key, copy)} <span>{selectedCases.entries.length} {copy.caseUnit}</span></h3><button type="button" onClick={() => onSelection(undefined)}>{copy.clear} ×</button></header><ul className="recent-progress-list">{selectedCases.entries.map(renderRow)}</ul></section>}
    <div className="momentum-action-strip" data-has-actions={overview.current.length > 0}>
      <span className="momentum-action-icon" aria-hidden="true">{overview.current.length ? "!" : "✓"}</span>
      <div><strong>{overview.current.length ? <>{copy.actionTitle} · {overview.current.length} {copy.actionUnit}</> : copy.actionClear}</strong><p>{overview.current.length ? copy.actionNote : copy.actionClearNote}</p></div>
      <Link href="/actions">{copy.actionLink}<span aria-hidden="true"> →</span></Link>
    </div>
    <p className="momentum-count-note">{copy.countNote} {copy.basis}</p>
  </div>;
}
