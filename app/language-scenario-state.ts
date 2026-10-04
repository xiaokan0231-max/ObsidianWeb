import type { ScenarioAttemptEvent, ScenarioAttemptPayload, ScenarioLesson } from "../lib/language-scenario.ts";

export type ScenarioDraft = {
  version: 1;
  courseId: string;
  payload: ScenarioAttemptPayload;
  stepIndex: number;
  responses: Record<string, string>;
  updatedAt: string;
  savedAt?: string;
  completed: boolean;
  pendingCompletion?: boolean;
};

export const SCENARIO_STORAGE_PREFIX = "echo:language-scenario:v1:";

export function scenarioStorageKey(courseId: string, revision: string) {
  return `${SCENARIO_STORAGE_PREFIX}${courseId}:${revision}`;
}

export function createScenarioDraft(courseId: string, lesson: ScenarioLesson, revision: string, attemptId: string): ScenarioDraft {
  return {
    version: 1, courseId, stepIndex: 0, responses: {}, completed: false, updatedAt: new Date().toISOString(),
    payload: {
      attemptId, revision,
      steps: lesson.steps.map((step) => ({
        stepId: step.id, answer: "", revealed: false, audio: "not-played",
        answerBasis: "unavailable", usedHintBeforeAnswer: false,
      })),
      assessments: { listening: "no-evidence", expression: "no-evidence" },
    },
  };
}

export function restoreScenarioDraft(raw: string | null, courseId: string, lesson: ScenarioLesson, revision: string): ScenarioDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ScenarioDraft;
    if (value.version !== 1 || value.courseId !== courseId || value.payload?.revision !== revision ||
      typeof value.payload.attemptId !== "string" || !Array.isArray(value.payload.steps) ||
      value.payload.steps.length !== lesson.steps.length || !value.responses || typeof value.responses !== "object" ||
      typeof value.updatedAt !== "string" || typeof value.completed !== "boolean") return null;
    if (!value.payload.steps.every((entry, index) => entry.stepId === lesson.steps[index].id &&
      typeof entry.answer === "string" && typeof entry.revealed === "boolean" &&
      ["audio", "text", "unavailable"].includes(entry.answerBasis) &&
      ["not-played", "synthetic-completed", "text"].includes(entry.audio) && typeof entry.usedHintBeforeAnswer === "boolean")) return null;
    const assessments = value.payload.assessments;
    if (!assessments || ![assessments.listening, assessments.expression].every((entry) =>
      ["independent", "prompted", "practice", "no-evidence"].includes(entry))) return null;
    if (!Object.values(value.responses).every((entry) => typeof entry === "string")) return null;
    return { ...value, stepIndex: Math.min(Math.max(Math.floor(Number(value.stepIndex) || 0), 0), lesson.steps.length - 1) };
  } catch { return null; }
}

export function scenarioDraftFromEvent(courseId: string, lesson: ScenarioLesson, event: ScenarioAttemptEvent): ScenarioDraft {
  const draft = createScenarioDraft(courseId, lesson, event.revision, event.attemptId);
  const byId = new Map(event.steps.map((entry) => [entry.stepId, entry]));
  const steps = draft.payload.steps.map((entry) => byId.get(entry.stepId) ?? entry);
  const firstOpen = steps.findIndex((entry) => !entry.answer.trim());
  return {
    ...draft,
    payload: { ...draft.payload, steps, assessments: event.assessments },
    stepIndex: firstOpen < 0 ? lesson.steps.length - 1 : firstOpen,
    responses: Object.fromEntries(steps.map((entry) => [entry.stepId, entry.answer])),
    updatedAt: event.at, savedAt: event.at, completed: event.action === "completed",
  };
}

// 播放后的补听不能把已看文字或已提交的答案洗成听力证据。
export function commitScenarioAnswer(draft: ScenarioDraft, index: number): ScenarioDraft {
  const current = draft.payload.steps[index];
  if (!current || current.answer.trim()) return draft;
  const answer = (draft.responses[current.stepId] ?? "").trim();
  if (!answer) return draft;
  return {
    ...draft,
    payload: {
      ...draft.payload,
      steps: draft.payload.steps.map((entry, i) => i !== index ? entry : {
        ...entry, answer, revealed: true,
        answerBasis: entry.usedHintBeforeAnswer || entry.audio === "text" ? "text" :
          entry.audio === "synthetic-completed" ? "audio" : "unavailable",
      }),
    },
  };
}

export function localJapaneseVoice<T extends { lang: string; localService: boolean }>(voices: readonly T[]): T | undefined {
  return voices.find((voice) => /^ja(?:[-_]|$)/iu.test(voice.lang) && voice.localService === true);
}

// 同一快照使用同一请求 ID；网络结果不明时重试不会再追加一条。
export function scenarioEventId(payload: ScenarioAttemptPayload, action: "checkpoint" | "completed") {
  let hash = 2166136261;
  for (const character of JSON.stringify(payload)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${payload.attemptId}:${action}:${(hash >>> 0).toString(36)}`;
}

export function listeningEvidence(draft: ScenarioDraft, lesson: ScenarioLesson) {
  const entries = draft.payload.steps.filter((entry) => {
    const step = lesson.steps.find((candidate) => candidate.id === entry.stepId);
    return step && ["listen", "verify", "transfer"].includes(step.kind) && entry.answer.trim();
  });
  return {
    hasAudio: entries.some((entry) => entry.answerBasis === "audio"),
    usedHint: entries.some((entry) => entry.usedHintBeforeAnswer),
    allAudio: entries.length > 0 && entries.every((entry) => entry.answerBasis === "audio"),
  };
}

export function scenarioResponseContext(draft: ScenarioDraft, lesson: ScenarioLesson, index: number) {
  if (lesson.steps[index]?.kind !== "respond") return null;
  const previous = lesson.steps.slice(0, index).findLast((step) => step.kind === "stance" || step.kind === "transfer");
  if (!previous) return null;
  return {
    label: previous.kind === "stance" ? "你刚才用中文写的立场" : "你对新问题的中文理解",
    answer: draft.payload.steps.find((entry) => entry.stepId === previous.id)?.answer ?? "",
  };
}
