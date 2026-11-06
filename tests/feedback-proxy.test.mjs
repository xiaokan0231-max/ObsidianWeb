import assert from "node:assert/strict";
import test from "node:test";
import { dispatchFeedbackRequest } from "../lib/server/feedback-dispatch.ts";
import { createSiteAccessGate } from "../lib/server/site-access.ts";
import { isFeedbackOwnerRequest } from "../lib/server/feedback-owner-auth.ts";
import { handleFeedbackRequest } from "../lib/server/feedback-handler.ts";
import { MemoryFeedbackBucket } from "./helpers/feedback-bucket.mjs";

const env = { OBSIDIAN_DATA_SOURCE: "live", FEEDBACK_REMOTE_URL: "https://feedback.example", FEEDBACK_OWNER_SECRET: "test-owner-server-secret" };

test("本机代理只转发服务端本人凭据，不转发浏览器身份或远端Cookie", async (t) => {
  const spy = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url.href, "https://feedback.example/api/feedback/session");
    assert.equal(init.headers.get("authorization"), "Bearer test-owner-server-secret");
    assert.equal(init.headers.get("cookie"), null);
    assert.equal(init.headers.get("origin"), "https://feedback.example");
    assert.equal(init.redirect, "error");
    return Response.json({ identity: { id: "owner", name: "本人", role: "owner" }, configured: true }, { headers: { "Set-Cookie": "must-not-reach-browser=secret" } });
  });
  const response = await dispatchFeedbackRequest(new Request("http://localhost:3000/api/feedback/session", { headers: { cookie: "feedback_session=untrusted", authorization: "Bearer browser-input" } }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).identity.role, "owner");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(spy.mock.callCount(), 1);
});

test("本机代理经过真实站点门禁和留言鉴权后读取同一个云端信箱", async (t) => {
  const runtime = { FEEDBACK_BUCKET: new MemoryFeedbackBucket(), FEEDBACK_OWNER_SECRET: "test-owner-secret-with-at-least-32-characters", FEEDBACK_SESSION_SECRET: "test-session-secret-with-at-least-32-characters", FEEDBACK_ACCESS_CODE: "test-teacher-code", SITE_ACCESS_PASSWORD: "test-site-password", SITE_ACCESS_SESSION_SECRET: "test-site-session-secret" };
  const gate = createSiteAccessGate();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const request = new Request(url, init);
    if (!await isFeedbackOwnerRequest(request, runtime)) {
      const denied = await gate(request, runtime);
      if (denied) return denied;
    }
    return handleFeedbackRequest(request, runtime);
  });
  const response = await dispatchFeedbackRequest(new Request("http://localhost:3000/api/feedback/session"), { ...env, FEEDBACK_OWNER_SECRET: runtime.FEEDBACK_OWNER_SECRET });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).identity.role, "owner");
  assert.equal(response.headers.get("Set-Cookie"), null);
});

test("跨站读写和非本机Host不能借用本人的留言管理权限", async (t) => {
  const spy = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not forward"); });
  for (const request of [
    new Request("http://localhost:3000/api/feedback/threads", { headers: { origin: "https://outside.example" } }),
    new Request("http://localhost:3000/api/feedback/threads", { headers: { "sec-fetch-site": "cross-site" } }),
    new Request("http://outside.example/api/feedback/threads"),
    new Request("http://localhost:3000/api/feedback/threads", { method: "POST" }),
  ]) assert.equal((await dispatchFeedbackRequest(request, env)).status, 403);
  assert.equal(spy.mock.callCount(), 0);
});

test("本机提交保留正文，远端失败不会泄露管理配置", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(new TextDecoder().decode(init.body), '{"text":"ご意見です"}');
    throw new Error("test-owner-server-secret");
  });
  const response = await dispatchFeedbackRequest(new Request("http://localhost:3000/api/feedback/threads", { method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json" }, body: '{"text":"ご意見です"}' }), env);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /test-owner-server-secret/);
});

test("公开模式不会启用本机自动本人代理", async (t) => {
  const spy = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not forward"); });
  const response = await dispatchFeedbackRequest(new Request("https://feedback.example/api/feedback/session"), { ...env, OBSIDIAN_DATA_SOURCE: "published" });
  assert.deepEqual(await response.json(), { identity: null, configured: false });
  assert.equal(spy.mock.callCount(), 0);
});
