// 面接準備ノートの埋め込み（![[ノート]] / ![[ノート#節]]）を解く最小の道具。
//
// Web の描画（lib/interview-prep-doc.ts）と vault:check の断リンク検査が同じ判定を使うために
// ここを唯一の実装にしている。片方だけ直すと「Web では出るのに check は通る」等のズレが出る。
// ⚠️ skill 側の scripts/build_interview_html.py にも同じ規則の実装がある（node 無しで動かすため）。
//    記法を変えるときは必ず両方を直す。

export const EMBED_RE = /^\s*!\[\[([^\]|#]+?)(?:#([^\]|]+?))?(?:\|[^\]]*)?\]\]\s*$/;
export const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

/** 行が単独の埋め込みなら {target, section} を返す。文中の ![[…]] は展開対象にしない。 */
export function parseEmbedLine(line) {
  const match = line.match(EMBED_RE);
  if (!match) return null;
  return { target: match[1].trim(), section: (match[2] ?? "").trim() };
}

export function stripFrontmatter(text) {
  return text.replace(FRONTMATTER_RE, "");
}

/** 作業メモ。展開より先に落とす——後回しにするとコメント内の ![[…]] の例まで取り込まれる。 */
export function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

export function listHeadings(body) {
  const out = [];
  for (const line of body.split("\n")) {
    const match = line.match(HEADING_RE);
    if (match) out.push(match[2].trim());
  }
  return out;
}

/**
 * 指定見出しの節本文を取り出す（見出し行そのものは含めない）。
 * 見つからなければ null。level は元の見出しレベルで、取り込み側で下げ幅を決めるのに使う。
 */
export function sliceSection(body, heading) {
  const want = heading.trim();
  const lines = body.split("\n");
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(HEADING_RE);
    if (match && match[2].trim() === want) {
      start = i + 1;
      level = match[1].length;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    const match = lines[i].match(HEADING_RE);
    if (match && match[1].length <= level) {
      end = i;
      break;
    }
  }
  return { body: lines.slice(start, end).join("\n").replace(/^\n+|\n+$/g, ""), level };
}

/** 取り込んだ本文の見出しを shift 段だけ下げる（埋め込み先の見出しの下にぶら下げるため）。 */
export function shiftHeadings(body, shift) {
  if (shift <= 0) return body;
  return body
    .split("\n")
    .map((line) => {
      const match = line.match(HEADING_RE);
      if (!match) return line;
      return "#".repeat(Math.min(match[1].length + shift, 6)) + " " + match[2];
    })
    .join("\n");
}

/**
 * ノート本文から埋め込み参照を列挙する（解決はしない）。
 * vault:check が「参照先が実在するか」を調べるのに使う。
 */
export function listEmbeds(content) {
  const out = [];
  for (const line of stripComments(stripFrontmatter(content)).split("\n")) {
    const embed = parseEmbedLine(line);
    if (embed) out.push({ ...embed, raw: line.trim() });
  }
  return out;
}
