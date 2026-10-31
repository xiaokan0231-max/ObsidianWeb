export type SiteAccessEnv = {
  SITE_ACCESS_PASSWORD?: string;
  SITE_ACCESS_SESSION_SECRET?: string;
};

const COOKIE = "__Host-obsidian_access";
const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function headers(type: string) {
  return new Headers({ "Content-Type": type, "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin" });
}

function escape(value: string) {
  return value.replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function returnPath(value: string | null, origin: string) {
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/u.test(value)) return "/calendar";
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin || target.pathname.startsWith("//") || target.pathname.startsWith("/_site-access")) return "/calendar";
    return target.pathname + target.search;
  } catch { return "/calendar"; }
}

function loginPage(request: Request, next: string, error = "", status = 401) {
  const responseHeaders = headers("text/html; charset=utf-8");
  responseHeaders.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>访问密码 · 求职作战室</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111b17;color:#edf1eb;font:16px/1.7 system-ui,sans-serif}main{width:min(420px,calc(100% - 40px));padding:36px;border:1px solid #34453b;border-radius:14px;background:#1b2921}small{color:#9bc5ac}h1{font-size:26px;margin:8px 0 10px}p{color:#b5c3b9;margin:0 0 24px}label{display:block;margin-bottom:7px}input,button{width:100%;border-radius:7px;padding:12px 14px;font:inherit}input{color:#edf1eb;background:#111b17;border:1px solid #53645a}input:focus{outline:2px solid #9bc5ac;outline-offset:2px}button{margin-top:18px;cursor:pointer;background:#b6d6bf;color:#17241c;border:0;font-weight:600}.error{color:#ffb6a6;margin:12px 0 0;font-size:14px}</style>
<main><small>求职作战室</small><h1>请输入访问密码</h1><p>此站点包含个人资料，输入密码后即可继续浏览。</p><form method="post" action="/_site-access/login"><input type="hidden" name="next" value="${escape(next)}"><label for="password">访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus>${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}<button type="submit">进入</button></form></main></html>`;
  return new Response(request.method === "HEAD" ? null : html, { status, headers: responseHeaders });
}

function json(request: Request, status: number, code: string, error: string) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify({ error, code }), { status, headers: headers("application/json; charset=utf-8") });
}

function redirect(location: string, cookie?: string) {
  const responseHeaders = headers("text/plain; charset=utf-8");
  responseHeaders.set("Location", location);
  if (cookie) responseHeaders.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers: responseHeaders });
}

function cookie(value: string, clear = false) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax${clear ? "; Max-Age=0" : ""}`;
}

async function key(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function message(expiration: number, password: string) {
  // 将当前密码绑定到签名；改密码后旧会话立即失效，但令牌不携带密码。
  return encoder.encode(`site-access-v1\n${expiration}\n${password}`);
}

async function signedSession(expiration: number, password: string, secret: string) {
  const signature = await crypto.subtle.sign("HMAC", await key(secret), message(expiration, password));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return `v1.${expiration}.${encoded}`;
}

async function hasSession(request: Request, password: string, secret: string, now: number) {
  const token = request.headers.get("Cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token) return false;
  const match = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/u.exec(token);
  if (!match) return false;
  const expiration = Number(match[1]);
  if (expiration <= now || expiration > now + SESSION_SECONDS) return false;
  try {
    const signature = Uint8Array.from(atob(match[2].replaceAll("-", "+").replaceAll("_", "/") + "="), character => character.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", await key(secret), signature, message(expiration, password));
  } catch { return false; }
}

async function equalPassword(actual: string, expected: string) {
  const [left, right] = await Promise.all([actual, expected].map(value => crypto.subtle.digest("SHA-256", encoder.encode(value))));
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function formBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return new URLSearchParams();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 4096) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return new URLSearchParams(new TextDecoder().decode(body));
}

/** Worker 最外层门禁；不能只保护页面路由，否则静态资料和接口仍可被直链读取。 */
export function createSiteAccessGate({ now = Date.now }: { now?: () => number } = {}) {
  const failures = new Map<string, { count: number; until: number }>();
  return async function siteAccessResponse(request: Request, env: SiteAccessEnv): Promise<Response | null> {
    const password = env.SITE_ACCESS_PASSWORD, secret = env.SITE_ACCESS_SESSION_SECRET;
    if (!password || !secret) return json(request, 503, "SITE_ACCESS_UNAVAILABLE", "访问密码暂未配置完成。");
    const url = new URL(request.url), seconds = Math.floor(now() / 1000);
    if (url.pathname === "/_site-access/login" || url.pathname === "/_site-access/logout") {
      if (request.method !== "POST") return json(request, 405, "METHOD_NOT_ALLOWED", "请通过密码页面提交。");
      if (request.headers.get("Origin") !== url.origin) return json(request, 403, "ORIGIN_REQUIRED", "请从本站密码页面进入。");
      if (url.pathname.endsWith("/logout")) return redirect("/_site-access", cookie("", true));
      if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return json(request, 415, "FORM_REQUIRED", "请使用密码表单。");
      const form = await formBody(request);
      if (!form) return json(request, 413, "BODY_TOO_LARGE", "提交内容过长。");
      const next = returnPath(form.get("next"), url.origin);
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const recent = failures.get(ip);
      if (recent && recent.until > seconds && recent.count >= 10) {
        const response = loginPage(request, next, "尝试次数较多，请稍后再试。", 429);
        response.headers.set("Retry-After", String(recent.until - seconds));
        return response;
      }
      if (!await equalPassword(form.get("password") ?? "", password)) {
        if (failures.size > 1000) for (const [address, entry] of failures) if (entry.until <= seconds) failures.delete(address);
        if (failures.size > 2000) failures.clear();
        failures.set(ip, recent && recent.until > seconds ? { ...recent, count: recent.count + 1 } : { count: 1, until: seconds + 60 });
        return loginPage(request, next, "密码不正确，请重新输入。");
      }
      failures.delete(ip);
      return redirect(next, cookie(await signedSession(seconds + SESSION_SECONDS, password, secret)));
    }
    if (url.pathname === "/_site-access") return loginPage(request, returnPath(url.searchParams.get("next"), url.origin));
    if (await hasSession(request, password, secret, seconds)) return null;
    if (["GET", "HEAD"].includes(request.method) && request.headers.get("Accept")?.includes("text/html")) return loginPage(request, url.pathname + url.search);
    return json(request, 401, "SITE_ACCESS_REQUIRED", "请输入访问密码。");
  };
}

export function privateSiteResponse(response: Response): Response {
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Cache-Control", "private, no-store");
  responseHeaders.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  // 聚合资料可能已是 gzip/br 字节；包裹缓存头时保留手动编码，避免平台再压缩一次。
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders,
    ...(responseHeaders.has("Content-Encoding") ? { encodeBody: "manual" as const } : {}) });
}
