import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedMtime, assertJsonContentType, assertSameOrigin, conflictError, sameOriginVerdict } from "../lib/server/write-guards.ts";

const headers = (map) => ({ get: (name) => map[name.toLowerCase()] ?? null });
const URL_ = "http://localhost:3000/api/jobs/status";

test("同源判定：Sec-Fetch-Site 优先；没有它就比 Origin 与 Host；两者都没有一律拒", () => {
  assert.equal(sameOriginVerdict(headers({ "sec-fetch-site": "same-origin" }), URL_).ok, true);
  assert.equal(sameOriginVerdict(headers({ "sec-fetch-site": "none" }), URL_).ok, true, "地址栏直接发起的请求");
  assert.equal(sameOriginVerdict(headers({ "sec-fetch-site": "cross-site", origin: "http://localhost:3000" }), URL_).ok, false, "Sec-Fetch-Site 说跨站就跨站，Origin 伪装无效");
  assert.equal(sameOriginVerdict(headers({ origin: "http://localhost:3000", host: "localhost:3000" }), URL_).ok, true);
  assert.equal(sameOriginVerdict(headers({ origin: "http://evil.test", host: "localhost:3000" }), URL_).ok, false);
  assert.equal(sameOriginVerdict(headers({ origin: "http://localhost:3000" }), URL_).ok, true, "没有 Host 头时用请求 URL 的 host");
  assert.equal(sameOriginVerdict(headers({ origin: "not a url" }), URL_).ok, false);
  assert.equal(sameOriginVerdict(headers({}), URL_).ok, false, "curl 之类不带任何来源头的请求也拒");
  assert.throws(() => assertSameOrigin({ headers: headers({}), url: URL_ }), (error) => error.status === 403);
  assert.doesNotThrow(() => assertSameOrigin({ headers: headers({ "sec-fetch-site": "same-origin" }), url: URL_ }));
});

test("Content-Type 必须是 application/json（允许带 charset），其它一律 415", () => {
  assert.doesNotThrow(() => assertJsonContentType(headers({ "content-type": "application/json" })));
  assert.doesNotThrow(() => assertJsonContentType(headers({ "content-type": "application/json; charset=utf-8" })));
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "", "application/jsonx"]) {
    assert.throws(() => assertJsonContentType(headers({ "content-type": type })), (error) => error.status === 415, type || "(无)");
  }
});

test("乐观锁：没给期待值放行，给了就要精确相等，不等是 409", () => {
  assert.doesNotThrow(() => assertExpectedMtime(undefined, 100));
  assert.doesNotThrow(() => assertExpectedMtime(100, 100));
  assert.throws(() => assertExpectedMtime(99, 100), (error) => error.status === 409);
  assert.equal(conflictError().status, 409);
});
