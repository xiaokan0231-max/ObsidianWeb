import { getString, getType, noteBasename, stripFrontmatter, type Note } from "./notes.ts";
import {
  EMBED_RE,
  HEADING_RE,
  shiftHeadings,
  sliceSection,
} from "./interview-prep-embed.mjs";

// 面接1回分の準備ドキュメント（type: interview-prep）を Web で読める構造に落とす。
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

/** 展開元の共通資産（準備稿の本文に直接書かれた ![[…]]）。入れ子の埋め込みは最外の資産に帰属させる。 */
export type PrepEmbedOrigin = { target: string; section: string };

type PrepBlockBody =
  // level は表示用（3=青見出し・4=紫見出し）、depth は Markdown の実際の階層。
  // 両方要る：#### と ##### は同じ紫で描くが、範囲を切るには区別が要る。
  | { kind: "heading"; level: 3 | 4; depth: number; inline: PrepInline[] }
  | { kind: "say"; speaker: "you" | "interviewer"; inline: PrepInline[] }
  | { kind: "note"; tone: PrepNoteTone; inline: PrepInline[] }
  | { kind: "paragraph"; inline: PrepInline[] }
  | { kind: "list"; ordered: boolean; start?: number; items: PrepInline[][] }
  | { kind: "table"; head: PrepInline[][]; rows: PrepInline[][][] }
  | { kind: "code"; text: string };

// embed＝このブロックが共通資産の展開由来である印。コンテナ型にせず平らなまま印だけ付けるのは、
// 節の切り出し（殺傷7題の答案参照・小節スライス）や検索が埋め込みの有無を知らずに済むようにするため。
// 畳んで見せるかどうかは表示層だけの判断で、データ層の消費者は embed を無視してよい。
export type PrepBlock = PrepBlockBody & { embed?: PrepEmbedOrigin };

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
  const groups: PrepSectionGroup[] = PREP_SECTION_GROUPS.map((spec) => {
    const sectionIndexes = numbered
      .filter((item) => spec.numbers.some((number) => number === item.number))
      .map((item) => item.index);
    sectionIndexes.forEach((index) => assigned.add(index));
    return { id: spec.id, label: spec.label, sectionIndexes };
  }).filter((group) => group.sectionIndexes.length > 0);

  const remaining = sections.map((_, index) => index).filter((index) => !assigned.has(index));
  // どの番号にも当たらない節は必ず「其他」が拾う＝節が1つでもあれば群も1つ以上できる。
  // なので「群が空なら節をそのまま1節1群で並べる」という代替経路は要らない
  // （sections が空の時しか到達せず、その時は代替経路の結果も空で同じ）。
  if (remaining.length > 0) groups.push({ id: "other", label: "其他", sectionIndexes: remaining });
  return groups;
}

const PREP_KILL_MAP_HEADING = "殺傷質問7題";
export const PREP_KILL_MAP_LABEL = "杀伤7题";
const PREP_TALENT_HEADING = "人材育成";
export const PREP_TALENT_LABEL = "人才育成";

/**
 * §6 の小節を、独立した主模块用の仮想節として切り出す共通処理。
 *
 * 正本はあくまで §6 の中の一小節（vault は12節契約のまま・13個目の ## は作らない）。
 * ただ当日その一枚だけを開きたい需要があるので、Web の表示層だけで独立モジュールに
 * 昇格させる。小節が無い回（他社の準備稿）では null ＝チップ自体が出ない。
 */
function extractPrepSubModule(
  sections: PrepSection[],
  headingPrefix: string,
  id: string,
  label: string,
): PrepSection | null {
  const parent = sections.find((section) => prepSectionNumber(section.title) === 6);
  if (!parent) return null;
  const start = parent.blocks.findIndex(
    (block) =>
      block.kind === "heading" &&
      block.level === 3 &&
      prepInlineText(block.inline).startsWith(headingPrefix),
  );
  if (start < 0) return null;
  const end = parent.blocks.findIndex(
    (block, index) => index > start && block.kind === "heading" && block.level === 3,
  );
  const heading = parent.blocks[start];
  return {
    id,
    title: heading.kind === "heading" ? prepInlineText(heading.inline) : headingPrefix,
    navLabel: label,
    blocks: parent.blocks.slice(start + 1, end < 0 ? undefined : end),
  };
}

/** §6 の小節「殺傷質問7題・当日の型」→ 第7主模块。 */
export function extractPrepKillMap(sections: PrepSection[]): PrepSection | null {
  return extractPrepSubModule(sections, PREP_KILL_MAP_HEADING, "prep-sec-kill7", PREP_KILL_MAP_LABEL);
}

/** §6 の小節「人材育成」→ 第8主模块。責任者面接の中心題なので当日ワンタップで開く。 */
export function extractPrepTalentMap(sections: PrepSection[]): PrepSection | null {
  return extractPrepSubModule(sections, PREP_TALENT_HEADING, "prep-sec-talent", PREP_TALENT_LABEL);
}

export type PrepKillQuestion = {
  id: string;
  /** 面接官が実際に投げてくる形の問い。 */
  ask: string;
  /** 出題頻度・題型（T1〜T7）などの短いメタ。 */
  meta: string;
  /** 主答案。`答案::` が指す先から取り込む（コピーではなく参照）。 */
  answer: PrepBlock[];
  /** 追問層。見つからなければ空。 */
  followUp: PrepBlock[];
  /** 中文の解読（▷ 行）。なぜその答え方なのか。 */
  why: PrepInline[][];
  /** 踏んではいけない一行。 */
  mine: PrepInline[] | null;
  /** 答案の在り処（解決できなかった時に「どこを見ればいいか」を出す）。 */
  source: string;
  resolved: boolean;
};

const KILL_FIELD_RE = /^(問|答案|追問|地雷|出題)::\s*(.*)$/;

function headingDepth(block: PrepBlock) {
  return block.kind === "heading" ? block.depth : 0;
}

/**
 * 「次の答案の見出し代わり」になる太字リード行か。
 * 台詞（【あなた】…）は本文なので除く——台詞は太字で始まることが多く、
 * これを境界に含めると答案が見出しだけになって当日読むものが消える。
 */
function isLeadLine(block: PrepBlock) {
  if (block.kind !== "note" && block.kind !== "paragraph") return false;
  return block.inline[0]?.kind === "strong";
}

/**
 * ロケータ（見出しか太字リードの先頭一致）から、その答案ブロック群を切り出す。
 *
 * 見出しなら「同階層以上の見出しが来るまで」、太字リードなら「次の見出しか
 * 次の太字リードまで」。答案の正本は各所に一つだけ置き、ここは参照で組み立てる——
 * コピーすると口径が二重管理になり、必ず片方だけ直されて食い違う。
 */
function sliceByLocator(sections: PrepSection[], locator: string): PrepBlock[] {
  // 見出しの頭に付く 🔴 ⭐ などの装飾は、ロケータ側に書かせない（書き分けが事故のもと）
  const strip = (text: string) => text.replace(/^[🔴🟠⭐★●■◆▼\s　]+/, "").trim();
  const needle = strip(locator);
  if (!needle) return [];
  for (const section of sections) {
    const start = section.blocks.findIndex((block) =>
      strip(
        prepInlineText(
          block.kind === "heading" || block.kind === "say" || block.kind === "note" || block.kind === "paragraph"
            ? block.inline
            : [],
        ),
      ).startsWith(needle),
    );
    if (start < 0) continue;
    const head = section.blocks[start];
    const depth = headingDepth(head);
    const end = section.blocks.findIndex((block, index) => {
      if (index <= start) return false;
      if (depth > 0) return block.kind === "heading" && block.depth <= depth;
      return block.kind === "heading" || isLeadLine(block);
    });
    // 先頭のリード行（見出し・太字リード）は落とす。カードの見出しが既に問いを出しており、
    // ここで繰り返すと「読み上げる文」がどれか一目で分からなくなる。
    return section.blocks.slice(start + 1, end < 0 ? undefined : end);
  }
  return [];
}

/** 見出しつきの答案は「追問されたら」以降を追問層として分ける。 */
function splitFollowUp(blocks: PrepBlock[]) {
  const at = blocks.findIndex(
    (block) =>
      block.kind === "heading" &&
      /^(追問|さらに|「)/.test(prepInlineText(block.inline).trim()),
  );
  if (at < 0) return { answer: blocks, followUp: [] as PrepBlock[] };
  return { answer: blocks.slice(0, at), followUp: blocks.slice(at) };
}

/**
 * 「殺傷質問7題」を、問い・答案・解読が1画面に揃ったカード列として組み立てる。
 * 索引だけでは当日使えない（7回ジャンプすることになる）ので、答案を参照で引き込む。
 */
export function buildPrepKillQuestions(sections: PrepSection[]): PrepKillQuestion[] {
  const map = extractPrepKillMap(sections);
  if (!map) return [];
  const questions: PrepKillQuestion[] = [];
  let current: (Partial<PrepKillQuestion> & { why: PrepInline[][]; fields: Map<string, string> }) | null = null;

  const flush = () => {
    if (!current?.ask) return;
    const fields = current.fields;
    const answerBlocks = sliceByLocator(sections, fields.get("答案") ?? "");
    const split = splitFollowUp(answerBlocks);
    const extra = (fields.get("追問") ?? "")
      .split("｜")
      .map((item) => item.trim())
      .filter(Boolean)
      .flatMap((item) => sliceByLocator(sections, item));
    questions.push({
      id: `kill-${questions.length + 1}`,
      ask: current.ask,
      meta: fields.get("出題") ?? "",
      answer: split.answer,
      followUp: [...split.followUp, ...extra],
      why: current.why,
      mine: fields.has("地雷") ? parseInline(fields.get("地雷") ?? "") : null,
      source: fields.get("答案") ?? "",
      resolved: answerBlocks.length > 0,
    });
    current = null;
  };

  for (const block of map.blocks) {
    if (block.kind === "heading" && block.depth === 4) {
      flush();
      current = { ask: prepInlineText(block.inline).trim(), why: [], fields: new Map() };
      continue;
    }
    if (!current) continue;
    if (block.kind === "list") {
      for (const item of block.items) {
        const matched = prepInlineText(item).match(KILL_FIELD_RE);
        if (matched) current.fields.set(matched[1], matched[2].trim());
      }
      continue;
    }
    if (block.kind === "note" && block.tone === "zh") current.why.push(block.inline);
  }
  flush();
  return questions;
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
  sessionOrder: number | null;
  sessionStatus: InterviewPrepSessionStatus | "";
  format: string;
  interviewers: string;
  caseLink: string;
  sections: PrepSection[];
  embeds: PrepEmbed[];
  externalLinks: PrepExternalLink[];
};

const INTERVIEW_PREP_TYPE = "interview-prep";
export type InterviewPrepSessionStatus =
  | "preparing"
  | "scheduled"
  | "completed"
  | "cancelled";

/**
 * `[[案件#節|表示名]]` から関連付けに使うノート名だけを取る。
 * 表示名を含んだままでは、同じ case を指す各回が別シリーズに分裂してしまう。
 */
export function prepWikiTarget(value: string) {
  const raw = value.trim().replace(/^["']|["']$/g, "");
  const inner = raw.match(/^\[\[([^\]]+)\]\]$/)?.[1] ?? raw;
  return inner.split("|")[0].split("#")[0].trim();
}

// 汉字/拉丁字母 + 「纯假名括号」→ ruby。括号内に仮名以外が混ざる場合は注音ではなく
// 普通の補足（例「（約70%）」「（Azure）」）なので変換しない。build_interview_html.py と同じ判定。
// 数字の発声（6.5万tps／約300%）も面接では重要な注音。小数点と percent 記号を
// 親字に含めないと「約300%（やくさんびゃく…）」だけ括弧のままコピーされてしまう。
const RUBY_SOURCE = "([一-龥々ヶ〆A-Za-z0-9.%％]+)（([ぁ-んァ-ヶーゝゞ・]+)）";
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

// 展開した共通資産の範囲を parseBlocks へ運ぶ行印。NUL(U+0000) は Markdown 本文に現れ得ないので
// 「本文にたまたま同じ文字列があった」事故が起きない。展開＝文字列結合の設計を保ったまま、
// どの行が資産由来かだけを後段へ伝える。
const EMBED_MARK = "\u0000";
const EMBED_OPEN = `${EMBED_MARK}embed${EMBED_MARK}`;
const EMBED_CLOSE = `${EMBED_MARK}/embed`;

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
    const inner = expandEmbeds(body, byName, embeds, depth + 1, new Set([...seen, key]));
    // 印は準備稿の本文に直接書かれた埋め込み（depth 0）にだけ付ける。資産の中の埋め込みまで
    // 個別に印を付けると「資産の一部だけ別の畳みになる」表示になり、正本の一体性が壊れる。
    if (depth === 0) {
      out.push(`${EMBED_OPEN}${target}${EMBED_MARK}${section}`, inner, EMBED_CLOSE);
    } else {
      out.push(inner);
    }
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

export function parseBlocks(markdown: string): PrepBlock[] {
  const blocks: PrepBlock[] = [];
  const lines = markdown.split("\n");
  let list: { ordered: boolean; start?: number; items: PrepInline[][] } | null = null;
  let table: { head: PrepInline[][]; rows: PrepInline[][][] } | null = null;
  // expandEmbeds が付けた行印の内側にいる間だけ値を持つ。リスト・表は行印で必ず閉じるので、
  // 「閉じた時の origin」と「開いた時の origin」が食い違うことはない。
  let origin: PrepEmbedOrigin | null = null;
  const push = (block: PrepBlock) => {
    blocks.push(origin ? { ...block, embed: origin } : block);
  };

  const closeList = () => {
    if (list) push({
      kind: "list",
      ordered: list.ordered,
      ...(list.start ? { start: list.start } : {}),
      items: list.items,
    });
    list = null;
  };
  const closeTable = () => {
    if (table) push({ kind: "table", head: table.head, rows: table.rows });
    table = null;
  };
  const closeAll = () => {
    closeList();
    closeTable();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\s+$/, "");
    const trimmed = line.trim();

    if (line.startsWith(EMBED_MARK)) {
      closeAll();
      if (line.startsWith(EMBED_OPEN)) {
        const [target, section = ""] = line.slice(EMBED_OPEN.length).split(EMBED_MARK);
        origin = { target, section };
      } else {
        origin = null;
      }
      continue;
    }

    if (trimmed.startsWith("```")) {
      closeAll();
      const buffer: string[] = [];
      i += 1;
      // 行印はフェンスの中でも必ず境界として扱う。閉じ忘れのフェンスが行印を飲み込むと
      // origin が復位せず、以降の本文が丸ごと「資産由来」扱いになってしまう。
      while (i < lines.length && !lines[i].trim().startsWith("```") && !lines[i].startsWith(EMBED_MARK)) {
        buffer.push(lines[i]);
        i += 1;
      }
      if (lines[i]?.startsWith(EMBED_MARK)) i -= 1;
      push({ kind: "code", text: buffer.join("\n") });
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
      push({
        kind: "heading",
        level: level <= 3 ? 3 : 4,
        depth: level,
        inline: parseInline(heading[2].trim()),
      });
      continue;
    }

    // 引用の中に台詞やメモが入ることがある（テンプレートの > 【あなた】… ）ので先に外す
    const body = trimmed.replace(/^>\s?/, "");
    const quoted = body !== trimmed;

    if (body.startsWith("【あなた】")) {
      closeList();
      push({ kind: "say", speaker: "you", inline: parseInline(body.slice(5)) });
      continue;
    }
    if (body.startsWith("【面接官】")) {
      closeList();
      push({ kind: "say", speaker: "interviewer", inline: parseInline(body.slice(5)) });
      continue;
    }
    if (body.startsWith("▷")) {
      closeList();
      push({ kind: "note", tone: "zh", inline: parseInline(body.slice(1).trim()) });
      continue;
    }
    if (body.startsWith("▶")) {
      closeList();
      push({ kind: "note", tone: "follow", inline: parseInline(body.slice(1).trim()) });
      continue;
    }
    if (quoted) {
      closeList();
      push({ kind: "note", tone: "tip", inline: parseInline(body) });
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
    push({ kind: "paragraph", inline: parseInline(trimmed) });
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
    sessionOrder: (() => {
      const source = note.frontmatter.session_order ?? note.frontmatter.round_order;
      const value = Number(source);
      return source !== undefined && Number.isFinite(value) ? value : null;
    })(),
    sessionStatus: (() => {
      const value = getString(
        note.frontmatter.session_status ?? note.frontmatter.schedule_status,
      );
      if (value === "pending") return "preparing";
      return value === "preparing" ||
        value === "scheduled" ||
        value === "completed" ||
        value === "cancelled"
        ? value
        : "";
    })(),
    format: getString(note.frontmatter.format),
    interviewers: getString(note.frontmatter.interviewers),
    caseLink: prepWikiTarget(getString(note.frontmatter.case)),
    sections,
    embeds,
    externalLinks: collectPrepExternalLinks(sections),
  };
}

const PREP_LIBRARY_NOTE = "面接標準回答集";

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
