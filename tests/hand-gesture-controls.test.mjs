import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readAppCss } from "./css-source.mjs";
import {
  gestureScoreThreshold,
  handPoseFromLandmarks,
  inferCommandGestureFromLandmarks,
  derivePinchThresholds,
  matchHandDetections,
  resolvePrimaryHandId,
  nextGrabState,
  smoothHandPose,
  twoHandMetrics,
  twoHandTransformDelta,
  updateGestureHold,
  updatePinchEnvelope,
  updatePinchInteraction,
} from "../lib/hand-gesture.mjs";
import { relationExploration } from "../lib/graph-relation-exploration.mjs";

const [graph, controls, stage, css] = await Promise.all([
  readFile("app/knowledge-graph-three.tsx", "utf8"),
  readFile("app/graph-hand-controls.tsx", "utf8"),
  readFile("app/three-stage.ts", "utf8"),
  readAppCss(),
]);

test("手势几何：自拍镜像、抓取滞回和低通平滑", () => {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.4, y: 0.5, z: 0 }));
  landmarks[0] = { x: 0.4, y: 0.8, z: 0 };
  landmarks[5] = { x: 0.3, y: 0.5, z: 0 };
  landmarks[9] = { x: 0.4, y: 0.4, z: 0 };
  landmarks[13] = { x: 0.5, y: 0.5, z: 0 };
  landmarks[17] = { x: 0.6, y: 0.5, z: 0 };
  landmarks[4] = { x: 0.42, y: 0.3, z: 0 };
  landmarks[8] = { x: 0.44, y: 0.3, z: 0 };

  const pose = handPoseFromLandmarks(landmarks);
  assert.ok(pose);
  assert.ok(Math.abs(pose.x - 0.56) < 1e-9, "自拍画面 x 必须镜像");
  assert.equal(nextGrabState(false, "Closed_Fist", 0.8, 1), true);
  assert.equal(nextGrabState(true, "Open_Palm", 0.8, 0.2), false);
  assert.equal(nextGrabState(false, "None", 0, 0.3), true, "捏合也能抓住");
  assert.equal(nextGrabState(true, "None", 0, 0.55), true, "滞回区保持上次状态");
  assert.equal(nextGrabState(true, "None", 0, 0.9), false);
  assert.equal(
    nextGrabState(true, "Thumb_Up", 0.8, 0.55),
    false,
    "明确的命令手势必须先释放抓取",
  );

  assert.deepEqual(
    smoothHandPose({ x: 0, y: 0, scale: 1, pinchRatio: 1 }, {
      x: 1, y: 1, scale: 2, pinchRatio: 0,
    }, 0.25),
    { x: 0.25, y: 0.25, scale: 1.25, pinchRatio: 0.75 },
  );
});

function commandLandmarks(direction) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6, z: 0 }));
  const up = direction !== "down";
  points[0] = { x: 0.5, y: up ? 0.8 : 0.2, z: 0 };
  points[2] = { x: 0.49, y: up ? 0.68 : 0.34, z: 0 };
  points[3] = { x: 0.5, y: up ? 0.52 : 0.5, z: 0 };
  points[4] = { x: 0.5, y: up ? 0.3 : 0.72, z: 0 };
  for (const [mcp, pip, tip, x] of [
    [5, 6, 8, 0.4],
    [9, 10, 12, 0.47],
    [13, 14, 16, 0.54],
    [17, 18, 20, 0.61],
  ]) {
    points[mcp] = { x, y: up ? 0.62 : 0.38, z: 0 };
    points[pip] = { x, y: 0.5, z: 0 };
    points[tip] = { x: x + 0.08, y: up ? 0.61 : 0.39, z: 0 };
  }
  return points;
}

test("难识别命令：拇指/ILY 有几何兜底，短暂漏帧不会清空确认进度", () => {
  assert.equal(inferCommandGestureFromLandmarks(commandLandmarks("up")), "Thumb_Up");
  assert.equal(inferCommandGestureFromLandmarks(commandLandmarks("down")), "Thumb_Down");

  const ily = commandLandmarks("up");
  ily[2] = { x: 0.44, y: 0.68, z: 0 };
  ily[3] = { x: 0.31, y: 0.62, z: 0 };
  ily[4] = { x: 0.16, y: 0.56, z: 0 };
  ily[5] = { x: 0.4, y: 0.62, z: 0 };
  ily[6] = { x: 0.39, y: 0.45, z: 0 };
  ily[8] = { x: 0.38, y: 0.2, z: 0 };
  ily[17] = { x: 0.62, y: 0.64, z: 0 };
  ily[18] = { x: 0.66, y: 0.48, z: 0 };
  ily[20] = { x: 0.71, y: 0.25, z: 0 };
  assert.equal(inferCommandGestureFromLandmarks(ily), "ILoveYou");
  assert.ok(gestureScoreThreshold("Thumb_Up") < gestureScoreThreshold("Open_Palm"));

  const first = updateGestureHold(null, "Thumb_Up", 0);
  const missed = updateGestureHold(first, "None", 80);
  assert.equal(missed.gesture, "Thumb_Up");
  assert.equal(missed.evidenceFrames, 1, "漏帧不能伪造新的识别证据");
  const recovered = updateGestureHold(missed, "Thumb_Up", 140);
  assert.equal(recovered.evidenceFrames, 2);
  assert.equal(updateGestureHold(recovered, "None", 500).gesture, "None");
});

test("统一捏合语法：短捏选择、长捏抓取、松手释放，并保留开合滞回", () => {
  const pressed = updatePinchInteraction(null, 0.4, 0);
  assert.equal(pressed.event, "press");
  assert.equal(pressed.grabbed, false, "刚捏下不能立刻拖走图谱");
  const jitter = updatePinchInteraction(pressed, 0.56, 90);
  assert.equal(jitter.pinching, true, "开合阈值之间要保持按下状态");
  assert.equal(updatePinchInteraction(jitter, 0.8, 150).event, "select");

  // 15fps 推理下「干脆捏一下」只会被采到一帧，press 与 release 相隔 66.7ms。
  // 旧实现的 70ms 下限刚好把这种最标准的短捏判成 cancel 丢掉。
  const tapPress = updatePinchInteraction(null, 0.4, 0);
  const tapRelease = updatePinchInteraction(tapPress, 0.85, 1000 / 15);
  assert.equal(tapRelease.event, "select", "一帧的短捏必须算数，不能被静默丢弃");
  assert.equal(
    updatePinchInteraction(tapPress, 0.85, 8).event,
    "cancel",
    "真正的亚帧抖动仍然要被挡掉",
  );

  const held = updatePinchInteraction(pressed, 0.38, 380);
  assert.equal(held.event, "grab-start");
  assert.equal(held.grabbed, true);
  assert.equal(held.progress, 1);
  assert.equal(updatePinchInteraction(held, 0.82, 460).event, "release");
});

test("捏合包络：阈值从这只手实际用到的区间里取，不依赖任何绝对值", () => {
  // 手侧过来时掌心尺度被压缩，同一个捏合动作的 pinchRatio 会整体抬高。
  // 固定 0.46 在这种手上永远够不到；包络必须跟着抬。
  let envelope = null;
  const open = 1.15;
  const closed = 0.62;
  for (let frame = 0; frame < 12; frame += 1) {
    envelope = updatePinchEnvelope(envelope, frame % 2 ? closed : open, frame * 66.7);
  }
  assert.equal(envelope.confident, true, "张合跨度够大就应该给出阈值");
  assert.ok(
    envelope.closeThreshold > closed && envelope.closeThreshold < open,
    `阈值 ${envelope.closeThreshold} 必须落在这只手的张合区间里`,
  );
  // 这只手全程没有低于 0.62，固定阈值 0.46 会完全失效。
  assert.ok(closed > 0.46, "构造的样本正是固定阈值够不到的那种手");
  assert.equal(
    updatePinchInteraction(null, closed, 0, envelope).pinching,
    true,
    "包络阈值必须让这只手也能捏得动",
  );

  // 跨度不够就不给阈值，让调用方回落默认值，而不是拿噪声当信号。
  let flat = null;
  for (let frame = 0; frame < 8; frame += 1) {
    flat = updatePinchEnvelope(flat, 0.9 + (frame % 2) * 0.02, frame * 66.7);
  }
  assert.equal(flat.confident, false);
  assert.equal(flat.closeThreshold, null);

  // 一次极端值不能把区间永久撑死：静置一段时间后包络要收回来。
  let spiked = updatePinchEnvelope(null, 1.2, 0);
  spiked = updatePinchEnvelope(spiked, 0.1, 66.7);
  const wideSpan = spiked.max - spiked.min;
  for (let frame = 2; frame < 90; frame += 1) {
    spiked = updatePinchEnvelope(spiked, 0.7, frame * 66.7);
  }
  assert.ok(spiked.max - spiked.min < wideSpan, "陈旧的极值必须随时间失效");
});

test("归一化坐标各向异性：同一个捏合竖着捏和横着捏必须读数一致", () => {
  const base = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const withPinch = (dx, dy) => {
    const points = base.map((point) => ({ ...point }));
    // 掌心：指节连线横向，腕到中指纵向
    points[5] = { x: 0.44, y: 0.5, z: 0 };
    points[17] = { x: 0.56, y: 0.5, z: 0 };
    points[0] = { x: 0.5, y: 0.56, z: 0 };
    points[9] = { x: 0.5, y: 0.44, z: 0 };
    points[4] = { x: 0.5, y: 0.5, z: 0 };
    points[8] = { x: 0.5 + dx, y: 0.5 + dy, z: 0 };
    return points;
  };
  const aspect = 640 / 480;
  // 同一段物理长度：横着 0.03 宽度单位，竖着要写成 0.03×aspect 才等长。
  const horizontal = handPoseFromLandmarks(withPinch(0.03, 0), { aspect });
  const vertical = handPoseFromLandmarks(withPinch(0, 0.03 * aspect), { aspect });
  assert.ok(
    Math.abs(horizontal.pinchRatio - vertical.pinchRatio) < 1e-9,
    `校正后横竖读数必须一致：${horizontal.pinchRatio} vs ${vertical.pinchRatio}`,
  );
  // 不传 aspect 时保持旧行为，既有断言不受影响。
  const naive = handPoseFromLandmarks(withPinch(0.03, 0));
  assert.ok(Number.isFinite(naive.pinchRatio));
});

test("滞回带有绝对下限：窄包络也不能靠一帧抖动误选", () => {
  let envelope = null;
  // 只比 minSpan 略宽的包络：按比例算滞回带只有 0.04 宽。
  for (let frame = 0; frame < 10; frame += 1) {
    envelope = updatePinchEnvelope(envelope, frame % 2 ? 0.5 : 0.68, frame * 66.7);
  }
  assert.equal(envelope.confident, true);
  assert.ok(
    envelope.releaseThreshold - envelope.closeThreshold > 0.0999,
    `滞回带 ${envelope.releaseThreshold - envelope.closeThreshold} 太窄，单帧噪声会误选`,
  );
});

test("长按不能把包络自己压塌：跨度回收有下限", () => {
  // 先张合几轮建立包络，再模拟一次长时间按住不放。
  let envelope = null;
  for (let frame = 0; frame < 10; frame += 1) {
    envelope = updatePinchEnvelope(envelope, frame % 2 ? 0.25 : 0.95, frame * 66.7);
  }
  assert.equal(envelope.confident, true);
  const heldRatio = 0.25;
  // 按住 20 秒：min 被钉在低位，只有 max 在单向衰减。
  for (let frame = 10; frame < 310; frame += 1) {
    envelope = updatePinchEnvelope(envelope, heldRatio, frame * 66.7);
  }
  assert.equal(
    envelope.confident,
    true,
    "按住二十秒后 confident 不能翻假——那会让阈值在拖拽途中回落到默认值",
  );
  assert.ok(
    envelope.max - envelope.min >= 0.16 - 1e-9,
    `跨度 ${envelope.max - envelope.min} 被回收压到了下限以下`,
  );
});

test("双手轨道：识别数组换序时保持稳定 id，handedness 只作为辅助成本", () => {
  const previous = [
    { id: "hand-1", x: 0.2, y: 0.5, handedness: "Left" },
    { id: "hand-2", x: 0.8, y: 0.5, handedness: "Right" },
  ];
  const swapped = [
    { x: 0.79, y: 0.51, handedness: "Right" },
    { x: 0.21, y: 0.49, handedness: "Left" },
  ];
  const result = matchHandDetections(previous, swapped);
  assert.deepEqual(
    result.matches.map(({ previousIndex, detectionIndex }) => [previousIndex, detectionIndex]),
    [[0, 1], [1, 0]],
  );
  const noisyHandedness = matchHandDetections(previous, [
    { x: 0.21, y: 0.5, handedness: "Right" },
    { x: 0.79, y: 0.5, handedness: "Left" },
  ]);
  assert.deepEqual(
    noisyHandedness.matches.map(({ previousIndex, detectionIndex }) => [previousIndex, detectionIndex]),
    [[0, 0], [1, 1]],
    "位置连续性必须压过单帧左右手标签抖动",
  );
});

test("主辅角色：辅助手按下不抢角色，主手遮挡超过 350ms 后才接管", () => {
  const hands = [
    { id: "main", lastSeen: 1000, visible: false },
    { id: "support", lastSeen: 1300, visible: true, event: "press" },
  ];
  assert.equal(resolvePrimaryHandId("main", hands, 1300), "main", "250ms 遮挡必须保持主手");
  assert.equal(resolvePrimaryHandId("main", hands, 1351), "support", "超过 350ms 才允许接管");
  assert.equal(
    resolvePrimaryHandId("main", [
      { id: "main", lastSeen: 1400, visible: true },
      { id: "support", lastSeen: 1400, visible: true, event: "press" },
    ], 1400),
    "main",
    "关系目标短捏不能交换主辅角色",
  );
});

test("双手几何：中点平移、手距缩放、连线旋转，并保护异常近距离", () => {
  const before = twoHandMetrics(
    { id: "a", x: 0.2, y: 0.5 },
    { id: "b", x: 0.6, y: 0.5 },
  );
  const after = twoHandMetrics(
    { id: "b", x: 0.72, y: 0.55 },
    { id: "a", x: 0.22, y: 0.45 },
  );
  const delta = twoHandTransformDelta(before, after);
  assert.ok(delta);
  assert.ok(Math.abs(delta.dx - 0.05) < 1e-9, "逐帧平移应限制跳变");
  assert.ok(delta.scaleRatio > 1);
  assert.ok(delta.rotationDelta > 0);
  const unsafe = twoHandTransformDelta(
    { centerX: 0.5, centerY: 0.5, distance: 0.02, angle: 0 },
    { centerX: 0.51, centerY: 0.5, distance: 0.04, angle: 1 },
  );
  assert.equal(unsafe.scaleRatio, 1);
  assert.equal(unsafe.rotationDelta, 0);
});

test("捏合校准：从开合中位数生成滞回阈值，坏样本回退默认值", () => {
  const calibrated = derivePinchThresholds(
    [0.95, 1.02, 1, 0.98],
    [0.22, 0.25, 0.24, 0.23],
  );
  assert.equal(calibrated.calibrated, true);
  assert.ok(calibrated.closeThreshold < calibrated.releaseThreshold);
  const state = updatePinchInteraction(null, calibrated.closeThreshold - 0.01, 0, calibrated);
  assert.equal(state.pinching, true);
  assert.deepEqual(
    derivePinchThresholds([0.5], [0.42]),
    { closeThreshold: 0.46, releaseThreshold: 0.68, calibrated: false },
  );
});

test("关系探索：确定性最短路径、方向保留、六边上限与共同邻居排序", () => {
  const nodes = [
    { id: "a", degree: 1 }, { id: "b", degree: 2 }, { id: "c", degree: 9 },
    { id: "d", degree: 4 }, { id: "e", degree: 3 }, { id: "f", degree: 2 },
    { id: "g", degree: 2 }, { id: "h", degree: 1 },
  ];
  const links = [
    { source: "a", target: "b", relationLabel: "A→B", directed: true },
    { source: "b", target: "d", relationLabel: "B→D", directed: true },
    { source: "a", target: "c", relationLabel: "A→C", directed: true },
    { source: "c", target: "d", relationLabel: "C→D", directed: true },
    { source: "a", target: "e" }, { source: "d", target: "e" },
    { source: "d", target: "f" }, { source: "f", target: "g" },
    { source: "g", target: "h" },
  ];
  const result = relationExploration(nodes, links, "a", "d");
  assert.deepEqual(result.pathIds, ["a", "b", "d"], "同长度路径按 id 稳定选择");
  assert.equal(result.pathLinks[0].relationLabel, "A→B");
  assert.deepEqual(result.commonNeighborIds, ["c", "e", "b"]);
  assert.equal(relationExploration(nodes, links, "a", "h", 3).connected, false);
});

test("摄像头生命周期只绑定全屏，退出立即停轨道和识别器", () => {
  assert.ok(graph.includes("active={fullscreen}"));
  assert.ok(controls.includes("navigator.mediaDevices.getUserMedia"));
  assert.ok(controls.includes("track.stop()"));
  assert.ok(controls.includes("recognizer?.close()"));
  assert.ok(controls.includes('import("@mediapipe/tasks-vision")'), "模型代码必须延迟到全屏后加载");
  assert.ok(controls.includes("INFERENCE_INTERVAL_MS"), "识别要限帧，不能堵住 Three 主循环");
  assert.ok(controls.includes("numHands: 2"), "双手必须在同一次 MediaPipe 推理中识别");
  assert.ok(controls.includes("TRACKING_GRACE_MS"), "短暂遮挡必须保留手的身份和状态");
});

test("相机手势接入：单手捏住拖动＝转视角，双手才平移，放下后恢复 OrbitControls", () => {
  assert.ok(graph.includes("gestureFrameRef"));
  assert.ok(graph.includes("controls.enabled = false"));
  assert.ok(graph.includes("controls.enabled = true"));
  // 单手捏住拖动必须走 OrbitControls 自己的旋转入口：手感、阻尼和角度上限
  // 都要和鼠标拖动共用一套，不能另写一份相机数学。
  assert.ok(graph.includes("controls.rotateLeft("), "捏住拖动要转视角");
  assert.ok(graph.includes("controls.rotateUp("));
  assert.ok(
    graph.includes("2 * Math.PI * orbitUnitsX * controls.rotateSpeed"),
    "换算必须与 OrbitControls 的 _handleMouseMoveRotate 同一条",
  );
  // 手的 x 除以画面宽、y 除以画面高；不乘回宽高比，横向会比纵向快 1.78 倍。
  assert.ok(
    graph.includes("dx * Math.max(0.0001, frame.frameAspect)"),
    "转视角必须等距，横竖不能有增益差",
  );
  // 单手不再推拉：掌心尺寸是 2D 投影，腕部一俯仰就变。缩放只留给双手张合。
  assert.ok(!graph.includes("steadyForZoom"), "单手捏住不该再有推拉");
  assert.ok(!graph.includes("Math.exp(-scaleDelta * 3.4)"), "单手 dolly 已删除");
  // 手滑出画面的帧不吃位移，抓住状态保持。
  assert.ok(graph.includes("previousPrimary?.grabbed && primary.visible"));
  assert.ok(
    !/const translation = right\.multiplyScalar\(-dx \* distance/.test(graph),
    "单手不再平移镜头，平移交给双手",
  );
  assert.ok(graph.includes("camera.position.add(translation)"), "双手仍然平移");
  assert.ok(graph.includes("controls.minDistance"));
  assert.ok(graph.includes("controls.maxDistance"));
  assert.ok(graph.includes("frame.mode === \"dual-transform\""));
  assert.ok(graph.includes("frame.transform.scaleRatio"));
  assert.ok(graph.includes("frame.transform.rotationDelta"));
  assert.ok(graph.includes("applyAxisAngle(worldUp, yaw)"), "双手连线只做水平旋转，不能引入滚转");
});

test("主交互收敛成掌心瞄准和捏合，复杂功能放进可见的 V 手势菜单", () => {
  for (const action of [
    "select-target",
    "reset-view",
    "open-selected",
    "select-previous",
    "select-next",
    "toggle-pause",
  ]) {
    assert.ok(controls.includes(`\"${action}\"`), `缺少 ${action}`);
  }
  assert.ok(controls.includes("updatePinchInteraction"));
  // 手离场再回来要继承上次学到的区间，不能退回默认 0.46 再学两三秒。
  assert.ok(controls.includes("seededEnvelope(envelopeSeedRef.current"), "新手要用包络种子起步");
  assert.ok(controls.includes("envelope: envelopeSeedRef.current"), "包络要写进存档");
  assert.ok(!controls.includes("{ ...thresholdsRef.current, holdMs: 360 }"), "首帧不能再单独用存档阈值裁一次");
  // 读数用判定同源的裸值；包络没学会时不能把默认值冒充成学到的。
  assert.ok(controls.includes("primary.rawPinchRatio.toFixed(2)"));
  assert.ok(controls.includes("学习中 · 暂用"));
  // 主手宽限要拿全集算，否则 350ms 永远够不到。
  assert.ok(controls.includes("[...runtimeHands.values()].map((hand) => ({"));
  // 双手起手只认看得见的手，且不再拿分开距离当入口闸。
  assert.ok(controls.includes("(dualActive ? usableHands : visibleHands)"));
  assert.ok(!controls.includes("metrics.distance >= MIN_DUAL_SEPARATION"));
  // 单手转视角优先于第二只手入镜。
  assert.ok(/mode = "single-orbit";[\s\S]{0,200}mode = "dual-ready"/.test(controls), "single-orbit 要排在 dual-ready 之前");
  assert.ok(graph.includes("writeStageFogUniforms(linkMaterial.uniforms"), "关系线也要吃雾");
  assert.ok(controls.includes("RADIAL_MENU_HOLD_MS"));
  assert.ok(controls.includes("radialActionAt"));
  assert.ok(controls.includes("短捏选择 · 捏住转视角"), "提示语要教的是转视角，不是抓取");
  assert.ok(!controls.includes("STATIC_ACTIONS"), "点赞、倒赞和 ILY 不应再直接抢占镜头");
  assert.ok(css.includes(".graph-hand-radial"));
  assert.ok(
    /prefers-reduced-motion: reduce\) \{[\s\S]{0,900}\.space-graph-dossier-orbit/.test(css),
    "减弱动态要停掉档案的无限轨道动画",
  );
  assert.ok(css.includes(".graph-hand-dual-link"));
});

test("双手关系探索：双射线稳定预览、短捏锁定，路径只读现有 links", () => {
  assert.ok(controls.includes("toggle-relation-target"));
  assert.ok(graph.includes("relationCandidate"));
  assert.ok(graph.includes(">= 180"));
  assert.ok(graph.includes("relationExploration(nodes, validLinks"));
  assert.ok(graph.includes("showRelationExploration"));
  assert.ok(graph.includes("commonNeighborIds"));
  assert.ok(controls.includes("当前可见关系中没有连接"));
  assert.ok(css.includes(".graph-hand-relation"));
});

test("实体反馈：掌心射线、磁吸目标、确认进度、3D 锚点与轻微释放惯性", () => {
  assert.ok(graph.includes("gestureHitTest"));
  assert.ok(graph.includes("new THREE.LineDashedMaterial"));
  assert.ok(graph.includes("showGestureContact"));
  assert.ok(graph.includes("publishHandTarget"));
  assert.ok(graph.includes("pinchTargets"), "每只手捏下后必须分别锁定目标，防止手抖换点");
  assert.ok(graph.includes("releasedPinchTargets"), "短捏松手帧也必须使用按下时锁定的目标");
  assert.ok(graph.includes("gestureInertia.multiplyScalar(0.78)"));
  assert.ok(graph.includes("new THREE.TorusGeometry"));
  assert.ok(graph.includes("showGestureAnchor"));
  assert.ok(graph.includes("root.worldToLocal(worldPosition.clone())"));
  assert.ok(graph.includes("syncGestureEffects"), "手势必须驱动与鼠标相同的粒子力场");
  assert.ok(graph.includes("frame.transform?.centerX"), "双手特效要落在两手中点");
  assert.ok(stage.includes("setExternalInteraction"), "共享能量探针必须接受手势输入");
  assert.ok(controls.includes("graph-hand-cursor"));
  assert.ok(controls.includes("--pinch-progress"));
  assert.ok(css.includes(".graph-hand-cursor[data-grabbed=\"true\"]"));
  assert.ok(css.includes("conic-gradient(currentColor var(--pinch-progress)"));
  assert.ok(css.includes(".graph-hand-guide"));
});
