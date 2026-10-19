import type { ElkNode, ElkExtendedEdge, ElkPoint } from "elkjs/lib/elk.bundled.js";
import type { NoxFlowSpecV2 } from "./response-graph-v2-schema";

export interface NoxFlowV2Layout {
  width: number;
  height: number;
  groups: Array<{ id: string; label: string; x: number; y: number; width: number; height: number }>;
  nodes: Array<NoxFlowSpecV2["nodes"][number] & {
    x: number; y: number; width: number; height: number;
  }>;
  edges: Array<NoxFlowSpecV2["edges"][number] & {
    path: string; labelX?: number; labelY?: number;
  }>;
}

const MAX_DIMENSION = 12_000;
const MAX_EDGE_POINTS = 64;
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX_DIMENSION;
const checked = (n: unknown): number => {
  if (!finite(n)) throw new Error("Graph layout returned an invalid coordinate.");
  return n;
};
const shape = (id: string, label: string): ElkNode => ({
  id,
  width: Math.min(220, Math.max(136, 100 + label.length * 3)),
  height: label.length > 30 ? 64 : 50,
});
const options = (direction: NoxFlowSpecV2["direction"]): Record<string, string> => ({
  "elk.algorithm": "layered",
  "elk.direction": direction === "TB" ? "DOWN" : "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.spacing.nodeNode": "26",
  "elk.layered.spacing.nodeNodeBetweenLayers": "44",
  "elk.spacing.edgeNode": "14",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.padding": "[top=20,left=20,bottom=20,right=20]",
});

/** Geometry is never model-provided. ELK owns graph ranking, node placement and routing. */
export async function layoutNoxFlowV2(spec: NoxFlowSpecV2): Promise<NoxFlowV2Layout> {
  const grouped = new Map(spec.groups.map(group => [group.id, [] as ElkNode[]]));
  const children: ElkNode[] = [];
  for (const node of spec.nodes) {
    const entry = shape(node.id, node.label);
    if (node.group) grouped.get(node.group)!.push(entry);
    else children.push(entry);
  }
  for (const group of spec.groups) {
    children.push({
      id: group.id,
      children: grouped.get(group.id)!,
      layoutOptions: { "elk.padding": "[top=40,left=14,bottom=14,right=14]" },
    });
  }
  const root: ElkNode = {
    id: "nox-root",
    layoutOptions: options(spec.direction),
    children,
    edges: spec.edges.map((edge, i): ElkExtendedEdge => ({
      id: "nox-edge-" + i,
      sources: [edge.from],
      targets: [edge.to],
    })),
  };
  // Expensive ELK initialization is deferred until an explicit v2 block is present.
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();
  const result = await elk.layout(root);
  const width = checked(result.width), height = checked(result.height);
  if (width <= 0 || height <= 0) throw new Error("Graph layout has no dimensions.");

  const nodeLookup = new Map(spec.nodes.map(node => [node.id, node]));
  const groupLookup = new Map(spec.groups.map(group => [group.id, group]));
  const nodes: NoxFlowV2Layout["nodes"] = [];
  const groups: NoxFlowV2Layout["groups"] = [];
  const edgesById = new Map<string, NoxFlowV2Layout["edges"][number]>();

  const point = (p: ElkPoint, x: number, y: number) => ({
    x: checked(checked(p.x) + x), y: checked(checked(p.y) + y),
  });
  const centerOnPath = (points: Array<{ x: number; y: number }>): { x: number; y: number } => {
    let best = 0, length = -1;
    for (let i = 1; i < points.length; i++) {
      const span = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      if (span > length) { length = span; best = i; }
    }
    return {
      x: (points[best - 1].x + points[best].x) / 2,
      y: (points[best - 1].y + points[best].y) / 2,
    };
  };

  // Coordinate ownership: each child and edge section is relative to its containing graph.
  const walk = (graph: ElkNode, offsetX: number, offsetY: number): void => {
    for (const edge of graph.edges ?? []) {
      const index = Number(edge.id.replace("nox-edge-", ""));
      if (!Number.isInteger(index) || index < 0 || index >= spec.edges.length) continue;
      const paths: string[] = [];
      let labelPosition: { x: number; y: number } | undefined;
      for (const section of edge.sections ?? []) {
        if (!section.startPoint || !section.endPoint ||
            (section.bendPoints?.length ?? 0) > MAX_EDGE_POINTS) {
          throw new Error("Graph layout returned malformed edge geometry.");
        }
        const points = [
          section.startPoint, ...(section.bendPoints ?? []), section.endPoint,
        ].map(p => point(p, offsetX, offsetY));
        paths.push("M " + points[0].x + " " + points[0].y +
          points.slice(1).map(p => " L " + p.x + " " + p.y).join(""));
        labelPosition ??= centerOnPath(points);
      }
      if (!paths.length) throw new Error("Graph layout omitted an edge route.");
      const input = spec.edges[index];
      edgesById.set(edge.id, {
        ...input, path: paths.join(" "),
        ...(labelPosition && input.label ? {
          labelX: labelPosition.x, labelY: labelPosition.y,
        } : {}),
      });
    }

    for (const node of graph.children ?? []) {
      const x = checked(offsetX + checked(node.x));
      const y = checked(offsetY + checked(node.y));
      const w = checked(node.width), h = checked(node.height);
      if (w <= 0 || h <= 0 || x + w > MAX_DIMENSION || y + h > MAX_DIMENSION) {
        throw new Error("Graph node geometry is out of bounds.");
      }
      const group = groupLookup.get(node.id);
      const input = nodeLookup.get(node.id);
      if (group) groups.push({ ...group, x, y, width: w, height: h });
      else if (input) nodes.push({ ...input, x, y, width: w, height: h });
      else throw new Error("Graph layout returned an unexpected node.");
      walk(node, x, y);
    }
  };
  walk(result, 0, 0);
  if (nodes.length !== spec.nodes.length || groups.length !== spec.groups.length ||
      edgesById.size !== spec.edges.length) {
    throw new Error("Graph layout did not preserve all nodes and edges.");
  }
  return {
    width, height, groups, nodes,
    edges: spec.edges.map((_, i) => edgesById.get("nox-edge-" + i)!),
  };
}
