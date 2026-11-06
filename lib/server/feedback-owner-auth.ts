/** 只给已有留言动作开放服务端凭据；不能让同一密钥成为站点其它接口的通行证。 */
export async function isFeedbackOwnerRequest(request: Request, env: { FEEDBACK_OWNER_SECRET?: string }): Promise<boolean> {
  const path = new URL(request.url).pathname;
  const method = request.method;
  const allowed = (path === "/api/feedback/session" && ["GET", "POST", "DELETE"].includes(method))
    || (path === "/api/feedback/settings" && ["GET", "PATCH"].includes(method))
    || (path === "/api/feedback/threads" && ["GET", "POST"].includes(method))
    || (["/api/feedback/summaries", "/api/feedback/unread"].includes(path) && method === "GET")
    || (/^\/api\/feedback\/threads\/[a-zA-Z0-9_-]{8,80}$/u.test(path) && ["GET", "PATCH"].includes(method))
    || (/^\/api\/feedback\/threads\/[a-zA-Z0-9_-]{8,80}\/(?:replies|read)$/u.test(path) && method === "POST");
  if (!allowed || !env.FEEDBACK_OWNER_SECRET || env.FEEDBACK_OWNER_SECRET.length < 32) return false;
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 1024) return false;
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([authorization.slice(7), env.FEEDBACK_OWNER_SECRET]
    .map(value => crypto.subtle.digest("SHA-256", encoder.encode(value))));
  const left = new Uint8Array(actual), right = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}
