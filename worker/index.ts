/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { publishedRequestResponse } from "../lib/server/published-access";
import { createPublishedVaultResponseHandler } from "../lib/server/published-vault-response";
import { createCalendarReadModel } from "../lib/server/calendar-read-model";
import { dispatchFeedbackRequest, type FeedbackDispatchEnv } from "../lib/server/feedback-dispatch";
import { createSiteAccessGate, privateSiteResponse, type SiteAccessEnv } from "../lib/server/site-access";

interface Env extends FeedbackDispatchEnv, SiteAccessEnv {
  OBSIDIAN_DATA_SOURCE?: string;
  ASSETS: Fetcher;
  DB?: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const publishedResponses = new WeakMap<Fetcher, ReturnType<typeof createPublishedVaultResponseHandler>>();
const siteAccess = createSiteAccessGate();

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const published = env.OBSIDIAN_DATA_SOURCE === "published";
    if (published) {
      const denied = await siteAccess(request, env);
      if (denied) return denied;
    }
    // 留言有独立鉴权；只为这一组精确路径放行，不能解除其他资料的只读保护。
    if (url.pathname.startsWith("/api/feedback/")) {
      const response = await dispatchFeedbackRequest(request, env);
      return published ? privateSiteResponse(response) : response;
    }
    const guarded = publishedRequestResponse(request, published);
    if (guarded) return published ? privateSiteResponse(guarded) : guarded;

    // 线上先验证密码再取静态资源；ASSETS 绑定直接读取文件，不会重新进入业务 Worker。
    if (published && ["GET", "HEAD"].includes(request.method)) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return privateSiteResponse(asset);
    }

    if (published && ["/api/vault", "/api/calendar"].includes(url.pathname)) {
      let respond = publishedResponses.get(env.ASSETS);
      if (!respond) {
        respond = createPublishedVaultResponseHandler((asset) => env.ASSETS.fetch(asset), env.DB ? createCalendarReadModel(env.DB) : undefined);
        publishedResponses.set(env.ASSETS, respond);
      }
      const response = await respond(request, published);
      if (response) {
        return privateSiteResponse(response);
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return published ? privateSiteResponse(response) : response;
    }

    const response = await handler.fetch(request, env, ctx);
    if (!published) return response;
    return privateSiteResponse(response);
  },
};

export default worker;
