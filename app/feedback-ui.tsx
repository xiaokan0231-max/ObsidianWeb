"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { feedbackContextKey, type FeedbackContext, type FeedbackSession, type FeedbackSummaryPage, type FeedbackThread, type FeedbackUnread } from "@/lib/feedback";
import { useUiLocale } from "./ui-locale";
import { TeacherTour, type TeacherTourMode } from "./feedback-tour";
import "./feedback.css";

export type FeedbackLocale = "ja" | "zh-CN";
export const feedbackText = (locale: FeedbackLocale, ja: string, zh: string) => locale === "ja" ? ja : zh;
type DrawerTarget = { context: FeedbackContext; threadId?: string; locale?: FeedbackLocale };
type ThreadDetail = { thread?: FeedbackThread; loading: boolean; error?: number; revision: number | undefined };
type FeedbackValue = {
  session: FeedbackSession | null; unread: FeedbackUnread | null; loading: boolean; error: string;
  refresh: () => Promise<void>; refreshSession: () => Promise<void>;
  open: (context?: FeedbackContext, threadId?: string, locale?: FeedbackLocale) => void;
  close: () => void; replaceThread: (thread: FeedbackThread, identity: string) => boolean; markRead: (thread: FeedbackThread) => Promise<void>;
  details: ReadonlyMap<string, ThreadDetail>;
  loadThread: (id: string, force?: boolean) => Promise<void>;
};
const emptyFeedback: FeedbackValue = {
  session: null, unread: null, loading: false, error: "", details: new Map(),
  refresh: async () => {}, refreshSession: async () => {}, open: () => {}, close: () => {},
  replaceThread: () => false, markRead: async () => {}, loadThread: async () => {},
};
const Feedback = createContext<FeedbackValue>(emptyFeedback);
export const useFeedback = () => useContext(Feedback);

export class FeedbackRequestError extends Error {
  constructor(public status: number) { super(`Feedback request failed (${status})`); }
}
function feedbackFetch(path: string, options: RequestInit = {}) {
  const timeout = AbortSignal.timeout(20000);
  return fetch(`/api/feedback${path}`, {
    cache: "no-store", credentials: "same-origin", ...options,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });
}
export async function feedbackRequest<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", signal?: AbortSignal): Promise<T> {
  const response = await feedbackFetch(path, {
    method, signal, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new FeedbackRequestError(response.status);
  return await response.json() as T;
}
function currentPage(): FeedbackContext {
  if (typeof window === "undefined") return { pagePath: "/", title: "ページについて" };
  const url = new URL(window.location.href);
  // 引用只带页面位置，避免把查询参数中的访问码或认证信息保存为资料。
  for (const key of [...url.searchParams.keys()]) if (/token|code|secret|key|auth/i.test(key)) url.searchParams.delete(key);
  return { pagePath: url.pathname + url.search, title: document.title || url.pathname };
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { locale } = useUiLocale();
  const [session, setSession] = useState<FeedbackSession | null>(null);
  const [unread, setUnread] = useState<FeedbackUnread | null>(null);
  const [details, setDetails] = useState<ReadonlyMap<string, ThreadDetail>>(() => new Map());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const displayedIdentity = useRef<string | null>(null);
  const unreadState = useRef<{ etag: string | null; value: FeedbackUnread | null; checkedAt: number }>({ etag: null, value: null, checkedAt: 0 });
  const unreadPending = useRef<Promise<void> | null>(null);
  const sessionPending = useRef<Promise<void> | null>(null);
  const detailState = useRef<ReadonlyMap<string, ThreadDetail>>(new Map());
  const detailRequests = useRef(new Map<string, AbortController>());
  const readPending = useRef(new Set<string>());

  const setIdentity = useCallback((next: FeedbackSession) => {
    const identity = next.identity?.id ?? null;
    if (displayedIdentity.current !== identity) {
      // 清空旧身份的详情与验证器，迟到的请求只能写回其原身份。
      displayedIdentity.current = identity;
      unreadState.current = { etag: null, value: null, checkedAt: 0 };
      unreadPending.current = null;
      setUnread(null);
      for (const controller of detailRequests.current.values()) controller.abort();
      detailRequests.current.clear();
      detailState.current = new Map();
      setDetails(detailState.current);
      readPending.current.clear();
    }
    setSession(next);
  }, []);

  const pollUnread = useCallback((force = false): Promise<void> => {
    const identity = displayedIdentity.current;
    if (!identity) return Promise.resolve();
    if (unreadPending.current) return unreadPending.current;
    const { etag, checkedAt } = unreadState.current;
    if (!force && Date.now() - checkedAt < 1000) return Promise.resolve();
    unreadState.current.checkedAt = Date.now();
    const task = (async () => {
      try {
        const response = await feedbackFetch("/unread", { headers: etag ? { "If-None-Match": etag } : undefined });
        if (displayedIdentity.current !== identity) return;
        if (response.status === 401) { setIdentity({ identity: null, configured: true }); return; }
        if (response.status === 304) { setError(""); return; }
        if (!response.ok) throw new FeedbackRequestError(response.status);
        const value = await response.json() as FeedbackUnread;
        if (displayedIdentity.current !== identity) return;
        const previous = unreadState.current.value;
        unreadState.current = { etag: response.headers.get("ETag"), value, checkedAt: Date.now() };
        if (!previous || previous.revision !== value.revision || previous.readRevision !== value.readRevision || previous.unreadThreads !== value.unreadThreads) setUnread(value);
        setError("");
      } catch {
        if (displayedIdentity.current === identity) setError("unavailable");
      }
    })().finally(() => { if (unreadPending.current === task) unreadPending.current = null; });
    unreadPending.current = task;
    return task;
  }, [setIdentity]);

  const refreshSession = useCallback((): Promise<void> => {
    if (sessionPending.current) return sessionPending.current;
    const task = (async () => {
      try {
        setIdentity(await feedbackRequest<FeedbackSession>("/session"));
        setError("");
        await pollUnread(true);
      } catch (reason) {
        if (reason instanceof FeedbackRequestError && reason.status === 401) setIdentity({ identity: null, configured: true });
        else if (reason instanceof FeedbackRequestError && reason.status === 503 && !displayedIdentity.current) setIdentity({ identity: null, configured: false });
        else setError("unavailable");
      } finally { setLoading(false); }
    })().finally(() => { if (sessionPending.current === task) sessionPending.current = null; });
    sessionPending.current = task;
    return task;
  }, [pollUnread, setIdentity]);

  useEffect(() => {
    queueMicrotask(() => { void refreshSession(); });
    const focus = () => { if (document.visibilityState === "visible") void pollUnread(); };
    const interval = window.setInterval(focus, 30000);
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [refreshSession, pollUnread]);

  const storeDetail = useCallback((id: string, entry: ThreadDetail) => {
    const next = new Map(detailState.current);
    next.delete(id); next.set(id, entry);
    while (next.size > 8) next.delete(next.keys().next().value!);
    detailState.current = next;
    setDetails(next);
  }, []);

  const replaceThread = useCallback((thread: FeedbackThread, identity: string) => {
    if (!displayedIdentity.current || displayedIdentity.current !== identity) return false;
    detailRequests.current.get(thread.id)?.abort();
    detailRequests.current.delete(thread.id);
    storeDetail(thread.id, { thread, loading: false, revision: unreadState.current.value?.revision });
    return true;
  }, [storeDetail]);

  const loadThread = useCallback(async (id: string, force = false) => {
    const identity = displayedIdentity.current, revision = unreadState.current.value?.revision;
    if (!identity) return;
    const previous = detailState.current.get(id), previousRequest = detailRequests.current.get(id);
    if (!force && previous?.revision === revision && (previousRequest || previous?.thread)) return;
    previousRequest?.abort();
    const controller = new AbortController();
    detailRequests.current.set(id, controller);
    storeDetail(id, { thread: previous?.thread, loading: true, revision });
    try {
      const data = await feedbackRequest<{ thread: FeedbackThread }>(`/threads/${encodeURIComponent(id)}`, undefined, "GET", controller.signal);
      if (displayedIdentity.current === identity && detailRequests.current.get(id) === controller) storeDetail(id, { thread: data.thread, loading: false, revision });
    } catch (reason) {
      if (displayedIdentity.current === identity && detailRequests.current.get(id) === controller) {
        const error = reason instanceof FeedbackRequestError ? reason.status : 0;
        storeDetail(id, { thread: error === 404 || error === 403 ? undefined : previous?.thread, loading: false, error, revision });
      }
    } finally {
      if (detailRequests.current.get(id) === controller) detailRequests.current.delete(id);
    }
  }, [storeDetail]);

  const refresh = useCallback(() => {
    const pending = unreadPending.current;
    return pending ? pending.then(() => pollUnread(true)) : pollUnread(true);
  }, [pollUnread]);
  const markRead = useCallback(async (thread: FeedbackThread) => {
    const identity = displayedIdentity.current;
    const ids = thread.messages.map(message => message.id), key = `${identity}:${thread.id}:${ids.join(",")}`;
    if (!identity || !thread.unread || readPending.current.has(key) || !ids.length) return;
    readPending.current.add(key);
    try {
      for (let index = 0; index < ids.length; index += 2000) {
        const batch = ids.slice(index, index + 2000);
        await feedbackRequest(`/threads/${encodeURIComponent(thread.id)}/read`, { messageId: batch.at(-1), messageIds: batch });
      }
      if (displayedIdentity.current !== identity) return;
      const current = detailState.current.get(thread.id);
      const shown = new Set(ids);
      // 只标记实际显示的消息，保留同时收到的新回复。
      if (current?.thread?.messages.every(message => shown.has(message.id))) storeDetail(thread.id, { ...current, thread: { ...current.thread, unread: false } });
      await refresh();
    } catch {
      // 未写入成功时下次打开仍可标记。
    } finally { readPending.current.delete(key); }
  }, [refresh, storeDetail]);
  const close = useCallback(() => { setTarget(null); requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus({ preventScroll: true })); }, []);
  const open = useCallback((context?: FeedbackContext, threadId?: string, locale?: FeedbackLocale) => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setTarget({ context: context ?? currentPage(), threadId, locale }); }, []);
  const value = useMemo(() => ({ session, unread, details, loading, error, refresh, refreshSession, open, close, replaceThread, markRead, loadThread }),
    [session, unread, details, loading, error, refresh, refreshSession, open, close, replaceThread, markRead, loadThread]);
  return <Feedback.Provider value={value}>{children}
    {!pathname?.startsWith("/consultation") && !pathname?.startsWith("/feedback") && <div className="feedback-floating"><FeedbackEntry locale={locale} /></div>}
    {target && <div className="feedback-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><FeedbackPanel key={`${feedbackContextKey(target.context)}:${target.threadId ?? ""}`} context={target.context} threadId={target.threadId} onClose={close} locale={target.locale ?? (pathname?.startsWith("/consultation") ? "ja" : locale)} /></div>}
  </Feedback.Provider>;
}

export function useFeedbackThread(id: string) {
  const { session, unread, details, loadThread } = useFeedback();
  const identity = session?.identity?.id, revision = unread?.revision;
  useEffect(() => {
    if (!identity || !id || revision === undefined) return;
    let active = true;
    queueMicrotask(() => { if (active) void loadThread(id); });
    return () => { active = false; };
  }, [id, identity, revision, loadThread]);
  return { ...(identity && id ? details.get(id) : undefined), retry: () => void loadThread(id, true) };
}

type SummaryState = { key: string; page?: FeedbackSummaryPage; loading: boolean; error: boolean };
export function useFeedbackSummaries(params: Record<string, string> | null, complete = false) {
  const { session, unread } = useFeedback();
  const search = params ? new URLSearchParams(params).toString() : "";
  const identity = params ? session?.identity?.id : undefined;
  const key = identity && unread ? `${identity}:${search}` : "";
  const [state, setState] = useState<SummaryState>({ key: "", loading: false, error: false });
  const active = useRef<AbortController | null>(null);
  const run = useCallback(async (previous?: FeedbackSummaryPage) => {
    if (!key) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState(value => ({ key, page: value.key === key ? value.page : undefined, loading: true, error: false }));
    const read = (cursor?: string | null) => {
      const query = new URLSearchParams(search);
      if (cursor) query.set("cursor", cursor);
      return feedbackRequest<FeedbackSummaryPage>(`/summaries?${query}`, undefined, "GET", controller.signal);
    };
    const collect = async (before?: FeedbackSummaryPage) => {
      let page = await read(before?.nextCursor);
      if (before && page.revision !== before.revision) throw new FeedbackRequestError(409);
      const items = [...(before?.items ?? []), ...page.items];
      if (complete) while (page.nextCursor) {
        const next = await read(page.nextCursor);
        if (next.revision !== page.revision) throw new FeedbackRequestError(409);
        items.push(...next.items);
        page = next;
      }
      return { ...page, items };
    };
    try {
      let page: FeedbackSummaryPage;
      try {
        page = await collect(previous);
      } catch (reason) {
        if (!(reason instanceof FeedbackRequestError && reason.status === 409)) throw reason;
        page = await collect();
      }
      if (!controller.signal.aborted) setState({ key, page, loading: false, error: false });
    } catch {
      if (!controller.signal.aborted) setState(value => ({ key, page: value.key === key ? value.page : undefined, loading: false, error: true }));
    } finally {
      if (active.current === controller) active.current = null;
    }
  }, [complete, key, search]);
  const revision = unread?.revision, readRevision = unread?.readRevision;
  useEffect(() => {
    let activeEffect = true;
    queueMicrotask(() => { if (activeEffect) void run(); });
    return () => { activeEffect = false; active.current?.abort(); };
  }, [revision, readRevision, run]);
  const current = state.key === key && key ? state : undefined;
  return {
    page: current?.page, error: Boolean(current?.error), loading: Boolean(identity && (!current || current.loading)),
    retry: () => void run(),
    more: () => { if (!active.current && current?.page?.nextCursor) void run(current.page); },
  };
}

export function FeedbackDetailStatus({ detail, locale }: { detail: ReturnType<typeof useFeedbackThread>; locale: FeedbackLocale }) {
  if (detail.error === undefined) return <p role="status">{feedbackText(locale, "コメントを読み込んでいます…", "正在读取留言…")}</p>;
  return <p className="feedback-notice" role="status">{detail.error === 404 ? feedbackText(locale, "このコメントは見つかりませんでした。", "未找到这条留言。") : feedbackText(locale, "コメントを読み込めませんでした。", "暂时无法读取留言。")} <button onClick={detail.retry}>{feedbackText(locale, "もう一度確認", "重试")}</button></p>;
}

export function FeedbackEntry({ locale: explicitLocale, context }: { locale?: FeedbackLocale; context?: FeedbackContext }) {
  const { locale: uiLocale } = useUiLocale();
  const locale = explicitLocale ?? uiLocale;
  const { unread, open } = useFeedback();
  const count = unread?.unreadThreads ?? 0;
  const content = <>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M7 9h10M7 13h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg><span>{count ? feedbackText(locale, `新しい返信 ${count}件`, `${count} 条新回复`) : feedbackText(locale, "コメント・返信", "老师交流与回复")}</span>
  </>;
  return count
    ? <Link className="feedback-entry" href="/feedback?filter=unread" prefetch={false}>{content}</Link>
    : <button type="button" className="feedback-entry" onClick={() => open(context, undefined, locale)}>{content}</button>;
}

export function FeedbackLogin({ locale = "ja" }: { locale?: FeedbackLocale }) {
  const { session, refreshSession, loading } = useFeedback();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [ownerKey, setOwnerKey] = useState("");
  const [ownerMode, setOwnerMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { try { const saved = localStorage.getItem("feedback:display-name"); if (saved) queueMicrotask(() => setName(saved)); } catch {} }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await feedbackRequest<FeedbackSession>("/session", ownerMode ? { ownerKey } : { name: name.trim(), code });
      if (!ownerMode) { try { localStorage.setItem("feedback:display-name", name.trim()); } catch {} }
      setCode(""); setOwnerKey(""); await refreshSession();
    } catch (reason) {
      if (reason instanceof FeedbackRequestError && reason.status === 429) setError(feedbackText(locale, "入力の回数が多くなっています。しばらくしてからお試しください。", "尝试次数较多，请稍后重试。"));
      else if (reason instanceof FeedbackRequestError && [401, 403].includes(reason.status)) setError(ownerMode ? feedbackText(locale, "管理キーをご確認ください。もう一度お試しいただけます。", "请核对本人管理密钥后重试。") : feedbackText(locale, "お名前とアクセスコードをご確認ください。もう一度お試しいただけます。", "请核对姓名和访问码后重试。"));
      else if (reason instanceof FeedbackRequestError && reason.status === 400) setError(feedbackText(locale, "お名前と入力内容をご確認ください。", "请检查姓名和输入内容。"));
      else setError(feedbackText(locale, "ただいま接続できません。入力内容は残っています。しばらくしてから、もう一度お試しください。", "暂时无法连接，输入内容已保留，请稍后重试。"));
    } finally { setBusy(false); }
  }
  if (loading && session === null) return <p className="feedback-notice" role="status">{feedbackText(locale, "コメントの準備をしています…", "正在准备交流区…")}</p>;
  if (session && !session.configured) return <div className="feedback-notice"><h3>{feedbackText(locale, "コメントの受付を準備しています", "交流区正在准备中")}</h3><p>{feedbackText(locale, "資料はそのままお読みいただけます。しばらくしてから、もう一度お試しください。", "资料仍可正常阅读，请稍后重试留言。")}</p><button onClick={() => void refreshSession()}>{feedbackText(locale, "もう一度確認", "重新检查")}</button></div>;
  return <form className="feedback-login" onSubmit={submit}>
    <p className="feedback-eyebrow">{feedbackText(locale, "先生方と本人の交流", "老师与本人的共享交流区")}</p>
    <h3>{feedbackText(locale, "コメント・返信を見る", "进入交流区")}</h3>
    <p>{feedbackText(locale, "登録は不要です。同じ端末・ブラウザでは、次回から入力を省略できます。", "无需注册。同一设备与浏览器会记住身份 30 天。")}</p>
    {ownerMode ? <label>{feedbackText(locale, "本人用の管理キー", "本人管理密钥")}<input autoComplete="off" type="password" value={ownerKey} onChange={event => setOwnerKey(event.target.value)} required /></label> : <>
      <label>{feedbackText(locale, "お名前（コメントに表示されます）", "姓名（显示在留言中）")}<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></label>
      <label>{feedbackText(locale, "共有されたアクセスコード", "收到的共用访问码")}<input autoComplete="off" type="password" value={code} onChange={event => setCode(event.target.value)} required /></label>
    </>}
    <p className="feedback-sharing">{feedbackText(locale, "先生方と本人に共有されます。", "内容对受邀老师和本人共同可见。")}</p>
    {error && <p className="feedback-error" role="alert">{error}</p>}
    <button className="feedback-primary" type="submit" disabled={busy}>{busy ? feedbackText(locale, "確認しています…", "正在验证…") : feedbackText(locale, "交流を開く", "进入交流区")}</button>
    <button type="button" className="feedback-link-button" onClick={() => { setOwnerMode(value => !value); setError(""); }}>{ownerMode ? feedbackText(locale, "先生の入口に戻る", "返回老师入口") : feedbackText(locale, "本人の管理用入口", "本人管理入口")}</button>
  </form>;
}

function draftRead(key: string): { id: string; text: string } | null {
  try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value && typeof value.id === "string" && typeof value.text === "string" ? value : null; } catch { return null; }
}

export function FeedbackComposer({ context, thread, locale = "ja", onSaved }: { context: FeedbackContext; thread?: FeedbackThread; locale?: FeedbackLocale; onSaved: (thread: FeedbackThread) => void }) {
  const { session, refresh, replaceThread } = useFeedback();
  // 会话更新后参与者 ID 可能变化；同一浏览器按显示名恢复草稿，避免重新输入访问码后丢字。
  const draftKey = `feedback:draft:${session?.identity?.role === "owner" ? "owner" : session?.identity?.name ?? "anonymous"}:${thread?.id ?? feedbackContextKey(context)}`;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const submission = useRef<{ id: string; text: string } | null>(null);
  useEffect(() => {
    const saved = draftRead(draftKey);
    queueMicrotask(() => { setText(saved?.text ?? ""); setError(""); setSuccess(false); submission.current = saved; });
  }, [draftKey]);
  function update(value: string) {
    setText(value); setSuccess(false);
    if (!submission.current || submission.current.text !== value) submission.current = { id: crypto.randomUUID(), text: value };
    try { localStorage.setItem(draftKey, JSON.stringify(submission.current)); } catch {}
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const identity = session?.identity?.id;
    if (!identity || !text.trim() || busy) return;
    setBusy(true); setError(""); setSuccess(false);
    const attempt = submission.current?.text === text ? submission.current : { id: crypto.randomUUID(), text };
    submission.current = attempt;
    try { localStorage.setItem(draftKey, JSON.stringify(attempt)); } catch {}
    try {
      const result = await feedbackRequest<{ thread: FeedbackThread }>(thread ? `/threads/${encodeURIComponent(thread.id)}/replies` : "/threads", thread ? { id: attempt.id, text: text.trim() } : { id: attempt.id, text: text.trim(), context });
      const verified = await feedbackRequest<{ thread: FeedbackThread }>(`/threads/${encodeURIComponent(result.thread.id)}`);
      const applied = replaceThread(verified.thread, identity);
      setText(""); submission.current = null; setSuccess(true);
      try { localStorage.removeItem(draftKey); } catch {}
      if (applied) { onSaved(verified.thread); void refresh(); }
    } catch (reason) {
      if (reason instanceof FeedbackRequestError && reason.status === 401) void refresh();
      setError(feedbackText(locale, "送信できませんでした。入力内容は残っています。", "发送失败，输入内容已保留。"));
    } finally { setBusy(false); }
  }
  return <form className="feedback-composer" onSubmit={submit}>
    {!thread && <FeedbackQuote context={context} locale={locale} />}
    <label>{thread ? feedbackText(locale, "返信を書く", "写下回复") : feedbackText(locale, "コメント・ご質問", "建议或问题")}
      <textarea value={text} onChange={event => update(event.target.value)} rows={5} maxLength={5000} required placeholder={feedbackText(locale, "気になる点や、ご質問をお書きください。短いコメントでも大丈夫です。", "请写下建议或问题，一句话也可以。")} />
    </label>
    <p className="feedback-sharing">{feedbackText(locale, "先生方と本人に共有されます", "对受邀老师与本人共同可见")}</p>
    {error && <p className="feedback-error" role="alert">{error}</p>}
    {success && <p className="feedback-success" role="status">{feedbackText(locale, "コメントを送信しました。", "留言已发送。")}</p>}
    <button type="submit" className="feedback-primary" disabled={busy || !text.trim()}>{busy ? feedbackText(locale, "送信しています…", "正在发送…") : error ? feedbackText(locale, "もう一度送信", "重新发送") : thread ? feedbackText(locale, "返信を送信", "发送回复") : feedbackText(locale, "送信", "发送")}</button>
  </form>;
}

export function feedbackSourceHref(thread: FeedbackThread): string {
  const url = new URL(thread.context.pagePath, "https://feedback.invalid");
  if (thread.context.sessionId) url.searchParams.set("feedbackThread", thread.id);
  if (thread.context.blockId) url.hash = `transcript-block-${thread.context.blockId}`;
  return url.pathname + url.search + url.hash;
}

export function FeedbackQuote({ context, locale = "ja" }: { context: FeedbackContext; locale?: FeedbackLocale }) {
  return <div className="feedback-reference"><p className="feedback-eyebrow">{context.quote ? feedbackText(locale, "この部分について", "针对这段原文") : feedbackText(locale, "相談する資料", "关联页面")}</p><strong>{context.company ? `${context.company} · ` : ""}{context.title}</strong>{context.quote && <blockquote>{context.quote}</blockquote>}</div>;
}

export function FeedbackThreadDetail({ thread, locale = "ja", context }: { thread: FeedbackThread; locale?: FeedbackLocale; context?: FeedbackContext }) {
  const { session, markRead, refresh, replaceThread } = useFeedback();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const patchAttempt = useRef<{ id: string; key: string } | null>(null);
  useEffect(() => { void markRead(thread); }, [thread, markRead]);
  async function patch(body: { state?: FeedbackThread["state"]; hidden?: boolean }) {
    const identity = session?.identity?.id;
    if (!identity || busy) return;
    const key = JSON.stringify(body);
    const attempt = patchAttempt.current?.key === key ? patchAttempt.current : { id: crypto.randomUUID(), key };
    patchAttempt.current = attempt;
    setBusy(true); setNotice("");
    try {
      const result = await feedbackRequest<{ thread: FeedbackThread }>(`/threads/${encodeURIComponent(thread.id)}`, { ...body, operationId: attempt.id }, "PATCH");
      patchAttempt.current = null;
      if (replaceThread(result.thread, identity)) await refresh();
    }
    catch { setNotice(feedbackText(locale, "変更できませんでした。もう一度お試しください。", "修改失败，请重试。")); }
    finally { setBusy(false); }
  }
  const stale = Boolean(context?.revision && thread.context.revision && context.revision !== thread.context.revision && context.blockId === thread.context.blockId && context.turnId === thread.context.turnId);
  return <div className="feedback-thread-detail">
    <FeedbackQuote context={thread.context} locale={locale} />
    {stale && <p className="feedback-notice">{feedbackText(locale, "元の資料が更新されています。送信時の原文を表示しています。", "原资料已更新，这里保留的是发送时的原文。")}</p>}
    <a className="feedback-source-link" href={feedbackSourceHref(thread)}>{feedbackText(locale, "原文を見る", "查看原文")} ↗</a>
    <div className="feedback-messages">{thread.messages.map(message => <article className={`feedback-message${message.author.role === "owner" ? " feedback-message-owner" : ""}`} key={message.id}><header><strong>{message.author.name}</strong><span>{message.author.role === "owner" ? feedbackText(locale, "本人", "本人") : feedbackText(locale, "先生", "老师")}</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(locale === "ja" ? "ja-JP" : "zh-CN", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></header><p>{message.text}</p></article>)}</div>
    {session?.identity?.role === "owner" && <div className="feedback-owner-actions"><label>{feedbackText(locale, "取り組み状況", "处理状态")}<select disabled={busy} value={thread.state} onChange={event => void patch({ state: event.target.value as FeedbackThread["state"] })}><option value="open">{feedbackText(locale, "未対応", "未处理")}</option><option value="working">{feedbackText(locale, "取り組み中", "跟进中")}</option><option value="done">{feedbackText(locale, "対応済み", "已处理")}</option></select></label><button disabled={busy} onClick={() => void patch({ hidden: !thread.hidden })}>{thread.hidden ? feedbackText(locale, "表示を戻す", "恢复显示") : feedbackText(locale, "この相談を非表示にする", "隐藏这个话题")}</button>{notice && <p role="alert" className="feedback-error">{notice}</p>}</div>}
    {!thread.hidden && <FeedbackComposer key={thread.id} context={thread.context} thread={thread} locale={locale} onSaved={() => {}} />}
  </div>;
}

export function FeedbackPanel({ context, threadId, onClose, locale: explicitLocale, inline = false }: { context?: FeedbackContext; threadId?: string; onClose: () => void; locale?: FeedbackLocale; inline?: boolean }) {
  const { locale: uiLocale } = useUiLocale();
  const locale = explicitLocale ?? uiLocale;
  const { session, error, refresh } = useFeedback();
  const pageContext = context ?? { pagePath: "/feedback", title: feedbackText(locale, "全体への相談", "一般咨询") };
  const scope = feedbackContextKey(pageContext);
  const [selection, setSelection] = useState<{ scope: string; id: string }>({ scope, id: threadId ?? "" });
  const selectedId = selection.scope === scope ? selection.id : threadId ?? "";
  const detail = useFeedbackThread(selectedId);
  const related = useFeedbackSummaries(selectedId ? null : pageContext.sessionId
    ? { sessionId: pageContext.sessionId, ...(pageContext.blockId ? { blockId: pageContext.blockId } : {}) }
    : { page: pageContext.pagePath });
  const matching = related.page?.items ?? [];
  const [confirmed, setConfirmed] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  return <aside className={`feedback-panel${inline ? " feedback-panel-inline" : ""}`} ref={panel} tabIndex={-1} role={inline ? "complementary" : "dialog"} aria-modal={inline ? undefined : true} aria-label={feedbackText(locale, "コメント・返信", "老师交流与回复")} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (!inline && event.key === "Tab") {
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="feedback-panel-header"><div><p className="feedback-eyebrow">{feedbackText(locale, "先生方と本人の交流", "老师与本人的交流")}</p><h2>{feedbackText(locale, "コメント・返信", "留言与回复")}</h2></div><button onClick={onClose} aria-label={feedbackText(locale, "コメントを閉じる", "关闭留言面板")}>{feedbackText(locale, "閉じる", "关闭")} ×</button></header>
    <div className="feedback-panel-body">
      {!session?.identity ? <FeedbackLogin locale={locale} /> : <>
        <div className="feedback-panel-account"><span>{session.identity.name}</span><Link href="/feedback">{feedbackText(locale, "すべての相談", "全部交流")} →</Link></div>
        {error && <p className="feedback-notice" role="status">{feedbackText(locale, "最新のコメントを確認できませんでした。", "暂时无法更新留言。")}<button onClick={() => void refresh()}>{feedbackText(locale, "もう一度確認", "重试")}</button></p>}
        {selectedId ? <><button className="feedback-link-button" onClick={() => { setSelection({ scope, id: "" }); setConfirmed(false); }}>← {feedbackText(locale, "この資料のコメント", "当前资料的留言")}</button>{confirmed && <p className="feedback-success" role="status">{feedbackText(locale, "コメントを送信しました。", "留言已发送。")}</p>}{detail.thread && <FeedbackThreadDetail thread={detail.thread} locale={locale} context={pageContext} />}{(!detail.thread || detail.error !== undefined) && <FeedbackDetailStatus detail={detail} locale={locale} />}</> : <>
          <FeedbackComposer key={`${scope}:${session.identity.id}`} context={pageContext} locale={locale} onSaved={saved => { setSelection({ scope, id: saved.id }); setConfirmed(true); }} />
          <section className="feedback-related">
            <h3>{feedbackText(locale, "この資料のコメント", "当前资料的留言")} <span>{related.page?.total ?? ""}</span></h3>
            {matching.map(item => <button className="feedback-related-item" key={item.id} onClick={() => { setSelection({ scope, id: item.id }); setConfirmed(false); }}><strong>{item.preview}</strong><span>{item.createdBy.name} · {item.messageCount} {feedbackText(locale, "件", "条")}{item.unread ? ` · ${feedbackText(locale, "新しい返信", "新回复")}` : ""}</span></button>)}
            {related.error ? <button className="feedback-link-button" onClick={related.retry}>{feedbackText(locale, "一覧をもう一度確認", "重试读取留言列表")}</button>
              : !matching.length && <p role="status">{related.loading ? feedbackText(locale, "読み込んでいます…", "正在读取…") : feedbackText(locale, "まだコメントはありません。一言からどうぞ。", "还没有留言，欢迎写下第一条建议。")}</p>}
            {related.page?.nextCursor && <button className="feedback-link-button" disabled={related.loading} onClick={related.more}>{feedbackText(locale, "さらに見る", "查看更多")}</button>}
          </section>
        </>}
      </>}
    </div>
  </aside>;
}

export function FeedbackHelp({ locale = "ja", onClose, mode = "library" }: { locale?: FeedbackLocale; onClose?: () => void; mode?: TeacherTourMode }) {
  return <TeacherTour mode={mode} locale={locale} active onClose={onClose} />;
}
