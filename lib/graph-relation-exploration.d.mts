export type RelationNode = { id: string; degree?: number };
export type RelationLink = {
  source: string;
  target: string;
  relation?: string;
  relationLabel?: string;
  directed?: boolean;
};

export function relationExploration<TLink extends RelationLink>(
  nodes: readonly RelationNode[],
  links: readonly TLink[],
  sourceId: string | null,
  targetId: string | null,
  maxEdges?: number,
): {
  connected: boolean;
  pathIds: string[];
  pathLinks: TLink[];
  commonNeighborIds: string[];
};
