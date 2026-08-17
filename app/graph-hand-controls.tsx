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
  fistDragEngagement,
  gestureScoreThreshold,
  handPoseFromLandmarks,
  isPinchPose,
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
// 24fps：识别帧率直接决定捏合/拖动的响应下限。15fps 时一帧就有 67ms，
// 快速短捏常整个落在两帧之间；相机流本身 ideal 24，再高也拿不到新帧。
// GPU 委托专用——CPU 回退时单次推理就要几十毫秒，24fps 会和 Three 渲染
// 抢主线程，越慢的机器拖动越黏，退回 15fps（见 CPU_INFERENCE_INTERVAL_MS）。
const INFERENCE_INTERVAL_MS = 1000 / 24;
const CPU_INFERENCE_INTERVAL_MS = 1000 / 15;
const RADIAL_MENU_HOLD_MS = 560;
const ONBOARDING_STEP_TIMEOUT_MS = 22000;
// 捏住不动多久算“我要原地抓取”。真正的拖动由位移即时接管（见 lib 的
// moveThreshold），这里只是给“捏住不动想缩放”的兜底，因此可以放得很宽——
// 放窄会把人正常的确认捏合（300–500ms）判成抓取，短捏选择就永远发不出。
const GRAB_HOLD_MS = 620;
const PALM_MENU_HOLD_MS = 550;
const DUAL_TRANSFORM_HOLD_MS = 120;
const TRACKING_GRACE_MS = 250;
const PRIMARY_GRACE_MS = 350;
const MIN_DUAL_SEPARATION = 0.12;
// 键名随捏合判定模型一起升版。存盘的阈值会原样覆盖代码里的默认值，
// 旧版标定出的偏紧阈值会让改过默认值的新版本对老用户完全不起作用——
// 表现就是「代码明明改了，捏下去还是没反应」。
const ONBOARDING_STORAGE_KEY = "echo:graph-hand-onboarding:v3";

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

/** 主手的实时判定量。手势失灵时肉眼无从判断卡在哪一环，面板直接摊开。 */
export type GraphHandDiagnostics = {
  pinchRatio: number;
  closeThreshold: number;
  releaseThreshold: number;
  calibrated: boolean;
  gesture: string;
  pinchPose: boolean;
  suppressed: boolean;
  travel: number;
  moveThreshold: number;
  lastEvent: string;
  targetKind: string;
};

export type GraphHandNavigationFrame = {
  hands: GraphTrackedHandFrame[];
  mode: GraphHandMode;
  primaryHandId: string | null;
  transform: GraphHandTransform | null;
  action: GraphHandActionEvent | null;
  diagnostics?: GraphHandDiagnostics;
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
  /** 当帧原始观测（未经 updateGestureHold 宽限保持），驱动握拳的即时停手。 */
  rawGesture: GraphHandGesture;
  gestureHold: GestureHold | null;
  pinch: PinchInteraction | null;
  /**
   * 握拳时拇指食指本来就贴在一起，捏合状态机会把整个拳读成一次长捏，
   * 松拳瞬间误发 select/release（节点上=误选中并起飞运镜，菜单里=误确认）。
   * 拳一旦接管拖动，这只手当前这轮捏合的全部事件都作废，直到彻底松开。
   */
  pinchSuppressed: boolean;
  /** 最近一次捏合 press 的时刻；菜单确认用它区分“菜单打开后才按下”的捏合。 */
  lastPressAt: number;
  /** 连续观测到「非拳非 None」手势的帧数；连续两帧才判拳真正结束。 */
  fistBreakStreak: number;
  /** 几何判定的捏合姿势；为真时这只手不走握拳语法。 */
  pinchPose: boolean;
  /** 未经平滑的当帧捏合比值。判定用它，校准采样也必须用它。 */
  rawPinchRatio: number;
  landmarks: NormalizedLandmark[];
  worldZ: number;
};

// 握拳=「抓住空间」。分类器对 Closed_Fist 的召回远高于持续捏合（捏合在快速
// 移动中常因运动模糊被误判松开），平移这种粗粒度操作交给它零等待接管；
// 捏合只负责需要精度的选择与节点抓取。判定本体在 lib（带行为测试）。
//
// pinchPose 一票否决：分类器同样会把捏合判成 Closed_Fist（捏合时其余三指
// 也蜷缩），而拳一接管就会整轮作废这只手的捏合事件——短捏选择因此永远
// 发不出来。几何上确认是捏合的手，一律走捏合语法。
function fistDragEngaged(hand: {
  gestureHold: GestureHold | null;
  rawGesture: GraphHandGesture;
  pinchPose: boolean;
}) {
  if (hand.pinchPose) return false;
  return fistDragEngagement(hand.gestureHold, hand.rawGesture);
}

// 拳的“身份”维持：保持轨道仍是拳就算数（单帧误分类不夺权）。跟不跟手
// 再看 fistDragEngaged 的 raw 层——身份在、当帧观测异常时暂停跟手，
// 和捏合的 releasePending 同一原则：保身份、停动作。
function fistMaintained(hand: {
  gestureHold: GestureHold | null;
  pinchPose: boolean;
}) {
  if (hand.pinchPose) return false;
  return hand.gestureHold?.gesture === "Closed_Fist"
    && (hand.gestureHold.evidenceFrames ?? 0) >= 2;
}

type RadialMenuState = {
  open: boolean;
  kind: "single" | "palm";
  ownerHandId: string | null;
  cursorHandId: string | null;
  centerX: number;
  centerY: number;
  selected: GraphHandAction | null;
  /**
   * 菜单打开时刻。确认只认「打开之后才按下」的捏合：光标手若在打开前就
   * 捏着拖拽，收手的 release 不能被当成确认——否则菜单一开用户连
   * “松手作罢”都做不到，随便一收手就执行了落点扇区的动作。
   */
  openedAt: number;
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
  { title: "抓住拖动", hint: "握拳（或捏住不放）并移动手掌" },
  { title: "双手操纵", hint: "两手同时握拳或捏住，然后把两手拉开" },
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
    // 存盘值只接受“比默认更宽松”的一侧。标定偏紧的话用户怎么捏都进不了
    // 按下状态，而他无从知道问题出在一次很久以前的采样上。
    const usable = Number.isFinite(thresholds?.closeThreshold)
      && Number.isFinite(thresholds?.releaseThreshold)
      && thresholds.closeThreshold >= DEFAULT_THRESHOLDS.closeThreshold
      && thresholds.releaseThreshold > thresholds.closeThreshold;
    return {
      seen: parsed?.seen === true,
      thresholds: usable ? thresholds as PinchThresholds : DEFAULT_THRESHOLDS,
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
    openedAt: 0,
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
    openedAt: 0,
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

  // 校准出的阈值会写进 localStorage 长期生效。若首次校准时捏得比平时紧，
  // closeThreshold 会被固化成一个之后再也够不着的值，捏多少次都没反应，
  // 而用户无从知道问题出在一次旧采样上——所以留一个一键回默认的出口。
  const resetCalibration = () => {
    calibrationSamplesRef.current = { open: [], closed: [] };
    thresholdsRef.current = DEFAULT_THRESHOLDS;
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
        seen: true,
        thresholds: DEFAULT_THRESHOLDS,
      }));
    } catch {
      // 隐私模式下写不进去也没关系，本次会话已经用上默认阈值。
    }
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
    let inferenceIntervalMs = INFERENCE_INTERVAL_MS;
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
    let onboardingStepAt = 0;
    // select 只出现一帧，肉眼追不上；留住最近一次非空事件供诊断面板显示。
    let lastPinchEvent = "none";
    let lastPinchEventAt = 0;

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
      onboardingStepAt = 0;
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
          inferenceIntervalMs = CPU_INFERENCE_INTERVAL_MS;
        }
        if (stopped) {
          recognizer.close();
          recognizer = null;
          return;
        }
        setPhase("ready");
        setDetail("单手瞄准与选择，握拳即可拖动；双手同时握拳或捏合可平移、缩放和旋转。");

        const detect = (now: number) => {
          if (stopped || !recognizer) return;
          animationFrame = window.requestAnimationFrame(detect);
          if (
            video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
            || now - lastInferenceAt < inferenceIntervalMs
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
            const heldFistBefore = fistMaintained(hand);
            hand.rawGesture = detection.gesture;
            // 捏合姿势带滞回：几何闸门（指尖距 0.62 掌尺度）比松手阈值
            // (0.68) 先一步失效，松手那一帧 pinchPose 必然翻假——而 select
            // 正好在那一帧发出，拳会当场接管并把它作废。只要这轮捏合还没
            // 结束，就一直按捏合对待。
            hand.pinchPose = isPinchPose(detection.landmarks)
              || (hand.pinch?.pinching ?? false);
            hand.rawPinchRatio = detection.pose.pinchRatio;
            hand.gestureHold = updateGestureHold(hand.gestureHold, detection.gesture, now);
            // 拳→其他明确手势连续两帧＝真的松拳，立刻结束保持轨道。
            // 一帧就砍会让单帧误分类拆掉双拳操纵；只等 240ms 宽限自然过期
            // 又会让松拳后立刻发起的捏合被 raw=None 重新读成拳、拖着目标跑。
            if (
              hand.gestureHold.gesture === "Closed_Fist"
              && detection.gesture !== "Closed_Fist"
              && detection.gesture !== "None"
            ) {
              hand.fistBreakStreak += 1;
              if (hand.fistBreakStreak >= 2) {
                hand.gestureHold = updateGestureHold(null, detection.gesture, now);
                hand.fistBreakStreak = 0;
              }
            } else {
              hand.fistBreakStreak = 0;
            }
            hand.gesture = KNOWN_GESTURES.has(hand.gestureHold.gesture as GraphHandGesture)
              ? hand.gestureHold.gesture as GraphHandGesture : "None";
            // 抓取由位移触发，不再按“瞄的是节点还是空间”分流 holdMs——
            // 那套分流依赖 targetsRef 的一帧回灌延迟，按下当帧读到旧值就会
            // 把 360ms 悄悄换成 120ms，本想选节点的捏合被吞成拖动。
            const pinchOptions = {
              ...thresholdsRef.current,
              holdMs: GRAB_HOLD_MS,
              // 位移判据必须吃原始坐标：EMA 平滑后的质心在按下瞬间还落后
              // 真实位置一两帧，接下来几帧的“追赶”会被当成用户在拖动。
              x: detection.pose.x,
              y: detection.pose.y,
              scale: detection.pose.scale,
              // 菜单里没有拖动可保：释放宽限只会让确认迟 130ms 且跟着
              // 回摆漂移到别的扇区，光标手在菜单打开期间即时释放。
              releaseGraceMs: menu.open && menu.cursorHandId === hand.id ? 0 : undefined,
            };
            hand.pinch = updatePinchInteraction(
              hand.pinch,
              detection.pose.pinchRatio,
              now,
              pinchOptions,
            );
            // 拳结束的瞬间重启捏合状态机：拳期间的“长捏”已整轮作废，若让它
            // 从释放宽限里无缝续接，紧接着的真捏合会永远发不出 select。
            // 但不能盖掉本帧已经产生的事件——重启会把它抹成 press/none，
            // 恰好在拳刚松、用户接着短捏的那一帧把 select 吃掉。
            if (
              heldFistBefore
              && !fistMaintained(hand)
              && hand.pinch.event !== "select"
              && hand.pinch.event !== "release"
            ) {
              hand.pinch = updatePinchInteraction(
                null,
                detection.pose.pinchRatio,
                now,
                pinchOptions,
              );
              hand.pinchSuppressed = false;
            }
            if (hand.pinch.event === "press") hand.lastPressAt = now;
            if (fistDragEngaged(hand)) {
              hand.pinchSuppressed = true;
            } else if (
              hand.pinchPose
              || (!hand.pinch.pinching && hand.pinch.event === "none")
            ) {
              // 几何确认是捏合就立刻解除作废（拳转捏合时 pinching 不会落回
              // false，只等空闲帧会把这轮捏合整个锁死）；否则等一个空闲帧，
              // 因为 release/select 事件帧本身仍属于拳的作废期。
              hand.pinchSuppressed = false;
            }
            hand.landmarks = detection.landmarks;
            hand.worldZ += (detection.worldZ - hand.worldZ) * 0.22;
          });
          assignment.unmatchedDetections.forEach((detectionIndex) => {
            const detection = detections[detectionIndex];
            const id = `hand-${nextHandNumber}`;
            nextHandNumber += 1;
            const gestureHold = updateGestureHold(null, detection.gesture, now);
            const pinch = updatePinchInteraction(
              null,
              detection.pose.pinchRatio,
              now,
              {
                ...thresholdsRef.current,
                holdMs: GRAB_HOLD_MS,
                x: detection.pose.x,
                y: detection.pose.y,
                scale: detection.pose.scale,
              },
            );
            runtimeHands.set(id, {
              id,
              handedness: detection.handedness,
              lastSeen: now,
              visible: true,
              pose: detection.pose,
              gesture: detection.gesture,
              rawGesture: detection.gesture,
              pinchSuppressed: false,
              lastPressAt: pinch.event === "press" ? now : 0,
              fistBreakStreak: 0,
              pinchPose: isPinchPose(detection.landmarks),
              rawPinchRatio: detection.pose.pinchRatio,
              gestureHold,
              pinch,
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
            // 采样必须和判定用同一个量：判定吃的是原始 pinchRatio，采样若取
            // EMA 平滑后的 pose，标定出来的阈值就落在另一个域里，随手速漂移。
            if (hand.gesture === "Open_Palm" && !hand.pinch?.pinching) {
              calibrationSamplesRef.current.open.push(hand.rawPinchRatio);
              calibrationSamplesRef.current.open = calibrationSamplesRef.current.open.slice(-40);
            }
            if (hand.pinch?.pinching && !hand.pinchSuppressed) {
              calibrationSamplesRef.current.closed.push(hand.rawPinchRatio);
              calibrationSamplesRef.current.closed = calibrationSamplesRef.current.closed.slice(-40);
            }
          });

          let action: GraphHandActionEvent | null = null;
          let transform: GraphHandTransform | null = null;
          // 双手操纵的“参与”：捏住（拳接管时捏合作废）或握拳。两拳拉开缩放
          // 和两捏一样合法，而且在快速动作里稳得多。参与≠稳定：参与决定
          // 双手态是否维持，稳定才喂 metrics——不稳定就暂停变换而不是拆台，
          // 否则剩下那只手的对称运动会被当成全额单手平移灌进相机。
          const maintainedHands = usableHands
            .filter((hand) => (
              (hand.pinch?.pinching && !hand.pinchSuppressed) || fistMaintained(hand)
            ))
            .slice(0, 2);
          // 不稳定的三种情形：丢帧手（状态冻结，位置是幽灵）；捏合在释放宽限
          // （已张开、在回摆）；拳被单帧误分类（raw 异常）。拳手忽略它那条
          // 被作废捏合的 releasePending——那个宽限防“张开回摆”，对拳不成立，
          // 否则拳内指尖距离的单帧噪声会让双拳变换周期性冻结 130ms。
          const steadyHands = maintainedHands.filter((hand) => (
            hand.visible && (
              fistMaintained(hand)
                ? fistDragEngaged(hand)
                : !hand.pinch?.releasePending
            )
          ));
          const metrics = steadyHands.length === 2
            ? twoHandMetrics(
                { id: steadyHands[0].id, x: steadyHands[0].pose.x, y: steadyHands[0].pose.y },
                { id: steadyHands[1].id, x: steadyHands[1].pose.x, y: steadyHands[1].pose.y },
              )
            : null;
          if (metrics && metrics.distance >= MIN_DUAL_SEPARATION) {
            if (dualCandidateSince === 0) dualCandidateSince = now;
            if (!dualActive && now - dualCandidateSince >= DUAL_TRANSFORM_HOLD_MS) {
              dualActive = true;
              dualStartSeparation = metrics.distance;
              previousDualMetrics = metrics;
              closeMenu();
              steadyHands.forEach((hand) => {
                if (hand.pinch?.pinching) {
                  hand.pinch = { ...hand.pinch, grabbed: true, progress: 1 };
                }
              });
            }
          } else if (!dualActive) {
            dualCandidateSince = 0;
          }

          if (dualActive) {
            if (metrics && steadyHands.length === 2) {
              transform = twoHandTransformDelta(previousDualMetrics ?? metrics, metrics);
              previousDualMetrics = metrics;
            } else if (maintainedHands.length >= 2) {
              // 一只手在释放宽限期：暂停变换（transform=null）但保持双手态；
              // 重新捏拢后从新的相对位置续算，不产生突跳。
              previousDualMetrics = null;
            } else {
              dualActive = false;
              dualCandidateSince = 0;
              previousDualMetrics = null;
              const remaining = maintainedHands[0];
              if (remaining?.pinch?.pinching) {
                remaining.pinch = {
                  ...remaining.pinch,
                  grabbed: true,
                  progress: 1,
                  startedAt: now - GRAB_HOLD_MS,
                };
              }
              if (remaining) primaryHandId = remaining.id;
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
                openedAt: now,
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
                openedAt: now,
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
              if (
                !cursorHand.pinchSuppressed
                && cursorHand.lastPressAt >= menu.openedAt
                && (cursorHand.pinch?.event === "select" || cursorHand.pinch?.event === "release")
              ) {
                if (picked && (!picked.requiresSelection || selectedLabelRef.current)) {
                  action = { type: picked.action, handId: cursorHand.id };
                }
                closeMenu();
              }
            }
          }

          if (!dualActive && !menu.open) {
            visibleHands.forEach((hand) => {
              if (action || hand.pinchSuppressed || hand.pinch?.event !== "select") return;
              // 只丢弃「明确瞄着空白」的短捏。targetsRef 由星图侧经 React 回灌，
              // 至少落后一帧；极快的捏合在松手帧还读不到自己的记录，要求它
              // 等于 node 会把这类选择整个吞掉。没有记录时放行，交给星图侧
              // 用按下帧锁定的目标裁决——那边本来就是权威，没命中即 no-op。
              const target = targetsRef.current.find((item) => item.handId === hand.id);
              if (target && target.kind !== "node") return;
              const secondarySelection = hand.id !== primaryHandId && Boolean(selectedLabelRef.current);
              action = {
                type: secondarySelection ? "toggle-relation-target" : "select-target",
                handId: hand.id,
              };
              if (!secondarySelection) primaryHandId = hand.id;
            });
          }

          // 对外的 grabbed 是“此刻应该跟手”：释放宽限期里保住抓取身份但
          // 暂停跟手（手已张开，位置是回摆），重新捏拢无缝续拖。
          const effectiveGrab = (hand: RuntimeHand) => (
            (Boolean(hand.pinch?.grabbed) && !hand.pinch?.releasePending && !hand.pinchSuppressed)
            || fistDragEngaged(hand)
          );

          let mode: GraphHandMode;
          if (onboardingRef.current.visible) mode = "calibration";
          else if (dualActive) mode = "dual-transform";
          else if (menu.open) mode = "palm-menu";
          else if (usableHands.length >= 2 && relationRef.current) mode = "relation-preview";
          else if (usableHands.length >= 2) mode = "dual-ready";
          else if (primary && effectiveGrab(primary)) mode = "single-grab";
          else if (primary?.pinch?.pinching) mode = "single-pinch";
          else mode = "single-aim";

          const frameHands: GraphTrackedHandFrame[] = usableHands.map((hand) => ({
            id: hand.id,
            handedness: hand.handedness,
            role: hand.id === primaryHandId ? "primary" : "secondary",
            visible: hand.visible,
            ...hand.pose,
            gesture: hand.gesture,
            pinching: (hand.pinch?.pinching ?? false) && !hand.pinchSuppressed,
            grabbed: dualActive
              ? Boolean(hand.pinch?.pinching && !hand.pinchSuppressed) || fistDragEngaged(hand)
              : effectiveGrab(hand),
            pinchProgress: hand.pinchSuppressed ? 0 : hand.pinch?.progress ?? 0,
            pointerX: hand.pose.x,
            pointerY: hand.pose.y,
            worldZ: hand.worldZ,
          }));
          // 引导期间只拦「会把镜头甩走」的导航类动作，选择照常生效。
          // 早期版本把动作整体吞掉，于是首次使用的人做对了短捏也毫无反应，
          // 而引导第 3 步的过关条件恰恰就是这个选择——它自己把自己锁死了。
          const publishedAction = onboardingRef.current.visible
            && action
            && action.type !== "select-target"
            && action.type !== "toggle-relation-target"
              ? null
              : action;
          if (primary?.pinch && primary.pinch.event !== "none") {
            lastPinchEvent = primary.pinch.event;
            lastPinchEventAt = now;
          }
          const frame: GraphHandNavigationFrame = {
            hands: frameHands,
            mode,
            primaryHandId,
            transform,
            action: publishedAction,
            diagnostics: primary
              ? {
                  pinchRatio: primary.pose.pinchRatio,
                  closeThreshold: thresholdsRef.current.closeThreshold,
                  releaseThreshold: thresholdsRef.current.releaseThreshold,
                  calibrated: thresholdsRef.current.calibrated === true,
                  gesture: primary.rawGesture,
                  pinchPose: primary.pinchPose,
                  suppressed: primary.pinchSuppressed,
                  travel: primary.pinch?.travel ?? 0,
                  moveThreshold: 0.038,
                  lastEvent: now - lastPinchEventAt <= 1600 ? lastPinchEvent : "none",
                  targetKind: targetsRef.current
                    .find((item) => item.handId === primary.id)?.kind ?? "—",
                }
              : undefined,
          };

          if (onboardingRef.current.visible) {
            const step = onboardingRef.current.step;
            // 每步都能超时放行。引导是教学不是考卷：最后一步要两只手，单手
            // 的人（或第二只手不在画面里）永远做不到，而走不完就不写 seen，
            // 于是每次进全屏都从第一步重来，正常操作被引导永久挡在门外。
            if (onboardingStepAt === 0) onboardingStepAt = now;
            if (now - onboardingStepAt >= ONBOARDING_STEP_TIMEOUT_MS) {
              advanceOnboarding(step);
            } else if (step === 0) {
              onboardingEvidence = primary?.visible && primary.gesture === "Open_Palm"
                ? onboardingEvidence + 1 : 0;
              if (onboardingEvidence >= 8) advanceOnboarding(0);
            } else if (step === 1) {
              const target = primary
                ? targetsRef.current.find((item) => item.handId === primary.id)
                : null;
              onboardingEvidence = target?.kind === "node" ? onboardingEvidence + 1 : 0;
              if (onboardingEvidence >= 6) advanceOnboarding(1);
            } else if (step === 2) {
              // 拳接管期间作废的 select 不算数，否则短促握拳会替用户“完成”短捏教学。
              if (primary?.pinch?.event === "select" && !primary.pinchSuppressed) {
                advanceOnboarding(2);
              }
            } else if (step === 3) {
              if (primary && effectiveGrab(primary)) {
                onboardingGrabOrigin ??= { x: primary.pose.x, y: primary.pose.y };
                if (Math.hypot(
                  primary.pose.x - onboardingGrabOrigin.x,
                  primary.pose.y - onboardingGrabOrigin.y,
                ) >= 0.035) advanceOnboarding(3);
              } else {
                // 松开就重置原点：否则在 A 点短抓、移到 B 再抓会用陈旧原点瞬间过关。
                onboardingGrabOrigin = null;
              }
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
          if (publishedAction) {
            setActionFeedback(publishedAction.type);
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
  const engagedUiHands = uiFrame?.hands.filter(
    (hand) => hand.pinching || hand.gesture === "Closed_Fist",
  ) ?? [];
  // 只作为“进入双手态前”的引导：变换进行中（合法的捏拢缩小会把间距收进
  // 阈值内）不再改口，否则用户会被指挥去撤销自己的正常操作。
  const dualTooClose = uiFrame?.mode !== "dual-transform"
    && engagedUiHands.length === 2
    && Math.hypot(
      engagedUiHands[1].x - engagedUiHands[0].x,
      engagedUiHands[1].y - engagedUiHands[0].y,
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
          : primary?.grabbed
            ? "拖动星图中 · 张开手结束"
          : primary?.pinching
            ? "快速松手选择 · 继续捏住抓取"
            : primary ? "掌心射线已就绪" : phase === "ready" ? "举起一只手开始探索" : detail;

  return (
    <>
      {uiFrame?.hands.filter((hand) => hand.visible).map((hand) => {
        const target = targetByHand.get(hand.id);
        const label = hand.grabbed
          ? `拖动星图中${target?.kind === "node" ? ` · 锚定 ${target.label}` : ""}`
          : hand.pinching
            ? target?.kind === "node" ? `${target.label} · 松手选择` : "继续捏住以拖动"
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
                ? "辅助手稳定张掌可展开菜单盘；双手同时握拳或捏合可操纵空间"
                : "短捏选择 · 握拳拖动 · ✌ 呼出菜单"}
          </small>
        </div>
        <details className="graph-hand-guide">
          <summary>查看操作方法</summary>
          <div>
            <span data-active={uiFrame?.mode === "single-aim" ? "true" : "false"}><b>🖐</b><small>掌心瞄准</small></span>
            <span data-active={uiFrame?.mode === "single-pinch" ? "true" : "false"}><b>🤏</b><small>短捏选择</small></span>
            <span data-active={uiFrame?.mode === "single-grab" ? "true" : "false"}><b>✊</b><small>握拳拖动</small></span>
            <span data-active={uiFrame?.mode === "dual-transform" ? "true" : "false"}><b>↔</b><small>双手变换</small></span>
            <span data-active={uiFrame?.mode === "relation-preview" ? "true" : "false"}><b>⛓</b><small>关系探索</small></span>
            <span data-active={uiFrame?.mode === "palm-menu" ? "true" : "false"}><b>✋</b><small>掌心菜单</small></span>
          </div>
        </details>
        <details className="graph-hand-debug">
          <summary>手势没反应？看这里</summary>
          {uiFrame?.diagnostics ? (
            <dl>
              <div data-ok={uiFrame.diagnostics.pinchRatio <= uiFrame.diagnostics.closeThreshold ? "true" : "false"}>
                <dt>捏合度</dt>
                <dd>
                  {uiFrame.diagnostics.pinchRatio.toFixed(2)}
                  <i>需 ≤ {uiFrame.diagnostics.closeThreshold.toFixed(2)}</i>
                </dd>
              </div>
              <div data-ok={uiFrame.diagnostics.pinchPose ? "true" : "false"}>
                <dt>姿势</dt>
                <dd>
                  {uiFrame.diagnostics.pinchPose ? "捏合" : "非捏合"}
                  <i>分类 {uiFrame.diagnostics.gesture}</i>
                </dd>
              </div>
              <div data-ok={uiFrame.diagnostics.suppressed ? "false" : "true"}>
                <dt>捏合语法</dt>
                <dd>{uiFrame.diagnostics.suppressed ? "被握拳作废" : "生效中"}</dd>
              </div>
              <div data-ok={uiFrame.diagnostics.targetKind === "node" ? "true" : "false"}>
                <dt>瞄准</dt>
                <dd>{uiFrame.diagnostics.targetKind === "node" ? "节点" : uiFrame.diagnostics.targetKind === "space" ? "空间" : "无"}</dd>
              </div>
              <div>
                <dt>位移</dt>
                <dd>
                  {uiFrame.diagnostics.travel.toFixed(3)}
                  <i>≥ {uiFrame.diagnostics.moveThreshold} 转拖动</i>
                </dd>
              </div>
              <div data-ok={uiFrame.diagnostics.lastEvent === "select" ? "true" : "false"}>
                <dt>最近事件</dt>
                <dd>{uiFrame.diagnostics.lastEvent}</dd>
              </div>
            </dl>
          ) : (
            <p>把手举到画面里，这里会显示实时判定数值。</p>
          )}
          <button type="button" onClick={resetCalibration}>恢复默认灵敏度</button>
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
