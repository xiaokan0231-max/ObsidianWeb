/**
 * MediaPipe 的 21 点手部骨架连接。放在纯 ESM 里，是为了让浏览器组件和 Node 测试
 * 共用同一份手势几何，不把“抓住”的阈值复制成两套。
 */
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const PALM_POINTS = [0, 5, 9, 13, 17];

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

const COMMAND_GESTURES = new Set(["Thumb_Up", "Thumb_Down", "ILoveYou"]);

/**
 * 罐装分类器对竖拇指和 ILY 的分数通常比张掌、握拳低。这里按手势分别设门槛，
 * 后面还有时间确认，因此不必为了三个难识别手势把所有类别都一起放宽。
 */
export function gestureScoreThreshold(gestureName) {
  if (COMMAND_GESTURES.has(gestureName)) return 0.35;
  if (gestureName === "Pointing_Up" || gestureName === "Victory") return 0.44;
  return 0.5;
}

function fingerExtended(landmarks, mcpIndex, pipIndex, tipIndex) {
  const mcp = landmarks[mcpIndex];
  const pip = landmarks[pipIndex];
  const tip = landmarks[tipIndex];
  const wrist = landmarks[0];
  const path = distance(mcp, pip) + distance(pip, tip);
  if (path <= 0.0001) return false;
  return distance(mcp, tip) / path >= 0.82
    && distance(wrist, tip) >= distance(wrist, pip) * 1.04;
}

/**
 * Thumb Up / Down / ILY 是模型最容易在连续帧里漏掉的三类。用 21 点骨架做严格的
 * 几何兜底，只在手指开合组合非常明确时返回结果，不取代模型对普通姿势的判断。
 */
export function inferCommandGestureFromLandmarks(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return "None";
  const required = [0, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 20];
  if (required.some((index) => (
    !Number.isFinite(landmarks[index]?.x) || !Number.isFinite(landmarks[index]?.y)
  ))) {
    return "None";
  }

  const thumbExtended = fingerExtended(landmarks, 2, 3, 4);
  const indexExtended = fingerExtended(landmarks, 5, 6, 8);
  const middleExtended = fingerExtended(landmarks, 9, 10, 12);
  const ringExtended = fingerExtended(landmarks, 13, 14, 16);
  const pinkyExtended = fingerExtended(landmarks, 17, 18, 20);

  if (
    thumbExtended
    && indexExtended
    && pinkyExtended
    && !middleExtended
    && !ringExtended
  ) {
    return "ILoveYou";
  }

  if (!thumbExtended || indexExtended || middleExtended || ringExtended || pinkyExtended) {
    return "None";
  }
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const palmScale = Math.max(distance(wrist, landmarks[9]), distance(landmarks[5], landmarks[17]));
  const dx = thumbTip.x - wrist.x;
  const dy = thumbTip.y - wrist.y;
  if (palmScale <= 0.0001 || Math.abs(dy) < palmScale * 0.72 || Math.abs(dy) < Math.abs(dx) * 0.72) {
    return "None";
  }
  return dy < 0 ? "Thumb_Up" : "Thumb_Down";
}

/**
 * 捏合姿势与握拳的几何区分。罐装分类器把两者都倾向判成 Closed_Fist——捏合时
 * 其余三指自然蜷缩，整体轮廓本来就接近拳——可一旦按拳处理，这只手的捏合
 * 语义（短捏选择）就整轮作废，用户捏多少次都不会选中任何东西。
 *
 * 判据看食指：握拳时食指卷回掌心，指尖比第二关节更靠近手腕；捏合时食指朝
 * 拇指伸出，指尖始终在第二关节前方。这条几何差异不依赖分类器，也不受
 * 手掌朝向影响。
 */
export function isPinchPose(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return false;
  const required = [0, 4, 5, 6, 8, 9, 17];
  if (required.some((index) => (
    !Number.isFinite(landmarks[index]?.x) || !Number.isFinite(landmarks[index]?.y)
  ))) {
    return false;
  }
  const wrist = landmarks[0];
  const palmWidth = distance(landmarks[5], landmarks[17]);
  const palmLength = distance(landmarks[0], landmarks[9]);
  const scale = (palmWidth + palmLength) / 2;
  if (scale <= 0.0001) return false;
  // 指尖没有真的靠拢就不是捏合。这里比开合阈值宽，是为了在“正在捏拢”的
  // 过程帧里就先把拳挡住，不给它两帧证据的机会。
  if (distance(landmarks[4], landmarks[8]) / scale > 0.62) return false;
  return distance(wrist, landmarks[8]) >= distance(wrist, landmarks[6]) * 1.02;
}

/**
 * 握拳是否应当接管拖动。两帧证据滤掉单帧误分类；raw（当帧原始观测）用来立即
 * 停手：updateGestureHold 的宽限会把“明确张开的手”也当丢帧保持 240ms，若只看
 * 保持后的手势，松拳回摆会被继续灌进相机。丢帧（None）沿用保持结果继续拖动，
 * 但识别器明确看到别的手势（如 Open_Palm）时当帧就停——与捏合的释放宽限期
 * “保住身份、暂停跟手”同一原则。
 */
export function fistDragEngagement(gestureHold, observedGesture) {
  if (!gestureHold || gestureHold.gesture !== "Closed_Fist") return false;
  if ((gestureHold.evidenceFrames ?? 0) < 2) return false;
  return observedGesture === "Closed_Fist" || observedGesture === "None";
}

/**
 * 摄像头分类偶尔会漏一两帧。短暂空帧或相邻类别抖动期间维持候选手势，但只有真正
 * 识别到同一手势的帧才累计 evidenceFrames，防止一次误判被“宽限期”放大成命令。
 */
export function updateGestureHold(previous, observedGesture, now, graceMs = 240) {
  const observed = typeof observedGesture === "string" ? observedGesture : "None";
  if (!previous || previous.gesture === "None") {
    return observed === "None"
      ? { gesture: "None", since: now, lastSeen: now, evidenceFrames: 0 }
      : { gesture: observed, since: now, lastSeen: now, evidenceFrames: 1 };
  }
  if (observed === previous.gesture) {
    return {
      ...previous,
      lastSeen: now,
      evidenceFrames: previous.evidenceFrames + 1,
    };
  }
  if (now - previous.lastSeen <= graceMs) return previous;
  return observed === "None"
    ? { gesture: "None", since: now, lastSeen: now, evidenceFrames: 0 }
    : { gesture: observed, since: now, lastSeen: now, evidenceFrames: 1 };
}

/**
 * 把连续的拇指—食指距离转换成统一的“按下—确认—抓取—释放”语法。
 *
 * **抓取靠位移，不靠时长**——和触摸板区分点击与拖动的方式一致。捏住后手一旦
 * 移出 moveThreshold 就立刻接管图谱；手不动则一直保留“可选择”的身份，松开
 * 就是选择。早期版本只看 holdMs(360ms)，而人刻意捏一下确认往往要 300–500ms，
 * 于是绝大多数「短捏」都在松手前被判成抓取，松开发出的是 release 而不是
 * select，节点永远选不中。holdMs 仍作兜底，让“捏住不动”也能进入原地缩放，
 * 但阈值放宽到不会误伤正常的确认捏合。
 *
 * select 下限 40ms：推理约 15–24fps，一帧间隔就有 42–67ms，只被看到一帧的
 * 快速捏合是合法输入，70ms 会把它整类判成 cancel。
 * 抓取中的松开先进 releaseGraceMs 宽限（releasePending=true）：拖动时运动模糊
 * 常让单帧指尖距离爆表，立即释放会把一次拖动打断成多次重新长按。宽限期内
 * 保住 grabbed 身份但由消费方暂停跟手，重新捏拢就无缝续拖；短捏（未抓取）
 * 仍即时释放，保证选择跟手。
 */
export function updatePinchInteraction(previous, pinchRatio, now, options = {}) {
  const settings = typeof options === "number" ? { holdMs: options } : options;
  const holdMs = Number.isFinite(settings.holdMs) ? settings.holdMs : 620;
  const closeThreshold = Number.isFinite(settings.closeThreshold)
    ? settings.closeThreshold
    : 0.46;
  const releaseThreshold = Number.isFinite(settings.releaseThreshold)
    ? settings.releaseThreshold
    : 0.68;
  const releaseGraceMs = Number.isFinite(settings.releaseGraceMs)
    ? settings.releaseGraceMs
    : 130;
  // 位移阈值按手在画面里的大小折算：同一个手部动作，人坐得远时画面位移更小。
  // 固定 0.038 归一化单位≈2cm，比空中悬手做一次确认捏合的自然漂移还小，
  // 正常的短捏几乎必然被判成拖动。改成“走出半个手掌”这个身体尺度的量。
  const scale = Number.isFinite(settings.scale) ? settings.scale : 0;
  const moveThreshold = Number.isFinite(settings.moveThreshold)
    ? settings.moveThreshold
    : scale > 0.02 ? scale * 0.5 : 0.075;
  const hasPosition = Number.isFinite(settings.x) && Number.isFinite(settings.y);
  const safeRatio = Number.isFinite(pinchRatio) ? pinchRatio : 1;
  const wasPinching = previous?.pinching ?? false;
  const pinching = wasPinching
    ? safeRatio < releaseThreshold
    : safeRatio <= closeThreshold;

  if (!wasPinching && pinching) {
    return {
      pinching: true,
      grabbed: false,
      startedAt: now,
      openSince: 0,
      releasePending: false,
      pressX: hasPosition ? settings.x : 0,
      pressY: hasPosition ? settings.y : 0,
      travel: 0,
      progress: 0,
      event: "press",
    };
  }

  if (wasPinching && pinching) {
    const startedAt = previous.startedAt;
    const elapsed = Math.max(0, now - startedAt);
    // 只看“离按下点最远走了多少”，不累加路径长度——否则原地抖动会
    // 慢慢累积成一次误抓取。
    const travel = hasPosition
      ? Math.max(
          previous.travel ?? 0,
          Math.hypot(settings.x - (previous.pressX ?? settings.x), settings.y - (previous.pressY ?? settings.y)),
        )
      : previous.travel ?? 0;
    const grabbed = previous.grabbed || travel >= moveThreshold || elapsed >= holdMs;
    return {
      pinching: true,
      grabbed,
      startedAt,
      openSince: 0,
      releasePending: false,
      pressX: previous.pressX ?? 0,
      pressY: previous.pressY ?? 0,
      travel,
      // 进度条表达“还差多少就接管”，两条路取更接近的那条。
      progress: Math.min(1, Math.max(
        elapsed / holdMs,
        moveThreshold > 0 ? travel / moveThreshold : 0,
      )),
      event: grabbed && !previous.grabbed ? "grab-start" : "none",
    };
  }

  if (wasPinching) {
    // 释放宽限是给「拖动被运动模糊打断」用的。从没真正拖动过的捏合不需要它，
    // 否则每次选择都要空等一个宽限期才生效，手感变钝。
    const draggedForReal = (previous.travel ?? 0) >= moveThreshold;
    if (previous.grabbed && releaseGraceMs > 0 && draggedForReal) {
      const openSince = previous.openSince > 0 ? previous.openSince : now;
      if (now - openSince < releaseGraceMs) {
        return {
          pinching: true,
          grabbed: true,
          startedAt: previous.startedAt,
          openSince,
          releasePending: true,
          pressX: previous.pressX ?? 0,
          pressY: previous.pressY ?? 0,
          travel: previous.travel ?? 0,
          progress: 1,
          event: "none",
        };
      }
    }
    const elapsed = Math.max(0, now - previous.startedAt);
    // 安全网：进过 grabbed，但全程没真正拖动过（位移始终不到阈值），
    // 且时长还在“确认捏一下”的范围内 —— 这是一次选择，不是拖动。
    // 少了这一条，holdMs 或 moveThreshold 只要定得稍紧，用户的选择就会
    // 静默消失成 release；触摸板同样是「有按下、没位移」即点击。
    const selecting = previous.grabbed
      ? !draggedForReal && elapsed < 1000
      : elapsed >= 40;
    return {
      pinching: false,
      grabbed: false,
      startedAt: 0,
      openSince: 0,
      releasePending: false,
      pressX: 0,
      pressY: 0,
      travel: 0,
      progress: 0,
      event: selecting
        ? "select"
        : previous.grabbed ? "release" : "cancel",
    };
  }

  return {
    pinching: false,
    grabbed: false,
    startedAt: 0,
    openSince: 0,
    releasePending: false,
    pressX: 0,
    pressY: 0,
    travel: 0,
    progress: 0,
    event: "none",
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/** 用校准样本生成仍带滞回区的开合阈值；样本不足或姿势没有拉开时回退默认值。 */
export function derivePinchThresholds(openSamples, closedSamples) {
  const openMedian = median(Array.isArray(openSamples) ? openSamples : []);
  const closedMedian = median(Array.isArray(closedSamples) ? closedSamples : []);
  if (
    openMedian === null
    || closedMedian === null
    || openMedian - closedMedian < 0.22
  ) {
    return { closeThreshold: 0.46, releaseThreshold: 0.68, calibrated: false };
  }
  const gap = openMedian - closedMedian;
  // 只放宽、不收紧。closed 样本只在“已经判成捏合”时才采得到，天然全部落在
  // 当前阈值以内，把新阈值压向闭合端就会系统性地比默认更严；用户越因为捏不上
  // 去而重新校准，阈值越紧，形成单向棘轮，最后怎么捏都没反应。
  const closeThreshold = Math.max(
    0.46,
    Math.min(0.6, closedMedian + gap * 0.28),
  );
  const releaseThreshold = Math.min(
    0.82,
    Math.max(closeThreshold + 0.12, closedMedian + gap * 0.62),
  );
  return { closeThreshold, releaseThreshold, calibrated: true };
}

/** 双手返回顺序会变化；用位置连续性为主、handedness 为辅寻找稳定的旧轨道。 */
export function matchHandDetections(previousHands, detections, maxDistance = 0.42) {
  const previous = Array.isArray(previousHands) ? previousHands : [];
  const next = Array.isArray(detections) ? detections : [];
  const candidates = [];
  previous.forEach((hand, previousIndex) => {
    next.forEach((detection, detectionIndex) => {
      const positionCost = Math.hypot(hand.x - detection.x, hand.y - detection.y);
      const handednessPenalty = hand.handedness && detection.handedness
        && hand.handedness !== detection.handedness ? 0.16 : 0;
      candidates.push({
        previousIndex,
        detectionIndex,
        cost: positionCost + handednessPenalty,
        positionCost,
      });
    });
  });
  candidates.sort((left, right) => left.cost - right.cost);
  const usedPrevious = new Set();
  const usedDetections = new Set();
  const matches = [];
  candidates.forEach((candidate) => {
    if (
      candidate.positionCost > maxDistance
      || usedPrevious.has(candidate.previousIndex)
      || usedDetections.has(candidate.detectionIndex)
    ) {
      return;
    }
    usedPrevious.add(candidate.previousIndex);
    usedDetections.add(candidate.detectionIndex);
    matches.push(candidate);
  });
  return {
    matches,
    unmatchedPrevious: previous
      .map((_, index) => index)
      .filter((index) => !usedPrevious.has(index)),
    unmatchedDetections: next
      .map((_, index) => index)
      .filter((index) => !usedDetections.has(index)),
  };
}

/**
 * 主手在短暂遮挡和另一只手按下时都不交换；只有原主手超过宽限期后才由当前按下的手、
 * 可见手依次接管。这样辅助手短捏关系目标时不会突然变成主手。
 */
export function resolvePrimaryHandId(currentId, hands, now, graceMs = 350) {
  const candidates = Array.isArray(hands) ? hands : [];
  const current = candidates.find((hand) => hand.id === currentId);
  if (current && now - current.lastSeen <= graceMs) return current.id;
  const pressed = candidates.find((hand) => hand.visible && hand.event === "press");
  if (pressed) return pressed.id;
  return candidates.find((hand) => hand.visible)?.id
    ?? candidates.find((hand) => now - hand.lastSeen <= graceMs)?.id
    ?? null;
}

function normalizedAngleDelta(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

/** 两只手的中点、间距和连线角度；按稳定 id 排序，避免交换参数导致角度翻转 π。 */
export function twoHandMetrics(first, second) {
  if (!first || !second) return null;
  const [left, right] = String(first.id).localeCompare(String(second.id)) <= 0
    ? [first, second]
    : [second, first];
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return {
    centerX: (left.x + right.x) / 2,
    centerY: (left.y + right.y) / 2,
    distance: Math.hypot(dx, dy),
    angle: Math.atan2(dy, dx),
  };
}

/**
 * 输出逐帧双手变换增量；异常近距离只允许平移，不产生爆炸式缩放或旋转。
 * 平移钳位 0.11：推理只有 15–24fps，快速挥手单帧位移可达 0.1 以上，
 * 钳得太紧会把大半位移扔掉，拖动像在打滑。
 */
export function twoHandTransformDelta(previous, next) {
  if (!previous || !next) return null;
  const safeDistance = previous.distance >= 0.08 && next.distance >= 0.08;
  return {
    centerX: next.centerX,
    centerY: next.centerY,
    separation: next.distance,
    dx: Math.min(0.11, Math.max(-0.11, next.centerX - previous.centerX)),
    dy: Math.min(0.11, Math.max(-0.11, next.centerY - previous.centerY)),
    scaleRatio: safeDistance
      ? Math.min(1.08, Math.max(0.92, next.distance / previous.distance))
      : 1,
    rotationDelta: safeDistance
      ? Math.min(0.09, Math.max(-0.09, normalizedAngleDelta(next.angle - previous.angle)))
      : 0,
  };
}

/**
 * 把 21 个归一化关键点压成相机控制需要的三个量。
 * x 在这里镜像，保证用户在自拍预览里向右移动时，星图也跟着手向右走。
 * 手掌宽度与腕到掌根的长度比指尖 z 更抗噪，用它的画面占比表达前后移动。
 */
export function handPoseFromLandmarks(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return null;
  const required = [...PALM_POINTS, 4, 8];
  if (required.some((index) => (
    !Number.isFinite(landmarks[index]?.x) || !Number.isFinite(landmarks[index]?.y)
  ))) {
    return null;
  }

  const center = PALM_POINTS.reduce((sum, index) => ({
    x: sum.x + landmarks[index].x,
    y: sum.y + landmarks[index].y,
  }), { x: 0, y: 0 });
  center.x /= PALM_POINTS.length;
  center.y /= PALM_POINTS.length;

  const palmWidth = distance(landmarks[5], landmarks[17]);
  const palmLength = distance(landmarks[0], landmarks[9]);
  const scale = Math.max(0.001, (palmWidth + palmLength) / 2);

  return {
    x: 1 - center.x,
    y: center.y,
    scale,
    pinchRatio: distance(landmarks[4], landmarks[8]) / scale,
  };
}

/**
 * 分类器负责“握拳”，拇指/食指距离补上更轻松的“捏合”。两组开合阈值刻意
 * 留出滞回区，避免临界帧在抓住与放下之间闪烁。
 */
export function nextGrabState(previous, gestureName, gestureScore, pinchRatio) {
  if (gestureName === "Closed_Fist" && gestureScore >= 0.55) return true;
  if (gestureName === "Open_Palm" && gestureScore >= 0.5) return false;
  // 一旦模型明确识别出命令手势就先放下，避免从握拳切到点赞时仍被滞回区
  // 锁在 grab，导致离散命令永远发不出去。
  if (
    gestureScore >= 0.55
    && ["Pointing_Up", "Thumb_Up", "Thumb_Down", "Victory", "ILoveYou"].includes(gestureName)
  ) {
    return false;
  }
  if (pinchRatio <= 0.42) return true;
  if (pinchRatio >= 0.72) return false;
  return previous;
}

/** MediaPipe 只有十几帧时，先低通再驱动 60fps 的 Three 舞台，镜头不会阶梯跳动。 */
export function smoothHandPose(previous, next, alpha = 0.42) {
  if (!previous) return next;
  const amount = Math.min(1, Math.max(0, alpha));
  return {
    x: previous.x + (next.x - previous.x) * amount,
    y: previous.y + (next.y - previous.y) * amount,
    scale: previous.scale + (next.scale - previous.scale) * amount,
    pinchRatio: previous.pinchRatio + (next.pinchRatio - previous.pinchRatio) * amount,
  };
}
