"use client";

import { memo, useMemo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { headingAnchor, readingDocumentLines } from "@/lib/reading-document";
import { normalizeHeading } from "@/lib/memory-atlas-data";
import { isAllowedHref, isAttachmentTarget, tokenizeInline, type InlineToken } from "@/lib/markdown-inline";
import { calloutHead, collectFootnotes, fenceLanguage, parseListItem, type Footnotes } from "@/lib/markdown-syntax";
import { highlightCode } from "@/lib/markdown-code";
import type { Note } from "@/lib/notes";
import type { UiLocale } from "@/lib/ui-locale";
import { useCopyFlash } from "./copy-flash";
import { useUiLocale } from "./ui-locale";
import { WikiPreviewLink, wikiMissingTitle } from "./wiki-preview";

/** 見出しに付ける id。行番号ベースなので、目次側と本文側で必ず一致する。 */
export { headingAnchor } from "@/lib/reading-document";

type InternalLinkResolver = (href: string) => { href: string; onNavigate: () => void } | null;
type WikiResolver = (target: string, section?: string) => Note | null;

const MARKDOWN_COPY: Record<UiLocale, {
  copy: string;
  copied: string;
  copyLabel: (language: string) => string;
  plain: string;
  image: string;
  footnotes: string;
  footnote: (number: number) => string;
  back: string;
  task: { open: string; done: string };
}> = {
  "zh-CN": {
    copy: "复制",
    copied: "已复制",
    copyLabel: (language) => `复制${language}代码`,
    plain: "文本",
    image: "图片",
    footnotes: "脚注",
    footnote: (number) => `脚注 ${number}`,
    back: "返回正文",
    task: { open: "未完成", done: "已完成" },
  },
  ja: {
    copy: "コピー",
    copied: "コピーしました",
    copyLabel: (language) => `${language}のコードをコピー`,
    plain: "テキスト",
    image: "画像",
    footnotes: "脚注",
    footnote: (number) => `脚注 ${number}`,
    back: "本文に戻る",
    task: { open: "未完了", done: "完了" },
  },
};

/*
 * 界面语言相关的文字都放进小组件里取：MarkdownDocument 本体保持无 hook，
 * 测试会把它当普通函数直接调用来检查链接的点击行为，本体一用 hook 就会在那里崩。
 */
function useMarkdownCopy() {
  return MARKDOWN_COPY[useUiLocale().locale];
}

type InlineContext = {
  onWikiLink: (target: string, section?: string) => void;
  resolveInternalLink?: InternalLinkResolver;
  resolveWiki?: WikiResolver;
  footnotes: Footnotes;
  /** 已经输出过的脚注引用：同一脚注被引用多次时，只有第一处是回跳的落点。 */
  referenced: Set<string>;
};

/**
 * 脚注与回跳不改地址栏 hash：外壳用 URL 记录视图状态，hash 跳转会触发 popstate，
 * 把「看个脚注」变成一次导航。目标只在同一篇文档里找——抽屉在阅读层下面仍挂着同一篇，
 * 用全局 id 会跳到被盖住的那份。滚过去后把焦点交给目标，键盘读者可以接着读。
 */
function jumpTo(selector: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    const target = event.currentTarget.closest(".markdown-document")?.querySelector<HTMLElement>(selector);
    if (!target) return;
    event.preventDefault();
    // JS 里显式写 smooth 会绕过 CSS 的减弱动效兜底，所以这里自己问一次。
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  };
}

const footnoteSelector = (id: string) => `[data-footnote="${CSS.escape(id)}"]`;
const footnoteRefSelector = (id: string) => `[data-footnote-ref="${CSS.escape(id)}"]`;

function FootnoteRef({ id, number, anchor }: { id: string; number: number; anchor: boolean }) {
  const copy = useMarkdownCopy();
  return (
    <sup className="md-footnote-ref" data-footnote-ref={anchor ? id : undefined} tabIndex={anchor ? -1 : undefined}>
      <a href={`#fn-${encodeURIComponent(id)}`} onClick={(event) => jumpTo(footnoteSelector(id))(event)} aria-label={copy.footnote(number)}>{number}</a>
    </sup>
  );
}

function FootnoteBack({ id }: { id: string }) {
  const copy = useMarkdownCopy();
  return <a className="md-footnote-back" href={`#fnref-${encodeURIComponent(id)}`}
    onClick={(event) => jumpTo(footnoteRefSelector(id))(event)} aria-label={copy.back}>↩</a>;
}

function FootnoteList({ line, children }: { line: number; children: ReactNode }) {
  const copy = useMarkdownCopy();
  return <section className="md-footnotes" data-reading-anchor={`md-${line}`} aria-label={copy.footnotes}><ol>{children}</ol></section>;
}

function MarkdownImage({ src, alt, width }: { src: string; alt: string; width?: number }) {
  const copy = useMarkdownCopy();
  // 说明为空时也给 alt：读屏要知道这里有张图，而不是把地址念出来。
  // 图片地址来自 vault 正文、域名不可预知，next/image 需要预先登记域名，这里只能用原生 img。
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="md-image" src={src} alt={alt || copy.image} width={width} loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
}

function TaskMark({ state }: { state: "open" | "done" }) {
  const copy = useMarkdownCopy();
  return <i role="img" aria-label={copy.task[state]} />;
}

function CalloutTitle({ zh, ja }: { zh: string; ja: string }) {
  return <>{useUiLocale().locale === "ja" ? ja : zh}</>;
}

function WikiMissingLink({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  const { locale } = useUiLocale();
  return <button className="wiki-link wiki-link--missing" onClick={onOpen} title={wikiMissingTitle(locale)}>{children}</button>;
}

function renderWiki(token: Extract<InlineToken, { type: "wiki" }>, ctx: InlineContext, key: string) {
  const open = () => ctx.onWikiLink(token.target, token.section);
  // [[#章节]] 指向本篇、[[x.pdf]] 指向附件，都不在笔记索引里，不该被标成「找不到」。
  if (!ctx.resolveWiki || !token.target || isAttachmentTarget(token.target)) {
    return <button className="wiki-link" key={key} onClick={open}>{token.label} ↗</button>;
  }
  const note = ctx.resolveWiki(token.target, token.section);
  if (!note) return <WikiMissingLink key={key} onOpen={open}>{token.label}</WikiMissingLink>;
  return <WikiPreviewLink key={key} note={note} onOpen={open}>{token.label} ↗</WikiPreviewLink>;
}

function renderTokens(tokens: InlineToken[], ctx: InlineContext, keyPrefix = ""): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}${index}`;
    switch (token.type) {
      case "text": return token.text;
      case "code": return <code key={key}>{token.text}</code>;
      case "wiki": return renderWiki(token, ctx, key);
      case "link": {
        const internal = ctx.resolveInternalLink?.(token.href);
        if (internal) return <a className="md-link" key={key} href={internal.href} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          internal.onNavigate();
        }}>{token.label}</a>;
        // vault 里的 [题](url) 直接变成 <a href>：只放行 http(s)・mailto・obsidian，javascript: 之类原样当文本。
        if (!isAllowedHref(token.href)) return token.raw;
        return (
          <a className="md-link" key={key} href={token.href} target="_blank" rel="noreferrer">
            {token.label}<i>↗</i>
          </a>
        );
      }
      case "image": return <MarkdownImage key={key} src={token.src} alt={token.alt} width={token.width} />;
      case "footnote": {
        const number = ctx.footnotes.numbers.get(token.id);
        if (!number) return token.raw;
        const anchor = !ctx.referenced.has(token.id);
        ctx.referenced.add(token.id);
        return <FootnoteRef key={key} id={token.id} number={number} anchor={anchor} />;
      }
      case "strong": return <strong key={key}>{renderTokens(token.children, ctx, `${key}-`)}</strong>;
      case "em": return <em key={key}>{renderTokens(token.children, ctx, `${key}-`)}</em>;
      case "del": return <del key={key}>{renderTokens(token.children, ctx, `${key}-`)}</del>;
      case "mark": return <mark className="md-mark" key={key}>{renderTokens(token.children, ctx, `${key}-`)}</mark>;
    }
  });
}

/**
 * 引用の先頭に付いた記号で色を決める。vault 側は 🔴＝禁止・⚠️＝注意・⭐＝最重要…と
 * 記号で強弱を書き分けているのに、全部同じ灰色の箱で出すとその区別が消える。
 */
const CALLOUT_TONES: [string, string][] = [
  ["🔴", "danger"], ["❌", "danger"], ["⛔", "danger"],
  ["⚠️", "warn"], ["⚠", "warn"],
  ["🔑", "key"], ["⭐", "key"],
  ["📊", "data"], ["🔍", "data"],
  ["🎯", "aim"], ["✅", "aim"],
  ["💡", "idea"],
];

function calloutTone(firstLine: string) {
  const head = firstLine.trimStart();
  // ** で始まる強調や > の入れ子を剥いでから記号を見る
  const bare = head.replace(/^(\*\*|>|\s)+/, "");
  for (const [mark, tone] of CALLOUT_TONES) {
    if (bare.startsWith(mark)) return tone;
  }
  return null;
}

/**
 * 代码块单独成组件：复制后的「已复制」只重绘这一块，不让整篇文档跟着重新逐行解析。
 * 着色在 lib/markdown-code.ts，认不出的语言原样输出。
 */
function CodeBlock({ code, language, line }: { code: string; language: string; line: number }) {
  const { copiedId, flash } = useCopyFlash();
  const tokens = useMemo(() => highlightCode(code, language), [code, language]);
  const copy = useMarkdownCopy();
  const label = language || copy.plain;
  const onCopy = () => {
    // 非安全上下文里没有 clipboard；复制失败时不报「已复制」，按钮保持原样即是提示。
    navigator.clipboard?.writeText(code).then(() => flash("code"), () => {});
  };
  return (
    <figure className="md-code" data-reading-anchor={`md-${line}`} data-language={language || undefined}>
      <div className="md-code-bar">
        <span>{label}</span>
        <button type="button" className="md-code-copy" onClick={onCopy} data-copied={copiedId ? "" : undefined}
          aria-label={copiedId ? copy.copied : copy.copyLabel(label)}>
          <span aria-live="polite">{copiedId ? copy.copied : copy.copy}</span>
        </button>
      </div>
      <pre><code>{tokens.map((token, index) => token.kind === "plain"
        ? token.text
        : <span key={index} className={`md-tok-${token.kind}`}>{token.text}</span>)}</code></pre>
    </figure>
  );
}

function MarkdownDocument({
  content,
  onWikiLink,
  reading = false,
  resolveInternalLink,
  resolveWiki,
}: {
  content: string;
  onWikiLink: (target: string, section?: string) => void;
  reading?: boolean;
  resolveInternalLink?: InternalLinkResolver;
  /**
   * 传了才检查双链：解析不到（或同名多篇返回 null）的标成虚线，解析到的悬停出预览卡。
   * 不传时链接与以前完全一样。请传稳定引用（useCallback），否则 memo 失效、每次都重排全文。
   */
  resolveWiki?: WikiResolver;
}) {
  const lines = readingDocumentLines(content);
  const footnotes = collectFootnotes(lines);
  const ctx: InlineContext = { onWikiLink, resolveInternalLink, resolveWiki, footnotes, referenced: new Set() };
  const inline = (text: string) => renderTokens(tokenizeInline(text), ctx);
  const blocks: ReactNode[] = [];
  let codeLines: string[] = [];
  let codeFence = "";
  let codeStart = 0;
  let codeLanguage = "";
  let paragraphLines: string[] = [];
  let paragraphStart = 0;
  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    blocks.push(<p key={`paragraph-${paragraphStart}`} data-reading-anchor={`md-${paragraphStart}`}>{inline(paragraphLines.join("\n"))}</p>);
    paragraphLines = [];
  };
  // 連続する > 行は1つの引用にまとめる。1行ごとに箱を作ると、
  // 数行の注意書きが分断されて読めなくなる。
  let quoteLines: string[] = [];
  let quoteStart = 0;
  // 表も同じ理由でまとめる。行ごとに独立した箱だと、
  // ヘッダ行と本体行の区別も、枠線の一体感も出せない。
  let tableLines: string[] = [];
  let tableStart = 0;
  let seenTitle = false;
  const flushQuote = () => {
    if (!quoteLines.length) return;
    const buffered = quoteLines;
    quoteLines = [];
    // Obsidian 原生 [!type] 写法：标题行单独成一行，色调按类型；没有类型时仍按开头的 emoji 判色。
    const head = calloutHead(buffered[0] ?? "");
    const tone = head ? head.tone ?? calloutTone(head.title) : calloutTone(buffered[0] ?? "");
    const body = head ? buffered.slice(1) : buffered;
    blocks.push(
      <blockquote key={`quote-${quoteStart}`} data-reading-anchor={`md-${quoteStart}`} data-callout={tone ?? undefined} data-callout-kind={head?.kind}>
        {head && <span className="md-callout-title">{head.title ? inline(head.title) : <CalloutTitle zh={head.titleZh} ja={head.titleJa} />}</span>}
        {body.map((quoted, offset) => (
          <span key={offset}>{inline(quoted)}</span>
        ))}
      </blockquote>,
    );
  };
  const flushTable = () => {
    if (!tableLines.length) return;
    const buffered = tableLines;
    tableLines = [];
    const rows = buffered.map((row) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|"));
    const columnCount = Math.max(...rows.map((row) => row.length));
    if (reading) {
      // 独立的行网格会被各行的长文本撑成不同宽度；原生表格让所有行共用列宽。
      // 空单元格仍然占位，宽表仅在容器内滚动，不拉宽整张书页。
      blocks.push(
        <div className="md-table" key={`table-${tableStart}`} data-reading-anchor={`md-${tableStart}`}
          role="region" aria-label="正文表格，可横向滚动" tabIndex={0}>
          <table className="reader-markdown-table" style={{ minWidth: `${columnCount * 8}em` }}>
            <thead>
              <tr>{Array.from({ length: columnCount }, (_, cellIndex) => (
                <th key={cellIndex} scope="col">{inline((rows[0][cellIndex] ?? "").trim())}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.slice(1).map((row, rowIndex) => (
                <tr key={rowIndex}>{Array.from({ length: columnCount }, (_, cellIndex) => (
                  <td key={cellIndex}>{inline((row[cellIndex] ?? "").trim())}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      return;
    }
    // 行结构保持 div 行 + span 格（测试与周复盘样式都依赖它）；列数交给外层，
    // 各行用 subgrid 共用同一组列轨，长文本把整列一起撑宽，而不是只撑歪自己那一行。
    blocks.push(
      <div className="md-table md-table--grid" key={`table-${tableStart}`} data-reading-anchor={`md-${tableStart}`}
        role="region" aria-label="正文表格，可横向滚动" tabIndex={0} style={{ "--md-cols": columnCount } as CSSProperties}>
        {rows.map((row, rowIndex) => (
          <div className={`md-table-row${rowIndex === 0 ? " md-table-head" : ""}`} key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <span key={cellIndex}>{inline(cell.trim())}</span>
            ))}
          </div>
        ))}
      </div>,
    );
  };
  const pushCode = (key: string) => {
    blocks.push(<CodeBlock key={key} code={codeLines.join("\n")} language={codeLanguage} line={codeStart} />);
    codeLines = [];
  };
  lines.forEach((line, index) => {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (marker && (!codeFence || (marker[0] === codeFence[0] && marker.length >= codeFence.length))) {
      flushParagraph();
      flushQuote();
      flushTable();
      if (codeFence) pushCode(`code-${codeStart}`);
      else {
        codeStart = index;
        codeLanguage = fenceLanguage(line);
      }
      codeFence = codeFence ? "" : marker;
      return;
    }
    if (codeFence) { codeLines.push(line); return; }
    // 脚注定义与续行统一收到文末，原位置只当段落分隔。
    if (footnotes.skip.has(index)) {
      flushParagraph();
      flushQuote();
      flushTable();
      return;
    }
    if (line.startsWith(">")) {
      flushParagraph();
      flushTable();
      if (!quoteLines.length) quoteStart = index;
      quoteLines.push(line.replace(/^>\s?/, ""));
      return;
    }
    if (line.startsWith("|")) {
      flushParagraph();
      flushQuote();
      if (!tableLines.length) tableStart = index;
      // |---|---| の区切り行は表示しない
      if (!/^\|?\s*:?-+/.test(line)) tableLines.push(line);
      return;
    }
    flushQuote();
    flushTable();
    if (!line.trim()) { flushParagraph(); return; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      blocks.push(<hr key={index} />);
      return;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const data = { "data-md-heading": normalizeHeading(heading[2]), id: headingAnchor(index) };
      // 冒頭の H1 は Obsidian 慣例でノート題名＝drawer が既に大きく出しているので捨てる。
      // 2つ目以降の H1 は本文の見出しなので h2 として出す。
      if (level === 1) {
        if (!seenTitle) { seenTitle = true; return; }
        blocks.push(<h2 key={index} {...data}>{inline(heading[2])}</h2>);
      }
      else if (level === 2) blocks.push(<h2 key={index} {...data}>{inline(heading[2])}</h2>);
      else if (level === 3) blocks.push(<h3 key={index} {...data}>{inline(heading[2])}</h3>);
      else blocks.push(<h4 key={index} {...data}>{inline(heading[2])}</h4>);
      return;
    }
    // 单独一行的图片当插图：带说明、占整行，并能作为阅读位置的锚点。
    const lone = tokenizeInline(line.trim());
    if (lone.length === 1 && lone[0].type === "image") {
      flushParagraph();
      const image = lone[0];
      blocks.push(
        <figure className="md-figure" key={index} data-reading-anchor={`md-${index}`}>
          {renderTokens(lone, ctx, `figure-${index}-`)}
          {image.alt && <figcaption>{image.alt}</figcaption>}
        </figure>,
      );
      return;
    }
    const item = parseListItem(line);
    if (item) {
      flushParagraph();
      // 序号与缩进两种模式都输出：普通详情页以前只画圆点、全部平铺，有序步骤和层级都丢了。
      blocks.push(
        <div className="md-list-item" key={index} data-reading-anchor={`md-${index}`}
          data-ordered={item.ordered ? "" : undefined} data-depth={item.depth || undefined} data-task={item.task ?? undefined}
          style={item.depth ? { marginLeft: `${item.depth}em` } : undefined}>
          {item.task
            ? <TaskMark state={item.task} />
            : <i>{item.ordered ? item.marker : reading ? "·" : null}</i>}
          <span>{inline(item.text)}</span>
        </div>,
      );
      return;
    }
    if (reading) {
      if (!paragraphLines.length) paragraphStart = index;
      paragraphLines.push(line);
    } else blocks.push(<p key={index} data-reading-anchor={`md-${index}`}>{inline(line)}</p>);
  });
  flushQuote();
  flushTable();
  flushParagraph();
  if (codeFence && codeLines.length) pushCode("unclosed-code");
  if (footnotes.numbers.size) {
    const ordered = [...footnotes.numbers].sort((left, right) => left[1] - right[1]);
    const firstLine = Math.min(...[...footnotes.definitions.values()].map((definition) => definition.line));
    // 正文已经渲染完，referenced 里就是真正被引用过的脚注：没被引用的不给回跳箭头。
    const referenced = new Set(ctx.referenced);
    blocks.push(
      <FootnoteList key="footnotes" line={firstLine}>
        {ordered.map(([id, number]) => (
          <li key={id} data-footnote={id} value={number} tabIndex={-1}>
            <span>{inline(footnotes.definitions.get(id)!.text)}</span>
            {referenced.has(id) && <FootnoteBack id={id} />}
          </li>
        ))}
      </FootnoteList>,
    );
  }
  return <article className="markdown-document">{blocks}</article>;
}

// 読書進捗（scroll ごとの setState）で NoteDrawer が毎フレーム再レンダーしても、
// 本文（content と onWikiLink が変わらない限り）を逐行パースし直さない。
export default memo(MarkdownDocument);
