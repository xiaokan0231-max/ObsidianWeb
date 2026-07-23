export type Frontmatter = Record<string, unknown>;

export type Note = {
  path: string;
  stat: {
    ctime: number;
    mtime: number;
    size: number;
  };
  tags: string[];
  frontmatter: Frontmatter;
  content: string;
};

export function getString(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

export function noteBasename(path: string) {
  return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
}

export function stripFrontmatter(content: string) {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

export function stripMarkdown(content: string) {
  return stripFrontmatter(content)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$2$1")
    .replace(/[#>*_`|\-[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getTitle(note: Note) {
  const heading = note.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || getString(note.frontmatter.company) || noteBasename(note.path);
}

export function getType(note: Note) {
  return getString(note.frontmatter.type) || "note";
}

export function formatDate(value: string | number, includeYear = false) {
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: includeYear ? "numeric" : undefined,
    month: "short",
    day: "numeric",
  }).format(date);
}
