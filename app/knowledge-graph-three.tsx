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
import {
  GraphHandControls,
  type GraphHandNavigationFrame,
  type GraphHandRelationFeedback,
  type GraphHandTargetFeedback,
  type GraphTrackedHandFrame,
} from "./graph-hand-controls";
import { relationExploration } from "@/lib/graph-relation-exploration.mjs";
import {
  createCometTexture,
  createFlightController,
  createFocusArtifact,
  createLabelLayer,
  createNebulaTexture,
  createStageRenderer,
  createStarfield,
  disposeStage,
  fitDistance,
  NODE_FRAGMENT_SHADER,
  NODE_VERTEX_SHADER,
  projectLabelItems,
  seeded,
  type StageLabelItem,
} from "./three-stage";
import {
  isEditableTarget,
  StageControls,
  StagePortal,
  StageSearchRadar,
  StageShortcuts,
  useStageFullscreen,
  useStagePortal,
  useStageSearch,
} from "./three-stage-chrome";

export type KnowledgeGraphSceneNode = {
  id: string;
  title: string;
  nodeKind: "note" | "company" | "skill";
  group: string;
  groupLabel: string;
  color: string;
  degree: number;
  path: string;
  kindLabel: string;
  updatedLabel: string;
  outbound: number;
  excerpt: string;
  openable: boolean;
};

export type KnowledgeGraphSceneLink = {
  source: string;
  target: string;
  relation: string;
  relationLabel: string;
  directed: boolean;
};

type Props = {
  nodes: KnowledgeGraphSceneNode[];
  links: KnowledgeGraphSceneLink[];
  onOpen: (id: string) => void;
  onFallback: () => void;
};

// 分区中心刻意在 z 轴上错层（关于我最近、系统最深），配合更大的节点纵深抖动，
// 让星图进场即有前后景——早期版本五个分区几乎同深，正对镜头时是一张平面散点图。
const GROUP_CENTERS: Record<string, [number, number, number]> = {
  self: [-3.8, 2.15, 1.9],
  career: [3.8, 2.05, -0.9],
  study: [-3.65, -2.45, 0.7],
  analysis: [3.7, -2.35, -2.1],
  system: [0, 0, -3.4],
};

// 常驻机位带一点右上方的 3/4 侧角：正对 z 轴的机位没有视差，纵深读不出来。
const HOME_DIRECTION = new THREE.Vector3(0.17, 0.14, 1).normalize();
// 首次进场的出发机位方向（另一侧高处），俯冲到常驻机位的运镜由飞行控制器完成。
const ENTRY_DIRECTION = new THREE.Vector3(-0.85, 0.55, 1).normalize();

// 分区不是装饰线，而是承载节点的扁椭球“星域”。菲涅尔外壳与经纬笼格让它
// 只在侧转时显出纵深；不再叠加固定中截面描边，否则椭球会被读成带赤道的蛋壳。
const GROUP_FIELD_VERTEX_SHADER = /* glsl */ `
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewPosition = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const GROUP_FIELD_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 viewDirection = normalize(-vViewPosition);
    float facing = abs(dot(normalize(vViewNormal), viewDirection));
    float fresnel = pow(1.0 - facing, 2.35);
    float alpha = (0.008 + fresnel * 0.105) * uStrength;
    vec3 color = mix(uColor, vec3(1.0), fresnel * 0.16);
    gl_FragColor = vec4(color, alpha);
  }
`;

// 搜索命中很少时，用只有边缘光的薄壳标记空间位置。实体玻璃球在结果多时
// 会叠成肥皂泡墙，因此数量超过阈值后不渲染此壳，只加强原本的星点。
const SEARCH_SHELL_VERTEX_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  void main() {
    vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
    vec4 viewPosition = modelViewMatrix * instancePosition;
    vColor = instanceColor;
    vViewNormal = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
    vViewPosition = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const SEARCH_SHELL_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 viewDirection = normalize(-vViewPosition);
    float facing = abs(dot(normalize(vViewNormal), viewDirection));
    float rim = pow(1.0 - facing, 3.8);
    float alpha = rim * 0.24;
    vec3 color = mix(vColor, vec3(1.0), rim * 0.42);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

// 分区内关系保留为细线；跨区关系在全景只留下极淡的个体痕迹，主要由下方
// 聚合航道表达。锁定节点后 aFocus 会把真实关系重新展开。
const GRAPH_LINK_VERTEX_SHADER = /* glsl */ `
  attribute float aFocus;
  attribute float aBase;
  varying vec3 vColor;
  varying float vFocus;
  varying float vBase;

  void main() {
    vColor = color;
    vFocus = aFocus;
    vBase = aBase;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GRAPH_LINK_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying float vFocus;
  varying float vBase;
  uniform float uSearchActive;

  void main() {
    float baseAlpha = mix(0.022, 0.145, vBase);
    float searchVisibility = mix(1.0, mix(0.16, 1.0, vFocus), uSearchActive);
    float alpha = mix(baseAlpha, 0.88, vFocus) * searchVisibility;
    gl_FragColor = vec4(vColor + vFocus * vec3(0.2), alpha);
  }
`;

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
  const gestureFrameRef = useRef<(frame: GraphHandNavigationFrame | null) => void>(
    () => undefined,
  );
  const updateSearchRef = useRef<(ids: string[], active: boolean) => void>(
    () => undefined,
  );
  const searchRequestRef = useRef<{ ids: string[]; active: boolean }>({
    ids: [],
    active: false,
  });
  const pauseRef = useRef(false);
  const dossierModeRef = useRef<"dock" | "focus">("dock");
  // 开场运镜只在本次会话第一次装载星图时播放；分区筛选会重建场景，不该重播。
  const entryPlayedRef = useRef(false);
  const onFallbackRef = useRef(onFallback);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dossierMode, setDossierMode] = useState<"dock" | "focus">("dock");
  const [dossierZoom, setDossierZoom] = useState(1);
  const [shortcutHelp, setShortcutHelp] = useState(false);
  const [handTargets, setHandTargets] = useState<GraphHandTargetFeedback[]>([]);
  const [handRelation, setHandRelation] = useState<GraphHandRelationFeedback>(null);
  const { fullscreen, toggleFullscreen } = useStageFullscreen(stageRef);

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
  const canOpen = useCallback((id: string) => Boolean(nodeById.get(id)?.openable), [nodeById]);
  const { openingId, openNode } = useStagePortal({ stageRef, onOpen, canOpen });
  const pickSearchResult = useCallback((id: string) => selectNodeRef.current(id), []);
  const searchTiebreak = useCallback(
    (left: KnowledgeGraphSceneNode, right: KnowledgeGraphSceneNode) => right.degree - left.degree,
    [],
  );
  const search = useStageSearch({
    items: nodes,
    inputRef: searchInputRef,
    onPick: pickSearchResult,
    tiebreak: searchTiebreak,
  });
  const activeNode = nodeById.get(selectedId ?? hoveredId ?? "") ?? null;
  const selectedNode = nodeById.get(selectedId ?? "") ?? null;
  const openingNode = nodeById.get(openingId ?? "") ?? null;
  const selectedNeighbors = useMemo(() => {
    if (!selectedId) return [];
    const neighbors = new Map<string, {
      node: KnowledgeGraphSceneNode;
      relationLabel: string;
      direction: "out" | "in" | "both";
    }>();
    links.forEach((link) => {
      const neighborId = link.source === selectedId
        ? link.target
        : link.target === selectedId
          ? link.source
          : "";
      const node = nodeById.get(neighborId);
      if (!node) return;
      const direction = link.directed
        ? link.source === selectedId ? "out" : "in"
        : "both";
      const key = `${neighborId}\u0000${link.relation}`;
      neighbors.set(key, { node, relationLabel: link.relationLabel, direction });
    });
    return [...neighbors.values()]
      .toSorted((left, right) => {
        const byDegree = right.node.degree - left.node.degree;
        return byDegree || left.relationLabel.localeCompare(right.relationLabel, "zh-CN");
      })
      .slice(0, 8);
  }, [links, nodeById, selectedId]);

  const changeDossierZoom = useCallback((amount: number) => {
    setDossierZoom((current) => (
      Math.round(Math.min(1.35, Math.max(0.85, current + amount)) * 100) / 100
    ));
  }, []);

  useEffect(() => {
    const request = {
      ids: search.results.map((node) => node.id),
      active: Boolean(search.normalizedQuery),
    };
    searchRequestRef.current = request;
    updateSearchRef.current(request.ids, request.active);
  }, [search.normalizedQuery, search.results]);

  useEffect(() => {
    const handleDossierShortcut = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host || nodes.length === 0) return;

    setReady(false);
    setHoveredId(null);
    setSelectedId(null);

    const stage = createStageRenderer({
      host,
      antialias: nodes.length < 1200,
      pixelRatioCap: nodes.length > 1200 ? 1.25 : 1.75,
      ariaLabel: `Obsidian 2.5D 记忆星图，共 ${nodes.length} 个节点；单击聚焦，双击打开完整笔记，方向键选择`,
    });
    if (!stage) {
      onFallbackRef.current();
      return;
    }
    const { renderer, canvas } = stage;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x101b17, 0.042);

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
    const baseSizes = new Float32Array(nodes.length);
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
        centerZ + (seeded(`${node.id}:depth`) - 0.5) * 4.2,
      );
      const color = new THREE.Color(node.color);
      positions.set(position.toArray(), index * 3);
      colors.set(color.toArray(), index * 3);
      baseSizes[index] = 0.82 + Math.min(1.08, Math.sqrt(node.degree + 1) * 0.17);
      sizes[index] = baseSizes[index];
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

    const searchSphereGeometry = new THREE.SphereGeometry(1, 28, 18);
    const searchSphereMaterial = new THREE.ShaderMaterial({
      vertexShader: SEARCH_SHELL_VERTEX_SHADER,
      fragmentShader: SEARCH_SHELL_FRAGMENT_SHADER,
      transparent: true,
      side: THREE.BackSide,
      depthTest: false,
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
    let searchSphereScale = 0.15;
    nodes.forEach((node, index) => {
      const position = positionById.get(node.id)!;
      searchMatrix.position.copy(position);
      searchMatrix.scale.setScalar(0.0001);
      searchMatrix.updateMatrix();
      searchSpheres.setMatrixAt(index, searchMatrix.matrix);
      searchSpheres.setColorAt(
        index,
        new THREE.Color(node.color).lerp(new THREE.Color("#ffffff"), 0.12),
      );
    });
    searchSpheres.instanceMatrix.needsUpdate = true;
    if (searchSpheres.instanceColor) searchSpheres.instanceColor.needsUpdate = true;
    root.add(searchSpheres);

    // 常驻少量高连接节点的标签，让星图不再只是一片“看不清是什么”的光点。
    const labelLayer = createLabelLayer(host);
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
      const titleElement = document.createElement("b");
      titleElement.textContent = node.title.length > 22 ? `${node.title.slice(0, 22)}…` : node.title;
      label.appendChild(dot);
      label.appendChild(titleElement);
      labelLayer.appendChild(label);
      return [{ node, position, label }];
    });
    const groupLabelItems = Object.entries(GROUP_CENTERS).flatMap(([group, center]) => {
      const groupNodes = nodes.filter((node) => node.group === group);
      const groupNode = groupNodes[0];
      if (!groupNode) return [];
      const label = document.createElement("span");
      label.className = "space-graph-group-label";
      label.style.setProperty("--label-accent", groupNode.color);
      const title = document.createElement("strong");
      title.textContent = groupNode.groupLabel;
      const count = document.createElement("small");
      count.textContent = `${groupNodes.length} 个节点`;
      label.appendChild(title);
      label.appendChild(count);
      labelLayer.appendChild(label);
      return [{
        group,
        position: new THREE.Vector3(center[0], center[1] + 1.62, center[2] + 0.45),
        label,
      }];
    });
    const stageLabelItems: StageLabelItem[] = [
      ...groupLabelItems.map(({ position, label }) => ({
        position,
        element: label,
        offsetY: -8,
      })),
      ...labelItems.map(
      ({ position, label }) => ({ position, element: label }),
      ),
    ];
    let searchActive = false;
    const applySearchMatches = (ids: string[], active: boolean) => {
      const matches = new Set(ids);
      const showSearchShells = active && matches.size > 0 && matches.size <= 10;
      searchActive = active;
      searchSphereScale = matches.size <= 4 ? 0.19 : matches.size <= 7 ? 0.155 : 0.125;
      nodeMaterial.uniforms.uSearchActive.value = active ? 1 : 0;
      nodes.forEach((node, index) => {
        const matched = matches.has(node.id);
        searchFlags[index] = active && matched ? 1 : 0;
        nodeSearch[index] = matched ? 1 : 0;
        sizes[index] = baseSizes[index] * (active && matched
          ? showSearchShells ? 1.34 : 1.72
          : 1);
        searchMatrix.position.copy(positionById.get(node.id)!);
        searchMatrix.rotation.set(
          seeded(`${node.id}:search-x`) * Math.PI,
          seeded(`${node.id}:search-y`) * Math.PI,
          seeded(`${node.id}:search-z`) * Math.PI,
        );
        searchMatrix.scale.setScalar(
          showSearchShells && matched ? searchSphereScale : 0.0001,
        );
        searchMatrix.updateMatrix();
        searchSpheres.setMatrixAt(index, searchMatrix.matrix);
      });
      searchSpheres.visible = showSearchShells;
      searchSpheres.instanceMatrix.needsUpdate = true;
      (nodeGeometry.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
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
    const linkBase = new Float32Array(validLinks.length * 2);
    const adjacency = new Map<string, Set<string>>();

    validLinks.forEach((link, index) => {
      const source = positionById.get(link.source)!;
      const target = positionById.get(link.target)!;
      const sourceColor = new THREE.Color(nodeById.get(link.source)?.color ?? "#9fb5a8");
      const targetColor = new THREE.Color(nodeById.get(link.target)?.color ?? "#9fb5a8");
      const sameGroup = nodeById.get(link.source)?.group === nodeById.get(link.target)?.group;
      linkPositions.set([...source.toArray(), ...target.toArray()], index * 6);
      linkColors.set([...sourceColor.toArray(), ...targetColor.toArray()], index * 6);
      linkBase[index * 2] = sameGroup ? 1 : 0;
      linkBase[index * 2 + 1] = sameGroup ? 1 : 0;
      if (!adjacency.has(link.source)) adjacency.set(link.source, new Set());
      if (!adjacency.has(link.target)) adjacency.set(link.target, new Set());
      adjacency.get(link.source)!.add(link.target);
      adjacency.get(link.target)!.add(link.source);
    });

    const linkGeometry = new THREE.BufferGeometry();
    linkGeometry.setAttribute("position", new THREE.BufferAttribute(linkPositions, 3));
    linkGeometry.setAttribute("color", new THREE.BufferAttribute(linkColors, 3));
    linkGeometry.setAttribute("aFocus", new THREE.BufferAttribute(linkFocus, 1));
    linkGeometry.setAttribute("aBase", new THREE.BufferAttribute(linkBase, 1));
    const linkMaterial = new THREE.ShaderMaterial({
      vertexShader: GRAPH_LINK_VERTEX_SHADER,
      fragmentShader: GRAPH_LINK_FRAGMENT_SHADER,
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

    // 全景只画每对星域之间的一条聚合航道。关系数量通过粗细和亮度表达，
    // 避免数百条跨区边叠成“光墙”；节点聚焦时仍会展开真实边。
    const channelPairs = new Map<string, {
      left: string;
      right: string;
      count: number;
    }>();
    validLinks.forEach((link) => {
      const sourceGroup = nodeById.get(link.source)?.group;
      const targetGroup = nodeById.get(link.target)?.group;
      if (!sourceGroup || !targetGroup || sourceGroup === targetGroup) return;
      const [left, right] = [sourceGroup, targetGroup].toSorted();
      const key = `${left}\u0000${right}`;
      const pair = channelPairs.get(key) ?? { left, right, count: 0 };
      pair.count += 1;
      channelPairs.set(key, pair);
    });
    const channelGroup = new THREE.Group();
    const channelItems: Array<{
      groups: [string, string];
      material: THREE.MeshBasicMaterial;
      baseOpacity: number;
    }> = [];
    const maxChannelCount = Math.max(1, ...[...channelPairs.values()].map((pair) => pair.count));
    channelPairs.forEach(({ left, right, count }) => {
      const leftCenter = new THREE.Vector3(...GROUP_CENTERS[left]);
      const rightCenter = new THREE.Vector3(...GROUP_CENTERS[right]);
      const midpoint = leftCenter.clone().lerp(rightCenter, 0.5);
      const direction = rightCenter.clone().sub(leftCenter);
      const normal = new THREE.Vector3(-direction.y, direction.x, 0).normalize();
      midpoint.addScaledVector(normal, 0.22 + seeded(`${left}:${right}:channel`) * 0.26);
      midpoint.z += 0.38 + seeded(`${left}:${right}:channel-z`) * 0.34;
      const curve = new THREE.QuadraticBezierCurve3(leftCenter, midpoint, rightCenter);
      const weight = Math.log1p(count) / Math.log1p(maxChannelCount);
      const leftColor = new THREE.Color(nodes.find((node) => node.group === left)?.color ?? "#9fb5a8");
      const rightColor = new THREE.Color(nodes.find((node) => node.group === right)?.color ?? "#9fb5a8");
      const color = leftColor.lerp(rightColor, 0.5).lerp(new THREE.Color("#ffffff"), 0.08);
      const baseOpacity = 0.1 + weight * 0.16;
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: baseOpacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const channel = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 32, 0.006 + weight * 0.009, 6, false),
        material,
      );
      channel.renderOrder = 2;
      channelGroup.add(channel);
      channelItems.push({ groups: [left, right], material, baseOpacity });
    });
    root.add(channelGroup);

    const relationRibbons = new THREE.Group();
    relationRibbons.renderOrder = 2;
    root.add(relationRibbons);

    const pulseLimit = Math.max(1, Math.min(80, validLinks.length));
    const pulsePositions = new Float32Array(pulseLimit * 3);
    const pulseColors = new Float32Array(pulseLimit * 3);
    const pulseGeometry = new THREE.BufferGeometry();
    pulseGeometry.setAttribute("position", new THREE.BufferAttribute(pulsePositions, 3));
    pulseGeometry.setAttribute("color", new THREE.BufferAttribute(pulseColors, 3));
    const pulseTexture = createCometTexture();
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

    const groupFieldGeometry = new THREE.SphereGeometry(1, 56, 28);
    const groupCageGeometry = new THREE.SphereGeometry(1, 18, 10);
    const groupVisuals = new Map<string, {
      fieldMaterial: THREE.ShaderMaterial;
      cageMaterial: THREE.MeshBasicMaterial;
      baseStrength: number;
      baseCageOpacity: number;
    }>();
    const groupHitTargets: THREE.Mesh[] = [];
    Object.entries(GROUP_CENTERS).forEach(([group, center]) => {
      const groupNode = nodes.find((node) => node.group === group);
      if (!groupNode) return;
      const baseStrength = group === "system" ? 0.72 : 1;
      const baseCageOpacity = group === "system" ? 0.009 : 0.017;

      const fieldMaterial = new THREE.ShaderMaterial({
        vertexShader: GROUP_FIELD_VERTEX_SHADER,
        fragmentShader: GROUP_FIELD_FRAGMENT_SHADER,
        uniforms: {
          uColor: { value: new THREE.Color(groupNode.color) },
          uStrength: { value: baseStrength },
        },
        transparent: true,
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const field = new THREE.Mesh(groupFieldGeometry, fieldMaterial);
      field.position.set(...center);
      field.scale.set(3.12, 1.94, 2.3);
      field.renderOrder = -1;
      root.add(field);

      const cageMaterial = new THREE.MeshBasicMaterial({
        color: groupNode.color,
        transparent: true,
        opacity: baseCageOpacity,
        wireframe: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const cage = new THREE.Mesh(groupCageGeometry, cageMaterial);
      cage.position.set(...center);
      cage.scale.copy(field.scale);
      cage.rotation.z = seeded(`${group}:cage`) * 0.16 - 0.08;
      cage.renderOrder = 0;
      root.add(cage);

      const hitTarget = new THREE.Mesh(
        groupFieldGeometry,
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
          colorWrite: false,
        }),
      );
      hitTarget.position.set(...center);
      hitTarget.scale.copy(field.scale);
      hitTarget.userData.group = group;
      root.add(hitTarget);
      groupHitTargets.push(hitTarget);
      groupVisuals.set(group, {
        fieldMaterial,
        cageMaterial,
        baseStrength,
        baseCageOpacity,
      });
    });

    const nebulaTexture = createNebulaTexture();
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
        center[2] - 0.45 + (seeded(`dust:${index}:depth`) - 0.5) * 2.8,
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

    const focusArtifact = createFocusArtifact(pulseTexture);
    root.add(focusArtifact.group);

    // 手伸进星图时的“实体接触点”。屏幕准星负责告诉用户手在哪里，这组 Three
    // 几何则真正钉在星图坐标上：抓取后相机移动，光环仍和被抓住的节点/空间一起走。
    type GestureVisual = {
      anchor: THREE.Group;
      outer: THREE.Mesh;
      inner: THREE.Mesh;
      ray: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;
      grabbed: boolean;
    };
    const createGestureVisual = (color: number): GestureVisual => {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.82,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const coreMaterial = material.clone();
      coreMaterial.opacity = 0.94;
      const anchor = new THREE.Group();
      const outer = new THREE.Mesh(
        new THREE.TorusGeometry(0.24, 0.012, 8, 48),
        material,
      );
      const inner = new THREE.Mesh(
        new THREE.TorusGeometry(0.13, 0.008, 8, 36),
        material.clone(),
      );
      inner.rotation.x = Math.PI * 0.34;
      anchor.add(
        outer,
        inner,
        new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), coreMaterial),
      );
      anchor.visible = false;
      anchor.renderOrder = 12;
      root.add(anchor);

      // 每只手都拥有独立射线；角色换手时只交换颜色语义，不依赖 MediaPipe 数组顺序。
      const rayMaterial = new THREE.LineDashedMaterial({
        color,
        transparent: true,
        opacity: 0.52,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        dashSize: 0.12,
        gapSize: 0.08,
      });
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        rayMaterial,
      );
      ray.visible = false;
      ray.renderOrder = 11;
      scene.add(ray);
      return { anchor, outer, inner, ray, grabbed: false };
    };
    const gestureVisuals: Record<"primary" | "secondary", GestureVisual> = {
      primary: createGestureVisual(0x83f2c5),
      secondary: createGestureVisual(0x76d9ff),
    };

    const starfield = createStarfield();
    scene.add(starfield.points);

    nodeGeometry.computeBoundingBox();
    const bounds = nodeGeometry.boundingBox ?? new THREE.Box3(
      new THREE.Vector3(-5, -4, -1),
      new THREE.Vector3(5, 4, 1),
    );
    const homeTarget = bounds.getCenter(new THREE.Vector3());
    const boundsSize = bounds.getSize(new THREE.Vector3());
    const fitHomeDistance = (aspect: number) => fitDistance({
      fovDeg: camera.fov,
      aspect,
      size: boundsSize,
    });
    let homeCamera = homeTarget.clone().add(
      HOME_DIRECTION.clone().multiplyScalar(fitHomeDistance(camera.aspect)),
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
    const selectedGroupRef = { current: null as string | null };
    const hoveredGroupRef = { current: null as string | null };
    let pointerStart: [number, number] | null = null;
    let keyboardIndex = 0;
    let visible = true;
    const previousHands = new Map<string, GraphTrackedHandFrame>();
    let gestureGrabbed = false;
    let gestureFocusActive = false;
    let gestureTargetId: string | null = null;
    const pinchTargets = new Map<string, {
      id: string | null;
      worldPosition: THREE.Vector3;
    }>();
    let publishedHandTargets = "";
    const gestureInertia = new THREE.Vector3();
    let dualTransformActive = false;
    let dualAnchorWorld: THREE.Vector3 | null = null;
    let relationCandidate: { id: string; since: number } | null = null;
    let relationTargetId: string | null = null;
    let relationTargetLocked = false;
    let activeRelationKey = "";

    const flightController = createFlightController({
      camera,
      target: controls.target,
      warp: {
        material: starfield.material,
        baseSize: 0.027,
        baseOpacity: 0.48,
      },
    });

    // 首次进场的开场运镜：从另一侧高处俯冲到常驻机位，让视差在第一秒
    // 就把星图的纵深立起来。分区筛选导致的场景重建不重复播放，减弱动态时跳过。
    if (!entryPlayedRef.current) {
      entryPlayedRef.current = true;
      if (!reducedMotion) {
        camera.position.copy(
          homeTarget.clone().add(
            ENTRY_DIRECTION.clone().multiplyScalar(fitHomeDistance(camera.aspect) * 1.42),
          ),
        );
        controls.update();
        flightController.start(homeCamera.clone(), homeTarget.clone(), 1650);
      }
    }

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

    const emphasizeGroup = (group: string | null, locked: boolean) => {
      groupVisuals.forEach((visual, candidate) => {
        const active = candidate === group;
        const dimmed = Boolean(group) && !active;
        visual.fieldMaterial.uniforms.uStrength.value = visual.baseStrength * (
          active ? locked ? 1.65 : 1.4 : dimmed ? 0.48 : 1
        );
        visual.cageMaterial.opacity = visual.baseCageOpacity * (
          active ? locked ? 2.4 : 2 : dimmed ? 0.38 : 1
        );
      });
      groupLabelItems.forEach((item) => {
        item.label.dataset.active = item.group === group
          ? locked ? "selected" : "hovered"
          : group ? "dim" : "";
      });
      channelItems.forEach((channel) => {
        const involved = Boolean(group) && channel.groups.includes(group!);
        channel.material.opacity = group
          ? channel.baseOpacity * (involved ? locked ? 1.85 : 1.55 : 0.24)
          : channel.baseOpacity;
      });
    };

    const focusAttributes = (id: string | null, group: string | null = null) => {
      const lockedNode = Boolean(id && selectedRef.current === id);
      const neighbors = id ? adjacency.get(id) ?? new Set<string>() : new Set<string>();
      nodes.forEach((node, index) => {
        nodeFocus[index] = node.id === id
          ? 0.3
          : neighbors.has(node.id)
            ? 0.42
            : group && node.group === group ? 0.16 : 0;
      });
      (nodeGeometry.getAttribute("aFocus") as THREE.BufferAttribute).needsUpdate = true;

      validLinks.forEach((link, index) => {
        const sourceGroup = nodeById.get(link.source)?.group;
        const targetGroup = nodeById.get(link.target)?.group;
        const sameGroup = sourceGroup === targetGroup;
        const touchesNode = id && (link.source === id || link.target === id);
        const belongsToGroup = group && sameGroup && sourceGroup === group;
        const active = touchesNode && lockedNode
          ? 1
          : touchesNode && sameGroup
            ? 0.18
            : belongsToGroup ? 0.2 : 0;
        linkFocus[index * 2] = active;
        linkFocus[index * 2 + 1] = active;
      });
      (linkGeometry.getAttribute("aFocus") as THREE.BufferAttribute).needsUpdate = true;

      pulseLinks = id
        ? validLinks
            .filter((link) => link.source === id || link.target === id)
            .filter((_, index) => lockedNode || index % 3 === 0)
            .slice(0, pulseLimit)
        : group
          ? validLinks
              .filter((link) => (
                nodeById.get(link.source)?.group === group ||
                nodeById.get(link.target)?.group === group
              ))
              .filter((_, index) => index % 3 === 0)
              .slice(0, pulseLimit)
          : ambientPulseLinks;
      pulseGeometry.setDrawRange(0, pulseLinks.length);
      channelGroup.visible = !lockedNode;

      const lockedId = selectedRef.current;
      const focusPosition = lockedId ? positionById.get(lockedId) : undefined;
      focusArtifact.setVisible(Boolean(focusPosition));
      if (focusPosition && lockedId) {
        const activeGraphNode = nodeById.get(lockedId);
        const accent = activeGraphNode?.color ?? "#ffffff";
        const artifactAccent = activeGraphNode?.group === "system"
          ? "#48c5a6"
          : accent;
        focusArtifact.setPosition(focusPosition);
        focusArtifact.setAccent(artifactAccent);
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
      const activeGroup = id ? nodeById.get(id)?.group ?? null : group;
      emphasizeGroup(
        activeGroup,
        Boolean(id ? selectedRef.current === id : group && selectedGroupRef.current === group),
      );
    };

    const showRelationExploration = (sourceId: string, targetId: string, locked: boolean) => {
      const relation = relationExploration(nodes, validLinks, sourceId, targetId, 6);
      const relationKey = `${sourceId}\u0000${targetId}\u0000${locked ? "1" : "0"}`;
      if (relationKey === activeRelationKey) return;
      activeRelationKey = relationKey;
      const pathIds = new Set(relation.pathIds);
      const commonIds = new Set(relation.commonNeighborIds);
      const pathLinks = new Set(relation.pathLinks);
      nodes.forEach((node, index) => {
        nodeFocus[index] = node.id === sourceId || node.id === targetId
          ? 0.72
          : pathIds.has(node.id) ? 0.54 : commonIds.has(node.id) ? 0.3 : 0;
      });
      (nodeGeometry.getAttribute("aFocus") as THREE.BufferAttribute).needsUpdate = true;
      validLinks.forEach((link, index) => {
        const active = pathLinks.has(link) ? 1 : 0;
        linkFocus[index * 2] = active;
        linkFocus[index * 2 + 1] = active;
      });
      (linkGeometry.getAttribute("aFocus") as THREE.BufferAttribute).needsUpdate = true;
      pulseLinks = relation.pathLinks.slice(0, pulseLimit);
      pulseGeometry.setDrawRange(0, pulseLinks.length);
      channelGroup.visible = false;
      clearRelationRibbons();
      relation.pathLinks.forEach((link) => {
        const accent = new THREE.Color(nodeById.get(link.target)?.color ?? "#76d9ff")
          .lerp(new THREE.Color("#ffffff"), 0.26);
        const ribbon = new THREE.Mesh(
          new THREE.TubeGeometry(relationCurve(link), 36, locked ? 0.015 : 0.01, 7, false),
          new THREE.MeshBasicMaterial({
            color: accent,
            transparent: true,
            opacity: locked ? 0.82 : 0.58,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        ribbon.renderOrder = 3;
        relationRibbons.add(ribbon);
      });
      labelItems.forEach(({ node, label }) => {
        label.dataset.active = node.id === sourceId || node.id === targetId
          ? "selected"
          : pathIds.has(node.id) || commonIds.has(node.id) ? "neighbor" : "";
      });
      emphasizeGroup(null, false);
      const pathLabels = relation.pathLinks.map((link, index) => {
        const from = relation.pathIds[index];
        const forward = link.source === from;
        const arrow = link.directed ? forward ? "→" : "←" : "↔";
        return `${arrow} ${link.relationLabel || link.relation || "关联"}`;
      });
      setHandRelation({
        sourceLabel: nodeById.get(sourceId)?.title ?? sourceId,
        targetLabel: nodeById.get(targetId)?.title ?? targetId,
        connected: relation.connected,
        pathLength: relation.pathLinks.length,
        commonCount: relation.commonNeighborIds.length,
        pathLabels,
        locked,
      });
    };

    const clearRelationExploration = (restore = true) => {
      if (!activeRelationKey && !relationTargetId) return;
      activeRelationKey = "";
      relationCandidate = null;
      relationTargetId = null;
      relationTargetLocked = false;
      setHandRelation(null);
      if (restore) {
        focusAttributes(
          selectedRef.current,
          selectedRef.current
            ? nodeById.get(selectedRef.current)?.group ?? null
            : selectedGroupRef.current,
        );
      }
    };

    const selectNode = (id: string) => {
      const index = indexById.get(id);
      const localPosition = positionById.get(id);
      if (index === undefined || !localPosition) return;
      keyboardIndex = index;
      selectedRef.current = id;
      selectedGroupRef.current = null;
      clearRelationExploration(false);
      setSelectedId(id);
      focusAttributes(id, nodeById.get(id)?.group ?? null);
      const worldPosition = nodePoints.localToWorld(localPosition.clone());
      flightController.start(
        worldPosition.clone().add(new THREE.Vector3(0, 0.12, 5.1)),
        worldPosition,
      );
    };
    selectNodeRef.current = selectNode;

    const selectGroup = (group: string) => {
      const centerTuple = GROUP_CENTERS[group];
      if (!centerTuple) return;
      const center = root.localToWorld(new THREE.Vector3(...centerTuple));
      const direction = camera.position.clone().sub(controls.target).normalize();
      selectedRef.current = null;
      selectedGroupRef.current = group;
      clearRelationExploration(false);
      setSelectedId(null);
      setHoveredId(null);
      focusAttributes(null, group);
      flightController.start(
        center.clone().add(direction.multiplyScalar(13.2)),
        center,
        850,
      );
    };

    const resetView = () => {
      selectedRef.current = null;
      hoveredRef.current = null;
      selectedGroupRef.current = null;
      hoveredGroupRef.current = null;
      clearRelationExploration(false);
      setSelectedId(null);
      setHoveredId(null);
      setDossierMode("dock");
      focusAttributes(null);
      flightController.start(homeCamera.clone(), homeTarget.clone(), 900);
    };
    resetViewRef.current = resetView;

    const setRayFromNormalized = (x: number, y: number) => {
      pointer.set(x * 2 - 1, -(y * 2 - 1));
      raycaster.setFromCamera(pointer, camera);
    };
    const setRayFromEvent = (event: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      setRayFromNormalized(
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height,
      );
    };
    const hitTest = (event: PointerEvent | MouseEvent) => {
      setRayFromEvent(event);
      const hit = raycaster.intersectObject(nodePoints, false)[0];
      return hit?.index === undefined ? null : nodes[hit.index]?.id ?? null;
    };
    const hitTestGroup = (event: PointerEvent | MouseEvent) => {
      setRayFromEvent(event);
      const hit = raycaster.intersectObjects(groupHitTargets, false)[0];
      return typeof hit?.object.userData.group === "string"
        ? hit.object.userData.group as string
        : null;
    };

    const gestureHitTest = (x: number, y: number) => {
      setRayFromNormalized(x, y);
      // 手掌射线比鼠标命中区更宽，靠近节点就自动吸附，远距离操作不要求像素级稳定。
      raycaster.params.Points!.threshold = 0.58;
      const hit = raycaster.intersectObject(nodePoints, false)[0];
      raycaster.params.Points!.threshold = 0.27;
      const id = hit?.index === undefined ? null : nodes[hit.index]?.id ?? null;
      if (id) {
        const localPosition = positionById.get(id);
        if (localPosition) {
          return {
            id,
            worldPosition: nodePoints.localToWorld(localPosition.clone()),
          };
        }
      }

      // 没碰到星点也要能“抓空气”：以当前 Orbit target 所在的视平面求交，
      // 让锚点落在用户正在观察的那一层，而不是跳到任意固定 z。
      const viewNormal = camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        viewNormal,
        controls.target,
      );
      const worldPosition = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      return worldPosition ? { id: null, worldPosition } : null;
    };

    const publishHandTargets = (
      hands: GraphTrackedHandFrame[],
      hits: Map<string, { id: string | null; worldPosition: THREE.Vector3 }>,
    ) => {
      const targets = hands.filter((hand) => hand.visible).map((hand) => {
        const id = hits.get(hand.id)?.id ?? null;
        const node = id ? nodeById.get(id) : null;
        return node
          ? { handId: hand.id, id: node.id, label: node.title, color: node.color, kind: "node" as const }
          : {
              handId: hand.id,
              id: null,
              label: "空间",
              color: hand.role === "primary" ? "#83f2c5" : "#76d9ff",
              kind: "space" as const,
            };
      }).toSorted((left, right) => left.handId.localeCompare(right.handId));
      const key = targets.map((target) => `${target.handId}:${target.id ?? "space"}`).join("|");
      if (key === publishedHandTargets) return;
      publishedHandTargets = key;
      setHandTargets(targets);
    };
    const clearHandTargets = () => {
      if (publishedHandTargets === "") return;
      publishedHandTargets = "";
      setHandTargets([]);
    };

    const restoreGestureFocus = () => {
      if (!gestureFocusActive) return;
      gestureFocusActive = false;
      focusAttributes(
        selectedRef.current,
        selectedRef.current
          ? nodeById.get(selectedRef.current)?.group ?? null
          : selectedGroupRef.current,
      );
    };

    const showGestureAnchor = (
      hand: GraphTrackedHandFrame,
      worldPosition: THREE.Vector3,
      id: string | null,
    ) => {
      const visual = gestureVisuals[hand.role];
      visual.grabbed = hand.grabbed;
      visual.anchor.position.copy(root.worldToLocal(worldPosition.clone()));
      const accent = new THREE.Color(
        hand.grabbed
          ? "#ff9563"
          : id
            ? nodeById.get(id)?.color ?? "#83f2c5"
            : hand.role === "primary" ? "#83f2c5" : "#76d9ff",
      );
      visual.anchor.children.forEach((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshBasicMaterial) material.color.copy(accent);
        });
      });
      visual.anchor.scale.setScalar(hand.grabbed ? 1.18 : 0.86);
      visual.anchor.visible = true;
    };

    const showGestureContact = (
      hand: GraphTrackedHandFrame,
      worldPosition: THREE.Vector3,
      id: string | null,
    ) => {
      const visual = gestureVisuals[hand.role];
      showGestureAnchor(hand, worldPosition, id);
      setRayFromNormalized(hand.pointerX, hand.pointerY);
      const start = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 0.72);
      const positions = visual.ray.geometry.getAttribute("position") as THREE.BufferAttribute;
      positions.setXYZ(0, start.x, start.y, start.z);
      positions.setXYZ(1, worldPosition.x, worldPosition.y, worldPosition.z);
      positions.needsUpdate = true;
      visual.ray.computeLineDistances();
      visual.ray.visible = true;
      const color = hand.grabbed
        ? "#ff9563"
        : id
          ? nodeById.get(id)?.color ?? "#83f2c5"
          : hand.role === "primary" ? "#83f2c5" : "#76d9ff";
      visual.ray.material.color.set(color);
      visual.ray.material.opacity = hand.grabbed ? 0.9 : hand.pinching ? 0.72 : 0.42;
      visual.ray.material.dashSize = hand.grabbed ? 100 : 0.12 + hand.pinchProgress * 0.5;
      visual.ray.material.gapSize = hand.grabbed ? 0.001 : 0.08 - hand.pinchProgress * 0.055;
    };

    const hideGestureAnchors = () => {
      Object.values(gestureVisuals).forEach((visual) => {
        visual.anchor.visible = false;
        visual.ray.visible = false;
        visual.grabbed = false;
      });
    };

    const runGestureAction = (
      action: GraphHandNavigationFrame["action"],
      aimedId: string | null,
    ) => {
      if (!action) return;
      if (action.type === "select-target") {
        if (aimedId) selectNode(aimedId);
        return;
      }
      if (action.type === "toggle-relation-target") {
        const sourceId = selectedRef.current;
        if (!sourceId || !aimedId || aimedId === sourceId) return;
        if (relationTargetLocked && relationTargetId === aimedId) {
          clearRelationExploration();
        } else {
          relationTargetId = aimedId;
          relationTargetLocked = true;
          showRelationExploration(sourceId, aimedId, true);
        }
        return;
      }
      if (action.type === "reset-view") {
        resetView();
        return;
      }
      if (action.type === "focus-neighbors") {
        const targetId = selectedRef.current ?? aimedId;
        if (targetId) focusAttributes(targetId, nodeById.get(targetId)?.group ?? null);
        return;
      }
      if (action.type === "open-selected") {
        const targetId = selectedRef.current ?? aimedId;
        if (targetId) {
          selectNode(targetId);
          openNode(targetId);
        }
        return;
      }
      if (action.type === "toggle-pause") {
        setPaused((current) => !current);
        return;
      }
      const currentIndex = selectedRef.current
        ? indexById.get(selectedRef.current) ?? keyboardIndex
        : keyboardIndex;
      const direction = action.type === "select-next" ? 1 : -1;
      keyboardIndex = (currentIndex + direction + nodes.length) % nodes.length;
      selectNode(nodes[keyboardIndex].id);
    };

    // 单手仍沿用“瞄准—短捏—长捏”；双手变换有更高优先级，进入时取消
    // 未提交的单手运动，并以选中节点或双手中点所在空间作为稳定锚点。
    gestureFrameRef.current = (frame) => {
      if (!frame) {
        previousHands.clear();
        gestureGrabbed = false;
        gestureTargetId = null;
        pinchTargets.clear();
        dualTransformActive = false;
        dualAnchorWorld = null;
        controls.enabled = true;
        hideGestureAnchors();
        hoveredRef.current = null;
        setHoveredId(null);
        clearHandTargets();
        clearRelationExploration();
        restoreGestureFocus();
        return;
      }

      hideGestureAnchors();
      const hits = new Map<string, { id: string | null; worldPosition: THREE.Vector3 }>();
      const releasedPinchTargets = new Map<string, {
        id: string | null;
        worldPosition: THREE.Vector3;
      }>();
      frame.hands.filter((hand) => hand.visible).forEach((hand) => {
        const hit = gestureHitTest(hand.pointerX, hand.pointerY);
        if (!hit) return;
        hits.set(hand.id, hit);
        showGestureContact(hand, hit.worldPosition, hit.id);
        const previous = previousHands.get(hand.id);
        if (hand.pinching && !previous?.pinching) {
          pinchTargets.set(hand.id, { id: hit.id, worldPosition: hit.worldPosition.clone() });
        }
        if (!hand.pinching && previous?.pinching) {
          const lockedTarget = pinchTargets.get(hand.id);
          if (lockedTarget) releasedPinchTargets.set(hand.id, lockedTarget);
          pinchTargets.delete(hand.id);
        }
      });
      publishHandTargets(frame.hands, hits);
      const actionHit = frame.action
        ? releasedPinchTargets.get(frame.action.handId)
          ?? pinchTargets.get(frame.action.handId)
          ?? hits.get(frame.action.handId)
        : null;
      runGestureAction(frame.action, actionHit?.id ?? null);

      if (frame.mode === "calibration" || frame.mode === "palm-menu") {
        gestureGrabbed = false;
        controls.enabled = true;
        frame.hands.forEach((hand) => previousHands.set(hand.id, hand));
        return;
      }

      if (frame.mode === "dual-transform" && frame.transform) {
        controls.enabled = false;
        gestureGrabbed = true;
        if (!dualTransformActive) {
          flightController.cancel();
          gestureInertia.set(0, 0, 0);
          const selectedPosition = selectedRef.current
            ? positionById.get(selectedRef.current)
            : null;
          dualAnchorWorld = selectedPosition
            ? nodePoints.localToWorld(selectedPosition.clone())
            : gestureHitTest(frame.transform.centerX, frame.transform.centerY)?.worldPosition ?? controls.target.clone();
          dualTransformActive = true;
        }
        camera.updateMatrixWorld();
        const offset = camera.position.clone().sub(controls.target);
        const distance = offset.length();
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
        const translation = right.multiplyScalar(-frame.transform.dx * distance * 1.35)
          .add(up.multiplyScalar(frame.transform.dy * distance * 1.35));
        camera.position.add(translation);
        controls.target.add(translation);
        gestureInertia.copy(translation).multiplyScalar(0.14);
        const anchor = dualAnchorWorld ?? controls.target;
        const unclampedFactor = 1 / frame.transform.scaleRatio;
        const nextDistance = THREE.MathUtils.clamp(
          camera.position.distanceTo(controls.target) * unclampedFactor,
          controls.minDistance,
          controls.maxDistance,
        );
        const zoomFactor = nextDistance / Math.max(0.001, camera.position.distanceTo(controls.target));
        camera.position.copy(anchor).add(camera.position.clone().sub(anchor).multiplyScalar(zoomFactor));
        controls.target.copy(anchor).add(controls.target.clone().sub(anchor).multiplyScalar(zoomFactor));
        if (frame.transform.rotationDelta !== 0) {
          const yaw = -frame.transform.rotationDelta * 1.4;
          const worldUp = new THREE.Vector3(0, 1, 0);
          camera.position.copy(anchor).add(
            camera.position.clone().sub(anchor).applyAxisAngle(worldUp, yaw),
          );
          controls.target.copy(anchor).add(
            controls.target.clone().sub(anchor).applyAxisAngle(worldUp, yaw),
          );
        }
        camera.updateMatrixWorld();
        frame.hands.forEach((hand) => previousHands.set(hand.id, hand));
        return;
      }

      if (dualTransformActive) {
        dualTransformActive = false;
        dualAnchorWorld = null;
        frame.hands.forEach((hand) => previousHands.set(hand.id, hand));
      }

      gestureGrabbed = false;
      controls.enabled = true;
      const primary = frame.hands.find((hand) => hand.id === frame.primaryHandId)
        ?? frame.hands.find((hand) => hand.role === "primary");
      const previousPrimary = primary ? previousHands.get(primary.id) : null;
      const primaryHit = primary ? hits.get(primary.id) ?? null : null;
      const pinchTarget = primary ? pinchTargets.get(primary.id) ?? null : null;
      const displayTarget = primary?.pinching && pinchTarget ? pinchTarget : primaryHit;
      if (primary?.grabbed) {
        controls.enabled = false;
        gestureGrabbed = true;
        if (!previousPrimary?.grabbed) {
          flightController.cancel();
          gestureInertia.set(0, 0, 0);
        }
        if (displayTarget) showGestureContact(primary, displayTarget.worldPosition, displayTarget.id);
        if (previousPrimary?.grabbed) {
          const deadZone = (value: number, threshold: number, limit: number) => (
            Math.abs(value) < threshold ? 0 : THREE.MathUtils.clamp(value, -limit, limit)
          );
          const dx = deadZone(primary.x - previousPrimary.x, 0.0035, 0.055);
          const dy = deadZone(primary.y - previousPrimary.y, 0.0035, 0.055);
          const scaleDelta = deadZone(
            Math.log(primary.scale / Math.max(0.001, previousPrimary.scale)),
            0.007,
            0.09,
          );
          camera.updateMatrixWorld();
          const offset = camera.position.clone().sub(controls.target);
          const distance = offset.length();
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
          const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
          const translation = right.multiplyScalar(-dx * distance * 1.3)
            .add(up.multiplyScalar(dy * distance * 1.3));
          camera.position.add(translation);
          controls.target.add(translation);
          gestureInertia.copy(translation).multiplyScalar(0.16);
          if (scaleDelta !== 0) {
            const nextDistance = THREE.MathUtils.clamp(
              distance * Math.exp(-scaleDelta * 3.4),
              controls.minDistance,
              controls.maxDistance,
            );
            const zoomFactor = nextDistance / distance;
            const anchor = pinchTarget?.worldPosition ?? controls.target;
            camera.position.copy(anchor).add(
              camera.position.clone().sub(anchor).multiplyScalar(zoomFactor),
            );
            controls.target.copy(anchor).add(
              controls.target.clone().sub(anchor).multiplyScalar(zoomFactor),
            );
          }
          camera.updateMatrixWorld();
        }
      }

      if (displayTarget) {
        if (primary) showGestureContact(primary, displayTarget.worldPosition, displayTarget.id);
        if (displayTarget.id !== gestureTargetId) {
          gestureTargetId = displayTarget.id;
          hoveredRef.current = displayTarget.id;
          setHoveredId(displayTarget.id);
          if (displayTarget.id && !selectedRef.current) {
            gestureFocusActive = true;
            focusAttributes(
              displayTarget.id,
              nodeById.get(displayTarget.id)?.group ?? null,
            );
          } else if (!displayTarget.id) {
            restoreGestureFocus();
          }
        }
      }

      const secondary = frame.hands.find((hand) => hand.role === "secondary" && hand.visible);
      const secondaryId = secondary ? hits.get(secondary.id)?.id ?? null : null;
      const sourceId = selectedRef.current;
      if (sourceId && relationTargetLocked && relationTargetId) {
        showRelationExploration(sourceId, relationTargetId, true);
      } else if (sourceId && secondaryId && secondaryId !== sourceId) {
        const now = performance.now();
        if (relationCandidate?.id !== secondaryId) {
          if (relationTargetId) clearRelationExploration();
          relationCandidate = { id: secondaryId, since: now };
        } else if (now - relationCandidate.since >= 180) {
          relationTargetId = secondaryId;
          showRelationExploration(sourceId, secondaryId, false);
        }
      } else if (!relationTargetLocked) {
        relationCandidate = null;
        if (relationTargetId) clearRelationExploration();
      }
      frame.hands.forEach((hand) => previousHands.set(hand.id, hand));
      [...previousHands.keys()].forEach((id) => {
        if (!frame.hands.some((hand) => hand.id === id)) previousHands.delete(id);
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerStart = [event.clientX, event.clientY];
    };
    const onPointerMove = (event: PointerEvent) => {
      const id = hitTest(event);
      const group = id ? nodeById.get(id)?.group ?? null : hitTestGroup(event);
      canvas.style.cursor = id ? "pointer" : group ? "zoom-in" : "grab";
      if (id === hoveredRef.current && group === hoveredGroupRef.current) return;
      hoveredRef.current = id;
      hoveredGroupRef.current = group;
      setHoveredId(id);
      const lockedId = selectedRef.current;
      const lockedGroup = selectedGroupRef.current;
      focusAttributes(
        lockedId ?? id,
        lockedId ? nodeById.get(lockedId)?.group ?? null : lockedGroup ?? group,
      );
    };
    const onPointerLeave = () => {
      hoveredRef.current = null;
      hoveredGroupRef.current = null;
      setHoveredId(null);
      canvas.style.cursor = "grab";
      focusAttributes(
        selectedRef.current,
        selectedRef.current
          ? nodeById.get(selectedRef.current)?.group ?? null
          : selectedGroupRef.current,
      );
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
      if (id) {
        selectNode(id);
        return;
      }
      const group = hitTestGroup(event);
      if (group) selectGroup(group);
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
        HOME_DIRECTION.clone().multiplyScalar(fitHomeDistance(camera.aspect)),
      );
      if (!selectedRef.current && !selectedGroupRef.current) {
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

      flightController.tick(now);

      // 松手后只保留很轻的一段余势，并快速衰减；它让拖动不是“硬刹车”，
      // 又不会像持续惯性那样破坏精确定位。
      if (!gestureGrabbed && gestureInertia.lengthSq() > 0.0000005) {
        camera.position.add(gestureInertia);
        controls.target.add(gestureInertia);
        gestureInertia.multiplyScalar(0.78);
      } else if (!gestureGrabbed) {
        gestureInertia.set(0, 0, 0);
      }

      if (
        !pauseRef.current &&
        !reducedMotion &&
        !selectedRef.current &&
        !selectedGroupRef.current &&
        !gestureGrabbed
      ) {
        root.rotation.y = Math.sin(seconds * 0.11) * 0.08;
        root.rotation.x = Math.cos(seconds * 0.08) * 0.028;
        starfield.points.rotation.y = seconds * 0.004;
        galaxyDust.rotation.z = Math.sin(seconds * 0.07) * 0.032;
      }

      focusArtifact.tick(seconds, !pauseRef.current && !reducedMotion);

      Object.values(gestureVisuals).forEach((visual) => {
        if (!visual.anchor.visible) return;
        const cameraInRoot = root.worldToLocal(camera.position.clone());
        visual.anchor.lookAt(cameraInRoot);
        visual.outer.rotation.z = seconds * (visual.grabbed ? 1.8 : 0.85);
        visual.inner.rotation.z = -seconds * (visual.grabbed ? 2.4 : 1.15);
        const pulse = 1 + Math.sin(seconds * (visual.grabbed ? 7 : 4)) * 0.075;
        visual.anchor.scale.setScalar((visual.grabbed ? 1.18 : 0.86) * pulse);
      });

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
      projectLabelItems(stageLabelItems, nodePoints, camera, host);
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
      disposeStage(scene);
      nebulaTexture.dispose();
      pulseTexture.dispose();
      groupFieldGeometry.dispose();
      groupCageGeometry.dispose();
      renderer.dispose();
      labelLayer.remove();
      canvas.remove();
      resetViewRef.current = () => undefined;
      selectNodeRef.current = () => undefined;
      updateSearchRef.current = () => undefined;
      gestureFrameRef.current = () => undefined;
      setHandTargets([]);
      setHandRelation(null);
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
      <StageSearchRadar
        inputRef={searchInputRef}
        search={search}
        meta={(node) => `${node.kindLabel} · ${node.groupLabel}`}
        resultsId="space-graph-search-results"
        placeholder="搜索标题与全文"
        inputAriaLabel="在关系图中搜索标题与全文"
        listAriaLabel="关系图全文搜索结果"
        clearAriaLabel="清空关系图搜索"
        hitUnit="节点"
        enterLabel="飞向节点"
        emptyHint="尝试更短的关键词，或搜索正文中的日语、公司名和技术词。"
      />
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
                  {selectedNeighbors.map(({ node: neighbor, relationLabel, direction }) => (
                    <button
                      type="button"
                      key={`${neighbor.id}:${relationLabel}:${direction}`}
                      onClick={() => selectNodeRef.current(neighbor.id)}
                      style={{ "--neighbor-accent": neighbor.color } as CSSProperties}
                    >
                      <span>{neighbor.title}</span>
                      <small>
                        {direction === "out" ? "→" : direction === "in" ? "←" : "↔"} {relationLabel}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <code>{selectedNode.path}</code>
          </div>
          {selectedNode.openable ? (
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
          ) : (
            <div className="space-graph-entity-hint">
              派生实体 · 请选择关系节点继续探索
            </div>
          )}
          <footer>
            <span>
              {selectedNode.openable
                ? <>双击节点或按 <kbd>Enter</kbd> 也可穿越</>
                : "实体由 Vault 的结构化字段实时生成"}
            </span>
            <button type="button" onClick={() => setShortcutHelp(true)}>
              查看快捷键 <kbd>?</kbd>
            </button>
          </footer>
        </aside>
      )}
      {openingNode && (
        <StagePortal
          accent={openingNode.color}
          kicker="MEMORY GATE · SYNCHRONIZING"
          title={openingNode.title}
          note="正在展开完整记忆"
        />
      )}
      <StageControls
        fullscreen={fullscreen}
        fullscreenAriaLabel="全屏查看星图，快捷键 F"
        onToggleFullscreen={() => void toggleFullscreen()}
        resetLabel="回到全景"
        onResetView={() => resetViewRef.current()}
        paused={paused}
        onTogglePaused={() => setPaused((value) => !value)}
        shortcutHelp={shortcutHelp}
        onToggleShortcuts={() => setShortcutHelp((current) => !current)}
      />
      {fullscreen && (
        <GraphHandControls
          active={fullscreen}
          onFrame={(frame) => gestureFrameRef.current(frame)}
          targets={handTargets}
          selectedLabel={selectedNode?.title ?? null}
          relation={handRelation}
        />
      )}
      {shortcutHelp && (
        <StageShortcuts
          title="星图快捷键"
          ariaLabel="星图快捷键"
          onClose={() => setShortcutHelp(false)}
          entries={[
            { keys: ["/"], label: "全文搜索" },
            { keys: ["F"], label: "全屏" },
            { keys: ["D"], label: "档案居中／停靠" },
            { keys: ["O"], label: "打开完整记忆" },
            { keys: ["＋", "－"], label: "文字缩放" },
            { keys: ["0"], label: "恢复 100%" },
            { keys: ["←", "→"], label: "切换节点" },
            { keys: ["P"], label: "暂停／继续动态" },
            { keys: ["R"], label: "回到全景" },
          ]}
        />
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
