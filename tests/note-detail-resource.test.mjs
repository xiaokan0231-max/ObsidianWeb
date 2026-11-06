import assert from "node:assert/strict";
import test from "node:test";
import { readNoteDetail } from "../app/note-detail-resource.ts";

const path = "20_求職/株式会社テスト.md";
const note = { path, content: "# 测试笔记" };

test("单篇正文读取失败后，重试同一路径和版本", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const fetcher = async (url, init) => {
    calls.push(url);
    assert.equal(init.signal, signal);
    return calls.length === 1 ? Response.json({ error: "测试正文不可用" }, { status: 404 }) : Response.json({ note });
  };
  await assert.rejects(readNoteDetail(path, "r1", signal, fetcher), /测试正文不可用/);
  assert.deepEqual(await readNoteDetail(path, "r1", signal, fetcher), { note, revision: "r1" });
  assert.deepEqual(calls, Array(2).fill(`/api/note?${new URLSearchParams({ path, revision: "r1" })}`));
});

test("旧正文 409 仅重定位一次，全部步骤共享取消信号", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const fetcher = async (url, init) => {
    const parsed = new URL(url, "https://example.test");
    calls.push(parsed);
    assert.equal(init.signal, signal);
    if (parsed.pathname.endsWith("/resolve")) return Response.json({ kind: "resolved", revision: "r2", path });
    if (parsed.searchParams.get("revision") === "r1") return Response.json({ error: "旧版已过期" }, { status: 409 });
    return Response.json({ note });
  };
  assert.deepEqual(await readNoteDetail(path, "r1", signal, fetcher), { note, revision: "r2" });
  assert.deepEqual(calls.map(({ pathname }) => pathname), ["/api/note", "/api/read-model/resolve", "/api/note"]);
  assert.equal(calls[2].searchParams.get("path"), path);
  assert.equal(calls[2].searchParams.get("revision"), "r2");
});
