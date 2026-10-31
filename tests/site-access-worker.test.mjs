import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { publishedRequestResponse } from "../lib/server/published-access.ts";
import { privateSiteResponse } from "../lib/server/site-access.ts";

async function harness({ deny = false, assetStatus = 404, projected = false, login = false } = {}) {
  const events = [];
  const gate = async request => {
    events.push(["gate", new URL(request.url).pathname]);
    if (login) return new Response(null, { status: 303, headers: { Location: "/training/reading", "Set-Cookie": "test-session=signed; HttpOnly; Secure; SameSite=Strict; Path=/" } });
    return deny ? new Response("需要访问密码", { status: 401 }) : null;
  };
  const mod = await loadAppModule("worker/index.ts", {
    stubs: {
      "../lib/server/site-access": { createSiteAccessGate: () => gate, privateSiteResponse },
      "vinext/server/app-router-entry": { default: { async fetch(request) { events.push(["page", new URL(request.url).pathname]); return new Response("page"); } } },
      "vinext/server/image-optimization": {
        DEFAULT_DEVICE_SIZES: [640], DEFAULT_IMAGE_SIZES: [64],
        async handleImageOptimization(request) { events.push(["image", new URL(request.url).pathname]); return new Response("image"); },
      },
      "../lib/server/published-access": {
        publishedRequestResponse(request, enabled) { events.push(["readonly", new URL(request.url).pathname]); return publishedRequestResponse(request, enabled); },
      },
      "../lib/server/published-vault-response": {
        createPublishedVaultResponseHandler: () => async request => {
          events.push(["projection", new URL(request.url).pathname]);
          return projected ? Response.json({ notes: ["authorized"] }) : null;
        },
      },
      "../lib/server/calendar-read-model": { createCalendarReadModel: () => ({}) },
      "../lib/server/feedback-dispatch": {
        async dispatchFeedbackRequest(request) { events.push(["feedback", new URL(request.url).pathname]); return Response.json({ error: "仍需留言鉴权" }, { status: 401 }); },
      },
    },
  });
  const env = {
    OBSIDIAN_DATA_SOURCE: "published",
    ASSETS: { async fetch(request) { events.push(["asset", new URL(request.url).pathname]); return new Response(assetStatus === 404 ? "not found" : "asset", { status: assetStatus, headers: { "Cache-Control": "public, max-age=31536000" } }); } },
    IMAGES: {},
  };
  return {
    events,
    fetch: (path, method = "GET", overrides = {}) => mod.default.fetch(new Request(`https://example.test${path}`, { method }), { ...env, ...overrides }, { waitUntil() {}, passThroughOnException() {} }),
  };
}

function privateResponse(response) {
  assert.match(response.headers.get("Cache-Control") ?? "", /(?:^|[,\s])private(?:$|[,\s])/u);
  assert.match(response.headers.get("Cache-Control") ?? "", /(?:^|[,\s])no-store(?:$|[,\s])/u);
}

test("生产入口先检查密码，页面、资料接口、原始静态、图片和留言均不能绕过", async () => {
  const h = await harness({ deny: true, assetStatus: 200, projected: true });
  const requests = [
    ["/"], ["/training/reading"], ["/api/note?path=20_%E6%B1%82%E8%81%B7%2F%E5%8E%9F%E7%A8%BF.md"],
    ["/api/vault"], ["/api/calendar"], ["/api/read-model/library"], ["/api/read-model/search?q=test"],
    ["/_published-vault/manifest.json"], ["/_published-vault/0123456789abcdef01234567.json.gz"],
    ["/_published-vault/0123456789abcdef01234567.json.br", "HEAD"], ["/assets/client.js"], ["/assets/theme.css"],
    ["/_vinext/image?url=%2Fimage.png&w=640"], ["/api/feedback/messages", "POST"], ["/api/feedback/messages", "OPTIONS"],
  ];
  for (const [path, method] of requests) {
    const response = await h.fetch(path, method);
    assert.equal(response.status, 401, `${method ?? "GET"} ${path}`);
  }
  assert.equal(h.events.length, requests.length);
  assert.ok(h.events.every(([kind]) => kind === "gate"), JSON.stringify(h.events));
});

test("密码处理返回的重定向和会话cookie不被线上只读守卫拦截", async () => {
  const h = await harness({ login: true });
  const response = await h.fetch("/_auth/login", "POST");
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/training/reading");
  assert.match(response.headers.get("Set-Cookie") ?? "", /test-session=signed/u);
  assert.deepEqual(h.events, [["gate", "/_auth/login"]]);
});

test("通过密码后静态资源可读且不向浏览器和共享缓存公开缓存", async () => {
  for (const method of ["GET", "HEAD"]) {
    const h = await harness({ assetStatus: 200 });
    const response = await h.fetch("/_published-vault/0123456789abcdef01234567.json.gz", method);
    assert.equal(response.status, 200);
    privateResponse(response);
    assert.equal(h.events[0][0], "gate");
    assert.equal(h.events.filter(([kind]) => kind === "asset").length, 1);
    assert.ok(h.events.every(([kind]) => !["page", "projection", "image", "feedback"].includes(kind)));
  }
});

test("通过密码后动态页面、投影和图片保留原路由并禁止缓存私有响应", async () => {
  const page = await harness();
  const pageResponse = await page.fetch("/training/reading");
  assert.equal(await pageResponse.text(), "page");
  privateResponse(pageResponse);
  assert.equal(page.events[0][0], "gate");
  assert.equal(page.events.at(-1)[0], "page");

  const projection = await harness({ projected: true });
  const projectionResponse = await projection.fetch("/api/vault");
  assert.deepEqual(await projectionResponse.json(), { notes: ["authorized"] });
  privateResponse(projectionResponse);
  assert.equal(projection.events[0][0], "gate");
  assert.equal(projection.events.filter(([kind]) => kind === "projection").length, 1);
  assert.ok(projection.events.every(([kind]) => kind !== "page"));

  const image = await harness();
  const imageResponse = await image.fetch("/_vinext/image?url=%2Fimage.png&w=640");
  assert.equal(await imageResponse.text(), "image");
  privateResponse(imageResponse);
  assert.equal(image.events[0][0], "gate");
  assert.equal(image.events.filter(([kind]) => kind === "image").length, 1);
});

test("通过网站密码不获得资料写入权，也不替代留言接口的独立鉴权", async () => {
  const write = await harness();
  const response = await write.fetch("/api/todos/status", "POST");
  assert.equal(response.status, 403);
  assert.ok(write.events.some(([kind]) => kind === "readonly"));
  assert.ok(write.events.every(([kind]) => !["page", "asset", "projection", "feedback"].includes(kind)));

  const feedback = await harness();
  const feedbackResponse = await feedback.fetch("/api/feedback/messages", "POST");
  assert.equal(feedbackResponse.status, 401);
  assert.deepEqual(feedback.events, [["gate", "/api/feedback/messages"], ["feedback", "/api/feedback/messages"]]);
});

test("本机live请求不启用公网密码门禁，也不改开发资源处理方式", async () => {
  const h = await harness({ deny: true, assetStatus: 200 });
  const response = await h.fetch("/training/reading", "GET", { OBSIDIAN_DATA_SOURCE: "live" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "page");
  assert.ok(h.events.every(([kind]) => kind !== "gate" && kind !== "asset"));
});
