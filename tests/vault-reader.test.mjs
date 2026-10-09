import assert from "node:assert/strict";
import test from "node:test";
import { createVaultReader } from "../lib/vault-reader.ts";
import { PENDING_WRITE_TTL_MS } from "../lib/memory-atlas-data.ts";

const note = (path, type = "job-case", content = "原文", mtime = 1) => ({
  path, frontmatter: { type }, content, tags: [], stat: { ctime: 0, mtime, size: content.length },
});
const response = (notes, { etag = "tag", paths = notes.map((item) => item.path) } = {}) => Response.json(
  { connected: true, notes, ...(paths === null ? {} : { paths }) },
  { headers: { ETag: etag } },
);
const unchanged = () => new Response(null, { status: 304 });
const failure = (message = "连接中断") => Response.json({ connected: false, error: message }, { status: 503 });

function harness() {
  const calls = [];
  let clock = 1_000;
  const reader = createVaultReader({
    now: () => clock,
    fetcher: (url, options) => new Promise((resolve, reject) => { calls.push({ url, options, resolve, reject }); }),
  });
  const deliver = async (options, notes, config) => {
    const pending = reader.request(options);
    calls.at(-1).resolve(response(notes, config));
    return pending;
  };
  return { reader, calls, deliver, time: (value) => { clock = value; } };
}

test("相同 scope 共享 Promise，独立 scope 并发且各自完成才减计数", async () => {
  const { reader, calls } = harness();
  const jobs = reader.request({ scope: "jobs" });
  assert.equal(reader.request({ scope: "jobs" }), jobs);
  const training = reader.request({ scope: "training" });
  assert.equal(calls.length, 2);
  assert.equal(reader.getState().requestCount, 2);
  const study = note("30_学習/例.md", "study");
  calls[1].resolve(response([study]));
  assert.equal((await training).status, "accepted");
  assert.equal(reader.getState().requestCount, 1);
  assert.equal(reader.getState().loading, true);
  calls[0].resolve(response([note("20_求職/例.md")]));
  await jobs;
  assert.equal(reader.getState().requestCount, 0);
  assert.deepEqual(new Set(reader.getState().notes.map((item) => item.path)), new Set([study.path, "20_求職/例.md"]));
});

test("不同 scope 倒序返回，独有资料都保留，共享路径采用较新请求", async () => {
  const { reader, calls } = harness();
  const actions = reader.request({ scope: "actions" });
  const jobs = reader.request({ scope: "jobs" });
  calls[1].resolve(response([note("case.md", "job-case", "新"), note("ledger.md", "ledger")]));
  await jobs;
  calls[0].resolve(response([note("case.md", "job-case", "旧"), note("todo.md", "todo")]));
  await actions;
  assert.equal(reader.getState().notes.find((item) => item.path === "case.md").content, "新");
  assert.deepEqual(new Set(reader.getState().notes.map((item) => item.path)), new Set(["case.md", "todo.md", "ledger.md"]));
  assert.deepEqual(reader.getState().readyScopes, new Set(["jobs", "actions"]));
});

test("较新 scope 的删除证据压住旧响应中的路径，包含之前从未显示的笔记", async () => {
  const { reader, calls } = harness();
  const actions = reader.request({ scope: "actions" });
  const jobs = reader.request({ scope: "jobs" });
  calls[1].resolve(response([]));
  await jobs;
  calls[0].resolve(response([note("deleted.md"), note("todo.md", "todo")]));
  await actions;
  assert.deepEqual(reader.getState().notes.map((item) => item.path), ["todo.md"]);
});

test("被删除路径的更早 type 版本也不能从另一份 scope 快照复活", async () => {
  const { reader, deliver } = harness();
  await deliver({ scope: "training" }, [note("changed.md", "self")]);
  await deliver({ scope: "actions" }, [note("changed.md", "job-case")]);
  await deliver({ scope: "jobs" }, []);
  assert.deepEqual(reader.getState().notes, []);
});

test("all 建立屏障，旧 scope 立即被替代，在途 all 可由其它 scope 共享", async () => {
  const { reader, calls, time } = harness();
  const old = reader.request({ scope: "actions" });
  const fresh = reader.request({ fresh: true });
  assert.equal((await old).status, "superseded");
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(reader.request({ scope: "training" }), fresh);
  assert.equal(reader.getState().requestCount, 1);
  time(2_000);
  calls[1].resolve(response([note("case.md", "job-case", "新")]));
  await fresh;
  const accepted = reader.getState();
  calls[0].resolve(response([note("case.md", "job-case", "旧"), note("deleted.md")]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reader.getState(), accepted, "旧响应不能更新任何可观察状态");
  assert.equal(reader.getState().notes[0].content, "新");
  assert.deepEqual(reader.getState().readyScopes, new Set(["all"]));
  assert.equal(reader.getState().checkedAt.get("all"), 2_000);
});

test("重复 R 只等待最新请求，旧 304 和异常都不能改写新状态", async () => {
  const { reader, calls, deliver } = harness();
  await deliver({ scope: "all" }, [note("a.md")]);
  const ordinary = reader.request();
  const firstFresh = reader.request({ fresh: true });
  const lastFresh = reader.request({ fresh: true });
  assert.equal((await ordinary).status, "superseded");
  assert.equal((await firstFresh).status, "superseded");
  assert.equal(reader.getState().requestCount, 1);
  calls[3].resolve(response([note("b.md")]));
  await lastFresh;
  const accepted = reader.getState();
  calls[1].resolve(unchanged());
  calls[2].reject(new Error("旧请求失败"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reader.getState(), accepted);
  assert.equal(reader.getState().errors.size, 0);
});

test("304 重用对应 scope 的服务器原始快照，并作为最新观察参与投影", async () => {
  const { reader, calls, deliver, time } = harness();
  await deliver({ scope: "actions" }, [note("case.md", "job-case", "A")], { etag: "actions-a" });
  await deliver({ scope: "jobs" }, [note("case.md", "job-case", "B")]);
  const check = reader.request({ scope: "actions" });
  assert.deepEqual(calls[2].options.headers, { "If-None-Match": "actions-a" });
  time(3_000);
  calls[2].resolve(unchanged());
  const result = await check;
  assert.equal(result.status, "accepted");
  assert.equal(result.notes[0].content, "A", "304 意味着服务器仍是 A，不能误用其它 scope 的 B");
  assert.equal(reader.getState().checkedAt.get("actions"), 3_000);
});

test("空快照的 304 仍保留删除证据", async () => {
  const { reader, calls, deliver } = harness();
  await deliver({ scope: "jobs" }, []);
  await deliver({ scope: "actions" }, [note("case.md")]);
  const check = reader.request({ scope: "jobs" });
  calls.at(-1).resolve(unchanged());
  await check;
  assert.deepEqual(reader.getState().notes, []);
});

test("意外 304 没有可复用快照时无条件重试一次", async () => {
  const { reader, calls } = harness();
  const read = reader.request({ scope: "jobs" });
  calls[0].resolve(unchanged());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].options.headers, {});
  calls[1].resolve(response([note("a.md")]));
  assert.equal((await read).status, "accepted");
  const next = harness();
  const invalid = next.reader.request();
  next.calls[0].resolve(unchanged());
  await new Promise((resolve) => setImmediate(resolve));
  next.calls[1].resolve(unchanged());
  assert.equal((await invalid).status, "error");
  assert.equal(next.calls.length, 2);
});

test("scope 错误隔离，成功重试清掉自己的错误，all 成功清全部错误", async () => {
  const { reader, calls, deliver } = harness();
  const jobs = reader.request({ scope: "jobs" });
  const training = reader.request({ scope: "training" });
  calls[0].resolve(failure("岗位读取失败"));
  assert.equal((await jobs).status, "error");
  calls[1].resolve(response([note("study.md", "study")]));
  await training;
  assert.equal(reader.getState().errors.get("jobs"), "岗位读取失败");
  assert.equal(reader.getState().checkedAt.has("jobs"), false);
  await deliver({ scope: "jobs" }, [note("case.md")]);
  assert.equal(reader.getState().errors.size, 0);
  const failed = reader.request({ scope: "jobs" });
  calls.at(-1).resolve(failure());
  await failed;
  await deliver({ scope: "all" }, []);
  assert.equal(reader.getState().errors.size, 0);
});

test("读请求途中的修改和创建在旧内容、旧 paths 下保留，服务器确认后可正常删除", async () => {
  const { reader, calls, deliver } = harness();
  const pending = reader.request({ scope: "jobs" });
  const updated = note("case.md", "job-case", "已写回", 2);
  const created = note("new.md", "job-case", "新建", 3);
  reader.patchNote(updated);
  reader.patchNote(created);
  calls[0].resolve(response([note("case.md")]));
  await pending;
  assert.deepEqual(new Map(reader.getState().notes.map((item) => [item.path, item.content])), new Map([
    ["case.md", "已写回"], ["new.md", "新建"],
  ]));
  await deliver({ scope: "jobs" }, [updated, created]);
  await deliver({ scope: "jobs" }, []);
  assert.deepEqual(reader.getState().notes, [], "确认写回后不再永久覆盖服务器删除");
});

test("304 不把乐观写入当成服务器确认；TTL 到期后恢复服务器数据", async () => {
  const { reader, calls, deliver, time } = harness();
  await deliver({ scope: "jobs" }, [note("case.md")]);
  reader.patchNote(note("case.md", "job-case", "本页更新"));
  const check = reader.request({ scope: "jobs" });
  calls.at(-1).resolve(unchanged());
  await check;
  assert.equal(reader.getState().notes[0].content, "本页更新");
  time(1_001 + PENDING_WRITE_TTL_MS);
  const expired = reader.request({ scope: "jobs" });
  calls.at(-1).resolve(unchanged());
  await expired;
  assert.equal(reader.getState().notes[0].content, "原文");
});

test("R 放弃此前 pending，但保护 R 开始之后的写入", async () => {
  const { reader, calls } = harness();
  reader.patchNote(note("before.md", "job-case", "旧 pending"));
  const fresh = reader.request({ fresh: true });
  reader.patchNote(note("after.md", "job-case", "新 pending"));
  calls[0].resolve(response([]));
  await fresh;
  assert.deepEqual(reader.getState().notes.map((item) => item.path), ["after.md"]);
  assert.match(calls[0].url, /refresh=1/);
  assert.deepEqual(calls[0].options.headers, {});
});

test("兼容没有 paths 的旧 scope 响应，不推断删除；all 仍替换全量", async () => {
  const { reader, deliver } = harness();
  await deliver({ scope: "jobs" }, [note("a.md"), note("b.md")]);
  await deliver({ scope: "jobs" }, [note("a.md", "job-case", "更新")], { paths: null });
  assert.deepEqual(reader.getState().notes.map((item) => item.path).sort(), ["a.md", "b.md"]);
  await deliver({ scope: "all" }, [note("a.md")], { paths: null });
  assert.deepEqual(reader.getState().notes.map((item) => item.path), ["a.md"]);
});

test("getState 在发布之间引用稳定，dispose 后仍可订阅和读取，适应 StrictMode 重放", async () => {
  const { reader, calls } = harness();
  let notifications = 0;
  const unsubscribe = reader.subscribe(() => { notifications += 1; });
  assert.equal(reader.getState(), reader.getState());
  const first = reader.request({ scope: "jobs" });
  reader.dispose();
  assert.equal((await first).status, "superseded");
  assert.equal(reader.getState().requestCount, 0);
  const before = notifications;
  const replay = reader.request({ scope: "jobs" });
  calls[1].resolve(response([note("a.md")]));
  await replay;
  assert.ok(notifications > before);
  assert.equal(reader.getState().notes.length, 1);
  unsubscribe();
  const stopped = notifications;
  reader.patchNote(note("b.md"));
  assert.equal(notifications, stopped);
  const latest = reader.getState();
  calls[0].resolve(failure());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reader.getState(), latest);
});
