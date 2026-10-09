function edgeKey(left, right) {
  return `${left}\u0000${right}`;
}

/**
 * 关系探索只读现有可见边。BFS 邻接表按 id 排序，因此同长度路径每次都选择同一条，
 * 不会因为 Map 插入顺序或渲染筛选重建而在两条路径间闪烁。
 */
export function relationExploration(nodes, links, sourceId, targetId, maxEdges = 6) {
  const nodeById = new Map((Array.isArray(nodes) ? nodes : []).map((node) => [node.id, node]));
  if (!sourceId || !targetId || sourceId === targetId) {
    return { connected: false, pathIds: [], pathLinks: [], commonNeighborIds: [] };
  }
  const adjacency = new Map();
  const edges = new Map();
  (Array.isArray(links) ? links : []).forEach((link) => {
    if (!nodeById.has(link.source) || !nodeById.has(link.target)) return;
    if (!adjacency.has(link.source)) adjacency.set(link.source, new Set());
    if (!adjacency.has(link.target)) adjacency.set(link.target, new Set());
    adjacency.get(link.source).add(link.target);
    adjacency.get(link.target).add(link.source);
    if (!edges.has(edgeKey(link.source, link.target))) {
      edges.set(edgeKey(link.source, link.target), link);
    }
    if (!edges.has(edgeKey(link.target, link.source))) {
      edges.set(edgeKey(link.target, link.source), link);
    }
  });

  const sourceNeighbors = adjacency.get(sourceId) ?? new Set();
  const targetNeighbors = adjacency.get(targetId) ?? new Set();
  const commonNeighborIds = [...sourceNeighbors]
    .filter((id) => targetNeighbors.has(id))
    .toSorted((left, right) => {
      const degree = (nodeById.get(right)?.degree ?? 0) - (nodeById.get(left)?.degree ?? 0);
      return degree || String(left).localeCompare(String(right));
    })
    .slice(0, 8);

  const queue = [[sourceId]];
  const visited = new Set([sourceId]);
  let pathIds = [];
  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    if (path.length - 1 >= maxEdges) continue;
    const neighbors = [...(adjacency.get(current) ?? [])]
      .toSorted((left, right) => String(left).localeCompare(String(right)));
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      const nextPath = [...path, neighbor];
      if (neighbor === targetId) {
        pathIds = nextPath;
        queue.length = 0;
        break;
      }
      visited.add(neighbor);
      queue.push(nextPath);
    }
  }

  const pathLinks = [];
  for (let index = 1; index < pathIds.length; index += 1) {
    const link = edges.get(edgeKey(pathIds[index - 1], pathIds[index]));
    if (link) pathLinks.push(link);
  }
  return {
    connected: pathIds.length > 1,
    pathIds,
    pathLinks,
    commonNeighborIds,
  };
}
