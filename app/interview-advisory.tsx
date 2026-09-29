"use client";

import { useEffect, useState } from "react";
import type { AdvisoryEvidenceRef, InterviewAdvisory } from "@/lib/interview-advisory";
import { getString, type Note } from "@/lib/notes";
import { parseAnnotations, parseSeirikou, plainSei } from "@/lib/review";
import { parseReviewFeedback, type ReviewFeedbackKind } from "@/lib/review-feedback";
import { reviewSiblingPath } from "@/lib/review-paths";
import { postJson } from "@/lib/client-api";
import { appViewHref, reviewEvidenceSearch } from "./app-route";
import { ADVISORY_STAGE_LABELS } from "./interview-insights-state";
import { useInterviewAdvisorySync } from "./interview-advisory-sync";

type FeedbackTarget = { type: "advisory" | "insight"; id: string; revision: string; snapshot: string };
type EvidenceProps = { notes: Note[]; onOpenEvidence: (ref: AdvisoryEvidenceRef) => void };
export function AdvisoryParagraphs({ text }: { text: string }) {
  return <>{text.split(/\n\s*\n/).filter(Boolean).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</>;
}

export function AdvisoryEvidence({ evidence, contextPaths = [], notes, onOpenEvidence }: EvidenceProps & {
  evidence: AdvisoryEvidenceRef[]; contextPaths?: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (!evidence.length && !contextPaths.length) return null;
  return <div className="ia-evidence">
    <div className="ia-evidence-links">
      {evidence.map((ref, index) => {
        const note = notes.find((item) => item.path === ref.sourcePath);
        const label = [getString(note?.frontmatter.company), getString(note?.frontmatter.date), ref.blockId, ref.sentenceIds.join("・")].filter(Boolean).join(" · ");
        return <a key={`${ref.sourcePath}:${ref.blockId}:${index}`} href={appViewHref("review", reviewEvidenceSearch(ref))}
          onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpenEvidence(ref); } }}
          title={ref.sourcePath}>{label || ref.sourcePath} ↗</a>;
      })}
      {evidence.length > 0 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起证据" : "并排看原话"}</button>}
    </div>
    {expanded && <div className="ia-evidence-grid" aria-label="原话证据并排对照">
      {evidence.map((ref, index) => {
        const note = notes.find((item) => item.path === ref.sourcePath);
        const parsed = note ? parseSeirikou(note.content) : null;
        const block = parsed?.blocks.find((item) => item.id === ref.blockId);
        const annotations = parseAnnotations(notes.find((item) => item.path === reviewSiblingPath(ref.sourcePath, "annotation"))?.content ?? "");
        return <article key={`${ref.sourcePath}:${ref.blockId}:${index}`}>
          <h4>{getString(note?.frontmatter.company) || "来源整理稿"} <small>{getString(note?.frontmatter.date)} · {getString(note?.frontmatter.round)}</small></h4>
          <p className="ia-source-title">{ref.blockId} · {block?.title || "原文尚未载入"}</p>
          {note?.frontmatter.verbatim === false && <p className="ia-source-note">这份材料来自本人记忆重构，以下句子不是现场逐字记录。</p>}
          {(ref.sentenceIds.length ? ref.sentenceIds : block?.sentences.map((sentence) => sentence.id) ?? []).map((id) => {
            const sentence = block?.sentences.find((item) => item.id === id);
            return <div className="ia-source-sentence" key={id}>
              <b>{id} · {sentence?.speaker === "私" ? "我" : "面试官"}</b>
              {sentence ? <><blockquote lang="ja">{plainSei(sentence)}</blockquote>
                {sentence.gen && sentence.gen !== plainSei(sentence) && <details><summary>原始转写</summary><blockquote lang="ja">{sentence.gen}</blockquote></details>}
                {sentence.yaku && <p>{sentence.yaku}</p>}
                {annotations.filter((item) => item.sentenceId === id && item.mine).map((item) => <p className="ia-source-note" key={item.id}>本人补充：{item.mine}</p>)}
                {sentence.notes.map((note, n) => <p className="ia-source-note" key={n}>来源说明：{note}</p>)}
              </> : <p>这句尚未载入，可打开来源核对。</p>}
            </div>;
          })}
          <button type="button" onClick={() => onOpenEvidence(ref)}>打开原文与批注 →</button>
        </article>;
      })}
    </div>}
    {contextPaths.length > 0 && <details className="ia-context"><summary>其他参考材料 · {contextPaths.length}</summary>
      <ul>{contextPaths.map((path) => <li key={path}><a href={appViewHref("library", new URLSearchParams({ note: path }))}>{path.split("/").at(-1)?.replace(/\.md$/, "")}</a></li>)}</ul>
    </details>}
  </div>;
}

export function AdvisoryFeedback({ notePath, target, notes, onSaved }: {
  notePath: string; target: FeedbackTarget; notes: Note[]; onSaved: (note?: Note) => void | Promise<void>;
}) {
  const [kind, setKind] = useState<ReviewFeedbackKind | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const feedbackPath = target.type === "insight" ? "20_求職/_素材/面接横断_顧問批注.md" : reviewSiblingPath(notePath, "answerFeedback");
  const history = notes.filter((note) => note.path === feedbackPath)
    .flatMap((note) => parseReviewFeedback(note.content))
    .filter((entry) => entry.target?.type === target.type && entry.target.id === target.id);
  const entries = history.filter((entry) => entry.target?.revision === target.revision && entry.target.snapshot === target.snapshot);
  const previous = history.filter((entry) => !entries.includes(entry));
  const submit = async () => {
    if (!kind || busy || (!text.trim() && kind !== "agree")) return;
    setBusy(true); setError("");
    try {
      const payload = await postJson<{ ok?: boolean; error?: string; note?: Note }>("/api/review/feedback", { notePath, target, kind, text: text.trim() || "同意这条分析。" });
      await onSaved(payload.note);
      setText(""); setKind(null); setSaved(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "反馈保存失败"); }
    finally { setBusy(false); }
  };
  return <div className="ia-feedback">
    <div><span>这条分析符合你的实际情况吗？</span>{(["agree", "disagree", "context"] as const).map((value) => <button key={value} type="button" aria-pressed={kind === value} disabled={busy}
      onClick={() => { setKind(kind === value ? null : value); setSaved(false); }}>{value === "agree" ? "同意" : value === "disagree" ? "不同意" : "补充事实"}</button>)}</div>
    {kind && <div className="ia-feedback-form"><label>你的说明{kind === "agree" ? "（选填）" : ""}<textarea value={text} onChange={(event) => setText(event.target.value)} disabled={busy} /></label>
      <button type="button" disabled={busy || (!text.trim() && kind !== "agree")} onClick={() => void submit()}>{busy ? "保存中…" : "保存反馈"}</button></div>}
    {error && <p role="alert">{error}</p>}{saved && <p role="status">已保存，后续分析会参考你的反馈。</p>}
    {entries.length > 0 && <details><summary>本版已有反馈 · {entries.length}</summary>{entries.map((entry, i) => <p key={i}>{entry.text}</p>)}</details>}
    {previous.length > 0 && <details><summary>此前版本的反馈 · {previous.length}</summary><p>这些反馈对应当时的分析，未作为对当前判断的同意。</p>{previous.map((entry, i) => <div key={i}><small>{entry.date} · {entry.target?.revision}</small><p>{entry.text}</p></div>)}</details>}
  </div>;
}

export function AdvisoryReportPanel({ report, notes, notePath, onOpenEvidence, onFeedbackSaved }: EvidenceProps & {
  report: InterviewAdvisory; notePath: string; onFeedbackSaved: (note?: Note) => void | Promise<void>;
}) {
  const feedback = (id: string, snapshot: unknown) => <AdvisoryFeedback key={`${report.generatedAt}:${id}`} notePath={notePath} notes={notes}
    target={{ type: "advisory", id, revision: report.generatedAt, snapshot: JSON.stringify(snapshot) }} onSaved={onFeedbackSaved} />;
  return <div className="ia-report">
    <section className="ia-overview"><span className="ia-eyebrow">{ADVISORY_STAGE_LABELS[report.stage] || "面谈"} · 综合判断</span>
      <h2>这场面谈，双方谈到了哪一步</h2><AdvisoryParagraphs text={report.commentaryZh} />
      <div className="ia-fit"><h3>双方的匹配</h3><AdvisoryParagraphs text={report.fitZh} /></div>
      <div className="ia-recommendation"><h3>目前建议</h3><AdvisoryParagraphs text={report.recommendationZh} />
        {report.changeConditionsZh && <><h4>什么情况会改变这个判断</h4><AdvisoryParagraphs text={report.changeConditionsZh} /></>}</div>
      <AdvisoryEvidence evidence={report.evidence} contextPaths={report.contextPaths} notes={notes} onOpenEvidence={onOpenEvidence} />
    </section>
    {report.observations.length > 0 && <section className="ia-section"><header><span className="ia-eyebrow">对方原话与互动</span><h2>值得读懂的细节</h2></header>
      {report.observations.map((item) => <article className="ia-observation" key={item.id}><h3>{item.titleZh}</h3>
        <dl><div><dt>现场发生了什么</dt><dd><AdvisoryParagraphs text={item.observationZh} /></dd></div>
          <div><dt>怎样理解</dt><dd><AdvisoryParagraphs text={item.interpretationZh} /></dd></div>
          {item.alternativeZh && <div><dt>其他解释与未知</dt><dd><AdvisoryParagraphs text={item.alternativeZh} /></dd></div>}
          <div><dt>对你有什么用</dt><dd><AdvisoryParagraphs text={item.implicationZh} /></dd></div></dl>
        <AdvisoryEvidence {...item} notes={notes} onOpenEvidence={onOpenEvidence} />{feedback(item.id, item)}
      </article>)}
    </section>}
    {report.answerOptions.length > 0 && <section className="ia-section"><header><span className="ia-eyebrow">未来可以怎么说</span><h2>可使用的表达</h2></header>
      {report.answerOptions.map((item) => <article className="ia-answer" key={item.id}><h3>{item.titleZh}<small>{item.scope === "company" ? "本公司适用" : "可用于类似面谈"}</small></h3>
        <p>{item.situationZh}</p><AdvisoryParagraphs text={item.whyZh} /><blockquote lang="ja">{item.answerJa}</blockquote>
        <AdvisoryEvidence {...item} notes={notes} onOpenEvidence={onOpenEvidence} />{feedback(item.id, item)}</article>)}
    </section>}
    {report.nextSteps.length > 0 && <section className="ia-section"><header><span className="ia-eyebrow">下一步</span><h2>值得准备与确认的事</h2></header>
      {report.nextSteps.map((item) => <article className="ia-next" key={item.id}><h3>{item.titleZh}</h3><AdvisoryParagraphs text={item.detailZh} />
        <p className="ia-trigger">适用时机：{item.triggerZh}</p><AdvisoryEvidence {...item} notes={notes} onOpenEvidence={onOpenEvidence} />{feedback(item.id, item)}</article>)}
    </section>}
    <p className="ia-report-meta">分析更新于 {report.generatedAt.replace("T", " ").slice(0, 16)} · {report.model}</p>
  </div>;
}

export default function InterviewAdvisory({ report: initialReport, notes, notePath, onOpenEvidence, onVaultChanged, onNoteWritten, onOpenInsights }: EvidenceProps & {
  report?: InterviewAdvisory; notePath: string; onVaultChanged: () => void | Promise<void>; onNoteWritten?: (note: Note) => void; onOpenInsights: () => void;
}) {
  const sync = useInterviewAdvisorySync(notes);
  const [loaded, setLoaded] = useState<{ report: InterviewAdvisory | null; status: string; reason?: string; lastError?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/review/advisory?${new URLSearchParams({ notePath })}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json() as { report: InterviewAdvisory | null; status: string; reason?: string; lastError?: string; error?: string }; if (!response.ok) throw new Error(payload.error || "顾问分析读取失败"); return payload; })
      .then((payload) => { setLoaded(payload); setError(""); }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "读取失败"); });
    return () => controller.abort();
  }, [notePath, sync.revision, initialReport?.generatedAt]);
  const report = loaded?.report ?? initialReport;
  const generate = async () => {
    setBusy(true); setError("");
    try {
      const payload = await postJson<{ ok?: boolean; error?: string; report?: InterviewAdvisory }>("/api/review/advisory", { notePath, force: true }, { timeoutMs: 600_000 });
      if (payload.report) setLoaded({ report: payload.report, status: "ready" });
      await onVaultChanged();
      void sync.synchronize();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "生成失败"); }
    finally { setBusy(false); }
  };
  const failure = error || loaded?.lastError || sync.error || sync.state?.error;
  return <div className="ia-view">
    <div className="ia-actions"><p>{busy || sync.busy || sync.state?.active ? "正在更新分析，已有内容仍可阅读。" : loaded?.status === "stale" ? "材料有更新，下面保留上一版分析。" : loaded?.status === "blocked" ? loaded.reason || "完成原文裁定后可生成分析。" : report ? "结合企业原话、你的意向和后续条件阅读这场面谈。" : "顾问分析会在证据裁定完成后自动补齐。"}</p>
      <button type="button" onClick={onOpenInsights}>跨面试横向对照 →</button>
      <button type="button" disabled={busy || sync.busy || loaded?.status === "blocked"} onClick={() => void generate()}>{busy ? "分析中…" : failure ? "重试分析" : report ? "重新分析" : "生成顾问分析"}</button>
    </div>
    {failure && <p className="ia-error" role="alert">{failure}</p>}
    {report ? <AdvisoryReportPanel report={report} notes={notes} notePath={notePath} onOpenEvidence={onOpenEvidence} onFeedbackSaved={async (note) => {
      if (note && onNoteWritten) onNoteWritten(note); else await onVaultChanged();
      void sync.synchronize();
    }} /> : <section className="ia-empty"><h2>从双方的对话里，看清这次机会</h2><p>这里将补充对方在意的事情、双方匹配、仍待确认的条件，以及下一次可使用的建议。原有回答质量复盘和原文批注继续保留在各自入口。</p></section>}
  </div>;
}
