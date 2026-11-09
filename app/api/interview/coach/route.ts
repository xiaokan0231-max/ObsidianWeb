import { badRequestError, parseRequiredText, readJson } from "@/lib/server/api";
import { interviewChatBridge } from "@/lib/server/codex-bridge";
import { readInterviewAiContext } from "@/lib/server/interview-ai-context";
import { readModelHash } from "@/lib/server/read-model-build";
import { RequestRejectedError } from "@/lib/server/write-guards";

type ChatMessage = { role: "user" | "assistant"; content: string };
type CoachInput = { action?: unknown; path?: unknown; revision?: unknown; digest?: unknown; messages?: unknown; includePrivatePrep?: unknown };
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function chatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || !value.length || value.length > 7 || value.length % 2 !== 1) {
    throw badRequestError("对话内容无效，请重新发送。");
  }
  return value.map((item, index) => {
    const role = index % 2 === 0 ? "user" : "assistant";
    const maxLength = role === "user" ? 2000 : 4000;
    if (!item || item.role !== role || typeof item.content !== "string" || item.content.length > maxLength || !item.content.trim()) {
      throw badRequestError("对话格式无效，单个问题最多 2000 字。");
    }
    return { role, content: item.content.trim() };
  });
}

export async function POST(request: Request) {
  if (process.env.OBSIDIAN_DATA_SOURCE !== "live" || !LOCAL_HOSTS.has(new URL(request.url).hostname)) {
    return reply({ error: "AI 对话仅在本机版可用。" }, 403);
  }
  try {
    const input = await readJson<CoachInput | null>(request);
    if (!input || (input.action !== "preview" && input.action !== "chat")) throw badRequestError("请求操作无效。");
    const path = parseRequiredText(input.path, "面试准备稿");
    const revision = parseRequiredText(input.revision, "资料版本");
    if (input.includePrivatePrep !== undefined && typeof input.includePrivatePrep !== "boolean") {
      throw badRequestError("准备资料的发送范围无效。");
    }
    const includePrivatePrep = input.includePrivatePrep === true;
    const messages = input.action === "chat" ? chatMessages(input.messages) : null;
    if (!messages) {
      const status = await interviewChatBridge<{ configured: boolean }>({ method: "GET" });
      if (!status.configured) return reply({ error: "本机尚未配置面试对话的 OpenAI Key。" }, 503);
    }

    const { sources, limited, usingPrivatePrep } = await readInterviewAiContext(path, revision, includePrivatePrep);
    const digest = await readModelHash(JSON.stringify({ path, revision, includePrivatePrep, sources }));
    if (!messages) return reply({ sources, digest, limited, usingPrivatePrep });
    if (input.digest !== digest) return reply({ error: "面试资料已变化，请重新查看发送范围。" }, 409);

    const result = await interviewChatBridge<{ answer: string; evidenceIds: string[] }>({
      method: "POST",
      body: JSON.stringify({ sources, messages }),
    });
    return reply(result);
  } catch (error) {
    if (error instanceof RequestRejectedError) return reply({ error: error.message }, error.status);
    const status = error instanceof Error ? (error as { status?: number }).status : undefined;
    if (status === 400) return reply({ error: "对话请求无效，请刷新页面或缩短问题后重试。" }, 400);
    if (status === 409) return reply({ error: "面试资料版本已变化，请刷新页面后重试。" }, 409);
    return reply({ error: "暂时无法读取本场面试资料，请稍后再试。" }, 503);
  }
}
