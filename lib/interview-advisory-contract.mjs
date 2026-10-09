// Bridge と正本の分類を共用し、モデルにだけ存在する段階・モジュールを作らない。
export const ADVISORY_STAGES = /** @type {const} */ (["agency", "matching", "technical", "final", "other"]);
export const INSIGHT_MODULE_KEYS = /** @type {const} */ (["employerPriorities", "positioning", "effectiveAnswers", "opportunities", "nextStage"]);

const text = { type: "string", pattern: "\\S" };
const optionalText = { type: "string" };
const itemId = { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_-]*$" };
const array = (items) => ({ type: "array", items });
const object = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const evidence = { ...array(object({ sourcePath: text, blockId: text, sentenceIds: { ...array(text), minItems: 1 } })), minItems: 1 };
const references = { evidence, contextPaths: array(text) };

export const ADVISORY_OUTPUT_SCHEMA = object({
  stage: { type: "string", enum: ADVISORY_STAGES },
  commentaryZh: text,
  fitZh: text,
  recommendationZh: text,
  changeConditionsZh: text,
  ...references,
  observations: array(object({
    id: itemId, titleZh: text, observationZh: text, interpretationZh: text,
    alternativeZh: optionalText, implicationZh: text, ...references,
  })),
  answerOptions: array(object({
    id: itemId, titleZh: text, situationZh: text, whyZh: text, answerJa: optionalText,
    scope: { type: "string", enum: ["general", "company"] }, ...references,
  })),
  nextSteps: array(object({
    id: itemId, titleZh: text, detailZh: text, triggerZh: text, ...references,
  })),
});

export const INSIGHTS_OUTPUT_SCHEMA = object({
  overviewZh: text,
  modules: { ...array(object({
    key: { type: "string", enum: INSIGHT_MODULE_KEYS },
    titleZh: text,
    commentaryZh: text,
    findings: array(object({
      id: itemId, titleZh: text, bodyZh: text, boundaryZh: text, ...references,
    })),
  })), minItems: INSIGHT_MODULE_KEYS.length, maxItems: INSIGHT_MODULE_KEYS.length },
});

/** 每个引用分支把来源、问题和可选句子绑定，不能把三个独立枚举误当合法组合。 */
export function interviewAdvisoryOutputSchema(input, kind = "advisory") {
  const choices = [];
  for (const source of input.evidenceSources ?? []) {
    const path = source.sourcePath;
    if (typeof path !== "string" || !path.startsWith("20_求職/") || !path.endsWith("_整理稿.md") || path.includes("..") || path.includes("\\")) throw new Error("顾问生成缺少已验证的完整整理稿来源清单。");
    for (const block of source.blocks ?? []) {
      if (!/^q\d+$/.test(block.blockId) || !Array.isArray(block.sentenceIds) || block.sentenceIds.some(id => typeof id !== "string" || !/^s\d+[a-z]?$/.test(id))) throw new Error("原稿问题或句子 ID 不符合引用契约，不能交给模型猜编号。");
      if (!block.sentenceIds.length) continue;
      choices.push(object({ sourcePath: { type: "string", enum: [path] }, blockId: { type: "string", enum: [block.blockId] }, sentenceIds: { ...array({ type: "string", enum: [...new Set(block.sentenceIds)] }), minItems: 1 } }));
    }
  }
  if (!choices.length) throw new Error("顾问生成缺少已验证的逐句来源清单。");
  const schema = structuredClone(kind === "insights" ? INSIGHTS_OUTPUT_SCHEMA : ADVISORY_OUTPUT_SCHEMA);
  const contextPaths = [...new Set(input.contextPaths ?? [])];
  if (contextPaths.some(path => typeof path !== "string" || path.startsWith("/") || path.includes("..") || path.includes("\\") || !path.endsWith(".md"))) throw new Error("顾问背景清单包含不合法路径。");
  const walk = value => {
    if (!value || typeof value !== "object") return;
    if (value.properties?.evidence) {
      value.properties.evidence = { ...array({ $ref: "#/$defs/evidenceReference" }), minItems: kind === "insights" ? 2 : 1 };
      value.properties.contextPaths = contextPaths.length ? array({ type: "string", enum: contextPaths }) : { ...array({ type: "string" }), maxItems: 0 };
      return;
    }
    for (const child of Object.values(value)) walk(child);
  };
  walk(schema);
  if (kind === "advisory") for (const key of ["observations", "answerOptions", "nextSteps"]) walk(schema.properties[key]);
  // 共用引用分支，避免每种条目复制全场句子枚举而扩大 schema。
  schema.$defs = { evidenceReference: { anyOf: choices } };
  return schema;
}

/** 生成与写前用同一 schema 核全部结构错误；独特性和证据语义由额外校验承担。 */
export function advisorySchemaErrors(value, schema, root = "advisory") {
  const errors = [];
  const walk = (data, rule, at) => {
    if (rule.$ref) { walk(data, schema.$defs.evidenceReference, at); return; }
    if (rule.anyOf) {
      const branch = rule.anyOf.find(option => option.properties.sourcePath.enum.includes(data?.sourcePath) && option.properties.blockId.enum.includes(data?.blockId));
      if (!branch) {
        const sources = [...new Set(rule.anyOf.flatMap(option => option.properties.sourcePath.enum))];
        const blocks = rule.anyOf.filter(option => option.properties.sourcePath.enum.includes(data?.sourcePath)).flatMap(option => option.properties.blockId.enum);
        errors.push(`${at} 来源/问题组合无效；sourcePath 必须为完整来源清单之一，blockId 必须为该来源真实 qNN；收到 ${JSON.stringify(data)}；该来源问题 ${blocks.join("、") || "不存在"}；完整来源 ${sources.join("、")}`);
        return;
      }
      walk(data, branch, at); return;
    }
    const matches = rule.type === "object" ? data && typeof data === "object" && !Array.isArray(data) : rule.type === "array" ? Array.isArray(data) : typeof data === rule.type;
    if (!matches) { errors.push(`${at} 必须为 ${rule.type}，收到 ${JSON.stringify(data)}`); return; }
    if (rule.enum && !rule.enum.includes(data)) errors.push(`${at} ${at.includes("contextPaths") ? "引用了未提供的背景笔记，" : ""}不属于已提供的合法选项 ${JSON.stringify(rule.enum)}；收到 ${JSON.stringify(data)}`);
    if (rule.type === "string" && rule.pattern && !new RegExp(rule.pattern).test(data)) errors.push(`${at} 必须为非空字符串或规定格式，收到 ${JSON.stringify(data)}`);
    if (rule.type === "array") {
      if (rule.minItems !== undefined && data.length < rule.minItems) errors.push(at === "insights.modules" ? "横向洞察必须包含全部五个模块" : `${at} 缺少逐句证据或必需条目（至少 ${rule.minItems} 项）`);
      if (rule.maxItems !== undefined && data.length > rule.maxItems) errors.push(`${at} 含未提供的背景引用或超出规定条目数（最多 ${rule.maxItems} 项）`);
      data.forEach((item, i) => walk(item, rule.items, `${at}[${i}]`));
    }
    if (rule.type === "object") {
      for (const key of rule.required ?? []) if (!Object.hasOwn(data, key)) errors.push(`${at}.${key} 缺少必需字段`);
      for (const [key, item] of Object.entries(data)) {
        if (rule.properties?.[key]) walk(item, rule.properties[key], `${at}.${key}`);
        else if (rule.additionalProperties === false) errors.push(`${at}.${key} 不允许由模型新增`);
      }
    }
  };
  walk(value, schema, root);
  return errors;
}

/** JSON schema 无法表达全报告唯一性、跨来源数量和相关性；前两者可确定地全部报出。 */
export function advisorySemanticErrors(value, kind = "advisory") {
  const errors = [];
  const ids = new Set();
  const check = (item, at, cross = false) => {
    if (!item || typeof item !== "object") return;
    if (typeof item.id === "string") {
      if (ids.has(item.id)) errors.push(`${at}.id 重复观点 ID ${item.id}`);
      ids.add(item.id);
    }
    const refs = Array.isArray(item.evidence) ? item.evidence : [];
    const seen = new Set();
    const sources = new Set();
    refs.forEach((ref, index) => {
      if (!ref || typeof ref !== "object") return;
      if (typeof ref.sourcePath === "string") sources.add(ref.sourcePath);
      for (const id of Array.isArray(ref.sentenceIds) ? ref.sentenceIds : []) {
        const key = JSON.stringify([ref.sourcePath, ref.blockId, id]);
        if (seen.has(key)) errors.push(`${at}.evidence[${index}] 包含重复证据 ${id}`);
        seen.add(key);
      }
    });
    if (cross && sources.size < 2) errors.push(`${at}.evidence 横向结论至少需要两个不同场次的完整来源路径`);
    const paths = new Set();
    for (const path of Array.isArray(item.contextPaths) ? item.contextPaths : []) {
      if (paths.has(path)) errors.push(`${at}.contextPaths 包含重复背景引用 ${path}`);
      paths.add(path);
    }
  };
  if (kind === "advisory") {
    check(value, "advisory");
    for (const key of ["observations", "answerOptions", "nextSteps"]) (Array.isArray(value?.[key]) ? value[key] : []).forEach((item, i) => check(item, `${key}[${i}]`));
  } else {
    const keys = new Set();
    (Array.isArray(value?.modules) ? value.modules : []).forEach((module, i) => {
      if (!module || typeof module !== "object") return;
      if (keys.has(module.key)) errors.push(`modules[${i}].key 重复横向模块 ${module.key}`);
      keys.add(module.key);
      (Array.isArray(module.findings) ? module.findings : []).forEach((item, j) => check(item, `modules[${i}].findings[${j}]`, true));
    });
    for (const key of INSIGHT_MODULE_KEYS) if (!keys.has(key)) errors.push(`modules 缺少横向模块 ${key}`);
  }
  return errors;
}
