import assert from "node:assert/strict";
import test from "node:test";
import {
  composeJobStatus,
  jobStatusNote,
  jobStatusNoteError,
  normalizeJobStatus,
} from "../lib/job-status.mjs";

test("normalizes the seven statuses with annotations", () => {
  assert.equal(normalizeJobStatus("応募済（2026-07-20・本人応募）"), "応募済");
  assert.equal(normalizeJobStatus("応募済 (Recruit Agent)"), "応募済");
  assert.equal(normalizeJobStatus("面接中（一次面接予定）"), "面接中");
});

test("rejects historical aliases instead of keeping a second contract", () => {
  assert.equal(normalizeJobStatus("応募完了：公式サイト"), null);
  assert.equal(normalizeJobStatus("書類選考中"), null);
  assert.equal(normalizeJobStatus("書類選考通過"), null);
});

test("does not silently rewrite an unknown workflow status", () => {
  assert.equal(normalizeJobStatus("応募しない"), null);
  assert.equal(normalizeJobStatus(""), null);
});

test("extracts the annotation, which is the only place a cause of death survives", () => {
  assert.equal(jobStatusNote("不採用（2026-07-21・書類選考／公式HRMOS）"), "2026-07-21・書類選考／公式HRMOS");
  assert.equal(jobStatusNote("応募済 (Recruit Agent)"), "Recruit Agent");
  assert.equal(jobStatusNote("不採用"), "");
  // 枚举に載っていない値は status ですらないので、注記も取り出さない。
  assert.equal(jobStatusNote("書類選考中（あれこれ）"), "");
});

test("round-trips compose and extract", () => {
  const note = "2026-07-30・募集終了で応募機会なし";
  const value = composeJobStatus("不採用", note);
  assert.equal(value, "不採用（2026-07-30・募集終了で応募機会なし）");
  assert.equal(normalizeJobStatus(value), "不採用");
  assert.equal(jobStatusNote(value), note);
});

test("an empty annotation drops the parentheses entirely", () => {
  assert.equal(composeJobStatus("不採用", ""), "不採用");
  assert.equal(composeJobStatus("不採用", "   "), "不採用");
  assert.equal(composeJobStatus("不採用", undefined), "不採用");
});

test("rejects annotations that would break the unquoted YAML line", () => {
  assert.equal(jobStatusNoteError(""), null);
  assert.equal(jobStatusNoteError("2026-07-30・募集終了"), null);
  // `status: 不採用（a: b）` は YAML のマッピングとして壊れる。
  assert.ok(jobStatusNoteError("a: b"));
  assert.ok(jobStatusNoteError("# comment"));
  assert.ok(jobStatusNoteError("募集終了 # メモ"));
  assert.ok(jobStatusNoteError("行1\n行2"));
  // 括弧は status と注記の区切りそのものなので、入れ子は読めなくなる。
  assert.ok(jobStatusNoteError("募集終了（社内都合）"));
  assert.ok(jobStatusNoteError("x".repeat(121)));
});
