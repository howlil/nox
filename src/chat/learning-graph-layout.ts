/** Pure, bounded graph layout; presentation only, never changes curriculum state. */
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
const NODE_WIDTH = 154;
const NODE_HEIGHT = 42;
const LEVEL_GAP = 26;
const ROW_GAP = 12;
const LIMIT = 40;

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
  for (const [level, group] of [...levels].sort(([a], [b]) => a - b)) {
    group.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    group.forEach((item, index) => {
      nodes.push({ ...item, level, x: 10 + level * (NODE_WIDTH + LEVEL_GAP),
        y: 10 + index * (NODE_HEIGHT + ROW_GAP) });
    });
  }
  const position = new Map(nodes.map(node => [node.id, node]));
  const edges: LearningMapEdge[] = [];
  for (const node of nodes) {
    for (const id of node.prerequisiteIds) {
      const prerequisite = position.get(id);
      if (prerequisite) edges.push({ from: id, to: node.id,
        x1: prerequisite.x + NODE_WIDTH, y1: prerequisite.y + NODE_HEIGHT / 2,
        x2: node.x, y2: node.y + NODE_HEIGHT / 2 });
    }
  }
  return { nodes, edges,
    width: 20 + (Math.max(0, ...nodes.map(node => node.level)) + 1) * (NODE_WIDTH + LEVEL_GAP),
    height: 20 + Math.max(1, ...[...levels.values()].map(group => group.length)) * (NODE_HEIGHT + ROW_GAP) };
}

export const LEARNING_MAP_NODE_SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT } as const;
