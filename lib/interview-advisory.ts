import { ADVISORY_STAGES, INSIGHT_MODULE_KEYS } from "./interview-advisory-contract.mjs";
export { ADVISORY_STAGES, INSIGHT_MODULE_KEYS } from "./interview-advisory-contract.mjs";

/** 顾问评论独立于回答评分；引用必须可回到事实层，不能靠规范化静默删去坏证据。 */

export type AdvisoryEvidenceRef = { sourcePath: string; blockId: string; sentenceIds: string[] };
export type AdvisoryMeta = { generatedAt: string; model: string; sourceFingerprint: string };
export type AdvisoryValidationContext = {
  sources: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
  contextPaths: ReadonlySet<string>;
};
type EvidenceBearing = { evidence: AdvisoryEvidenceRef[]; contextPaths: string[] };
export type AdvisoryObservation = EvidenceBearing & {
  id: string; titleZh: string; observationZh: string; interpretationZh: string;
  alternativeZh: string; implicationZh: string;
};
export type AdvisoryAnswerOption = EvidenceBearing & {
  id: string; titleZh: string; situationZh: string; whyZh: string; answerJa: string;
  scope: "general" | "company";
};
export type AdvisoryNextStep = EvidenceBearing & {
  id: string; titleZh: string; detailZh: string; triggerZh: string;
};
export type InterviewAdvisory = AdvisoryMeta & EvidenceBearing & {
  version: 1;
  stage: (typeof ADVISORY_STAGES)[number];
  commentaryZh: string; fitZh: string; recommendationZh: string; changeConditionsZh: string;
  observations: AdvisoryObservation[];
  answerOptions: AdvisoryAnswerOption[];
  nextSteps: AdvisoryNextStep[];
};
export type InsightFinding = EvidenceBearing & {
  id: string; titleZh: string; bodyZh: string; boundaryZh: string;
};
export type InsightModule = {
  key: (typeof INSIGHT_MODULE_KEYS)[number]; titleZh: string; commentaryZh: string;
  findings: InsightFinding[];
};
export type InterviewInsights = AdvisoryMeta & { version: 1; overviewZh: string; modules: InsightModule[] };

const ADVISORY_START = "<!-- interview-advisory:start -->";
const ADVISORY_END = "<!-- interview-advisory:end -->";
const REVIEW_DATA_MARKER = "<!-- interview-answer-review-data -->";
const INSIGHTS_DATA_MARKER = "<!-- interview-insights-data -->";

function fail(message: string): never { throw new Error(`顾问复盘数据无效：${message}`); }
function object(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${at} 必须为对象`);
  return value as Record<string, unknown>;
}
function string(value: unknown, at: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) fail(`${at} 必须为非空字符串`);
}
function optionalText(value: unknown, at: string): asserts value is string {
  if (typeof value !== "string") fail(`${at} 必须为字符串，可留空`);
}
function array(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) fail(`${at} 必须为数组`);
  return value;
}
function fields(value: Record<string, unknown>, names: string[], at: string) {
  for (const name of names) string(value[name], `${at}.${name}`);
}
function sourcePath(value: unknown, at: string): asserts value is string {
  string(value, at);
  if (!value.startsWith("20_求職/") || !value.endsWith("_整理稿.md") || value.includes("..") || value.includes("\\")) {
    fail(`${at} 必须为完整的 Vault 整理稿相对路径`);
  }
}
function metadata(value: Record<string, unknown>) {
  if (value.version !== 1) fail("version 必须为 1");
  fields(value, ["generatedAt", "model", "sourceFingerprint"], "metadata");
  if (!Number.isFinite(Date.parse(value.generatedAt as string))) fail("generatedAt 不是有效时间");
}
function evidence(value: Record<string, unknown>, at: string, context?: AdvisoryValidationContext, cross = false) {
  const refs = array(value.evidence, `${at}.evidence`);
  if (refs.length === 0) fail(`${at} 缺少逐句证据`);
  const paths = new Set<string>();
  const seen = new Set<string>();
  for (const [index, raw] of refs.entries()) {
    const ref = object(raw, `${at}.evidence[${index}]`);
    sourcePath(ref.sourcePath, `${at}.sourcePath`);
    string(ref.blockId, `${at}.blockId`);
    if (!/^q\d+$/.test(ref.blockId)) fail(`${at}.blockId 必须为 qNN`);
    const ids = array(ref.sentenceIds, `${at}.sentenceIds`);
    if (!ids.length) fail(`${at} 的引用没有句子`);
    const allowed = context?.sources.get(ref.sourcePath)?.get(ref.blockId);
    if (context && !allowed) fail(`${at} 引用了不存在的来源或问题 ${ref.sourcePath}#${ref.blockId}`);
    for (const id of ids) {
      if (typeof id !== "string" || !/^s\d+[a-z]?$/.test(id)) fail(`${at} 的句子 ID 无效`);
      if (allowed && !allowed.has(id)) fail(`${at} 的 ${id} 不属于 ${ref.sourcePath}#${ref.blockId}`);
      const key = `${ref.sourcePath}\0${ref.blockId}\0${id}`;
      if (seen.has(key)) fail(`${at} 包含重复证据 ${id}`);
      seen.add(key);
    }
    paths.add(ref.sourcePath);
  }
  if (cross && paths.size < 2) fail(`${at} 的横向结论至少需要两个不同场次的完整来源路径`);
  const contexts = array(value.contextPaths, `${at}.contextPaths`);
  const contextSeen = new Set<string>();
  for (const path of contexts) {
    string(path, `${at}.contextPaths`);
    if (path.startsWith("/") || path.includes("..") || path.includes("\\") || !path.endsWith(".md")) {
      fail(`${at} 的背景引用必须为 Vault 相对笔记路径`);
    }
    if (context && !context.contextPaths.has(path)) fail(`${at} 引用了未提供的背景笔记 ${path}`);
    if (contextSeen.has(path)) fail(`${at} 包含重复背景引用 ${path}`);
    contextSeen.add(path);
  }
}
function itemId(value: Record<string, unknown>, at: string, seen: Set<string>) {
  string(value.id, `${at}.id`);
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value.id)) fail(`${at}.id 格式无效`);
  if (seen.has(value.id)) fail(`重复观点 ID ${value.id}`);
  seen.add(value.id);
}

export function validateInterviewAdvisory(value: unknown, context?: AdvisoryValidationContext): asserts value is InterviewAdvisory {
  const data = object(value, "advisory");
  metadata(data);
  if (!(ADVISORY_STAGES as readonly unknown[]).includes(data.stage)) fail("stage 无效");
  fields(data, ["commentaryZh", "fitZh", "recommendationZh", "changeConditionsZh"], "advisory");
  evidence(data, "advisory", context);
  const seen = new Set<string>();
  for (const key of ["observations", "answerOptions", "nextSteps"] as const) {
    for (const [index, raw] of array(data[key], key).entries()) {
      const at = `${key}[${index}]`;
      const item = object(raw, at);
      itemId(item, at, seen);
      fields(item, ["titleZh"], at);
      evidence(item, at, context);
      if (key === "observations") {
        fields(item, ["observationZh", "interpretationZh", "implicationZh"], at);
        optionalText(item.alternativeZh, `${at}.alternativeZh`);
      }
      if (key === "answerOptions") {
        fields(item, ["situationZh", "whyZh"], at);
        optionalText(item.answerJa, `${at}.answerJa`);
        if (item.scope !== "general" && item.scope !== "company") fail(`${at}.scope 无效`);
      }
      if (key === "nextSteps") fields(item, ["detailZh", "triggerZh"], at);
    }
  }
}

export function validateInterviewInsights(value: unknown, context?: AdvisoryValidationContext): asserts value is InterviewInsights {
  const data = object(value, "insights");
  metadata(data);
  fields(data, ["overviewZh"], "insights");
  const modules = array(data.modules, "modules");
  if (modules.length !== INSIGHT_MODULE_KEYS.length) fail("横向洞察必须包含全部五个模块");
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const [index, raw] of modules.entries()) {
    const at = `modules[${index}]`;
    const item = object(raw, at);
    if (!(INSIGHT_MODULE_KEYS as readonly unknown[]).includes(item.key)) fail(`${at}.key 无效`);
    const key = item.key as string;
    if (keys.has(key)) fail(`重复横向模块 ${key}`);
    keys.add(key);
    fields(item, ["titleZh", "commentaryZh"], at);
    for (const [findingIndex, rawFinding] of array(item.findings, `${at}.findings`).entries()) {
      const location = `${at}.findings[${findingIndex}]`;
      const finding = object(rawFinding, location);
      itemId(finding, location, ids);
      fields(finding, ["titleZh", "bodyZh", "boundaryZh"], location);
      evidence(finding, location, context, true);
    }
  }
}

/** 写前必须提供完整来源索引；校验失败直接拒绝本次结果，旧报告不受影响。 */
export function normalizeInterviewAdvisory(value: unknown, meta: AdvisoryMeta, context: AdvisoryValidationContext): InterviewAdvisory {
  if (!context?.sources || !context.contextPaths) fail("写前校验需要完整来源索引");
  const result = { ...object(value, "advisory output"), ...meta, version: 1 };
  validateInterviewAdvisory(result, context);
  return structuredClone(result);
}
export function normalizeInterviewInsights(value: unknown, meta: AdvisoryMeta, context: AdvisoryValidationContext): InterviewInsights {
  if (!context?.sources || !context.contextPaths) fail("写前校验需要完整来源索引");
  const result = { ...object(value, "insights output"), ...meta, version: 1 };
  validateInterviewInsights(result, context);
  return structuredClone(result);
}

function readMarkedJson(content: string, marker: string): unknown {
  const index = content.indexOf(marker);
  if (index < 0) return null;
  const json = content.slice(index + marker.length).match(/```json\s*([\s\S]*?)\s*```/)?.[1];
  return json ? JSON.parse(json) : null;
}
export function parseInterviewInsights(content: string): InterviewInsights | null {
  try {
    const parsed = readMarkedJson(content, INSIGHTS_DATA_MARKER);
    validateInterviewInsights(parsed);
    return parsed;
  } catch { return null; }
}

function references(item: EvidenceBearing) {
  const sentences = item.evidence.map((ref) => `[[${ref.sourcePath.replace(/\.md$/, "")}#${ref.blockId}]]（${ref.sentenceIds.join("・")}）`);
  const contexts = item.contextPaths.map((path) => `[[${path.replace(/\.md$/, "")}]]`);
  return `依据：${[...sentences, ...contexts].join("；")}`;
}
export function renderInterviewAdvisory(advisory: InterviewAdvisory): string {
  validateInterviewAdvisory(advisory);
  const observations = advisory.observations.map((item) => `### ${item.titleZh}\n\n现场观察：${item.observationZh}\n\n可能含义：${item.interpretationZh}${item.alternativeZh ? `\n\n其他解释与边界：${item.alternativeZh}` : ""}\n\n对你的意义：${item.implicationZh}\n\n${references(item)}`);
  const options = advisory.answerOptions.map((item) => `### ${item.titleZh}\n\n适用情境：${item.situationZh}\n\n建议理由：${item.whyZh}${item.answerJa ? `\n\n日语表达草稿：${item.answerJa}` : ""}\n\n适用范围：${item.scope === "general" ? "通用" : "本公司"}\n\n${references(item)}`);
  const steps = advisory.nextSteps.map((item) => `### ${item.titleZh}\n\n${item.detailZh}\n\n触发条件：${item.triggerZh}\n\n${references(item)}`);
  return `${ADVISORY_START}\n## 顾问视角\n\n> AI作者：Codex · ${advisory.generatedAt} · ${advisory.model}\n\n${advisory.commentaryZh}\n\n匹配判断：${advisory.fitZh}\n\n当前建议：${advisory.recommendationZh}\n\n改变判断的条件：${advisory.changeConditionsZh}\n\n${references(advisory)}\n\n${[...observations, ...options, ...steps].join("\n\n")}\n${ADVISORY_END}`;
}

/** 只替换顾问标记块及 JSON 中的 advisory，绝不重新规范化旧分数或重写旧正文。 */
export function mergeAdvisoryIntoReview(content: string, advisory: InterviewAdvisory): string {
  validateInterviewAdvisory(advisory);
  const marker = content.indexOf(REVIEW_DATA_MARKER);
  if (marker < 0) fail("报告没有 JSON 正本标记");
  const tail = content.slice(marker + REVIEW_DATA_MARKER.length);
  const match = /```json\s*([\s\S]*?)\s*```/.exec(tail);
  if (!match) fail("报告没有 JSON 正本");
  const previous = object(JSON.parse(match[1]), "existing review");
  const next = { ...previous, advisory };
  const nextTail = tail.slice(0, match.index) + "```json\n" + JSON.stringify(next, null, 2) + "\n```" + tail.slice(match.index + match[0].length);
  let body = content.slice(0, marker);
  const rendered = renderInterviewAdvisory(advisory);
  const starts = body.split(ADVISORY_START).length - 1;
  const ends = body.split(ADVISORY_END).length - 1;
  if (starts !== ends || starts > 1) fail("旧顾问标记块不完整或重复，拒绝覆盖");
  if (starts === 1) {
    const start = body.indexOf(ADVISORY_START);
    const end = body.indexOf(ADVISORY_END);
    if (end < start) fail("旧顾问标记顺序错误");
    body = body.slice(0, start) + rendered + body.slice(end + ADVISORY_END.length);
  } else {
    const heading = body.search(/^## 全体評価\s*$/m);
    const insertion = heading >= 0 ? heading : body.length;
    body = body.slice(0, insertion) + rendered + "\n\n" + body.slice(insertion);
  }
  return body + REVIEW_DATA_MARKER + nextTail;
}

export function renderInterviewInsights(insights: InterviewInsights): string {
  validateInterviewInsights(insights);
  const modules = insights.modules.map((module) => `## ${module.titleZh}\n\n${module.commentaryZh}\n\n${module.findings.map((item) => `### ${item.titleZh}\n\n${item.bodyZh}\n\n适用边界：${item.boundaryZh}\n\n${references(item)}`).join("\n\n")}`);
  return `---\ntype: interview-insights\nlayer: ai-derived\nai_author: Codex\nschema_version: 1\ngenerated_at: ${insights.generatedAt}\nmodel: ${JSON.stringify(insights.model)}\nsource_fingerprint: ${JSON.stringify(insights.sourceFingerprint)}\n---\n# 跨面试顾问洞察\n\n<!-- interview-insights:start -->\n${insights.overviewZh}\n\n${modules.join("\n\n")}\n\n${INSIGHTS_DATA_MARKER}\n\`\`\`json\n${JSON.stringify(insights, null, 2)}\n\`\`\`\n<!-- interview-insights:end -->\n`;
}

/** 人工补充在生成区外保留；不明旧格式宁可拒绝更新，不能猜测哪些正文可删。 */
export function mergeInterviewInsights(content: string | null, insights: InterviewInsights): string {
  const rendered = renderInterviewInsights(insights);
  if (!content) return rendered;
  const start = "<!-- interview-insights:start -->";
  const end = "<!-- interview-insights:end -->";
  if (content.split(start).length !== 2 || content.split(end).length !== 2 || content.indexOf(end) < content.indexOf(start)) {
    fail("横向报告生成区缺失或重复，保留原报告，请先核对人工内容");
  }
  const generated = rendered.slice(rendered.indexOf(start), rendered.indexOf(end) + end.length);
  let result = content.slice(0, content.indexOf(start)) + generated + content.slice(content.indexOf(end) + end.length);
  const metadata: Record<string, string> = { generated_at: insights.generatedAt, model: JSON.stringify(insights.model), source_fingerprint: JSON.stringify(insights.sourceFingerprint) };
  result = result.replace(/^---\n[\s\S]*?\n---/, (frontmatter) => {
    for (const [key, value] of Object.entries(metadata)) {
      const field = new RegExp(`^${key}:.*$`, "m");
      frontmatter = field.test(frontmatter) ? frontmatter.replace(field, `${key}: ${value}`) : frontmatter.replace(/\n---$/, `\n${key}: ${value}\n---`);
    }
    return frontmatter;
  });
  return result;
}
