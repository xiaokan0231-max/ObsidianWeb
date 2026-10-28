"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { FeedbackContext, FeedbackThread } from "@/lib/feedback";
import { useUiLocale } from "../ui-locale";
import { FeedbackComposer, FeedbackHelp, FeedbackLogin, FeedbackThreadDetail, feedbackRequest, feedbackText as t, useFeedback, type FeedbackLocale } from "../feedback-ui";

const GENERAL_CONTEXT: FeedbackContext = { pagePath: "/feedback", title: "全体への相談" };

function ConversationIcon({ decorative = false }: { decorative?: boolean }) {
  return <svg width={decorative ? 62 : 25} height={decorative ? 62 : 25} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8l-5.5 3v-3H5A1.5 1.5 0 0 1 3.5 16V7A1.5 1.5 0 0 1 5 5.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
}

export default function FeedbackView() {
  const { locale: uiLocale } = useUiLocale();
  const { session, threads, loading, error, refresh, replaceThread } = useFeedback();
  const locale: FeedbackLocale = session?.identity?.role === "owner" ? uiLocale : "ja";
  const [selected, setSelected] = useState("");
  const [compose, setCompose] = useState(false);
  const [help, setHelp] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [page, setPage] = useState("");
  const [author, setAuthor] = useState("");
  const [settings, setSettings] = useState(false);
  const [code, setCode] = useState("");
  const [settingNotice, setSettingNotice] = useState("");
  const [settingBusy, setSettingBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      setSelected(params.get("thread") || ""); setCompose(false);
      const incomingFilter = params.get("filter") || "all";
      setFilter(["all", "unread", "open", "working", "done", "hidden"].includes(incomingFilter) ? incomingFilter : "all");
    };
    sync(); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync);
  }, []);
  const current = threads.find(thread => thread.id === selected);
  useEffect(() => {
    if (!selected || current || !session?.identity) return;
    let active = true;
    feedbackRequest<{ thread: FeedbackThread }>(`/threads/${encodeURIComponent(selected)}`).then(data => { if (active) replaceThread(data.thread); }).catch(() => {});
    return () => { active = false; };
  }, [selected, current, session?.identity, replaceThread]);
  const owners = session?.identity?.role === "owner";
  const companies = [...new Set(threads.map(thread => thread.context.company).filter((value): value is string => Boolean(value)))].sort();
  const pages = [...new Map(threads.map(thread => [thread.context.pagePath, thread.context.title])).entries()];
  const authors = [...new Map(threads.flatMap(thread => thread.messages.map(message => [message.author.id, message.author.name] as const))).entries()];
  const visible = useMemo(() => threads.filter(thread => {
    if (filter === "hidden" ? !thread.hidden : thread.hidden) return false;
    if (filter === "unread" && !thread.unread) return false;
    if (["open", "working", "done"].includes(filter) && thread.state !== filter) return false;
    if (company && thread.context.company !== company || page && thread.context.pagePath !== page) return false;
    if (author && !thread.messages.some(message => message.author.id === author)) return false;
    const text = `${thread.context.title} ${thread.context.company ?? ""} ${thread.context.quote ?? ""} ${thread.messages.map(message => `${message.author.name} ${message.text}`).join(" ")}`.toLocaleLowerCase();
    return !query.trim() || text.includes(query.trim().toLocaleLowerCase());
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [threads, filter, company, page, author, query]);
  function choose(id: string) {
    setSelected(id); setCompose(false); setConfirmed(false);
    window.history.pushState(null, "", `/feedback?${new URLSearchParams({ thread: id })}`);
  }
  async function openSettings() {
    setSettings(value => !value); setSettingNotice("");
    try { const data = await feedbackRequest<{ accessCode: string }>("/settings"); setCode(data.accessCode); }
    catch { setSettingNotice(t(locale, "アクセスコードを確認できませんでした。", "暂时无法读取访问码。")); }
  }
  async function saveSettings() {
    setSettingBusy(true); setSettingNotice("");
    try { await feedbackRequest("/settings", { accessCode: code }, "PATCH"); setSettingNotice(t(locale, "アクセスコードを変更しました。先生方には新しいコードをご案内ください。", "访问码已更新。老师需要使用新访问码重新进入。")); }
    catch { setSettingNotice(t(locale, "変更できませんでした。もう一度お試しください。", "修改失败，请重试。")); }
    finally { setSettingBusy(false); }
  }
  return <div className="feedback-workspace" lang={locale}>
    <header className="feedback-workspace-header"><Link href="/consultation" className="feedback-workspace-brand"><span className="feedback-brand-mark" aria-hidden="true"><ConversationIcon /></span><span>Obsidian Memory Atlas<small>{t(locale, "先生方との相談・コメント", "老师交流与原文批注")}</small></span></Link><nav><button data-tour="help-entry" onClick={() => setHelp(value => !value)} aria-expanded={help}>{t(locale, "使い方", "使用方法")}</button><Link href="/consultation">{t(locale, "原稿を読む", "阅读面试原文")}</Link><Link href="/">{t(locale, "ホーム", "首页")}</Link>{owners && <button onClick={() => void openSettings()} aria-expanded={settings}>{t(locale, "アクセスコードの管理", "管理访问码")}</button>}{session?.identity && <button onClick={async () => { try { await feedbackRequest("/session", undefined, "DELETE"); await refresh(); } catch {} }}>{t(locale, "退出", "退出交流区")}</button>}</nav></header>
    <main className="feedback-workspace-main"><section className="feedback-workspace-intro"><div><p className="feedback-eyebrow">{t(locale, "原文を囲んで、少しずつ相談", "围绕原文，持续交流")}</p><h1>{t(locale, "相談・コメント", "老师交流")}</h1><p>{t(locale, "気になる点を一言から。先生方のアドバイスと本人の返信を、ここで確認できます。", "一句建议、一个问题都可以。在这里查看老师的指点、回复和改进进展。")}</p></div>{session?.identity && <button className="feedback-primary" data-tour="new-question" onClick={() => { setCompose(true); setConfirmed(false); }}>{t(locale, "新しい相談を書く", "发起新咨询")} ＋</button>}</section>
      {help && <FeedbackHelp mode="feedback" locale={locale} onClose={() => setHelp(false)} />}
      {settings && owners && <section className="feedback-settings"><h2>{t(locale, "先生方と共有するアクセスコード", "老师共用访问码")}</h2><p>{t(locale, "変更すると、先生方は新しいコードでの入力が必要になります。", "更换后，已有老师会话失效，需要重新输入新访问码。")}</p><label>{t(locale, "アクセスコード", "共用访问码")}<input value={code} minLength={8} maxLength={100} autoComplete="off" onChange={event => setCode(event.target.value)} /></label><button className="feedback-primary" disabled={settingBusy || code.trim().length < 8} onClick={() => void saveSettings()}>{settingBusy ? t(locale, "変更しています…", "正在保存…") : t(locale, "アクセスコードを変更", "保存访问码")}</button>{settingNotice && <p role="status">{settingNotice}</p>}</section>}
      {!session?.identity ? <section className="feedback-welcome"><div className="feedback-welcome-story"><div className="feedback-welcome-symbol"><ConversationIcon decorative /></div><p className="feedback-eyebrow">{t(locale, "先生方とつながる相談スペース", "与老师持续交流的空间")}</p><h2>{t(locale, "原文を読みながら、気づきを共有。", "读到哪里，就在那里交流。")}</h2><p>{t(locale, "短いご意見やご質問から。原文と一緒に、やりとりを残せます。", "一句建议、一个问题都可以，交流会与对应原文保存在一起。")}</p><Link className="feedback-read-cta" data-tour="read-materials" href="/consultation">{t(locale, "原稿を読む", "阅读面试原文")} <span aria-hidden="true">→</span></Link><p className="feedback-welcome-privacy"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6V10Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>{t(locale, "コメントは、招待された先生方と本人に共有されます。", "留言仅对受邀老师与本人共同开放。")}</p></div><div className="feedback-welcome-form" data-tour="feedback-login"><FeedbackLogin locale={locale} /></div></section> : <>
        {error && <p className="feedback-notice" role="status">{t(locale, "最新のコメントを確認できませんでした。", "暂时无法更新留言。")}<button onClick={() => void refresh()}>{t(locale, "もう一度確認", "重试")}</button></p>}
        <div className="feedback-workspace-grid"><aside className="feedback-list-panel" data-tour="discussion-list"><div className="feedback-list-heading"><strong>{t(locale, "相談の一覧", "交流列表")}</strong><span>{visible.length}</span></div><div className="feedback-filters"><label>{t(locale, "相談を探す", "搜索交流")}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t(locale, "原文・コメント・先生のお名前", "原文、留言或老师姓名")} /></label><label>{t(locale, "表示する相談", "话题范围")}<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">{t(locale, "すべて", "全部")}</option><option value="unread">{t(locale, "新しい返信", "未读")}</option><option value="open">{t(locale, "未対応", "未处理")}</option><option value="working">{t(locale, "取り組み中", "跟进中")}</option><option value="done">{t(locale, "対応済み", "已处理")}</option>{owners && <option value="hidden">{t(locale, "非表示の相談", "已隐藏")}</option>}</select></label><details><summary>{t(locale, "企業・資料・お名前で絞り込む", "按公司、页面或作者筛选")}</summary><label>{t(locale, "企業", "公司")}<select value={company} onChange={event => setCompany(event.target.value)}><option value="">{t(locale, "すべての企業", "全部公司")}</option>{companies.map(value => <option key={value}>{value}</option>)}</select></label><label>{t(locale, "資料", "页面")}<select value={page} onChange={event => setPage(event.target.value)}><option value="">{t(locale, "すべての資料", "全部页面")}</option>{pages.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label><label>{t(locale, "お名前", "作者")}<select value={author} onChange={event => setAuthor(event.target.value)}><option value="">{t(locale, "すべてのお名前", "全部作者")}</option>{authors.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></details></div><div className="feedback-thread-list" aria-label={t(locale, "相談の一覧", "话题列表")}>{visible.map(thread => <button key={thread.id} className={`feedback-thread-row${selected === thread.id && !compose ? " is-selected" : ""}`} onClick={() => choose(thread.id)} aria-current={selected === thread.id && !compose ? "true" : undefined}><span className="feedback-row-meta">{thread.unread && <strong>{t(locale, "新しい返信", "新回复")}</strong>}<span>{thread.context.company || thread.context.title}</span></span><strong>{thread.messages[0]?.text.slice(0, 100)}</strong>{thread.context.quote && <span className="feedback-row-quote">「{thread.context.quote.slice(0, 65)}」</span>}<span className="feedback-row-footer">{thread.messages.at(-1)?.author.name} · {thread.messages.length} {t(locale, "件", "条")}<span data-state={thread.state}>{thread.state === "done" ? t(locale, "対応済み", "已处理") : thread.state === "working" ? t(locale, "取り組み中", "跟进中") : t(locale, "未対応", "未处理")}</span></span></button>)}{!visible.length && <p className="feedback-empty">{loading ? t(locale, "読み込んでいます…", "正在读取…") : t(locale, "条件に合う相談はありません。", "没有符合条件的话题。")}</p>}</div></aside><section className="feedback-detail-panel" data-tour="discussion-detail">{compose ? <><h2>{t(locale, "新しい相談", "发起新咨询")}</h2><p>{t(locale, "全体へのご意見や、聞いてみたいことをお書きください。", "可以写下整体建议，或你想请教的问题。")}</p><FeedbackComposer context={{ ...GENERAL_CONTEXT, title: t(locale, "全体への相談", "一般咨询") }} locale={locale} onSaved={thread => { choose(thread.id); setConfirmed(true); }} /></> : current ? <>{confirmed && <p className="feedback-success" role="status">{t(locale, "コメントを送信しました。", "留言已发送。")}</p>}<FeedbackThreadDetail key={current.id} thread={current} locale={locale} /></> : <div className="feedback-detail-empty"><span className="feedback-empty-symbol" aria-hidden="true"><ConversationIcon decorative /></span><h2>{t(locale, "左の相談を選ぶと、やりとりが開きます", "选择左侧话题，查看原文与交流")}</h2><p>{t(locale, "原稿の気になる部分からも、そのままコメントできます。", "也可以在面试原文旁直接发起批注。")}</p><Link href="/consultation">{t(locale, "原稿を読む", "阅读面试原文")} →</Link></div>}</section></div>
      </>}
    </main><footer className="feedback-workspace-footer">{t(locale, "先生方と本人に共有される交流です。時刻は日本時間（JST）です。", "交流内容对受邀老师与本人共同可见，时间为日本时间（JST）。")}</footer>
  </div>;
}
