import { settingsConnectionStatus } from "@/lib/ui-settings";

/*
 * 设置中心「数据与连接」用：Obsidian 地址的主机与端口、密钥配没配、vault 路径变量传没传进来。
 *
 * 为什么只回布尔值：OBSIDIAN_API_KEY 与 CODEX_BRIDGE_TOKEN 兼作语言批次的签名密钥，
 * 任何一段出现在响应里都等于把签名能力交给能打开这个页面的人。地址也只取 host:port，
 * 写在 URL 里的认证段、路径与查询串不回传。只读，不改任何配置。
 */
export async function GET() {
  return Response.json(settingsConnectionStatus(process.env), {
    headers: { "Cache-Control": "no-store" },
  });
}
