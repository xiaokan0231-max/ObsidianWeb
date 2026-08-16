"use client";

import type { ReactNode } from "react";
import { stripFrontmatter } from "@/lib/notes";
import { normalizeHeading } from "@/lib/memory-atlas-data";

/** 見出しに付ける id。行番号ベースなので、目次側と本文側で必ず一致する。 */
export function headingAnchor(lineIndex: number) {
  return `doc-h-${lineIndex}`;
}

function renderInline(text: string, onWikiLink: (target: string, section?: string) => void): ReactNode[] {
  // 埋め込み記法 ![[…]] も同じリンクとして扱う。`!` を先に食わないと裸で残る。
  // [題](url) と <url> は取材メモの出典で多用するので、素の URL を晒さずリンクにする。
  const pieces = text
    .split(/(!?\[\[[^\]]+\]\]|\[[^\]]+\]\([^)\s]+\)|<https?:\/\/[^>\s]+>|\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean);
  return pieces.map((piece, index) => {
    const mdLink = piece.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (mdLink) {
      return (
        <a className="md-link" key={index} href={mdLink[2]} target="_blank" rel="noreferrer">
          {mdLink[1]}<i>↗</i>
        </a>
      );
    }
    if (/^<https?:\/\/[^>\s]+>$/.test(piece)) {
      const url = piece.slice(1, -1);
      return (
        <a className="md-link" key={index} href={url} target="_blank" rel="noreferrer">
          {url}<i>↗</i>
        </a>
      );
    }
    if (piece.startsWith("[[") || piece.startsWith("![[")) {
      const body = piece.replace(/^!?\[\[/, "").replace(/\]\]$/, "");
      const [targetWithHeading, alias] = body.split("|");
      const [target, section] = targetWithHeading.split("#");
      return (
        <button className="wiki-link" key={index} onClick={() => onWikiLink(target, section)}>
          {alias || section || target} ↗
        </button>
      );
    }
    if (piece.startsWith("**") && piece.endsWith("**")) return <strong key={index}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith("`") && piece.endsWith("`")) return <code key={index}>{piece.slice(1, -1)}</code>;
    return piece;
  });
}

/**
 * 引用の先頭に付いた記号で色を決める。vault 側は 🔴＝禁止・⚠️＝注意・⭐＝最重要…と
 * 記号で強弱を書き分けているのに、全部同じ灰色の箱で出すとその区別が消える。
 */
const CALLOUT_TONES: [string, string][] = [
  ["🔴", "danger"], ["❌", "danger"], ["⛔", "danger"],
  ["⚠️", "warn"], ["⚠", "warn"],
  ["🔑", "key"], ["⭐", "key"],
  ["📊", "data"], ["🔍", "data"],
  ["🎯", "aim"], ["✅", "aim"],
  ["💡", "idea"],
];

function calloutTone(firstLine: string) {
  const head = firstLine.trimStart();
  // ** で始まる強調や > の入れ子を剥いでから記号を見る
  const bare = head.replace(/^(\*\*|>|\s)+/, "");
  for (const [mark, tone] of CALLOUT_TONES) {
    if (bare.startsWith(mark)) return tone;
  }
  return null;
}

export default function MarkdownDocument({
  content,
  onWikiLink,
}: {
  content: string;
  onWikiLink: (target: string, section?: string) => void;
}) {
  const lines = stripFrontmatter(content).split("\n");
  const blocks: ReactNode[] = [];
  let codeLines: string[] = [];
  let inCode = false;
  // 連続する > 行は1つの引用にまとめる。1行ごとに箱を作ると、
  // 数行の注意書きが分断されて読めなくなる。
  let quoteLines: string[] = [];
  let quoteStart = 0;
  // 表も同じ理由でまとめる。行ごとに独立した箱だと、
  // ヘッダ行と本体行の区別も、枠線の一体感も出せない。
  let tableLines: string[] = [];
  let tableStart = 0;
  let seenTitle = false;
  const flushQuote = () => {
    if (!quoteLines.length) return;
    const buffered = quoteLines;
    quoteLines = [];
    const tone = calloutTone(buffered[0] ?? "");
    blocks.push(
      <blockquote key={`quote-${quoteStart}`} data-callout={tone ?? undefined}>
        {buffered.map((quoted, offset) => (
          <span key={offset}>{renderInline(quoted, onWikiLink)}</span>
        ))}
      </blockquote>,
    );
  };
  const flushTable = () => {
    if (!tableLines.length) return;
    const buffered = tableLines;
    tableLines = [];
    blocks.push(
      <div className="md-table" key={`table-${tableStart}`}>
        {buffered.map((row, rowIndex) => (
          <div className={`md-table-row${rowIndex === 0 ? " md-table-head" : ""}`} key={rowIndex}>
            {/* 前後のパイプだけ落として分割する。filter(Boolean) だと空セルが消えて列がずれる */}
            {row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell, cellIndex) => (
              <span key={cellIndex}>{renderInline(cell.trim(), onWikiLink)}</span>
            ))}
          </div>
        ))}
      </div>,
    );
  };
  lines.forEach((line, index) => {
    if (line.startsWith("```")) {
      flushQuote();
      flushTable();
      if (inCode) {
        blocks.push(<pre key={`code-${index}`}><code>{codeLines.join("\n")}</code></pre>);
        codeLines = [];
      }
      inCode = !inCode;
      return;
    }
    if (inCode) { codeLines.push(line); return; }
    if (line.startsWith(">")) {
      flushTable();
      if (!quoteLines.length) quoteStart = index;
      quoteLines.push(line.replace(/^>\s?/, ""));
      return;
    }
    if (line.startsWith("|")) {
      flushQuote();
      if (!tableLines.length) tableStart = index;
      // |---|---| の区切り行は表示しない
      if (!/^\|?\s*:?-+/.test(line)) tableLines.push(line);
      return;
    }
    flushQuote();
    flushTable();
    if (!line.trim()) return;
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={index} />);
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)/);
    if (heading) {
      const level = heading[1].length;
      const data = { "data-md-heading": normalizeHeading(heading[2]), id: headingAnchor(index) };
      // 冒頭の H1 は Obsidian 慣例でノート題名＝drawer が既に大きく出しているので捨てる。
      // 2つ目以降の H1 は本文の見出しなので h2 として出す。
      if (level === 1) {
        if (!seenTitle) { seenTitle = true; return; }
        blocks.push(<h2 key={index} {...data}>{renderInline(heading[2], onWikiLink)}</h2>);
      }
      else if (level === 2) blocks.push(<h2 key={index} {...data}>{renderInline(heading[2], onWikiLink)}</h2>);
      else if (level === 3) blocks.push(<h3 key={index} {...data}>{renderInline(heading[2], onWikiLink)}</h3>);
      else blocks.push(<h4 key={index} {...data}>{renderInline(heading[2], onWikiLink)}</h4>);
      return;
    }
    const listItem = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);
    if (listItem) {
      blocks.push(<div className="md-list-item" key={index}><i /> <span>{renderInline(listItem[1], onWikiLink)}</span></div>);
      return;
    }
    blocks.push(<p key={index}>{renderInline(line, onWikiLink)}</p>);
  });
  flushQuote();
  flushTable();
  return <article className="markdown-document">{blocks}</article>;
}
