import assert from "node:assert/strict";
import test from "node:test";
import { highlightTerms, searchSnippet, splitByTerms } from "../lib/search-snippet.ts";
import { pushRecentPath, readRecentPaths, rememberRecentPath, RECENT_NOTES_KEY } from "../lib/recent-notes.ts";

test("前缀词只筛选不高亮，| 展开成候选", () => {
  assert.deepEqual(highlightTerms("type:ai-report 面接|面谈  逆質問"), ["面接", "面谈", "逆質問"]);
  assert.deepEqual(highlightTerms("status:応募済"), []);
});

test("命中片段合并重叠区间，大小写不敏感", () => {
  assert.deepEqual(splitByTerms("Spark and spark", ["spark"]), [
    { text: "Spark", hit: true },
    { text: " and ", hit: false },
    { text: "spark", hit: true },
  ]);
  assert.deepEqual(splitByTerms("abcde", ["bc", "cd"]), [
    { text: "a", hit: false },
    { text: "bcd", hit: true },
    { text: "e", hit: false },
  ]);
});

test("摘要取命中位置前后一段，截断处补省略号；没命中退回开头", () => {
  const text = `${"甲".repeat(60)}株式会社テスト${"乙".repeat(100)}`;
  const parts = searchSnippet(text, "テスト", { radius: 10 });
  assert.equal(parts[0].text.startsWith("…"), true);
  assert.equal(parts.find((part) => part.hit)?.text, "テスト");
  assert.equal(parts.at(-1)?.text.endsWith("…"), true);
  assert.deepEqual(searchSnippet("开头的正文", "type:todo"), [{ text: "开头的正文", hit: false }]);
});

test("最近打开：去重置顶、截断，存储不可用时静默", () => {
  assert.deepEqual(pushRecentPath(["a", "b", "c"], "b", 3), ["b", "a", "c"]);
  assert.deepEqual(pushRecentPath(["a", "b", "c"], "d", 3), ["d", "a", "b"]);
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  rememberRecentPath("x.md", storage);
  rememberRecentPath("y.md", storage);
  rememberRecentPath("x.md", storage);
  assert.deepEqual(readRecentPaths(storage), ["x.md", "y.md"]);
  store.set(RECENT_NOTES_KEY, "{broken");
  assert.deepEqual(readRecentPaths(storage), []);
  assert.doesNotThrow(() => rememberRecentPath("z.md", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }));
});
