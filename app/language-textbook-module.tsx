"use client";

import { useEffect, useRef } from "react";
import type { TextbookModule, TextbookPoint } from "@/lib/language-textbook-module";
import type { TextbookView } from "@/lib/language-textbook-position";
import { useTextbookPosition } from "./use-textbook-position";
import { useTextbookCopy } from "./language-textbook-copy";
import { ContrastStep, ExampleStep } from "./textbook-practice-cards";

const STEP_ORDER: TextbookView[] = ["source", "explain", "contrast", "examples"];
const LABELS = { source: "回看原场", explain: "抓住用法", contrast: "辨别含义", examples: "开口练习" } as const;
const STEP_HINTS = { source: "先看原句与判断依据", explain: "记住一个关系，再看为什么", contrast: "先辨别意思，再看解释", examples: "用一句日语表达，再对照参考" } as const;

function SourceLinks({ references, onOpenWiki }: { references: string[]; onOpenWiki: (target: string, section?: string) => void }) {
  const { t } = useTextbookCopy();
  return <div className="learning-source-links">{references.map((reference, index) => {
    if (/^https?:\/\//.test(reference)) return <a key={reference} href={reference} target="_blank" rel="noreferrer">{t("公开教学依据")} ↗</a>;
    const body = reference.replace(/^\[\[/, "").replace(/\]\]$/, "");
    const [targetAndSection, alias] = body.split("|");
    const [target, section] = targetAndSection.split("#");
    return <button key={reference} type="button" onClick={() => onOpenWiki(target, section)}>{alias ? <span lang="zh-CN">{alias}</span> : t("出处 {index}", { index: index + 1 })} ↗</button>;
  })}</div>;
}

function firstReason(explanation: string) {
  const closing: Record<string, string> = { "「": "」", "『": "』", "“": "”", "‘": "’", "（": "）", "(": ")" };
  const nested: string[] = [];
  // 不在引用句或括号内部截断；完整说明仍留在原场步骤中。
  for (let index = 0; index < explanation.length; index++) {
    const char = explanation[index];
    if (closing[char]) nested.push(closing[char]);
    else if (char === nested.at(-1)) nested.pop();
    else if (!nested.length && "。！？\n".includes(char)) return explanation.slice(0, index + 1).trim();
  }
  return explanation.trim();
}

function SourcePreview({ point, view, onOpenWiki }: { point: TextbookPoint; view: TextbookView; onOpenWiki: (target: string, section?: string) => void }) {
  const { t } = useTextbookCopy();
  const source = point.source;
  if (!source) return null;
  const interviewer = source.speaker === "interviewer";
  const comparison = <div className="learning-source-quick-pair"><div><small>{t(interviewer ? "对方原场用语" : "原稿中的表达")}</small><p lang="ja">{source.originalJa}</p></div><div><small>{t(interviewer ? "语义整理" : "最小整理")}</small><p lang="ja">{source.revisionJa}</p></div></div>;
  return <section className="learning-source-preview" aria-label={t("原场表达与修改性质")}>
    {view === "source" ? comparison : <details key={view} className="learning-source-revisit"><summary>{t("回看原场表达与整理")}</summary>{comparison}</details>}
    <details className="learning-evidence"><summary>{t("来源可靠性与出处")}</summary><p className="learning-source-reliability" lang="zh-CN">{source.reliabilityZh}</p><SourceLinks references={source.refs} onOpenWiki={onOpenWiki} /></details>
  </section>;
}

function SourceStep({ point }: { point: TextbookPoint }) {
  const { t } = useTextbookCopy();
  const source = point.source;
  if (!source) return null;
  return <div className="learning-source">
    {firstReason(source.explanationZh) !== source.explanationZh.trim() && <details className="learning-source-reason"><summary>{t(source.speaker === "interviewer" ? "展开理解对方原话的完整说明" : "展开整理理由与使用边界")}</summary><p className="learning-source-explanation" lang="zh-CN">{source.explanationZh}</p></details>}
    {source.naturalJa && <details className="learning-natural"><summary>{t("也可以这样说")}</summary><p lang="ja">{source.naturalJa}</p></details>}
  </div>;
}

export default function TextbookLearningModule({ chapterId, chapterIds, module, onOpenWiki }: { chapterId: string; chapterIds: string[]; module: TextbookModule; onOpenWiki: (target: string, section?: string) => void }) {
  const { t, number, locale } = useTextbookCopy();
  const [position, setPosition] = useTextbookPosition(chapterId, chapterIds, module);
  const point = module.points.find(item => item.id === position.knowledge) ?? module.points[0];
  const focusRef = useRef<HTMLElement>(null);
  const pendingPointFocus = useRef<string | null>(null);
  useEffect(() => {
    const requested = pendingPointFocus.current;
    pendingPointFocus.current = null;
    // 只响应本人点击切点；URL 恢复、刷新和历史后退不抢滚动位置。
    if (requested !== point.id) return;
    focusRef.current?.scrollIntoView({ block: "start" });
    focusRef.current?.focus({ preventScroll: true });
  }, [point.id]);
  const view = position.lessonView;
  const views = STEP_ORDER.filter(item => item !== "source" || !!point.source);
  const stepIndex = views.indexOf(view);
  const setView = (lessonView: TextbookView) => setPosition({ ...position, lessonView });
  const index = module.points.indexOf(point);
  const selectPoint = (id: string) => {
    if (id !== point.id) pendingPointFocus.current = id;
    setPosition({ knowledge: id, lessonView: module.points.find(item => item.id === id)?.source ? "source" : "explain" });
  };
  return <div className="learning-module" lang={locale}>
    <section className="learning-overview" aria-label={t("本章重点概览")}>
      <div className="learning-overview-title"><small>{t("这一章学什么")}</small><p lang="zh-CN">{firstReason(module.summaryZh)}</p>{firstReason(module.summaryZh) !== module.summaryZh.trim() && <details className="learning-overview-more"><summary>{t("展开本章学习目标")}</summary><p lang="zh-CN">{module.summaryZh}</p></details>}</div>
      <nav className="learning-point-picker" aria-label={t("切换学习重点")}><small>{t("选一个重点开始 · {count} 个知识点", { count: module.points.length })}</small>
        <div className="learning-point-grid">{module.points.map((item, pointIndex) => <button type="button" key={item.id} onClick={() => selectPoint(item.id)} aria-pressed={item.id === point.id}>
          <span className="learning-point-number">{number(pointIndex + 1).padStart(2, "0")}</span><strong lang="zh-CN">{item.titleZh}</strong><span lang="ja">{item.patternJa}</span>
        </button>)}</div>
      </nav>
    </section>
    <section ref={focusRef} className="learning-focus" aria-labelledby="learning-point-title" tabIndex={-1}>
      <header><div><small>{t("当前知识点 {current} / {total}", { current: index + 1, total: module.points.length })}</small><h3 id="learning-point-title" lang="zh-CN">{point.titleZh}</h3></div><span className="learning-mode-label">{t("按需看，不必逐项完成")}</span></header>
      <section className="learning-point-brief" aria-label={t(point.source ? "材料能确认什么" : "教学例句起点")}>
        <small>{t(point.source ? "先看这次的结论" : "教学拓展")}</small>
        <dl><dt>{t(point.source ? "修改性质" : "本次重点")}</dt><dd lang="zh-CN">{point.source?.natureZh ?? point.meaningZh}</dd><dt>{t("为什么")}</dt><dd lang="zh-CN">{firstReason(point.source?.explanationZh ?? point.explanationZh[0])}</dd></dl>
        {!point.source && <p>{t("这个知识点先用教学例句学习，不是本人原话。")}</p>}
      </section>
      <div className="learning-tabs learning-step-tabs" role="tablist" aria-label={t("知识点学习方式")}>{views.map((item, tabIndex) => <button key={item} type="button" role="tab"
        id={`learning-tab-${item}`} aria-controls="learning-point-panel" aria-selected={view === item} tabIndex={view === item ? 0 : -1}
        onClick={() => setView(item)} onKeyDown={event => {
          const next = event.key === "ArrowRight" ? views[(tabIndex + 1) % views.length] : event.key === "ArrowLeft" ? views[(tabIndex + views.length - 1) % views.length] : event.key === "Home" ? views[0] : event.key === "End" ? views[views.length - 1] : null;
          if (next) { event.preventDefault(); setView(next); document.getElementById(`learning-tab-${next}`)?.focus(); }
        }}><span className="learning-step-number">{number(tabIndex + 1)}</span>{t(item === "source" && point.source?.speaker === "interviewer" ? "看原场用语" : LABELS[item])}</button>)}</div>
      <div className="learning-panel" role="tabpanel" id="learning-point-panel" aria-labelledby={`learning-tab-${view}`} tabIndex={0}>
        <div className="learning-step-intro"><small>{t("第 {current} / {total} 步", { current: stepIndex + 1, total: views.length })}</small><span>{t(STEP_HINTS[view])}</span></div>
        {point.source && (view === "source" ? <SourcePreview key={point.id} point={point} view={view} onOpenWiki={onOpenWiki} /> : <details className="learning-source-drawer" key={`${point.id}-${view}`}><summary>{t("原场对照与判断依据")}</summary><SourcePreview point={point} view="source" onOpenWiki={onOpenWiki} /><SourceStep point={point} /></details>)}
        {view === "explain" && <div className="learning-explanation" key={point.id}>
          <div className="learning-rule"><strong lang="ja">{point.patternJa}</strong><span lang="zh-CN">{point.meaningZh}</span></div>
          {point.readingJa && <p className="learning-reading"><small>{t("读音")}</small><span lang="ja">{point.readingJa}</span></p>}
          <div className="learning-why"><h4>{t("为什么这样用")}</h4>{point.source && <p lang="zh-CN">{firstReason(point.explanationZh[0])}</p>}
            {(point.explanationZh.length > 1 || firstReason(point.explanationZh[0]) !== point.explanationZh[0].trim()) && <details className="learning-extra-reasons"><summary>{t("展开接续与完整说明")}</summary>{point.explanationZh.map((line,lineIndex) => <p key={lineIndex} lang="zh-CN">{line}</p>)}</details>}
          </div>
          {!!point.collocationsJa?.length && <details className="learning-collocation-details"><summary>{t("常用搭配")}</summary><div className="learning-collocations">{point.collocationsJa.map(value => <span key={value} lang="ja">{value}</span>)}</div></details>}
          <div className="learning-inline-example"><small>{t("看一个例句")} · <span lang={point.examples[0].labelZh ? "zh-CN" : undefined}>{point.examples[0].labelZh || t("教学例句")}</span></small><p lang="ja">{point.examples[0].ja}</p><span lang="zh-CN">{point.examples[0].zh}</span></div>
          <p className="learning-caution"><b>{t("使用边界")}</b><span lang="zh-CN">{point.cautionZh}</span></p>
        </div>}
        {view === "source" && <SourceStep key={point.id} point={point} />}
        {view === "contrast" && <ContrastStep key={`${point.id}-contrast`} point={point} pointIndex={index} />}
        {view === "examples" && <ExampleStep key={`${point.id}-examples`} point={point} />}
        {view === "examples" && <section className="learning-takeaway" aria-label={t("这一轮带走什么")}><h4>{t("这一轮带走什么")}</h4><strong lang="ja">{point.patternJa}</strong><p lang="zh-CN">{point.cautionZh}</p><button type="button" onClick={() => setView("contrast")}>{t("再辨别一次")}</button></section>}
        <nav className="learning-step-nav" aria-label={t("知识点学习步骤")}><button type="button" disabled={stepIndex === 0} onClick={() => setView(views[stepIndex - 1])}>{t("← 上一步")}</button><span>{t("可以直接切换任一步")}</span><button type="button" disabled={stepIndex === views.length - 1} onClick={() => setView(views[stepIndex + 1])}>{t("下一步 →")}</button></nav>
      </div>
      <footer className="learning-point-nav"><span>{t("也可以换一个知识点继续看。")}</span><div>{index > 0 && <button type="button" onClick={() => selectPoint(module.points[index - 1].id)}>{t("← 上一知识点：")}<span lang="zh-CN">{module.points[index - 1].titleZh}</span></button>}{index < module.points.length - 1 && <button type="button" onClick={() => selectPoint(module.points[index + 1].id)}>{t("下一知识点：")}<span lang="zh-CN">{module.points[index + 1].titleZh}</span> →</button>}</div></footer>
    </section>
    <details className="learning-recap"><summary>{t("本章回顾")}</summary><ul lang="zh-CN">{module.recapZh.map(line => <li key={line}>{line}</li>)}</ul></details>
  </div>;
}
