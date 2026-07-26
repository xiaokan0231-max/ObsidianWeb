import { getString, getType, noteBasename, stripFrontmatter, type Note } from "./notes.ts";
import {
  EMBED_RE,
  HEADING_RE,
  shiftHeadings,
  sliceSection,
} from "./interview-prep-embed.mjs";

// 単場面接の準備ドキュメント（type: interview-prep）を Web で読める構造に落とす。
//
// なぜ独自パーサなのか：この文書は普通の Markdown ではなく、面接準備専用の記法を持つ。
//   `漢字（かな）`  → 頭上のルビ（口に出すための注音。プレーンテキストだと読めない）
//   `【あなた】…`   → 自分の台詞　`【面接官】…` → 相手の想定発言
//   `▷ …`「▶ …」  → 中文の戦略メモ・補足　`> …` → 注意書き
//   `![[ノート#節]]` → vault の共通資産をその場に取り込む（コピーせず参照する）
// 記法の正本は skill 側の build_interview_html.py と揃えている。片方だけ変えると
// 「HTML では出るが Web では出ない」節が生まれるので、両方同時に直す。

export type PrepInline =
  | { kind: "text"; text: string }
  | { kind: "ruby"; base: string; reading: string }
  | { kind: "strong"; children: PrepInline[] }
  | { kind: "link"; href: string; children: PrepInline[] }
  // ref＝vault 内リンク。表示テキストだけでなく飛び先も持つ：
  // 準備ドキュメントから「自己紹介はどのカードか」へ行けないと、結局 Obsidian を開くことになる
  | { kind: "ref"; text: string; target: string; section: string };

export type PrepNoteTone = "zh" | "follow" | "tip";

export type PrepBlock =
  | { kind: "heading"; level: 3 | 4; inline: PrepInline[] }
  | { kind: "say"; speaker: "you" | "interviewer"; inline: PrepInline[] }
  | { kind: "note"; tone: PrepNoteTone; inline: PrepInline[] }
  | { kind: "paragraph"; inline: PrepInline[] }
  | { kind: "list"; ordered: boolean; start?: number; items: PrepInline[][] }
  | { kind: "table"; head: PrepInline[][]; rows: PrepInline[][][] }
  | { kind: "code"; text: string };

export type PrepSection = {
  id: string;
  title: string;
  navLabel: string;
  blocks: PrepBlock[];
};

export type PrepSectionGroup = {
  id: string;
  label: string;
  sectionIndexes: number[];
};

const PREP_SECTION_GROUPS = [
  { id: "quick", label: "临战速查", numbers: [1] },
  { id: "company", label: "公司与岗位", numbers: [2, 3, 4, 11] },
  { id: "story", label: "自我叙事", numbers: [5, 8] },
  { id: "answers", label: "想定问答", numbers: [6] },
  { id: "questions", label: "反向提问", numbers: [7] },
  { id: "tools", label: "当日工具", numbers: [9, 10, 12] },
] as const;

function prepSectionNumber(title: string) {
  const normalized = title.normalize("NFKC");
  return Number(normalized.match(/^(\d+)[.、．]/)?.[1] ?? 0);
}

/**
 * vault の12節は出典・埋め込み・交差参照の契約として残し、Web では用途別の6群に畳む。
 * 情報設計まで Markdown の見出し数に引きずられると、当日のナビが12個の同格ボタンになってしまう。
 */
export function groupPrepSections(sections: PrepSection[]): PrepSectionGroup[] {
  const numbered = sections.map((section, index) => ({
    index,
    number: prepSectionNumber(section.title),
  }));
  const assigned = new Set<number>();
  const groups = PREP_SECTION_GROUPS.map((spec) => {
    const sectionIndexes = numbered
      .filter((item) => spec.numbers.some((number) => number === item.number))
      .map((item) => item.index);
    sectionIndexes.forEach((index) => assigned.add(index));
    return { id: spec.id, label: spec.label, sectionIndexes };
  }).filter((group) => group.sectionIndexes.length > 0);

  const remaining = sections.map((_, index) => index).filter((index) => !assigned.has(index));
  if (remaining.length > 0) groups.push({ id: "other", label: "其他", sectionIndexes: remaining });
  return groups.length > 0
    ? groups
    : sections.map((section, index) => ({
        id: section.id,
        label: section.navLabel,
        sectionIndexes: [index],
      }));
}

export type PrepEmbed = {
  raw: string;
  target: string;
  section: string;
  resolved: boolean;
};

export type PrepExternalLink = {
  label: string;
  href: string;
  group: string;
  starred: boolean;
};

export type InterviewPrepDoc = {
  note: Note;
  title: string;
  company: string;
  date: string;
  round: string;
  format: string;
  interviewers: string;
  caseLink: string;
  sections: PrepSection[];
  embeds: PrepEmbed[];
  externalLinks: PrepExternalLink[];
};

export const INTERVIEW_PREP_TYPE = "interview-prep";

// 汉字/拉丁字母 + 「纯假名括号」→ ruby。括号内に仮名以外が混ざる場合は注音ではなく
// 普通の補足（例「（約70%）」「（Azure）」）なので変換しない。build_interview_html.py と同じ判定。
const RUBY_SOURCE = "([一-龥々ヶ〆A-Za-z0-9]+)（([ぁ-んァ-ヶーゝゞ・]+)）";
const INLINE_RE = new RegExp(
  [
    "(\\*\\*[^*]+\\*\\*)",
    "(\\[\\[[^\\]]+\\]\\])",
    "(\\[[^\\]]+\\]\\((?:https?:)?[^)\\s]+\\))",
    `(${RUBY_SOURCE})`,
  ].join("|"),
  "g",
);
const RUBY_RE = new RegExp(`^${RUBY_SOURCE}$`);

function pushText(nodes: PrepInline[], text: string) {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last?.kind === "text") last.text += text;
  else nodes.push({ kind: "text", text });
}

export function parseInline(source: string): PrepInline[] {
  const nodes: PrepInline[] = [];
  let cursor = 0;
  for (const match of source.matchAll(INLINE_RE)) {
    const index = match.index ?? 0;
    pushText(nodes, source.slice(cursor, index));
    cursor = index + match[0].length;
    const [, bold, wiki, link] = match;
    if (bold) {
      nodes.push({ kind: "strong", children: parseInline(bold.slice(2, -2)) });
      continue;
    }
    if (wiki) {
      // [[ノート#節|表示名]] → 表示名 / [[ノート#節]] → 節（無ければノート名）。
      // Web からは vault のファイルを開けないので、出典が分かる文字だけ残す
      const inner = wiki.slice(2, -2);
      const [linkTarget, alias] = inner.split("|");
      const [name, section] = linkTarget.split("#");
      nodes.push({
        kind: "ref",
        text: (alias || section || name).trim(),
        target: name.trim(),
        section: (section ?? "").trim(),
      });
      continue;
    }
    if (link) {
      const parsed = link.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (parsed) {
        nodes.push({ kind: "link", href: parsed[2], children: parseInline(parsed[1]) });
        continue;
      }
    }
    const ruby = match[0].match(RUBY_RE);
    if (ruby) {
      nodes.push({ kind: "ruby", base: ruby[1], reading: ruby[2] });
      continue;
    }
    pushText(nodes, match[0]);
  }
  pushText(nodes, source.slice(cursor));
  return nodes;
}

/**
 * ナビ用の短いラベル。**節番号は残す**——12節あるので「何番目か」が最も速い手がかりになる。
 * 番号の後ろは、括弧や読点で切って核だけにする（「求人の正体と、そこから逆算した戦い方」→「求人の正体と」）。
 */
function navLabel(title: string) {
  const numbered = title.match(/^([0-9０-９一二三四五六七八九十]+[．.、]\s*)(.*)$/);
  const prefix = numbered ? numbered[1].replace(/\s+$/, "") : "";
  const core = shortLabel(numbered ? numbered[2] : title);
  return prefix + (core || title.slice(0, 8));
}

/**
 * 見出しから「核」だけを取る。括弧の補足・読点以降・中黒以降を落とす。
 * 「転職理由・転職回数の台本」→「転職理由」、「3つの数字（信用状。…）」→「3つの数字」。
 * 途中で切れたラベルは読めないので、区切りで切ってから丸める。
 */
export function shortLabel(text: string, limit = 8) {
  const core = text
    .replace(/^[⭐★●■\s　]+/, "")
    .replace(/[（(].*/, "")
    .split(/[、，・]/)[0]
    .split(/\s+/)[0]
    .trim();
  return core.length > limit ? `${core.slice(0, limit)}…` : core;
}

/** インライン列を素のテキストに戻す。検索・見出し索引に使う。 */
export function prepInlineText(nodes: PrepInline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "ruby":
          return node.base;
        case "strong":
        case "link":
          return prepInlineText(node.children);
        default:
          return node.text;
      }
    })
    .join("");
}

/** ブロックを素のテキストに戻す。表はセルを空白で連結する。 */
export function prepBlockText(block: PrepBlock): string {
  switch (block.kind) {
    case "table":
      return [...block.head, ...block.rows.flat()].map(prepInlineText).join(" ");
    case "list":
      return block.items.map(prepInlineText).join(" ");
    case "code":
      return block.text;
    default:
      return prepInlineText(block.inline);
  }
}

function expandEmbeds(
  markdown: string,
  byName: Map<string, Note>,
  embeds: PrepEmbed[],
  depth = 0,
  seen: ReadonlySet<string> = new Set(),
): string {
  if (depth > 3) return markdown;
  const out: string[] = [];
  let contextLevel = 1;
  for (const line of markdown.split("\n")) {
    const heading = line.match(HEADING_RE);
    if (heading) contextLevel = heading[1].length;
    const embed = line.match(EMBED_RE);
    if (!embed) {
      out.push(line);
      continue;
    }
    const target = embed[1].trim();
    const section = (embed[2] ?? "").trim();
    const key = `${target}#${section}`;
    const record: PrepEmbed = { raw: line.trim(), target, section, resolved: false };
    embeds.push(record);
    const note = byName.get(target);
    if (!note || seen.has(key)) {
      // 解決できない埋め込みは節がまるごと欠ける事故なので、本文に警告として残す
      out.push(`> ⚠️ 埋め込みを解決できません：![[${key.replace(/#$/, "")}]]`);
      continue;
    }
    let body = stripFrontmatter(note.content).replace(/^\n+|\n+$/g, "");
    let sourceLevel = 1;
    if (section) {
      const sliced = sliceSection(body, section);
      if (!sliced) {
        out.push(`> ⚠️ 埋め込み先に「${section}」という節がありません：![[${key}]]`);
        continue;
      }
      body = sliced.body;
      sourceLevel = sliced.level;
    } else {
      body = body.replace(/^#\s+.*\n?/, "").replace(/^\n+/, "");
    }
    record.resolved = true;
    body = shiftHeadings(body, Math.max(0, contextLevel - sourceLevel));
    out.push(expandEmbeds(body, byName, embeds, depth + 1, new Set([...seen, key])));
  }
  return out.join("\n");
}

/**
 * 表のセルに分ける。`\|` はセル区切りではなく文字としての `|`。
 * これを素の split("|") でやると、表の中に書いた `[[ノート#節\|表示名]]` が
 * 途中で切れてリンクとして認識されなくなる（Obsidian は表内の別名指定に `\|` を要求する）。
 */
function splitCells(line: string) {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let buffer = "";
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === "\\" && inner[i + 1] === "|") {
      buffer += "|";
      i += 1;
      continue;
    }
    if (inner[i] === "|") {
      cells.push(buffer);
      buffer = "";
      continue;
    }
    buffer += inner[i];
  }
  cells.push(buffer);
  return cells;
}

function parseRow(line: string) {
  return splitCells(line).map((cell) => parseInline(cell.trim()));
}

function isSeparatorRow(line: string) {
  return splitCells(line).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseBlocks(markdown: string): PrepBlock[] {
  const blocks: PrepBlock[] = [];
  const lines = markdown.split("\n");
  let list: { ordered: boolean; start?: number; items: PrepInline[][] } | null = null;
  let table: { head: PrepInline[][]; rows: PrepInline[][][] } | null = null;

  const closeList = () => {
    if (list) blocks.push({
      kind: "list",
      ordered: list.ordered,
      ...(list.start ? { start: list.start } : {}),
      items: list.items,
    });
    list = null;
  };
  const closeTable = () => {
    if (table) blocks.push({ kind: "table", head: table.head, rows: table.rows });
    table = null;
  };
  const closeAll = () => {
    closeList();
    closeTable();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\s+$/, "");
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      closeAll();
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buffer.push(lines[i]);
        i += 1;
      }
      blocks.push({ kind: "code", text: buffer.join("\n") });
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      closeList();
      if (isSeparatorRow(trimmed)) continue;
      const cells = parseRow(trimmed);
      if (!table) table = { head: cells, rows: [] };
      else table.rows.push(cells);
      continue;
    }
    closeTable();

    if (!trimmed) {
      closeList();
      continue;
    }
    if (trimmed === "---") {
      closeList();
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      closeList();
      const level = heading[1].length;
      blocks.push({
        kind: "heading",
        level: level <= 3 ? 3 : 4,
        inline: parseInline(heading[2].trim()),
      });
      continue;
    }

    // 引用の中に台詞やメモが入ることがある（テンプレートの > 【あなた】… ）ので先に外す
    const body = trimmed.replace(/^>\s?/, "");
    const quoted = body !== trimmed;

    if (body.startsWith("【あなた】")) {
      closeList();
      blocks.push({ kind: "say", speaker: "you", inline: parseInline(body.slice(5)) });
      continue;
    }
    if (body.startsWith("【面接官】")) {
      closeList();
      blocks.push({ kind: "say", speaker: "interviewer", inline: parseInline(body.slice(5)) });
      continue;
    }
    if (body.startsWith("▷")) {
      closeList();
      blocks.push({ kind: "note", tone: "zh", inline: parseInline(body.slice(1).trim()) });
      continue;
    }
    if (body.startsWith("▶")) {
      closeList();
      blocks.push({ kind: "note", tone: "follow", inline: parseInline(body.slice(1).trim()) });
      continue;
    }
    if (quoted) {
      closeList();
      blocks.push({ kind: "note", tone: "tip", inline: parseInline(body) });
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (list?.ordered) closeList();
      list = list ?? { ordered: false, items: [] };
      list.items.push(parseInline(trimmed.replace(/^[-*]\s+/, "")));
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      if (list && !list.ordered) closeList();
      const match = trimmed.match(/^(\d+)\.\s+/);
      list = list ?? { ordered: true, start: Number(match?.[1] ?? 1), items: [] };
      list.items.push(parseInline(trimmed.replace(/^\d+\.\s+/, "")));
      continue;
    }
    closeList();
    blocks.push({ kind: "paragraph", inline: parseInline(trimmed) });
  }
  closeAll();
  return blocks;
}

function linksInInline(nodes: PrepInline[]) {
  const links: { label: string; href: string }[] = [];
  for (const node of nodes) {
    if (node.kind === "link") {
      links.push({ label: prepInlineText(node.children), href: node.href });
    } else if (node.kind === "strong") {
      links.push(...linksInInline(node.children));
    }
  }
  return links;
}

/**
 * §11 のリンク集だけをトップ画面用に取り出す。
 * 本文中の Teams URL や補助リンクまで混ぜると「外部調査資料」の意味が薄れるため、
 * skill が正本としている会社研究リンク集を唯一の抽出元にする。
 */
export function collectPrepExternalLinks(sections: PrepSection[]): PrepExternalLink[] {
  const source = sections.find((section) => section.title.includes("会社研究リンク集"));
  if (!source) return [];

  const links: PrepExternalLink[] = [];
  const seen = new Set<string>();
  let group = "その他";
  for (const block of source.blocks) {
    if (block.kind === "heading") {
      group = prepInlineText(block.inline).replace(/^[①-⑳0-9０-９.\s]+/, "").trim() || "その他";
      continue;
    }
    const inlineGroups =
      block.kind === "table"
        ? [...block.head, ...block.rows.flat()]
        : block.kind === "list"
          ? block.items
          : block.kind === "code"
            ? []
            : [block.inline];
    for (const inline of inlineGroups) {
      // リストは複数項目が1ブロックになるため、★はブロック単位ではなくリンクのある行単位で判定する。
      const inlineText = prepInlineText(inline);
      const starred = inlineText.includes("⭐") || inlineText.includes("★");
      for (const link of linksInInline(inline)) {
        if (!/^https?:\/\//.test(link.href) || seen.has(link.href)) continue;
        seen.add(link.href);
        links.push({ ...link, group, starred });
      }
    }
  }
  return links;
}

export function parseInterviewPrepDoc(note: Note, notes: Note[]): InterviewPrepDoc | null {
  if (getType(note) !== INTERVIEW_PREP_TYPE) return null;

  const byName = new Map<string, Note>();
  for (const candidate of notes) {
    const name = noteBasename(candidate.path);
    if (!byName.has(name)) byName.set(name, candidate);
  }

  const raw = stripFrontmatter(note.content)
    // 作業メモ（HTML コメント）は成果物に出さない。展開より先に落とす——
    // 後回しにするとコメント内に書いた ![[…]] の例まで本文に取り込まれる
    .replace(/<!--[\s\S]*?-->/g, "");
  const embeds: PrepEmbed[] = [];
  const expanded = expandEmbeds(raw, byName, embeds);

  const title = expanded.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? noteBasename(note.path);
  const sections: PrepSection[] = [];
  const matches = [...expanded.matchAll(/^##\s+(.+)$/gm)];
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? expanded.length;
    const heading = match[1].trim();
    sections.push({
      id: `prep-sec-${index}`,
      title: heading,
      navLabel: navLabel(heading),
      blocks: parseBlocks(expanded.slice(start, end)),
    });
  });

  return {
    note,
    title,
    company: getString(note.frontmatter.company),
    date: getString(note.frontmatter.date),
    round: getString(note.frontmatter.round),
    format: getString(note.frontmatter.format),
    interviewers: getString(note.frontmatter.interviewers),
    caseLink: getString(note.frontmatter.case).replace(/\[\[|\]\]/g, ""),
    sections,
    embeds,
    externalLinks: collectPrepExternalLinks(sections),
  };
}

export const PREP_LIBRARY_NOTE = "面接標準回答集";

/**
 * `[[面接標準回答集#p27 …]]` のような参照から カードID を取り出す。
 * これが取れる参照だけは Web 内で回答库のカードへ飛ばせる（それ以外は Obsidian を開く）。
 */
export function cardIdFromRef(ref: { target: string; section: string }) {
  if (ref.target !== PREP_LIBRARY_NOTE) return null;
  return ref.section.match(/^(p\d+)\b/)?.[1] ?? null;
}

/** 準備ドキュメントを日付の新しい順に並べる。日付が無いものは後ろへ。 */
export function findInterviewPrepDocs(notes: Note[]): InterviewPrepDoc[] {
  return notes
    .map((note) => parseInterviewPrepDoc(note, notes))
    .filter((doc): doc is InterviewPrepDoc => Boolean(doc))
    .sort((left, right) => (right.date || "").localeCompare(left.date || ""));
}

/** 面接当日を「まだ来ていない」と判定する境界。today は YYYY-MM-DD。 */
export function splitPrepDocsByDate(docs: InterviewPrepDoc[], today: string) {
  const upcoming = docs.filter((doc) => doc.date && doc.date >= today);
  const past = docs.filter((doc) => !doc.date || doc.date < today);
  return { upcoming: [...upcoming].reverse(), past };
}
