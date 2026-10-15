// 面接準備に「その会社でしか成立しない志望動機」が実際に書かれているかを検査する。
// §1 の一行や共通カード p11 だけでは、面接でそのまま話せる回答にならないため別に確認する。

import { HEADING_RE, stripComments, stripFrontmatter } from "./interview-prep-embed.mjs";

// 新稿按语义章节分派；未声明版本的历史稿保留原来的编号契约。
/** @type {readonly { id: "overview" | "motivation" | "questions" | "resources" | "backup", title: string, navLabel: string }[]} */
export const PREP_V2_SECTIONS = [
  { id: "overview", title: "纵览与建议", navLabel: "纵览" },
  { id: "motivation", title: "志望動機", navLabel: "志望動機" },
  { id: "questions", title: "逆質問", navLabel: "逆質問" },
  { id: "resources", title: "研究资料", navLabel: "资料" },
  { id: "backup", title: "临场备用", navLabel: "临场备用" },
];

/**
 * v2 临场备用开头的三个固定块。不新增 H2：五章契约、导航与历史稿都不用动，临场卡按这些标题取出重排。
 * 标题原样匹配——改了一个字，Web 就认不出来，校验器也会按缺块报。
 * @type {readonly { id: "opening" | "concerns" | "closing", title: string }[]}
 */
export const PREP_V2_STAGE_BLOCKS = [
  { id: "opening", title: "冒頭30秒" },
  { id: "concerns", title: "本場の懸念 TOP3 と先回り一言" },
  { id: "closing", title: "締めの一言" },
];
export const PREP_V2_THANKS_TITLE = "当日お礼メッセージ";
/** 面试日期在这天及以后的 v2 稿必须带三块；更早的是历史稿，不回头补。 */
export const PREP_V2_STAGE_BLOCKS_FROM = "2026-10-16";
const SELF_INTRO_LINK_RE = /\[\[自己紹介_音読台本#[^\]|]+(?:\|[^\]]*)?\]\]/;
// 只抓「〜経験はまだありません」式的单纯否定和道歉：被问到时可以说边界，但先回り和締め不能用它开口。
const BARE_NEGATIVE_RE = /(?:経験|実績|こと)(?:は|が|も)?(?:まだ|あまり|ほとんど|全く|一度も|多く)?(?:ありません|ございません|ない)|申し訳|すみません/;

/** @param {unknown} value @returns {1 | 2 | null} */
export function interviewPrepVersion(value) {
  if (value === undefined || value === 1 || value === "1") return 1;
  if (value === 2 || value === "2") return 2;
  return null;
}

function headingBlock(lines, startIndex, level) {
  let end = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(HEADING_RE);
    if (match && match[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(startIndex + 1, end);
}

function semanticSectionLines(content, title) {
  const lines = stripComments(stripFrontmatter(content)).split("\n");
  const index = lines.findIndex((line) => {
    const match = line.match(HEADING_RE);
    return match?.[1].length === 2 && match[2].trim() === title;
  });
  return index < 0 ? null : headingBlock(lines, index, 2);
}

/** @param {string} content @param {1 | 2} [prepVersion] @param {{ date?: string }} [options] */
export function interviewPrepStructureIssues(content, prepVersion = 1, options = {}) {
  if (prepVersion !== 2) return [];
  const body = stripComments(stripFrontmatter(content));
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
  const issues = [];
  for (const spec of PREP_V2_SECTIONS) {
    const count = headings.filter((heading) => heading === spec.title).length;
    if (count !== 1) issues.push(`v2 需要且仅能有一个 \`## ${spec.title}\`（当前 ${count} 个）`);
    else if (!semanticSectionLines(content, spec.title)?.join("\n").trim()) {
      issues.push(`v2 的 \`## ${spec.title}\` 不能为空`);
    }
  }
  for (const heading of headings) {
    if (!PREP_V2_SECTIONS.some((spec) => spec.title === heading)) {
      issues.push(`v2 不支持额外的 H2「${heading}」，请放入五个语义章节内`);
    }
  }
  return [...issues, ...prepStageBlockIssues(content, options)];
}

const headingLevel = (line) => line.match(HEADING_RE)?.[1].length ?? 0;
const headingTitle = (line) => line.match(HEADING_RE)?.[2].trim() ?? "";
const filled = (text) => Boolean(text) && !text.includes("{{");

/** 台词正文。去掉注音与加粗再查，免得「経験（けいけん）は」这类写法躲过否定检查。 */
function sayText(line) {
  const body = line.trim().replace(/^>\s?/, "");
  if (!body.startsWith("【あなた】")) return null;
  return body.slice(5).replace(/（[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+）/gu, "").replace(/\*/g, "").trim();
}

/**
 * 临场备用的三个固定块。稿里出现任一块、或面试日期不早于生效日时才查：
 * 生效前的 v2 稿没有这三块也照常通过，一旦开始用就必须写全。
 * @param {string} content
 * @param {{ date?: string }} [options]
 */
export function prepStageBlockIssues(content, { date = "" } = {}) {
  const lines = semanticSectionLines(content, "临场备用");
  if (!lines) return [];
  const found = (title) => lines.flatMap((line, index) => headingLevel(line) === 3 && headingTitle(line) === title ? [index] : []);
  const day = String(date).trim().replace(/^["']|["']$/g, "");
  const due = /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= PREP_V2_STAGE_BLOCKS_FROM;
  if (!due && PREP_V2_STAGE_BLOCKS.every((spec) => found(spec.title).length === 0)) return [];

  const issues = [];
  for (const spec of PREP_V2_STAGE_BLOCKS) {
    const indexes = found(spec.title);
    if (indexes.length !== 1) {
      issues.push(`v2 的临场备用需要且仅能有一个 \`### ${spec.title}\`（当前 ${indexes.length} 个）`);
      continue;
    }
    const block = headingBlock(lines, indexes[0], 3);
    const says = block.map(sayText).filter((text) => text !== null);
    for (const text of says) {
      if (BARE_NEGATIVE_RE.test(text)) {
        issues.push(`「${spec.title}」的台词不能用单纯否定或道歉开口，改成现状＋计划：${text.slice(0, 40)}`);
      }
    }
    if (spec.id === "opening") {
      if (!says.some(filled)) issues.push("「冒頭30秒」缺少置换后的 `【あなた】` 挨拶");
      if (!SELF_INTRO_LINK_RE.test(block.join("\n"))) {
        issues.push("「冒頭30秒」缺少自己紹介的指定朗读节链接 `[[自己紹介_音読台本#…]]`");
      }
    } else if (spec.id === "concerns") {
      const items = block.flatMap((line, index) => headingLevel(line) === 4 ? [index] : []);
      if (items.length < 1 || items.length > 3) {
        issues.push(`「${spec.title}」需要 1〜3 个 \`####\` 懸念（当前 ${items.length} 个）`);
      }
      for (const index of items) {
        if (!headingBlock(block, index, 4).map(sayText).some(filled)) {
          issues.push(`懸念「${headingTitle(block[index])}」缺少置换后的 \`【あなた】\` 先回り一言`);
        }
      }
    } else {
      const firstSub = block.findIndex((line) => headingLevel(line) >= 4);
      if (!(firstSub < 0 ? block : block.slice(0, firstSub)).map(sayText).some(filled)) {
        issues.push("「締めの一言」缺少置换后的 `【あなた】` 志望度表达");
      }
      const thanks = block.flatMap((line, index) => headingLevel(line) === 4 && headingTitle(line) === PREP_V2_THANKS_TITLE ? [index] : []);
      if (thanks.length !== 1) {
        issues.push(`「締めの一言」需要且仅能有一个 \`#### ${PREP_V2_THANKS_TITLE}\`（当前 ${thanks.length} 个）`);
      } else if (!headingBlock(block, thanks[0], 4).some((line) => {
        const text = line.trim();
        return filled(text) && !text.startsWith("▷") && headingLevel(text) === 0;
      })) {
        issues.push(`「${PREP_V2_THANKS_TITLE}」缺少置换后的短文`);
      }
    }
  }
  return issues;
}

export function prepCarryForwardIssues(content, prepVersion = 1) {
  const scope = prepVersion === 2
    ? (semanticSectionLines(content, "纵览与建议") ?? []).join("\n")
    : content;
  return /^###\s+前回から今回への回流\s*$/m.test(scope)
    ? []
    : [prepVersion === 2
      ? "v2 的纵览与建议中缺少「### 前回から今回への回流」"
      : "§2 に「### 前回から今回への回流」が無い"];
}

function quickMotivationValue(lines) {
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells[0] === "志望動機") return cells.slice(1).join("|").trim();
  }
  return "";
}

/**
 * Web の「本場専属・志望動機」入口もこの判定を使う。
 * §6 の外にある速査キーワードや共通カード p11 を拾うと、別会社でも同じ回答を
 * 開いてしまうため、想定問答内の H4 だけを返す。
 */
export function findCompanyMotivationHeading(content, prepVersion = 1) {
  if (prepVersion === 2) {
    return semanticSectionLines(content, "志望動機") ? "志望動機" : null;
  }
  const body = stripComments(stripFrontmatter(content));
  const lines = body.split("\n");
  const qaSectionIndex = lines.findIndex((line) => {
    const match = line.match(HEADING_RE);
    return match?.[1].length === 2 && match[2].includes("想定問答");
  });
  if (qaSectionIndex < 0) return null;

  const qaLines = headingBlock(lines, qaSectionIndex, 2);
  for (const line of qaLines) {
    const match = line.match(HEADING_RE);
    if (match?.[1].length === 4 && match[2].includes("志望動機")) {
      return match[2].trim();
    }
  }
  return null;
}

export function companyMotivationIssues(content, prepVersion = 1) {
  if (prepVersion === 2) {
    const lines = semanticSectionLines(content, "志望動機");
    return lines
      ? shortMotivationIssues(lines, 3)
      : ["v2 缺少 `## 志望動機` 的本公司专属回答"];
  }
  const body = stripComments(stripFrontmatter(content));
  const lines = body.split("\n");
  const issues = [];

  const quickSectionIndex = lines.findIndex((line) => {
    const match = line.match(HEADING_RE);
    return match?.[1].length === 2 && match[2].includes("速査");
  });
  const quickLines = quickSectionIndex < 0 ? [] : headingBlock(lines, quickSectionIndex, 2);
  const quickValue = quickMotivationValue(quickLines);
  if (!quickValue || quickValue.includes("{{")) {
    issues.push("§1「面談直前の一枚」に会社固有の志望動機が無い");
  }

  const qaSectionIndex = lines.findIndex((line) => {
    const match = line.match(HEADING_RE);
    return match?.[1].length === 2 && match[2].includes("想定問答");
  });
  const qaLines = qaSectionIndex < 0 ? [] : headingBlock(lines, qaSectionIndex, 2);
  const motivationHeading = findCompanyMotivationHeading(content);
  const questionIndex = motivationHeading
    ? qaLines.findIndex((line) => {
        const match = line.match(HEADING_RE);
        return match?.[1].length === 4 && match[2].trim() === motivationHeading;
      })
    : -1;
  if (questionIndex < 0) {
    issues.push("§6 に `#### Q. 志望動機` の会社特化回答が無い（§1 の一行や p11 の参照だけでは不可）");
    return issues;
  }

  const questionLines = headingBlock(qaLines, questionIndex, 4);
  return [...issues, ...shortMotivationIssues(questionLines, 5)];
}

function shortMotivationIssues(questionLines, shortLevel) {
  const issues = [];
  const shortIndex = questionLines.findIndex((line) => {
    const match = line.match(HEADING_RE);
    return match?.[1].length === shortLevel && match[2].trim() === "20秒版（既定）";
  });
  if (shortIndex < 0) {
    issues.push(`志望動機に \`${"#".repeat(shortLevel)} 20秒版（既定）\` が無い`);
  } else {
    const shortLines = headingBlock(questionLines, shortIndex, shortLevel);
    const answer = shortLines
      .filter((line) => line.includes("【あなた】"))
      .join("\n")
      .trim();
    if (!answer || answer.includes("{{")) {
      issues.push("志望動機の20秒版に、置換済みの `【あなた】` 回答が無い");
    } else {
      const sentenceCount = (answer.match(/。/g) ?? []).length;
      if (sentenceCount < 2 || sentenceCount > 3) {
        issues.push(`志望動機の20秒版は2〜3句にする（現在 ${sentenceCount} 句）`);
      }
    }
  }

  const questionText = questionLines.join("\n");
  if (!/^▷\s*根拠\s*[:：].*\[[^\]]+\]\(https:\/\/[^)]+\)/m.test(questionText)) {
    issues.push(`${shortLevel === 3 ? "志望動機の H2" : "志望動機と同じQブロック"}に \`▷ 根拠: [公式の直接ページ](https://…)\` が無い`);
  }

  return issues;
}
