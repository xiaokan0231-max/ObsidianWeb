"use client";

import { useEffect, useRef, useState } from "react";
import type { ConsultationDraft, ConsultationMemo, ConsultationProjection } from "@/lib/consultation";
import ReadingMode from "../reading-mode";
import { UiLocaleProvider } from "../ui-locale";
import { appViewHref } from "../app-route";
import { useDialogFocus } from "../use-dialog-focus";
import "./consultation.css";

type Payload = { material: ConsultationProjection; materialRevision: string; revision: string; draft: ConsultationDraft; savedAt: string | null; historyCount: number };
const memoLabels: Record<Exclude<keyof ConsultationMemo, "confirmed">, [string, string]> = {
  received: ["先生にはどう伝わったか", "老师理解到什么／形成什么印象"],
  evidence: ["そう感じた箇所・理由", "对应句子与原因，可记 s 编号"],
  improvement: ["残す表現・変える表現", "保留什么、怎样改善"],
  retry: ["言い直した後の確認", "重新回答后，老师的反馈"],
  explanation: ["私の補足（面接後の説明）", "我本来想表达什么，不属于原回答"],
};
const summaryLabels: Record<keyof ConsultationDraft["summary"], [string, string]> = {
  keep: ["これからも続けること", "值得保持的表达"], change: ["まず変えること", "优先改善的具体一点"],
  unknown: ["まだ判断できないこと", "未确定的问题与适用边界"], action: ["次にすること", "下一步行动；不会自动生成待办或日程"],
};
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000), ...options });
  const body = await response.json();
  if (!response.ok) throw new Error((body as { error?: string }).error || "読み込みに失敗しました。");
  return body as T;
}
export default function ConsultationView() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request<Payload>("/api/consultation").then(value => { if (active) setPayload(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  return <UiLocaleProvider initialLocale="ja">{payload ? <ConsultationSession initial={payload} /> : <main className="consultation-loading" lang="ja">
    <small>CAREER CONSULTATION</small><h1>キャリア相談</h1><p role={error ? "alert" : "status"}>{error || "今回の資料を読み込んでいます…"}</p>
    {error && <button onClick={() => window.location.reload()}>もう一度読み込む</button>}<a href={appViewHref("calendar")}>カレンダーに戻る</a>
  </main>}</UiLocaleProvider>;
}

export function ConsultationSession({ initial }: { initial: Payload }) {
  const [payload, setPayload] = useState(initial);
  const [draft, setDraft] = useState(initial.draft);
  const [saved, setSaved] = useState(JSON.stringify(initial.draft));
  const [section, setSection] = useState("intro");
  const [zh, setZh] = useState(false);
  const [names, setNames] = useState(false);
  const [pendingNames, setPendingNames] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [full, setFull] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const scroll = useRef<HTMLDivElement>(null);
  const fullButton = useRef<HTMLButtonElement>(null);
  const positions = useRef(new Map<string, number>());
  const activeSection = useRef(section);
  const dirty = JSON.stringify(draft) !== saved;
  const material = payload.material;
  const selected = material.cases.find(c => c.id === section);
  const source = material.sources.find(s => s.id === selected?.sourceId);
  const reading = material.sources.find(s => s.id === full);
  const sections = ["intro", ...material.cases.map(c => c.id), "summary"];
  const sectionIndex = sections.indexOf(section);

  useEffect(() => {
    const valid = new Set(["intro", ...initial.material.cases.map(c => c.id), "summary"]);
    const sync = () => {
      const next = new URLSearchParams(window.location.search).get("part") ?? "intro";
      positions.current.set(activeSection.current, scroll.current?.scrollTop ?? 0);
      activeSection.current = valid.has(next) ? next : "intro";
      setSection(activeSection.current);
      setFull(null);
      window.requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = positions.current.get(activeSection.current) ?? 0; });
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [initial.material.cases]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function navigate(next: string) {
    if (next === section) return;
    positions.current.set(section, scroll.current?.scrollTop ?? 0);
    activeSection.current = next;
    setSection(next);
    window.history.pushState({}, "", `/consultation?part=${encodeURIComponent(next)}`);
    window.requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = positions.current.get(next) ?? 0; document.getElementById("consultation-title")?.focus({ preventScroll: true }); });
  }
  async function toggleNames() {
    setPendingNames(true); setError("");
    try {
      const next = await request<Payload>(`/api/consultation?names=${names ? "0" : "1"}`);
      if (next.materialRevision !== payload.materialRevision) throw new Error("資料が更新されています。メモを保存してから資料を開き直してください。");
      setPayload(p => ({ ...p, material: next.material })); setNames(!names);
    } catch (e) { setError(e instanceof Error ? e.message : "表示を切り替えられません。"); }
    finally { setPendingNames(false); }
  }
  async function save() {
    setSaving(true); setError("");
    const snapshot = structuredClone(draft);
    try {
      const result = await request<{ revision: string; savedAt: string; historyCount: number }>("/api/consultation", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: snapshot, revision: payload.revision, materialRevision: payload.materialRevision }),
      });
      setPayload(p => ({ ...p, ...result })); setSaved(JSON.stringify(snapshot));
    } catch (e) { setError(e instanceof Error ? e.message : "保存できませんでした。入力は残っています。"); }
    finally { setSaving(false); }
  }
  function changeMemo(key: keyof ConsultationMemo, value: string | boolean) {
    if (!selected) return;
    setDraft(d => ({ ...d, memos: { ...d.memos, [selected.id]: { ...d.memos[selected.id], confirmed: key === "confirmed" ? Boolean(value) : false, [key]: value } } }));
  }
  function disclosure(key: string, label: string, content: React.ReactNode) {
    return <details open={expanded[key] ?? false} onToggle={event => {
      const open = event.currentTarget.open;
      setExpanded(old => old[key] === open ? old : { ...old, [key]: open });
    }}><summary>{label}</summary>{content}</details>;
  }
  const status = saving ? "保存中…" : dirty ? "未保存の変更があります" : payload.savedAt ? `保存確認済み · ${new Date(payload.savedAt).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })} JST` : "メモはまだありません";

  return <>
    <div className="app-shell consultation-shell" lang="ja">
      <header className="consultation-header">
        <div><small>CAREER CONSULTATION</small><strong>キャリア相談</strong><span>本機で一緒に読む</span></div>
        <div className="consultation-tools">
          <button aria-pressed={zh} onClick={() => setZh(!zh)}>中文辅助 {zh ? "ON" : "OFF"}</button>
          <button aria-pressed={names} disabled={pendingNames} onClick={toggleNames}>{pendingNames ? "切替中…" : names ? "企業名を隠す" : "企業名を表示"}</button>
          <a href={appViewHref("calendar")} onClick={e => { if (dirty && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setLeaveOpen(true); } }}>相談を離れる ↗</a>
        </div>
      </header>
      <aside className="consultation-nav" aria-label="今回の相談">
        <small>今日の進め方</small>
        <button aria-current={section === "intro" ? "step" : undefined} onClick={() => navigate("intro")}><span>はじめに</span><strong>背景と相談の目的</strong></button>
        <p>やり取りを読む</p>
        {material.cases.map((c, index) => <button key={c.id} aria-current={section === c.id ? "step" : undefined} onClick={() => navigate(c.id)}>
          <span>{c.reserve ? "予備" : `0${index + 1}`} · {material.sources.find(s => s.id === c.sourceId)?.company}</span><strong>{c.titleJa}</strong>{zh && <em lang="zh-CN">{c.titleZh}</em>}
          {draft.memos[c.id].received.trim() && <small>メモあり</small>}
        </button>)}
        <button aria-current={section === "summary" ? "step" : undefined} onClick={() => navigate("summary")}><span>おわりに</span><strong>今日のまとめ</strong></button>
        <div className="consultation-boundary">日時・所要時間は未定<br />先生のご意見は本相談での視点として記録します。</div>
      </aside>
      <div className="consultation-workspace" ref={scroll}>
        <div className={`consultation-columns ${selected ? "with-memo" : ""}`}>
          <main className="consultation-paper">
            {section === "intro" && <>
              <p className="consultation-eyebrow">はじめに · 本日の相談</p><h1 id="consultation-title" tabIndex={-1}>{material.titleJa}</h1>
              <p className="consultation-lead">{material.goalJa}</p>
              <section className="consultation-background"><h2>私の背景</h2><p>{material.introJa}</p>{zh && <p className="consultation-zh" lang="zh-CN">{material.introZh}</p>}</section>
              <h2>この順で、一つずつ</h2><ol className="consultation-steps"><li><strong>まず、先生の受け取り方</strong><p>質問と回答を読んで、何が伝わったかを伺います。</p></li><li><strong>具体的な箇所を確かめる</strong><p>どの言葉でそう感じたか、前後のやり取りも見ます。</p></li><li><strong>その場でもう一度答える</strong><p>一つ変えて話し直し、伝わり方が変わったかを確認します。</p></li></ol>
              <section className="consultation-pacing"><h2>使える時間に合わせる</h2><div>{(["20", "30", "45"] as const).map(m => <button key={m} aria-pressed={draft.minutes === m} onClick={() => setDraft(d => ({ ...d, minutes: m }))}>{m}分の目安</button>)}</div><p>{draft.minutes === "20" ? "背景3分 → 重点2件を12分 → まとめ5分" : draft.minutes === "45" ? "背景5分 → 重点3件と再回答30分 → まとめ10分" : "背景4分 → 重点3件を21分 → まとめ5分"}</p><small>予約時間ではありません。全部を終えるより、一つでも具体的に改善できることを優先します。</small></section>
              <p className="consultation-notice">文字起こしは原音未確認です。読みやすい整理稿と原始転写を区別し、話す速さ・声の印象や採用側の本心を文字だけで断定しません。</p>
              <button className="consultation-primary" onClick={() => navigate(material.cases[0].id)}>最初のやり取りへ →</button>
            </>}
            {selected && source && <>
              <p className="consultation-eyebrow">{source.company} · {source.date} · {source.round}</p><h1 id="consultation-title" tabIndex={-1}>{selected.titleJa}</h1>
              <p className="consultation-role">{source.roleJa}</p>
              <div className="consultation-context"><strong>この場面の背景</strong><p>{selected.contextJa}</p>{zh && <p lang="zh-CN" className="consultation-zh">{selected.contextZh}</p>}</div>
              <p className="consultation-notice">{selected.cautionJa}{zh && <span lang="zh-CN">{selected.cautionZh}</span>}</p>
              <div className="consultation-transcript-label"><h2>当日のやり取り</h2><span>可読整理 · フィラー等は省略</span></div>
              {selected.blocks.map(block => <section key={block.id} className="consultation-block"><h3>{block.id} · {block.title}</h3>{block.sentences.map(sentence => <div key={sentence.id} className={`consultation-turn ${sentence.speaker === "私" ? "self" : "interviewer"}`}>
                <div><strong>{sentence.speaker === "私" ? "私" : "面接官"}</strong><small>{sentence.id}</small></div><div><p>{sentence.text}</p>{sentence.uncertain && <span className="consultation-uncertain">話者・転写に未確認の箇所があります</span>}{zh && sentence.zh && <p lang="zh-CN" className="consultation-zh">{sentence.zh}</p>}
                  {sentence.notes.length > 0 && disclosure(`${selected.id}-${sentence.id}`, "整理時の注記（発言ではありません）", <div className="consultation-note">{sentence.notes.map((n, i) => <p key={i}>{n}</p>)}</div>)}
                </div></div>)}</section>)}
              {disclosure(`${selected.id}-raw`, "原始転写との対照 · 前後の境界を含む", <><p>話者分離前の連続転写です。「マイク」は話者ではありません。行の途中に前後の話題が含まれる場合があります。</p><RawLines lines={selected.raw} prefix={`${selected.id}-excerpt`} /></>)}
              <button className="consultation-source-button" ref={fullButton} onClick={() => setFull(source.id)}>前後・原稿全文を開く（個人情報は非表示） ↗</button>
              <p className="consultation-source-meta">{source.sourceLabel} · L{selected.rawRange[0]}–{selected.rawRange[1]}<br />{source.studyLabel} · {selected.blocks.map(b => b.id).join(" / ")}<br />資料照合：{material.checkedAt} · 原音の確認とは異なります</p>
              {disclosure(`${selected.id}-ai`, "AIの見立てと比較する（先生の初見の後で）", <div className="consultation-ai"><small>AI作者：Codex · {material.checkedAt} · 相談用の仮説</small><p>{selected.aiJa || "今回の資料には AI コメントがありません。"}</p>{zh && <p lang="zh-CN">{selected.aiZh}</p>}<p>先生の見方と違う場合は、理由をメモに残します。点数や合否予測は使いません。</p></div>)}
            </>}
            {section === "summary" && <>
              <p className="consultation-eyebrow">おわりに</p><h1 id="consultation-title" tabIndex={-1}>今日のまとめ</h1><p className="consultation-lead">次の面接で試すことを、具体的に一つ決めます。</p>
              {Object.entries(summaryLabels).map(([key, label]) => <label className="consultation-field" key={key}>{label[0]}{zh && <small lang="zh-CN">{label[1]}</small>}<textarea rows={3} maxLength={4000} value={draft.summary[key as keyof ConsultationDraft["summary"]]} onChange={e => setDraft(d => ({ ...d, summary: { ...d.summary, [key]: e.target.value } }))} /></label>)}
              <p className="consultation-notice">本人による相談メモです。先生の意見・本人の解釈・未確認のことを区別してください。タスク・カレンダー・応募状態へは自動反映しません。</p>
              {material.cases.map(c => draft.memos[c.id].received && <section className="consultation-recap" key={c.id}><button onClick={() => navigate(c.id)}>{c.titleJa} ↗</button><p>{draft.memos[c.id].received}</p><small>{draft.memos[c.id].confirmed ? "要約を先生と確認済み" : "本人の要約・先生未確認"}</small></section>)}
            </>}
            <nav className="consultation-next" aria-label="相談の順序"><button disabled={sectionIndex === 0} onClick={() => navigate(sections[sectionIndex - 1])}>← 前へ</button><button disabled={sectionIndex === sections.length - 1} onClick={() => navigate(sections[sectionIndex + 1])}>次へ →</button></nav>
          </main>
          {selected && <aside className="consultation-memo" aria-label="本人が記録する相談メモ"><small>私が記録する</small><h2>先生のフィードバック</h2><p>まず先生の受け取り方を伺い、次に自分の意図を補足します。</p>
            {Object.entries(memoLabels).map(([key, label]) => <label key={key} className="consultation-field">{label[0]}{zh && <small lang="zh-CN">{label[1]}</small>}<textarea rows={3} maxLength={4000} value={draft.memos[selected.id][key as Exclude<keyof ConsultationMemo, "confirmed">]} onChange={e => changeMemo(key as keyof ConsultationMemo, e.target.value)} /></label>)}
            <label className="consultation-confirm"><input type="checkbox" checked={draft.memos[selected.id].confirmed} onChange={e => changeMemo("confirmed", e.target.checked)} />この要約を先生と確認した</label><small>未確認のメモは「本人の要約」として保存します。先生の逐語発言とは扱いません。</small>
          </aside>}
        </div>
      </div>
      <footer className="consultation-save"><div><span role="status" aria-live="polite">{status}</span><small>保存先：本人の Obsidian vault · 送信・公開なし</small></div>{error && <p role="alert">{error}</p>}<button className="consultation-primary" onClick={save} disabled={saving || !dirty}>メモを保存</button></footer>
      {leaveOpen && <LeaveDialog onClose={() => setLeaveOpen(false)} onDiscard={() => { setSaved(JSON.stringify(draft)); setLeaveOpen(false); window.setTimeout(() => { window.location.href = appViewHref("calendar"); }, 0); }} />}
    </div>
    {reading && <ReadingMode documentKey={`consultation:${material.id}:${reading.id}`} title={`${reading.company} · ${reading.date}`} eyebrow="原始転写・個人情報非表示" metadata={[reading.round, "原音未確認", "マイクは録音の区切り"]}
      initialHeadingId={`consultation-line-${selected?.rawRange[0]}`} backLabel="相談の同じ箇所に戻る" onClose={() => { setFull(null); window.requestAnimationFrame(() => fullButton.current?.focus({ preventScroll: true })); }}
      headerNote={<p>元の行番号を保持しています。無関係な個人情報は省略表示です。相談メモは閉じても残ります。</p>}>
      <RawLines lines={reading.rawLines} />
    </ReadingMode>}
  </>;
}
function LeaveDialog({ onClose, onDiscard }: { onClose: () => void; onDiscard: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, true);
  return <div className="consultation-dialog-backdrop"><div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="consultation-leave-title" tabIndex={-1} onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
    <h2 id="consultation-leave-title">未保存のメモがあります</h2><p>相談に戻って保存できます。保存せずに離れると、この変更は失われます。</p><div><button onClick={onClose}>相談に戻る</button><button onClick={onDiscard}>保存せずに離れる</button></div>
  </div></div>;
}
function RawLines({ lines, prefix = "consultation-line" }: { lines: { number: number; text: string }[]; prefix?: string }) {
  return <div className="consultation-raw">{lines.map(line => <p key={line.number} id={`${prefix}-${line.number}`} data-reading-anchor={`line-${line.number}`}><small>L{line.number}</small><span>{line.text || " "}</span></p>)}</div>;
}
