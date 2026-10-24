"use client";

import "./styles/language-scenario.css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Note } from "@/lib/notes";
import { postJson } from "@/lib/client-api";
import { languageExpressionProgressPath, type LanguageExpressionCourse } from "@/lib/language-expression-course";
import { parseScenarioAttempts, scenarioRevision, type ScenarioAttemptEvent, type ScenarioLesson } from "@/lib/language-scenario";
import { commitScenarioAnswer, createScenarioDraft, listeningEvidence, localJapaneseVoice, restoreScenarioDraft, scenarioDraftFromEvent, scenarioEventId, scenarioResponseContext, scenarioStorageKey, SCENARIO_STORAGE_PREFIX, type ScenarioDraft } from "./language-scenario-state";

const subscribeMounted = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;
const ASSESSMENTS = [
  ["independent", "独立完成"], ["prompted", "提示后"], ["practice", "需练"], ["no-evidence", "无证据"],
] as const;
const KIND_LABELS = { listen: "听题与复述", verify: "换问法验证", stance: "自己的立场", respond: "简单日语", repair: "追问与修复", transfer: "跨场迁移", reflect: "回看与自评" };
const EVIDENCE_LABELS = { transcript: "逐字稿", study: "整理稿", annotation: "本人批注", review: "复盘", recollection: "记忆再构成", fact: "事实正本" };
const HYPOTHESIS_LABELS = { "confirmed-misunderstanding": "本人确认误听／未听懂", "possible-partial-understanding": "可能部分听懂（推断）", "expression-limited": "表达受限", "focus-shift": "答题焦点偏移", "asr-uncertain": "ASR 不确定（不诊断）" };
const CONFIDENCE_LABELS = { high: "高置信", medium: "中置信", low: "低置信" };

type Props = {
  course: LanguageExpressionCourse;
  notes: Note[];
  onNoteWritten?: (note: Note) => void;
  onVaultChanged: () => Promise<void>;
};

function newAttemptId() {
  return `scenario-${crypto.randomUUID()}`;
}

function initialDraft(course: LanguageExpressionCourse, lesson: ScenarioLesson, notes: Note[]) {
  const revision = scenarioRevision(lesson);
  const key = scenarioStorageKey(course.courseId, revision);
  let local: ScenarioDraft | null = null;
  let warning = "";
  try {
    local = restoreScenarioDraft(localStorage.getItem(key), course.courseId, lesson, revision);
    if (!local && Object.keys(localStorage).some((name) => name.startsWith(`${SCENARIO_STORAGE_PREFIX}${course.courseId}:`) && !name.startsWith(`${key}:`) && name !== key)) {
      warning = "课程内容已更新。旧版草稿仍保留在本机，本轮从新版开始。";
    }
  } catch { warning = "浏览器无法读取草稿；请用“保存已确认作答到 Vault”保留进度。"; }
  const progress = notes.find((note) => note.path === languageExpressionProgressPath(course));
  const events = progress ? parseScenarioAttempts(progress.content).filter((event) => event.courseId === course.courseId && event.revision === revision) : [];
  const latest = events.at(-1);
  if (local && (!latest || local.updatedAt >= latest.at)) return { draft: local, warning };
  if (latest) return { warning, draft: scenarioDraftFromEvent(course.courseId, lesson, latest) };
  return { draft: createScenarioDraft(course.courseId, lesson, revision, newAttemptId()), warning };
}

function useLocalSpeech() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener("voiceschanged", update);
    queueMicrotask(update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return localJapaneseVoice(voices);
}

export default function LanguageScenarioCourse(props: Props) {
  const mounted = useSyncExternalStore(subscribeMounted, clientMounted, serverMounted);
  if (!props.course.scenario) return null;
  if (!mounted) return <section className="scenario-workbench"><p>正在恢复本机训练草稿…</p></section>;
  return <ScenarioWorkbench key={`${props.course.courseId}:${scenarioRevision(props.course.scenario)}`} {...props} lesson={props.course.scenario} />;
}

function ScenarioWorkbench({ course, lesson, notes, onNoteWritten, onVaultChanged }: Props & { lesson: ScenarioLesson }) {
  const [initial] = useState(() => initialDraft(course, lesson, notes));
  const [draft, setDraft] = useState(initial.draft);
  const draftRef = useRef(initial.draft);
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saveLock = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [audioMessage, setAudioMessage] = useState("");
  const speechToken = useRef(0);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localVoice = useLocalSpeech();
  const step = lesson.steps[draft.stepIndex];
  const entry = draft.payload.steps[draft.stepIndex];
  const committed = Boolean(entry.answer.trim());
  const locked = draft.completed || draft.pendingCompletion || busy;
  const evidence = listeningEvidence(draft, lesson);
  const responseContext = scenarioResponseContext(draft, lesson, draft.stepIndex);
  const allAnswered = draft.payload.steps.every((item) => item.answer.trim());
  const completedCount = draft.payload.steps.filter((item) => item.answer.trim()).length;
  const firstOpen = draft.payload.steps.findIndex((item) => !item.answer.trim());
  const furthest = firstOpen < 0 ? lesson.steps.length - 1 : firstOpen;

  function update(change: (current: ScenarioDraft) => ScenarioDraft) {
    const next = { ...change(draftRef.current), updatedAt: new Date().toISOString() };
    draftRef.current = next;
    setDraft(next);
    try {
      const key = scenarioStorageKey(course.courseId, next.payload.revision);
      localStorage.setItem(`${key}:attempt:${next.payload.attemptId}`, JSON.stringify(next));
      localStorage.setItem(key, JSON.stringify(next));
    } catch { setStorageWarning("浏览器未能保存本机草稿。请保存已确认作答到 Vault；刷新前先保留当前输入。"); }
    return next;
  }

  function changeEntry(change: (value: typeof entry) => typeof entry, index = draftRef.current.stepIndex) {
    update((current) => ({ ...current, payload: { ...current.payload, steps: current.payload.steps.map((value, i) => i === index ? change(value) : value) } }));
  }

  function stopSpeech() {
    speechToken.current += 1;
    if (speechTimer.current) clearTimeout(speechTimer.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  useEffect(() => () => {
    speechToken.current += 1;
    if (speechTimer.current) clearTimeout(speechTimer.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  function play() {
    if (!step.promptJa || draftRef.current.completed || draftRef.current.pendingCompletion || saveLock.current) return;
    // 每次播放重新确认 localService，绝不回退到浏览器默认的远端声线。
    const voice = localJapaneseVoice(window.speechSynthesis?.getVoices() ?? []);
    if (!voice) { setAudioMessage("没有可确认的本地日语声线。可以进入文字模式；本题不产生听力证据。"); return; }
    stopSpeech();
    const token = ++speechToken.current;
    const index = draftRef.current.stepIndex;
    const utterance = new SpeechSynthesisUtterance(step.promptJa);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.9;
    setSpeaking(true);
    setAudioMessage("正在播放本地合成练习句…");
    utterance.onend = () => {
      if (speechToken.current !== token) return;
      if (speechTimer.current) clearTimeout(speechTimer.current);
      setSpeaking(false);
      setAudioMessage("本地合成播放结束。若实际没有听到声音，请进入文字模式，不记听力证据。");
      changeEntry((value) => ({ ...value, audio: value.audio === "text" ? "text" : "synthetic-completed" }), index);
    };
    utterance.onerror = () => {
      if (speechToken.current !== token) return;
      stopSpeech();
      setAudioMessage("播放未完成。可以重试，或进入文字模式；本次未记为有效播放。");
    };
    speechTimer.current = setTimeout(() => {
      if (speechToken.current !== token) return;
      stopSpeech();
      setAudioMessage("未收到播放完成确认。请重试或使用文字模式；本次没有听力证据。");
    }, 30000);
    window.speechSynthesis.speak(utterance);
  }

  function useText() {
    if (draftRef.current.completed || draftRef.current.pendingCompletion || saveLock.current) return;
    stopSpeech();
    changeEntry((value) => value.answer.trim() ? value : ({ ...value, audio: "text", revealed: true, usedHintBeforeAnswer: value.usedHintBeforeAnswer || ["listen", "verify", "transfer"].includes(step.kind) }));
    setAudioMessage("已进入文字模式。本题验证文字理解，不用来判断听力。");
  }

  function move(index: number) {
    stopSpeech();
    setAudioMessage("");
    update((current) => ({ ...current, stepIndex: index }));
  }

  async function save(action: "checkpoint" | "completed") {
    if (saveLock.current || draftRef.current.completed) return;
    saveLock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const snapshot = action === "completed" ? update((value) => ({ ...value, pendingCompletion: true })) : draftRef.current;
    try {
      const result = await postJson<{ ok: true; event: ScenarioAttemptEvent; note?: Note }>("/api/language/topics/progress", {
        eventId: scenarioEventId(snapshot.payload, action), courseId: course.courseId, exercise: "scenario", action, payload: snapshot.payload,
      });
      const confirmed = scenarioDraftFromEvent(course.courseId, lesson, result.event);
      update((current) => ({ ...current, payload: confirmed.payload, savedAt: result.event.at, completed: result.event.action === "completed", pendingCompletion: false }));
      setMessage(action === "completed" ? "本轮作答和两项自评已写入 Vault。" : "已确认作答已写入 Vault；尚未确认的输入仍是本机草稿。");
      if (result.note && onNoteWritten) onNoteWritten(result.note);
      else {
        try { await onVaultChanged(); }
        catch { setMessage("作答已写入 Vault，但页面资料刷新未完成；本机草稿仍保留。"); }
      }
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "保存失败。"} 草稿仍保留；网络状态不会改写你的自评。${action === "completed" ? "本轮暂时锁定，重试将使用同一个请求。" : ""}`);
    } finally { saveLock.current = false; setBusy(false); }
  }

  function freshAttempt() {
    stopSpeech();
    update(() => createScenarioDraft(course.courseId, lesson, scenarioRevision(lesson), newAttemptId()));
    setMessage("已开始新一轮。上一轮草稿仍保留，答案不会带入本轮。");
    setError("");
    setAudioMessage("");
  }

  return (
    <section className="scenario-workbench" aria-label="情境课程练习">
      <header className="scenario-header">
        <div><small>情境练习 · 约 {lesson.durationMinutes} 分钟</small><h2>{course.title}</h2><p>{lesson.introZh}</p></div>
        <span className="scenario-progress-label">{completedCount} / {lesson.steps.length}<small>已确认步骤</small></span>
      </header>
      <nav className="scenario-steps" aria-label="本课步骤">
        {lesson.steps.map((item, index) => <button key={item.id} type="button" disabled={index > furthest || busy || speaking} aria-current={index === draft.stepIndex ? "step" : undefined} onClick={() => move(index)}>
          <span>{draft.payload.steps[index].answer.trim() ? "✓" : index + 1}</span>{KIND_LABELS[item.kind]}
        </button>)}
      </nav>
      {storageWarning && <p className="scenario-warning" role="status">{storageWarning}</p>}
      <article className="scenario-stage">
        <div className="scenario-stage-heading"><small>步骤 {draft.stepIndex + 1} / {lesson.steps.length}</small><h3>{step.titleZh}</h3><p>{step.instructionZh}</p></div>
        {step.promptJa && <div className="scenario-audio">
          <div><strong>{entry.audio === "text" ? "文字理解模式" : "本地合成练习 · 非面试原音"}</strong><p>{localVoice ? `可用本地日语声线：${localVoice.name}` : "未发现可确认的本地日语声线；不会调用远端语音。"}</p></div>
          <div className="scenario-audio-actions"><button type="button" onClick={play} disabled={!localVoice || speaking || locked}>{speaking ? "正在播放…" : "播放练习句"}</button>
            {speaking && <button type="button" onClick={stopSpeech}>停止</button>}
            {!committed && <button type="button" onClick={useText} disabled={locked || speaking}>进入文字模式</button>}</div>
          {audioMessage && <p role="status">{audioMessage}</p>}
          {!entry.revealed && <p className="scenario-hidden-prompt">题文暂时隐藏。先用自己的话作答；没听清的部分也可以如实写下。</p>}
          {entry.revealed && <blockquote lang="ja">{step.promptJa}</blockquote>}
        </div>}
        {responseContext && <div className="scenario-own-points"><strong>{responseContext.label}</strong><p>{responseContext.answer || "尚未填写"}</p></div>}
        {step.factBoundaryZh && (committed || !step.promptJa) && <p className="scenario-boundary">{step.factBoundaryZh}</p>}
        <label className="scenario-answer-label" htmlFor={`scenario-answer-${step.id}`}>{["respond", "repair"].includes(step.kind) ? "你的日语回应" : step.kind === "stance" ? "你自己的中文要点" : "先自由写下你的理解或回看"}</label>
        <textarea id={`scenario-answer-${step.id}`} key={`${draft.payload.attemptId}:${step.id}`} value={committed ? entry.answer : draft.responses[step.id] ?? ""} lang={["respond", "repair"].includes(step.kind) ? "ja" : "zh-CN"} rows={4} maxLength={5000} readOnly={committed || locked} disabled={busy} placeholder="可以写没听清、暂时不确定；不必猜一个漂亮答案。" onChange={(event) => { const answer = event.target.value; update((current) => ({ ...current, responses: { ...current.responses, [step.id]: answer } })); }} />
        {!committed ? <div className="scenario-confirm-row"><button type="button" className="scenario-primary" disabled={locked || speaking || !(draft.responses[step.id] ?? "").trim()} onClick={() => update((current) => commitScenarioAnswer(current, current.stepIndex))}>确认这次作答，查看核对要点</button><span>确认后保留原答，不用事后改写覆盖。</span></div> : <>
          <p className="scenario-answer-basis">原答已保留 · {entry.answerBasis === "audio" ? "作答前完成本地音频播放" : entry.answerBasis === "text" ? "文字／提示后作答" : "本题无听力证据"}</p>
          <section className="scenario-review" aria-label="作答后的核对要点">
            <h4>对照任务要点，自行核对</h4>
            <ul>{step.expectedZh.map((value) => <li key={value}>{value}</li>)}</ul>
            {step.choicesZh && step.choicesZh.length > 0 && <details><summary>完成自由复述后，再比较这些理解</summary><ul>{step.choicesZh.map((value) => <li key={value}>{value}</li>)}</ul></details>}
            {(step.hintsZh.length > 0 || step.examplesJa.length > 0) && <details><summary>需要时查看提示和短句</summary>{step.hintsZh.map((value) => <p key={value}>{value}</p>)}{step.examplesJa.map((value) => <p className="scenario-example" lang="ja" key={value}>{value}</p>)}<p>短句仅供改写。只保留符合你当前立场和真实经历的内容。</p></details>}
            <p className="scenario-self-note">这里不自动判对错。能复述任务与能用日语回答分开看；主动澄清也可以是独立完成。</p>
          </section>
        </>}
        <footer className="scenario-step-footer"><button type="button" disabled={draft.stepIndex === 0 || busy || speaking} onClick={() => move(draft.stepIndex - 1)}>上一步</button><span>每次只处理当前任务</span><button type="button" className="scenario-primary" disabled={!committed || draft.stepIndex === lesson.steps.length - 1 || busy || speaking} onClick={() => move(draft.stepIndex + 1)}>继续下一步</button></footer>
      </article>
      {allAnswered && <>
        <section className="scenario-assessment">
          <h3>本轮自评 · 两项分别记录</h3><p>按实际完成情况选择。没有自动评分、没有总分；澄清不自动算失败。</p>
          <div className="scenario-assessment-grid">{(["listening", "expression"] as const).map((axis) => <fieldset key={axis} disabled={locked}><legend>{axis === "listening" ? "听辨与任务理解" : "日语表达"}</legend>{ASSESSMENTS.map(([value, label]) => <label key={value}><input type="radio" name={`${draft.payload.attemptId}-${axis}`} value={value} checked={draft.payload.assessments[axis] === value} disabled={axis === "listening" && ((!evidence.hasAudio && value !== "no-evidence") || (value === "independent" && (!evidence.allAudio || evidence.usedHint)))} onChange={() => update((current) => ({ ...current, payload: { ...current.payload, assessments: { ...current.payload.assessments, [axis]: value } } }))} />{label}</label>)}</fieldset>)}</div>
          <p>{!evidence.hasAudio ? "本轮没有在看文字前完成的听题作答，听力保留“无证据”。" : !evidence.allAudio || evidence.usedHint ? "部分理解任务借助文字／提示，不能把整轮听力记为独立完成。" : "本轮保留了先听后答的记录；请自行核对是否真正理解了各个任务。"}</p>
        </section>
        <EvidencePanel lesson={lesson} />
      </>}
      <footer className="scenario-save-bar">
        <div><strong>{draft.completed ? "本轮已写入 Vault" : "作答自动保留为本机草稿"}</strong><p>{draft.savedAt ? `最近写入 Vault：${new Date(draft.savedAt).toLocaleString("zh-CN")}` : "还没有写入 Vault。未确认的输入只保存在本浏览器。"}</p></div>
        <div>{!draft.completed && !draft.pendingCompletion && <button type="button" disabled={busy || speaking || completedCount === 0} onClick={() => void save("checkpoint")}>{busy ? "正在保存…" : "保存已确认作答到 Vault"}</button>}
          {!draft.completed && allAnswered && <button type="button" className="scenario-primary" disabled={busy || speaking} onClick={() => void save("completed")}>{busy ? "正在保存…" : draft.pendingCompletion ? "重试保存本轮结果" : "保存本轮作答与自评"}</button>}
          {completedCount > 0 && <button type="button" disabled={busy || speaking} onClick={freshAttempt}>保留本轮，开始新一轮</button>}</div>
      </footer>
      {message && <p className="scenario-message" role="status">{message}</p>}
      {error && <p className="scenario-error" role="alert">{error}</p>}
    </section>
  );
}

function EvidencePanel({ lesson }: { lesson: ScenarioLesson }) {
  return <details className="scenario-evidence"><summary>展开原问答、本人批注与判断边界</summary>
    <p>以下是来源证据。练习合成句不冒充原音，也不能反推原场听力。</p>
    {lesson.evidence.map((source, index) => <article key={`${source.path}:${source.locator}:${index}`}><strong>{EVIDENCE_LABELS[source.kind]} · {source.locator}</strong><a href={`obsidian://open?file=${encodeURIComponent(source.path.replace(/\.md$/u, ""))}`}>{source.path}</a><blockquote>{source.excerpt}</blockquote></article>)}
    <h4>能观察到的事实</h4><ul>{lesson.observationsZh.map((value) => <li key={value}>{value}</li>)}</ul>
    <h4>原因分类与假设</h4>{lesson.hypotheses.map((value, index) => <p key={index}><b>{HYPOTHESIS_LABELS[value.kind]} · {CONFIDENCE_LABELS[value.confidence]}</b> {value.detailZh}</p>)}
    <h4>正例、反例与限制</h4><ul>{lesson.counterexamplesZh.map((value) => <li key={value}>{value}</li>)}</ul>
  </details>;
}
