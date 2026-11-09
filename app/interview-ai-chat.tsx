"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useUiLocale } from "./ui-locale";
import "./styles/interview-ai-chat.css";

type Source = { id: string; label: string; excerpt: string };
type Preview = { digest: string; sources: Source[]; limited?: boolean; usingPrivatePrep?: boolean };
type Answer = { answer: string; evidenceIds: string[] };
type Turn = { question: string; answer: string; sources: Source[] };
type Message = { role: "user" | "assistant"; content: string };

const COPY = {
  "zh-CN": {
    title: "AI 对话",
    close: "收起",
    prompt: "问问这场面试怎么准备",
    placeholder: "例如：这场已经准备了什么？",
    sending: "正在回答…",
    send: "发送",
    you: "你",
    answer: "AI 回答",
    retry: "重新读取资料",
    loading: "正在读取本场资料…",
    sourceCount: (count: number) => `发送给 OpenAI 的资料片段（${count}）`,
    sources: "回答参考的片段",
    empty: "本场暂时没有可用的资料片段。可以在问题中补充背景。",
    includePrep: "加入本轮准备资料",
    includePrepHelp: "部分资料仅在本机保留。勾选可预览精选片段，点发送时才会随问题发给 OpenAI。",
    prepExcluded: "勾选上方选项后，AI 就能参考本轮准备资料。",
    missingPrep: "仅在本机保留的资料里，暂时没有可加入的片段。",
    historyReset: "资料范围已切换，接下来的提问会开始一段新对话。",
    privacy: "发送时会附上当前问题、最近几轮对话和这里列出的片段。",
    error: "请求失败。请检查本机服务后重试。",
  },
  ja: {
    title: "AI チャット",
    close: "閉じる",
    prompt: "今回の面接について質問する",
    placeholder: "例：今回の面接に向けて、何を準備できていますか？",
    sending: "回答を作成中…",
    send: "送信",
    you: "あなた",
    answer: "AI の回答",
    retry: "資料を読み直す",
    loading: "今回の資料を読み込み中…",
    sourceCount: (count: number) => `OpenAI に送信する資料の抜粋（${count}件）`,
    sources: "回答で参照した資料",
    empty: "参照できる資料の抜粋がありません。必要に応じて質問に背景を添えてください。",
    includePrep: "今回の面接準備資料を使う",
    includePrepHelp: "一部の資料はこの端末にのみ保存されています。チェックすると、質問と一緒に OpenAI へ送る抜粋を確認できます。",
    prepExcluded: "上の項目をチェックすると、AI が今回の準備資料を参照できます。",
    missingPrep: "この端末にのみ保存されている資料に、添えられる抜粋がありません。",
    historyReset: "参照する資料が変わったため、次の質問から新しい会話を始めます。",
    privacy: "送信時は、質問と直近の会話に、ここに表示した抜粋を添えます。",
    error: "リクエストに失敗しました。ローカルサーバーを確認して再試行してください。",
  },
};

async function request<T>(body: object, signal: AbortSignal): Promise<T> {
  const response = await fetch("/api/interview/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw Object.assign(new Error(payload?.error ?? ""), { status: response.status });
  return payload;
}

function SourceList({ sources }: { sources: Source[] }) {
  return <ul className="interview-chat-sources">
    {sources.map((source) => <li key={source.id}><strong>{source.label}</strong><p>{source.excerpt}</p></li>)}
  </ul>;
}

export default function InterviewAiChat({ id, open, path, revision, scope, onClose }: {
  id: string;
  open: boolean;
  path: string;
  revision: string;
  scope: string;
  onClose: () => void;
}) {
  const { locale } = useUiLocale();
  const copy = COPY[locale];
  const [loadedPreview, setLoadedPreview] = useState<{ attempt: number; value: Preview } | null>(null);
  const [failedPreview, setFailedPreview] = useState<{ attempt: number; message: string } | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [includePrivatePrep, setIncludePrivatePrep] = useState(false);
  const [historyStart, setHistoryStart] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previewError = failedPreview?.attempt === previewAttempt ? failedPreview.message : null;
  const preview = previewError === null && loadedPreview?.attempt === previewAttempt ? loadedPreview.value : null;

  useEffect(() => {
    const controller = new AbortController();
    // 预览走本机资料读取，点发送才调用模型。
    void request<Preview>({ action: "preview", path, revision, includePrivatePrep }, controller.signal).then((result) => {
      if (!controller.signal.aborted) setLoadedPreview({ attempt: previewAttempt, value: result });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setFailedPreview({
        attempt: previewAttempt,
        message: error instanceof Error && "status" in error ? error.message : "",
      });
    });
    return () => controller.abort();
  }, [path, revision, includePrivatePrep, previewAttempt]);

  useEffect(() => () => inFlight.current?.abort(), []);
  useEffect(() => {
    if (open) titleRef.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (open && (turns.length > 0 || sending) && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, turns.length, sending]);

  function changePrepScope(included: boolean) {
    setIncludePrivatePrep(included);
    // 切换发送范围时，旧回复可能复述此前附带的资料，只保留在本页显示。
    setHistoryStart(turns.length);
    setSendError(null);
    setPreviewAttempt((attempt) => attempt + 1);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || !preview || inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setSending(true);
    setSendError(null);
    // 只传最近三轮加当前问题，减少无关上下文和重复计费。
    const messages = turns.slice(Math.max(historyStart, turns.length - 3)).flatMap<Message>((turn) => [
      { role: "user", content: turn.question },
      { role: "assistant", content: turn.answer },
    ]);
    messages.push({ role: "user", content: question });
    try {
      const result = await request<Answer>({ action: "chat", path, revision, includePrivatePrep, digest: preview.digest, messages }, controller.signal);
      if (controller.signal.aborted) return;
      const sources = preview.sources.filter((source) => result.evidenceIds.includes(source.id));
      setTurns((previous) => [...previous, { question, answer: result.answer, sources }]);
      setDraft("");
    } catch (error) {
      if (controller.signal.aborted) return;
      const requestError = error instanceof Error && "status" in error ? error : null;
      if (requestError?.status === 409) {
        setFailedPreview({ attempt: previewAttempt, message: requestError.message });
      } else {
        setSendError(requestError?.message ?? "");
      }
    } finally {
      inFlight.current = null;
      if (!controller.signal.aborted) setSending(false);
    }
  }

  return <aside id={id} hidden={!open} className="interview-chat" aria-labelledby={`${id}-title`}>
    <header className="interview-chat-header">
      <div>
        <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1}>{copy.title}</h2>
        <p>{scope}</p>
      </div>
      <button type="button" onClick={onClose}>{copy.close}</button>
    </header>
    {loadedPreview?.value.limited && <div className="interview-chat-prep-scope">
      <label>
        <input type="checkbox" checked={includePrivatePrep} disabled={sending} aria-describedby={`${id}-prep-help`}
          onChange={(event) => changePrepScope(event.target.checked)} />
        {copy.includePrep}
      </label>
      <p id={`${id}-prep-help`}>{copy.includePrepHelp}</p>
      {historyStart > 0 && historyStart === turns.length && <p role="status">{copy.historyReset}</p>}
    </div>}
    <div className="interview-chat-scroll" ref={scrollRef}>
      {preview ? <>
        {preview.limited && includePrivatePrep && !preview.usingPrivatePrep && <p className="interview-chat-status">{copy.missingPrep}</p>}
        {!preview.sources.length && <p className="interview-chat-status">{preview.limited && !includePrivatePrep ? copy.prepExcluded : copy.empty}</p>}
        <details className="interview-chat-disclosure">
          <summary>{copy.sourceCount(preview.sources.length)}</summary>
          <p>{copy.privacy}</p>
          {preview.sources.length > 0 && <SourceList sources={preview.sources} />}
        </details>
      </> : previewError === null ? <p className="interview-chat-status" role="status">{copy.loading}</p> : <>
        <p className="interview-chat-error" role="alert">{previewError || copy.error}</p>
        <button type="button" onClick={() => setPreviewAttempt((attempt) => attempt + 1)}>{copy.retry}</button>
      </>}
      <div role="log" aria-live="polite" aria-relevant="additions" aria-label={copy.title} className="interview-chat-log">
        {turns.map((turn, index) => <div className="interview-chat-turn" key={index}>
            <section className="interview-chat-question"><h3>{copy.you}</h3><p>{turn.question}</p></section>
            <section className="interview-chat-answer"><h3>{copy.answer}</h3><p>{turn.answer}</p>
              {turn.sources.length > 0 && <details><summary>{copy.sources}</summary><SourceList sources={turn.sources} /></details>}
            </section>
        </div>)}
      </div>
    </div>
    <form className="interview-chat-composer" onSubmit={send}>
      <label htmlFor={`${id}-draft`}>{copy.prompt}</label>
      <textarea id={`${id}-draft`} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={copy.placeholder}
        maxLength={2000} rows={3} readOnly={sending} required />
      {sendError !== null && <p className="interview-chat-error" role="alert">{sendError || copy.error}</p>}
      <div className="interview-chat-actions">
        {sending && <span className="interview-chat-status" role="status">{copy.sending}</span>}
        <button className="interview-chat-send" type="submit" disabled={!preview || sending || !draft.trim()}>{copy.send}</button>
      </div>
    </form>
  </aside>;
}
