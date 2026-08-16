import assert from "node:assert/strict";
import test from "node:test";
import { createVaultCache } from "../lib/server/vault-cache.ts";

// 可控的假 IO：stats 是「Obsidian 眼里的现状」，notes 是每个路径的当前内容。
// readCalls / crawlCalls 记录缓存层实际付出的代价——断言的就是这些代价。
function fakeVault(initial) {
  const state = {
    stats: new Map(Object.entries(initial).map(([path, mtime]) => [path, mtime])),
    statsAvailable: true,
    readCalls: [],
    crawlCalls: 0,
  };
  const io = {
    async statAllNotes() {
      return state.statsAvailable ? new Map(state.stats) : null;
    },
    async readNote(path) {
      state.readCalls.push(path);
      return note(path, state.stats.get(path) ?? 0);
    },
    async crawlAllNotes() {
      state.crawlCalls += 1;
      return [...state.stats.keys()].map((path) => note(path, state.stats.get(path)));
    },
  };
  return { state, cache: createVaultCache(io) };
}

function note(path, mtime) {
  return {
    path,
    stat: { ctime: mtime, mtime, size: 10 },
    tags: [],
    frontmatter: {},
    content: `body of ${path} @${mtime}`,
  };
}

test("首轮全取，第二轮 mtime 没变就一个文件都不重取", async () => {
  const { state, cache } = fakeVault({ "a.md": 100, "b.md": 200 });
  const first = await cache.readAll();
  assert.equal(first.length, 2);
  assert.equal(state.readCalls.length, 2);

  const second = await cache.readAll();
  assert.equal(second.length, 2);
  assert.equal(state.readCalls.length, 2, "缓存命中时零 GET");
  // mtime 降序（与旧 readAllNotes 的排序契约一致）
  assert.deepEqual(second.map((item) => item.path), ["b.md", "a.md"]);
});

test("只重取 mtime 变过的文件；删除的文件从结果中消失；新文件被拾起", async () => {
  const { state, cache } = fakeVault({ "a.md": 100, "b.md": 200, "c.md": 300 });
  await cache.readAll();
  state.readCalls.length = 0;

  state.stats.set("a.md", 150);      // 变更
  state.stats.delete("c.md");        // 删除
  state.stats.set("d.md", 400);      // 新建
  const notes = await cache.readAll();

  assert.deepEqual(state.readCalls.sort(), ["a.md", "d.md"], "b.md 不重取");
  assert.deepEqual(
    notes.map((item) => item.path).sort(),
    ["a.md", "b.md", "d.md"],
  );
  assert.ok(notes.find((item) => item.path === "a.md").content.includes("@150"));
});

test("拿不到变更信号时退回全量爬取＝旧行为，且顺手重建缓存", async () => {
  const { state, cache } = fakeVault({ "a.md": 100 });
  state.statsAvailable = false;
  await cache.readAll();
  assert.equal(state.crawlCalls, 1);

  // 信号恢复后走增量，爬取不再发生
  state.statsAvailable = true;
  state.readCalls.length = 0;
  await cache.readAll();
  assert.equal(state.crawlCalls, 1);
  assert.equal(state.readCalls.length, 0, "全量爬取重建过的缓存直接命中");
});

test("invalidate 后同一路径必然重取——写路由收尾的 readAll 要看到新内容", async () => {
  const { state, cache } = fakeVault({ "a.md": 100, "b.md": 200 });
  await cache.readAll();
  state.readCalls.length = 0;

  // 模拟写入：内容变了但我们只知道路径（mtime 由 Obsidian 侧变化）
  state.stats.set("a.md", 101);
  cache.invalidate("a.md");
  const notes = await cache.readAll();

  assert.deepEqual(state.readCalls, ["a.md"]);
  assert.ok(notes.find((item) => item.path === "a.md").content.includes("@101"));
});

test("并发 readAll 共享同一趟在途请求", async () => {
  const { state, cache } = fakeVault({ "a.md": 100, "b.md": 200 });
  const [first, second] = await Promise.all([cache.readAll(), cache.readAll()]);
  assert.equal(state.readCalls.length, 2, "两个并发调用只付一份代价");
  assert.deepEqual(
    first.map((item) => item.path),
    second.map((item) => item.path),
  );
});

test("force 跳过增量走全量爬取（页面 R 键的语义）", async () => {
  const { state, cache } = fakeVault({ "a.md": 100 });
  await cache.readAll();
  await cache.readAll({ force: true });
  assert.equal(state.crawlCalls, 1, "force 不做 mtime 扫描直接爬");
});
