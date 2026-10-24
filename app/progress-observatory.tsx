"use client";

import { type CSSProperties, type KeyboardEvent } from "react";
import type { buildProgressDashboard, ProgressSegment } from "@/lib/recent-progress-dashboard";
import "./styles/progress-observatory.css";

type Data = ReturnType<typeof buildProgressDashboard>;
type Props = { data: Data; locale: string; selection?: string; onSelection: (value: string | undefined) => void };
const words = {
  "zh-CN": {
    flow: "案件流向", flowNote: "从本期涉及案件，流向各自的最新记录", flowHint: "点击流向，联动查看案件明细", total: "本期案件", unit: "个案件", advancing: "已确认推进", applied: "已申请", held: "保留", rejected: "未采用",
    heatmap: "记录活跃度", heatmapNote: "近 12 周 · 按事件日期统计公司", heatmapHint: "点击日期查看当日记录，描边标出所选时段", less: "少", more: "多", active: "有记录的日期", day: "天", companies: "家公司", weekdays: ["一", "", "三", "", "五", "", ""],
    stars: "机会星图", starsNote: "每个光点对应一个案件，颜色对应最新记录", starsHint: "悬停查看公司 · 点击光点查看案件", empty: "所选时段暂无可展示的案件", range: "所选时段", node: "案件", selected: "已选中", foot: "按案件聚合展示，不表示状态转移历史。",
  },
  ja: {
    flow: "案件の行き先", flowNote: "期間内の案件を、それぞれの最新記録へ分類", flowHint: "流れをクリックして案件の明細へ", total: "期間内の案件", unit: "案件", advancing: "確認できた進展", applied: "応募済", held: "保留", rejected: "不採用",
    heatmap: "記録のアクティビティ", heatmapNote: "直近 12 週・発生日ごとの会社数", heatmapHint: "日付をクリックして記録へ・枠線は選択期間", less: "少", more: "多", active: "記録のある日", day: "日", companies: "社", weekdays: ["月", "", "水", "", "金", "", ""],
    stars: "機会の星図", starsNote: "光点ひとつが案件、色は最新記録の分類", starsHint: "ホバーで会社を確認・光点をクリックして明細へ", empty: "この期間には表示できる案件がありません", range: "選択期間", node: "案件", selected: "選択中", foot: "案件別の分類です。状態遷移の履歴ではありません。",
  },
};
const labelFor = (key: ProgressSegment, copy: typeof words["zh-CN"]) => copy[key];
function keyboardSelect(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

export function ProgressFlow({ data, locale, selection, onSelection }: Props) {
  const copy = locale === "ja" ? words.ja : words["zh-CN"];
  return <section className="momentum-panel signal-flow" aria-labelledby="signal-flow-title">
    <header><div><span className="signal-eyebrow">CASE FLOW</span><h2 id="signal-flow-title">{copy.flow}</h2><p>{copy.flowNote}</p></div><span className="momentum-panel-number">03 / FLOW</span></header>
    <svg className="signal-flow-map" viewBox="0 0 640 250" role="group" aria-label={copy.flow}>
      <defs>{data.segments.map((segment) => <linearGradient key={segment.key} id={`signal-flow-${segment.key}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--signal-cyan)" stopOpacity=".12" /><stop offset="1" stopColor={`var(--signal-${segment.key})`} stopOpacity=".7" /></linearGradient>)}</defs>
      <circle className="signal-source-orbit" cx="100" cy="125" r="73" /><circle className="signal-source-orbit signal-source-orbit-inner" cx="100" cy="125" r="61" />
      <circle className="signal-source-core" cx="100" cy="125" r="49" />
      <text className="signal-source-value" x="100" y="126">{data.caseCount}</text><text className="signal-source-caption" x="100" y="149">{copy.total}</text>
      {data.segments.map((segment, index) => {
        const y = 29 + index * 64;
        const path = `M153 125 C290 125 320 ${y} 450 ${y}`;
        const select = () => onSelection(selection === `segment:${segment.key}` ? undefined : `segment:${segment.key}`);
        return <g key={segment.key} data-segment={segment.key} className="signal-flow-branch" data-selected={selection === `segment:${segment.key}`}>
          {segment.entries.length > 0 && <><path className="signal-flow-ribbon" d={path} stroke={`url(#signal-flow-${segment.key})`} strokeWidth={Math.max(1, segment.entries.length / data.caseCount * 64)} /><path className="signal-flow-photons" d={path} style={{ "--flow-delay": `${index * -.7}s` } as CSSProperties} /></>}
          <g className="signal-flow-target" role="button" tabIndex={segment.entries.length ? 0 : -1} aria-disabled={!segment.entries.length} aria-pressed={selection === `segment:${segment.key}`} aria-label={`${labelFor(segment.key, copy)} · ${segment.entries.length} ${copy.unit}`} onClick={() => segment.entries.length && select()} onKeyDown={(event) => segment.entries.length && keyboardSelect(event, select)}>
            <rect x="450" y={y - 22} width="180" height="44" rx="8" /><circle cx="467" cy={y} r="3" /><text className="signal-flow-label" x="478" y={y + 4}>{labelFor(segment.key, copy)}</text><text className="signal-flow-value" x="612" y={y + 5}>{segment.entries.length}</text>
          </g>
        </g>;
      })}
    </svg>
    <p className="momentum-chart-hint"><i />{data.caseCount ? copy.flowHint : copy.empty}</p>
  </section>;
}

export function ProgressHeatmap({ data, locale, selection, onSelection }: Props) {
  const copy = locale === "ja" ? words.ja : words["zh-CN"];
  return <section className="momentum-panel signal-heatmap" aria-labelledby="signal-heatmap-title">
    <header><div><span className="signal-eyebrow">ACTIVITY FIELD</span><h2 id="signal-heatmap-title">{copy.heatmap}</h2><p>{copy.heatmapNote}</p></div><span className="momentum-panel-number">04 / ACTIVITY</span></header>
    <div className="signal-heatmap-summary"><strong>{data.activeDays}</strong><span>{copy.day}<small>{copy.active}</small></span><svg viewBox="0 0 100 24" aria-hidden="true"><path d="M0 17 8 17 15 8 22 20 30 6 37 17 45 17 51 2 58 23 66 10 72 17 100 17" /></svg></div>
    <div className="signal-calendar">
      <div className="signal-weekdays" aria-hidden="true">{copy.weekdays.map((day, index) => <span key={index}>{day}</span>)}</div>
      <div className="signal-calendar-columns">{Array.from({ length: Math.ceil(data.heatmap.length / 7) }, (_, week) => <div className="signal-calendar-week" key={week}>
        <span className="signal-calendar-month">{(week === 0 || data.heatmap[week * 7].date.slice(5, 7) !== data.heatmap[(week - 1) * 7].date.slice(5, 7)) ? `${Number(data.heatmap[week * 7].date.slice(5, 7))}/` : ""}</span>
        {data.heatmap.slice(week * 7, week * 7 + 7).map((day) => {
          const level = day.companies ? Math.min(4, Math.max(1, Math.ceil(day.companies / data.heatmapPeak * 4))) : 0;
          const label = `${day.date} · ${day.companies} ${copy.companies}`;
          return <button type="button" key={day.date} className="signal-calendar-day" data-level={level} data-in-range={day.inRange} data-future={day.future} aria-label={label} aria-pressed={selection === `heat:${day.date}`} disabled={!day.entries.length || day.future} onClick={() => onSelection(selection === `heat:${day.date}` ? undefined : `heat:${day.date}`)}><span className="signal-calendar-tooltip">{label}</span></button>;
        })}
      </div>)}</div>
    </div>
    <div className="signal-heatmap-legend"><span>{copy.less}</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} />)}<span>{copy.more}</span></div>
    <p className="momentum-chart-hint">{copy.heatmapHint}</p>
  </section>;
}

export function ProgressConstellation({ data, locale, selection, onSelection }: Props) {
  const copy = locale === "ja" ? words.ja : words["zh-CN"];
  const count = data.stars.length;
  return <section className="momentum-panel signal-constellation" aria-labelledby="signal-stars-title">
    <header><div><span className="signal-eyebrow">OPPORTUNITY UNIVERSE</span><h2 id="signal-stars-title">{copy.stars}</h2><p>{copy.starsNote}</p></div><span className="momentum-panel-number">05 / UNIVERSE</span></header>
    <div className="signal-stars-layout"><div className="signal-stars-space">
      <svg viewBox="0 0 700 260" role="group" aria-label={copy.stars}>
        <defs><radialGradient id="signal-nebula"><stop offset="0" stopColor="var(--signal-cyan)" stopOpacity=".11" /><stop offset="1" stopColor="var(--signal-cyan)" stopOpacity="0" /></radialGradient></defs>
        <ellipse cx="350" cy="130" rx="300" ry="125" fill="url(#signal-nebula)" />
        {[55, 95, 135, 175, 215, 255].map((radius) => <ellipse key={radius} className="signal-star-orbit" cx="350" cy="130" rx={radius} ry={radius * .44} />)}
        <path className="signal-crosshair" d="M30 130H670M350 7V253" />
        {data.stars.map(({ entry, segment }, index) => {
          const angle = index * 2.399963229728653;
          const radius = Math.sqrt((index + 1) / Math.max(1, count));
          const x = 350 + Math.cos(angle) * radius * 290;
          const y = 130 + Math.sin(angle) * radius * 108;
          const selected = selection === `case:${entry.id}` || selection === `segment:${segment}`;
          const choose = () => onSelection(selection === `case:${entry.id}` ? undefined : `case:${entry.id}`);
          const label = `${entry.company} · ${entry.position} · ${labelFor(segment, copy)}`;
          return <g key={entry.id} className="signal-star" data-segment={segment} data-selected={selected} role="button" tabIndex={0} aria-label={label} aria-pressed={selection === `case:${entry.id}`} onClick={choose} onKeyDown={(event) => keyboardSelect(event, choose)} style={{ "--star-delay": `${(index % 17) * -.41}s` } as CSSProperties}>
            <title>{label}</title>
            {segment === "advancing" && <circle className="signal-star-pulse" cx={x} cy={y} r="11" />}
            {index % 4 === 0 && <path className="signal-star-tether" d={`M350 130L${x} ${y}`} />}
            <circle className="signal-star-halo" cx={x} cy={y} r="9" /><circle className="signal-star-core" cx={x} cy={y} r={segment === "advancing" ? 4.2 : 3} />
            <circle className="signal-star-hit" cx={x} cy={y} r="12" />
            <g className="signal-star-tooltip" transform={`translate(${Math.min(490, Math.max(10, x - 80))} ${y > 190 ? y - 42 : y + 15})`}><rect width="180" height="30" rx="5" /><text x="10" y="19">{entry.company.length > 18 ? `${entry.company.slice(0, 18)}…` : entry.company}</text></g>
          </g>;
        })}
      </svg>
      {!count && <p className="signal-star-empty">{copy.empty}</p>}
      <span className="signal-space-coordinate">{copy.range} / {count} {copy.node}</span>
    </div><div className="signal-star-legend">{data.segments.map((segment) => <button key={segment.key} type="button" data-segment={segment.key} aria-pressed={selection === `segment:${segment.key}`} disabled={!segment.entries.length} onClick={() => onSelection(selection === `segment:${segment.key}` ? undefined : `segment:${segment.key}`)}><i /><span>{labelFor(segment.key, copy)}</span><strong>{segment.entries.length}</strong><small>{copy.unit}</small></button>)}<p>{copy.starsHint}</p></div></div>
    <p className="momentum-chart-hint">{copy.foot}</p>
  </section>;
}
