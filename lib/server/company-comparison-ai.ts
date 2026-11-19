import type { CompanyComparisonAnalysis, CompanyComparisonEvidence } from "../company-comparison-analysis.ts";
import { INTERVIEW_RECORDS, type InterviewCatalog, type InterviewCompanyProjection, type InterviewCompareSummary } from "../interview-read-model.ts";
import { RequestRejectedError } from "./write-guards.ts";
import { readInterviewRecord } from "./interview-read-model.ts";

const COMPANY_FACT_IDS = ["business", "business_model", "employees", "team_size", "revenue", "capital", "founded", "ownership"];
const ROLE_FACT_IDS = ["role", "work_style", "location", "salary"];
const PRIVATE_TEXT = /\[\[|https?:\/\/|www\.|\S+@\S+\.\S+|(?:\+?\d{1,4}[ -])?\(?\d{2,4}\)?[ -]\d{2,4}[ -]\d{3,4}|(?<!\d)0\d{9,10}(?!\d)|候选人(?:本人|希望)|本人(?:希望|现职|经历|年収|年薪|在留|工资)|当前年收|前职年收|前職年収|現年収|希望年収|希望(?:薪资|年薪)|雇用契約書|在留資格|联系方式|连络先|連絡先|電話番号|手机号码|個人情報|面接官|会議(?:ID|リンク)|会议(?:ID|链接)|密码|パスコード|老师留言|老師留言/i;
const NO_VALUE = /^(待确认|未披露|未公开|未公開|非公表|非公開|不明|暂无资料)[。.]?$/u;
const PRIVATE_URL = /(?:^|[/?&#=_-])(?:token|signature|password|passcode|invite|invitation|auth|oauth|access_token)(?:[/?&#=_-]|$)/i;

type PublicSource = NonNullable<CompanyComparisonEvidence["sources"]>[number];
type Fact = { label: string; value: string; scope: string; asOf: string; sources: PublicSource[] };
type ModelFact = Pick<CompanyComparisonEvidence, "id" | "label" | "value" | "scope" | "asOf">;
type ModelCompany = { id: string; facts: ModelFact[] };
type AnalysisCompany = Omit<CompanyComparisonAnalysis["companies"][number], "path" | "label" | "role"> & { id: string };
export type ModelCompanyAnalysis = { companies: AnalysisCompany[]; differences: CompanyComparisonAnalysis["differences"] };

function safeText(text: string, limit: number) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean || PRIVATE_TEXT.test(clean.normalize("NFKC"))) return "";
  return clean.length > limit ? `${clean.slice(0, limit).trimEnd()}…` : clean;
}

function publicSource(source: { label: string; url?: string; wiki?: string }): PublicSource | null {
  if (source.wiki || !source.url || source.url.length > 2048) return null;
  try {
    const url = new URL(source.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".")
      || /\.(local|localhost|internal)$/i.test(url.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
      || PRIVATE_URL.test(decodeURIComponent(url.pathname + url.search + url.hash))) return null;
    return { label: safeText(source.label, 70) || url.hostname, url: url.href };
  } catch {
    return null;
  }
}

function factRows(company: InterviewCompanyProjection, summary: InterviewCompareSummary): Fact[] {
  const facts = COMPANY_FACT_IDS.flatMap((id) => company.profile?.facts.find((fact) => fact.id === id) ?? []);
  const conditions = ROLE_FACT_IDS.flatMap((id) => company.assessment?.data.contextFacts.find((fact) => fact.id === id) ?? []);
  const rows = [...facts, ...conditions].flatMap((fact): Fact[] => {
    const label = safeText(fact.label, 70);
    const value = safeText(fact.value, 280);
    const sources = fact.sources.map(publicSource);
    // 和公开来源混用的本机引用没有逐字对应关系，不能把整条摘录视作可发送事实。
    if (!label || !value || NO_VALUE.test(value) || !sources.length || sources.some((source) => source === null)) return [];
    return [{ label, value, asOf: safeText(fact.asOf, 40), scope: safeText(fact.scope, 145), sources: sources.filter((source) => source !== null).slice(0, 3) }];
  });
  const ratingRows = summary.reviews.flatMap((review): Fact[] => {
    const source = publicSource({ label: review.platform, url: review.url });
    if (!source) return [];
    const sample = review.sampleCount === null ? "样本数量未确认" : `样本数 ${review.sampleCount} ${safeText(review.sampleUnit, 20)}`.trimEnd();
    return [{
      label: `${review.platform} 平台评分`, value: `${review.score} / ${review.scale}`,
      asOf: safeText(review.readOn, 40),
      scope: [sample, safeText(review.commentPeriod, 50), "平台样本，仅供参考"].filter(Boolean).join(" · "),
      sources: [source],
    }];
  });
  return [...rows, ...ratingRows];
}

/** 先核对目录中的正本路径，选中项仍按界面顺序分析。 */
export async function resolveCompanyComparisonAiContext(
  paths: string[],
  catalog: InterviewCatalog | null,
  readCompany: (path: string) => Promise<InterviewCompanyProjection | null>,
) {
  const byPath = new Map(catalog?.comparisons.map((item) => [item.path, item]));
  const selection = paths.map((path) => byPath.get(path));
  if (selection.some((item) => !item)) throw new RequestRejectedError("所选公司已变化，请刷新比较后重试。", 409);

  const projections = await Promise.all(paths.map(readCompany));
  const evidence: CompanyComparisonEvidence[] = [];
  const companies: ModelCompany[] = [];
  const labels = new Map<string, { path: string; label: string; role: string }>();
  for (const [index, path] of paths.entries()) {
    const projection = projections[index];
    const item = selection[index]!;
    if (projection?.kind !== "interview-company" || projection.sourcePath !== path) {
      throw new RequestRejectedError("所选公司已变化，请刷新比较后重试。", 409);
    }
    const id = `C${index + 1}`;
    labels.set(id, { path, label: item.shortName, role: item.displayRole });
    const facts = factRows(projection, item).map((row, factIndex) => {
      const { label, value, asOf, scope } = row;
      const fact = { id: `${id}-F${factIndex + 1}`, label, value, asOf, scope };
      evidence.push({ ...fact, path, sourceLabels: row.sources.map((source) => source.label), sources: row.sources });
      return fact;
    });
    // 路径、选择理由和来源链接留在本机。模型只需要列号及经过筛选的公开事实。
    companies.push({ id, facts });
  }
  return { companies, labels, evidence };
}

export async function readCompanyComparisonAiContext(paths: string[], revision: string) {
  const { readModelRuntime } = await import("../../app/read-model-server.ts");
  const { model, revision: pinnedRevision } = await readModelRuntime(revision);
  if (pinnedRevision !== revision) throw new RequestRejectedError("资料版本已变化，请刷新比较后重试。", 409);
  const catalog = await readInterviewRecord<InterviewCatalog>(model, revision, INTERVIEW_RECORDS.catalog, "root");
  return resolveCompanyComparisonAiContext(paths, catalog,
    (path) => readInterviewRecord<InterviewCompanyProjection>(model, revision, INTERVIEW_RECORDS.company, path));
}

export function formatCompanyComparisonAnalysis(
  result: ModelCompanyAnalysis,
  { companies, labels, evidence }: Awaited<ReturnType<typeof readCompanyComparisonAiContext>>,
): CompanyComparisonAnalysis {
  const byId = new Map(result.companies.map(({ id, ...report }) => [id, report]));
  const counts = new Map<string, number>();
  for (const { label } of labels.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
  const displayNames = new Map([...labels].map(([id, { label, role }]) =>
    [id, counts.get(label)! > 1 && role ? `${label}（${role}）` : label]));
  const replaceCompanyIds = (text: string) => text.replace(/\bC[1-8]\b/g, (id) => displayNames.get(id) ?? id);
  const renamePoints = (points: CompanyComparisonAnalysis["differences"]) =>
    points.map((point) => ({ ...point, text: replaceCompanyIds(point.text) }));
  return {
    companies: companies.map(({ id }) => {
      const { advantages, tradeoffs, unknowns, questions } = byId.get(id)!;
      return {
        ...labels.get(id)!,
        advantages: renamePoints(advantages),
        tradeoffs: renamePoints(tradeoffs),
        unknowns: unknowns.map(replaceCompanyIds),
        questions: questions.map(replaceCompanyIds),
      };
    }),
    differences: renamePoints(result.differences),
    evidence,
  };
}
