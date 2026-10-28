import assert from "node:assert/strict";
import test from "node:test";
import { handleFeedbackRequest } from "../lib/server/feedback-handler.ts";

class MemoryBucket {
  records = new Map();
  counter = 0;
  failMessageOnce = false;
  listCount = 0;
  async get(key) {
    const record = this.records.get(key);
    if (!record) return null;
    return { key, etag: record.etag, json: async () => JSON.parse(record.body), text: async () => record.body };
  }
  async put(key, body, options = {}) {
    if (this.failMessageOnce && key.includes("/messages/")) { this.failMessageOnce = false; throw new Error("temporary storage failure"); }
    const existing = this.records.get(key);
    if (options.onlyIf?.etagMatches && existing?.etag !== options.onlyIf.etagMatches) return null;
    if (options.onlyIf?.etagDoesNotMatch === "*" && existing) return null;
    const etag = `etag-${++this.counter}`;
    this.records.set(key, { body: String(body), etag });
    return { key, etag };
  }
  async list({ prefix, cursor } = {}) {
    this.listCount++;
    const entries = [...this.records.keys()].filter(key => key.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const next = start + 2;
    return { objects: entries.slice(start, next).map(key => ({ key })), truncated: next < entries.length, cursor: next < entries.length ? String(next) : undefined };
  }
}
const origin = "https://feedback.example";
const ownerKey = "test-owner-secret-with-at-least-32-characters";
const accessCode = "teacher-test-code";
const context = { pagePath: "/consultation?session=session-test", title: "株式会社テストの原稿", company: "株式会社テスト", sessionId: "session-test", blockId: "block-test", turnId: "turn-test", quote: "開発を担当しました。", revision: "revision-test" };
function fixture() {
  const bucket = new MemoryBucket();
  const env = { FEEDBACK_BUCKET: bucket, FEEDBACK_SESSION_SECRET: "test-signing-secret-with-at-least-32-characters", FEEDBACK_OWNER_SECRET: ownerKey, FEEDBACK_ACCESS_CODE: accessCode };
  async function call(path, options = {}) {
    const headers = new Headers(options.headers);
    if (options.cookie) headers.set("Cookie", options.cookie);
    if (options.owner) headers.set("Authorization", `Bearer ${ownerKey}`);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    const method = options.method ?? "GET";
    if (!["GET", "HEAD"].includes(method) && !headers.has("Origin")) headers.set("Origin", origin);
    const response = await handleFeedbackRequest(new Request(`${origin}/api/feedback/${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }), env);
    return { response, status: response.status, body: await response.json(), cookie: response.headers.get("Set-Cookie")?.split(";")[0] };
  }
  async function teacher(name = "テスト先生", code = accessCode) {
    const result = await call("session", { method: "POST", body: { name, code } });
    assert.equal(result.status, 200);
    return { ...result, identity: result.body.identity };
  }
  async function thread(cookie, id = crypto.randomUUID(), text = "この部分を詳しく説明できますか。", ctx = context) {
    const result = await call("threads", { cookie, method: "POST", body: { id, text, context: ctx } });
    return { ...result, id };
  }
  return { bucket, env, call, teacher, thread };
}

test("匿名は留言を読めず、共有コードで署名Cookieを発行し、名前から権限は昇格しない", async () => {
  const f = fixture();
  assert.equal((await f.call("threads")).status, 401);
  assert.deepEqual((await f.call("session")).body, { identity: null, configured: true });
  const login = await f.teacher("本人");
  assert.equal(login.identity.role, "teacher");
  assert.match(login.response.headers.get("Set-Cookie"), /HttpOnly; SameSite=Strict; Max-Age=2592000; Secure/);
  assert.equal((await f.call("settings", { cookie: login.cookie })).status, 403);
  assert.equal((await f.call("session", { cookie: `${login.cookie}changed` })).body.identity, null);
  assert.equal((await f.call("session", { owner: true })).body.identity.role, "owner");
  const ownerLogin = await f.call("session", { method: "POST", body: { ownerKey } });
  assert.equal(ownerLogin.body.identity.role, "owner");
  for (const result of [login, await f.call("threads"), await f.call("settings", { owner: true })]) assert.match(result.response.headers.get("Cache-Control"), /no-store/);
});

test("設定がない環境は閉じており、偽装Ownerヘッダーやクロスサイト操作を拒否する", async () => {
  const raw = new Request(`${origin}/api/feedback/threads`);
  assert.equal((await handleFeedbackRequest(raw, {})).status, 503);
  assert.deepEqual(await (await handleFeedbackRequest(new Request(`${origin}/api/feedback/session`), {})).json(), { identity: null, configured: false });
  const f = fixture();
  assert.equal((await f.call("threads", { headers: { "X-Feedback-Local-Owner": "true" } })).status, 401);
  const badOrigin = await f.call("session", { method: "POST", headers: { Origin: "https://other.example" }, body: { name: "テスト先生", code: accessCode } });
  assert.equal(badOrigin.status, 403);
  assert.equal((await f.call("threads", { owner: true, method: "POST", headers: { Origin: "https://other.example" }, body: { id: crypto.randomUUID(), text: "test", context } })).status, 403);
});

test("複数の先生が互いの提案を読み、並行返信と再送を一件ずつ保存する", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.teacher("テスト先生A"), f.teacher("テスト先生B")]);
  const id = crypto.randomUUID();
  const [first, retry] = await Promise.all([f.thread(a.cookie, id), f.thread(a.cookie, id)]);
  assert.equal(first.status, 201);
  assert.equal(retry.status, 201);
  const replies = Array.from({ length: 8 }, (_, index) => ({ id: crypto.randomUUID(), text: `補足${index}` }));
  const results = await Promise.all(replies.map(body => f.call(`threads/${id}/replies`, { cookie: b.cookie, method: "POST", body })));
  assert.ok(results.every(result => result.status === 201));
  await f.call(`threads/${id}/replies`, { cookie: b.cookie, method: "POST", body: replies[0] });
  const reloaded = await f.call(`threads/${id}`, { cookie: a.cookie });
  assert.equal(reloaded.body.thread.messages.length, 9);
  assert.equal(reloaded.body.thread.messages[0].id, id);
  assert.equal(reloaded.body.thread.messages[0].author.id, a.identity.id);
  assert.equal(reloaded.body.thread.messages[1].author.id, b.identity.id);
  assert.equal(reloaded.body.thread.unread, true);
  assert.ok(f.bucket.listCount > 4, "R2の複数ページを読む");
  assert.equal((await f.thread(b.cookie, id)).status, 409);
  assert.equal((await f.thread(a.cookie, id, "変更された本文")).status, 409);
});

test("保存途中の失敗を再送で回復し、Handlerを作り直しても留言は残る", async () => {
  const f = fixture();
  const teacher = await f.teacher();
  const id = crypto.randomUUID();
  f.bucket.failMessageOnce = true;
  assert.equal((await f.thread(teacher.cookie, id)).status, 503);
  assert.equal((await f.thread(teacher.cookie, id)).status, 201);
  const response = await handleFeedbackRequest(new Request(`${origin}/api/feedback/threads/${id}`, { headers: { Cookie: teacher.cookie } }), { ...f.env });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).thread.messages.length, 1);
});

test("表示したIDだけを既読にし、同時に増えた返信を取りこぼさない", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.teacher("テスト先生A"), f.teacher("テスト先生B")]);
  const created = await f.thread(a.cookie);
  const initialIds = created.body.thread.messages.map(message => message.id);
  const lateId = crypto.randomUUID();
  await f.call(`threads/${created.id}/replies`, { cookie: b.cookie, method: "POST", body: { id: lateId, text: "あとから届いた返信" } });
  assert.equal((await f.call(`threads/${created.id}/read`, { cookie: a.cookie, method: "POST", body: { messageId: initialIds.at(-1), messageIds: initialIds } })).status, 200);
  assert.equal((await f.call(`threads/${created.id}`, { cookie: a.cookie })).body.thread.unread, true);
  const all = (await f.call(`threads/${created.id}`, { cookie: a.cookie })).body.thread.messages.map(message => message.id);
  await Promise.all(all.map(messageId => f.call(`threads/${created.id}/read`, { cookie: a.cookie, method: "POST", body: { messageId } })));
  assert.equal((await f.call(`threads/${created.id}`, { cookie: a.cookie })).body.thread.unread, false);
  assert.equal((await f.call(`threads/${created.id}/read`, { cookie: a.cookie, method: "POST", body: { messageId: crypto.randomUUID() } })).status, 400);
});

test("本人のみが対応状態と非表示を管理し、非表示内容は先生の一覧と詳細から消える", async () => {
  const f = fixture();
  const teacher = await f.teacher();
  const created = await f.thread(teacher.cookie);
  const patch = { method: "PATCH", body: { state: "done", hidden: true } };
  assert.equal((await f.call(`threads/${created.id}`, { ...patch, cookie: teacher.cookie })).status, 403);
  assert.equal((await f.call(`threads/${created.id}`, { ...patch, owner: true })).body.thread.state, "done");
  assert.deepEqual((await f.call("threads", { cookie: teacher.cookie })).body.threads, []);
  assert.equal((await f.call(`threads/${created.id}`, { cookie: teacher.cookie })).status, 404);
  assert.equal((await f.call("threads", { owner: true })).body.threads.length, 1);
  await f.call(`threads/${created.id}`, { owner: true, method: "PATCH", body: { hidden: false } });
  assert.equal((await f.call(`threads/${created.id}`, { cookie: teacher.cookie })).status, 200);
});

test("アクセスコード変更は全先生の旧Cookieを無効にし、本人の会話を保持する", async () => {
  const f = fixture();
  const teacher = await f.teacher();
  await f.thread(teacher.cookie);
  assert.equal((await f.call("settings", { owner: true })).body.accessCode, accessCode);
  assert.equal((await f.call("settings", { owner: true, method: "PATCH", body: { accessCode: "new-teacher-code" } })).status, 200);
  assert.equal((await f.call("threads", { cookie: teacher.cookie })).status, 401);
  assert.equal((await f.call("session", { cookie: teacher.cookie })).body.identity, null);
  assert.equal((await f.call("session", { method: "POST", body: { name: "テスト先生", code: accessCode } })).status, 401);
  const refreshed = await f.teacher("テスト先生", "new-teacher-code");
  assert.equal((await f.call("threads", { cookie: refreshed.cookie })).body.threads.length, 1);
  assert.equal((await f.call("threads", { owner: true })).body.threads.length, 1);
});

test("不正な資料URLや引用範囲を拒否し、文字と引用はデータとして保存する", async () => {
  const f = fixture();
  const teacher = await f.teacher();
  for (const pagePath of ["https://evil.example/", "//evil.example", "/%2e%2e/private", "/a/../private", "/api/vault", "/consultation?ownerKey=secret", "/a\\evil"]) {
    assert.equal((await f.thread(teacher.cookie, crypto.randomUUID(), "comment", { ...context, pagePath })).status, 400, pagePath);
  }
  assert.equal((await f.thread(teacher.cookie, crypto.randomUUID(), "comment", { ...context, quoteStart: 0, quoteEnd: 1 })).status, 400);
  const quote = " 開発を担当しました。 ";
  const created = await f.thread(teacher.cookie, crypto.randomUUID(), "<script>test</script>", { ...context, quote, quoteStart: 2, quoteEnd: 2 + quote.length });
  assert.equal(created.status, 201);
  assert.equal(created.body.thread.context.quote, quote);
  assert.equal(created.body.thread.messages[0].text, "<script>test</script>");
});

test("コード入力の試行制限はHandlerやリクエストをまたいで保持される", async () => {
  const f = fixture();
  for (let index = 0; index < 20; index++) assert.equal((await f.call("session", { method: "POST", body: { name: "テスト先生", code: "wrong" } })).status, 401);
  assert.equal((await f.call("session", { method: "POST", body: { name: "テスト先生", code: accessCode } })).status, 429);
  assert.equal((await f.call("session", { method: "POST", headers: { "CF-Connecting-IP": "192.0.2.1" }, body: { name: "テスト先生", code: accessCode } })).status, 200);
});
