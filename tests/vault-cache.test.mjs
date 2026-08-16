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

// 🔴 実際の Local REST API の形：content と stat は磁盘（PUT 完了後なので新しい）、
// frontmatter と tags は**非同期に再解析される metadataCache**（しばらく古いまま）。
// つまり滞留中は「新しい mtime ＋ 新しい content ＋ 古い frontmatter」。
// content で追いつき判定をすると必ず一致してしまい、古い frontmatter が
// 磁盘と同じ mtime で落ちて**永久に固定**される（看板の status が巻き戻り、
// R キーを押しても直らない）。この形でしか捕まらないので、こう組む。
test("prime した権威データは、metadataCache が追いつくまで古い frontmatter に上書きされない", async () => {
  const { state, cache } = fakeVault({ "a.md": 100 });
  await cache.readAll();

  const authoritative = {
    ...note("a.md", 500),
    content: "書き換え後の本文",
    frontmatter: { type: "job-case", status: "不採用" },
  };
  cache.prime(authoritative);
  state.stats.set("a.md", 500);
  // 磁盘は追いついている（content も mtime も新しい）が metadataCache だけ古い
  state.contentOverride.set("a.md", {
    content: "書き換え後の本文",
    frontmatter: { type: "job-case", status: "応募済" },
  });

  const first = await cache.readAll();
  assert.equal(first[0].frontmatter.status, "不採用", "古い frontmatter で権威データを潰さない");

  // 何度読んでも固定されない（＝mtime 一致で取り直しを諦めていない）
  const second = await cache.readAll();
  assert.equal(second[0].frontmatter.status, "不採用");

  // metadataCache が追いついたら素直に受け入れる
  state.contentOverride.set("a.md", {
    content: "書き換え後の本文",
    frontmatter: { type: "job-case", status: "不採用" },
  });
  const third = await cache.readAll();
  assert.equal(third[0].frontmatter.status, "不採用");
  state.readCalls.length = 0;
  await cache.readAll();
  assert.equal(state.readCalls.length, 0, "追いついた後は普通にキャッシュが効く");

  // 守り時間を過ぎれば、Obsidian 側の手編集は無条件に通る（固定ではなく逃げ道）
  state.clock += 10_000;
  state.stats.set("a.md", 900);
  state.contentOverride.set("a.md", {
    content: "Obsidian で手編集",
    frontmatter: { type: "job-case", status: "保留" },
  });
  const fourth = await cache.readAll();
  assert.equal(fourth[0].frontmatter.status, "保留");
  assert.equal(fourth[0].content, "Obsidian で手編集");
});

// R キー（force）は crawl 分岐へ落ちる。ここが守りを見ていないと、書いた直後に
// R を押した時——カードが変わらないので押したくなる——同じ古い frontmatter が、
// 今度は取り直しの機会も無いまま固定される。
test("force（R キー）の全量爬取でも、prime した権威データは守り時間内なら残る", async () => {
  const { state, cache } = fakeVault({ "a.md": 100 });
  await cache.readAll();

  cache.prime({
    ...note("a.md", 500),
    content: "書き換え後の本文",
    frontmatter: { type: "job-case", status: "不採用" },
  });
  state.stats.set("a.md", 500);
  state.contentOverride.set("a.md", {
    content: "書き換え後の本文",
    frontmatter: { type: "job-case", status: "応募済" },
  });

  const forced = await cache.readAll({ force: true });
  assert.equal(forced[0].frontmatter.status, "不採用", "R キーでも古い frontmatter を固定しない");

  // その後の増分読みでも固定されていない
  const next = await cache.readAll();
  assert.equal(next[0].frontmatter.status, "不採用");
});

test("prime 直後の新規ノートは、まだスキャンに現れなくても消えない", async () => {
  const { state, cache } = fakeVault({ "a.md": 100 });
  await cache.readAll();

  // 批注ノートの初回作成：スキャンはまだこのファイルを知らない
  cache.prime(note("new.md", 300));
  const notes = await cache.readAll();
  assert.ok(notes.some((item) => item.path === "new.md"), "作りたてのノートが消えてはいけない");

  // 守り時間を過ぎ、スキャンにも現れないなら（＝本当に消された）落とす
  state.clock += 10_000;
  const later = await cache.readAll();
  assert.equal(later.some((item) => item.path === "new.md"), false);
});

// 🔴 prime できるのは「更新後の note を組み立てられる書き手」だけで、実際には
// writeNote の呼び出し 15 箇所のうち 2 箇所しかない。残り（課程の再生成・
// generated-artifact の supersede など）は invalidate だけなので、権威データが無い。
// 印を付けて取り直させても、その取り直しが metadataCache の再解析より早ければ
// 「新しい mtime ＋ 古い frontmatter」を mtime 一致で固定してしまう——
// supersede は既存ノートの frontmatter だけを書き換えるので Obsidian は旧 cache を即返す＝必ず踏む。
test("prime していない書き込みでも、守り時間内は mtime で固定しない", async () => {
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
