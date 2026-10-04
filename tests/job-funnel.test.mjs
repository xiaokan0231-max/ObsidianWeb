import assert from "node:assert/strict";
import test from "node:test";
import { funnelSteps, pipelineSegments } from "../lib/job-funnel.ts";

test("漏斗：相邻转化率以前一段为分母，首段与前段为 0 时是 null 而不是 0%", () => {
  const steps = funnelSteps([
    { stage: "応募", value: 16 },
    { stage: "書類通過", value: 10 },
    { stage: "面接実施", value: 0 },
    { stage: "内定", value: 0 },
  ]);
  assert.deepEqual(steps.map((step) => step.ofPrevious), [null, 0.625, 0, null]);
  assert.deepEqual(steps.map((step) => step.ofTop), [1, 0.625, 0, 0]);
});

test("漏斗：首段为 0 时比例全为 0；后段多于前段（观测口径）不截断", () => {
  assert.deepEqual(funnelSteps([{ stage: "応募", value: 0 }, { stage: "内定", value: 0 }]).map((step) => step.ofTop), [0, 0]);
  const [, over] = funnelSteps([{ stage: "書類通過", value: 2 }, { stage: "面接実施", value: 3 }]);
  assert.equal(over.ofPrevious, 1.5);
  assert.deepEqual(funnelSteps([]), []);
});

test("选考管线：按给定顺序数件数，0 件的段保留，合计为 0 时占比为 0", () => {
  const jobs = [{ status: "応募済" }, { status: "応募済" }, { status: "面接中" }, { status: "未応募" }];
  assert.deepEqual(pipelineSegments(jobs, ["応募済", "書類通過", "面接中", "内定"]), [
    { status: "応募済", count: 2, share: 2 / 3 },
    { status: "書類通過", count: 0, share: 0 },
    { status: "面接中", count: 1, share: 1 / 3 },
    { status: "内定", count: 0, share: 0 },
  ]);
  assert.deepEqual(pipelineSegments([], ["応募済"]), [{ status: "応募済", count: 0, share: 0 }]);
});
