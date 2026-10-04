import assert from "node:assert/strict";
import test from "node:test";
import {
  createQuickSession,
  currentQuickEntry,
  QUICK_RETRY_GAP,
  quickSessionAnswers,
  quickSessionReducer,
  summarizeQuickSet,
} from "../lib/language/quick-session.ts";

// 全部虚构卡片：只需要会话关心的字段（选项、答案、题型）。
function choice(id, answer = "正解", extra = {}) {
  return {
    cardId: `${id}:meaning_choice:2026-10-04`,
    itemId: id,
    group: "interviewer_phrase",
    type: "meaning_choice",
    grading: "auto",
    reason: "new",
    stage: "unseen",
    layer: "R",
    prompt: "meaning",
    stem: `題面${id}`,
    stemLang: "ja",
    options: [answer, "干扰一", "干扰二", "干扰三"],
    answer,
    accepted: [answer],
    reveal: { ja: `題面${id}`, reading: "", meaning: answer, wrong: "", explain: "", evidence: [] },
    ...extra,
  };
}

function natural(id) {
  return choice(id, "自然な形", {
    cardId: `${id}:natural_choice:2026-10-04`,
    group: "error_patch",
    type: "natural_choice",
    prompt: "natural",
    options: ["自然な形", "不自然な形"],
    optionMarks: [[0, 2], [0, 3]],
  });
}

function flip(id) {
  return choice(id, "裏面", {
    cardId: `${id}:flip:2026-10-04`,
    group: "answer_strategy",
    type: "flip",
    grading: "self",
    prompt: "flip_meaning",
    options: [],
    accepted: [],
  });
}

function session(cards) {
  return createQuickSession({ setId: "set_demo", day: "2026-10-04", size: 10, cards });
}

const run = (state, ...actions) => actions.reduce(quickSessionReducer, state);
const right = (state) => ({ type: "answer", response: currentQuickEntry(state).card.answer });
const wrong = { type: "answer", response: "干扰一" };
const next = { type: "next" };

/** 按顺序作答：fn(entry) 返回该题的动作。 */
function playAll(state, decide) {
  let current = state;
  let guard = 0;
  while (current.phase !== "ended" && guard < 100) {
    guard += 1;
    const entry = currentQuickEntry(current);
    current = quickSessionReducer(current, decide(entry, current));
    if (current.phase === "feedback") current = quickSessionReducer(current, next);
  }
  return current;
}

test("首答定成败：本地判分只看卡片里的 accepted，答后进入反馈、Next 才前进", () => {
  let state = session([choice("a"), choice("b")]);
  assert.equal(state.phase, "question");
  state = run(state, right(state));
  assert.equal(state.phase, "feedback");
  assert.equal(state.records[0].passed, true);
  assert.equal(state.records[0].round, 0);
  // 反馈阶段再按选项不改结果。
  const again = quickSessionReducer(state, wrong);
  assert.equal(again, state);
  state = run(state, next);
  assert.equal(currentQuickEntry(state).card.itemId, "b");
  // 空答案不收。
  assert.equal(quickSessionReducer(state, { type: "answer", response: "  " }), state);
});

test("答错的卡隔至少 3 题重出一次，重出选项重排、正解换位置；重出再错不再追加", () => {
  const cards = ["a", "b", "c", "d", "e", "f"].map((id) => choice(id));
  let state = session(cards);
  state = run(state, wrong);
  const order = state.queue.map((entry) => entry.key);
  const retryAt = order.indexOf("a:meaning_choice:2026-10-04:1");
  assert.equal(retryAt, 0 + 1 + QUICK_RETRY_GAP, "隔 b、c、d 三题");
  const retry = state.queue[retryAt];
  assert.equal(retry.round, 1);
  assert.deepEqual([...retry.card.options].sort(), [...cards[0].options].sort());
  assert.notEqual(retry.card.options.indexOf(retry.card.answer), cards[0].options.indexOf(cards[0].answer));

  // b c d 答对，然后轮到重出的 a：再错一次也不再追加。
  for (const id of ["b", "c", "d"]) {
    state = run(state, next);
    assert.equal(currentQuickEntry(state).card.itemId, id);
    state = run(state, right(state));
  }
  state = run(state, next);
  assert.equal(currentQuickEntry(state).key, "a:meaning_choice:2026-10-04:1");
  state = run(state, wrong);
  assert.equal(state.queue.filter((entry) => entry.card.itemId === "a").length, 2);
  assert.equal(state.records.at(-1).round, 1);
  assert.equal(state.records.at(-1).passed, false);
});

test("剩余不足 3 题时重出排在末尾（在先前安排的重出之后）", () => {
  let state = session(["a", "b", "c", "d"].map((id) => choice(id)));
  state = playAll(state, (entry) => (entry.round === 0 && ["c", "d"].includes(entry.card.itemId) ? wrong : { type: "answer", response: entry.card.answer }));
  const keys = state.queue.map((entry) => `${entry.card.itemId}${entry.round}`);
  assert.deepEqual(keys, ["a0", "b0", "c0", "d0", "c1", "d1"]);
});

test("二选一重出：两个选项对调，高亮区间跟着换", () => {
  let state = session([natural("n"), choice("x"), choice("y"), choice("z")]);
  state = run(state, { type: "answer", response: "不自然な形" });
  const retry = state.queue.find((entry) => entry.round === 1);
  assert.deepEqual(retry.card.options, ["不自然な形", "自然な形"]);
  assert.deepEqual(retry.card.optionMarks, [[0, 3], [0, 2]]);
});

test("「不知道」记为答错、显示答案、安排重出；翻卡的「不知道」记成忘了", () => {
  let state = session([choice("a"), flip("f"), choice("b"), choice("c"), choice("d")]);
  state = run(state, { type: "gaveUp", elapsedMs: 1200 });
  assert.equal(state.phase, "feedback");
  assert.equal(state.records[0].passed, false);
  assert.equal(state.records[0].gaveUp, true);
  assert.deepEqual(state.records[0].input, { eventId: "set_demo.1", itemId: "a", type: "meaning_choice", gaveUp: true, elapsedMs: 1200 });
  assert.ok(state.queue.some((entry) => entry.round === 1 && entry.card.itemId === "a"));

  state = run(state, next, { type: "gaveUp" });
  assert.equal(state.records[1].rating, "forgot");
  assert.equal(state.records[1].passed, undefined);
  assert.equal(state.records[1].input.rating, "forgot");
});

test("翻卡：未揭晓不收自评；揭晓后「记得」不重出，「模糊」重出", () => {
  let state = session([flip("f1"), flip("f2"), choice("a"), choice("b"), choice("c")]);
  assert.equal(quickSessionReducer(state, { type: "answer", rating: "remembered" }), state);
  state = run(state, { type: "reveal" }, { type: "answer", rating: "remembered" });
  assert.equal(state.records[0].rating, "remembered");
  assert.equal(state.records[0].passed, undefined);
  assert.equal(state.queue.length, 5);
  state = run(state, next);
  assert.equal(state.revealed, false, "换题后背面收起");
  state = run(state, { type: "reveal" }, { type: "answer", rating: "fuzzy" });
  assert.equal(state.queue.length, 6);
});

test("suspend：随时可按，记一条 suspend、撤掉它的重出并前进", () => {
  let state = session(["a", "b", "c", "d", "e"].map((id) => choice(id)));
  state = run(state, wrong);
  assert.equal(state.queue.length, 6);
  state = run(state, { type: "suspend" });
  assert.equal(state.queue.length, 5, "重出被撤掉");
  assert.equal(currentQuickEntry(state).card.itemId, "b");
  assert.deepEqual(state.suspended, ["a"]);
  assert.equal(state.records.at(-1).action, "suspend");
  assert.equal(state.records.at(-1).input.suspend, true);
  // 题面阶段直接 suspend：不记作答，直接下一题。
  state = run(state, { type: "suspend" });
  assert.equal(currentQuickEntry(state).card.itemId, "c");
  assert.deepEqual(quickSessionAnswers(state).map((input) => [input.itemId, input.suspend === true]), [
    ["a", false],
    ["a", true],
    ["b", true],
  ]);
  assert.deepEqual(state.records.map((record) => record.input.eventId), ["set_demo.1", "set_demo.2", "set_demo.3"]);
});

test("end：随时结束；空组直接是 ended", () => {
  let state = session([choice("a"), choice("b")]);
  state = run(state, { type: "end" });
  assert.equal(state.phase, "ended");
  assert.equal(currentQuickEntry(state), undefined);
  assert.equal(session([]).phase, "ended");
});

test("小结：正确率只算首答的判分题，自评另计，重出改对单列；升阶来自服务端应答", () => {
  const cards = [choice("a"), choice("b"), choice("c"), natural("n"), flip("f1"), flip("f2"), choice("d")];
  let state = session(cards);
  state = playAll(state, (entry, current) => {
    const id = entry.card.itemId;
    if (entry.card.type === "flip") {
      if (!current.revealed) return { type: "reveal" };
      return { type: "answer", rating: id === "f1" ? "remembered" : "forgot" };
    }
    if (entry.round === 1) return id === "a" ? { type: "answer", response: entry.card.answer } : wrong;
    if (id === "a") return wrong;
    if (id === "b") return { type: "gaveUp" };
    return { type: "answer", response: entry.card.answer, elapsedMs: 1000 };
  });
  assert.equal(state.phase, "ended");

  const pending = summarizeQuickSet(state);
  assert.equal(pending.total, 7);
  assert.equal(pending.answered, 7);
  assert.deepEqual(pending.graded, { total: 5, correct: 3, accuracy: 3 / 5 });
  assert.deepEqual(pending.self, { total: 2, remembered: 1, fuzzy: 0, forgot: 1 });
  assert.equal(pending.gaveUp, 1);
  assert.deepEqual(pending.retries, { total: 3, fixed: 1, stillWrong: 2 });
  assert.equal(pending.elapsedMs, 3000);
  assert.equal(pending.stages.known, false, "没有服务端应答时升阶未知");
  assert.equal(pending.stages.pending, state.records.length);
  assert.deepEqual(
    pending.mistakes.map((mistake) => [mistake.itemId, mistake.retry]),
    [["a", "fixed"], ["b", "wrong"], ["f2", "wrong"]],
  );
  assert.equal(pending.mistakes[0].answer, "正解");
  assert.equal(pending.mistakes[0].response, "干扰一");

  const results = state.records.map((record) => ({
    eventId: record.input.eventId,
    itemId: record.itemId,
    status: "recorded",
    first: record.round === 0,
    stageBefore: "unseen",
    stageAfter: record.round === 0 && record.passed === true ? "correctable" : record.itemId === "f1" ? "recognized" : "unseen",
  }));
  results.find((result) => result.itemId === "c").stageBefore = "stable";
  results.find((result) => result.itemId === "c").stageAfter = "stable";
  const confirmedPart = summarizeQuickSet(state, results.slice(0, 3));
  assert.equal(confirmedPart.stages.known, false);
  assert.equal(confirmedPart.stages.pending, state.records.length - 3);

  const done = summarizeQuickSet(state, results);
  assert.equal(done.stages.known, true);
  assert.deepEqual(done.stages.promoted.map((change) => change.itemId).sort(), ["d", "f1", "n"]);
  assert.deepEqual(done.stages.demoted, []);
});

test("小结：回落与 stale 应答", () => {
  let state = session([choice("a"), choice("b")]);
  state = playAll(state, (entry) => (entry.card.itemId === "a" ? wrong : { type: "answer", response: entry.card.answer }));
  const results = state.records.map((record, index) => ({
    eventId: record.input.eventId,
    itemId: record.itemId,
    status: index === 1 ? "stale" : "recorded",
    first: record.round === 0,
    stageBefore: "stable",
    stageAfter: "retrievable",
  }));
  const summary = summarizeQuickSet(state, results);
  assert.equal(summary.stages.known, true);
  // b 的应答是 stale（条目已不在题库）：算已确认，但不计升降。
  assert.equal(summary.stages.confirmed, 3);
  // a 首答错 + 重出两条应答，按条目只算一次回落（逐条计会让「回落 2 项」多报）。
  assert.deepEqual(summary.stages.demoted.map((change) => change.itemId), ["a"]);
  assert.deepEqual(summary.stages.promoted, []);
});
