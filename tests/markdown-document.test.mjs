import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const { default: MarkdownDocument } = await loadAppModule("app/markdown-document.tsx");
const render = (content, reading = true) => renderToStaticMarkup(createElement(MarkdownDocument, {
  content, reading, onWikiLink() {},
}));
const tableRows = (html, reading) => reading
  ? [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) => [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => cell[1]))
  : [...html.matchAll(/<div class="md-table-row[^\"]*">([\s\S]*?)<\/div>/g)].map((row) => [...row[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((cell) => cell[1]));

for (const reading of [true, false]) {
  const mode = reading ? "阅读表格" : "普通表格";
  test(`${mode}保留 wiki 别名和空单元格，链接不制造额外列`, () => {
    const html = render([
      "| 项目 | 出处 | 备注 |",
      "| --- | :---: | ---: |",
      "| 例子 | [[资料/示例#说明|原文]] | |",
      "| | | 补充 |",
    ].join("\n"), reading);
    const rows = tableRows(html, reading);
    assert.deepEqual(rows.map((row) => row.length), [3, 3, 3]);
    assert.match(rows[1][1], /<button class="wiki-link">原文 ↗<\/button>/);
    assert.equal(rows[1][2], "");
    assert.deepEqual(rows[2], ["", "", "补充"]);
    if (reading) assert.match(html, /min-width:24em/);
  });

  test(`${mode}只有完整分隔行被隐藏，负数和横线开头正文保留`, () => {
    const rows = tableRows(render([
      "| 变化 | 说明 |",
      "|---|---|",
      "| --- | --- |",
      "| -5 | 数值下降 |",
      "| ---待核对 | 仍是正文 |",
      "| --- | 另一列不是分隔符 |",
    ].join("\n"), reading), reading);
    assert.deepEqual(rows, [["变化", "说明"], ["---", "---"], ["-5", "数值下降"], ["---待核对", "仍是正文"], ["---", "另一列不是分隔符"]]);
  });

  test(`${mode}转义竖线和行内代码保留在原单元格`, () => {
    const rows = tableRows(render([
      "| 内容 | 说明 |",
      "| --- | --- |",
      String.raw`| 左\|右 | 文字 |`,
      "| `a|b` | 代码 |",
      String.raw`| 末尾 | \|`,
    ].join("\n"), reading), reading);
    assert.deepEqual(rows, [["内容", "说明"], ["左|右", "文字"], ["<code>a|b</code>", "代码"], ["末尾", "|"]]);
  });

  test(`${mode}行内代码保留连续反斜杠，不改写代码原文`, () => {
    const code = String.raw`a\\b`;
    const rows = tableRows(render([
      "| 代码 | 说明 |",
      "| --- | --- |",
      `| \`${code}\` | 原文 |`,
    ].join("\n"), reading), reading);
    assert.deepEqual(rows, [["代码", "说明"], [`<code>${code}</code>`, "原文"]]);
    assert.ok(render(`\`${code}\``).includes(rows[1][0]), "段落和表格里的相同代码保持一致");
  });
}

test("标准的四组两列对照没有分隔行或多余列", () => {
  const rows = tableRows(render([
    "| 表达 | 关系 |",
    "|---|---|",
    "| A／B | 第一组 |",
    "| C／D | 第二组 |",
    "| E／F | 第三组 |",
    "| G／H | 第四组 |",
  ].join("\n")), true);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.length === 2));
});

test("未提供教材导航处理器时，原有 Markdown 外链行为不变", () => {
  const html = render("[章节](http://localhost:3000/training/topics?chapter=sample) [外部](https://example.org/grammar)");
  assert.equal((html.match(/target="_blank"/g) ?? []).length, 2);
  assert.match(html, /href="http:\/\/localhost:3000\/training\/topics\?chapter=sample"/);
});

test("内部章节普通点击交给导航，修饰键点击保留浏览器默认行为", () => {
  let navigated = 0;
  let prevented = 0;
  const tree = MarkdownDocument.type({ content: "[下一章](/training/topics?chapter=sample)", onWikiLink() {},
    resolveInternalLink: () => ({href:"/training/topics?chapter=sample",onNavigate: () => { navigated++; }}),
  });
  const walk = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
  const anchor = walk(tree).find(node => node.type === "a");
  assert.equal(anchor.props.target, undefined);
  anchor.props.onClick({button:0,ctrlKey:true,preventDefault(){prevented++;}});
  assert.equal(navigated, 0);
  assert.equal(prevented, 0);
  anchor.props.onClick({button:0,preventDefault(){prevented++;}});
  assert.equal(navigated, 1);
  assert.equal(prevented, 1);
});
