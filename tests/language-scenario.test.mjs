import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deriveScenarioProgress,
  parseScenarioAttempts,
  parseScenarioLesson,
  prepareScenarioAttempt,
  renderScenarioAttempt,
  scenarioRevision,
  ScenarioConflictError,
  ScenarioValidationError,
  validateScenarioLesson,
} from "../lib/language-scenario.ts";
import {
  languageExpressionProgressPath,
  parseLanguageExpressionCourse,
  parseLanguageExpressionProgress,
  renderLanguageExpressionProgressEvent,
} from "../lib/language-expression-course.ts";

function lesson() {
  return {
    durationMinutes: 20,
    introZh: "先确认问题在问什么，再用短句表达自己的立场。音频为练习合成音。",
    evidence: [{ kind: "transcript", path: "20_求職/株式会社テスト/面接.md", locator: "q01 / L10–14", excerpt: "前職では、どのような役割でしたか。" }],
    observationsZh: ["原问题询问过去的职责。"],
    hypotheses: [{ kind: "possible-partial-understanding", confidence: "low", detailZh: "仅是待验证假设，未确认听解原因。" }],
    counterexamplesZh: ["没有原始音频，不能据转写评价语速或发音。"],
    steps: ["listen", "verify", "verify", "stance", "respond", "repair", "transfer", "respond", "reflect"].map((kind, index) => ({
      id: `step-${index + 1}`,
      kind,
      titleZh: `练习 ${index + 1}`,
      instructionZh: "先独立作答，再展开核对。",
      ...(["listen", "verify", "transfer"].includes(kind) ? { promptJa: "前職では、どのような役割でしたか。" } : {}),
      expectedZh: ["区分过去的职责与未来的希望。"],
      hintsZh: ["注意前職。"],
      examplesJa: ["前職での役割について、ということでしょうか。"],
      factBoundaryZh: "请填写自己已确认的事实。",
    })),
  };
}

function payload(source = lesson()) {
  return {
    attemptId: "attempt-1",
    revision: scenarioRevision(source),
    steps: source.steps.map((step) => ({
      stepId: step.id,
      answer: step.kind === "listen" ? "在问过去承担什么职责。" : "自己的练习回答。",
      revealed: false,
      audio: ["listen", "verify", "transfer"].includes(step.kind) ? "synthetic-completed" : "not-played",
      answerBasis: ["listen", "verify", "transfer"].includes(step.kind) ? "audio" : "unavailable",
      usedHintBeforeAnswer: false,
    })),
    assessments: { listening: "independent", expression: "independent" },
  };
}

function prepare(value = payload(), overrides = {}) {
  return prepareScenarioAttempt({
    courseId: "interview-test",
    lesson: lesson(),
    eventId: "event-1",
    action: "completed",
    payload: value,
    events: [],
    at: "2026-10-04T01:00:00.000Z",
    ...overrides,
  });
}

test("一课一情境沿用专项课程入口，迁移后可再做日语回应", () => {
  const content = `<!-- language-scenario-json:start -->\n\`\`\`json\n${JSON.stringify(lesson())}\n\`\`\`\n<!-- language-scenario-json:end -->`;
  const course = parseLanguageExpressionCourse({
    path: "20_求職/_素材/情境练习.md",
    frontmatter: { type: "material", material_kind: "language-expression-course", schema_version: 2, course_id: "interview-test", title: "职责听辨", topic: "题意确认" },
    content,
  });
  assert.equal(course.schemaVersion, 2);
  assert.equal(course.scenario.steps.length, 9);
  assert.deepEqual(course.chunks, []);
  assert.deepEqual(course.itemIds, lesson().steps.map((step) => step.id));
  assert.equal(languageExpressionProgressPath(course), "30_日本語学習/専門コースログ/interview-test_進捗.md");
  assert.deepEqual(parseScenarioLesson(content), lesson());
});

test("教材校验保留证据与阶段边界，不把首题变成选择题", () => {
  for (const mutate of [
    (value) => { value.evidence = []; },
    (value) => { value.durationMinutes = 60; },
    (value) => { value.steps[0].choicesZh = ["过去", "未来"]; },
    (value) => { value.steps[1].id = value.steps[0].id; },
    (value) => { value.steps[0].kind = "respond"; },
    (value) => { value.hypotheses[0].kind = "did-not-answer-so-cannot-listen"; },
  ]) {
    const value = lesson();
    mutate(value);
    assert.throws(() => validateScenarioLesson(value), ScenarioValidationError);
  }
  assert.notEqual(scenarioRevision(lesson()), scenarioRevision({ ...lesson(), introZh: "更新后的训练要求。" }));
});

test("情境事件与旧练过 marker 共存，损坏记录不抹掉历史", () => {
  const event = prepare().event;
  event.steps[0].answer = "文本含 <!-- 不应截断 -->";
  const old = { eventId: "legacy", courseId: "interview-test", itemId: "c01", exercise: "recall", action: "completed", at: "2026-10-03T00:00:00.000Z" };
  const content = renderLanguageExpressionProgressEvent(old) + "\n<!-- language-scenario-attempt:{broken} -->\n" + renderScenarioAttempt(event);
  assert.deepEqual(parseScenarioAttempts(content), [event]);
  assert.deepEqual(parseLanguageExpressionProgress(content), [old]);
  assert.equal(renderScenarioAttempt(event).includes("<!-- 不应截断"), false);
});

test("无音频独立作答证据时听力保持无证据，表达自评独立保留", () => {
  const value = payload();
  value.steps.forEach((step) => {
    if (step.answerBasis === "audio") { step.audio = "text"; step.answerBasis = "text"; }
  });
  const result = prepare(value);
  assert.equal(result.event.assessments.listening, "no-evidence");
  assert.equal(result.event.assessments.expression, "independent");
  assert.equal(result.event.steps[0].usedHintBeforeAnswer, true);
  assert.equal("score" in result.event, false);
});

test("独立作答后揭示核对不降级，作答前提示分别影响两个维度", () => {
  const after = payload();
  after.steps.forEach((step) => { step.revealed = true; });
  assert.deepEqual(prepare(after).event.assessments, { listening: "independent", expression: "independent" });
  const listeningHint = payload();
  listeningHint.steps[0].usedHintBeforeAnswer = true;
  assert.deepEqual(prepare(listeningHint).event.assessments, { listening: "prompted", expression: "independent" });
  const expressionHint = payload();
  expressionHint.steps[4].usedHintBeforeAnswer = true;
  assert.deepEqual(prepare(expressionHint).event.assessments, { listening: "independent", expression: "prompted" });
});

test("后播放音频不能把同轮已确认的文字作答改成听力证据", () => {
  const first = payload();
  first.steps = [{ ...first.steps[0], audio: "text", answerBasis: "text" }];
  const saved = prepare(first, { action: "checkpoint" }).event;
  const next = payload();
  next.steps.slice(1).forEach((step) => { step.audio = "not-played"; step.answerBasis = "unavailable"; });
  const result = prepare(next, { eventId: "event-2", events: [saved] });
  assert.equal(result.event.steps[0].answerBasis, "text");
  assert.equal(result.event.assessments.listening, "no-evidence");
  assert.equal(result.event.steps[0].usedHintBeforeAnswer, true);
});

test("另一个标签页的空白旧快照不清除已确认原答和音频依据", () => {
  const first = payload();
  first.steps = [first.steps[0]];
  const saved = prepare(first, { action: "checkpoint" }).event;
  const stale = payload();
  stale.steps[0] = { stepId: stale.steps[0].stepId, answer: "", revealed: false, audio: "not-played", answerBasis: "unavailable", usedHintBeforeAnswer: false };
  const merged = prepare(stale, { eventId: "event-2", action: "checkpoint", events: [saved] }).event;
  assert.deepEqual(merged.steps[0], saved.steps[0]);
  const changed = payload();
  changed.steps[0].answer = "另一个标签页事后写的新答案。";
  assert.throws(() => prepare(changed, { eventId: "event-3", action: "checkpoint", events: [saved, merged] }), ScenarioConflictError);
  assert.deepEqual(parseScenarioAttempts(renderScenarioAttempt(saved) + renderScenarioAttempt(merged))[0], saved);
});

test("尚未确认的空白不锁作答依据，完成允许如实记录未回答", () => {
  const first = payload();
  first.steps = [{ ...first.steps[0], answer: "", audio: "not-played", answerBasis: "unavailable" }];
  const saved = prepare(first, { action: "checkpoint" }).event;
  const result = prepare(payload(), { eventId: "event-2", events: [saved] });
  assert.equal(result.event.steps[0].answerBasis, "audio");
  assert.equal(result.event.assessments.listening, "independent");
  const empty = payload();
  empty.steps.forEach((step) => { step.answer = ""; });
  assert.deepEqual(prepare(empty).event.assessments, { listening: "no-evidence", expression: "no-evidence" });
});

test("澄清和需要练习均按本人自评保存，不自动判成错误", () => {
  const value = payload();
  value.steps[5].answer = "前職での役割について、ということでしょうか。";
  value.assessments.listening = "practice";
  const event = prepare(value).event;
  assert.deepEqual(event.assessments, { listening: "practice", expression: "independent" });
  assert.equal(event.steps[5].answer, value.steps[5].answer);
  assert.equal("passed" in event, false);
});

test("迁移步骤的中文复述属于理解证据，不冒充日语表达", () => {
  const value = payload();
  value.steps.forEach((step, index) => {
    if (["respond", "repair"].includes(lesson().steps[index].kind)) step.answer = "";
  });
  value.steps[6].answer = "这是在问未来想负责什么。";
  value.steps[6].usedHintBeforeAnswer = true;
  assert.deepEqual(prepare(value).event.assessments, { listening: "prompted", expression: "no-evidence" });
});

test("同事件重试幂等，异内容409，后续保存后重试旧事件也不增加记录", () => {
  const first = prepare(payload(), { action: "checkpoint" }).event;
  const completed = prepare(payload(), { eventId: "event-2", events: [first], at: "2026-10-04T02:00:00.000Z" }).event;
  const retry = prepare(payload(), { action: "checkpoint", events: [first, completed], at: "2026-10-04T03:00:00.000Z" });
  assert.equal(retry.deduplicated, true);
  assert.deepEqual(retry.event, first);
  assert.deepEqual(retry.scenarioState.attempts, [completed]);
  const changed = payload();
  changed.steps[0].answer += "新增内容";
  assert.throws(() => prepare(changed, { action: "checkpoint", events: [first] }), ScenarioConflictError);
  assert.throws(() => prepare(payload(), { eventId: "event-3", action: "checkpoint", events: [first, completed] }), ScenarioConflictError);
});

test("即使安全归一化后相同，重用eventId修改自评仍返回409", () => {
  const value = payload();
  value.steps[0].audio = "text";
  value.steps[0].answerBasis = "text";
  const saved = prepare(value, { action: "checkpoint" }).event;
  value.assessments.listening = "prompted";
  assert.throws(() => prepare(value, { action: "checkpoint", events: [saved] }), ScenarioConflictError);
});

test("拒绝过期课程、外来步骤、重复步骤、超长回答和无依据的音频标记", () => {
  for (const mutate of [
    (value) => { value.steps[0].stepId = "foreign-step"; },
    (value) => { value.steps.push({ ...value.steps[0] }); },
    (value) => { value.steps[0].answer = "字".repeat(6001); },
    (value) => { value.steps[0].audio = "not-played"; },
    (value) => { value.steps[0].usedHintBeforeAnswer = "false"; },
    (value) => { value.assessments.expression = "passed"; },
    (value) => { value.steps = value.steps.slice(0, 3); },
  ]) {
    const value = payload();
    mutate(value);
    assert.throws(() => prepare(value), ScenarioValidationError);
  }
  assert.throws(() => prepare({ ...payload(), revision: "old-version" }), ScenarioConflictError);
});

test("状态按轮次取最新快照，没有把检查点累计成掌握次数", () => {
  const first = prepare(payload(), { action: "checkpoint" }).event;
  const second = prepare(payload(), { eventId: "event-2", events: [first], at: "2026-10-04T02:00:00.000Z" }).event;
  const third = prepare({ ...payload(), attemptId: "attempt-2" }, { eventId: "event-3", action: "checkpoint", events: [first, second], at: "2026-10-05T01:00:00.000Z" }).event;
  assert.deepEqual(deriveScenarioProgress([first, second, third, third]).attempts, [third, second]);
});

test("情境API仍使用业务ID、服务端时间及串行追加，未引入模型评分", async () => {
  const source = await readFile(new URL("../app/api/language/topics/progress/route.ts", import.meta.url), "utf8");
  assert.match(source, /exercise === "scenario"/u);
  assert.match(source, /prepareScenarioAttempt\(/u);
  assert.match(source, /at:\s*new Date\(\)\.toISOString\(\)/u);
  assert.match(source, /ScenarioValidationError \|\| error instanceof ScenarioConflictError/u);
  assert.doesNotMatch(source, /invokeCodex|body\.(?:path|notePath|at)\b/u);
});
