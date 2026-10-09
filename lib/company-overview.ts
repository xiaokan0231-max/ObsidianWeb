import { getString, getTitle, getType, stripFrontmatter, type Note } from "./notes.ts";
import { parseBlocks, parseInline, prepInlineText, type PrepInline } from "./interview-prep-doc.ts";
import { sliceSection, stripComments } from "./interview-prep-embed.mjs";

export const LEGACY_COMPANY_FIT_DIMENSIONS = [
  { key: "experience", label: "经验发挥" },
  { key: "business", label: "业务方向" },
  { key: "autonomy", label: "职责与裁量" },
  { key: "growth", label: "成长空间" },
  { key: "collaboration", label: "协作适配" },
  { key: "conditions", label: "工作条件" },
] as const;

export const COMPANY_FIT_DIMENSIONS = [
  { key: "technical", label: "技术匹配" },
  { key: "experience", label: "经验发挥" },
  { key: "business", label: "业务方向" },
  { key: "role", label: "职责方向" },
  { key: "growth", label: "成长方向" },
  { key: "practical", label: "已知条件" },
] as const;

export type CompanyFitCriteriaVersion = 1 | 2;
export type CompanyFitDimensionKey = typeof COMPANY_FIT_DIMENSIONS[number]["key"] |
  typeof LEGACY_COMPANY_FIT_DIMENSIONS[number]["key"];

/** 历史评价保留当时的轴与含义，不能用新标签重解释旧分数。 */
export function companyFitDimensions(criteriaVersion: CompanyFitCriteriaVersion) {
  return criteriaVersion === 1 ? LEGACY_COMPANY_FIT_DIMENSIONS : COMPANY_FIT_DIMENSIONS;
}
export type CompanyEvidence = { label: string; url?: string; wiki?: string };
export type CompanyFact = {
  id: string;
  label: string;
  value: string;
  asOf: string;
  scope: string;
  sources: CompanyEvidence[];
};
export type CompanyReview = {
  platform: string;
  url: string;
  status: "available" | "not_researched" | "no_samples" | "restricted";
  score: number | null;
  scale: number | null;
  sampleCount: number | null;
  commentPeriod: string;
  coverage: string;
  positive: string[];
  negative: string[];
  readOn: string;
  limitations: string;
};
export type CompanyProfile = {
  version: 1;
  updatedOn: string;
  facts: CompanyFact[];
  reviews: CompanyReview[];
};
export type CompanySummary = {
  note: Note;
  schemaVersion: 1;
  assessedOn: string;
  aiAuthor: string;
  coveragePeriod: string;
  paragraphs: PrepInline[][];
  sources: CompanyEvidence[];
};
export type CompanyFitDimension = {
  key: CompanyFitDimensionKey;
  label: string;
  score: number | null;
  rationale: string;
  evidence: CompanyEvidence[];
  unknowns: string[];
};
export type CompanyFitAssessment = {
  note: Note;
  schemaVersion: 1;
  criteriaVersion: CompanyFitCriteriaVersion;
  assessedOn: string;
  aiAuthor: string;
  summary: string;
  strengths: string[];
  questions: string[];
  dimensions: CompanyFitDimension[];
  contextFacts: CompanyFact[];
};
export type CompanyOverviewStatus = "available" | "missing" | "invalid";
export type CompanyOverview = {
  key: string;
  kind: "case" | "meeting";
  note: Note;
  company: string;
  title: string;
  caseId: string;
  dossier: Note | null;
  profile: CompanyProfile | null;
  summary: CompanySummary | null;
  assessment: CompanyFitAssessment | null;
  profileStatus: CompanyOverviewStatus;
  summaryStatus: CompanyOverviewStatus;
  assessmentStatus: CompanyOverviewStatus;
  issues: string[];
};

type ObjectValue = Record<string, unknown>;
type Parsed<T> = { value: T | null; issues: string[] };

function object(value: unknown): ObjectValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectValue : null;
}

function text(value: unknown) {
  const raw = getString(value).trim();
  // CLI 的旧标量读取器保留 YAML 引号；浏览器给的是解码后的值。
  return /^(["'])[\s\S]*\1$/.test(raw) ? raw.slice(1, -1) : raw;
}

function date(value: unknown) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : "";
}

function pathKey(value: string) {
  return value.trim().replace(/\.md$/i, "");
}

function wikiTarget(value: unknown) {
  return text(value).match(/^\[\[([^\]]+)\]\]$/)?.[1]?.split("|")[0]?.split("#")[0]?.trim() ?? "";
}

/** 显式路径优先；短名有多个匹配时绝不按公司显示名或文件顺序猜测。 */
export function resolveCompanyReference(notes: Note[], reference: string): Note | null {
  const target = pathKey(wikiTarget(reference) || reference);
  if (!target) return null;
  const exact = notes.filter((note) => pathKey(note.path) === target);
  const matches = exact.length ? exact : notes.filter((note) => pathKey(note.path).endsWith(`/${target}`));
  return matches.length === 1 ? matches[0] : null;
}

function explicitReference(notes: Note[], value: unknown, field: string, issues: string[]) {
  if (!wikiTarget(value)) {
    issues.push(`${field} 必须使用显式 [[笔记路径]] 引用`);
    return null;
  }
  const note = resolveCompanyReference(notes, text(value));
  if (!note) issues.push(`${field} 引用不存在或同名歧义，须写唯一完整路径`);
  return note;
}

function validUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function strings(value: unknown, field: string, issues: string[]) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    issues.push(`${field} 必须是非空文本组成的数组（无内容使用 []）`);
    return [];
  }
  return value.map((item) => item.trim() as string);
}

function evidence(value: unknown, field: string, issues: string[], notes: Note[]): CompanyEvidence[] {
  if (!Array.isArray(value)) {
    issues.push(`${field} 必须是来源数组`);
    return [];
  }
  return value.flatMap((item, index) => {
    const source = object(item);
    const label = text(source?.label);
    const url = text(source?.url);
    const wiki = text(source?.wiki);
    if (!source || !label || Number(Boolean(url)) + Number(Boolean(wiki)) !== 1) {
      issues.push(`${field}[${index}] 须有 label 及 url / wiki 二选一`);
      return [];
    }
    if (url && !validUrl(url)) {
      issues.push(`${field}[${index}].url 必须是完整 http(s) 地址`);
      return [];
    }
    if (wiki && !explicitReference(notes, wiki, `${field}[${index}].wiki`, issues)) return [];
    return [{ label, ...(url ? { url } : { wiki }) }];
  });
}

function facts(value: unknown, field: string, issues: string[], notes: Note[]): CompanyFact[] {
  if (!Array.isArray(value)) {
    issues.push(`${field} 必须是事实数组`);
    return [];
  }
  const ids = new Set<string>();
  return value.map((item, index) => {
    const fact = object(item);
    const id = text(fact?.id);
    const label = text(fact?.label);
    const value = text(fact?.value);
    const asOf = text(fact?.as_of);
    const scope = text(fact?.scope);
    const name = `${field}[${index}]`;
    if (!id || !label || !value || !asOf || !scope) issues.push(`${name} 须有 id / label / value / as_of / scope`);
    if (ids.has(id)) issues.push(`${field} 的 id ${id} 重复；不同口径须分别命名`);
    ids.add(id);
    const sources = evidence(fact?.sources, `${name}.sources`, issues, notes);
    if (!sources.length) issues.push(`${name} 缺少事实来源`);
    return { id, label, value, asOf, scope, sources };
  });
}

function summaryInlineIssues(nodes: PrepInline[], notes: Note[], issues: string[]) {
  for (const node of nodes) {
    if (node.kind === "link") {
      if (!validUrl(node.href)) issues.push("company-summary 正文链接必须是完整 http(s) 地址");
      summaryInlineIssues(node.children, notes, issues);
    } else if (node.kind === "strong") summaryInlineIssues(node.children, notes, issues);
    else if (node.kind === "ref") explicitReference(notes, `[[${node.target}]]`, "company-summary 正文引用", issues);
  }
}

function summarySection(body: string, title: string) {
  // 同名 H1 是报告标题，不能让通用切节器先匹配它而丢掉真正的 H2 正文。
  const headings = [...body.matchAll(/^##[ \t]+([^\r\n]+)$/gm)].filter((match) => match[1].trim() === title);
  return headings.length === 1 ? sliceSection(body.slice(headings[0].index), title) : null;
}

function parseSummary(note: Note, notes: Note[]): Parsed<CompanySummary> & { dossier: Note | null } {
  const issues: string[] = [];
  const fm = note.frontmatter;
  if (getType(note) !== "ai-report" || text(fm.report_kind) !== "company-summary") issues.push("company_summary 须引用 type: ai-report / report_kind: company-summary");
  if (text(fm.schema_version) !== "1") issues.push("company-summary schema_version 必须为 1");
  const assessedOn = date(fm.assessed_on);
  const aiAuthor = text(fm.ai_author);
  const coveragePeriod = text(fm.coverage_period);
  if (!assessedOn) issues.push("company-summary assessed_on 必须是真实 YYYY-MM-DD 日期");
  if (typeof fm.ai_author !== "string" || !aiAuthor || /^(ai|人工智能|unknown|不明|未记录)$/i.test(aiAuthor)) issues.push("company-summary 必须有具体 ai_author 署名");
  if (typeof fm.coverage_period !== "string" || !coveragePeriod) issues.push("company-summary coverage_period 必须是非空文本");
  const dossier = explicitReference(notes, fm.company_dossier, "company_dossier", issues);
  if (dossier && getType(dossier) !== "company") issues.push("company_dossier 必须指向 type: company");
  const sources = evidence(fm.sources, "company-summary sources", issues, notes);
  if (!sources.length) issues.push("company-summary sources 至少需要一项有效来源");

  // 研究边界留在完整报告；页面只取指定正文，避免把附录或旧版本一起带入。
  const body = stripComments(stripFrontmatter(note.content.replace(/\r\n/g, "\n")));
  const section = summarySection(body, "公司总结");
  const boundaries = summarySection(body, "资料与边界");
  if (!section) issues.push("company-summary 须有唯一的二级标题「公司总结」");
  if (!boundaries?.body.trim()) issues.push("company-summary 须有唯一且非空的二级标题「资料与边界」");
  const chunks: string[] = section?.body.trim() ? section.body.trim().split(/\n\s*\n/) : [];
  if (!chunks.length) issues.push("company-summary 公司总结正文不能为空");
  const paragraphs = chunks.map((chunk) => {
    const blocks = parseBlocks(chunk);
    if (!blocks.length || blocks.some((block) => block.kind !== "paragraph") || /!\[/.test(chunk)) issues.push("company-summary 公司总结只支持自然段，可使用 Markdown 加粗与链接");
    const inline = parseInline(chunk.replace(/\s*\n\s*/g, " "));
    if (!prepInlineText(inline).trim()) issues.push("company-summary 公司总结不可含空段落");
    summaryInlineIssues(inline, notes, issues);
    return inline;
  });
  return { dossier, issues, value: issues.length ? null : {
    note, schemaVersion: 1, assessedOn, aiAuthor, coveragePeriod, paragraphs, sources,
  } };
}

function summaryForDossier(dossier: Note, notes: Note[]): Parsed<CompanySummary> & { status: CompanyOverviewStatus } {
  if (dossier.frontmatter.company_summary === undefined) return { value: null, status: "missing", issues: [] };
  const issues: string[] = [];
  if (getType(dossier) !== "company") issues.push("company_summary 只能保存在 type: company 卷宗");
  const report = explicitReference(notes, dossier.frontmatter.company_summary, "company_summary", issues);
  let value: CompanySummary | null = null;
  if (report) {
    const parsed = parseSummary(report, notes);
    issues.push(...parsed.issues.map((issue) => `${report.path}: ${issue}`));
    if (parsed.dossier?.path !== dossier.path) issues.push("company_summary 的 company_dossier 与当前公司卷宗不符");
    value = parsed.value;
  }
  return { value: issues.length ? null : value, status: issues.length ? "invalid" : "available", issues };
}

function parseProfile(note: Note, notes: Note[]): Parsed<CompanyProfile> {
  const issues: string[] = [];
  const profile = object(note.frontmatter.company_profile);
  if (!profile) return { value: null, issues: ["company_profile 必须是结构化对象"] };
  if (getType(note) !== "company") issues.push("company_profile 只能保存在 type: company 卷宗");
  if (profile.version !== 1) issues.push("company_profile.version 必须为 1");
  const updatedOn = date(profile.updated_on);
  if (!updatedOn) issues.push("company_profile.updated_on 必须是真实 YYYY-MM-DD 日期");
  const profileFacts = facts(profile.facts, "company_profile.facts", issues, notes);
  const reviews: CompanyReview[] = [];
  if (!Array.isArray(profile.reviews)) issues.push("company_profile.reviews 必须是数组");
  else profile.reviews.forEach((item, index) => {
    const review = object(item);
    const name = `company_profile.reviews[${index}]`;
    const platform = text(review?.platform);
    const url = text(review?.url);
    const status = text(review?.status) as CompanyReview["status"];
    const score = review?.score ?? null;
    const scale = review?.scale ?? null;
    const sampleCount = review?.sample_count ?? null;
    const readOn = date(review?.read_on);
    const commentPeriod = text(review?.comment_period);
    const coverage = text(review?.coverage);
    const limitations = text(review?.limitations);
    if (!review || !platform) issues.push(`${name} 须有 platform`);
    if ((url && !validUrl(url)) || (["available", "restricted"].includes(status) && !validUrl(url))) issues.push(`${name} 已取得或受限资料须有完整 url`);
    if (!["available", "not_researched", "no_samples", "restricted"].includes(status)) issues.push(`${name}.status 不合法`);
    if (score !== null && (typeof score !== "number" || !Number.isFinite(score) || score < 0 ||
      typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0 || score > scale)) {
      issues.push(`${name} 评分必须保留有效原量尺，未知使用 null`);
    }
    if (scale !== null && (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0)) issues.push(`${name}.scale 不合法`);
    if (sampleCount !== null && (typeof sampleCount !== "number" || !Number.isInteger(sampleCount) || sampleCount < 0)) issues.push(`${name}.sample_count 不合法`);
    if (status === "not_researched" && (score !== null || scale !== null || sampleCount !== null)) issues.push(`${name} 未调查时不可提供评分或样本数`);
    if (status === "no_samples" && (score !== null || (sampleCount !== null && sampleCount !== 0))) issues.push(`${name} 无有效样本时不可提供评分或正样本数`);
    if (!readOn && status !== "not_researched") issues.push(`${name}.read_on 必须是真实 YYYY-MM-DD 日期`);
    if (!commentPeriod || !coverage || !limitations) issues.push(`${name} 须说明 comment_period / coverage / limitations（未知也要明示）`);
    const positive = strings(review?.positive, `${name}.positive`, issues);
    const negative = strings(review?.negative, `${name}.negative`, issues);
    if (["not_researched", "no_samples"].includes(status) && (positive.length || negative.length)) issues.push(`${name} 未取得评论样本时不可写评价主题`);
    reviews.push({ platform, url, status, score: score as number | null, scale: scale as number | null,
      sampleCount: sampleCount as number | null, commentPeriod, coverage, positive, negative, readOn, limitations });
  });
  return { value: issues.length ? null : { version: 1, updatedOn, facts: profileFacts, reviews }, issues };
}

function isMeeting(note: Note) {
  if (getType(note) !== "todo" || !text(note.frontmatter.company)) return false;
  const category = text(note.frontmatter.category);
  const event = text(note.frontmatter.next_event) || text(note.frontmatter.next_event_label);
  return /面接準備|面谈准备|面試準備/.test(category) ||
    (Boolean(text(note.frontmatter.next_event_at)) && /面接|面談|面试|面谈|interview|meeting/i.test(`${event} ${getTitle(note)}`));
}

function contextKind(note: Note): CompanyOverview["kind"] | null {
  if (getType(note) === "job-case") return "case";
  return isMeeting(note) ? "meeting" : null;
}

function reportContext(note: Note, notes: Note[], issues: string[]) {
  const fields = (["case", "meeting"] as const).filter((field) => note.frontmatter[field] !== undefined);
  if (fields.length !== 1) {
    issues.push("company-fit 必须有 case / meeting 二选一");
    return null;
  }
  const field = fields[0];
  const context = explicitReference(notes, note.frontmatter[field], field, issues);
  if (context && contextKind(context) !== field) {
    issues.push(`${field} 须指向真实 ${field === "case" ? "job-case" : "面谈 todo"} 正本`);
    return null;
  }
  return context;
}

function parseAssessment(note: Note, notes: Note[]): Parsed<CompanyFitAssessment> & { context: Note | null; dossier: Note | null } {
  const issues: string[] = [];
  const fm = note.frontmatter;
  if (getType(note) !== "ai-report" || text(fm.report_kind) !== "company-fit") issues.push("fit_assessment 须引用 type: ai-report / report_kind: company-fit");
  if (text(fm.schema_version) !== "1") issues.push("company-fit schema_version 必须为 1");
  const rawCriteriaVersion = text(fm.criteria_version);
  if (!["1", "2"].includes(rawCriteriaVersion)) issues.push("company-fit criteria_version 必须为 1 或 2");
  const criteriaVersion: CompanyFitCriteriaVersion = rawCriteriaVersion === "1" ? 1 : 2;
  const dimensionDefinitions = companyFitDimensions(criteriaVersion);
  const assessedOn = date(fm.assessed_on);
  const aiAuthor = text(fm.ai_author);
  if (!assessedOn) issues.push("company-fit assessed_on 必须是真实 YYYY-MM-DD 日期");
  if (!aiAuthor || /^(ai|人工智能|unknown|不明|未记录)$/i.test(aiAuthor)) issues.push("company-fit 必须有具体 ai_author 署名");
  const context = reportContext(note, notes, issues);
  const dossier = explicitReference(notes, fm.company_dossier, "company_dossier", issues);
  if (dossier && getType(dossier) !== "company") issues.push("company_dossier 必须指向 type: company");
  const assessment = object(fm.fit_assessment);
  if (!assessment) issues.push("company-fit fit_assessment 必须是结构化对象");
  const summary = text(assessment?.summary);
  if (!summary) issues.push("fit_assessment.summary 必填");
  const strengths = strings(assessment?.strengths, "fit_assessment.strengths", issues);
  const questions = strings(assessment?.questions, "fit_assessment.questions", issues);
  const sourceDimensions = object(assessment?.dimensions);
  if (!sourceDimensions) issues.push("fit_assessment.dimensions 必须含固定六维");
  for (const key of Object.keys(sourceDimensions ?? {})) {
    if (!dimensionDefinitions.some((dimension) => dimension.key === key)) issues.push(`fit_assessment.dimensions 在 criteria_version: ${criteriaVersion} 不支持 ${key}`);
  }
  const dimensions = dimensionDefinitions.map(({ key, label }) => {
    const dimension = object(sourceDimensions?.[key]);
    const field = `fit_assessment.dimensions.${key}`;
    const score = dimension?.score;
    const rationale = text(dimension?.rationale);
    if (!dimension || !(score === null || (typeof score === "number" && Number.isInteger(score) && score >= 1 && score <= 5))) issues.push(`${field}.score 必须为 1～5 整数或明确 null`);
    if (!rationale) issues.push(`${field}.rationale 必填`);
    const sources = evidence(dimension?.evidence, `${field}.evidence`, issues, notes);
    const unknowns = strings(dimension?.unknowns, `${field}.unknowns`, issues);
    if (score !== null && !sources.length) issues.push(`${field} 有分数时必须有证据`);
    if (score === null && !unknowns.length) issues.push(`${field} 未评分时必须说明待确认事项`);
    return { key, label, score: typeof score === "number" ? score : null, rationale, evidence: sources, unknowns };
  });
  const contextFacts = assessment?.context_facts === undefined ? [] : facts(assessment.context_facts, "fit_assessment.context_facts", issues, notes);
  return { context, dossier, issues, value: issues.length ? null : {
    note, schemaVersion: 1, criteriaVersion, assessedOn, aiAuthor, summary, strengths, questions, dimensions, contextFacts,
  } };
}

function dossierForContext(note: Note, notes: Note[], issues: string[]) {
  if (note.frontmatter.company_dossier !== undefined) {
    const dossier = explicitReference(notes, note.frontmatter.company_dossier, "company_dossier", issues);
    if (dossier && getType(dossier) !== "company") {
      issues.push("company_dossier 必须指向 type: company");
      return null;
    }
    return dossier;
  }
  // 旧正本尚未补链接时，只信同一显式 case / meeting 的旧准备稿。错链接不走兜底。
  const kind = contextKind(note)!;
  const candidates = notes.filter((candidate) => getType(candidate) === "interview-prep" &&
    Boolean(wikiTarget(candidate.frontmatter[kind])) &&
    resolveCompanyReference(notes, text(candidate.frontmatter[kind]))?.path === note.path &&
    candidate.frontmatter[kind === "case" ? "meeting" : "case"] === undefined &&
    candidate.frontmatter.company_dossier !== undefined);
  const dossiers = new Map<string, Note>();
  for (const prep of candidates) {
    const dossier = explicitReference(notes, prep.frontmatter.company_dossier, `${prep.path}: company_dossier`, issues);
    if (dossier && getType(dossier) === "company") dossiers.set(dossier.path, dossier);
    else if (dossier) issues.push(`${prep.path}: company_dossier 必须指向 type: company`);
  }
  if (dossiers.size > 1) issues.push("旧准备稿 company_dossier 指向不同卷宗，须在正本明确唯一引用");
  return !issues.length && dossiers.size === 1 ? [...dossiers.values()][0] : null;
}

function contextTitle(note: Note) {
  const fm = note.frontmatter;
  return text(fm.position) || text(fm.meeting_topic) ||
    (getType(note) === "job-case" ? getTitle(note).split(/\s[—–-]\s/).slice(1).join(" — ").trim() : "") || getTitle(note);
}

/** 最新画像跟随案件正本的显式引用；历史准备稿的正文与评分均不参与画像计算。 */
export function buildCompanyOverviews(notes: Note[]): CompanyOverview[] {
  return notes.flatMap((note) => {
    const kind = contextKind(note);
    if (!kind) return [];
    const issues: string[] = [];
    const dossier = dossierForContext(note, notes, issues);
    let profileStatus: CompanyOverviewStatus = issues.length ? "invalid" : "missing";
    let profile: CompanyProfile | null = null;
    if (dossier?.frontmatter.company_profile !== undefined) {
      const parsed = parseProfile(dossier, notes);
      profile = parsed.value;
      profileStatus = profile ? "available" : "invalid";
      issues.push(...parsed.issues.map((issue) => `${dossier.path}: ${issue}`));
    }
    const companySummary = dossier ? summaryForDossier(dossier, notes) : null;
    if (companySummary) issues.push(...companySummary.issues.map((issue) => `${dossier!.path}: ${issue}`));
    let assessment: CompanyFitAssessment | null = null;
    let assessmentStatus: CompanyOverviewStatus = "missing";
    if (note.frontmatter.fit_assessment !== undefined) {
      const report = explicitReference(notes, note.frontmatter.fit_assessment, "fit_assessment", issues);
      assessmentStatus = "invalid";
      if (report) {
        const parsed = parseAssessment(report, notes);
        const referenceIssues = [...parsed.issues];
        if (parsed.context?.path !== note.path) referenceIssues.push("fit_assessment 的 case / meeting 与当前正本不符");
        if (!dossier || parsed.dossier?.path !== dossier.path) referenceIssues.push("fit_assessment 的 company_dossier 与当前正本不符");
        issues.push(...referenceIssues.map((issue) => `${report.path}: ${issue}`));
        if (!referenceIssues.length) {
          assessment = parsed.value;
          assessmentStatus = "available";
        }
      }
    }
    return [{ key: `${kind}:${note.path}`, kind, note, company: text(note.frontmatter.company) || text(dossier?.frontmatter.company) || getTitle(note),
      title: contextTitle(note), caseId: text(note.frontmatter.case_id), dossier, profile, assessment,
      summary: companySummary?.value ?? null, summaryStatus: companySummary?.status ?? "missing",
      profileStatus, assessmentStatus, issues }];
  });
}

/** source 可为真实正本或准备稿；同公司不同岗位永不通过公司名合并。 */
export function resolveCompanyOverview(notes: Note[], source: Note | string): CompanyOverview | null {
  return resolveCompanyOverviewFrom(buildCompanyOverviews(notes), notes, source);
}

/**
 * 同上，但复用已算好的画像列表。本场面试页对每份准备稿各解析一遍全部画像（含 markdown），
 * 准备稿 × 案件数的平方级重算；页面已经持有 contexts，就不要再建一次。
 */
export function resolveCompanyOverviewFrom(contexts: CompanyOverview[], notes: Note[], source: Note | string): CompanyOverview | null {
  const note = typeof source === "string" ? resolveCompanyReference(notes, source) : source;
  if (!note) return null;
  const direct = contextKind(note);
  if (direct) return contexts.find((entry) => entry.note.path === note.path) ?? null;
  const fields = (["case", "meeting"] as const).filter((field) => note.frontmatter[field] !== undefined);
  if (fields.length !== 1) return null;
  const field = fields[0];
  if (!wikiTarget(note.frontmatter[field])) return null;
  const linked = resolveCompanyReference(notes, text(note.frontmatter[field]));
  return linked ? contexts.find((entry) => entry.kind === field && entry.note.path === linked.path) ?? null : null;
}

/** UI 与 CLI 共用同一份校验，未被正本采用的历史报告也不能藏住坏分数或坏引用。 */
export function validateCompanyOverviewNotes(notes: Note[]): string[] {
  const issues: string[] = [];
  for (const note of notes) {
    if (note.frontmatter.company_profile !== undefined) {
      issues.push(...parseProfile(note, notes).issues.map((issue) => `${note.path}: ${issue}`));
    }
    if (text(note.frontmatter.report_kind) === "company-fit") {
      issues.push(...parseAssessment(note, notes).issues.map((issue) => `${note.path}: ${issue}`));
    }
    if (text(note.frontmatter.report_kind) === "company-summary") {
      issues.push(...parseSummary(note, notes).issues.map((issue) => `${note.path}: ${issue}`));
    }
    if (note.frontmatter.company_summary !== undefined) {
      issues.push(...summaryForDossier(note, notes).issues.map((issue) => `${note.path}: ${issue}`));
    }
  }
  for (const entry of buildCompanyOverviews(notes)) {
    issues.push(...entry.issues.map((issue) => `${entry.note.path}: ${issue}`));
  }
  return [...new Set(issues)];
}
