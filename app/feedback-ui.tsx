"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { feedbackContextKey, type FeedbackContext, type FeedbackSession, type FeedbackThread } from "@/lib/feedback";
import { useUiLocale } from "./ui-locale";
import { TeacherTour, type TeacherTourMode } from "./feedback-tour";
import "./feedback.css";

export type FeedbackLocale = "ja" | "zh-CN";
export const feedbackText = (locale: FeedbackLocale, ja: string, zh: string) => locale === "ja" ? ja : zh;
type DrawerTarget = { context: FeedbackContext; threadId?: string; locale?: FeedbackLocale };
type FeedbackValue = {
  session: FeedbackSession | null; threads: FeedbackThread[]; loading: boolean; error: string;
  refresh: () => Promise<void>; open: (context?: FeedbackContext, threadId?: string, locale?: FeedbackLocale) => void;
  close: () => void; replaceThread: (thread: FeedbackThread) => void;
  markRead: (thread: FeedbackThread) => Promise<void>;
};
const emptyFeedback: FeedbackValue = { session: null, threads: [], loading: false, error: "", refresh: async () => {}, open: () => {}, close: () => {}, replaceThread: () => {}, markRead: async () => {} };
const Feedback = createContext<FeedbackValue>(emptyFeedback);
export const useFeedback = () => useContext(Feedback);

export class FeedbackRequestError extends Error {
  constructor(public status: number) { super(`Feedback request failed (${status})`); }
}
export async function feedbackRequest<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const response = await fetch(`/api/feedback${path}`, {
    method, cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(20000),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
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
  const [threads, setThreads] = useState<FeedbackThread[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const requestGeneration = useRef(0);
  const displayedIdentity = useRef<string | null>(null);
  const readPending = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    try {
      const next = await feedbackRequest<FeedbackSession>("/session");
      if (generation !== requestGeneration.current) return;
      if (displayedIdentity.current !== (next.identity?.id ?? null)) {
        // 身份变化时不能沿用上一位参与者的私密列表；同一身份暂时断线则保留已读资料。
        displayedIdentity.current = next.identity?.id ?? null; setThreads([]); readPending.current.clear();
      }
      setSession(next);
      if (next.identity) {
        const data = await feedbackRequest<{ threads: FeedbackThread[] }>("/threads");
        if (generation === requestGeneration.current) setThreads(data.threads);
      } else setThreads([]);
      if (generation === requestGeneration.current) setError("");
    } catch (reason) {
      if (generation !== requestGeneration.current) return;
      if (reason instanceof FeedbackRequestError && reason.status === 401) {
        displayedIdentity.current = null; readPending.current.clear(); setSession({ identity: null, configured: true }); setThreads([]);
      } else if (reason instanceof FeedbackRequestError && reason.status === 503) {
        displayedIdentity.current = null; readPending.current.clear(); setSession({ identity: null, configured: false }); setThreads([]);
      } else setError("unavailable");
    } finally { if (generation === requestGeneration.current) setLoading(false); }
  }, []);
  const cancelRequests = useCallback(() => { ++requestGeneration.current; }, []);
  useEffect(() => {
    queueMicrotask(() => { void refresh(); });
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(focus, 30000);
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { cancelRequests(); window.clearInterval(interval); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [refresh, cancelRequests]);
  const replaceThread = useCallback((thread: FeedbackThread) => {
    setThreads(previous => [...previous.filter(item => item.id !== thread.id), thread].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, []);
  const markRead = useCallback(async (thread: FeedbackThread) => {
    const key = `${displayedIdentity.current}:${thread.id}:${thread.messages.map(message => message.id).join(",")}`;
    if (!thread.unread || readPending.current.has(key) || !thread.messages.length) return;
    readPending.current.add(key);
    try {
      const ids = thread.messages.map(message => message.id);
      for (let index = 0; index < ids.length; index += 2000) {
        await feedbackRequest(`/threads/${encodeURIComponent(thread.id)}/read`, { messageId: ids[Math.min(index + 1999, ids.length - 1)], messageIds: ids.slice(index, index + 2000) });
      }
      // 只比较实际显示的消息，不能把标记过程中刚收到的回复一起判成已读。
      setThreads(previous => previous.map(item => item.id === thread.id && item.messages.every(message => ids.includes(message.id)) ? { ...item, unread: false } : item));
    } catch { readPending.current.delete(key); }
  }, []);
  const close = useCallback(() => { setTarget(null); requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus({ preventScroll: true })); }, []);
  const open = useCallback((context?: FeedbackContext, threadId?: string, locale?: FeedbackLocale) => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setTarget({ context: context ?? currentPage(), threadId, locale }); }, []);
  const value = useMemo(() => ({ session, threads, loading, error, refresh, open, close, replaceThread, markRead }), [session, threads, loading, error, refresh, open, close, replaceThread, markRead]);
  return <Feedback.Provider value={value}>{children}
    {!pathname?.startsWith("/consultation") && !pathname?.startsWith("/feedback") && <div className="feedback-floating"><FeedbackEntry locale={locale} /></div>}
    {target && <div className="feedback-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><FeedbackPanel key={`${feedbackContextKey(target.context)}:${target.threadId ?? ""}`} context={target.context} threadId={target.threadId} onClose={close} locale={target.locale ?? (pathname?.startsWith("/consultation") ? "ja" : locale)} /></div>}
  </Feedback.Provider>;
}

export function FeedbackEntry({ locale: explicitLocale, context }: { locale?: FeedbackLocale; context?: FeedbackContext }) {
  const { locale: uiLocale } = useUiLocale();
  const locale = explicitLocale ?? uiLocale;
  const { threads, open } = useFeedback();
  const count = threads.filter(thread => thread.unread && !thread.hidden).length;
  return <button type="button" className="feedback-entry" onClick={() => count ? window.location.assign("/feedback?filter=unread") : open(context, undefined, locale)}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M7 9h10M7 13h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg><span>{count ? feedbackText(locale, `新しい返信 ${count}件`, `${count} 条新回复`) : feedbackText(locale, "コメント・返信", "老师交流与回复")}</span>
  </button>;
}

export function FeedbackLogin({ locale = "ja" }: { locale?: FeedbackLocale }) {
  const { session, refresh, loading } = useFeedback();
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
      setCode(""); setOwnerKey(""); await refresh();
    } catch (reason) {
      if (reason instanceof FeedbackRequestError && reason.status === 429) setError(feedbackText(locale, "入力の回数が多くなっています。しばらくしてからお試しください。", "尝试次数较多，请稍后重试。"));
      else if (reason instanceof FeedbackRequestError && [401, 403].includes(reason.status)) setError(ownerMode ? feedbackText(locale, "管理キーをご確認ください。もう一度お試しいただけます。", "请核对本人管理密钥后重试。") : feedbackText(locale, "お名前とアクセスコードをご確認ください。もう一度お試しいただけます。", "请核对姓名和访问码后重试。"));
      else if (reason instanceof FeedbackRequestError && reason.status === 400) setError(feedbackText(locale, "お名前と入力内容をご確認ください。", "请检查姓名和输入内容。"));
      else setError(feedbackText(locale, "ただいま接続できません。入力内容は残っています。しばらくしてから、もう一度お試しください。", "暂时无法连接，输入内容已保留，请稍后重试。"));
    } finally { setBusy(false); }
  }
  if (loading && session === null) return <p className="feedback-notice" role="status">{feedbackText(locale, "コメントの準備をしています…", "正在准备交流区…")}</p>;
  if (session && !session.configured) return <div className="feedback-notice"><h3>{feedbackText(locale, "コメントの受付を準備しています", "交流区正在准备中")}</h3><p>{feedbackText(locale, "資料はそのままお読みいただけます。しばらくしてから、もう一度お試しください。", "资料仍可正常阅读，请稍后重试留言。")}</p><button onClick={() => void refresh()}>{feedbackText(locale, "もう一度確認", "重新检查")}</button></div>;
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
    event.preventDefault(); if (!text.trim() || busy) return;
    setBusy(true); setError(""); setSuccess(false);
    const attempt = submission.current?.text === text ? submission.current : { id: crypto.randomUUID(), text };
    submission.current = attempt;
    try { localStorage.setItem(draftKey, JSON.stringify(attempt)); } catch {}
    try {
      const result = await feedbackRequest<{ thread: FeedbackThread }>(thread ? `/threads/${encodeURIComponent(thread.id)}/replies` : "/threads", thread ? { id: attempt.id, text: text.trim() } : { id: attempt.id, text: text.trim(), context });
      const verified = await feedbackRequest<{ thread: FeedbackThread }>(`/threads/${encodeURIComponent(result.thread.id)}`);
      replaceThread(verified.thread); setText(""); submission.current = null; setSuccess(true);
      try { localStorage.removeItem(draftKey); } catch {}
      onSaved(verified.thread); void refresh();
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
  const messagesKey = thread.messages.map(message => message.id).join(",");
  useEffect(() => { void markRead(thread); }, [thread, messagesKey, markRead]);
  async function patch(body: { state?: FeedbackThread["state"]; hidden?: boolean }) {
    setNotice("");
    try { const result = await feedbackRequest<{ thread: FeedbackThread }>(`/threads/${encodeURIComponent(thread.id)}`, body, "PATCH"); replaceThread(result.thread); await refresh(); }
    catch { setNotice(feedbackText(locale, "変更できませんでした。もう一度お試しください。", "修改失败，请重试。")); }
  }
  const stale = Boolean(context?.revision && thread.context.revision && context.revision !== thread.context.revision && context.blockId === thread.context.blockId && context.turnId === thread.context.turnId);
  return <div className="feedback-thread-detail">
    <FeedbackQuote context={thread.context} locale={locale} />
    {stale && <p className="feedback-notice">{feedbackText(locale, "元の資料が更新されています。送信時の原文を表示しています。", "原资料已更新，这里保留的是发送时的原文。")}</p>}
    <a className="feedback-source-link" href={feedbackSourceHref(thread)}>{feedbackText(locale, "原文を見る", "查看原文")} ↗</a>
    <div className="feedback-messages">{thread.messages.map(message => <article className={`feedback-message${message.author.role === "owner" ? " feedback-message-owner" : ""}`} key={message.id}><header><strong>{message.author.name}</strong><span>{message.author.role === "owner" ? feedbackText(locale, "本人", "本人") : feedbackText(locale, "先生", "老师")}</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(locale === "ja" ? "ja-JP" : "zh-CN", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></header><p>{message.text}</p></article>)}</div>
    {session?.identity?.role === "owner" && <div className="feedback-owner-actions"><label>{feedbackText(locale, "取り組み状況", "处理状态")}<select value={thread.state} onChange={event => void patch({ state: event.target.value as FeedbackThread["state"] })}><option value="open">{feedbackText(locale, "未対応", "未处理")}</option><option value="working">{feedbackText(locale, "取り組み中", "跟进中")}</option><option value="done">{feedbackText(locale, "対応済み", "已处理")}</option></select></label><button onClick={() => void patch({ hidden: !thread.hidden })}>{thread.hidden ? feedbackText(locale, "表示を戻す", "恢复显示") : feedbackText(locale, "この相談を非表示にする", "隐藏这个话题")}</button>{notice && <p role="alert" className="feedback-error">{notice}</p>}</div>}
    {!thread.hidden && <FeedbackComposer key={thread.id} context={thread.context} thread={thread} locale={locale} onSaved={() => {}} />}
  </div>;
}

export function FeedbackPanel({ context, threadId, onClose, locale: explicitLocale, inline = false }: { context?: FeedbackContext; threadId?: string; onClose: () => void; locale?: FeedbackLocale; inline?: boolean }) {
  const { locale: uiLocale } = useUiLocale();
  const locale = explicitLocale ?? uiLocale;
  const { session, threads, error, refresh, replaceThread } = useFeedback();
  const pageContext = context ?? { pagePath: "/feedback", title: feedbackText(locale, "全体への相談", "一般咨询") };
  const scope = feedbackContextKey(pageContext);
  const [selection, setSelection] = useState<{ scope: string; id: string }>({ scope, id: threadId ?? "" });
  const selectedId = selection.scope === scope ? selection.id : threadId ?? "";
  const thread = threads.find(item => item.id === selectedId);
  const [missing, setMissing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (!session?.identity || !selectedId || thread) return;
    let active = true;
    feedbackRequest<{ thread: FeedbackThread }>(`/threads/${encodeURIComponent(selectedId)}`).then(data => { if (active) replaceThread(data.thread); }).catch(() => { if (active) setMissing(true); });
    return () => { active = false; };
  }, [selectedId, thread, session?.identity, replaceThread]);
  const matching = threads.filter(item => !item.hidden && (pageContext.sessionId ? item.context.sessionId === pageContext.sessionId && (!pageContext.blockId || item.context.blockId === pageContext.blockId) : item.context.pagePath === pageContext.pagePath));
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
        {selectedId ? <><button className="feedback-link-button" onClick={() => { setSelection({ scope, id: "" }); setMissing(false); setConfirmed(false); }}>← {feedbackText(locale, "この資料のコメント", "当前资料的留言")}</button>{confirmed && <p className="feedback-success" role="status">{feedbackText(locale, "コメントを送信しました。", "留言已发送。")}</p>}{thread ? <FeedbackThreadDetail thread={thread} locale={locale} context={pageContext} /> : <p role="status">{missing ? feedbackText(locale, "このコメントは見つかりませんでした。", "未找到这条留言。") : feedbackText(locale, "コメントを読み込んでいます…", "正在读取留言…")}</p>}</> : <>
          <FeedbackComposer key={`${scope}:${session.identity.id}`} context={pageContext} locale={locale} onSaved={saved => { setSelection({ scope, id: saved.id }); setConfirmed(true); }} />
          <section className="feedback-related"><h3>{feedbackText(locale, "この資料のコメント", "当前资料的留言")} <span>{matching.length}</span></h3>{matching.map(item => <button className="feedback-related-item" key={item.id} onClick={() => { setSelection({ scope, id: item.id }); setConfirmed(false); }}><strong>{item.messages[0]?.text.slice(0, 90)}</strong><span>{item.createdBy.name} · {item.messages.length} {feedbackText(locale, "件", "条")}{item.unread ? ` · ${feedbackText(locale, "新しい返信", "新回复")}` : ""}</span></button>)}{!matching.length && <p>{feedbackText(locale, "まだコメントはありません。一言からどうぞ。", "还没有留言，欢迎写下第一条建议。")}</p>}</section>
        </>}
      </>}
    </div>
  </aside>;
}

export function FeedbackHelp({ locale = "ja", onClose, mode = "library" }: { locale?: FeedbackLocale; onClose?: () => void; mode?: TeacherTourMode }) {
  return <TeacherTour mode={mode} locale={locale} active onClose={onClose} />;
}
