import assert from "node:assert/strict";
import test from "node:test";
import { invokeCodex } from "../lib/server/codex-bridge.ts";

test("bridge client preserves task errors and identifies transport failures", async (t) => {
  const previousToken = process.env.CODEX_BRIDGE_TOKEN;
  process.env.CODEX_BRIDGE_TOKEN = "client-test-token-longer-than-24-characters";
  t.after(() => {
    if (previousToken === undefined) delete process.env.CODEX_BRIDGE_TOKEN;
    else process.env.CODEX_BRIDGE_TOKEN = previousToken;
  });

  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ error: "spawn codex ENOENT" }),
    { status: 502, headers: { "Content-Type": "application/json" } },
  ));
  await assert.rejects(invokeCodex("grade_language_exam", { items: [] }), {
    message: "spawn codex ENOENT",
  });

  fetchMock.mock.mockImplementation(async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(invokeCodex("grade_language_exam", { items: [] }), /无法连接本地 Codex Bridge/);

  delete process.env.CODEX_BRIDGE_TOKEN;
  await assert.rejects(invokeCodex("grade_language_exam", { items: [] }), /本地 Codex Bridge 未配置/);
  assert.equal(fetchMock.mock.callCount(), 2);
});
