const MAGIC = new TextEncoder().encode("OWSEALED1");

async function encryptionKey(secret?: string) {
  if (!secret || !/^[a-f0-9]{64}$/iu.test(secret)) throw new Error("发布资料解密密钥未配置");
  const bytes = Uint8Array.from(secret.match(/../gu)!, pair => Number.parseInt(pair, 16));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function isSealedAsset(bytes: Uint8Array) {
  return bytes.length >= MAGIC.length + 12 + 16 && MAGIC.every((value, index) => bytes[index] === value);
}

/** 托管层可能直接提供静态资源，因此部署副本本身也必须不含可读的个人资料。 */
export async function sealAsset(bytes: Uint8Array, secret: string): Promise<Uint8Array> {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // 先压缩再加密，避免原先可压缩的大型资料变成同体积随机字节，拖慢部署和资料读取。
  const compressed = await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed));
  const result = new Uint8Array(MAGIC.length + iv.length + encrypted.length);
  result.set(MAGIC); result.set(iv, MAGIC.length); result.set(encrypted, MAGIC.length + iv.length);
  return result;
}

export async function unsealAssetResponse(response: Response, secret?: string | readonly string[], method = "GET"): Promise<Response> {
  if (!response.ok) return response;
  const secrets = (Array.isArray(secret) ? secret : [secret]).filter((value): value is string => Boolean(value));
  if (!secrets.length) throw new Error("发布资料解密密钥未配置");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isSealedAsset(bytes)) throw new Error("部署资料未加密，已拒绝读取");
  let plaintext: ArrayBuffer | undefined;
  // 轮换期间保留上一发布密钥，旧安全版本回退时仍可解封自己的不可变资源。
  for (const candidate of secrets.slice(0, 2)) {
    try {
      plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(MAGIC.length, MAGIC.length + 12) }, await encryptionKey(candidate), bytes.slice(MAGIC.length + 12));
      break;
    } catch { /* 仅尝试配置的第二把密钥，不接受明文兜底。 */ }
  }
  if (!plaintext) throw new Error("部署资料解密验证失败");
  const headers = new Headers(response.headers);
  for (const name of ["Content-Length", "Content-Encoding", "ETag", "Last-Modified"]) headers.delete(name);
  headers.set("Cache-Control", "private, no-store");
  const body = method === "HEAD" ? null : new Response(plaintext).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export async function fetchSealedPublishedAsset(assets: { fetch(request: Request): Promise<Response> }, request: Request, secret?: string | readonly string[]): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set("Accept-Encoding", "identity");
  headers.delete("If-None-Match"); headers.delete("If-Modified-Since");
  // HEAD 也先取完整封装来验证，不能仅凭可伪造的响应头判断资料已加密。
  const response = await assets.fetch(new Request(request, { method: "GET", headers }));
  return unsealAssetResponse(response, secret, request.method);
}

export function publishedAssetSecrets(env: { SITE_ASSET_SECRET?: string; SITE_ASSET_SECRET_NEXT?: string }): string[] {
  return [...new Set([env.SITE_ASSET_SECRET_NEXT, env.SITE_ASSET_SECRET].filter((value): value is string => Boolean(value)))];
}
