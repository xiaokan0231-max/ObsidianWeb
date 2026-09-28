import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

// 写路由的三道门是否装齐：每条 POST 都过同源校验（readJson 内置，或显式调用），
// 带乐观锁的三条都用 mtime。源码断言而不是行为测试，因为路由靠 "@/" 别名，node 加载不了。
async function postRoutes(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await postRoutes(path)));
    else if (entry.name === "route.ts") {
      const source = await readFile(path, "utf8");
      if (/export async function POST/.test(source)) out.push([path, source]);
    }
  }
  return out;
}

test("每条 POST 路由都先过同源校验", async () => {
  const routes = await postRoutes("app/api");
  assert.ok(routes.length >= 20, `找到 ${routes.length} 条 POST 路由`);
  for (const [path, source] of routes) {
    assert.ok(/await readJson</.test(source) || /assertSameOrigin\(request\)/.test(source), `${path} 没有同源校验`);
    assert.doesNotMatch(source, /export async function POST\(\)/, `${path} 的 POST 拿不到 request，无法校验来源`);
  }
});

test("案件状态・跟进・行动状态三条路由用 mtime 做乐观锁，写后回读磁盘 mtime", async () => {
  for (const path of ["app/api/jobs/status/route.ts", "app/api/jobs/follow-up/route.ts", "app/api/todos/status/route.ts"]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /expectedMtime/, `${path} 没有 expectedMtime`);
    assert.match(source, /readNoteOrNull\(path\)/, `${path} 写后没有回读 mtime`);
    assert.doesNotMatch(source, /expectedStatusUpdated/, `${path} 还在用日精度的 status_updated 当版本`);
  }
  const api = await readFile("lib/server/api.ts", "utf8");
  assert.match(api, /assertSameOrigin\(request\);\s*assertJsonContentType\(request\.headers\);/, "readJson 先验来源与 Content-Type");
});
