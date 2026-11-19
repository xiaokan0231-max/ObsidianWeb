"use client";

import { useEffect, useRef, useState } from "react";
import type { CompanyComparisonAnalysis, CompanyComparisonAnalysisError, CompanyComparisonEvidence, ComparisonPoint } from "@/lib/company-comparison-analysis";
import { useUiLocale } from "./ui-locale";
import { useCompanyCopy } from "./company-copy";

type Failure = CompanyComparisonAnalysisError | "request";
type AnalysisState =
  | { key: string; loading: true }
  | { key: string; result: CompanyComparisonAnalysis }
  | { key: string; error: Failure };

const errorLabels: Record<Failure, string> = {
  local_only: "AI 分析可在本机版使用。",
  invalid_selection: "请重新选择要比较的公司。",
  stale_revision: "资料已更新，重新读取后可再次分析。",
  insufficient_evidence: "所选公司的公开来源资料太少，暂时无法生成有依据的对比。",
  openai_config: "请检查本机配置的 OpenAI Key 和模型权限。",
  openai_credit: "当前 OpenAI API 组织的可用额度不足。",
  openai_busy: "OpenAI 请求达到频率限制，请稍后重试。",
  openai_timeout: "OpenAI 响应超时，可以重试。",
  openai_unavailable: "本次未能生成完整分析，可以重试。",
  request: "暂时无法读取分析结果，可以重试。",
};

export function useCompanyAiAnalysis(revision: string | undefined, paths: string[], ready: boolean) {
  const { locale } = useUiLocale();
  const key = JSON.stringify([revision, paths, locale]);
  const [state, setState] = useState<AnalysisState | null>(null);
  const inFlight = useRef<{ key: string; controller: AbortController } | null>(null);
  const current = state?.key === key ? state : null;

  // 选择、资料版本或语言变化后，只显示当前请求的结果。
  useEffect(() => () => {
    if (inFlight.current?.key !== key) return;
    inFlight.current.controller.abort();
    inFlight.current = null;
  }, [key]);

  async function generate() {
    if (!ready || !revision || inFlight.current?.key === key) return;
    inFlight.current?.controller.abort();
    const controller = new AbortController();
    inFlight.current = { key, controller };
    setState({ key, loading: true });
    try {
      const response = await fetch("/api/interview/company-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, paths, locale }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(65_000)]),
      });
      const body = await response.json().catch(() => null) as CompanyComparisonAnalysis | { code?: CompanyComparisonAnalysisError } | null;
      if (controller.signal.aborted) return;
      if (response.ok && body && "companies" in body) setState({ key, result: body });
      else setState({ key, error: body && "code" in body && body.code && Object.hasOwn(errorLabels, body.code) ? body.code : "request" });
    } catch (error) {
      if (!controller.signal.aborted) setState({ key, error: error instanceof DOMException && error.name === "TimeoutError" ? "openai_timeout" : "request" });
    } finally {
      if (inFlight.current?.controller === controller) inFlight.current = null;
    }
  }

  return {
    result: current && "result" in current ? current.result : null,
    error: current && "error" in current ? current.error : null,
    loading: Boolean(current && "loading" in current),
    generate,
  };
}

function EvidenceList({ entries }: { entries: CompanyComparisonEvidence[] }) {
  const t = useCompanyCopy();
  if (!entries.length) return null;
  return <details className="cc-ai-evidence">
    <summary>{t("依据")} · {entries.length}</summary>
    <ul>{entries.map((entry) => <li key={entry.id}>
      <strong>{entry.label}</strong> · {entry.value}
      {(entry.scope || entry.asOf) && <small>{[entry.scope, entry.asOf].filter(Boolean).join(" · ")}</small>}
      <div>{(entry.sources ?? entry.sourceLabels.map((label) => ({ label, url: undefined }))).map((source, index) =>
        source.url && /^https?:\/\//i.test(source.url)
          ? <a key={index} href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>
          : <span key={index}>{source.label}</span>)}</div>
    </li>)}</ul>
  </details>;
}

function Points({ points, evidence }: { points: ComparisonPoint[]; evidence: Map<string, CompanyComparisonEvidence> }) {
  const t = useCompanyCopy();
  if (!points.length) return <span className="co-muted">{t("尚无足够依据")}</span>;
  return <ul className="cc-ai-points">{points.map((point, index) =>
    <li key={index}>{point.text}<EvidenceList entries={point.evidenceIds.flatMap((id) => {
      const item = evidence.get(id);
      return item ? [item] : [];
    })} /></li>)}</ul>;
}

function TextPoints({ points }: { points: string[] }) {
  const t = useCompanyCopy();
  return points.length ? <ul className="cc-ai-points">{points.map((text, index) => <li key={index}>{text}</li>)}</ul>
    : <span className="co-muted">—<span className="sr-only">{t("无补充项")}</span></span>;
}

export function CompanyAiAnalysisPanel({ analysis, ready, onReload }: {
  analysis: ReturnType<typeof useCompanyAiAnalysis>;
  ready: boolean;
  onReload?: () => void;
}) {
  const t = useCompanyCopy();
  const { result, loading, error, generate } = analysis;
  const reload = error === "stale_revision";
  if (!result) {
    return <div className="cc-ai-start">
      {loading ? <p role="status">{t("正在分析所选公司的优势和取舍…")}</p> : <>
        {error && <p role="alert">{t(errorLabels[error])}</p>}
        <p>{t("发送所选公司的公开来源事实给 OpenAI，现场生成对比。")}</p>
        <button type="button" className="cc-ai-generate" disabled={!ready || (reload && !onReload)}
          onClick={reload ? onReload : () => void generate()}>
          {t(reload ? "重读资料" : error ? "重试分析" : "生成 AI 分析")}
        </button>
      </>}
    </div>;
  }

  const evidence = new Map(result.evidence.map((item) => [item.id, item]));
  const wide = result.companies.length > 4;
  return <section className="cc-ai-result" aria-label={t("AI 分析")}>
    <div className="cc-ai-summary">
      <h2>{t("最值得比较的差异")}</h2>
      <Points points={result.differences} evidence={evidence} />
    </div>
    <div className="co-board-scroll cc-ai-scroll" role="region" aria-label={t("各公司优势与取舍")} tabIndex={wide ? 0 : undefined}>
      <table className="co-board-table cc-ai-table" style={{ minWidth: 132 + result.companies.length * 190 }}>
        <caption className="sr-only">{t("各公司优势与取舍")}</caption>
        <colgroup><col className="co-board-label-column" />{result.companies.map((company) => <col key={company.path} />)}</colgroup>
        <thead><tr><th scope="col">{t("公司 / 岗位")}</th>{result.companies.map((company) =>
          <th scope="col" key={company.path}>{company.label}<small>{company.role}</small></th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">{t("优势")}</th>{result.companies.map((company) => <td key={company.path}><Points points={company.advantages} evidence={evidence} /></td>)}</tr>
          <tr><th scope="row">{t("短板与取舍")}</th>{result.companies.map((company) => <td key={company.path}><Points points={company.tradeoffs} evidence={evidence} /></td>)}</tr>
          <tr><th scope="row">{t("待核实")}</th>{result.companies.map((company) => <td key={company.path}><TextPoints points={company.unknowns} /></td>)}</tr>
          <tr><th scope="row">{t("面试追问")}</th>{result.companies.map((company) => <td key={company.path}><TextPoints points={company.questions} /></td>)}</tr>
        </tbody>
      </table>
    </div>
  </section>;
}
