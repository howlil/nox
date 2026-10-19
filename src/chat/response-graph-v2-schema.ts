import { MAX_VISUAL_SOURCE_CHARS } from "./response-spec";

/** Source-only contract for advanced read-only graphs. v1 stays unchanged. */
export interface NoxFlowSpecV2 {
  version: 2;
  title?: string;
  direction: "TB" | "LR";
  layout: "layered";
  groups: Array<{ id: string; label: string }>;
  nodes: Array<{
    id: string; label: string;
    kind?: "default" | "decision" | "focus" | "result";
    group?: string;
  }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;
const KINDS = new Set(["default", "decision", "focus", "result"]);
const record = (input: unknown): input is Record<string, unknown> =>
  input !== null && typeof input === "object" && !Array.isArray(input);

/** Convert untrusted JSON to a bounded, safe, typed graph. No source is executed. */
export function parseNoxFlowV2(source: string): NoxFlowSpecV2 | null {
  if (!source.trim() || source.length > MAX_VISUAL_SOURCE_CHARS) return null;
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { return null; }
  if (!record(raw) || raw.version !== 2 || raw.layout !== "layered" ||
      (raw.direction !== "TB" && raw.direction !== "LR") ||
      (raw.title !== undefined &&
       (typeof raw.title !== "string" || raw.title.length > 120)) ||
      !Array.isArray(raw.groups) || raw.groups.length > 8 ||
      !Array.isArray(raw.nodes) || raw.nodes.length < 1 || raw.nodes.length > 40 ||
      !Array.isArray(raw.edges) || raw.edges.length > 80) return null;

  const ids = new Set<string>();
  const groups: NoxFlowSpecV2["groups"] = [];
  for (const entry of raw.groups) {
    if (!record(entry) || typeof entry.id !== "string" || !ID.test(entry.id) ||
        ids.has(entry.id) || typeof entry.label !== "string" ||
        !entry.label.trim() || entry.label.length > 80) return null;
    ids.add(entry.id);
    groups.push({ id: entry.id, label: entry.label });
  }

  const nodeIds = new Set<string>();
  const groupIds = new Set(groups.map(group => group.id));
  const nodes: NoxFlowSpecV2["nodes"] = [];
  for (const entry of raw.nodes) {
    if (!record(entry) || typeof entry.id !== "string" || !ID.test(entry.id) ||
        ids.has(entry.id) || typeof entry.label !== "string" ||
        !entry.label.trim() || entry.label.length > 100 ||
        (entry.kind !== undefined && (typeof entry.kind !== "string" || !KINDS.has(entry.kind))) ||
        (entry.group !== undefined && (typeof entry.group !== "string" ||
          !groupIds.has(entry.group)))) return null;
    ids.add(entry.id);
    nodeIds.add(entry.id);
    nodes.push({
      id: entry.id, label: entry.label,
      ...(typeof entry.kind === "string" ? { kind: entry.kind as NonNullable<NoxFlowSpecV2["nodes"][number]["kind"]> } : {}),
      ...(typeof entry.group === "string" ? { group: entry.group } : {}),
    });
  }
  if (groups.some(group => !nodes.some(node => node.group === group.id))) return null;

  const edgeKeys = new Set<string>();
  const edges: NoxFlowSpecV2["edges"] = [];
  for (const entry of raw.edges) {
    if (!record(entry) || typeof entry.from !== "string" ||
        typeof entry.to !== "string" || entry.from === entry.to ||
        !nodeIds.has(entry.from) || !nodeIds.has(entry.to) ||
        (entry.label !== undefined && (typeof entry.label !== "string" ||
          entry.label.length > 64))) return null;
    const key = JSON.stringify([entry.from, entry.to]);
    if (edgeKeys.has(key)) return null;
    edgeKeys.add(key);
    edges.push({
      from: entry.from, to: entry.to,
      ...(typeof entry.label === "string" ? { label: entry.label } : {}),
    });
  }
  return {
    version: 2, title: raw.title as string | undefined,
    direction: raw.direction, layout: "layered", groups, nodes, edges,
  };
}
