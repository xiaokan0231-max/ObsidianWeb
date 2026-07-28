// 面接準備に「その会社でしか成立しない志望動機」が実際に書かれているかを検査する。
// §1 の一行や共通カード p11 だけでは、面接でそのまま話せる回答にならないため別に確認する。

import { HEADING_RE, stripComments, stripFrontmatter } from "./interview-prep-embed.mjs";

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
export function findCompanyMotivationHeading(content) {
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

export function companyMotivationIssues(content) {
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
  const shortIndex = questionLines.findIndex((line) => {
    const match = line.match(HEADING_RE);
    return match?.[1].length === 5 && match[2].trim() === "20秒版（既定）";
  });
  if (shortIndex < 0) {
    issues.push("志望動機に `##### 20秒版（既定）` が無い");
  } else {
    const shortLines = headingBlock(questionLines, shortIndex, 5);
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
    issues.push("志望動機と同じQブロックに `▷ 根拠: [公式の直接ページ](https://…)` が無い");
  }

  return issues;
}
