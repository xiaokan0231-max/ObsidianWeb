import assert from "node:assert/strict";
import test from "node:test";
import { sealAsset, unsealAssetResponse } from "../lib/server/sealed-assets.ts";

const secret = "a1".repeat(32);
const otherSecret = "b2".repeat(32);
const encoder = new TextEncoder();
const plaintext = JSON.stringify({ company: "株式会社テスト", content: "非公開の面談資料を暗号化するための架空テキスト。" });
const bytes = encoder.encode(plaintext);

function response(body, headers = {}) {
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

test("保存用封装使用指定magic和随机IV，同文不会重复密文，也不含明文", async () => {
  const first = await sealAsset(bytes, secret);
  const second = await sealAsset(bytes, secret);
  assert.ok(first instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(first.slice(0, 9)), "OWSEALED1");
  assert.notDeepEqual(first.slice(9, 21), second.slice(9, 21));
  assert.notDeepEqual(first, second);
  assert.equal(Buffer.from(first).includes(Buffer.from(bytes)), false);
  assert.equal(Buffer.from(second).includes(Buffer.from(bytes)), false);
  for (const sealed of [first, second]) {
    const opened = await unsealAssetResponse(response(sealed), secret);
    assert.deepEqual(new Uint8Array(await opened.arrayBuffer()), bytes);
  }
});

test("重复的大型资料先压缩再封装，减少发布体积且解密仍逐字节还原", async () => {
  const repeated = encoder.encode("株式会社テストの架空面談資料。\n".repeat(4000));
  const sealed = await sealAsset(repeated, secret);
  assert.ok(sealed.length < repeated.length, "封装后的重复资料应小于未压缩正文");
  const opened = await unsealAssetResponse(response(sealed), secret);
  assert.deepEqual(new Uint8Array(await opened.arrayBuffer()), repeated);
});

test("解密保留内容类型与响应状态，清除密文的长度、压缩和验证器，并禁止缓存明文", async () => {
  const sealed = await sealAsset(bytes, secret);
  const opened = await unsealAssetResponse(response(sealed, {
    "Content-Length": String(sealed.length), "Content-Encoding": "gzip", ETag: '"sealed-asset-etag"',
    "Cache-Control": "public, max-age=31536000, immutable", "X-Test-Metadata": "preserved",
  }), secret);
  assert.equal(opened.status, 200);
  assert.match(opened.headers.get("Content-Type"), /application\/json/);
  assert.equal(opened.headers.get("X-Test-Metadata"), "preserved");
  for (const name of ["Content-Length", "Content-Encoding", "ETag"]) assert.equal(opened.headers.get(name), null, name);
  assert.match(opened.headers.get("Cache-Control"), /private/);
  assert.match(opened.headers.get("Cache-Control"), /no-store/);
  assert.equal(await opened.text(), plaintext);
});

test("缺失或错误密钥、损坏密文与未封装明文全部关闭访问，不作明文回退", async () => {
  const sealed = await sealAsset(bytes, secret);
  for (const key of [undefined, "", otherSecret, "not-a-valid-key"]) {
    await assert.rejects(() => unsealAssetResponse(response(sealed), key));
  }
  const damaged = sealed.slice();
  damaged[damaged.length - 1] ^= 1;
  const wrongMagic = sealed.slice();
  wrongMagic[0] ^= 1;
  for (const invalid of [damaged, wrongMagic, sealed.slice(0, 20), encoder.encode("OWSEALED1"), bytes]) {
    await assert.rejects(() => unsealAssetResponse(response(invalid), secret));
  }
});

test("HEAD仍验证完整密文，仅在认证解密成功后返回无正文响应", async () => {
  const sealed = await sealAsset(bytes, secret);
  const opened = await unsealAssetResponse(response(sealed, { "Content-Length": String(sealed.length), ETag: '"ciphertext"' }), secret, "HEAD");
  assert.equal(opened.status, 200);
  assert.equal(opened.body, null);
  assert.equal(await opened.text(), "");
  assert.equal(opened.headers.get("Content-Length"), null);
  assert.equal(opened.headers.get("ETag"), null);
  assert.match(opened.headers.get("Cache-Control"), /no-store/);
  const damaged = sealed.slice();
  damaged[damaged.length - 1] ^= 1;
  await assert.rejects(() => unsealAssetResponse(response(damaged), secret, "HEAD"));
  await assert.rejects(() => unsealAssetResponse(response(sealed), otherSecret, "HEAD"));
});

test("不存在的资源保留404与原有正文，不要求密钥也不尝试解密", async () => {
  const missing = new Response("missing-test-asset", { status: 404, headers: { "Content-Type": "text/plain", "X-Test-Metadata": "missing" } });
  const opened = await unsealAssetResponse(missing);
  assert.equal(opened.status, 404);
  assert.equal(opened.headers.get("X-Test-Metadata"), "missing");
  assert.equal(await opened.text(), "missing-test-asset");
});

test("封装只接受完整的256位十六进制密钥", async () => {
  for (const key of ["", "short", "a1".repeat(31), "a1".repeat(33), "zz".repeat(32)]) {
    await assert.rejects(() => sealAsset(bytes, key));
  }
});
