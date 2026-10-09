export type TextbookExample = { ja: string; zh: string; labelZh?: string };
export type TextbookContrast = {
  leftJa: string; leftZh: string; rightJa: string; rightZh: string; explanationZh: string;
};
export type TextbookSource = {
  originalJa: string; revisionJa: string; naturalJa?: string;
  explanationZh: string; reliabilityZh: string; natureZh: string; refs: string[];
  speaker?: "self" | "interviewer";
};
export type TextbookPoint = {
  id: string; titleZh: string; patternJa: string; meaningZh: string;
  readingJa?: string; collocationsJa?: string[];
  explanationZh: string[]; examples: TextbookExample[];
  source?: TextbookSource; contrasts: TextbookContrast[]; cautionZh: string;
};
export type TextbookModule = { summaryZh: string; points: TextbookPoint[]; recapZh: string[] };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function nonempty(value: unknown): value is string { return typeof value === "string" && !!value.trim(); }
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonempty);
}
function source(value: unknown): value is TextbookSource {
  return record(value) && ["originalJa", "revisionJa", "explanationZh", "reliabilityZh", "natureZh"].every(key => nonempty(value[key]))
    && (value.naturalJa === undefined || nonempty(value.naturalJa)) && strings(value.refs)
    && (value.speaker === undefined || value.speaker === "self" || value.speaker === "interviewer");
}
function point(value: unknown): value is TextbookPoint {
  return record(value) && nonempty(value.id) && /^[a-z][a-z0-9-]{0,79}$/.test(value.id)
    && ["titleZh", "patternJa", "meaningZh", "cautionZh"].every(key => nonempty(value[key]))
    && (value.readingJa === undefined || nonempty(value.readingJa))
    && (value.collocationsJa === undefined || strings(value.collocationsJa))
    && strings(value.explanationZh) && Array.isArray(value.examples) && value.examples.length > 0
    && value.examples.every(item => record(item) && nonempty(item.ja) && nonempty(item.zh)
      && (item.labelZh === undefined || nonempty(item.labelZh)))
    && Array.isArray(value.contrasts) && value.contrasts.length > 0
    && value.contrasts.every(item => record(item) && ["leftJa", "leftZh", "rightJa", "rightZh", "explanationZh"].every(key => nonempty(item[key])))
    && (value.source === undefined || source(value.source));
}

export function parseTextbookModule(value: unknown): TextbookModule | undefined {
  if (!record(value) || !nonempty(value.summaryZh) || !strings(value.recapZh)
    || !Array.isArray(value.points) || value.points.length < 2 || value.points.length > 4 || !value.points.every(point)) return;
  if (new Set(value.points.map(item => item.id)).size !== value.points.length) return;
  // 展示数据来自 Vault，保留原始证据轴；缺字段时回到完整课文，不猜测用户的错误。
  return value as TextbookModule;
}
