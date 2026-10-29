"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { buildCompanyOverviews, resolveCompanyReference, type CompanyOverview } from "@/lib/company-overview";
import { REVIEW_COMPANY_PARAM, reviewCompanyHref, reviewCompanyMatch } from "@/lib/review-company";
import type { Note } from "@/lib/notes";
import CompanyOverviewContent from "./company-overview";
import MarkdownDocument from "./markdown-document";
import { useUiLocale } from "./ui-locale";
import { useDialogFocus } from "./use-dialog-focus";
import { notifyUrlChange, readUrlParam, URL_CHANGE_EVENT } from "./use-url-state";
import { useInterviewOverlayNotes } from "./use-interview-overlay-notes";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(URL_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(URL_CHANGE_EVENT, listener);
  };
}
const readPanel = () => readUrlParam(REVIEW_COMPANY_PARAM);
const serverPanel = () => null;
const readHref = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

export default function ReviewCompanyAnalysis({ notes, source, sourcePath = source?.path ?? "", contextPath, company, filter = "all", pattern = null, companyContexts, revision }: {
  notes: Note[]; source?: Note; sourcePath?: string; contextPath?: string | null; company: string; filter?: string; pattern?: string | null;
  companyContexts?: CompanyOverview[];
  revision?: string;
}) {
  const { locale } = useUiLocale();
  const ja = locale === "ja";
  const match = useMemo(() => {
    const contexts = companyContexts ?? buildCompanyOverviews(notes);
    if (source) return reviewCompanyMatch(notes, source, company, contexts);
    const context = contextPath ? contexts.find((item) => item.note.path === contextPath) ?? null : null;
    return { context, status: context ? "ready" as const : "missing" as const };
  }, [notes, source, company, contextPath, companyContexts]);
  const selectedPath = useSyncExternalStore(subscribe, readPanel, serverPanel);
  const defaultHref = `/interview/review?review=${encodeURIComponent(sourcePath)}`;
  const href = useSyncExternalStore(subscribe, readHref, () => defaultHref);
  const context = match.context;
  const open = selectedPath !== null;
  const close = () => {
    if (window.history.state?.__echoReviewCompanySource === sourcePath) window.history.back();
    else {
      window.history.replaceState(window.history.state, "", reviewCompanyHref(window.location.href, null));
      notifyUrlChange();
    }
  };
  const unavailable = match.status === "ambiguous"
    ? (ja ? "案件の関連付けを要確認" : "案件关联待确认")
    : match.status === "invalid" ? (ja ? "関連ノートを要確認" : "关联笔记待确认")
      : (ja ? "会社資料は未関連付け" : "公司资料未关联");
  return <>
    {context ? <a className="rv-company-entry" href={reviewCompanyHref(
      href,
      context.note.path,
      { filter, pattern },
    )} onClick={(event) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      window.history.pushState({ ...window.history.state, __echoReviewCompanySource: sourcePath }, "",
        reviewCompanyHref(window.location.href, context.note.path));
      notifyUrlChange();
    }}>{ja ? "会社分析" : "公司分析"} ↗</a>
      : <span className="rv-company-unavailable" data-company-status={match.status}>{unavailable}</span>}
    {open && createPortal(<CompanyPanel company={company} close={close}>
      {context && context.note.path === selectedPath ? <AnalysisContent notes={notes} context={context} revision={revision} />
        : <p role="status">{ja ? "この振り返りに対応する会社資料を特定できません。関連ノートをご確認ください。" : "无法确定这场复盘对应的公司资料，请核对关联笔记。"}</p>}
    </CompanyPanel>, document.querySelector(".app-shell") ?? document.body)}
  </>;
}

function AnalysisContent({ notes, context, revision }: { notes: Note[]; context: NonNullable<ReturnType<typeof reviewCompanyMatch>["context"]>; revision?: string }) {
  const { locale } = useUiLocale();
  const [note, setNote] = useState<Note | null>(null);
  const [missing, setMissing] = useState(false);
  const [target, setTarget] = useState("");
  const remote = useInterviewOverlayNotes({ asset: revision && target ? { note: target, label: target, hint: "" } : null, revision, seed: notes });
  const shownNote = revision ? remote.sharedNote : note;
  const hasSource = revision ? Boolean(target) : Boolean(note);
  const openWiki = (target: string) => {
    if (revision) { setTarget(target); return; }
    const resolved = resolveCompanyReference(notes, target);
    setMissing(!resolved);
    if (resolved) setNote(resolved);
  };
  // 资料在同一个焦点边界内阅读，避免在分析层下面打开被隔离的抽屉。
  return <>
    {hasSource ? <><button type="button" autoFocus onClick={() => { setNote(null); setTarget(""); }}>{locale === "ja" ? "← 会社分析に戻る" : "← 返回公司分析"}</button>
      {shownNote ? <MarkdownDocument content={shownNote.content} onWikiLink={openWiki} reading /> : remote.error ? <p role="alert">{locale === "ja" ? "参照資料を読み込めませんでした。" : "引用资料读取失败。"}<button type="button" onClick={() => void remote.retry()}>{locale === "ja" ? "再試行" : "重试"}</button></p> : <p role="status">{locale === "ja" ? "参照資料を読み込み中…" : "正在读取引用资料…"}</p>}</>
      : <CompanyOverviewContent context={context} onOpenWiki={openWiki} />}
    {missing && <p role="status">{locale === "ja" ? "参照ノートが見つかりません。" : "引用笔记不存在或无法唯一确定。"}</p>}
  </>;
}

function CompanyPanel({ company, close, children }: { company: string; close: () => void; children: React.ReactNode }) {
  const { locale } = useUiLocale();
  const ja = locale === "ja";
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(ref, true);
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = before; };
  }, []);
  useEffect(() => {
    // 研究笔记返回时焦点节点会被卸载；Escape 仍应能关闭当前分析层。
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [close]);
  return <div className="rv-company-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="rv-company-panel" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><button type="button" onClick={close}>{ja ? "← 振り返りに戻る" : "← 返回复盘"}</button>
        <h2 id={titleId}>{company} · {ja ? "会社分析" : "公司分析"}</h2></header>
      <div className="rv-company-body">{children}</div>
    </div>
  </div>;
}
