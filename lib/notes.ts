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

/**
 * 会社名の同一性判定。表示名は出所ごとに `株式会社ＧＳＩ` / `GSI` /
 * `Sharing_Innovations` のように揺れるが、人間には同じ会社である。
 * 法人格・空白・区切りだけを落とし、語そのものは残す。
 * 日历の重複判定と、面接ノートの照合（review-join）が同じ一本を使う——
 * 実データで 整理稿=株式会社ＧＳＩ／批注=GSI（批注はディレクトリ名から自動生成）
 * という割れが実在し、厳密一致では同じ回のノートが配对できなかった。
 */
export function companyIdentity(company: string) {
  return company
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/株式会社|有限会社|合同会社|\(株\)|incorporated|inc\.?|co\.?,?\s*ltd\.?|ltd\.?/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * wikilink を数える前に「リンクと見なさない領域」を落とす。
 * frontmatter・コードフェンス・HTML コメント・行内コードの [[...]] は
 * 例示や設定であって知識関係ではない。
 * これまで剥ぐ側（知識図譜）と剥がない側（首页の孤点統計・反リンク）の
 * 二つの口径が併存し、同じノートの「関係の有無」が画面ごとに違い得た。
 */
export function stripNonLinkRegions(content: string) {
  return stripFrontmatter(content)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/`[^`\n]*`/g, " ");
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
