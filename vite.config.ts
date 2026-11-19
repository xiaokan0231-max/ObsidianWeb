import vinext from "vinext";
import { defineConfig, loadEnv, type ViteDevServer } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";
import { feedbackDevProxy } from "./build/feedback-dev-proxy";
import { warmReadModel } from "./scripts/warm-read-model.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  // 静态资源先由 Vite／Cloudflare 处理；强制先走业务路由会把开发模块和 CSS 当页面，返回 404。
  assets: { binding: "ASSETS" },
  compatibility_flags: [
    "nodejs_compat",
    "nodejs_compat_populate_process_env",
  ],
  vars: {
    OBSIDIAN_DATA_SOURCE: process.env.OBSIDIAN_DATA_SOURCE ?? "live",
    OBSIDIAN_API_URL:
      process.env.OBSIDIAN_API_URL ?? "http://127.0.0.1:27123",
    OBSIDIAN_API_KEY: process.env.OBSIDIAN_API_KEY ?? "",
    CODEX_BRIDGE_URL:
      process.env.CODEX_BRIDGE_URL ?? "http://127.0.0.1:43127",
    CODEX_BRIDGE_TOKEN: process.env.CODEX_BRIDGE_TOKEN ?? "",
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  // 留言管理凭据只注入开发环境，不随构建产物进入线上或公开源码。
  const feedbackVars = command === "serve" ? loadEnv("feedback", process.cwd(), "FEEDBACK_") : {};

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      feedbackDevProxy(feedbackVars),
      {
        name: "warm-local-read-model",
        apply: "serve",
        configureServer({ httpServer, config }: ViteDevServer) {
          if (!httpServer || !d1 || !localBindingConfig.vars.CODEX_BRIDGE_TOKEN || localBindingConfig.vars.OBSIDIAN_DATA_SOURCE !== "live") return;
          const controller = new AbortController();
          httpServer.once("close", () => controller.abort());
          // 冷启动由开发服务器完成索引导入，避免等待浏览器的有限次数重试逐批推进。
          httpServer.once("listening", () => {
            const address = httpServer.address();
            if (!address || typeof address === "string") return;
            const host = address.address === "::" ? "[::1]" : address.family === "IPv6" ? `[${address.address}]`
              : address.address === "0.0.0.0" ? "127.0.0.1" : address.address;
            void warmReadModel(`http://${host}:${address.port}`, { signal: controller.signal })
              .then(({ completedBatches, batchCount }) => config.logger.info(`本地资料索引已就绪（${completedBatches}/${batchCount}）`))
              .catch((error: unknown) => {
                if (!controller.signal.aborted) config.logger.warn(`本地资料索引预热失败：${error instanceof Error ? error.message : String(error)}`);
              });
          });
        },
      },
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: { ...localBindingConfig,
          // 生产的原始资料也必须先过密码门禁；开发继续由 Vite 直接提供模块资源。
          assets: { ...localBindingConfig.assets, ...(command === "build" ? { run_worker_first: true } : {}) },
          vars: { ...localBindingConfig.vars, ...feedbackVars } },
      }),
    ],
  };
});
