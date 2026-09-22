import assert from "node:assert/strict";
import test from "node:test";
import { createStageInteraction } from "../lib/stage-interaction.mjs";

const SNAPSHOT_KEYS = [
  "source", "phase", "x", "y", "targetX", "targetY", "velocityX", "velocityY",
  "tiltX", "tiltY", "energy", "dragEnergy", "releaseImpulse", "active", "dragging",
];

function tickFor(controller, from, to, fps) {
  const frame = 1000 / fps;
  for (let now = from + frame; now < to - 1e-7; now += frame) controller.tick(now);
  return controller.tick(to);
}

function fixedTimeline(fps, source = "pointer") {
  const controller = createStageInteraction();
  controller.setInput({ source, kind: "move", x: 0.18, y: 0.72, energy: 0.42, time: 0 });
  tickFor(controller, 0, 240, fps);
  controller.setInput({ source, kind: "press", x: 0.42, y: 0.61, energy: 0.74, time: 240 });
  tickFor(controller, 240, 420, fps);
  controller.setInput({ source, kind: "drag", x: 0.82, y: 0.24, energy: 0.96, time: 420 });
  tickFor(controller, 420, 760, fps);
  controller.endInput(source, 760);
  tickFor(controller, 760, 1050, fps);
  return controller.snapshot();
}

test("统一舞台状态覆盖完整的跟踪、操作、释放和归稳阶段", () => {
  const interaction = createStageInteraction();
  assert.deepEqual(Object.keys(interaction.snapshot()), SNAPSHOT_KEYS);
  assert.equal(interaction.snapshot().phase, "idle");

  assert.equal(interaction.setInput({
    source: "pointer", kind: "move", x: 0.7, y: 0.3, energy: 0.4, time: 0,
  }).phase, "tracking");
  assert.equal(interaction.setInput({
    source: "pointer", kind: "press", x: 0.7, y: 0.3, energy: 0.7, time: 100,
  }).phase, "pressing");
  const dragging = interaction.setInput({
    source: "pointer", kind: "drag", x: 0.8, y: 0.25, energy: 1, time: 180,
  });
  assert.equal(dragging.phase, "manipulating");
  assert.equal(dragging.dragging, true);

  const released = interaction.endInput("pointer", 260);
  assert.equal(released.phase, "released");
  assert.ok(released.releaseImpulse > 0);
  assert.equal(interaction.tick(400).phase, "settling");
  assert.equal(interaction.tick(4000).phase, "idle");
  assert.equal(interaction.snapshot().source, null);
});

test("临界阻尼和指数衰减在 15/30/60/120fps 下近似一致", () => {
  const baseline = fixedTimeline(120);
  for (const fps of [15, 30, 60]) {
    const actual = fixedTimeline(fps);
    for (const key of [
      "x", "y", "velocityX", "velocityY", "tiltX", "tiltY",
      "energy", "dragEnergy", "releaseImpulse",
    ]) {
      assert.ok(
        Math.abs(actual[key] - baseline[key]) < 1e-9,
        `${fps}fps 的 ${key} 不应依赖渲染帧率`,
      );
    }
    assert.equal(actual.phase, baseline.phase);
  }
});

test("离场撤掉作用力但保留最后目标，首帧不会瞬移回中心", () => {
  const interaction = createStageInteraction();
  interaction.setInput({
    source: "pointer", kind: "move", x: 0.88, y: 0.16, energy: 0.55, time: 0,
  });
  interaction.tick(320);
  const before = interaction.snapshot();
  const ended = interaction.endInput("pointer", 320);
  assert.equal(ended.x, before.x);
  assert.equal(ended.y, before.y);
  assert.equal(ended.targetX, 0.88);
  assert.equal(ended.targetY, 0.16);

  const firstFrame = interaction.tick(1000 / 60 + 320);
  assert.ok(Math.hypot(firstFrame.x - before.x, firstFrame.y - before.y) < 0.02);
  assert.ok(Math.abs(firstFrame.tiltX) <= Math.abs(before.tiltX) + 0.001);
});

test("鼠标与手势输入相同轨迹时得到相同动力学快照", () => {
  const pointer = fixedTimeline(60, "pointer");
  const hand = fixedTimeline(60, "hand");
  for (const key of SNAPSHOT_KEYS.filter((key) => key !== "source")) {
    assert.deepEqual(hand[key], pointer[key], key);
  }
  assert.equal(pointer.source, "pointer");
  assert.equal(hand.source, "hand");
});

test("按压和拖拽期间锁定输入源，不会被另一来源抢占", () => {
  const interaction = createStageInteraction();
  interaction.setInput({
    source: "pointer", kind: "press", x: 0.2, y: 0.3, energy: 0.7, time: 0,
  });
  interaction.setInput({
    source: "hand", kind: "drag", x: 0.9, y: 0.8, energy: 1, time: 40,
  });
  let snapshot = interaction.snapshot();
  assert.equal(snapshot.source, "pointer");
  assert.equal(snapshot.phase, "pressing");
  assert.equal(snapshot.targetX, 0.2);

  interaction.setInput({
    source: "pointer", kind: "drag", x: 0.4, y: 0.5, energy: 1, time: 80,
  });
  interaction.setInput({
    source: "hand", kind: "press", x: 0.85, y: 0.15, energy: 0.8, time: 100,
  });
  snapshot = interaction.snapshot();
  assert.equal(snapshot.source, "pointer");
  assert.equal(snapshot.phase, "manipulating");
  assert.equal(snapshot.targetX, 0.4);
});

test("取消操作直接归稳且不会制造释放冲量", () => {
  const interaction = createStageInteraction();
  interaction.setInput({
    source: "hand", kind: "drag", x: 0.76, y: 0.22, energy: 1, time: 0,
  });
  interaction.tick(280);
  const cancelled = interaction.endInput("hand", 280, { cancelled: true });
  assert.equal(cancelled.phase, "settling");
  assert.equal(cancelled.active, false);
  assert.equal(cancelled.dragging, false);
  assert.equal(cancelled.releaseImpulse, 0);
  assert.equal(interaction.tick(420).releaseImpulse, 0);
});

test("关闭动画时立即采用目标值，并在离场后同步回到 idle", () => {
  const interaction = createStageInteraction();
  interaction.setInput({
    source: "pointer", kind: "move", x: 0.8, y: 0.2, energy: 0.5, time: 0,
  });
  const active = interaction.tick(16, false);
  assert.equal(active.x, 0.8);
  assert.equal(active.y, 0.2);
  assert.equal(active.energy, 0.5);
  interaction.endInput("pointer", 20);
  const idle = interaction.tick(36, false);
  assert.equal(idle.phase, "idle");
  assert.equal(idle.energy, 0);
  assert.equal(idle.tiltX, 0);
  assert.equal(idle.x, 0.8, "无动画模式也要保留最后位置");
});
