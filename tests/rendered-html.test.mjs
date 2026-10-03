import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/calendar", method = "GET", cookie = "") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { accept: "text/html", host: "localhost", cookie },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      OBSIDIAN_API_KEY: "",
      OBSIDIAN_API_URL: "http://127.0.0.1:27123",
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Career War Room shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>求职作战室<\/title>/i);
  assert.match(html, /<link rel="icon" href="\/favicon\.svg"/i);
  assert.match(html, /正在加载求职作战室/);
  assert.match(html, /class="language-switch"/);
  assert.match(html, /lang="zh-CN" aria-pressed="true"/);
  assert.match(html, /lang="ja" aria-pressed="false"/);
  assert.doesNotMatch(html, /回声/);
  // 顶栏不再有搜索框和刷新按钮，改成「我在哪 / 下一件 / 数据源」。首屏 loading=true。
  assert.match(html, /正在读取/);
  assert.match(html, /重读/);
  // 搜索是可点击的命令入口，不再要求先记住快捷键。
  assert.match(html, /搜索与命令/);
  assert.doesNotMatch(html, /搜索记忆、公司、日语错误/);
  for (const navigationLabel of [
    "日历",
    "求职",
    "面试作战",
    "训练中心",
    "资料库",
  ]) {
    assert.match(html, new RegExp(navigationLabel));
  }
  assert.doesNotMatch(html, /行动清单|全部行动|件待办/);
  assert.doesNotMatch(html, /href="\/overview"|aria-label="总览"|近期安排|进行中案件|等待回复/);
  assert.match(html, /class="brand" href="\/calendar"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("保存的日语选择在服务端首屏、菜单与元数据中保持一致", async () => {
  const response = await render("/jobs?status=応募済", "GET", "career-room-locale=ja");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ja"/);
  assert.match(html, /<title>転職作戦室<\/title>/);
  assert.match(html, /カレンダー|転職活動|今回の面接/);
  assert.match(html, /検索とコマンド/);
  assert.match(html, /lang="ja" aria-pressed="true"/);
  assert.doesNotMatch(html, /搜索与命令|正在加载求职作战室|回声/);
});

test("根入口及旧行动、总览入口重定向日历并保留笔记定位", async () => {
  for (const path of ["/", "/actions", "/actions/", "/overview", "/overview/"]) {
    let response = await render(`${path}?tab=open&who=system&note=test.md&section=background&tag=a&tag=b`);
    if (path.length > 1 && path.endsWith("/")) {
      assert.equal(response.status, 308);
      const normalized = new URL(response.headers.get("location"), "http://localhost");
      assert.equal(normalized.pathname, path.replace(/\/$/, ""));
      response = await render(`${normalized.pathname}${normalized.search}`);
    }
    assert.equal(response.status, 307);
    const target = new URL(response.headers.get("location"), "http://localhost");
    assert.equal(target.pathname, "/calendar");
    assert.equal(target.searchParams.get("note"), "test.md");
    assert.equal(target.searchParams.get("section"), "background");
    assert.deepEqual(target.searchParams.getAll("tag"), ["a", "b"]);
    assert.equal(target.searchParams.has("tab"), false);
    assert.equal(target.searchParams.has("who"), false);
  }
});

test("移除的待办状态接口不再接受写入", async () => {
  const response = await render("/api/todos/status", "POST");
  assert.ok([404, 405].includes(response.status), `删除的接口返回 ${response.status}`);
});

test("keeps the Obsidian credential server-side", async () => {
  const [apiRoute, vaultClient, client, packageJson, socialCard] = await Promise.all([
    readFile(new URL("../app/api/vault/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/obsidian.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/memory-atlas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/og.jpg", import.meta.url)),
  ]);

  assert.doesNotMatch(apiRoute, /NEXT_PUBLIC|window\./);
  assert.match(vaultClient, /OBSIDIAN_API_KEY/);
  assert.match(vaultClient, /Authorization: `Bearer/);
  assert.doesNotMatch(client, /OBSIDIAN_API_KEY|Authorization: `Bearer/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.deepEqual([...socialCard.subarray(0, 3)], [255, 216, 255]);
});
