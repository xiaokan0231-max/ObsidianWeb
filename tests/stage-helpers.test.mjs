import assert from "node:assert/strict";
import test from "node:test";
import { approachValues, createRenderGate, flightCarry, speedFeel } from "../lib/stage-motion.mjs";
import { estimateLabelWidth, staggerLabels } from "../lib/stage-interaction.mjs";

test("明暗渐变：逐元素趋近目标，收敛后报告停止", () => {
  const current = new Float32Array([0, 1, 0.5]);
  const target = [1, 1, 0];
  assert.equal(approachValues(current, target, 0.5), 2, "还没到位就报告仍在移动");
  assert.ok(Math.abs(current[0] - 0.5) < 1e-6);
  assert.equal(current[1], 1, "已经在目标上的不动");
  assert.ok(Math.abs(current[2] - 0.25) < 1e-6);
  let state = 2;
  for (let frame = 0; frame < 40 && state === 2; frame += 1) {
    state = approachValues(current, target, 0.5);
  }
  assert.equal(state, 1, "最后一步对齐目标：有改动、已收敛");
  assert.deepEqual([...current], target);
  assert.equal(approachValues(current, target, 0.5), 0, "收敛以后不再有改动，调用方据此停止上传缓冲");
});

test("减弱动态时 rate=1，一步到位", () => {
  const current = new Float32Array([0, 0.3]);
  assert.equal(approachValues(current, [0.42, 0], 1), 1);
  assert.deepEqual([...current].map((value) => Math.round(value * 100) / 100), [0.42, 0]);
});

test("按需渲染闸门：有动静就画，静止后再等 settleFrames 帧才跳过，输入立刻唤醒", () => {
  const gate = createRenderGate(3);
  assert.equal(gate.shouldRender(false), true, "首帧总要画（初始即脏）");
  assert.equal(gate.shouldRender(false), true);
  assert.equal(gate.shouldRender(false), true);
  assert.equal(gate.shouldRender(false), true);
  assert.equal(gate.shouldRender(false), false, "连续静止超过 3 帧才跳过");
  assert.equal(gate.shouldRender(false), false);
  gate.invalidate();
  assert.equal(gate.shouldRender(false), true, "任何输入都要立刻重画");
  assert.equal(gate.shouldRender(true), true);
  assert.equal(gate.quietFrames, 0, "活动帧把静止计数清零");
});

test("滚轮速度感：按满速阈值归一，方向无关，封顶 1", () => {
  assert.equal(speedFeel(0), 0);
  assert.equal(speedFeel(20, 40), 0.5);
  assert.equal(speedFeel(-20, 40), 0.5, "往当下滚和往过去滚一样有速度感");
  assert.equal(speedFeel(72, 40), 1);
  assert.equal(speedFeel(Number.NaN, 40), 0);
});

test("飞行底座：从起飞时的 fov 淡回基准，起止两端分毫不差", () => {
  // 航道滚轮速度感把 fov 抬到 47，起飞第一帧仍是 47，落地正好 43，中途单调回落。
  assert.equal(flightCarry(47, 43, 0), 47);
  assert.equal(flightCarry(47, 43, 1), 43);
  assert.equal(flightCarry(47, 43, 0.5), 45);
  const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map((progress) => flightCarry(47, 43, progress));
  assert.ok(samples.every((value, index) => index === 0 || value <= samples[index - 1]), "不回弹");
  // 星图起飞时就在基准：退化为常量，与改动前逐位相同。
  for (const progress of [0, 0.37, 1]) assert.equal(flightCarry(43, 43, progress), 43);
  assert.equal(flightCarry(0.042, 0.042, 0.5), 0.042);
  // 进度越界与坏值兜底：越界按端点算，起飞值不是数时当作已在基准。
  assert.equal(flightCarry(47, 43, -1), 47);
  assert.equal(flightCarry(47, 43, 2), 43);
  assert.equal(flightCarry(Number.NaN, 43, 0), 43);
  assert.equal(flightCarry(47, 43, Number.NaN), 43);
});

test("标签错开：横向重叠又挨得太近的往下推一行，不重叠的不动", () => {
  const items = [
    { id: "a", x: 100, y: 100, width: 80 },
    { id: "b", x: 110, y: 105, width: 80 },
    { id: "c", x: 400, y: 104, width: 80 },
    { id: "d", x: 105, y: 108, width: 80 },
  ];
  staggerLabels(items, { rowHeight: 16 });
  const byId = Object.fromEntries(items.map((item) => [item.id, item.y]));
  assert.equal(byId.a, 100, "最上面的不动");
  assert.equal(byId.b, 116, "与 a 重叠：推到 a 下面一行");
  assert.equal(byId.c, 104, "横向离得远的不受影响");
  assert.equal(byId.d, 132, "推下去以后又压到 b，要继续往下");
});

test("标签错开：超过 maxShift 的标为 dropped，不再挡后面的标签", () => {
  const items = [
    { id: "a", x: 100, y: 100, width: 80 },
    { id: "b", x: 102, y: 101, width: 80 },
    { id: "c", x: 104, y: 102, width: 80 },
    { id: "d", x: 106, y: 103, width: 80 },
  ];
  staggerLabels(items, { rowHeight: 16, maxShift: 32 });
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  assert.equal(byId.a.dropped, false);
  assert.equal(byId.b.y, 116);
  assert.equal(byId.c.y, 132, "推两行还在上限内");
  assert.equal(byId.d.dropped, true, "要推三行的隐藏");
  assert.equal(byId.d.y, 103, "隐藏的保持原位，不影响下一帧排序");
});

test("标签宽度估算：全角按一个字号、半角按 0.6 个字号", () => {
  assert.equal(estimateLabelWidth("", 12, 18), 18);
  assert.equal(estimateLabelWidth("株式会社", 12, 0), 48);
  assert.ok(Math.abs(estimateLabelWidth("abc", 10, 0) - 18) < 1e-9);
});
