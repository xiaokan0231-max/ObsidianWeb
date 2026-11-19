import { COMPANY_COMPARE_LIMIT } from "@/lib/company-compare";
import type { CompanyComparisonAnalysisError } from "@/lib/company-comparison-analysis";
import { readJson } from "@/lib/server/api";
import { companyComparisonBridge } from "@/lib/server/codex-bridge";
import { formatCompanyComparisonAnalysis, readCompanyComparisonAiContext, type ModelCompanyAnalysis } from "@/lib/server/company-comparison-ai";
import { RequestRejectedError } from "@/lib/server/write-guards";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
type Input = { revision?: unknown; paths?: unknown; locale?: unknown };

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(code: CompanyComparisonAnalysisError, error: string, status: number) {
  return reply({ code, error }, status);
}

export async function POST(request: Request) {
  if (process.env.OBSIDIAN_DATA_SOURCE !== "live" || !LOCAL_HOSTS.has(new URL(request.url).hostname)) {
    return failure("local_only", "AI 分析仅在本机版可用。", 403);
  }
  try {
    const input = await readJson<Input | null>(request);
    const { revision, paths, locale = "zh-CN" } = input ?? {};
    if (typeof revision !== "string" || !revision.trim() || revision.length > 256
      || !Array.isArray(paths) || paths.length < 2 || paths.length > COMPANY_COMPARE_LIMIT
      || new Set(paths).size !== paths.length
      || paths.some((path) => typeof path !== "string" || path.length > 1024 || !path.endsWith(".md"))
      || (locale !== "ja" && locale !== "zh-CN")) {
      return failure("invalid_selection", "请选择 2 至 8 个不同的公司或岗位后再分析。", 400);
    }
    const context = await readCompanyComparisonAiContext(paths, revision);
    if (context.companies.filter((company) => company.facts.length).length < 2) {
      return failure("insufficient_evidence", "有可核对资料的公司不足两家。请选择资料较完整的公司再试。", 422);
    }
    const result = await companyComparisonBridge<ModelCompanyAnalysis>({ companies: context.companies, locale });
    return reply(formatCompanyComparisonAnalysis(result, context));
  } catch (error) {
    const rejected = error as { status?: number; code?: string } | null;
    if (rejected?.status === 409) return failure("stale_revision", "比较资料已更新，请重新加载后重试。", 409);
    if (!(error instanceof RequestRejectedError)) return failure("openai_unavailable", "暂时无法读取比较资料，请稍后重试。", 503);
    if (error.status === 403) return failure("local_only", "只接受本机比较页面发出的请求。", 403);
    if (error.status === 415) return failure("invalid_selection", "请求格式无效，请刷新页面后重试。", 415);
    if (rejected?.code === "openai_credit") return failure("openai_credit", error.message, error.status);
    if (error.status === 429) return failure("openai_busy", error.message, 429);
    if (error.status === 503) return failure("openai_config", error.message, 503);
    if (error.status === 504) return failure("openai_timeout", error.message, 504);
    return failure("openai_unavailable", error.message, error.status);
  }
}
