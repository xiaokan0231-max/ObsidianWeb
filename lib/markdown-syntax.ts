/*
 * 块级 Markdown 的判定（callout、列表、脚注、代码围栏）。和行内切分一样只产出数据，
 * 让 app/markdown-document.tsx 与 lib/reading-document.ts 的目录扫描共用同一套判定。
 */
import { stripFrontmatter } from "./notes.ts";
import { inlinePlainText } from "./markdown-inline.ts";

export type CalloutTone = "danger" | "warn" | "key" | "data" | "aim" | "idea" | "info";

/**
 * Obsidian 原生 callout 的类型 → 现有的 data-callout 色调。
 * 现有色调原本由引用开头的 emoji 决定（🔴＝禁止、⚠️＝注意…），这里只是给 [!type] 写法一个入口，
 * 不另起一套颜色；Obsidian 里本来同色的别名（caution/attention、error/bug…）归到同一档。
 */
const CALLOUT_KINDS: Record<string, { tone: CalloutTone | null; zh: string; ja: string }> = {
  note: { tone: "info", zh: "备注", ja: "メモ" },
  info: { tone: "info", zh: "信息", ja: "情報" },
  todo: { tone: "info", zh: "待办", ja: "TODO" },
  abstract: { tone: "info", zh: "摘要", ja: "要約" },
  summary: { tone: "info", zh: "摘要", ja: "要約" },
  tldr: { tone: "info", zh: "摘要", ja: "要約" },
  tip: { tone: "key", zh: "提示", ja: "ヒント" },
  hint: { tone: "key", zh: "提示", ja: "ヒント" },
  important: { tone: "key", zh: "重要", ja: "重要" },
  success: { tone: "aim", zh: "成功", ja: "成功" },
  check: { tone: "aim", zh: "已确认", ja: "確認済み" },
  done: { tone: "aim", zh: "完成", ja: "完了" },
  question: { tone: "warn", zh: "疑问", ja: "質問" },
  help: { tone: "warn", zh: "疑问", ja: "質問" },
  faq: { tone: "warn", zh: "常见问题", ja: "よくある質問" },
  warning: { tone: "warn", zh: "注意", ja: "注意" },
  caution: { tone: "warn", zh: "注意", ja: "注意" },
  attention: { tone: "warn", zh: "注意", ja: "注意" },
  failure: { tone: "danger", zh: "失败", ja: "失敗" },
  fail: { tone: "danger", zh: "失败", ja: "失敗" },
  missing: { tone: "danger", zh: "缺失", ja: "欠落" },
  danger: { tone: "danger", zh: "危险", ja: "危険" },
  error: { tone: "danger", zh: "错误", ja: "エラー" },
  bug: { tone: "danger", zh: "缺陷", ja: "不具合" },
  example: { tone: "data", zh: "示例", ja: "例" },
  quote: { tone: null, zh: "引用", ja: "引用" },
  cite: { tone: null, zh: "引用", ja: "引用" },
};

export type CalloutHead = {
  kind: string;
  tone: CalloutTone | null;
  title: string;
  titleZh: string;
  titleJa: string;
  /** 只有写了 `-`（默认收起）或 `+`（默认展开）才可折叠；没写时不带这个键。 */
  fold?: "open" | "closed";
};

/** `[!note] 标题` → 类型与标题。不认识的类型按 Obsidian 的做法当 note。 */
export function calloutHead(firstLine: string): CalloutHead | null {
  const match = firstLine.trim().match(/^\[!([\w-]+)\]([+-]?)\s*(.*)$/);
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const meta = CALLOUT_KINDS[kind] ?? CALLOUT_KINDS.note;
  const head: CalloutHead = { kind, tone: meta.tone, title: match[3].trim(), titleZh: meta.zh, titleJa: meta.ja };
  // 不可折叠的保持原样（不加 fold: undefined），渲染端据此决定是 blockquote 还是 details。
  if (match[2]) head.fold = match[2] === "+" ? "open" : "closed";
  return head;
}

export type ListItem = { depth: number; ordered: boolean; marker: string; task: "open" | "done" | null; text: string };

export function parseListItem(line: string): ListItem | null {
  const match = line.match(/^(\s*)([-*+] |\d+[.)] )\s*(.+)/);
  if (!match) return null;
  // 两个空格算一级、Tab 算两级；上限 6 级，再深在正文宽度里也读不出层次。
  const depth = Math.min(Math.floor(match[1].replace(/\t/g, "    ").length / 2), 6);
  const ordered = /^\d/.test(match[2]);
  // 只写了框没写字的 `- [ ]` 也是任务项（随手占位的待办），不能把 [ ] 原样当正文。
  const task = !ordered ? match[3].match(/^\[([ xX])\](?:\s+(.*))?$/) : null;
  return {
    depth,
    ordered,
    marker: match[2].trim(),
    task: task ? (task[1] === " " ? "open" : "done") : null,
    text: task ? task[2] ?? "" : match[3],
  };
}

/** 围栏后的信息串只取第一个词当语言名（```ts title="x" → ts）。 */
export function fenceLanguage(line: string) {
  return line.trimStart().replace(/^(`{3,}|~{3,})/, "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:\s?(.*)$/;
const FOOTNOTE_REFERENCE = /\[\^([^\]\s]+)\](?!:)/g;

export type Footnotes = {
  /** 脚注 id → 定义所在行与正文（续行已并入）。 */
  definitions: Map<string, { line: number; text: string }>;
  /** 按正文中第一次引用的先后编号；只定义没引用的排在最后。 */
  numbers: Map<string, number>;
  /** 定义行与续行：正文渲染时跳过，统一收到文末。 */
  skip: Set<number>;
};

/**
 * 脚注要先整篇扫一遍：引用可能出现在定义之前，编号也要按引用顺序定。
 * 围栏代码里的 `[^1]` 是示例，不算；行内代码同理。
 */
export function collectFootnotes(lines: string[]): Footnotes {
  const definitions: Footnotes["definitions"] = new Map();
  const skip = new Set<number>();
  const referenced: string[] = [];
  let fence = "";
  let current: string | null = null;
  lines.forEach((line, index) => {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? "" : marker;
      current = null;
      return;
    }
    if (fence) return;
    const definition = line.match(FOOTNOTE_DEFINITION);
    if (definition && !definitions.has(definition[1])) {
      current = definition[1];
      definitions.set(current, { line: index, text: definition[2] });
      skip.add(index);
      return;
    }
    // 缩进的下一行是同一条脚注的续行（Obsidian 与 CommonMark 扩展的写法）。
    if (current && /^(\s{2,}|\t)\S/.test(line)) {
      const entry = definitions.get(current)!;
      entry.text = `${entry.text}\n${line.trim()}`;
      skip.add(index);
      return;
    }
    current = null;
    for (const match of line.replace(/`[^`]+`/g, "").matchAll(FOOTNOTE_REFERENCE)) {
      if (!referenced.includes(match[1])) referenced.push(match[1]);
    }
  });
  const numbers = new Map<string, number>();
  [...referenced.filter((id) => definitions.has(id)), ...[...definitions.keys()].filter((id) => !referenced.includes(id))]
    .forEach((id, order) => numbers.set(id, order + 1));
  return { definitions, numbers, skip };
}

/** 悬浮预览卡的正文摘录：去掉 frontmatter、注释、标题行与 Markdown 记号，只留读得懂的字。 */
export function wikiPreviewExcerpt(content: string, max = 120) {
  const body = stripFrontmatter(content)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^(`{3,}|~{3,})[\s\S]*?^\1\s*$/gm, " ")
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line) && !/^\s*\|?\s*:?-{3,}/.test(line) && !FOOTNOTE_DEFINITION.test(line))
    .map((line) => inlinePlainText(line.replace(/^\s*(>\s?)*(\[![\w-]+\][+-]?\s*)?/, "").replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "")))
    .join(" ")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return body.length > max ? `${body.slice(0, max - 1)}…` : body;
}
