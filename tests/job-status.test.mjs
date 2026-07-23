import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJobStatus } from "../lib/job-status.mjs";

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
