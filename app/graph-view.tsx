"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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

const ThreeKnowledgeGraph = lazy(() => import("./knowledge-graph-three"));

function buildKnowledgeGraphScene(
  graph: KnowledgeGraph,
  mode: GraphViewMode,
  filter: GroupKey | "all",
  kind: GraphNodeKind | "all",
): {
  nodes: KnowledgeGraphSceneNode[];
  links: KnowledgeGraphSceneLink[];
} {
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

export default function GraphView({
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
  const [renderer, setRenderer] = useState<"space" | "map">("space");
  const [mode, setMode] = useState<GraphViewMode>("semantic");
  const [kind, setKind] = useState<GraphNodeKind | "all">("all");
  const graph = useMemo(() => buildKnowledgeGraph(notes), [notes]);
  const scene = useMemo(
    () => buildKnowledgeGraphScene(graph, mode, filter, kind),
    [filter, graph, kind, mode],
  );
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
  const emptyGroup = filter !== "all" && scene.nodes.length === 0;
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
    <section className="graph-view">
      <div className="module-control-row">
        <GroupFilters value={filter} onChange={onFilter} counts={modeCounts} />
        <div className="graph-control-cluster">
          <div className="graph-renderer-toggle" aria-label="关系范围">
            <button type="button" className={mode === "semantic" ? "active" : ""} onClick={() => setMode("semantic")} title="只看 frontmatter 声明的强类型关系（关于公司・派生自・要求技能…）">语义关系</button>
            <button type="button" className={mode === "all" ? "active" : ""} onClick={() => setMode("all")} title="语义关系＋正文里的普通双链，全部显示">全部关系</button>
          </div>
          <div className="graph-renderer-toggle" aria-label="节点类型">
            {(["all", "note", "company", "skill"] as const).map((value) => (
              <button key={value} type="button" className={kind === value ? "active" : ""} onClick={() => setKind(value)}>
                {{ all: "全部", note: "笔记", company: "公司", skill: "技能" }[value]}
              </button>
            ))}
          </div>
          <div className="graph-renderer-toggle" aria-label="关系图显示方式">
            <button type="button" className={renderer === "space" ? "active" : ""} onClick={() => setRenderer("space")}>3D 星图</button>
            <button type="button" className={renderer === "map" ? "active" : ""} onClick={() => setRenderer("map")}>简洁模式</button>
          </div>
        </div>
      </div>
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
                <button type="button" onClick={() => setMode("all")}>切到「全部关系」查看</button>
              </>
            ) : (
              <p>换一个分区，或把「节点类型」切回「全部」再看。</p>
            )}
          </div>
        )}
        {renderer === "space" ? (
          <Suspense
            fallback={(
              <div className="space-graph-loading space-graph-loading-shell" role="status">
                <i />
                <span>正在载入星图引擎</span>
              </div>
            )}
          >
            <ThreeKnowledgeGraph
              nodes={scene.nodes}
              links={scene.links}
              onOpen={openSceneNode}
              onFallback={fallBackToMap}
            />
          </Suspense>
        ) : (
          <CanvasKnowledgeGraph nodes={scene.nodes} links={scene.links} onOpen={openSceneNode} />
        )}
        <aside className="graph-legend">
          <span>{renderer === "space" ? "星系图例" : "图例"}</span>
          {(Object.keys(GROUPS) as GroupKey[]).map((group) => (
            <button key={group} onClick={() => onFilter(group)}>
              <i style={{ background: GROUPS[group].color }} />
              <span>{GROUPS[group].label}</span>
              <strong>{scene.nodes.filter((node) => node.group === group).length}</strong>
            </button>
          ))}
          <div className="graph-relation-summary">
            <span>{mode === "semantic" ? "强类型关系" : "全部关系"}</span>
            <strong>{scene.links.length}</strong>
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
  return (
    <div className="group-filters" aria-label="按分区筛选">
      <button className={value === "all" ? "active" : ""} onClick={() => onChange("all")}>全部</button>
      {(Object.keys(GROUPS) as GroupKey[]).map((group) => {
        const count = counts?.[group];
        return (
          <button
            key={group}
            className={`${value === group ? "active" : ""}${count === 0 ? " empty" : ""}`}
            onClick={() => onChange(group)}
            title={count === 0 ? `当前视图下该分区没有节点` : undefined}
          >
            <i style={{ background: GROUPS[group].color }} />{GROUPS[group].label}
            {count !== undefined && <b>{count}</b>}
          </button>
        );
      })}
    </div>
  );
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
    context.fillStyle = "#18231e";
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
  }, [hovered, links, nodes, size]);

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
          <span style={{ color: hovered.node.color }}>{hovered.node.kindLabel} · {hovered.node.groupLabel}</span>
          <strong>{hovered.node.title}</strong>
          <small>{hovered.degree} 条关系{hovered.node.openable ? " · 点击查看" : " · 派生实体"}</small>
        </div>
      )}
    </div>
  );
}
