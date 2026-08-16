// 3D 舞台共享层：记忆星图（knowledge-graph-three）与时之航道（timeline-three）
// 共用的 three.js 工具。这里只放与「哪张图」无关的部件——着色器、纹理、飞行、
// 锁定物、标签投影、销毁——图专属的布局与语义留在各自视图里。
// 注意：本模块 import 了 three，只允许被两个 lazy 视图引用，
// 绝不能被 memory-atlas.tsx 急加载，否则 three 会被拖进主 chunk。
import * as THREE from "three";

export const NODE_VERTEX_SHADER = `
  attribute float aSize;
  attribute float aFocus;
  attribute float aPhase;
  attribute float aSearch;
  varying vec3 vColor;
  varying float vFocus;
  varying float vSearch;
  uniform float uTime;
  uniform float uMotion;
  uniform float uSearchActive;

  void main() {
    vColor = color;
    vFocus = aFocus;
    vSearch = aSearch;
    float pulse = 1.0 + sin(uTime * 1.5 + aPhase) * 0.08 * uMotion;
    float searchScale = mix(1.0, 1.28, aSearch * uSearchActive);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = aSize * pulse * searchScale * (360.0 / max(3.0, -viewPosition.z));
  }
`;

export const NODE_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vFocus;
  varying float vSearch;
  uniform float uSearchActive;

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
    float diffraction = horizontal * 0.62 + vertical * 0.42 + diagonal;
    float searchVisibility = mix(1.0, mix(0.16, 1.0, vSearch), uSearchActive);
    float alpha = min(1.0, halo + core + diffraction)
      * mix(0.76, 1.0, vFocus)
      * searchVisibility;
    vec3 color = mix(vColor * 1.2, vec3(1.0), core * 0.92 + diffraction * 0.42);
    gl_FragColor = vec4(color, alpha);
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
  renderer.setClearColor(options.clearColor ?? 0x101b17, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
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

// 背景星场。材质一并交出去：飞行控制器要在冲刺时拉伸它的 size / opacity。
export function createStarfield(options?: {
  count?: number;
  minRadius?: number;
  spread?: number;
  color?: number;
  size?: number;
  opacity?: number;
}) {
  const count = options?.count ?? 360;
  const minRadius = options?.minRadius ?? 8;
  const spread = options?.spread ?? 18;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const radius = minRadius + seeded(`background:${index}`) * spread;
    const theta = seeded(`background:${index}:theta`) * Math.PI * 2;
    const phi = Math.acos(2 * seeded(`background:${index}:phi`) - 1);
    positions.set([
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
    ], index * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: options?.color ?? 0xcfe2d7,
    size: options?.size ?? 0.027,
    transparent: true,
    opacity: options?.opacity ?? 0.48,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  return { points, material };
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

  const coreMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.45,
    roughness: 0.11,
    metalness: 0.36,
    transmission: 0.2,
    thickness: 0.8,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
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
