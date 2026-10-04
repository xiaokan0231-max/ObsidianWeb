"use client";

import type { TextbookModule, TextbookPoint } from "@/lib/language-textbook-module";
import { TEXTBOOK_VIEWS, type TextbookView } from "@/lib/language-textbook-position";
import { useTextbookPosition } from "./use-textbook-position";

const LABELS: Record<TextbookView, string> = { explain: "怎么用", source: "我的表达", contrast: "易混对比", examples: "更多例句" };

function SourceLinks({ references, onOpenWiki }: { references: string[]; onOpenWiki: (target: string, section?: string) => void }) {
  return <div className="learning-source-links">{references.map((reference, index) => {
    if (/^https?:\/\//.test(reference)) return <a key={reference} href={reference} target="_blank" rel="noreferrer">公开教学依据 ↗</a>;
    const body = reference.replace(/^\[\[/, "").replace(/\]\]$/, "");
    const [targetAndSection, alias] = body.split("|");
    const [target, section] = targetAndSection.split("#");
    return <button key={reference} type="button" onClick={() => onOpenWiki(target, section)}>{alias || `出处 ${index + 1}`} ↗</button>;
  })}</div>;
}

function Source({ point, onOpenWiki }: { point: TextbookPoint; onOpenWiki: (target: string, section?: string) => void }) {
  const source = point.source;
  if (!source) return null;
  const interviewer = source.speaker === "interviewer";
  return <div className="learning-source">
    <div className="learning-source-status"><span>{source.natureZh.split(/[；;。]/)[0]}</span><span>{interviewer ? "对方原场用语" : "原稿中的表达"}</span></div>
    <div className="learning-revision"><section><small>{interviewer ? "对方原场用语" : "原稿中的表达"}</small><p lang="ja">{source.originalJa}</p></section><section><small>{interviewer ? "语义整理" : "最小整理"}</small><p lang="ja">{source.revisionJa}</p></section></div>
    {source.naturalJa && <div className="learning-natural"><small>也可以这样说</small><p lang="ja">{source.naturalJa}</p></div>}
    <p className="learning-source-explanation">{source.explanationZh}</p>
    <details className="learning-evidence"><summary>查看来源与核对说明</summary><p><b>来源可靠性：</b>{source.reliabilityZh}</p><p><b>修改性质：</b>{source.natureZh}</p><SourceLinks references={source.refs} onOpenWiki={onOpenWiki} /></details>
  </div>;
}

export default function TextbookLearningModule({ chapterId, chapterIds, module, onOpenWiki }: { chapterId: string; chapterIds: string[]; module: TextbookModule; onOpenWiki: (target: string, section?: string) => void }) {
  const [position, setPosition] = useTextbookPosition(chapterId, chapterIds, module);
  const point = module.points.find(item => item.id === position.knowledge) ?? module.points[0];
  const view = position.lessonView;
  const views = TEXTBOOK_VIEWS.filter(item => item !== "source" || !!point.source);
  const setView = (lessonView: TextbookView) => setPosition({ ...position, lessonView });
  const index = module.points.indexOf(point);
  const selectPoint = (id: string) => setPosition({ knowledge: id, lessonView: "explain" });
  return <div className="learning-module">
    <section className="learning-overview" aria-label="本章重点概览">
      <div className="learning-overview-title"><h3>先记住这几个关系</h3><p>{module.summaryZh}</p></div>
      <div className="learning-point-grid">{module.points.map((item, pointIndex) => <button type="button" key={item.id}
        onClick={() => selectPoint(item.id)} aria-pressed={item.id === point.id}>
        <span className="learning-point-number">{String(pointIndex + 1).padStart(2, "0")}</span><strong lang="ja">{item.patternJa}</strong><span>{item.meaningZh}</span>
      </button>)}</div>
    </section>
    <section className="learning-focus" aria-labelledby="learning-point-title">
      <header><div><small>当前知识点 {index + 1} / {module.points.length}</small><h3 id="learning-point-title">{point.titleZh}</h3></div><span className="learning-mode-label">可自由切换</span></header>
      <div className="learning-tabs" role="tablist" aria-label="知识点学习方式">{views.map((item, tabIndex) => <button key={item} type="button" role="tab"
        id={`learning-tab-${item}`} aria-controls="learning-point-panel" aria-selected={view === item} tabIndex={view === item ? 0 : -1}
        onClick={() => setView(item)} onKeyDown={event => {
          const next = event.key === "ArrowRight" ? views[(tabIndex + 1) % views.length] : event.key === "ArrowLeft" ? views[(tabIndex + views.length - 1) % views.length] : null;
          if (next) { event.preventDefault(); setView(next); document.getElementById(`learning-tab-${next}`)?.focus(); }
        }}>{item === "source" && point.source?.speaker === "interviewer" ? "原场用语" : LABELS[item]}</button>)}</div>
      <div className="learning-panel" role="tabpanel" id="learning-point-panel" aria-labelledby={`learning-tab-${view}`} tabIndex={0}>
        {view === "explain" && <div className="learning-explanation">
          <div className="learning-rule"><strong lang="ja">{point.patternJa}</strong><span>{point.meaningZh}</span></div>
          {point.readingJa && <p className="learning-reading"><small>读音</small><span lang="ja">{point.readingJa}</span></p>}
          {!!point.collocationsJa?.length && <div className="learning-collocations"><small>常用搭配</small>{point.collocationsJa.map(value => <span key={value} lang="ja">{value}</span>)}</div>}
          <div className="learning-why"><h4>为什么这样用</h4>{point.explanationZh.map(line => <p key={line}>{line}</p>)}</div>
          <div className="learning-inline-example"><small>{point.examples[0].labelZh || "教学例句"}</small><p lang="ja">{point.examples[0].ja}</p><span>{point.examples[0].zh}</span></div>
          <p className="learning-caution"><b>注意</b>{point.cautionZh}</p>
        </div>}
        {view === "source" && <Source key={point.id} point={point} onOpenWiki={onOpenWiki} />}
        {view === "contrast" && <div className="learning-contrasts">{point.contrasts.map((contrast, contrastIndex) => <section className="learning-contrast" key={contrastIndex}>
          <div className="learning-contrast-pair"><div><small>A · 这句的意思</small><p lang="ja">{contrast.leftJa}</p><span>{contrast.leftZh}</span></div><div><small>B · 换个表达之后</small><p lang="ja">{contrast.rightJa}</p><span>{contrast.rightZh}</span></div></div>
          <p className="learning-contrast-note"><b>差别</b>{contrast.explanationZh}</p>
        </section>)}</div>}
        {view === "examples" && <div className="learning-examples"><p>以下均为教学示例，可用来观察同一结构怎样换内容。</p>{point.examples.map((example, exampleIndex) => <section key={exampleIndex}><small>{example.labelZh || String(exampleIndex + 1).padStart(2, "0")}</small><div><p lang="ja">{example.ja}</p><span>{example.zh}</span></div></section>)}</div>}
      </div>
      <footer className="learning-point-nav"><span>读懂这一项，再选择需要的内容。</span><div>{index > 0 && <button type="button" onClick={() => selectPoint(module.points[index - 1].id)}>← 上一知识点：{module.points[index - 1].titleZh}</button>}{index < module.points.length - 1 && <button type="button" onClick={() => selectPoint(module.points[index + 1].id)}>下一知识点：{module.points[index + 1].titleZh} →</button>}</div></footer>
    </section>
    <section className="learning-recap"><h3>带走这几句</h3><ul>{module.recapZh.map(line => <li key={line}>{line}</li>)}</ul></section>
  </div>;
}
