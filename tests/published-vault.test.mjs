import assert from "node:assert/strict";
import test from "node:test";
import { createPublishedVaultReader } from "../lib/server/published-vault.ts";
import { publishedRequestResponse } from "../lib/server/published-access.ts";

const note = { path: "例.md", content: "# 内容", stat: { ctime: 1, mtime: 2, size: 10 }, tags: [], frontmatter: { type: "note" } };
const data = { schemaVersion: 2, publishedAt: "2026-01-01T00:00:00Z", scopes: { all: ["one.json"], jobs: [] }, chunks: { [note.path]: "one.json" } };

test("published reads use a single cloud snapshot with no local service", async () => {
  let calls = 0;
  const reader = createPublishedVaultReader(async () => { calls++; return data; }, async () => [note]);
  const [all, one] = await Promise.all([reader.readAll(), reader.readNote(note.path)]);
  assert.deepEqual(all, [note]);
  assert.deepEqual(one, note);
  assert.equal(calls, 1);
  assert.deepEqual(await reader.readAll("jobs"), []);
  await assert.rejects(reader.readNote("不存在.md"), /returned 404/);
});
test("failed or invalid snapshots retry rather than caching an empty result", async () => {
  let calls = 0;
  const reader = createPublishedVaultReader(async () => ++calls === 1 ? {} : data, async () => [note]);
  await assert.rejects(reader.readAll(), /格式无效/);
  assert.deepEqual(await reader.readAll(), [note]);
});
test("public visitors cannot write or generate through any API", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = publishedRequestResponse(new Request("https://example.com/api/review/deep", { method }), true);
    assert.equal(response.status, 403);
  }
  assert.equal(publishedRequestResponse(new Request("https://example.com/api/vault"), true), null);
  assert.equal(publishedRequestResponse(new Request("https://example.com/api/review/deep", { method: "POST" }), false), null);
  assert.match(await publishedRequestResponse(new Request("https://example.com/robots.txt"), true).text(), /Disallow: \//);
});
