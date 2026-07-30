"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type KnowledgeGraphSceneNode = {
  id: string;
  title: string;
  group: string;
  groupLabel: string;
  color: string;
  degree: number;
};

export type KnowledgeGraphSceneLink = {
  source: string;
  target: string;
};

type Props = {
  nodes: KnowledgeGraphSceneNode[];
  links: KnowledgeGraphSceneLink[];
  onOpen: (id: string) => void;
  onFallback: () => void;
};

type Flight = {
  startedAt: number;
  duration: number;
  fromCamera: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toCamera: THREE.Vector3;
  toTarget: THREE.Vector3;
};

const GROUP_CENTERS: Record<string, [number, number, number]> = {
  self: [-3.8, 2.15, 0.6],
  career: [3.8, 2.05, -0.2],
  study: [-3.65, -2.45, -0.15],
  analysis: [3.7, -2.35, 0.7],
  system: [0, 0, -1.25],
};

const NODE_VERTEX_SHADER = `
  attribute float aSize;
  attribute float aFocus;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vFocus;
  uniform float uTime;
  uniform float uMotion;

  void main() {
    vColor = color;
    vFocus = aFocus;
    float pulse = 1.0 + sin(uTime * 1.5 + aPhase) * 0.08 * uMotion;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = aSize * pulse * (300.0 / max(3.0, -viewPosition.z));
  }
`;

const NODE_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vFocus;

  void main() {
    float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
    if (distanceFromCenter > 0.5) discard;
    float corona = smoothstep(0.5, 0.22, distanceFromCenter);
    float body = smoothstep(0.29, 0.08, distanceFromCenter);
    float core = smoothstep(0.14, 0.0, distanceFromCenter);
    float ring = smoothstep(0.38, 0.32, distanceFromCenter)
      - smoothstep(0.29, 0.23, distanceFromCenter);
    float alpha = max(corona * 0.72, body) * mix(0.82, 1.0, vFocus);
    vec3 color = vColor * 1.42 + ring * vec3(0.48) + core * vec3(1.0) + vFocus * vec3(0.28);
    gl_FragColor = vec4(color, alpha);
  }
`;

const LINK_VERTEX_SHADER = `
  attribute float aFocus;
  varying vec3 vColor;
  varying float vFocus;

  void main() {
    vColor = color;
    vFocus = aFocus;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINK_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vFocus;

  void main() {
    float alpha = mix(0.16, 0.88, vFocus);
    gl_FragColor = vec4(vColor + vFocus * vec3(0.2), alpha);
  }
`;

function seeded(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export default function ThreeKnowledgeGraph({
  nodes,
  links,
  onOpen,
  onFallback,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<() => void>(() => undefined);
  const pauseRef = useRef(false);
  const onOpenRef = useRef(onOpen);
  const onFallbackRef = useRef(onFallback);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const toggleFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage || !document.fullscreenEnabled) return;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else {
        await stage.requestFullscreen();
      }
    } catch {
      // 埋め込みブラウザが権限を拒否しても、星図本体と他の操作は壊さない。
    }
  }, []);

  useEffect(() => {
    const syncFullscreen = () => {
      setFullscreen(document.fullscreenElement === stageRef.current);
    };
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key.toLowerCase() !== "f" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      void toggleFullscreen();
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("keydown", handleShortcut);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("keydown", handleShortcut);
    };
  }, [toggleFullscreen]);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    onFallbackRef.current = onFallback;
  }, [onFallback]);

  useEffect(() => {
    pauseRef.current = paused;
  }, [paused]);

  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const activeNode = nodeById.get(selectedId ?? hoveredId ?? "") ?? null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || nodes.length === 0) return;

    setReady(false);
    setHoveredId(null);
    setSelectedId(null);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: nodes.length < 1200,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      onFallbackRef.current();
      return;
    }

    const canvas = renderer.domElement;
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      `Obsidian 2.5D 记忆星图，共 ${nodes.length} 个节点；方向键选择，回车打开笔记`,
    );
    canvas.tabIndex = 0;
    host.appendChild(canvas);

    renderer.setClearColor(0x101b17, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, nodes.length > 1200 ? 1.25 : 1.75),
    );

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x101b17, 0.035);

    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 80);
    const root = new THREE.Group();
    scene.add(root);

    const positions = new Float32Array(nodes.length * 3);
    const colors = new Float32Array(nodes.length * 3);
    const sizes = new Float32Array(nodes.length);
    const phases = new Float32Array(nodes.length);
    const nodeFocus = new Float32Array(nodes.length);
    const positionById = new Map<string, THREE.Vector3>();
    const indexById = new Map<string, number>();

    nodes.forEach((node, index) => {
      const [centerX, centerY, centerZ] = GROUP_CENTERS[node.group] ?? GROUP_CENTERS.system;
      const angle = seeded(node.id) * Math.PI * 2;
      const radius = 0.65 + seeded(`${node.id}:radius`) * 2.25;
      const position = new THREE.Vector3(
        centerX + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius * 0.66,
        centerZ + (seeded(`${node.id}:depth`) - 0.5) * 2.45,
      );
      const color = new THREE.Color(node.color);
      positions.set(position.toArray(), index * 3);
      colors.set(color.toArray(), index * 3);
      sizes[index] = 0.82 + Math.min(1.08, Math.sqrt(node.degree + 1) * 0.17);
      phases[index] = seeded(`${node.id}:phase`) * Math.PI * 2;
      positionById.set(node.id, position);
      indexById.set(node.id, index);
    });

    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    nodeGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    nodeGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    nodeGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    nodeGeometry.setAttribute("aFocus", new THREE.BufferAttribute(nodeFocus, 1));

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodeMaterial = new THREE.ShaderMaterial({
      vertexShader: NODE_VERTEX_SHADER,
      fragmentShader: NODE_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uMotion: { value: reducedMotion ? 0 : 1 },
      },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const nodePoints = new THREE.Points(nodeGeometry, nodeMaterial);
    nodePoints.renderOrder = 3;
    root.add(nodePoints);

    // 常驻少量高连接节点的标签，让星图不再只是一片“看不清是什么”的光点。
    const labelLayer = document.createElement("div");
    labelLayer.className = "space-graph-label-layer";
    host.appendChild(labelLayer);
    const labeledNodes = Object.keys(GROUP_CENTERS).flatMap((group) =>
      nodes
        .filter((node) => node.group === group)
        .toSorted((left, right) => right.degree - left.degree)
        .slice(0, 3),
    );
    const labelItems = labeledNodes.flatMap((node) => {
      const position = positionById.get(node.id);
      if (!position) return [];
      const label = document.createElement("span");
      label.style.setProperty("--label-accent", node.color);
      const dot = document.createElement("i");
      const text = document.createElement("b");
      text.textContent = node.title.length > 22 ? `${node.title.slice(0, 22)}…` : node.title;
      label.append(dot, text);
      labelLayer.appendChild(label);
      return [{ node, position, label }];
    });

    const validLinks = links.filter(
      (link) => positionById.has(link.source) && positionById.has(link.target),
    );
    const linkPositions = new Float32Array(validLinks.length * 6);
    const linkColors = new Float32Array(validLinks.length * 6);
    const linkFocus = new Float32Array(validLinks.length * 2);
    const adjacency = new Map<string, Set<string>>();

    validLinks.forEach((link, index) => {
      const source = positionById.get(link.source)!;
      const target = positionById.get(link.target)!;
      const sourceColor = new THREE.Color(nodeById.get(link.source)?.color ?? "#9fb5a8");
      const targetColor = new THREE.Color(nodeById.get(link.target)?.color ?? "#9fb5a8");
      linkPositions.set([...source.toArray(), ...target.toArray()], index * 6);
      linkColors.set([...sourceColor.toArray(), ...targetColor.toArray()], index * 6);
      if (!adjacency.has(link.source)) adjacency.set(link.source, new Set());
      if (!adjacency.has(link.target)) adjacency.set(link.target, new Set());
      adjacency.get(link.source)!.add(link.target);
      adjacency.get(link.target)!.add(link.source);
    });

    const linkGeometry = new THREE.BufferGeometry();
    linkGeometry.setAttribute("position", new THREE.BufferAttribute(linkPositions, 3));
    linkGeometry.setAttribute("color", new THREE.BufferAttribute(linkColors, 3));
    linkGeometry.setAttribute("aFocus", new THREE.BufferAttribute(linkFocus, 1));
    const linkMaterial = new THREE.ShaderMaterial({
      vertexShader: LINK_VERTEX_SHADER,
      fragmentShader: LINK_FRAGMENT_SHADER,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const linkLines = new THREE.LineSegments(linkGeometry, linkMaterial);
    linkLines.renderOrder = 1;
    root.add(linkLines);

    const pulseLimit = Math.max(1, Math.min(80, validLinks.length));
    const pulsePositions = new Float32Array(pulseLimit * 3);
    const pulseColors = new Float32Array(pulseLimit * 3);
    const pulseGeometry = new THREE.BufferGeometry();
    pulseGeometry.setAttribute("position", new THREE.BufferAttribute(pulsePositions, 3));
    pulseGeometry.setAttribute("color", new THREE.BufferAttribute(pulseColors, 3));
    const pulseMaterial = new THREE.PointsMaterial({
      size: 0.115,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pulsePoints = new THREE.Points(pulseGeometry, pulseMaterial);
    pulsePoints.renderOrder = 4;
    root.add(pulsePoints);
    const ambientPulseStep = Math.max(1, Math.ceil(validLinks.length / pulseLimit));
    const ambientPulseLinks = validLinks
      .filter((_, index) => index % ambientPulseStep === 0)
      .slice(0, pulseLimit);
    let pulseLinks: KnowledgeGraphSceneLink[] = ambientPulseLinks;
    pulseGeometry.setDrawRange(0, pulseLinks.length);

    const haloGeometry = new THREE.RingGeometry(2.5, 2.53, 96);
    Object.entries(GROUP_CENTERS).forEach(([group, center]) => {
      const groupNode = nodes.find((node) => node.group === group);
      if (!groupNode) return;
      const haloMaterial = new THREE.MeshBasicMaterial({
        color: groupNode.color,
        transparent: true,
        opacity: 0.075,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Mesh(haloGeometry, haloMaterial);
      halo.position.set(...center);
      halo.scale.set(1.2, 0.76, 1);
      halo.renderOrder = 0;
      root.add(halo);
    });

    const nebulaCanvas = document.createElement("canvas");
    nebulaCanvas.width = 192;
    nebulaCanvas.height = 192;
    const nebulaContext = nebulaCanvas.getContext("2d");
    if (nebulaContext) {
      const gradient = nebulaContext.createRadialGradient(96, 96, 0, 96, 96, 96);
      gradient.addColorStop(0, "rgba(255,255,255,.72)");
      gradient.addColorStop(0.2, "rgba(255,255,255,.23)");
      gradient.addColorStop(0.58, "rgba(255,255,255,.07)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      nebulaContext.fillStyle = gradient;
      nebulaContext.fillRect(0, 0, 192, 192);
    }
    const nebulaTexture = new THREE.CanvasTexture(nebulaCanvas);
    Object.entries(GROUP_CENTERS).forEach(([group, center], groupIndex) => {
      const groupNode = nodes.find((node) => node.group === group);
      if (!groupNode) return;
      const nebulaMaterial = new THREE.SpriteMaterial({
        map: nebulaTexture,
        color: groupNode.color,
        transparent: true,
        opacity: group === "system" ? 0.12 : 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const nebula = new THREE.Sprite(nebulaMaterial);
      nebula.position.set(center[0], center[1], center[2] - 1.6);
      nebula.scale.set(7.2 + groupIndex * 0.16, 4.4, 1);
      nebula.renderOrder = -1;
      root.add(nebula);
    });

    const galaxyGroups = Object.entries(GROUP_CENTERS).filter(([group]) =>
      nodes.some((node) => node.group === group),
    );
    const dustCount = Math.min(1300, Math.max(520, nodes.length * 4));
    const dustPositions = new Float32Array(dustCount * 3);
    const dustColors = new Float32Array(dustCount * 3);
    for (let index = 0; index < dustCount; index += 1) {
      const [group, center] = galaxyGroups[index % galaxyGroups.length];
      const radius = Math.pow(seeded(`dust:${index}:radius`), 0.72) * 3.1;
      const arm = index % 3;
      const angle =
        radius * 1.55 +
        arm * (Math.PI * 2 / 3) +
        (seeded(`dust:${index}:angle`) - 0.5) * 0.72;
      dustPositions.set([
        center[0] + Math.cos(angle) * radius,
        center[1] + Math.sin(angle) * radius * 0.56,
        center[2] - 0.45 + (seeded(`dust:${index}:depth`) - 0.5) * 1.7,
      ], index * 3);
      const groupColor = new THREE.Color(
        nodes.find((node) => node.group === group)?.color ?? "#9fb5a8",
      ).lerp(new THREE.Color("#ffffff"), 0.22);
      dustColors.set(groupColor.toArray(), index * 3);
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    dustGeometry.setAttribute("color", new THREE.BufferAttribute(dustColors, 3));
    const dustMaterial = new THREE.PointsMaterial({
      size: 0.035,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const galaxyDust = new THREE.Points(dustGeometry, dustMaterial);
    galaxyDust.renderOrder = 0;
    root.add(galaxyDust);

    const focusRingGeometry = new THREE.RingGeometry(0.31, 0.37, 72);
    const focusRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const focusRing = new THREE.Mesh(focusRingGeometry, focusRingMaterial);
    focusRing.visible = false;
    focusRing.renderOrder = 5;
    root.add(focusRing);

    const backgroundPositions = new Float32Array(360 * 3);
    for (let index = 0; index < 360; index += 1) {
      const radius = 8 + seeded(`background:${index}`) * 18;
      const theta = seeded(`background:${index}:theta`) * Math.PI * 2;
      const phi = Math.acos(2 * seeded(`background:${index}:phi`) - 1);
      backgroundPositions.set([
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
      ], index * 3);
    }
    const backgroundGeometry = new THREE.BufferGeometry();
    backgroundGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(backgroundPositions, 3),
    );
    const backgroundMaterial = new THREE.PointsMaterial({
      color: 0xcfe2d7,
      size: 0.027,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    const background = new THREE.Points(backgroundGeometry, backgroundMaterial);
    scene.add(background);

    nodeGeometry.computeBoundingBox();
    const bounds = nodeGeometry.boundingBox ?? new THREE.Box3(
      new THREE.Vector3(-5, -4, -1),
      new THREE.Vector3(5, 4, 1),
    );
    const homeTarget = bounds.getCenter(new THREE.Vector3());
    const boundsSize = bounds.getSize(new THREE.Vector3());
    const fitDistance = (aspect: number) => {
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.3, aspect));
      const verticalDistance = boundsSize.y / (2 * Math.tan(verticalFov / 2));
      const horizontalDistance = boundsSize.x / (2 * Math.tan(horizontalFov / 2));
      return Math.max(10.5, Math.max(verticalDistance, horizontalDistance) * 1.24 + boundsSize.z * 0.45);
    };
    let homeCamera = homeTarget.clone().add(
      new THREE.Vector3(0, 0, fitDistance(camera.aspect)),
    );
    camera.position.copy(homeCamera);

    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(homeTarget);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = true;
    controls.panSpeed = 0.55;
    controls.rotateSpeed = 0.42;
    controls.zoomSpeed = 0.72;
    controls.minDistance = 3.6;
    controls.maxDistance = 30;
    controls.minPolarAngle = Math.PI * 0.31;
    controls.maxPolarAngle = Math.PI * 0.69;
    controls.minAzimuthAngle = -Math.PI * 0.28;
    controls.maxAzimuthAngle = Math.PI * 0.28;
    controls.update();

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points!.threshold = 0.27;
    const pointer = new THREE.Vector2();
    const selectedRef = { current: null as string | null };
    const hoveredRef = { current: null as string | null };
    let flight: Flight | null = null;
    let pointerStart: [number, number] | null = null;
    let keyboardIndex = 0;
    let visible = true;

    const setFlight = (toCamera: THREE.Vector3, toTarget: THREE.Vector3, duration = 820) => {
      flight = {
        startedAt: performance.now(),
        duration,
        fromCamera: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toCamera,
        toTarget,
      };
    };

    const focusAttributes = (id: string | null) => {
      const neighbors = id ? adjacency.get(id) ?? new Set<string>() : new Set<string>();
      nodes.forEach((node, index) => {
        nodeFocus[index] = node.id === id ? 1 : neighbors.has(node.id) ? 0.42 : 0;
      });
      (nodeGeometry.getAttribute("aFocus") as THREE.BufferAttribute).needsUpdate = true;

      validLinks.forEach((link, index) => {
        const active = id && (link.source === id || link.target === id) ? 1 : 0;
        linkFocus[index * 2] = active;
        linkFocus[index * 2 + 1] = active;
      });
      (linkGeometry.getAttribute("aFocus") as THREE.BufferAttribute).needsUpdate = true;

      pulseLinks = id
        ? validLinks
            .filter((link) => link.source === id || link.target === id)
            .slice(0, pulseLimit)
        : ambientPulseLinks;
      pulseGeometry.setDrawRange(0, pulseLinks.length);

      const focusPosition = id ? positionById.get(id) : undefined;
      focusRing.visible = Boolean(focusPosition);
      if (focusPosition && id) {
        focusRing.position.copy(focusPosition);
        focusRingMaterial.color.set(nodeById.get(id)?.color ?? "#ffffff");
      }
      labelItems.forEach(({ node, label }) => {
        label.dataset.active =
          node.id === id ? "selected" : neighbors.has(node.id) ? "neighbor" : "";
      });
    };

    const selectNode = (id: string) => {
      const index = indexById.get(id);
      const localPosition = positionById.get(id);
      if (index === undefined || !localPosition) return;
      keyboardIndex = index;
      selectedRef.current = id;
      setSelectedId(id);
      focusAttributes(id);
      const worldPosition = nodePoints.localToWorld(localPosition.clone());
      setFlight(
        worldPosition.clone().add(new THREE.Vector3(0, 0.12, 5.1)),
        worldPosition,
      );
    };

    const resetView = () => {
      selectedRef.current = null;
      hoveredRef.current = null;
      setSelectedId(null);
      setHoveredId(null);
      focusAttributes(null);
      setFlight(homeCamera.clone(), homeTarget.clone(), 900);
    };
    resetViewRef.current = resetView;

    const hitTest = (event: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(nodePoints, false)[0];
      return hit?.index === undefined ? null : nodes[hit.index]?.id ?? null;
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerStart = [event.clientX, event.clientY];
    };
    const onPointerMove = (event: PointerEvent) => {
      const id = hitTest(event);
      canvas.style.cursor = id ? "pointer" : "grab";
      if (id === hoveredRef.current) return;
      hoveredRef.current = id;
      setHoveredId(id);
      focusAttributes(id ?? selectedRef.current);
    };
    const onPointerLeave = () => {
      hoveredRef.current = null;
      setHoveredId(null);
      canvas.style.cursor = "grab";
      focusAttributes(selectedRef.current);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerStart) return;
      const moved = Math.hypot(
        event.clientX - pointerStart[0],
        event.clientY - pointerStart[1],
      );
      pointerStart = null;
      if (moved > 5) return;
      const id = hitTest(event);
      if (id) selectNode(id);
    };
    const onDoubleClick = (event: MouseEvent) => {
      const id = hitTest(event);
      if (id) onOpenRef.current(id);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        resetView();
        return;
      }
      if (event.key === "Enter" && selectedRef.current) {
        onOpenRef.current(selectedRef.current);
        return;
      }
      if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
      keyboardIndex = (keyboardIndex + direction + nodes.length) % nodes.length;
      selectNode(nodes[keyboardIndex].id);
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      onFallbackRef.current();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("webglcontextlost", onContextLost);

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.max(1, entry.contentRect.width);
      const height = Math.max(1, entry.contentRect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      homeCamera = homeTarget.clone().add(
        new THREE.Vector3(0, 0, fitDistance(camera.aspect)),
      );
      if (!selectedRef.current) {
        camera.position.copy(homeCamera);
        controls.target.copy(homeTarget);
        controls.update();
      }
    });
    resizeObserver.observe(host);

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
      },
      { threshold: 0.01 },
    );
    visibilityObserver.observe(host);

    const animate = (now: number) => {
      if (!visible) return;
      const seconds = now / 1000;
      nodeMaterial.uniforms.uTime.value = seconds;
      nodeMaterial.uniforms.uMotion.value = pauseRef.current || reducedMotion ? 0 : 1;

      if (flight) {
        const rawProgress = Math.min(1, (now - flight.startedAt) / flight.duration);
        const progress = easeInOutCubic(rawProgress);
        camera.position.lerpVectors(flight.fromCamera, flight.toCamera, progress);
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, progress);
        if (rawProgress >= 1) flight = null;
      }

      if (!pauseRef.current && !reducedMotion && !selectedRef.current) {
        root.rotation.y = Math.sin(seconds * 0.11) * 0.055;
        root.rotation.x = Math.cos(seconds * 0.08) * 0.018;
        background.rotation.y = seconds * 0.004;
        galaxyDust.rotation.z = Math.sin(seconds * 0.07) * 0.025;
      }

      if (focusRing.visible) {
        const ringPulse = pauseRef.current || reducedMotion
          ? 1
          : 1 + Math.sin(seconds * 3.1) * 0.18;
        focusRing.scale.setScalar(ringPulse);
        focusRingMaterial.opacity = 0.62 + Math.sin(seconds * 3.1) * 0.22;
      }

      if (!pauseRef.current && pulseLinks.length > 0) {
        pulseLinks.forEach((link, index) => {
          const source = positionById.get(link.source)!;
          const target = positionById.get(link.target)!;
          const progress = (seconds * 0.23 + index / Math.max(1, pulseLinks.length)) % 1;
          const position = source.clone().lerp(target, progress);
          const color = new THREE.Color(
            nodeById.get(progress < 0.5 ? link.source : link.target)?.color ?? "#ffffff",
          );
          pulsePositions.set(position.toArray(), index * 3);
          pulseColors.set(color.toArray(), index * 3);
        });
        (pulseGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
        (pulseGeometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
      }

      controls.update();
      scene.updateMatrixWorld(true);
      labelItems.forEach(({ position, label }) => {
        const projected = nodePoints.localToWorld(position.clone()).project(camera);
        const onScreen =
          projected.z > -1 &&
          projected.z < 1 &&
          Math.abs(projected.x) < 1.08 &&
          Math.abs(projected.y) < 1.08;
        label.dataset.visible = onScreen ? "true" : "false";
        if (onScreen) {
          const x = (projected.x * 0.5 + 0.5) * host.clientWidth;
          const y = (-projected.y * 0.5 + 0.5) * host.clientHeight;
          label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, 13px)`;
        }
      });
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(animate);
    const readyFrame = window.requestAnimationFrame(() => setReady(true));

    return () => {
      cancelAnimationFrame(readyFrame);
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      controls.dispose();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
        if (object instanceof THREE.Sprite) {
          object.material.dispose();
        }
      });
      nebulaTexture.dispose();
      haloGeometry.dispose();
      renderer.dispose();
      labelLayer.remove();
      canvas.remove();
      resetViewRef.current = () => undefined;
    };
  }, [links, nodeById, nodes]);

  if (nodes.length === 0) {
    return <div className="space-graph-empty">这个分区暂时没有可绘制的笔记。</div>;
  }

  return (
    <div
      ref={stageRef}
      className="space-graph-stage"
      data-ready={ready ? "true" : "false"}
      data-fullscreen={fullscreen ? "true" : "false"}
    >
      <div ref={hostRef} className="space-graph-webgl" />
      {!ready && (
        <div className="space-graph-loading" role="status">
          <i />
          <span>正在点亮记忆星图</span>
        </div>
      )}
      <div className="space-graph-brand" aria-hidden="true">
        <span>MEMORY CONSTELLATION</span>
        <strong>思考的轨迹，以光连接。</strong>
      </div>
      {activeNode && (
        <div
          className="space-graph-node-card"
          style={{ "--node-accent": activeNode.color } as CSSProperties}
          role="status"
        >
          <span>{activeNode.groupLabel}</span>
          <strong>{activeNode.title}</strong>
          <small>{activeNode.degree} 条可见关系</small>
          {selectedId && (
            <button type="button" onClick={() => onOpen(selectedId)}>
              打开这篇笔记 <b>↗</b>
            </button>
          )}
        </div>
      )}
      <div className="space-graph-controls">
        <button
          type="button"
          aria-label={fullscreen ? "退出全屏" : "全屏查看星图，快捷键 F"}
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? "退出全屏" : "全屏"} <kbd>F</kbd>
        </button>
        <button type="button" onClick={() => resetViewRef.current()}>
          回到全景
        </button>
        <button
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? "继续呼吸" : "暂停动态"}
        </button>
      </div>
      <div className="space-graph-caption">
        <span>拖动探索 · 滚轮缩放 · 双击打开</span>
        <strong>{nodes.length} 个节点 · {links.length} 条连接</strong>
      </div>
      <details className="space-graph-index">
        <summary>用列表访问全部节点</summary>
        <div>
          {nodes
            .toSorted((left, right) => right.degree - left.degree)
            .map((node) => (
              <button type="button" key={node.id} onClick={() => onOpen(node.id)}>
                <i style={{ background: node.color }} />
                <span>{node.title}</span>
                <small>{node.degree}</small>
              </button>
            ))}
        </div>
      </details>
    </div>
  );
}
