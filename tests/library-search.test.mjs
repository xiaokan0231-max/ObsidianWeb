import assert from "node:assert/strict";
import test from "node:test";
import {
  compareRelevance,
  libraryCardSummary,
  libraryHits,
  librarySnippet,
  libraryTitleParts,
  markRecencyBreaks,
  noteHasTags,
  recencyBucket,
  tagListCodec,
  topLibraryTags,
} from "../lib/library-search.ts";

function note(path, { title = path, body = "", frontmatter = {}, tags = [], mtime = 0 } = {}) {
  return {
    path, tags, frontmatter,
    stat: { ctime: 0, mtime, size: body.length },
    content: `---\ntype: material\n---\n# ${title}\n\n${body}\n`,
  };
}

test("空查询的摘要是正文开头（去掉重复的标题与生成标记），带 summary 时用 summary", () => {
  const plain = note("a.md", { title: "株式会社テスト 面谈记录", body: "<!-- generated:x 勿手改 -->正文第一句。<!-- /generated -->" });
  assert.equal(libraryCardSummary(plain), "正文第一句。");
  const summarized = note("b.md", { body: "正文", frontmatter: { summary: "一句话结论" } });
  assert.equal(libraryCardSummary(summarized), "一句话结论");
  const long = note("c.md", { body: "字".repeat(300) });
  assert.equal(libraryCardSummary(long).length, 150);
  assert.ok(libraryCardSummary(long).endsWith("…"));
});

test("有关键词时摘要换成命中处前后的片段；正文没命中时返回 null 交给普通摘要", () => {
  const body = `${"前".repeat(80)}株式会社テストの逆質問${"后".repeat(120)}`;
  const target = note("d.md", { title: "准备稿", body });
  const parts = librarySnippet(target, "テスト");
  assert.ok(parts);
  assert.equal(parts.find((part) => part.hit)?.text, "テスト");
  assert.ok(parts[0].text.startsWith("…"));
  assert.ok(parts.at(-1).text.endsWith("…"));
  assert.equal(librarySnippet(target, "type:material"), null, "前缀词只筛选，不产生片段");
  assert.equal(librarySnippet(note("e.md", { title: "テスト", body: "无关正文" }), "テスト"), null);
});

test("标题命中按词高亮", () => {
  assert.deepEqual(libraryTitleParts(note("f.md", { title: "株式会社テスト 一次面接" }), "面接"), [
    { text: "株式会社テスト 一次", hit: false },
    { text: "面接", hit: true },
  ]);
});

test("相关度：标题命中 > 属性命中 > 正文命中次数", () => {
  const inTitle = note("t.md", { title: "逆質問メモ", body: "一般正文" });
  const inFrontmatter = note("fm.md", { title: "别的标题", frontmatter: { topic: "逆質問" } });
  const manyInBody = note("b.md", { title: "长文", body: "逆質問 ".repeat(30) });
  const fewInBody = note("b2.md", { title: "短文", body: "逆質問 一次" });
  const ranked = [fewInBody, manyInBody, inFrontmatter, inTitle]
    .map((item) => ({ item, hits: libraryHits(item, "逆質問") }))
    .sort((left, right) => compareRelevance(left.hits, right.hits))
    .map(({ item }) => item.path);
  assert.deepEqual(ranked, ["t.md", "fm.md", "b.md", "b2.md"]);
  assert.equal(libraryHits(manyInBody, "逆質問").body, 30);
  assert.equal(libraryHits(manyInBody, "status:x").total, 0);
});

test("标签 facet：取出现最多的前 N 个，已选的即使掉出前 N 也保留；多选是同时满足", () => {
  const notes = [
    note("1.md", { tags: ["#面试", "复盘"] }),
    note("2.md", { tags: ["面试"] }),
    note("3.md", { tags: ["面试", "日语"] }),
    note("4.md", { tags: ["复盘"] }),
    note("5.md", { tags: ["冷门"] }),
  ];
  assert.deepEqual(topLibraryTags(notes, [], 2), [{ tag: "面试", count: 3 }, { tag: "复盘", count: 2 }]);
  assert.deepEqual(topLibraryTags(notes, ["冷门"], 2).map((item) => item.tag), ["面试", "复盘", "冷门"]);
  assert.equal(noteHasTags(notes[0], ["面试", "复盘"]), true);
  assert.equal(noteHasTags(notes[1], ["面试", "复盘"]), false);
  assert.equal(noteHasTags(notes[1], []), true);
});

test("URL 的标签列表去重去 #，空串得到空列表", () => {
  assert.deepEqual(tagListCodec.parse("面试,#面试,,复盘"), ["面试", "复盘"]);
  assert.deepEqual(tagListCodec.parse(""), []);
  assert.equal(tagListCodec.serialize(["面试", "复盘"]), "面试,复盘");
});

test("最近更新分组：今天 / 本周（周一起）/ 本月 / 更早，跨月的本周仍算本周", () => {
  // 2026-10-01 是周四：本周从 9 月 28 日（周一）开始，早于本月 1 号。
  const now = new Date(2026, 9, 1, 15, 0);
  assert.equal(recencyBucket(new Date(2026, 9, 1, 0, 5).getTime(), now), "today");
  assert.equal(recencyBucket(new Date(2026, 8, 29, 9, 0).getTime(), now), "week");
  assert.equal(recencyBucket(new Date(2026, 8, 20).getTime(), now), "older");
  const later = new Date(2026, 9, 20, 12, 0);
  assert.equal(recencyBucket(new Date(2026, 9, 19).getTime(), later), "week");
  assert.equal(recencyBucket(new Date(2026, 9, 3).getTime(), later), "month");
  const rows = markRecencyBreaks([
    { stat: { mtime: new Date(2026, 9, 20, 9).getTime() } },
    { stat: { mtime: new Date(2026, 9, 20, 8).getTime() } },
    { stat: { mtime: new Date(2026, 9, 3).getTime() } },
  ], later);
  assert.deepEqual(rows.map((row) => [row.bucket, row.first]), [["today", true], ["today", false], ["month", true]]);
});
