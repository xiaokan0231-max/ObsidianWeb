import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientRoot = new URL("../dist/client/", import.meta.url);
const serverRoot = new URL("../dist/server/", import.meta.url);
const client = JSON.parse(await readFile(new URL(".vite/manifest.json", clientRoot), "utf8"));
const server = JSON.parse(await readFile(new URL(".vite/manifest.json", serverRoot), "utf8"));

function staticClosure(manifest, roots) {
  const visited = new Set();
  const pending = [...roots];
  while (pending.length) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    assert.ok(manifest[key], `构建清单缺少 ${key}`);
    visited.add(key);
    pending.push(...(manifest[key].imports ?? []));
  }
  return [...visited];
}

async function cssFor(manifest, keys, root) {
  const files = new Set(keys.flatMap((key) => manifest[key].css ?? []));
  return (await Promise.all([...files].map((file) => readFile(new URL(file, root), "utf8")))).join("\n");
}

const shell = staticClosure(client, ["app/memory-atlas.tsx"]);
test("日历外壳的静态依赖不包含其它业务页，业务页仍作为动态入口可达", () => {
  const views = ["interview-review", "interview-insights", "interview-practice", "interview-prep", "interview-session", "japanese-training", "language-expression-courses", "jobs-analytics", "jobs-view", "graph-view", "library-view", "timeline-view"];
  const dynamic = new Set(shell.flatMap((key) => client[key].dynamicImports ?? []));
  for (const view of views) {
    const key = `app/${view}.tsx`;
    assert.equal(client[key]?.isDynamicEntry, true, `${view} 应生成可加载的业务页模块`);
    assert.equal(shell.includes(key), false, `${view} 不应进入首屏静态依赖`);
    assert.ok(dynamic.has(key), `${view} 的动态入口必须由外壳引用`);
  }
});

test("教材和情境课样式随课程模块加载，不进入全局与日历首屏 CSS", async () => {
  const serverEntry = Object.keys(server).filter((key) => server[key].isEntry);
  assert.ok(serverEntry.length, "找到 Worker 构建入口");
  const initialCss = await cssFor(client, shell, clientRoot) +
    await cssFor(server, staticClosure(server, serverEntry), serverRoot);
  assert.match(initialCss, /\.app-shell\b/, "实际检查包含全局外壳的样式，不能因清单漏读而空通过");
  for (const selector of [/\.scenario-workbench\b/, /\.language-textbook\b/]) assert.doesNotMatch(initialCss, selector);
  const course = staticClosure(client, ["app/language-expression-courses.tsx"]);
  const courseCss = await cssFor(client, course, clientRoot);
  assert.match(courseCss, /\.scenario-workbench\b/);
  assert.match(courseCss, /\.language-textbook\b/);
});
