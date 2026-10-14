import type { NoxFlowSpec } from "./response-spec";

/** Bounded deterministic layout for user-supplied, validated acyclic graphs.
 * Vertical-stack retains backwards compatibility for narrow single-track flows;
 * layered arranges at most three sibling nodes per row with barycentric ordering.
 */
export type NoxFlowLayoutNode = NoxFlowSpec["nodes"][number] & {
  x: number; y: number; width: number; height: number; rank: number;
};
export interface NoxFlowLayoutEdge {
  from: string; to: string; label?: string; path: string;
}
export interface NoxFlowLayout {
  width: number; height: number;
  nodes: NoxFlowLayoutNode[];
  edges: NoxFlowLayoutEdge[];
}

const STACK_WIDTH = 360;
const STACK_NODE_WIDTH = 224;
const STACK_NODE_HEIGHT = 54;
const STACK_GAP = 32;
const NODE_WIDTH = 184;
const NODE_HEIGHT = 56;
const COLUMN_GAP = 18;
const LAYER_GAP = 52;
const PADDING = 16;
const MAX_COLUMNS = 3;

export function layoutNoxFlow(spec: NoxFlowSpec): NoxFlowLayout {
  const parents = new Map(spec.nodes.map(node => [node.id, [] as string[]]));
  const children = new Map(spec.nodes.map(node => [node.id, [] as string[]]));
  for (const edge of spec.edges) {
    parents.get(edge.to)?.push(edge.from);
    children.get(edge.from)?.push(edge.to);
  }
  const original = new Map(spec.nodes.map((node, index) => [node.id, index]));
  const cache = new Map<string, number>();
  const rankOf = (id: string): number => {
    const known = cache.get(id);
    if (known !== undefined) return known;
    // parseNoxFlow rejects cycles before reaching this function.
    const depth = Math.max(0, ...(parents.get(id) ?? []).map(parent => rankOf(parent) + 1));
    cache.set(id, depth);
    return depth;
  };
  for (const node of spec.nodes) rankOf(node.id);

  let nodes: NoxFlowLayoutNode[] = [];
  let width: number;
  let height: number;

  if (spec.layout === "vertical-stack") {
    const ordered = [...spec.nodes].sort((a, b) =>
      rankOf(a.id) - rankOf(b.id) ||
      (original.get(a.id) ?? 0) - (original.get(b.id) ?? 0));
    width = STACK_WIDTH;
    let y = 12, previousRank = -1;
    for (const node of ordered) {
      const rank = rankOf(node.id);
      if (previousRank !== -1 && previousRank !== rank) y += 16;
      nodes.push({
        ...node, rank, x: (width - STACK_NODE_WIDTH) / 2, y,
        width: STACK_NODE_WIDTH, height: STACK_NODE_HEIGHT,
      });
      y += STACK_NODE_HEIGHT + STACK_GAP;
      previousRank = rank;
    }
    height = Math.max(100, y - STACK_GAP + 12);
  } else {
    const groups = new Map<number, NoxFlowSpec["nodes"]>();
    for (const node of spec.nodes) {
      const rank = rankOf(node.id);
      const group = groups.get(rank) ?? [];
      group.push(node);
      groups.set(rank, group);
    }
    // Two topological sweeps in each direction reduce crossing in compact DAGs.
    // Stable original-order fallback guarantees deterministic output.
    const levels = [...groups.keys()].sort((a, b) => a - b);
    const positioned = new Map<string, number>();
    for (let sweep = 0; sweep < 4; sweep++) {
      const forward = sweep % 2 === 0;
      for (const level of forward ? levels : [...levels].reverse()) {
        const items = groups.get(level)!;
        const neighbors = forward ? parents : children;
        const score = (id: string): number => {
          const indices = (neighbors.get(id) ?? []).map(next => positioned.get(next))
            .filter((value): value is number => value !== undefined);
          return indices.length
            ? indices.reduce((a, b) => a + b, 0) / indices.length
            : (original.get(id) ?? 0);
        };
        items.sort((a, b) =>
          score(a.id) - score(b.id) || (original.get(a.id) ?? 0) - (original.get(b.id) ?? 0));
        items.forEach((node, index) => positioned.set(node.id, index));
      }
    }
    // Bound the intrinsic SVG width even for a rank with many siblings.
    const rows: Array<NoxFlowSpec["nodes"]> = [];
    for (const level of levels) {
      const group = groups.get(level)!;
      for (let i = 0; i < group.length; i += MAX_COLUMNS) {
        rows.push(group.slice(i, i + MAX_COLUMNS));
      }
    }
    const columns = Math.max(...rows.map(row => row.length));
    width = Math.max(280, columns * NODE_WIDTH + (columns - 1) * COLUMN_GAP + PADDING * 2);
    rows.forEach((row, rowIndex) => {
      const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * COLUMN_GAP;
      const left = (width - rowWidth) / 2;
      row.forEach((node, col) => {
        nodes.push({
          ...node,
          rank: rankOf(node.id),
          x: left + col * (NODE_WIDTH + COLUMN_GAP),
          y: PADDING + rowIndex * (NODE_HEIGHT + LAYER_GAP),
          width: NODE_WIDTH, height: NODE_HEIGHT,
        });
      });
    });
    height = PADDING * 2 + rows.length * NODE_HEIGHT +
      Math.max(0, rows.length - 1) * LAYER_GAP;
  }

  const placed = new Map(nodes.map((node, index) => [node.id, { node, index }]));
  const edges: NoxFlowLayoutEdge[] = [];
  for (const [index, edge] of spec.edges.entries()) {
    const source = placed.get(edge.from), target = placed.get(edge.to);
    if (!source || !target) continue;
    const fromX = source.node.x + source.node.width / 2;
    const fromY = source.node.y + source.node.height;
    const toX = target.node.x + target.node.width / 2;
    const toY = target.node.y;
    if (spec.layout === "vertical-stack") {
      const cx = width / 2;
      if (target.index === source.index + 1) {
        edges.push({ ...edge, path: "M " + cx + " " + fromY + " L " + cx + " " + (toY - 5) });
      } else {
        const lane = index % 2 ? width - 23 - (index % 3) * 5 : 23 + (index % 3) * 5;
        const bendStart = Math.min(fromY + 12, toY - 18);
        const bendEnd = Math.max(bendStart + 3, toY - 16);
        edges.push({ ...edge, path: [
          "M", cx, fromY, "L", cx, bendStart - 6,
          "Q", cx, bendStart, lane, bendStart,
          "L", lane, bendEnd, "Q", lane, toY - 5, cx, toY - 5,
        ].join(" ") });
      }
      continue;
    }
    const distance = Math.max(16, (toY - fromY) / 2);
    const path = [
      "M", fromX, fromY,
      "C", fromX, fromY + distance,
      toX, toY - distance,
      toX, toY - 5,
    ].join(" ");
    edges.push({ ...edge, path });
  }
  return { width, height, nodes, edges };
}
