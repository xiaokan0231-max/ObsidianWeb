import assert from "node:assert/strict";
import test from "node:test";
import { describeConnectionError } from "../lib/connection-error.ts";

test("连接错误按原因分档：凭证、连不上、其它", () => {
  assert.equal(describeConnectionError("Obsidian returned 401 for /vault/: Unauthorized").kind, "credentials");
  assert.equal(describeConnectionError("Obsidian returned 403 for /search/").kind, "credentials");
  assert.equal(describeConnectionError("OBSIDIAN_API_KEY is missing").kind, "credentials");
  assert.equal(describeConnectionError("fetch failed: connect ECONNREFUSED 127.0.0.1:27123").kind, "unreachable");
  assert.equal(describeConnectionError("TimeoutError: The operation was aborted due to timeout").kind, "unreachable");
  assert.equal(describeConnectionError("Unknown Obsidian error").kind, "other");
  const hint = describeConnectionError("connect ECONNREFUSED");
  assert.match(hint.title, /连不上/);
  assert.match(hint.hint, /Local REST API/);
  assert.match(describeConnectionError("401").hint, /npm run dev/, "凭证问题要指向带 Obsidian 的启动脚本");
});
