"use client";

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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
  path: string;
  kindLabel: string;
  updatedLabel: string;
  outbound: number;
  excerpt: string;
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

const NODE_FRAGMENT_SHADER = `
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
  uniform float uSearchActive;

  void main() {
    float searchVisibility = mix(1.0, mix(0.18, 1.0, vFocus), uSearchActive);
    float alpha = mix(0.16, 0.88, vFocus) * searchVisibility;
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resetViewRef = useRef<() => void>(() => undefined);
  const selectNodeRef = useRef<(id: string) => void>(() => undefined);
  const updateSearchRef = useRef<(ids: string[], active: boolean) => void>(
    () => undefined,
  );
  const searchRequestRef = useRef<{ ids: string[]; active: boolean }>({
    ids: [],
    active: false,
  });
  const pauseRef = useRef(false);
  const dossierModeRef = useRef<"dock" | "focus">("dock");
  const openingTimerRef = useRef<number | null>(null);
  const openingRequestRef = useRef(0);
  const onOpenRef = useRef(onOpen);
  const onFallbackRef = useRef(onFallback);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [dossierMode, setDossierMode] = useState<"dock" | "focus">("dock");
  const [dossierZoom, setDossierZoom] = useState(1);
  const [shortcutHelp, setShortcutHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);

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

  useEffect(() => {
    dossierModeRef.current = dossierMode;
  }, [dossierMode]);

  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const activeNode = nodeById.get(selectedId ?? hoveredId ?? "") ?? null;
  const selectedNode = nodeById.get(selectedId ?? "") ?? null;
  const openingNode = nodeById.get(openingId ?? "") ?? null;
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    const terms = normalizedSearchQuery.split(/\s+/).filter(Boolean);
    return nodes
      .flatMap((node) => {
        const title = node.title.toLocaleLowerCase();
        const path = node.path.toLocaleLowerCase();
        const content = node.excerpt.toLocaleLowerCase();
        const searchable = `${title}\n${path}\n${content}`;
        if (!terms.every((term) => searchable.includes(term))) return [];
        const score = terms.reduce((total, term) => (
          total
          + (title.includes(term) ? 8 : 0)
          + (path.includes(term) ? 3 : 0)
          + (content.includes(term) ? 1 : 0)
        ), 0);
        return [{ node, score }];
      })
      .toSorted((left, right) => (
        right.score - left.score
        || right.node.degree - left.node.degree
        || left.node.title.localeCompare(right.node.title)
      ))
      .map(({ node }) => node);
  }, [nodes, normalizedSearchQuery]);
  const searchWindowStart = Math.min(
    Math.max(0, searchCursor - 2),
    Math.max(0, searchResults.length - 6),
  );
  const visibleSearchResults = searchResults.slice(
    searchWindowStart,
    searchWindowStart + 6,
  );
  const selectedNeighbors = useMemo(() => {
    if (!selectedId) return [];
    const neighborIds = new Set<string>();
    links.forEach((link) => {
      if (link.source === selectedId) neighborIds.add(link.target);
      if (link.target === selectedId) neighborIds.add(link.source);
    });
    return [...neighborIds]
      .flatMap((id) => {
        const node = nodeById.get(id);
        return node ? [node] : [];
      })
      .toSorted((left, right) => right.degree - left.degree)
      .slice(0, 4);
  }, [links, nodeById, selectedId]);

  const openNode = useCallback((id: string) => {
    if (!nodeById.has(id)) return;
    const request = ++openingRequestRef.current;
    if (openingTimerRef.current !== null) {
      window.clearTimeout(openingTimerRef.current);
    }
    setOpeningId(id);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    openingTimerRef.current = window.setTimeout(() => {
      void (async () => {
        if (openingRequestRef.current !== request) return;
        const stage = stageRef.current;
        // Fullscreen API 只显示全屏元素的子树。先完成“穿越”动画，再退出全屏，
        // 才能让应用根节点下的完整笔记抽屉真正出现在用户眼前。
        if (stage && document.fullscreenElement === stage) {
          try {
            await document.exitFullscreen();
          } catch {
            // 某些嵌入式浏览器会拒绝退出请求，仍然继续打开笔记。
          }
        }
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        if (openingRequestRef.current !== request) return;
        onOpenRef.current(id);
        openingTimerRef.current = window.setTimeout(() => {
          if (openingRequestRef.current === request) setOpeningId(null);
        }, reducedMotion ? 80 : 320);
      })();
    }, reducedMotion ? 120 : 680);
  }, [nodeById]);

  const changeDossierZoom = useCallback((amount: number) => {
    setDossierZoom((current) => (
      Math.round(Math.min(1.35, Math.max(0.85, current + amount)) * 100) / 100
    ));
  }, []);

  useEffect(() => {
    const request = {
      ids: searchResults.map((node) => node.id),
      active: Boolean(normalizedSearchQuery),
    };
    searchRequestRef.current = request;
    updateSearchRef.current(request.ids, request.active);
  }, [normalizedSearchQuery, searchResults]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key === "Escape"
        && normalizedSearchQuery
        && !(target instanceof HTMLInputElement)
        && !(target instanceof HTMLTextAreaElement)
        && !(target instanceof HTMLElement && target.isContentEditable)
      ) {
        event.preventDefault();
        event.stopPropagation();
        setSearchQuery("");
        setSearchCursor(0);
        return;
      }
      if (
        event.key !== "/"
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    document.addEventListener("keydown", focusSearch, true);
    return () => document.removeEventListener("keydown", focusSearch, true);
  }, [normalizedSearchQuery]);

  const selectSearchResult = useCallback((index: number) => {
    const result = searchResults[index];
    if (!result) return;
    setSearchCursor(index);
    selectNodeRef.current(result.id);
    searchInputRef.current?.blur();
  }, [searchResults]);

  const handleSearchKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchCursor((current) => (
        searchResults.length === 0 ? 0 : (current + 1) % searchResults.length
      ));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchCursor((current) => (
        searchResults.length === 0
          ? 0
          : (current - 1 + searchResults.length) % searchResults.length
      ));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectSearchResult(searchCursor);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (searchQuery) {
        setSearchQuery("");
        setSearchCursor(0);
      } else {
        searchInputRef.current?.blur();
      }
    }
  }, [searchCursor, searchQuery, searchResults.length, selectSearchResult]);

  useEffect(() => {
    const handleDossierShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (event.key === "?") {
        event.preventDefault();
        setShortcutHelp((current) => !current);
        return;
      }
      if (key === "r") {
        event.preventDefault();
        resetViewRef.current();
        return;
      }
      if (key === "p") {
        event.preventDefault();
        setPaused((current) => !current);
        return;
      }
      if (!selectedId) return;
      if (key === "d") {
        event.preventDefault();
        setDossierMode((current) => current === "dock" ? "focus" : "dock");
        return;
      }
      if (key === "o") {
        event.preventDefault();
        openNode(selectedId);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeDossierZoom(0.1);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        changeDossierZoom(-0.1);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        setDossierZoom(1);
        return;
      }
      if (event.key === "Escape" && dossierMode === "focus") {
        event.preventDefault();
        event.stopPropagation();
        setDossierMode("dock");
      }
    };
    document.addEventListener("keydown", handleDossierShortcut);
    return () => document.removeEventListener("keydown", handleDossierShortcut);
  }, [changeDossierZoom, dossierMode, openNode, selectedId]);

  useEffect(() => () => {
    openingRequestRef.current += 1;
    if (openingTimerRef.current !== null) {
      window.clearTimeout(openingTimerRef.current);
    }
  }, []);

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
      `Obsidian 2.5D 记忆星图，共 ${nodes.length} 个节点；单击聚焦，双击打开完整笔记，方向键选择`,
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
    scene.add(new THREE.HemisphereLight(0xd8fff0, 0x07110d, 1.7));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(3, 6, 8);
    scene.add(keyLight);
    Object.entries(GROUP_CENTERS).forEach(([group, center]) => {
      const groupNode = nodes.find((node) => node.group === group);
      if (!groupNode) return;
      const light = new THREE.PointLight(groupNode.color, 5.2, 7.5, 1.65);
      light.position.set(center[0], center[1], center[2] + 2.1);
      scene.add(light);
    });

    const positions = new Float32Array(nodes.length * 3);
    const colors = new Float32Array(nodes.length * 3);
    const sizes = new Float32Array(nodes.length);
    const phases = new Float32Array(nodes.length);
    const nodeFocus = new Float32Array(nodes.length);
    const nodeSearch = new Float32Array(nodes.length);
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
    nodeGeometry.setAttribute("aSearch", new THREE.BufferAttribute(nodeSearch, 1));

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodeMaterial = new THREE.ShaderMaterial({
      vertexShader: NODE_VERTEX_SHADER,
      fragmentShader: NODE_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uMotion: { value: reducedMotion ? 0 : 1 },
        uSearchActive: { value: 0 },
      },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const nodePoints = new THREE.Points(nodeGeometry, nodeMaterial);
    nodePoints.renderOrder = 4;
    root.add(nodePoints);

    // 全文搜索命中项使用独立的三维能量球，而不是单纯放大 Point Sprite。
    // 这样远近关系、遮挡和镜头飞行时的体积都保持真实。
    const searchSphereGeometry = new THREE.SphereGeometry(1, 32, 20);
    const searchSphereMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.12,
      metalness: 0.14,
      transmission: 0.46,
      thickness: 0.78,
      ior: 1.34,
      clearcoat: 1,
      clearcoatRoughness: 0.035,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const searchSpheres = new THREE.InstancedMesh(
      searchSphereGeometry,
      searchSphereMaterial,
      nodes.length,
    );
    searchSpheres.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    searchSpheres.renderOrder = 3;
    const searchMatrix = new THREE.Object3D();
    const searchFlags = new Float32Array(nodes.length);
    let searchSphereScale = 0.24;
    nodes.forEach((node, index) => {
      const position = positionById.get(node.id)!;
      searchMatrix.position.copy(position);
      searchMatrix.scale.setScalar(0.0001);
      searchMatrix.updateMatrix();
      searchSpheres.setMatrixAt(index, searchMatrix.matrix);
      searchSpheres.setColorAt(
        index,
        new THREE.Color(node.color).lerp(new THREE.Color("#ffffff"), 0.24),
      );
    });
    searchSpheres.instanceMatrix.needsUpdate = true;
    if (searchSpheres.instanceColor) searchSpheres.instanceColor.needsUpdate = true;
    root.add(searchSpheres);

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
    let searchActive = false;
    const applySearchMatches = (ids: string[], active: boolean) => {
      const matches = new Set(ids);
      searchActive = active;
      searchSphereScale = matches.size <= 8
        ? 0.31
        : matches.size <= 30
          ? 0.25
          : matches.size <= 80
            ? 0.2
            : 0.16;
      nodeMaterial.uniforms.uSearchActive.value = active ? 1 : 0;
      nodes.forEach((node, index) => {
        const matched = matches.has(node.id);
        searchFlags[index] = active && matched ? 1 : 0;
        nodeSearch[index] = matched ? 1 : 0;
        searchMatrix.position.copy(positionById.get(node.id)!);
        searchMatrix.rotation.set(
          seeded(`${node.id}:search-x`) * Math.PI,
          seeded(`${node.id}:search-y`) * Math.PI,
          seeded(`${node.id}:search-z`) * Math.PI,
        );
        searchMatrix.scale.setScalar(
          active && matched ? searchSphereScale : 0.0001,
        );
        searchMatrix.updateMatrix();
        searchSpheres.setMatrixAt(index, searchMatrix.matrix);
      });
      searchSpheres.visible = active && matches.size > 0;
      searchSpheres.instanceMatrix.needsUpdate = true;
      (nodeGeometry.getAttribute("aSearch") as THREE.BufferAttribute).needsUpdate = true;
      labelItems.forEach(({ node, label }) => {
        label.dataset.search = active
          ? matches.has(node.id) ? "match" : "dim"
          : "";
      });
    };
    updateSearchRef.current = applySearchMatches;
    applySearchMatches(
      searchRequestRef.current.ids,
      searchRequestRef.current.active,
    );

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
      uniforms: {
        uSearchActive: { value: 0 },
      },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const linkLines = new THREE.LineSegments(linkGeometry, linkMaterial);
    linkLines.renderOrder = 1;
    root.add(linkLines);
    updateSearchRef.current = (ids, active) => {
      applySearchMatches(ids, active);
      linkMaterial.uniforms.uSearchActive.value = active ? 1 : 0;
    };
    linkMaterial.uniforms.uSearchActive.value = searchActive ? 1 : 0;

    const relationRibbons = new THREE.Group();
    relationRibbons.renderOrder = 2;
    root.add(relationRibbons);

    const pulseLimit = Math.max(1, Math.min(80, validLinks.length));
    const pulsePositions = new Float32Array(pulseLimit * 3);
    const pulseColors = new Float32Array(pulseLimit * 3);
    const pulseGeometry = new THREE.BufferGeometry();
    pulseGeometry.setAttribute("position", new THREE.BufferAttribute(pulsePositions, 3));
    pulseGeometry.setAttribute("color", new THREE.BufferAttribute(pulseColors, 3));
    const pulseCanvas = document.createElement("canvas");
    pulseCanvas.width = 192;
    pulseCanvas.height = 96;
    const pulseContext = pulseCanvas.getContext("2d");
    if (pulseContext) {
      pulseContext.translate(96, 48);
      pulseContext.scale(1, 0.42);
      const halo = pulseContext.createRadialGradient(0, 0, 0, 0, 0, 74);
      halo.addColorStop(0, "rgba(255,255,255,1)");
      halo.addColorStop(0.08, "rgba(255,255,255,.94)");
      halo.addColorStop(0.28, "rgba(215,245,232,.5)");
      halo.addColorStop(0.62, "rgba(110,210,173,.13)");
      halo.addColorStop(1, "rgba(110,210,173,0)");
      pulseContext.fillStyle = halo;
      pulseContext.beginPath();
      pulseContext.arc(0, 0, 74, 0, Math.PI * 2);
      pulseContext.fill();
      pulseContext.setTransform(1, 0, 0, 1, 0, 0);
      const streak = pulseContext.createLinearGradient(12, 0, 180, 0);
      streak.addColorStop(0, "rgba(255,255,255,0)");
      streak.addColorStop(0.42, "rgba(210,255,237,.2)");
      streak.addColorStop(0.5, "rgba(255,255,255,.92)");
      streak.addColorStop(0.58, "rgba(210,255,237,.2)");
      streak.addColorStop(1, "rgba(255,255,255,0)");
      pulseContext.fillStyle = streak;
      pulseContext.fillRect(12, 45, 168, 6);
    }
    const pulseTexture = new THREE.CanvasTexture(pulseCanvas);
    pulseTexture.colorSpace = THREE.SRGBColorSpace;
    const pulseMaterial = new THREE.PointsMaterial({
      size: 0.24,
      sizeAttenuation: true,
      vertexColors: true,
      map: pulseTexture,
      alphaTest: 0.018,
      transparent: true,
      opacity: 0.94,
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

    // 选中节点是一枚悬浮的“记忆数据核心”：有天体的体量感，但不模拟真实星球。
    // 粒子扫描、测地骨架和晶体内核共同表达未来感，避免重新堆叠装饰性轨道。
    const focusArtifact = new THREE.Group();
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
    const focusShellGeometry = new THREE.BufferGeometry();
    focusShellGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(shellPositions, 3),
    );
    focusShellGeometry.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(shellPhases, 1),
    );
    const focusShellMaterial = new THREE.ShaderMaterial({
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
    const focusShell = new THREE.Points(focusShellGeometry, focusShellMaterial);
    focusShell.renderOrder = 7;

    const focusLatticeMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const focusLattice = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.372, 2), 18),
      focusLatticeMaterial,
    );
    focusLattice.renderOrder = 6;

    const focusCoreMaterial = new THREE.MeshPhysicalMaterial({
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
    const focusCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.14, 1),
      focusCoreMaterial,
    );
    focusCore.renderOrder = 9;

    const focusCageMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const focusCage = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.19, 1), 8),
      focusCageMaterial,
    );
    focusCage.renderOrder = 8;

    const focusBloomMaterial = new THREE.SpriteMaterial({
      map: pulseTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const focusBloom = new THREE.Sprite(focusBloomMaterial);
    focusBloom.scale.set(1.36, 0.42, 1);
    focusBloom.renderOrder = 5;
    const focusLight = new THREE.PointLight(0xffffff, 2.6, 2.65, 1.7);
    focusArtifact.add(
      focusBloom,
      focusLattice,
      focusShell,
      focusCage,
      focusCore,
      focusLight,
    );
    focusArtifact.visible = false;
    focusArtifact.renderOrder = 6;
    root.add(focusArtifact);

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

    const relationCurve = (link: KnowledgeGraphSceneLink) => {
      const source = positionById.get(link.source)!;
      const target = positionById.get(link.target)!;
      const midpoint = source.clone().lerp(target, 0.5);
      const direction = target.clone().sub(source);
      const normal = new THREE.Vector3(-direction.y, direction.x, 0.5).normalize();
      const bend = 0.16 + seeded(`${link.source}:${link.target}:bend`) * 0.3;
      midpoint.addScaledVector(normal, bend);
      midpoint.z += (seeded(`${link.source}:${link.target}:z`) - 0.5) * 0.42;
      return new THREE.QuadraticBezierCurve3(source, midpoint, target);
    };

    const clearRelationRibbons = () => {
      [...relationRibbons.children].forEach((child) => {
        relationRibbons.remove(child);
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      });
    };

    const focusAttributes = (id: string | null) => {
      const neighbors = id ? adjacency.get(id) ?? new Set<string>() : new Set<string>();
      nodes.forEach((node, index) => {
        nodeFocus[index] = node.id === id ? 0.3 : neighbors.has(node.id) ? 0.42 : 0;
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

      const lockedId = selectedRef.current;
      const focusPosition = lockedId ? positionById.get(lockedId) : undefined;
      focusArtifact.visible = Boolean(focusPosition);
      if (focusPosition && lockedId) {
        const activeGraphNode = nodeById.get(lockedId);
        const accent = activeGraphNode?.color ?? "#ffffff";
        const artifactAccent = activeGraphNode?.group === "system"
          ? "#48c5a6"
          : accent;
        focusArtifact.position.copy(focusPosition);
        focusShellMaterial.uniforms.uAccent.value.set(artifactAccent);
        focusLatticeMaterial.color.set(artifactAccent);
        focusCoreMaterial.color.set(artifactAccent);
        focusCoreMaterial.emissive.set(artifactAccent);
        focusCageMaterial.color.set(artifactAccent);
        focusBloomMaterial.color.set(artifactAccent);
        focusLight.color.set(artifactAccent);
      }
      clearRelationRibbons();
      if (selectedRef.current) {
        validLinks
          .filter((link) => (
            link.source === selectedRef.current || link.target === selectedRef.current
          ))
          .slice(0, 32)
          .forEach((link) => {
            const accent = new THREE.Color(
              nodeById.get(
                link.source === selectedRef.current ? link.target : link.source,
              )?.color ?? "#ffffff",
            ).lerp(new THREE.Color("#ffffff"), 0.36);
            const ribbon = new THREE.Mesh(
              new THREE.TubeGeometry(relationCurve(link), 28, 0.0055, 7, false),
              new THREE.MeshPhysicalMaterial({
                color: accent,
                emissive: accent,
                emissiveIntensity: 0.48,
                roughness: 0.045,
                metalness: 0.08,
                transmission: 0.66,
                thickness: 0.22,
                clearcoat: 1,
                clearcoatRoughness: 0.025,
                transparent: true,
                opacity: 0.38,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
              }),
            );
            ribbon.renderOrder = 2;
            relationRibbons.add(ribbon);
          });
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
    selectNodeRef.current = selectNode;

    const resetView = () => {
      selectedRef.current = null;
      hoveredRef.current = null;
      setSelectedId(null);
      setHoveredId(null);
      setDossierMode("dock");
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
      focusAttributes(selectedRef.current ?? id);
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
      if (id) openNode(id);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dossierModeRef.current === "focus") {
          event.preventDefault();
          event.stopPropagation();
          setDossierMode("dock");
          return;
        }
        resetView();
        return;
      }
      if (event.key === "Enter" && selectedRef.current) {
        openNode(selectedRef.current);
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

      if (searchActive && searchSpheres.visible) {
        nodes.forEach((node, index) => {
          if (searchFlags[index] !== 1) return;
          const pulse = pauseRef.current || reducedMotion
            ? 1
            : 1 + Math.sin(seconds * 1.5 + phases[index]) * 0.055;
          searchMatrix.position.copy(positionById.get(node.id)!);
          searchMatrix.rotation.set(
            seeded(`${node.id}:search-x`) * Math.PI + seconds * 0.04,
            seeded(`${node.id}:search-y`) * Math.PI + seconds * 0.065,
            seeded(`${node.id}:search-z`) * Math.PI,
          );
          searchMatrix.scale.setScalar(searchSphereScale * pulse);
          searchMatrix.updateMatrix();
          searchSpheres.setMatrixAt(index, searchMatrix.matrix);
        });
        searchSpheres.instanceMatrix.needsUpdate = true;
      }

      if (flight) {
        const rawProgress = Math.min(1, (now - flight.startedAt) / flight.duration);
        const progress = easeInOutCubic(rawProgress);
        const thrust = Math.sin(rawProgress * Math.PI);
        camera.position.lerpVectors(flight.fromCamera, flight.toCamera, progress);
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, progress);
        camera.fov = 43 + thrust * 5.5;
        backgroundMaterial.size = 0.027 + thrust * 0.045;
        backgroundMaterial.opacity = 0.48 + thrust * 0.24;
        camera.updateProjectionMatrix();
        if (rawProgress >= 1) {
          camera.fov = 43;
          backgroundMaterial.size = 0.027;
          backgroundMaterial.opacity = 0.48;
          camera.updateProjectionMatrix();
          flight = null;
        }
      }

      if (!pauseRef.current && !reducedMotion && !selectedRef.current) {
        root.rotation.y = Math.sin(seconds * 0.11) * 0.055;
        root.rotation.x = Math.cos(seconds * 0.08) * 0.018;
        background.rotation.y = seconds * 0.004;
        galaxyDust.rotation.z = Math.sin(seconds * 0.07) * 0.025;
      }

      if (focusArtifact.visible) {
        const artifactPulse = pauseRef.current || reducedMotion
          ? 1
          : 1 + Math.sin(seconds * 1.05) * 0.012;
        focusArtifact.scale.setScalar(artifactPulse);
        focusShellMaterial.uniforms.uTime.value =
          pauseRef.current || reducedMotion ? 0 : seconds;
        if (!pauseRef.current && !reducedMotion) {
          focusShell.rotation.y = seconds * 0.11;
          focusShell.rotation.x = Math.sin(seconds * 0.16) * 0.08;
          focusLattice.rotation.y = -seconds * 0.055;
          focusLattice.rotation.z = seconds * 0.032;
          focusCore.rotation.x = seconds * 0.34;
          focusCore.rotation.y = seconds * 0.47;
          focusCage.rotation.x = -seconds * 0.19;
          focusCage.rotation.z = seconds * 0.23;
          focusBloomMaterial.opacity = 0.18 + Math.sin(seconds * 1.4) * 0.045;
        }
      }

      if (!pauseRef.current && pulseLinks.length > 0) {
        pulseLinks.forEach((link, index) => {
          const progress = (seconds * 0.23 + index / Math.max(1, pulseLinks.length)) % 1;
          const position = relationCurve(link).getPoint(progress);
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
      pulseTexture.dispose();
      haloGeometry.dispose();
      renderer.dispose();
      labelLayer.remove();
      canvas.remove();
      resetViewRef.current = () => undefined;
      selectNodeRef.current = () => undefined;
      updateSearchRef.current = () => undefined;
    };
  }, [links, nodeById, nodes, openNode]);

  if (nodes.length === 0) {
    return <div className="space-graph-empty">这个分区暂时没有可绘制的笔记。</div>;
  }

  return (
    <div
      ref={stageRef}
      className="space-graph-stage"
      data-ready={ready ? "true" : "false"}
      data-fullscreen={fullscreen ? "true" : "false"}
      data-selected={selectedNode ? "true" : "false"}
      data-dossier-mode={selectedNode ? dossierMode : "none"}
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
      <div
        className="space-graph-search"
        data-active={normalizedSearchQuery ? "true" : "false"}
      >
        <div className="space-graph-search-field">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchCursor(0);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="搜索标题与全文"
            role="combobox"
            aria-autocomplete="list"
            aria-label="在关系图中搜索标题与全文"
            aria-controls="space-graph-search-results"
            aria-expanded={Boolean(normalizedSearchQuery)}
          />
          {searchQuery ? (
            <button
              type="button"
              aria-label="清空关系图搜索"
              onClick={() => {
                setSearchQuery("");
                setSearchCursor(0);
                searchInputRef.current?.focus();
              }}
            >
              ×
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </div>
        {normalizedSearchQuery && (
          <div
            id="space-graph-search-results"
            className="space-graph-search-results"
          >
            <header>
              <span>FULL TEXT RADAR</span>
              <strong>
                {searchResults.length > 0
                  ? `${searchResults.length} 个节点命中`
                  : "没有匹配的节点"}
              </strong>
            </header>
            {searchResults.length > 0 ? (
              <div role="listbox" aria-label="关系图全文搜索结果">
                {visibleSearchResults.map((node, visibleIndex) => {
                  const resultIndex = searchWindowStart + visibleIndex;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={resultIndex === searchCursor}
                      key={node.id}
                      data-active={resultIndex === searchCursor ? "true" : "false"}
                      style={{ "--search-accent": node.color } as CSSProperties}
                      onMouseEnter={() => setSearchCursor(resultIndex)}
                      onClick={() => selectSearchResult(resultIndex)}
                    >
                      <i aria-hidden="true" />
                      <span>
                        <strong>{node.title}</strong>
                        <small>{node.kindLabel} · {node.groupLabel}</small>
                      </span>
                      <b>{resultIndex + 1}</b>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p>尝试更短的关键词，或搜索正文中的日语、公司名和技术词。</p>
            )}
            <footer>
              <span><kbd>↑</kbd><kbd>↓</kbd> 切换</span>
              <span><kbd>Enter</kbd> 飞向节点</span>
              <span><kbd>Esc</kbd> 清空</span>
            </footer>
          </div>
        )}
      </div>
      {activeNode && !selectedNode && (
        <div
          className="space-graph-node-card space-graph-node-peek"
          style={{ "--node-accent": activeNode.color } as CSSProperties}
          role="status"
        >
          <span>{activeNode.groupLabel}</span>
          <strong>{activeNode.title}</strong>
          <small>{activeNode.degree} 条可见关系</small>
        </div>
      )}
      {selectedNode && (
        <aside
          className="space-graph-dossier"
          data-mode={dossierMode}
          style={{
            "--node-accent": selectedNode.color,
            "--dossier-zoom": dossierZoom,
          } as CSSProperties}
          aria-label={`${selectedNode.title}的节点档案`}
        >
          <i className="space-graph-dossier-scan" aria-hidden="true" />
          <header>
            <div>
              <span>NODE SIGNAL · 已锁定</span>
              <small>{selectedNode.groupLabel}</small>
            </div>
            <div className="space-graph-dossier-actions">
              <button
                type="button"
                aria-label={dossierMode === "focus" ? "将节点档案停靠到右侧" : "居中放大节点档案"}
                onClick={() => setDossierMode((current) => current === "dock" ? "focus" : "dock")}
              >
                {dossierMode === "focus" ? "停靠" : "居中"} <kbd>D</kbd>
              </button>
              <button
                type="button"
                aria-label="缩小节点档案文字"
                onClick={() => changeDossierZoom(-0.1)}
              >
                −
              </button>
              <output aria-label={`节点档案缩放 ${Math.round(dossierZoom * 100)}%`}>
                {Math.round(dossierZoom * 100)}%
              </output>
              <button
                type="button"
                aria-label="放大节点档案文字"
                onClick={() => changeDossierZoom(0.1)}
              >
                +
              </button>
              <button
                type="button"
                aria-label="收起节点档案并返回全景"
                onClick={() => resetViewRef.current()}
              >
                ×
              </button>
            </div>
          </header>
          <div className="space-graph-dossier-body">
            <div className="space-graph-dossier-orbit" aria-hidden="true">
              <i />
              <i />
              <b />
            </div>
            <div className="space-graph-dossier-title">
              <span>{selectedNode.kindLabel}</span>
              <h2>{selectedNode.title}</h2>
            </div>
            <dl>
              <div><dt>连接</dt><dd>{selectedNode.degree}</dd></div>
              <div><dt>外链</dt><dd>{selectedNode.outbound}</dd></div>
              <div><dt>更新</dt><dd>{selectedNode.updatedLabel}</dd></div>
            </dl>
            <div className="space-graph-dossier-copy">
              <span>内容预览 · 可滚动查看全文</span>
              <p>{selectedNode.excerpt || "这篇记忆暂时没有可提取的正文摘要。"}</p>
            </div>
            {selectedNeighbors.length > 0 && (
              <div className="space-graph-dossier-neighbors">
                <span>最近的记忆轨道</span>
                <div>
                  {selectedNeighbors.map((neighbor) => (
                    <button
                      type="button"
                      key={neighbor.id}
                      onClick={() => selectNodeRef.current(neighbor.id)}
                      style={{ "--neighbor-accent": neighbor.color } as CSSProperties}
                    >
                      {neighbor.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <code>{selectedNode.path}</code>
          </div>
          <button
            type="button"
            className="space-graph-enter-memory"
            onClick={() => openNode(selectedNode.id)}
          >
            <span>
              <small>ENTER MEMORY</small>
              展开完整记忆
            </span>
            <b aria-hidden="true">→</b>
          </button>
          <footer>
            <span>双击节点或按 <kbd>Enter</kbd> 也可穿越</span>
            <button type="button" onClick={() => setShortcutHelp(true)}>
              查看快捷键 <kbd>?</kbd>
            </button>
          </footer>
        </aside>
      )}
      {openingNode && (
        <div
          className="space-graph-portal"
          style={{ "--node-accent": openingNode.color } as CSSProperties}
          role="status"
          aria-live="assertive"
        >
          <div className="space-graph-portal-rings" aria-hidden="true">
            <i />
            <i />
            <i />
            <b />
          </div>
          <div>
            <span>MEMORY GATE · SYNCHRONIZING</span>
            <strong>{openingNode.title}</strong>
            <small>正在展开完整记忆</small>
          </div>
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
        <button
          type="button"
          aria-expanded={shortcutHelp}
          onClick={() => setShortcutHelp((current) => !current)}
        >
          快捷键 <kbd>?</kbd>
        </button>
      </div>
      {shortcutHelp && (
        <aside className="space-graph-shortcuts" aria-label="星图快捷键">
          <header>
            <div><span>COMMAND DECK</span><strong>星图快捷键</strong></div>
            <button type="button" onClick={() => setShortcutHelp(false)} aria-label="关闭快捷键">×</button>
          </header>
          <div>
            <span><kbd>/</kbd><b>全文搜索</b></span>
            <span><kbd>F</kbd><b>全屏</b></span>
            <span><kbd>D</kbd><b>档案居中／停靠</b></span>
            <span><kbd>O</kbd><b>打开完整记忆</b></span>
            <span><kbd>＋</kbd><kbd>－</kbd><b>文字缩放</b></span>
            <span><kbd>0</kbd><b>恢复 100%</b></span>
            <span><kbd>←</kbd><kbd>→</kbd><b>切换节点</b></span>
            <span><kbd>P</kbd><b>暂停／继续动态</b></span>
            <span><kbd>R</kbd><b>回到全景</b></span>
          </div>
        </aside>
      )}
      <div className="space-graph-caption">
        <span>单击锁定 · 拖动探索 · 双击穿越</span>
        <strong>{nodes.length} 个节点 · {links.length} 条连接</strong>
      </div>
      <details className="space-graph-index">
        <summary>用列表访问全部节点</summary>
        <div>
          {nodes
            .toSorted((left, right) => right.degree - left.degree)
            .map((node) => (
              <button type="button" key={node.id} onClick={() => openNode(node.id)}>
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
