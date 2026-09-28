import assert from "node:assert/strict";
import test from "node:test";
import { ClientApiError, ConflictError, postJson } from "../lib/client-api.ts";

const fake = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("postJson：ok 与 payload.ok 都要真；409 是 ConflictError；坏 JSON 也报错而不是吞掉", async () => {
  assert.deepEqual(await postJson("/x", {}, { fetcher: fake(200, { ok: true, note: 1 }) }), { ok: true, note: 1 });
  await assert.rejects(postJson("/x", {}, { fetcher: fake(200, { ok: false, error: "写入失败" }) }), (error) => error instanceof ClientApiError && error.message === "写入失败" && error.status === 200);
  await assert.rejects(postJson("/x", {}, { fetcher: fake(409, { ok: false, error: "版本不一致" }) }), (error) => error instanceof ConflictError && error.status === 409);
  await assert.rejects(postJson("/x", {}, { fetcher: fake(500, { error: "boom" }) }), (error) => error instanceof ClientApiError && error.status === 500 && error.message === "boom");
  await assert.rejects(postJson("/x", {}, { fetcher: async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad"); } }) }), /无法解析/);
});

test("postJson 发出的请求带 JSON 头、no-store 与超时信号", async () => {
  let seen;
  await postJson("/api/test", { a: 1 }, { fetcher: async (path, init) => { seen = { path, init }; return { ok: true, status: 200, json: async () => ({ ok: true }) }; } });
  assert.equal(seen.path, "/api/test");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["Content-Type"], "application/json");
  assert.equal(seen.init.body, '{"a":1}');
  assert.equal(seen.init.cache, "no-store");
  assert.ok(seen.init.signal instanceof AbortSignal);
});
