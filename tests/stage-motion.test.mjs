import assert from "node:assert/strict";
import test from "node:test";
import {
  coastOffset,
  createPointerMotionField,
  MOTION_MASS_MAX,
  MOTION_MASS_MIN,
  MOTION_SETTLE_SECONDS,
  motionMass,
  strokeWeight,
} from "../lib/stage-motion.mjs";
import { readFileSync } from "node:fs";

const stage = readFileSync(new URL("../app/three-stage.ts", import.meta.url), "utf8");

function driveAlongX(field, fps, from, to, seconds) {
  const frames = Math.round(seconds * fps);
  for (let step = 1; step <= frames; step += 1) {
    field.push(from + (to - from) * (step / frames), 0);
    field.tick(1 / fps);
  }
}

test("滑行是解析解：起点为零、中途起峰、最终归位", () => {
  assert.equal(coastOffset(1, 1, 0), 0);
  const samples = Array.from({ length: 40 }, (_, index) => coastOffset(1, 1, index * 0.1));
  const peak = Math.max(...samples);
  const peakAt = samples.indexOf(peak) * 0.1;
  // 位移的峰值必须落在指针离开之后，而不是当场——这正是「停手才开始动」的手感来源。
  assert.ok(peakAt > 0.2 && peakAt < 1.6, `峰值时刻 ${peakAt} 落在预期之外`);
  assert.ok(peak > 0.1, "峰值位移太小，看不出被带走");
  assert.ok(Math.abs(coastOffset(1, 1, MOTION_SETTLE_SECONDS)) < 0.005, "回收年龄处应已归位");
  // 轻的粒子被带得更远，重的更迟钝。
  assert.ok(coastOffset(1, MOTION_MASS_MIN, 0.5) < coastOffset(1, MOTION_MASS_MAX, 0.5));
});

test("质量随尺寸单调上升并被夹在区间内", () => {
  assert.equal(motionMass(0), MOTION_MASS_MIN);
  assert.equal(motionMass(1), MOTION_MASS_MAX);
  assert.ok(motionMass(0.15) > motionMass(0.1));
  assert.ok(motionMass(0.25) > motionMass(0.15));
});

test("影响范围量到线段而不是点，快速划过不会漏掉中间的粒子", () => {
  const radius = 0.13;
  // 笔画从 (-0.5,0) 扫到 (0.5,0)；正中间的粒子必须被扫到。
  const middle = strokeWeight(0, 0, -0.5, 0, 1, 0, radius);
  assert.ok(middle > 0.9, `线段中点权重 ${middle} 太低，说明只按端点算了距离`);
  const off = strokeWeight(0, 0.4, -0.5, 0, 1, 0, radius);
  assert.equal(off, 0, "半径之外不该有影响");
  const near = strokeWeight(0, 0.05, -0.5, 0, 1, 0, radius);
  assert.ok(near > 0 && near < middle, "垂直距离越大权重越小");
});

test("笔画按时间窗切分，不同帧率下的动量总量一致", () => {
  const totals = [15, 30, 60, 120].map((fps) => {
    const field = createPointerMotionField();
    field.push(-0.6, 0);
    driveAlongX(field, fps, -0.6, 0.6, 0.5);
    let sum = 0;
    for (let index = 0; index < field.strokes; index += 1) {
      if (field.ages[index] >= MOTION_SETTLE_SECONDS) continue;
      sum += Math.hypot(field.impulses[index * 2], field.impulses[index * 2 + 1]);
    }
    return sum;
  });
  const [baseline] = totals;
  assert.ok(baseline > 0, "扫过一段之后必须留下动量");
  for (const total of totals) {
    assert.ok(
      Math.abs(total - baseline) / baseline < 0.08,
      `不同帧率的动量总量差得太多：${totals.join(", ")}`,
    );
  }
});

test("离场只断开笔画，已有动量继续滑行到自然停住", () => {
  const field = createPointerMotionField();
  field.push(-0.2, 0);
  field.push(0.2, 0);
  const during = field.offsetAt(0, 0, 1, 0.13);
  field.tick(0.4);
  field.lift();
  const afterLeave = field.offsetAt(0, 0, 1, 0.13);
  assert.ok(Math.hypot(...afterLeave) > Math.hypot(...during), "离场当帧位移不应塌回零");
  assert.equal(field.active, true);
  field.tick(MOTION_SETTLE_SECONDS);
  assert.equal(field.active, false, "超过回收年龄后必须自己安静下来");
  const settled = field.offsetAt(0, 0, 1, 0.13);
  assert.equal(Math.hypot(...settled), 0);
});

test("按下不写入笔画，重置清空全部动量", () => {
  const field = createPointerMotionField();
  field.push(-0.2, 0);
  field.push(0.2, 0);
  assert.equal(field.active, true);
  field.reset();
  assert.equal(field.active, false);
  assert.equal(Math.hypot(...field.offsetAt(0, 0, 1, 0.13)), 0);
});

test("释放涟漪是径向的，并与笔画共用同一套滑行解", () => {
  const field = createPointerMotionField();
  field.burst(0, 0, 1);
  assert.ok(field.releaseImpulse > 0);
  field.tick(0.5);
  assert.ok(field.releaseAge > 0 && field.releaseAge < MOTION_SETTLE_SECONDS);
  field.tick(MOTION_SETTLE_SECONDS);
  assert.equal(field.releaseImpulse, 0, "涟漪过期后必须清零，否则会一直留在 uniform 里");
});

test("着色器与 CPU 侧共用同一条滑行公式", () => {
  // 两边写法必须逐字一致，否则测试里验过的手感和画面上的不是一回事。
  assert.match(stage, /float drag = 2\.3 \/ sqrt\(mass\);/);
  assert.match(stage, /velocity \* \(exp\(-age\) - exp\(-drag \* age\)\) \/ \(drag - 1\.0\)/);
  // 距离必须量到线段（capsule），点采样会在快速划过时漏掉整排粒子。
  assert.match(stage, /length\(current - origin - segment \* t\)/);
  // 速度上限要夹在逐粒子这一层，夹累计冲量会让动量总量随帧率变化。
  assert.match(stage, /velocity \*= min\(1\.0, \$\{MOTION_SPEED_CLAMP\}/);
  // 语义节点不许形变，否则和 Raycaster、标签、手势锚点分家。
  assert.match(stage, /if \(uDeform > 0\.5\) \{/);
});
