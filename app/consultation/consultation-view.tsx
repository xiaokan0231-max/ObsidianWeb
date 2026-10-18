"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ConsultationCatalog, ConsultationCompany, ConsultationInterview, ConsultationSessionSummary, ConsultationTranscript } from "@/lib/consultation-library";
import { UiLocaleProvider } from "../ui-locale";
import "./consultation.css";

type OutcomeFilter = "all" | "rejected" | "waiting" | "positive" | "unknown" | "not-applicable";
type TranscriptView = "readable" | "raw";
type ProgressFilter = "all" | "final" | "passed";
type LibraryRoute = { tab: "companies" | "sessions"; query: string; outcome: OutcomeFilter; progress: ProgressFilter; companyId: string; sessionId: string; view: TranscriptView };
const DEFAULT_ROUTE: LibraryRoute = { tab: "companies", query: "", outcome: "all", progress: "all", companyId: "", sessionId: "", view: "readable" };
const FILTERS: { value: OutcomeFilter; label: string }[] = [
  { value: "all", label: "すべての結果" }, { value: "rejected", label: "不採用" }, { value: "waiting", label: "進行中" },
  { value: "positive", label: "内定・通過" }, { value: "unknown", label: "未確認" },
];
const PROGRESS_FILTERS: { value: ProgressFilter; label: string }[] = [
  { value: "all", label: "すべての企業" },
  { value: "final", label: "最終面接に進んだ企業" },
  { value: "passed", label: "面接を通過した企業" },
];
const OUTCOMES: Record<ConsultationSessionSummary["outcomeKind"], string> = {
  offer: "内定", passed: "通過", rejected: "不採用", waiting: "進行中", unknown: "未確認", "not-applicable": "対象外",
};

async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!response.ok) throw new Error((body as { error?: string }).error || "資料を読み込めませんでした。");
  return body as T;
}
export function parseConsultationLibraryRoute(search: string): LibraryRoute {
  const params = new URLSearchParams(search);
  const outcome = params.get("outcome");
  return {
    tab: params.get("tab") === "sessions" ? "sessions" : "companies", query: params.get("q") || "",
    outcome: FILTERS.some(filter => filter.value === outcome) ? outcome as OutcomeFilter : "all",
    progress: PROGRESS_FILTERS.some(filter => filter.value === params.get("progress")) ? params.get("progress") as ProgressFilter : "all",
    companyId: params.get("company") || "", sessionId: params.get("session") || "", view: params.get("view") === "raw" ? "raw" : "readable",
  };
}
export function consultationLibraryHref(route: LibraryRoute) {
  const params = new URLSearchParams();
  if (route.tab !== "companies") params.set("tab", route.tab);
  if (route.query) params.set("q", route.query);
  if (route.outcome !== "all") params.set("outcome", route.outcome);
  if (route.progress !== "all") params.set("progress", route.progress);
  if (route.companyId) params.set("company", route.companyId);
  if (route.sessionId) params.set("session", route.sessionId);
  if (route.view === "raw") params.set("view", route.view);
  return `/consultation${params.size ? `?${params}` : ""}`;
}
function exportHref(sessionId: string, view: TranscriptView) {
  return `/api/consultation/export?${new URLSearchParams({ session: sessionId, view })}`;
}
function dateLabel(date: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : "日付未確認";
}
function applicationKind(status: string): ConsultationSessionSummary["outcomeKind"] {
  if (/^不採用/.test(status)) return "rejected";
  if (/^内定/.test(status)) return "offer";
  if (/^書類通過/.test(status)) return "passed";
  if (/^(応募済|面接中)/.test(status)) return "waiting";
  if (/^未応募/.test(status)) return "not-applicable";
  return "unknown";
}
function matchesOutcome(kind: ConsultationSessionSummary["outcomeKind"], filter: OutcomeFilter) {
  return filter === "all" || (filter === "positive" ? kind === "offer" || kind === "passed" : kind === filter);
}
function hasRecord(session: ConsultationSessionSummary) {
  return session.hasRaw || session.hasReadable;
}
function companyHistory(company: ConsultationCompany, sessions: ConsultationSessionSummary[]): ConsultationInterview[] {
  const history = company.interviews ?? sessions.filter(session => session.companyId === company.id && hasRecord(session)).map(session => ({
    id: session.id, date: session.date, round: session.round, stage: session.stage || "", outcome: session.outcome,
    outcomeKind: session.outcomeKind, sessionId: session.id, evidenceKind: "transcript" as const,
  }));
  return [...history].sort((a, b) => b.date.localeCompare(a.date));
}
function companyProgress(company: ConsultationCompany, sessions: ConsultationSessionSummary[]) {
  const history = companyHistory(company, sessions);
  return {
    final: company.reachedFinal ?? history.some(interview => interview.stage === "final"),
    passed: company.hasPassedInterview ?? history.some(interview => interview.outcomeKind === "passed" || interview.outcomeKind === "offer"),
  };
}
/** 公司当前结果和历史面试进展是两个维度；后来的落选不能抹掉曾经通过的轮次。 */
export function filterConsultationCompanies(companies: ConsultationCompany[], sessions: ConsultationSessionSummary[], query: string, outcome: OutcomeFilter, progress: ProgressFilter = "all") {
  const normalized = query.trim().toLocaleLowerCase();
  return companies.filter(company => {
    const history = companyHistory(company, sessions);
    if (normalized && !`${company.company} ${company.applications.map(application => application.position).join(" ")}`.toLocaleLowerCase().includes(normalized)) return false;
    if (progress !== "all" && !companyProgress(company, sessions)[progress]) return false;
    if (outcome === "all") return true;
    const kinds = company.applications.length
      ? company.applications.map(application => applicationKind(application.status))
      : [history[0]?.outcomeKind ?? "unknown"];
    return kinds.some(kind => matchesOutcome(kind, outcome));
  });
}
/** 记录页先按公司进展选公司，再按本场结果选轮次，避免把两类结果混成一次筛选。 */
export function filterConsultationSessions(companies: ConsultationCompany[], sessions: ConsultationSessionSummary[], query: string, outcome: OutcomeFilter, progress: ProgressFilter = "all", companyId = "") {
  const eligible = new Set(filterConsultationCompanies(companies, sessions, query, "all", progress).map(company => company.id));
  return sessions.filter(session => hasRecord(session) && eligible.has(session.companyId)
    && (!companyId || session.companyId === companyId) && matchesOutcome(session.outcomeKind, outcome));
}
function stageLabel(session: { stage?: string; round: string }) {
  if (session.stage === "final") return "最終面接";
  if (session.stage?.startsWith("round-")) {
    const numeral = ["一", "二", "三", "四", "五", "六"][Number(session.stage.slice(6)) - 1];
    if (numeral) return `${numeral}次面接`;
  }
  return session.round || "面接・面談";
}
function Badge({ kind, children }: { kind: ConsultationSessionSummary["outcomeKind"]; children?: React.ReactNode }) {
  return <span className={`consultation-badge consultation-badge-${kind}`}>{children || OUTCOMES[kind]}</span>;
}
function BookIcon({ small = false }: { small?: boolean }) {
  return <svg width={small ? 16 : 23} height={small ? 16 : 23} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5.5C9 3.5 5 3.5 2.5 4.5v15c2.5-1 6.5-1 9.5 1 3-2 7-2 9.5-1v-15c-2.5-1-6.5-1-9.5 1Zm0 0v15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function ConsultationView() {
  const [catalog, setCatalog] = useState<ConsultationCatalog | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    request<ConsultationCatalog>("/api/consultation", controller.signal).then(setCatalog).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "資料を読み込めませんでした。"); });
    return () => controller.abort();
  }, [retry]);
  return <UiLocaleProvider initialLocale="ja">{catalog ? <ConsultationLibrary initial={catalog} /> : <div className="consultation-shell" lang="ja"><LibraryHeader /><main className="consultation-loading"><BookIcon /><h1>面接相談の資料</h1><p role={error ? "alert" : "status"}>{error || "企業一覧と面接記録を読み込んでいます…"}</p>{error && <button className="consultation-primary" onClick={() => { setError(""); setRetry(value => value + 1); }}>もう一度読み込む</button>}</main></div>}</UiLocaleProvider>;
}

function LibraryHeader() {
  return <header className="consultation-header">
    <Link className="consultation-brand" href="/consultation" aria-label="面接相談の資料のトップ"><span className="consultation-brand-mark"><BookIcon /></span><span><strong>Obsidian Memory Atlas</strong><small>面接相談の資料</small></span></Link>
    <div className="consultation-header-actions">
      <div className="consultation-header-note"><span className="consultation-readonly-dot" />閲覧専用<span className="consultation-header-divider" />日本語</div>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 独立阅读入口返回主站时需要完整加载首页。 */}
      <a className="consultation-home-link" href="/">← ホームに戻る</a>
    </div>
  </header>;
}

export function ConsultationLibrary({ initial }: { initial: ConsultationCatalog }) {
  const [route, setRoute] = useState<LibraryRoute>(DEFAULT_ROUTE);
  const [detail, setDetail] = useState<{ id: string; data?: ConsultationTranscript; error?: string }>({ id: "" });
  const [detailRetry, setDetailRetry] = useState(0);
  const cache = useRef(new Map<string, ConsultationTranscript>());
  const listScroll = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const lastSession = useRef("");
  const readerOpen = Boolean(route.sessionId);
  useEffect(() => {
    const sync = () => {
      if (!lastSession.current) listPosition.current = Number(window.history.state?.consultationListScroll) || 0;
      setRoute(parseConsultationLibraryRoute(window.location.search));
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    if (!route.sessionId) {
      window.requestAnimationFrame(() => {
        if (listScroll.current) listScroll.current.scrollTop = listPosition.current;
        if (lastSession.current) document.getElementById(`session-${lastSession.current}`)?.focus({ preventScroll: true });
      });
      return;
    }
    const sessionId = route.sessionId;
    const cached = cache.current.get(sessionId);
    if (cached) { setDetail({ id: sessionId, data: cached }); return; }
    const controller = new AbortController();
    setDetail({ id: sessionId });
    request<ConsultationTranscript>(`/api/consultation?${new URLSearchParams({ session: sessionId })}`, controller.signal).then(data => {
      cache.current.set(sessionId, data); setDetail({ id: sessionId, data });
    }).catch(error => { if (!controller.signal.aborted) setDetail({ id: sessionId, error: error instanceof Error ? error.message : "面接記録を読み込めませんでした。" }); });
    return () => controller.abort();
  }, [route.sessionId, detailRetry]);
  function navigate(patch: Partial<LibraryRoute>, replace = false) {
    const next = { ...route, ...patch };
    if (!route.sessionId && next.sessionId) listPosition.current = listScroll.current?.scrollTop || 0;
    const state = next.sessionId && !route.sessionId ? { consultationFromLibrary: true, consultationListScroll: listPosition.current } : window.history.state;
    window.history[replace ? "replaceState" : "pushState"](state, "", consultationLibraryHref(next));
    setRoute(next);
  }
  function closeReader() {
    if (window.history.state?.consultationFromLibrary) window.history.back();
    else navigate({ sessionId: "" }, true);
  }
  function openSession(session: ConsultationSessionSummary) {
    lastSession.current = session.id;
    navigate({ sessionId: session.id, view: session.hasReadable ? "readable" : "raw" });
  }
  const query = route.query.trim().toLocaleLowerCase();
  const companies = useMemo(() => [...initial.companies].sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.company.localeCompare(b.company, "ja")), [initial.companies]);
  const sessions = useMemo(() => initial.sessions.filter(hasRecord).sort((a, b) => b.date.localeCompare(a.date) || a.company.localeCompare(b.company, "ja")), [initial.sessions]);
  const manuscriptCompanyCount = new Set(sessions.map(session => session.companyId)).size;
  const selectedCompany = initial.companies.find(company => company.id === route.companyId);
  const visibleCompanies = filterConsultationCompanies(companies, sessions, query, route.outcome, route.progress);
  const visibleSessions = filterConsultationSessions(companies, sessions, query, route.outcome, route.progress, route.companyId);
  const hasFilters = Boolean(route.query || route.outcome !== "all" || route.progress !== "all" || route.companyId);
  const selectedDetail = detail.id === route.sessionId ? detail : null;
  return <div className={`consultation-shell${readerOpen ? " consultation-reader-open" : ""}`} lang="ja">
    <LibraryHeader />
    <div className="consultation-library-scroll" ref={listScroll} hidden={readerOpen}>
      <main className="consultation-library">
        <section className="consultation-intro"><div><p className="consultation-eyebrow">先生との相談に向けて</p><h1>面接・面談の企業一覧と原稿</h1><p className="consultation-lead">面接・面談の履歴と、読める原稿を分けて表示しています。<br />原稿未登録の企業も、履歴と結果を確認できます。</p></div><div className="consultation-guide" aria-label="資料の読み方"><h2>資料の読み方</h2><ol><li><span>1</span><div><strong>面接・面談した企業を見る</strong><p>職種ごとの現在の状況</p></div></li><li><span>2</span><div><strong>読める原稿を開く</strong><p>進んだ段階・各回の結果から</p></div></li><li><span>3</span><div><strong>必要なら Word で保存</strong><p>一覧・原稿をダウンロード</p></div></li></ol></div></section>
        <section className="consultation-coverage" aria-label="資料の収録範囲"><div><span>面接・面談した企業</span><strong>{companies.length}<small>社</small></strong></div><div><span>原稿のある企業</span><strong>{manuscriptCompanyCount}<small>社</small></strong></div><div><span>読める原稿</span><strong>{sessions.length}<small>件</small></strong></div><p>現在の記録で確認できる範囲です。<br />すべての面接履歴を網羅した件数ではありません。</p></section>
        <section className="consultation-materials" aria-label="相談資料">
          <div className="consultation-materials-top"><div className="consultation-tabs" role="tablist" aria-label="資料の種類"><button role="tab" id="companies-tab" aria-selected={route.tab === "companies"} aria-controls="companies-panel" onClick={() => navigate({ tab: "companies", companyId: "" })}>面接・面談した企業<span>{companies.length}</span></button><button role="tab" id="sessions-tab" aria-selected={route.tab === "sessions"} aria-controls="sessions-panel" onClick={() => navigate({ tab: "sessions" })}>読める原稿<span>{sessions.length}</span></button></div><a className="consultation-download-link" href="/api/consultation/export?format=companies" download><DownloadIcon />企業一覧を Word で保存</a></div>
          <div className="consultation-filters"><label className="consultation-search"><SearchIcon /><span className="consultation-sr-only">企業名・職種で検索</span><input type="search" placeholder="企業名・職種で検索" value={route.query} onChange={event => navigate({ query: event.target.value }, true)} /></label><label className="consultation-result-filter"><span>選考の進み方</span><select value={route.progress} onChange={event => navigate({ progress: event.target.value as ProgressFilter }, true)}>{PROGRESS_FILTERS.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label><label className="consultation-result-filter"><span>{route.tab === "companies" ? "現在の選考状況" : "この回の結果"}</span><select value={route.outcome} onChange={event => navigate({ outcome: event.target.value as OutcomeFilter }, true)}>{FILTERS.map(filter => <option key={filter.value} value={filter.value}>{filter.value === "all" && route.tab === "companies" ? "すべての状況" : filter.value === "positive" && route.tab === "companies" ? "内定・書類通過" : filter.value === "unknown" && route.tab === "companies" ? "保留・未確認" : filter.label}</option>)}</select></label><span className="consultation-sort-label">面接・面談日の新しい順 ↓</span></div>
          {selectedCompany && route.tab === "sessions" && <div className="consultation-company-filter"><span>{selectedCompany.company} の読める原稿</span><button onClick={() => navigate({ companyId: "" }, true)} aria-label="企業の絞り込みを解除">絞り込みを解除 ×</button></div>}
          <div className="consultation-results-caption" aria-live="polite"><span>{route.tab === "companies" ? `${visibleCompanies.length} 社` : `${visibleSessions.length} 件`}{hasFilters && " が見つかりました"}</span><small>{route.tab === "companies" ? "原稿未登録の企業も含みます。現在の状況と、過去に進んだ段階を分けて表示しています。" : "ここには読める原稿のみ掲載しています。各回の結果は、後の選考結果と分けて表示しています。"}</small></div>
          {route.tab === "companies" ? <div role="tabpanel" id="companies-panel" aria-labelledby="companies-tab"><div className="consultation-table"><div className="consultation-table-head" aria-hidden="true"><span>企業・応募職種</span><span>現在の選考状況</span><span>応募日</span><span>読める原稿</span></div>{visibleCompanies.map(company => <CompanyRow key={company.id} company={company} sessions={sessions.filter(session => session.companyId === company.id)} onOpen={openSession} onBrowse={() => navigate({ tab: "sessions", companyId: company.id, outcome: "all" })} />)}</div>{visibleCompanies.length === 0 && <EmptyState filtered={hasFilters} onReset={() => navigate({ query: "", outcome: "all", progress: "all", companyId: "" }, true)} />}</div>
            : <div role="tabpanel" id="sessions-panel" aria-labelledby="sessions-tab" className="consultation-session-list">{visibleSessions.map(session => <SessionRow key={session.id} session={session} onOpen={() => openSession(session)} />)}{visibleSessions.length === 0 && <EmptyState filtered={hasFilters} onReset={() => navigate({ query: "", outcome: "all", progress: "all", companyId: "" }, true)} />}</div>}
        </section>
        <footer className="consultation-library-footer"><span><BookIcon small />面接相談の資料 · 閲覧専用</span><span>資料更新：{dateLabel(initial.updatedAt)}<span className="consultation-footer-separator">／</span>時刻のある日程は日本時間（JST）</span></footer>
      </main>
    </div>
    {readerOpen && (selectedDetail?.data ? <ConsultationTranscriptReader initial={selectedDetail.data} view={route.view} onView={view => navigate({ view }, true)} onClose={closeReader} /> : <main className="consultation-reader-loading"><button className="consultation-back" onClick={closeReader}>← 一覧に戻る</button><div><BookIcon /><h1>面接記録</h1><p role={selectedDetail?.error ? "alert" : "status"}>{selectedDetail?.error || "面接の原稿を読み込んでいます…"}</p>{selectedDetail?.error && <button className="consultation-primary" onClick={() => setDetailRetry(value => value + 1)}>もう一度読み込む</button>}</div></main>)}
  </div>;
}

function CompanyRow({ company, sessions, onOpen, onBrowse }: { company: ConsultationCompany; sessions: ConsultationSessionSummary[]; onOpen: (session: ConsultationSessionSummary) => void; onBrowse: () => void }) {
  const recent = sessions[0];
  const history = companyHistory(company, sessions);
  const latestInterview = history[0];
  const progress = companyProgress(company, sessions);
  const readableIds = new Set(sessions.map(session => session.id));
  return <article className="consultation-company-row"><div className="consultation-company-heading"><h2>{company.company}</h2>{(progress.final || progress.passed) && <div className="consultation-progress-badges">{progress.final && <span>最終面接に進行</span>}{progress.passed && <span>面接通過あり</span>}</div>}<span>{company.applications.length ? `${company.applications.length} 職種` : "この面接の応募情報は未確認"}</span></div><div className="consultation-applications">{company.applications.length === 0 && latestInterview && <div className="consultation-application"><div><strong>{latestInterview.position || "応募職種は未確認"}</strong></div><div><small>直近の面接結果</small><Badge kind={latestInterview.outcomeKind}>{latestInterview.outcome || OUTCOMES[latestInterview.outcomeKind]}</Badge></div><span className="consultation-no-record">未確認</span></div>}{company.applications.map(application => <div className="consultation-application" key={application.id}><div><strong>{application.position || "職種未確認"}</strong>{application.channel && <small>{application.channel}</small>}</div><div><Badge kind={applicationKind(application.status)}>{application.status || "未確認"}</Badge></div><time dateTime={application.appliedOn || undefined}>{application.appliedOn ? dateLabel(application.appliedOn) : "未確認"}</time></div>)}{history.length > 0 && <div className="consultation-company-history" aria-label="確認できている面接・面談の履歴"><h3>確認できている面接・面談</h3>{history.map(interview => <div key={interview.id}><time dateTime={interview.date || undefined}>{dateLabel(interview.date)}</time><span>{stageLabel(interview)}</span><Badge kind={interview.outcomeKind}>{interview.outcome || OUTCOMES[interview.outcomeKind]}</Badge>{(!interview.sessionId || !readableIds.has(interview.sessionId)) && <small>原稿未登録</small>}</div>)}</div>}</div><div className="consultation-company-records">{recent ? <><button className="consultation-record-button" id={`company-session-${recent.id}`} onClick={() => onOpen(recent)}><BookIcon small />{recent.recordKind === "memory" ? "最新の記録を読む" : "最新の原稿を読む"}<span>↗</span></button><button className="consultation-text-button" onClick={onBrowse}>{sessions.length} 件の読める原稿を見る →</button>{recent.recordKind === "memory" && <small className="consultation-memory-label">記憶から再構成</small>}</> : <><strong className="consultation-no-record">原稿未登録</strong><small className="consultation-record-absence">面接・面談の履歴のみ</small></>}</div></article>;
}
function SessionRow({ session, onOpen }: { session: ConsultationSessionSummary; onOpen: () => void }) {
  const available = session.hasReadable || session.hasRaw;
  return <article className="consultation-session-row"><time dateTime={session.date || undefined}><strong>{dateLabel(session.date)}</strong><small className={session.stage === "final" ? "consultation-final-stage" : undefined}>{stageLabel(session)}</small></time><div className="consultation-session-company"><h2>{session.company}</h2><div><span className="consultation-round-result-label">この回の結果</span><Badge kind={session.outcomeKind} /><span>{session.outcome && session.outcome !== OUTCOMES[session.outcomeKind] ? session.outcome : ""}</span></div></div><div className="consultation-session-formats">{session.recordKind === "memory" && <strong className="consultation-memory-label">記憶から再構成</strong>}{session.hasReadable && <span>可読整理稿</span>}{session.hasRaw && <span>原始転写</span>}{!available && <span>原稿未登録</span>}</div><button className="consultation-record-button" id={`session-${session.id}`} onClick={onOpen}><BookIcon small />{available ? session.recordKind === "memory" ? "記録を読む" : "原稿を読む" : "記録を確認"}<span>↗</span></button></article>;
}
function EmptyState({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return <div className="consultation-empty"><BookIcon /><h2>{filtered ? "条件に合う資料はありません" : "資料はまだありません"}</h2><p>{filtered ? "企業名や選考結果を変えて、もう一度お探しください。" : "資料が登録されると、ここに表示されます。"}</p>{filtered && <button onClick={onReset}>絞り込みをすべて解除</button>}</div>;
}

export function ConsultationTranscriptReader({ initial, view = "readable", onView = () => {}, onClose = () => {} }: { initial: ConsultationTranscript; view?: TranscriptView; onView?: (view: TranscriptView) => void; onClose?: () => void }) {
  const [fontSize, setFontSize] = useState(18);
  const title = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const positions = useRef<Record<TranscriptView, number>>({ readable: 0, raw: 0 });
  const currentView = useRef(view);
  const readable = view === "readable";
  const available = readable ? initial.hasReadable && initial.blocks.some(block => block.turns.length > 0) : initial.hasRaw && Boolean(initial.raw.trim());
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, [initial.id]);
  useEffect(() => {
    if (currentView.current === view) return;
    positions.current[currentView.current] = scroll.current?.scrollTop || 0;
    currentView.current = view;
    if (scroll.current) scroll.current.scrollTop = positions.current[view];
  }, [view]);
  return <div className="consultation-reader" onKeyDown={event => { if (event.key === "Escape") onClose(); }}><div className="consultation-reader-toolbar"><button className="consultation-back" onClick={onClose}>← 一覧に戻る</button><div className="consultation-reader-switch" role="group" aria-label="原稿の表示形式"><button aria-pressed={readable} onClick={() => onView("readable")}>可読整理稿</button><button aria-pressed={!readable} onClick={() => onView("raw")}>原始転写</button></div><div className="consultation-reader-actions"><div className="consultation-font-controls" role="group" aria-label="本文の文字サイズ"><button aria-label="文字を小さく" disabled={fontSize === 16} onClick={() => setFontSize(value => Math.max(16, value - 2))}>A−</button><button aria-label="文字を大きく" disabled={fontSize === 24} onClick={() => setFontSize(value => Math.min(24, value + 2))}>A＋</button></div><button className="consultation-print-button" onClick={() => window.print()}>印刷</button>{available && <a className="consultation-download-link" href={exportHref(initial.id, view)} download><DownloadIcon />Word で保存</a>}</div></div>
    <div className="consultation-reader-scroll" ref={scroll}><div className="consultation-reader-layout"><main className="consultation-reading-paper" style={{ "--consultation-reading-size": `${fontSize}px` } as React.CSSProperties}><header className="consultation-transcript-heading"><p className="consultation-eyebrow">面接の記録 · {initial.recordKind === "memory" ? "記憶から再構成" : readable ? "可読整理稿" : "原始転写"}</p><h1 ref={title} tabIndex={-1}>{initial.company}</h1><div className="consultation-transcript-meta"><span>{dateLabel(initial.date)}</span><span>{stageLabel(initial)}</span><span className="consultation-round-result-label">この回の結果</span><Badge kind={initial.outcomeKind} /></div>{initial.outcome && initial.outcome !== OUTCOMES[initial.outcomeKind] && <p className="consultation-outcome-detail">{initial.outcome}</p>}</header>
      <div className="consultation-transcript-notice"><strong>{initial.recordKind === "memory" ? "面接後の記憶から再構成した資料です" : readable ? "当日の会話を読みやすく整理した原稿です" : "元の文字起こしをそのまま確認するための資料です"}</strong><p>{readable || initial.recordKind === "memory" ? initial.notice || "音声認識による誤りや、話者を確定できない箇所が残る場合があります。" : "録音からの文字起こしです。誤認識や発言者の区別に未確認の箇所があります。原音は未確認です。"}</p><p>{initial.recordKind === "memory" ? "録音の逐語転写ではありません。発言の内容や順序は、当日の会話と異なる場合があります。" : readable ? "「面接官」「私」を区別して表示しています。話者・転写が未確認の箇所には注記があります。" : "話者の表記や録音の区切りは、実際の話者と一致しない場合があります。"}</p></div>
      {available ? readable ? <div className="consultation-conversation">{initial.blocks.map((block, index) => <section className="consultation-conversation-block" key={block.id} id={`transcript-block-${block.id}`}><h2><span>{String(index + 1).padStart(2, "0")}</span>{block.title || `会話 ${index + 1}`}</h2>{block.turns.map(turn => <div className={`consultation-turn consultation-turn-${turn.speaker}`} key={turn.id}><div className="consultation-speaker"><span>{turn.speaker === "self" ? "私" : turn.speaker === "interviewer" ? "面接官" : "話者未確認"}</span></div><div><p>{turn.text}</p>{turn.uncertain && <small className="consultation-uncertain">話者・転写に未確認の箇所があります</small>}</div></div>)}</section>)}</div> : <div className="consultation-raw-transcript">{initial.raw.split("\n").map((line, index) => <p key={index}><span aria-hidden="true">{index + 1}</span><span>{line || " "}</span></p>)}</div> : <div className="consultation-empty"><BookIcon /><h2>{readable ? "可読整理稿はまだありません" : "原始転写はまだありません"}</h2><p>{readable && initial.hasRaw ? "原始転写で、元の文字起こしをお読みいただけます。" : !readable && initial.hasReadable ? "可読整理稿で、当日の会話をお読みいただけます。" : "この面接の原稿は登録されていません。"}</p>{readable && initial.hasRaw ? <button onClick={() => onView("raw")}>原始転写を読む →</button> : !readable && initial.hasReadable ? <button onClick={() => onView("readable")}>可読整理稿を読む →</button> : null}</div>}
      {available && <footer className="consultation-transcript-end"><BookIcon small /><span>{initial.recordKind === "memory" ? "記録は以上です" : "原稿は以上です"}</span><button onClick={onClose}>一覧に戻る →</button></footer>}
    </main><aside className="consultation-reader-aside"><p className="consultation-eyebrow">この原稿について</p><dl><div><dt>面接日</dt><dd>{dateLabel(initial.date)}</dd></div><div><dt>形式・ラウンド</dt><dd>{stageLabel(initial)}</dd></div><div><dt>この回の結果</dt><dd><Badge kind={initial.outcomeKind} /></dd></div></dl>{readable && initial.blocks.length > 0 && <nav aria-label="原稿の目次"><h2>会話の目次</h2>{initial.blocks.map((block, index) => <button key={block.id} onClick={() => document.getElementById(`transcript-block-${block.id}`)?.scrollIntoView({ block: "start", behavior: "instant" })}><span>{String(index + 1).padStart(2, "0")}</span>{block.title || `会話 ${index + 1}`}</button>)}</nav>}<p className="consultation-aside-help">原稿の気になる箇所は、Word に保存して書き込みながらご確認いただけます。</p></aside></div></div>
  </div>;
}
function SearchIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>; }
function DownloadIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
