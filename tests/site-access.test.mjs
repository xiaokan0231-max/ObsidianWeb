import assert from "node:assert/strict";
import test from "node:test";
import { createSiteAccessGate } from "../lib/server/site-access.ts";

const origin = "https://vault.example.test";
const password = "test-access-phrase-willow";
const secret = "test-session-signing-secret-at-least-32-characters";
const initialTime = Date.parse("2026-01-01T00:00:00Z");

function fixture() {
  let time = initialTime;
  const env = { SITE_ACCESS_PASSWORD: password, SITE_ACCESS_SESSION_SECRET: secret };
  const gate = createSiteAccessGate({ now: () => time });
  function request(path = "/training/reading", options = {}) {
    const headers = new Headers(options.headers);
    if (options.cookie) headers.set("Cookie", options.cookie);
    if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/x-www-form-urlencoded");
    return new Request(`${origin}${path}`, { method: options.method ?? "GET", headers, body: options.body });
  }
  async function login(next = "/training/reading?readingFinding=alternative", supplied = password) {
    const response = await gate(request("/_site-access/login", {
      method: "POST", headers: { Origin: origin }, body: new URLSearchParams({ password: supplied, next }).toString(),
    }), env);
    return { response, cookie: response.headers.get("Set-Cookie")?.split(";")[0] };
  }
  return { env, gate, request, login, advance: milliseconds => { time += milliseconds; } };
}

test("未解锁时页面显示密码页，资料接口与静态快照均不能放行", async () => {
  const f = fixture();
  const page = await f.gate(f.request("/training/reading", { headers: { Accept: "text/html" } }), f.env);
  assert.equal(page.status, 401);
  assert.match(page.headers.get("Content-Type"), /text\/html/);
  assert.match(page.headers.get("Cache-Control"), /no-store/);
  const html = await page.text();
  assert.match(html, /type=["']password["']/);
  assert.match(html, /<form\b/);
  assert.doesNotMatch(html, new RegExp(`${password}|${secret}`));
  for (const path of ["/api/note?path=private.md", "/api/read-model/library", "/_published-vault/manifest.json", "/_published-vault/0123456789abcdef01234567.json.gz", "/api/feedback/threads"]) {
    const response = await f.gate(f.request(path), f.env);
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    assert.equal((await response.json()).code, "SITE_ACCESS_REQUIRED");
  }
});

test("运行时密码或签名密钥缺失时关闭访问，不降级为公开站点", async () => {
  const f = fixture();
  for (const env of [{}, { SITE_ACCESS_PASSWORD: password }, { SITE_ACCESS_SESSION_SECRET: secret }, { ...f.env, SITE_ACCESS_PASSWORD: "" }]) {
    const response = await f.gate(f.request(), env);
    assert.equal(response.status, 503);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
});

test("正确密码签发浏览会话Cookie，后续页面、接口与静态资料均可进入", async () => {
  const f = fixture();
  const login = await f.login();
  assert.equal(login.response.status, 303);
  assert.equal(login.response.headers.get("Location"), "/training/reading?readingFinding=alternative");
  const setCookie = login.response.headers.get("Set-Cookie");
  assert.match(setCookie, /^__Host-obsidian_access=/);
  for (const attribute of [/;\s*HttpOnly(?:;|$)/i, /;\s*Secure(?:;|$)/i, /;\s*SameSite=Lax(?:;|$)/i, /;\s*Path=\/(?:;|$)/i]) assert.match(setCookie, attribute);
  assert.doesNotMatch(setCookie, /(?:Max-Age|Expires)=/i);
  assert.ok(!setCookie.includes(password));
  for (const path of ["/training/reading", "/api/note?path=test.md", "/_published-vault/manifest.json", "/api/feedback/threads"]) {
    assert.equal(await f.gate(f.request(path, { cookie: login.cookie }), f.env), null, path);
  }
});

test("错误密码不产生有效会话，密码与密钥更新都会使旧Cookie失效", async () => {
  const f = fixture();
  const wrong = await f.login("/calendar", "wrong-test-phrase");
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.response.headers.get("Set-Cookie"), null);
  const { cookie } = await f.login();
  for (const env of [{ ...f.env, SITE_ACCESS_PASSWORD: "another-test-phrase" }, { ...f.env, SITE_ACCESS_SESSION_SECRET: `${secret}-rotated` }]) {
    assert.equal((await f.gate(f.request("/api/note", { cookie }), env)).status, 401);
  }
});

test("不能篡改或延长会话，12小时之后重新要求密码", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  const [name, token] = cookie.split("=");
  const parts = token.split(".");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "v1");
  const alteredExpiry = `${parts[0]}.${Number(parts[1]) + 3600}.${parts[2]}`;
  const changedSignature = `${parts[0]}.${parts[1]}.${parts[2][0] === "a" ? "b" : "a"}${parts[2].slice(1)}`;
  for (const invalid of ["", "v1.invalid.invalid", `${token}extra`, alteredExpiry, changedSignature]) {
    assert.equal((await f.gate(f.request("/api/note", { cookie: `${name}=${invalid}` }), f.env)).status, 401);
  }
  f.advance(12 * 60 * 60 * 1000 + 1000);
  assert.equal((await f.gate(f.request("/api/note", { cookie }), f.env)).status, 401);
});

test("登录只能同源表单POST，拒绝跨站、缺失来源、其它类型和超长请求", async () => {
  const f = fixture();
  const body = new URLSearchParams({ password, next: "/calendar" }).toString();
  for (const headers of [{}, { Origin: "https://other.example.test" }]) {
    const response = await f.gate(f.request("/_site-access/login", { method: "POST", body, headers }), f.env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Set-Cookie"), null);
  }
  const contentType = await f.gate(f.request("/_site-access/login", { method: "POST", body, headers: { Origin: origin, "Content-Type": "text/plain" } }), f.env);
  assert.equal(contentType.status, 415);
  const tooLarge = await f.gate(f.request("/_site-access/login", { method: "POST", body: "password=" + "x".repeat(5000), headers: { Origin: origin } }), f.env);
  assert.equal(tooLarge.status, 413);
  for (const method of ["GET", "PUT"]) {
    const response = await f.gate(f.request("/_site-access/login", { method, headers: { Origin: origin } }), f.env);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Set-Cookie"), null);
  }
});

test("登录后的返回地址不能跳出本站，也不接受反斜线或控制字符", async () => {
  for (const next of ["https://other.example.test/", "//other.example.test/", "/\\other.example.test/", "\n//other.example.test/", "/calendar\r\nX-Test: bad"]) {
    const f = fixture();
    const { response } = await f.login(next);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("Location"), "/calendar", JSON.stringify(next));
  }
});

test("退出只接受同源POST并清除会话，未授权HEAD不会返回正文", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  const response = await f.gate(f.request("/_site-access/logout", { method: "POST", cookie, headers: { Origin: origin } }), f.env);
  assert.equal(response.status, 303);
  assert.match(response.headers.get("Set-Cookie"), /^__Host-obsidian_access=;/);
  assert.match(response.headers.get("Set-Cookie"), /Max-Age=0/i);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  const head = await f.gate(f.request("/_published-vault/manifest.json", { method: "HEAD" }), f.env);
  assert.equal(head.status, 401);
  assert.equal(await head.text(), "");
  assert.match(head.headers.get("Cache-Control"), /no-store/);
});
