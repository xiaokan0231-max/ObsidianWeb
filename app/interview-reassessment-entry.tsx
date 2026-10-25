"use client";


import { useInterviewMenu } from "./interview-menu-copy";
import { parseSeirikou } from "@/lib/review";
import type { AdvisoryEvidenceRef } from "@/lib/interview-advisory";
import { REVIEW_DIMENSION_META, type ReviewDimensionKey } from "@/lib/review-deep";
import { reviewDisplayScore } from "@/lib/review-visual";
import { getString, getTitle, getType, type Note } from "@/lib/notes";

export function findInterviewReassessment(notes: Note[], sourcePath?: string) {
  return notes.filter((note) => getType(note) === "ai-report"
    && note.frontmatter.report_kind === "interview-reassessment"
    && (sourcePath ? note.frontmatter.report_role === "session" && note.frontmatter.source_path === sourcePath : note.frontmatter.report_role === "index"))
    .sort((a, b) => getString(b.frontmatter.generated_at).localeCompare(getString(a.frontmatter.generated_at)) || getString(b.frontmatter.method_version).localeCompare(getString(a.frontmatter.method_version)))[0];
}


/** 只拆分已保存的观察、动作与引用，不推断新的问题，也不改原报告。 */
export function assessmentIssueCopy(text: string) {
  const action = text.match(/下一步[：:]\s*([\s\S]*?)(?=\s*验证[：:]|$)/)?.[1]?.trim() || "";
  const observation = text.split(/\s*(?:下一步|依据|验证)[：:]/)[0]
    .replace(/^(?:严重|中等|轻微)\s*·\s*(?:未恢复|已恢复|部分恢复)\s*·\s*[^：]*[：:]/, "")
    .replace(/^有限材料局部行动\s*·\s*opportunity\s*·\s*/, "");
  const readable = (value: string) => value.replace(/\bq\d+(?:[–—-]\d+)?(?:\/)?/g, "").replace(/\bs\d+(?:[–—-]\d+)?/g, "").replace(/[、，]\s*[、，]/g, "，").replace(/^[、，：\s]+/, "").trim();
  return { observation: readable(observation), action: readable(action), blockId: text.match(/\bq\d+\b/)?.[0] || "", sentenceIds: [...text.matchAll(/\bs\d+\b/g)].map(match => match[0]) };
}

/** 默认保留分数与首要问题，完整依据按需展开，避免挤走原文。 */
export function InterviewReassessmentEntry({ notes, sourcePath, onOpenNote, expanded, onExpandedChange, onClose, onOpenEvidence, onOpenUnderstanding, t: translate }: {
  notes: Note[]; sourcePath?: string; onOpenNote?: (note: Note) => void; t?: (label: string) => string;
  onOpenEvidence?: (ref: AdvisoryEvidenceRef) => void; onOpenUnderstanding?: () => void;
  expanded?: boolean; onExpandedChange?: (open: boolean) => void; onClose?: () => void;
}) {
  const menu = useInterviewMenu();
  const t = translate ?? menu;
  const report = findInterviewReassessment(notes, sourcePath);
  if (!report) return null;
  const fm = report.frontmatter;
  const display = reviewDisplayScore({ key: report.path, company: "", date: "", round: "", reassessment: report });
  const scored = fm.evaluation_mode === "scored_evidence";
  const dimensions = fm.dimension_scores && typeof fm.dimension_scores === "object" ? fm.dimension_scores as Record<string, unknown> : {};
  const dimensionScore = (key: string) => typeof dimensions[key] === "number" && Number.isFinite(dimensions[key]) ? Math.round(dimensions[key] as number) : null;
  const actions = notes.filter((note) => note.frontmatter.report_kind === "interview-reassessment"
    && note.frontmatter.report_role === "actions" && note.frontmatter.method_version === fm.method_version)
    .sort((a, b) => getString(b.frontmatter.generated_at).localeCompare(getString(a.frontmatter.generated_at)))[0];
  const previous = notes.find((note) => note.path === fm.previous_report);
  const items = (key: string) => Array.isArray(fm[key]) ? (fm[key] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const critical = sourcePath ? [] : notes.filter((n) => n.frontmatter.report_kind === "interview-reassessment"
    && n.frontmatter.report_role === "session" && n.frontmatter.method_version === fm.method_version
    && findInterviewReassessment(notes, getString(n.frontmatter.source_path))?.path === n.path).flatMap((n) => {
      const issues = Array.isArray(n.frontmatter.priority_issues) ? n.frontmatter.priority_issues as unknown[] : [];
      return issues.filter((x): x is string => typeof x === "string" && x.startsWith("严重 · 未恢复"))
        .map((issue) => ({ note: n, issue }));
    }).slice(0, 3);
  const content = <section className="rv-insights-entry rv-reassessment-entry" aria-label={menu("新版证据评价")}>
    <div className="rv-reassessment-copy"><h2>{sourcePath ? scored ? menu("新版有据评分与主要问题") : menu("新版证据评价 · 无总分") : t("跨面试重点")}</h2>
      <p>{sourcePath && fm.assessment_scope !== "full_available_text"
        ? menu("有限材料分析，不生成整场分数；有证据的局部评分与观察仍保留。")
        : scored ? menu("分数与关键问题一起读；未问或缺证的维度保持未评估，不以0或100代替。") : menu("以具体证据、关键问题与修复状态评价；未问或缺证的维度保持未评估。")}</p>
      {critical.length > 0 && <><h3>{menu("先看未恢复的关键问题")}</h3><ol aria-label={menu("未恢复核心问题")}>{critical.map(({ note, issue }) => {
        const copy = assessmentIssueCopy(issue);
        const source = notes.find(item => item.path === note.frontmatter.source_path);
        return <li key={note.path + issue}>
          <strong>{getString(note.frontmatter.company) || (source && getString(source.frontmatter.company)) || getTitle(note)}</strong>
          <p>{copy.observation.split(/[。；]/)[0]}</p>
          {copy.action && <p>{t("下一步")}：{copy.action.split(/[。；]/)[0]}</p>}
          {onOpenNote && <button type="button" onClick={() => onOpenNote(note)}>{t("查看证据 →")}</button>}
          <details><summary>{t("查看完整建议与依据")}</summary><p>{issue}</p></details>
        </li>;
      })}</ol></>}
      {sourcePath && <>
        {scored && <section aria-label={menu("新版有据评分")}>
          <p><strong>{display.score === null ? menu("整场总分：未评估") : menu("新版总分：{score} / 100", { score: Math.round(display.score) })}</strong> · {getString(fm.eligibility)}</p>
          <p aria-label={menu("新版维度评分")}>{(Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[]).map((key, index) => <span key={key}>{index > 0 ? " · " : ""}{REVIEW_DIMENSION_META[key].label}：{dimensionScore(key) === null ? menu("未评估（—）") : dimensionScore(key)}</span>)}</p>
          {getString(fm.scoring_formula) && <p>{getString(fm.scoring_formula)}</p>}
        </section>}
        {display.historicalScore !== null && <p>{menu("历史旧分：")}{Math.round(display.historicalScore)}{menu(" / 100 · 不同口径，不能解读为能力涨跌。")}</p>}
        <p><strong>{getString(fm.diagnostic_conclusion) || menu("材料与诊断见新版报告")}</strong></p>
        {items("priority_issues").length > 0 && <ol aria-label={menu("优先问题与修复状态")}>{items("priority_issues").map((item) => <li key={item}>{item}</li>)}</ol>}
        {items("dimension_evaluation").length > 0 && <ul aria-label={menu("有据维度判断")}>{items("dimension_evaluation").map((item) => <li key={item}>{item}</li>)}</ul>}
        {scored && fm.assessment_scope !== "full_available_text" && items("local_scores").length > 0 && <ul aria-label={menu("有据局部评分")}>{items("local_scores").map((item) => <li key={item}>{item}</li>)}</ul>}
        {scored && (items("score_basis").length > 0 || (fm.assessment_scope === "full_available_text" && items("local_scores").length > 0)) && <details><summary>{menu("评分依据、上限与局部评分")}</summary>
          {items("score_basis").length > 0 && <ul aria-label={menu("评分依据与算式")}>{items("score_basis").map((item) => <li key={item}>{item}</li>)}</ul>}
          {fm.assessment_scope === "full_available_text" && items("local_scores").length > 0 && <ul aria-label={menu("局部评分")}>{items("local_scores").map((item) => <li key={item}>{item}</li>)}</ul>}
        </details>}
        <p>{getString(fm.material_coverage)}</p>
        <p>{getString(fm.material_limits)}</p>
      </>}
    </div>
    {onOpenNote && <div className="rv-title-links rv-reassessment-actions">
      <button type="button" onClick={() => onOpenNote(report)}>{sourcePath ? menu("打开新版报告 →") : t("重评总索引 →")}</button>
      {actions && <button type="button" onClick={() => onOpenNote(actions)}>{t("跨场行动建议 →")}</button>}
      {sourcePath && previous && <button type="button" onClick={() => onOpenNote(previous)}>{menu("旧版报告（历史）↗")}</button>}
    </div>}
  </section>;
  if (!sourcePath) return content;
  const issues = items("priority_issues");
  const parsed = notes.find(note => note.path === sourcePath);
  const blocks = parsed ? parseSeirikou(parsed.content).blocks : [];
  const humanContent = <section className="rv-assessment-content" aria-label={t("面试评价")}>
    <header><h2>{t("这场面试的表现")}</h2><p>{display.score === null ? t("现有材料不足以给整场评分；可以查看具体回答。") : t("分数反映这场有记录的回答，结合下面的具体内容一起看。")}</p></header>
    {scored && <dl className="rv-assessment-dimensions" aria-label={t("各项表现")}>
      {(Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[]).map(key => <div key={key}><dt>{t(REVIEW_DIMENSION_META[key].label)}</dt><dd>{dimensionScore(key) ?? t("暂无法判断")}</dd></div>)}
    </dl>}
    <h3>{t("值得改进的地方")}</h3>
    {issues.length ? <ol className="rv-assessment-issues">{issues.map((issue, index) => {
      const copy = assessmentIssueCopy(issue);
      const block = blocks.find(block => block.id === copy.blockId);
      const sentenceIds = copy.sentenceIds.filter(id => block?.sentences.some(sentence => sentence.id === id));
      return <li key={issue}>
        <h4>{block?.title || `${t("建议")} ${index + 1}`}</h4>
        {issue.startsWith(menu("严重")) && <strong className="rv-issue-important">{t("优先改进")}</strong>}
        <p>{copy.observation}</p>
        {copy.action && <div className="rv-issue-next"><strong>{t("下次可以这样做")}</strong><p>{copy.action}</p></div>}
        {block && onOpenEvidence && <button type="button" onClick={() => onOpenEvidence({ sourcePath, blockId: block.id, sentenceIds })}>{t("查看这段原文 →")}</button>}
      </li>;
    })}</ol> : <p>{t("这次评价没有列出需要优先纠正的回答。后续准备与确认事项可以在全文理解中查看。")}</p>}
    <div className="rv-assessment-links">
      {onOpenUnderstanding && <button type="button" onClick={onOpenUnderstanding}>{t("看看下一步怎么准备 →")}</button>}
      {onOpenNote && <>
        <button type="button" onClick={() => onOpenNote(report)}>{t("完整评价 →")}</button>
        {actions && <button type="button" onClick={() => onOpenNote(actions)}>{t("跨场练习建议 →")}</button>}
      </>}
    </div>
    <details className="rv-assessment-evidence"><summary>{t("查看评价依据")}</summary>
      {getString(fm.diagnostic_conclusion) && <p>{getString(fm.diagnostic_conclusion)}</p>}
      <ul aria-label={menu("原始问题与修复记录")}>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
      <ul aria-label={menu("各项评价依据")}>{items("dimension_evaluation").map(item => <li key={item}>{item}</li>)}</ul>
      {items("local_scores").length > 0 && <ul aria-label={menu("局部评分")}>{items("local_scores").map(item => <li key={item}>{item}</li>)}</ul>}
      <details><summary>{t("分数怎么算的")}</summary>
        <p>{getString(fm.eligibility)}</p><p>{getString(fm.scoring_formula)}</p>
        <ul aria-label={menu("评分依据与算式")}>{items("score_basis").map(item => <li key={item}>{item}</li>)}</ul>
        {display.historicalScore !== null && <p>{menu("历史旧分：")}{Math.round(display.historicalScore)}{menu(" / 100 · 不同口径，不能解读为能力涨跌。")}</p>}
        {previous && onOpenNote && <button type="button" onClick={() => onOpenNote(previous)}>{t("查看之前的评价 ↗")}</button>}
      </details>
      <details><summary>{t("哪些内容暂时不能判断")}</summary><p>{getString(fm.material_coverage)}</p><p>{getString(fm.material_limits)}</p></details>
    </details>
  </section>;
  return <details className="rv-assessment-disclosure" open={expanded} onToggle={(event) => {
    onExpandedChange?.(event.currentTarget.open);
  }}>
    <summary onClick={(event) => {
      const details = event.currentTarget.parentElement as HTMLDetailsElement;
      if (!details.open) details.dataset.returnScroll = String(window.scrollY);
    }}>
      <span className="rv-assessment-score">{t("面试评价")} <strong>{display.score === null ? t("未评估") : `${Math.round(display.score)} / 100`}</strong></span>
      <span className="rv-assessment-preview">{issues.length ? assessmentIssueCopy(issues[0]).observation.split(/[。；]/)[0] : t("查看具体表现与下一步建议")}</span>
      <span className="rv-assessment-open">{t("查看评价与建议")} <i aria-hidden="true">⌄</i></span>
    </summary>
    {humanContent}
    <button type="button" className="rv-assessment-close" onClick={(event) => {
      const details = event.currentTarget.closest("details");
      if (details) {
        details.open = false;
        onExpandedChange?.(false);
        // 显式关闭长报告才恢复入口位置；面板切换由父页恢复各自的阅读位置。
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: Number(details.dataset.returnScroll || 0), behavior: "instant" });
          details.querySelector("summary")?.focus({ preventScroll: true });
        });
      }
      onClose?.();
    }}>{t("收起详情，返回阅读")}</button>
  </details>;
}
