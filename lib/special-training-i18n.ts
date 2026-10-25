import { resolveUiLocale, type UiLocale } from "./ui-locale.ts";
import type { QuestionTopicId } from "./interview-question-collection.ts";
import type { LanguageDimension } from "./interview-language.ts";

export type TrainingCopyTable = Record<string, readonly [string, string]>;
export type TrainingCopyValues = Record<string, string | number | null | undefined>;

/** 复用现有中日双语字典和 locale；格式化只作用于显示，不写回原材料或进度。 */
export function createTrainingCopy<T extends TrainingCopyTable>(dictionary: T, requestedLocale: UiLocale) {
  const locale = resolveUiLocale(requestedLocale);
  const unavailable = locale === "ja" ? "表示できません" : "暂无法显示";
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const number = (value: number) => Number.isFinite(value) ? formatter.format(value) : "—";
  const pick = (value: readonly [string, string] | undefined) =>
    (locale === "ja" ? value?.[1]?.trim() || value?.[0] : value?.[0]) || unavailable;
  const t = (key: keyof T & string, values: TrainingCopyValues = {}) => pick(dictionary[key]).replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name];
    return value == null ? "—" : typeof value === "number" ? number(value) : value;
  });
  const label = (value: string) => Object.hasOwn(dictionary, value) ? t(value) : value;
  return { locale, t, label, pick, number, date: (value: string) => trainingDate(value, locale), dateTime: (value: string) => trainingDateTime(value, locale) };
}

export function trainingDate(value: string, requestedLocale: UiLocale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const validation = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(validation.getTime()) || validation.toISOString().slice(0, 10) !== value) return value;
  return new Intl.DateTimeFormat(resolveUiLocale(requestedLocale), { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" })
    .format(new Date(`${value}T00:00:00+09:00`));
}

export function trainingDateTime(value: string, requestedLocale: UiLocale) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return trainingDate(value, requestedLocale);
  const datePart = value.match(/^(\d{4}-\d{2}-\d{2})T/)?.[1];
  if (datePart && trainingDate(datePart, requestedLocale) === datePart) return value;
  // 无时区的旧时间按产品约定视为 JST，不交给本机时区猜测。
  const input = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? `${value}+09:00` : value;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(resolveUiLocale(requestedLocale), { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Tokyo" }).format(date);
}

const TOPIC_JA: Record<QuestionTopicId, readonly [string, string]> = {
  introduction: ["自己紹介", "概要だけを求める質問と、職歴や転職活動も含めて求める質問を区別します。"],
  career: ["職歴・経験", "どの経験・会社について、いつからいつまでを聞かれているか確認します。"],
  "leaving-japan": ["退職・来日・応募の理由", "退職理由、来日理由、その会社への応募理由を分けて考えます。"],
  responsibility: ["役割・職位・担当範囲", "過去の役割、現在の分担、希望する役割のどれを聞かれているか確認します。"],
  "projects-technology": ["プロジェクト・技術", "実務での使用、学習、設計上の判断、具体的な案件を区別します。"],
  "team-collaboration": ["チーム・協働", "規模、個人の分担、進め方、協働する相手を分けて答えます。"],
  "aspirations-preferences": ["方向性・意向・希望", "やりたいこと、受け入れる意向、過去の経験を区別します。"],
  "conditions-start": ["勤務条件・入社時期", "条件、時期、程度、前提を一緒に確認します。"],
  "job-search": ["転職活動・応募経路", "他社選考、応募経路、優先順位ごとの時間の範囲を確認します。"],
  "background-life": ["生活背景・個人の状況", "質問された範囲に沿い、キーワードだけで個人情報を広げません。"],
  "language-learning": ["日本語・学習・日本での経験", "資格、会話の状況、学習方法、日本での実務経験を区別します。"],
  interaction: ["確認・聞き直し・逆質問への誘い", "確認、意見を求める発話、逆質問の案内も実際の問いとして読みます。"],
  "company-role": ["企業・ポジションの理解", "自分の理解を説明することと、役割を受け入れる意思表示を区別します。"],
  other: ["その他の質問", "共通する意図にまだ分類できない実際の質問を残します。"],
};
const DIMENSION_JA: Record<LanguageDimension, readonly [string, string]> = {
  honorific: ["敬語", "動作をする人を確かめ、丁寧な表現と実際の依頼を分けて読みます。"],
  expression: ["よく使う表現", "面談での前置き、確認、比較、自由な回答を求める表現を理解します。"],
  grammar: ["文法", "並列、条件、時間、範囲から、この一文が何を求めているか読みます。"],
  vocabulary: ["語彙", "実際の質問の中で、組み合わせ、対象、意味の違いを確認します。"],
};

export function trainingTopicCopy(topic: { id: QuestionTopicId; titleZh: string; summaryZh: string }, locale: UiLocale) {
  return locale === "ja" ? { title: TOPIC_JA[topic.id][0], summary: TOPIC_JA[topic.id][1] } : { title: topic.titleZh, summary: topic.summaryZh };
}
export function trainingDimensionCopy(dimension: { id: LanguageDimension; titleZh: string; summaryZh: string }, locale: UiLocale) {
  return locale === "ja" ? { title: DIMENSION_JA[dimension.id][0], summary: DIMENSION_JA[dimension.id][1] } : { title: dimension.titleZh, summary: dimension.summaryZh };
}
