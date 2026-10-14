import type { AgentContext } from "../types";

export type HistoricalMessage = { role: "user" | "assistant"; content: string };

export interface ContextEnvelope {
  context: AgentContext[];
  history: HistoricalMessage[];
  promptPrefix: string;
  estimate: {
    total: number;
    context: number;
    history: number;
    prompt: number;
    compacted: boolean;
    shortenedSources: number;
  };
}

export interface ContextEnvelopeRequest {
  prompt: string;
  visible: AgentContext[];
  system: AgentContext[];
  history: HistoricalMessage[];
  research?: boolean;
  /** Exact source and edit workflows must not silently omit required material. */
  strict?: boolean;
  /** Conservative estimated input ceiling, independent of a provider's advertised maximum. */
  maxInputTokens?: number;
}

/** Conservative heuristic, not a tokenizer or provider usage report. */
export function estimateTokens(content: string): number {
  if (!content) return 0;
  return Math.ceil(new TextEncoder().encode(content).length / 2.5);
}

const words = (text: string): string[] => (text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  .filter(word => !new Set(["yang", "dan", "dari", "dengan", "untuk", "the", "and", "this", "that", "with", "about"]).has(word));

/** A query-directed extract, not an arbitrary prefix cut. Preserves paragraph order. */
export function extractRelevantText(content: string, query: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  if (maxChars < 80) return "";
  const terms = new Set(words(query));
  const blocks = content.split(/(?<=\n)\s*\n/).flatMap(paragraph => {
    if (paragraph.length <= 1200) return [paragraph];
    const parts: string[] = [];
    for (let i = 0; i < paragraph.length; i += 1000) parts.push(paragraph.slice(i, i + 1000));
    return parts;
  });
  const ranked = blocks.map((block, index) => ({
    index, block,
    score: words(block).reduce((score, word) => score + (terms.has(word) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen: typeof ranked = [];
  let used = 60;
  for (const item of ranked) {
    if (used + item.block.length > maxChars) continue;
    chosen.push(item);
    used += item.block.length + 2;
  }
  chosen.sort((a, b) => a.index - b.index);
  return "[Selected excerpts; source shortened to fit the context budget]\n" +
    chosen.map(item => item.block).join("\n\n");
}

/** Deterministic, bounded historical digest: NOT a substitute for canonical transcript/evidence. */
export function compactHistory(history: HistoricalMessage[], maxChars = 1300): string {
  const older = history.slice(-14);
  const fragments = older.map(message =>
    (message.role === "user" ? "User: " : "Assistant: ") + message.content.replace(/\s+/g, " ").slice(0, 260));
  let result = "";
  for (let i = fragments.length - 1; i >= 0; i--) {
    const candidate = fragments[i] + "\n" + result;
    if (candidate.length > maxChars) break;
    result = candidate;
  }
  return result.trim();
}

export function prepareContextEnvelope(request: ContextEnvelopeRequest): ContextEnvelope {
  const ceiling = request.maxInputTokens ?? (request.research ? 14000 : 10000);
  if (!Number.isFinite(ceiling) || ceiling < 1000) throw new Error("Invalid context budget.");
  const promptTokens = estimateTokens(request.prompt);
  const fixedOverhead = 600;
  if (promptTokens + fixedOverhead >= ceiling) throw new Error("Request exceeds the input context budget.");

  const maxHistory = Math.min(2400, Math.floor(ceiling * 0.24));
  const recent = request.history.filter(item => item.content.trim()).slice(-6)
    .map(item => ({ role: item.role, content: item.content.slice(0, 4400) }));
  while (recent.length && estimateTokens(JSON.stringify(recent)) > maxHistory) {
    if (recent.length > 2) recent.shift();
    else {
      const first = recent[0];
      first.content = first.content.slice(Math.ceil(first.content.length / 3));
      if (first.content.length < 100) recent.shift();
    }
  }
  const earlier = request.history.slice(0, Math.max(0, request.history.length - 6));
  let digest = earlier.length ? compactHistory(earlier) : "";
  let historyTokens = estimateTokens(JSON.stringify(recent)) + estimateTokens(digest);
  if (historyTokens > maxHistory) {
    // A summary is optional; never allow the digest to consume source budget.
    // A character budget alone is insufficient for UTF-8/CJK-heavy transcripts.
    const remainingHistory = Math.max(0, maxHistory - estimateTokens(JSON.stringify(recent)));
    if (remainingHistory === 0) digest = "";
    else {
      digest = extractRelevantText(digest, request.prompt, Math.max(80, remainingHistory * 2));
      while (digest && estimateTokens(digest) > remainingHistory) {
        digest = digest.slice(0, Math.floor(digest.length * 0.8));
      }
    }
    historyTokens = estimateTokens(JSON.stringify(recent)) + estimateTokens(digest);
  }

  const room = ceiling - promptTokens - fixedOverhead - historyTokens;
  const context: AgentContext[] = [];
  // User-selected evidence receives priority over ambient state.
  const priority = [...request.visible, ...request.system];
  const seen = new Set<string>();
  let remaining = room;
  let shortenedSources = 0;
  for (const source of priority) {
    const fingerprint = source.file + "\0" + source.type + "\0" + source.content;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const overhead = estimateTokens(source.file) + 30;
    if (overhead >= remaining) {
      if (request.strict) throw new Error("Required source does not fit the context budget.");
      shortenedSources++;
      continue;
    }
    let content = source.content;
    const cost = estimateTokens(content);
    if (cost > remaining - overhead) {
      if (request.strict) throw new Error("Required source exceeds the context budget; narrow the selection.");
      content = extractRelevantText(content, request.prompt, Math.max(0, Math.floor((remaining - overhead) * 2)));
      shortenedSources++;
    }
    if (content.trim()) {
      context.push({ ...source, content });
      remaining -= overhead + estimateTokens(content);
    }
  }

  const prefix = digest
    ? "Earlier conversation (lossy summary, not authoritative learning evidence):\n" + digest + "\n\n"
    : "";
  const estimatedContext = estimateTokens(JSON.stringify(context));
  const total = estimatedContext + estimateTokens(JSON.stringify(recent)) +
    estimateTokens(prefix) + promptTokens + fixedOverhead;
  if (total > ceiling) {
    // Serialized JSON can add overhead that the note-level estimate missed.
    while (context.length && estimateTokens(JSON.stringify(context)) +
      estimateTokens(JSON.stringify(recent)) + estimateTokens(prefix) + promptTokens + fixedOverhead > ceiling) {
      if (request.strict) throw new Error("Serialized required context exceeds the input budget.");
      context.pop();
      shortenedSources++;
    }
  }
  return {
    context, history: recent, promptPrefix: prefix,
    estimate: {
      total: estimateTokens(JSON.stringify(context)) + estimateTokens(JSON.stringify(recent)) +
        estimateTokens(prefix) + promptTokens + fixedOverhead,
      context: estimateTokens(JSON.stringify(context)),
      history: estimateTokens(JSON.stringify(recent)) + estimateTokens(prefix),
      prompt: promptTokens,
      compacted: Boolean(digest) || request.history.length > recent.length,
      shortenedSources,
    },
  };
}
