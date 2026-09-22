// 3D 舞台共享层：记忆星图（knowledge-graph-three）与时之航道（timeline-three）
// 共用的 three.js 工具。这里只放与「哪张图」无关的部件——着色器、纹理、飞行、
// 锁定物、标签投影、销毁——图专属的布局与语义留在各自视图里。
// 注意：本模块 import 了 three，只允许被两个 lazy 视图引用，
// 绝不能被 memory-atlas.tsx 急加载，否则 three 会被拖进主 chunk。
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { createStageInteraction } from "@/lib/stage-interaction.mjs";
import {
  createPointerMotionField,
  MOTION_IMPULSE_GAIN,
  MOTION_MASS_MAX,
  MOTION_MASS_MIN,
  MOTION_SETTLE_SECONDS,
  MOTION_SPEED_CLAMP,
  MOTION_STROKE_LIMIT,
  type PointerMotionField,
} from "@/lib/stage-motion.mjs";

export const NODE_VERTEX_SHADER = `
  attribute float aSize;
  attribute float aFocus;
  attribute float aPhase;
  attribute float aSearch;
  varying vec3 vColor;
  varying float vFocus;
  varying float vSearch;
  varying float vPointer;
  varying float vLens;
  varying float vBright;
  varying float vFog;
  uniform float uTime;
  uniform float uMotion;
  uniform float uSearchActive;
  uniform float uFogDensity;
  uniform float uFogStrength;
  uniform vec2 uPointer;
  uniform float uPointerEnergy;
  uniform float uDragEnergy;
  uniform float uDeform;
  uniform float uAspect;
  uniform vec2 uMotionOrigin[${MOTION_STROKE_LIMIT}];
  uniform vec2 uMotionSegment[${MOTION_STROKE_LIMIT}];
  uniform vec2 uMotionImpulse[${MOTION_STROKE_LIMIT}];
  uniform float uMotionAge[${MOTION_STROKE_LIMIT}];
  uniform float uMotionRadius;
  uniform vec2 uReleaseCenter;
  uniform float uReleaseImpulse;
  uniform float uReleaseAge;

  // 位移随时间的解析解：速度按 drag 衰减，位移以 1 秒的时间常数回零。
  // 必须与 lib/stage-motion.mjs 的 coastOffset 逐字一致，否则 CPU 侧的
  // 复核（测试、非着色器消费者）会和画面对不上。
  vec2 stageCoast(vec2 velocity, float mass, float age) {
    float drag = 2.3 / sqrt(mass);
    return velocity * (exp(-age) - exp(-drag * age)) / (drag - 1.0);
  }

  void main() {
    vColor = color;
    vFocus = aFocus;
    vSearch = aSearch;
    // 亮度等级由尺寸推出。星图里尺寸＝被引用次数，所以「被引用多的更亮」
    // 既是视觉层级也是语义层级，不需要再多一条属性。
    vBright = smoothstep(0.55, 2.1, aSize);
    float pulse = 1.0 + sin(uTime * 1.5 + aPhase) * 0.08 * uMotion;
    float searchScale = mix(1.0, 1.28, aSearch * uSearchActive);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    // 场景里挂了 FogExp2，但裸 ShaderMaterial 不会自己吃它——之前所有点
    // 不分远近一样亮，整座图谱是平的。远处的点淡下去，才有虚实。
    float fogDistance = length(viewPosition.xyz);
    float fogExponent = uFogDensity * fogDistance;
    vFog = mix(1.0, exp(-fogExponent * fogExponent), uFogStrength);
    vec2 screenPosition = gl_Position.xy / max(0.0001, gl_Position.w);
    // 宽画布上不做纵横比校正的话，影响范围会变成横向拉长的椭圆。
    vec2 aspect = vec2(max(uAspect, 0.0001), 1.0);
    float pointerDistance = length((uPointer - screenPosition) * aspect);
    vPointer = smoothstep(0.42, 0.02, pointerDistance) * uPointerEnergy;
    vLens = 0.0;

    // 只有伴生微尘做局部形变。语义节点把 uDeform 设为 0，避免屏幕上的点
    // 与 Raycaster、关系线、HTML 标签和手势锚点分家；整座图谱的视差由 root
    // 的真实 3D 变换承担，所以所有功能层始终共用同一个空间位置。
    if (uDeform > 0.5) {
      float mass = mix(${MOTION_MASS_MIN}, ${MOTION_MASS_MAX}, smoothstep(0.08, 0.30, aSize));
      vec2 current = screenPosition * aspect;
      vec2 offset = vec2(0.0);
      // 距离量到「上一帧到这一帧」的线段，不是量到光标那一点——
      // 否则快速划过时，两帧之间的粒子会被整排跳过。
      for (int i = 0; i < ${MOTION_STROKE_LIMIT}; i++) {
        float age = uMotionAge[i];
        if (age >= ${MOTION_SETTLE_SECONDS}.0) continue;
        vec2 origin = uMotionOrigin[i] * aspect;
        vec2 segment = uMotionSegment[i] * aspect;
        float span = max(dot(segment, segment), 0.000001);
        float t = clamp(dot(current - origin, segment) / span, 0.0, 1.0);
        float falloff = 1.0 - smoothstep(
          0.0,
          max(uMotionRadius, 0.001),
          length(current - origin - segment * t)
        );
        float weight = falloff * falloff;
        if (weight <= 0.0) continue;
        vec2 velocity = uMotionImpulse[i] * aspect * (${MOTION_IMPULSE_GAIN} / mass) * weight;
        velocity *= min(1.0, ${MOTION_SPEED_CLAMP} / max(length(velocity), 0.00001));
        offset += stageCoast(velocity, mass, age);
      }
      if (uReleaseAge < ${MOTION_SETTLE_SECONDS}.0 && uReleaseImpulse > 0.0) {
        vec2 delta = current - uReleaseCenter * aspect;
        float ring = 1.0 - smoothstep(0.0, max(uMotionRadius * 2.2, 0.001), length(delta));
        vec2 ripple = normalize(delta + vec2(0.0001, 0.0))
          * uReleaseImpulse * (${MOTION_IMPULSE_GAIN} / mass) * ring * ring;
        ripple *= min(1.0, ${MOTION_SPEED_CLAMP} / max(length(ripple), 0.00001));
        offset += stageCoast(ripple, mass, uReleaseAge);
      }
      gl_Position.xy += offset / aspect * gl_Position.w * uMotion;

      // 悬停透镜：指针附近的微尘朝镜头抬一点，并以指针为中心轻微放大。
      vLens = smoothstep(0.2, 0.0, pointerDistance) * uPointerEnergy;
      vec2 anchor = uPointer * gl_Position.w;
      gl_Position.xy = anchor + (gl_Position.xy - anchor) * (1.0 + vLens * 0.18);
    }

    float interactionScale = 1.0 + vPointer * 0.85 + vLens * 0.5 + uDragEnergy * 0.24;
    gl_PointSize = aSize * pulse * searchScale * interactionScale
      * (360.0 / max(3.0, -viewPosition.z));
  }
`;

export const NODE_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vFocus;
  varying float vSearch;
  varying float vPointer;
  varying float vLens;
  varying float vBright;
  varying float vFog;
  uniform float uSearchActive;
  uniform float uDragEnergy;
  uniform vec2 uDragVector;

  void main() {
    vec2 point = (gl_PointCoord - vec2(0.5)) * 2.0;
    float radius = length(point);
    if (radius > 1.0) discard;
    float core = exp(-radius * radius * 34.0);
    float halo = exp(-radius * 5.4) * 0.58;
    float horizontal = exp(-abs(point.y) * 52.0)
      * smoothstep(1.0, 0.08, abs(point.x));
    float vertical = exp(-abs(point.x) * 64.0)
      * smoothstep(0.82, 0.04, abs(point.y));
    float diagonal = (
      exp(-abs(point.x + point.y) * 42.0)
      + exp(-abs(point.x - point.y) * 42.0)
    ) * smoothstep(0.72, 0.0, radius) * 0.15;
    // 星芒只发给真正亮的那几颗。之前每个点都带十字，整片星野读起来像
    // 一格格的水晶网，而不是一张星空照片——真实镜头也只有过曝的星才起芒。
    float rays = smoothstep(0.34, 0.86, vBright);
    float diffraction = (horizontal * 0.62 + vertical * 0.42 + diagonal) * rays;
    vec2 dragDirection = normalize(uDragVector + vec2(0.0001, 0.0));
    float alongDrag = dot(point, dragDirection);
    float acrossDrag = dot(point, vec2(-dragDirection.y, dragDirection.x));
    float dragStreak = exp(-abs(acrossDrag) * 23.0)
      * smoothstep(1.0, 0.03, abs(alongDrag))
      * uDragEnergy * 0.72;
    float searchVisibility = mix(1.0, mix(0.16, 1.0, vSearch), uSearchActive);
    // 明暗跨度拉大：多数点安静地暗着，少数亮星过曝到发白。
    // 之前所有点亮度几乎一样，整片是「均匀撒糖」，没有主次。
    float exposure = mix(0.46, 1.45, vBright);
    float alpha = min(1.0, (halo + core + diffraction + dragStreak + vPointer * 0.2) * exposure)
      * mix(0.76, 1.0, vFocus)
      * searchVisibility
      * (1.0 + vLens * 0.55);
    vec3 color = mix(
      vColor * 1.2,
      vec3(1.0),
      min(1.0, (core * 0.92 + diffraction * 0.42) * exposure
        + dragStreak * 0.62 + vPointer * 0.24)
    );
    gl_FragColor = vec4(color * mix(0.86, 1.22, vBright), min(1.0, alpha) * vFog);
  }
`;

export const LINK_VERTEX_SHADER = `
  attribute float aFocus;
  varying vec3 vColor;
  varying float vFocus;

  void main() {
    vColor = color;
    vFocus = aFocus;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const LINK_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vFocus;
  uniform float uSearchActive;

  void main() {
    float searchVisibility = mix(1.0, mix(0.18, 1.0, vFocus), uSearchActive);
    float alpha = mix(0.16, 0.88, vFocus) * searchVisibility;
    gl_FragColor = vec4(vColor + vFocus * vec3(0.2), alpha);
  }
`;

export function seeded(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

export function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

// WebGL 初始化失败（旧显卡、无头环境）返回 null，由调用方降级到 2D 视图，
// 而不是在这里抛错——两个视图的降级出口必须长得一样。
export function createStageRenderer(options: {
  host: HTMLElement;
  antialias: boolean;
  pixelRatioCap: number;
  ariaLabel: string;
  clearColor?: number;
}): { renderer: THREE.WebGLRenderer; canvas: HTMLCanvasElement } | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: options.antialias,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", options.ariaLabel);
  canvas.tabIndex = 0;
  options.host.appendChild(canvas);
  renderer.setClearColor(options.clearColor ?? 0x030807, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Astra 风格的星光依赖高亮端仍然有颜色层次；ACES 能让暖白恒星保持温度，
  // 又不会把大量叠加粒子直接烧成一整块纯白。
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio || 1, options.pixelRatioCap),
  );
  return { renderer, canvas };
}

// 视野同时受纵横两个方向约束，取更远的那个再放一点边距，
// 保证整个包围盒在任何窗口比例下都完整入画。
export function fitDistance(options: {
  fovDeg: number;
  aspect: number;
  size: { x: number; y: number; z: number };
  minDistance?: number;
  margin?: number;
  depthFactor?: number;
}) {
  const verticalFov = THREE.MathUtils.degToRad(options.fovDeg);
  const horizontalFov =
    2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.3, options.aspect));
  const verticalDistance = options.size.y / (2 * Math.tan(verticalFov / 2));
  const horizontalDistance = options.size.x / (2 * Math.tan(horizontalFov / 2));
  return Math.max(
    options.minDistance ?? 10.5,
    Math.max(verticalDistance, horizontalDistance) * (options.margin ?? 1.24)
      + options.size.z * (options.depthFactor ?? 0.45),
  );
}

type Flight = {
  startedAt: number;
  duration: number;
  fromCamera: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toCamera: THREE.Vector3;
  toTarget: THREE.Vector3;
};

export type FlightController = {
  readonly active: boolean;
  start(toCamera: THREE.Vector3, toTarget: THREE.Vector3, duration?: number): void;
  cancel(): void;
  tick(now: number): void;
};

// 镜头飞行 = 位置插值 + FOV 冲刺 + 星场拉伸三件事绑在一起，
// 拆开由各视图自己拼很容易漏掉复位（fov 卡在 48.5 的那种 bug），所以做成控制器。
export function createFlightController(options: {
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  baseFov?: number;
  fovKick?: number;
  warp?: { material: THREE.PointsMaterial; baseSize: number; baseOpacity: number };
  onComplete?: () => void;
}): FlightController {
  const baseFov = options.baseFov ?? 43;
  const fovKick = options.fovKick ?? 5.5;
  let flight: Flight | null = null;

  const restore = () => {
    options.camera.fov = baseFov;
    if (options.warp) {
      options.warp.material.size = options.warp.baseSize;
      options.warp.material.opacity = options.warp.baseOpacity;
    }
    options.camera.updateProjectionMatrix();
  };

  return {
    get active() {
      return flight !== null;
    },
    start(toCamera, toTarget, duration = 820) {
      flight = {
        startedAt: performance.now(),
        duration,
        fromCamera: options.camera.position.clone(),
        fromTarget: options.target.clone(),
        toCamera,
        toTarget,
      };
    },
    cancel() {
      if (!flight) return;
      flight = null;
      restore();
    },
    tick(now) {
      if (!flight) return;
      const rawProgress = Math.min(1, (now - flight.startedAt) / flight.duration);
      const progress = easeInOutCubic(rawProgress);
      const thrust = Math.sin(rawProgress * Math.PI);
      options.camera.position.lerpVectors(flight.fromCamera, flight.toCamera, progress);
      options.target.lerpVectors(flight.fromTarget, flight.toTarget, progress);
      options.camera.fov = baseFov + thrust * fovKick;
      if (options.warp) {
        options.warp.material.size = options.warp.baseSize + thrust * 0.045;
        options.warp.material.opacity = options.warp.baseOpacity + thrust * 0.24;
      }
      options.camera.updateProjectionMatrix();
      if (rawProgress >= 1) {
        restore();
        flight = null;
        options.onComplete?.();
      }
    },
  };
}

// 彗星贴图：squash 过的径向光晕 + 一条水平拖尾。
// 星图拿它画连线脉冲与锁定物 bloom，航道拿它画时间流粒子与事件标记。
export function createCometTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    context.translate(96, 48);
    context.scale(1, 0.42);
    const halo = context.createRadialGradient(0, 0, 0, 0, 0, 74);
    halo.addColorStop(0, "rgba(255,255,255,1)");
    halo.addColorStop(0.08, "rgba(255,255,255,.94)");
    halo.addColorStop(0.28, "rgba(215,245,232,.5)");
    halo.addColorStop(0.62, "rgba(110,210,173,.13)");
    halo.addColorStop(1, "rgba(110,210,173,0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(0, 0, 74, 0, Math.PI * 2);
    context.fill();
    context.setTransform(1, 0, 0, 1, 0, 0);
    const streak = context.createLinearGradient(12, 0, 180, 0);
    streak.addColorStop(0, "rgba(255,255,255,0)");
    streak.addColorStop(0.42, "rgba(210,255,237,.2)");
    streak.addColorStop(0.5, "rgba(255,255,255,.92)");
    streak.addColorStop(0.58, "rgba(210,255,237,.2)");
    streak.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = streak;
    context.fillRect(12, 45, 168, 6);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createNebulaTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(96, 96, 0, 96, 96, 96);
    gradient.addColorStop(0, "rgba(255,255,255,.72)");
    gradient.addColorStop(0.2, "rgba(255,255,255,.23)");
    gradient.addColorStop(0.58, "rgba(255,255,255,.07)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 192, 192);
  }
  return new THREE.CanvasTexture(canvas);
}

function createStarTexture(kind: "dust" | "star") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 62);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(kind === "star" ? 0.055 : 0.12, "rgba(255,255,255,.96)");
    gradient.addColorStop(kind === "star" ? 0.2 : 0.36, "rgba(225,239,255,.34)");
    gradient.addColorStop(1, "rgba(190,220,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    if (kind === "star") {
      const ray = context.createLinearGradient(0, 64, 128, 64);
      ray.addColorStop(0, "rgba(255,255,255,0)");
      ray.addColorStop(0.47, "rgba(255,255,255,.05)");
      ray.addColorStop(0.5, "rgba(255,255,255,.8)");
      ray.addColorStop(0.53, "rgba(255,255,255,.05)");
      ray.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = ray;
      context.fillRect(0, 62.5, 128, 3);
      context.save();
      context.translate(64, 64);
      context.rotate(Math.PI / 2);
      context.translate(-64, -64);
      context.fillStyle = ray;
      context.fillRect(0, 63, 128, 2);
      context.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export type StagePointerEffects = {
  readonly pointer: THREE.Vector2;
  readonly dragVector: THREE.Vector2;
  readonly energy: number;
  readonly dragEnergy: number;
  /** 舞台倾斜（弧度）。视图把它加到 root 上，让前景和背景同步产生视差。 */
  readonly tiltX: number;
  readonly tiltY: number;
  readonly releaseImpulse: number;
  readonly aspect: number;
  readonly motion: PointerMotionField;
  tick(now: number, animate: boolean): void;
  setAccent(color: string): void;
  /** 画布尺寸变化后重新取一次矩形；平时不在事件里读，避免每次移动都触发同步布局。 */
  resize(): void;
  setExternalInteraction(interaction: {
    x: number;
    y: number;
    energy: number;
    dragging: boolean;
    charging?: boolean;
    progress?: number;
    accent?: string;
  } | null): void;
  dispose(): void;
};

// 鼠标不是盖在 WebGL 上的一枚普通箭头，而是场景中的“能量探针”：
// DOM 层负责清晰的准星、尾迹和释放波，shader 读取同一份状态做邻近星体响应。
// 这样触摸设备仍走原生交互，细指针设备才启用额外视觉反馈。
//
// 平滑一律交给 StageInteraction（临界阻尼的解析解），所以 30fps 和 120fps
// 的手感一致；轨迹动量交给 PointerMotionField，指针离场后粒子继续滑行归位。
export function createStagePointerEffects(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
): StagePointerEffects {
  const root = document.createElement("div");
  root.className = "space-graph-pointer-fx";
  root.setAttribute("aria-hidden", "true");
  const aura = document.createElement("span");
  aura.className = "space-graph-pointer-aura";
  const core = document.createElement("span");
  core.className = "space-graph-pointer-core";
  const trail = document.createElement("span");
  trail.className = "space-graph-pointer-trail";
  const trailDots = Array.from({ length: 11 }, (_, index) => {
    const dot = document.createElement("i");
    dot.style.setProperty("--trail-opacity", (1 - index / 11).toFixed(3));
    dot.style.setProperty("--trail-hue", `${index * 18 - 36}deg`);
    trail.appendChild(dot);
    return dot;
  });
  root.appendChild(aura);
  root.appendChild(trail);
  root.appendChild(core);
  host.appendChild(root);

  const interaction = createStageInteraction();
  const motion = createPointerMotionField();
  const pointer = new THREE.Vector2(0, 0);
  const dragVector = new THREE.Vector2(1, 0);
  const trailX = new Float32Array(trailDots.length);
  const trailY = new Float32Array(trailDots.length);
  let rect = canvas.getBoundingClientRect();
  let aspect = Math.max(0.0001, rect.width / Math.max(1, rect.height));
  let currentX = rect.width / 2;
  let currentY = rect.height / 2;
  let lastFrameAt = performance.now();
  let trailSeeded = false;
  let active = false;
  let dragging = false;
  let externalActive = false;
  let energy = 0;
  let dragEnergy = 0;
  let tiltX = 0;
  let tiltY = 0;
  let releaseImpulse = 0;
  let speed = 0;

  const refreshRect = () => {
    rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) aspect = rect.width / rect.height;
  };

  // x/y 是 0..1 的画布内比例；动量场吃的是 NDC，所以两边各转一次。
  const feed = (x: number, y: number, kind: "move" | "press" | "drag", time: number) => {
    const clampedX = THREE.MathUtils.clamp(x, 0, 1);
    const clampedY = THREE.MathUtils.clamp(y, 0, 1);
    interaction.setInput({ source: "pointer", kind, x: clampedX, y: clampedY, time });
    // 按住时指针在开镜头，微尘不该同时被抹一道；Astra 也把动量闸在「未按下」。
    if (kind !== "drag") motion.push(clampedX * 2 - 1, -(clampedY * 2 - 1));
    active = true;
    host.dataset.pointerActive = "true";
  };

  const feedEvent = (event: PointerEvent, kind: "move" | "press" | "drag") => {
    if (rect.width <= 0 || rect.height <= 0) refreshRect();
    feed(
      (event.clientX - rect.left) / Math.max(1, rect.width),
      (event.clientY - rect.top) / Math.max(1, rect.height),
      kind,
      event.timeStamp || performance.now(),
    );
  };

  const spawnBurst = () => {
    const burst = document.createElement("b");
    burst.className = "space-graph-pointer-burst";
    burst.style.setProperty("--burst-x", `${currentX}px`);
    burst.style.setProperty("--burst-y", `${currentY}px`);
    burst.style.setProperty("--pointer-release", releaseImpulse.toFixed(3));
    burst.style.setProperty("--pointer-accent", root.style.getPropertyValue("--pointer-accent"));
    host.appendChild(burst);
    burst.addEventListener("animationend", () => burst.remove(), { once: true });
    window.setTimeout(() => burst.remove(), 900);
  };

  const finish = (time: number, cancelled: boolean) => {
    const snapshot = interaction.endInput("pointer", time, { cancelled });
    releaseImpulse = snapshot.releaseImpulse;
    motion.lift();
    if (dragging) {
      dragging = false;
      delete root.dataset.dragging;
      if (!cancelled && releaseImpulse > 0) {
        motion.burst(snapshot.x * 2 - 1, -(snapshot.y * 2 - 1), releaseImpulse);
        spawnBurst();
      }
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (externalActive) return;
    feedEvent(event, dragging ? "drag" : "move");
  };
  const onPointerDown = (event: PointerEvent) => {
    if (externalActive) return;
    // 按下先断开笔画，否则「移动一段→按下」会被并成一条横跨屏幕的长笔。
    motion.lift();
    feedEvent(event, "press");
    dragging = true;
    root.dataset.dragging = "true";
  };
  const onPointerUp = (event: PointerEvent) => {
    if (externalActive) return;
    finish(event.timeStamp || performance.now(), false);
  };
  // 离场不把指针瞬移到画外：位置留在最后一点，作用力靠 energy 自己退场，
  // 已经甩出去的微尘继续滑行。瞬移会让背景层被「踢」一下，看得很清楚。
  const onPointerLeave = (event: PointerEvent) => {
    if (externalActive) return;
    finish(event.timeStamp || performance.now(), false);
    active = false;
    delete host.dataset.pointerActive;
  };
  const onPointerCancel = (event: PointerEvent) => {
    if (externalActive) return;
    finish(event.timeStamp || performance.now(), true);
    active = false;
    delete host.dataset.pointerActive;
  };

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("resize", refreshRect, { passive: true });
  window.addEventListener("scroll", refreshRect, { passive: true, capture: true });

  const api: StagePointerEffects = {
    pointer,
    dragVector,
    motion,
    get energy() {
      return energy;
    },
    get dragEnergy() {
      return dragEnergy;
    },
    get tiltX() {
      return tiltX;
    },
    get tiltY() {
      return tiltY;
    },
    get releaseImpulse() {
      return releaseImpulse;
    },
    get aspect() {
      return aspect;
    },
    resize: refreshRect,
    tick(now, animate) {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
      lastFrameAt = now;
      const snapshot = interaction.tick(now, animate);
      motion.tick(animate ? dt : MOTION_SETTLE_SECONDS);

      currentX = snapshot.x * rect.width;
      currentY = snapshot.y * rect.height;
      pointer.set(snapshot.x * 2 - 1, -(snapshot.y * 2 - 1));
      energy = snapshot.energy;
      dragEnergy = snapshot.dragEnergy;
      tiltX = snapshot.tiltX;
      tiltY = snapshot.tiltY;
      releaseImpulse = snapshot.releaseImpulse;
      speed = Math.min(1, Math.hypot(snapshot.velocityX, snapshot.velocityY) / 2.4);
      if (speed > 0.02) {
        dragVector.set(snapshot.velocityX, -snapshot.velocityY).normalize();
      }

      if (!trailSeeded) {
        trailX.fill(currentX);
        trailY.fill(currentY);
        trailSeeded = true;
      }
      root.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      root.style.setProperty("--pointer-energy", energy.toFixed(3));
      root.style.setProperty("--pointer-speed", speed.toFixed(3));
      root.style.setProperty("--pointer-release", releaseImpulse.toFixed(3));
      let leadX = currentX;
      let leadY = currentY;
      trailDots.forEach((dot, index) => {
        const follow = 1 - Math.exp(-dt * (11.5 - index * 0.72));
        trailX[index] += (leadX - trailX[index]) * follow;
        trailY[index] += (leadY - trailY[index]) * follow;
        dot.style.transform = `translate3d(${trailX[index] - currentX}px, ${trailY[index] - currentY}px, 0)`;
        leadX = trailX[index];
        leadY = trailY[index];
      });
      root.style.opacity = !active && energy < 0.01 ? "0" : "1";
    },
    setAccent(color) {
      root.style.setProperty("--pointer-accent", color);
    },
    setExternalInteraction(interactionFrame) {
      if (!interactionFrame) {
        if (!externalActive) return;
        externalActive = false;
        // 手离开摄像头画面不是一次「松手」，别按释放处理去炸一圈涟漪。
        interaction.endInput("hand", performance.now(), { cancelled: true });
        motion.lift();
        dragging = false;
        active = false;
        delete root.dataset.dragging;
        delete root.dataset.source;
        delete root.dataset.charging;
        root.style.removeProperty("--gesture-progress");
        delete host.dataset.pointerActive;
        return;
      }
      const now = performance.now();
      if (!externalActive) {
        externalActive = true;
        motion.lift();
      }
      const x = THREE.MathUtils.clamp(interactionFrame.x, 0, 1);
      const y = THREE.MathUtils.clamp(interactionFrame.y, 0, 1);
      const kind = interactionFrame.dragging
        ? "drag"
        : interactionFrame.charging
          ? "press"
          : "move";
      const wasDragging = dragging;
      interaction.setInput({
        source: "hand",
        kind,
        x,
        y,
        energy: THREE.MathUtils.clamp(interactionFrame.energy, 0, 1),
        time: now,
      });
      if (kind !== "drag") motion.push(x * 2 - 1, -(y * 2 - 1));
      else motion.lift();
      active = true;
      dragging = interactionFrame.dragging;
      if (wasDragging && !dragging) {
        releaseImpulse = Math.max(releaseImpulse, 0.42);
        motion.burst(x * 2 - 1, -(y * 2 - 1), releaseImpulse);
        spawnBurst();
      }
      if (dragging) root.dataset.dragging = "true";
      else delete root.dataset.dragging;
      root.dataset.charging = interactionFrame.charging ? "true" : "false";
      root.style.setProperty(
        "--gesture-progress",
        `${THREE.MathUtils.clamp(interactionFrame.progress ?? 0, 0, 1) * 360}deg`,
      );
      if (interactionFrame.accent) {
        root.style.setProperty("--pointer-accent", interactionFrame.accent);
      }
      root.dataset.source = "hand";
      // 手势光环不应该顺便藏掉仍可用的实体鼠标。
      delete host.dataset.pointerActive;
    },
    dispose() {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", refreshRect);
      window.removeEventListener("scroll", refreshRect, { capture: true });
      delete host.dataset.pointerActive;
      root.remove();
      host.querySelectorAll(".space-graph-pointer-burst").forEach((item) => item.remove());
    },
  };
  return api;
}

// 三个视图共用的指针 uniform 组。新增一个 uniform 时只改这里，
// 三处材质自动跟上——之前散在各视图里，改一处漏两处是常态。
export function createStageInteractionUniforms(deform: number) {
  return {
    uPointer: { value: new THREE.Vector2(0, 0) },
    uPointerEnergy: { value: 0 },
    uDragEnergy: { value: 0 },
    uDragVector: { value: new THREE.Vector2(1, 0) },
    uDeform: { value: deform },
    uAspect: { value: 1 },
    uFogDensity: { value: 0 },
    uFogStrength: { value: 1 },
    uMotionOrigin: {
      value: Array.from({ length: MOTION_STROKE_LIMIT }, () => new THREE.Vector2()),
    },
    uMotionSegment: {
      value: Array.from({ length: MOTION_STROKE_LIMIT }, () => new THREE.Vector2()),
    },
    uMotionImpulse: {
      value: Array.from({ length: MOTION_STROKE_LIMIT }, () => new THREE.Vector2()),
    },
    uMotionAge: {
      value: Array.from({ length: MOTION_STROKE_LIMIT }, () => MOTION_SETTLE_SECONDS),
    },
    uMotionRadius: { value: 0.13 },
    uReleaseCenter: { value: new THREE.Vector2() },
    uReleaseImpulse: { value: 0 },
    uReleaseAge: { value: MOTION_SETTLE_SECONDS },
  };
}

export function writeStageFogUniforms(
  uniforms: Record<string, THREE.IUniform>,
  fog: THREE.FogExp2 | null,
  strength = 1,
) {
  uniforms.uFogDensity.value = fog ? fog.density : 0;
  uniforms.uFogStrength.value = fog ? strength : 0;
}

export function writeStageInteractionUniforms(
  uniforms: Record<string, THREE.IUniform>,
  effects: StagePointerEffects,
) {
  (uniforms.uPointer.value as THREE.Vector2).copy(effects.pointer);
  uniforms.uPointerEnergy.value = effects.energy;
  uniforms.uDragEnergy.value = effects.dragEnergy;
  (uniforms.uDragVector.value as THREE.Vector2).copy(effects.dragVector);
  uniforms.uAspect.value = effects.aspect;
  const motion = effects.motion;
  const origins = uniforms.uMotionOrigin.value as THREE.Vector2[];
  const segments = uniforms.uMotionSegment.value as THREE.Vector2[];
  const impulses = uniforms.uMotionImpulse.value as THREE.Vector2[];
  const ages = uniforms.uMotionAge.value as number[];
  for (let index = 0; index < origins.length; index += 1) {
    const index2 = index * 2;
    origins[index].set(motion.origins[index2], motion.origins[index2 + 1]);
    segments[index].set(motion.segments[index2], motion.segments[index2 + 1]);
    impulses[index].set(motion.impulses[index2], motion.impulses[index2 + 1]);
    ages[index] = motion.ages[index];
  }
  const [releaseX, releaseY] = motion.releaseCenter;
  (uniforms.uReleaseCenter.value as THREE.Vector2).set(releaseX, releaseY);
  uniforms.uReleaseImpulse.value = motion.releaseImpulse;
  uniforms.uReleaseAge.value = motion.releaseAge;
}

export type StageBloom = {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setSize(width: number, height: number): void;
  dispose(): void;
};

// 叠加混合下密集区域的亮度会加到 1 以上，直接写屏就是硬裁成一片死白，
// 里面所有结构全没了。半浮点渲染靶把超出的值留住，最后用一条软肩把它们
// 压回可见范围：膝点以下原样不动，膝点以上按 Reinhard 逐渐逼近 1。
// 只按最亮通道算比例再整体缩放，颜色关系不会被单通道裁剪打散。
const HIGHLIGHT_KNEE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uKnee: { value: 0.72 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uKnee;
    varying vec2 vUv;
    void main() {
      // 变量不能叫 sample —— 那是 GLSL 的保留字，会静默让整条通道编译失败。
      vec4 texel = texture2D(tDiffuse, vUv);
      float peak = max(texel.r, max(texel.g, texel.b));
      if (peak > uKnee) {
        float excess = (peak - uKnee) / max(1.0 - uKnee, 0.0001);
        float compressed = uKnee + (1.0 - uKnee) * excess / (1.0 + excess);
        texel.rgb *= compressed / peak;
      }
      gl_FragColor = texel;
    }
  `,
};

// 辉光是这套画面的地基，不是装饰。逐点在片元里画的光晕只能照亮自己那几个像素，
// 星与星之间永远是纯黑；真正让星野读成「一团发光的东西」的，是跨过阈值的亮部
// 被大半径模糊后糊到邻居身上的那层雾。没有它，再多粒子也只是撒在黑纸上的糖。
//
// 刻意不接 OutputPass：当前管线里自定义 ShaderMaterial 不参与 three 的色调映射
// 和色彩空间转换，直接输出。加了 OutputPass 会把整套颜色重新编码一遍，画面会
// 整体发白——那是另一个问题，不该混在这次改动里。
export function createStageBloom(
  renderer: THREE.WebGLRenderer,
  options?: { strength?: number; radius?: number; threshold?: number },
): StageBloom | null {
  const size = renderer.getSize(new THREE.Vector2());
  let composer: EffectComposer;
  let renderPass: RenderPass;
  let bloomPass: UnrealBloomPass;
  let kneePass: ShaderPass;
  try {
    composer = new EffectComposer(renderer);
    renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, size.x), Math.max(1, size.y)),
      // 阈值定得高：这套星点本来就亮，低阈值会把整片都收进辉光，
      // 结果是一堆糊成一坨的白团，反而丢掉星点。只让最亮的核心溢出。
      options?.strength ?? 0.44,
      options?.radius ?? 0.5,
      options?.threshold ?? 0.6,
    );
    kneePass = new ShaderPass(HIGHLIGHT_KNEE_SHADER);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(kneePass);
  } catch {
    return null;
  }
  return {
    render(scene, camera) {
      renderPass.scene = scene;
      renderPass.camera = camera;
      composer.render();
    },
    setSize(width, height) {
      composer.setSize(Math.max(1, width), Math.max(1, height));
      bloomPass.resolution.set(Math.max(1, width), Math.max(1, height));
    },
    dispose() {
      kneePass.dispose();
      bloomPass.dispose();
      composer.dispose();
    },
  };
}

// 三层银河背景：微尘提供密度，中星建立冷暖色温，少量衍射恒星承担高光。
// 布点采用旋臂盘 + 稀疏球壳的混合，正面看有 Astra 首屏的中心凝聚感，
// 侧转又不会变成一张纸。material 仍交给飞行控制器做冲刺拉伸。
export function createStarfield(options?: {
  count?: number;
  minRadius?: number;
  spread?: number;
  color?: number;
  size?: number;
  opacity?: number;
}) {
  const count = options?.count ?? 1680;
  const minRadius = options?.minRadius ?? 8;
  const spread = options?.spread ?? 18;
  const dustTexture = createStarTexture("dust");
  const starTexture = createStarTexture("star");
  const group = new THREE.Group();
  let interactionX = 0;
  let interactionY = 0;
  let interactionEnergy = 0;
  let interactionDragging = false;
  let interactionReturning = false;
  let lastSeconds: number | null = null;
  const parallaxLayers: Array<{ points: THREE.Points; strength: number }> = [];

  const makeLayer = (
    layer: string,
    layerCount: number,
    size: number,
    opacity: number,
    bright: boolean,
  ) => {
    const positions = new Float32Array(layerCount * 3);
    const colors = new Float32Array(layerCount * 3);
    const white = new THREE.Color(options?.color ?? 0xf2f7f3);
    const spectrum = [
      new THREE.Color(0xf7fbff),
      new THREE.Color(0xe5f3ff),
      new THREE.Color(0xc9e8ff),
      new THREE.Color(0xf2f9ff),
      new THREE.Color(0xd8eeff),
      new THREE.Color(0xfff1e5),
      new THREE.Color(0xffc7a7),
      new THREE.Color(0x91ddff),
    ];
    for (let index = 0; index < layerCount; index += 1) {
      const seed = `background:${layer}:${index}`;
      const inHalo = seeded(`${seed}:halo`) < 0.24;
      let x: number;
      let y: number;
      let z: number;
      if (inHalo) {
        const radius = minRadius + seeded(`${seed}:radius`) * spread;
        const theta = seeded(`${seed}:theta`) * Math.PI * 2;
        const phi = Math.acos(2 * seeded(`${seed}:phi`) - 1);
        x = radius * Math.sin(phi) * Math.cos(theta);
        y = radius * Math.sin(phi) * Math.sin(theta);
        z = radius * Math.cos(phi);
      } else {
        const normalizedRadius = Math.pow(seeded(`${seed}:radius`), 1.55);
        const radius = minRadius * 0.12 + normalizedRadius * (minRadius + spread * 0.8);
        const arm = Math.floor(seeded(`${seed}:arm`) * 4);
        const angle = arm * Math.PI / 2
          + radius * 0.31
          + (seeded(`${seed}:scatter`) - 0.5) * (0.38 + normalizedRadius * 0.72);
        x = Math.cos(angle) * radius;
        y = Math.sin(angle) * radius * 0.72;
        z = (seeded(`${seed}:depth`) - 0.5) * (1.8 + normalizedRadius * 8.5);
      }
      positions.set([x, y, z], index * 3);
      const temperature = seeded(`${seed}:temperature`);
      const spectralColor = spectrum[
        Math.min(spectrum.length - 1, Math.floor(temperature * spectrum.length))
      ];
      const color = spectralColor.clone().lerp(
        white,
        0.28 + seeded(`${seed}:neutral`) * 0.5,
      );
      const luminance = 0.58 + seeded(`${seed}:luminance`) * 0.48;
      color.multiplyScalar(luminance);
      colors.set(color.toArray(), index * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size,
      sizeAttenuation: true,
      vertexColors: true,
      map: bright ? starTexture : dustTexture,
      alphaTest: 0.012,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    group.add(points);
    parallaxLayers.push({
      points,
      // 远处微尘只给深度参照；越亮、越近的恒星才显著响应视差。
      strength: bright ? 1 : layer === "stars" ? 0.68 : 0.34,
    });
    return material;
  };

  const material = makeLayer(
    "dust",
    count,
    options?.size ?? 0.042,
    options?.opacity ?? 0.58,
    false,
  );
  makeLayer("stars", Math.max(120, Math.round(count * 0.18)), 0.14, 0.78, false);
  makeLayer("flares", Math.max(22, Math.round(count * 0.032)), 0.42, 0.96, true);

  const coreMaterial = new THREE.SpriteMaterial({
    map: dustTexture,
    color: 0xdde9e3,
    transparent: true,
    opacity: 0.085,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const core = new THREE.Sprite(coreMaterial);
  core.position.set(0, 0, -15);
  core.scale.set(25, 17, 1);
  group.add(core);

  return {
    points: group,
    material,
    setInteraction(
      x: number,
      y: number,
      energy: number,
      dragging: boolean,
      returning = false,
    ) {
      interactionX = x;
      interactionY = y;
      interactionEnergy = energy;
      interactionDragging = dragging;
      interactionReturning = returning;
    },
    // 每层各有自己的滞后：近处的亮星跟得紧，远处的微尘慢半拍，
    // 转头时层与层拉开时间差，纵深才读得出来。松手后统一换成慢速率回位。
    tick(seconds: number, animate: boolean) {
      const dt = lastSeconds === null
        ? 1 / 60
        : Math.min(0.05, Math.max(0.0001, seconds - lastSeconds));
      lastSeconds = seconds;
      const motion = animate ? 1 : 0;
      const hoverX = interactionX * interactionEnergy * motion;
      const hoverY = interactionY * interactionEnergy * motion;
      const baseRate = interactionReturning ? 5.5 : 14;
      group.rotation.z = seconds * 0.0035 * motion + hoverX * 0.014;
      const groupFollow = 1 - Math.exp(-dt * baseRate * 0.42);
      group.rotation.y += (
        Math.sin(seconds * 0.035) * 0.018 * motion + hoverX * 0.072 - group.rotation.y
      ) * groupFollow;
      group.rotation.x += (-hoverY * 0.052 - group.rotation.x) * groupFollow;
      parallaxLayers.forEach(({ points, strength }, index) => {
        const follow = 1 - Math.exp(-dt * (baseRate / (1 + (0.18 + index * 0.17) * 1.7)));
        points.rotation.y += (hoverX * 0.055 * strength - points.rotation.y) * follow;
        points.rotation.x += (-hoverY * 0.038 * strength - points.rotation.x) * follow;
      });
      const reactiveScale = 1 + interactionEnergy * (interactionDragging ? 0.026 : 0.009);
      const scaleFollow = 1 - Math.exp(-dt * 6);
      group.scale.x += (reactiveScale - group.scale.x) * scaleFollow;
      group.scale.y += (reactiveScale - group.scale.y) * scaleFollow;
      group.scale.z += (1 - group.scale.z) * scaleFollow;
    },
  };
}

export type FocusArtifact = {
  group: THREE.Group;
  setAccent(color: string): void;
  setPosition(position: THREE.Vector3): void;
  setVisible(visible: boolean): void;
  tick(seconds: number, animate: boolean): void;
};

// 选中目标是一枚悬浮的“记忆数据核心”：有天体的体量感，但不模拟真实星球。
// 粒子扫描、测地骨架和晶体内核共同表达未来感，避免重新堆叠装饰性轨道。
// 它只依赖一个位置和一个主题色，所以星图和航道可以共用同一枚。
export function createFocusArtifact(bloomTexture: THREE.Texture): FocusArtifact {
  const group = new THREE.Group();
  const shellPointCount = 460;
  const shellPositions = new Float32Array(shellPointCount * 3);
  const shellPhases = new Float32Array(shellPointCount);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < shellPointCount; index += 1) {
    const y = 1 - ((index + 0.5) / shellPointCount) * 2;
    const radial = Math.sqrt(1 - y * y);
    const angle = goldenAngle * index;
    const shellRadius = 0.36 * (0.972 + seeded(`focus-shell:${index}`) * 0.032);
    shellPositions.set([
      Math.cos(angle) * radial * shellRadius,
      y * shellRadius,
      Math.sin(angle) * radial * shellRadius,
    ], index * 3);
    shellPhases[index] = seeded(`focus-shell:${index}:phase`) * Math.PI * 2;
  }
  const shellGeometry = new THREE.BufferGeometry();
  shellGeometry.setAttribute("position", new THREE.BufferAttribute(shellPositions, 3));
  shellGeometry.setAttribute("aPhase", new THREE.BufferAttribute(shellPhases, 1));
  const shellMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAccent: { value: new THREE.Color("#ffffff") },
    },
    vertexShader: `
      attribute float aPhase;
      uniform float uTime;
      varying float vEnergy;
      void main() {
        float scanHeight = sin(uTime * 0.58) * 0.24;
        float scan = exp(-abs(position.y - scanHeight) * 38.0);
        float flicker = 0.58 + sin(uTime * 1.6 + aPhase) * 0.18;
        vEnergy = min(1.0, flicker + scan * 0.84);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = 2.0 + scan * 3.6 + flicker * 0.8;
      }
    `,
    fragmentShader: `
      uniform vec3 uAccent;
      varying float vEnergy;
      void main() {
        vec2 point = gl_PointCoord - vec2(0.5);
        float radius = length(point);
        if (radius > 0.5) discard;
        float alpha = smoothstep(0.5, 0.08, radius) * (0.46 + vEnergy * 0.54);
        vec3 color = mix(uAccent, vec3(1.0), vEnergy * 0.72);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const shell = new THREE.Points(shellGeometry, shellMaterial);
  shell.renderOrder = 7;

  const latticeMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lattice = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.372, 2), 18),
    latticeMaterial,
  );
  lattice.renderOrder = 6;

  // 不用 MeshPhysicalMaterial：transmission > 0 会让 three 为折射多渲染一整遍
  // 场景，而这颗核心一直可见。加法混合下折射几乎不可见，自发光已经够亮。
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.45,
    roughness: 0.11,
    metalness: 0.36,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), coreMaterial);
  core.renderOrder = 9;

  const cageMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const cage = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.19, 1), 8),
    cageMaterial,
  );
  cage.renderOrder = 8;

  const bloomMaterial = new THREE.SpriteMaterial({
    map: bloomTexture,
    color: 0xffffff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const bloom = new THREE.Sprite(bloomMaterial);
  bloom.scale.set(1.36, 0.42, 1);
  bloom.renderOrder = 5;
  const light = new THREE.PointLight(0xffffff, 2.6, 2.65, 1.7);
  group.add(bloom, lattice, shell, cage, core, light);
  group.visible = false;
  group.renderOrder = 6;

  return {
    group,
    setAccent(color) {
      (shellMaterial.uniforms.uAccent.value as THREE.Color).set(color);
      latticeMaterial.color.set(color);
      coreMaterial.color.set(color);
      coreMaterial.emissive.set(color);
      cageMaterial.color.set(color);
      bloomMaterial.color.set(color);
      light.color.set(color);
    },
    setPosition(position) {
      group.position.copy(position);
    },
    setVisible(visible) {
      group.visible = visible;
    },
    tick(seconds, animate) {
      if (!group.visible) return;
      group.scale.setScalar(animate ? 1 + Math.sin(seconds * 1.05) * 0.012 : 1);
      shellMaterial.uniforms.uTime.value = animate ? seconds : 0;
      if (animate) {
        shell.rotation.y = seconds * 0.11;
        shell.rotation.x = Math.sin(seconds * 0.16) * 0.08;
        lattice.rotation.y = -seconds * 0.055;
        lattice.rotation.z = seconds * 0.032;
        core.rotation.x = seconds * 0.34;
        core.rotation.y = seconds * 0.47;
        cage.rotation.x = -seconds * 0.19;
        cage.rotation.z = seconds * 0.23;
        bloomMaterial.opacity = 0.18 + Math.sin(seconds * 1.4) * 0.045;
      }
    },
  };
}

export type StageLabelItem = {
  position: THREE.Vector3;
  element: HTMLElement;
  offsetY?: number;
};

export function createLabelLayer(host: HTMLElement) {
  const layer = document.createElement("div");
  layer.className = "space-graph-label-layer";
  host.appendChild(layer);
  return layer;
}

// 把三维位置投到屏幕像素并写进 transform。文字必须留在 HTML 层——
// WebGL 里渲染 CJK 文本既不清晰也不可选中，这是两个视图共同的铁律。
export function projectLabelItems(
  items: StageLabelItem[],
  anchor: THREE.Object3D,
  camera: THREE.Camera,
  host: HTMLElement,
) {
  items.forEach(({ position, element, offsetY = 13 }) => {
    const projected = anchor.localToWorld(position.clone()).project(camera);
    const onScreen =
      projected.z > -1 &&
      projected.z < 1 &&
      Math.abs(projected.x) < 1.08 &&
      Math.abs(projected.y) < 1.08;
    element.dataset.visible = onScreen ? "true" : "false";
    if (onScreen) {
      const x = (projected.x * 0.5 + 0.5) * host.clientWidth;
      const y = (-projected.y * 0.5 + 0.5) * host.clientHeight;
      element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, ${offsetY}px)`;
    }
  });
}

export function disposeStage(scene: THREE.Scene) {
  scene.traverse((object) => {
    // Line で判定する（LineSegments は Line の子クラスなので両方拾える）。
    // 以前は LineSegments で判定していて、普通の Line（手勢の射線）が
    // どの分岐にも入らず geometry/material を漏らしていた。
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Points ||
      object instanceof THREE.Line
    ) {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
      materials.forEach((material) => {
        const map = "map" in material ? material.map : null;
        if (map instanceof THREE.Texture) map.dispose();
      });
    }
    if (object instanceof THREE.Sprite) {
      object.material.dispose();
    }
    // InstancedMesh の instanceMatrix / instanceColor の GL buffer は
    // object.dispose() の dispose イベント経由でしか解放されない
    // （geometry/material の dispose では落ちない）。分区筛选はシーンを
    // 作り直すので、これが無いと旧 buffer が GC まで宙吊りになる。
    if (object instanceof THREE.InstancedMesh) {
      object.dispose();
    }
  });
}
