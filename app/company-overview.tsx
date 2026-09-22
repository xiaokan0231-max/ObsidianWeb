"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  companyFitDimensions,
  type CompanyEvidence,
  type CompanyFact,
  type CompanyFitDimension,
  type CompanyOverview,
  type CompanyReview,
} from "@/lib/company-overview";
import { useDialogFocus } from "./use-dialog-focus";

export const COMPANY_COMPARE_LIMIT = 3;
const SCORE_LABELS = ["", "明确不合", "契合较弱", "基本适配", "明显契合", "高度契合"];
const REVIEW_STATUS = { available: "可读资料", not_researched: "未调查", no_samples: "未找到有效资料", restricted: "访问受限" };

function Evidence({ items, onOpenWiki }: { items: CompanyEvidence[]; onOpenWiki: (target: string) => void }) {
  if (!items.length) return <span className="co-muted">暂无可引用资料</span>;
  return <ul className="co-evidence">{items.map((item, index) => <li key={`${item.url || item.wiki}:${index}`}>
    {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.label} ↗</a> : item.wiki ? <button type="button" onClick={() => onOpenWiki(item.wiki!)}>{item.label} ↗</button> : <span>{item.label}</span>}
  </li>)}</ul>;
}

function Fact({ fact, onOpenWiki }: { fact?: CompanyFact; onOpenWiki: (target: string) => void }) {
  if (!fact) return <span className="co-muted">待确认</span>;
  return <div className="co-fact"><div>{fact.value}</div><details><summary>来源与口径</summary><p>{fact.asOf || "统计时点未注明"}{fact.scope ? ` · ${fact.scope}` : ""}</p><Evidence items={fact.sources} onOpenWiki={onOpenWiki} /></details></div>;
}

/** 缺失维度不落在原点，也不跨过缺口连接，避免面积暗示不存在的评分。 */
export function CompanyFitRadar({ dimensions, criteriaVersion = 2, label, compact = false, detailPrefix }: { dimensions: CompanyFitDimension[]; criteriaVersion?: 1 | 2; label: string; compact?: boolean; detailPrefix?: string }) {
  const id = useId();
  const axes = companyFitDimensions(criteriaVersion);
  const radius = 96, cx = 176, cy = 146;
  const point = (index: number, scale: number) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale];
  };
  const values = axes.map((item) => dimensions.find((dimension) => dimension.key === item.key)?.score ?? null);
  const complete = values.every((value) => value !== null);
  const known = values.filter((value) => value !== null).length;
  const summary = axes.map((item, index) => `${item.label}：${values[index] === null ? "资料不足" : `${values[index]} / 5`}`).join("；");
  return <figure className={`co-radar${compact ? " compact" : ""}`}>
    <svg viewBox="0 0 352 296" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>{`${label}的六维契合画像`}</title><desc id={`${id}-desc`}>{summary}。六维齐全才显示填充区域；评分不代表录用概率。</desc>
      {[1, 2, 3, 4, 5].map((level) => <polygon key={level} className="co-radar-grid" points={axes.map((_, index) => point(index, level / 5).join(",")).join(" ")} />)}
      {axes.map((item, index) => { const [x, y] = point(index, 1); return <line key={item.key} className="co-radar-axis" x1={cx} y1={cy} x2={x} y2={y} />; })}
      {[1, 3, 5].map((level) => <text key={level} className="co-radar-tick" x={cx + 5} y={cy - radius * level / 5 + 4}>{level}</text>)}
      {complete && <polygon className="co-radar-fill" points={values.map((value, index) => point(index, value! / 5).join(",")).join(" ")} />}
      {values.map((value, index) => { const next = (index + 1) % 6; if (value === null || values[next] === null) return null; const [x1, y1] = point(index, value / 5), [x2, y2] = point(next, values[next]! / 5); return <line key={index} className="co-radar-value" x1={x1} y1={y1} x2={x2} y2={y2} />; })}
      {axes.map((item, index) => {
        const [x, y] = point(index, 1.24), value = values[index];
        const anchor = index === 0 || index === 3 ? "middle" : index < 3 ? "start" : "end";
        const text = <text x={x} y={y - 2} textAnchor={anchor} className={`co-radar-label${value === null ? " unknown" : ""}`}>{item.label}<tspan x={x} dy="17">{value === null ? "资料不足" : `${value} / 5`}</tspan></text>;
        return <g key={item.key}>{detailPrefix ? <a href={`#${detailPrefix}-${item.key}`} aria-label={`查看${item.label}的评分依据`} onClick={(event) => {
          // 仅定位当前页的依据，避免路由接管 hash 后重建页面而关闭展开内容。
          event.preventDefault();
          event.stopPropagation();
          const detail = document.getElementById(`${detailPrefix}-${item.key}`);
          if (detail instanceof HTMLDetailsElement) {
            detail.open = true;
            detail.scrollIntoView({ block: "center", behavior: "smooth" });
            detail.querySelector("summary")?.focus({ preventScroll: true });
          }
        }}>{text}</a> : text}{value !== null && <circle className="co-radar-dot" cx={point(index, value / 5)[0]} cy={point(index, value / 5)[1]} r="4" />}</g>;
      })}
    </svg>
    <figcaption>{known === 6 ? "六维已评估" : `${known} / 6 维有依据 · 留白为资料不足`}<span>{criteriaVersion === 1 ? "旧口径 · 原始判断" : "面试前口径"} · 不合成总分</span></figcaption>
  </figure>;
}

function Dimension({ dimension, label, id, onOpenWiki }: { dimension?: CompanyFitDimension; label: string; id?: string; onOpenWiki: (target: string) => void }) {
  const score = dimension?.score ?? null;
  return <details className="co-dimension" id={id}>
    <summary><span>{label}</span><b className={score === null ? "unknown" : ""}>{score === null ? "资料不足" : `${score} / 5`}<small>{score === null ? "" : SCORE_LABELS[score]}</small></b></summary>
    <div className="co-dimension-detail"><p>{dimension?.rationale || "还没有足够证据评价这一维。"}</p>{!!dimension?.unknowns.length && <ul>{dimension.unknowns.map((item) => <li key={item}>{item}</li>)}</ul>}<Evidence items={dimension?.evidence ?? []} onOpenWiki={onOpenWiki} /></div>
  </details>;
}

function Reviews({ reviews, onOpenWiki }: { reviews: CompanyReview[]; onOpenWiki: (target: string) => void }) {
  if (!reviews.length) return <p className="co-muted">未调查 · 尚未收录可核对的外部评价。</p>;
  return <div className="co-reviews">{reviews.map((review, index) => <article key={`${review.platform}:${index}`}>
    <header><h4>{review.platform}</h4><span className="co-review-status">{REVIEW_STATUS[review.status]}</span></header>
    <div className="co-review-meta">{review.score !== null && review.scale !== null ? <strong>{review.score}<small> / {review.scale}</small></strong> : <span>评分未取得</span>}<span>{review.sampleCount === null ? "样本量未取得" : `${review.sampleCount} 条样本`}</span><span>{review.commentPeriod || "评论时间未注明"}</span></div>
    <p className="co-muted">{review.coverage || "岗位适用范围未注明"}</p>
    {(review.positive.length > 0 || review.negative.length > 0) && <dl className="co-review-themes"><div><dt>正面主题</dt><dd>{review.positive.join("；") || "暂无有效信息"}</dd></div><div><dt>负面主题</dt><dd>{review.negative.join("；") || "暂无有效信息"}</dd></div></dl>}
    <details><summary>来源与阅读范围</summary><p>{review.limitations || "平台评价只作为待核对线索。"}</p><p>读取：{review.readOn || "日期未记录"}</p>{review.url && <Evidence items={[{ label: review.platform, url: review.url }]} onOpenWiki={onOpenWiki} />}</details>
  </article>)}</div>;
}

export default function CompanyOverviewContent({ context, onOpenWiki, historical = false }: { context: CompanyOverview | null; onOpenWiki: (target: string) => void; historical?: boolean }) {
  const prefix = useId().replaceAll(":", "");
  const assessment = context?.assessment;
  const profile = context?.profile;
  const criteriaVersion = assessment?.criteriaVersion ?? 2;
  const axes = companyFitDimensions(criteriaVersion);
  const facts = [...(profile?.facts ?? []), ...(assessment?.contextFacts ?? [])];
  return <div className="company-overview">
    <div className="co-dates"><span>公司资料 <b>{profile?.updatedOn || "尚未整理"}</b></span><span>契合评价 <b>{assessment?.assessedOn || "尚未评估"}</b>{assessment && <small> · {assessment.aiAuthor}</small>}</span><span className="co-latest">最新画像{historical ? " · 历史面谈正文保持原样" : ""}</span></div>
    {!context && <p className="co-notice">这份准备尚未关联可唯一识别的案件或面谈记录，公司画像待补齐。</p>}
    {!!context?.issues.length && <details className="co-notice"><summary>部分资料暂不可用</summary><ul>{context.issues.map((item) => <li key={item}>{item}</li>)}</ul></details>}
    <section className="co-company-facts" aria-labelledby={`${prefix}-facts`}><header className="co-section-header"><span>01</span><h2 id={`${prefix}-facts`}>公司与岗位</h2>{context?.dossier && <button type="button" onClick={() => onOpenWiki(context.dossier!.path)}>公司卷宗 ↗</button>}</header>
      {facts.length ? <dl className="co-fact-grid">{facts.map((fact, index) => <div key={`${fact.id}:${index}`}><dt>{fact.label}</dt><dd><Fact fact={fact} onOpenWiki={onOpenWiki} /></dd></div>)}</dl> : <p className="co-muted">公司规模、业务、岗位条件等资料待整理；已存在的案件和面谈记录仍可查看。</p>}
    </section>
    <section className="co-fit-section" aria-labelledby={`${prefix}-fit`}><header className="co-section-header"><span>02</span><h2 id={`${prefix}-fit`}>{criteriaVersion === 1 ? "与你的契合画像 · 旧口径" : "面试前契合画像"}</h2><p>1 明确不合 → 5 高度契合</p></header>
      {criteriaVersion === 1 ? <p className="co-notice">这份评价使用旧口径，保留原始维度与判断，待更新后可与面试前画像比较。</p> : <p className="co-fit-scope">依据当前求人、公开资料与你的已确认经历，判断面试前能看清的契合度。实际权限、协作支持和在留手续另列为「面谈核实」。</p>}
      <div className="co-fit-main"><CompanyFitRadar label={context?.company ?? "当前公司"} dimensions={assessment?.dimensions ?? []} criteriaVersion={criteriaVersion} detailPrefix={prefix} /><div className="co-fit-brief"><p className="co-summary">{assessment?.summary || "根据岗位原文和你的经历补齐资料后，形成面试前判断。"}</p><div className="co-fit-notes"><section><h3>主要契合点</h3>{assessment?.strengths.length ? <ul>{assessment.strengths.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="co-muted">待补充证据</p>}</section><section><h3>面谈核实</h3>{assessment?.questions.length ? <ul>{assessment.questions.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="co-muted">实际岗位、职责分工与工作条件</p>}</section></div></div></div>
      <div className="co-dimensions">{axes.map((item) => <Dimension key={item.key} id={`${prefix}-${item.key}`} label={item.label} dimension={assessment?.dimensions.find((dimension) => dimension.key === item.key)} onOpenWiki={onOpenWiki} />)}</div><p className="co-footnote">展开维度查看理由与证据。资料不足仍保留空缺；公司规模、薪资与口碑独立展示，契合度不代表录用概率。</p>
    </section>
    <section className="co-external" aria-labelledby={`${prefix}-reviews`}><header className="co-section-header"><span>03</span><h2 id={`${prefix}-reviews`}>外部评价</h2><p>保留各平台原始量尺与样本</p></header><Reviews reviews={profile?.reviews ?? []} onOpenWiki={onOpenWiki} /></section>
  </div>;
}

export function CompanyCompareButton({ context, compared, full, onToggle }: { context: CompanyOverview | null; compared: boolean; full: boolean; onToggle: () => void }) {
  if (!context) return null;
  return <button type="button" className={`co-compare-toggle${compared ? " active" : ""}`} disabled={!compared && full} aria-pressed={compared} title={!compared && full ? "最多同时对比 3 个公司／岗位，请先移除一项" : undefined} onClick={onToggle}>{compared ? "✓ 已加入对比" : full ? "已选满 3 项" : "＋ 加入对比"}</button>;
}

export function CompanyCompareTray({ contexts, onRemove, onClear, onOpen }: { contexts: CompanyOverview[]; onRemove: (path: string) => void; onClear: () => void; onOpen: () => void }) {
  if (!contexts.length) return null;
  return <div className="job-compare-tray co-compare-tray" role="region" aria-label="公司画像对比候选"><span className="job-compare-count">{contexts.length} / {COMPANY_COMPARE_LIMIT} 已选</span><div className="job-compare-items">{contexts.map((context) => <button key={context.key} type="button" title={context.title} onClick={() => onRemove(context.note.path)} aria-label={`移除${context.company} ${context.title}`}><span>{context.company}<small>{context.title}</small></span><b aria-hidden="true">×</b></button>)}</div><button type="button" className="job-compare-open" disabled={contexts.length < 2} onClick={onOpen}>{contexts.length < 2 ? "再选 1 项即可对比" : "并排对比"}</button><button type="button" className="job-compare-clear" onClick={onClear}>清空</button></div>;
}

/** 选择器与页面加入按钮共用上限，已选项在满额时仍可取消。 */
export function toggleCompanyComparison(paths: string[], path: string) {
  if (paths.includes(path)) return paths.filter((item) => item !== path);
  return paths.length < COMPANY_COMPARE_LIMIT ? [...paths, path] : paths;
}

export function CompanyCompareSelector({ contexts, selected, onToggle, onClose, onCompare }: { contexts: CompanyOverview[]; selected: CompanyOverview[]; onToggle: (path: string) => void; onClose: () => void; onCompare: () => void }) {
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, true);
  useEffect(() => { const old = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = old; }; }, []);
  const selectedPaths = new Set(selected.map((item) => item.note.path));
  const full = selected.length >= COMPANY_COMPARE_LIMIT;
  const visible = contexts.filter((item) => `${item.company} ${item.title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((left, right) => Number(!!right.assessment) - Number(!!left.assessment) || left.company.localeCompare(right.company) || left.title.localeCompare(right.title));
  return <div className="job-compare-backdrop co-compare-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="co-compare-panel co-picker-panel" role="dialog" aria-modal="true" aria-label="选择公司对比" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="co-compare-header"><div><p>选择 2～3 个公司／岗位</p><h2>公司对比</h2></div><button type="button" onClick={onClose} aria-label="关闭公司选择">关闭 ×</button></header>
    <div className="co-picker-search"><label>搜索公司或岗位<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入公司名、岗位或面谈主题" /></label><p>同公司不同岗位分别选择。已评估的画像排在前面。</p></div>
    <div className="co-picker-list" role="group" aria-label="可对比的公司与岗位">{visible.map((item) => {
      const checked = selectedPaths.has(item.note.path);
      return <label key={item.key} className={`co-picker-option${checked ? " selected" : ""}${full && !checked ? " disabled" : ""}`}><input type="checkbox" checked={checked} disabled={full && !checked} onChange={() => onToggle(item.note.path)} /><span><strong>{item.company}</strong><span>{item.title}</span><small>{!item.assessment ? "画像待补齐" : item.assessment.criteriaVersion === 1 ? "旧口径待更新" : "面试前画像"}{item.assessment ? ` · ${item.assessment.assessedOn}` : ""}</small></span><em>{checked ? "已选" : "选择"}</em></label>;
    })}{!visible.length && <p className="co-muted">没有找到对应的公司或岗位。</p>}</div>
    <footer className="co-picker-footer"><div><strong aria-live="polite">已选 {selected.length} / {COMPANY_COMPARE_LIMIT} 项</strong><p>{full ? "已选满 3 项，可取消一项后更换。" : selected.length < 2 ? "至少选择 2 项即可开始对比。" : "可以开始对比，也可再选 1 项。"}</p></div><button type="button" disabled={selected.length < 2} onClick={onCompare}>并排对比</button></footer>
  </div></div>;
}

export function CompanyCompare({ contexts, onClose, onDetail, onRemove, onOpenWiki, onEdit }: { contexts: CompanyOverview[]; onClose: () => void; onDetail: (context: CompanyOverview) => void; onRemove: (path: string) => void; onOpenWiki: (target: string) => void; onEdit?: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, true);
  useEffect(() => { const old = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = old; }; }, []);
  const facts = new Map<string, string>();
  const versions = new Set(contexts.flatMap((context) => context.assessment ? [context.assessment.criteriaVersion] : []));
  const mixedCriteria = versions.size > 1;
  const criteriaVersion = [...versions][0] ?? 2;
  const axes = companyFitDimensions(criteriaVersion);
  for (const context of contexts) for (const fact of [...(context.profile?.facts ?? []), ...(context.assessment?.contextFacts ?? [])]) if (!facts.has(fact.id)) facts.set(fact.id, fact.label);
  const rows: { label: string; render: (context: CompanyOverview) => ReactNode }[] = [
    { label: "资料与评价日期", render: (context) => <>{context.profile?.updatedOn || "资料待补"}<br />{context.assessment?.assessedOn || "评价待补"}</> },
    { label: "评价口径", render: (context) => !context.assessment ? "尚未评估" : context.assessment.criteriaVersion === 1 ? "旧口径 · 待更新" : "面试前口径" },
    { label: "一句话判断", render: (context) => context.assessment?.summary || "尚未评估" },
    ...[...facts].map(([id, label]) => ({ label, render: (context: CompanyOverview) => <Fact fact={[...(context.assessment?.contextFacts ?? []), ...(context.profile?.facts ?? [])].find((fact) => fact.id === id)} onOpenWiki={onOpenWiki} /> })),
    ...(mixedCriteria ? [] : axes.map((dimension) => ({ label: dimension.label, render: (context: CompanyOverview) => <Dimension label={dimension.label} dimension={context.assessment?.dimensions.find((item) => item.key === dimension.key)} onOpenWiki={onOpenWiki} /> }))),
    { label: "外部评价", render: (context) => <Reviews reviews={context.profile?.reviews ?? []} onOpenWiki={onOpenWiki} /> },
    { label: "面谈核实", render: (context) => context.assessment?.questions.length ? <ul>{context.assessment.questions.map((question) => <li key={question}>{question}</li>)}</ul> : "岗位详情与评价待补" },
  ];
  return <div className="job-compare-backdrop co-compare-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="co-compare-panel" role="dialog" aria-modal="true" aria-label="公司与岗位并排对比" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="co-compare-header"><div><p>最新公司画像 · {contexts.length} 项</p><h2>并排看，逐项判断</h2></div><p>{mixedCriteria ? "评价口径不同 · 公司事实仍可对比" : "六维同尺度 · 资料不足保留空白 · 不合成总分"}</p>{onEdit && <button type="button" onClick={onEdit}>更换公司</button>}<button type="button" onClick={onClose} aria-label="关闭对比">关闭 ×</button></header>
    {mixedCriteria && <p className="co-notice co-compare-notice">旧口径待更新：所选画像的评价维度不同，暂不并排比较雷达与分数。各公司的原始判断可从「查看总览」阅读。</p>}
    <div className="co-compare-scroll"><table className="co-compare-table"><caption className="sr-only">公司事实、六维契合度与外部评价并排比较</caption><thead><tr><th scope="col">公司／岗位</th>{contexts.map((context) => <th scope="col" key={context.key}><div className="co-compare-company"><button type="button" onClick={() => onDetail(context)}><strong>{context.company}</strong><small>{context.title}</small><em>查看总览 ↗</em></button><button type="button" className="co-remove" onClick={() => onRemove(context.note.path)} aria-label={`从对比移除${context.company} ${context.title}`}>×</button></div></th>)}</tr></thead><tbody>{!mixedCriteria && <tr className="co-compare-radars"><th scope="row">契合画像<small>1 — 5</small></th>{contexts.map((context) => <td key={context.key}><CompanyFitRadar compact dimensions={context.assessment?.dimensions ?? []} criteriaVersion={criteriaVersion} label={context.company} /></td>)}</tr>}{rows.map((row, index) => <tr key={`${row.label}:${index}`}><th scope="row">{row.label}</th>{contexts.map((context) => <td key={context.key}>{row.render(context)}</td>)}</tr>)}</tbody></table></div>
  </div></div>;
}
