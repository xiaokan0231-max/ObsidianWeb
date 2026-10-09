"use client";

import { useId } from "react";

/*
 * 通用雷达图：岗位 Fit 六轴、面试五维、对比时叠几组。口径与公司卷宗的 CompanyFitRadar 一致：
 * 缺失的轴不落在原点、不跨缺口连线，只有全部有值时才填色——面积不能暗示不存在的评分。
 * CompanyFitRadar 的 DOM 被测试钉着，所以那边不改，新用处都走这里。
 */
export type RadarAxis = { key: string; label: string };
export type RadarSeries = {
  id: string;
  label: string;
  /** 与 axes 一一对应；null 表示这一轴没有依据。 */
  values: (number | null)[];
  /** primary 是主角（填色 + 实线），其余只描边，用于「历史平均」「对比岗位」。 */
  tone?: "primary" | "secondary" | "tertiary" | "quaternary";
};

export function RadarChart({
  axes,
  series,
  max,
  title,
  size = 260,
  showValues = true,
  className = "",
}: {
  axes: RadarAxis[];
  series: RadarSeries[];
  max: number;
  title: string;
  size?: number;
  showValues?: boolean;
  className?: string;
}) {
  const id = useId();
  const count = axes.length;
  const pad = 58;
  const radius = size / 2 - pad;
  const center = size / 2;
  const point = (index: number, scale: number): [number, number] => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return [center + Math.cos(angle) * radius * scale, center + Math.sin(angle) * radius * scale];
  };
  const clamp = (value: number) => Math.max(0, Math.min(1, value / max));
  const primary = series.find((item) => (item.tone ?? "primary") === "primary") ?? series[0];
  const summary = axes
    .map((axis, index) => `${axis.label}：${series.map((item) => `${item.label} ${item.values[index] ?? "无"}`).join("，")}`)
    .join("；");
  return (
    <figure className={`radar-chart ${className}`.trim()}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-desc`}>{summary}</desc>
        {[0.25, 0.5, 0.75, 1].map((level) => (
          <polygon key={level} className="radar-grid" points={axes.map((_, index) => point(index, level).join(",")).join(" ")} />
        ))}
        {axes.map((axis, index) => {
          const [x, y] = point(index, 1);
          return <line key={axis.key} className="radar-axis" x1={center} y1={center} x2={x} y2={y} />;
        })}
        {series.map((item, seriesIndex) => {
          const tone = item.tone ?? "primary";
          const complete = item.values.every((value) => value !== null);
          return (
            <g key={item.id} className={`radar-series tone-${tone}`} style={{ animationDelay: `${seriesIndex * 80}ms` }}>
              {complete && (
                <polygon className="radar-shape" points={item.values.map((value, index) => point(index, clamp(value!)).join(",")).join(" ")} />
              )}
              {item.values.map((value, index) => {
                const next = (index + 1) % count;
                const nextValue = item.values[next];
                if (value === null || nextValue === null) return null;
                const [x1, y1] = point(index, clamp(value));
                const [x2, y2] = point(next, clamp(nextValue));
                return <line key={index} className="radar-edge" x1={x1} y1={y1} x2={x2} y2={y2} />;
              })}
              {item.values.map((value, index) => {
                if (value === null) return null;
                const [x, y] = point(index, clamp(value));
                return <circle key={index} className="radar-dot" cx={x} cy={y} r={tone === "primary" ? 3.6 : 2.6} />;
              })}
            </g>
          );
        })}
        {axes.map((axis, index) => {
          const [x, y] = point(index, 1.2);
          const value = primary?.values[index] ?? null;
          const anchor = Math.abs(x - center) < 4 ? "middle" : x > center ? "start" : "end";
          return (
            <text key={axis.key} className={`radar-label${value === null ? " unknown" : ""}`} x={x} y={y} textAnchor={anchor} dominantBaseline="middle">
              {axis.label}
              {showValues && <tspan className="radar-value" x={x} dy="15">{value === null ? "—" : value}</tspan>}
            </text>
          );
        })}
      </svg>
      {series.length > 1 && (
        <figcaption className="radar-legend">
          {series.map((item) => (
            <span key={item.id} className={`tone-${item.tone ?? "primary"}`}><i aria-hidden="true" />{item.label}</span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
