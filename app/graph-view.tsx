"use client";

import {
  memo,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  KnowledgeGraphSceneLink,
  KnowledgeGraphSceneNode,
} from "./knowledge-graph-three";
import {
  buildKnowledgeGraph,
  GRAPH_RELATION_LABELS,
  selectKnowledgeGraphView,
  type GraphNodeKind,
  type GraphViewMode,
  type KnowledgeGraph,
} from "@/lib/knowledge-graph";
import { formatDate, type Note } from "@/lib/notes";
import {
  GROUPS,
  seeded,
  typeLabel,
  type GroupKey,
} from "@/lib/memory-atlas-data";
import { enumCodec, useUrlState, type UrlStateCodec } from "./use-url-state";
import { type UiLocale } from "@/lib/ui-locale";
import { UI_THEME_EVENT } from "@/lib/ui-theme";
import { useUiLocale } from "./ui-locale";

const graphZh = {
  graph: "关系图", relations: "关系", relationScope: "关系范围", semantic: "语义关系", allRelations: "全部关系",
  semanticHint: "只看 frontmatter 声明的强类型关系（关于公司・派生自・要求技能…）",
  allRelationsHint: "语义关系＋正文里的普通双链，全部显示",
  node: "节点", nodeKind: "节点类型", kinds: { all: "全部", note: "笔记", company: "公司", skill: "技能" },
  renderer: "关系图显示方式", view: "视图", space: "探索模式 · 3D", map: "关系地图",
  searchPlaceholder: "搜索公司、技能或笔记，建立局部关系图", searchLabel: "搜索关系图中心节点",
  focus: "当前中心", reselect: "重新选择", selectFocus: "选择关系图中心节点",
  selectResult: "选择一个搜索结果", start: "先从一个对象开始",
  allRelationsAction: "切到「全部关系」查看", legend: "图例", spaceLegend: "星系图例", typedRelations: "强类型关系",
  filterLabel: "按分区筛选", emptyGroup: "当前视图下该分区没有节点",
  groups: { self: "关于我", career: "求职", study: "日语学习", analysis: "AI 分析", system: "系统" } satisfies Record<GroupKey, string>,
};
type GraphCopy = typeof graphZh;
const GRAPH_COPY: Record<UiLocale, GraphCopy> = {
  "zh-CN": graphZh,
  ja: {
    graph: "関係図", relations: "関係", relationScope: "関係の範囲", semantic: "意味関係", allRelations: "すべての関係",
    semanticHint: "frontmatter で明示した型付きの関係のみ表示（企業について・派生元・必要スキルなど）",
    allRelationsHint: "意味関係と本文中の通常リンクをすべて表示",
    node: "ノード", nodeKind: "ノードの種類", kinds: { all: "すべて", note: "ノート", company: "企業", skill: "スキル" },
    renderer: "関係図の表示方法", view: "表示", space: "探索モード · 3D", map: "関係マップ",
    searchPlaceholder: "企業・スキル・ノートを検索して周辺の関係を表示", searchLabel: "関係図の中心ノードを検索",
    focus: "現在の中心", reselect: "選び直す", selectFocus: "関係図の中心ノードを選択",
    selectResult: "検索結果を選択", start: "まず対象を選択",
    allRelationsAction: "「すべての関係」を表示", legend: "凡例", spaceLegend: "星図の凡例", typedRelations: "型付きの関係",
    filterLabel: "カテゴリで絞り込み", emptyGroup: "現在の表示ではこのカテゴリにノードがありません",
    groups: { self: "自己紹介", career: "就職活動", study: "日本語学習", analysis: "AI 分析", system: "システム" },
  },
};

// 关系范围・节点类型・中心节点放进 URL：打开笔记再返回、或刷新后，局部图仍围着同一个中心。
// 分区与检索词归外壳（q / group），这里不碰。
const MODE_CODEC = enumCodec<GraphViewMode>(["semantic", "all"]);
const KIND_CODEC = enumCodec<GraphNodeKind | "all">(["all", "note", "company", "skill"]);
// null＝还没选中心。中心 id 已不在图里（笔记改名・删除）时，focusedNode 为 null，自然回到「先选一个对象」。
const FOCUS_CODEC: UrlStateCodec<string | null> = {
  parse: (raw) => raw || null,
  serialize: (value) => value ?? "",
};

const ThreeKnowledgeGraph = lazy(() => import("./knowledge-graph-three"));

type GraphScene = {
  nodes: KnowledgeGraphSceneNode[];
  links: KnowledgeGraphSceneLink[];
};

function buildKnowledgeGraphScene(
  graph: KnowledgeGraph,
  mode: GraphViewMode,
  filter: GroupKey | "all",
  kind: GraphNodeKind | "all",
): GraphScene {
  const view = selectKnowledgeGraphView(graph, { mode, group: filter, kind });
  const degree = new Map<string, number>();
  const outbound = new Map<string, number>();
  view.edges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    outbound.set(edge.source, (outbound.get(edge.source) ?? 0) + 1);
  });

  return {
    nodes: view.nodes.map((node) => {
      const group = node.group as GroupKey;
      const entityColor = node.kind === "company"
        ? "#54b990"
        : node.kind === "skill"
          ? "#e48a58"
          : GROUPS[group].color;
      return {
        id: node.id,
        title: node.label,
        nodeKind: node.kind,
        group,
        groupLabel: GROUPS[group].label,
        color: entityColor,
        degree: degree.get(node.id) ?? 0,
        path: node.pathLabel,
        kindLabel: node.kind === "company"
          ? "公司实体"
          : node.kind === "skill"
            ? "技能实体"
            : typeLabel(node.noteType ?? "note"),
        updatedLabel: node.kind === "note" ? formatDate(node.updatedAt, true) : "实时派生",
        outbound: outbound.get(node.id) ?? 0,
        excerpt: node.excerpt,
        openable: node.openable,
      };
    }),
    links: view.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      relationLabel: GRAPH_RELATION_LABELS[edge.relation],
      directed: edge.directed,
    })),
  };
}

function graphNeighborhood(scene: GraphScene, focusId: string | null): GraphScene {
  if (!focusId || !scene.nodes.some((node) => node.id === focusId)) return { nodes: [], links: [] };
  const neighborIds = new Set<string>([focusId]);
  const firstHop = scene.links
    .filter((link) => link.source === focusId || link.target === focusId)
    .toSorted((left, right) => left.relation.localeCompare(right.relation))
    .slice(0, 28);
  firstHop.forEach((link) => {
    neighborIds.add(link.source);
    neighborIds.add(link.target);
  });
  const links = scene.links.filter((link) => neighborIds.has(link.source) && neighborIds.has(link.target));
  return {
    nodes: scene.nodes.filter((node) => neighborIds.has(node.id)),
    links,
  };
}

function GraphView({
  notes,
  filter,
  onFilter,
  onOpen,
}: {
  notes: Note[];
  filter: GroupKey | "all";
  onFilter: (filter: GroupKey | "all") => void;
  onOpen: (note: Note) => void;
}) {
  const { locale } = useUiLocale();
  const copy = GRAPH_COPY[locale];
  const [renderer, setRenderer] = useState<"space" | "map">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("echo.graph.renderer") === "space"
      ? "space"
      : "map",
  );
  const [mode, setMode] = useUrlState<GraphViewMode>("mode", "semantic", MODE_CODEC);
  const [kind, setKind] = useUrlState<GraphNodeKind | "all">("kind", "all", KIND_CODEC);
  const [focusId, setFocusId] = useUrlState<string | null>("focus", null, FOCUS_CODEC);
  const [graphQuery, setGraphQuery] = useState("");
  useEffect(() => window.localStorage.setItem("echo.graph.renderer", renderer), [renderer]);
  const graph = useMemo(() => buildKnowledgeGraph(notes), [notes]);
  const fullScene = useMemo(
    () => buildKnowledgeGraphScene(graph, mode, filter, kind),
    [filter, graph, kind, mode],
  );
  const localScene = useMemo(() => graphNeighborhood(fullScene, focusId), [focusId, fullScene]);
  // 3D 是主动进入的探索层，保留全图；默认 2D 只承担围绕一个对象的检索。
  const scene = renderer === "space" ? fullScene : localScene;
  const graphSearchResults = useMemo(() => {
    const normalized = graphQuery.trim().toLocaleLowerCase();
    return fullScene.nodes
      .filter((node) => !normalized || `${node.title} ${node.path} ${node.excerpt}`.toLocaleLowerCase().includes(normalized))
      .toSorted((left, right) => right.degree - left.degree || left.title.localeCompare(right.title))
      .slice(0, normalized ? 12 : 8);
  }, [fullScene.nodes, graphQuery]);
  const focusedNode = fullScene.nodes.find((node) => node.id === focusId) ?? null;
  const legendScene = renderer === "map" && !focusedNode ? fullScene : scene;
  // 分区ボタンには「今のモードで何件出るか」を出す。0 のまま押せると
  // 「データが入っていない」と誤解する（日本語学習・系统が既定ビューで丸ごと消えていた）。
  const modeCounts = useMemo(() => {
    const counts = Object.fromEntries(
      (Object.keys(GROUPS) as GroupKey[]).map((group) => [group, 0]),
    ) as Record<GroupKey, number>;
    for (const node of selectKnowledgeGraphView(graph, { mode, group: "all", kind }).nodes) {
      counts[node.group as GroupKey] += 1;
    }
    return counts;
  }, [graph, kind, mode]);
  const emptyGroup = filter !== "all" && fullScene.nodes.length === 0;
  // 「全部关系」に切り替えれば実際に出るときだけ、そう案内する。
  // 空の原因が节点类型フィルタ側のときに「双链だから」と説明すると帰因を誤る。
  const recoverableInAllMode = useMemo(() => {
    if (!emptyGroup || mode !== "semantic") return false;
    return selectKnowledgeGraphView(graph, { mode: "all", group: filter, kind }).nodes.length > 0;
  }, [emptyGroup, filter, graph, kind, mode]);
  const noteByPath = useMemo(
    () => new Map(notes.map((note) => [note.path, note])),
    [notes],
  );
  const openSceneNode = useCallback((id: string) => {
    const note = noteByPath.get(id);
    if (note) onOpen(note);
  }, [noteByPath, onOpen]);
  const fallBackToMap = useCallback(() => setRenderer("map"), []);

  return (
    <section className={`graph-view${renderer === "space" ? " stage-immersive" : ""}`}>
      <h1 className="sr-only">{copy.graph}</h1>
      <div className="stage-toolbar">
        <GroupFilters value={filter} onChange={onFilter} counts={modeCounts} />
        <div className="graph-control-cluster">
          <div className="graph-renderer-toggle" role="group" aria-label={copy.relationScope}>
            <span aria-hidden="true">{copy.relations}</span>
            <button type="button" className={mode === "semantic" ? "active" : ""} aria-pressed={mode === "semantic"} onClick={() => setMode("semantic")} title={copy.semanticHint}>{copy.semantic}</button>
            <button type="button" className={mode === "all" ? "active" : ""} aria-pressed={mode === "all"} onClick={() => setMode("all")} title={copy.allRelationsHint}>{copy.allRelations}</button>
          </div>
          <div className="graph-renderer-toggle" role="group" aria-label={copy.nodeKind}>
            <span aria-hidden="true">{copy.node}</span>
            {(["all", "note", "company", "skill"] as const).map((value) => (
              <button key={value} type="button" className={kind === value ? "active" : ""} aria-pressed={kind === value} onClick={() => setKind(value)}>
                {copy.kinds[value]}
              </button>
            ))}
          </div>
          <div className="graph-renderer-toggle" role="group" aria-label={copy.renderer}>
            <span aria-hidden="true">{copy.view}</span>
            <button type="button" className={renderer === "space" ? "active" : ""} aria-pressed={renderer === "space"} onClick={() => setRenderer("space")}>{copy.space}</button>
            <button type="button" className={renderer === "map" ? "active" : ""} aria-pressed={renderer === "map"} onClick={() => setRenderer("map")}>{copy.map}</button>
          </div>
        </div>
      </div>
      {renderer === "map" && (
        <div className="graph-focus-bar">
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              value={graphQuery}
              onChange={(event) => setGraphQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
              aria-label={copy.searchLabel}
            />
          </label>
          {focusedNode && (
            <div>
              <small>{copy.focus}</small>
              <strong>{focusedNode.title}</strong>
              <span>{localScene.nodes.length} 节点 · {localScene.links.length} 关系</span>
              <button type="button" onClick={() => setFocusId(null)}>{copy.reselect}</button>
            </div>
          )}
        </div>
      )}
      <div className="graph-layout" data-renderer={renderer}>
        {emptyGroup && (
          <div className="graph-empty-note" role="status">
            <strong>「{GROUPS[filter as GroupKey].label}」在当前视图下没有节点</strong>
            {recoverableInAllMode ? (
              <>
                <p>
                  这个分区的笔记之间只有正文里的普通双链，没有 frontmatter 声明的强类型关系，
                  所以「语义关系」视图不会显示它们。
                </p>
                <button type="button" onClick={() => setMode("all")}>{copy.allRelationsAction}</button>
              </>
            ) : (
              <p>换一个分区，或把「节点类型」切回「全部」再看。</p>
            )}
          </div>
        )}
        {renderer === "map" && !focusedNode ? (
          <section className="graph-start" aria-label={copy.selectFocus}>
            <header>
              <span>START LOCAL</span>
              <h2>{graphQuery ? copy.selectResult : copy.start}</h2>
              <p>选择公司、技能或笔记后，只显示它的一跳邻域。需要鸟瞰全部关系时，再切到 3D 探索模式。</p>
            </header>
            <div className="graph-start-results">
              {graphSearchResults.map((node) => (
                <button key={node.id} type="button" onClick={() => { setFocusId(node.id); setGraphQuery(""); }}>
                  <span>{node.nodeKind === "company" ? copy.kinds.company : node.nodeKind === "skill" ? copy.kinds.skill : node.kindLabel}</span>
                  <strong>{node.title}</strong>
                  <small>{node.degree} 条直接关系</small>
                </button>
              ))}
              {graphSearchResults.length === 0 && <p>没有匹配的节点。试试更短的关键词。</p>}
            </div>
          </section>
        ) : renderer === "space" ? (
          <Suspense
            fallback={(
              <div className="space-graph-loading space-graph-loading-shell" role="status">
                <i />
                <span>正在载入星图引擎</span>
              </div>
            )}
          >
            {/* 3D 锁定的节点与 2D 关系地图的中心共用 ?focus=：切换视图、刷新后停在同一个节点。 */}
            <ThreeKnowledgeGraph
              nodes={scene.nodes}
              links={scene.links}
              onOpen={openSceneNode}
              onFallback={fallBackToMap}
              initialFocusId={focusId}
              onFocusChange={setFocusId}
            />
          </Suspense>
        ) : (
          <CanvasKnowledgeGraph nodes={scene.nodes} links={scene.links} onOpen={openSceneNode} />
        )}
        <aside className="graph-legend">
          {/* 图例、分区筛选点和悬停提示是节点颜色的钥匙：2D/3D 节点不随皮肤换色，这里也用固定的 color，
              换成 cssVar 会让图例和节点对不上。 */}
          <span>{renderer === "space" ? copy.spaceLegend : copy.legend}</span>
          {(Object.keys(GROUPS) as GroupKey[]).map((group) => (
            <button key={group} onClick={() => onFilter(group)}>
              <i style={{ background: GROUPS[group].color }} />
              <span>{copy.groups[group]}</span>
              <strong>{legendScene.nodes.filter((node) => node.group === group).length}</strong>
            </button>
          ))}
          <div className="graph-relation-summary">
            <span>{mode === "semantic" ? copy.typedRelations : copy.allRelations}</span>
            <strong>{legendScene.links.length}</strong>
          </div>
          <div className="legend-rule"><span>小</span><i /><i /><i /><span>被引用多</span></div>
        </aside>
      </div>
    </section>
  );
}

function GroupFilters({ value, onChange, counts }: {
  value: GroupKey | "all";
  onChange: (value: GroupKey | "all") => void;
  counts?: Record<GroupKey, number>;
}) {
  const { locale } = useUiLocale();
  const copy = GRAPH_COPY[locale];
  return (
    <div className="group-filters" aria-label={copy.filterLabel}>
      <button className={value === "all" ? "active" : ""} onClick={() => onChange("all")}>{copy.kinds.all}</button>
      {(Object.keys(GROUPS) as GroupKey[]).map((group) => {
        const count = counts?.[group];
        return (
          <button
            key={group}
            className={`${value === group ? "active" : ""}${count === 0 ? " empty" : ""}`}
            onClick={() => onChange(group)}
            title={count === 0 ? copy.emptyGroup : undefined}
          >
            <i style={{ background: GROUPS[group].color }} />{copy.groups[group]}
            {count !== undefined && <b>{count}</b>}
          </button>
        );
      })}
    </div>
  );
}

/*
 * 2D 关系图的底色跟皮肤走：浅色取反相面、暗色取凸起面，与总览的关系图预览面板同一套映射。
 * 暗色不用反相面：它比浮层还亮一级（默认皮肤下 #26392f），会把原来的深底整块提亮。
 * 各皮肤这两档都是深色，白色半透明的连线、节点描边和标签照旧可读，所以它们不跟着换。
 * 节点填色仍是 GROUPS 的固定 hex，和 3D 星图、图例保持同色。
 */
const CANVAS_BACKDROP_FALLBACK = "#18231e";

function canvasBackdrop(canvas: HTMLCanvasElement) {
  const token = document.documentElement.dataset.theme === "light" ? "--surface-inverse" : "--surface-raised-solid";
  // 自定义属性的计算值已替换掉 var()，canvas 能直接解析；取不到就回落原色。
  return getComputedStyle(canvas).getPropertyValue(token).trim() || CANVAS_BACKDROP_FALLBACK;
}

type GraphPoint = {
  node: KnowledgeGraphSceneNode;
  x: number;
  y: number;
  radius: number;
  group: GroupKey;
  degree: number;
};

function CanvasKnowledgeGraph({
  nodes,
  links,
  onOpen,
}: {
  nodes: KnowledgeGraphSceneNode[];
  links: KnowledgeGraphSceneLink[];
  onOpen: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<GraphPoint[]>([]);
  const [hovered, setHovered] = useState<GraphPoint | null>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });
  // 切明暗或皮肤不会让这棵树重渲染，canvas 自己取的底色要靠这个计数触发重画。
  const [themeVersion, setThemeVersion] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const repaint = () => setThemeVersion((version) => version + 1);
    window.addEventListener(UI_THEME_EVENT, repaint);
    return () => window.removeEventListener(UI_THEME_EVENT, repaint);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const centers: Record<GroupKey, [number, number]> = {
      self: [0.26, 0.28], career: [0.7, 0.3], study: [0.28, 0.72], analysis: [0.7, 0.72], system: [0.5, 0.5],
    };
    const points: GraphPoint[] = nodes.map((node, index) => {
      const group = node.group as GroupKey;
      const [centerX, centerY] = centers[group];
      const angle = seeded(node.id) * Math.PI * 2;
      const ring = 38 + (index % 5) * 21 + seeded(`${node.id}-r`) * 18;
      return {
        node,
        group,
        x: centerX * size.width + Math.cos(angle) * ring,
        y: centerY * size.height + Math.sin(angle) * ring * 0.72,
        radius: 4.5 + Math.min(8, node.degree * 1.25),
        degree: node.degree,
      };
    });
    pointsRef.current = points;
    const pointByPath = new Map(points.map((point) => [point.node.id, point]));
    const labelLimit = nodes.length > 80 ? 4 : 12;
    const labelPaths = new Set(
      (Object.keys(GROUPS) as GroupKey[])
        .flatMap((group) =>
          points
            .filter((point) => point.group === group)
            .toSorted((left, right) => right.degree - left.degree)
            .slice(0, labelLimit)
            .map((point) => point.node.id),
        ),
    );

    context.clearRect(0, 0, size.width, size.height);
    // 先铺回落色：token 的值 canvas 解析不了时，赋值会被忽略，画面停在原来的底色上。
    context.fillStyle = CANVAS_BACKDROP_FALLBACK;
    context.fillStyle = canvasBackdrop(canvas);
    context.fillRect(0, 0, size.width, size.height);
    context.fillStyle = "rgba(255,255,255,.055)";
    for (let x = 18; x < size.width; x += 24) {
      for (let y = 18; y < size.height; y += 24) {
        context.beginPath(); context.arc(x, y, 1, 0, Math.PI * 2); context.fill();
      }
    }

    context.lineWidth = 1;
    links.forEach((link) => {
      const source = pointByPath.get(link.source);
      const target = pointByPath.get(link.target);
      if (!source || !target) return;
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.strokeStyle = link.relation === "references"
        ? "rgba(208, 223, 213, .12)"
        : "rgba(208, 238, 220, .28)";
      context.stroke();
    });

    points.forEach((point) => {
      const active = hovered?.node.id === point.node.id;
      if (active) {
        context.beginPath(); context.arc(point.x, point.y, point.radius + 8, 0, Math.PI * 2);
        context.fillStyle = "rgba(255,255,255,.12)"; context.fill();
      }
      context.beginPath(); context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.fillStyle = point.node.color; context.fill();
      context.strokeStyle = active ? "#fff" : "rgba(255,255,255,.45)";
      context.lineWidth = active ? 2 : 1; context.stroke();
      if (labelPaths.has(point.node.id) || active) {
        context.font = `${active ? 600 : 500} ${active ? 13 : 11}px system-ui, sans-serif`;
        context.fillStyle = active ? "#ffffff" : "rgba(244,245,238,.78)";
        context.textAlign = "center";
        context.fillText(point.node.title.slice(0, 18), point.x, point.y + point.radius + 17);
      }
    });
  }, [hovered, links, nodes, size, themeVersion]);

  const findPoint = (event: {
    currentTarget: HTMLCanvasElement;
    clientX: number;
    clientY: number;
  }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return pointsRef.current.find((point) => Math.hypot(point.x - x, point.y - y) <= point.radius + 8) ?? null;
  };

  return (
    <div className="graph-canvas-wrap">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Obsidian 记忆关系图，共 ${nodes.length} 个节点、${links.length} 条关系`}
        onPointerMove={(event) => setHovered(findPoint(event))}
        onPointerLeave={() => setHovered(null)}
        onClick={(event) => {
          const point = findPoint(event);
          if (point?.node.openable) onOpen(point.node.id);
        }}
      />
      <div className="graph-caption"><span>移动鼠标探索节点</span><strong>{nodes.length} 个节点 · {links.length} 条关系</strong></div>
      {hovered && (
        <div className="graph-tooltip">
          <span className="accent-ink" style={{ "--accent": hovered.node.color } as CSSProperties}>{hovered.node.kindLabel} · {hovered.node.groupLabel}</span>
          <strong>{hovered.node.title}</strong>
          <small>{hovered.degree} 条关系{hovered.node.openable ? " · 点击查看" : " · 派生实体"}</small>
        </div>
      )}
    </div>
  );
}

// 外壳的 UI state（⌘K・overlay・移动端菜单）变化时不重渲染整个视圖。
// props 都是稳定引用（notes 整体替换・useCallback 回调・原始值），memo 直接命中。
export default memo(GraphView);
