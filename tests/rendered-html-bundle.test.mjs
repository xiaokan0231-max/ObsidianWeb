import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";

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
  const views = ["interview-review", "company-comparison", "interview-practice", "interview-prep", "interview-session", "japanese-training", "language-expression-courses", "jobs-analytics", "jobs-view", "graph-view", "library-view", "timeline-view"];
  const dynamic = new Set(shell.flatMap((key) => client[key].dynamicImports ?? []));
  for (const view of views) {
    const key = `app/${view}.tsx`;
    assert.equal(client[key]?.isDynamicEntry, true, `${view} 应生成可加载的业务页模块`);
    assert.equal(shell.includes(key), false, `${view} 不应进入首屏静态依赖`);
    assert.ok(dynamic.has(key), `${view} 的动态入口必须由外壳引用`);
  }
});

test("笔记正文与共用面试材料只在打开阅读层时加载", () => {
  const dynamic = new Set(shell.flatMap((key) => client[key].dynamicImports ?? []));
  for (const reader of ["note-drawer", "scene-note-reader", "interview-shared-asset"]) {
    const key = `app/${reader}.tsx`;
    assert.equal(client[key]?.isDynamicEntry, true, `${reader} 应保留独立入口`);
    assert.equal(shell.includes(key), false, `${reader} 不应进入首屏静态依赖`);
    assert.ok(dynamic.has(key), `${reader} 打开时必须能加载`);
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

test("快练样式随日语训练模块加载，不进入全局与日历首屏 CSS", async () => {
  const serverEntry = Object.keys(server).filter((key) => server[key].isEntry);
  const initialCss = await cssFor(client, shell, clientRoot) +
    await cssFor(server, staticClosure(server, serverEntry), serverRoot);
  assert.match(initialCss, /\.app-shell\b/, "实际检查包含全局外壳的样式，不能因清单漏读而空通过");
  assert.doesNotMatch(initialCss, /\.quick-card\b/);
  const training = staticClosure(client, ["app/japanese-training.tsx"]);
  assert.match(await cssFor(client, training, clientRoot), /\.quick-card\b/);
});

test("日历首屏不带专题和3D样式，按构建闭包限制初始CSS字节", async () => {
  const initialFiles = new Map();
  const addFiles = (manifest, keys, root) => {
    for (const key of keys) for (const path of manifest[key].css ?? []) initialFiles.set(path, new URL(path, root));
  };
  const serverEntry = Object.keys(server).filter((key) => server[key].isEntry);
  addFiles(server, staticClosure(server, serverEntry), serverRoot);
  addFiles(client, staticClosure(client, ["app/memory-atlas.tsx", "app/feedback-ui.tsx"]), clientRoot);
  const chunks = await Promise.all([...initialFiles.values()].map((path) => readFile(path)));
  const css = chunks.map((chunk) => chunk.toString()).join("\n");
  assert.match(css, /\.app-shell\b/);
  assert.doesNotMatch(css, /\.reading-workspace\b|\.space-graph-pointer-fx\b/);
  const rawBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const gzipBytes = chunks.reduce((sum, chunk) => sum + gzipSync(chunk, { level: 6 }).length, 0);
  assert.ok(rawBytes <= 768_000, `日历初始 CSS 原始字节 ${rawBytes}`);
  assert.ok(gzipBytes <= 126_000, `日历初始 CSS gzip 字节 ${gzipBytes}`);
  assert.match(await cssFor(client, staticClosure(client, ["app/reading-view.tsx"]), clientRoot), /\.reading-workspace\b/);
  for (const view of ["graph-view", "timeline-view"]) {
    assert.match(await cssFor(client, staticClosure(client, [`app/${view}.tsx`]), clientRoot), /\.space-graph-pointer-fx\b/);
  }
});
