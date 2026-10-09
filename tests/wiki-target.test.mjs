import assert from "node:assert/strict";
import test from "node:test";
import { explicitNoteLink, resolveNoteLink } from "../lib/wiki-target.ts";

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

test("未载入来源仅接受 Vault 相对完整笔记路径，保留章节", () => {
  assert.deepEqual(explicitNoteLink("[[20_求職/テスト/逐字稿#追问|出处]]"), {
    path: "20_求職/テスト/逐字稿.md", section: "追问",
  });
  assert.deepEqual(explicitNoteLink("20_求職/テスト/逐字稿.md#旧节", "本人批注"), {
    path: "20_求職/テスト/逐字稿.md", section: "本人批注",
  });
  for (const input of ["逐字稿", "逐字稿.md", "/tmp/逐字稿.md", "../逐字稿", "20_求職/../逐字稿", "20_求職/./逐字稿", "20_求職//逐字稿", "20_求職/", "https://example.com/test.md", "20_求職/テスト.pdf", "20_求職\\テスト/逐字稿"]) {
    assert.equal(explicitNoteLink(input), null, input);
  }
});
