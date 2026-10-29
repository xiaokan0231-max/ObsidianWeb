import assert from "node:assert/strict";
import test from "node:test";
import { resolveCompanyReference } from "../lib/company-overview.ts";

const note = (path) => ({ path, frontmatter: { type: "company", company: "株式会社テスト" }, content: "", tags: [], stat: { ctime: 0, mtime: 1, size: 0 } });

test("公司引用索引保持完整路径优先、目录后缀和短名歧义的原有规则", () => {
  const root = note("_公司.md");
  const first = note("20_求職/甲/_公司.md");
  const second = note("20_求職/乙/_公司.MD");
  const nested = note("备份/20_求職/甲/_公司.md");
  const notes = [root, first, second, nested];
  for (const input of [notes, [...notes].reverse()]) {
    assert.equal(resolveCompanyReference(input, "[[_公司]]"), root, "根目录完整路径优先于其他目录的同名文件");
    assert.equal(resolveCompanyReference(input, " [[20_求職/甲/_公司.md#概要|会社]] "), first);
    assert.equal(resolveCompanyReference(input, "乙/_公司.MD"), second);
    assert.equal(resolveCompanyReference(input, "甲/_公司"), null, "多个目录后缀匹配仍有歧义");
    assert.equal(resolveCompanyReference(input, "不存在"), null);
    assert.equal(resolveCompanyReference(input, ""), null);
  }
  assert.equal(resolveCompanyReference([first, second], "_公司"), null);
  assert.equal(resolveCompanyReference([first, { ...first }], first.path), null, "重复完整路径不能伪装成唯一引用");
});

test("笔记快照替换后删除、改名和同名新增会重建引用结果", () => {
  const first = note("20_求職/甲/_公司.md");
  const second = note("20_求職/乙/_公司.md");
  const before = [first];
  assert.equal(resolveCompanyReference(before, "_公司"), first);
  assert.equal(resolveCompanyReference([first, second], "_公司"), null);
  assert.equal(resolveCompanyReference([second], first.path), null);
  assert.equal(resolveCompanyReference([second], "_公司"), second);
  const renamed = { ...first, path: "20_求職/甲/新卷宗.md" };
  assert.equal(resolveCompanyReference([renamed], first.path), null);
  assert.equal(resolveCompanyReference([renamed], "新卷宗"), renamed);
  assert.equal(resolveCompanyReference(before, "_公司"), first, "新快照不污染仍在使用的旧快照");

  before.push(second);
  assert.equal(resolveCompanyReference(before, "_公司"), null, "兼容同一集合追加文件的调用方");
  before.pop();
  assert.equal(resolveCompanyReference(before, "_公司"), first);
});
