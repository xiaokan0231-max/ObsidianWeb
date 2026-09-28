import assert from "node:assert/strict";
import test from "node:test";
import { noteInVaultScope, vaultScopeForView } from "../lib/vault-scope.ts";

const note = (type) => ({ path: `${type}.md`, stat: { ctime: 0, mtime: 0, size: 0 }, tags: [], frontmatter: { type }, content: "" });

test("route scopes keep only the notes each module needs", () => {
  assert.equal(noteInVaultScope(note("todo"), "actions"), true);
  assert.equal(noteInVaultScope(note("todo"), "jobs"), false);
  assert.equal(noteInVaultScope(note("job-case"), "training"), false);
  assert.equal(noteInVaultScope(note("job-case"), "overview"), true);
  assert.equal(noteInVaultScope(note("transcript"), "overview"), false);
  // 首页の复盘提醒は整理稿を起点に数える。落とすと冷启动で「待裁定 0」が出続ける。
  assert.equal(noteInVaultScope(note("transcript-study"), "overview"), true);
  assert.equal(noteInVaultScope(note("study-annotation"), "overview"), true);
  assert.equal(noteInVaultScope(note("interview-answer-review"), "overview"), true);
  assert.equal(noteInVaultScope(note("interview-answer-practice"), "overview"), true);
  assert.equal(noteInVaultScope(note("language-bank"), "jobs"), false);
  assert.equal(noteInVaultScope(note("language-bank"), "training"), true);
  assert.equal(noteInVaultScope(note("material"), "all"), true);
  // 面接準備の ![[…]] 展開先と全局共用資産の実体は material。落とすと節が静かに空になる。
  assert.equal(noteInVaultScope(note("material"), "interview"), true);
});

test("views map to stable module scopes", () => {
  assert.equal(vaultScopeForView("calendar"), "actions");
  assert.equal(vaultScopeForView("practice"), "interview");
  assert.equal(vaultScopeForView("graph"), "all");
});

test("面试加载公司契合与总结报告，不引入无关AI报告", () => {
  for (const kind of ["company-fit", "company-summary"]) {
    const report = note("ai-report");
    report.frontmatter.report_kind = kind;
    assert.equal(noteInVaultScope(report, "interview"), true);
  }
  assert.equal(noteInVaultScope(note("ai-report"), "interview"), false);
});
