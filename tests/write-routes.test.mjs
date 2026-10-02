import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import * as api from "../lib/server/api.ts";
import * as guards from "../lib/server/write-guards.ts";
import { validateJobStatusRestore } from "../lib/job-status-restore.ts";

// 写路由的三道门是否装齐：每条 POST 都过同源校验（readJson 内置，或显式调用），
// 案件状态与跟进都用 mtime。源码断言而不是行为测试，因为路由靠 "@/" 别名，node 加载不了。
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

test("案件状态与跟进路由用 mtime 做乐观锁，写后回读磁盘 mtime", async () => {
  for (const path of ["app/api/jobs/status/route.ts", "app/api/jobs/follow-up/route.ts"]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /expectedMtime/, `${path} 没有 expectedMtime`);
    assert.match(source, /readNoteOrNull\(path\)/, `${path} 写后没有回读 mtime`);
    assert.doesNotMatch(source, /expectedStatusUpdated/, `${path} 还在用日精度的 status_updated 当版本`);
  }
  const api = await readFile("lib/server/api.ts", "utf8");
  assert.match(api, /assertSameOrigin\(request\);\s*assertJsonContentType\(request\.headers\);/, "readJson 先验来源与 Content-Type");
});

test("状态撤销必须带 expectedMtime，并返回可校验的撤销表", async () => {
  const jobs = await readFile("app/api/jobs/status/route.ts", "utf8");
  assert.match(jobs, /validateJobStatusRestore\(body\.restore\)/, "restore 表经过白名单校验");
  assert.match(jobs, /buildJobStatusUndo\(note\.frontmatter/, "撤销表取写入前的 frontmatter");
  assert.match(jobs, /if \(expectedMtime === undefined\)/, "撤销缺 expectedMtime 时拒绝，而不是放行");
  assert.match(jobs, /restore 与 status 不能同时提交/);
});

/** 断言 needles 在 source 里依次出现（每个都要找得到，且位置递增）。 */
function assertInOrder(source, needles, label) {
  let cursor = -1;
  for (const needle of needles) {
    const index = source.indexOf(needle, cursor + 1);
    assert.ok(index > cursor, `${label}：「${needle}」缺失或顺序不对`);
    cursor = index;
  }
}

test("状态撤销分支：先走白名单校验，缺 expectedMtime 就 400，进队列后用共用的 assertExpectedMtime 比对再写", async () => {
  const source = await readFile("app/api/jobs/status/route.ts", "utf8");
  assert.match(source, /import \{[^}]*\bvalidateJobStatusRestore\b[^}]*\} from "@\/lib\/job-status-restore";/, "restore 校验来自 lib/job-status-restore.ts，而不是路由里另写一份");
  assert.match(source, /import \{[^}]*\bassertExpectedMtime\b[^}]*\} from "@\/lib\/server\/api";/);
  // POST 先分派撤销：撤销请求不能掉进状态写入的规则里（会再推进 status_updated、补 applied_on）。
  assertInOrder(source, ["if (body.restore !== undefined) return await restoreStatus(body);", "parseRequiredText(body.status"], "POST 分派");
  const restore = source.slice(source.indexOf("async function restoreStatus("));
  assert.ok(restore.length > 0, "找到 restoreStatus");
  assertInOrder(restore, [
    "validateJobStatusRestore(body.restore)",
    "parseExpectedMtime(body.expectedMtime)",
    "if (expectedMtime === undefined)",
    "status: 400",
    "inStatusQueue(path, async () => {",
    "readNote(path)",
    "assertExpectedMtime(expectedMtime, note.stat.mtime)",
    "writeNote(path, content)",
    "readNoteOrNull(path)",
  ], "restoreStatus");
});

test("跟进路由在队列里、写入前用共用的 assertExpectedMtime，不自己拼比较", async () => {
  for (const [path, queue] of [["app/api/jobs/follow-up/route.ts", "inFollowUpQueue"]]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /import \{[^}]*\bassertExpectedMtime\b[^}]*\} from "@\/lib\/server\/api";/, `${path} 没有引入共用的 assertExpectedMtime`);
    assertInOrder(source, [
      "parseExpectedMtime(body.expectedMtime)",
      `${queue}(path, async () => {`,
      "readNote(path)",
      "assertExpectedMtime(expectedMtime, note.stat.mtime)",
      "writeNote(",
    ], path);
    assert.doesNotMatch(source, /expectedMtime !==? note\.stat\.mtime|note\.stat\.mtime !==? expectedMtime/, `${path} 自己拼了版本比较`);
  }
});

test("api.ts 转出的 assertExpectedMtime 就是 write-guards 的那一个（路由从 api 引，不能分叉成两份）", () => {
  assert.equal(api.assertExpectedMtime, guards.assertExpectedMtime);
  assert.equal(api.conflictError, guards.conflictError);
  assert.equal(api.assertSameOrigin, guards.assertSameOrigin);
});

test("parseExpectedMtime：缺席与空串视为未给；非负整数（含数字字符串）通过；其余一律 400", () => {
  for (const absent of [undefined, null, "", "   "]) assert.equal(api.parseExpectedMtime(absent), undefined, JSON.stringify(absent));
  assert.equal(api.parseExpectedMtime(0), 0);
  assert.equal(api.parseExpectedMtime(1_727_000_000_000), 1_727_000_000_000);
  assert.equal(api.parseExpectedMtime(" 456 "), 456);
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "abc", "12px", true, {}, []]) {
    assert.throws(() => api.parseExpectedMtime(bad), (error) => error.status === 400 && /expectedMtime/.test(error.message), String(bad));
  }
});

test("409 与撤销校验失败经 errorResponse 原样映射成状态码，前端据此区分「刷新重试」和「请求本身错了」", async () => {
  const conflict = api.errorResponse(guards.conflictError(), "更新应募状态失败");
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { ok: false, error: "笔记已被别处修改，版本不一致。请刷新后重试。" });
  let restoreError;
  try { validateJobStatusRestore({ rating: "9" }); } catch (error) { restoreError = error; }
  const rejected = api.errorResponse(restoreError, "更新应募状态失败");
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /撤销不能改动字段「rating」/);
});

const jsonRequest = (body, headers = {}) => new Request("http://localhost:3000/api/jobs/status", {
  method: "POST",
  headers: { "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
  body,
});

test("readJson：先验来源（403）再验 Content-Type（415），通过后才解析正文", async () => {
  assert.deepEqual(await api.readJson(jsonRequest(JSON.stringify({ path: "a.md", expectedMtime: 1 }))), { path: "a.md", expectedMtime: 1 });
  await assert.rejects(api.readJson(jsonRequest("{}", { "sec-fetch-site": "cross-site" })), (error) => error.status === 403);
  await assert.rejects(api.readJson(jsonRequest("{}", { "content-type": "text/plain" })), (error) => error.status === 415);
  // 跨站且类型也不对时报的是来源：不给跨站请求透露接口接受什么格式。
  await assert.rejects(api.readJson(jsonRequest("{}", { "sec-fetch-site": "cross-site", "content-type": "text/plain" })), (error) => error.status === 403);
});

test("正文不是合法 JSON 应该是 400（请求本身有问题），而不是 500", async () => {
  let error;
  try { await api.readJson(jsonRequest("{not json")); } catch (caught) { error = caught; }
  assert.ok(error, "非法 JSON 必须抛错");
  assert.equal(api.errorResponse(error).status, 400);
});
