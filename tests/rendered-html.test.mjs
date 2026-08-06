import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
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

test("server-renders the Memory Atlas shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>回声 · 求职作战室<\/title>/i);
  assert.match(html, /<link rel="icon" href="\/favicon\.svg"/i);
  assert.match(html, /正在重建你的记忆关系/);
  // 顶栏不再有搜索框和刷新按钮，改成「我在哪 / 下一件 / 数据源」。首屏 loading=true。
  assert.match(html, /正在读取/);
  assert.match(html, /重读/);
  // 全库检索只有资料库有实体入口，其他页面靠 ⌘K 召唤浮层。
  // 所以初始外壳里既没有搜索框也没有搜索按钮——这不是漏渲染。
  assert.doesNotMatch(html, /搜索记忆、公司、日语错误/);
  for (const navigationLabel of [
    "总览",
    "求职进展",
    "岗位机会",
    "日历",
    "面试作战",
    "训练中心",
    "资料库",
  ]) {
    assert.match(html, new RegExp(navigationLabel));
  }
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the Obsidian credential server-side", async () => {
  const [apiRoute, vaultClient, client, packageJson, socialCard] = await Promise.all([
    readFile(new URL("../app/api/vault/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/obsidian.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/memory-atlas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/og.png", import.meta.url)),
  ]);

  assert.doesNotMatch(apiRoute, /NEXT_PUBLIC|window\./);
  assert.match(vaultClient, /OBSIDIAN_API_KEY/);
  assert.match(vaultClient, /Authorization: `Bearer/);
  assert.doesNotMatch(client, /OBSIDIAN_API_KEY|Authorization: `Bearer/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.deepEqual([...socialCard.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
