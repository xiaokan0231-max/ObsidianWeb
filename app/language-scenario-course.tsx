"use client";

import "./styles/language-scenario.css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Note } from "@/lib/notes";
import { postJson } from "@/lib/client-api";
import { languageExpressionProgressPath, type LanguageExpressionCourse } from "@/lib/language-expression-course";
import { parseScenarioAttempts, scenarioRevision, type ScenarioAttemptEvent, type ScenarioLesson } from "@/lib/language-scenario";
import { commitScenarioAnswer, createScenarioDraft, listeningEvidence, localJapaneseVoice, restoreScenarioDraft, scenarioDraftFromEvent, scenarioEventId, scenarioResponseContext, scenarioStorageKey, SCENARIO_STORAGE_PREFIX, type ScenarioDraft } from "./language-scenario-state";
import { useUiLocale } from "./ui-locale";
import { createScenarioCopy, type ScenarioCopyKey } from "./language-scenario-copy";

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
  let warning: ScenarioCopyKey | "" = "";
  try {
    local = restoreScenarioDraft(localStorage.getItem(key), course.courseId, lesson, revision);
    if (!local && Object.keys(localStorage).some((name) => name.startsWith(`${SCENARIO_STORAGE_PREFIX}${course.courseId}:`) && !name.startsWith(`${key}:`) && name !== key)) {
      warning = "storageUpdated";
    }
  } catch { warning = "storageReadFailed"; }
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
  const { locale } = useUiLocale();
  const { t } = createScenarioCopy(locale);
  const mounted = useSyncExternalStore(subscribeMounted, clientMounted, serverMounted);
  if (!props.course.scenario) return null;
  if (!mounted) return <section className="scenario-workbench" lang={locale}><p>{t("restoring")}</p></section>;
  return <ScenarioWorkbench key={`${props.course.courseId}:${scenarioRevision(props.course.scenario)}`} {...props} lesson={props.course.scenario} />;
}

function ScenarioWorkbench({ course, lesson, notes, onNoteWritten, onVaultChanged }: Props & { lesson: ScenarioLesson }) {
  const { locale } = useUiLocale();
  const { t, label, number, dateTime } = createScenarioCopy(locale);
  const [initial] = useState(() => initialDraft(course, lesson, notes));
  const [draft, setDraft] = useState(initial.draft);
  const draftRef = useRef(initial.draft);
  const [storageWarning, setStorageWarning] = useState<ScenarioCopyKey | "">(initial.warning);
  const [message, setMessage] = useState<ScenarioCopyKey | "">("");
  const [error, setError] = useState<{ action: "checkpoint" | "completed"; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const saveLock = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [audioMessage, setAudioMessage] = useState<ScenarioCopyKey | "">("");
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
    } catch { setStorageWarning("storageWriteFailed"); }
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
    if (!voice) { setAudioMessage("audioUnavailable"); return; }
    stopSpeech();
    const token = ++speechToken.current;
    const index = draftRef.current.stepIndex;
    const utterance = new SpeechSynthesisUtterance(step.promptJa);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.9;
    setSpeaking(true);
    setAudioMessage("audioPlaying");
    utterance.onend = () => {
      if (speechToken.current !== token) return;
      if (speechTimer.current) clearTimeout(speechTimer.current);
      setSpeaking(false);
      setAudioMessage("audioEnded");
      changeEntry((value) => ({ ...value, audio: value.audio === "text" ? "text" : "synthetic-completed" }), index);
    };
    utterance.onerror = () => {
      if (speechToken.current !== token) return;
      stopSpeech();
      setAudioMessage("audioFailed");
    };
    speechTimer.current = setTimeout(() => {
      if (speechToken.current !== token) return;
      stopSpeech();
      setAudioMessage("audioTimeout");
    }, 30000);
    window.speechSynthesis.speak(utterance);
  }

  function useText() {
    if (draftRef.current.completed || draftRef.current.pendingCompletion || saveLock.current) return;
    stopSpeech();
    changeEntry((value) => value.answer.trim() ? value : ({ ...value, audio: "text", revealed: true, usedHintBeforeAnswer: value.usedHintBeforeAnswer || ["listen", "verify", "transfer"].includes(step.kind) }));
    setAudioMessage("audioText");
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
    setError(null);
    setMessage("");
    const snapshot = action === "completed" ? update((value) => ({ ...value, pendingCompletion: true })) : draftRef.current;
    try {
      const result = await postJson<{ ok: true; event: ScenarioAttemptEvent; note?: Note }>("/api/language/topics/progress", {
        eventId: scenarioEventId(snapshot.payload, action), courseId: course.courseId, exercise: "scenario", action, payload: snapshot.payload,
      });
      const confirmed = scenarioDraftFromEvent(course.courseId, lesson, result.event);
      update((current) => ({ ...current, payload: confirmed.payload, savedAt: result.event.at, completed: result.event.action === "completed", pendingCompletion: false }));
      setMessage(action === "completed" ? "savedCompleted" : "savedCheckpoint");
      if (result.note && onNoteWritten) onNoteWritten(result.note);
      else {
        try { await onVaultChanged(); }
        catch { setMessage("savedRefreshFailed"); }
      }
    } catch (cause) {
      setError({ action, detail: cause instanceof Error ? cause.message : "" });
    } finally { saveLock.current = false; setBusy(false); }
  }

  function freshAttempt() {
    stopSpeech();
    update(() => createScenarioDraft(course.courseId, lesson, scenarioRevision(lesson), newAttemptId()));
    setMessage("freshAttempt");
    setError(null);
    setAudioMessage("");
  }

  return (
    <section className="scenario-workbench" lang={locale} aria-label={t("workbench")}>
      <header className="scenario-header">
        <div><small>{t("duration", { minutes: lesson.durationMinutes })}</small><h2 lang="zh-CN">{course.title}</h2><p lang="zh-CN">{lesson.introZh}</p></div>
        <span className="scenario-progress-label">{number(completedCount)} / {number(lesson.steps.length)}<small>{t("confirmedSteps")}</small></span>
      </header>
      <nav className="scenario-steps" aria-label={t("steps")}>
        {lesson.steps.map((item, index) => <button key={item.id} type="button" disabled={index > furthest || busy || speaking} aria-current={index === draft.stepIndex ? "step" : undefined} onClick={() => move(index)}>
          <span>{draft.payload.steps[index].answer.trim() ? "✓" : number(index + 1)}</span>{label(KIND_LABELS[item.kind])}
        </button>)}
      </nav>
      {storageWarning && <p className="scenario-warning" role="status">{t(storageWarning)}</p>}
      <article className="scenario-stage">
        <div className="scenario-stage-heading"><small>{t("stepProgress", { current: draft.stepIndex + 1, total: lesson.steps.length })}</small><h3 lang="zh-CN">{step.titleZh}</h3><p lang="zh-CN">{step.instructionZh}</p></div>
        {step.promptJa && <div className="scenario-audio">
          <div><strong>{t(entry.audio === "text" ? "textMode" : "syntheticMode")}</strong><p>{localVoice ? t("localVoice", { name: localVoice.name }) : t("noLocalVoice")}</p></div>
          <div className="scenario-audio-actions"><button type="button" onClick={play} disabled={!localVoice || speaking || locked}>{t(speaking ? "playing" : "play")}</button>
            {speaking && <button type="button" onClick={stopSpeech}>{t("stop")}</button>}
            {!committed && <button type="button" onClick={useText} disabled={locked || speaking}>{t("enterText")}</button>}</div>
          {audioMessage && <p role="status">{t(audioMessage)}</p>}
          {!entry.revealed && <p className="scenario-hidden-prompt">{t("hiddenPrompt")}</p>}
          {entry.revealed && <blockquote lang="ja">{step.promptJa}</blockquote>}
        </div>}
        {responseContext && <div className="scenario-own-points"><strong>{label(responseContext.label)}</strong><p lang={responseContext.answer ? "und" : locale}>{responseContext.answer || t("emptyAnswer")}</p></div>}
        {step.factBoundaryZh && (committed || !step.promptJa) && <p className="scenario-boundary" lang="zh-CN">{step.factBoundaryZh}</p>}
        <label className="scenario-answer-label" htmlFor={`scenario-answer-${step.id}`}>{t(["respond", "repair"].includes(step.kind) ? "answerJa" : step.kind === "stance" ? "answerStance" : "answerUnderstanding")}</label>
        <textarea id={`scenario-answer-${step.id}`} key={`${draft.payload.attemptId}:${step.id}`} value={committed ? entry.answer : draft.responses[step.id] ?? ""} lang="und" rows={4} maxLength={5000} readOnly={committed || locked} disabled={busy} placeholder={t("answerPlaceholder")} onChange={(event) => { const answer = event.target.value; update((current) => ({ ...current, responses: { ...current.responses, [step.id]: answer } })); }} />
        {!committed ? <div className="scenario-confirm-row"><button type="button" className="scenario-primary" disabled={locked || speaking || !(draft.responses[step.id] ?? "").trim()} onClick={() => update((current) => commitScenarioAnswer(current, current.stepIndex))}>{t("confirmAnswer")}</button><span>{t("retainAnswer")}</span></div> : <>
          <p className="scenario-answer-basis">{t("answerRetained")} · {t(entry.answerBasis === "audio" ? "basisAudio" : entry.answerBasis === "text" ? "basisText" : "basisUnavailable")}</p>
          <section className="scenario-review" aria-label={t("reviewLabel")}>
            <h4>{t("reviewHeading")}</h4>
            <ul lang="zh-CN">{step.expectedZh.map((value) => <li key={value}>{value}</li>)}</ul>
            {step.choicesZh && step.choicesZh.length > 0 && <details><summary>{t("choices")}</summary><ul lang="zh-CN">{step.choicesZh.map((value) => <li key={value}>{value}</li>)}</ul></details>}
            {(step.hintsZh.length > 0 || step.examplesJa.length > 0) && <details><summary>{t("hints")}</summary>{step.hintsZh.map((value) => <p lang="zh-CN" key={value}>{value}</p>)}{step.examplesJa.map((value) => <p className="scenario-example" lang="ja" key={value}>{value}</p>)}<p>{t("exampleBoundary")}</p></details>}
            <p className="scenario-self-note">{t("selfNote")}</p>
          </section>
        </>}
        <footer className="scenario-step-footer"><button type="button" disabled={draft.stepIndex === 0 || busy || speaking} onClick={() => move(draft.stepIndex - 1)}>{t("previous")}</button><span>{t("currentTask")}</span><button type="button" className="scenario-primary" disabled={!committed || draft.stepIndex === lesson.steps.length - 1 || busy || speaking} onClick={() => move(draft.stepIndex + 1)}>{t("next")}</button></footer>
      </article>
      {allAnswered && <>
        <section className="scenario-assessment">
          <h3>{t("assessment")}</h3><p>{t("assessmentHelp")}</p>
          <div className="scenario-assessment-grid">{(["listening", "expression"] as const).map((axis) => <fieldset key={axis} disabled={locked}><legend>{t(axis === "listening" ? "listeningAxis" : "expressionAxis")}</legend>{ASSESSMENTS.map(([value, text]) => <label key={value}><input type="radio" name={`${draft.payload.attemptId}-${axis}`} value={value} checked={draft.payload.assessments[axis] === value} disabled={axis === "listening" && ((!evidence.hasAudio && value !== "no-evidence") || (value === "independent" && (!evidence.allAudio || evidence.usedHint)))} onChange={() => update((current) => ({ ...current, payload: { ...current.payload, assessments: { ...current.payload.assessments, [axis]: value } } }))} />{label(text)}</label>)}</fieldset>)}</div>
          <p>{t(!evidence.hasAudio ? "noListeningEvidence" : !evidence.allAudio || evidence.usedHint ? "partialListeningEvidence" : "listeningEvidence")}</p>
        </section>
        <EvidencePanel lesson={lesson} />
      </>}
      <footer className="scenario-save-bar">
        <div><strong>{t(draft.completed ? "roundSaved" : "localDraft")}</strong><p>{draft.savedAt ? t("lastSaved", { date: dateTime(draft.savedAt) }) : t("notSaved")}</p></div>
        <div>{!draft.completed && !draft.pendingCompletion && <button type="button" disabled={busy || speaking || completedCount === 0} onClick={() => void save("checkpoint")}>{t(busy ? "saving" : "saveCheckpoint")}</button>}
          {!draft.completed && allAnswered && <button type="button" className="scenario-primary" disabled={busy || speaking} onClick={() => void save("completed")}>{t(busy ? "saving" : draft.pendingCompletion ? "retrySave" : "saveCompleted")}</button>}
          {completedCount > 0 && <button type="button" disabled={busy || speaking} onClick={freshAttempt}>{t("newRound")}</button>}</div>
      </footer>
      {message && <p className="scenario-message" role="status">{t(message)}</p>}
      {error && <div className="scenario-error" role="alert"><p>{t("saveFailed")} {t("saveFailureSafety")}{error.action === "completed" && t("saveRetrySafety")}</p>{error.detail && <details><summary>{t("errorDetail")}</summary><p lang="und">{error.detail}</p></details>}</div>}
    </section>
  );
}

function EvidencePanel({ lesson }: { lesson: ScenarioLesson }) {
  const { locale } = useUiLocale();
  const { t, label } = createScenarioCopy(locale);
  return <details className="scenario-evidence"><summary>{t("evidenceHeading")}</summary>
    <p>{t("evidenceBoundary")}</p>
    {lesson.evidence.map((source, index) => <article key={`${source.path}:${source.locator}:${index}`}><strong>{label(EVIDENCE_LABELS[source.kind])} · <span lang="und">{source.locator}</span></strong><a lang="und" href={`obsidian://open?file=${encodeURIComponent(source.path.replace(/\.md$/u, ""))}`}>{source.path}</a><blockquote lang="und">{source.excerpt}</blockquote></article>)}
    <h4>{t("observations")}</h4><ul lang="zh-CN">{lesson.observationsZh.map((value) => <li key={value}>{value}</li>)}</ul>
    <h4>{t("hypotheses")}</h4>{lesson.hypotheses.map((value, index) => <p key={index}><b>{label(HYPOTHESIS_LABELS[value.kind])} · {label(CONFIDENCE_LABELS[value.confidence])}</b> <span lang="zh-CN">{value.detailZh}</span></p>)}
    <h4>{t("counterexamples")}</h4><ul lang="zh-CN">{lesson.counterexamplesZh.map((value) => <li key={value}>{value}</li>)}</ul>
  </details>;
}
