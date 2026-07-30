"use client";

import {
  type CSSProperties,
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
    gl_PointSize = aSize * pulse * (250.0 / max(3.0, -viewPosition.z));
  }
`;

const NODE_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vFocus;

  void main() {
    float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
    if (distanceFromCenter > 0.5) discard;
    float halo = smoothstep(0.5, 0.04, distanceFromCenter);
    float core = smoothstep(0.18, 0.0, distanceFromCenter);
    float alpha = halo * mix(0.7, 1.0, vFocus);
    vec3 color = vColor + core * vec3(0.85) + vFocus * vec3(0.22);
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
    float alpha = mix(0.105, 0.82, vFocus);
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
  const hostRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<() => void>(() => undefined);
  const pauseRef = useRef(false);
  const onOpenRef = useRef(onOpen);
  const onFallbackRef = useRef(onFallback);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      sizes[index] = 0.58 + Math.min(0.72, Math.sqrt(node.degree + 1) * 0.12);
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
    pulseGeometry.setDrawRange(0, 0);
    const pulseMaterial = new THREE.PointsMaterial({
      size: 0.1,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pulsePoints = new THREE.Points(pulseGeometry, pulseMaterial);
    pulsePoints.renderOrder = 4;
    root.add(pulsePoints);
    let pulseLinks: KnowledgeGraphSceneLink[] = [];

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
    const homeDistance = Math.max(12, Math.max(boundsSize.x, boundsSize.y) * 1.48);
    const homeCamera = homeTarget.clone().add(new THREE.Vector3(0, 0, homeDistance));
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
        : [];
      pulseGeometry.setDrawRange(0, pulseLinks.length);
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
      });
      haloGeometry.dispose();
      renderer.dispose();
      canvas.remove();
      resetViewRef.current = () => undefined;
    };
  }, [links, nodeById, nodes]);

  if (nodes.length === 0) {
    return <div className="space-graph-empty">这个分区暂时没有可绘制的笔记。</div>;
  }

  return (
    <div className="space-graph-stage" data-ready={ready ? "true" : "false"}>
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
