import assert from "node:assert/strict";
import test from "node:test";
import yaml from "js-yaml";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { buildUserActions } from "../lib/user-actions.ts";

const TODAY = "2026-10-05";
const TODO_PATH = "20_求職/_TODO/テスト_日程回答.md";
const CASE_PATH = "20_求職/テスト/案件.md";
const BODY = "# 株式会社テスト\n\n原始通知はここに保存する。\n\n- [ ] 正文のチェック欄は自動変更しない\n";
function note(path, fields, body = BODY, mtime = 100) {
  const content = `---\n${yaml.dump(fields, { lineWidth: -1 })}---\n${body}`;
  return { path, frontmatter: structuredClone(fields), content, tags: [], stat: { mtime, ctime: 90, size: content.length } };
}
function todo(fields = {}, path = TODO_PATH) {
  return note(path, { type: "todo", status: "未着手", audience: "user", action_owner: "user", action_kind: "required",
    action_reviewed_at: TODAY, action_reason: "本人の都合を確認する必要がある", action_source: "https://example.com/messages/1",
    action: "確実に参加できる日時を回答する", action_next_owner: "company", case_id: "test-case", due: "2026-10-06",
    focus: true, focus_until: "2026-10-06", custom_field: "元の値", ...fields });
}
function job(fields = {}, path = CASE_PATH) {
  return note(path, { type: "job-case", case_id: "test-case", company: "株式会社テスト", status: "面接中", ...fields });
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function memoryVault(initial = [todo(), job()]) {
  const notes = new Map(initial.map((entry) => [entry.path, structuredClone(entry)]));
  const reads = [], writes = [], allReads = [];
  let clock = 100;
  let gate = null;
  let transform = null;
  let writeFailure = false;
  const io = {
    async readNote(path) {
      reads.push(path);
      const snapshot = structuredClone(notes.get(path));
      if (gate?.path === path) {
        const current = gate; gate = null; current.entered.resolve(); await current.released.promise;
      }
      if (!snapshot) throw new Error("Obsidian returned 404");
      return snapshot;
    },
    async readNoteOrNull(path) {
      reads.push(path);
      return structuredClone(notes.get(path) ?? null);
    },
    async readAllNotes(options) {
      allReads.push(options);
      return structuredClone([...notes.values()]);
    },
    async writeNote(path, content) {
      if (writeFailure) { writeFailure = false; throw new Error("test write failure"); }
      const fm = yaml.load(content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "", { schema: yaml.JSON_SCHEMA });
      let saved = { ...notes.get(path), path, content, frontmatter: fm, stat: { ctime: 90, mtime: ++clock, size: content.length } };
      if (transform) saved = transform(saved, structuredClone(notes.get(path)));
      if (saved === null) notes.delete(path);
      else notes.set(path, saved);
      writes.push({ path, content });
    },
  };
  return { notes, reads, writes, allReads, io,
    pauseRead(path) { gate = { path, entered: deferred(), released: deferred() }; return gate; },
    transformWrite(fn) { transform = fn; }, failNextWrite() { writeFailure = true; } };
}
function request(overrides = {}, options = {}) {
  return new Request("http://localhost:3000/api/todos/status", { method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...options.headers },
    body: options.rawBody ?? JSON.stringify({ path: TODO_PATH, expectedMtime: 100, resolution: "completed", resolutionNote: "回答を送信済み", ...overrides }) });
}
async function routes(vault) {
  const stubs = { "@/lib/server/obsidian": vault.io, "@/lib/dojo/utils": { tokyoParts: () => ({ date: TODAY, time: "09:00:00" }) } };
  return loadAppModule("app/api/todos/status/route.ts", { stubs });
}

test("完成写入真实回读版本，保留正文/案件/非白名单字段并清除置顶", async () => {
  const vault = memoryVault();
  const beforeCase = structuredClone(vault.notes.get(CASE_PATH));
  const { POST } = await routes(vault);
  const response = await POST(request({ status: "不採用", case_id: "injected", action: "injected", resolutionNote: '本人確認: "送付済み" # 記録' }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  const saved = vault.notes.get(TODO_PATH);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.note, saved);
  assert.equal(saved.frontmatter.status, "完了");
  assert.equal(saved.frontmatter.action_resolution, "completed");
  assert.equal(saved.frontmatter.action_resolved_at, TODAY);
  assert.equal(saved.frontmatter.updated, TODAY);
  assert.equal(saved.frontmatter.action_resolution_note, '本人確認: "送付済み" # 記録');
  assert.equal(saved.frontmatter.focus, undefined);
  assert.equal(saved.frontmatter.focus_until, undefined);
  assert.equal(saved.frontmatter.action_kind, "required");
  assert.equal(saved.frontmatter.case_id, "test-case");
  assert.equal(saved.frontmatter.custom_field, "元の値");
  assert.ok(saved.content.endsWith(BODY));
  assert.deepEqual(vault.notes.get(CASE_PATH), beforeCase);
  assert.deepEqual(vault.writes.map((entry) => entry.path), [TODO_PATH]);
  assert.equal(saved.stat.mtime, 101);
});

test("取消保留任务并记history和理由，不能伪标完了", async () => {
  const vault = memoryVault(); const { POST } = await routes(vault);
  const response = await POST(request({ resolution: "cancelled", resolutionNote: "依頼が取り消されたため対応不要" }));
  assert.equal(response.status, 200);
  const saved = (await response.json()).note;
  assert.equal(saved.frontmatter.status, "保留");
  assert.equal(saved.frontmatter.action_kind, "history");
  assert.equal(saved.frontmatter.action_resolution, "cancelled");
  assert.equal(buildUserActions([...vault.notes.values()], TODAY).history.length, 1);
  assert.ok(saved.content.endsWith(BODY));
});

test("同源与JSON入口校验在读取Vault前拒绝", async () => {
  const vault = memoryVault(); const { POST } = await routes(vault);
  for (const [options, status] of [
    [{ headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://example.com" } }, 403],
    [{ headers: { "Sec-Fetch-Site": "", Origin: "https://example.com" } }, 403],
    [{ headers: { "Content-Type": "text/plain" } }, 415],
    [{ rawBody: "{not-json" }, 400],
  ]) assert.equal((await POST(request({}, options))).status, status);
  assert.equal(vault.reads.length, 0); assert.equal(vault.allReads.length, 0); assert.equal(vault.writes.length, 0);
});

test("JSON null或非对象不能变成内部错误", async () => {
  const vault = memoryVault(); const { POST } = await routes(vault);
  for (const rawBody of ["null", "[]", '"plain text"', "123"]) {
    assert.equal((await POST(request({}, { rawBody }))).status, 400, rawBody);
  }
  assert.equal(vault.reads.length, 0); assert.equal(vault.writes.length, 0);
});

test("路径、处理结果、说明及版本非法时不写入", async () => {
  const vault = memoryVault(); const { POST } = await routes(vault);
  for (const path of ["../秘密.md", "/20_求職/待办.md", "10_资料/待办.md", "20_求職/../待办.md", "20_求職/待办.txt", "20_求職/a\\b.md", "20_求職/a\nb.md"]) {
    assert.equal((await POST(request({ path }))).status, 400, path);
  }
  for (const fields of [{ resolution: "read" }, { resolutionNote: "  " }, { resolutionNote: 1 },
    { resolutionNote: "a\nb" }, { resolutionNote: "あ".repeat(501) }, { expectedMtime: undefined },
    { expectedMtime: null }, { expectedMtime: -1 }, { expectedMtime: 1.5 }, { expectedMtime: "bad" }, { path: [] }]) {
    assert.equal((await POST(request(fields))).status, 400, JSON.stringify(fields));
  }
  assert.equal(vault.reads.length, 0); assert.equal(vault.writes.length, 0);
});

test("错误笔记类型和过期版本不会触发写入", async () => {
  for (const [initial, fields, expected] of [
    [[todo({ type: "job-case" }), job()], {}, 400],
    [[todo(), job()], { expectedMtime: 99 }, 409],
  ]) {
    const vault = memoryVault(initial); const { POST } = await routes(vault);
    assert.equal((await POST(request(fields))).status, expected);
    assert.equal(vault.writes.length, 0);
  }
});

test("缺审核、等待、可选、系统、失效、终态或失效关联均不能确认完成", async () => {
  const variants = [
    [todo({ action_reviewed_at: undefined }), job()], [todo({ action_kind: "waiting" }), job()],
    [todo({ action_kind: "optional" }), job()], [todo({ action_kind: "reference" }), job()],
    [todo({ action_owner: "ai" }), job()], [todo({ audience: "system" }), job()],
    [todo({ status: "完了" }), job()], [todo({ expires_at: "2026-10-04", due: undefined, focus: false }), job()],
    [todo(), job({ status: "不採用" })], [todo(), job({ status: "保留" })],
    [todo()], [todo(), job(), job({}, "20_求職/テスト/重複.md")],
  ];
  for (const initial of variants) {
    const vault = memoryVault(initial); const { POST } = await routes(vault);
    assert.equal((await POST(request())).status, 400, JSON.stringify(initial[0].frontmatter));
    assert.equal(vault.writes.length, 0);
  }
});

test("同一待办并发请求串行，第二个旧版本返回409且不覆盖处理结果", { timeout: 5000 }, async () => {
  const vault = memoryVault(); const { POST } = await routes(vault);
  const gate = vault.pauseRead(TODO_PATH);
  const first = POST(request()); await gate.entered.promise;
  const second = POST(request({ resolution: "cancelled", resolutionNote: "不要" }));
  try { await new Promise((done) => setImmediate(done)); assert.equal(vault.reads.length, 1); }
  finally { gate.released.resolve(); }
  assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [200, 409]);
  assert.equal(vault.writes.length, 1);
  assert.equal(vault.notes.get(TODO_PATH).frontmatter.action_resolution, "completed");
});

test("写失败会释放队列且不宣称完成", async () => {
  const vault = memoryVault(); const { POST } = await routes(vault); vault.failNextWrite();
  const failed = await POST(request()); assert.equal(failed.status, 500); assert.equal((await failed.json()).ok, false);
  assert.equal(vault.notes.get(TODO_PATH).frontmatter.status, "未着手");
  assert.equal((await POST(request())).status, 200);
});

test("写后回读缺失或关键字段不一致必须失败，不能仅看到部分成功就报ok", async () => {
  for (const mismatch of ["missing", "status", "action_resolution", "action_resolution_note", "action_kind", "action_resolved_at", "updated", "focus", "focus_until"]) {
    const vault = memoryVault(); const { POST } = await routes(vault);
    vault.transformWrite((saved, previous) => {
      if (mismatch === "missing") return null;
      if (Object.hasOwn(previous.frontmatter, mismatch)) saved.frontmatter[mismatch] = previous.frontmatter[mismatch];
      else delete saved.frontmatter[mismatch];
      return saved;
    });
    const response = await POST(request({ resolution: "cancelled", resolutionNote: "依頼取消" }));
    assert.equal(response.status, 500, mismatch);
    assert.equal((await response.json()).ok, false, mismatch);
  }
});

test("GET读取Vault与纯分类不会调用POST或完成任务", async () => {
  const vault = memoryVault(); const before = structuredClone([...vault.notes.values()]);
  const writes = await routes(vault);
  assert.equal(writes.GET, undefined, "状态端点只导出显式POST");
  let postCalls = 0;
  const readRoute = await loadAppModule("app/api/vault/route.ts", { stubs: {
    "@/lib/server/obsidian": vault.io,
    "@/app/api/todos/status/route": { POST() { postCalls += 1; throw new Error("GET must not call POST"); } },
  } });
  const response = await readRoute.GET(new Request("http://localhost:3000/api/vault?scope=jobs&refresh=1"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  buildUserActions(payload.notes, TODAY);
  assert.equal(postCalls, 0); assert.equal(vault.writes.length, 0);
  assert.deepEqual([...vault.notes.values()], before);
});
