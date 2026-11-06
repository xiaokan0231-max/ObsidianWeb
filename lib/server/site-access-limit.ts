const PREFIX = "site-access/limits/";
const cleaned = new WeakMap<R2Bucket, number>();

/** 先预占一次尝试再验密码，跨实例和并发请求也不能超过同一窗口的额度。 */
export async function reserveSiteLogin(bucket: R2Bucket | undefined, secret: string, ip: string, seconds: number): Promise<number> {
  if (!bucket) throw new Error("site login storage unavailable");
  const window = Math.floor(seconds / 60);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`site-login\n${ip}`)));
  const client = [...signature].map(value => value.toString(16).padStart(2, "0")).join("");
  const objectKey = `${PREFIX}${String(window).padStart(12, "0")}/${client}.json`;
  for (let attempt = 0; attempt < 32; attempt++) {
    const object = await bucket.get(objectKey);
    const count = object ? (await object.json<{ count: number }>()).count : 0;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid login limit");
    if (count >= 10) return (window + 1) * 60 - seconds;
    const saved = await bucket.put(objectKey, JSON.stringify({ count: count + 1 }), {
      onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" },
    });
    if (!saved) continue;
    // 清理只是空间维护，不能影响已经成功预占的登录；每个实例每分钟最多检查 100 项。
    if (cleaned.get(bucket) !== window) {
      cleaned.set(bucket, window);
      try {
        const expired = await bucket.list({ prefix: PREFIX, limit: 100 });
        const keys = expired.objects.filter(item => Number(item.key.slice(PREFIX.length).split("/")[0]) < window - 1).map(item => item.key);
        if (keys.length) await bucket.delete(keys);
      } catch { /* 下个窗口重试，不记录客户端标识。 */ }
    }
    return 0;
  }
  throw new Error("site login limit contention");
}
