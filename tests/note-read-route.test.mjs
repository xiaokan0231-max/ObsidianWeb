import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";

test("精确来源链接只读取一篇，配置、控制文件和越界路径不进入 Obsidian 接口", async () => {
  const calls = [];
  const note = { path: "資料/原文.md", content: "# 原文\n完整内容", frontmatter: { type: "note" },
    tags: [], stat: { ctime: 1, mtime: 2, size: 20 } };
  const { GET } = await loadAppModule("app/api/note/route.ts", { stubs: {
    "@/lib/server/obsidian": {
      async readNote(path) { calls.push(path); return note; },
      isMissingNoteError() { return false; },
    },
  } });
  const request = (path) => new Request(`https://example.com/api/note?${new URLSearchParams({ path })}`);
  const response = await GET(request(note.path));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { note });
  for (const path of ["", "../秘密.md", "/資料/原文.md", "資料/../原文.md", ".obsidian/config.md", "AGENTS.md", "資料\\原文.md", "資料/画像.png"]) {
    assert.equal((await GET(request(path))).status, 400, path);
  }
  assert.deepEqual(calls, [note.path]);
});

test("单篇来源不存在与连接故障分别报告，不能当作空笔记成功", async () => {
  let missing = true;
  const { GET } = await loadAppModule("app/api/note/route.ts", { stubs: {
    "@/lib/server/obsidian": {
      async readNote() { throw new Error("read failed"); },
      isMissingNoteError() { return missing; },
    },
  } });
  const request = new Request("https://example.com/api/note?path=missing.md");
  assert.equal((await GET(request)).status, 404);
  missing = false;
  assert.equal((await GET(request)).status, 503);
});
