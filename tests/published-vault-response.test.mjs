import assert from "node:assert/strict";
import test from "node:test";
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";
import { createPublishedVaultResponseHandler } from "../lib/server/published-vault-response.ts";

const file = `${"a".repeat(24)}.json`;
const etag = 'W/"published-snapshot"';
const note = { path: "例.md", content: "# 内容", stat: { ctime: 1, mtime: 2, size: 10 }, tags: [], frontmatter: { type: "job-case" } };
const payload = { connected: true, fetchedAt: Date.parse("2026-01-01T00:00:00Z"), notes: [note], paths: [note.path], scope: "actions" };
const bytes = Buffer.from(JSON.stringify(payload));
const entry = { file, etag, gzip: `${file}.gz`, br: `${file}.br` };
const manifest = {
  schemaVersion: 2, publishedAt: "2026-01-01T00:00:00Z",
  scopes: { all: [file], actions: [file] }, chunks: { [note.path]: file },
  responses: { all: entry, actions: entry },
};

function request(search = "?scope=actions", headers = {}, method = "GET") {
  return new Request(`https://example.com/api/vault${search}`, { headers, method });
}

function fixture(options = {}) {
  const calls = [];
  let manifestCalls = 0;
  let payloadCalls = 0;
  const handle = createPublishedVaultResponseHandler(async (incoming) => {
    const path = new URL(incoming.url).pathname;
    calls.push({ path, method: incoming.method, encoding: incoming.headers.get("Accept-Encoding") });
    if (path.endsWith("/manifest.json")) {
      manifestCalls++;
      if (options.manifestFailure && manifestCalls === 1) return new Response(null, { status: 503 });
      return Response.json(options.invalidManifest && manifestCalls === 1 ? {} : (options.manifest ?? manifest));
    }
    payloadCalls++;
    if (options.payloadFailure && payloadCalls === 1) return new Response(null, { status: 404 });
    const body = path.endsWith(".br") ? brotliCompressSync(bytes) : path.endsWith(".gz") ? gzipSync(bytes) : bytes;
    const response = new Response(incoming.method === "HEAD" ? null : body, { headers: { "Content-Length": String(body.length) } });
    // 资源正文只能作为流转发，服务端不能解码或重新序列化它。
    response.json = response.text = () => { throw new Error("Payload must remain a stream"); };
    return response;
  });
  return { handle, calls, manifestCalls: () => manifestCalls, payloadCalls: () => payloadCalls };
}

test("published response preserves the vault API payload and streams asset bytes", async () => {
  const f = fixture();
  const response = await f.handle(request(), true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), payload);
  assert.equal(response.headers.get("ETag"), etag);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
  assert.equal(response.headers.get("Vary"), "Accept-Encoding");
  assert.match(response.headers.get("Content-Type"), /^application\/json/);
  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.deepEqual(f.calls.map((call) => call.encoding), ["identity", "identity"]);
});

test("日历专用静态响应复用压缩与验证器，旧快照才回退动态接口", async () => {
  const f = fixture({ manifest: { ...manifest, calendar: entry } });
  const response = await f.handle(new Request("https://example.com/api/calendar", {
    headers: { "Accept-Encoding": "gzip" },
  }), true);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  assert.deepEqual(gunzipSync(Buffer.from(await response.arrayBuffer())), bytes);
  const cached = await f.handle(new Request("https://example.com/api/calendar", { headers: { "If-None-Match": etag } }), true);
  assert.equal(cached.status, 304);
  assert.equal(f.payloadCalls(), 1);
  assert.equal(await fixture().handle(new Request("https://example.com/api/calendar"), true), null);
});

test("a matching validator returns 304 without reading any payload asset", async () => {
  const f = fixture();
  for (const validator of [etag, etag.slice(2), `"older", ${etag}`, "*"]) {
    const response = await f.handle(request("?scope=actions", { "If-None-Match": validator }), true);
    assert.equal(response.status, 304);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("ETag"), etag);
  }
  assert.equal(f.manifestCalls(), 1);
  assert.equal(f.payloadCalls(), 0);
  const fresh = await f.handle(request("?scope=actions&refresh=1", { "If-None-Match": etag }), true);
  assert.equal(fresh.status, 200);
  assert.equal(f.payloadCalls(), 1);
});

test("compression honors encoding quality, wildcard and explicit exclusions", async () => {
  const cases = [
    ["br, gzip", "br"],
    ["gzip;q=0.8, br;q=0.5", "gzip"],
    ["br;q=0, gzip;q=1", "gzip"],
    ["br;q=0, gzip;q=0", null],
    ["*;q=0.5, br;q=0", "gzip"],
    ["identity;q=1, br;q=0.5", null],
  ];
  for (const [accepted, expected] of cases) {
    const f = fixture();
    const response = await f.handle(request("?scope=actions", { "Accept-Encoding": accepted }), true);
    assert.equal(response.status, 200, accepted);
    assert.equal(response.headers.get("Content-Encoding"), expected, accepted);
    const body = Buffer.from(await response.arrayBuffer());
    const decoded = expected === "br" ? brotliDecompressSync(body) : expected === "gzip" ? gunzipSync(body) : body;
    assert.deepEqual(JSON.parse(decoded.toString()), payload, accepted);
    assert.equal(Number(response.headers.get("Content-Length")), body.length);
  }
  const f = fixture();
  const refused = await f.handle(request("?scope=actions", { "Accept-Encoding": "br;q=0,gzip;q=0,identity;q=0" }), true);
  assert.equal(refused.status, 406);
  assert.equal(f.payloadCalls(), 0);
});

test("Cloudflare original encoding overrides rewritten request headers", async () => {
  const f = fixture();
  const incoming = request("?scope=actions", { "Accept-Encoding": "br, gzip" });
  Object.defineProperty(incoming, "cf", { value: { clientAcceptEncoding: "gzip, br;q=0" } });
  const response = await f.handle(incoming, true);
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  assert.deepEqual(gunzipSync(Buffer.from(await response.arrayBuffer())), bytes);
  assert.equal(f.calls.at(-1).path, `/_published-vault/${file}.gz`);
});

test("HEAD retains negotiated headers with no response body", async () => {
  const f = fixture();
  const response = await f.handle(request("?scope=actions", { "Accept-Encoding": "gzip" }, "HEAD"), true);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  assert.equal(await response.text(), "");
  assert.equal(f.calls.at(-1).method, "HEAD");
});

test("concurrent requests share the small manifest without caching payloads", async () => {
  const f = fixture();
  const responses = await Promise.all([f.handle(request(), true), f.handle(request(), true)]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(f.manifestCalls(), 1);
  assert.equal(f.payloadCalls(), 2);
});

test("manifest failures retry and payload failures never masquerade as empty data", async () => {
  for (const options of [{ manifestFailure: true }, { invalidManifest: true }]) {
    const f = fixture(options);
    const failed = await f.handle(request(), true);
    assert.equal(failed.status, 503);
    const error = await failed.json();
    assert.equal(error.connected, false);
    assert.equal("notes" in error, false);
    assert.equal((await f.handle(request(), true)).status, 200);
    assert.equal(f.manifestCalls(), 2);
  }
  const f = fixture({ payloadFailure: true });
  assert.equal((await f.handle(request(), true)).status, 503);
  assert.equal((await f.handle(request(), true)).status, 200);
  assert.equal(f.manifestCalls(), 1);
});

test("legacy snapshots, missing scopes, unrelated paths and local mode use the existing handler", async () => {
  const legacy = { ...manifest };
  delete legacy.responses;
  assert.equal(await fixture({ manifest: legacy }).handle(request(), true), null);
  assert.equal(await fixture().handle(request("?scope=jobs"), true), null);
  const f = fixture();
  assert.equal(await f.handle(request(), false), null);
  assert.equal(await f.handle(new Request("https://example.com/calendar"), true), null);
  assert.equal(await f.handle(request("", {}, "POST"), true), null);
  assert.equal(f.calls.length, 0);
});

test("missing or invalid scopes normalize to all and unsafe asset paths fail closed", async () => {
  for (const search of ["", "?scope=invalid", "?scope=calendar"]) {
    const f = fixture();
    assert.equal((await f.handle(request(search), true)).status, 200);
    assert.equal(f.calls.at(-1).path, `/_published-vault/${file}`);
  }
  const unsafe = { ...manifest, responses: { actions: { ...entry, file: "../outside.json" } } };
  const f = fixture({ manifest: unsafe });
  assert.equal((await f.handle(request(), true)).status, 503);
  assert.equal(f.payloadCalls(), 0);
});
