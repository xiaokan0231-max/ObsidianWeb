import assert from "node:assert/strict";
import test from "node:test";
import { resolveNoteLink } from "../lib/wiki-target.ts";

const source = { path: "10_资料/项目实绩.md", frontmatter: {}, content: "" };
const dossier = { path: "20_求職/テスト/_会社.md", frontmatter: {}, content: "" };

test("画像证据支持完整路径、双链、章节及显示别名", () => {
  for (const input of [source.path, "项目实绩", "[[10_资料/项目实绩]]"]) {
    assert.deepEqual(resolveNoteLink([source, dossier], input), { note: source, section: null });
  }
  assert.deepEqual(resolveNoteLink([source], "[[10_资料/项目实绩#组织建设|本人项目]]"), { note: source, section: "组织建设" });
  assert.deepEqual(resolveNoteLink([source], "项目实绩#旧章", "新章"), { note: source, section: "新章" });
  assert.deepEqual(resolveNoteLink([dossier], dossier.path), { note: dossier, section: null });
});

test("同名来源必须消歧，缺失来源不能猜测", () => {
  const other = { ...source, path: "90_归档/项目实绩.md" };
  assert.equal(resolveNoteLink([source, other], "项目实绩"), null);
  assert.equal(resolveNoteLink([source, other], "[[不存在]]"), null);
  assert.equal(resolveNoteLink([source, other], ""), null);
  assert.equal(resolveNoteLink([source, other], source.path)?.note, source);
});
