import type { Plugin } from "vite";
import { dispatchFeedbackRequest } from "../lib/server/feedback-dispatch";

// 本机的 Node 服务负责远端连接，避免开发用 Worker 的网络模拟层阻断 HTTPS。
// 这个插件仅用于 serve，管理凭据不会被编译进 Worker 或浏览器资源。
export function feedbackDevProxy(values: Record<string, string>): Plugin {
  return {
    name: "feedback-local-proxy", apply: "serve", enforce: "pre",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!values.FEEDBACK_REMOTE_URL || !request.url?.startsWith("/api/feedback/")) return next();
        try {
          const chunks: Uint8Array[] = [];
          let length = 0;
          for await (const chunk of request) {
            length += chunk.length;
            if (length > 150000) {
              response.writeHead(413, { "Content-Type": "application/json", "Cache-Control": "no-store" });
              response.end(JSON.stringify({ error: "入力内容が長すぎます。" })); return;
            }
            chunks.push(chunk);
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers)) {
            if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const body = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
          const method = request.method ?? "GET";
          const result = await dispatchFeedbackRequest(new Request(`http://${request.headers.host}${request.url}`, {
            method, headers, body: ["GET", "HEAD"].includes(method) ? undefined : body.buffer,
          }), { ...values, OBSIDIAN_DATA_SOURCE: "live" });
          response.writeHead(result.status, Object.fromEntries(result.headers));
          response.end(Buffer.from(await result.arrayBuffer()));
        } catch (error) { next(error); }
      });
    },
  };
}
