import type {
  LanguageCurriculum,
  LanguageEvidenceRef,
  LanguageLearningItem,
} from "./types.ts";
import type { QuickEvidence, QuickGroup, QuickItem, QuickPatch, QuickPool } from "./quick-types.ts";
import { stableId } from "../dojo/utils.ts";
import {
  cleanGoMeaning,
  clipContext,
  diffSpan,
  hasKanji,
  isKanaOnly,
  meaningLanguage,
  normalizeQuickAnswer,
  splitMeaningNotes,
} from "./quick-text.ts";

/*
 * 课程条目与単語文法帳 → QuickItem。
 * 这一层只做「能不能出题、题面能用哪些字段」的归一化，不决定题型与干扰项（那是 quick-cards.ts）。
 * 単語文法帳运行时解析、不并进课程生成物：该笔记自述「埋め込むだけにする（コピーしない）」，
 * 并进去是第二份拷贝，改一行就让课程 stale。
 */

export const VOCAB_NOTEBOOK_PATH = "20_求職/_素材/単語文法帳.md";

function bump(counter: Record<string, number>, key: string, by = 1) {
  counter[key] = (counter[key] ?? 0) + by;
}

const HIRA_SHIFT = 0x60;

function foldKana(value: string) {
  let output = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    output += code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - HIRA_SHIFT) : char;
  }
  return output;
}

/**
 * 把 ja 与读音按「假名锚点 + 汉字串」对齐。汉字串 n 字至少对 n 个假名（3 字以上至少 1.5n），最多 4n。
 * 返回每个汉字串在读音里的区间；对不上返回 null。
 * 为什么卡下限：整理稿的读音常只注了一部分（四字词只给后两字注音），
 * 只看「读音 ≥ 汉字数」会把半截读音当成完整读音，拿去当读音题与打字题的正确答案就错了。
 */
export function alignReading(ja: string, reading: string): Array<[number, number]> | null {
  const target = foldKana(reading.replace(/[・\s]/gu, ""));
  if (!target || !isKanaOnly(target)) return null;
  const runs = ja.match(/[\p{Script=Han}々〆ヶ]+|[ぁ-ゖァ-ヺー]+|[^\p{Script=Han}々〆ヶぁ-ゖァ-ヺー]+/gu) ?? [];
  let pattern = "^";
  let groups = 0;
  for (const run of runs) {
    if (/^[\p{Script=Han}々〆ヶ]/u.test(run)) {
      const size = run.length;
      const min = size <= 2 ? size : Math.ceil(size * 1.5);
      pattern += `([ぁ-ゖー]{${min},${size * 4}})`;
      groups += 1;
    } else if (/^[ぁ-ゖァ-ヺー]/u.test(run)) {
      pattern += foldKana(run);
    } else {
      return null;
    }
  }
  if (!groups) return null;
  const match = new RegExp(`${pattern}$`, "u").exec(target);
  if (!match) return null;
  // 按捕获内容顺序累加位置，并回拼一遍确认对齐覆盖整条读音。
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  let rebuilt = "";
  for (const run of runs) {
    if (/^[\p{Script=Han}々〆ヶ]/u.test(run)) {
      const captured = match[spans.length + 1] ?? "";
      spans.push([cursor, cursor + captured.length]);
      cursor += captured.length;
      rebuilt += captured;
    } else {
      cursor += run.length;
      rebuilt += foldKana(run);
    }
  }
  return rebuilt === target ? spans : null;
}

/** 读音能否当作 ja 的完整读音（读音题答案、打字题可接受答案都靠它）。 */
export function reliableReading(ja: string, reading: string) {
  if (!reading || !hasKanji(ja) || /[〜…~]/u.test(ja)) return false;
  return alignReading(ja, reading) !== null;
}

// ── 改错条目 ────────────────────────────────────────────────────

const PARTICLES = new Set([
  "が", "を", "に", "で", "と", "の", "は", "も", "へ", "や",
  "から", "まで", "より", "には", "では", "にも", "とも", "って", "とは", "のは",
  "として", "について", "に対して", "にとって",
]);

export function isParticleCore(value: string) {
  return value === "" || PARTICLES.has(value);
}

function occurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return count;
    count += 1;
    from = index + 1;
  }
}

export type ParsedPatch =
  | { ok: true; patch: QuickPatch; notes: string[] }
  | { ok: false; reason: "no_arrow" | "deleted" | "ellipsis" | "no_fix" };

/**
 * 从课程条目的 targetJa / correctedJa / originalJa 还原「错形 → 修正」与最小差分。
 * 错形只能从 targetJa 的「 → 」左侧取：课程没有单独存错形，meaningZh「把「…」改为「…」」含答案，不能用。
 */
export function parsePatch(targetJa: string, correctedJa: string, originalJa: string): ParsedPatch {
  const arrow = targetJa.indexOf("→");
  if (arrow < 0) return { ok: false, reason: "no_arrow" };
  let wrong = targetJa.slice(0, arrow).trim();
  if (!wrong) return { ok: false, reason: "no_arrow" };

  const rawFixes = correctedJa.split(/[／/]/u).map((value) => value.trim()).filter(Boolean);
  if (!rawFixes.length) return { ok: false, reason: "no_fix" };
  if (/削除|言わない/u.test(rawFixes[0])) return { ok: false, reason: "deleted" };

  const notes: string[] = [];
  let fixes: string[] = [];
  for (const raw of rawFixes) {
    let value = raw;
    const lead = value.match(/^（([^）]*)）\s*/u);
    if (lead) {
      notes.push(lead[1]);
      value = value.slice(lead[0].length);
    }
    const colon = value.indexOf("：「");
    if (colon > 0) {
      notes.push(value.slice(colon + 1));
      value = value.slice(0, colon);
    }
    // 结尾是 1–2 个平假名的括注＝可省的助词，带与不带都算对。
    const optional = value.match(/^(.+?)（([ぁ-ゖ]{1,2})）$/u);
    if (optional) {
      fixes.push(optional[1], `${optional[1]}${optional[2]}`);
      continue;
    }
    const paren = value.indexOf("（");
    if (paren > 0) {
      notes.push(value.slice(paren));
      value = value.slice(0, paren);
    }
    fixes.push(value.trim());
  }

  if (wrong.includes("…") || fixes[0]?.includes("…")) {
    const wrongParts = wrong.split("…");
    const fixParts = (fixes[0] ?? "").split("…");
    const differing = wrongParts
      .map((part, index) => (part.trim() === fixParts[index]?.trim() ? -1 : index))
      .filter((index) => index >= 0);
    if (wrongParts.length !== fixParts.length || differing.length !== 1) {
      return { ok: false, reason: "ellipsis" };
    }
    const at = differing[0];
    wrong = wrongParts[at].trim();
    fixes = fixes.flatMap((fix) => {
      const parts = fix.split("…");
      return parts.length === wrongParts.length ? [parts[at].trim()] : [];
    });
  }

  fixes = [...new Set(fixes.map((value) => value.trim()).filter((value) => value && value !== wrong))];
  if (!fixes.length || !wrong) return { ok: false, reason: "no_fix" };

  const base = diffSpan(wrong, fixes[0]);
  const rightCores = [base.bCore];
  for (const fix of fixes.slice(1)) {
    const other = diffSpan(wrong, fix);
    if (other.pre === base.pre && other.post === base.post && !rightCores.includes(other.bCore)) {
      rightCores.push(other.bCore);
    }
  }
  const anchor: QuickPatch["anchor"] = occurrences(originalJa, wrong) === 1
    ? "wrong"
    : occurrences(originalJa, fixes[0]) === 1
      ? "fix"
      : "none";
  const particle = isParticleCore(base.aCore) &&
    rightCores.every(isParticleCore) &&
    (base.aCore !== "" || rightCores.some(Boolean)) &&
    (base.pre !== "" || anchor !== "none");
  return {
    ok: true,
    notes,
    patch: {
      wrong,
      fixes,
      pre: base.pre,
      post: base.post,
      wrongCore: base.aCore,
      rightCores,
      particle,
      context: originalJa,
      anchor,
    },
  };
}

// ── 出处 ────────────────────────────────────────────────────────

function evidenceLabel(ref: LanguageEvidenceRef) {
  const [date, , round] = ref.interviewKey.split("|");
  // 只放日期 · 场次 · 句子 ID：公司名在 interviewKey 里，但出处标签用不到它。
  return [/^\d{4}-\d{2}-\d{2}$/u.test(date ?? "") ? date : "", round ?? "", ref.sentenceId ?? ""]
    .filter(Boolean)
    .join(" · ");
}

function clipExcerpt(raw: string, focus: string[], max = 40) {
  const text = raw.replace(/[«»]/gu, "").split(" → ")[0]?.trim() ?? "";
  // 表达升级、回答结构的证据来自回答复盘块，摘录是中文点评而不是本人说过的日语；
  // 放进「出处」只会让人读一段分析。没有假名的摘录不显示，只留日期 · 场次标签。
  if (!/[ぁ-ゖァ-ヺ]/u.test(text)) return "";
  for (const needle of focus) {
    const at = needle ? text.indexOf(needle) : -1;
    if (at >= 0) return clipContext(text, at, needle.length, { max });
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function curriculumEvidence(value: LanguageLearningItem, focus: string[]): QuickEvidence[] {
  return value.evidence.slice(0, 2).map((ref) => ({
    path: ref.path,
    label: evidenceLabel(ref),
    sentenceId: ref.sentenceId,
    excerpt: clipExcerpt(ref.excerpt, focus),
  }));
}

function baseItem(value: LanguageLearningItem, group: QuickGroup): Omit<QuickItem, "ja" | "jaAlts" | "reading" | "meaning" | "note" | "hasSlot"> {
  return {
    id: value.id,
    source: "curriculum",
    group,
    pattern: value.pattern,
    priority: value.basePriority,
    interviewCount: new Set(value.sourceInterviewKeys).size,
    stars: 0,
    listeningMark: value.listeningMark,
    evidence: [],
  };
}

const hasSlot = (value: string) => /[〜…~]/u.test(value);

function balancedParens(value: string) {
  let depth = 0;
  for (const char of value) {
    if (char === "（" || char === "(") depth += 1;
    if (char === "）" || char === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export type CurriculumQuickItems = {
  items: QuickItem[];
  skipped: Record<string, number>;
  excludedJaMeaning: number;
};

/**
 * 课程 → QuickItem。
 * - error_patch：meaning 留空，课程的 meaningZh「把「错」改为「对」」含答案，任何题面都不能用。
 * - interviewer_phrase：释义是日文的第一版不出题（多是话语标记的日文解释，四个选项合计上百字，不符合短平快），只计数。
 * - technical_term（题面即答案）与 fact_anchor（本人事实）不出题。
 */
export function quickItemsFromCurriculum(curriculum: LanguageCurriculum): CurriculumQuickItems {
  const items: QuickItem[] = [];
  const skipped: Record<string, number> = {};
  let excludedJaMeaning = 0;

  for (const value of curriculum.items) {
    switch (value.kind) {
      case "technical_term":
      case "fact_anchor":
        bump(skipped, value.kind);
        break;
      case "error_patch": {
        const parsed = parsePatch(value.targetJa, value.correctedJa, value.originalJa);
        if (!parsed.ok) {
          bump(skipped, `patch_${parsed.reason}`);
          break;
        }
        const { patch, notes } = parsed;
        items.push({
          ...baseItem(value, "error_patch"),
          ja: patch.fixes[0],
          jaAlts: patch.fixes,
          reading: "",
          meaning: "",
          note: [value.noteJa ?? "", ...notes].map((part) => part.trim()).filter(Boolean).join("；"),
          hasSlot: hasSlot(patch.fixes[0]),
          patch,
          evidence: curriculumEvidence(value, [patch.wrong, patch.fixes[0]]),
        });
        break;
      }
      case "interviewer_phrase": {
        const rawTarget = value.targetJa.replace(/\*\*/g, "").trim();
        const cleaned = cleanGoMeaning(value.meaningZh, rawTarget);
        if (cleaned.drop) {
          bump(skipped, "transcript_note");
          break;
        }
        // 含引号、问号或残缺括号（旧课程注音截取留下的「…する）」）的不是一个可出题的词；
        // 配对的括号是可省部分（「〜みたいなの（って）」），保留。
        if (!rawTarget || /[「」『』？?]/u.test(rawTarget) || !balancedParens(rawTarget)) {
          bump(skipped, "bad_target");
          break;
        }
        if (!cleaned.meaning) {
          bump(skipped, "no_meaning");
          break;
        }
        if (meaningLanguage(cleaned.meaning) === "ja") {
          excludedJaMeaning += 1;
          break;
        }
        // 日文括注与整理标记会在选项里泄露答案，移到解释里（见 splitMeaningNotes）。
        const split = splitMeaningNotes(cleaned.meaning);
        // 释义里原样包含目标（「抽象的＝抽象的」「SRE＝SRE（…）」）：和技术词一样题面即答案，不出题。
        if (normalizeQuickAnswer(cleaned.meaning).includes(normalizeQuickAnswer(rawTarget))) {
          bump(skipped, "meaning_echoes_target");
          break;
        }
        const reading = reliableReading(rawTarget, value.reading) ? value.reading.replace(/[・\s]/gu, "") : "";
        // 对不齐的读音不当答案，但原样留给答后反馈：本人看到半截读音也有用。
        const readingNote = !reading && value.reading ? `よみ：${value.reading}` : "";
        items.push({
          ...baseItem(value, "interviewer_phrase"),
          ja: rawTarget,
          jaAlts: [rawTarget],
          reading,
          meaning: split.meaning,
          note: [...split.notes, cleaned.rest, readingNote].filter(Boolean).join("；"),
          hasSlot: hasSlot(rawTarget),
          evidence: curriculumEvidence(value, [rawTarget]),
        });
        break;
      }
      case "active_chunk":
      case "answer_strategy": {
        // 「在「某题」中可直接调用的新表达」是兜底文案，不是这句话的意思，拿来当翻卡正面没有提示作用。
        if (!value.meaningZh || /可直接调用的新表达$/u.test(value.meaningZh)) {
          bump(skipped, "generic_meaning");
          break;
        }
        items.push({
          ...baseItem(value, value.kind),
          ja: value.targetJa,
          jaAlts: [value.targetJa],
          reading: "",
          meaning: value.meaningZh,
          note: "",
          hasSlot: hasSlot(value.targetJa),
          evidence: curriculumEvidence(value, [value.targetJa]),
        });
        break;
      }
    }
  }
  return { items, skipped, excludedJaMeaning };
}

// ── 単語文法帳 ──────────────────────────────────────────────────

type NotebookTable = "A" | "B-1" | "B-2" | "C" | "D" | "F" | "H";

const TABLE_GROUP: Record<NotebookTable, QuickGroup> = {
  A: "nb_calque",
  "B-1": "nb_term",
  "B-2": "nb_term",
  C: "nb_katakana",
  D: "nb_keigo",
  F: "nb_verb",
  H: "nb_pattern",
};

const READ_TABLES = new Set<string>(Object.keys(TABLE_GROUP));

function cells(line: string) {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function countStars(value: string): 0 | 1 | 2 {
  const count = (value.match(/★/gu) ?? []).length;
  return count >= 2 ? 2 : count === 1 ? 1 : 0;
}

/** 「★（注）」的注。 */
function starNote(value: string) {
  const match = value.replace(/★/gu, "").trim().match(/^（(.*)）$/u);
  return match ? match[1].trim() : "";
}

const splitSlash = (value: string) => value.split("／").map((part) => part.trim()).filter(Boolean);
const noReading = (value: string) => !value || /^[ー-]$/u.test(value);

function notebookItem(
  table: NotebookTable,
  path: string,
  key: string,
  values: Pick<QuickItem, "ja" | "jaAlts" | "reading" | "meaning" | "note" | "stars"> & { patch?: QuickPatch },
): QuickItem {
  const excerpt = [values.ja, values.reading, values.meaning].filter(Boolean).join(" · ");
  return {
    id: stableId("nb", `${table}|${normalizeQuickAnswer(key)}`),
    source: "notebook",
    group: TABLE_GROUP[table],
    ja: values.ja,
    jaAlts: values.jaAlts,
    reading: values.reading,
    meaning: values.meaning,
    note: values.note,
    hasSlot: hasSlot(values.ja),
    pattern: table,
    patch: values.patch,
    priority: 60 + 20 * values.stars,
    interviewCount: 0,
    stars: values.stars,
    evidence: [{
      path,
      label: `単語文法帳 · ${table}`,
      excerpt: excerpt.length > 40 ? `${excerpt.slice(0, 39)}…` : excerpt,
    }],
  };
}

function headerIndex(header: string[], ...names: string[]) {
  return header.findIndex((cell) => names.some((name) => cell.includes(name)));
}

function parseTable(table: NotebookTable, lines: string[], path: string, skipped: Record<string, number>) {
  const rows = lines.filter((line) => line.trim().startsWith("|"));
  if (rows.length < 2) return [];
  const header = cells(rows[0]);
  const body = rows.slice(1).filter((line) => !/^\|?\s*:?-{2,}/u.test(line.trim()));
  // 按表头名取列，不按位置：表格加一列或调换列序时不会把中文读成读音。
  const columns = {
    wrong: headerIndex(header, "✗"),
    right: headerIndex(header, "✓"),
    surface: headerIndex(header, "表記"),
    kana: headerIndex(header, "かな", "読み"),
    meaning: headerIndex(header, "中文", "用途"),
    star: header.findIndex((cell) => cell === "★"),
  };
  const items: QuickItem[] = [];
  for (const line of body) {
    const row = cells(line);
    const at = (index: number) => (index >= 0 ? row[index] ?? "" : "");
    if (table === "A") {
      if (columns.wrong < 0 || columns.right < 0 || columns.meaning < 0) {
        bump(skipped, "notebook_header");
        return items;
      }
      const wrongRaw = at(columns.wrong);
      const wrongNote = wrongRaw.match(/（([^）]*)）/u)?.[1] ?? "";
      const wrong = wrongRaw.replace(/（[^）]*）/gu, "").trim();
      const right = at(columns.right);
      const rights = splitSlash(right);
      const meaning = at(columns.meaning).replace(/★/gu, "").trim();
      if (!wrong || !rights.length || !meaning) {
        bump(skipped, "notebook_incomplete");
        continue;
      }
      items.push(notebookItem(table, path, wrong, {
        ja: right,
        jaAlts: [...new Set([right, ...rights])],
        reading: "",
        meaning,
        note: wrongNote,
        stars: countStars(line),
        patch: {
          wrong,
          fixes: rights,
          pre: "",
          post: "",
          wrongCore: wrong,
          rightCores: rights,
          particle: false,
          context: "",
          anchor: "none",
        },
      }));
      continue;
    }
    if (columns.surface < 0 || columns.kana < 0 || (table !== "C" && columns.meaning < 0)) {
      bump(skipped, "notebook_header");
      return items;
    }
    const surface = at(columns.surface);
    const kana = at(columns.kana);
    const meaningCell = table === "C" ? "" : at(columns.meaning);
    const starCell = columns.star >= 0 ? at(columns.star) : meaningCell;
    const meaning = meaningCell.replace(/★+/gu, "").replace(/\s+$/u, "").trim();
    const surfaces = splitSlash(surface);
    const kanas = noReading(kana) ? [] : splitSlash(kana);
    if (!surface) continue;
    if (table === "C" && !kanas.length) {
      bump(skipped, "notebook_no_reading");
      continue;
    }
    if (table !== "C" && !meaning) {
      bump(skipped, "notebook_incomplete");
      continue;
    }
    // 表記与かな各只有一段时，かな才是完整读音；「一次面接／最終面接｜いちじ／さいしゅうめんせつ」是缩写注音。
    const reading = surfaces.length === 1 && kanas.length === 1 ? kanas[0] : "";
    const readingNote = !reading && kanas.length ? `よみ：${kana}` : "";
    items.push(notebookItem(table, path, surface, {
      ja: surface,
      jaAlts: [...new Set([surface, ...surfaces])],
      reading,
      meaning,
      note: [starNote(starCell), readingNote].filter(Boolean).join("；"),
      stars: countStars(starCell),
    }));
  }
  return items;
}

function parsePatterns(lines: string[], path: string) {
  const items: QuickItem[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+\*\*(.+?)\*\*\s*(.*)$/u);
    if (!match) continue;
    const raw = match[1].trim();
    const tail = match[2];
    const ja = raw.replace(/（[ぁ-ゖー]+）/gu, "");
    const composed = raw.replace(/[\p{Script=Han}々]+（([ぁ-ゖー]+)）/gu, "$1");
    const reading = hasKanji(composed) ? "" : composed;
    items.push(notebookItem("H", path, ja, {
      ja,
      jaAlts: [ja],
      reading,
      meaning: "",
      note: starNote(tail.trim()),
      stars: countStars(tail),
    }));
  }
  return items;
}

/**
 * 解析単語文法帳。只认 A、B-1、B-2、C、D、F、H 七张表；
 * E 与 G 两表记的是本人事实（个人状况与实绩数字），和课程的 fact_anchor 同口径不出题，未知小节同样不读。
 * C 表「読み」为「ー」的行没有读音可考，跳过。
 */
export function parseVocabNotebook(markdown: string, path: string) {
  const items: QuickItem[] = [];
  const skipped: Record<string, number> = {};
  const sections = markdown.split(/^##\s+/mu).slice(1);
  for (const section of sections) {
    const [heading = "", ...lines] = section.split("\n");
    const table = heading.match(/^([A-Z](?:-\d+)?)\./u)?.[1] ?? "";
    if (!READ_TABLES.has(table)) {
      bump(skipped, "notebook_section");
      continue;
    }
    const parsed = table === "H"
      ? parsePatterns(lines, path)
      : parseTable(table as NotebookTable, lines, path, skipped);
    items.push(...parsed);
  }
  const unique = new Map<string, QuickItem>();
  for (const item of items) {
    if (unique.has(item.id)) bump(skipped, "notebook_duplicate");
    else unique.set(item.id, item);
  }
  return { items: [...unique.values()], skipped };
}

/** 题库：课程条目 ∪ 単語文法帳条目。没有课程时只有単語文法帳，仍能出题。 */
export function buildQuickPool(
  curriculum: LanguageCurriculum | undefined,
  notebook?: { path: string; content: string },
): QuickPool {
  const fromCurriculum = curriculum
    ? quickItemsFromCurriculum(curriculum)
    : { items: [], skipped: {}, excludedJaMeaning: 0 };
  const fromNotebook = notebook
    ? parseVocabNotebook(notebook.content, notebook.path)
    : { items: [], skipped: {} };
  const skipped: Record<string, number> = { ...fromCurriculum.skipped };
  for (const [key, count] of Object.entries(fromNotebook.skipped)) bump(skipped, key, count);
  const seen = new Set<string>();
  const items = [...fromCurriculum.items, ...fromNotebook.items].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return {
    items,
    skipped,
    excludedJaMeaning: fromCurriculum.excludedJaMeaning,
    notebookParsed: fromNotebook.items.length,
  };
}
