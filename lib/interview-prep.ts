import { getString, getType, stripFrontmatter, type Note } from "./notes.ts";

export type InterviewPrepItem = {
  id: string;
  title: string;
  category: string;
  priority: string;
  question: string;
  purpose: string;
  tags: string[];
  standardAnswer: string;
  shortAnswer: string;
  structure: string;
  boundary: string;
  evidence: string;
};

export type InterviewPrepLibrary = {
  note: Note;
  title: string;
  description: string;
  items: InterviewPrepItem[];
};

function sectionText(block: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = block.match(new RegExp(`^###\\s+${escaped}\\s*$`, "m"));
  if (!marker || marker.index === undefined) return "";
  const tail = block.slice(marker.index + marker[0].length).replace(/^\r?\n/, "");
  const nextHeading = tail.search(/^###\s+/m);
  return (nextHeading >= 0 ? tail.slice(0, nextHeading) : tail).trim();
}

function field(block: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`^-\\s+${escaped}::\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
}

export function parseInterviewPrepLibrary(note: Note): InterviewPrepLibrary | null {
  if (getType(note) !== "interview-prep-library") return null;

  const content = stripFrontmatter(note.content);
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "面试标准回答库";
  const description =
    content.match(/^>\s*(.+)$/m)?.[1]?.trim() ??
    "用真实经历回答高频问题，并明确能力边界。";
  const matches = [...content.matchAll(/^##\s+(p\d+)\s+(.+)$/gm)];
  const items = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    const block = content.slice(start, end);
    return {
      id: match[1],
      title: match[2].trim(),
      category: field(block, "分类") || "其他",
      priority: field(block, "优先级") || "B",
      question: field(block, "问题"),
      purpose: field(block, "目的"),
      tags: field(block, "标签")
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
      standardAnswer: sectionText(block, "标准回答"),
      shortAnswer: sectionText(block, "30秒版"),
      structure: sectionText(block, "回答结构"),
      boundary: sectionText(block, "使用边界"),
      evidence: sectionText(block, "证据"),
    };
  });

  return {
    note,
    title: getString(note.frontmatter.title) || title,
    description,
    items,
  };
}

export function findInterviewPrepLibrary(notes: Note[]) {
  for (const note of notes) {
    const library = parseInterviewPrepLibrary(note);
    if (library) return library;
  }
  return null;
}
