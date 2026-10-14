import type { NoxFlowSpec } from "./response-spec";

/** Deterministic compact SVG layout for validated directed acyclic graphs.
 * One centered node per row intentionally prioritizes narrow Obsidian sidebars.
 * Never mutates learning state or executes model-supplied source.
 */
export interface NoxFlowLayoutNode extends NoxFlowSpec["nodes"][number] {
  x: number; y: number; width: number; height: number; rank: number;
}
export interface NoxFlowLayoutEdge {
  from: string; to: string; label?: string; path: string;
}
export interface NoxFlowLayout {
  width: number; height: number;
  nodes: NoxFlowLayoutNode[];
  edges: NoxFlowLayoutEdge[];
}

const CANVAS_WIDTH = 360;
const NODE_WIDTH = 224;
const NODE_HEIGHT = 54;
const TOP = 12;
const ROW_GAP = 32;
const LEVEL_GAP = 16;

export function layoutNoxFlow(spec: NoxFlowSpec): NoxFlowLayout {
  const nodesById = new Map(spec.nodes.map(node => [node.id, node]));
  const parents = new Map(spec.nodes.map(node => [node.id, [] as string[]]));
  for (const edge of spec.edges) parents.get(edge.to)?.push(edge.from);

  const cache = new Map<string, number>();
  const rank = (id: string): number => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    // parseNoxFlow has already rejected cycles and unknown references.
    const depth = Math.max(0, ...(parents.get(id) ?? []).map(parent => rank(parent) + 1));
    cache.set(id, depth);
    return depth;
  };
  for (const node of spec.nodes) rank(node.id);

  const original = new Map(spec.nodes.map((node, index) => [node.id, index]));
  const ordered = [...spec.nodes].sort((a, b) =>
    rank(a.id) - rank(b.id) ||
    (spec.layout === "layered"
      ? (Math.min(...(parents.get(a.id) ?? []).map(id => original.get(id) ?? 0), original.get(a.id) ?? 0) -
        Math.min(...(parents.get(b.id) ?? []).map(id => original.get(id) ?? 0), original.get(b.id) ?? 0))
      : 0) ||
    (original.get(a.id) ?? 0) - (original.get(b.id) ?? 0));

  const positioned: NoxFlowLayoutNode[] = [];
  let y = TOP, lastRank = -1;
  for (const node of ordered) {
    const level = rank(node.id);
    if (lastRank !== -1 && level !== lastRank) y += LEVEL_GAP;
    positioned.push({
      ...node, rank: level,
      x: (CANVAS_WIDTH - NODE_WIDTH) / 2, y,
      width: NODE_WIDTH, height: NODE_HEIGHT,
    });
    y += NODE_HEIGHT + ROW_GAP;
    lastRank = level;
  }

  const placed = new Map(positioned.map((node, index) => [node.id, { node, index }]));
  const edges: NoxFlowLayoutEdge[] = [];
  for (const [index, edge] of spec.edges.entries()) {
    const source = placed.get(edge.from), target = placed.get(edge.to);
    if (!source || !target) continue;
    const cx = CANVAS_WIDTH / 2, fromY = source.node.y + NODE_HEIGHT, toY = target.node.y;
    if (target.index === source.index + 1) {
      edges.push({ ...edge, path: `M ${cx} ${fromY} L ${cx} ${toY - 5}` });
      continue;
    }
    const lane = index % 2 ? 337 - (index % 3) * 5 : 23 + (index % 3) * 5;
    const middleStart = Math.min(fromY + 12, toY - 18);
    const middleEnd = Math.max(middleStart + 3, toY - 16);
    const path = `M ${cx} ${fromY} L ${cx} ${middleStart - 6} Q ${cx} ${middleStart} ${lane} ${middleStart} L ${lane} ${middleEnd} Q ${lane} ${toY - 5} ${cx} ${toY - 5}`;
    edges.push({ ...edge, path });
  }
  return { width: CANVAS_WIDTH, height: Math.max(100, y - ROW_GAP + TOP), nodes: positioned, edges };
}
