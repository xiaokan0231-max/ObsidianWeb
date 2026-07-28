/**
 * AI 活用のようなテーマ別教材は、完成回答ではなく再利用できる語彙・型を正本にする。
 * Markdown は人が読める形を保ちつつ、H3 の安定 ID と `字段:: 值` だけを機械契約にする。
 */

export type LanguageExpressionCourseNote = {
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
};

export type ExpressionLevel = "core" | "extended";

export type ExpressionChunk = {
  id: string;
  title: string;
  level: ExpressionLevel;
  japanese: string;
  reading: string;
  meaningZh: string;
  collocations: string[];
  exampleJa: string;
  alternativesJa: string[];
  topics: string[];
  factBoundary: string;
};

export type SentencePattern = {
  id: string;
  title: string;
  level: ExpressionLevel;
  functionZh: string;
  patternJa: string;
  slotsZh: string;
  examplesJa: string[];
  topics: string[];
};

export type IdeaCardCategory = "cause" | "solution" | "personal" | "boundary";

export type IdeaCard = {
  id: string;
  title: string;
  category: IdeaCardCategory;
  keywords: string[];
  descriptionZh: string;
  relatedChunkIds: string[];
};

export type CorrectionCard = {
  id: string;
  title: string;
  originalJa: string;
  correctedJa: string;
  replacementPractice: string;
  evidenceRefs: string[];
};

export type SafeRewriteCard = {
  id: string;
  title: string;
  riskyJa: string;
  safeJa: string;
  reasonZh: string;
  replacementPractice: string;
};

export type RandomPromptRecipe = {
  id: string;
  title: string;
  causeCategories: string[];
  solutionCategories: string[];
  patternLevels: ExpressionLevel[];
  promptZh: string;
};

export type LanguageExpressionCourse = {
  courseId: string;
  title: string;
  topic: string;
  notePath: string;
  schemaVersion: number;
  chunks: ExpressionChunk[];
  patterns: SentencePattern[];
  ideaCards: IdeaCard[];
  corrections: CorrectionCard[];
  safeRewrites: SafeRewriteCard[];
  recipes: RandomPromptRecipe[];
  itemIds: string[];
};

export type LanguageExpressionExercise =
  | "recall"
  | "collocation"
  | "substitution"
  | "improv"
  | "rewrite";

export type LanguageExpressionProgressAction = "completed" | "reopened";

export type LanguageExpressionProgressEvent = {
  eventId: string;
  courseId: string;
  itemId: string;
  exercise: LanguageExpressionExercise;
  action: LanguageExpressionProgressAction;
  at: string;
};

export type LanguageExpressionProgressState = {
  completedKeys: string[];
  improvCount: number;
  lastEventAt?: string;
};

export const LANGUAGE_EXPRESSION_PROGRESS_MARKER = "language-expression-progress";

const FORBIDDEN_SCRIPT = /标准回答|標準回答|20秒版|60秒版/u;
const ITEM_HEADING = /^###\s+([csienr]\d+)\s*(?:[｜|:：—–-]\s*)?(.*?)\s*$/u;
const FIELD_LINE = /^\s*-\s+(?:\*\*)?([^:*：]+?)(?:\*\*)?::\s*(.*?)\s*$/u;
const ITEM_ORDER = { c: 0, s: 1, i: 2, e: 3, n: 4, r: 5 } as const;

type RawItem = {
  id: string;
  title: string;
  fields: Map<string, string[]>;
};

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function normalizeFieldName(value: string) {
  return value
    .replace(/\s+/gu, "")
    .replace(/[（）()【】[\]「」『』]/gu, "")
    .toLowerCase();
}

function field(item: RawItem, ...names: string[]) {
  for (const name of names) {
    const value = item.fields.get(normalizeFieldName(name))?.at(-1)?.trim();
    if (value) return value;
  }
  return "";
}

function fields(item: RawItem, ...names: string[]) {
  return rawFields(item, ...names).flatMap(splitList);
}

function rawFields(item: RawItem, ...names: string[]) {
  return names
    .flatMap((name) => item.fields.get(normalizeFieldName(name)) ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
}

function wikiLinkFields(item: RawItem, ...names: string[]) {
  return rawFields(item, ...names).flatMap((value) => {
    const links = [...value.matchAll(/\[\[[^\]]+\]\]/gu)].map((match) => match[0]);
    return links.length ? links : splitList(value);
  });
}

function splitList(value: string) {
  return value
    .split(/\s*(?:／|、|，|,|；|;|\|)\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseLevel(value: string): ExpressionLevel | undefined {
  const normalized = value.trim().toLowerCase();
  if (["core", "核心", "主动", "必須", "必須表現"].includes(normalized)) return "core";
  if (["extended", "扩展", "拡張", "補助", "理解"].includes(normalized)) return "extended";
  return undefined;
}

function parseIdeaCategory(value: string): IdeaCardCategory | undefined {
  const normalized = value.trim().toLowerCase();
  if (["cause", "原因", "要因"].includes(normalized)) return "cause";
  if (["solution", "对策", "対策", "解决"].includes(normalized)) return "solution";
  if (["personal", "本人", "本人连接", "本人接続", "贡献"].includes(normalized)) return "personal";
  if (["boundary", "边界", "境界", "事实边界", "事実境界"].includes(normalized)) return "boundary";
  return undefined;
}

function parseRawItems(content: string) {
  const items: RawItem[] = [];
  let current: RawItem | undefined;
  for (const line of content.split(/\r?\n/u)) {
    const heading = line.match(ITEM_HEADING);
    if (heading) {
      current = {
        id: heading[1].toLowerCase(),
        title: heading[2].trim(),
        fields: new Map(),
      };
      items.push(current);
      continue;
    }
    if (!current) continue;
    const match = line.match(FIELD_LINE);
    if (!match) continue;
    const key = normalizeFieldName(match[1]);
    const values = current.fields.get(key) ?? [];
    values.push(match[2].trim());
    current.fields.set(key, values);
  }
  return items;
}

function h1(content: string) {
  return content.match(/^#\s+(.+?)\s*$/mu)?.[1]?.trim() ?? "";
}

export function isLanguageExpressionCourseNote(note: LanguageExpressionCourseNote) {
  return (
    text(note.frontmatter.type) === "material" &&
    text(note.frontmatter.material_kind) === "language-expression-course"
  );
}

function chunkFromRaw(item: RawItem): ExpressionChunk {
  return {
    id: item.id,
    title: item.title || field(item, "日语", "日本語", "词块", "語句"),
    level: parseLevel(field(item, "级别", "レベル", "level")) ?? "core",
    japanese: field(item, "日语", "日本語", "词块", "語句", "表現"),
    reading: field(item, "读音", "読み", "ふりがな"),
    meaningZh: field(item, "中文", "中文功能", "意味", "中国語"),
    collocations: fields(item, "搭配", "固定搭配", "コロケーション", "組み合わせ"),
    exampleJa: field(item, "例句", "例文", "短例文"),
    alternativesJa: fields(item, "近义", "近义表达", "言い換え", "類似表現"),
    topics: fields(item, "主题", "テーマ", "適用テーマ"),
    factBoundary: field(item, "事实边界", "事実境界", "边界", "注意"),
  };
}

function patternFromRaw(item: RawItem): SentencePattern {
  return {
    id: item.id,
    title: item.title || field(item, "功能", "機能", "句型"),
    level: parseLevel(field(item, "级别", "レベル", "level")) ?? "core",
    functionZh: field(item, "功能", "中文功能", "機能", "用途"),
    patternJa: field(item, "句型", "パターン", "型", "日本語"),
    slotsZh: field(item, "槽位", "スロット", "替换位置", "置換箇所"),
    examplesJa: fields(item, "例句", "例文", "短例文", "例句1", "例句2"),
    topics: fields(item, "主题", "テーマ", "適用テーマ"),
  };
}

function ideaFromRaw(item: RawItem): IdeaCard {
  return {
    id: item.id,
    title: item.title || field(item, "关键词", "キーワード"),
    category: parseIdeaCategory(field(item, "类别", "カテゴリ", "category")) ?? "cause",
    keywords: fields(item, "关键词", "キーワード", "内容"),
    descriptionZh: field(item, "说明", "説明", "中文说明", "使い方"),
    relatedChunkIds: fields(item, "相关词块", "関連語句", "关联词块", "関連ID").map((id) =>
      id.toLowerCase(),
    ),
  };
}

function correctionFromRaw(item: RawItem): CorrectionCard {
  return {
    id: item.id,
    title: item.title || field(item, "原句"),
    originalJa: field(item, "原句", "误用", "誤用", "原文"),
    correctedJa: field(item, "修正", "正用", "修正文"),
    replacementPractice: field(item, "替换练习", "置換練習", "練習"),
    evidenceRefs: wikiLinkFields(item, "证据", "証拠", "来源", "出典"),
  };
}

function safeRewriteFromRaw(item: RawItem): SafeRewriteCard {
  return {
    id: item.id,
    title: item.title || field(item, "危险表达", "危険表現"),
    riskyJa: field(item, "危险表达", "危険表現", "原句"),
    safeJa: field(item, "安全表达", "安全表現", "改写", "言い換え"),
    reasonZh: field(item, "原因", "理由", "风险", "リスク"),
    replacementPractice: field(item, "替换练习", "置換練習", "練習"),
  };
}

function recipeFromRaw(item: RawItem): RandomPromptRecipe {
  const levelText = fields(item, "句型级别", "句型レベル", "レベル").join(" ");
  const patternLevels: ExpressionLevel[] = [
    ...(levelText.match(/\bcore\b/giu) ? ["core" as const] : []),
    ...(levelText.match(/\bextended\b/giu) ? ["extended" as const] : []),
  ];
  return {
    id: item.id,
    title: item.title || field(item, "名称", "名前"),
    causeCategories: fields(item, "原因类别", "原因カテゴリ", "原因"),
    solutionCategories: fields(item, "对策类别", "対策カテゴリ", "对策", "対策"),
    patternLevels,
    promptZh: field(item, "提示", "中文提示", "プロンプト"),
  };
}

export function validateLanguageExpressionCourse(course: LanguageExpressionCourse) {
  const errors: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(course.courseId)) {
    errors.push("course_id 只能使用小写字母、数字和连字符。");
  }
  if (!course.title) errors.push("课程缺少 title。");
  if (!course.topic) errors.push("课程缺少 topic。");
  if (course.schemaVersion !== 1) errors.push("schema_version 必须是 1。");

  const allIds = [
    ...course.chunks,
    ...course.patterns,
    ...course.ideaCards,
    ...course.corrections,
    ...course.safeRewrites,
    ...course.recipes,
  ].map((item) => item.id);
  const duplicateIds = [...new Set(allIds.filter((id, index) => allIds.indexOf(id) !== index))];
  if (duplicateIds.length) errors.push(`项目 ID 重复：${duplicateIds.join("、")}。`);

  const stableIds = allIds.filter((id) => !/^[csienr]\d+$/u.test(id));
  if (stableIds.length) errors.push(`项目 ID 不稳定：${stableIds.join("、")}。`);

  const coreChunks = course.chunks.filter((item) => item.level === "core");
  const extendedChunks = course.chunks.filter((item) => item.level === "extended");
  if (coreChunks.length !== 16) errors.push(`核心词块必须是 16 个，当前为 ${coreChunks.length} 个。`);
  if (extendedChunks.length !== 12) {
    errors.push(`扩展词块必须是 12 个，当前为 ${extendedChunks.length} 个。`);
  }
  const corePatterns = course.patterns.filter((item) => item.level === "core");
  const extendedPatterns = course.patterns.filter((item) => item.level === "extended");
  if (corePatterns.length !== 12) errors.push(`核心句型必须是 12 个，当前为 ${corePatterns.length} 个。`);
  if (extendedPatterns.length !== 6) {
    errors.push(`扩展句型必须是 6 个，当前为 ${extendedPatterns.length} 个。`);
  }

  for (const item of course.chunks) {
    const missing = [
      !item.title && "标题",
      !item.japanese && "日语",
      !item.reading && "读音",
      !item.meaningZh && "中文功能",
      !item.collocations.length && "固定搭配",
      !item.exampleJa && "例句",
      !item.alternativesJa.length && "近义表达",
      !item.topics.length && "主题",
      !item.factBoundary && "事实边界",
    ].filter(Boolean);
    if (missing.length) errors.push(`${item.id} 缺少：${missing.join("、")}。`);
  }
  for (const item of course.patterns) {
    const missing = [
      !item.title && "标题",
      !item.functionZh && "功能",
      !item.patternJa && "句型",
      !item.slotsZh && "槽位",
      item.examplesJa.length < 2 && "两个例句",
      !item.topics.length && "主题",
    ].filter(Boolean);
    if (missing.length) errors.push(`${item.id} 缺少：${missing.join("、")}。`);
  }
  for (const item of course.ideaCards) {
    if (!item.title || !item.keywords.length || !item.descriptionZh) {
      errors.push(`${item.id} 的标题、关键词或说明不完整。`);
    }
    const invalid = item.relatedChunkIds.filter((id) => !course.chunks.some((chunk) => chunk.id === id));
    if (invalid.length) errors.push(`${item.id} 引用了不存在的词块：${invalid.join("、")}。`);
  }
  for (const item of course.corrections) {
    if (!item.title || !item.originalJa || !item.correctedJa || !item.replacementPractice || !item.evidenceRefs.length) {
      errors.push(`${item.id} 的原句、修正、替换练习或证据不完整。`);
    }
  }
  for (const item of course.safeRewrites) {
    if (!item.title || !item.riskyJa || !item.safeJa || !item.reasonZh || !item.replacementPractice) {
      errors.push(`${item.id} 的危险表达、安全改写、理由或替换练习不完整。`);
    }
  }
  for (const item of course.recipes) {
    if (
      !item.title ||
      !item.causeCategories.length ||
      !item.solutionCategories.length ||
      !item.patternLevels.length ||
      !item.promptZh
    ) {
      errors.push(`${item.id} 的随机组句配方不完整。`);
    }
  }
  if (!course.ideaCards.length) errors.push("课程至少需要一张思路关键词卡。");
  if (!course.corrections.length) errors.push("课程至少需要一张真实口误修正卡。");
  if (!course.safeRewrites.length) errors.push("课程至少需要一张危险表达改写卡。");
  if (!course.recipes.length) errors.push("课程至少需要一个随机组句配方。");
  return errors;
}

export function parseLanguageExpressionCourse(
  note: LanguageExpressionCourseNote,
): LanguageExpressionCourse | null {
  if (!isLanguageExpressionCourseNote(note)) return null;
  if (FORBIDDEN_SCRIPT.test(note.content)) {
    throw new Error(`${note.path}: 专项课程禁止保存标准回答或 20／60 秒背诵稿。`);
  }
  const rawItems = parseRawItems(note.content);
  const course: LanguageExpressionCourse = {
    courseId: text(note.frontmatter.course_id),
    title: text(note.frontmatter.title) || h1(note.content),
    topic: text(note.frontmatter.topic),
    notePath: note.path,
    schemaVersion: Number(note.frontmatter.schema_version),
    chunks: rawItems.filter((item) => item.id.startsWith("c")).map(chunkFromRaw),
    patterns: rawItems.filter((item) => item.id.startsWith("s")).map(patternFromRaw),
    ideaCards: rawItems.filter((item) => item.id.startsWith("i")).map(ideaFromRaw),
    corrections: rawItems.filter((item) => item.id.startsWith("e")).map(correctionFromRaw),
    safeRewrites: rawItems.filter((item) => item.id.startsWith("n")).map(safeRewriteFromRaw),
    recipes: rawItems.filter((item) => item.id.startsWith("r")).map(recipeFromRaw),
    itemIds: [],
  };
  course.itemIds = [
    ...course.chunks,
    ...course.patterns,
    ...course.ideaCards,
    ...course.corrections,
    ...course.safeRewrites,
    ...course.recipes,
  ]
    .map((item) => item.id)
    .sort((left, right) => {
      const prefix = ITEM_ORDER[left[0] as keyof typeof ITEM_ORDER] - ITEM_ORDER[right[0] as keyof typeof ITEM_ORDER];
      return prefix || Number(left.slice(1)) - Number(right.slice(1));
    });
  const errors = validateLanguageExpressionCourse(course);
  if (errors.length) throw new Error(`${note.path}: ${errors.join("\n")}`);
  return course;
}

export function findLanguageExpressionCourses(notes: LanguageExpressionCourseNote[]) {
  return notes
    .filter(isLanguageExpressionCourseNote)
    .map((note) => parseLanguageExpressionCourse(note))
    .filter((course): course is LanguageExpressionCourse => Boolean(course))
    .sort((left, right) => left.title.localeCompare(right.title, "ja"));
}

export function languageExpressionProgressKey(
  exercise: LanguageExpressionExercise,
  itemId: string,
) {
  return `${exercise}:${itemId}`;
}

export function renderLanguageExpressionProgressEvent(event: LanguageExpressionProgressEvent) {
  const json = JSON.stringify(event).replace(/</gu, "\\u003c").replace(/--/gu, "\\u002d\\u002d");
  return `\n<!-- ${LANGUAGE_EXPRESSION_PROGRESS_MARKER}:${json} -->\n`;
}

export function parseLanguageExpressionProgress(content: string) {
  const events: LanguageExpressionProgressEvent[] = [];
  const pattern = new RegExp(
    `<!--\\s*${LANGUAGE_EXPRESSION_PROGRESS_MARKER}:(\\{[\\s\\S]*?\\})\\s*-->`,
    "gu",
  );
  for (const match of content.matchAll(pattern)) {
    try {
      const event = JSON.parse(match[1]) as Partial<LanguageExpressionProgressEvent>;
      if (
        typeof event.eventId === "string" &&
        typeof event.courseId === "string" &&
        typeof event.itemId === "string" &&
        ["recall", "collocation", "substitution", "improv", "rewrite"].includes(
          event.exercise ?? "",
        ) &&
        ["completed", "reopened"].includes(event.action ?? "") &&
        typeof event.at === "string"
      ) {
        events.push(event as LanguageExpressionProgressEvent);
      }
    } catch {
      // 壊れた一行で過去の有効な練習履歴まで読めなくしない。
    }
  }
  return events;
}

export function deriveLanguageExpressionProgress(
  events: LanguageExpressionProgressEvent[],
): LanguageExpressionProgressState {
  const latest = new Map<string, LanguageExpressionProgressEvent>();
  const seenEventIds = new Set<string>();
  let improvCount = 0;
  let lastEventAt: string | undefined;
  for (const event of events) {
    if (seenEventIds.has(event.eventId)) continue;
    seenEventIds.add(event.eventId);
    if (event.exercise === "improv") {
      if (event.action === "completed") improvCount += 1;
    } else {
      latest.set(languageExpressionProgressKey(event.exercise, event.itemId), event);
    }
    lastEventAt = event.at;
  }
  return {
    completedKeys: [...latest.entries()]
      .filter(([, event]) => event.action === "completed")
      .map(([key]) => key)
      .sort(),
    improvCount,
    ...(lastEventAt ? { lastEventAt } : {}),
  };
}

export function languageExpressionProgressPath(course: Pick<LanguageExpressionCourse, "topic">) {
  const topic = course.topic
    .trim()
    .replace(/[\\/:*?"<>|]/gu, "＿")
    .replace(/\.\./gu, "．");
  if (!topic) throw new Error("课程 topic 为空，无法生成进度路径。");
  return `30_日本語学習/専門コースログ/${topic}_進捗.md`;
}

export function renderLanguageExpressionProgressNote(
  course: LanguageExpressionCourse,
  event?: LanguageExpressionProgressEvent,
) {
  const source = course.notePath.replace(/\.md$/iu, "");
  return `---
type: language-expression-course-progress
course_id: ${JSON.stringify(course.courseId)}
topic: ${JSON.stringify(course.topic)}
source_note: ${JSON.stringify(`[[${source}]]`)}
layer: user-action
---
# ${course.topic} 進捗

> 「練習した」という本人操作だけを追記する履歴です。「習得済み」を意味しません。

## 練習イベント
${event ? renderLanguageExpressionProgressEvent(event).replace(/^\n/u, "") : ""}`;
}
