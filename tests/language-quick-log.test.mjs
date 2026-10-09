import assert from "node:assert/strict";
import test from "node:test";
import {
  appendQuickEvents,
  collectQuickEvents,
  collectTriageJudgments,
  isFirstAnswer,
  parseQuickEvents,
  QUICK_LOG_DIR,
  quickDay,
  quickLogFrontmatter,
  quickLogPath,
  renderQuickEvent,
  renderQuickLogNote,
} from "../lib/language/quick-log.ts";

// 虚构事件：itemId、作答内容都是测试自编的。
let serial = 0;
function event(values = {}) {
  serial += 1;
  return {
    eventId: `ev_${serial}`,
    setId: "set_a",
    setSize: 20,
    itemId: "li2_demo",
    type: "cloze_choice",
    action: "answer",
    response: "に",
    passed: true,
    first: true,
    at: "2026-10-04T01:00:00.000Z",
    ...values,
  };
}

// 原断言按 JST 零点换月；本人改为练习日从日本时间 04:00 起算，换月点随之移到 11-01 04:00。
test("路径按练习日所在的月；练习日由调用方给，月初 0:00–4:00 仍属上个月", () => {
  assert.equal(QUICK_LOG_DIR, "30_日本語学習/快練ログ");
  assert.equal(quickLogPath("2026-10-04"), "30_日本語学習/快練ログ/2026-10_快練ログ.md");
  // UTC 10-31 16:00＝JST 11-01 01:00，仍是 10-31 这个练习日。
  assert.equal(quickDay("2026-10-31T16:00:00.000Z"), "2026-10-31");
  assert.equal(quickLogPath(quickDay("2026-10-31T16:00:00.000Z")), "30_日本語学習/快練ログ/2026-10_快練ログ.md");
  // UTC 10-31 19:00＝JST 11-01 04:00，换到 11 月。
  assert.equal(quickDay("2026-10-31T19:00:00.000Z"), "2026-11-01");
  assert.equal(quickLogPath(quickDay("2026-10-31T19:00:00.000Z")), "30_日本語学習/快練ログ/2026-11_快練ログ.md");
  assert.equal(quickDay("2026-10-31T18:59:59.000Z"), "2026-10-31");
  assert.equal(quickDay("not a date"), "");
  assert.throws(() => quickLogPath("10/04"));
});

test("新文件骨架：frontmatter、标题、勿手改说明、作答イベント小节", () => {
  const note = renderQuickLogNote("2026-10");
  assert.match(note, /^---\ntype: language-quick-log\nmonth: "2026-10"\nlayer: user-action\nschema_version: 1\n---\n/u);
  assert.match(note, /^# 2026-10 快練ログ$/mu);
  assert.match(note, /由 Web 写入，请勿手改/u);
  assert.match(note, /^## 作答イベント$/mu);
  assert.deepEqual(parseQuickEvents(note), []);
  assert.deepEqual(quickLogFrontmatter("2026-10"), {
    type: "language-quick-log", month: "2026-10", layer: "user-action", schema_version: 1,
  });
});

test("往返：渲染后再解析得到同一事件（含可选字段）", () => {
  const values = [
    event(),
    event({ type: "flip", response: "", passed: undefined, rating: "fuzzy", elapsedMs: 4200 }),
    event({ action: "suspend", response: "", passed: undefined, first: false }),
    event({ gaveUp: true, passed: false, response: "" }),
    event({ action: "restore", response: "", passed: undefined, first: false }),
    event({ action: "easy", response: "", passed: undefined, first: false }),
    event({ action: "triage", response: "", passed: undefined, first: false, judgment: "uncertain" }),
  ].map((value) => JSON.parse(JSON.stringify(value)));
  const content = appendQuickEvents(null, "2026-10-04", values);
  assert.ok(content.startsWith(renderQuickLogNote("2026-10")));
  assert.deepEqual(parseQuickEvents(content), values);
  // 追加到已有内容后面，旧事件不丢。
  const more = event({ itemId: "li2_more" });
  const appended = appendQuickEvents(content, "2026-10-05", [more]);
  assert.deepEqual(parseQuickEvents(appended), [...values, more]);
  assert.equal(appended.split("\n").filter((line) => line.startsWith("<!-- language-quick-event:")).length, 8);
});

test("转义：response 里的 --> 、<!-- 与 < 不会破坏注释，读回原文", () => {
  const tricky = event({ response: "a --> b <!-- c < d -- e" });
  const line = renderQuickEvent(tricky);
  assert.match(line, /^<!-- language-quick-event:\{.*\} -->$/u);
  const body = line.slice("<!-- ".length, -" -->".length);
  assert.ok(!body.includes("--"), "注释体内不能有 --");
  assert.ok(!body.includes("<"));
  const content = `${renderQuickLogNote("2026-10")}${line}\n${renderQuickEvent(event({ itemId: "li2_after" }))}\n`;
  const parsed = parseQuickEvents(content);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].response, "a --> b <!-- c < d -- e");
  assert.equal(parsed[1].itemId, "li2_after");
});

test("坏行跳过：JSON 坏、字段缺失或类型不对的行不影响其余", () => {
  const good = event();
  const lines = [
    renderQuickEvent(good),
    "<!-- language-quick-event:{not json} -->",
    `<!-- language-quick-event:${JSON.stringify({ ...event(), type: "essay" })} -->`,
    `<!-- language-quick-event:${JSON.stringify({ ...event(), action: "delete" })} -->`,
    `<!-- language-quick-event:${JSON.stringify({ ...event(), first: "yes" })} -->`,
    `<!-- language-quick-event:${JSON.stringify({ ...event(), at: "yesterday" })} -->`,
    `<!-- language-quick-event:${JSON.stringify({ ...event(), rating: "great" })} -->`,
    `<!-- language-quick-event:${JSON.stringify({ ...event(), eventId: "" })} -->`,
    `<!-- language-quick-event:${JSON.stringify({ ...event(), extra: "dropped", response: undefined })} -->`,
    `<!-- language-quick-event:${JSON.stringify({ ...event(), action: "triage", passed: undefined })} -->`,
    `<!-- language-quick-event:${JSON.stringify({ ...event(), action: "triage", judgment: "maybe" })} -->`,
  ];
  const parsed = parseQuickEvents(lines.join("\n"));
  assert.equal(parsed.length, 2, "triage 缺 judgment 或 judgment 不合法也算坏行");
  assert.deepEqual(parsed[0], JSON.parse(JSON.stringify(good)));
  assert.equal(parsed[1].response, "", "缺 response 视为空串");
  assert.equal("extra" in parsed[1], false, "契约外的键不带出来");
  // 非 triage 的事件带了 judgment：丢掉，不让它流进选题。
  const stray = parseQuickEvents(renderQuickEvent(event({ judgment: "known" })));
  assert.equal(stray.length, 1);
  assert.equal("judgment" in stray[0], false);
});

test("collectTriageJudgments：只收 triage，同一条目以最后一次为准", () => {
  const events = [
    event({ itemId: "li2_a", action: "triage", judgment: "known", passed: undefined, at: "2026-10-04T01:00:00.000Z" }),
    event({ itemId: "li2_b", action: "triage", judgment: "unknown", passed: undefined, at: "2026-10-04T01:00:01.000Z" }),
    event({ itemId: "li2_a", action: "triage", judgment: "uncertain", passed: undefined, at: "2026-10-04T01:00:02.000Z" }),
    event({ itemId: "li2_c", action: "answer" }),
  ];
  assert.deepEqual([...collectTriageJudgments(events)], [["li2_a", "uncertain"], ["li2_b", "unknown"]]);
});

test("collectQuickEvents：只收 language-quick-log，按 (at, 路径, 文件内顺序) 排序并按 eventId 去重", () => {
  const a1 = event({ eventId: "a1", at: "2026-10-04T02:00:00.000Z" });
  const a2 = event({ eventId: "a2", at: "2026-10-04T01:00:00.000Z" });
  const a3 = event({ eventId: "a3", at: "2026-10-04T01:00:00.000Z" });
  const b1 = event({ eventId: "b1", at: "2026-09-30T23:00:00.000Z" });
  const dup = { ...a1, response: "重复" };
  const notes = [
    { path: "30_日本語学習/快練ログ/2026-10_快練ログ.md", frontmatter: { type: "language-quick-log" }, content: appendQuickEvents(null, "2026-10-04", [a1, a2, a3]) },
    { path: "30_日本語学習/快練ログ/2026-09_快練ログ.md", content: appendQuickEvents(null, "2026-09-30", [b1, dup]) },
    { path: "30_日本語学習/别的笔记.md", frontmatter: { type: "language-batch-log" }, content: renderQuickEvent(event({ eventId: "x" })) },
  ];
  const events = collectQuickEvents(notes);
  assert.deepEqual(events.map((value) => value.eventId), ["b1", "a2", "a3", "a1"]);
  // 同一 eventId 只留排序最前的一条（这里两条 at 相同，按路径 09 < 10 取 09 的那条）。
  assert.equal(events.at(-1).response, "重复");
  // 刚新建的当月日志：metadata cache 没追上、接口给空 frontmatter 时，按正文 YAML 认，不能把这批作答丢掉。
  const fresh = [{ path: "30_日本語学習/快練ログ/2026-11_快練ログ.md", frontmatter: {}, content: appendQuickEvents(null, "2026-11-01", [event({ eventId: "c1" })]) }];
  assert.deepEqual(collectQuickEvents(fresh).map((value) => value.eventId), ["c1"]);
});

test("首答判定：当日没有更早作答，且同组没有更早事件", () => {
  const day = "2026-10-04";
  const earlier = [
    event({ itemId: "li2_x", setId: "set_a", at: "2026-10-04T00:30:00.000Z" }),
    event({ itemId: "li2_y", setId: "set_b", at: "2026-10-03T14:00:00.000Z" }), // JST 10-03 23:00
    event({ itemId: "li2_z", setId: "set_c", action: "suspend", at: "2026-10-04T00:10:00.000Z" }),
  ];
  // 同一天同一条目再答：不是首答，换组也不是。
  assert.equal(isFirstAnswer(earlier, { itemId: "li2_x", day, setId: "set_a" }), false);
  assert.equal(isFirstAnswer(earlier, { itemId: "li2_x", day, setId: "set_new" }), false);
  // 别的条目：是首答。
  assert.equal(isFirstAnswer(earlier, { itemId: "li2_other", day, setId: "set_a" }), true);
  // 跨零点：li2_y 昨天（JST）在 set_b 答过；今天新开一组再答是首答……
  assert.equal(isFirstAnswer(earlier, { itemId: "li2_y", day, setId: "set_new" }), true);
  // ……但同一组跨零点后的重出不是首答。
  assert.equal(isFirstAnswer(earlier, { itemId: "li2_y", day, setId: "set_b" }), false);
  // UTC 还是 10-03、JST 已过 10-04 04:00 的作答算今天（原用例是 JST 00:05，按旧的零点日界写，已改为 04:00 日界）。
  const lateNight = [event({ itemId: "li2_w", setId: "set_d", at: "2026-10-03T19:05:00.000Z" })];
  assert.equal(isFirstAnswer(lateNight, { itemId: "li2_w", day, setId: "set_e" }), false);
  // suspend 不是作答：不同组不挡首答，同组也不挡（原断言「同组的 suspend 挡」已改：本人要求 X 可撤销，
  // 题面阶段按 X 再撤销后那张卡回到当前位置重新作答，那是第一次回答，必须能判分）。
  assert.equal(isFirstAnswer(earlier, { itemId: "li2_z", day, setId: "set_new" }), true);
  assert.equal(isFirstAnswer(earlier, { itemId: "li2_z", day, setId: "set_c" }), true);
  const undone = [
    ...earlier,
    event({ itemId: "li2_z", setId: "set_c", action: "restore", passed: undefined, first: false, at: "2026-10-04T00:11:00.000Z" }),
  ];
  assert.equal(isFirstAnswer(undone, { itemId: "li2_z", day, setId: "set_c" }), true);
  // 当日「太简单」挡首答（换组也挡）；分流与撤销排除不挡（同组也不挡）。
  const others = [
    event({ itemId: "li2_e", setId: "set_f", action: "easy", passed: undefined, first: false, at: "2026-10-04T00:20:00.000Z" }),
    event({ itemId: "li2_t", setId: "set_g", action: "triage", judgment: "known", passed: undefined, first: false, at: "2026-10-04T00:20:00.000Z" }),
    event({ itemId: "li2_r", setId: "set_h", action: "restore", passed: undefined, first: false, at: "2026-10-04T00:20:00.000Z" }),
  ];
  assert.equal(isFirstAnswer(others, { itemId: "li2_e", day, setId: "set_new" }), false);
  assert.equal(isFirstAnswer(others, { itemId: "li2_t", day, setId: "set_g" }), true);
  assert.equal(isFirstAnswer(others, { itemId: "li2_r", day, setId: "set_h" }), true);
});

test("首答判定按练习日：日本时间 04:00 两侧", () => {
  // JST 10-04 23:53 答错，10-05 00:10 再答：同一练习日，不是首答（旧规则下这里会白拿一个成功日）。
  const lateNight = [event({ itemId: "li2_n", setId: "set_1", passed: false, at: "2026-10-04T14:53:00.000Z" })];
  assert.equal(quickDay("2026-10-04T15:10:00.000Z"), "2026-10-04");
  assert.equal(isFirstAnswer(lateNight, { itemId: "li2_n", day: quickDay("2026-10-04T15:10:00.000Z"), setId: "set_2" }), false);
  // 过了 JST 04:00 就是新的练习日。
  assert.equal(isFirstAnswer(lateNight, { itemId: "li2_n", day: quickDay("2026-10-04T19:00:00.000Z"), setId: "set_2" }), true);
  assert.equal(isFirstAnswer(lateNight, { itemId: "li2_n", day: quickDay("2026-10-04T18:59:00.000Z"), setId: "set_2" }), false);
});
