"use client";

// 时之航道：把带日期的记忆折算成一条可穿行的 3D 航道。
// 星图是「空间」，这里是「时间」——镜头沿 Z 轴从当下驶向过去，
// 日期是站点环，当天的笔记是环上的星，月份是大门，滚轮就是时间机器。
// 布局与舞台 chrome 全部复用 three-stage / three-stage-chrome，
// 图专属的只有：航道几何、travel 标量相机、磁吸泊站、标签池与密度 scrubber。
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
import type { TimelineScene, TimelineSceneNote } from "@/lib/timeline-scene";
import {
  createCometTexture,
  createFlightController,
  createFocusArtifact,
  createLabelLayer,
  createNebulaTexture,
  createStageRenderer,
  createStarfield,
  disposeStage,
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

type Props = {
  scene: TimelineScene;
  onOpen: (id: string) => void;
  onFallback: () => void;
};

const WARM_ACCENT = "#e66d45";
const COOL_ACCENT = "#9adfc6";
const PAST_EVENT_ACCENT = "#66706c";
// 两种视角：俯瞰（默认）像无人机掠过星河，整条时间线与每日活动量尽收眼底；
// 巡航是隧道内第一人称，用于沉浸式穿行。切换只动镜头与雾，不动任何数据。
type ViewMode = "overview" | "cruise";
const FOG_DENSITY: Record<ViewMode, number> = { overview: 0.0062, cruise: 0.016 };
// 每滚动 1px 注入的行进速度（单位/秒）。衰减 4.2 意味着一次滚动的总行程 ≈ 速度/4.2。
const WHEEL_VELOCITY = 0.09;
const VELOCITY_DECAY = 4.2;
const SNAP_RATE = 4;
// 标签池的规模：航道可能有几百个站点，但 DOM 里最多只挂这些常驻元素。
const DATE_LABEL_POOL = 18;
const MONTH_LABEL_POOL = 4;
const EVENT_FLAG_POOL = 8;

export default function ThreeTimeCorridor({ scene, onOpen, onFallback }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<() => void>(() => undefined);
  const selectNodeRef = useRef<(id: string) => void>(() => undefined);
  const stepStationRef = useRef<(direction: number) => void>(() => undefined);
  const goToMonthRef = useRef<(index: number) => void>(() => undefined);
  const updateSearchRef = useRef<(ids: string[], active: boolean) => void>(
    () => undefined,
  );
  const searchRequestRef = useRef<{ ids: string[]; active: boolean }>({
    ids: [],
    active: false,
  });
  const pauseRef = useRef(false);
  const dossierModeRef = useRef<"dock" | "focus">("dock");
  const viewModeRef = useRef<ViewMode>("overview");
  const applyViewModeRef = useRef<(mode: ViewMode) => void>(() => undefined);
  const onFallbackRef = useRef(onFallback);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dossierMode, setDossierMode] = useState<"dock" | "focus">("dock");
  const [dossierZoom, setDossierZoom] = useState(1);
  const [shortcutHelp, setShortcutHelp] = useState(false);
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

  const noteById = useMemo(
    () => new Map(scene.notes.map((note) => [note.id, note])),
    [scene.notes],
  );
  const eventByNoteId = useMemo(
    () => new Map(scene.events.map((event) => [event.noteId, event])),
    [scene.events],
  );
  const canOpen = useCallback(
    (id: string) => noteById.has(id) || eventByNoteId.has(id),
    [eventByNoteId, noteById],
  );
  const { openingId, openNode } = useStagePortal({ stageRef, onOpen, canOpen });
  const pickSearchResult = useCallback((id: string) => selectNodeRef.current(id), []);
  const searchTiebreak = useCallback(
    (left: TimelineSceneNote, right: TimelineSceneNote) => right.date.localeCompare(left.date),
    [],
  );
  const search = useStageSearch({
    items: scene.notes,
    inputRef: searchInputRef,
    onPick: pickSearchResult,
    tiebreak: searchTiebreak,
  });

  const activeNote = noteById.get(selectedId ?? hoveredId ?? "") ?? null;
  const selectedNote = noteById.get(selectedId ?? "") ?? null;
  const selectedStation = selectedNote ? scene.stations[selectedNote.dayIndex] : null;
  const sameDayNotes = useMemo(() => {
    if (!selectedNote) return [];
    return scene.notes
      .filter((note) => note.dayIndex === selectedNote.dayIndex && note.id !== selectedNote.id)
      .slice(0, 6);
  }, [scene.notes, selectedNote]);
  const sameDayEvents = useMemo(() => {
    if (!selectedNote) return [];
    return scene.events.filter((event) => event.dayIndex === selectedNote.dayIndex);
  }, [scene.events, selectedNote]);
  // 穿越动画的展示数据：优先按记忆解析，解析不到说明入口是日程旗（事件源笔记可能自身无日期）。
  const openingDisplay = useMemo(() => {
    if (!openingId) return null;
    const note = noteById.get(openingId);
    if (note) return { title: note.title, accent: note.color };
    const event = eventByNoteId.get(openingId);
    if (event) {
      return {
        title: `${event.company}・${event.label}`,
        accent: event.phase === "upcoming" ? WARM_ACCENT : PAST_EVENT_ACCENT,
      };
    }
    return null;
  }, [eventByNoteId, noteById, openingId]);

  const changeDossierZoom = useCallback((amount: number) => {
    setDossierZoom((current) => (
      Math.round(Math.min(1.35, Math.max(0.85, current + amount)) * 100) / 100
    ));
  }, []);

  const toggleViewMode = useCallback(() => {
    const next = viewModeRef.current === "overview" ? "cruise" : "overview";
    viewModeRef.current = next;
    setViewMode(next);
    applyViewModeRef.current(next);
  }, []);

  useEffect(() => {
    const request = {
      ids: search.results.map((note) => note.id),
      active: Boolean(search.normalizedQuery),
    };
    searchRequestRef.current = request;
    updateSearchRef.current(request.ids, request.active);
  }, [search.normalizedQuery, search.results]);

  useEffect(() => {
    const handleDeckShortcut = (event: KeyboardEvent) => {
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
      if (key === "v") {
        event.preventDefault();
        toggleViewMode();
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
    document.addEventListener("keydown", handleDeckShortcut);
    return () => document.removeEventListener("keydown", handleDeckShortcut);
  }, [changeDossierZoom, dossierMode, openNode, selectedId, toggleViewMode]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || scene.stations.length === 0) return;

    setReady(false);
    setHoveredId(null);
    setSelectedId(null);

    const stageBundle = createStageRenderer({
      host,
      antialias: scene.notes.length < 1500,
      pixelRatioCap: scene.notes.length > 1500 ? 1.25 : 1.75,
      ariaLabel: `时之航道，共 ${scene.notes.length} 篇带日期的记忆；滚轮沿时间航行，单击锁定，双击打开完整笔记，方向键按时间切换`,
    });
    if (!stageBundle) {
      onFallbackRef.current();
      return;
    }
    const { renderer, canvas } = stageBundle;

    const notes = scene.notes;
    const stations = scene.stations;
    const months = scene.months;
    const events = scene.events;
    const deepestZ = stations[stations.length - 1].z;

    const stageScene = new THREE.Scene();
    let fogTargetDensity = FOG_DENSITY[viewModeRef.current];
    const stageFog = new THREE.FogExp2(0x101b17, fogTargetDensity);
    stageScene.fog = stageFog;

    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 260);
    const root = new THREE.Group();
    stageScene.add(root);
    stageScene.add(new THREE.HemisphereLight(0xd8fff0, 0x07110d, 1.7));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(3, 6, 8);
    stageScene.add(keyLight);
    // 星图按分区放五盏灯；航道会一路移动，所以把冷暖两盏灯挂在相机上，
    // 保证正在穿行的这一段永远有光。
    const warmLight = new THREE.PointLight(0xe6b08a, 4.2, 16, 1.8);
    warmLight.position.set(0, 0.4, -2);
    camera.add(warmLight);
    const coolLight = new THREE.PointLight(0x79d7b8, 3.4, 22, 1.9);
    coolLight.position.set(0, -0.6, -9);
    camera.add(coolLight);
    stageScene.add(camera);

    // ── 笔记星：与星图同一套衍射星光 shader，只是布点换成「站点环」几何。
    const positions = new Float32Array(notes.length * 3);
    const colors = new Float32Array(notes.length * 3);
    const sizes = new Float32Array(notes.length);
    const phases = new Float32Array(notes.length);
    // 検索命中球の回転基値。決定的な値なのに、以前は帧内で命中ごとに
    // seeded(テンプレート文字列)×3 を回していた——命中数に上限が無いので、
    // 「面接」のような常用語では毎フレーム数百〜千回の文字列分配になる。
    const searchSpins = new Float32Array(notes.length * 3);
    const nodeFocus = new Float32Array(notes.length);
    const nodeSearch = new Float32Array(notes.length);
    const positionById = new Map<string, THREE.Vector3>();
    const indexById = new Map<string, number>();

    notes.forEach((note, index) => {
      const station = stations[note.dayIndex];
      const dayCount = Math.max(1, station.noteIds.length);
      const base = seeded(station.date) * Math.PI * 2;
      const angle = base
        + note.slot * (Math.PI * 2 / Math.max(5, dayCount))
        + (seeded(`${note.id}:angle`) - 0.5) * 0.35;
      const radius = 2.1 * (0.82 + seeded(`${note.id}:radius`) * 0.5);
      // 中心半径 <1.6 留空：那是镜头穿行的航道本体，星不挡路。
      const position = new THREE.Vector3(
        Math.cos(angle) * radius * 1.15,
        Math.sin(angle) * radius * 0.78,
        -station.z + (seeded(`${note.id}:depth`) - 0.5) * 0.55,
      );
      const color = new THREE.Color(note.color);
      positions.set(position.toArray(), index * 3);
      colors.set(color.toArray(), index * 3);
      sizes[index] = 0.85 + seeded(`${note.id}:size`) * 0.25;
      phases[index] = seeded(`${note.id}:phase`) * Math.PI * 2;
      searchSpins[index * 3] = seeded(`${note.id}:search-x`) * Math.PI;
      searchSpins[index * 3 + 1] = seeded(`${note.id}:search-y`) * Math.PI;
      searchSpins[index * 3 + 2] = seeded(`${note.id}:search-z`) * Math.PI;
      positionById.set(note.id, position);
      indexById.set(note.id, index);
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

    // 搜索命中的实体能量球：与星图同一模式。
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
      Math.max(1, notes.length),
    );
    searchSpheres.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    searchSpheres.renderOrder = 3;
    const searchMatrix = new THREE.Object3D();
    const searchFlags = new Float32Array(notes.length);
    let searchSphereScale = 0.24;
    notes.forEach((note, index) => {
      const position = positionById.get(note.id)!;
      searchMatrix.position.copy(position);
      searchMatrix.scale.setScalar(0.0001);
      searchMatrix.updateMatrix();
      searchSpheres.setMatrixAt(index, searchMatrix.matrix);
      searchSpheres.setColorAt(
        index,
        new THREE.Color(note.color).lerp(new THREE.Color("#ffffff"), 0.24),
      );
    });
    searchSpheres.instanceMatrix.needsUpdate = true;
    if (searchSpheres.instanceColor) searchSpheres.instanceColor.needsUpdate = true;
    root.add(searchSpheres);

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
      notes.forEach((note, index) => {
        const matched = matches.has(note.id);
        searchFlags[index] = active && matched ? 1 : 0;
        nodeSearch[index] = matched ? 1 : 0;
        searchMatrix.position.copy(positionById.get(note.id)!);
        searchMatrix.rotation.set(
          searchSpins[index * 3],
          searchSpins[index * 3 + 1],
          searchSpins[index * 3 + 2],
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
    };
    updateSearchRef.current = applySearchMatches;
    applySearchMatches(
      searchRequestRef.current.ids,
      searchRequestRef.current.active,
    );

    // ── 站点环：一天一个环，实例化绘制。近的暖、远的冷，方向感一眼可读。
    const ringGeometry = new THREE.RingGeometry(2.62, 2.66, 72);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stationRings = new THREE.InstancedMesh(
      ringGeometry,
      ringMaterial,
      stations.length,
    );
    const ringMatrix = new THREE.Object3D();
    const warmColor = new THREE.Color(WARM_ACCENT);
    const coolColor = new THREE.Color(COOL_ACCENT);
    stations.forEach((station, index) => {
      ringMatrix.position.set(0, 0, -station.z);
      const scale = station.isMonthStart ? 1.18 : 1;
      ringMatrix.scale.set(scale, scale, 1);
      ringMatrix.updateMatrix();
      stationRings.setMatrixAt(index, ringMatrix.matrix);
      stationRings.setColorAt(
        index,
        warmColor.clone().lerp(coolColor, Math.min(1, station.z / 30)),
      );
    });
    if (stationRings.instanceColor) stationRings.instanceColor.needsUpdate = true;
    root.add(stationRings);

    // ── 每日活动光柱：高度 = 当天笔记数 + 日程数。俯瞰视角下这就是一条
    // 沿星河排开的柱状图，「哪天发生了多少事」不用数星星也能读出来。
    // 立在环顶偏左（0.66π），给环顶正中的日程旗让位。
    const pillarGeometry = new THREE.CylinderGeometry(0.032, 0.032, 1, 6, 1, true);
    const pillarMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pillars = new THREE.InstancedMesh(pillarGeometry, pillarMaterial, stations.length);
    stations.forEach((station, index) => {
      const activity = station.noteIds.length + station.eventIds.length;
      const height = Math.min(3.4, 0.35 + Math.sqrt(activity) * 0.52);
      const ringScale = station.isMonthStart ? 1.18 : 1;
      const baseAngle = Math.PI * 0.66;
      ringMatrix.position.set(
        Math.cos(baseAngle) * 2.64 * ringScale,
        Math.sin(baseAngle) * 2.64 * ringScale + 0.1 + height / 2,
        -station.z,
      );
      ringMatrix.scale.set(1, height, 1);
      ringMatrix.updateMatrix();
      pillars.setMatrixAt(index, ringMatrix.matrix);
      pillars.setColorAt(
        index,
        warmColor.clone().lerp(coolColor, Math.min(1, station.z / 30)),
      );
    });
    if (pillars.instanceColor) pillars.instanceColor.needsUpdate = true;
    pillars.renderOrder = 1;
    root.add(pillars);

    // ── 月门：数量少，独立 mesh + 星云衬底。
    const nebulaTexture = createNebulaTexture();
    const gateGeometry = new THREE.RingGeometry(3.3, 3.42, 96);
    months.forEach((month) => {
      const gateMaterial = new THREE.MeshBasicMaterial({
        color: COOL_ACCENT,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const gate = new THREE.Mesh(gateGeometry, gateMaterial);
      gate.position.set(0, 0, -month.zStart);
      gate.renderOrder = 1;
      root.add(gate);
      const nebulaMaterial = new THREE.SpriteMaterial({
        map: nebulaTexture,
        color: COOL_ACCENT,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const nebula = new THREE.Sprite(nebulaMaterial);
      nebula.position.set(0, 0, -month.zStart - 0.8);
      nebula.scale.set(7.2, 4.4, 1);
      nebula.renderOrder = -1;
      root.add(nebula);
    });

    // ── 星河：绕航道外侧的氛围粒子带，替代星图的分区星云与星尘。
    const riverCount = Math.min(2200, stations.length * 14 + 600);
    const riverPositions = new Float32Array(riverCount * 3);
    const riverColors = new Float32Array(riverCount * 3);
    const warmDust = new THREE.Color(0xe6b08a);
    const coolDust = new THREE.Color(0x79d7b8);
    for (let index = 0; index < riverCount; index += 1) {
      const depth = seeded(`river:${index}`) * (deepestZ + 12) - 6;
      const angle = depth * 0.35 + seeded(`river:${index}:angle`) * Math.PI * 2;
      const radius = 3.1 + seeded(`river:${index}:radius`) * 1.4;
      riverPositions.set([
        Math.cos(angle) * radius * 1.2,
        Math.sin(angle) * radius * 0.72,
        -depth,
      ], index * 3);
      const tone = warmDust.clone()
        .lerp(coolDust, Math.min(1, Math.max(0, depth / Math.max(1, deepestZ))))
        .lerp(new THREE.Color("#ffffff"), 0.2);
      riverColors.set(tone.toArray(), index * 3);
    }
    const riverGeometry = new THREE.BufferGeometry();
    riverGeometry.setAttribute("position", new THREE.BufferAttribute(riverPositions, 3));
    riverGeometry.setAttribute("color", new THREE.BufferAttribute(riverColors, 3));
    const riverMaterial = new THREE.PointsMaterial({
      size: 0.035,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const river = new THREE.Points(riverGeometry, riverMaterial);
    river.renderOrder = 0;
    root.add(river);

    // ── 时间流粒子：航道管内从过去漂向现在的彗星，预分配缓冲、零逐帧分配。
    const cometTexture = createCometTexture();
    const flowCount = 140;
    const flowPositions = new Float32Array(flowCount * 3);
    for (let index = 0; index < flowCount; index += 1) {
      const angle = seeded(`flow:${index}:angle`) * Math.PI * 2;
      const radius = seeded(`flow:${index}:radius`) * 0.85;
      flowPositions.set([
        Math.cos(angle) * radius * 1.1,
        Math.sin(angle) * radius * 0.6,
        seeded(`flow:${index}:depth`) * 80 - 40,
      ], index * 3);
    }
    const flowGeometry = new THREE.BufferGeometry();
    flowGeometry.setAttribute("position", new THREE.BufferAttribute(flowPositions, 3));
    const flowMaterial = new THREE.PointsMaterial({
      size: 0.22,
      sizeAttenuation: true,
      color: 0xbfe8d5,
      map: cometTexture,
      alphaTest: 0.018,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const flowPoints = new THREE.Points(flowGeometry, flowMaterial);
    flowPoints.renderOrder = 2;
    root.add(flowPoints);

    // ── 日程标记：面接等事件挂在站点环顶部，将来暖橙、过去灰。
    const eventPositions = new Float32Array(Math.max(1, events.length) * 3);
    const eventColors = new Float32Array(Math.max(1, events.length) * 3);
    const eventPositionByIndex: THREE.Vector3[] = [];
    events.forEach((event, index) => {
      const station = stations[event.dayIndex];
      const slot = station.eventIds.indexOf(event.id);
      const count = station.eventIds.length;
      const angle = Math.PI / 2 + (slot - (count - 1) / 2) * 0.35;
      const ringScale = station.isMonthStart ? 1.18 : 1;
      const position = new THREE.Vector3(
        Math.cos(angle) * 2.64 * ringScale,
        Math.sin(angle) * 2.64 * ringScale,
        -station.z,
      );
      eventPositions.set(position.toArray(), index * 3);
      const color = new THREE.Color(
        event.phase === "upcoming" ? WARM_ACCENT : PAST_EVENT_ACCENT,
      );
      eventColors.set(color.toArray(), index * 3);
      eventPositionByIndex.push(position);
    });
    const eventGeometry = new THREE.BufferGeometry();
    eventGeometry.setAttribute("position", new THREE.BufferAttribute(eventPositions, 3));
    eventGeometry.setAttribute("color", new THREE.BufferAttribute(eventColors, 3));
    eventGeometry.setDrawRange(0, events.length);
    const eventMaterial = new THREE.PointsMaterial({
      size: 0.34,
      sizeAttenuation: true,
      vertexColors: true,
      map: cometTexture,
      alphaTest: 0.018,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const eventPoints = new THREE.Points(eventGeometry, eventMaterial);
    eventPoints.renderOrder = 5;
    eventPoints.visible = events.length > 0;
    root.add(eventPoints);

    const focusArtifact = createFocusArtifact(cometTexture);
    root.add(focusArtifact.group);

    const starfield = createStarfield();
    stageScene.add(starfield.points);

    // ── 相机 rig：travel 标量 = 距当下的纵深。OrbitControls 只负责姿态，
    // 缩放/平移全部关掉，滚轮由我们自己接管成「时间行进」。
    // 俯瞰视角从右上方斜看整条星河，巡航视角回到隧道内第一人称。
    const vantageFor = (mode: ViewMode) =>
      mode === "overview"
        ? new THREE.Vector3(14, 6.8, 16.5)
        : new THREE.Vector3(0, 1.1, 8.2);
    // 俯瞰时注视点前移到航道深处：当前环落在画面左下，整条星河横穿中心。
    // 注视点若钉在近端，「未来」一侧永远是半屏空白。
    const lookLeadFor = (mode: ViewMode) => (mode === "overview" ? 12 : 0);
    const flightAnchor = (depth: number) =>
      new THREE.Vector3(0, 0, -(depth + lookLeadFor(viewModeRef.current)));
    camera.position.copy(
      vantageFor(viewModeRef.current).add(
        new THREE.Vector3(0, 0, -lookLeadFor(viewModeRef.current)),
      ),
    );
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0, -lookLeadFor(viewModeRef.current));
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.rotateSpeed = 0.42;
    const applyModeConstraints = (mode: ViewMode) => {
      if (mode === "overview") {
        controls.minPolarAngle = Math.PI * 0.22;
        controls.maxPolarAngle = Math.PI * 0.52;
        controls.minAzimuthAngle = Math.PI * 0.04;
        controls.maxAzimuthAngle = Math.PI * 0.42;
      } else {
        controls.minPolarAngle = Math.PI * 0.38;
        controls.maxPolarAngle = Math.PI * 0.62;
        controls.minAzimuthAngle = -Math.PI * 0.22;
        controls.maxAzimuthAngle = Math.PI * 0.22;
      }
    };
    applyModeConstraints(viewModeRef.current);
    controls.update();

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points!.threshold = 0.27;
    const pointer = new THREE.Vector2();
    const selectedRef = { current: null as string | null };
    const hoveredRef = { current: null as string | null };
    let travel = 0;
    let travelVelocity = 0;
    let flightTargetTravel: number | null = null;
    let pointerStart: [number, number] | null = null;
    let pointerHeld = false;
    let keyboardIndex = 0;
    let visible = true;

    const flightController = createFlightController({
      camera,
      target: controls.target,
      warp: {
        material: starfield.material,
        baseSize: 0.027,
        baseOpacity: 0.48,
      },
      onComplete: () => {
        if (flightTargetTravel !== null) {
          travel = flightTargetTravel;
          flightTargetTravel = null;
        }
      },
    });

    // 切视角 = 一次到「当前深度对应机位」的飞行 + 雾密度渐变 + 姿态钳位换挡。
    const applyViewMode = (mode: ViewMode) => {
      viewModeRef.current = mode;
      applyModeConstraints(mode);
      fogTargetDensity = FOG_DENSITY[mode];
      labelWindowKey = "";
      const anchor = flightAnchor(travel);
      flightTargetTravel = travel;
      travelVelocity = 0;
      flightController.start(anchor.clone().add(vantageFor(mode)), anchor, 860);
    };
    applyViewModeRef.current = applyViewMode;

    // 行进 = 相机与注视点整体沿 -Z 平移，姿态偏移原样保留，所以不会与拖拽打架。
    const applyTravel = (next: number) => {
      const clamped = Math.min(deepestZ, Math.max(0, next));
      const delta = clamped - travel;
      if (delta === 0) return;
      travel = clamped;
      camera.position.z -= delta;
      controls.target.z -= delta;
    };

    const nearestStationIndex = (depth: number) => {
      let low = 0;
      let high = stations.length - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (stations[mid].z < depth) low = mid + 1;
        else high = mid;
      }
      if (low > 0) {
        const previous = stations[low - 1];
        if (Math.abs(previous.z - depth) <= Math.abs(stations[low].z - depth)) {
          return low - 1;
        }
      }
      return low;
    };

    const monthIndexForTravel = (depth: number) => {
      let index = 0;
      months.forEach((month, monthIndex) => {
        if (month.zStart <= depth + 0.001) index = monthIndex;
      });
      return index;
    };

    const focusAttributes = (id: string | null) => {
      const note = id ? noteById.get(id) : null;
      const sameDay = note
        ? new Set(stations[note.dayIndex].noteIds)
        : new Set<string>();
      notes.forEach((item, index) => {
        // 与星图不同：这里选中星最亮（0.42），同日的星次之（0.3）。
        nodeFocus[index] = item.id === id ? 0.42 : sameDay.has(item.id) ? 0.3 : 0;
      });
      (nodeGeometry.getAttribute("aFocus") as THREE.BufferAttribute).needsUpdate = true;

      const lockedId = selectedRef.current;
      const focusPosition = lockedId ? positionById.get(lockedId) : undefined;
      focusArtifact.setVisible(Boolean(focusPosition));
      if (focusPosition && lockedId) {
        focusArtifact.setPosition(focusPosition);
        focusArtifact.setAccent(noteById.get(lockedId)?.color ?? "#ffffff");
      }
    };

    const selectNote = (id: string) => {
      const index = indexById.get(id);
      const localPosition = positionById.get(id);
      const note = noteById.get(id);
      if (index === undefined || !localPosition || !note) return;
      keyboardIndex = index;
      selectedRef.current = id;
      setSelectedId(id);
      focusAttributes(id);
      const worldPosition = nodePoints.localToWorld(localPosition.clone());
      // 永远从「当下」一侧接近星体，让镜头保持望向过去的方向感。
      flightTargetTravel = stations[note.dayIndex].z;
      travelVelocity = 0;
      flightController.start(
        worldPosition.clone().add(new THREE.Vector3(0, 0.15, 4.6)),
        worldPosition,
      );
    };
    selectNodeRef.current = selectNote;

    const clearSelection = (flyBack: boolean) => {
      selectedRef.current = null;
      hoveredRef.current = null;
      setSelectedId(null);
      setHoveredId(null);
      setDossierMode("dock");
      focusAttributes(null);
      // 从星体特写退出时飞回当前视角的标准机位，而不是留在原地漂着。
      if (flyBack) {
        const anchor = flightAnchor(travel);
        flightTargetTravel = travel;
        travelVelocity = 0;
        flightController.start(anchor.clone().add(vantageFor(viewModeRef.current)), anchor, 760);
      }
    };

    const resetView = () => {
      clearSelection(false);
      const anchor = flightAnchor(0);
      flightTargetTravel = 0;
      travelVelocity = 0;
      flightController.start(
        anchor.clone().add(vantageFor(viewModeRef.current)),
        anchor,
        900,
      );
    };
    resetViewRef.current = resetView;

    const goToStation = (index: number) => {
      const clamped = Math.min(stations.length - 1, Math.max(0, index));
      const station = stations[clamped];
      const anchor = flightAnchor(station.z);
      flightTargetTravel = station.z;
      travelVelocity = 0;
      flightController.start(
        anchor.clone().add(vantageFor(viewModeRef.current)),
        anchor,
        720,
      );
    };
    stepStationRef.current = (direction: number) => {
      goToStation(nearestStationIndex(travel) + direction);
    };
    goToMonthRef.current = (index: number) => {
      const month = months[index];
      if (!month) return;
      goToStation(month.firstDayIndex);
    };

    const hitTest = (event: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const noteHit = raycaster.intersectObject(nodePoints, false)[0];
      if (noteHit?.index !== undefined && notes[noteHit.index]) {
        return { kind: "note" as const, id: notes[noteHit.index].id };
      }
      if (events.length > 0) {
        const eventHit = raycaster.intersectObject(eventPoints, false)[0];
        if (eventHit?.index !== undefined && events[eventHit.index]) {
          return { kind: "event" as const, id: events[eventHit.index].id };
        }
      }
      return null;
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerStart = [event.clientX, event.clientY];
      pointerHeld = true;
    };
    const onPointerMove = (event: PointerEvent) => {
      const hit = hitTest(event);
      canvas.style.cursor = hit ? "pointer" : "grab";
      const nextHover = hit?.kind === "note" ? hit.id : null;
      if (nextHover === hoveredRef.current) return;
      hoveredRef.current = nextHover;
      setHoveredId(nextHover);
      focusAttributes(selectedRef.current ?? nextHover);
    };
    const onPointerLeave = () => {
      hoveredRef.current = null;
      setHoveredId(null);
      pointerHeld = false;
      canvas.style.cursor = "grab";
      focusAttributes(selectedRef.current);
    };
    const onPointerUp = (event: PointerEvent) => {
      pointerHeld = false;
      if (!pointerStart) return;
      const moved = Math.hypot(
        event.clientX - pointerStart[0],
        event.clientY - pointerStart[1],
      );
      pointerStart = null;
      if (moved > 5) return;
      const hit = hitTest(event);
      if (!hit) return;
      if (hit.kind === "note") {
        selectNote(hit.id);
        return;
      }
      const eventItem = events.find((item) => item.id === hit.id);
      // 日程旗不进档案卡，直接穿越到来源笔记（多半是 job-case）。
      if (eventItem) openNode(eventItem.noteId);
    };
    const onDoubleClick = (event: MouseEvent) => {
      const hit = hitTest(event);
      if (!hit) return;
      if (hit.kind === "note") {
        openNode(hit.id);
        return;
      }
      const eventItem = events.find((item) => item.id === hit.id);
      if (eventItem) openNode(eventItem.noteId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const px = event.deltaY * (
        event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? host.clientHeight : 1
      );
      flightController.cancel();
      flightTargetTravel = null;
      if (reducedMotion) {
        travelVelocity = 0;
        applyTravel(travel + px * 0.02);
        return;
      }
      travelVelocity = Math.min(72, Math.max(-72, travelVelocity + px * WHEEL_VELOCITY));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dossierModeRef.current === "focus") {
          event.preventDefault();
          event.stopPropagation();
          setDossierMode("dock");
          return;
        }
        if (selectedRef.current) {
          clearSelection(true);
          return;
        }
        resetView();
        return;
      }
      if (event.key === "Enter" && selectedRef.current) {
        openNode(selectedRef.current);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        resetView();
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        goToStation(stations.length - 1);
        return;
      }
      if (event.key === "PageUp" || event.key === "[") {
        event.preventDefault();
        goToMonthRef.current(monthIndexForTravel(travel) - 1);
        return;
      }
      if (event.key === "PageDown" || event.key === "]") {
        event.preventDefault();
        goToMonthRef.current(monthIndexForTravel(travel) + 1);
        return;
      }
      if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      // scene.notes 本来就是时间序（新→旧），线性步进即按时间穿行。
      const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
      keyboardIndex = (keyboardIndex + direction + notes.length) % notes.length;
      selectNote(notes[keyboardIndex].id);
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
    canvas.addEventListener("wheel", onWheel, { passive: false });
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

    // ── 标签池：DOM 里常驻少量元素，窗口滑动时只重绑内容，不增删节点。
    const labelLayer = createLabelLayer(host);
    type PooledLabel = StageLabelItem & { element: HTMLElement };
    const makePooledLabel = (className: string, build: (element: HTMLElement) => void): PooledLabel => {
      const element = document.createElement("span");
      element.className = className;
      build(element);
      labelLayer.appendChild(element);
      element.dataset.visible = "false";
      return { element, position: new THREE.Vector3(), offsetY: 13 };
    };
    const dateLabels = Array.from({ length: DATE_LABEL_POOL }, () =>
      makePooledLabel("time-corridor-date-label", (element) => {
        element.appendChild(document.createElement("i"));
        element.appendChild(document.createElement("b"));
        element.appendChild(document.createElement("small"));
      }));
    const monthLabels = Array.from({ length: MONTH_LABEL_POOL }, () =>
      makePooledLabel("time-corridor-month-label", (element) => {
        element.appendChild(document.createElement("b"));
      }));
    const eventFlags = Array.from({ length: EVENT_FLAG_POOL }, () =>
      makePooledLabel("time-corridor-event-flag", (element) => {
        element.appendChild(document.createElement("b"));
      }));
    let activeLabelItems: StageLabelItem[] = [];
    let labelWindowKey = "";

    const updateLabelWindow = () => {
      const centerIndex = nearestStationIndex(travel);
      const key = `${centerIndex}:${selectedRef.current ?? ""}:${viewModeRef.current}`;
      if (key === labelWindowKey) return;
      labelWindowKey = key;
      activeLabelItems = [];
      // 俯瞰时视距更远，标签的可见窗口与衰减距离一并放宽。
      const overview = viewModeRef.current === "overview";
      const dateFadeSpan = overview ? 90 : 40;
      const monthRange = overview ? 120 : 60;
      const eventRange = overview ? 80 : 42;
      const eventFadeSpan = overview ? 80 : 34;

      const start = Math.max(0, centerIndex - Math.floor(DATE_LABEL_POOL / 2));
      const windowStations = stations.slice(start, start + DATE_LABEL_POOL);
      dateLabels.forEach((label, index) => {
        const station = windowStations[index];
        if (!station) {
          label.element.dataset.visible = "false";
          return;
        }
        (label.element.children[1] as HTMLElement).textContent = station.dateLabel;
        (label.element.children[2] as HTMLElement).textContent = station.weekdayLabel;
        // WebGL 里的雾不会作用到 HTML 标签，这里手动给一个随纵深的衰减，
        // 否则远处站牌全亮，在灭点处叠成一摞。
        label.element.style.setProperty(
          "--label-depth-fade",
          Math.max(0.08, 1 - Math.abs(station.z - travel) / dateFadeSpan).toFixed(3),
        );
        label.element.style.setProperty(
          "--label-accent",
          `#${warmColor.clone().lerp(coolColor, Math.min(1, station.z / 30)).getHexString()}`,
        );
        label.element.dataset.active =
          selectedRef.current && noteById.get(selectedRef.current)?.dayIndex === station.dayIndex
            ? "selected"
            : "";
        const ringScale = station.isMonthStart ? 1.18 : 1;
        label.position.set(0, -2.72 * ringScale, -station.z);
        label.offsetY = 10;
        activeLabelItems.push(label);
      });

      const nearbyMonths = months
        .map((month, index) => ({ month, index }))
        .filter(({ month }) => Math.abs(month.zStart - travel) < monthRange)
        .slice(0, MONTH_LABEL_POOL);
      monthLabels.forEach((label, index) => {
        const entry = nearbyMonths[index];
        if (!entry) {
          label.element.dataset.visible = "false";
          return;
        }
        (label.element.children[0] as HTMLElement).textContent = entry.month.label;
        label.position.set(0, 3.6, -entry.month.zStart);
        label.offsetY = -30;
        activeLabelItems.push(label);
      });

      const nearbyEvents = events
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => Math.abs(stations[event.dayIndex].z - travel) < eventRange)
        .slice(0, EVENT_FLAG_POOL);
      eventFlags.forEach((label, index) => {
        const entry = nearbyEvents[index];
        if (!entry) {
          label.element.dataset.visible = "false";
          return;
        }
        (label.element.children[0] as HTMLElement).textContent =
          `${entry.event.company}・${entry.event.label}`;
        label.element.dataset.phase = entry.event.phase;
        label.element.style.setProperty(
          "--label-depth-fade",
          Math.max(0.08, 1 - Math.abs(stations[entry.event.dayIndex].z - travel) / eventFadeSpan).toFixed(3),
        );
        const position = eventPositionByIndex[entry.index];
        label.position.set(position.x, position.y + 0.2, position.z);
        label.offsetY = -26;
        activeLabelItems.push(label);
      });
    };

    // ── scrubber 与进度：逐帧 imperative 更新，不走 React 状态。
    const scrubberButtons = scrubberRef.current
      ? [...scrubberRef.current.querySelectorAll("button")]
      : [];
    let lastProgress = -1;
    let lastMonthIndex = -1;
    const updateScrubber = () => {
      const stageElement = stageRef.current;
      if (!stageElement) return;
      const progress = deepestZ > 0 ? travel / deepestZ : 0;
      if (Math.abs(progress - lastProgress) > 0.001) {
        lastProgress = progress;
        stageElement.style.setProperty("--corridor-progress", progress.toFixed(4));
      }
      const monthIndex = monthIndexForTravel(travel);
      if (monthIndex !== lastMonthIndex) {
        lastMonthIndex = monthIndex;
        scrubberButtons.forEach((button, index) => {
          button.dataset.active = index === monthIndex ? "true" : "false";
        });
      }
    };

    let lastFrameAt = performance.now();
    const animate = (now: number) => {
      if (!visible) {
        lastFrameAt = now;
        return;
      }
      const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;
      const seconds = now / 1000;
      nodeMaterial.uniforms.uTime.value = seconds;
      nodeMaterial.uniforms.uMotion.value = pauseRef.current || reducedMotion ? 0 : 1;

      if (searchActive && searchSpheres.visible) {
        notes.forEach((note, index) => {
          if (searchFlags[index] !== 1) return;
          const pulse = pauseRef.current || reducedMotion
            ? 1
            : 1 + Math.sin(seconds * 1.5 + phases[index]) * 0.055;
          searchMatrix.position.copy(positionById.get(note.id)!);
          searchMatrix.rotation.set(
            searchSpins[index * 3] + seconds * 0.04,
            searchSpins[index * 3 + 1] + seconds * 0.065,
            searchSpins[index * 3 + 2],
          );
          searchMatrix.scale.setScalar(searchSphereScale * pulse);
          searchMatrix.updateMatrix();
          searchSpheres.setMatrixAt(index, searchMatrix.matrix);
        });
        searchSpheres.instanceMatrix.needsUpdate = true;
      }

      flightController.tick(now);
      stageFog.density += (fogTargetDensity - stageFog.density) * Math.min(1, dt * 3);

      if (flightController.active) {
        // 飞行途中 travel 独立向目的地缓动（注视点带 lead 偏移，不能反推），
        // scrubber 与标签窗口照样平滑随行，落点由 onComplete 精确校准。
        if (flightTargetTravel !== null) {
          travel += (flightTargetTravel - travel) * Math.min(1, dt * 3.2);
        }
      } else {
        if (travelVelocity !== 0) {
          applyTravel(travel + travelVelocity * dt);
          travelVelocity *= Math.exp(-dt * VELOCITY_DECAY);
          if (Math.abs(travelVelocity) < 0.01) travelVelocity = 0;
          if (travel <= 0 || travel >= deepestZ) travelVelocity = 0;
        } else if (!pointerHeld && !reducedMotion) {
          // 磁吸泊站：静止时缓缓吸附到最近的日期，让停下来的画面永远是一天的全景。
          const nearest = stations[nearestStationIndex(travel)].z;
          const delta = nearest - travel;
          if (Math.abs(delta) > 0.01) {
            applyTravel(travel + delta * (1 - Math.exp(-dt * SNAP_RATE)));
          } else if (delta !== 0) {
            applyTravel(nearest);
          }
        }
      }

      if (!pauseRef.current && !reducedMotion) {
        river.rotation.z = seconds * 0.02;
        const flowAttribute = flowGeometry.getAttribute("position") as THREE.BufferAttribute;
        const center = -travel;
        for (let index = 0; index < flowCount; index += 1) {
          let z = flowPositions[index * 3 + 2] + dt * 2.2;
          if (z > center + 40) z -= 80;
          if (z < center - 40) z += 80;
          flowPositions[index * 3 + 2] = z;
        }
        flowAttribute.needsUpdate = true;
      }

      focusArtifact.tick(seconds, !pauseRef.current && !reducedMotion);

      starfield.points.position.copy(camera.position);
      controls.update();
      stageScene.updateMatrixWorld(true);
      updateLabelWindow();
      projectLabelItems(activeLabelItems, root, camera, host);
      updateScrubber();
      renderer.render(stageScene, camera);
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
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      disposeStage(stageScene);
      nebulaTexture.dispose();
      cometTexture.dispose();
      renderer.dispose();
      labelLayer.remove();
      canvas.remove();
      resetViewRef.current = () => undefined;
      selectNodeRef.current = () => undefined;
      updateSearchRef.current = () => undefined;
      stepStationRef.current = () => undefined;
      goToMonthRef.current = () => undefined;
    };
  }, [noteById, openNode, scene]);

  if (scene.stations.length === 0) {
    return <div className="space-graph-empty">还没有带日期的记忆。</div>;
  }

  const maxMonthCount = Math.max(1, ...scene.months.map((month) => month.noteCount));

  return (
    <div
      ref={stageRef}
      className="space-graph-stage"
      data-view="corridor"
      data-ready={ready ? "true" : "false"}
      data-fullscreen={fullscreen ? "true" : "false"}
      data-selected={selectedNote ? "true" : "false"}
      data-dossier-mode={selectedNote ? dossierMode : "none"}
    >
      <div ref={hostRef} className="space-graph-webgl" />
      {!ready && (
        <div className="space-graph-loading" role="status">
          <i />
          <span>正在铺设时间航道</span>
        </div>
      )}
      <div className="space-graph-brand" aria-hidden="true">
        <span>TIME CORRIDOR</span>
        <strong>沿着时间，重访每一天。</strong>
      </div>
      <StageSearchRadar
        inputRef={searchInputRef}
        search={search}
        meta={(note) => `${scene.stations[note.dayIndex]?.dateLabel ?? note.date} · ${note.kindLabel}`}
        resultsId="time-corridor-search-results"
        placeholder="搜索标题与全文"
        inputAriaLabel="在时间航道中搜索标题与全文"
        listAriaLabel="时间航道全文搜索结果"
        clearAriaLabel="清空时间航道搜索"
        hitUnit="记忆"
        enterLabel="飞向记忆"
        emptyHint="尝试更短的关键词，或搜索正文中的日语、公司名和技术词。"
      />
      {activeNote && !selectedNote && (
        <div
          className="space-graph-node-card space-graph-node-peek"
          style={{ "--node-accent": activeNote.color } as CSSProperties}
          role="status"
        >
          <span>{scene.stations[activeNote.dayIndex]?.dateLabel}</span>
          <strong>{activeNote.title}</strong>
          <small>{activeNote.kindLabel} · {activeNote.groupLabel}</small>
        </div>
      )}
      {selectedNote && (
        <aside
          className="space-graph-dossier"
          data-mode={dossierMode}
          style={{
            "--node-accent": selectedNote.color,
            "--dossier-zoom": dossierZoom,
          } as CSSProperties}
          aria-label={`${selectedNote.title}的记忆档案`}
        >
          <i className="space-graph-dossier-scan" aria-hidden="true" />
          <header>
            <div>
              <span>TIME SIGNAL · 已锁定</span>
              <small>{selectedStation?.dateLabel} · {selectedNote.groupLabel}</small>
            </div>
            <div className="space-graph-dossier-actions">
              <button
                type="button"
                aria-label={dossierMode === "focus" ? "将记忆档案停靠到右侧" : "居中放大记忆档案"}
                onClick={() => setDossierMode((current) => current === "dock" ? "focus" : "dock")}
              >
                {dossierMode === "focus" ? "停靠" : "居中"} <kbd>D</kbd>
              </button>
              <button
                type="button"
                aria-label="缩小记忆档案文字"
                onClick={() => changeDossierZoom(-0.1)}
              >
                −
              </button>
              <output aria-label={`记忆档案缩放 ${Math.round(dossierZoom * 100)}%`}>
                {Math.round(dossierZoom * 100)}%
              </output>
              <button
                type="button"
                aria-label="放大记忆档案文字"
                onClick={() => changeDossierZoom(0.1)}
              >
                +
              </button>
              <button
                type="button"
                aria-label="收起记忆档案并回到当下"
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
              <span>{selectedNote.kindLabel}</span>
              <h2>{selectedNote.title}</h2>
            </div>
            <dl>
              <div><dt>日期</dt><dd>{selectedStation?.dateLabel}</dd></div>
              <div><dt>星期</dt><dd>{selectedStation?.weekdayLabel}</dd></div>
              <div><dt>更新</dt><dd>{selectedNote.updatedLabel}</dd></div>
            </dl>
            <div className="space-graph-dossier-copy">
              <span>内容预览 · 可滚动查看全文</span>
              <p>{selectedNote.excerpt || "这篇记忆暂时没有可提取的正文摘要。"}</p>
            </div>
            {sameDayNotes.length > 0 && (
              <div className="space-graph-dossier-neighbors">
                <span>同日的记忆</span>
                <div>
                  {sameDayNotes.map((note) => (
                    <button
                      type="button"
                      key={note.id}
                      onClick={() => selectNodeRef.current(note.id)}
                      style={{ "--neighbor-accent": note.color } as CSSProperties}
                    >
                      {note.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {sameDayEvents.length > 0 && (
              <div className="space-graph-dossier-neighbors">
                <span>当日安排</span>
                <div>
                  {sameDayEvents.map((event) => (
                    <button
                      type="button"
                      key={event.id}
                      onClick={() => openNode(event.noteId)}
                      style={{
                        "--neighbor-accent": event.phase === "upcoming"
                          ? WARM_ACCENT
                          : PAST_EVENT_ACCENT,
                      } as CSSProperties}
                    >
                      {event.time ? `${event.time} ` : ""}{event.company}・{event.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <code>{selectedNote.path}</code>
          </div>
          <button
            type="button"
            className="space-graph-enter-memory"
            onClick={() => openNode(selectedNote.id)}
          >
            <span>
              <small>ENTER MEMORY</small>
              展开完整记忆
            </span>
            <b aria-hidden="true">→</b>
          </button>
          <footer>
            <span>双击星体或按 <kbd>Enter</kbd> 也可穿越</span>
            <button type="button" onClick={() => setShortcutHelp(true)}>
              查看快捷键 <kbd>?</kbd>
            </button>
          </footer>
        </aside>
      )}
      {openingDisplay && (
        <StagePortal
          accent={openingDisplay.accent}
          kicker="TIME GATE · SYNCHRONIZING"
          title={openingDisplay.title}
          note="正在展开完整记忆"
        />
      )}
      <StageControls
        fullscreen={fullscreen}
        fullscreenAriaLabel="全屏查看时间航道，快捷键 F"
        onToggleFullscreen={() => void toggleFullscreen()}
        resetLabel="回到当下"
        onResetView={() => resetViewRef.current()}
        paused={paused}
        onTogglePaused={() => setPaused((value) => !value)}
        shortcutHelp={shortcutHelp}
        onToggleShortcuts={() => setShortcutHelp((current) => !current)}
        extra={(
          <>
            <button
              type="button"
              aria-pressed={viewMode === "cruise"}
              aria-label={viewMode === "overview" ? "切换到隧道内巡航视角" : "切换到俯瞰整条时间线的视角"}
              onClick={toggleViewMode}
            >
              {viewMode === "overview" ? "巡航视角" : "俯瞰全线"} <kbd>V</kbd>
            </button>
            <button
              type="button"
              aria-label="回到更近的一天"
              onClick={() => stepStationRef.current(-1)}
            >
              上一天
            </button>
            <button
              type="button"
              aria-label="驶向更早的一天"
              onClick={() => stepStationRef.current(1)}
            >
              下一天
            </button>
          </>
        )}
      />
      {shortcutHelp && (
        <StageShortcuts
          title="航道快捷键"
          ariaLabel="时间航道快捷键"
          onClose={() => setShortcutHelp(false)}
          entries={[
            { keys: ["/"], label: "全文搜索" },
            { keys: ["V"], label: "俯瞰／巡航切换" },
            { keys: ["F"], label: "全屏" },
            { keys: ["D"], label: "档案居中／停靠" },
            { keys: ["O"], label: "打开完整记忆" },
            { keys: ["＋", "－"], label: "文字缩放" },
            { keys: ["0"], label: "恢复 100%" },
            { keys: ["←", "→"], label: "按时间切换记忆" },
            { keys: ["[", "]"], label: "月份跳跃" },
            { keys: ["Home"], label: "回到当下" },
            { keys: ["End"], label: "最早的一站" },
            { keys: ["P"], label: "暂停／继续动态" },
            { keys: ["R"], label: "回到当下" },
          ]}
        />
      )}
      <div className="space-graph-caption">
        <span>滚轮穿行 · 单击锁定 · 双击穿越</span>
        <strong>
          {scene.notes.length} 篇记忆 · {scene.stations.length} 天
          {scene.events.length > 0 ? ` · ${scene.events.length} 场日程` : ""}
        </strong>
      </div>
      <div
        ref={scrubberRef}
        className="time-corridor-scrubber"
        role="group"
        aria-label="按月份跳转时间航道"
      >
        <i className="time-corridor-scrubber-progress" aria-hidden="true" />
        <div>
          {scene.months.map((month, index) => (
            <button
              type="button"
              key={month.key}
              title={`${month.label} · ${month.noteCount} 篇记忆`}
              style={{
                "--bucket-scale": Math.sqrt(month.noteCount) / Math.sqrt(maxMonthCount),
              } as CSSProperties}
              onClick={() => goToMonthRef.current(index)}
            >
              <i aria-hidden="true" />
              <span>{month.label}</span>
            </button>
          ))}
        </div>
      </div>
      <details className="space-graph-index">
        <summary>用列表访问全部记忆</summary>
        <div>
          {scene.notes.map((note) => (
            <button type="button" key={note.id} onClick={() => openNode(note.id)}>
              <i style={{ background: note.color }} />
              <span>{note.title}</span>
              <small>{scene.stations[note.dayIndex]?.dateLabel}</small>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
