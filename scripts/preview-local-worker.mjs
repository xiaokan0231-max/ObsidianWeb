import { unstable_dev } from "wrangler";

// 生产构建也使用本地 D1 模拟绑定；凭据只通过进程内配置传入，不写入归档。
const runtime = await unstable_dev("dist/server/index.js", {
  config: "dist/server/wrangler.json", bundle: false, local: true,
  ip: "127.0.0.1", port: Number(process.env.PORT || 3000), persist: true, persistTo: ".wrangler/state",
  vars: { OBSIDIAN_DATA_SOURCE: "live", OBSIDIAN_API_URL: process.env.OBSIDIAN_API_URL || "http://127.0.0.1:27123",
    OBSIDIAN_API_KEY: process.env.OBSIDIAN_API_KEY || "", CODEX_BRIDGE_URL: process.env.CODEX_BRIDGE_URL || "http://127.0.0.1:43127", CODEX_BRIDGE_TOKEN: process.env.CODEX_BRIDGE_TOKEN || "" },
  logLevel: "error", experimental: { disableExperimentalWarning: true, watch: false },
});
console.log(`Production Worker preview: http://localhost:${runtime.port}`);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await runtime.stop(); process.exit(0); });
await runtime.waitUntilExit();
