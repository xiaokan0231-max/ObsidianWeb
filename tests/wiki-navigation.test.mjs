import assert from "node:assert/strict";
import test from "node:test";
import { createWikiNavigator } from "../lib/wiki-navigation.ts";
import { createExitController } from "../lib/exit-transition.ts";

const note = (path) => ({ path, content: "", frontmatter: {}, tags: [], stat: { ctime: 0, mtime: 1, size: 0 } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function setup(initial = [], complete = false) {
  const request = deferred();
  const opened = [], notices = [];
  let calls = 0;
  const navigator = createWikiNavigator({
    getNotes: () => initial, isComplete: () => complete,
    ensureAll: () => { calls += 1; return request.promise; },
    onOpen: (link) => opened.push(link), onNotice: (notice) => notices.push(notice),
  });
  return { navigator, request, opened, notices, calls: () => calls };
}

test("冷启动短名等待全库，保留章节及别名；不能用局部唯一性代替全库唯一性", async () => {
  const target = note("20_求職/株式会社テスト/面试准备.md");
  const state = setup();
  const opening = state.navigator.open("[[面试准备#技术|本场资料]]");
  assert.equal(state.opened.length, 0);
  assert.equal(state.notices.at(-1).kind, "loading");
  state.request.resolve([target]);
  await opening;
  assert.deepEqual(state.opened, [{ path: target.path, section: "技术" }]);

  const ambiguous = setup([target]);
  const another = note("90_归档/面试准备.md");
  const waiting = ambiguous.navigator.open("面试准备");
  ambiguous.request.resolve([target, another]);
  await waiting;
  assert.deepEqual(ambiguous.opened, []);
  assert.equal(ambiguous.notices.at(-1).kind, "ambiguous");
});

test("多次短链点击共享读取，仅最后一次意图打开", async () => {
  const state = setup();
  const first = state.navigator.open("旧资料");
  const second = state.navigator.open("新资料#重点");
  assert.equal(state.calls(), 1);
  state.request.resolve([note("资料/旧资料.md"), note("资料/新资料.md")]);
  await Promise.all([first, second]);
  assert.deepEqual(state.opened, [{ path: "资料/新资料.md", section: "重点" }]);
});

test("关闭、换页或直接打开别的笔记后，取消的短链不会迟到弹回", async () => {
  const state = setup();
  const opening = state.navigator.open("准备资料");
  state.navigator.cancel();
  state.request.resolve([note("资料/准备资料.md")]);
  await opening;
  assert.deepEqual(state.opened, []);
  assert.equal(state.notices.at(-1), null);
});

test("完整路径按需打开，完整索引区分缺失与重名且不猜路径", async () => {
  const partial = setup([note("20_求職/株式会社テスト/准备.md")]);
  await partial.navigator.open("[[20_求職/株式会社テスト/准备#旧节]]", "本节");
  assert.deepEqual(partial.opened, [{ path: "20_求職/株式会社テスト/准备.md", section: "本节" }]);
  assert.equal(partial.calls(), 0);

  const ready = setup([note("资料/准备.md")], true);
  await ready.navigator.open("不存在");
  assert.deepEqual(ready.opened, []);
  assert.equal(ready.notices.at(-1).kind, "missing");
  await ready.navigator.open("准备");
  assert.deepEqual(ready.opened, [{ path: "资料/准备.md", section: null }]);
});

test("带目录的唯一后缀也等待全库解析，不把后缀误作 Vault 根路径", async () => {
  const target = note("20_求職/株式会社テスト/准备.md");
  const partial = setup([target]);
  const opening = partial.navigator.open("[[株式会社テスト/准备#技术|资料]]");
  assert.equal(partial.calls(), 1);
  assert.deepEqual(partial.opened, []);
  partial.request.resolve([target]);
  await opening;
  assert.deepEqual(partial.opened, [{ path: target.path, section: "技术" }]);

  const conflict = setup([target]);
  const ambiguous = conflict.navigator.open("株式会社テスト/准备");
  conflict.request.resolve([target, note("90_归档/株式会社テスト/准备.md")]);
  await ambiguous;
  assert.deepEqual(conflict.opened, []);
  assert.equal(conflict.notices.at(-1).kind, "ambiguous");
});

test("局部索引缺失的完整路径补读后再打开，真正缺失时不留下假的笔记地址", async () => {
  const found = setup();
  const opening = found.navigator.open("资料/准备.md#重点");
  assert.deepEqual(found.opened, []);
  found.request.resolve([note("资料/准备.md")]);
  await opening;
  assert.deepEqual(found.opened, [{ path: "资料/准备.md", section: "重点" }]);

  const absent = setup();
  const missing = absent.navigator.open("资料/不存在.md");
  absent.request.resolve([]);
  await missing;
  assert.deepEqual(absent.opened, []);
  assert.equal(absent.notices.at(-1).kind, "missing");
});

test("关闭意图在退场动画开始时取消链接，动画中的晚响应不能抢回阅读层", async () => {
  const request = deferred();
  let current = "资料/当前.md";
  let closed = false;
  const timers = new Map();
  let nextTimer = 0;
  const navigator = createWikiNavigator({
    getNotes: () => [], isComplete: () => false, ensureAll: () => request.promise,
    onOpen: (link) => { current = link.path; }, onNotice() {},
  });
  const exit = createExitController({
    current: () => current, reducedMotion: () => false, onExiting() {}, onRelease() {},
    scheduler: { set: (callback) => { timers.set(++nextTimer, callback); return nextTimer; }, clear: (id) => timers.delete(id) },
  });
  const opening = navigator.open("另一篇");
  navigator.cancel();
  exit.exit(() => { current = null; closed = true; });
  assert.equal(closed, false, "仍保留退场动画");
  request.resolve([note("资料/另一篇.md")]);
  await opening;
  assert.equal(current, "资料/当前.md", "晚响应不能换篇，否则退场控制器会放弃原来的关闭");
  timers.get(1)();
  assert.equal(current, null);
  assert.equal(closed, true);
  exit.dispose();
});

test("读取失败保留当前阅读位置，后续点击能够重新加载", async () => {
  let calls = 0;
  const opened = [];
  const navigator = createWikiNavigator({
    getNotes: () => [], isComplete: () => false,
    ensureAll: async () => (++calls === 1 ? null : [note("资料/准备.md")]),
    onOpen: (value) => opened.push(value), onNotice() {},
  });
  await navigator.open("准备");
  assert.equal(opened.length, 0);
  await navigator.open("准备");
  assert.equal(opened.length, 1);
});
