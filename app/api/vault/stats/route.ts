import { errorResponse } from "@/lib/server/api";
import { invokeCodex } from "@/lib/server/codex-bridge";

/**
 * 派生統計（台帳・数据字典・面接傾向の generated 区块）を再計算する。
 *
 * Workers 実行時は本機スクリプトを起動できないので、状態を書いたルートは
 * `derivedState: "stale"` を返すだけだった——分析ページは古い台帳を読み続け、
 * 次の Claude Code の応答は Stop hook に止められる。ここは本機の codex-bridge
 * （宿主 Node、LLM は使わない）へ「vault:stats を走らせろ」と頼む窓口。
 */
export async function POST() {
  try {
    const result = await invokeCodex<{ ok: boolean; summary: string }>("vault_stats", {});
    return Response.json({ ok: true, summary: result.output?.summary ?? "" });
  } catch (error) {
    return errorResponse(error, "重算派生统计失败");
  }
}
