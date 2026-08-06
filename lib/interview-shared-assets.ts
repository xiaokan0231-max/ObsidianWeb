import {
  parseBlocks,
  prepBlockText,
  shortLabel,
  type InterviewPrepDoc,
  type PrepBlock,
} from "./interview-prep-doc.ts";
import { sliceSection } from "./interview-prep-embed.mjs";
import { findCompanyMotivationHeading } from "./interview-prep-validation.mjs";
import { noteBasename, stripFrontmatter, type Note } from "./notes.ts";

export type SharedAssetTarget = {
  note: string;
  label: string;
  hint: string;
  section?: string;
  defaultSection?: string;
  /**
   * 値を持つのは「その回だけの素材」だけ。共通素材は undefined のまま。
   * 表示側で条件を書き下さず、必ず isRoundSpecificAsset() を通すこと。
   */
  scope?: "round";
};

/**
 * 「本轮专属」か「共通素材」かの唯一の判定。
 * 以前は overlay の顶栏とヘッダーが別々に条件を持っていたため、
 * scope の呼び名を company → round に変えた時に顶栏だけ取り残され、
 * 同じ画面に「COMMON INTERVIEW ASSET」と「THIS ROUND」が同時に出ていた。
 */
export function isRoundSpecificAsset(target: SharedAssetTarget) {
  return target.scope === "round";
}

export type SharedAssetSection = {
  id: string;
  title: string;
  navLabel: string;
  blocks: PrepBlock[];
  plainText: string;
};

export type SharedAssetDocument = {
  note: Note;
  title: string;
  sourceTitle: string;
  restrictedToSection: boolean;
  intro: PrepBlock[];
  sections: SharedAssetSection[];
};

type MarkdownSection = {
  title: string;
  body: string;
};

/**
 * 現在選択中の面接準備から、その会社専用の志望動機だけを全画面で開く入口を作る。
 * note は basename ではなく path を持たせ、同じ日に複数社の面接があっても取り違えない。
 */
export function companyMotivationAssetTarget(
  doc: InterviewPrepDoc,
): SharedAssetTarget | null {
  const section = findCompanyMotivationHeading(doc.note.content);
  if (!section) return null;
  return {
    note: doc.note.path,
    label: "志望動機",
    hint: `${doc.company || doc.title}本轮专属・默认打开20秒版`,
    section,
    scope: "round",
  };
}

function withoutComments(markdown: string) {
  // generated 区块は本文として読むが、制御コメント自体は UI に出さない。
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

function splitAtHeadingLevel(markdown: string, level: number) {
  const lines = markdown.split("\n");
  const marker = "#".repeat(level);
  const sections: MarkdownSection[] = [];
  const preamble: string[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading?.[1] === marker) {
      if (current) {
        sections.push({ title: current.title, body: current.lines.join("\n").trim() });
      }
      current = { title: heading[2].trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  if (current) {
    sections.push({ title: current.title, body: current.lines.join("\n").trim() });
  }
  return { preamble: preamble.join("\n").trim(), sections };
}

function readableTitle(title: string) {
  return title
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, name, alias) => alias || name)
    .replace(/^[⭐★🔴⚠️▷▶\s　]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toSection(section: MarkdownSection, index: number): SharedAssetSection {
  const blocks = parseBlocks(section.body);
  return {
    id: `shared-sec-${index}`,
    title: section.title,
    navLabel: shortLabel(readableTitle(section.title), 14) || `章节 ${index + 1}`,
    blocks,
    plainText: blocks.map(prepBlockText).join("\n"),
  };
}

/**
 * 共通資産は vault の Markdown を正本のまま使い、Web 側では見出しだけを
 * 「左の索引／右の本文」に組み替える。転職理由は指定された H2 の内側だけを
 * 切り出すため、内部用の事実や禁則が誤って画面へ出ない。
 */
export function parseSharedAssetDocument(
  note: Note,
  requestedSection?: string,
): SharedAssetDocument | null {
  const raw = withoutComments(stripFrontmatter(note.content));
  const sourceTitle = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? noteBasename(note.path);
  let title = sourceTitle;
  let scope = raw.replace(/^#\s+.*\n?/, "").trim();
  let childLevel = 2;

  if (requestedSection) {
    const sliced = sliceSection(raw, requestedSection);
    if (!sliced) return null;
    title = requestedSection;
    scope = sliced.body;
    childLevel = Math.min(6, sliced.level + 1);
  }

  let split = splitAtHeadingLevel(scope, childLevel);

  // 横断傾向のように H2 が1つだけで、その下の H3 が実質的な目次になっている
  // ノートは一段掘る。長文を「1章だけ」の巨大カードに戻さないため。
  if (!requestedSection && split.sections.length === 1) {
    const only = split.sections[0];
    const nested = splitAtHeadingLevel(only.body, Math.min(6, childLevel + 1));
    if (nested.sections.length >= 2) {
      const promoted: MarkdownSection[] = [];
      if (nested.preamble) promoted.push({ title: only.title, body: nested.preamble });
      promoted.push(...nested.sections);
      split = { preamble: split.preamble, sections: promoted };
    }
  }

  const markdownSections =
    split.sections.length > 0
      ? split.sections
      : [{ title, body: scope }];

  return {
    note,
    title,
    sourceTitle,
    restrictedToSection: Boolean(requestedSection),
    intro: parseBlocks(split.preamble),
    sections: markdownSections.map(toSection),
  };
}
