import assert from "node:assert/strict";
import test from "node:test";
import {
  listEmbeds,
  listHeadings,
  parseEmbedLine,
  shiftHeadings,
  sliceSection,
} from "../lib/interview-prep-embed.mjs";

const NOTE = `---
type: material
---
# 転職理由台本

> 前書き。

## 音読用スクリプト

### 30秒版

社数が多いのは事実です。

### 追撃への備え

その懸念はもっともだと思います。

## 逐社一句

内部の説明。
`;

test("単独行の埋め込みだけを拾い、文中や説明用の記法は拾わない", () => {
  assert.deepEqual(parseEmbedLine("![[当日フレーズ集]]"), { target: "当日フレーズ集", section: "" });
  assert.deepEqual(parseEmbedLine("  ![[台本#音読用スクリプト]]  "), {
    target: "台本",
    section: "音読用スクリプト",
  });
  assert.equal(parseEmbedLine("正本は ![[単語文法帳]] G表"), null, "文中は展開対象にしない");
  assert.equal(parseEmbedLine("[[単語文法帳]]"), null, "! なしはただのリンク");
});

test("埋め込みの列挙は frontmatter と作業メモを除いた本文だけを見る", () => {
  const embeds = listEmbeds(`---
type: interview-prep
---
<!--
改修マップ：![[コメント内の例]]
-->
# 準備

![[当日フレーズ集]]
![[転職理由台本#音読用スクリプト]]
`);
  assert.deepEqual(
    embeds.map((embed) => `${embed.target}#${embed.section}`),
    ["当日フレーズ集#", "転職理由台本#音読用スクリプト"],
  );
});

test("節の切り出しは同レベル以上の見出しで止まる（隣の節を巻き込まない）", () => {
  const sliced = sliceSection(NOTE, "音読用スクリプト");
  assert.equal(sliced.level, 2);
  assert.match(sliced.body, /30秒版/);
  assert.match(sliced.body, /追撃への備え/, "配下の ### は含む");
  assert.doesNotMatch(sliced.body, /内部の説明/, "次の ## は含まない");
  assert.doesNotMatch(sliced.body, /前書き/, "前の内容も含まない");
});

test("下位見出しを指定するとその小節だけが取れる", () => {
  const sliced = sliceSection(NOTE, "30秒版");
  assert.equal(sliced.level, 3);
  assert.equal(sliced.body, "社数が多いのは事実です。");
});

test("無い節は null（vault:check がここで断リンクを検出する）", () => {
  assert.equal(sliceSection(NOTE, "存在しない節"), null);
  assert.ok(listHeadings(NOTE).includes("音読用スクリプト"));
});

test("見出しの繰り下げは 6 段で頭打ちになる", () => {
  assert.equal(shiftHeadings("## A\n### B\n本文", 1), "### A\n#### B\n本文");
  assert.equal(shiftHeadings("## A", 0), "## A");
  assert.equal(shiftHeadings("###### A", 3), "###### A");
});
