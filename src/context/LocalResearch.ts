/**
 * On-demand, provider-free lexical + Obsidian link-graph retrieval.
 * The index is derived from vault notes and is never an authority for learning state.
 */
export interface ResearchChunk {
  path: string;
  heading: string;
  line: number;
  content: string;
}
export interface IndexedNote {
  path: string;
  content: string;
  links: string[];
  revision: string;
}
export interface ResearchHit extends ResearchChunk {
  score: number;
  revision: string;
  linkedFrom: string[];
}
export interface ResearchResult {
  query: string;
  subquestions: string[];
  hits: ResearchHit[];
  edges: Array<{ from: string; to: string; relation: "links-to" }>;
}

const STOP = new Set(["yang","dari","dengan","untuk","atau","pada","bagaimana",
  "adalah","agar","the","and","this","that","with","what","does","how","are","why"]);
function tokenize(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .filter(word => !STOP.has(word));
}

export function splitNote(path: string, content: string): ResearchChunk[] {
  const lines = content.split(/\r?\n/);
  const result: ResearchChunk[] = [];
  let heading = path, start = 1, block: string[] = [];
  const flush = () => {
    const text = block.join("\n").trim();
    if (text) {
      // Each excerpt must point to its actual first source line.
      // Character-based chunks may start in the middle of a line.
      for (let offset = 0; offset < text.length; offset += 1250) {
        const prefix = text.slice(0, offset);
        const line = start + (prefix.match(/\n/g)?.length ?? 0);
        result.push({ path, heading, line, content: text.slice(offset, offset + 1250) });
      }
    }
    block = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const match = /^#{1,6}\s+(.+)/.exec(lines[i]);
    if (match) {
      flush();
      heading = match[1].trim();
      start = i + 1;
    } else {
      if (block.length === 0) start = i + 1;
      block.push(lines[i]);
      if (block.join("\n").length > 1800) flush();
    }
  }
  flush();
  return result.slice(0, 120);
}

/** Deterministic breadth limit: decomposition introduces no additional LLM round trips. */
export function decomposeResearchQuestion(question: string): string[] {
  const query = question.replace(/^\/research\s*/i, "").trim();
  if (!query) return [];
  const parts = query.split(/\s+(?:vs\.?|versus|dibandingkan|compared to|dan|and)\s+/i)
    .map(part => part.trim()).filter(part => part.length > 6);
  return [query, ...parts].filter((part, i, all) => all.indexOf(part) === i).slice(0, 4);
}

export class LocalResearchIndex {
  private notes = new Map<string, { note: IndexedNote; chunks: ResearchChunk[] }>();

  upsert(note: IndexedNote): void {
    if (this.notes.get(note.path)?.note.revision === note.revision) return;
    this.notes.set(note.path, { note: { ...note, links: [...note.links] },
      chunks: splitNote(note.path, note.content) });
  }

  remove(path: string): void { this.notes.delete(path); }

  paths(): string[] { return [...this.notes.keys()]; }

  search(question: string, options: { limit?: number; allowedPaths?: string[]; maxHops?: number } = {}): ResearchResult {
    const allowed = options.allowedPaths ? new Set(options.allowedPaths) : null;
    const subquestions = decomposeResearchQuestion(question);
    const terms = new Set(subquestions.flatMap(tokenize));
    if (!terms.size) return { query: question, subquestions, hits: [], edges: [] };
    const scored: ResearchHit[] = [];
    for (const { note, chunks } of this.notes.values()) {
      if (allowed && !allowed.has(note.path)) continue;
      for (const chunk of chunks) {
        const haystack = tokenize(chunk.heading + " " + chunk.content);
        let hits = 0;
        for (const term of terms) hits += haystack.filter(word => word === term).length;
        const title = tokenize(note.path);
        const titleBoost = title.filter(word => terms.has(word)).length * 2;
        const score = (hits / Math.sqrt(1 + haystack.length / 60)) + titleBoost;
        if (score > 0) scored.push({ ...chunk, score, revision: note.revision, linkedFrom: [] });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
    const limit = Math.max(1, Math.min(16, options.limit ?? 8));
    const picked = scored.slice(0, Math.max(1, Math.ceil(limit * 0.75)));
    if (options.maxHops !== 0 && picked.length > 0) {
      const topPaths = new Set(picked.map(hit => hit.path));
      for (const hit of scored) {
        if (picked.length >= limit) break;
        if (topPaths.has(hit.path)) continue;
        const linked = [...topPaths].some(path =>
          this.notes.get(path)?.note.links.includes(hit.path) ||
          this.notes.get(hit.path)?.note.links.includes(path));
        if (linked) { picked.push(hit); topPaths.add(hit.path); }
      }
    }
    const resultPaths = new Set(picked.map(hit => hit.path));
    const edges: ResearchResult["edges"] = [];
    for (const path of resultPaths) {
      for (const link of this.notes.get(path)?.note.links ?? []) {
        if (resultPaths.has(link) && (!allowed || allowed.has(link))) {
          edges.push({ from: path, to: link, relation: "links-to" });
        }
      }
    }
    for (const hit of picked) {
      hit.linkedFrom = edges.filter(edge => edge.to === hit.path).map(edge => edge.from);
    }
    return { query: question, subquestions, hits: picked, edges };
  }
}
