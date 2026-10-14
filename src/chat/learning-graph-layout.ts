/** Pure, bounded vertical prerequisite layout; learning state stays authoritative elsewhere. */
export interface LearningMapItem {
  id: string;
  title: string;
  status: string;
  prerequisiteIds: string[];
}
export interface LearningMapNode extends LearningMapItem {
  level: number;
  x: number;
  y: number;
}
export interface LearningMapEdge {
  from: string;
  to: string;
  x1: number; y1: number; x2: number; y2: number;
}
export interface LearningMapLayout {
  nodes: LearningMapNode[];
  edges: LearningMapEdge[];
  width: number;
  height: number;
  problem?: "cycle" | "large";
}
const NODE_WIDTH = 192;
const NODE_HEIGHT = 46;
const ROW_GAP = 22;
const RANK_GAP = 16;
const LIMIT = 40;
const NODE_X = 24;

export function layoutLearningMap(items: readonly LearningMapItem[]): LearningMapLayout {
  const empty = (problem?: "cycle" | "large"): LearningMapLayout =>
    ({ nodes: [], edges: [], width: 0, height: 0, problem });
  if (items.length > LIMIT) return empty("large");
  const map = new Map(items.map(item => [item.id, item]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  let cyclic = false;
  const depth = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) { cyclic = true; return 0; }
    visiting.add(id);
    const item = map.get(id);
    const dependencies = (item?.prerequisiteIds ?? []).filter(dependency => map.has(dependency));
    const result = dependencies.length ? 1 + Math.max(...dependencies.map(depth)) : 0;
    visiting.delete(id);
    memo.set(id, result);
    return result;
  };
  for (const item of items) depth(item.id);
  if (cyclic) return empty("cycle");

  const levels = new Map<number, LearningMapItem[]>();
  for (const item of items) {
    const level = memo.get(item.id) ?? 0;
    const group = levels.get(level) ?? [];
    group.push(item);
    levels.set(level, group);
  }
  const nodes: LearningMapNode[] = [];
  let y = 12, lastRank = -1;
  for (const [level, group] of [...levels].sort(([a], [b]) => a - b)) {
    group.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    if (lastRank !== -1) y += RANK_GAP;
    for (const item of group) {
      nodes.push({ ...item, level, x: NODE_X, y });
      y += NODE_HEIGHT + ROW_GAP;
    }
    lastRank = level;
  }
  const position = new Map(nodes.map(node => [node.id, node]));
  const edges: LearningMapEdge[] = [];
  for (const node of nodes) {
    for (const id of node.prerequisiteIds) {
      const prerequisite = position.get(id);
      if (prerequisite) edges.push({ from: id, to: node.id,
        x1: prerequisite.x + NODE_WIDTH / 2, y1: prerequisite.y + NODE_HEIGHT,
        x2: node.x + NODE_WIDTH / 2, y2: node.y });
    }
  }
  return { nodes, edges, width: NODE_X * 2 + NODE_WIDTH,
    height: Math.max(0, y - ROW_GAP + 12) };
}

export const LEARNING_MAP_NODE_SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT } as const;
