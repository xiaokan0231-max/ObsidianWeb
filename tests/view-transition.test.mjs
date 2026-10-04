import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canStartViewTransition,
  createPreloadable,
  createViewTransitionNavigator,
  startViewTransition,
  VIEW_TRANSITION_ATTRIBUTE,
  VIEW_TRANSITION_PRELOAD_WAIT_MS,
} from "../lib/view-transition.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** 手动推进的计时器：wait 返回的 Promise 只在 flush 时兑现，不必真等 150ms。 */
function manualScheduler() {
  const waits = [];
  return {
    waits,
    scheduler: { wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })) },
    flush() {
      for (const item of waits.splice(0)) item.resolve();
    },
  };
}

/** 模拟 document.startViewTransition：回调先挂起，runAll 时按浏览器顺序执行。 */
function fakeDocument() {
  const queued = [];
  return {
    queued,
    doc: {
      visibilityState: "visible",
      startViewTransition(update) {
        queued.push(update);
        return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
      },
    },
    runAll() {
      for (const update of queued.splice(0)) update();
    },
  };
}

test("API 不存在、文档隐藏或减弱动效时不走转场", () => {
  const doc = { startViewTransition() {}, visibilityState: "visible" };
  assert.equal(canStartViewTransition(doc, () => false), true);
  assert.equal(canStartViewTransition({ visibilityState: "visible" }, () => false), false);
  assert.equal(canStartViewTransition(null, () => false), false);
  assert.equal(canStartViewTransition({ ...doc, visibilityState: "hidden" }, () => false), false);
  assert.equal(canStartViewTransition(doc, () => true), false);
  assert.equal(canStartViewTransition(doc, () => { throw new Error("matchMedia 不可用"); }), false);
});

test("被顶掉的转场：ready 的拒绝被吞掉，不留未处理拒绝", async () => {
  const rejected = Promise.reject(new Error("Transition was skipped"));
  let ran = false;
  startViewTransition({
    startViewTransition(update) {
      update();
      return { ready: rejected, finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    },
  }, () => { ran = true; });
  assert.equal(ran, true);
  await tick();
});

test("转场期间给 <html> 打标记；重叠的转场全部结束才摘掉", async () => {
  const attributes = new Map();
  const root = {
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  };
  const finishers = [];
  const doc = {
    startViewTransition(update) {
      update();
      return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished: new Promise((resolve) => finishers.push(resolve)) };
    },
  };
  startViewTransition(doc, () => {}, root);
  startViewTransition(doc, () => {}, root);
  assert.equal(attributes.get(VIEW_TRANSITION_ATTRIBUTE), "");
  finishers[0]();
  await tick();
  assert.ok(attributes.has(VIEW_TRANSITION_ATTRIBUTE), "被顶掉的旧转场先结束，不能摘掉新转场的名字");
  finishers[1]();
  await tick();
  assert.equal(attributes.has(VIEW_TRANSITION_ATTRIBUTE), false);

  assert.throws(() => startViewTransition({ startViewTransition() { throw new Error("boom"); } }, () => {}, root));
  assert.equal(attributes.has(VIEW_TRANSITION_ATTRIBUTE), false, "启动失败也要摘掉");
});

test("不能转场时同步提交，行为与原路径一致（不等 chunk、不进回调）", () => {
  const { scheduler, waits } = manualScheduler();
  const commits = [];
  const navigator = createViewTransitionNavigator({
    canTransition: () => false,
    start: () => assert.fail("不应启动转场"),
    scheduler,
  });
  navigator.navigate({ ready: () => new Promise(() => {}), commit: (mode) => commits.push(mode) });
  assert.deepEqual(commits, ["instant"], "当场提交");
  assert.equal(waits.length, 0, "不等预取");
});

test("transition: false 的请求同步提交", () => {
  const { scheduler } = manualScheduler();
  const commits = [];
  const navigator = createViewTransitionNavigator({ canTransition: () => true, start: () => assert.fail(), scheduler });
  navigator.navigate({ commit: (mode) => commits.push(mode), transition: false });
  assert.deepEqual(commits, ["instant"]);
});

test("目标已就绪：立刻开始转场，状态在回调里提交", () => {
  const browser = fakeDocument();
  const { scheduler } = manualScheduler();
  const commits = [];
  const navigator = createViewTransitionNavigator({
    canTransition: () => true,
    start: (update) => startViewTransition(browser.doc, update),
    scheduler,
  });
  navigator.navigate({ ready: () => null, commit: (mode) => commits.push(mode) });
  assert.deepEqual(commits, [], "旧快照截图前不提交任何状态");
  browser.runAll();
  assert.deepEqual(commits, ["transition"]);
});

test("chunk 没到：最多等 150ms，到了就提前开始；超时照常切换", async () => {
  const browser = fakeDocument();
  const timer = manualScheduler();
  const commits = [];
  const navigator = createViewTransitionNavigator({
    canTransition: () => true,
    start: (update) => startViewTransition(browser.doc, update),
    scheduler: timer.scheduler,
  });

  let resolveChunk;
  navigator.navigate({ ready: () => new Promise((resolve) => { resolveChunk = resolve; }), commit: (mode) => commits.push(`fast:${mode}`) });
  assert.equal(timer.waits[0].ms, VIEW_TRANSITION_PRELOAD_WAIT_MS);
  resolveChunk();
  await tick();
  browser.runAll();
  assert.deepEqual(commits, ["fast:transition"], "chunk 先到就不等满 150ms");

  timer.waits.splice(0);
  navigator.navigate({ ready: () => new Promise(() => {}), commit: (mode) => commits.push(`slow:${mode}`) });
  await tick();
  assert.equal(browser.queued.length, 0, "超时前不开始");
  timer.flush();
  await tick();
  browser.runAll();
  assert.deepEqual(commits, ["fast:transition", "slow:transition"], "超时后照常切换");

  navigator.navigate({ ready: () => Promise.reject(new Error("chunk 失败")), commit: (mode) => commits.push(`fail:${mode}`) });
  await tick();
  browser.runAll();
  assert.equal(commits.at(-1), "fail:transition", "加载失败也要切过去，由错误边界显示");
});

test("等待期间来了新导航：旧的让路，只提交最后一次", async () => {
  const browser = fakeDocument();
  const timer = manualScheduler();
  const commits = [];
  const navigator = createViewTransitionNavigator({
    canTransition: () => true,
    start: (update) => startViewTransition(browser.doc, update),
    scheduler: timer.scheduler,
  });
  navigator.navigate({ ready: () => new Promise(() => {}), commit: () => commits.push("A") });
  navigator.navigate({ ready: () => null, commit: () => commits.push("B") });
  timer.flush();
  await tick();
  browser.runAll();
  assert.deepEqual(commits, ["B"]);
});

test("回调尚未执行就被新转场顶掉：旧回调什么都不做", () => {
  const browser = fakeDocument();
  const { scheduler } = manualScheduler();
  const commits = [];
  const navigator = createViewTransitionNavigator({
    canTransition: () => true,
    start: (update) => startViewTransition(browser.doc, update),
    scheduler,
  });
  navigator.navigate({ ready: () => null, commit: () => commits.push("A") });
  navigator.navigate({ ready: () => null, commit: () => commits.push("B") });
  browser.runAll();
  assert.deepEqual(commits, ["B"]);
});

test("cancel 作废还没提交的导航（浏览器后退已换了地址）", async () => {
  const browser = fakeDocument();
  const { scheduler } = manualScheduler();
  const commits = [];
  const navigator = createViewTransitionNavigator({
    canTransition: () => true,
    start: (update) => startViewTransition(browser.doc, update),
    scheduler,
  });
  navigator.navigate({ ready: () => null, commit: () => commits.push("A") });
  navigator.cancel();
  browser.runAll();
  assert.deepEqual(commits, []);
});

test("预取后 lazy 拿到同步兑现的 thenable，首帧不挂起", async () => {
  let calls = 0;
  const pageModule = { default: function Page() {} };
  const preloadable = createPreloadable(() => {
    calls += 1;
    return Promise.resolve(pageModule);
  });
  assert.equal(preloadable.isLoaded(), false);
  await Promise.all([preloadable.preload(), preloadable.preload()]);
  assert.equal(calls, 1, "并发预取只请求一次");
  assert.equal(preloadable.isLoaded(), true);

  // 照 React.lazy 的读法：then 之后立刻检查是否已兑现。
  let resolved = null;
  preloadable.load().then((value) => { resolved = value; });
  assert.equal(resolved, pageModule, "then 回调同步执行");
  assert.equal(await preloadable.load(), pageModule, "await 同样可用");
  assert.equal(calls, 1);
});

test("没预取时 load 就是普通的动态导入；失败后可重试，预取永不拒绝", async () => {
  let attempt = 0;
  const preloadable = createPreloadable(() => {
    attempt += 1;
    return attempt === 1 ? Promise.reject(new Error("网络错误")) : Promise.resolve({ default: "ok" });
  });
  await preloadable.preload();
  assert.equal(preloadable.isLoaded(), false);
  assert.deepEqual(await preloadable.load(), { default: "ok" });
  assert.equal(attempt, 2);
  assert.equal(preloadable.isLoaded(), true);
});

test("外壳：业务页仍是动态入口，导航经转场提交，伪元素有减弱动效兜底", async () => {
  const [atlas, base, shell] = await Promise.all([
    readFile(new URL("../app/memory-atlas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/base.css", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/shell.css", import.meta.url), "utf8"),
  ]);
  for (const view of ["interview-review", "jobs-view", "library-view", "timeline-view", "graph-view"]) {
    assert.ok(atlas.includes(`import("./${view}")`), `${view} 仍由外壳动态引用`);
  }
  assert.match(atlas, /flushSync\(\(\) => commit/);
  assert.match(atlas, /onPointerEnter=\{\(\) => preloadView\(/);
  // 伪元素挂在 :root 上，全局 *, ::before, ::after 的兜底管不到，必须单独关。
  assert.match(base, /@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-group\(\*\),\s*::view-transition-old\(\*\),\s*::view-transition-new\(\*\) \{\s*animation: none !important;/);
  assert.match(shell, /\.view-container\[data-enter="transition"\] \{\s*animation: none;/);
  assert.match(shell, /view-transition-name: nav-active;/);
  assert.match(shell, /view-transition-name: page-title;/);
});

test("外壳：同一页内的导航与回退不走转场，也不改 data-enter（否则容器重播入场）", async () => {
  const [atlas, shell] = await Promise.all([
    readFile(new URL("../app/memory-atlas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/shell.css", import.meta.url), "utf8"),
  ]);
  assert.match(atlas, /transition: nextView !== currentView\.current,/);
  // navigateToView 与 popstate 两处提交都只在换页时动 data-enter。
  assert.equal(atlas.match(/if \(entersNewView\) setViewEnter\(mode\);/g)?.length, 2);
  assert.doesNotMatch(atlas, /^\s*setViewEnter\(mode\);/m);
  // 跨页常驻的固定提示单独成组；页标题快照不随组宽度拉伸。
  assert.match(shell, /\.global-write-banner \{ view-transition-name: write-banner; \}/);
  assert.match(shell, /::view-transition-new\(page-title\) \{\s*width: auto;/);
});

test("外壳：后退／前进走转场时先把旧页面放回离开的位置，不改全局 scrollRestoration", async () => {
  const atlas = await readFile(new URL("../app/memory-atlas.tsx", import.meta.url), "utf8");
  const popstate = atlas.slice(atlas.indexOf("const onPopState"), atlas.indexOf('window.addEventListener("popstate", onPopState)'));
  // 浏览器的 auto 滚动恢复会先作用在旧 DOM 上；截快照前的那一帧滚回离开时的位置。
  assert.match(popstate, /const leaveY = window\.scrollY;\s*window\.requestAnimationFrame\(\(\) => window\.scrollTo\(\{ left: 0, top: leaveY, behavior: "instant" \}\)\);/);
  assert.ok(popstate.indexOf("const leaveY") < popstate.indexOf("viewNavigator.navigate("), "要在发起转场之前记下位置");
  // 章节、岗位抽屉等同页条目的后退还靠浏览器自动恢复滚动，外壳的历史处理不能整体改成 manual
  //（临场卡浮层打开期间临时改 manual、关闭时还原，那是另一回事）。
  assert.doesNotMatch(popstate, /scrollRestoration\s*=/);
});
