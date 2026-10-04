import assert from "node:assert/strict";
import test from "node:test";
import { backlinkContext, findHeadingBySection, noteBacklinks, noteOutlinks } from "../lib/memory-atlas-data.ts";

function note(path, content, frontmatter = "") {
  return {
    path, tags: [], frontmatter: {},
    stat: { ctime: 0, mtime: 0, size: content.length },
    content: `${frontmatter ? `---\n${frontmatter}\n---\n` : ""}${content}`,
  };
}

const target = note("20_求職/株式会社テスト.md", "# 株式会社テスト\n\n公司卷宗。");
const prep = note("20_求職/面接準備.md", [
  "# 一次面接の準備",
  "",
  "- 志望動機は **[[株式会社テスト|テスト社]]** の物流基盤に合わせて話す。",
  "```",
  "[[株式会社テスト]] はコード例なので数えない",
  "```",
].join("\n"));
const viaFrontmatter = note("20_求職/批注.md", "# 批注\n\n正文没有提到。", 'source_note: "[[株式会社テスト]]"');
const table = note("20_求職/一覧.md", "# 一覧\n\n| 社名 | 状態 |\n| --- | --- |\n| [[株式会社テスト\\|テスト]] | 応募済 |");
const unrelated = note("20_求職/別件.md", "# 別件\n\n[[株式会社サンプル]] だけ。");
const duplicateA = note("10_关于我/同名.md", "# 同名A");
const duplicateB = note("20_求職/同名.md", "# 同名B");
const linker = note("20_求職/リンク元.md", "# リンク元\n\n[[株式会社テスト]] と [[同名]] と [[存在しない]] と [[株式会社テスト]]。");
const all = [target, prep, viaFrontmatter, table, unrelated, duplicateA, duplicateB, linker];

test("反链：与 noteLinks 同一口径，代码块里的链接不算，frontmatter 里的结构化关系算", () => {
  const paths = noteBacklinks(all, target).map((item) => item.path);
  assert.deepEqual(paths.sort(), [prep.path, viaFrontmatter.path, linker.path].sort());
  assert.equal(noteBacklinks(all, unrelated).length, 0);
});

test("本文链接到：同名多篇不猜，不存在的跳过，重复的只列一次", () => {
  assert.deepEqual(noteOutlinks(all, linker).map((item) => item.path), [target.path]);
});

test("反链上下文：取提到的那一行，链接换成显示名并标为命中，去掉行首记号与强调符", () => {
  assert.deepEqual(backlinkContext(prep, "株式会社テスト"), [
    { text: "志望動機は ", hit: false },
    { text: "テスト社", hit: true },
    { text: " の物流基盤に合わせて話す。", hit: false },
  ]);
  assert.deepEqual(backlinkContext(viaFrontmatter, "株式会社テスト"), [
    { text: 'source_note: "', hit: false },
    { text: "株式会社テスト", hit: true },
    { text: '"', hit: false },
  ]);
  assert.equal(backlinkContext(unrelated, "株式会社テスト"), null);
});

test("反链上下文：长行只留链接前后约 radius 字，截断处补省略号", () => {
  const long = note("20_求職/长文.md", `# 长文\n\n${"甲".repeat(100)}[[株式会社テスト]]${"乙".repeat(100)}`);
  const parts = backlinkContext(long, "株式会社テスト", 20);
  assert.equal(parts[0].text, `…${"甲".repeat(20)}`);
  assert.equal(parts[1].text, "株式会社テスト");
  assert.equal(parts[2].text, `${"乙".repeat(20)}…`);
});

test("表格里转义的别名链接也能取到上下文", () => {
  const parts = backlinkContext(table, "株式会社テスト");
  assert.equal(parts?.find((part) => part.hit)?.text, "テスト");
});

test("章节定位：全等优先，其次前缀互含；没有就返回 undefined", () => {
  const headings = [
    { id: "h1", text: "志望動機（改訂版）" },
    { id: "h2", text: "志望動機" },
    { id: "h3", text: "逆質問" },
  ];
  assert.equal(findHeadingBySection(headings, "志望動機")?.id, "h2");
  assert.equal(findHeadingBySection(headings, "逆質問の候補")?.id, "h3");
  assert.equal(findHeadingBySection(headings, "**逆質問**")?.id, "h3");
  assert.equal(findHeadingBySection(headings, "自己紹介"), undefined);
  assert.equal(findHeadingBySection(headings, null), undefined);
});
