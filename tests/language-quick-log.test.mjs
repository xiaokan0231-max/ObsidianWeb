import assert from "node:assert/strict";
import test from "node:test";
import {
  appendQuickEvents,
  collectQuickEvents,
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

test("路径按 JST 月；JST 日由调用方给，月末最后 9 小时不落到上个月", () => {
  assert.equal(QUICK_LOG_DIR, "30_日本語学習/快練ログ");
  assert.equal(quickLogPath("2026-10-04"), "30_日本語学習/快練ログ/2026-10_快練ログ.md");
  // UTC 10-31 16:00 已是 JST 11-01。
  assert.equal(quickDay("2026-10-31T16:00:00.000Z"), "2026-11-01");
  assert.equal(quickLogPath(quickDay("2026-10-31T16:00:00.000Z")), "30_日本語学習/快練ログ/2026-11_快練ログ.md");
  assert.equal(quickDay("2026-10-31T14:59:59.000Z"), "2026-10-31");
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
  ].map((value) => JSON.parse(JSON.stringify(value)));
  const content = appendQuickEvents(null, "2026-10-04", values);
  assert.ok(content.startsWith(renderQuickLogNote("2026-10")));
  assert.deepEqual(parseQuickEvents(content), values);
  // 追加到已有内容后面，旧事件不丢。
  const more = event({ itemId: "li2_more" });
  const appended = appendQuickEvents(content, "2026-10-05", [more]);
  assert.deepEqual(parseQuickEvents(appended), [...values, more]);
  assert.equal(appended.split("\n").filter((line) => line.startsWith("<!-- language-quick-event:")).length, 5);
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
  ];
  const parsed = parseQuickEvents(lines.join("\n"));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], JSON.parse(JSON.stringify(good)));
  assert.equal(parsed[1].response, "", "缺 response 视为空串");
  assert.equal("extra" in parsed[1], false, "契约外的键不带出来");
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
  // UTC 还是 10-03、JST 已是 10-04 的作答算今天。
  const lateNight = [event({ itemId: "li2_w", setId: "set_d", at: "2026-10-03T15:05:00.000Z" })];
  assert.equal(isFirstAnswer(lateNight, { itemId: "li2_w", day, setId: "set_e" }), false);
  // 当日只有 suspend（不同组）不挡首答；同组的 suspend 挡。
  assert.equal(isFirstAnswer(earlier, { itemId: "li2_z", day, setId: "set_new" }), true);
  assert.equal(isFirstAnswer(earlier, { itemId: "li2_z", day, setId: "set_c" }), false);
});
