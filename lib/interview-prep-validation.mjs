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

export function interviewPrepStructureIssues(content, prepVersion = 1) {
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
