import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inlinePlainText, parseWikiBody, tokenizeInline } from "../lib/markdown-inline.ts";
import { calloutHead, collectFootnotes, fenceLanguage, parseListItem, wikiPreviewExcerpt } from "../lib/markdown-syntax.ts";
import { highlightCode } from "../lib/markdown-code.ts";
import { headingPlainText, scanReadingHeadings } from "../lib/reading-document.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const { default: MarkdownDocument } = await loadAppModule("app/markdown-document.tsx");
const render = (content, props = {}) => renderToStaticMarkup(createElement(MarkdownDocument, { content, onWikiLink() {}, ...props }));
const note = (path, content, type = "material") => ({ path, frontmatter: { type }, content, tags: [], stat: { ctime: 1, mtime: 1, size: 1 } });

test("行内：斜体、删除线、高亮排在粗体之后，乘号与比较式保持原文", () => {
  const kinds = (text) => tokenizeInline(text).map((token) => token.type);
  assert.deepEqual(kinds("**粗** *斜*"), ["strong", "text", "em"]);
  assert.deepEqual(kinds("中文*斜体*中文"), ["text", "em", "text"]);
  assert.deepEqual(kinds("3 * 4 * 5 与 2*3*4 与 a*b*c"), ["text"]);
  assert.deepEqual(kinds("~~旧~~ ==重点=="), ["del", "text", "mark"]);
  assert.deepEqual(kinds("a == b == c"), ["text"]);
  assert.deepEqual(kinds("`*不解析*`"), ["code"]);
  const nested = tokenizeInline("**粗里有 `代码` 和 [[笔记]]**")[0];
  assert.deepEqual(nested.children.map((token) => token.type), ["text", "code", "text", "wiki"]);
});

test("图片只放行 https，并解析 Obsidian 的宽度写法", () => {
  assert.deepEqual(tokenizeInline("![示意图|320](https://example.test/a.png)")[0],
    { type: "image", alt: "示意图", src: "https://example.test/a.png", width: 320 });
  assert.equal(tokenizeInline("![x](http://example.test/a.png)")[0].type, "text");
  assert.equal(tokenizeInline("![x](javascript:alert(1))")[0].type, "text");
});

test("wikilink 认转义竖线，目录文字去掉新的行内记号", () => {
  assert.deepEqual(parseWikiBody(String.raw`资料/示例#说明\|原文`), { target: "资料/示例", section: "说明", label: "原文" });
  assert.deepEqual(parseWikiBody("资料#章节"), { target: "资料", section: "章节", label: "章节" });
  assert.equal(inlinePlainText("==重点== 与 *补充*[^1] 见 [[资料|原文]]"), "重点 与 补充 见 原文");
  assert.equal(headingPlainText("## ==重点==[^n] ~~旧~~".replace(/^## /, "")), "重点 旧");
});

test("callout 类型映射到现有色调，未知类型按 note 处理", () => {
  assert.deepEqual(calloutHead("[!warning] 截止前确认"), { kind: "warning", tone: "warn", title: "截止前确认", titleZh: "注意", titleJa: "注意" });
  assert.equal(calloutHead("[!TIP]- ").tone, "key");
  assert.equal(calloutHead("[!danger]").tone, "danger");
  assert.equal(calloutHead("[!success]").tone, "aim");
  assert.equal(calloutHead("[!custom] x").tone, "info");
  assert.equal(calloutHead("[!quote]").tone, null);
  assert.equal(calloutHead("普通引用"), null);
});

test("列表项：层级、有序、任务状态", () => {
  assert.deepEqual(parseListItem("  - [x] 已提交"), { depth: 1, ordered: false, marker: "-", task: "done", text: "已提交" });
  assert.deepEqual(parseListItem("\t3. 第三步"), { depth: 2, ordered: true, marker: "3.", task: null, text: "第三步" });
  assert.equal(parseListItem("- [ ] 待办").task, "open");
  // 只有框没有字的占位待办也算任务项，[ ] 不能漏成正文。
  assert.deepEqual(parseListItem("- [ ] "), { depth: 0, ordered: false, marker: "-", task: "open", text: "" });
  assert.equal(parseListItem("* [x]").task, "done");
  assert.equal(parseListItem("- [x]没空格").task, null);
  assert.equal(parseListItem("正文"), null);
  assert.equal(fenceLanguage("```TypeScript title=\"x\""), "typescript");
  assert.equal(fenceLanguage("~~~"), "");
});

test("脚注按引用顺序编号，代码块里的写法不算", () => {
  const footnotes = collectFootnotes([
    "先看[^b]，再看[^a]。",
    "```",
    "[^c]: 示例里的定义",
    "```",
    "[^a]: 甲",
    "[^b]: 乙",
    "    乙的续行",
    "[^z]: 没被引用",
  ]);
  assert.deepEqual([...footnotes.numbers], [["b", 1], ["a", 2], ["z", 3]]);
  assert.equal(footnotes.definitions.get("b").text, "乙\n乙的续行");
  assert.deepEqual([...footnotes.skip].sort(), [4, 5, 6, 7]);
  assert.equal(footnotes.definitions.has("c"), false);
});

test("代码着色只分四类，认不出的语言原样输出", () => {
  const kinds = (code, language) => highlightCode(code, language).filter((token) => token.kind !== "plain").map((token) => [token.kind, token.text]);
  assert.deepEqual(kinds("const a = \"x\"; // 注释\nreturn 42", "ts"), [["keyword", "const"], ["string", "\"x\""], ["comment", "// 注释"], ["keyword", "return"], ["number", "42"]]);
  assert.deepEqual(kinds("select id from t -- 说明", "SQL"), [["keyword", "select"], ["keyword", "from"], ["comment", "-- 说明"]]);
  assert.deepEqual(kinds("key: true # 注释", "yml"), [["keyword", "true"], ["comment", "# 注释"]]);
  assert.deepEqual(kinds("echo \"a # b\" # 真注释", "sh"), [["keyword", "echo"], ["string", "\"a # b\""], ["comment", "# 真注释"]]);
  assert.deepEqual(highlightCode("任意 *文本*", "brainfuck"), [{ kind: "plain", text: "任意 *文本*" }]);
});

test("预览卡摘录去掉标题、记号与 frontmatter，并限长", () => {
  const content = "---\ntype: material\n---\n# 标题\n\n> [!note] 提要\n> 这是**重点**内容\n\n- [ ] 待办事项\n";
  assert.equal(wikiPreviewExcerpt(content), "提要 这是重点内容 待办事项");
  assert.equal(wikiPreviewExcerpt(`正文${"字".repeat(200)}`, 20).length, 20);
});

test("渲染：行内语法、单行图片成插图、非 https 图片保持原文", () => {
  const html = render([
    "*斜体* ~~删除~~ ==高亮== 3 * 4",
    "",
    "![流程图](https://example.test/flow.png)",
    "",
    "![旧图](http://example.test/old.png)",
  ].join("\n"));
  assert.match(html, /<em>斜体<\/em> <del>删除<\/del> <mark class="md-mark">高亮<\/mark> 3 \* 4/);
  assert.match(html, /<figure class="md-figure" data-reading-anchor="md-2"><img class="md-image" src="https:\/\/example.test\/flow.png" alt="流程图" loading="lazy"/);
  assert.match(html, /<figcaption>流程图<\/figcaption>/);
  assert.match(html, /!\[旧图\]\(http:\/\/example.test\/old.png\)/);
});

test("渲染：任务项、有序项序号和嵌套缩进在普通模式也输出", () => {
  const html = render(["1. 第一步", "  - [x] 已完成", "  - [ ] 未完成"].join("\n"));
  assert.match(html, /data-reading-anchor="md-0" data-ordered=""><i>1\.<\/i>/);
  assert.match(html, /data-depth="1" data-task="done" style="margin-left:1em"><i role="img" aria-label="已完成"><\/i><span>已完成<\/span>/);
  assert.match(html, /data-task="open"/);
});

test("渲染：原生 callout 单独输出标题行，emoji 判色仍然有效", () => {
  const html = render(["> [!warning] 截止前确认", "> 正文第一行", "", "> [!tip]", "> 无标题", "", "> 🔴 禁止事项"].join("\n"));
  assert.match(html, /data-callout="warn" data-callout-kind="warning"><span class="md-callout-title">截止前确认<\/span><span>正文第一行<\/span>/);
  assert.match(html, /data-callout="key" data-callout-kind="tip"><span class="md-callout-title">提示<\/span>/);
  assert.match(html, /data-callout="danger"><span>🔴 禁止事项<\/span>/);
});

test("渲染：脚注成上标并收到文末，未定义的保持原文", () => {
  const html = render(["正文[^a]与[^zz]。", "", "[^a]: 出处说明"].join("\n"));
  assert.match(html, /<sup class="md-footnote-ref" data-footnote-ref="a" tabindex="-1"><a href="#fn-a" aria-label="脚注 1">1<\/a><\/sup>/);
  assert.match(html, /与\[\^zz\]。/);
  assert.match(html, /<section class="md-footnotes" data-reading-anchor="md-2" aria-label="脚注"><ol><li data-footnote="a" value="1" tabindex="-1"><span>出处说明<\/span><a class="md-footnote-back"/);
  assert.equal((html.match(/出处说明/g) ?? []).length, 1);
});

test("渲染：代码块带语言名、复制按钮与着色，锚点是开头围栏的行号", () => {
  const html = render(["说明", "```ts", "const a = 1; // 注释", "```"].join("\n"));
  assert.match(html, /<figure class="md-code" data-reading-anchor="md-1" data-language="ts"><div class="md-code-bar"><span>ts<\/span><button type="button" class="md-code-copy"/);
  assert.match(html, /<span class="md-tok-keyword">const<\/span>/);
  assert.match(html, /<span class="md-tok-comment">\/\/ 注释<\/span>/);
  assert.match(html, />复制<\/span><\/button>/);
});

test("渲染：resolveWiki 只在传入时生效，解析不到的标成缺失", () => {
  const known = note("20_求職/テスト/資料.md", "# 資料\n\n本文");
  const content = "[[資料]] [[不存在]] [[#本篇章节]]";
  assert.equal((render(content).match(/<button class="wiki-link">/g) ?? []).length, 3);
  const html = render(content, { resolveWiki: (target) => (target === "資料" ? known : null) });
  assert.match(html, /<button class="wiki-link">資料 ↗<\/button>/);
  assert.match(html, /<button class="wiki-link wiki-link--missing" title="找不到这篇笔记，或同名笔记不止一篇">不存在<\/button>/);
  assert.match(html, /<button class="wiki-link">本篇章节 ↗<\/button>/);
  // 附件不在笔记索引里：不查、不标缺失，仍按原来的链接输出。
  const attachments = render("![[截图.PNG]] [[资料.pdf]] [[版本1.2 方案]]", { resolveWiki: () => null });
  assert.match(attachments, /<button class="wiki-link">截图\.PNG ↗<\/button> <button class="wiki-link">资料\.pdf ↗<\/button>/);
  assert.match(attachments, /wiki-link--missing" title="[^"]+">版本1\.2 方案</);
});

test("目录扫描与正文标题一一对应：callout 与代码块里的 # 不算标题", () => {
  const content = [
    "# 题名",
    "## 第一节 ==重点==",
    "> [!note] 说明",
    "> # 引用里的井号",
    "```md",
    "# 代码里的井号",
    "```",
    "- [ ] 任务",
    "### 小节[^1]",
    "[^1]: 脚注",
    "#### 四级",
  ].join("\n");
  const scanned = scanReadingHeadings(content);
  assert.deepEqual(scanned.map((heading) => heading.text), ["第一节 重点", "小节"]);
  const rendered = [...render(content).matchAll(/<h[23][^>]* id="(doc-h-\d+)"/g)].map((match) => match[1]);
  assert.deepEqual(rendered, scanned.map((heading) => heading.id));
});

test("日语界面下 callout 默认标题与复制按钮跟随界面语言", async () => {
  const { default: JaDocument } = await loadAppModule("app/markdown-document.tsx", {
    stubs: { "./ui-locale": { useUiLocale: () => ({ locale: "ja", setLocale() {} }) } },
  });
  const html = renderToStaticMarkup(createElement(JaDocument, { content: "> [!tip]\n> 本文\n\n```\nx\n```", onWikiLink() {} }));
  assert.match(html, /<span class="md-callout-title">ヒント<\/span>/);
  assert.match(html, /<span>テキスト<\/span>/);
  assert.match(html, />コピー<\/span>/);
});
