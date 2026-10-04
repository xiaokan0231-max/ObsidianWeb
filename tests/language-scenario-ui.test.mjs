import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  createScenarioDraft, restoreScenarioDraft, commitScenarioAnswer,
  localJapaneseVoice, listeningEvidence, scenarioDraftFromEvent, scenarioEventId, scenarioResponseContext, scenarioStorageKey,
} from "../app/language-scenario-state.ts";

const lesson = {
  steps: [
    { id: "listen-01", kind: "listen", promptJa: "昨日は何をしましたか。" },
    { id: "transfer-02", kind: "transfer", promptJa: "明日は何をしますか。" },
  ],
};
const fresh = () => createScenarioDraft("test-course", lesson, "revision-a", "attempt-a");

test("情境草稿按课程和内容版本隔离，刷新保留未确认输入", () => {
  const draft = fresh();
  draft.responses["listen-01"] = "我只听出昨天";
  const restored = restoreScenarioDraft(JSON.stringify(draft), "test-course", lesson, "revision-a");
  assert.equal(restored.responses["listen-01"], "我只听出昨天");
  assert.equal(restored.payload.steps[0].answer, "");
  assert.equal(restoreScenarioDraft(JSON.stringify(draft), "other-course", lesson, "revision-a"), null);
  assert.equal(restoreScenarioDraft(JSON.stringify(draft), "test-course", lesson, "revision-b"), null);
  assert.notEqual(scenarioStorageKey("test-course", "revision-a"), scenarioStorageKey("test-course", "revision-b"));
  assert.equal(restoreScenarioDraft("broken", "test-course", lesson, "revision-a"), null);
});

test("Vault局部检查点恢复时补齐未做步骤，不把后续题目提前显示", () => {
  const draft = fresh();
  draft.responses["listen-01"] = "只听出昨天";
  const answered = commitScenarioAnswer(draft, 0);
  const restored = scenarioDraftFromEvent("test-course", lesson, {
    ...answered.payload, steps: [answered.payload.steps[0]],
    eventId: "event-a", courseId: "test-course", action: "checkpoint", at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(restored.stepIndex, 1);
  assert.equal(restored.payload.steps.length, 2);
  assert.equal(restored.payload.steps[1].revealed, false);
  assert.equal(restored.payload.steps[1].answer, "");
  assert.equal(restored.savedAt, "2026-01-01T00:00:00.000Z");
});

test("只有首次作答前完成的音频可作为听力依据，正常答后揭示不扣为提示", () => {
  let draft = fresh();
  draft.responses["listen-01"] = "询问昨天的行动";
  draft.payload.steps[0].audio = "synthetic-completed";
  draft = commitScenarioAnswer(draft, 0);
  assert.equal(draft.payload.steps[0].answerBasis, "audio");
  assert.equal(draft.payload.steps[0].revealed, true);
  assert.equal(draft.payload.steps[0].usedHintBeforeAnswer, false);
  assert.equal(listeningEvidence(draft, lesson).hasAudio, true);
  draft.responses["listen-01"] = "事后改成另一个答案";
  assert.equal(commitScenarioAnswer(draft, 0).payload.steps[0].answer, "询问昨天的行动");
});

test("先看文字再听、未播放先作答，都不能洗成独立听力记录", () => {
  let text = fresh();
  text.responses["listen-01"] = "询问昨天的行动";
  text.payload.steps[0] = { ...text.payload.steps[0], revealed: true, usedHintBeforeAnswer: true, audio: "synthetic-completed" };
  text = commitScenarioAnswer(text, 0);
  assert.equal(text.payload.steps[0].answerBasis, "text");
  assert.equal(listeningEvidence(text, lesson).hasAudio, false);

  let unavailable = fresh();
  unavailable.responses["listen-01"] = "没听到声音";
  unavailable = commitScenarioAnswer(unavailable, 0);
  unavailable.payload.steps[0].audio = "synthetic-completed";
  assert.equal(commitScenarioAnswer(unavailable, 0).payload.steps[0].answerBasis, "unavailable");
  assert.equal(listeningEvidence(unavailable, lesson).hasAudio, false);
});

test("迁移的中文任务复述也计入理解依据，表达练习不冒充听懂", () => {
  const draft = fresh();
  draft.responses["transfer-02"] = "询问明天计划";
  draft.payload.steps[1].audio = "synthetic-completed";
  const committed = commitScenarioAnswer(draft, 1);
  assert.equal(listeningEvidence(committed, lesson).hasAudio, true);
  assert.equal(listeningEvidence(committed, { steps: [{ id: "transfer-02", kind: "respond" }] }).hasAudio, false);
});

test("迁移后的回应显示新问题的中文理解，不能混入旧任务的个人立场", () => {
  const responseLesson = { steps: [
    { id: "stance", kind: "stance" }, { id: "respond", kind: "respond" },
    { id: "transfer", kind: "transfer" }, { id: "respond-new", kind: "respond" },
  ] };
  const draft = createScenarioDraft("test-course", responseLesson, "revision-a", "attempt-a");
  draft.payload.steps[0].answer = "想在新领域做开发";
  draft.payload.steps[2].answer = "问过去用过的语言";
  assert.equal(scenarioResponseContext(draft, responseLesson, 1).answer, "想在新领域做开发");
  assert.deepEqual(scenarioResponseContext(draft, responseLesson, 3), {
    label: "你对新问题的中文理解", answer: "问过去用过的语言",
  });
});

test("同一作答快照重试使用稳定ID，新一轮不会继承答案或自评", () => {
  const draft = fresh();
  const id = scenarioEventId(draft.payload, "completed");
  assert.equal(scenarioEventId(structuredClone(draft.payload), "completed"), id);
  assert.notEqual(scenarioEventId(draft.payload, "checkpoint"), id);
  draft.payload.assessments.expression = "practice";
  assert.notEqual(scenarioEventId(draft.payload, "completed"), id);
  const next = createScenarioDraft("test-course", lesson, "revision-a", "attempt-b");
  assert.equal(next.payload.steps.every((entry) => entry.answer === "" && !entry.revealed), true);
  assert.deepEqual(next.payload.assessments, { listening: "no-evidence", expression: "no-evidence" });
});

test("语音仅可选择声明localService的日语声线", () => {
  const remote = { lang: "ja-JP", localService: false };
  const english = { lang: "en-US", localService: true };
  const japanese = { lang: "ja_JP", localService: true };
  assert.equal(localJapaneseVoice([remote, english]), undefined);
  assert.equal(localJapaneseVoice([remote, english, japanese]), japanese);
  assert.equal(localJapaneseVoice([{ lang: "ja-JP" }]), undefined);
});

test("界面将题文、要点和原稿分别置于揭示、确认及本轮回看的门后", async () => {
  const ui = await readFile("app/language-scenario-course.tsx", "utf8");
  assert.ok(ui.includes('{entry.revealed && <blockquote lang="ja">{step.promptJa}</blockquote>}'));
  assert.ok(ui.includes("!committed ? <div"));
  assert.ok(ui.includes("{allAnswered && <>"));
  assert.ok(ui.includes("<EvidencePanel lesson={lesson} />"));
  assert.ok(ui.includes("utterance.onend"));
  assert.ok(ui.includes("utterance.onerror"));
  assert.ok(ui.includes("disabled={!localVoice || speaking || locked}"));
  assert.ok(ui.includes("draftRef.current.completed || draftRef.current.pendingCompletion || saveLock.current"));
  assert.equal(/(?:aria-label|title)=\{step\.promptJa\}/u.test(ui), false);
  for (const term of ["MediaRecorder", "SpeechRecognition", "invokeCodex", "speech.googleapis", "api.openai"]) {
    assert.equal(ui.includes(term), false);
  }
});
