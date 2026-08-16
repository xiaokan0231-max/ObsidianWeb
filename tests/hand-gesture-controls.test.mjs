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
  updatePinchInteraction,
} from "../lib/hand-gesture.mjs";
import { relationExploration } from "../lib/graph-relation-exploration.mjs";

const [graph, controls, css] = await Promise.all([
  readFile("app/knowledge-graph-three.tsx", "utf8"),
  readFile("app/graph-hand-controls.tsx", "utf8"),
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

  const held = updatePinchInteraction(pressed, 0.38, 380);
  assert.equal(held.event, "grab-start");
  assert.equal(held.grabbed, true);
  assert.equal(held.progress, 1);
  assert.equal(updatePinchInteraction(held, 0.82, 460).event, "release");
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

test("相机手势接入：抓住时平移与远近，放下后恢复 OrbitControls", () => {
  assert.ok(graph.includes("gestureFrameRef"));
  assert.ok(graph.includes("controls.enabled = false"));
  assert.ok(graph.includes("controls.enabled = true"));
  assert.ok(graph.includes("camera.position.add(translation)"));
  assert.ok(graph.includes("Math.exp(-scaleDelta * 3.4)"));
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
  assert.ok(controls.includes("RADIAL_MENU_HOLD_MS"));
  assert.ok(controls.includes("radialActionAt"));
  assert.ok(controls.includes("短捏选择 · 捏住抓取"));
  assert.ok(!controls.includes("STATIC_ACTIONS"), "点赞、倒赞和 ILY 不应再直接抢占镜头");
  assert.ok(css.includes(".graph-hand-radial"));
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
  assert.ok(controls.includes("graph-hand-cursor"));
  assert.ok(controls.includes("--pinch-progress"));
  assert.ok(css.includes(".graph-hand-cursor[data-grabbed=\"true\"]"));
  assert.ok(css.includes("conic-gradient(currentColor var(--pinch-progress)"));
  assert.ok(css.includes(".graph-hand-guide"));
});
