import type { FeedbackIdentity } from "../feedback.ts";
import { changeThread, createThread, FeedbackError, getThread, listThreads, loginAttempt, markRead, participantName, reply, rotateCode, settings, validId, type FeedbackSettings } from "./feedback-store.ts";

export type FeedbackEnv = {
  FEEDBACK_BUCKET?: R2Bucket;
  FEEDBACK_SESSION_SECRET?: string;
  FEEDBACK_OWNER_SECRET?: string;
  FEEDBACK_ACCESS_CODE?: string;
};
type SessionClaims = FeedbackIdentity & { exp: number; version: string };
const COOKIE = "feedback_session";
const MAX_AGE = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();
function json(value: unknown, status = 200, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Cookie, Authorization");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(value, { status, headers });
}
function bytes(value: string): ArrayBuffer { return encoder.encode(value).buffer as ArrayBuffer; }
async function hash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function equal(a: string, b: string) {
  const [left, right] = await Promise.all([hash(a), hash(b)]);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function base64(value: string | Uint8Array) {
  const data = typeof value === "string" ? encoder.encode(value) : value;
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode(value: string) { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0)); }
async function signingKey(secret: string) { return crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
async function signed(claims: SessionClaims, secret: string) {
  const payload = base64(JSON.stringify(claims));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), bytes(payload));
  return `${payload}.${base64(new Uint8Array(signature))}`;
}
function cookie(request: Request, value: string, maxAge = MAX_AGE) {
  return `${COOKIE}=${value}; Path=/api/feedback; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function identity(request: Request, env: FeedbackEnv, config: FeedbackSettings): Promise<FeedbackIdentity | null> {
  const bearer = request.headers.get("Authorization");
  if (bearer?.startsWith("Bearer ") && await equal(bearer.slice(7), env.FEEDBACK_OWNER_SECRET!)) return { id: "owner", name: "本人", role: "owner" };
  const value = request.headers.get("Cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!value || value.length > 4096) return null;
  try {
    const [payload, signature, extra] = value.split(".");
    if (extra || !payload || !signature) return null;
    if (!await crypto.subtle.verify("HMAC", await signingKey(env.FEEDBACK_SESSION_SECRET!), decode(signature).buffer as ArrayBuffer, bytes(payload))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decode(payload))) as SessionClaims;
    if (!claims || !["owner", "teacher"].includes(claims.role) || !Number.isFinite(claims.exp) || claims.exp < Date.now() || typeof claims.name !== "string" || !claims.name.trim() || claims.name.length > 80) return null;
    if (claims.role === "owner") {
      if (claims.id !== "owner" || claims.version !== await hash(env.FEEDBACK_OWNER_SECRET!)) return null;
    } else if (!validId(claims.id) || claims.version !== config.version) return null;
    return { id: claims.id, name: claims.name, role: claims.role };
  } catch { return null; }
}
function configured(env: FeedbackEnv) { return Boolean(env.FEEDBACK_BUCKET && env.FEEDBACK_SESSION_SECRET && env.FEEDBACK_SESSION_SECRET.length >= 32 && env.FEEDBACK_OWNER_SECRET && env.FEEDBACK_OWNER_SECRET.length >= 32); }
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") ?? "")) throw new FeedbackError(415, "入力内容を確認してください。");
  if (Number(request.headers.get("Content-Length")) > 150_000) throw new FeedbackError(413, "入力内容が長すぎます。");
  const reader = request.body?.getReader();
  if (!reader) throw new FeedbackError(400, "入力内容を確認してください。");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > 150_000) { await reader.cancel(); throw new FeedbackError(413, "入力内容が長すぎます。"); }
    chunks.push(item.value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const result: unknown = JSON.parse(new TextDecoder().decode(data));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("invalid");
    return result as Record<string, unknown>;
  } catch { throw new FeedbackError(400, "入力内容を確認してください。"); }
}
function sameOrigin(request: Request, participant: FeedbackIdentity | null) {
  const origin = request.headers.get("Origin");
  if (request.headers.get("Sec-Fetch-Site") === "cross-site" || (origin ? origin !== new URL(request.url).origin : !(participant?.role === "owner" && request.headers.has("Authorization")))) throw new FeedbackError(403, "このページからもう一度お試しください。");
}
async function response(request: Request, env: FeedbackEnv): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const method = request.method;
  if (!path.startsWith("/api/feedback/")) return json({ error: "見つかりませんでした。" }, 404);
  if (!configured(env)) {
    if (path === "/api/feedback/session" && method === "GET") return json({ identity: null, configured: false });
    throw new FeedbackError(503, "コメントの準備がまだ完了していません。");
  }
  const bucket = env.FEEDBACK_BUCKET!;
  let config: FeedbackSettings;
  try { config = await settings(bucket, env.FEEDBACK_ACCESS_CODE); }
  catch (error) {
    if (path === "/api/feedback/session" && method === "GET" && error instanceof FeedbackError && error.status === 503) return json({ identity: null, configured: false });
    throw error;
  }
  const participant = await identity(request, env, config);
  if (!["GET", "HEAD"].includes(method)) sameOrigin(request, participant);
  if (path === "/api/feedback/session") {
    if (method === "GET") return json({ identity: participant, configured: true });
    if (method === "DELETE") return json({ identity: null, configured: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
    if (method === "POST") {
      const input = await body(request);
      const client = await hash(`${env.FEEDBACK_SESSION_SECRET}|${request.headers.get("CF-Connecting-IP") ?? "unknown"}`);
      await loginAttempt(bucket, client);
      let next: FeedbackIdentity;
      let version: string;
      if (typeof input.ownerKey === "string" && input.ownerKey.length <= 256 && await equal(input.ownerKey, env.FEEDBACK_OWNER_SECRET!)) {
        next = { id: "owner", name: "本人", role: "owner" }; version = await hash(env.FEEDBACK_OWNER_SECRET!);
      } else if (!Object.hasOwn(input, "ownerKey") && typeof input.code === "string" && input.code.length <= 100 && await equal(input.code, config.accessCode)) {
        next = { id: crypto.randomUUID(), name: participantName(input.name), role: "teacher" }; version = config.version;
      } else throw new FeedbackError(401, "アクセスコードを確認して、もう一度入力してください。");
      const token = await signed({ ...next, exp: Date.now() + MAX_AGE * 1000, version }, env.FEEDBACK_SESSION_SECRET!);
      return json({ identity: next, configured: true }, 200, { "Set-Cookie": cookie(request, token) });
    }
    return json({ error: "この操作は利用できません。" }, 405);
  }
  if (!participant) throw new FeedbackError(401, "お名前とアクセスコードを入力してください。");
  if (path === "/api/feedback/settings") {
    if (participant.role !== "owner") throw new FeedbackError(403, "この操作は本人のみ利用できます。");
    if (method === "GET") return json({ accessCode: config.accessCode });
    if (method === "PATCH") {
      const input = await body(request);
      if (typeof input.accessCode !== "string") throw new FeedbackError(400, "アクセスコードを入力してください。");
      config = await rotateCode(bucket, input.accessCode.trim());
      return json({ accessCode: config.accessCode });
    }
    return json({ error: "この操作は利用できません。" }, 405);
  }
  if (path === "/api/feedback/threads") {
    if (method === "GET") return json({ threads: await listThreads(bucket, participant) });
    if (method === "POST") return json({ thread: await createThread(bucket, participant, await body(request)) }, 201);
    return json({ error: "この操作は利用できません。" }, 405);
  }
  const match = path.match(/^\/api\/feedback\/threads\/([a-zA-Z0-9_-]{8,80})(?:\/(replies|read))?$/);
  if (!match) return json({ error: "見つかりませんでした。" }, 404);
  const [, id, action] = match;
  if (!action && method === "GET") return json({ thread: await getThread(bucket, id, participant) });
  if (!action && method === "PATCH") return json({ thread: await changeThread(bucket, participant, id, await body(request)) });
  if (action === "replies" && method === "POST") return json({ thread: await reply(bucket, participant, id, await body(request)) }, 201);
  if (action === "read" && method === "POST") { await markRead(bucket, participant, id, await body(request)); return json({ ok: true }); }
  return json({ error: "この操作は利用できません。" }, 405);
}
export async function handleFeedbackRequest(request: Request, env: FeedbackEnv): Promise<Response> {
  try { return await response(request, env); }
  catch (error) {
    if (error instanceof FeedbackError) return json({ error: error.message }, error.status);
    // 不把正文、密钥或存储内部错误写入日志或返回给访客。
    return json({ error: "コメントを読み込めませんでした。少し待ってから、もう一度お試しください。" }, 503);
  }
}
