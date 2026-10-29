"use client";

import { useCompanyCopy } from "./company-copy";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  companyFitDimensions,
  type CompanyEvidence,
  type CompanyFact,
  type CompanyFitDimension,
  type CompanyOverview,
  type CompanyReview,
  type CompanyReviewSynthesis,
} from "@/lib/company-overview";
import { HARD_GATE_LABEL, JOB_FIT_AXES, JOB_FIT_SCORE_LABEL, UNRATED_V2_LABEL, toJobCard } from "@/lib/jobs";
import { prefersReducedMotion } from "@/lib/motion";
import { useDialogFocus } from "./use-dialog-focus";
import { Inlines } from "./prep-doc-render";

import { getString, type Note } from "@/lib/notes";
import { buildCompanyCompareCandidates, filterCompanyCompareCandidates, companyComparePreset, companyCompareRatings, COMPANY_COMPARE_LIMIT, type CompanyCompareCandidate, type CompanyCompareFilter, type CompanyCompareSort } from "@/lib/company-compare";
export { COMPANY_COMPARE_LIMIT };
const SCORE_LABELS = ["", "明确不合", "契合较弱", "基本适配", "明显契合", "高度契合"];
const REVIEW_STATUS = { available: "可读资料", not_researched: "未调查", no_samples: "未找到有效资料", restricted: "访问受限" };

function Evidence({ items, onOpenWiki }: { items: CompanyEvidence[]; onOpenWiki: (target: string) => void }) {
  const t = useCompanyCopy();
  if (!items.length) return <span className="co-muted">{t("暂无可引用资料")}</span>;
  return <ul className="co-evidence">{items.map((item, index) => <li key={`${item.url || item.wiki}:${index}`}>
    {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.label} ↗</a> : item.wiki ? <button type="button" onClick={() => onOpenWiki(item.wiki!)}>{item.label} ↗</button> : <span>{item.label}</span>}
  </li>)}</ul>;
}

function Fact({ fact, onOpenWiki }: { fact?: CompanyFact; onOpenWiki: (target: string) => void }) {
  const t = useCompanyCopy();
  if (!fact) return <span className="co-muted">{t("待确认")}</span>;
  return <div className="co-fact"><div>{fact.value}</div><details><summary>{t("来源与口径")}</summary><p>{fact.asOf || t("统计时点未注明")}{fact.scope ? ` · ${fact.scope}` : ""}</p><Evidence items={fact.sources} onOpenWiki={onOpenWiki} /></details></div>;
}

/** 缺失维度不落在原点，也不跨过缺口连接，避免面积暗示不存在的评分。 */
export function CompanyFitRadar({ dimensions, criteriaVersion = 2, label, compact = false, detailPrefix }: { dimensions: CompanyFitDimension[]; criteriaVersion?: 1 | 2; label: string; compact?: boolean; detailPrefix?: string }) {
  const t = useCompanyCopy();
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
  const summary = axes.map((item, index) => `${t(item.label)}：${values[index] === null ? t("资料不足") : `${values[index]} / 5`}`).join("；");
  return <figure className={`co-radar${compact ? " compact" : ""}`}>
    <svg viewBox="0 0 352 296" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>{t("{company}的六维契合画像", { company: label })}</title><desc id={`${id}-desc`}>{summary}{t("。六维齐全才显示填充区域；评分不代表录用概率。")}</desc>
      {[1, 2, 3, 4, 5].map((level) => <polygon key={level} className="co-radar-grid" points={axes.map((_, index) => point(index, level / 5).join(",")).join(" ")}/>)}
      {axes.map((item, index) => { const [x, y] = point(index, 1); return <line key={item.key} className="co-radar-axis" x1={cx} y1={cy} x2={x} y2={y} />; })}
      {[1, 3, 5].map((level) => <text key={level} className="co-radar-tick" x={cx + 5} y={cy - radius * level / 5 + 4}>{level}</text>)}
      {complete && <polygon className="co-radar-fill" points={values.map((value, index) => point(index, value! / 5).join(",")).join(" ")}/>}
      {values.map((value, index) => { const next = (index + 1) % 6; if (value === null || values[next] === null) return null; const [x1, y1] = point(index, value / 5), [x2, y2] = point(next, values[next]! / 5); return <line key={index} className="co-radar-value" x1={x1} y1={y1} x2={x2} y2={y2} />; })}
      {axes.map((item, index) => {
        const [x, y] = point(index, 1.24), value = values[index];
        const anchor = index === 0 || index === 3 ? "middle" : index < 3 ? "start" : "end";
        const text = <text x={x} y={y - 2} textAnchor={anchor} className={`co-radar-label${value === null ? " unknown" : ""}`}>{t(item.label)}<tspan x={x} dy="17">{value === null ? t("资料不足") : `${value} / 5`}</tspan></text>;
        return <g key={item.key}>{detailPrefix ? <a href={`#${detailPrefix}-${item.key}`} aria-label={t("查看{dimension}的评分依据", { dimension: t(item.label) })} onClick={(event) => {
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
    <figcaption>{known === 6 ? t("六维已评估") : t("{count} / 6 维有依据 · 留白为资料不足", { count: known })}<span>{criteriaVersion === 1 ? t("旧口径 · 原始判断") : t("面试前口径")}{t(" · 不合成总分")}</span></figcaption>
  </figure>;
}

function Dimension({ dimension, label, id, onOpenWiki }: { dimension?: CompanyFitDimension; label: string; id?: string; onOpenWiki: (target: string) => void }) {
  const t = useCompanyCopy();
  const score = dimension?.score ?? null;
  return <details className="co-dimension" id={id}>
    <summary><span>{label}</span><b className={score === null ? "unknown" : ""}>{score === null ? t("资料不足") : `${score} / 5`}<small>{score === null ? "" : t(SCORE_LABELS[score])}</small></b></summary>
    <div className="co-dimension-detail"><p>{dimension?.rationale || t("还没有足够证据评价这一维。")}</p>{!!dimension?.unknowns.length && <ul>{dimension.unknowns.map((item) => <li key={item}>{item}</li>)}</ul>}<Evidence items={dimension?.evidence ?? []} onOpenWiki={onOpenWiki} /></div>
  </details>;
}

/** 案件側の v2 採点。公司画像の六維（会社としての契合）とは別の軸なので、行を分けて併記する。面谈は案件を持たない。 */
function CaseFit({ context }: { context: CompanyOverview }) {
  const t = useCompanyCopy();
  const fit = context.kind === "case" ? toJobCard(context.note).fit : null;
  if (!fit) return <span className="co-muted">{context.kind === "case" ? t(UNRATED_V2_LABEL) : t("面谈 · 无案件采点")}</span>;
  return <div className="co-case-fit"><strong>Fit {fit.score}</strong> · Band {fit.band} · Gate {t(HARD_GATE_LABEL[fit.hardGate])}<ul>{JOB_FIT_AXES.map((key) => <li key={key}>{t(JOB_FIT_SCORE_LABEL[key].label)} {fit.scores[key]}/{JOB_FIT_SCORE_LABEL[key].max}</li>)}</ul></div>;
}

function ReviewSynthesis({ synthesis, compact = false, onOpenWiki }: { synthesis?: CompanyReviewSynthesis | null; compact?: boolean; onOpenWiki: (target: string) => void }) {
  const t = useCompanyCopy();
  if (!synthesis) return null;
  const renderParagraph = (paragraph: CompanyReviewSynthesis["paragraphs"][number], index: number) => <p key={index}><Inlines nodes={paragraph} refs={{ onOpenWiki: (target, section) => onOpenWiki(section ? `${target}#${section}` : target) }} /></p>;
  return <section className={`co-review-synthesis${compact ? " compact" : ""}`} aria-label={t("外部评价总结")}>
    <header><h3>{t("外部评价总结")}</h3><span>{t("截至 ")}<time dateTime={synthesis.asOf}>{synthesis.asOf}</time> · {synthesis.aiAuthor}</span></header>
    <div className="co-summary-prose">{(compact ? synthesis.paragraphs.slice(0, 2) : synthesis.paragraphs).map(renderParagraph)}</div>
    {compact && synthesis.paragraphs.length > 2 && <details className="co-review-synthesis-more"><summary>{t("展开完整总结")}</summary><div className="co-summary-prose">{synthesis.paragraphs.slice(2).map(renderParagraph)}</div></details>}
    {!compact && <p className="co-review-synthesis-coverage">{synthesis.coverage}</p>}
    <details className="co-review-synthesis-sources"><summary>{t("总结依据 · ")}{synthesis.sources.length}{t(" 项")}</summary>{compact && <p className="co-review-synthesis-coverage">{synthesis.coverage}</p>}<Evidence items={synthesis.sources} onOpenWiki={onOpenWiki} /></details>
  </section>;
}

function Reviews({ reviews, onOpenWiki, compact = false }: { reviews: CompanyReview[]; onOpenWiki: (target: string) => void; compact?: boolean }) {
  const t = useCompanyCopy();
  if (!reviews.length) return <p className="co-muted">{t("未调查 · 尚未收录可核对的外部评价。")}</p>;
  return <div className={`co-reviews${compact ? " compact" : ""}`}>{reviews.map((review, index) => {
    const insights = review.insights ?? [];
    const readings = insights.map((insight, insightIndex) => <section className={`co-review-insight ${insight.kind}`} key={`${insight.title}:${insightIndex}`}>
      <header className="co-insight-heading"><span>{insight.kind === "positive" ? t("值得期待") : insight.kind === "concern" ? t("需要留意") : t("两面来看")}</span><h4>{insight.title}</h4></header>
      <div className="co-insight-body"><div className="co-insight-reading"><p>{insight.summary}</p><p className="co-insight-implication"><b>{t("对这次面谈")}</b>{insight.implication}</p></div>
        <div className="co-review-evidence">{insight.evidence.map((evidence, evidenceIndex) => <div className="co-review-excerpt" key={`${evidence.url}:${evidenceIndex}`}>
          <p className="co-review-attribution"><span>{evidence.role}</span><time dateTime={evidence.publishedOn}>{evidence.publishedOn}</time><a href={evidence.url} target="_blank" rel="noopener noreferrer" aria-label={t("阅读{role}于{date}发布的评论原文", { role: evidence.role, date: evidence.publishedOn })}>{t("原文 ↗")}</a></p>
          {evidence.quote && <blockquote lang="ja" cite={evidence.url}>{evidence.quote}</blockquote>}
          <p className="co-review-paraphrase"><span>{t("中文释义")}</span>{evidence.paraphrase}</p>
        </div>)}</div>
      </div>
    </section>);
    return <article className="co-review-platform" key={`${review.platform}:${index}`}>
      <div className="co-review-topline"><div><h3>{review.url ? <a href={review.url} target="_blank" rel="noopener noreferrer">{review.platform} ↗</a> : review.platform}</h3><span className="co-review-status">{t(REVIEW_STATUS[review.status])} · {review.readOn || t("日期未记录")}{t(" 读取")}</span></div>
        <div className="co-review-meta">{review.score !== null && review.scale !== null ? <strong>{review.score}<small> / {review.scale}</small></strong> : <span>{t("评分未取得")}</span>}<span>{review.sampleCount === null ? t("样本量未取得") : `${review.sampleCount} ${review.sampleUnit || t("条样本")}`}</span><span>{review.commentPeriod || t("评论时间未注明")}</span></div>
      </div>
      <p className="co-review-coverage"><b>{t("这些评价来自谁")}</b>{review.coverage || t("岗位适用范围未注明")}</p>
      {readings.length > 0 ? (compact ? <details className="co-review-readings"><summary>{readings.length}{t(" 个主题 · 查看员工原话与面谈启示")}</summary>{readings}</details> : <div className="co-review-readings">{readings}</div>) : (review.positive.length > 0 || review.negative.length > 0) && <dl className="co-review-themes"><div><dt>{t("正面主题")}</dt><dd>{review.positive.join("；") || t("暂无有效信息")}</dd></div><div><dt>{t("负面主题")}</dt><dd>{review.negative.join("；") || t("暂无有效信息")}</dd></div></dl>}
      <details className="co-review-limits"><summary>{t("来源与阅读范围")}</summary><p>{review.limitations || t("平台评价只作为待核对线索。")}</p>{review.url && <Evidence items={[{ label: review.platform, url: review.url }]} onOpenWiki={onOpenWiki} />}</details>
    </article>;
  })}</div>;
}

export type CompanyOverviewView = "full" | "story" | "reviews";

export default function CompanyOverviewContent({ context, onOpenWiki, historical = false, view = "full", onOpenReviews }: { context: CompanyOverview | null; onOpenWiki: (target: string) => void; historical?: boolean; view?: CompanyOverviewView; onOpenReviews?: () => void }) {
  const t = useCompanyCopy();
  const prefix = useId().replaceAll(":", "");
  const assessment = context?.assessment;
  const profile = context?.profile;
  const companySummary = context?.summary;
  const criteriaVersion = assessment?.criteriaVersion ?? 2;
  const axes = companyFitDimensions(criteriaVersion);
  const facts = [...(profile?.facts ?? []), ...(assessment?.contextFacts ?? [])];
  const renderParagraph = (paragraph: NonNullable<typeof companySummary>["paragraphs"][number], index: number) => <p key={index}><Inlines nodes={paragraph} refs={{ onOpenWiki: (target, section) => onOpenWiki(section ? `${target}#${section}` : target) }} /></p>;
  const externalSection = <section className="co-external" id={`${prefix}-reviews`} aria-labelledby={`${prefix}-reviews-title`}><header className="co-section-header">{view === "full" && <span>03</span>}<h2 id={`${prefix}-reviews-title`} tabIndex={-1}>{t("外部评价")}</h2><p>{t("员工的经历 · 对本次面谈的启示")}</p></header><ReviewSynthesis synthesis={profile?.reviewSynthesis} onOpenWiki={onOpenWiki} /><Reviews reviews={profile?.reviews ?? []} onOpenWiki={onOpenWiki} /></section>;
  // 独立评价页不带岗位结论与公司故事，来源和统计仍由同一份正本组件展示。
  if (view === "reviews") return <div className="company-overview co-view-reviews">{externalSection}</div>;
  const reviewsAction = onOpenReviews ? <button type="button" onClick={onOpenReviews}>{t("查看外部评价 →")}</button> : <a href={`#${prefix}-reviews`} onClick={(event) => {
    event.preventDefault();
    const heading = document.getElementById(`${prefix}-reviews-title`);
    heading?.focus({ preventScroll: true });
    document.getElementById(`${prefix}-reviews`)?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }}>{t("查看外部评价 ↓")}</a>;
  return <div className={`company-overview${view === "story" ? " co-view-story" : ""}`}>
    <div className="co-dates"><span>{t("资料 ")}<b>{profile?.updatedOn || t("尚未整理")}</b></span><span>{t("判断 ")}<b>{assessment?.assessedOn || t("尚未评估")}</b>{assessment && <small> · {assessment.aiAuthor}</small>}</span><span className="co-latest">{t("最新画像")}{historical ? t(" · 历史面谈正文保持原样") : ""}</span></div>
    {!context && <p className="co-notice">{t("这份准备尚未关联可唯一识别的案件或面谈记录，公司画像待补齐。")}</p>}
    {!!context?.issues.length && <details className="co-notice"><summary>{t("部分资料暂不可用")}</summary><ul>{[...new Set(context.issues)].map((item) => <li key={item}>{item}</li>)}</ul></details>}
    <section className="co-fit-section" aria-labelledby={`${prefix}-fit`}>
      <div className="co-fit-main"><div className="co-fit-brief"><header className="co-section-header"><span>01</span><h2 id={`${prefix}-fit`}>{t("先看结论")}</h2>{reviewsAction}</header><p className="co-summary">{assessment?.summary || t("根据岗位原文和你的经历补齐资料后，形成面试前判断。")}</p><div className="co-fit-notes"><section><h3>{t("主要契合点")}</h3>{assessment?.strengths.length ? <ul>{assessment.strengths.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="co-muted">{t("待补充证据")}</p>}</section><section><h3>{t("面谈核实")}</h3>{assessment?.questions.length ? <><ol>{assessment.questions.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ol>{assessment.questions.length > 3 && <details className="co-more-questions"><summary>{t("其他核实事项 · ")}{assessment.questions.length - 3}</summary><ol start={4}>{assessment.questions.slice(3).map((item) => <li key={item}>{item}</li>)}</ol></details>}</> : <p className="co-muted">{t("实际岗位、职责分工与工作条件")}</p>}</section></div></div>
        <aside className="co-fit-chart" aria-label={t("六维契合画像")}><h3>{criteriaVersion === 1 ? t("与你的契合画像 · 旧口径") : t("面试前契合画像")}</h3><CompanyFitRadar label={context?.company ?? t("当前公司")} dimensions={assessment?.dimensions ?? []} criteriaVersion={criteriaVersion} detailPrefix={prefix} /></aside>
      </div>
      {criteriaVersion === 1 && <p className="co-notice">{t("这份评价使用旧口径，保留原始维度与判断，待更新后可与面试前画像比较。")}</p>}
      <div className="co-dimensions">{axes.map((item) => <Dimension key={item.key} id={`${prefix}-${item.key}`} label={t(item.label)} dimension={assessment?.dimensions.find((dimension) => dimension.key === item.key)} onOpenWiki={onOpenWiki} />)}</div><p className="co-footnote">{t("1 明确不合 → 5 高度契合 · 点开各维度查看依据；平台口碑独立展示，契合度不代表录用概率。")}</p>
    </section>
    <div className="co-company-context">
      <section className="co-company-summary" aria-labelledby={`${prefix}-summary`}>
        <header className="co-section-header"><span>02</span><h2 id={`${prefix}-summary`}>{t("公司总结")}</h2>{companySummary && <button type="button" onClick={() => onOpenWiki(companySummary.note.path)}>{t("研究笔记 ↗")}</button>}</header>
        {companySummary ? <>
          <div className="co-summary-prose">{companySummary.paragraphs.slice(0, 1).map(renderParagraph)}</div>
          {companySummary.paragraphs.length > 1 && <details className="co-summary-continuation"><summary>{t("展开公司故事与招聘背景 ")}<span>＋</span></summary><div className="co-summary-prose">{companySummary.paragraphs.slice(1).map(renderParagraph)}</div></details>}
          <p className="co-summary-meta"><span>{t("资料截至 ")}<time dateTime={companySummary.assessedOn}>{companySummary.assessedOn}</time></span><span>{t("覆盖 ")}{companySummary.coveragePeriod}</span><span>{companySummary.aiAuthor}</span></p>
          <details className="co-summary-sources"><summary>{t("研究来源 · ")}{companySummary.sources.length}{t(" 项")}</summary><Evidence items={companySummary.sources} onOpenWiki={onOpenWiki} /></details>
        </> : <p className="co-muted co-summary-empty">{context?.summaryStatus === "invalid" ? t("公司总结暂不可用，请核对研究笔记的引用与内容。") : t("公司总结待整理。补齐研究后，将在这里连贯说明公司的现状、发展变化与招聘背景。")}</p>}
      </section>
      <section className="co-company-facts" aria-labelledby={`${prefix}-facts`}><header className="co-section-header"><h2 id={`${prefix}-facts`}>{t("公司与岗位")}</h2>{context?.dossier && <button type="button" onClick={() => onOpenWiki(context.dossier!.path)}>{t("公司卷宗 ↗")}</button>}</header>
        {facts.length ? <dl className="co-fact-grid">{facts.map((fact, index) => <div key={`${fact.id}:${index}`}><dt>{t(fact.label)}</dt><dd><Fact fact={fact} onOpenWiki={onOpenWiki} /></dd></div>)}</dl> : <p className="co-muted">{t("公司规模、业务、岗位条件等资料待整理；已存在的案件和面谈记录仍可查看。")}</p>}
      </section>
    </div>
    {view === "full" && externalSection}
  </div>;
}

const COMPARE_PLATFORMS = ["OpenWork", "転職会議"] as const;
function compareName(context: CompanyOverview) {
  return (getString(context.dossier?.frontmatter.company) || context.company).replace(/^(株式会社|有限会社|合同会社)\s*|\s*(株式会社|有限会社|合同会社)$/gu, "");
}
function companyTone(name: string) { return [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5; }
function sourceReview(context: CompanyOverview, platform: string) {
  const platformKey = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s/g, "").replace(/^(jobtalk|tenshokukaigi)$/u, "転職会議");
  return [...(context.profile?.reviews ?? [])].filter((review) => platformKey(review.platform) === platformKey(platform)).sort((a, b) => b.readOn.localeCompare(a.readOn))[0];
}
function missingReviewLabel(review?: CompanyReview) {
  if (!review || review.status === "not_researched") return "尚未调查";
  if (review.status === "restricted") return "正文访问受限";
  if (review.status === "no_samples") return "无有效员工样本";
  return /面试|面接/.test(review.sampleUnit) ? "仅面试体验" : "公司评分未取得";
}
function PlatformScore({ context, platform, mini = false }: { context: CompanyOverview; platform: string; mini?: boolean }) {
  const t = useCompanyCopy();
  const review = sourceReview(context, platform);
  const rating = companyCompareRatings(context).find((item) => item.platform === platform);
  const valid = Boolean(rating);
  const source = rating ?? review;
  const sample = source?.sampleCount == null ? "样本量未取得" : `${source.sampleCount} ${source.sampleUnit || t("条样本")}`;
  const tone = rating ? rating.score >= 4 ? "high" : rating.score < 3 ? "low" : "mid" : "unknown";
  const missing = !rating && review?.score != null && review.scale === 5 && (review.status === "available" || review.status === "restricted") ? t("评分记录待核对") : t(missingReviewLabel(review));
  return <div className={`co-platform-score${mini ? " mini" : ""}`} data-score-tone={tone} title={source ? `${platform} · ${sample} · ${source.readOn || t("读取日未记录")}\n${source.coverage}` : t("{platform} 尚未调查", { platform })}>
    <div className="co-score-top"><span>{!mini && source?.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">{platform} ↗</a> : platform}</span><strong className="co-score-number">{rating ? rating.score.toFixed(2) : "—"}{!mini && valid && <small> / 5</small>}</strong></div>
    {!mini && <div className="co-score-track" aria-hidden="true">{rating && <i style={{ width: `${rating.score / 5 * 100}%` }} />}</div>}
    <small className={valid ? "co-score-sample" : "co-score-empty"}>{valid ? sample : missing}</small>
    {!mini && source && <details className="co-score-context"><summary>{t("样本与范围")}</summary><p>{source.coverage}</p><p>{source.limitations}</p><small>{source.readOn}{t(" 读取 · ")}{source.commentPeriod}</small></details>}
  </div>;
}
function CandidateMeta({ item }: { item: CompanyCompareCandidate }) {
  const t = useCompanyCopy();
  return <div className="co-candidate-meta"><span className={`co-date-tag${item.eventAt ? " upcoming" : ""}`}>{item.eventAt ? t("下次 {date}", { date: item.eventAt }) : item.lastInterviewAt ? t("面过 {date}", { date: item.lastInterviewAt }) : t("面谈日期未记录")}</span><span className="co-origin-tag" data-origin={item.originKind}>{t(item.originLabel)}</span>{item.channel && <span>{item.channel}</span>}{item.status && <span className="co-status-tag">{t(item.status)}</span>}</div>;
}

export function CompanyCompareButton({ context, compared, full, onToggle }: { context: CompanyOverview | null; compared: boolean; full: boolean; onToggle: () => void }) {
  const t = useCompanyCopy();
  if (!context) return null;
  return <button type="button" className={`co-compare-toggle${compared ? " active" : ""}`} disabled={!compared && full} aria-pressed={compared} title={!compared && full ? t("最多同时对比 {count} 个公司／岗位，请先移除一项", { count: COMPANY_COMPARE_LIMIT }) : undefined} onClick={onToggle}>{compared ? t("✓ 已加入对比") : full ? t("已选满 {count} 项", { count: COMPANY_COMPARE_LIMIT }) : t("＋ 加入对比")}</button>;
}
export function CompanyCompareTray({ contexts, onRemove, onClear, onOpen }: { contexts: CompanyOverview[]; onRemove: (path: string) => void; onClear: () => void; onOpen: () => void }) {
  const t = useCompanyCopy();
  if (!contexts.length) return null;
  return <div className="job-compare-tray co-compare-tray" role="region" aria-label={t("公司画像对比候选")}><span className="job-compare-count">{contexts.length} / {COMPANY_COMPARE_LIMIT}{t(" 已选")}</span><div className="job-compare-items">{contexts.map((context) => <button key={context.key} type="button" title={context.title} onClick={() => onRemove(context.note.path)} aria-label={t("移除{company} {role}", { company: context.company, role: context.title })}><span>{compareName(context)}<small>{context.title}</small></span><b aria-hidden="true">×</b></button>)}</div><button type="button" className="job-compare-open" disabled={contexts.length < 2} onClick={onOpen}>{contexts.length < 2 ? t("再选 1 项即可对比") : t("查看差异")}</button><button type="button" className="job-compare-clear" onClick={onClear}>{t("清空")}</button></div>;
}
/** 选择器与页头共用同一个上限，满额后仍能取消。 */
export function toggleCompanyComparison(paths: string[], path: string) {
  if (paths.includes(path)) return paths.filter((item) => item !== path);
  return paths.length < COMPANY_COMPARE_LIMIT ? [...paths, path] : paths;
}
const COMPARE_FILTERS: { id: CompanyCompareFilter; label: string }[] = [{ id: "relevant", label: "相关公司" }, { id: "upcoming", label: "即将面谈" }, { id: "recent", label: "最近面过" }, { id: "rated", label: "有外部评分" }, { id: "selected", label: "已选" }, { id: "all", label: "全部案件" }];
const COMPARE_PRESETS = [{ id: "upcoming", icon: "↗", title: "即将面谈", hint: "按确认日程，先看接下来几家" }, { id: "recent", icon: "◷", title: "最近面过", hint: "按真实面谈日期回看" }, { id: "openwork", icon: "★", title: "OpenWork 高分", hint: "只按 OpenWork 原始评分" }, { id: "jobtalk", icon: "✦", title: "転職会議 高分", hint: "只按転職会議原始评分" }] as const;
export function CompanyCompareQuickPicks({ candidates, onSelect }: { candidates: CompanyCompareCandidate[]; onSelect: (paths: string[], preset: typeof COMPARE_PRESETS[number]) => void }) {
  const t = useCompanyCopy();
  return <div className="co-quick-picks" aria-label={t("快捷选择公司")}>{COMPARE_PRESETS.map((preset) => {
    const paths = companyComparePreset(candidates, preset.id, 4);
    return <button type="button" key={preset.id} disabled={!paths.length} title={t("{hint}。替换当前所选，之后仍可增删。", { hint: t(preset.hint) })} onClick={() => onSelect(paths, preset)}><em aria-hidden="true">{preset.icon}</em><span><strong>{t(preset.title)}</strong><small>{paths.length ? t("快速选 {count} 家 · 可再调整", { count: paths.length }) : t("暂无对应资料")}</small></span><b aria-hidden="true">＋</b></button>;
  })}</div>;
}
function CompareDialog({ className, label, onClose, children }: { className: string; label: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, true);
  useEffect(() => { const old = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = old; }; }, []);
  return <div className="job-compare-backdrop co-compare-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className={`co-compare-panel ${className}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>{children}</div></div>;
}
/** 独立页正常参与文档与键盘导航，只有浮层模式才隔离背景和焦点。 */
function CompareFrame({ embedded, className, label, onClose, children }: { embedded: boolean; className: string; label: string; onClose: () => void; children: ReactNode }) {
  return embedded ? <section className={`co-compare-panel ${className} co-compare-embedded`} aria-label={label}>{children}</section> : <CompareDialog className={className} label={label} onClose={onClose}>{children}</CompareDialog>;
}
export function CompanyCompareSelector({ contexts, selected, notes = [], today = "1970-01-01", onToggle, onSelectPaths, onClose, onCompare, embedded = false }: { contexts: CompanyOverview[]; selected: CompanyOverview[]; notes?: Note[]; today?: string; onToggle: (path: string) => void; onSelectPaths?: (paths: string[]) => void; onClose: () => void; onCompare: () => void; embedded?: boolean }) {
  const t = useCompanyCopy();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CompanyCompareFilter>("relevant");
  const [sort, setSort] = useState<CompanyCompareSort>("relevance");
  const [presetMessage, setPresetMessage] = useState("");
  const candidates = useMemo(() => buildCompanyCompareCandidates(contexts, notes, today), [contexts, notes, today]);
  const selectedPaths = selected.map((item) => item.note.path);
  const selectedSet = new Set(selectedPaths);
  const full = selected.length >= COMPANY_COMPARE_LIMIT;
  const visible = filterCompanyCompareCandidates(candidates, query, filter, selectedPaths, sort);
  const replaceSelection = (paths: string[]) => {
    if (onSelectPaths) onSelectPaths(paths);
    else { for (const path of selectedPaths) if (!paths.includes(path)) onToggle(path); for (const path of paths) if (!selectedSet.has(path)) onToggle(path); }
  };
  return <CompareFrame embedded={embedded} className="co-selector-shell" label={t("选择公司对比")} onClose={onClose}>
    <header className="co-selector-hero"><div className="co-selector-icon" aria-hidden="true">⇄</div><div className="co-selector-heading"><p>{t("COMPARE · 先认出公司，再看差异")}</p><h2>{t("选几家，一起看")}</h2><span>{t("岗位、面谈时间与口碑放在一起，最多选择 ")}{COMPANY_COMPARE_LIMIT}{t(" 项。")}</span></div>{!embedded && <button type="button" className="co-dialog-close" onClick={onClose} aria-label={t("关闭公司选择")}>×</button>}</header>
    <CompanyCompareQuickPicks candidates={candidates} onSelect={(paths, preset) => { replaceSelection(paths); setQuery(""); setFilter("selected"); setSort(preset.id === "upcoming" ? "relevance" : preset.id); setPresetMessage(t("已按{preset}选入 {count} 家，可继续调整。", { preset: t(preset.title), count: paths.length })); }} />
    <div className="co-selector-tools"><label><span className="sr-only">{t("搜索公司、岗位或业务")}</span><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("想不起来名字？也可以搜岗位、业务或渠道")} /></label><label>{t("排序")}<select value={sort} onChange={(event) => setSort(event.target.value as CompanyCompareSort)}><option value="relevance">{t("面谈与资料优先")}</option><option value="recent">{t("最近面过在前")}</option><option value="openwork">{t("OpenWork 高 → 低")}</option><option value="jobtalk">{t("転職会議 高 → 低")}</option></select></label></div>
    <div className="co-selector-filters" aria-label={t("筛选对比公司")}>{COMPARE_FILTERS.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{t(item.label)}<small>{filterCompanyCompareCandidates(candidates, "", item.id, selectedPaths, "relevance").length}</small></button>)}</div>
    <p className="co-selector-guide" aria-live="polite">{query ? t("找到 {count} 项", { count: visible.length }) : presetMessage || t("默认显示有公司资料或面谈记录的项目；近期安排排在前面。快捷选择会替换已选项。")}</p>
    <div className="co-candidate-grid" role="group" aria-label={t("可对比的公司与岗位")}>{visible.map((item) => {
      const checked = selectedSet.has(item.context.note.path);
      const business = item.context.profile?.facts.find((fact) => /business/.test(fact.id))?.value || t("业务资料待补，可先查看岗位与已有评价");
      return <label key={item.context.key} className={`co-candidate-card${checked ? " selected" : ""}${full && !checked ? " disabled" : ""}`} data-tone={companyTone(item.shortName)}><input type="checkbox" checked={checked} disabled={full && !checked} onChange={() => onToggle(item.context.note.path)} aria-label={`${item.shortName} · ${item.displayRole}`} /><div className="co-candidate-head"><span className="co-company-monogram" data-tone={companyTone(item.shortName)} aria-hidden="true">{item.shortName.slice(0, 2)}</span><div className="co-candidate-identity"><h3 title={item.context.company}>{item.shortName}</h3><p title={item.context.title}>{item.displayRole}</p></div><span className="co-check-indicator" aria-hidden="true">{checked ? "✓" : "＋"}</span></div><p className="co-candidate-business" title={business}>{business}</p><CandidateMeta item={item} /><div className="co-candidate-ratings">{COMPARE_PLATFORMS.map((platform) => <PlatformScore key={platform} context={item.context} platform={platform} mini />)}</div><div className="co-readiness"><span>{t(item.readinessLabel)}</span><small>{checked ? t("已选入对比") : t("点击加入")}</small></div></label>;
    })}{!visible.length && <div className="co-selector-empty"><strong>{t("这里还没有匹配的公司")}</strong><p>{t("试试岗位或业务关键词，或切换到「全部案件」。")}</p><button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>{t("查看全部案件")}</button></div>}</div>
    <footer className="co-selector-footer"><div className="co-selected-chips" aria-label={t("已选公司")}>{selected.length ? selected.map((item) => <button type="button" key={item.key} onClick={() => onToggle(item.note.path)} title={item.title}>{compareName(item)}<span aria-hidden="true">×</span></button>) : <span>{t("先选 2 家，就能看出差异")}</span>}</div><div className="co-selector-submit"><span aria-live="polite">{selected.length} / {COMPANY_COMPARE_LIMIT}{t(" 已选")}{full ? t(" · 已选满，可移除后更换") : ""}</span>{selected.length > 0 && <button type="button" className="co-selection-clear" onClick={() => replaceSelection([])}>{t("清空")}</button>}<button type="button" disabled={selected.length < 2} onClick={onCompare}>{t("开始对比 ")}<b aria-hidden="true">→</b></button></div></footer>
  </CompareFrame>;
}
function ComparisonSignal({ context, kind }: { context: CompanyOverview; kind: "positive" | "concern" }) {
  const t = useCompanyCopy();
  const insights = context.profile?.reviews.flatMap((review) => review.insights.map((insight) => ({ ...insight, platform: review.platform }))) ?? [];
  const signal = insights.find((insight) => insight.kind === kind) || (kind === "positive" ? insights.find((insight) => insight.kind === "mixed") : undefined);
  if (!signal) return <span className="co-muted">{context.profile?.reviews.length ? t("尚无足够证据提炼这一项") : t("外部评价待调查")}</span>;
  return <details className={`co-signal ${signal.kind}`}><summary><small>{signal.platform} · {signal.kind === "mixed" ? t("机会与代价") : kind === "positive" ? t("值得留意的机会") : t("需要留意")}</small><strong>{signal.title}</strong><span>{t("看依据 ＋")}</span></summary><p>{signal.summary}</p><p>{signal.implication}</p><Evidence items={signal.evidence.map((item) => ({ label: `${item.role} · ${item.publishedOn}`, url: item.url }))} onOpenWiki={() => {}} /></details>;
}
function FitPips({ dimension }: { dimension?: CompanyFitDimension }) {
  const t = useCompanyCopy();
  const score = dimension?.score ?? null;
  return <div className={`co-fit-pips${score === null ? " unknown" : ""}`} aria-label={score === null ? t("资料不足，未评分") : `${score} / 5`}><span aria-hidden="true">{[1, 2, 3, 4, 5].map((value) => <i key={value} data-filled={score !== null && value <= score} />)}</span><b>{score === null ? t("待评估") : `${score} / 5`}</b>{dimension && <details><summary>{t("依据")}</summary><p>{dimension.rationale}</p></details>}</div>;
}
function CaseFitGraphic({ context }: { context: CompanyOverview }) {
  const t = useCompanyCopy();
  const fit = context.kind === "case" ? toJobCard(context.note).fit : null;
  return <div className="co-jobfit-meter">{fit && <><strong>{fit.score}<small> / 100 · Band {fit.band}</small></strong><div aria-hidden="true"><i style={{ width: `${fit.score}%` }} /></div></>}<details><summary>{fit ? t("案件採点与依据") : context.kind === "case" ? t("未採点（v2）") : t("面谈 · 无案件采点")}</summary><CaseFit context={context} /></details></div>;
}
function ReviewThemeCell({ context, onOpenWiki }: { context: CompanyOverview; onOpenWiki: (target: string) => void }) {
  const t = useCompanyCopy();
  const reviews = context.profile?.reviews ?? [];
  const themes = reviews.flatMap((review) => (review.insights ?? []).map((insight) => ({ ...insight, platform: review.platform })));
  const titleKey = (title: string) => title.normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
  const unique = themes.filter((theme, index) => themes.findIndex((other) => titleKey(other.title) === titleKey(theme.title)) === index);
  // 优先让机会与顾虑同时可见；缺少一类时按资料原序补足，不替评价编造另一面。
  const preferred = [unique.find((theme) => theme.kind === "positive" || theme.kind === "mixed"), unique.find((theme) => theme.kind === "concern")];
  const preview = [...preferred, ...unique].filter((theme, index, items) => theme && items.findIndex((other) => other && titleKey(other.title) === titleKey(theme.title)) === index).slice(0, 2);
  return <div className="co-theme-cell">
    {!!preview.length && <ul className="co-theme-preview" aria-label={t("评价主题预览")}>{preview.map((theme) => theme && <li key={titleKey(theme.title)} className={theme.kind}><span>{theme.platform}</span><strong>{theme.title}</strong></li>)}</ul>}
    <details className="co-board-expand"><summary>{themes.length}{t(" 个主题 · 查看原文与阅读边界")}</summary><Reviews compact reviews={reviews} onOpenWiki={onOpenWiki} /></details>
  </div>;
}
export function CompanyCompare({ contexts, notes = [], today = "1970-01-01", onClose, onDetail, onRemove, onOpenWiki, onEdit, embedded = false, projectedCandidates }: { contexts: CompanyOverview[]; notes?: Note[]; today?: string; onClose: () => void; onDetail: (context: CompanyOverview) => void; onRemove: (path: string) => void; onOpenWiki: (target: string) => void; onEdit?: () => void; embedded?: boolean; projectedCandidates?: CompanyCompareCandidate[] }) {
  const t = useCompanyCopy();
  const [view, setView] = useState<"overview" | "reviews" | "conditions">("overview");
  const [sort, setSort] = useState<"selected" | CompanyCompareSort>("selected");
  const candidates = useMemo(() => projectedCandidates ?? buildCompanyCompareCandidates(contexts, notes, today), [projectedCandidates, contexts, notes, today]);
  const items = sort === "selected" ? contexts.flatMap((context) => { const item = candidates.find((candidate) => candidate.context.key === context.key); return item ? [item] : []; }) : filterCompanyCompareCandidates(candidates, "", "all", [], sort);
  const columns = items.map((item) => item.context);
  const versions = new Set(columns.flatMap((context) => context.assessment ? [context.assessment.criteriaVersion] : []));
  const mixedCriteria = versions.size > 1;
  const axes = companyFitDimensions([...versions][0] ?? 2);
  const facts = new Map<string, string>();
  for (const context of columns) for (const fact of [...(context.profile?.facts ?? []), ...(context.assessment?.contextFacts ?? [])]) if (!facts.has(fact.id)) facts.set(fact.id, fact.label);
  const rows: { label: string; hint?: string; render: (context: CompanyOverview) => ReactNode }[] = view === "conditions" ? [
    { label: "案件 v2 採点", hint: "与公司口碑分开", render: (context) => <CaseFitGraphic context={context} /> },
    ...[...facts].map(([id, label]) => ({ label, render: (context: CompanyOverview) => <Fact fact={[...(context.assessment?.contextFacts ?? []), ...(context.profile?.facts ?? [])].find((fact) => fact.id === id)} onOpenWiki={onOpenWiki} /> })),
    { label: "面谈核实", render: (context) => context.assessment?.questions.length ? <ul>{context.assessment.questions.slice(0, 3).map((question) => <li key={question}>{question}</li>)}</ul> : <span className="co-muted">{t("岗位职责与工作条件待核实")}</span> },
    { label: "资料时点", render: (context) => <span className="co-muted">{t("公司资料 ")}{context.profile?.updatedOn || t("未整理")}<br />{t("契合判断 ")}{context.assessment?.assessedOn || t("未评估")}</span> },
  ] : [
    ...COMPARE_PLATFORMS.map((platform) => ({ label: platform, hint: "原始评分 · 满分 5", render: (context: CompanyOverview) => <PlatformScore context={context} platform={platform} /> })),
    ...(view === "overview" ? [
      { label: "值得争取", hint: "来自已有评价", render: (context: CompanyOverview) => <ComparisonSignal context={context} kind="positive" /> },
      { label: "主要取舍", hint: "先看具体疑虑", render: (context: CompanyOverview) => <ComparisonSignal context={context} kind="concern" /> },
      { label: "岗位判断", hint: "本人经验与岗位", render: (context: CompanyOverview) => <details className="co-board-expand"><summary>{context.assessment ? t("展开岗位判断") : t("尚未评估")}</summary><p>{context.assessment?.summary || t("没有足够证据判断岗位契合；外部口碑仍可独立比较。")}</p></details> },
      ...(mixedCriteria ? [] : axes.map((axis) => ({ label: axis.label, hint: "契合刻度 · 满分 5", render: (context: CompanyOverview) => <FitPips dimension={context.assessment?.dimensions.find((item) => item.key === axis.key)} /> }))),
    ] : [
      { label: "口碑总结", hint: "先读这家最重要的取舍", render: (context: CompanyOverview) => context.profile?.reviewSynthesis ? <ReviewSynthesis compact synthesis={context.profile.reviewSynthesis} onOpenWiki={onOpenWiki} /> : <span className="co-muted">{t("尚无可核对的总结")}</span> },
      { label: "主题与原文", hint: "按需展开证据", render: (context: CompanyOverview) => <ReviewThemeCell context={context} onOpenWiki={onOpenWiki} /> },
    ]),
  ];
  return <CompareFrame embedded={embedded} className="co-board-shell" label={t("公司与岗位并排对比")} onClose={onClose}>
    <header className="co-board-header"><div className="co-selector-icon" aria-hidden="true">⇄</div><div><p>COMPARE · {columns.length}{t(" 项并排")}</p><h2>{t("差异，放在一起看")}</h2><span>{t("先看分数和取舍，再展开原文。不同平台不平均，资料缺失保留空白。")}</span></div><div className="co-board-actions">{onEdit && <button type="button" onClick={onEdit}>{t("更换公司")}</button>}{!embedded && <button type="button" className="co-dialog-close" onClick={onClose} aria-label={t("关闭对比")}>×</button>}</div></header>
    <div className="co-board-controls"><div role="group" aria-label={t("比较内容")}>{[{ id: "overview", label: t("一眼看差异") }, { id: "reviews", label: t("外部口碑") }, { id: "conditions", label: t("职责与条件") }].map((tab) => <button type="button" key={tab.id} aria-pressed={view === tab.id} onClick={() => setView(tab.id as typeof view)}>{t(tab.label)}</button>)}</div><label>{t("列排序")}<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="selected">{t("选择顺序")}</option><option value="openwork">{t("OpenWork 高 → 低")}</option><option value="jobtalk">{t("転職会議 高 → 低")}</option><option value="recent">{t("最近面谈")}</option></select></label><span>{columns.length > 3 ? t("向右滚动查看更多公司 →") : t("点开主题，查看具体依据")}</span></div>
    {mixedCriteria && <p className="co-notice co-compare-notice">{t("所选画像的评价维度不同，暂不并排比较六维契合刻度。公司事实和各平台口碑仍可比较；各公司的原始判断可从「查看总览」阅读。")}</p>}
    <div className="co-board-scroll"><table className="co-board-table" style={{ minWidth: `${170 + columns.length * 270}px` }}><caption className="sr-only">{t("公司事实、六维契合度与外部评价并排比较")}</caption><colgroup><col style={{ width: 170 }} />{columns.map((context) => <col key={context.key} style={{ width: 270 }} />)}</colgroup><thead><tr><th scope="col"><span>{t("公司 / 岗位")}</span><small>{t("每一列独立判断")}</small></th>{items.map((item) => <th scope="col" key={item.context.key} data-tone={companyTone(item.shortName)}><div className="co-board-company"><button type="button" className="co-company-detail" onClick={() => onDetail(item.context)}><span className="co-company-monogram" data-tone={companyTone(item.shortName)} aria-hidden="true">{item.shortName.slice(0, 2)}</span><strong>{item.shortName}</strong><small title={item.context.title}>{item.displayRole}</small><em>{t("查看总览 ↗")}</em></button><button type="button" className="co-remove" onClick={() => onRemove(item.context.note.path)} aria-label={t("从对比移除{company} {role}", { company: item.context.company, role: item.displayRole })}>×</button></div><CandidateMeta item={item} /></th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${view}:${row.label}:${index}`}><th scope="row">{t(row.label)}{row.hint && <small>{t(row.hint)}</small>}</th>{columns.map((context) => <td key={context.key}>{row.render(context)}</td>)}</tr>)}</tbody></table></div>
  </CompareFrame>;
}
