import assert from "node:assert/strict";
import test from "node:test";
import { handleFeedbackRequest } from "../lib/server/feedback-handler.ts";
import { createThread, reply, changeThread, markRead, listSummaries, unreadSummary, getThread } from "../lib/server/feedback-store.ts";
import { MemoryFeedbackBucket } from "./helpers/feedback-bucket.mjs";

const owner = { id: "owner", name: "本人", role: "owner" };
const teacher = { id: "teacher-test", name: "テスト先生", role: "teacher" };
const context = { pagePath: "/consultation", title: "テスト原稿", company: "株式会社テスト", sessionId: "session-test", quote: "引用".repeat(100), revision: "test-revision", quoteStart: 0, quoteEnd: 200 };
const params = values => new URLSearchParams(values);
const pendingKeys = bucket => [...bucket.records.keys()].filter(key => key.startsWith("feedback/v2/pending/"));

async function seedLegacy(bucket, count = 3) {
  for (let index = 0; index < count; index++) {
    const id = `thread-${String(index).padStart(4, "0")}`;
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
    await bucket.put(`feedback/v1/threads/${id}.json`, JSON.stringify({ id, context, createdAt, createdBy: teacher, state: "open", hidden: false }));
    for (let message = 0; message < 5; message++) {
      const mid = message ? `message-${index}-${message}` : id;
      await bucket.put(`feedback/v1/messages/${id}/${mid}.json`, JSON.stringify({ id: mid, threadId: id, author: teacher, text: "本文".repeat(100) + (message === 4 ? "全文検索の後半" : ""), createdAt }));
    }
  }
}

test("旧形式を一度移行し、100件の信箱でも通常の未読確認は本文を読まず3操作", async () => {
  const bucket = new MemoryFeedbackBucket();
  await seedLegacy(bucket, 100);
  await bucket.put("feedback/v1/reads/owner/thread-0000.json", JSON.stringify({ ids: ["thread-0000", ...[1, 2, 3, 4].map(n => `message-0-${n}`)] }));
  const first = await listSummaries(bucket, owner, params({}));
  assert.equal(first.items.length, 25);
  assert.equal(first.total, 100);
  assert.equal(first.items[0].preview.length, 100);
  assert.equal(first.items[0].context.quote.length, 65);
  assert.equal(first.items[0].messageCount, 5);
  assert.ok(!JSON.stringify(first).includes("全文検索の後半"));
  const before = { gets: bucket.gets, lists: bucket.lists, puts: bucket.puts };
  bucket.fail = (operation, key) => { if (operation === "get" && /feedback\/v1\/(threads|messages|reads)\//u.test(key)) throw new Error("must not read canonical contents"); };
  const unread = await unreadSummary(bucket, owner);
  assert.equal(unread.unreadThreads, 99);
  assert.equal(bucket.gets - before.gets, 2);
  assert.equal(bucket.lists - before.lists, 1);
  assert.equal(bucket.puts - before.puts, 0);
});

test("摘要稳定分页、身份与条件绑定、版本变化重开第一页、显式全文搜索保留后半正文命中", async () => {
  const bucket = new MemoryFeedbackBucket();
  await seedLegacy(bucket, 4);
  const first = await listSummaries(bucket, owner, params({ limit: "2" }));
  const second = await listSummaries(bucket, owner, params({ limit: "2", cursor: first.nextCursor }));
  assert.deepEqual([...first.items, ...second.items].map(item => item.id), ["thread-0003", "thread-0002", "thread-0001", "thread-0000"]);
  assert.equal(second.nextCursor, null);
  await assert.rejects(listSummaries(bucket, teacher, params({ limit: "2", cursor: first.nextCursor })), error => error.status === 400);
  await assert.rejects(listSummaries(bucket, owner, params({ limit: "2", filter: "open", cursor: first.nextCursor })), error => error.status === 400);
  assert.equal((await listSummaries(bucket, owner, params({ q: "全文検索の後半" }))).total, 4);
  await reply(bucket, teacher, "thread-0000", { id: "new-reply-test", text: "追加の返信" });
  await assert.rejects(listSummaries(bucket, owner, params({ limit: "2", cursor: first.nextCursor })), error => error.status === 409);
  await changeThread(bucket, owner, "thread-0000", { hidden: true });
  assert.equal((await listSummaries(bucket, teacher, params({ filter: "hidden" }))).total, 0);
  assert.equal((await listSummaries(bucket, owner, params({ filter: "hidden" }))).total, 1);
});

test("消息、提交元数据、摘要或清理日志的部分失败均可由下次读取恢复且不重复", async () => {
  for (const stage of ["message", "meta", "index", "cleanup"]) {
    const bucket = new MemoryFeedbackBucket();
    await listSummaries(bucket, owner, params({}));
    let failed = false;
    bucket.fail = (operation, key) => {
      const hit = stage === "message" && operation === "put" && key.includes("/messages/")
        || stage === "meta" && operation === "put" && key.includes("/threads/")
        || stage === "index" && operation === "put" && key.endsWith("summary-index.json")
        || stage === "cleanup" && operation === "delete" && key.includes("/pending/");
      if (hit && !failed) { failed = true; throw new Error("synthetic interrupted write"); }
    };
    await assert.rejects(createThread(bucket, teacher, { id: "thread-recovery", text: "復元する本文", context }));
    assert.equal(pendingKeys(bucket).length, 1, stage);
    bucket.fail = null;
    const restored = await listSummaries(bucket, owner, params({}));
    assert.equal(restored.total, 1, stage);
    assert.equal(restored.items[0].messageCount, 1, stage);
    assert.equal(pendingKeys(bucket).length, 0, stage);
    await createThread(bucket, teacher, { id: "thread-recovery", text: "復元する本文", context });
    assert.equal((await getThread(bucket, "thread-recovery", owner)).messages.length, 1, stage);
  }
});

test("并发回复和旧状态日志重放不覆盖较新版本，读取记录失败后恢复仍保留新增未读", async () => {
  const bucket = new MemoryFeedbackBucket();
  await createThread(bucket, teacher, { id: "thread-concurrent", text: "最初の本文", context });
  await Promise.all(Array.from({ length: 8 }, (_, index) => reply(bucket, teacher, "thread-concurrent", { id: `reply-test-${index}`, text: `補足${index}` })));
  assert.equal((await listSummaries(bucket, owner, params({}))).items[0].messageCount, 9);
  let oldJournal;
  bucket.fail = (operation, key) => { if (operation === "delete" && key.includes("/pending/change-")) oldJournal = [key, bucket.records.get(key).body]; };
  await changeThread(bucket, owner, "thread-concurrent", { state: "working", operationId: "operation-old" });
  bucket.fail = null;
  await changeThread(bucket, owner, "thread-concurrent", { state: "done", operationId: "operation-new" });
  await bucket.put(oldJournal[0], oldJournal[1]);
  assert.equal((await listSummaries(bucket, owner, params({}))).items[0].state, "done");
  const displayed = (await getThread(bucket, "thread-concurrent", owner)).messages.map(item => item.id);
  await unreadSummary(bucket, owner);
  let failed = false;
  bucket.fail = (operation, key) => { if (!failed && operation === "put" && key.includes("/read-summary/")) { failed = true; throw new Error("synthetic read projection failure"); } };
  await assert.rejects(markRead(bucket, owner, "thread-concurrent", { messageIds: displayed }));
  bucket.fail = null;
  await reply(bucket, teacher, "thread-concurrent", { id: "late-message-test", text: "後からの返信" });
  assert.equal((await unreadSummary(bucket, owner)).unreadThreads, 1);
  assert.equal(pendingKeys(bucket).length, 0);
});

test("未读接口ETag返回304且认证先于条件响应，存储异常明确503可重试", async () => {
  const bucket = new MemoryFeedbackBucket();
  const env = { FEEDBACK_BUCKET: bucket, FEEDBACK_OWNER_SECRET: "test-owner-secret-with-at-least-32-characters", FEEDBACK_SESSION_SECRET: "test-session-secret-with-at-least-32-characters", FEEDBACK_ACCESS_CODE: "test-access-code" };
  const request = (extra = {}) => new Request("https://test.example/api/feedback/unread", { headers: { Authorization: `Bearer ${env.FEEDBACK_OWNER_SECRET}`, ...extra } });
  const first = await handleFeedbackRequest(request(), env);
  assert.equal(first.status, 200);
  const etag = first.headers.get("ETag");
  const before = bucket.gets + bucket.lists;
  const unchanged = await handleFeedbackRequest(request({ "If-None-Match": etag }), env);
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  assert.equal(bucket.gets + bucket.lists - before, 4, "包含一次运行时鉴权配置读取");
  assert.equal((await handleFeedbackRequest(request({ Authorization: "Bearer wrong", "If-None-Match": etag }), env)).status, 401);
  bucket.fail = () => { throw new Error("synthetic outage"); };
  const unavailable = await handleFeedbackRequest(request(), env);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("Retry-After"), "3");
});

test("首次迁移与新写入并发时保留最新摘要，复用旧版正本后可清空派生层重建", async () => {
  const bucket = new MemoryFeedbackBucket();
  await seedLegacy(bucket, 8);
  await Promise.all([
    ...Array.from({ length: 4 }, () => listSummaries(bucket, owner, params({}))),
    reply(bucket, teacher, "thread-0000", { id: "migration-reply", text: "移行中に届いた返信" }),
    createThread(bucket, teacher, { id: "migration-created", text: "移行中に作った相談", context }),
  ]);
  const migrated = await listSummaries(bucket, owner, params({}));
  assert.equal(migrated.total, 9);
  assert.equal(migrated.items.find(item => item.id === "thread-0000").messageCount, 6);
  assert.equal(pendingKeys(bucket).length, 0);
  // 模拟临时回退旧服务写入：v1 正文仍兼容，恢复新版前只清派生索引与已读摘要。
  await bucket.put("feedback/v1/messages/thread-0000/rollback-reply.json", JSON.stringify({ id: "rollback-reply", threadId: "thread-0000", author: teacher, text: "旧版からの返信", createdAt: "2026-02-01T00:00:00.000Z" }));
  await bucket.delete([...bucket.records.keys()].filter(key => key === "feedback/v2/summary-index.json" || key.startsWith("feedback/v2/read-summary/")));
  assert.equal((await listSummaries(bucket, owner, params({}))).items.find(item => item.id === "thread-0000").messageCount, 7);
});

test("各参与者按实际显示ID计算未读，消息投影失败后隐藏仍不向老师泄露", async () => {
  const bucket = new MemoryFeedbackBucket();
  const another = { id: "teacher-another", name: "テスト先生B", role: "teacher" };
  await createThread(bucket, teacher, { id: "thread-private", text: "最初の相談", context });
  assert.equal((await unreadSummary(bucket, teacher)).unreadThreads, 0);
  assert.equal((await unreadSummary(bucket, another)).unreadThreads, 1);
  await markRead(bucket, another, "thread-private", { messageIds: ["thread-private"] });
  await reply(bucket, another, "thread-private", { id: "another-reply", text: "先生Bからの返信" });
  assert.equal((await unreadSummary(bucket, another)).unreadThreads, 0);
  assert.equal((await unreadSummary(bucket, teacher)).unreadThreads, 1);
  let failed = false;
  bucket.fail = (operation, key) => { if (!failed && operation === "put" && key.endsWith("summary-index.json")) { failed = true; throw new Error("projection failure"); } };
  await assert.rejects(reply(bucket, owner, "thread-private", { id: "owner-reply-test", text: "本人の返信" }));
  bucket.fail = null;
  await changeThread(bucket, owner, "thread-private", { hidden: true });
  assert.equal((await listSummaries(bucket, teacher, params({ q: "本人の返信" }))).total, 0);
  assert.equal((await unreadSummary(bucket, teacher)).unreadThreads, 0);
  await assert.rejects(getThread(bucket, "thread-private", teacher), error => error.status === 404);
  assert.equal((await listSummaries(bucket, owner, params({ filter: "hidden" }))).items[0].messageCount, 3);
});
