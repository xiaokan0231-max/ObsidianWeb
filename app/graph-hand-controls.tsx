"use client";

import {
  type CSSProperties,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  GestureRecognizer,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import {
  HAND_CONNECTIONS,
  derivePinchThresholds,
  gestureScoreThreshold,
  handPoseFromLandmarks,
  matchHandDetections,
  resolvePrimaryHandId,
  smoothHandPose,
  twoHandMetrics,
  twoHandTransformDelta,
  updateGestureHold,
  updatePinchInteraction,
  type GestureHold,
  type HandPose,
  type PinchInteraction,
  type PinchThresholds,
  type TwoHandMetrics,
} from "@/lib/hand-gesture.mjs";

// wasm とモデルは自托管が正（scripts/fetch-mediapipe.mjs が public/mediapipe/ に用意する）。
// オフラインや CSP を締めた環境でも手勢が動き、モデルのバージョンも固定される。
// 取得脚本が走っていない環境のためだけに CDN フォールバックを残す——
// CDN のモデル URL はバージョン無しの latest で、Google 側の差し替えで挙動が変わり得る。
const LOCAL_WASM_ROOT = "/mediapipe/wasm";
const LOCAL_MODEL_URL = "/mediapipe/gesture_recognizer.task";
const CDN_WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const CDN_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";

/** 自托管の実体が揃っている時だけ local を選ぶ。wasm とモデルは対で切り替える。 */
async function resolveMediapipeAssets() {
  try {
    const [wasmOk, modelOk] = await Promise.all([
      fetch(`${LOCAL_WASM_ROOT}/vision_wasm_internal.wasm`, { method: "HEAD" })
        .then((response) => response.ok)
        .catch(() => false),
      fetch(LOCAL_MODEL_URL, { method: "HEAD" })
        .then((response) => response.ok)
        .catch(() => false),
    ]);
    if (wasmOk && modelOk) {
      return { wasmRoot: LOCAL_WASM_ROOT, modelUrl: LOCAL_MODEL_URL };
    }
  } catch {
    // HEAD が投げたら CDN へ
  }
  return { wasmRoot: CDN_WASM_ROOT, modelUrl: CDN_MODEL_URL };
}
const INFERENCE_INTERVAL_MS = 1000 / 15;
const RADIAL_MENU_HOLD_MS = 560;
const PALM_MENU_HOLD_MS = 550;
const DUAL_TRANSFORM_HOLD_MS = 120;
const TRACKING_GRACE_MS = 250;
const PRIMARY_GRACE_MS = 350;
const MIN_DUAL_SEPARATION = 0.12;
const ONBOARDING_STORAGE_KEY = "echo:graph-hand-onboarding:v2";

export type GraphHandGesture =
  | "None"
  | "Closed_Fist"
  | "Open_Palm"
  | "Pointing_Up"
  | "Thumb_Down"
  | "Thumb_Up"
  | "Victory"
  | "ILoveYou";

export type GraphHandAction =
  | "select-target"
  | "toggle-relation-target"
  | "focus-neighbors"
  | "reset-view"
  | "open-selected"
  | "select-previous"
  | "select-next"
  | "toggle-pause";

export type GraphHandMode =
  | "calibration"
  | "single-aim"
  | "single-pinch"
  | "single-grab"
  | "dual-ready"
  | "dual-transform"
  | "relation-preview"
  | "palm-menu";

export type GraphHandRole = "primary" | "secondary";

export type GraphTrackedHandFrame = HandPose & {
  id: string;
  handedness: "Left" | "Right" | "Unknown";
  role: GraphHandRole;
  visible: boolean;
  gesture: GraphHandGesture;
  pinching: boolean;
  grabbed: boolean;
  pinchProgress: number;
  pointerX: number;
  pointerY: number;
  worldZ: number;
};

export type GraphHandTransform = {
  centerX: number;
  centerY: number;
  separation: number;
  dx: number;
  dy: number;
  scaleRatio: number;
  rotationDelta: number;
};

export type GraphHandActionEvent = {
  type: GraphHandAction;
  handId: string;
};

export type GraphHandNavigationFrame = {
  hands: GraphTrackedHandFrame[];
  mode: GraphHandMode;
  primaryHandId: string | null;
  transform: GraphHandTransform | null;
  action: GraphHandActionEvent | null;
};

export type GraphHandTargetFeedback = {
  handId: string;
  id: string | null;
  label: string;
  color: string;
  kind: "node" | "space";
};

export type GraphHandRelationFeedback = {
  sourceLabel: string;
  targetLabel: string;
  connected: boolean;
  pathLength: number;
  commonCount: number;
  pathLabels: string[];
  locked: boolean;
} | null;

type Phase = "idle" | "requesting" | "loading" | "ready" | "tracking" | "error";

type RuntimeHand = {
  id: string;
  handedness: "Left" | "Right" | "Unknown";
  lastSeen: number;
  visible: boolean;
  pose: HandPose;
  gesture: GraphHandGesture;
  gestureHold: GestureHold | null;
  pinch: PinchInteraction | null;
  landmarks: NormalizedLandmark[];
  worldZ: number;
};

type RadialMenuState = {
  open: boolean;
  kind: "single" | "palm";
  ownerHandId: string | null;
  cursorHandId: string | null;
  centerX: number;
  centerY: number;
  selected: GraphHandAction | null;
};

const DEFAULT_THRESHOLDS: PinchThresholds = {
  closeThreshold: 0.46,
  releaseThreshold: 0.68,
};

const KNOWN_GESTURES = new Set<GraphHandGesture>([
  "None", "Closed_Fist", "Open_Palm", "Pointing_Up", "Thumb_Down",
  "Thumb_Up", "Victory", "ILoveYou",
]);

const ACTION_COPY: Record<GraphHandAction, string> = {
  "select-target": "节点已锁定",
  "toggle-relation-target": "关系目标已切换",
  "focus-neighbors": "正在聚焦相邻关系",
  "reset-view": "正在返回全景",
  "open-selected": "正在打开记忆",
  "select-previous": "切换到上一个节点",
  "select-next": "切换到下一个节点",
  "toggle-pause": "切换星图动态",
};

const RADIAL_ACTIONS: Array<{
  action: Exclude<GraphHandAction, "select-target" | "toggle-relation-target">;
  icon: string;
  label: string;
  angle: number;
  requiresSelection?: boolean;
}> = [
  { action: "reset-view", icon: "⌂", label: "回到全景", angle: -90 },
  { action: "open-selected", icon: "↗", label: "打开记忆", angle: -30, requiresSelection: true },
  { action: "select-next", icon: "→", label: "下个节点", angle: 30 },
  { action: "toggle-pause", icon: "Ⅱ", label: "暂停动态", angle: 90 },
  { action: "select-previous", icon: "←", label: "上个节点", angle: 150 },
  { action: "focus-neighbors", icon: "◎", label: "聚焦邻居", angle: 210, requiresSelection: true },
];

const ONBOARDING_STEPS = [
  { title: "让系统认识你的手", hint: "张开一只手，保持在画面中央" },
  { title: "用掌心射线瞄准", hint: "移动手掌，让光环吸附到任意节点" },
  { title: "短捏选择", hint: "拇指与食指快速捏合后松开" },
  { title: "捏住抓取", hint: "捏住不放并移动手掌" },
  { title: "双手操纵", hint: "两手同时捏住，然后把两手拉开" },
] as const;

function cameraErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) return "识别器加载失败，请检查网络后重试。";
  if (error.name === "NotAllowedError") return "摄像头权限被拒绝，请在地址栏允许后重试。";
  if (error.name === "NotFoundError") return "没有找到可用的摄像头。";
  if (error.name === "NotReadableError") return "摄像头正被其他应用占用。";
  return "无法启动摄像头，请退出全屏后再试一次。";
}

function radialActionAt(centerX: number, centerY: number, x: number, y: number) {
  const dx = x - centerX;
  const dy = y - centerY;
  if (Math.hypot(dx, dy) < 0.055) return null;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return RADIAL_ACTIONS.reduce((nearest, item) => {
    const delta = Math.abs(((angle - item.angle + 540) % 360) - 180);
    return delta < nearest.delta ? { item, delta } : nearest;
  }, { item: RADIAL_ACTIONS[0], delta: Infinity }).item;
}

function drawHands(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  hands: RuntimeHand[],
  primaryHandId: string | null,
) {
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(2, width / 220);
  context.font = `600 ${Math.max(10, width / 42)}px monospace`;

  hands.filter((hand) => hand.visible).forEach((hand) => {
    const primary = hand.id === primaryHandId;
    const grabbed = hand.pinch?.grabbed ?? false;
    const color = grabbed ? "#ff9d62" : primary ? "#79f0bc" : "#76d9ff";
    context.strokeStyle = color;
    context.fillStyle = color;
    context.shadowBlur = grabbed ? 16 : 10;
    context.shadowColor = color;
    HAND_CONNECTIONS.forEach(([from, to]) => {
      const start = hand.landmarks[from];
      const end = hand.landmarks[to];
      if (!start || !end) return;
      context.beginPath();
      context.moveTo(start.x * width, start.y * height);
      context.lineTo(end.x * width, end.y * height);
      context.stroke();
    });
    hand.landmarks.forEach((landmark, index) => {
      context.beginPath();
      context.arc(
        landmark.x * width,
        landmark.y * height,
        index === 4 || index === 8 ? width / 78 : width / 135,
        0,
        Math.PI * 2,
      );
      context.fill();
    });
    const wrist = hand.landmarks[0];
    if (wrist) {
      context.fillText(primary ? "主" : "辅", wrist.x * width + 8, wrist.y * height + 6);
    }
  });
  context.shadowBlur = 0;
}

function readStoredPreferences() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "null");
    const thresholds = parsed?.thresholds;
    return {
      seen: parsed?.seen === true,
      thresholds: Number.isFinite(thresholds?.closeThreshold)
        && Number.isFinite(thresholds?.releaseThreshold)
        ? thresholds as PinchThresholds
        : DEFAULT_THRESHOLDS,
    };
  } catch {
    return { seen: false, thresholds: DEFAULT_THRESHOLDS };
  }
}

export function GraphHandControls({
  active,
  onFrame,
  targets,
  selectedLabel,
  relation,
}: {
  active: boolean;
  onFrame: (frame: GraphHandNavigationFrame | null) => void;
  targets: GraphHandTargetFeedback[];
  selectedLabel: string | null;
  relation: GraphHandRelationFeedback;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFrameRef = useRef(onFrame);
  const targetsRef = useRef(targets);
  const selectedLabelRef = useRef(selectedLabel);
  const relationRef = useRef(relation);
  const radialMenuRef = useRef<RadialMenuState>({
    open: false,
    kind: "single",
    ownerHandId: null,
    cursorHandId: null,
    centerX: 0.5,
    centerY: 0.5,
    selected: null,
  });
  const thresholdsRef = useRef<PinchThresholds>(DEFAULT_THRESHOLDS);
  const onboardingRef = useRef({ visible: false, step: 0 });
  const calibrationSamplesRef = useRef({ open: [] as number[], closed: [] as number[] });
  const [enabled, setEnabled] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");
  const [retry, setRetry] = useState(0);
  const [actionFeedback, setActionFeedback] = useState<GraphHandAction | null>(null);
  const [uiFrame, setUiFrame] = useState<GraphHandNavigationFrame | null>(null);
  const [radialMenu, setRadialMenu] = useState<RadialMenuState>({
    open: false,
    kind: "single",
    ownerHandId: null,
    cursorHandId: null,
    centerX: 0.5,
    centerY: 0.5,
    selected: null,
  });
  const [onboarding, setOnboarding] = useState({ visible: false, step: 0 });

  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  useEffect(() => { targetsRef.current = targets; }, [targets]);
  useEffect(() => { selectedLabelRef.current = selectedLabel; }, [selectedLabel]);
  useEffect(() => { relationRef.current = relation; }, [relation]);
  useEffect(() => { radialMenuRef.current = radialMenu; }, [radialMenu]);
  useEffect(() => { onboardingRef.current = onboarding; }, [onboarding]);

  useEffect(() => {
    const stored = readStoredPreferences();
    thresholdsRef.current = stored.thresholds;
    if (!stored.seen) {
      onboardingRef.current = { visible: true, step: 0 };
      const timer = window.setTimeout(() => setOnboarding({ visible: true, step: 0 }), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  const finishOnboarding = (skipped: boolean) => {
    const samples = calibrationSamplesRef.current;
    const calibrated = skipped
      ? { ...thresholdsRef.current, calibrated: false }
      : derivePinchThresholds(samples.open, samples.closed);
    thresholdsRef.current = calibrated;
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
        seen: true,
        thresholds: calibrated,
      }));
    } catch {
      // 隐私模式下 localStorage 可能不可写；本次会话仍继续使用内存阈值。
    }
    onboardingRef.current = { visible: false, step: 0 };
    setOnboarding({ visible: false, step: 0 });
  };

  const replayOnboarding = () => {
    calibrationSamplesRef.current = { open: [], closed: [] };
    onboardingRef.current = { visible: true, step: 0 };
    setOnboarding({ visible: true, step: 0 });
  };

  useEffect(() => {
    if (!active || !enabled) {
      onFrameRef.current(null);
      return;
    }

    let stopped = false;
    let stream: MediaStream | null = null;
    let recognizer: GestureRecognizer | null = null;
    let animationFrame = 0;
    let lastInferenceAt = -Infinity;
    let lastVideoTime = -1;
    let nextHandNumber = 1;
    const runtimeHands = new Map<string, RuntimeHand>();
    let primaryHandId: string | null = null;
    let dualCandidateSince = 0;
    let dualActive = false;
    let previousDualMetrics: TwoHandMetrics | null = null;
    let dualStartSeparation = 0;
    let supportPalm: { handId: string; since: number; x: number; y: number } | null = null;
    let menu: RadialMenuState = radialMenuRef.current;
    let singleMenuEmitted = false;
    let feedbackTimer = 0;
    let onboardingEvidence = 0;
    let onboardingGrabOrigin: { x: number; y: number } | null = null;

    const stopStream = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    const closeMenu = () => {
      menu = { ...menu, open: false, selected: null, ownerHandId: null, cursorHandId: null };
      setRadialMenu(menu);
    };

    const publishMenu = () => setRadialMenu({ ...menu });

    const advanceOnboarding = (step: number) => {
      if (!onboardingRef.current.visible || onboardingRef.current.step !== step) return;
      const nextStep = step + 1;
      onboardingEvidence = 0;
      onboardingGrabOrigin = null;
      if (nextStep >= ONBOARDING_STEPS.length) {
        finishOnboarding(false);
      } else {
        onboardingRef.current = { visible: true, step: nextStep };
        setOnboarding({ visible: true, step: nextStep });
      }
    };

    const run = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException("getUserMedia unavailable", "NotSupportedError");
        }
        setPhase("requesting");
        setDetail("视频只在本机内存中处理，不会上传。");
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24, max: 30 },
          },
        });
        if (stopped) {
          stopStream();
          return;
        }

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (stopped) return;

        setPhase("loading");
        setDetail("首次进入会下载约 20MB 的模型与运行时，之后由浏览器缓存。");
        const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
        const assets = await resolveMediapipeAssets();
        const fileset = await FilesetResolver.forVisionTasks(assets.wasmRoot);
        const commonOptions = {
          runningMode: "VIDEO" as const,
          numHands: 2,
          minHandDetectionConfidence: 0.58,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
          cannedGesturesClassifierOptions: {
            scoreThreshold: 0.32,
            categoryAllowlist: [
              "Closed_Fist", "Open_Palm", "Pointing_Up", "Thumb_Down",
              "Thumb_Up", "Victory", "ILoveYou",
            ],
          },
        };
        try {
          recognizer = await GestureRecognizer.createFromOptions(fileset, {
            ...commonOptions,
            canvas: document.createElement("canvas"),
            baseOptions: { modelAssetPath: assets.modelUrl, delegate: "GPU" },
          });
        } catch {
          recognizer = await GestureRecognizer.createFromOptions(fileset, {
            ...commonOptions,
            baseOptions: { modelAssetPath: assets.modelUrl, delegate: "CPU" },
          });
        }
        if (stopped) {
          recognizer.close();
          recognizer = null;
          return;
        }
        setPhase("ready");
        setDetail("单手瞄准与抓取；双手同时捏合可平移、缩放和旋转。");

        const detect = (now: number) => {
          if (stopped || !recognizer) return;
          animationFrame = window.requestAnimationFrame(detect);
          if (
            video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
            || now - lastInferenceAt < INFERENCE_INTERVAL_MS
            || video.currentTime === lastVideoTime
          ) return;
          lastInferenceAt = now;
          lastVideoTime = video.currentTime;

          const result = recognizer.recognizeForVideo(video, now);
          const detections = result.landmarks.flatMap((landmarks, index) => {
            const pose = handPoseFromLandmarks(landmarks);
            if (!pose) return [];
            const handednessName = result.handedness[index]?.[0]?.categoryName;
            const handedness: RuntimeHand["handedness"] = handednessName === "Left" || handednessName === "Right"
              ? handednessName
              : "Unknown";
            const category = result.gestures[index]?.[0];
            const candidate = KNOWN_GESTURES.has(category?.categoryName as GraphHandGesture)
              ? category?.categoryName as GraphHandGesture
              : "None";
            const gesture = category?.score
              && category.score >= gestureScoreThreshold(candidate) ? candidate : "None";
            const worldLandmarks = result.worldLandmarks[index] ?? [];
            const worldZSamples = [0, 5, 9, 13, 17]
              .map((landmarkIndex) => worldLandmarks[landmarkIndex]?.z)
              .filter((value): value is number => Number.isFinite(value));
            const worldZ = worldZSamples.length > 0
              ? worldZSamples.reduce((sum, value) => sum + value, 0) / worldZSamples.length
              : 0;
            return [{ landmarks, pose, handedness, gesture, worldZ }];
          });

          const previous = [...runtimeHands.values()];
          const assignment = matchHandDetections(
            previous.map((hand) => ({
              id: hand.id,
              x: hand.pose.x,
              y: hand.pose.y,
              handedness: hand.handedness,
            })),
            detections.map((detection) => ({
              x: detection.pose.x,
              y: detection.pose.y,
              handedness: detection.handedness,
            })),
          );

          runtimeHands.forEach((hand) => { hand.visible = false; });
          assignment.matches.forEach(({ previousIndex, detectionIndex }) => {
            const hand = previous[previousIndex];
            const detection = detections[detectionIndex];
            hand.visible = true;
            hand.lastSeen = now;
            hand.handedness = detection.handedness;
            hand.pose = smoothHandPose(hand.pose, detection.pose);
            hand.gestureHold = updateGestureHold(hand.gestureHold, detection.gesture, now);
            hand.gesture = KNOWN_GESTURES.has(hand.gestureHold.gesture as GraphHandGesture)
              ? hand.gestureHold.gesture as GraphHandGesture : "None";
            hand.pinch = updatePinchInteraction(
              hand.pinch,
              detection.pose.pinchRatio,
              now,
              { ...thresholdsRef.current, holdMs: 360 },
            );
            hand.landmarks = detection.landmarks;
            hand.worldZ += (detection.worldZ - hand.worldZ) * 0.22;
          });
          assignment.unmatchedDetections.forEach((detectionIndex) => {
            const detection = detections[detectionIndex];
            const id = `hand-${nextHandNumber}`;
            nextHandNumber += 1;
            const gestureHold = updateGestureHold(null, detection.gesture, now);
            runtimeHands.set(id, {
              id,
              handedness: detection.handedness,
              lastSeen: now,
              visible: true,
              pose: detection.pose,
              gesture: detection.gesture,
              gestureHold,
              pinch: updatePinchInteraction(
                null,
                detection.pose.pinchRatio,
                now,
                { ...thresholdsRef.current, holdMs: 360 },
              ),
              landmarks: detection.landmarks,
              worldZ: detection.worldZ,
            });
          });
          runtimeHands.forEach((hand, id) => {
            if (now - hand.lastSeen > PRIMARY_GRACE_MS) runtimeHands.delete(id);
          });

          const usableHands = [...runtimeHands.values()]
            .filter((hand) => now - hand.lastSeen <= TRACKING_GRACE_MS)
            .toSorted((left, right) => left.id.localeCompare(right.id));
          const visibleHands = usableHands.filter((hand) => hand.visible);
          primaryHandId = resolvePrimaryHandId(
            primaryHandId,
            usableHands.map((hand) => ({
              id: hand.id,
              lastSeen: hand.lastSeen,
              visible: hand.visible,
              event: hand.pinch?.event,
            })),
            now,
            PRIMARY_GRACE_MS,
          );

          const primary = usableHands.find((hand) => hand.id === primaryHandId) ?? usableHands[0];
          const secondary = usableHands.find((hand) => hand.id !== primary?.id);
          if (primary && primary.id !== primaryHandId) primaryHandId = primary.id;

          visibleHands.forEach((hand) => {
            if (hand.gesture === "Open_Palm" && !hand.pinch?.pinching) {
              calibrationSamplesRef.current.open.push(hand.pose.pinchRatio);
              calibrationSamplesRef.current.open = calibrationSamplesRef.current.open.slice(-40);
            }
            if (hand.pinch?.pinching) {
              calibrationSamplesRef.current.closed.push(hand.pose.pinchRatio);
              calibrationSamplesRef.current.closed = calibrationSamplesRef.current.closed.slice(-40);
            }
          });

          let action: GraphHandActionEvent | null = null;
          let transform: GraphHandTransform | null = null;
          const pinchingHands = usableHands.filter((hand) => hand.pinch?.pinching).slice(0, 2);
          const metrics = pinchingHands.length === 2
            ? twoHandMetrics(
                { id: pinchingHands[0].id, x: pinchingHands[0].pose.x, y: pinchingHands[0].pose.y },
                { id: pinchingHands[1].id, x: pinchingHands[1].pose.x, y: pinchingHands[1].pose.y },
              )
            : null;
          if (metrics && metrics.distance >= MIN_DUAL_SEPARATION) {
            if (dualCandidateSince === 0) dualCandidateSince = now;
            if (!dualActive && now - dualCandidateSince >= DUAL_TRANSFORM_HOLD_MS) {
              dualActive = true;
              dualStartSeparation = metrics.distance;
              previousDualMetrics = metrics;
              closeMenu();
              pinchingHands.forEach((hand) => {
                if (hand.pinch) hand.pinch = { ...hand.pinch, grabbed: true, progress: 1 };
              });
            }
          } else if (!dualActive) {
            dualCandidateSince = 0;
          }

          if (dualActive) {
            if (metrics && pinchingHands.length === 2) {
              transform = twoHandTransformDelta(previousDualMetrics ?? metrics, metrics);
              previousDualMetrics = metrics;
            } else if (pinchingHands.length < 2) {
              dualActive = false;
              dualCandidateSince = 0;
              previousDualMetrics = null;
              const remaining = pinchingHands[0];
              if (remaining?.pinch) {
                remaining.pinch = {
                  ...remaining.pinch,
                  grabbed: true,
                  progress: 1,
                  startedAt: now - 360,
                };
                primaryHandId = remaining.id;
              }
            }
          }

          if (!dualActive && !menu.open && secondary && primary) {
            const stationaryPalm = secondary.visible
              && secondary.gesture === "Open_Palm"
              && !secondary.pinch?.pinching;
            if (!stationaryPalm) {
              supportPalm = null;
            } else if (!supportPalm || supportPalm.handId !== secondary.id) {
              supportPalm = {
                handId: secondary.id,
                since: now,
                x: secondary.pose.x,
                y: secondary.pose.y,
              };
            } else if (Math.hypot(
              secondary.pose.x - supportPalm.x,
              secondary.pose.y - supportPalm.y,
            ) > 0.025) {
              supportPalm = {
                handId: secondary.id,
                since: now,
                x: secondary.pose.x,
                y: secondary.pose.y,
              };
            } else if (now - supportPalm.since >= PALM_MENU_HOLD_MS) {
              menu = {
                open: true,
                kind: "palm",
                ownerHandId: secondary.id,
                cursorHandId: primary.id,
                centerX: secondary.pose.x,
                centerY: secondary.pose.y,
                selected: null,
              };
              publishMenu();
              supportPalm = null;
            }
          } else if (!secondary) {
            supportPalm = null;
          }

          if (!dualActive && !menu.open && primary) {
            const victoryReady = primary.gesture === "Victory"
              && (primary.gestureHold?.evidenceFrames ?? 0) >= 5
              && now - (primary.gestureHold?.since ?? now) >= RADIAL_MENU_HOLD_MS;
            if (victoryReady && !singleMenuEmitted) {
              menu = {
                open: true,
                kind: "single",
                ownerHandId: primary.id,
                cursorHandId: primary.id,
                centerX: primary.pose.x,
                centerY: primary.pose.y,
                selected: null,
              };
              singleMenuEmitted = true;
              publishMenu();
            }
            if (primary.gesture !== "Victory") singleMenuEmitted = false;
          }

          if (menu.open) {
            const owner = usableHands.find((hand) => hand.id === menu.ownerHandId);
            const cursorHand = usableHands.find((hand) => hand.id === menu.cursorHandId);
            const ownerValid = menu.kind === "single"
              ? Boolean(owner)
              : Boolean(owner?.gesture === "Open_Palm" && !owner.pinch?.pinching);
            if (!ownerValid || !cursorHand) {
              closeMenu();
            } else {
              if (menu.kind === "palm" && owner) {
                menu.centerX = owner.pose.x;
                menu.centerY = owner.pose.y;
              }
              const picked = radialActionAt(
                menu.centerX,
                menu.centerY,
                cursorHand.pose.x,
                cursorHand.pose.y,
              );
              menu.selected = picked?.action ?? null;
              publishMenu();
              if (cursorHand.pinch?.event === "select" || cursorHand.pinch?.event === "release") {
                if (picked && (!picked.requiresSelection || selectedLabelRef.current)) {
                  action = { type: picked.action, handId: cursorHand.id };
                }
                closeMenu();
              }
            }
          }

          if (!dualActive && !menu.open) {
            visibleHands.forEach((hand) => {
              if (action || hand.pinch?.event !== "select") return;
              const target = targetsRef.current.find((item) => item.handId === hand.id);
              if (target?.kind !== "node") return;
              const secondarySelection = hand.id !== primaryHandId && Boolean(selectedLabelRef.current);
              action = {
                type: secondarySelection ? "toggle-relation-target" : "select-target",
                handId: hand.id,
              };
              if (!secondarySelection) primaryHandId = hand.id;
            });
          }

          let mode: GraphHandMode;
          if (onboardingRef.current.visible) mode = "calibration";
          else if (dualActive) mode = "dual-transform";
          else if (menu.open) mode = "palm-menu";
          else if (usableHands.length >= 2 && relationRef.current) mode = "relation-preview";
          else if (usableHands.length >= 2) mode = "dual-ready";
          else if (primary?.pinch?.grabbed) mode = "single-grab";
          else if (primary?.pinch?.pinching) mode = "single-pinch";
          else mode = "single-aim";

          const frameHands: GraphTrackedHandFrame[] = usableHands.map((hand) => ({
            id: hand.id,
            handedness: hand.handedness,
            role: hand.id === primaryHandId ? "primary" : "secondary",
            visible: hand.visible,
            ...hand.pose,
            gesture: hand.gesture,
            pinching: hand.pinch?.pinching ?? false,
            grabbed: dualActive ? Boolean(hand.pinch?.pinching) : hand.pinch?.grabbed ?? false,
            pinchProgress: hand.pinch?.progress ?? 0,
            pointerX: hand.pose.x,
            pointerY: hand.pose.y,
            worldZ: hand.worldZ,
          }));
          const frame: GraphHandNavigationFrame = {
            hands: frameHands,
            mode,
            primaryHandId,
            transform,
            action: onboardingRef.current.visible ? null : action,
          };

          if (onboardingRef.current.visible) {
            const step = onboardingRef.current.step;
            if (step === 0) {
              onboardingEvidence = primary?.visible && primary.gesture === "Open_Palm"
                ? onboardingEvidence + 1 : 0;
              if (onboardingEvidence >= 8) advanceOnboarding(0);
            } else if (step === 1) {
              const target = primary
                ? targetsRef.current.find((item) => item.handId === primary.id)
                : null;
              onboardingEvidence = target?.kind === "node" ? onboardingEvidence + 1 : 0;
              if (onboardingEvidence >= 6) advanceOnboarding(1);
            } else if (step === 2 && primary?.pinch?.event === "select") {
              advanceOnboarding(2);
            } else if (step === 3 && primary?.pinch?.grabbed) {
              onboardingGrabOrigin ??= { x: primary.pose.x, y: primary.pose.y };
              if (Math.hypot(
                primary.pose.x - onboardingGrabOrigin.x,
                primary.pose.y - onboardingGrabOrigin.y,
              ) >= 0.035) advanceOnboarding(3);
            } else if (
              step === 4
              && dualActive
              && metrics
              && dualStartSeparation > 0
              && Math.abs(metrics.distance / dualStartSeparation - 1) >= 0.12
            ) {
              advanceOnboarding(4);
            }
          }

          onFrameRef.current(frame);
          setUiFrame(frame);
          if (action) {
            setActionFeedback(action.type);
            window.clearTimeout(feedbackTimer);
            feedbackTimer = window.setTimeout(() => setActionFeedback(null), 920);
          }
          const canvas = canvasRef.current;
          if (canvas) drawHands(canvas, video, usableHands, primaryHandId);
          setPhase(usableHands.length > 0 ? "tracking" : "ready");
        };
        animationFrame = window.requestAnimationFrame(detect);
      } catch (error) {
        if (stopped) return;
        onFrameRef.current(null);
        setUiFrame(null);
        setPhase("error");
        setDetail(cameraErrorMessage(error));
        stopStream();
      }
    };

    void run();
    return () => {
      stopped = true;
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(feedbackTimer);
      onFrameRef.current(null);
      recognizer?.close();
      recognizer = null;
      stopStream();
    };
  }, [active, enabled, retry]);

  if (!active) return null;

  const targetByHand = new Map(targets.map((target) => [target.handId, target]));
  const primary = uiFrame?.hands.find((hand) => hand.id === uiFrame.primaryHandId) ?? null;
  const secondary = uiFrame?.hands.find((hand) => hand.role === "secondary") ?? null;
  const pinchingHands = uiFrame?.hands.filter((hand) => hand.pinching) ?? [];
  const dualTooClose = pinchingHands.length === 2
    && Math.hypot(
      pinchingHands[1].x - pinchingHands[0].x,
      pinchingHands[1].y - pinchingHands[0].y,
    ) < MIN_DUAL_SEPARATION;
  const selectedRadialAction = RADIAL_ACTIONS.find((item) => item.action === radialMenu.selected);
  const showVideo = enabled && phase !== "error" && phase !== "idle";
  const modeTitle = actionFeedback
    ? ACTION_COPY[actionFeedback]
    : dualTooClose
      ? "双手分开一点"
    : uiFrame?.mode === "dual-transform"
      ? "双手操纵中"
      : uiFrame?.mode === "relation-preview"
        ? "正在探索节点关系"
        : uiFrame?.mode === "palm-menu"
          ? selectedRadialAction?.label ?? "空间菜单"
          : primary?.pinching
            ? "快速松手选择 · 继续捏住抓取"
            : primary ? "掌心射线已就绪" : phase === "ready" ? "举起一只手开始探索" : detail;

  return (
    <>
      {uiFrame?.hands.filter((hand) => hand.visible).map((hand) => {
        const target = targetByHand.get(hand.id);
        const label = hand.grabbed
          ? `已抓住${target?.kind === "node" ? ` · ${target.label}` : "空间"}`
          : hand.pinching
            ? target?.kind === "node" ? `${target.label} · 松手选择` : "继续捏住以抓取"
            : target?.kind === "node" ? `${target.label} · 捏合选择` : hand.role === "primary" ? "主手" : "辅助手";
        return (
          <div
            key={hand.id}
            className="graph-hand-cursor"
            data-role={hand.role}
            data-grabbed={hand.grabbed ? "true" : "false"}
            data-pinching={hand.pinching ? "true" : "false"}
            data-target={target?.kind ?? "space"}
            data-interaction={uiFrame.mode}
            style={{
              "--hand-x": `${Math.min(96, Math.max(4, hand.x * 100))}%`,
              "--hand-y": `${Math.min(92, Math.max(8, hand.y * 100))}%`,
              "--pinch-progress": `${Math.round(hand.pinchProgress * 360)}deg`,
              "--target-color": target?.color ?? (hand.role === "primary" ? "#83f2c5" : "#76d9ff"),
            } as CSSProperties}
            aria-hidden="true"
          >
            <i /><i /><b>{label}</b>
          </div>
        );
      })}

      {uiFrame?.mode === "dual-transform" && primary && secondary && (
        <div
          className="graph-hand-dual-link"
          style={{
            "--dual-x1": `${primary.x * 100}%`,
            "--dual-y1": `${primary.y * 100}%`,
            "--dual-x2": `${secondary.x * 100}%`,
            "--dual-y2": `${secondary.y * 100}%`,
            "--dual-distance": `${Math.hypot(secondary.x - primary.x, secondary.y - primary.y) * 100}vw`,
            "--dual-angle": `${Math.atan2(secondary.y - primary.y, secondary.x - primary.x)}rad`,
          } as CSSProperties}
          aria-hidden="true"
        >
          <span>
            {uiFrame.transform
              ? `${Math.round(uiFrame.transform.scaleRatio * 100)}% · ${Math.round(uiFrame.transform.rotationDelta * 180 / Math.PI)}°`
              : "双手已连接"}
          </span>
        </div>
      )}

      {radialMenu.open && (
        <div
          className="graph-hand-radial"
          data-kind={radialMenu.kind}
          style={{
            "--menu-x": `${Math.min(90, Math.max(10, radialMenu.centerX * 100))}%`,
            "--menu-y": `${Math.min(86, Math.max(14, radialMenu.centerY * 100))}%`,
          } as CSSProperties}
          aria-label="空间手势菜单"
        >
          <div><span>{radialMenu.kind === "palm" ? "辅助手掌盘" : "移动掌心"}</span><b>主手捏合确认</b></div>
          {RADIAL_ACTIONS.map((item) => {
            const disabled = Boolean(item.requiresSelection && !selectedLabel);
            return (
              <span
                key={item.action}
                data-active={radialMenu.selected === item.action ? "true" : "false"}
                data-disabled={disabled ? "true" : "false"}
                style={{ "--menu-angle": `${item.angle}deg` } as CSSProperties}
              >
                <b>{item.icon}</b><small>{disabled ? "先选择节点" : item.label}</small>
              </span>
            );
          })}
        </div>
      )}

      {relation && (
        <aside className="graph-hand-relation" data-connected={relation.connected ? "true" : "false"}>
          <span>RELATION TRACE {relation.locked ? "· LOCKED" : "· PREVIEW"}</span>
          <strong>{relation.sourceLabel}<i>→</i>{relation.targetLabel}</strong>
          <small>
            {relation.connected
              ? `${relation.pathLength} 跳连接 · ${relation.commonCount} 个共同邻居${relation.pathLabels.length > 0 ? ` · ${relation.pathLabels.slice(0, 3).join("  ")}` : ""}`
              : "当前可见关系中没有连接"}
          </small>
        </aside>
      )}

      <aside
        className="graph-hand-console"
        data-phase={uiFrame?.mode === "dual-transform" ? "dual" : phase}
        data-video={showVideo ? "true" : "false"}
        aria-label="摄像头手势控制"
      >
        {showVideo && (
          <div className="graph-hand-preview" aria-hidden="true">
            <video ref={videoRef} muted playsInline />
            <canvas ref={canvasRef} />
            <i />
          </div>
        )}
        <div className="graph-hand-status" aria-live="polite">
          <span><i /> HAND NAVIGATION <b>{uiFrame?.hands.length === 2 ? "DUAL" : "SINGLE"}</b></span>
          <strong>{modeTitle}</strong>
          <small>
            {uiFrame?.mode === "dual-transform"
              ? "移动中点平移 · 拉开缩放 · 转动双手旋转"
              : uiFrame?.hands.length === 2
                ? "辅助手稳定张掌可展开菜单盘；双手同时捏合可操纵空间"
                : "短捏选择 · 捏住抓取 · ✌ 呼出菜单"}
          </small>
        </div>
        <details className="graph-hand-guide">
          <summary>查看操作方法</summary>
          <div>
            <span data-active={uiFrame?.mode === "single-aim" ? "true" : "false"}><b>🖐</b><small>掌心瞄准</small></span>
            <span data-active={uiFrame?.mode === "single-pinch" ? "true" : "false"}><b>🤏</b><small>短捏选择</small></span>
            <span data-active={uiFrame?.mode === "single-grab" ? "true" : "false"}><b>🤏</b><small>捏住抓取</small></span>
            <span data-active={uiFrame?.mode === "dual-transform" ? "true" : "false"}><b>↔</b><small>双手变换</small></span>
            <span data-active={uiFrame?.mode === "relation-preview" ? "true" : "false"}><b>⛓</b><small>关系探索</small></span>
            <span data-active={uiFrame?.mode === "palm-menu" ? "true" : "false"}><b>✋</b><small>掌心菜单</small></span>
          </div>
        </details>
        <div className="graph-hand-actions">
          {phase === "error" ? (
            <button type="button" onClick={() => setRetry((current) => current + 1)}>重试</button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (enabled) {
                  setPhase("idle");
                  setUiFrame(null);
                  setActionFeedback(null);
                  setRadialMenu((current) => ({ ...current, open: false, selected: null }));
                }
                setEnabled((current) => !current);
              }}
            >
              {enabled ? "关闭摄像头" : "启用手势"}
            </button>
          )}
          <button type="button" onClick={replayOnboarding}>重新校准</button>
          {uiFrame?.mode === "dual-transform" && <b>DUAL GRAB</b>}
        </div>
      </aside>

      {onboarding.visible && (
        <section className="graph-hand-onboarding" aria-label="手势校准">
          <span>HAND CALIBRATION · {onboarding.step + 1}/{ONBOARDING_STEPS.length}</span>
          <strong>{ONBOARDING_STEPS[onboarding.step].title}</strong>
          <p>{ONBOARDING_STEPS[onboarding.step].hint}</p>
          <div>{ONBOARDING_STEPS.map((_, index) => <i key={index} data-done={index <= onboarding.step ? "true" : "false"} />)}</div>
          <button type="button" onClick={() => finishOnboarding(true)}>跳过引导</button>
        </section>
      )}
    </>
  );
}
