"use client";

import { useInterviewMenu } from "./interview-menu-copy";

import { useEffect, useRef, useState } from "react";
import type { AdvisoryEvidenceRef, InterviewAdvisory } from "@/lib/interview-advisory";
import { getString, type Note } from "@/lib/notes";
import { parseAnnotations, parseSeirikou, plainSei } from "@/lib/review";
import { parseReviewFeedback, type ReviewFeedbackKind } from "@/lib/review-feedback";
import { reviewSiblingPath } from "@/lib/review-paths";
import { postJson } from "@/lib/client-api";
import { prefersReducedMotion } from "@/lib/motion";
import { appViewHref, reviewEvidenceSearch } from "./app-route";
import { ADVISORY_STAGE_LABELS } from "./interview-insights-state";
import { useInterviewAdvisorySync } from "./interview-advisory-sync";
import { useUiLocale } from "./ui-locale";
import { advisoryFailureMessage, advisoryRetryLabel } from "@/lib/advisory-recovery";

type FeedbackTarget = { type: "advisory" | "insight"; id: string; revision: string; snapshot: string };
type EvidenceProps = { notes: Note[]; onOpenEvidence: (ref: AdvisoryEvidenceRef) => void };
export function AdvisoryParagraphs({ text }: { text: string }) {
  return <>{text.split(/\n\s*\n/).filter(Boolean).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</>;
}

export function AdvisoryEvidence({ evidence, contextPaths = [], notes, onOpenEvidence }: EvidenceProps & {
  evidence: AdvisoryEvidenceRef[]; contextPaths?: string[];
}) {
  const menu = useInterviewMenu();
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
      {evidence.length > 0 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? menu("收起证据") : menu("并排看原话")}</button>}
    </div>
    {expanded && <div className="ia-evidence-grid" aria-label={menu("原话证据并排对照")}>
      {evidence.map((ref, index) => {
        const note = notes.find((item) => item.path === ref.sourcePath);
        const parsed = note ? parseSeirikou(note.content) : null;
        const block = parsed?.blocks.find((item) => item.id === ref.blockId);
        const annotations = parseAnnotations(notes.find((item) => item.path === reviewSiblingPath(ref.sourcePath, "annotation"))?.content ?? "");
        return <article key={`${ref.sourcePath}:${ref.blockId}:${index}`}>
          <h4>{getString(note?.frontmatter.company) || menu("来源整理稿")} <small>{getString(note?.frontmatter.date)} · {getString(note?.frontmatter.round)}</small></h4>
          <p className="ia-source-title">{ref.blockId} · {block?.title || menu("原文尚未载入")}</p>
          {note?.frontmatter.verbatim === false && <p className="ia-source-note">{menu("这份材料来自本人记忆重构，以下句子不是现场逐字记录。")}</p>}
          {(ref.sentenceIds.length ? ref.sentenceIds : block?.sentences.map((sentence) => sentence.id) ?? []).map((id) => {
            const sentence = block?.sentences.find((item) => item.id === id);
            return <div className="ia-source-sentence" key={id}>
              <b>{id} · {sentence?.speaker === "私" ? menu("我") : menu("面试官")}</b>
              {sentence ? <><blockquote lang="ja">{plainSei(sentence)}</blockquote>
                {sentence.gen && sentence.gen !== plainSei(sentence) && <details><summary>{menu("原始转写")}</summary><blockquote lang="ja">{sentence.gen}</blockquote></details>}
                {sentence.yaku && <p>{sentence.yaku}</p>}
                {annotations.filter((item) => item.sentenceId === id && item.mine).map((item) => <p className="ia-source-note" key={item.id}>{menu("本人补充：")}{item.mine}</p>)}
                {sentence.notes.map((note, n) => <p className="ia-source-note" key={n}>{menu("来源说明：")}{note}</p>)}
              </> : <p>{menu("这句尚未载入，可打开来源核对。")}</p>}
            </div>;
          })}
          <button type="button" onClick={() => onOpenEvidence(ref)}>{menu("打开原文与批注 →")}</button>
        </article>;
      })}
    </div>}
    {contextPaths.length > 0 && <details className="ia-context"><summary>{menu("其他参考材料 · ")}{contextPaths.length}</summary>
      <ul>{contextPaths.map((path) => <li key={path}><a href={appViewHref("library", new URLSearchParams({ note: path }))}>{path.split("/").at(-1)?.replace(/\.md$/, "")}</a></li>)}</ul>
    </details>}
  </div>;
}

export function AdvisoryFeedback({ notePath, target, notes, onSaved }: {
  notePath: string; target: FeedbackTarget; notes: Note[]; onSaved: (note?: Note) => void | Promise<void>;
}) {
  const menu = useInterviewMenu();
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
    <div><span>{menu("这条分析符合你的实际情况吗？")}</span>{(["agree", "disagree", "context"] as const).map((value) => <button key={value} type="button" aria-pressed={kind === value} disabled={busy}
      onClick={() => { setKind(kind === value ? null : value); setSaved(false); }}>{value === "agree" ? menu("同意") : value === "disagree" ? menu("不同意") : menu("补充事实")}</button>)}</div>
    {kind && <div className="ia-feedback-form"><label>{menu("你的说明")}{kind === "agree" ? menu("（选填）") : ""}<textarea value={text} onChange={(event) => setText(event.target.value)} disabled={busy} /></label>
      <button type="button" disabled={busy || (!text.trim() && kind !== "agree")} onClick={() => void submit()}>{busy ? menu("保存中…") : menu("保存反馈")}</button></div>}
    {error && <p role="alert">{error}</p>}{saved && <p role="status">{menu("已保存，后续分析会参考你的反馈。")}</p>}
    {entries.length > 0 && <details><summary>{menu("本版已有反馈 · ")}{entries.length}</summary>{entries.map((entry, i) => <p key={i}>{entry.text}</p>)}</details>}
    {previous.length > 0 && <details><summary>{menu("此前版本的反馈 · ")}{previous.length}</summary><p>{menu("这些反馈对应当时的分析，未作为对当前判断的同意。")}</p>{previous.map((entry, i) => <div key={i}><small>{entry.date} · {entry.target?.revision}</small><p>{entry.text}</p></div>)}</details>}
  </div>;
}

/**
 * 报告右栏的本页目录。长报告（观察 + 表达 + 下一步）往往三四屏，读到一半要回看「目前建议」时
 * 不必滚回顶部。点目录用 scrollIntoView 而不是改 hash：hash 变化会触发外壳的路由监听。
 */
function AdvisoryToc({ entries, rootRef }: { entries: { id: string; label: string }[]; rootRef: { current: HTMLElement | null } }) {
  const menu = useInterviewMenu();
  const { locale } = useUiLocale();
  const [current, setCurrent] = useState<string | null>(entries[0]?.id ?? null);
  const ids = entries.map((entry) => entry.id).join("|");
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const sections = ids.split("|").map((id) => root.querySelector<HTMLElement>(`#${CSS.escape(id)}`)).filter((item): item is HTMLElement => Boolean(item));
    const update = () => {
      const passed = sections.filter((section) => section.getBoundingClientRect().top < 200);
      setCurrent((passed.at(-1) ?? sections[0])?.id ?? null);
    };
    const observer = new IntersectionObserver(update, { rootMargin: "-120px 0px -55% 0px" });
    sections.forEach((section) => observer.observe(section));
    update();
    return () => observer.disconnect();
  }, [ids, rootRef]);
  if (entries.length < 2) return null;
  return <nav className="ia-report-toc" aria-label={locale === "ja" ? menu("このページの目次") : menu("本页目录")}>
    <h3>{locale === "ja" ? menu("このページの目次") : menu("本页目录")}</h3>
    <ol>{entries.map((entry) => <li key={entry.id}><a href={`#${entry.id}`} aria-current={current === entry.id ? "location" : undefined} onClick={(event) => {
      event.preventDefault();
      // 显式 smooth 会绕过 CSS 的减弱动效兜底，自己问一次（系统设置或设置里的「总是减弱」）。
      rootRef.current?.querySelector<HTMLElement>(`#${CSS.escape(entry.id)}`)?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }}>{entry.label}</a></li>)}</ol>
  </nav>;
}

export function AdvisoryReportPanel({ report, notes, notePath, onOpenEvidence, onFeedbackSaved }: EvidenceProps & {
  report: InterviewAdvisory; notePath: string; onFeedbackSaved: (note?: Note) => void | Promise<void>;
}) {
  const menu = useInterviewMenu();
  const rootRef = useRef<HTMLDivElement>(null);
  const { locale } = useUiLocale();
  const feedback = (id: string, snapshot: unknown) => <AdvisoryFeedback key={`${report.generatedAt}:${id}`} notePath={notePath} notes={notes}
    target={{ type: "advisory", id, revision: report.generatedAt, snapshot: JSON.stringify(snapshot) }} onSaved={onFeedbackSaved} />;
  const toc = [
    { id: "ia-sec-overview", label: "综合判断" },
    ...(report.observations.length > 0 ? [{ id: "ia-sec-observations", label: "值得读懂的细节" }] : []),
    ...(report.answerOptions.length > 0 ? [{ id: "ia-sec-answers", label: "可使用的表达" }] : []),
    ...(report.nextSteps.length > 0 ? [{ id: "ia-sec-next", label: "值得准备与确认的事" }] : []),
  ];
  return <div className="ia-report" ref={rootRef}><div className="ia-report-main">
    <section className="ia-recommendation ia-next-summary"><h2>{locale === "ja" ? menu("次にすること") : menu("接下来怎么做")}</h2>
      <AdvisoryParagraphs text={report.recommendationZh.split(/\n\s*\n/)[0]} />
      {report.nextSteps.length > 0 && <a href="#ia-sec-next">{locale === "ja" ? menu("準備・確認リストを見る →") : menu("查看准备与确认清单 →")}</a>}
    </section>
    <section className="ia-overview" id="ia-sec-overview"><span className="ia-eyebrow">{ADVISORY_STAGE_LABELS[report.stage] || menu("面谈")}{menu(" · 综合判断")}</span>
      <h2>{menu("这场面谈，双方谈到了哪一步")}</h2><AdvisoryParagraphs text={report.commentaryZh} />
      <div className="ia-fit"><h3>{menu("双方的匹配")}</h3><AdvisoryParagraphs text={report.fitZh} /></div>
      <details className="ia-recommendation"><summary>{locale === "ja" ? menu("準備のアドバイスを詳しく見る") : menu("更多准备建议")}</summary><AdvisoryParagraphs text={report.recommendationZh} />
        {report.changeConditionsZh && <><h4>{menu("什么情况会改变这个判断")}</h4><AdvisoryParagraphs text={report.changeConditionsZh} /></>}</details>
      <AdvisoryEvidence evidence={report.evidence} contextPaths={report.contextPaths} notes={notes} onOpenEvidence={onOpenEvidence} />
    </section>
    {report.observations.length > 0 && <section className="ia-section" id="ia-sec-observations"><header><span className="ia-eyebrow">{menu("对方原话与互动")}</span><h2>{menu("值得读懂的细节")}</h2></header>
      {report.observations.map((item) => <article className="ia-observation" key={item.id}><h3>{item.titleZh}</h3>
        <dl><div><dt>{menu("现场发生了什么")}</dt><dd><AdvisoryParagraphs text={item.observationZh} /></dd></div>
          <div><dt>{menu("怎样理解")}</dt><dd><AdvisoryParagraphs text={item.interpretationZh} /></dd></div>
          {item.alternativeZh && <div><dt>{menu("其他解释与未知")}</dt><dd><AdvisoryParagraphs text={item.alternativeZh} /></dd></div>}
          <div><dt>{menu("对你有什么用")}</dt><dd><AdvisoryParagraphs text={item.implicationZh} /></dd></div></dl>
        <AdvisoryEvidence {...item} notes={notes} onOpenEvidence={onOpenEvidence} />{feedback(item.id, item)}
      </article>)}
    </section>}
    {report.answerOptions.length > 0 && <section className="ia-section" id="ia-sec-answers"><header><span className="ia-eyebrow">{menu("未来可以怎么说")}</span><h2>{menu("可使用的表达")}</h2></header>
      {report.answerOptions.map((item) => <article className="ia-answer" key={item.id}><h3>{item.titleZh}<small>{item.scope === "company" ? menu("本公司适用") : menu("可用于类似面谈")}</small></h3>
        <p>{item.situationZh}</p><AdvisoryParagraphs text={item.whyZh} /><blockquote lang="ja">{item.answerJa}</blockquote>
        <AdvisoryEvidence {...item} notes={notes} onOpenEvidence={onOpenEvidence} />{feedback(item.id, item)}</article>)}
    </section>}
    {report.nextSteps.length > 0 && <section className="ia-section" id="ia-sec-next"><header><span className="ia-eyebrow">{menu("下一步")}</span><h2>{menu("值得准备与确认的事")}</h2></header>
      {report.nextSteps.map((item) => <article className="ia-next" key={item.id}><h3>{item.titleZh}</h3><AdvisoryParagraphs text={item.detailZh} />
        <p className="ia-trigger">{menu("适用时机：")}{item.triggerZh}</p><AdvisoryEvidence {...item} notes={notes} onOpenEvidence={onOpenEvidence} />{feedback(item.id, item)}</article>)}
    </section>}
    <p className="ia-report-meta">{menu("更新于 ")}{report.generatedAt.replace("T", " ").slice(0, 16)}</p>
  </div><AdvisoryToc entries={toc} rootRef={rootRef} /></div>;
}

export default function InterviewAdvisory({ report: initialReport, notes, notePath, onOpenEvidence, onVaultChanged, onNoteWritten, onOpenInsights }: EvidenceProps & {
  report?: InterviewAdvisory; notePath: string; onVaultChanged: () => void | Promise<void>; onNoteWritten?: (note: Note) => void; onOpenInsights: () => void;
}) {
  const menu = useInterviewMenu();
  const { locale } = useUiLocale();
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
    <div className="ia-actions"><p>{busy || sync.busy || sync.state?.active ? menu("正在更新，已有内容仍可阅读。") : loaded?.status === "stale" ? menu("原文有更新，下面的评价尚未更新。") : loaded?.status === "blocked" ? menu("原文还有需要确认的地方，可在原文阅读中查看。") : report ? menu("先看这次机会和下一步，再按需要查看原话。") : menu("还没有这场面谈的解读，可以先阅读原文。")}</p>
      <button type="button" onClick={() => onOpenInsights()}>{locale === "ja" ? menu("企業比較を開く →") : menu("进入公司对比 →")}</button>
      <button type="button" disabled={busy || sync.busy || loaded?.status === "blocked"} onClick={() => void generate()}>{busy ? menu("更新中…") : failure ? advisoryRetryLabel(failure) : report ? menu("更新解读") : menu("获取面谈解读")}</button>
    </div>
    {failure && <div className="ia-error" role="alert"><p>{advisoryFailureMessage(failure)}</p><details><summary>{menu("查看失败详情")}</summary><p>{failure}</p></details></div>}
    {report ? <AdvisoryReportPanel report={report} notes={notes} notePath={notePath} onOpenEvidence={onOpenEvidence} onFeedbackSaved={async (note) => {
      if (note && onNoteWritten) onNoteWritten(note); else await onVaultChanged();
      void sync.synchronize();
    }} /> : <section className="ia-empty"><h2>{menu("从双方的对话里，看清这次机会")}</h2><p>{menu("这里将补充对方在意的事情、双方匹配、仍待确认的条件，以及下一次可使用的建议。原有回答质量复盘和原文批注继续保留在各自入口。")}</p></section>}
  </div>;
}
