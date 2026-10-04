import type { LanguageTrainingStage } from "./types.ts";
import type {
  QuickCard,
  QuickCardReason,
  QuickCardType,
  QuickGroup,
  QuickItem,
  QuickLayer,
  QuickPatch,
  QuickSelfRating,
} from "./quick-types.ts";
import { QUICK_EMPTY } from "./quick-types.ts";
import { alignReading } from "./quick-items.ts";
import { stableHash } from "../dojo/utils.ts";
import {
  clipContextRange,
  dice,
  isKanaOnly,
  isKanjiOnly,
  normalizeQuickAnswer,
  seededShuffle,
  stableSeed,
} from "./quick-text.ts";

/*
 * 出卡与判分。服务端取题、服务端判分、客户端即时显示都调这里，只有一份规则。
 *
 * 题型随掌握阶段分三层（服务端决定，客户端不能选）：
 * - R 识别（unseen / recognized）：点选。
 * - D 辨析（correctable）：更难的点选。
 * - P 提取（retrievable 及以上，即 ≥2 个成功日）：才允许短输入，且受每组打字题上限约束。
 * 某层没有可用题型时先往下一层找，再往上；短输入只在条目本身处于 P 层时出。
 *
 * 干扰项全部确定性生成（种子 itemId|type|day），没有人工或 AI 校验，所以排除规则宁严勿松：
 * 凑不够就不出这个题型，不放宽到别的组。
 */

const BLANK = "＿＿";
const NATURAL_BLANK = "＿＿＿＿";
const STEM_MAX = 30;
const OPTION_MAX = 28;
const JA_OPTION_MAX = 20;
const NATURAL_OPTION_MAX = 24;
const NATURAL_CORE_MAX = 12;
const NATURAL_CONTEXT = 4;
const INPUT_MAX = 6;
const READING_INPUT_MAX = 8;
const READING_MAX = 12;
const CHOICE_TYPES = new Set<QuickCardType>([
  "meaning_choice",
  "reading_choice",
  "word_choice",
  "cloze_choice",
  "natural_choice",
]);
const FLIP_ONLY = new Set<QuickGroup>(["answer_strategy", "active_chunk", "nb_pattern"]);
const CLAUSE_BREAK = /[、。？！!?]/u;
const HIRAGANA = /^[ぁ-ゖ]$/u;
const SLOT_MARK = /…|〜/u;

/**
 * 型说明兜底：只在条目自己没有解释（整理稿 型:: 括注、単語文法帳备注）时显示。
 * 只写语法规则，不举整理稿里的真实句子。
 */
export const PATTERN_HINT: Record<string, string> = {
  助詞: "動詞・形容詞ごとに取る助詞が決まっている。動作の対象・相手・場所で助詞を選ぶ。",
  い形だと: "動詞・い形容詞の普通形は「だ」を挟まずに「と思う／と考える」へつなぐ。",
  感じします: "「感じる」は一段動詞。「感じします」「感じした」とは言わない。",
  時制: "名詞を修飾する動詞は、述べる時点に合わせて辞書形とた形を選ぶ。",
  文体: "面接では普通体や「〜けど」で終えず、です・ます体で言い切る。",
  敬語: "相手側の行為は尊敬語、自分側の行為は謙譲語。自分の行為に尊敬語を使わない。",
  冗長敬語: "敬語を重ねすぎない。謙譲語と尊敬語を一つの動作に重ねない。",
  の過剰: "動詞・形容詞が名詞を直接修飾するとき、間に「の」は入れない。",
  な形: "な形容詞が名詞を修飾するときは「な」を入れる。",
  語彙: "中国語の語感に引かれず、日本語で定着している語を選ぶ。",
  語彙選択: "意味が近い語のうち、場面と結びつきが自然な語を選ぶ。",
  中文直訳: "中国語の言い回しを直訳せず、日本語の定型表現に置き換える。",
  語形: "活用形（て形・ない形・可能形・受身形など）を正しく作る。",
  搭配: "語と語の決まった組み合わせ（コロケーション）を使う。",
  語順: "修飾語は修飾される語の直前に置き、述語は文末に置く。",
  名詞化: "動詞を名詞として使うときは「こと」「の」で名詞化する。",
};

export function layerOf(stage: LanguageTrainingStage): QuickLayer {
  if (stage === "unseen" || stage === "recognized") return "R";
  if (stage === "correctable") return "D";
  return "P";
}

// ── 索引与缓存 ──────────────────────────────────────────────────

export type QuickIndex = {
  items: readonly QuickItem[];
  byId: ReadonlyMap<string, QuickItem>;
  /** 干扰项池：単語文法帳按表（A、B-1…），课程按 group。 */
  pools: ReadonlyMap<string, readonly QuickItem[]>;
  /** 纯缓存（排好序的干扰项候选、可用题型）。内容只由 items 决定，不随日期变。 */
  cache: Map<string, unknown>;
};

function poolKey(item: QuickItem) {
  return item.source === "notebook" ? `nb:${item.pattern}` : item.group;
}

export function createQuickIndex(items: readonly QuickItem[]): QuickIndex {
  const pools = new Map<string, QuickItem[]>();
  for (const item of items) {
    const key = poolKey(item);
    const list = pools.get(key) ?? [];
    list.push(item);
    pools.set(key, list);
  }
  return {
    items,
    byId: new Map(items.map((item) => [item.id, item])),
    pools,
    cache: new Map(),
  };
}

function cached<T>(index: QuickIndex, key: string, compute: () => T): T {
  if (index.cache.has(key)) return index.cache.get(key) as T;
  const value = compute();
  index.cache.set(key, value);
  return value;
}

const norm = normalizeQuickAnswer;

// ── 干扰项 ──────────────────────────────────────────────────────

/** 释义按「／、；（）」等切段：「收到」与「收到（更礼貌）」、「请教」与「请教/拜访」都要判成同义。 */
function meaningSegments(value: string) {
  return value
    .split(/[／/、；;（）()，,]/u)
    .map((part) => norm(part))
    .filter(Boolean);
}

function overlaps(left: string, right: string) {
  return left === right || left.includes(right) || right.includes(left);
}

/** 两段文本是否「可能都对」：归一化相同、互相包含、或（≥4 字时）字形过近。 */
function textClash(left: string, right: string) {
  const a = norm(left);
  const b = norm(right);
  if (!a || !b) return false;
  if (overlaps(a, b)) return true;
  return a.length >= 4 && b.length >= 4 && dice(a, b) >= 0.5;
}

/** 两个条目同时出现在一题里会不会两个选项都说得通。 */
function itemsClash(a: QuickItem, b: QuickItem) {
  const aJa = [...new Set([a.ja, ...a.jaAlts])].map(norm).filter(Boolean);
  const bJa = [...new Set([b.ja, ...b.jaAlts])].map(norm).filter(Boolean);
  if (aJa.some((left) => bJa.some((right) => overlaps(left, right)))) return true;
  if (a.meaning && b.meaning) {
    if (textClash(a.meaning, b.meaning)) return true;
    const segments = new Set(meaningSegments(a.meaning));
    if (meaningSegments(b.meaning).some((segment) => segments.has(segment))) return true;
  }
  return false;
}

/**
 * 中文释义里引了日文（「「〜しかいません」的郑重表达」「「行っている」的尊敬表达」），
 * 与日语题面/选项共用一段 ≥2 字的假名：看释义就能拼出答案，题面泄露答案。
 */
function sharesKana(meaning: string, ja: string) {
  for (const run of meaning.match(/[ぁ-ゖァ-ヺー]{2,}/gu) ?? []) {
    for (let index = 0; index + 2 <= run.length; index += 1) {
      if (ja.includes(run.slice(index, index + 2))) return true;
    }
  }
  return false;
}

type Field = "meaning" | "ja";

function fieldOf(item: QuickItem, field: Field) {
  return field === "ja" ? item.ja : item.meaning;
}

function lastChar(value: string) {
  return value.replace(/[。、]$/u, "").slice(-1);
}

/** 同组候选按「易混」排序：同词尾优先、长度相近优先；平分时按稳定哈希，结果只由条目决定。 */
function rankedCandidates(item: QuickItem, field: Field, index: QuickIndex) {
  return cached(index, `rank|${item.id}|${field}`, () => {
    const target = fieldOf(item, field);
    const pool = index.pools.get(poolKey(item)) ?? [];
    const limit = field === "ja" ? JA_OPTION_MAX : OPTION_MAX;
    const accepted = acceptedAnswers(item, field === "ja" ? "word_choice" : "meaning_choice");
    return pool
      .filter((candidate) => {
        if (candidate.id === item.id) return false;
        const value = fieldOf(candidate, field);
        if (!value || value.length > limit) return false;
        // 「〜」句型混进普通词，一眼就能排除；反之亦然。
        if (field === "ja" && candidate.hasSlot !== item.hasSlot) return false;
        if (itemsClash(item, candidate)) return false;
        return !accepted.some((answer) => textClash(answer, value));
      })
      .map((candidate) => {
        const value = fieldOf(candidate, field);
        const sameEnding = field === "ja" && lastChar(value) === lastChar(target);
        // 句型的释义带「……」（「关于……」），只有正解带省略号时一眼就能认出；释义侧优先取同样带省略号的。
        const sameSlot = field === "meaning" && SLOT_MARK.test(value) === SLOT_MARK.test(target);
        return {
          candidate,
          score: Math.abs(value.length - target.length) - (sameEnding ? 2 : 0) - (sameSlot ? 3 : 0),
          tie: stableHash(`${item.id}|${candidate.id}`),
        };
      })
      .sort((left, right) => left.score - right.score || left.tie.localeCompare(right.tie))
      .map((entry) => entry.candidate);
  });
}

function greedyPick(
  order: readonly QuickItem[],
  field: Field,
  count: number,
  fixed: readonly string[],
) {
  const picked: QuickItem[] = [];
  for (const candidate of order) {
    if (picked.length >= count) break;
    const value = fieldOf(candidate, field);
    if (picked.some((other) => itemsClash(other, candidate))) continue;
    if (fixed.some((other) => textClash(other, value))) continue;
    picked.push(candidate);
  }
  return picked.length >= count ? picked.map((candidate) => fieldOf(candidate, field)) : null;
}

/**
 * 取 count 个干扰项。前 12 个候选按种子打乱后贪心取，取不满时退回确定性顺序：
 * 可用性（不看日期）与当天的选项（看日期）因此永远一致——确定性顺序能取满，当天就一定能出题。
 */
export function pickDistractors(
  item: QuickItem,
  field: Field,
  count: number,
  seed: string,
  index: QuickIndex,
  fixed: readonly string[] = [],
) {
  const ranked = rankedCandidates(item, field, index);
  const shuffled = [...seededShuffle(ranked.slice(0, 12), seed), ...ranked.slice(12)];
  return greedyPick(shuffled, field, count, fixed) ?? greedyPick(ranked, field, count, fixed);
}

// ── 助词选项 ────────────────────────────────────────────────────

const PARTICLE_FILL: Record<string, string[]> = {
  に: ["を", "で", "が", "と", "の"],
  を: ["に", "が", "で", "と", "の"],
  が: ["を", "に", "で", "の", "と"],
  で: ["に", "を", "と", "が", "の"],
  と: ["に", "を", "で", "が", "の"],
  の: ["に", "を", "が", "で", "と"],
  は: ["を", "に", "で", "の", "と"],
  も: ["を", "に", "が", "の", "で"],
  へ: ["を", "で", "が", "と", "の"],
  や: ["の", "を", "に", "が", "で"],
  "": ["の", "を", "に", "が", "で"],
};
const DEFAULT_FILL = ["を", "に", "で", "が", "と", "の", "は"];
/**
 * 互换也成立的对子：补位时不让两者同时出现，否则可能两个选项都对。
 * が/の：连体修饰从句里的主语两者通用（「先輩が作った資料」「先輩の作った資料」）。
 */
const GA_NO = ["が", "の"] as const;
const SWAP_PAIRS: ReadonlyArray<readonly [string, string]> = [["が", "は"], ["に", "へ"], ["と", "や"], GA_NO];

/** 「〜にする／〜とする」：空格后是する的活用时，に与と多半都成立。 */
const SURU_PAIR = ["に", "と"] as const;

function swapPartners(value: string, pairs: ReadonlyArray<readonly [string, string]>) {
  return pairs.flatMap(([left, right]) => (value === left ? [right] : value === right ? [left] : []));
}

/**
 * 空格后紧跟这些助词时，能与它叠用的助词放进去也说得通（「勝つには／勝つのは／勝つとは」「ビザへの／ビザでの」），
 * 不拿来补位；正解与本人的错助词照常出现。
 */
const STACKABLE: Readonly<Record<string, readonly string[]>> = {
  は: ["に", "で", "と", "へ", "の"],
  も: ["に", "で", "と", "へ", "の"],
  の: ["で", "と", "へ"],
};

/**
 * 助词填空的 4 个选项（未打乱）：全部正解 + 本人当时的错助词，再按种子补位。
 * nextChar 是空格后紧接的字：后面是汉字或片假名（名词）且正解不是「の」时，「の」几乎总能成立，不补。
 */
export function particleOptions(patch: QuickPatch, seed: string, nextChar: string) {
  const display = (core: string) => core || QUICK_EMPTY;
  const options = [...new Set([...patch.rightCores.map(display), display(patch.wrongCore)])];
  const answers = new Set(patch.rightCores);
  const nounFollows = /[\p{Script=Han}々ァ-ヺ]/u.test(nextChar);
  const base = PARTICLE_FILL[patch.rightCores[0] ?? ""] ?? DEFAULT_FILL;
  const offset = stableSeed(seed) % base.length;
  const rotated = [...base.slice(offset), ...base.slice(0, offset), ...DEFAULT_FILL];
  // が/の 互通只发生在从句主语位置；空格后紧跟助词（「提供する＿＿は」）时「がは」根本不成立，不必回避。
  const basePairs = /^[はもをがの]/u.test(nextChar) ? SWAP_PAIRS.filter((pair) => pair !== GA_NO) : SWAP_PAIRS;
  const pairs = /^[しすさせ]/u.test(nextChar) ? [...basePairs, SURU_PAIR] : basePairs;
  for (const filler of rotated) {
    if (options.length >= 4) break;
    if (options.includes(filler)) continue;
    if (swapPartners(filler, pairs).some((partner) => options.includes(partner))) continue;
    // 「勝つ＿＿は」补「は」成了「はは」，一眼就能排除，等于少一个干扰项。
    if (STACKABLE[nextChar]?.includes(filler) || filler === nextChar) continue;
    if (filler === "の" && nounFollows && !answers.has("の")) continue;
    options.push(filler);
  }
  return options.length >= 4 ? options.slice(0, 4) : null;
}

// ── 读音变异 ────────────────────────────────────────────────────

const VOICE_PAIRS = [
  "かが", "きぎ", "くぐ", "けげ", "こご", "さざ", "しじ", "すず", "せぜ", "そぞ",
  "ただ", "ちぢ", "つづ", "てで", "とど", "はば", "ひび", "ふぶ", "へべ", "ほぼ",
  "カガ", "キギ", "クグ", "ケゲ", "コゴ", "サザ", "シジ", "スズ", "セゼ", "ソゾ",
  "タダ", "チヂ", "ツヅ", "テデ", "トド", "ハバ", "ヒビ", "フブ", "ヘベ", "ホボ",
];
const VOICE: Record<string, string> = {};
for (const [plain, voiced] of VOICE_PAIRS) {
  VOICE[plain] = voiced;
  VOICE[voiced] = plain;
}
for (const [half, voiced] of ["ぱば", "ぴび", "ぷぶ", "ぺべ", "ぽぼ", "パバ", "ピビ", "プブ", "ペベ", "ポボ"]) {
  VOICE[half] = voiced;
}
const O_ROW = "おこそとのほもよろごぞどぼぽょオコソトノホモヨロゴゾドボポョ";
const U_ROW = "うくすつぬふむゆるぐずづぶぷゅ";
const SOKUON_BEFORE = "かきくけこさしすせそたちつてとぱぴぷぺぽカキクケコサシスセソタチツテトパピプペポ";
const NO_SOKUON_AFTER = "っッんンーゃゅょャュョぁぃぅぇぉァィゥェォ";
const KATAKANA = /[ァ-ヺ]/u;
const SMALL_KANA = "ゃゅょぁぃぅぇぉャュョァィゥェォ";

const READING_OPS = ["long-", "long+", "sokuon-", "n-", "voice", "sokuon+"] as const;

/**
 * 对正确读音做确定性变异：长音增删、促音增删、拨音删除、清浊互换——正好是本人真实读错的方式。
 * 只变汉字读音部分；与 ja 相同的送假名不动（否则一眼就能排除）。
 */
export function mutateReading(reading: string, ja: string) {
  const spans = /[・\s]/u.test(reading) ? null : alignReading(ja, reading);
  const mutable = (position: number) =>
    !spans || spans.some(([start, end]) => position >= start && position < end);
  const variants: Record<(typeof READING_OPS)[number], string[]> = {
    "long-": [], "long+": [], "sokuon-": [], "n-": [], voice: [], "sokuon+": [],
  };
  for (let index = 0; index < reading.length; index += 1) {
    if (!mutable(index)) continue;
    const char = reading[index];
    const prev = reading[index - 1] ?? "";
    const next = reading[index + 1] ?? "";
    const cut = reading.slice(0, index) + reading.slice(index + 1);
    if ((char === "う" && prev && (O_ROW + U_ROW).includes(prev)) || char === "ー") variants["long-"].push(cut);
    // 后面紧跟小写假名时不插长音（「ジーャ」不是可能的读法）。
    const smallNext = next !== "" && SMALL_KANA.includes(next);
    if (O_ROW.includes(char) && !KATAKANA.test(char) && next !== "う" && !smallNext) {
      variants["long+"].push(`${reading.slice(0, index + 1)}う${reading.slice(index + 1)}`);
    } else if (KATAKANA.test(char) && !"ッンャュョァィゥェォ".includes(char) && next !== "ー" && !smallNext) {
      variants["long+"].push(`${reading.slice(0, index + 1)}ー${reading.slice(index + 1)}`);
    }
    if (char === "っ" || char === "ッ") variants["sokuon-"].push(cut);
    if ((char === "ん" || char === "ン") && reading.length > 2) variants["n-"].push(cut);
    if (VOICE[char]) variants.voice.push(reading.slice(0, index) + VOICE[char] + reading.slice(index + 1));
    if (index > 0 && SOKUON_BEFORE.includes(char) && !NO_SOKUON_AFTER.includes(prev)) {
      const mark = KATAKANA.test(char) ? "ッ" : "っ";
      variants["sokuon+"].push(`${reading.slice(0, index)}${mark}${reading.slice(index)}`);
    }
  }
  const original = norm(reading);
  for (const op of READING_OPS) {
    variants[op] = [...new Set(variants[op])].filter((value) => norm(value) && norm(value) !== original);
  }
  return variants;
}

function readingDistractors(item: QuickItem, index: QuickIndex, seed: string | null) {
  const variants = mutateReading(item.reading, item.ja);
  const picked: string[] = [];
  const seen = new Set([norm(item.reading)]);
  const take = (value: string) => {
    const key = norm(value);
    if (!key || seen.has(key) || picked.length >= 3) return;
    seen.add(key);
    picked.push(value);
  };
  const longest = Math.max(...READING_OPS.map((op) => variants[op].length));
  // 六种变异轮流各取一个；种子只决定每种里取哪一个，候选集合不随日期变，可用性因此与日期无关。
  for (let round = 0; round < longest && picked.length < 3; round += 1) {
    for (const op of READING_OPS) {
      const list = variants[op];
      if (round >= list.length) continue;
      const shift = seed === null ? 0 : stableSeed(`${seed}|${op}`);
      take(list[(shift + round) % list.length]);
    }
  }
  if (picked.length < 3) {
    const others = (index.pools.get(poolKey(item)) ?? [])
      .filter((candidate) => candidate.id !== item.id && candidate.reading)
      .map((candidate) => candidate.reading)
      .sort((left, right) =>
        Math.abs(left.length - item.reading.length) - Math.abs(right.length - item.reading.length) ||
        left.localeCompare(right));
    for (const value of others) take(value);
  }
  return picked.length >= 3 ? picked : null;
}

// ── 改错题的版面 ────────────────────────────────────────────────

type Anchored = { base: string; coreStart: number; present: string; spanStart: number; spanEnd: number };

/** 差异核在哪段文本里、从哪开始：原句能唯一定位就用原句，否则退回错形本身。span 是标注者划的错形（或修正）范围。 */
function anchorCore(patch: QuickPatch): Anchored {
  if (patch.anchor === "wrong") {
    const at = patch.context.indexOf(patch.wrong);
    return {
      base: patch.context,
      coreStart: at + patch.pre.length,
      present: patch.wrongCore,
      spanStart: at,
      spanEnd: at + patch.wrong.length,
    };
  }
  if (patch.anchor === "fix") {
    const at = patch.context.indexOf(patch.fixes[0]);
    return {
      base: patch.context,
      coreStart: at + patch.pre.length,
      present: patch.rightCores[0] ?? "",
      spanStart: at,
      spanEnd: at + patch.fixes[0].length,
    };
  }
  return {
    base: patch.wrong,
    coreStart: patch.pre.length,
    present: patch.wrongCore,
    spanStart: 0,
    spanEnd: patch.wrong.length,
  };
}

function charClass(char: string | undefined) {
  if (!char) return "";
  if (/[\p{Script=Han}々]/u.test(char)) return "han";
  if (/[ァ-ヺー]/u.test(char)) return "katakana";
  if (/[A-Za-z0-9]/u.test(char)) return "latin";
  return "";
}

/**
 * 差异核左侧给多少语境：优先用标注者划的错形范围里差异核之前的字（那是天然的词边界），最多 4 字；
 * 错形范围里不足 2 字时才向原句借，不跨句读。切口落在汉字/片假名串中间时，
 * 差 4 字以内就补全整个词，否则收回到串边——平假名无法分词，只能靠标注范围兜住。
 */
function windowLeft(base: string, spanStart: number, coreStart: number) {
  let at = Math.max(spanStart, coreStart - NATURAL_CONTEXT);
  // 错形范围只剩 1–2 字没进窗口时整段带上，不在题面外留半截（「…ておりま」+「す」）。
  if (at - spanStart <= 2) at = spanStart;
  if (coreStart - spanStart < 2) {
    while (at > 0 && coreStart - at < NATURAL_CONTEXT && !CLAUSE_BREAK.test(base[at - 1])) {
      at -= 1;
      // 借到一个汉字/片假名词的词首、前面是平假名（多半是上一个词的助词）就停。
      if (charClass(base[at]) && HIRAGANA.test(base[at - 1] ?? "")) break;
    }
  }
  const cls = charClass(base[at]);
  if (at > 0 && cls && charClass(base[at - 1]) === cls) {
    let start = at;
    while (start > 0 && charClass(base[start - 1]) === cls) start -= 1;
    if (at - start <= NATURAL_CONTEXT) return start;
    while (at < coreStart && charClass(base[at]) === cls) at += 1;
  }
  return at;
}

function windowRight(base: string, spanEnd: number, coreEnd: number) {
  let at = Math.min(spanEnd, coreEnd + NATURAL_CONTEXT);
  if (spanEnd - at <= 2) at = spanEnd;
  if (spanEnd - coreEnd < 2) {
    while (at < base.length && at - coreEnd < NATURAL_CONTEXT && !CLAUSE_BREAK.test(base[at])) {
      at += 1;
      // 借到「汉字/片假名词 + 一个平假名」、后面还是平假名时停：多半是「名词 + 助词」的边界，再借就切进下一个词。
      if (HIRAGANA.test(base[at - 1]) && charClass(base[at - 2]) && HIRAGANA.test(base[at] ?? "")) break;
    }
  }
  const cls = charClass(base[at - 1]);
  if (at < base.length && cls && charClass(base[at]) === cls) {
    let end = at;
    while (end < base.length && charClass(base[end]) === cls) end += 1;
    if (end - at <= NATURAL_CONTEXT) return end;
    while (at > coreEnd && charClass(base[at - 1]) === cls) at -= 1;
  }
  return at;
}

function clozeLayout(patch: QuickPatch) {
  if (patch.anchor === "none") {
    return { stem: `${patch.pre}${BLANK}${patch.post}`, nextChar: patch.post[0] ?? "" };
  }
  const { base, coreStart, present } = anchorCore(patch);
  const text = `${base.slice(0, coreStart)}${BLANK}${base.slice(coreStart + present.length)}`;
  return {
    stem: clipContextRange(text, coreStart, BLANK.length, { max: STEM_MAX }).text,
    nextChar: base[coreStart + present.length] ?? "",
  };
}

type NaturalLayout = {
  stem: string;
  wrong: string;
  fix: string;
  wrongMark: [number, number];
  fixMark: [number, number];
};

/**
 * 「哪个更自然」只比差异核 ± 最多 4 字，不摆整段：本人要的是短题，整段比较等于又在读长句。
 * 差异核超过 12 字的不出二选一（那已经不是一个点，而是整句重说）。
 */
/**
 * 差异核与两侧原文在接缝处重复（「同じ」+「ポジション」+「ポジションは…」）：标注者把后面的词也写进了修正，
 * 拼回原句就成了「同じポジションポジション」——正解本身不通，比两个都对更糟。错形那侧本来就重复的（口误原样）不算。
 */
function seamRepeats(before: string, core: string, after: string) {
  for (let size = 2; size <= core.length; size += 1) {
    if (after.startsWith(core.slice(-size)) || before.endsWith(core.slice(0, size))) return true;
  }
  return false;
}

const BRACKET_PAIRS: Record<string, string> = { "（": "）", "(": ")", "「": "」", "『": "』" };
const CLOSING = new Set(Object.values(BRACKET_PAIRS));

/** 选项里的括号要成对：窗口切在括注中间时会出现「法）も試す価値」这种半截选项。 */
function bracketsBalanced(text: string) {
  const stack: string[] = [];
  for (const char of text) {
    if (BRACKET_PAIRS[char]) stack.push(BRACKET_PAIRS[char]);
    else if (CLOSING.has(char) && stack.pop() !== char) return false;
  }
  return stack.length === 0;
}

/**
 * 修正把前面已有的动词又说了一遍：前文以「あ+る」这类辞书形结尾、修正以同一词干的连用形开头
 * （「原因がある」+「ありますが」）。标注者的意思是整段替换，拼回原句却成了「原因があるありますが」。
 */
function restatesVerb(before: string, core: string) {
  const stem = before.at(-2);
  return Boolean(stem) && core[0] === stem && /[うくすつぬふむゆるぐずぶぷ]$/u.test(before)
    && /^[いきしちにひみりぎじびぴ]/u.test(core.slice(1));
}

function naturalLayout(patch: QuickPatch): NaturalLayout | null {
  // 错形里并列了几种说法（「2回目の会社／3回目の会社」）：长短悬殊，一眼就能排除。
  if (/[／/]/u.test(patch.wrong)) return null;
  const { base, coreStart, present, spanStart, spanEnd } = anchorCore(patch);
  if (coreStart < 0) return null;
  const coreEnd = coreStart + present.length;
  const before = base.slice(0, coreStart);
  const after = base.slice(coreEnd);
  // 错形那侧本来就重复的（口误原样）不算接缝问题。
  const wrongSeam = seamRepeats(before, patch.wrongCore, after);
  const first = patch.rightCores[0] ?? "";
  // 首选写法把后面的词也带了进来：其余写法多半同样是替换那一整段（「がいい／を希望しています」），换一个也拼不通。
  if (!wrongSeam && seamRepeats(before, first, after)) return null;
  // 首选写法重说了前面的动词：其余写法里可能有只替换差异处的（「ありますが／のですが」），取第一个拼得通的。
  const right = patch.rightCores.find((core) => wrongSeam || (!seamRepeats(before, core, after) && !restatesVerb(before, core)));
  if (right === undefined) return null;
  if (Math.max(patch.wrongCore.length, right.length) > NATURAL_CORE_MAX) return null;
  const from = windowLeft(base, spanStart, coreStart);
  const to = windowRight(base, spanEnd, coreEnd);
  const left = base.slice(from, coreStart);
  const tail = base.slice(coreEnd, to);
  const wrong = `${left}${patch.wrongCore}${tail}`;
  const fix = `${left}${right}${tail}`;
  if (!norm(wrong) || !norm(fix) || norm(wrong) === norm(fix)) return null;
  if (wrong.length > NATURAL_OPTION_MAX || fix.length > NATURAL_OPTION_MAX) return null;
  if (/[／/]/u.test(fix) || !bracketsBalanced(wrong) || !bracketsBalanced(fix)) return null;
  const stemBase = `${base.slice(0, from)}${NATURAL_BLANK}${base.slice(to)}`;
  return {
    stem: clipContextRange(stemBase, from, NATURAL_BLANK.length, { max: STEM_MAX }).text,
    wrong,
    fix,
    wrongMark: [left.length, left.length + patch.wrongCore.length],
    fixMark: [left.length, left.length + right.length],
  };
}

/** 题面保留本人原错形并给出高亮区间（打字改错与翻卡用）。整理稿正文已是改后句子时，把修正换回错形。 */
function wrongInContext(patch: QuickPatch): { stem: string; mark: [number, number] } {
  if (patch.anchor === "none") return { stem: patch.wrong, mark: [0, patch.wrong.length] };
  let text = patch.context;
  let at = text.indexOf(patch.wrong);
  if (patch.anchor === "fix") {
    at = text.indexOf(patch.fixes[0]);
    text = `${text.slice(0, at)}${patch.wrong}${text.slice(at + patch.fixes[0].length)}`;
  }
  const clipped = clipContextRange(text, at, patch.wrong.length, { max: STEM_MAX });
  return { stem: clipped.text, mark: [clipped.start, clipped.end] };
}

// ── 可接受答案 ──────────────────────────────────────────────────

type InputKind = "particle" | "fix" | "word" | "reading";

/** 短输入资格：答案 ≤6 字（读音题 ≤8 假名）、不含 〜 …，打出来的东西能被唯一判定。 */
function inputKind(item: QuickItem): InputKind | null {
  const patch = item.patch;
  if (item.group === "error_patch" && patch) {
    // 删除型助词没有可打的字；修正只收假名短答案，避免汉字变换候选带来的歧义。
    if (patch.particle && patch.rightCores[0]) return "particle";
    if (patch.fixes.some((fix) => isKanaOnly(fix) && fix.length <= INPUT_MAX)) return "fix";
    return null;
  }
  if (item.group === "nb_katakana") {
    return item.reading && norm(item.reading).length <= READING_INPUT_MAX ? "reading" : null;
  }
  if (item.group === "nb_calque") {
    return patch?.fixes.some((fix) => isKanaOnly(fix) && fix.length <= INPUT_MAX) ? "word" : null;
  }
  if (FLIP_ONLY.has(item.group) || item.hasSlot) return null;
  const length = norm(item.ja).length;
  if (!length || length > INPUT_MAX) return null;
  return item.reading || isKanaOnly(item.ja) ? "word" : null;
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/**
 * 某题型的可接受答案原文（判分时归一化比较）。只依赖条目与题型，不依赖干扰项：
 * 服务端判分不必重建整组卡片，客户端用卡片里同一份 accepted 即时显示，两边不会分叉。
 */
export function acceptedAnswers(item: QuickItem, type: QuickCardType): string[] {
  const patch = item.patch;
  switch (type) {
    case "meaning_choice":
      return unique([item.meaning]);
    case "reading_choice":
      return unique([item.reading]);
    case "word_choice":
      return unique([item.ja, ...item.jaAlts]);
    case "cloze_choice":
      return patch?.particle ? unique(patch.rightCores.map((core) => core || QUICK_EMPTY)) : [];
    case "natural_choice": {
      const layout = patch && item.group === "error_patch" && !patch.particle ? naturalLayout(patch) : null;
      return layout ? [layout.fix] : [];
    }
    case "short_input": {
      const kind = inputKind(item);
      if (!kind) return [];
      if (kind === "particle" && patch) {
        const cores = patch.rightCores.filter(Boolean);
        return unique([...cores, ...cores.map((core) => `${patch.pre}${core}${patch.post}`), ...patch.fixes]);
      }
      if (kind === "fix" && patch) return unique(patch.fixes);
      if (kind === "reading") return unique([item.reading]);
      if (item.group === "nb_calque") return unique([...item.jaAlts]);
      return unique([...item.jaAlts, item.ja, item.reading]);
    }
    case "flip":
      return [];
  }
}

// ── 卡片 ────────────────────────────────────────────────────────

type CardBody = Pick<QuickCard, "prompt" | "stem" | "stemLang" | "mark" | "options" | "optionMarks" | "answer">;

function patternCue(ja: string) {
  const keep = ja.length <= 5 ? 2 : 4;
  return `${ja.slice(0, keep)}……`;
}

function flipBody(item: QuickItem): CardBody {
  if (item.group === "error_patch" && item.patch) {
    const { stem, mark } = wrongInContext(item.patch);
    return { prompt: "flip_fix", stem, stemLang: "ja", mark, options: [], answer: item.patch.fixes.join("／") };
  }
  if (item.group === "nb_pattern") {
    return { prompt: "flip_pattern", stem: patternCue(item.ja), stemLang: "ja", options: [], answer: item.ja };
  }
  if (item.group === "interviewer_phrase" || !item.meaning) {
    // 面试官表达是听解项，方向是日 → 义；没有释义的条目（C 表）也只能从日语回想。
    return {
      prompt: "flip_meaning",
      stem: item.ja,
      stemLang: "ja",
      options: [],
      answer: item.meaning || item.reading || item.ja,
    };
  }
  return { prompt: "flip_word", stem: item.meaning, stemLang: "zh", options: [], answer: item.ja };
}

/** 时态类错误型（整理稿里写法不一：時制、テンス、時点表現、語彙・時制…）。 */
const CONTEXT_BOUND_PATTERN = /時制|テンス|時点/u;

/** 全部改错条目的修正形 / 错形（归一化）→ 拥有它的条目。只由题库决定，缓存在索引里。 */
function patchOwners(index: QuickIndex, side: "fix" | "wrong") {
  return cached(index, `patch-owners|${side}`, () => {
    const owners = new Map<string, Set<string>>();
    for (const candidate of index.items) {
      if (candidate.group !== "error_patch" || !candidate.patch) continue;
      for (const form of side === "fix" ? candidate.patch.fixes : [candidate.patch.wrong]) {
        const key = norm(form);
        if (!key) continue;
        const set = owners.get(key) ?? new Set<string>();
        set.add(candidate.id);
        owners.set(key, set);
      }
    }
    return owners;
  });
}

/**
 * 显示出来的错形选项恰是别的条目的正解，或正解选项恰是别的条目的错形。
 * 比的是带窗口的完整选项而不是差异片段：「だと思います」在名词后是正解、在动词后是错误，
 * 片段相同不说明矛盾；「かしこまりました」这种整句一样才是。
 */
function contradictsOtherItem(item: QuickItem, layout: NaturalLayout, index: QuickIndex) {
  // 只管选项自成一个分句的题（「はい、＿＿＿＿。」）：空格紧挨着题面里的词时，前后文已经说明了为什么这里对、那里错。
  const at = layout.stem.indexOf(NATURAL_BLANK);
  const edge = (char: string | undefined) => !char || CLAUSE_BREAK.test(char) || char === "…";
  if (!edge(layout.stem[at - 1]) || !edge(layout.stem[at + NATURAL_BLANK.length])) return false;
  const other = (side: "fix" | "wrong", text: string) => {
    const owners = patchOwners(index, side).get(norm(text));
    return Boolean(owners && [...owners].some((id) => id !== item.id));
  };
  return other("fix", layout.wrong) || other("wrong", layout.fix);
}

function choiceBody(item: QuickItem, type: QuickCardType, index: QuickIndex, seed: string): CardBody | null {
  const patch = item.patch;
  switch (type) {
    case "meaning_choice": {
      // 只给中文释义的面试官表达；纯汉字短语与中文释义同形，看日语选中文是送分题，改出识词。
      if (item.group !== "interviewer_phrase" || isKanjiOnly(item.ja)) return null;
      if (item.meaning.length < 2 || item.meaning.length > OPTION_MAX || item.ja.length > JA_OPTION_MAX) return null;
      if (norm(item.meaning).includes(norm(item.ja)) || sharesKana(item.meaning, item.ja)) return null;
      const distractors = pickDistractors(item, "meaning", 3, seed, index);
      if (!distractors) return null;
      return { prompt: "meaning", stem: item.ja, stemLang: "ja", options: [item.meaning, ...distractors], answer: item.meaning };
    }
    case "word_choice": {
      const allowed: QuickGroup[] = ["interviewer_phrase", "nb_term", "nb_keigo", "nb_verb", "nb_calque"];
      if (!allowed.includes(item.group) || !item.meaning) return null;
      if (item.meaning.length > 40 || item.ja.length > JA_OPTION_MAX) return null;
      if (item.group !== "nb_calque" && sharesKana(item.meaning, item.ja)) return null;
      if (item.group === "nb_calque" && patch) {
        // A 表固定带上本人的 ✗ 形：要练的正是「别把中文词直接说出来」。
        if (acceptedAnswers(item, "word_choice").some((answer) => overlaps(norm(answer), norm(patch.wrong)))) return null;
        const distractors = pickDistractors(item, "ja", 2, seed, index, [patch.wrong]);
        if (!distractors) return null;
        return { prompt: "word", stem: item.meaning, stemLang: "zh", options: [item.ja, patch.wrong, ...distractors], answer: item.ja };
      }
      const distractors = pickDistractors(item, "ja", 3, seed, index);
      if (!distractors) return null;
      return { prompt: "word", stem: item.meaning, stemLang: "zh", options: [item.ja, ...distractors], answer: item.ja };
    }
    case "reading_choice": {
      // 只对単語文法帳完整的かな列开放：整理稿的读音常只注了一部分，拿来当正解会出错题。
      if (item.source !== "notebook" || !item.reading || item.hasSlot) return null;
      if (!["nb_term", "nb_keigo", "nb_verb", "nb_katakana"].includes(item.group)) return null;
      if (item.reading.length > READING_MAX || isKanaOnly(item.ja)) return null;
      const distractors = readingDistractors(item, index, seed);
      if (!distractors) return null;
      return { prompt: "reading", stem: item.ja, stemLang: "ja", options: [item.reading, ...distractors], answer: item.reading };
    }
    case "cloze_choice": {
      if (item.group !== "error_patch" || !patch?.particle) return null;
      const layout = clozeLayout(patch);
      const options = particleOptions(patch, seed, layout.nextChar);
      if (!options) return null;
      return {
        prompt: "cloze_particle",
        stem: layout.stem,
        stemLang: "ja",
        options,
        answer: patch.rightCores[0] || QUICK_EMPTY,
      };
    }
    case "natural_choice": {
      if (item.group !== "error_patch" || !patch || patch.particle) return null;
      // 时态对错取决于整段在说什么时候的事，±4 字的窗口带不出来：「自分が＿＿。やります／やりました」两个都通。
      if (CONTEXT_BOUND_PATTERN.test(item.pattern)) return null;
      const layout = naturalLayout(patch);
      if (!layout) return null;
      // 本人的错形恰是别的条目的正解（「かしこまりました」在一处被改掉、在另一处是答案）：
      // 脱离原场景单看两个选项，同一个说法今天判错、明天判对，只会把人教糊涂。
      if (contradictsOtherItem(item, layout, index)) return null;
      return {
        prompt: "natural",
        stem: layout.stem,
        stemLang: "ja",
        options: [layout.fix, layout.wrong],
        optionMarks: [layout.fixMark, layout.wrongMark],
        answer: layout.fix,
      };
    }
    default:
      return null;
  }
}

function inputBody(item: QuickItem): CardBody | null {
  const kind = inputKind(item);
  const patch = item.patch;
  if (!kind) return null;
  if (kind === "particle" && patch) {
    return { prompt: "input_particle", stem: clozeLayout(patch).stem, stemLang: "ja", options: [], answer: patch.rightCores[0] };
  }
  if (kind === "fix" && patch) {
    const { stem, mark } = wrongInContext(patch);
    const answer = patch.fixes.find((fix) => isKanaOnly(fix) && fix.length <= INPUT_MAX) ?? patch.fixes[0];
    return { prompt: "input_fix", stem, stemLang: "ja", mark, options: [], answer };
  }
  if (kind === "reading") {
    return { prompt: "input_reading", stem: item.ja, stemLang: "ja", options: [], answer: item.reading };
  }
  if (!item.meaning) return null;
  const answer = item.group === "nb_calque"
    ? patch?.fixes.find((fix) => isKanaOnly(fix) && fix.length <= INPUT_MAX) ?? item.ja
    : item.ja;
  return { prompt: "input_word", stem: item.meaning, stemLang: "zh", options: [], answer };
}

/**
 * 卡片不变式。出卡时违反任何一条就不出这张卡；测试与真实数据抽查用同一个函数。
 * - 选择题：2–4 个互不相同的选项，且至少一个是可接受答案。
 * - 非翻卡题：题面不含答案（助词题看「前后文 + 正解助词」整段，单个助词在句中别处出现不算泄露）。
 */
export function checkQuickCard(card: QuickCard, item: QuickItem): string[] {
  const problems: string[] = [];
  if (card.type !== "flip" && !card.accepted.length) problems.push("no_accepted");
  if (CHOICE_TYPES.has(card.type)) {
    const keys = card.options.map(norm);
    if (card.options.length < 2 || card.options.length > 4) problems.push("option_count");
    if (keys.some((key) => !key) || new Set(keys).size !== keys.length) problems.push("option_duplicate");
    const accepted = new Set(card.accepted.map(norm));
    if (!keys.some((key) => accepted.has(key))) problems.push("answer_missing");
    if (card.options.some((option) => option.length > OPTION_MAX)) problems.push("option_too_long");
    if (card.optionMarks && card.optionMarks.length !== card.options.length) problems.push("option_marks");
  } else if (card.options.length) {
    problems.push("unexpected_options");
  }
  if (stemLeaks(card, item)) problems.push("stem_leak");
  return problems;
}

function stemLeaks(card: QuickCard, item: QuickItem) {
  if (card.type === "flip") return false;
  const patch = item.patch;
  if ((card.type === "cloze_choice" || card.prompt === "input_particle") && patch) {
    return patch.rightCores
      .filter(Boolean)
      .map((core) => `${patch.pre}${core}${patch.post}`)
      .filter((probe) => probe.length >= 2)
      .some((probe) => card.stem.includes(probe));
  }
  const stem = norm(card.stem);
  return card.accepted.some((answer) => {
    const key = norm(answer);
    return key.length > 0 && stem.includes(key);
  });
}

function composeCard(item: QuickItem, type: QuickCardType, index: QuickIndex, day: string) {
  const seed = `${item.id}|${type}|${day}`;
  const body = type === "flip"
    ? flipBody(item)
    : type === "short_input"
      ? inputBody(item)
      : choiceBody(item, type, index, seed);
  if (!body) return null;
  // 选项位置也由种子决定；高亮区间跟着选项一起换位。
  const order = seededShuffle(body.options.map((_, position) => position), `${seed}|order`);
  const card: QuickCard = {
    cardId: `${item.id}:${type}:${day}`,
    itemId: item.id,
    group: item.group,
    type,
    grading: type === "flip" ? "self" : "auto",
    reason: "new",
    stage: "unseen",
    layer: "R",
    prompt: body.prompt,
    stem: body.stem,
    stemLang: body.stemLang,
    ...(body.mark ? { mark: body.mark } : {}),
    options: order.map((position) => body.options[position]),
    ...(body.optionMarks ? { optionMarks: order.map((position) => body.optionMarks![position]) } : {}),
    answer: body.answer,
    accepted: acceptedAnswers(item, type),
    reveal: {
      ja: item.group === "error_patch" && item.patch ? item.patch.fixes.join("／") : item.ja,
      reading: item.reading,
      meaning: item.meaning,
      wrong: item.patch?.wrong ?? "",
      explain: item.note || (item.group === "error_patch" ? PATTERN_HINT[item.pattern] ?? "" : ""),
      evidence: item.evidence.slice(0, 2),
    },
  };
  return checkQuickCard(card, item).length ? null : card;
}

// ── 题型选择 ────────────────────────────────────────────────────

const AVAILABILITY_DAY = "0000-00-00";

/**
 * 条目可用的题型（与阶段无关）。typing=false 时去掉短输入。
 * 翻卡只给没有任何判分点选的条目，以及回答结构、表达升级、単語文法帳 H：可判分的条目不混翻卡，
 * 否则自评会把已经排到 7 天的复习拉回 3 天，也不产生成功日。
 */
export function availableCardTypes(
  item: QuickItem,
  index: QuickIndex,
  { typing }: { typing: boolean },
): QuickCardType[] {
  const base = cached(index, `types|${item.id}`, () => {
    if (FLIP_ONLY.has(item.group)) return ["flip"] as QuickCardType[];
    const types = (["meaning_choice", "reading_choice", "word_choice", "cloze_choice", "natural_choice", "short_input"] as const)
      .filter((type) => composeCard(item, type, index, AVAILABILITY_DAY) !== null);
    return types.some((type) => CHOICE_TYPES.has(type)) ? [...types] : [...types, "flip" as const];
  });
  return typing ? base : base.filter((type) => type !== "short_input");
}

/** 只有「哪个更自然」二选一可判分的条目：猜对率 50%，升 stable 要更多成功日（见 quick-progress.ts）。 */
export function isBinaryOnly(item: QuickItem, index: QuickIndex) {
  const choices = availableCardTypes(item, index, { typing: false }).filter((type) => CHOICE_TYPES.has(type));
  return choices.length > 0 && choices.every((type) => type === "natural_choice");
}

const LADDER: Record<QuickGroup, Record<QuickLayer, QuickCardType[]>> = {
  error_patch: {
    R: ["cloze_choice", "natural_choice"],
    D: ["cloze_choice", "natural_choice"],
    P: ["short_input"],
  },
  interviewer_phrase: { R: ["meaning_choice"], D: ["word_choice"], P: ["short_input"] },
  nb_term: { R: ["reading_choice"], D: ["word_choice"], P: ["short_input"] },
  nb_keigo: { R: ["reading_choice"], D: ["word_choice"], P: ["short_input"] },
  nb_verb: { R: ["reading_choice"], D: ["word_choice"], P: ["short_input"] },
  nb_katakana: { R: ["reading_choice"], D: ["reading_choice"], P: ["short_input"] },
  nb_calque: { R: ["word_choice"], D: ["word_choice"], P: ["short_input"] },
  answer_strategy: { R: ["flip"], D: ["flip"], P: ["flip"] },
  active_chunk: { R: ["flip"], D: ["flip"], P: ["flip"] },
  nb_pattern: { R: ["flip"], D: ["flip"], P: ["flip"] },
};

const SEARCH: Record<QuickLayer, QuickLayer[]> = { R: ["R", "D", "P"], D: ["D", "R", "P"], P: ["P", "D", "R"] };

/**
 * 按阶段选题型。P 层的短输入还要 typing 打开且本组打字额度 typedLeft > 0，否则退回同层以下的点选。
 * 同一层有多个可用题型时按 itemId|day 轮换，同一天同一条目选法固定。
 */
export function chooseCardType(
  item: QuickItem,
  stage: LanguageTrainingStage,
  { index, typing, day, typedLeft }: { index: QuickIndex; typing: boolean; day: string; typedLeft: number },
): QuickCardType | null {
  const available = new Set(availableCardTypes(item, index, { typing }));
  const own = layerOf(stage);
  for (const layer of SEARCH[own]) {
    const candidates = LADDER[item.group][layer].filter((type) => {
      if (!available.has(type)) return false;
      if (type === "short_input") return own === "P" && layer === "P" && typing && typedLeft > 0;
      return true;
    });
    if (candidates.length) return candidates[stableSeed(`${item.id}|${day}`) % candidates.length];
  }
  return available.has("flip") ? "flip" : null;
}

export function buildQuickCard(
  item: QuickItem,
  type: QuickCardType,
  { index, day, reason, stage }: { index: QuickIndex; day: string; reason: QuickCardReason; stage: LanguageTrainingStage },
): QuickCard | null {
  const card = composeCard(item, type, index, day);
  return card ? { ...card, reason, stage, layer: layerOf(stage) } : null;
}

// ── 判分 ────────────────────────────────────────────────────────

export type QuickGradeInput = { response?: string; rating?: QuickSelfRating; gaveUp?: boolean };
export type QuickGrade = { passed?: boolean };

function grade(type: QuickCardType, accepted: readonly string[], input: QuickGradeInput): QuickGrade {
  // 翻卡是自评，不给 passed；成败由 rating 在进度回放里另算，自评永远不产生成功日。
  if (type === "flip") return {};
  if (input.gaveUp) return { passed: false };
  const response = norm(input.response ?? "");
  return { passed: response.length > 0 && accepted.some((answer) => norm(answer) === response) };
}

/** 服务端判分：按 itemId + type 从题库重新取可接受答案，客户端传来的 passed 一概不读。 */
export function gradeQuickAnswer(item: QuickItem, type: QuickCardType, input: QuickGradeInput): QuickGrade {
  return grade(type, acceptedAnswers(item, type), input);
}

/** 客户端即时显示：只用卡片里的 accepted 与 type，与服务端同一套归一化，结果一致。 */
export function gradeQuickCard(card: Pick<QuickCard, "type" | "accepted">, input: QuickGradeInput): QuickGrade {
  return grade(card.type, card.accepted, input);
}
