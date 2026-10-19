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

export function splitNote(path: string, content: string, maxChunks = 120, strict = false): ResearchChunk[] {
  const lines = content.split(/\r?\n/);
  const result: ResearchChunk[] = [];
  let heading = path, start = 1, block: string[] = [], blockLength = 0;
  const flush = () => {
    const text = block.join("\n").trim();
    if (text) {
      // Each excerpt must point to its actual first source line.
      // Character-based chunks may start in the middle of a line.
      let line = start;
      for (let offset = 0; offset < text.length; offset += 1250) {
        const excerpt = text.slice(offset, offset + 1250);
        result.push({ path, heading, line, content: excerpt });
        line += (excerpt.match(/\n/g) ?? []).length;
      }
    }
    block = [];
    blockLength = 0;
  };
  for (let i = 0; i < lines.length; i++) {
    const match = /^#{1,6}\s+(.+)/.exec(lines[i]);
    if (match) {
      flush();
      heading = match[1].trim();
      start = i + 1;
    } else {
      if (block.length === 0) start = i + 1;
      blockLength += lines[i].length + (block.length ? 1 : 0);
      block.push(lines[i]);
      if (blockLength > 1800) flush();
    }
  }
  flush();
  if (strict && result.length > maxChunks) {
    throw new Error("Authorized note exceeds the maximum retrievable chunks; split the note.");
  }
  return result.slice(0, maxChunks);
}

/** Deterministic breadth limit: decomposition introduces no additional LLM round trips. */
export function decomposeResearchQuestion(question: string): string[] {
  const query = question.replace(/^\/research\s*/i, "").trim();
  if (!query) return [];
  const parts = query.split(/\s+(?:vs\.?|versus|dibandingkan|compared to|dan|and)\s+/i)
    .map(part => part.trim()).filter(part => part.length > 6);
  return [query, ...parts].filter((part, i, all) => all.indexOf(part) === i).slice(0, 4);
}

/**
 * Derived sparse index. Each chunk is tokenized only on revision change,
 * not on every search. Posting lists contain no note content or credentials.
 */
interface StoredChunk {
  chunk: ResearchChunk;
  wordCount: number;
  revision: string;
}

type Posting = { frequency: number; titleHits: number };

export class LocalResearchIndex {
  constructor(private readonly maxChunksPerNote = 120,
    private readonly strictChunkBudget = false) {}
  private notes = new Map<string, { note: IndexedNote; ids: string[]; links: Set<string> }>();
  private chunks = new Map<string, StoredChunk>();
  private postings = new Map<string, Map<string, Posting>>();

  upsert(note: IndexedNote): void {
    if (this.notes.get(note.path)?.note.revision === note.revision) return;
    this.remove(note.path);
    const ids: string[] = [];
    const titleCounts = new Map<string, number>();
    for (const term of tokenize(note.path)) {
      titleCounts.set(term, (titleCounts.get(term) ?? 0) + 1);
    }
    for (const [index, chunk] of splitNote(note.path, note.content, this.maxChunksPerNote, this.strictChunkBudget).entries()) {
      const id = note.path + "\0" + index;
      ids.push(id);
      const tokens = tokenize(chunk.heading + " " + chunk.content);
      this.chunks.set(id, { chunk, wordCount: tokens.length, revision: note.revision });
      const frequencies = new Map<string, number>();
      for (const term of tokens) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      const combined = new Set([...frequencies.keys(), ...titleCounts.keys()]);
      for (const term of combined) {
        let posting = this.postings.get(term);
        if (!posting) {
          posting = new Map<string, Posting>();
          this.postings.set(term, posting);
        }
        posting.set(id, { frequency: frequencies.get(term) ?? 0, titleHits: titleCounts.get(term) ?? 0 });
      }
    }
    this.notes.set(note.path, { note: { ...note, links: [...note.links] }, ids, links: new Set(note.links) });
  }

  remove(path: string): void {
    const stored = this.notes.get(path);
    if (!stored) return;
    for (const id of stored.ids) {
      const chunk = this.chunks.get(id);
      if (!chunk) continue;
      const terms = new Set([...tokenize(chunk.chunk.heading + " " + chunk.chunk.content),
        ...tokenize(path)]);
      for (const term of terms) {
        const posting = this.postings.get(term);
        posting?.delete(id);
        if (posting?.size === 0) this.postings.delete(term);
      }
      this.chunks.delete(id);
    }
    this.notes.delete(path);
  }

  paths(): string[] { return [...this.notes.keys()]; }

  search(question: string, options: { limit?: number; allowedPaths?: string[]; maxHops?: number } = {}): ResearchResult {
    const allowed = options.allowedPaths ? new Set(options.allowedPaths) : null;
    const subquestions = decomposeResearchQuestion(question);
    const terms = new Set(subquestions.flatMap(tokenize));
    if (!terms.size) return { query: question, subquestions, hits: [], edges: [] };
    const counts = new Map<string, { hits: number; titleBoost: number }>();
    for (const term of terms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      for (const [id, value] of posting) {
        const stored = this.chunks.get(id);
        if (!stored || (allowed && !allowed.has(stored.chunk.path))) continue;
        const count = counts.get(id) ?? { hits: 0, titleBoost: 0 };
        count.hits += value.frequency;
        count.titleBoost += 2 * value.titleHits;
        counts.set(id, count);
      }
    }
    const scored: ResearchHit[] = [];
    for (const [id, count] of counts) {
      const stored = this.chunks.get(id);
      if (!stored) continue;
      const score = count.hits / Math.sqrt(1 + stored.wordCount / 60) + count.titleBoost;
      if (score > 0) scored.push({ ...stored.chunk, score, revision: stored.revision, linkedFrom: [] });
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
    const limit = Math.max(1, Math.min(16, options.limit ?? 8));
    const picked = scored.slice(0, Math.max(1, Math.ceil(limit * 0.75)));
    if (options.maxHops !== 0 && picked.length > 0) {
      const topPaths = new Set(picked.map(hit => hit.path));
      for (const hit of scored) {
        if (picked.length >= limit) break;
        if (topPaths.has(hit.path)) continue;
        const links = this.notes.get(hit.path)?.links;
        const linked = [...topPaths].some(path =>
          this.notes.get(path)?.links.has(hit.path) || links?.has(path));
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
