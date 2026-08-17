import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readAppCss } from "./css-source.mjs";
import {
  fistDragEngagement,
  gestureScoreThreshold,
  handPoseFromLandmarks,
  isPinchPose,
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

test("握拳拖动判定：两帧证据起拖，丢帧继续，识别到张掌当帧即停", () => {
  const first = updateGestureHold(null, "Closed_Fist", 0);
  assert.equal(fistDragEngagement(first, "Closed_Fist"), false, "单帧误分类不能接管拖动");
  const second = updateGestureHold(first, "Closed_Fist", 50);
  assert.equal(fistDragEngagement(second, "Closed_Fist"), true);
  const missed = updateGestureHold(second, "None", 100);
  assert.equal(fistDragEngagement(missed, "None"), true, "丢帧沿用保持结果继续拖动");
  const opened = updateGestureHold(missed, "Open_Palm", 150);
  assert.equal(opened.gesture, "Closed_Fist", "前提：宽限期内保持结果仍是握拳");
  assert.equal(
    fistDragEngagement(opened, "Open_Palm"),
    false,
    "识别器明确看到张掌时不能吃着宽限继续跟手（松拳回摆不入相机）",
  );
});

test("短捏选择的整段帧序列：分类器全程读成握拳也必须发出 select", () => {
  // 复刻识别层每帧的判定顺序（含捏合姿势滞回、拳接管、事件作废），
  // 用真实的 lib 函数跑一次「瞄准→捏合→松开」。字符串断言查不出时序错位，
  // 而这条链上任何一环把 select 吃掉，用户看到的都是「捏了没反应」。
  const scale = 0.15;
  const step = (hand, { ratio, gesture, pinchGeometry, x, now }) => {
    const pinchPose = pinchGeometry || (hand.pinch?.pinching ?? false);
    const hold = updateGestureHold(hand.gestureHold, gesture, now);
    const pinch = updatePinchInteraction(hand.pinch, ratio, now, {
      closeThreshold: 0.46,
      releaseThreshold: 0.68,
      holdMs: 620,
      x,
      y: 0.5,
      scale,
    });
    const engaged = pinchPose ? false : fistDragEngagement(hold, gesture);
    const suppressed = engaged
      ? true
      : pinchPose || (!pinch.pinching && pinch.event === "none")
        ? false
        : hand.pinchSuppressed;
    return { gestureHold: hold, pinch, pinchSuppressed: suppressed, pinchPose };
  };

  // 捏合被罐装分类器读成 Closed_Fist 是常态：捏合时其余三指也蜷缩。
  const frames = [
    { now: 0, ratio: 0.9, gesture: "None", pinchGeometry: false, x: 0.5 },
    { now: 42, ratio: 0.4, gesture: "Closed_Fist", pinchGeometry: true, x: 0.5 },
    { now: 84, ratio: 0.3, gesture: "Closed_Fist", pinchGeometry: true, x: 0.501 },
    { now: 126, ratio: 0.28, gesture: "Closed_Fist", pinchGeometry: true, x: 0.502 },
    // 松开帧：指尖已分开到 0.75，几何闸门（0.62）当场失效——滞回必须接住。
    { now: 210, ratio: 0.75, gesture: "None", pinchGeometry: false, x: 0.502 },
  ];

  let hand = { gestureHold: null, pinch: null, pinchSuppressed: false, pinchPose: false };
  const events = [];
  for (const frame of frames) {
    hand = step(hand, frame);
    events.push({ event: hand.pinch.event, suppressed: hand.pinchSuppressed });
  }

  assert.equal(events[1].event, "press");
  assert.equal(
    events.slice(1, 4).some((frame) => frame.suppressed),
    false,
    "捏合期间不能被误判成握拳而作废",
  );
  const last = events.at(-1);
  assert.equal(last.event, "select", "松开必须发出 select");
  assert.equal(last.suppressed, false, "select 那一帧不能正好被握拳接管作废");
});

test("捏合姿势与握拳的几何区分：拇指食指都靠拢，看食指是否卷回掌心", () => {
  const base = () => {
    const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6, z: 0 }));
    points[0] = { x: 0.5, y: 0.8, z: 0 };
    points[5] = { x: 0.42, y: 0.62, z: 0 };
    points[9] = { x: 0.5, y: 0.6, z: 0 };
    points[17] = { x: 0.58, y: 0.64, z: 0 };
    return points;
  };

  const pinch = base();
  pinch[6] = { x: 0.42, y: 0.5, z: 0 };
  pinch[8] = { x: 0.46, y: 0.42, z: 0 };
  pinch[4] = { x: 0.47, y: 0.43, z: 0 };
  assert.equal(isPinchPose(pinch), true, "食指伸向拇指＝捏合");

  const fist = base();
  fist[6] = { x: 0.42, y: 0.52, z: 0 };
  fist[8] = { x: 0.46, y: 0.62, z: 0 };
  fist[4] = { x: 0.47, y: 0.6, z: 0 };
  assert.equal(isPinchPose(fist), false, "食指卷回掌心＝握拳");

  const open = base();
  open[6] = { x: 0.42, y: 0.5, z: 0 };
  open[8] = { x: 0.42, y: 0.36, z: 0 };
  open[4] = { x: 0.26, y: 0.6, z: 0 };
  assert.equal(isPinchPose(open), false, "指尖没有靠拢就不是捏合");
});

test("抓取靠位移不靠时长：捏住不动多久都算选择，一移动就转拖动", () => {
  // scale=0.15 是常见取景下的掌尺度，位移阈值＝半个手掌＝0.075。
  const at = (x, y) => ({ x, y, scale: 0.15 });
  const pressed = updatePinchInteraction(null, 0.4, 0, at(0.5, 0.5));
  assert.equal(pressed.event, "press");
  assert.equal(pressed.grabbed, false, "刚捏下不能立刻拖走图谱");
  const jitter = updatePinchInteraction(pressed, 0.56, 90, at(0.5, 0.5));
  assert.equal(jitter.pinching, true, "开合阈值之间要保持按下状态");
  assert.equal(updatePinchInteraction(jitter, 0.8, 150).event, "select");
  assert.equal(
    updatePinchInteraction(pressed, 0.8, 42).event,
    "select",
    "识别帧率下只被看到一帧的快速捏合也是合法选择",
  );

  // 人刻意“捏一下确认”常要 300–500ms。这段时间只要手没移动，
  // 松开就必须是选择——按时长判定会把它整类吞成抓取后的 release。
  const deliberate = updatePinchInteraction(pressed, 0.38, 430, at(0.503, 0.498));
  assert.equal(deliberate.grabbed, false, "捏住不动 430ms 仍是待确认的选择");
  assert.equal(
    updatePinchInteraction(deliberate, 0.82, 470, at(0.503, 0.498)).event,
    "select",
    "确认式短捏松手必须发出 select",
  );

  // 空中悬手做一次确认捏合，本身就会漂移一两厘米。阈值必须比这个大，
  // 否则每一次正常的短捏都被判成拖动，选择静默消失。
  const drift = updatePinchInteraction(pressed, 0.38, 300, at(0.53, 0.52));
  assert.equal(drift.grabbed, false, "手抖幅度不能触发拖动");
  assert.equal(
    updatePinchInteraction(drift, 0.82, 340, at(0.53, 0.52)).event,
    "select",
    "带手抖的确认捏合仍是选择",
  );

  const moved = updatePinchInteraction(pressed, 0.38, 120, at(0.5, 0.40));
  assert.equal(moved.event, "grab-start", "手真的移出半个掌宽就接管拖动");
  assert.equal(moved.grabbed, true);

  // 安全网：进过抓取但全程没拖动过，松手仍算选择。holdMs 与位移阈值
  // 无论定得多保守，用户的选择都不该静默消失。
  const heldStill = updatePinchInteraction(pressed, 0.38, 700, at(0.5, 0.5));
  assert.equal(heldStill.grabbed, true, "捏住不动到 holdMs 仍要能进入原地缩放");
  assert.equal(
    updatePinchInteraction(heldStill, 0.82, 760, at(0.5, 0.5)).event,
    "select",
    "抓过但从没拖动过，松手要回退成选择",
  );
  const heldLong = updatePinchInteraction(heldStill, 0.38, 1400, at(0.5, 0.5));
  assert.equal(
    updatePinchInteraction(heldLong, 0.82, 1460, at(0.5, 0.5)).event,
    "release",
    "长按超过确认窗口就是明确的抓取意图，不再回退",
  );

  const blip = updatePinchInteraction(moved, 0.82, 200, at(0.5, 0.40));
  assert.equal(blip.event, "none", "运动模糊的单帧爆表不能打断拖动");
  assert.equal(blip.grabbed, true);
  assert.equal(blip.releasePending, true, "宽限期内要提示消费方暂停跟手");
  const resumed = updatePinchInteraction(blip, 0.4, 260, at(0.5, 0.40));
  assert.equal(resumed.grabbed, true, "宽限期内重新捏拢必须无缝续拖");
  assert.equal(resumed.releasePending, false);
  const opening = updatePinchInteraction(resumed, 0.82, 340, at(0.5, 0.40));
  assert.equal(opening.event, "none");
  assert.equal(
    updatePinchInteraction(opening, 0.82, 485, at(0.5, 0.40)).event,
    "release",
    "真的拖动过，持续张开超过宽限期就是松手",
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
  assert.ok(Math.abs(delta.dx - 0.07) < 1e-9, "识别帧率下的正常挥手位移要完整保留");
  assert.ok(delta.scaleRatio > 1);
  assert.ok(delta.rotationDelta > 0);
  const sweep = twoHandTransformDelta(
    { centerX: 0.2, centerY: 0.5, distance: 0.4, angle: 0 },
    { centerX: 0.5, centerY: 0.5, distance: 0.4, angle: 0 },
  );
  assert.ok(Math.abs(sweep.dx - 0.11) < 1e-9, "异常跳变仍要钳位");
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
  assert.ok(graph.includes("gesturePan.add(translation)"), "手势平移要经 60fps 缓冲排出，不能 15Hz 直搬相机");
  assert.ok(graph.includes("zoomCameraOffset"), "锚点缩放的偏移必须先算完再写回");
  assert.ok(
    !graph.includes("copy(anchor).add(camera.position.clone()"),
    "copy(anchor) 链式写法有别名陷阱：clone 克隆到的已是 anchor，相机会坍缩到锚点",
  );
  assert.ok(graph.includes("flushOrbitInertia"), "手势接管前要结清 OrbitControls 的阻尼残余");
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
  assert.ok(controls.includes("短捏选择 · 握拳拖动"));
  assert.ok(controls.includes("fistDragEngaged"), "握拳必须能直接接管拖动");
  assert.ok(controls.includes("releasePending"), "释放宽限期内不能继续跟手");
  assert.ok(controls.includes("pinchSuppressed"), "拳接管期间必须整体静默捏合事件");
  assert.ok(controls.includes("releaseGraceMs: menu.open"), "菜单光标手要即时释放确认");
  assert.ok(controls.includes("lastPressAt >= menu.openedAt"), "菜单确认只认打开之后按下的捏合");
  assert.ok(controls.includes("fistMaintained"), "拳的身份与跟手分层，单帧误分类不拆双拳");
  assert.ok(
    controls.includes("if (hand.pinchPose) return false;"),
    "捏合被分类器读成握拳时必须一票否决，否则短捏选择整轮作废",
  );
  assert.ok(!controls.includes("SPACE_GRAB_HOLD_MS"), "holdMs 不再按瞄准对象分流，抓取由位移触发");
  assert.ok(controls.includes("graph-hand-debug"), "手势失灵时要能看到实时判定数值");
  assert.ok(controls.includes("resetCalibration"), "固化过严的校准阈值要有回默认的出口");
  assert.ok(css.includes(".graph-hand-debug"));
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
  assert.ok(graph.includes("lastNodeHits"), "按下帧已滑出节点时要在短窗口内回溯锁定");
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
