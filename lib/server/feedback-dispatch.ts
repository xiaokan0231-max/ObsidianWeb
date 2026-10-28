import { handleFeedbackRequest, type FeedbackEnv } from "./feedback-handler.ts";

export type FeedbackDispatchEnv = FeedbackEnv & {
  OBSIDIAN_DATA_SOURCE?: string;
  FEEDBACK_REMOTE_URL?: string;
};

const privateHeaders = { "Cache-Control": "no-store, private", Vary: "Cookie" };

export async function dispatchFeedbackRequest(request: Request, env: FeedbackDispatchEnv): Promise<Response> {
  if (env.OBSIDIAN_DATA_SOURCE === "published" || !env.FEEDBACK_REMOTE_URL) {
    return handleFeedbackRequest(request, env);
  }
  const local = new URL(request.url);
  // 本机工作台可自动使用本人身份，但不能把这个能力暴露给外部 Host 或跨站请求。
  if (!["localhost", "127.0.0.1", "[::1]"].includes(local.hostname)) {
    return Response.json({ error: "この画面からは接続できません。" }, { status: 403, headers: privateHeaders });
  }
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((origin && origin !== local.origin) || (site && !["same-origin", "none"].includes(site)) ||
    (!["GET", "HEAD"].includes(request.method) && origin !== local.origin)) {
    return Response.json({ error: "この画面からもう一度お試しください。" }, { status: 403, headers: privateHeaders });
  }
  if (!env.FEEDBACK_OWNER_SECRET) {
    return Response.json({ error: "コメントの接続を準備しています。" }, { status: 503, headers: privateHeaders });
  }
  try {
    const remote = new URL(env.FEEDBACK_REMOTE_URL);
    if (remote.protocol !== "https:") throw new Error("Invalid feedback origin");
    const target = new URL(local.pathname + local.search, remote.origin);
    const headers = new Headers({
      Authorization: `Bearer ${env.FEEDBACK_OWNER_SECRET}`,
      Origin: remote.origin,
      Accept: "application/json",
    });
    if (request.headers.has("content-type")) headers.set("content-type", request.headers.get("content-type")!);
    const response = await fetch(target, {
      method: request.method, headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: "error", signal: AbortSignal.timeout(20000),
    });
    // 远端 Cookie 不复制到 localhost；管理权限始终留在服务端代理中。
    return new Response(response.body, {
      status: response.status,
      headers: { ...privateHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return Response.json({ error: "コメントに接続できませんでした。時間をおいて、もう一度お試しください。" }, { status: 502, headers: privateHeaders });
  }
}
