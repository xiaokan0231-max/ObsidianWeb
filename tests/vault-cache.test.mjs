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
    clock: 1_000,
    /** path → 呼び出し側が解決を握る gate（読み取り中に別の操作を差し込むため）。 */
    gates: new Map(),
    /** path → 実際に GET が返す内容の上書き（磁盘が追いつく前の状態を再現する）。 */
    contentOverride: new Map(),
  };
  const io = {
    now: () => state.clock,
    async statAllNotes() {
      return state.statsAvailable ? new Map(state.stats) : null;
    },
    async readNote(path) {
      state.readCalls.push(path);
      const gate = state.gates.get(path);
      if (gate) await gate;
      const built = note(path, state.stats.get(path) ?? 0);
      const override = state.contentOverride.get(path);
      return override ? { ...built, ...override } : built;
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

// 🔴 実測で再現した回帰。invalidate が条目を「消して」いた時、在途の増分リフレッシュ
// （スキャン済み・再取得待ち）の穴に落ちて、そのラウンドの結果からノートが丸ごと落ちた。
// クライアントはそれを全量スナップショットとして setNotes するので、画面から消えたまま
// 手動再読込まで戻らない（B2 で「書いたら全量再取得」を外したので自動復帰もしない）。
test("在途リフレッシュ中に別のノートを書いても、そのノートは結果から消えない", async () => {
  const { state, cache } = fakeVault({ "a.md": 100, "b.md": 200 });
  await cache.readAll();

  // a だけ変更 → 次の readAll は a を取り直す。その GET を握って止める。
  state.stats.set("a.md", 150);
  let openGate = () => {};
  state.gates.set("a.md", new Promise((resolve) => { openGate = resolve; }));

  const inflight = cache.readAll();
  await Promise.resolve();
  // a の再取得を待っている間に、別のノート b へ書き込みが起きる
  cache.invalidate("b.md");
  openGate();

  const notes = await inflight;
  assert.deepEqual(
    notes.map((item) => item.path).sort(),
    ["a.md", "b.md"],
    "書き込まれた b.md がスナップショットから落ちてはいけない",
  );
});

test("書いた直後は mtime で固定しない（取り直しが古い値を掴んでも居座らせない）", async () => {
  const { state, cache } = fakeVault({ "curriculum.md": 100 });
  await cache.readAll();

  // writeNote 相当：内容は磁盘に落ちたが metadataCache はまだ古い
  cache.invalidate("curriculum.md");
  state.stats.set("curriculum.md", 500);
  state.contentOverride.set("curriculum.md", {
    content: "再生成された課程",
    frontmatter: { type: "language-curriculum", lifecycle: "superseded" },
  });

  // 取り直しは走るが、固定はしない
  const first = await cache.readAll();
  assert.equal(first[0].content, "再生成された課程");
  state.readCalls.length = 0;
  await cache.readAll();
  assert.deepEqual(state.readCalls, ["curriculum.md"], "守り時間内は毎回突き合わせる");

  // metadataCache が追いつき、守り時間も過ぎたら普通に固定される（無限に取り直さない）
  state.clock += 10_000;
  await cache.readAll();
  state.readCalls.length = 0;
  const settled = await cache.readAll();
  assert.deepEqual(state.readCalls, [], "守り時間を過ぎたらキャッシュが効く");
  assert.equal(settled[0].frontmatter.lifecycle, "superseded");
});

// R キー（force）は crawl 分岐へ落ちる。ここが守りを見ていないと、書いた直後に
// R を押した時——カードが変わらないので押したくなる——固定を早回しすることになる。
test("force（R キー）の全量爬取でも、書いた直後のパスは固定しない", async () => {
  const { state, cache } = fakeVault({ "a.md": 100 });
  await cache.readAll();

  cache.invalidate("a.md");
  state.stats.set("a.md", 500);

  await cache.readAll({ force: true });
  state.readCalls.length = 0;
  await cache.readAll();
  assert.deepEqual(state.readCalls, ["a.md"], "crawl 後も守り時間内は突き合わせ続ける");

  state.clock += 10_000;
  await cache.readAll();
  state.readCalls.length = 0;
  await cache.readAll();
  assert.deepEqual(state.readCalls, [], "守り時間を過ぎたら固定される");
});

test("書き込み直後のノートは、まだスキャンに現れなくても消えない", async () => {
  const { state, cache } = fakeVault({ "a.md": 100, "b.md": 200 });
  await cache.readAll();

  // b を書いたが、このラウンドのスキャンは b の変更前を見ている（＝現れない）
  cache.invalidate("b.md");
  state.stats.delete("b.md");
  const notes = await cache.readAll();
  assert.ok(notes.some((item) => item.path === "b.md"), "書いた直後のノートが消えてはいけない");

  // 守り時間を過ぎてもスキャンに現れないなら（＝本当に消された）落とす
  state.clock += 10_000;
  const later = await cache.readAll();
  assert.equal(later.some((item) => item.path === "b.md"), false);
});
