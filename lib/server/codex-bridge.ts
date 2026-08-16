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
 * ブリッジ側は task ごとに上限を持つ（最長 480 秒、scripts/codex-bridge.mjs）。
 * ここはその外側の兜底：接続だけ受けて黙り込まれた時、undici の既定（約 300 秒）まで
 * 待たされるのを避ける。ブリッジ自身の上限より長く取り、正常な長時間タスクは殺さない。
 */
const BRIDGE_TIMEOUT_MS = 540_000;

async function bridgeFetch(path: string, init: RequestInit) {
  try {
    const response = await fetch(`${BRIDGE_URL}${path}`, {
      ...init,
      headers: { ...bridgeHeaders(), ...(init.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
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
