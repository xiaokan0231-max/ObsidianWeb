import assert from "node:assert/strict";
import test from "node:test";
import { createKeyedSerialQueue, createSerialQueue } from "../lib/server/serial-queue.ts";

// 写路由的串行区间。并发与顺序都用手动 resolve 的 deferred 证明，不靠 sleep 赌时序。
// 按 key 的队列在每次操作后挂一个清理定时器（最少 1 秒、未 unref）：
// 这里用 mock 定时器接管 setTimeout，测试进程不必等真定时器到点才能退出。
// 把已排队的微任务全部跑完（setImmediate 不在 mock 范围内）。只用来「让该发生的都发生」，不承担证明。
const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test("同一 tick 里涌进来的调用按调用顺序执行，前一个没完成后一个不开始", async () => {
  const run = createSerialQueue();
  const log = [];
  const gates = [deferred(), deferred(), deferred()];
  const results = gates.map((gate, index) => run(async () => {
    log.push(`start ${index}`);
    await gate.promise;
    log.push(`end ${index}`);
    return index;
  }));
  // 倒序放行：若不是串行，2 会先结束。
  gates[2].resolve();
  gates[1].resolve();
  await settle();
  assert.deepEqual(log, ["start 0"], "0 还没完成，1 和 2 都不该开始");
  gates[0].resolve();
  assert.deepEqual(await Promise.all(results), [0, 1, 2]);
  assert.deepEqual(log, ["start 0", "end 0", "start 1", "end 1", "start 2", "end 2"]);
});

test("失败只抛回自己的调用方，不毒化后面排着的操作（含同步抛错）", async () => {
  const run = createSerialQueue();
  const gate = deferred();
  const failing = run(async () => { await gate.promise; throw new Error("写入失败"); });
  const syncThrow = run(() => { throw new Error("同步抛错"); });
  const after = run(async () => "后续照常");
  gate.resolve();
  await assert.rejects(failing, /写入失败/);
  await assert.rejects(syncThrow, /同步抛错/);
  assert.equal(await after, "后续照常");
  assert.equal(await run(async () => "再来一次"), "再来一次");
});

test("按 key 分片：同 key 串行，不同 key 在前者阻塞时照样跑完", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = createKeyedSerialQueue(1_000);
  const gateA = deferred();
  const started = [];
  const first = run("20_求職/株式会社テスト/案件.md", async () => { started.push("a1"); await gateA.promise; return "a1"; });
  const second = run("20_求職/株式会社テスト/案件.md", async () => { started.push("a2"); return "a2"; });
  const other = run("20_求職/株式会社サンプル/案件.md", async () => { started.push("b"); return "b"; });
  // a1 仍被挡着的时候 b 已经完成：不同 key 真的是并行的。
  assert.equal(await other, "b");
  assert.deepEqual(started, ["a1", "b"], "a2 必须等 a1");
  gateA.resolve();
  assert.deepEqual(await Promise.all([first, second]), ["a1", "a2"]);
  assert.deepEqual(started, ["a1", "b", "a2"]);
});

test("清理定时器只删自己那一段 tail：后续操作还在跑时到点，也不会让新请求插队", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = createKeyedSerialQueue(1_000);
  const key = "20_求職/株式会社ダミー/案件.md";
  const gate1 = deferred();
  const gate2 = deferred();
  const log = [];
  const first = run(key, async () => { await gate1.promise; log.push("1"); });
  const second = run(key, async () => { log.push("2 start"); await gate2.promise; log.push("2 end"); });
  gate1.resolve();
  await first;
  // first 的 finally 已挂上清理定时器；让它在 second 仍未完成时到点。
  t.mock.timers.tick(1_000);
  const third = run(key, async () => { log.push("3"); });
  await settle();
  assert.deepEqual(log, ["1", "2 start"], "third 必须排在仍在进行的 second 之后");
  gate2.resolve();
  await Promise.all([second, third]);
  assert.deepEqual(log, ["1", "2 start", "2 end", "3"]);
  // 全部结束、定时器到点清掉之后，同一个 key 仍能正常使用。
  t.mock.timers.tick(1_000);
  assert.equal(await run(key, async () => "ok"), "ok");
});

test("空 key 直接拒绝，操作不会被执行", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = createKeyedSerialQueue(1_000);
  let ran = false;
  await assert.rejects(run("", async () => { ran = true; }), /需要 key/);
  assert.equal(ran, false);
});
