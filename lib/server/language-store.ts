import type {
  LanguageBank,
  LanguageCategory,
  LanguageCoachFeedback,
  LanguageDrill,
  LanguageExamQuestion,
  LanguageExamReport,
  LanguageSessionAttempt,
  LanguageTrainingEvent,
  LanguageUnit,
} from "@/lib/language/types";
import { includeAiSourceNote } from "@/lib/vault-boundary.mjs";
import { deriveLanguageState } from "@/lib/language/state";
import { stableId, yamlString } from "@/lib/dojo/utils";
import { buildSourceContext } from "@/lib/server/dojo-store";
import { readAllNotes, type ObsidianNote } from "@/lib/server/obsidian";
import { bankContentFingerprint } from "../language-bank-fingerprint.mjs";

export const BANK_START = "<!-- language-bank-json:start -->";
export const BANK_END = "<!-- language-bank-json:end -->";
const SESSION_START = "<!-- language-session-attempt:start -->";
const SESSION_END = "<!-- language-session-attempt:end -->";
const COACH_START = "<!-- language-coach-feedback:start -->";
const COACH_END = "<!-- language-coach-feedback:end -->";
const EXAM_START = "<!-- language-exam-report:start -->";
const EXAM_END = "<!-- language-exam-report:end -->";
const EVENT_PREFIX = "<!-- language-training-event:";

const CATEGORY_SET = new Set<LanguageCategory>([
  "numbers_reading",
  "vocabulary",
  "technical_vocabulary",
  "grammar",
  "particles_collocations",
  "interview_expression",
  "business_expression",
  "delivery_buffer",
]);

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function number(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strings(value: unknown, limit = 20) {
  return Array.isArray(value) ? value.slice(0, limit).map(text).filter(Boolean) : [];
}

function records(value: unknown, limit = 60) {
  return Array.isArray(value)
    ? value.slice(0, limit).map((entry) => (entry ?? {}) as Record<string, unknown>)
    : [];
}

function markerJson<T>(content: string, start: string, end: string): T | undefined {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return undefined;
  const raw = content
    .slice(startIndex + start.length, endIndex)
    .replace(/^\s*```json\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function languagePriority(value: unknown) {
  const parsed = Math.max(1, Math.min(100, number(value, 50)));
  return parsed <= 10 ? parsed * 10 : parsed;
}

function languageSummary(value: unknown, unitCount: number) {
  const summary = text(value);
  if (summary && !/(练习|題|题库).{0,12}(留空|空数组)/u.test(summary)) return summary;
  return `已根据本人确认资料和真实面试记录建立${unitCount}个日语训练单元，覆盖数字、词汇、专业术语、语法、搭配、面试表达、商务表达和现场救场。`;
}

export function languageBankContentFingerprint(
  bank: Pick<LanguageBank, "units" | "questionBank">,
) {
  return bankContentFingerprint(bank);
}

function trainingEvents(content: string) {
  const events: LanguageTrainingEvent[] = [];
  for (const line of content.split("\n")) {
    const index = line.indexOf(EVENT_PREFIX);
    if (index < 0) continue;
    const raw = line.slice(index + EVENT_PREFIX.length).replace(/-->.*$/, "").trim();
    try {
      events.push(JSON.parse(raw) as LanguageTrainingEvent);
    } catch {
      // Keep the readable historical log even if one machine marker is malformed.
    }
  }
  return events;
}

export function languageBankEntries(notes: ObsidianNote[]) {
  return notes.flatMap((note) => {
    if (
      note.frontmatter.type !== "language-bank" &&
      !note.path.startsWith("80_AI分析/日本語訓練/")
    ) return [];
    const parsed = markerJson<LanguageBank>(note.content, BANK_START, BANK_END);
    if (!parsed) return [];
    const bank: LanguageBank = {
      ...parsed,
      contentFingerprint: parsed.contentFingerprint || languageBankContentFingerprint(parsed),
      summaryZh: languageSummary(parsed.summaryZh, parsed.units.length),
      units: parsed.units.map((unit) => ({
        ...unit,
        priority: languagePriority(unit.priority),
      })),
    };
    return [{ note, bank }];
  });
}

export function latestLanguageBankEntry(notes: ObsidianNote[]) {
  return languageBankEntries(notes)
    .toSorted((left, right) => right.bank.generatedAt.localeCompare(left.bank.generatedAt))[0];
}

function latestBank(notes: ObsidianNote[]) {
  return latestLanguageBankEntry(notes)?.bank;
}

function noteType(note: ObsidianNote) {
  return text(note.frontmatter.type) || "note";
}

const LANGUAGE_SOURCE_LIMIT = 320_000;
const LANGUAGE_SOURCE_PRIORITY: Record<string, number> = {
  self: 0,
  transcript: 1,
  review: 2,
  company: 3,
  policy: 4,
  study: 5,
  material: 6,
  "ai-report": 7,
};

const LANGUAGE_NOTE_LIMIT: Record<string, number> = {
  self: 32_000,
  transcript: 15_000,
  review: 13_000,
  company: 11_000,
  policy: 8_000,
  study: 6_000,
  material: 5_000,
  "ai-report": 3_500,
};

const LANGUAGE_SIGNAL =
  /(^#{1,6}\s)|([?？])|(面接|質問|回答|誤|修正|文法|助詞|語彙|表現|読み|数字|成果|年収|給与|退職|離職|転職|志望|経験|担当|管理|要件|設計|運用|AI|GPU|YOLO|Kafka|Flink|ClickHouse|\d|[０-９])/i;

function compactLanguageContent(content: string, limit: number) {
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  if (normalized.length <= limit) return normalized;

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const selected: string[] = [];
  const seen = new Set<string>();
  const push = (line: string) => {
    const clipped = line.slice(0, 1_200);
    if (!clipped || seen.has(clipped)) return;
    seen.add(clipped);
    selected.push(clipped);
  };

  for (const line of lines.slice(0, 24)) push(line);
  for (const line of lines) {
    if (LANGUAGE_SIGNAL.test(line)) push(line);
    if (selected.join("\n").length >= limit * 0.78) break;
  }
  const sampleStep = Math.max(1, Math.floor(lines.length / 24));
  for (let index = 0; index < lines.length; index += sampleStep) push(lines[index]);
  for (const line of lines.slice(-12)) push(line);

  const excerpt = selected.join("\n").slice(0, Math.max(0, limit - 90));
  return `${excerpt}\n[该笔记已按日语训练相关性压缩；来源路径和高信号片段已保留]`;
}

/**
 * Language-bank generation needs broad Vault coverage, but sending every note
 * verbatim can spend most of the five-minute task window on context ingestion.
 * Keep every eligible source path while allocating the text budget to confirmed
 * facts, transcripts, reviews and upcoming-company notes first.
 */
export function buildLanguageSourceContext(notes: ObsidianNote[]) {
  const baseline = buildSourceContext(notes);
  const candidates = notes
    .filter(includeAiSourceNote)
    .sort((left, right) => {
      const priority =
        (LANGUAGE_SOURCE_PRIORITY[noteType(left)] ?? 8) -
        (LANGUAGE_SOURCE_PRIORITY[noteType(right)] ?? 8);
      return priority || right.stat.mtime - left.stat.mtime;
    });
  const chunks: string[] = [];
  let used = 0;

  for (const note of candidates) {
    const type = noteType(note);
    const header = `<note path=${JSON.stringify(note.path)} type=${JSON.stringify(
      type,
    )}>`;
    const footer = "</note>";
    const remaining = LANGUAGE_SOURCE_LIMIT - used - header.length - footer.length - 4;
    const noteLimit = Math.min(LANGUAGE_NOTE_LIMIT[type] ?? 5_000, Math.max(0, remaining));
    const body = noteLimit >= 240
      ? compactLanguageContent(note.content, noteLimit)
      : "[仅保留来源索引；正文超出本次相关性预算]";
    const chunk = `${header}\n${body}\n${footer}`;
    chunks.push(chunk);
    used += chunk.length + 2;
  }

  return {
    ...baseline,
    sourceContext: chunks.join("\n\n"),
    sourceCount: candidates.length,
  };
}

function isFactAuthority(note: ObsidianNote) {
  return [
    "self",
    "transcript",
    "review",
    "company",
    "job-case",
    "mail",
    "application_log",
    "application_documents",
    "job_platform_sync",
    "deep-thought-evidence",
    "policy",
  ].includes(noteType(note));
}

function fallbackDrill(
  unitId: string,
  targetJa: string,
  reading: string,
  index: number,
): LanguageDrill {
  const testsReading = index === 0 && Boolean(reading);
  return {
    id: stableId("ld", `${unitId}|fallback|${index}`),
    unitId,
    type: "text",
    promptZh: testsReading
      ? `「${targetJa}」怎么读？请用假名输入。`
      : `请用日语表达讲解中的中文含义：${targetJa ? "（作答时会显示中文提示）" : ""}`,
    choices: [],
    correctAnswer: testsReading ? reading : targetJa,
    acceptedAnswers: testsReading
      ? [reading]
      : targetJa
        ? [...new Set([targetJa, targetJa.replace(/[。！？]$/u, "")])]
        : [],
    correctOrder: [],
    explanationZh: testsReading
      ? "对照讲解卡中的读音，重新读一遍并输入。"
      : "回到讲解卡，对照目标表达并重新输入。",
  };
}

function normalizeDrill(
  raw: Record<string, unknown>,
  unitId: string,
  targetJa: string,
  reading: string,
  index: number,
): LanguageDrill {
  const type = ["choice", "text", "ordering"].includes(text(raw.type))
    ? (text(raw.type) as LanguageDrill["type"])
    : "text";
  const promptZh = text(raw.promptZh) || "请完成本单元练习。";
  const drill: LanguageDrill = {
    id: stableId("ld", `${unitId}|${type}|${promptZh}|${index}`),
    unitId,
    type,
    promptZh,
    promptJa: text(raw.promptJa) || undefined,
    choices: strings(raw.choices, 10),
    correctAnswer: text(raw.correctAnswer) || undefined,
    acceptedAnswers: strings(raw.acceptedAnswers, 12),
    correctOrder: strings(raw.correctOrder, 12),
    explanationZh: text(raw.explanationZh) || "请对照讲解后再练一次。",
  };
  if (drill.type === "choice" && (!drill.choices.length || !drill.correctAnswer)) {
    return fallbackDrill(unitId, targetJa, reading, index);
  }
  if (
    drill.type === "ordering" &&
    (!drill.choices.length || drill.choices.length !== drill.correctOrder.length)
  ) {
    return fallbackDrill(unitId, targetJa, reading, index);
  }
  if (
    drill.type === "text" &&
    !drill.correctAnswer &&
    drill.acceptedAnswers.length === 0
  ) {
    return fallbackDrill(unitId, targetJa, reading, index);
  }
  return drill;
}

export function normalizeLanguageBank(
  raw: Record<string, unknown>,
  metadata: Pick<
    LanguageBank,
    "generatedAt" | "model" | "sourceFingerprint" | "sourceCount"
  >,
  previousUnits: LanguageUnit[],
  notes: ObsidianNote[],
): LanguageBank {
  const existingPaths = new Set(notes.map((note) => note.path));
  const safeFactPaths = new Set(notes.filter(isFactAuthority).map((note) => note.path));
  const previousReferences = new Map<string, LanguageUnit>();
  for (const unit of previousUnits) {
    previousReferences.set(`key:${unit.canonicalKey}`, unit);
    previousReferences.set(`id:${unit.id}`, unit);
    previousReferences.set(
      `content:${unit.category}|${unit.titleZh.normalize("NFKC").trim()}|${unit.targetJa.normalize("NFKC").trim()}`,
      unit,
    );
  }
  const idReferences = new Map<string, string>();
  const rawUnits = records(raw.units, 48);
  const units = rawUnits.map((source, index) => {
    const category = CATEGORY_SET.has(text(source.category) as LanguageCategory)
      ? (text(source.category) as LanguageCategory)
      : "vocabulary";
    const targetJa = text(source.targetJa);
    const reading = text(source.reading);
    const proposedKey =
      text(source.canonicalKey) || `${category}|${text(source.titleZh)}|${targetJa}`;
    const previous =
      previousReferences.get(`key:${proposedKey}`) ??
      previousReferences.get(`id:${text(source.id)}`) ??
      previousReferences.get(
        `content:${category}|${text(source.titleZh).normalize("NFKC").trim()}|${targetJa.normalize("NFKC").trim()}`,
      );
    const canonicalKey = previous?.canonicalKey || proposedKey;
    const id = previous?.id || stableId("lu", canonicalKey);
    idReferences.set(text(source.id), id);
    idReferences.set(text(source.canonicalKey), id);
    idReferences.set(canonicalKey, id);
    idReferences.set(String(index), id);

    const exampleKind = text(source.exampleKind) === "personal" ? "personal" : "general";
    const proposedFactPaths = strings(source.factSourcePaths, 12);
    const factSourcePaths = proposedFactPaths.filter((path) => safeFactPaths.has(path));
    const hasNumericPersonalClaim =
      category === "numbers_reading" &&
      /[0-9０-９]/.test(`${targetJa}${text(source.exampleJa)}`);
    const factSensitive =
      Boolean(source.factSensitive) || exampleKind === "personal" || hasNumericPersonalClaim;
    const factSafe = !factSensitive || factSourcePaths.length > 0;
    const evidence = records(source.evidence, 6)
      .map((entry) => ({ path: text(entry.path), excerpt: text(entry.excerpt) }))
      .filter((entry) => existingPaths.has(entry.path));
    const drills = records(source.drills, 2).map((entry, drillIndex) =>
      normalizeDrill(entry, id, targetJa, reading, drillIndex),
    );
    while (drills.length < 2) {
      drills.push(fallbackDrill(id, targetJa, reading, drills.length));
    }

    return {
      id,
      canonicalKey,
      category,
      titleZh: text(source.titleZh) || `日语训练单元 ${index + 1}`,
      targetJa,
      reading,
      meaningZh: text(source.meaningZh),
      usageZh: text(source.usageZh),
      register: ["interview", "business", "both"].includes(text(source.register))
        ? (text(source.register) as LanguageUnit["register"])
        : "both",
      exampleKind,
      exampleJa: factSafe ? text(source.exampleJa) : "",
      alternativesJa: strings(source.alternativesJa, 8),
      commonErrorJa: text(source.commonErrorJa),
      correctedJa: text(source.correctedJa),
      errorReasonZh: text(source.errorReasonZh),
      cautionZh: factSafe
        ? text(source.cautionZh)
        : `${text(source.cautionZh)}${text(source.cautionZh) ? " " : ""}个人例句缺少权威来源，已暂时隐藏。`,
      evidence,
      factSensitive,
      factSourcePaths,
      relatedDojoItemIds: strings(source.relatedDojoItemIds, 12),
      priority: languagePriority(source.priority),
      drills,
    } satisfies LanguageUnit;
  });

  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const questionBank = records(raw.questionBank, 180).flatMap((source, index) => {
    const unitId = idReferences.get(text(source.unitId));
    const unit = unitId ? unitById.get(unitId) : undefined;
    if (!unit) return [];
    const rawType = text(source.type);
    const type = ["choice", "text", "ordering", "free_response"].includes(rawType)
      ? (rawType as LanguageExamQuestion["type"])
      : "text";
    const promptZh = text(source.promptZh) || `请完成“${unit.titleZh}”的考试题。`;
    const question: LanguageExamQuestion = {
      id: stableId("lq", `${unit.id}|${type}|${promptZh}|${index}`),
      unitId: unit.id,
      category: unit.category,
      type,
      promptZh,
      promptJa: text(source.promptJa) || undefined,
      choices: strings(source.choices, 12),
      correctAnswer: text(source.correctAnswer) || undefined,
      acceptedAnswers: strings(source.acceptedAnswers, 12),
      correctOrder: strings(source.correctOrder, 12),
      rubricZh: text(source.rubricZh) || undefined,
    };
    if (type === "choice" && (!question.choices.length || !question.correctAnswer)) return [];
    if (
      type === "ordering" &&
      (!question.choices.length || question.choices.length !== question.correctOrder.length)
    ) return [];
    if (
      type === "text" &&
      !question.correctAnswer &&
      question.acceptedAnswers.length === 0
    ) return [];
    return [question];
  });

  for (const unit of units) {
    const existing = questionBank.filter((question) => question.unitId === unit.id);
    if (!existing.some((question) => question.type !== "free_response")) {
      questionBank.push(
        ...unit.drills.map((drill) => ({
          ...drill,
          id: stableId("lq", `${unit.id}|${drill.id}|exam`),
          category: unit.category,
        })),
      );
    }
    if (
      !["numbers_reading", "vocabulary", "technical_vocabulary"].includes(unit.category) &&
      !existing.some((question) => question.type === "free_response")
    ) {
      questionBank.push({
        id: stableId("lq", `${unit.id}|open`),
        unitId: unit.id,
        category: unit.category,
        type: "free_response",
        promptZh: `请在面试或商务场景中，用“${unit.targetJa}”完成一句自然、可说出口的日语表达。`,
        choices: [],
        acceptedAnswers: [],
        correctOrder: [],
        rubricZh: "准确表达原意，语法自然，语域合适，不能增加未经确认的个人事实。",
      });
    }
  }

  return {
    version: 1,
    ...metadata,
    summaryZh: languageSummary(raw.summaryZh, units.length),
    immediateAdviceZh: text(raw.immediateAdviceZh),
    units,
    questionBank,
  };
}

export async function loadLanguageState(notes?: ObsidianNote[]) {
  const allNotes = notes ?? (await readAllNotes());
  const bank = latestBank(allNotes);
  const source = buildSourceContext(allNotes);
  const events = allNotes.flatMap((note) =>
    note.path.startsWith("30_日本語学習/瞬発訓練ログ/")
      ? trainingEvents(note.content)
      : [],
  );
  const attempts = allNotes.flatMap((note) => {
    if (!note.path.startsWith("30_日本語学習/瞬発訓練ログ/")) return [];
    const attempt = markerJson<LanguageSessionAttempt>(
      note.content,
      SESSION_START,
      SESSION_END,
    );
    return attempt ? [attempt] : [];
  });
  const feedbacks = allNotes.flatMap((note) => {
    if (!note.path.startsWith("30_日本語学習/瞬発訓練ログ/")) return [];
    const feedback = markerJson<LanguageCoachFeedback>(
      note.content,
      COACH_START,
      COACH_END,
    );
    return feedback ? [feedback] : [];
  });
  const reports = allNotes.flatMap((note) => {
    if (!note.path.startsWith("30_日本語学習/言語試験ログ/")) return [];
    const report = markerJson<LanguageExamReport>(note.content, EXAM_START, EXAM_END);
    return report ? [report] : [];
  });
  return deriveLanguageState(
    bank,
    events,
    attempts,
    feedbacks,
    reports,
    source.sourceFingerprint,
  );
}

export function renderLanguageBank(bank: LanguageBank) {
  const contentFingerprint = bank.contentFingerprint || languageBankContentFingerprint(bank);
  const renderedBank = { ...bank, contentFingerprint };
  const unitList = bank.units
    .map(
      (unit) =>
        `## ${unit.titleZh}\n\n- ID: \`${unit.id}\`\n- 分类: ${unit.category}\n- 目标: ${unit.targetJa}\n- 读音: ${unit.reading || "—"}\n- 含义: ${unit.meaningZh}\n- 优先级: ${unit.priority}\n`,
    )
    .join("\n");
  return `---\ntype: language-bank\nlifecycle: current\nschema_version: 2\ngenerated_at: ${bank.generatedAt}\nmodel: ${yamlString(
    bank.model,
  )}\nsource_fingerprint: ${bank.sourceFingerprint}\ncontent_fingerprint: ${contentFingerprint}\n---\n\n# 个性化日语训练库\n\n${
    bank.summaryZh
  }\n\n> 立即改善：${bank.immediateAdviceZh}\n\n${unitList}\n${BANK_START}\n\`\`\`json\n${JSON.stringify(
    renderedBank,
    null,
    2,
  )}\n\`\`\`\n${BANK_END}\n`;
}

export function renderLanguageSession(
  attempt: LanguageSessionAttempt,
  events: LanguageTrainingEvent[],
  bank: LanguageBank,
) {
  const details = attempt.grades
    .map((grade) => {
      const unit = bank.units.find((candidate) => candidate.id === grade.unitId);
      return `- ${grade.passed ? "✅" : "❌"} ${unit?.titleZh ?? grade.unitId}：${grade.userAnswer || "（未作答）"} → ${grade.correctAnswer}`;
    })
    .join("\n");
  const markers = events
    .map((event) => `${EVENT_PREFIX}${JSON.stringify(event)} -->`)
    .join("\n");
  return `---\ntype: language-session-log\ndate: ${attempt.submittedAt.slice(
    0,
    10,
  )}\nscore: ${attempt.score}\n---\n\n# 日语瞬发训练\n\n- 完成时间：${attempt.submittedAt}\n- 单元数：${attempt.unitIds.length}\n- 固定练习得分：${attempt.score}\n\n${details}\n\n${markers}\n\n${SESSION_START}\n\`\`\`json\n${JSON.stringify(
    attempt,
    null,
    2,
  )}\n\`\`\`\n${SESSION_END}\n`;
}

export function renderLanguageCoachFeedback(feedback: LanguageCoachFeedback) {
  const details = feedback.unitFeedbacks
    .map(
      (item) =>
        `## ${item.unitId}\n\n- 点评：${item.feedbackZh}\n- 推荐改写：${item.correctedJa}\n`,
    )
    .join("\n");
  return `---\ntype: language-coach-log\ndate: ${feedback.submittedAt.slice(
    0,
    10,
  )}\nmodel: ${yamlString(feedback.model)}\n---\n\n# 日语造句教练反馈\n\n${
    feedback.summaryZh
  }\n\n${details}\n${COACH_START}\n\`\`\`json\n${JSON.stringify(
    feedback,
    null,
    2,
  )}\n\`\`\`\n${COACH_END}\n`;
}

export function renderLanguageExamReport(report: LanguageExamReport) {
  const details = report.grades
    .map(
      (grade, index) =>
        `## ${index + 1}. ${grade.passed ? "通过" : "未通过"} · ${grade.score}分\n\n- 回答：${grade.userAnswer || "（未作答）"}\n- 标准：${grade.correctAnswer || "开放题评分"}\n- 反馈：${grade.feedbackZh}\n${grade.improvedAnswerJa ? `- 推荐改写：${grade.improvedAnswerJa}\n` : ""}`,
    )
    .join("\n");
  return `---\ntype: language-exam-log\ndate: ${report.submittedAt.slice(
    0,
    10,
  )}\nexam: ${yamlString(report.examName)}\nscore: ${report.score}\nmodel: ${yamlString(
    report.model,
  )}\n---\n\n# ${report.examName}\n\n总分：**${report.score}**\n\n${details}\n${EXAM_START}\n\`\`\`json\n${JSON.stringify(
    report,
    null,
    2,
  )}\n\`\`\`\n${EXAM_END}\n`;
}
