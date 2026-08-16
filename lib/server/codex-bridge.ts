import type { CodexRuntimeStatus } from "@/lib/dojo/types";

const BRIDGE_URL = (
  process.env.CODEX_BRIDGE_URL ?? "http://127.0.0.1:43127"
).replace(/\/$/, "");

function bridgeHeaders() {
  const token = process.env.CODEX_BRIDGE_TOKEN;
  if (!token) {
    throw new Error(
      "本地 Codex Bridge 未配置。请使用 npm run dev:obsidian 启动应用。",
    );
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * ここにクライアント側のタイムアウトは置かない。
 *
 * 上限はブリッジが task ごとに持っている（runProcess の timeoutMs、最長 480 秒）。
 * そのブリッジは受けた依頼を**直列キュー**（深さ4）で回すので、こちら側から見た
 * 待ち時間は「自分の実行時間」ではなく「前の依頼が終わるまで＋自分」になる。
 * 発行時刻から数える AbortSignal.timeout を被せると、正常に順番待ちしていただけの
 * 依頼が実行途中で切られる——一度そう書いて、レビューで指摘された。
 *
 * 「接続だけ受けて黙り込む」場合の保護は、呼ぶ側の構造で担保する：
 * 集中訓練の完了はこの呼び出しをキューの外に出してあるので、待たされても
 * 自動保存・退出時の保存はブロックされない（app/api/language/v2/batch/complete）。
 */
async function bridgeFetch(path: string, init: RequestInit) {
  try {
    const response = await fetch(`${BRIDGE_URL}${path}`, {
      ...init,
      headers: { ...bridgeHeaders(), ...(init.headers ?? {}) },
      cache: "no-store",
    });
    const result = (await response.json()) as {
      error?: string;
      output?: unknown;
      model?: string;
    };
    if (!response.ok) {
      throw new Error(result.error || `Codex Bridge 返回 ${response.status}`);
    }
    return result;
  } catch (error) {
    if (error instanceof Error && /Bridge|Codex|登录|API key/.test(error.message)) {
      throw error;
    }
    throw new Error(
      `无法连接本地 Codex Bridge。请使用 npm run dev:obsidian 启动。${
        error instanceof Error ? ` ${error.message}` : ""
      }`,
    );
  }
}

export async function getCodexRuntime(): Promise<CodexRuntimeStatus> {
  try {
    return (await bridgeFetch("/status", { method: "GET" })) as CodexRuntimeStatus;
  } catch (error) {
    return {
      bridge: "offline",
      authentication: "unknown",
      safeBilling: false,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function invokeCodex<T>(
  task:
    | "rebuild_profile"
    | "generate_exam"
    | "grade_exam"
    | "company_prep"
    | "fact_proposal"
    | "generate_lesson"
    | "coach_practice"
    | "rebuild_language_bank"
    | "expand_language_category"
    | "coach_language_output"
    | "grade_language_exam"
    | "review_interview_answers",
  payload: Record<string, unknown>,
) {
  const result = await bridgeFetch("/invoke", {
    method: "POST",
    body: JSON.stringify({ task, payload }),
  });
  return {
    output: result.output as T,
    model: result.model ?? "unknown",
  };
}
