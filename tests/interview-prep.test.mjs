import assert from "node:assert/strict";
import test from "node:test";
import { parseInterviewPrepLibrary } from "../lib/interview-prep.ts";

function note(content, type = "interview-prep-library") {
  return {
    path: "20_求職/_素材/面接標準回答集.md",
    stat: { ctime: 0, mtime: 0, size: content.length },
    tags: [],
    frontmatter: { type, title: "面试标准回答库" },
    content,
  };
}

test("interview prep library keeps answer, boundary and evidence in separate cards", () => {
  const parsed = parseInterviewPrepLibrary(note(`---
type: interview-prep-library
---
# 面试标准回答库
> 真实经历优先。

## p01 自我介绍
- 分类:: 基础
- 优先级:: S
- 问题:: 自己紹介をお願いします。
- 目的:: 展示通用能力。
- 标签:: 自我介绍, Java

### 标准回答
標準の回答です。

二つ目の段落です。

### 30秒版
短い回答です。

### 回答结构
- 結論
- 証拠

### 使用边界
- 実績を誇張しない。

### 证据
- [[本人事实]]

## p02 未经验
- 分类:: 经验边界
- 优先级:: A
- 问题:: 経験はありますか。

### 标准回答
実務経験はありません。
`));

  assert.ok(parsed);
  assert.equal(parsed.title, "面试标准回答库");
  assert.equal(parsed.description, "真实经历优先。");
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.items[0].tags, ["自我介绍", "Java"]);
  assert.match(parsed.items[0].standardAnswer, /二つ目の段落/);
  assert.match(parsed.items[0].structure, /証拠/);
  assert.match(parsed.items[0].boundary, /誇張/);
  assert.match(parsed.items[0].evidence, /本人事实/);
  assert.equal(parsed.items[1].category, "经验边界");
});

test("non-library notes are ignored", () => {
  assert.equal(parseInterviewPrepLibrary(note("# 普通笔记", "material")), null);
});
