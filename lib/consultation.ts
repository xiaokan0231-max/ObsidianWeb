import { parseSeirikou, parseAnnotations, reviewDecisionTasks, plainSei } from "./review.ts";

// 私有内容只住在 vault；页面拿到的是投影，不能把隐私仅用 CSS 藏起来。
export const CONSULTATION_PATH = "20_求職/_面談相談/現在の相談.md";
export const CONSULTATION_RECORD_PATH = "20_求職/_面談相談/相談メモ.md";
export type Range = [number, number];
export type ConsultationSource = {
  id: string; company: string; aliases: string[]; date: string; roleJa: string; round: string;
  rawPath: string; studyPath: string; annotationPath: string;
  rawHash: string; studyHash: string; annotationHash: string;
  bodyRange: Range; hiddenRanges: Range[]; privateTerms: string[];
};
export type ConsultationCase = {
  id: string; sourceId: string; titleJa: string; titleZh: string; blocks: string[];
  rawRange: Range; reserve: boolean; cautionJa: string; cautionZh: string;
  contextJa: string; contextZh: string; aiJa: string; aiZh: string;
};
export type ConsultationMaterial = {
  schemaVersion: 1; id: string; titleJa: string; introJa: string; introZh: string;
  goalJa: string; checkedAt: string; sources: ConsultationSource[]; cases: ConsultationCase[];
};
export type ConsultationMemo = { received: string; evidence: string; improvement: string; retry: string; explanation: string; confirmed: boolean };
export type ConsultationDraft = {
  minutes: "20" | "30" | "45"; memos: Record<string, ConsultationMemo>;
  summary: { keep: string; change: string; unknown: string; action: string };
};
export const emptyMemo = (): ConsultationMemo => ({ received: "", evidence: "", improvement: "", retry: "", explanation: "", confirmed: false });
export function emptyDraft(cases: { id: string }[]): ConsultationDraft {
  return { minutes: "30", memos: Object.fromEntries(cases.map(item => [item.id, emptyMemo()])), summary: { keep: "", change: "", unknown: "", action: "" } };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 12000;
const nonempty = (v: unknown): v is string => text(v) && v.trim().length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(nonempty);
const id = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9-]{0,70}$/.test(v);
const range = (v: unknown): v is Range => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && v[0] > 0 && v[1] >= v[0];
const path = (v: unknown): v is string => nonempty(v) && v.startsWith("20_求職/") && v.endsWith(".md") && !v.split("/").some(p => p === ".." || p.startsWith(".")) && !v.includes("\\");
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function parseConsultation(content: string): ConsultationMaterial {
  const data: unknown = JSON.parse(content.match(/<!-- consultation:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- consultation:end -->/)?.[1] ?? "null");
  if (!record(data) || data.schemaVersion !== 1 || !id(data.id) || ![data.titleJa, data.introJa, data.introZh, data.goalJa, data.checkedAt].every(nonempty)
    || !Array.isArray(data.sources) || !data.sources.length || data.sources.length > 5 || !Array.isArray(data.cases) || !data.cases.length || data.cases.length > 5) throw new Error("相談資料の形式を確認してください。");
  for (const s of data.sources) {
    if (!record(s) || !id(s.id) || ![s.company, s.date, s.roleJa, s.round].every(nonempty) || !strings(s.aliases) || !strings(s.privateTerms)
      || ![s.rawPath, s.studyPath, s.annotationPath].every(path) || ![s.rawHash, s.studyHash, s.annotationHash].every(hash)
      || !range(s.bodyRange) || !Array.isArray(s.hiddenRanges) || !s.hiddenRanges.every(range)) throw new Error("資料の出典・確認版が不正です。");
  }
  const sourceIds = new Set(data.sources.map(s => s.id));
  if (sourceIds.size !== data.sources.length || new Set(data.cases.map(c => c.id)).size !== data.cases.length) throw new Error("資料 ID が重複しています。");
  for (const c of data.cases) {
    if (!record(c) || !id(c.id) || !sourceIds.has(c.sourceId) || !strings(c.blocks) || !c.blocks.length || !c.blocks.every(b => /^q\d+$/.test(b))
      || !range(c.rawRange) || typeof c.reserve !== "boolean" || ![c.titleJa, c.titleZh, c.cautionJa, c.cautionZh, c.contextJa, c.contextZh].every(nonempty)
      || ![c.aiJa, c.aiZh].every(text)) throw new Error("相談する箇所の指定が不正です。");
  }
  if (data.cases.filter(c => !c.reserve).length > 3 || data.cases.filter(c => c.reserve).length > 2) throw new Error("主な資料は3件、予備は2件までです。");
  return data as ConsultationMaterial;
}

export function validateDraft(value: unknown, ids: string[]): ConsultationDraft {
  if (!record(value) || !["20", "30", "45"].includes(String(value.minutes)) || !record(value.memos) || !record(value.summary)
    || Object.keys(value.memos).length !== ids.length || Object.keys(value).some(k => !["minutes", "memos", "summary"].includes(k))) throw new Error("メモの形式が不正です。");
  const fields = ["received", "evidence", "improvement", "retry", "explanation"];
  for (const key of ids) {
    const memo = value.memos[key];
    if (!record(memo) || !fields.every(k => text(memo[k]) && (memo[k] as string).length <= 4000) || typeof memo.confirmed !== "boolean"
      || Object.keys(memo).some(k => ![...fields, "confirmed"].includes(k))) throw new Error("メモは各欄4000文字までです。");
  }
  const summary = value.summary;
  if (Object.keys(summary).length !== 4 || !["keep", "change", "unknown", "action"].every(k => text(summary[k]) && (summary[k] as string).length <= 4000)) throw new Error("まとめは各欄4000文字までです。");
  return value as ConsultationDraft;
}

export function privacyText(value: string, material: ConsultationMaterial, names: boolean): string {
  const replacements: [string, string][] = [];
  material.sources.forEach((s, index) => {
    for (const term of [s.company, ...s.aliases]) replacements.push([term, names ? s.company : `企業${String.fromCharCode(65 + index)}`]);
    for (const term of s.privateTerms) replacements.push([term, "［個人情報非表示］"]);
  });
  // 一回の置換で処理し、置換後の社名を別の略称で再置換しない。
  const terms = [...new Set(replacements.map(([term]) => term))].sort((a, b) => b.length - a.length);
  const lookup = new Map(replacements);
  let result = terms.length ? value.replace(new RegExp(terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g"), t => lookup.get(t)!) : value;
  result = result.replace(/https?:\/\/[^\s<>「」]+/g, "［リンク非表示］")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "［メール非表示］")
    .replace(/(?:\+81[-\s]?|0)\d{1,4}[-\s]\d{1,4}[-\s]\d{3,4}/g, "［電話非表示］")
    .replace(/\b0\d{9,10}\b/g, "［電話非表示］")
    .replace(/\[\[.*?\]\]/g, "［関連資料］");
  return result;
}

export type SourceContent = { raw: string; study: string; annotations: string; changed: boolean };
export function projectConsultation(material: ConsultationMaterial, loaded: Record<string, SourceContent>, names = false) {
  const safe = (s: string) => privacyText(s, material, names);
  const sources = material.sources.map((s, index) => {
    const content = loaded[s.id];
    if (!content) throw new Error("出典を読み込めません。");
    const lines = content.raw.split("\n");
    if (s.bodyRange[1] > lines.length) throw new Error("原稿の行範囲を確認してください。");
    const rawLines = lines.slice(s.bodyRange[0] - 1, s.bodyRange[1]).flatMap((line, offset) => {
      const number = offset + s.bodyRange[0];
      const hidden = s.hiddenRanges.find(([a, b]) => number >= a && number <= b);
      if (hidden) return number === hidden[0] ? [{ number, text: "［本相談に無関係な個人情報を含む区間は非表示］" }] : [];
      return [{ number, text: safe(line) }];
    });
    return { id: s.id, company: names ? s.company : `企業${String.fromCharCode(65 + index)}`, date: s.date, roleJa: safe(s.roleJa), round: safe(s.round),
      sourceLabel: safe(s.rawPath), studyLabel: safe(s.studyPath), changed: content.changed, rawLines };
  });
  const cases = material.cases.map(c => {
    const content = loaded[c.sourceId];
    const parsed = parseSeirikou(content.study);
    const tasks = reviewDecisionTasks(parsed.sentences, parseAnnotations(content.annotations));
    const selected = c.blocks.map(b => parsed.blocks.find(block => block.id === b));
    if (selected.some(b => !b)) throw new Error("質問の ID が見つかりません。資料を再確認してください。");
    const source = sources.find(s => s.id === c.sourceId)!;
    const raw = source.rawLines.filter(l => l.number >= c.rawRange[0] && l.number <= c.rawRange[1]);
    if (!raw.length || c.rawRange[1] > material.sources.find(s => s.id === c.sourceId)!.bodyRange[1]) throw new Error("引用範囲が原稿の外にあります。");
    return { id: c.id, sourceId: c.sourceId, titleJa: safe(c.titleJa), titleZh: safe(c.titleZh), reserve: c.reserve,
      cautionJa: safe(c.cautionJa), cautionZh: safe(c.cautionZh), contextJa: safe(c.contextJa), contextZh: safe(c.contextZh), aiJa: safe(c.aiJa), aiZh: safe(c.aiZh), rawRange: c.rawRange, raw,
      blocks: selected.map(block => ({ id: block!.id, title: safe(block!.title), sentences: block!.sentences.map(sentence => {
        const speakerTask = tasks.find(t => t.sentenceId === sentence.id && t.target === "speaker");
        const speaker = speakerTask?.resolution === "speaker-interviewer" ? "面" : speakerTask?.resolution === "speaker-self" ? "私" : sentence.speaker;
        return { id: sentence.id, speaker, text: safe(plainSei(sentence)), zh: safe(sentence.yaku ?? ""),
          uncertain: tasks.some(t => t.sentenceId === sentence.id && !t.resolvedBy),
          notes: sentence.notes.map(safe) };
      }) })) };
  });
  return { id: material.id, titleJa: safe(material.titleJa), introJa: safe(material.introJa), introZh: safe(material.introZh), goalJa: safe(material.goalJa), checkedAt: material.checkedAt, sources, cases };
}
export type ConsultationProjection = ReturnType<typeof projectConsultation>;

export type ConsultationHistory = { materialId: string; entries: { savedAt: string; draft: ConsultationDraft; materialRevision: string }[] };
export function parseConsultationHistory(content: string | null): ConsultationHistory | null {
  if (content === null) return null;
  const value = JSON.parse(content.match(/<!-- consultation-record:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- consultation-record:end -->/)?.[1] ?? "null");
  if (!record(value) || !id(value.materialId) || !Array.isArray(value.entries) || !value.entries.length) throw new Error("保存済みメモを確認してください。上書きは行いません。");
  return value as ConsultationHistory;
}
export function renderConsultationHistory(history: ConsultationHistory) {
  return `---\ntype: career-consultation-record\nlayer: human-feedback\n---\n# キャリア相談メモ\n\n本人が記録した相談メモ。先生の発言そのものか、本人の要約かは確認状態を参照。既存の面接裁定・求職状態へ自動反映しない。履歴は追記のみ。\n\n<!-- consultation-record:start -->\n\x60\x60\x60json\n${JSON.stringify(history, null, 2)}\n\x60\x60\x60\n<!-- consultation-record:end -->\n`;
}
