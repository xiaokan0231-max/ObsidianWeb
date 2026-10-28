"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ConsultationCatalog, ConsultationCompany, ConsultationInterview, ConsultationSessionSummary, ConsultationTranscript } from "@/lib/consultation-library";
import { selectConsultationReadingGroups } from "@/lib/consultation-reading-start";
import type { FeedbackContext, FeedbackThread } from "@/lib/feedback";
import { consultationBlockText, consultationContextIsCurrent, consultationFeedbackContext, feedbackQuoteRange } from "@/lib/feedback-annotations";
import { FeedbackEntry, FeedbackHelp, FeedbackPanel, useFeedback } from "../feedback-ui";
import { TEACHER_TOUR_STORAGE_KEY } from "../feedback-tour";
import { UiLocaleProvider } from "../ui-locale";
import SelectionNoticePanel from "../selection-notice";
import "./consultation.css";

type OutcomeFilter = "all" | "rejected" | "waiting" | "positive" | "unknown" | "not-applicable";
type TranscriptView = "readable" | "raw";
type ProgressFilter = "all" | "final" | "passed";
type LibraryRoute = { tab: "companies" | "sessions"; query: string; outcome: OutcomeFilter; progress: ProgressFilter; companyId: string; sessionId: string; view: TranscriptView; feedbackThread: string; blockId: string };
const DEFAULT_ROUTE: LibraryRoute = { tab: "companies", query: "", outcome: "all", progress: "all", companyId: "", sessionId: "", view: "readable", feedbackThread: "", blockId: "" };
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
    feedbackThread: params.get("feedbackThread") || params.get("feedback") || "",
    blockId: params.get("block") || "",
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
  if (route.feedbackThread) params.set("feedbackThread", route.feedbackThread);
  if (route.blockId) params.set("block", route.blockId);
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

function LibraryHeader({ onHelp }: { onHelp?: () => void }) {
  return <header className="consultation-header">
    <Link className="consultation-brand" href="/consultation" aria-label="面接相談の資料のトップ"><span className="consultation-brand-mark"><BookIcon /></span><span><strong>Obsidian Memory Atlas</strong><small>資料を読んでコメントできます</small></span></Link>
    <div className="consultation-header-actions">
      <span className="consultation-header-note">日本語</span>
      <button data-tour="help-entry" className="consultation-help-button" onClick={onHelp ?? (() => { window.location.href = "/consultation?help=1"; })}>使い方</button>
      <span data-tour="feedback-entry"><FeedbackEntry locale="ja" context={{ pagePath: "/consultation", title: "面接相談の資料" }} /></span>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 独立阅读入口返回主站时需要完整加载首页。 */}
      <a className="consultation-home-link" href="/">← ホームに戻る</a>
    </div>
  </header>;
}

export function ConsultationLibrary({ initial }: { initial: ConsultationCatalog }) {
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    // 首次引导在资料就绪后出现；深链接阅读不被突然打断。
    let frame = 0;
    const params = new URLSearchParams(window.location.search);
    let firstVisit = true;
    try { firstVisit = localStorage.getItem(TEACHER_TOUR_STORAGE_KEY) !== "1"; } catch { /* 无法保存偏好时仍允许手动关闭。 */ }
    if (params.get("help") === "1" || (firstVisit && !params.has("session"))) {
      frame = window.requestAnimationFrame(() => setHelpOpen(true));
    }
    return () => { if (frame) window.cancelAnimationFrame(frame); };
  }, []);
  function closeHelp() {
    setHelpOpen(false);
    try { localStorage.setItem(TEACHER_TOUR_STORAGE_KEY, "1"); } catch { /* 不阻止继续阅读。 */ }
  }
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
    else navigate({ sessionId: "", blockId: "", feedbackThread: "" }, true);
  }
  function openSession(session: ConsultationSessionSummary) {
    lastSession.current = session.id;
    navigate({ sessionId: session.id, view: session.hasReadable ? "readable" : "raw", feedbackThread: "", blockId: "" });
  }
  function openExcerpt(session: ConsultationSessionSummary, blockId: string) {
    lastSession.current = session.id;
    navigate({ sessionId: session.id, view: "readable", blockId, feedbackThread: "" });
  }
  function showAllMaterials() {
    navigate({ tab: "sessions", query: "", outcome: "all", progress: "all", companyId: "", sessionId: "", blockId: "", feedbackThread: "" });
    window.requestAnimationFrame(() => document.getElementById("consultation-materials")?.scrollIntoView({ block: "start", behavior: "instant" }));
  }
  const query = route.query.trim().toLocaleLowerCase();
  const companies = useMemo(() => [...initial.companies].sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.company.localeCompare(b.company, "ja")), [initial.companies]);
  const sessions = useMemo(() => initial.sessions.filter(hasRecord).sort((a, b) => b.date.localeCompare(a.date) || a.company.localeCompare(b.company, "ja")), [initial.sessions]);
  const readingGroups = useMemo(() => selectConsultationReadingGroups(initial.sessions), [initial.sessions]);
  const [readingGroupId, setReadingGroupId] = useState("recent");
  const readingGroup = readingGroups.find(group => group.id === readingGroupId) ?? readingGroups[0];
  const readingStarts = readingGroup?.sessions ?? [];
  const manuscriptCompanyCount = new Set(sessions.map(session => session.companyId)).size;
  const selectedCompany = initial.companies.find(company => company.id === route.companyId);
  const visibleCompanies = filterConsultationCompanies(companies, sessions, query, route.outcome, route.progress);
  const visibleSessions = filterConsultationSessions(companies, sessions, query, route.outcome, route.progress, route.companyId);
  const hasFilters = Boolean(route.query || route.outcome !== "all" || route.progress !== "all" || route.companyId);
  const selectedDetail = detail.id === route.sessionId ? detail : null;
  return <div className={`consultation-shell${readerOpen ? " consultation-reader-open" : ""}`} lang="ja">
    <LibraryHeader onHelp={() => setHelpOpen(true)} />
    {helpOpen && <FeedbackHelp locale="ja" mode={readerOpen ? "reader" : "library"} onClose={closeHelp} />}
    <div className="consultation-library-scroll" ref={listScroll} hidden={readerOpen}>
      <main className="consultation-library">
        <section className="consultation-intro">
          <div className="consultation-intro-copy"><p className="consultation-eyebrow"><span />先生との相談スペース</p><h1>面接の記録から、<span>次の一歩へ。</span></h1><p className="consultation-lead">まずは一つの原稿から。気になる表現にコメントできます。</p></div>
        </section>
        <section className="consultation-reading-start" data-tour="reading-start" aria-labelledby="reading-start-title">
          <header className="consultation-reading-start-heading"><div><p className="consultation-eyebrow">READING START</p><h2 id="reading-start-title">まずは、ここから</h2><p>気になる入口を選んで、一つの原稿からご覧ください。</p></div><button data-tour="all-materials" className="consultation-all-materials" onClick={showAllMaterials}>すべての資料を見る<span aria-hidden="true">→</span></button></header>
          {readingGroups.length > 0 && <div className="consultation-reading-choices" data-tour="reading-choice" role="group" aria-label="読み始める面接の種類">{readingGroups.map(group => <button key={group.id} className={`consultation-reading-choice is-${group.id}`} aria-pressed={readingGroup?.id === group.id} aria-controls="consultation-reading-selection" onClick={() => setReadingGroupId(group.id)}><span className="consultation-reading-choice-icon" aria-hidden="true"><ReadingGroupIcon group={group.id} /></span><span><strong>{group.title}</strong><small>{group.id === "recent" ? "まずは直近のやり取りから" : group.id === "final" ? "選考の終盤で話したこと" : "違う話題や企業も見てみる"}</small></span><span className="consultation-reading-choice-count">{group.sessions.length}<small>件</small></span></button>)}</div>}
          <div id="consultation-reading-selection" className={`consultation-reading-selection is-${readingGroup?.id ?? "recent"}`} aria-live="polite" aria-atomic="false">
            {readingGroup && <p className="consultation-reading-group-description">{readingGroup.description}</p>}
            <div className={`consultation-reading-start-grid${readingStarts.length === 1 ? " is-single" : ""}`}>
              {readingStarts.map(session => <ReadingStartCard key={session.id} session={session} recent={readingGroup?.id === "recent" && Boolean(session.date)} label={readingGroup?.id === "recent" ? undefined : readingGroup?.title} onOpen={() => openSession(session)} onExcerpt={blockId => openExcerpt(session, blockId)} />)}
            </div>
          </div>
          {readingStarts.length === 0 && <p className="consultation-reading-start-empty">原稿が登録されると、ここから読み始められます。企業一覧から、確認できている面接の履歴をご覧いただけます。</p>}
        </section>
        <section className="consultation-coverage" aria-label="資料の収録範囲">
          <div><span className="consultation-stat-icon" aria-hidden="true"><CompanyIcon /></span><div><span>面接・面談した企業</span><strong>{companies.length}<small>社</small></strong></div></div>
          <div><span className="consultation-stat-icon" aria-hidden="true"><BookIcon /></span><div><span>原稿のある企業</span><strong>{manuscriptCompanyCount}<small>社</small></strong></div></div>
          <div><span className="consultation-stat-icon" aria-hidden="true"><DocumentIcon /></span><div><span>読める原稿</span><strong>{sessions.length}<small>件</small></strong></div></div>
          <p>記録で確認できる範囲です。すべての面接履歴を網羅した件数ではありません。</p>
        </section>
        <section className="consultation-materials" id="consultation-materials" aria-label="相談資料">
          <div data-tour="materials" className="consultation-materials-top"><div className="consultation-tabs" role="tablist" aria-label="資料の種類"><button role="tab" id="companies-tab" aria-selected={route.tab === "companies"} aria-controls="companies-panel" onClick={() => navigate({ tab: "companies", companyId: "" })}>面接・面談した企業<span>{companies.length}</span></button><button role="tab" id="sessions-tab" aria-selected={route.tab === "sessions"} aria-controls="sessions-panel" onClick={() => navigate({ tab: "sessions" })}>読める原稿<span>{sessions.length}</span></button></div><a className="consultation-download-link" href="/api/consultation/export?format=companies" download><DownloadIcon />企業一覧を Word で保存</a></div>
          <div className="consultation-filters"><label className="consultation-search"><SearchIcon /><span className="consultation-sr-only">企業名・職種で検索</span><input type="search" placeholder="企業名・職種で検索" value={route.query} onChange={event => navigate({ query: event.target.value }, true)} /></label><label className="consultation-result-filter"><span>選考の進み方</span><select value={route.progress} onChange={event => navigate({ progress: event.target.value as ProgressFilter }, true)}>{PROGRESS_FILTERS.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label><label className="consultation-result-filter"><span>{route.tab === "companies" ? "現在の選考状況" : "この回の結果"}</span><select value={route.outcome} onChange={event => navigate({ outcome: event.target.value as OutcomeFilter }, true)}>{FILTERS.map(filter => <option key={filter.value} value={filter.value}>{filter.value === "all" && route.tab === "companies" ? "すべての状況" : filter.value === "positive" && route.tab === "companies" ? "内定・書類通過" : filter.value === "unknown" && route.tab === "companies" ? "保留・未確認" : filter.label}</option>)}</select></label><span className="consultation-sort-label">面接・面談日の新しい順 ↓</span></div>
          {selectedCompany && route.tab === "sessions" && <div className="consultation-company-filter"><span>{selectedCompany.company} の読める原稿</span><button onClick={() => navigate({ companyId: "" }, true)} aria-label="企業の絞り込みを解除">絞り込みを解除 ×</button></div>}
          <div className="consultation-results-caption" aria-live="polite"><span>{route.tab === "companies" ? `${visibleCompanies.length} 社` : `${visibleSessions.length} 件`}{hasFilters && " が見つかりました"}</span><small>{route.tab === "companies" ? "原稿未登録の企業も含みます。現在の状況と、過去に進んだ段階を分けて表示しています。" : "ここには読める原稿のみ掲載しています。各回の結果は、後の選考結果と分けて表示しています。"}</small></div>
          {route.tab === "companies" ? <div role="tabpanel" id="companies-panel" aria-labelledby="companies-tab"><div className="consultation-table"><div className="consultation-table-head" aria-hidden="true"><span>企業・応募職種</span><span>現在の選考状況</span><span>応募日</span><span>読める原稿</span></div>{visibleCompanies.map(company => <CompanyRow key={company.id} company={company} sessions={sessions.filter(session => session.companyId === company.id)} onOpen={openSession} onBrowse={() => navigate({ tab: "sessions", companyId: company.id, outcome: "all" })} />)}</div>{visibleCompanies.length === 0 && <EmptyState filtered={hasFilters} onReset={() => navigate({ query: "", outcome: "all", progress: "all", companyId: "" }, true)} />}</div>
            : <div role="tabpanel" id="sessions-panel" aria-labelledby="sessions-tab" className="consultation-session-list">{visibleSessions.map(session => <SessionRow key={session.id} session={session} onOpen={() => openSession(session)} />)}{visibleSessions.length === 0 && <EmptyState filtered={hasFilters} onReset={() => navigate({ query: "", outcome: "all", progress: "all", companyId: "" }, true)} />}</div>}
        </section>
        <footer className="consultation-library-footer"><span><BookIcon small />面接相談の資料 · コメントできます</span><span>資料更新：{dateLabel(initial.updatedAt)}<span className="consultation-footer-separator">／</span>時刻のある日程は日本時間（JST）</span></footer>
      </main>
    </div>
    {readerOpen && (selectedDetail?.data ? <ConsultationTranscriptReader key={selectedDetail.data.id} initial={selectedDetail.data} requestedThreadId={route.feedbackThread} requestedBlockId={route.blockId} view={route.view} onView={view => navigate({ view }, true)} onClose={closeReader} /> : <main className="consultation-reader-loading"><button className="consultation-back" onClick={closeReader}>← 一覧に戻る</button><div><BookIcon /><h1>面接記録</h1><p role={selectedDetail?.error ? "alert" : "status"}>{selectedDetail?.error || "面接の原稿を読み込んでいます…"}</p>{selectedDetail?.error && <button className="consultation-primary" onClick={() => setDetailRetry(value => value + 1)}>もう一度読み込む</button>}</div></main>)}
  </div>;
}

function ReadingGroupIcon({ group }: { group: string }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{group === "recent" ? <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></> : group === "final" ? <><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></> : <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><path d="M14 17.5h7m-3.5-3.5v7" /></>}</svg>;
}

export function ReadingStartCard({ session, recent, label, onOpen, onExcerpt }: { session: ConsultationSessionSummary; recent: boolean; label?: string; onOpen: () => void; onExcerpt: (blockId: string) => void }) {
  const guide = session.readingGuide;
  const excerpts = session.hasReadable && session.recordKind !== "memory" ? (guide?.excerpts ?? []).slice(0, 2) : [];
  const introduction = guide?.introduction || (session.recordKind === "memory" ? "当日の記憶から再構成した記録です。会話の内容を中心にご覧いただけます。" : session.date ? `${dateLabel(session.date)}の${stageLabel(session)}です。気になるやり取りからコメントできます。` : "日付未確認の面接記録です。原稿から、確認できるやり取りをご覧いただけます。");
  return <article className={`consultation-reading-start-card${guide?.featured ? " is-featured" : ""}${excerpts.length ? " has-preview" : ""}`}>
    <div className="consultation-reading-start-main">
      <div className="consultation-reading-start-badges">{recent && <span className="reading-start-recent">最近の面接</span>}{guide?.featured && <span className="reading-start-featured">本人からの相談</span>}{!recent && !guide?.featured && <span>{label || "読み始める原稿"}</span>}</div>
      <h3>{session.company}</h3>
      <div className="consultation-reading-start-meta"><time dateTime={session.date || undefined}>{dateLabel(session.date)}</time><span>{stageLabel(session)}</span>{session.recordKind === "memory" ? <span className="reading-start-memory">記憶から再構成</span> : <span>{session.hasReadable ? "可読整理稿" : "原始転写"}</span>}</div>
      {session.position && <p className="consultation-reading-start-position">{session.position}</p>}
      <p className="consultation-reading-start-introduction">{introduction}</p>
      {guide?.request && <div className="consultation-reading-start-request"><strong>相談したいこと</strong><p>{guide.request}</p></div>}
    </div>
    <div className="consultation-reading-start-side">
      {excerpts.length > 0 && <div className="consultation-reading-preview" data-tour="reading-preview"><h4>原稿にある質問</h4>{excerpts.map(excerpt => <button key={`${excerpt.blockId}:${excerpt.text}`} title={excerpt.text} onClick={() => onExcerpt(excerpt.blockId)}><span>「{excerpt.text}」</span><small>このやり取りを見る<span aria-hidden="true">↗</span></small></button>)}</div>}
      <div className="consultation-reading-start-footer"><span><BookIcon small />{session.hasReadable && (guide?.blockCount ?? 0) > 0 ? `${guide!.blockCount}の会話区分` : session.recordKind === "memory" ? "内容の確認・ご相談に" : "原文を確認できます"}</span><button data-tour="start-reading" className="consultation-reading-start-open" onClick={onOpen}>この原稿を読む<span aria-hidden="true">→</span></button></div>
    </div>
  </article>;
}

function CompanyRow({ company, sessions, onOpen, onBrowse }: { company: ConsultationCompany; sessions: ConsultationSessionSummary[]; onOpen: (session: ConsultationSessionSummary) => void; onBrowse: () => void }) {
  const recent = sessions[0];
  const history = companyHistory(company, sessions);
  const latestInterview = history[0];
  const progress = companyProgress(company, sessions);
  const readableIds = new Set(sessions.map(session => session.id));
  return <article className="consultation-company-row"><div className="consultation-company-heading"><h2>{company.company}</h2>{(progress.final || progress.passed) && <div className="consultation-progress-badges">{progress.final && <span>最終面接に進行</span>}{progress.passed && <span>面接通過あり</span>}</div>}<span>{company.applications.length ? `${company.applications.length} 職種` : "この面接の応募情報は未確認"}</span></div><div className="consultation-applications">{company.applications.length === 0 && latestInterview && <div className="consultation-application"><div><strong>{latestInterview.position || "応募職種は未確認"}</strong></div><div><small>直近の面接結果</small><Badge kind={latestInterview.outcomeKind}>{latestInterview.outcome || OUTCOMES[latestInterview.outcomeKind]}</Badge></div><span className="consultation-no-record">未確認</span></div>}{company.applications.map(application => <div className="consultation-application" key={application.id}><div><strong>{application.position || "職種未確認"}</strong>{application.channel && <small>{application.channel}</small>}</div><div><Badge kind={applicationKind(application.status)}>{application.status || "未確認"}</Badge></div><time dateTime={application.appliedOn || undefined}>{application.appliedOn ? dateLabel(application.appliedOn) : "未確認"}</time></div>)}{history.length > 0 && <div className="consultation-company-history" aria-label="確認できている面接・面談の履歴"><h3>確認できている面接・面談</h3>{history.map(interview => <div key={interview.id}><time dateTime={interview.date || undefined}>{dateLabel(interview.date)}</time><span>{stageLabel(interview)}</span><Badge kind={interview.outcomeKind}>{interview.outcome || OUTCOMES[interview.outcomeKind]}</Badge>{(!interview.sessionId || !readableIds.has(interview.sessionId)) && <small>原稿未登録</small>}</div>)}</div>}</div><div className="consultation-company-records">{recent ? <><button data-tour="open-transcript" className="consultation-record-button" id={`company-session-${recent.id}`} onClick={() => onOpen(recent)}><BookIcon small />{recent.recordKind === "memory" ? "最新の記録を読む" : "最新の原稿を読む"}<span>↗</span></button><button className="consultation-text-button" onClick={onBrowse}>{sessions.length} 件の読める原稿を見る →</button>{recent.recordKind === "memory" && <small className="consultation-memory-label">記憶から再構成</small>}</> : <><strong className="consultation-no-record">原稿未登録</strong><small className="consultation-record-absence">面接・面談の履歴のみ</small></>}</div></article>;
}
function SessionRow({ session, onOpen }: { session: ConsultationSessionSummary; onOpen: () => void }) {
  const available = session.hasReadable || session.hasRaw;
  return <article className="consultation-session-row"><time dateTime={session.date || undefined}><strong>{dateLabel(session.date)}</strong><small className={session.stage === "final" ? "consultation-final-stage" : undefined}>{stageLabel(session)}</small></time><div className="consultation-session-company"><h2>{session.company}</h2><div><span className="consultation-round-result-label">この回の結果</span><Badge kind={session.outcomeKind} /><span>{session.outcome && session.outcome !== OUTCOMES[session.outcomeKind] ? session.outcome : ""}</span></div></div><div className="consultation-session-formats">{session.recordKind === "memory" && <strong className="consultation-memory-label">記憶から再構成</strong>}{session.hasReadable && <span>可読整理稿</span>}{session.hasRaw && <span>原始転写</span>}{!available && <span>原稿未登録</span>}</div><button data-tour="open-transcript" className="consultation-record-button" id={`session-${session.id}`} onClick={onOpen}><BookIcon small />{available ? session.recordKind === "memory" ? "記録を読む" : "原稿を読む" : "記録を確認"}<span>↗</span></button></article>;
}
function EmptyState({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return <div className="consultation-empty"><BookIcon /><h2>{filtered ? "条件に合う資料はありません" : "資料はまだありません"}</h2><p>{filtered ? "企業名や選考結果を変えて、もう一度お探しください。" : "資料が登録されると、ここに表示されます。"}</p>{filtered && <button onClick={onReset}>絞り込みをすべて解除</button>}</div>;
}

type AnnotationRange = { start: number; end: number; thread: FeedbackThread };

function AnnotatedText({ text, ranges, onOpen }: { text: string; ranges: AnnotationRange[]; onOpen: (thread: FeedbackThread) => void }) {
  if (!ranges.length) return <>{text}</>;
  const points = [...new Set([0, text.length, ...ranges.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b);
  return <>{points.slice(0, -1).map((point, index) => {
    const end = points[index + 1];
    const matches = ranges.filter(range => range.start < end && range.end > point);
    return matches.length ? <mark className="consultation-comment-highlight" data-feedback-threads={matches.map(match => match.thread.id).join(" ")} key={point} role="button" tabIndex={0} title={`この部分へのコメント ${matches.length}件`} onClick={() => onOpen(matches[0].thread)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(matches[0].thread); } }}>{text.slice(point, end)}</mark> : <span key={point}>{text.slice(point, end)}</span>;
  })}</>;
}

export function consultationReadingBlockTarget(transcript: ConsultationTranscript, blockId: string, view: TranscriptView, feedbackThread = ""): string | null {
  if (feedbackThread || view !== "readable" || !blockId || !transcript.blocks.some(block => block.id === blockId)) return null;
  return `transcript-block-${blockId}`;
}

export function ConsultationTranscriptReader({ initial, view = "readable", requestedThreadId = "", requestedBlockId = "", onView = () => {}, onClose = () => {} }: { initial: ConsultationTranscript; view?: TranscriptView; requestedThreadId?: string; requestedBlockId?: string; onView?: (view: TranscriptView) => void; onClose?: () => void }) {
  const [fontSize, setFontSize] = useState(18);
  const [panel, setPanel] = useState<{ context: FeedbackContext; threadId?: string } | null>(null);
  const [selection, setSelection] = useState<{ context: FeedbackContext; left: number; top: number } | null>(null);
  const { threads } = useFeedback();
  const title = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const positions = useRef<Record<TranscriptView, number>>({ readable: 0, raw: 0 });
  const currentView = useRef(view);
  const openedRequest = useRef("");
  const positionedThread = useRef("");
  const positionedBlock = useRef("");
  const readable = view === "readable";
  const available = readable ? initial.hasReadable && initial.blocks.some(block => block.turns.length > 0) : initial.hasRaw && Boolean(initial.raw.trim());
  const related = threads.filter(thread => thread.context.sessionId === initial.id && !thread.hidden);
  const sessionContext = consultationFeedbackContext(initial, view);
  const currentThread = panel?.threadId ? threads.find(thread => thread.id === panel.threadId) : undefined;
  const sourceContext = currentThread?.context ?? panel?.context;
  const stale = Boolean(sourceContext?.blockId && !consultationContextIsCurrent(initial, sourceContext));

  useEffect(() => { title.current?.focus({ preventScroll: true }); }, [initial.id]);
  useEffect(() => {
    const targetId = consultationReadingBlockTarget(initial, requestedBlockId, view, requestedThreadId || panel?.threadId);
    const key = `${initial.id}:${targetId}`;
    if (!targetId || positionedBlock.current === key) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      positionedBlock.current = key;
      target.scrollIntoView({ block: "start", behavior: "instant" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initial, requestedBlockId, requestedThreadId, view, panel?.threadId]);
  useEffect(() => {
    if (currentView.current === view) return;
    positions.current[currentView.current] = scroll.current?.scrollTop || 0;
    currentView.current = view;
    setSelection(null);
    if (scroll.current) scroll.current.scrollTop = positions.current[view];
  }, [view]);
  useEffect(() => {
    if (!requestedThreadId) return;
    const thread = threads.find(item => item.id === requestedThreadId);
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (openedRequest.current !== requestedThreadId) {
        openedRequest.current = requestedThreadId;
        setPanel({ context: thread?.context ?? consultationFeedbackContext(initial, view), threadId: requestedThreadId });
      } else if (thread) {
        setPanel(previous => previous?.threadId === requestedThreadId && previous.context !== thread.context ? { ...previous, context: thread.context } : previous);
      }
    });
    return () => { active = false; };
  }, [requestedThreadId, threads, initial, view]);
  useEffect(() => {
    if (!panel?.threadId || !sourceContext?.blockId || positionedThread.current === panel.threadId || !consultationContextIsCurrent(initial, sourceContext)) return;
    const rawTarget = sourceContext.blockId === "raw" ? "transcript-block-raw" : `transcript-block-${sourceContext.blockId}`;
    // 长段落居中会把被点评的句子滚出视野，优先定位准确的高亮文字。
    const exact = document.querySelector<HTMLElement>(`[data-feedback-threads~="${CSS.escape(panel.threadId)}"]`);
    const target = exact ?? document.getElementById(rawTarget);
    if (!target) return;
    positionedThread.current = panel.threadId;
    window.requestAnimationFrame(() => target.scrollIntoView({ block: exact ? "center" : "start", behavior: "instant" }));
  }, [panel?.threadId, sourceContext, initial, view]);

  function openPanel(context: FeedbackContext, threadId?: string) {
    setSelection(null);
    setPanel({ context, threadId });
    if (threadId) {
      const url = new URL(window.location.href);
      url.searchParams.set("feedbackThread", threadId);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }
  function closePanel() {
    positionedThread.current = "";
    setPanel(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("feedbackThread"); url.searchParams.delete("feedback");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  function openThread(thread: FeedbackThread) { openPanel(thread.context, thread.id); }
  function captureSelection() {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount || selected.toString().trim().length < 1) { setSelection(null); return; }
    const range = selected.getRangeAt(0);
    const element = (node: Node) => node instanceof Element ? node : node.parentElement;
    const startElement = element(range.startContainer);
    const endElement = element(range.endContainer);
    const startText = startElement?.closest<HTMLElement>("[data-feedback-text]");
    const endText = endElement?.closest<HTMLElement>("[data-feedback-text]");
    const startBlock = startText?.closest<HTMLElement>("[data-feedback-block]");
    const endBlock = endText?.closest<HTMLElement>("[data-feedback-block]");
    if (!startText || !endText || !startBlock || startBlock !== endBlock || !scroll.current?.contains(startText)) { setSelection(null); return; }
    const offset = (container: HTMLElement, node: Node, at: number) => {
      const before = document.createRange(); before.selectNodeContents(container); before.setEnd(node, at); return before.toString().length;
    };
    let text = ""; let start = 0; let end = 0; let blockId = startBlock.dataset.feedbackBlock!; let turnId: string | undefined;
    if (readable) {
      const block = initial.blocks.find(item => item.id === blockId);
      if (!block) return;
      if (startText === endText) {
        const turn = block.turns.find(item => item.id === startText.dataset.feedbackTurn);
        if (!turn) return;
        text = turn.text; turnId = turn.id;
        start = offset(startText, range.startContainer, range.startOffset); end = offset(endText, range.endContainer, range.endOffset);
      } else {
        text = consultationBlockText(block);
        const turnOffset = (id: string | undefined) => {
          const index = block.turns.findIndex(item => item.id === id);
          return block.turns.slice(0, index).reduce((sum, item) => sum + item.text.length + 1, 0);
        };
        start = turnOffset(startText.dataset.feedbackTurn) + offset(startText, range.startContainer, range.startOffset);
        end = turnOffset(endText.dataset.feedbackTurn) + offset(endText, range.endContainer, range.endOffset);
      }
    } else {
      const lines = initial.raw.split("\n");
      const startLine = Number(startText.dataset.feedbackLine);
      const endLine = Number(endText.dataset.feedbackLine);
      if (startLine === endLine) { text = lines[startLine]; blockId = `raw-line-${startLine}`; start = offset(startText, range.startContainer, range.startOffset); end = offset(endText, range.endContainer, range.endOffset); }
      else { text = initial.raw; blockId = "raw"; start = lines.slice(0, startLine).reduce((sum, line) => sum + line.length + 1, 0) + offset(startText, range.startContainer, range.startOffset); end = lines.slice(0, endLine).reduce((sum, line) => sum + line.length + 1, 0) + offset(endText, range.endContainer, range.endOffset); }
    }
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) { setSelection(null); return; }
    const rect = range.getBoundingClientRect();
    setSelection({ context: consultationFeedbackContext(initial, view, { blockId, turnId, text, start, end }), left: Math.max(16, Math.min(rect.left, window.innerWidth - 245)), top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 70)) });
  }
  function turnRanges(block: ConsultationTranscript["blocks"][number], turn: ConsultationTranscript["blocks"][number]["turns"][number]): AnnotationRange[] {
    const before = block.turns.slice(0, block.turns.indexOf(turn)).reduce((sum, item) => sum + item.text.length + 1, 0);
    return related.flatMap(thread => {
      const context = thread.context;
      if (context.blockId !== block.id || (context.turnId && context.turnId !== turn.id)) return [];
      const range = feedbackQuoteRange(context.turnId ? turn.text : consultationBlockText(block), context);
      if (!range) return [];
      const start = context.turnId ? range.start : Math.max(0, range.start - before);
      const end = context.turnId ? range.end : Math.min(turn.text.length, range.end - before);
      return start < end && start < turn.text.length && end > 0 ? [{ start, end, thread }] : [];
    });
  }
  function rawRanges(line: string, index: number): AnnotationRange[] {
    const before = initial.raw.split("\n").slice(0, index).reduce((sum, item) => sum + item.length + 1, 0);
    return related.flatMap(thread => {
      const context = thread.context;
      if (context.blockId !== `raw-line-${index}` && context.blockId !== "raw") return [];
      const range = feedbackQuoteRange(context.blockId === "raw" ? initial.raw : line, context);
      if (!range) return [];
      const start = context.blockId === "raw" ? Math.max(0, range.start - before) : range.start;
      const end = context.blockId === "raw" ? Math.min(line.length, range.end - before) : range.end;
      return start < end && start < line.length && end > 0 ? [{ start, end, thread }] : [];
    });
  }
  return <div className="consultation-reader" onKeyDown={event => {
    if (event.key !== "Escape") return;
    if (selection) { event.stopPropagation(); setSelection(null); }
    else if (panel) { event.stopPropagation(); closePanel(); }
    else onClose();
  }}>
    <div className="consultation-reader-toolbar"><button className="consultation-back" onClick={onClose}>← 一覧に戻る</button><div className="consultation-reader-switch" role="group" aria-label="原稿の表示形式"><button aria-pressed={readable} onClick={() => onView("readable")}>可読整理稿</button><button aria-pressed={!readable} onClick={() => onView("raw")}>原始転写</button></div><div className="consultation-reader-actions"><button className="consultation-comment-button" onClick={() => openPanel(sessionContext)}>この面接にコメント{related.length > 0 && <span>{related.length}</span>}</button><div className="consultation-font-controls" role="group" aria-label="本文の文字サイズ"><button aria-label="文字を小さく" disabled={fontSize === 16} onClick={() => setFontSize(value => Math.max(16, value - 2))}>A−</button><button aria-label="文字を大きく" disabled={fontSize === 24} onClick={() => setFontSize(value => Math.min(24, value + 2))}>A＋</button></div><button className="consultation-print-button" onClick={() => window.print()}>印刷</button>{available && <a className="consultation-download-link" href={exportHref(initial.id, view)} download><DownloadIcon />Word で保存</a>}</div></div>
    <div className="consultation-reader-scroll" ref={scroll}><div className={`consultation-reader-layout${panel ? " consultation-reader-layout-commenting" : ""}`}><main className="consultation-reading-paper" onMouseUp={captureSelection} onKeyUp={event => { if (event.key.startsWith("Arrow") || event.key === "Shift") captureSelection(); }} style={{ "--consultation-reading-size": `${fontSize}px` } as React.CSSProperties}><header className="consultation-transcript-heading"><p className="consultation-eyebrow">面接の記録 · {initial.recordKind === "memory" ? "記憶から再構成" : readable ? "可読整理稿" : "原始転写"}</p><h1 ref={title} tabIndex={-1}>{initial.company}</h1><div className="consultation-transcript-meta"><span>{dateLabel(initial.date)}</span><span>{stageLabel(initial)}</span><span className="consultation-round-result-label">この回の結果</span><Badge kind={initial.outcomeKind} /></div>{initial.outcome && initial.outcome !== OUTCOMES[initial.outcomeKind] && <p className="consultation-outcome-detail">{initial.outcome}</p>}</header>
      <SelectionNoticePanel key={initial.id} notices={initial.selectionNotices ?? []} locale="ja" rejected={initial.outcomeKind === "rejected"} />
      {Boolean(initial.selectionNotices?.length) && <p className="consultation-notice-privacy">連絡先・内部リンクは非表示です。通知の文面は翻訳せずに掲載しています。</p>}
      <div className="consultation-transcript-notice"><strong>{initial.recordKind === "memory" ? "面接後の記憶から再構成した資料です" : readable ? "当日の会話を読みやすく整理した原稿です" : "元の文字起こしをそのまま確認するための資料です"}</strong><p>{readable || initial.recordKind === "memory" ? initial.notice || "音声認識による誤りや、話者を確定できない箇所が残る場合があります。" : "録音からの文字起こしです。誤認識や発言者の区別に未確認の箇所があります。原音は未確認です。"}</p><p>{initial.recordKind === "memory" ? "録音の逐語転写ではありません。発言の内容や順序は、当日の会話と異なる場合があります。" : readable ? "「面接官」「私」を区別して表示しています。話者・転写が未確認の箇所には注記があります。" : "話者の表記や録音の区切りは、実際の話者と一致しない場合があります。"}</p></div>
      {available ? readable ? <div className="consultation-conversation">{initial.blocks.map((block, index) => {
        const blockThreads = related.filter(thread => thread.context.blockId === block.id);
        const context = consultationFeedbackContext(initial, view, { blockId: block.id, text: consultationBlockText(block) });
        return <section className="consultation-conversation-block" key={block.id} id={`transcript-block-${block.id}`} tabIndex={-1} data-feedback-block={block.id}><div className="consultation-block-heading"><h2><span>{String(index + 1).padStart(2, "0")}</span>{block.title || `会話 ${index + 1}`}</h2><button data-tour="paragraph-comment" className="consultation-comment-button" onClick={() => openPanel(context)}>この部分にコメント</button>{blockThreads.length > 0 && <button className="consultation-comment-count" onClick={() => openPanel(context)}>コメント {blockThreads.length}件</button>}</div>{block.turns.map(turn => <div className={`consultation-turn consultation-turn-${turn.speaker}`} key={turn.id}><div className="consultation-speaker"><span>{turn.speaker === "self" ? "私" : turn.speaker === "interviewer" ? "面接官" : "話者未確認"}</span></div><div><p data-feedback-text="true" data-feedback-turn={turn.id}><AnnotatedText text={turn.text} ranges={turnRanges(block, turn)} onOpen={openThread} /></p>{turn.uncertain && <small className="consultation-uncertain">話者・転写に未確認の箇所があります</small>}</div></div>)}</section>;
      })}</div> : <div className="consultation-raw-transcript" id="transcript-block-raw" data-feedback-block="raw">{initial.raw.split("\n").map((line, index) => <div className="consultation-raw-line" key={index} id={`transcript-block-raw-line-${index}`}><p><span aria-hidden="true">{index + 1}</span><span data-feedback-text="true" data-feedback-line={index}><AnnotatedText text={line || " "} ranges={rawRanges(line, index)} onOpen={openThread} /></span></p>{line.trim() && <button data-tour="paragraph-comment" className="consultation-comment-button" onClick={() => openPanel(consultationFeedbackContext(initial, view, { blockId: `raw-line-${index}`, text: line }))}>この部分にコメント</button>}</div>)}</div> : <div className="consultation-empty"><BookIcon /><h2>{readable ? "可読整理稿はまだありません" : "原始転写はまだありません"}</h2><p>{readable && initial.hasRaw ? "原始転写で、元の文字起こしをお読みいただけます。" : !readable && initial.hasReadable ? "可読整理稿で、当日の会話をお読みいただけます。" : "この面接の原稿は登録されていません。"}</p>{readable && initial.hasRaw ? <button onClick={() => onView("raw")}>原始転写を読む →</button> : !readable && initial.hasReadable ? <button onClick={() => onView("readable")}>可読整理稿を読む →</button> : null}</div>}
      {available && <footer className="consultation-transcript-end"><BookIcon small /><span>{initial.recordKind === "memory" ? "記録は以上です" : "原稿は以上です"}</span><button onClick={onClose}>一覧に戻る →</button></footer>}
    </main>{panel ? <aside className="consultation-feedback-aside" aria-label="この原稿へのコメント">{stale && <p className="consultation-source-updated" role="status">元の資料が更新されています。送信時の原文はコメント内に残っています。</p>}<FeedbackPanel key={`${panel.threadId ?? "new"}:${panel.context.blockId ?? "session"}:${panel.context.turnId ?? ""}:${panel.context.quoteStart ?? ""}`} locale="ja" inline context={panel.context} threadId={panel.threadId} onClose={closePanel} /></aside> : <aside className="consultation-reader-aside"><p className="consultation-eyebrow">この原稿について</p><dl><div><dt>面接日</dt><dd>{dateLabel(initial.date)}</dd></div><div><dt>形式・ラウンド</dt><dd>{stageLabel(initial)}</dd></div><div><dt>この回の結果</dt><dd><Badge kind={initial.outcomeKind} /></dd></div></dl>{readable && initial.blocks.length > 0 && <nav aria-label="原稿の目次"><h2>会話の目次</h2>{initial.blocks.map((block, index) => <button key={block.id} onClick={() => document.getElementById(`transcript-block-${block.id}`)?.scrollIntoView({ block: "start", behavior: "instant" })}><span>{String(index + 1).padStart(2, "0")}</span>{block.title || `会話 ${index + 1}`}</button>)}</nav>}<p className="consultation-aside-help">気になる会話の「この部分にコメント」から、ご意見やご質問をその場で送れます。</p></aside>}</div></div>
    {selection && <button className="consultation-selection-action" style={{ left: selection.left, top: selection.top }} onMouseDown={event => event.preventDefault()} onClick={() => openPanel(selection.context)}>選んだ文章にコメントする</button>}
  </div>;
}
function SearchIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>; }
function DownloadIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

function CompanyIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 21V7l8-4v18m0-11h8v11M8 8v1m0 4v1m0 4v1m8-5v1m0 3v1M2 21h20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function DocumentIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8m-8 4h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
