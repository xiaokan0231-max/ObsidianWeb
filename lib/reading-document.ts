import { stripFrontmatter } from "./notes";

export type ReadingHeading = { id: string; text: string; level?: number; lang?: string };

export function headingAnchor(lineIndex: number) {
  return `doc-h-${lineIndex}`;
}

export function headingPlainText(text: string) {
  return text
    .replace(/!?\[\[([^\]]+)\]\]/g, (_, body: string) => {
      const [target, alias] = body.split("|");
      return alias || target.split("#").filter(Boolean).pop() || target;
    })
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

// 目录和正文使用同一份行序列；隐藏生成标记但保留换行，避免章节锚点错位。
export function readingDocumentLines(content: string) {
  let fence = "";
  let inComment = false;
  return stripFrontmatter(content).split("\n").map((line) => {
    if (!inComment && /^\s*(`{3,}|~{3,})/.test(line)) {
      const marker = line.trimStart().match(/^(`{3,}|~{3,})/)![1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      return line;
    }
    if (fence) return line;
    let visible = "";
    let rest = line;
    while (rest) {
      if (inComment) {
        const end = rest.indexOf("-->");
        if (end < 0) break;
        rest = rest.slice(end + 3);
        inComment = false;
      } else {
        const start = rest.indexOf("<!--");
        if (start < 0) { visible += rest; break; }
        visible += rest.slice(0, start);
        rest = rest.slice(start + 4);
        inComment = true;
      }
    }
    return visible;
  });
}

export function scanReadingHeadings(content: string): ReadingHeading[] {
  const found: ReadingHeading[] = [];
  let fence = "";
  let seenTitle = false;
  readingDocumentLines(content).forEach((line, index) => {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      return;
    }
    if (fence || line.startsWith(">")) return;
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (!heading) return;
    const level = heading[1].length;
    if (level === 1 && !seenTitle) { seenTitle = true; return; }
    if (level > 3) return;
    found.push({ id: headingAnchor(index), level: Math.max(2, level), text: headingPlainText(heading[2]) });
  });
  return found;
}
