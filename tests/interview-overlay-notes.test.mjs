import assert from "node:assert/strict";
import test from "node:test";
import { createInterviewOverlayNotesResource } from "../app/use-interview-overlay-notes.ts";

const note = (path, body = "完整回答正文") => ({ path, content: `# 架空素材\n\n${body}`, frontmatter: { type: "interview-prep-library" }, tags: [], stat: { ctime: 0, mtime: 0, size: body.length } });
const libraryPath = "20_求職/共用/标准回答.md";
const assetPath = "10_关于我/共用/素材.md";
const catalog = { libraryPaths: [libraryPath] };
const asset = { note: "素材", label: "素材", hint: "共用素材" };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("关闭浮层不加载正文；打开回答卡才按目录精确路径及版本读取，重开复用完整缓存", async () => {
  const urls = [];
  const resource = createInterviewOverlayNotesResource(async (url) => { urls.push(new URL(url, "https://example.test")); return Response.json({ note: note(libraryPath) }); });
  await resource.query({ catalog, revision: "r1" });
  assert.equal(urls.length, 0);
  await resource.query({ cardId: "story", catalog, revision: "r1" });
  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, "/api/note");
  assert.equal(urls[0].searchParams.get("path"), libraryPath);
  assert.equal(urls[0].searchParams.get("revision"), "r1");
  assert.match(resource.getState().notes[0].content, /完整回答正文/);
  await resource.query({ revision: "r1" });
  await resource.query({ cardId: "other-card", catalog, revision: "r1" });
  assert.equal(urls.length, 1);
  assert.equal(resource.getState().notes[0].path, libraryPath);
});

test("共用素材先查询同版关系索引再读取完整正文，已嵌入的完整来源只复用正文", async () => {
  const urls = [];
  const seeded = note(assetPath, "已经按需读取的完整嵌入正文");
  const resource = createInterviewOverlayNotesResource(async (url) => {
    const parsed = new URL(url, "https://example.test"); urls.push(parsed);
    if (parsed.pathname === "/api/read-model/resolve") return Response.json({ revision: "r1", kind: "resolved", path: assetPath, section: null });
    return Response.json({ note: note(assetPath) });
  });
  await resource.query({ asset, revision: "r1", seed: [seeded] });
  assert.equal(urls.length, 1);
  assert.equal(urls[0].searchParams.get("revision"), "r1");
  assert.equal(urls[0].searchParams.get("target"), "素材");
  assert.equal(resource.getState().sharedNote, seeded);
  await resource.query({ revision: "r1" });
  await resource.query({ asset, revision: "r1" });
  assert.equal(urls.length, 1, "同版解析和完整来源都缓存");
  const fresh = createInterviewOverlayNotesResource(async (url) => {
    const parsed = new URL(url, "https://example.test"); urls.push(parsed);
    return Response.json(parsed.pathname === "/api/read-model/resolve" ? { revision: "r2", kind: "resolved", path: assetPath, section: null } : { note: note(assetPath, "另一个资料版本") });
  });
  await fresh.query({ asset, revision: "r2" });
  assert.equal(urls.at(-1).pathname, "/api/note");
  assert.equal(urls.at(-1).searchParams.get("path"), assetPath);
  assert.equal(urls.at(-1).searchParams.get("revision"), "r2");
  assert.ok(urls.every((url) => ["/api/note", "/api/read-model/resolve"].includes(url.pathname)), "不得请求all或interview范围");
});

test("素材重名、缺失或版本过期都明确失败，不能猜来源或回退整库", async () => {
  for (const kind of ["ambiguous", "missing", "expired", "different-version"]) {
    const urls = [];
    const resource = createInterviewOverlayNotesResource(async (url) => {
      urls.push(url);
      return kind === "expired" ? Response.json({ error: "资料版本已过期" }, { status: 409 }) : Response.json({ revision: kind === "different-version" ? "r2" : "r1", kind: kind === "different-version" ? "resolved" : kind, path: assetPath });
    });
    await resource.query({ asset, revision: "r1" });
    assert.equal(resource.getState().sharedNote, null);
    assert.ok(resource.getState().error);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].startsWith("/api/read-model/resolve?"));
  }
});

test("切换、关闭及销毁后的迟到正文不能覆盖当前素材，资料版本之间不复用正文", async () => {
  const late = deferred();
  const urls = [];
  const resource = createInterviewOverlayNotesResource(async (url) => {
    const parsed = new URL(url, "https://example.test"); urls.push(parsed);
    return parsed.searchParams.get("revision") === "r1" ? late.promise : Response.json({ note: note(libraryPath, "新版本全文") });
  });
  const old = resource.query({ cardId: "story", catalog, revision: "r1" });
  await resource.query({ cardId: "story", catalog, revision: "r2" });
  late.resolve(Response.json({ note: note(libraryPath, "迟到旧版") })); await old;
  assert.match(resource.getState().notes[0].content, /新版本全文/);
  assert.equal(urls.length, 2);
  const pending = deferred();
  const closed = createInterviewOverlayNotesResource(() => pending.promise);
  const loading = closed.query({ cardId: "story", catalog, revision: "r1" });
  await closed.query({});
  closed.dispose();
  pending.resolve(Response.json({ note: note(libraryPath) })); await loading;
  assert.deepEqual(closed.getState().notes, []);
  assert.equal(closed.getState().loading, false);
});

test("目录和版本未就绪时等待；同一目标完成后冻结，错误可显式重试", async () => {
  let calls = 0;
  const resource = createInterviewOverlayNotesResource(async () => ++calls === 1 ? Response.json({ error: "暂不可用" }, { status: 503 }) : Response.json({ note: note(libraryPath) }));
  await resource.query({ cardId: "story" });
  assert.equal(calls, 0);
  assert.equal(resource.getState().loading, true);
  const input = { cardId: "story", catalog, revision: "r1" };
  await resource.query(input);
  assert.ok(resource.getState().error);
  await resource.retry();
  assert.equal(resource.getState().error, "");
  await resource.query({ ...input, seed: [] });
  assert.equal(calls, 2);
});
