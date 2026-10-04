/*
 * 行内 Markdown 的切分。只产出纯数据（token），React 元素由 app/markdown-document.tsx 生成，
 * 这样语法边界（斜体避开乘号、图片只放行 https…）可以脱离渲染单独测试。
 */

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "wiki"; target: string; section?: string; label: string }
  /** href 未经协议过滤：站内相对链接要先交给调用方解析，渲染侧再按 isAllowedHref 决定能不能外链。 */
  | { type: "link"; label: string; href: string; raw: string }
  | { type: "image"; alt: string; src: string; width?: number }
  | { type: "footnote"; id: string; raw: string }
  | { type: "strong" | "em" | "del" | "mark"; children: InlineToken[] };

/**
 * 交替顺序就是优先级：同一位置先试前面的。
 * - 行内代码排第一，代码里的 * [[ 一律不再解析。
 * - 图片 ![…](…) 要排在 [题](url) 前，否则 `!` 会被剩成字面量。
 * - **粗体** 必须在 *斜体* 之前；斜体要求紧贴文字（`3 * 4 * 5` 不算），
 *   且两侧不能是半角字母数字或 *（`2*3*4`、`a*b` 都不会误伤）。中文紧贴的 `中文*斜体*` 照常生效，
 *   因为全角文字旁不会出现乘号。列表标记在块级已被剥掉，到不了这里。
 * - ==高亮== 同样要求紧贴，`a == b == c` 这种比较式保持原文。
 */
const INLINE_PATTERN = new RegExp([
  "`[^`]+`",
  "!?\\[\\[[^\\]]+\\]\\]",
  "!\\[[^\\]]*\\]\\([^)\\s]+\\)",
  "\\[\\^[^\\]\\s]+\\]",
  "\\[[^\\]]+\\]\\([^)\\s]+\\)",
  "<https?:\\/\\/[^>\\s]+>",
  "\\*\\*(?:[^*]|\\*(?!\\*))+?\\*\\*",
  "~~(?!\\s)[^~]+?~~",
  "==(?![\\s=])[^=\\n]+?(?<!\\s)==",
  "(?<![*A-Za-z0-9_])\\*(?![\\s*])[^*\\n]+?(?<![\\s*])\\*(?![*A-Za-z0-9_])",
].map((part) => `(?:${part})`).join("|"), "g");

// 外链只放行这几种协议；javascript: 之类原样当文本，不能变成可点的 href。
export function isAllowedHref(href: string) {
  return /^(https?:|mailto:|obsidian:)/i.test(href);
}

/** wikilink 本体 → 目标／章节／显示名。表格外写的 `[[a\|b]]` 也按 Obsidian 的转义竖线理解。 */
export function parseWikiBody(body: string) {
  const split = body.match(/^([\s\S]*?)\\?\|([\s\S]*)$/);
  const targetWithHeading = split ? split[1] : body;
  const alias = split ? split[2] : "";
  const [target, section] = targetWithHeading.split("#");
  return { target, section: section || undefined, label: alias || section || target };
}

/**
 * `![[截图.png]]`、`[[资料.pdf]]` 指向附件而不是笔记：笔记索引里本来就没有它们，
 * 拿去查只会全部被标成「找不到」，读者会误以为链接断了。
 */
export function isAttachmentTarget(target: string) {
  return /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|pdf|mp3|wav|m4a|ogg|flac|mp4|webm|mov|mkv|canvas|excalidraw|docx?|xlsx?|pptx?|csv|zip)$/i.test(target.trim());
}

function imageToken(piece: string): InlineToken {
  const match = piece.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/)!;
  // 图片会自动发请求，比链接更敏感：只放行 https，不让 http 明文或其他协议偷偷加载。
  if (!/^https:\/\//i.test(match[2])) return { type: "text", text: piece };
  // Obsidian 的 ![说明|300](url) 写法：竖线后的数字是宽度，不是说明的一部分。
  const sized = match[1].match(/^(.*?)\|(\d{1,4})$/);
  return sized
    ? { type: "image", alt: sized[1].trim(), src: match[2], width: Number(sized[2]) }
    : { type: "image", alt: match[1].trim(), src: match[2] };
}

function tokenFor(piece: string): InlineToken {
  if (piece.startsWith("`")) return { type: "code", text: piece.slice(1, -1) };
  if (piece.startsWith("[[") || piece.startsWith("![[")) {
    return { type: "wiki", ...parseWikiBody(piece.replace(/^!?\[\[/, "").replace(/\]\]$/, "")) };
  }
  if (piece.startsWith("![")) return imageToken(piece);
  if (piece.startsWith("[^")) return { type: "footnote", id: piece.slice(2, -1), raw: piece };
  const mdLink = piece.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
  if (mdLink) return { type: "link", label: mdLink[1], href: mdLink[2], raw: piece };
  if (piece.startsWith("<")) return { type: "link", label: piece.slice(1, -1), href: piece.slice(1, -1), raw: piece };
  if (piece.startsWith("**")) return { type: "strong", children: tokenizeInline(piece.slice(2, -2)) };
  if (piece.startsWith("~~")) return { type: "del", children: tokenizeInline(piece.slice(2, -2)) };
  if (piece.startsWith("==")) return { type: "mark", children: tokenizeInline(piece.slice(2, -2)) };
  return { type: "em", children: tokenizeInline(piece.slice(1, -1)) };
}

export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    if (match.index > last) tokens.push({ type: "text", text: text.slice(last, match.index) });
    tokens.push(tokenFor(match[0]));
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ type: "text", text: text.slice(last) });
  return tokens;
}

/** 目录、预览卡等只要纯文字的地方：去掉行内标记，保留读者看得到的字。 */
export function inlinePlainText(text: string): string {
  return tokenizeInline(text).map(plainText).join("");
}

function plainText(token: InlineToken): string {
  if (token.type === "text" || token.type === "code") return token.text;
  if (token.type === "wiki" || token.type === "link") return token.label;
  if (token.type === "image") return token.alt;
  if (token.type === "footnote") return "";
  return token.children.map(plainText).join("");
}
