import assert from "node:assert/strict";
import test from "node:test";
import { createExitController, NOTE_EXIT_MS, NOTE_EXIT_SETTLE_MS } from "../lib/exit-transition.ts";

// 手动推进的假计时器：按到期时间依次执行，测试不必真等 200ms。
function fakeScheduler() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    set(callback, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clear(id) { timers.delete(id); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = until;
    },
    get size() { return timers.size; },
  };
}

function setup({ reduced = false, open = "a.md" } = {}) {
  const scheduler = fakeScheduler();
  const state = { current: open, exiting: null, finished: 0 };
  const controller = createExitController({
    current: () => state.current,
    reducedMotion: () => reduced,
    onExiting: (key) => { state.exiting = key; },
    onRelease: (key) => { if (state.exiting === key) state.exiting = null; },
    scheduler,
  });
  // 模拟外壳的关闭逻辑：清空 selectedPath。
  const finish = () => { state.finished += 1; state.current = null; };
  return { scheduler, state, controller, finish };
}

test("先进入退场，计时结束后才执行原来的关闭逻辑", () => {
  const { scheduler, state, controller, finish } = setup();
  assert.equal(controller.exit(finish), true);
  assert.equal(state.exiting, "a.md");
  assert.equal(state.finished, 0);
  scheduler.advance(NOTE_EXIT_MS - 1);
  assert.equal(state.finished, 0);
  scheduler.advance(1);
  assert.equal(state.finished, 1);
  assert.ok(NOTE_EXIT_MS >= 180 && NOTE_EXIT_MS <= 220, "退场时长在 180–220ms");
});

test("退场中再次关闭（×・Esc）不重复执行", () => {
  const { scheduler, state, controller, finish } = setup();
  controller.exit(finish);
  assert.equal(controller.exit(finish), false);
  assert.equal(controller.exit(finish), false);
  scheduler.advance(NOTE_EXIT_MS * 3);
  assert.equal(state.finished, 1);
});

test("减弱动效时立即关闭，不进入退场状态", () => {
  const { scheduler, state, controller, finish } = setup({ reduced: true });
  controller.exit(finish);
  assert.equal(state.finished, 1);
  assert.equal(state.exiting, null);
  assert.equal(scheduler.size, 0);
});

test("退场途中打开了另一篇：取消关闭，新的一篇不带退场状态", () => {
  const { scheduler, state, controller, finish } = setup();
  controller.exit(finish);
  state.current = "b.md";
  scheduler.advance(NOTE_EXIT_MS);
  assert.equal(state.finished, 0, "没有执行 history.back / 清空");
  assert.equal(state.exiting, null);
  // 之后关闭新的一篇照常走退场。
  assert.equal(controller.exit(finish), true);
  assert.equal(state.exiting, "b.md");
  scheduler.advance(NOTE_EXIT_MS);
  assert.equal(state.finished, 1);
});

test("换篇后立刻关新的一篇：旧计时器作废，只关一次", () => {
  const { scheduler, state, controller, finish } = setup();
  controller.exit(finish);
  scheduler.advance(NOTE_EXIT_MS / 2);
  state.current = "b.md";
  controller.exit(finish);
  scheduler.advance(NOTE_EXIT_MS / 2);
  assert.equal(state.finished, 0, "a 的计时器不能把 b 提前关掉");
  scheduler.advance(NOTE_EXIT_MS / 2);
  assert.equal(state.finished, 1);
});

test("history.back 回到同一篇时，兜底解除退场状态，不留一层看不见的模态框", () => {
  const { scheduler, state, controller } = setup();
  // 回退由 popstate 异步落地；这里模拟回到的仍是同一篇。
  const back = () => { state.finished += 1; };
  controller.exit(back);
  scheduler.advance(NOTE_EXIT_MS);
  assert.equal(state.finished, 1);
  assert.equal(state.exiting, "a.md");
  scheduler.advance(NOTE_EXIT_SETTLE_MS);
  assert.equal(state.exiting, null);
});

test("没有打开的笔记时直接执行；卸载后计时器全部清掉", () => {
  const { scheduler, state, controller, finish } = setup({ open: null });
  controller.exit(finish);
  assert.equal(state.finished, 1);
  state.current = "c.md";
  controller.exit(finish);
  controller.dispose();
  scheduler.advance(NOTE_EXIT_MS * 4);
  assert.equal(state.finished, 1);
  assert.equal(scheduler.size, 0);
});
