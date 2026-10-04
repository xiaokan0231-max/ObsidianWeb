/** 情境课只记录本人作答与自评；合成音、文字提示和模型判断不能冒充原声听力证据。 */
export type ScenarioStepKind = "listen" | "verify" | "stance" | "respond" | "repair" | "transfer" | "reflect";
export type ScenarioAssessment = "independent" | "prompted" | "practice" | "no-evidence";
export type ScenarioEvidenceKind = "transcript" | "study" | "annotation" | "review" | "recollection" | "fact";
export type ScenarioHypothesisKind =
  | "confirmed-misunderstanding"
  | "possible-partial-understanding"
  | "expression-limited"
  | "focus-shift"
  | "asr-uncertain";

export type ScenarioStep = {
  id: string;
  kind: ScenarioStepKind;
  titleZh: string;
  instructionZh: string;
  promptJa?: string;
  expectedZh: string[];
  hintsZh: string[];
  examplesJa: string[];
  factBoundaryZh?: string;
  choicesZh?: string[];
};

export type ScenarioLesson = {
  durationMinutes: number;
  introZh: string;
  evidence: Array<{ kind: ScenarioEvidenceKind; path: string; locator: string; excerpt: string }>;
  observationsZh: string[];
  hypotheses: Array<{ kind: ScenarioHypothesisKind; confidence: "high" | "medium" | "low"; detailZh: string }>;
  counterexamplesZh: string[];
  steps: ScenarioStep[];
};

export type ScenarioStepAnswer = {
  stepId: string;
  answer: string;
  revealed: boolean;
  audio: "not-played" | "synthetic-completed" | "text";
  /** 在首次确认作答时锁定，之后播放音频不能倒推为听懂后作答。 */
  answerBasis: "audio" | "text" | "unavailable";
  usedHintBeforeAnswer: boolean;
};

export type ScenarioAttemptPayload = {
  attemptId: string;
  revision: string;
  steps: ScenarioStepAnswer[];
  assessments: { listening: ScenarioAssessment; expression: ScenarioAssessment };
};

export type ScenarioAttemptEvent = ScenarioAttemptPayload & {
  eventId: string;
  courseId: string;
  action: "checkpoint" | "completed";
  at: string;
  requestFingerprint?: string;
};

export type ScenarioProgress = {
  attempts: ScenarioAttemptEvent[];
  latest?: ScenarioAttemptEvent;
};

export const SCENARIO_START = "<!-- language-scenario-json:start -->";
export const SCENARIO_END = "<!-- language-scenario-json:end -->";
export const SCENARIO_ATTEMPT_MARKER = "language-scenario-attempt";
const STEP_KINDS: ScenarioStepKind[] = ["listen", "verify", "stance", "respond", "repair", "transfer", "reflect"];
const ASSESSMENTS: ScenarioAssessment[] = ["independent", "prompted", "practice", "no-evidence"];
const EVIDENCE_KINDS: ScenarioEvidenceKind[] = ["transcript", "study", "annotation", "review", "recollection", "fact"];
const HYPOTHESIS_KINDS: ScenarioHypothesisKind[] = ["confirmed-misunderstanding", "possible-partial-understanding", "expression-limited", "focus-shift", "asr-uncertain"];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export class ScenarioValidationError extends Error {
  readonly status = 400;
}

export class ScenarioConflictError extends Error {
  readonly status = 409;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ScenarioValidationError(`${label} 格式不正确。`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, max = 4000, allowEmpty = false) {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
    throw new ScenarioValidationError(`${label} 必须是${allowEmpty ? "" : "非空"}文本，且不超过 ${max} 字。`);
  }
  return value.trim();
}

function list(value: unknown, label: string, max: number) {
  if (!Array.isArray(value) || value.length > max) throw new ScenarioValidationError(`${label} 必须是最多 ${max} 项的数组。`);
  return value;
}

function strings(value: unknown, label: string, max = 16) {
  return list(value, label, max).map((entry) => string(entry, label));
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new ScenarioValidationError(`${label} 不受支持。`);
  return value as T;
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new ScenarioValidationError(`${label} 必须是布尔值。`);
  return value;
}

function identifier(value: unknown, label: string) {
  const result = string(value, label, 128);
  if (!ID.test(result)) throw new ScenarioValidationError(`${label} 格式不正确。`);
  return result;
}

export function validateScenarioLesson(value: unknown): ScenarioLesson {
  const raw = record(value, "情境课程");
  if (typeof raw.durationMinutes !== "number" || !Number.isInteger(raw.durationMinutes) || raw.durationMinutes < 15 || raw.durationMinutes > 25) {
    throw new ScenarioValidationError("情境课时长必须是 15–25 分钟。");
  }
  const steps = list(raw.steps, "步骤", 16).map((entry): ScenarioStep => {
    const step = record(entry, "步骤");
    return {
      id: identifier(step.id, "步骤 ID"),
      kind: enumeration(step.kind, STEP_KINDS, "步骤类型"),
      titleZh: string(step.titleZh, "步骤标题", 200),
      instructionZh: string(step.instructionZh, "步骤说明"),
      ...(step.promptJa !== undefined ? { promptJa: string(step.promptJa, "日语题目") } : {}),
      expectedZh: strings(step.expectedZh, "核对要点"),
      hintsZh: strings(step.hintsZh, "提示"),
      examplesJa: strings(step.examplesJa, "日语练习示例"),
      ...(step.factBoundaryZh !== undefined ? { factBoundaryZh: string(step.factBoundaryZh, "事实边界") } : {}),
      ...(step.choicesZh !== undefined ? { choicesZh: strings(step.choicesZh, "选择项", 8) } : {}),
    };
  });
  if (new Set(steps.map((step) => step.id)).size !== steps.length) throw new ScenarioValidationError("情境步骤 ID 重复。");
  if (STEP_KINDS.some((kind) => !steps.some((step) => step.kind === kind))) throw new ScenarioValidationError("情境课必须包含听辨、验证、中文立场、日语回应、修复、迁移与复盘。");
  const firstPositions = STEP_KINDS.map((kind) => steps.findIndex((step) => step.kind === kind));
  if (steps[0]?.kind !== "listen" || steps.at(-1)?.kind !== "reflect" ||
    firstPositions.some((position, index) => index > 0 && position < firstPositions[index - 1])) {
    throw new ScenarioValidationError("情境步骤必须先理解，再表达、修复和迁移。");
  }
  if (steps.some((step) => step.kind === "listen" && (!step.promptJa || step.choicesZh?.length))) {
    throw new ScenarioValidationError("首次听辨必须有日语题目，且不能先提供选择项。");
  }
  const evidence = list(raw.evidence, "证据", 30).map((entry) => {
    const ref = record(entry, "证据");
    return {
      kind: enumeration(ref.kind, EVIDENCE_KINDS, "证据类型"),
      path: string(ref.path, "证据路径", 2000),
      locator: string(ref.locator, "证据定位", 1000),
      excerpt: string(ref.excerpt, "证据摘录", 12000),
    };
  });
  if (!evidence.length) throw new ScenarioValidationError("情境课必须保留来源证据。");
  return {
    durationMinutes: raw.durationMinutes,
    introZh: string(raw.introZh, "课程说明"),
    evidence,
    observationsZh: strings(raw.observationsZh, "观察事实", 30),
    hypotheses: list(raw.hypotheses, "解释与假设", 20).map((entry) => {
      const hypothesis = record(entry, "解释与假设");
      return {
        kind: enumeration(hypothesis.kind, HYPOTHESIS_KINDS, "解释类型"),
        confidence: enumeration(hypothesis.confidence, ["high", "medium", "low"] as const, "置信度"),
        detailZh: string(hypothesis.detailZh, "解释内容"),
      };
    }),
    counterexamplesZh: strings(raw.counterexamplesZh, "反例与限制", 30),
    steps,
  };
}

export function parseScenarioLesson(content: string): ScenarioLesson {
  const start = content.indexOf(SCENARIO_START);
  const end = content.indexOf(SCENARIO_END, start + SCENARIO_START.length);
  if (start < 0 || end < 0) throw new ScenarioValidationError("情境课缺少 language-scenario-json 区块。");
  const source = content.slice(start + SCENARIO_START.length, end).replace(/^\s*```json\s*/iu, "").replace(/\s*```\s*$/u, "").trim();
  if (source.length > 200000) throw new ScenarioValidationError("情境课程内容过长。");
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { throw new ScenarioValidationError("情境课程 JSON 格式不正确。"); }
  return validateScenarioLesson(raw);
}

export function scenarioRevision(lesson: ScenarioLesson) {
  // 版本指纹只用于阻止旧草稿写进新教材，不承担签名或身份验证。
  return `scenario-${fingerprint(lesson)}`;
}

function fingerprint(value: unknown) {
  let first = 2166136261;
  let second = 5381;
  for (const char of JSON.stringify(value)) {
    first = Math.imul(first ^ char.charCodeAt(0), 16777619);
    second = Math.imul(second, 33) ^ char.charCodeAt(0);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function parsePayload(value: unknown): ScenarioAttemptPayload {
  const raw = record(value, "作答记录");
  const assessments = record(raw.assessments, "自评");
  const steps = list(raw.steps, "步骤作答", 16).map((entry): ScenarioStepAnswer => {
    const step = record(entry, "步骤作答");
    return {
      stepId: identifier(step.stepId, "作答步骤 ID"),
      answer: string(step.answer, "作答", 6000, true),
      revealed: boolean(step.revealed, "是否已揭示"),
      audio: enumeration(step.audio, ["not-played", "synthetic-completed", "text"] as const, "音频状态"),
      answerBasis: enumeration(step.answerBasis, ["audio", "text", "unavailable"] as const, "作答依据"),
      usedHintBeforeAnswer: boolean(step.usedHintBeforeAnswer, "作答前是否用提示"),
    };
  });
  if (new Set(steps.map((step) => step.stepId)).size !== steps.length) throw new ScenarioValidationError("步骤作答 ID 重复。");
  return {
    attemptId: identifier(raw.attemptId, "attemptId"),
    revision: string(raw.revision, "课程版本", 100),
    steps,
    assessments: {
      listening: enumeration(assessments.listening, ASSESSMENTS, "听力理解自评"),
      expression: enumeration(assessments.expression, ASSESSMENTS, "日语表达自评"),
    },
  };
}

function eventContent(event: ScenarioAttemptEvent) {
  return JSON.stringify({ ...event, at: undefined });
}

export function prepareScenarioAttempt(input: {
  courseId: string;
  lesson: ScenarioLesson;
  eventId: unknown;
  action: unknown;
  payload: unknown;
  events: ScenarioAttemptEvent[];
  at: string;
}): { event: ScenarioAttemptEvent; scenarioState: ScenarioProgress; deduplicated: boolean } {
  const eventId = identifier(input.eventId, "eventId");
  const action = enumeration(input.action, ["checkpoint", "completed"] as const, "情境保存操作");
  const payload = parsePayload(input.payload);
  const requestFingerprint = fingerprint({ action, payload });
  if (payload.revision !== scenarioRevision(input.lesson)) throw new ScenarioConflictError("课程已更新，请重新打开课程并开始新一轮练习；原作答仍保留。");
  const byId = new Map(input.lesson.steps.map((step) => [step.id, step]));
  if (payload.steps.some((step) => !byId.has(step.stepId))) throw new ScenarioValidationError("作答包含不属于这门课的步骤。");
  const events = input.events.filter((event) => event.courseId === input.courseId);
  const duplicateIndex = events.findIndex((entry) => entry.eventId === eventId);
  const duplicate = events[duplicateIndex];
  if (duplicate?.requestFingerprint && duplicate.requestFingerprint !== requestFingerprint) {
    throw new ScenarioConflictError("相同 eventId 的内容不同，请保留原记录并用新的 eventId 保存。");
  }
  // 网络重试应重现当时的合并结果，不让后来保存的步骤影响旧事件的幂等判断。
  const history = duplicateIndex >= 0 ? events.slice(0, duplicateIndex) : events;
  const previous = history.filter((event) => event.attemptId === payload.attemptId).at(-1);
  if (previous && previous.revision !== payload.revision) throw new ScenarioConflictError("这一轮作答对应旧教材，请使用新的 attemptId。");
  const answers = new Map(previous?.steps.map((step) => [step.stepId, step]) ?? []);
  for (const step of payload.steps) {
    const prior = answers.get(step.stepId);
    if (prior?.answer && step.answer && prior.answer !== step.answer) {
      throw new ScenarioConflictError("这一步已有已确认原答，请保留本轮并开始新一轮；不能用新答案覆盖原答。");
    }
    if (step.answerBasis === "audio" && step.audio !== "synthetic-completed") throw new ScenarioValidationError("音频作答依据需要已完成合成音播放。");
    answers.set(step.stepId, {
      ...step,
      // 另一个标签页可能仍持有空白草稿；原答和首次作答依据必须作为一组保留。
      answer: prior?.answer || step.answer,
      audio: prior?.answer ? prior.audio : step.audio,
      revealed: Boolean(prior?.revealed || step.revealed),
      answerBasis: prior?.answer ? prior.answerBasis : step.answerBasis,
      usedHintBeforeAnswer: Boolean(prior?.usedHintBeforeAnswer || step.usedHintBeforeAnswer ||
        (["listen", "verify", "transfer"].includes(byId.get(step.stepId)!.kind) && step.answerBasis === "text")),
    });
  }
  payload.steps = input.lesson.steps.flatMap((step) => answers.has(step.id) ? [answers.get(step.id)!] : []);
  if (action === "completed" && payload.steps.length !== input.lesson.steps.length) throw new ScenarioValidationError("完成前请确认每一步；没有回答也可以如实留下空白。");
  const listeningAnswers = payload.steps.filter((step) => ["listen", "verify", "transfer"].includes(byId.get(step.stepId)!.kind) && step.answer);
  const audioAnswers = listeningAnswers.filter((step) => step.audio === "synthetic-completed" && step.answerBasis === "audio");
  if (!audioAnswers.length) payload.assessments.listening = "no-evidence";
  else if (payload.assessments.listening === "independent" && listeningAnswers.some((step) => step.usedHintBeforeAnswer || step.answerBasis !== "audio")) payload.assessments.listening = "prompted";
  const expressionAnswers = payload.steps.filter((step) => ["respond", "repair"].includes(byId.get(step.stepId)!.kind) && step.answer);
  if (!expressionAnswers.length) payload.assessments.expression = "no-evidence";
  else if (payload.assessments.expression === "independent" && expressionAnswers.some((step) => step.usedHintBeforeAnswer)) payload.assessments.expression = "prompted";
  const event: ScenarioAttemptEvent = { eventId, courseId: input.courseId, action, at: input.at, ...payload, requestFingerprint };
  if (duplicate) {
    if (eventContent(duplicate) !== eventContent(event)) throw new ScenarioConflictError("相同 eventId 的内容不同，请保留原记录并用新的 eventId 保存。");
    return { event: duplicate, scenarioState: deriveScenarioProgress(events), deduplicated: true };
  }
  if (previous?.action === "completed") throw new ScenarioConflictError("这一轮已完成，请开始新一轮练习。");
  return { event, scenarioState: deriveScenarioProgress([...events, event]), deduplicated: false };
}

export function renderScenarioAttempt(event: ScenarioAttemptEvent) {
  const json = JSON.stringify(event).replace(/</gu, "\\u003c").replace(/--/gu, "\\u002d\\u002d");
  return `\n<!-- ${SCENARIO_ATTEMPT_MARKER}:${json} -->\n`;
}

export function parseScenarioAttempts(content: string): ScenarioAttemptEvent[] {
  const events: ScenarioAttemptEvent[] = [];
  const marker = new RegExp(`<!--\\s*${SCENARIO_ATTEMPT_MARKER}:(\\{[\\s\\S]*?\\})\\s*-->`, "gu");
  for (const match of content.matchAll(marker)) {
    try {
      const raw = record(JSON.parse(match[1]), "练习事件");
      const at = string(raw.at, "保存时间", 40);
      if (!Number.isFinite(Date.parse(at))) continue;
      events.push({
        eventId: identifier(raw.eventId, "eventId"),
        courseId: string(raw.courseId, "courseId", 64),
        action: enumeration(raw.action, ["checkpoint", "completed"] as const, "练习操作"),
        at,
        ...parsePayload(raw),
        ...(typeof raw.requestFingerprint === "string" ? { requestFingerprint: raw.requestFingerprint } : {}),
      });
    } catch {
      // 单条损坏不能抹掉同一笔记中此前有效的练习记录。
    }
  }
  return events;
}

export function deriveScenarioProgress(events: ScenarioAttemptEvent[]): ScenarioProgress {
  const latestByAttempt = new Map<string, ScenarioAttemptEvent>();
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    latestByAttempt.set(event.attemptId, event);
  }
  const attempts = [...latestByAttempt.values()].sort((left, right) => right.at.localeCompare(left.at));
  return { attempts, ...(attempts[0] ? { latest: attempts[0] } : {}) };
}
