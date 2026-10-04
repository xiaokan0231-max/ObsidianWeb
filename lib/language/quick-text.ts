import { stableHash } from "../dojo/utils.ts";

/*
 * 快练的文本工具：归一化、語:: 行切分与清洗、截取语境、差分、相似度、带种子的洗牌。
 * 服务端判分、课程构建与客户端即时显示共用这一份，任何一处各写一套都会让「同一答案两边判法不同」。
 */

const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KANA_SHIFT = 0x60;

/**
 * 判分用归一化。在 lib/language/grading.ts 的宽松规则上再加两步：
 * 片假名折成平假名（打字题「假名即可」，IME 打出片假名不该判错）；去掉 …＿_（题面占位符）。
 * 长音「ー」保留：它是读音的一部分，删掉会让「こうざ」与「こーざ」之外的真错误也被放过。
 */
export function normalizeQuickAnswer(value: string) {
  const loose = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ja")
    .replace(/[\s、。,.!?！？「」『』（）()・･:：;；/／\-‐‑–—~〜～…＿_]/g, "");
  let folded = "";
  for (const char of loose) {
    const code = char.charCodeAt(0);
    folded += code >= KATAKANA_START && code <= KATAKANA_END
      ? String.fromCharCode(code - KANA_SHIFT)
      : char;
  }
  return folded;
}

/** 归一化后相等；空串永远不算相等（什么都没选不能碰巧「答对」空答案）。 */
export function sameQuickAnswer(left: string, right: string) {
  const normalized = normalizeQuickAnswer(left);
  return normalized.length > 0 && normalized === normalizeQuickAnswer(right);
}

const HAN = /[\p{Script=Han}々〆ヶ]/u;
const HIRAGANA = /[ぁ-ゖ]/u;

export function isKanjiOnly(text: string) {
  return /^[\p{Script=Han}々〆ヶ]+$/u.test(text);
}

/** 只含平假名、片假名与长音（打字题「假名即可」的判断）。 */
export function isKanaOnly(text: string) {
  return /^[ぁ-ゖァ-ヺー]+$/u.test(text);
}

export function hasKanji(text: string) {
  return HAN.test(text);
}

type CharClass = "han" | "katakana" | "latin" | "other";

function charClass(char: string | undefined): CharClass {
  if (!char) return "other";
  if (HAN.test(char)) return "han";
  if (/[ァ-ヺー]/u.test(char)) return "katakana";
  if (/[A-Za-z0-9Ａ-Ｚａ-ｚ０-９]/u.test(char)) return "latin";
  return "other";
}

// ── 語:: 行切分与清洗 ──────────────────────────────────────────

// 中文弯引号也算一层：释义里的「委婉确认“看起来／听起来没问题吧”」不能在引号里的「／」处切开。
const OPENERS: Record<string, string> = { "（": "）", "(": ")", "「": "」", "『": "』", "“": "”", "‘": "’" };
const CLOSERS = new Set(Object.values(OPENERS));

/** 顶层（不在任何括号或引号里）的字符位置。括号不配对时按已打开的层数处理，不抛错。 */
function topLevelIndexes(value: string, predicate: (char: string) => boolean) {
  const indexes: number[] = [];
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (OPENERS[char]) {
      depth += 1;
      continue;
    }
    if (CLOSERS.has(char)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && predicate(char)) indexes.push(index);
  }
  return indexes;
}

function splitTopLevel(value: string, separators: string) {
  const parts: Array<{ text: string; separator: string }> = [];
  let start = 0;
  let separator = "";
  for (const index of topLevelIndexes(value, (char) => separators.includes(char))) {
    parts.push({ text: value.slice(start, index), separator });
    separator = value[index];
    start = index + 1;
  }
  parts.push({ text: value.slice(start), separator });
  return parts;
}

function topLevelEquals(value: string) {
  return topLevelIndexes(value, (char) => char === "＝" || char === "=")[0] ?? -1;
}

function entryLeft(slice: string) {
  const equals = topLevelEquals(slice);
  // 读音括注不算词长：「〜というところです（じったい）」这类长句型加上注音就会超过上限。
  return equals < 0 ? null : slice.slice(0, equals).replace(/（[^）]*）|\([^)]*\)/gu, "").trim();
}

/** 「；」后的片是新词条：顶层有＝，且左侧像一个词（1–24 字、不含「，。：」）。否则是上一词条释义的延续。 */
function startsEntry(slice: string) {
  const left = entryLeft(slice);
  return left !== null && left.length >= 1 && left.length <= 24 && !/[，。：]/u.test(left);
}

/**
 * 「／」「｜」后的段是新词条：整理稿本来就用它并列词条，面试官长句型也会作为词条出现，所以只排除明显不是词条的段
 * ——左侧超过 40 字或含「。」（那是释义里的说明句碰巧带了＝，例如转写订正注记）。
 */
function startsSegmentEntry(segment: string) {
  const left = entryLeft(segment);
  return left !== null && left.length >= 1 && left.length <= 40 && !left.includes("。");
}

/**
 * 把整理稿的一行 語:: 切成「目标＝释义」词条（原文，不清洗）。
 * 为什么不只按「／」切：实测近百行用「；」「｜」并列多个词条，旧切法把后一词条整个吞进前一条的释义，
 * 识义题就会出现「意思里带着另一个词」的选项。反过来，释义里本来就有的「；」不能被切成词条，
 * 所以「；」后的片左侧必须像一个词才算新词条，否则并回前一条；不像词条的「／」段也并回，不再整段丢掉。
 * 课程构建与出卡共用这一个函数，签名保持 (line) => string[]。
 */
export function splitGoEntries(line: string): string[] {
  const cleaned = line.replace(/🔴|⭐|⚠️|⚠|\uFE0F|\*\*/gu, "").trim();
  const entries: string[] = [];
  for (const segment of splitTopLevel(cleaned, "／｜")) {
    for (const [sliceIndex, slice] of splitTopLevel(segment.text, "；;").entries()) {
      const text = slice.text.trim();
      if (!text) continue;
      // 行首第一个词条沿用旧规则：只要有顶层＝就是词条，不卡左侧长度。
      const opens = !entries.length
        ? topLevelEquals(text) >= 0
        : sliceIndex === 0
          ? startsSegmentEntry(text)
          : startsEntry(text);
      if (opens) {
        entries.push(text);
        continue;
      }
      if (!entries.length) continue;
      const joiner = sliceIndex === 0 ? segment.separator || "／" : slice.separator || "；";
      entries[entries.length - 1] = `${entries[entries.length - 1]}${joiner}${text}`;
    }
  }
  return entries;
}

const TRANSCRIPT_NOISE = /転写|转写|ASR|文字起こし|誤認識/u;

/** 删掉内容含转写注记的全角括号段（可嵌套），返回剩余文本与删掉的部分。 */
function removeNoisyParens(value: string) {
  const removed: string[] = [];
  let output = "";
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "（") {
      output += value[index];
      index += 1;
      continue;
    }
    let depth = 0;
    let end = index;
    for (; end < value.length; end += 1) {
      if (value[end] === "（") depth += 1;
      if (value[end] === "）") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const segment = value.slice(index, Math.min(end + 1, value.length));
    if (TRANSCRIPT_NOISE.test(segment)) removed.push(segment.slice(1, -1));
    else output += segment;
    index = end + 1;
  }
  return { text: output, removed };
}

export type CleanedGoMeaning = {
  /** 题面与选项用的释义。 */
  meaning: string;
  /** 被清洗掉的部分，只在答后反馈里显示。 */
  rest: string;
  /** 整条是转写订正注记（不是词汇），不应成为条目。 */
  drop: boolean;
};

/**
 * 清洗 語:: 词条的释义。
 * 整理稿里释义常夹带「「○○」は転写」这类转写订正注记，它们对听解复盘有用，但放进识义选项就成了噪声，
 * 而且日文注记会让中文释义被误判成日文释义。
 * target 传词条左侧原文（含「」时才可能 drop）：左侧被「」包住且释义含転写，说明这条是在订正转写，不是一个词。
 * 旧课程没有新的 splitGoEntries，释义里可能还吞着下一词条，这里在「；｜」处与第二句起的「＝」处兜底截断。
 * 释义只取第一句，其余句子进 rest。
 */
export function cleanGoMeaning(raw: string, target = ""): CleanedGoMeaning {
  const source = raw.replace(/\*\*/g, "").trim();
  const drop = /^「[^」]*」$/u.test(target.trim()) && /転写|转写/u.test(source);
  const rest: string[] = [];
  const parens = removeNoisyParens(source);
  rest.push(...parens.removed);

  const [head, ...tails] = splitTopLevel(parens.text, "；;｜|");
  rest.push(...tails.map((part) => part.text.trim()).filter(Boolean));

  const kept: string[] = [];
  const sentences = splitTopLevel(head?.text ?? "", "。").map((part) => part.text.trim()).filter(Boolean);
  for (const [index, sentence] of sentences.entries()) {
    if (index > 0 && topLevelEquals(sentence) >= 0) {
      rest.push(...sentences.slice(index));
      break;
    }
    if (TRANSCRIPT_NOISE.test(sentence)) rest.push(sentence);
    else kept.push(sentence);
  }
  // 释义只留第一句：后面的句子多是用法补充，放进题面或选项就成了长句；它们进 rest，答后照样能看到。
  const [meaning = "", ...more] = kept;
  return {
    meaning: meaning.replace(/[。．.]+$/u, "").trim(),
    rest: [...more, ...rest].join("；"),
    drop,
  };
}

/**
 * 只在日文（新字体）里出现、简体中文写成别的字形的汉字。纯汉字的日文释义（「人材紹介会社」「尊敬語」
 * 「語学試験」）没有假名可认，混进「看日语选中文」的选项里一眼就能排除，当正解更是答非所问；
 * 本人写中文释义用简体，出现这些字形基本就是日文。只收常见字，宁漏勿错。
 */
export const JA_ONLY_GLYPHS = /[語験紹歴達職級試資調価値済関発対応業様気説読書話時間題問実際員長開選経営報確認設計環運現場挙機歳帰転進給続練習寧聴傾渉縮約変換況識録頼覧較態雑図戦軽単純絡総縁働込]/u;

const META_NOTE = /必收|高频|頻出|定番|常用|キーワード|口癖/u;

/**
 * 把释义里的日文括注与整理用标记（「（〜っぷり＝……的样子）」「（いける＝行ける）」「（丁寧）」「（必收惯用句）」）
 * 移出主释义。为什么：它们放在选项里会泄露答案（与题面同形的假名）或让正解一眼可辨（只有它带标记）；
 * 答后反馈仍要看，所以退回 notes 而不是丢掉。纯中文的语境括注（「（谦让）」「（此处）」）是意思的一部分，保留。
 * 去掉后什么都不剩时原样返回，交给 meaningLanguage 判定。
 */
export function splitMeaningNotes(meaning: string): { meaning: string; notes: string[] } {
  const notes: string[] = [];
  const kept = meaning
    .replace(/（[^（）]*）|\([^()]*\)/gu, (part) => {
      if (!/[ぁ-ゖァ-ヺ〜～＝=]/u.test(part) && !JA_ONLY_GLYPHS.test(part) && !META_NOTE.test(part)) return part;
      const inner = part.slice(1, -1).trim();
      if (inner) notes.push(inner);
      return "";
    })
    .replace(/\s{2,}/gu, " ")
    .replace(/^[\s、，,；;]+|[\s、，,；;]+$/gu, "")
    .trim();
  // 「很难启齿——坏消息的缓冲垫，听到它就预备接否定内容」：破折号后面是整理时写的用法说明，
  // 留在选项或题面里会把一条意思拉成一句话，移到答后解释。
  const dash = kept.search(/——|――/u);
  if (dash > 0) {
    const head = kept.slice(0, dash).replace(/[\s、，,；;]+$/gu, "").trim();
    const tail = kept.slice(dash).replace(/^[—―\s]+/u, "").trim();
    if (head && tail) return { meaning: head, notes: [...notes, tail] };
  }
  return kept ? { meaning: kept, notes } : { meaning, notes: [] };
}

/**
 * 释义语言。去掉「」引用与括号注释后仍含平假名、片假名或日文专用字形 → 日文；去掉后什么实词都不剩（整条就是一句日文引用）也算日文。
 * 括注要去掉：中文释义常带日文括注（「公司内部（書面寄り）」），主体是中文，按括注判成日文会把能出的题排除掉。
 * 片假名算日文：「サポート」「站内ツール」这类释义放进「看日语选中文」的选项里不是中文。
 */
export function meaningLanguage(text: string): "zh" | "ja" {
  let stripped = text;
  for (let pass = 0; pass < 3; pass += 1) {
    stripped = stripped
      .replace(/「[^「」]*」|『[^『』]*』/gu, "")
      .replace(/（[^（）]*）|\([^()]*\)/gu, "");
  }
  if (HIRAGANA.test(stripped) || /[ァ-ヺ]/u.test(stripped) || JA_ONLY_GLYPHS.test(stripped)) return "ja";
  const hasContent = /[\p{Script=Han}A-Za-z0-9]/u.test(stripped);
  return !hasContent && /[ぁ-ゖァ-ヺ]/u.test(text) ? "ja" : "zh";
}

// ── 截取语境 ────────────────────────────────────────────────────

const CLAUSE_BREAK = /[、。？！!?]/u;
const SENTENCE_END = /[。？！!?]/u;

export type ClippedContext = {
  text: string;
  /** 目标在 text 里的区间 [start, end)。 */
  start: number;
  end: number;
};

/**
 * 截取包含目标的语境，返回文本与目标在其中的位置（高亮、挖空都靠它定位）。
 * 为什么按「、」也切：本人抱怨的正是读长句；只给目标所在的一个分句最短，太短（<12 字）才向前后各借一句。
 * 仍超过 max 时以目标为中心截，切口落在片假名/汉字/拉丁连续串中间就挪到串边，避免题面出现半个词。
 */
export function clipContextRange(
  context: string,
  start: number,
  length: number,
  { max = 30 }: { max?: number } = {},
): ClippedContext {
  const safeStart = Math.max(0, Math.min(start, context.length));
  const safeEnd = Math.max(safeStart, Math.min(safeStart + length, context.length));
  const clauseStart = (from: number) => {
    for (let index = from - 1; index >= 0; index -= 1) {
      if (CLAUSE_BREAK.test(context[index])) return index + 1;
    }
    return 0;
  };
  const clauseEnd = (from: number) => {
    for (let index = from; index < context.length; index += 1) {
      if (CLAUSE_BREAK.test(context[index])) return SENTENCE_END.test(context[index]) ? index + 1 : index;
    }
    return context.length;
  };
  let left = clauseStart(safeStart);
  let right = clauseEnd(safeEnd);
  // 分句太短时借相邻分句；借左侧时跳过前一分句末尾的标点。
  for (let guard = 0; guard < 4 && right - left < 12; guard += 1) {
    const prevLeft = left > 0 ? clauseStart(left - 1) : left;
    const nextRight = right < context.length ? clauseEnd(right + 1) : right;
    if (prevLeft < left && right - prevLeft <= max && !SENTENCE_END.test(context[left - 1] ?? "")) {
      left = prevLeft;
    } else if (nextRight > right && nextRight - left <= max && !SENTENCE_END.test(context[right - 1] ?? "")) {
      right = nextRight;
    } else {
      break;
    }
  }
  while (left < safeStart && /\s/u.test(context[left])) left += 1;
  while (right > safeEnd && /\s/u.test(context[right - 1])) right -= 1;

  if (right - left > max) {
    const targetLength = safeEnd - safeStart;
    // 预留两侧省略号的位置，截完连同「…」也不超过 max。
    const budget = Math.max(0, max - targetLength - 2);
    let leftRoom = Math.min(safeStart - left, Math.floor(budget / 2));
    const rightRoom = Math.min(right - safeEnd, budget - leftRoom);
    leftRoom = Math.min(safeStart - left, budget - rightRoom);
    let cutLeft = safeStart - leftRoom;
    let cutRight = safeEnd + rightRoom;
    if (cutLeft > left) {
      const cls = charClass(context[cutLeft]);
      if (cls !== "other" && charClass(context[cutLeft - 1]) === cls) {
        while (cutLeft < safeStart && charClass(context[cutLeft]) === cls) cutLeft += 1;
      }
    }
    if (cutRight < right) {
      const cls = charClass(context[cutRight - 1]);
      if (cls !== "other" && charClass(context[cutRight]) === cls) {
        while (cutRight > safeEnd && charClass(context[cutRight - 1]) === cls) cutRight -= 1;
      }
    }
    const prefix = cutLeft > left ? "…" : "";
    const suffix = cutRight < right ? "…" : "";
    const body = context.slice(cutLeft, cutRight);
    return {
      text: `${prefix}${body}${suffix}`,
      start: prefix.length + (safeStart - cutLeft),
      end: prefix.length + (safeEnd - cutLeft),
    };
  }
  return {
    text: context.slice(left, right),
    start: safeStart - left,
    end: safeEnd - left,
  };
}

export function clipContext(
  context: string,
  start: number,
  length: number,
  options: { max?: number } = {},
) {
  return clipContextRange(context, start, length, options).text;
}

// ── 差分、相似度、洗牌 ──────────────────────────────────────────

export type DiffSpan = { pre: string; aCore: string; bCore: string; post: string };

/** 最小差分：公共前缀 + 两侧不同的核 + 公共后缀。后缀不与前缀重叠。 */
export function diffSpan(a: string, b: string): DiffSpan {
  const limit = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < limit && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    pre: a.slice(0, prefix),
    aCore: a.slice(prefix, a.length - suffix),
    bCore: b.slice(prefix, b.length - suffix),
    post: a.slice(a.length - suffix),
  };
}

function bigrams(value: string) {
  const grams = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index += 1) {
    const gram = value.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** 字符二元组 Dice 系数（0–1）。少于 2 字时二元组为空，只能看是否相等。 */
export function dice(a: string, b: string) {
  if (a === b) return a.length ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let overlap = 0;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) ?? 0);
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

export function stableSeed(value: string) {
  return Number.parseInt(stableHash(value), 36) >>> 0;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** 同一种子永远得到同一顺序：同一天同一题的选项固定，服务端与客户端各算一遍也一致。 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = mulberry32(stableSeed(seed));
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}
