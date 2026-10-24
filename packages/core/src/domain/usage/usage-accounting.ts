import type { TokenUsage } from "./usage-types";

/** Provider-reported UTC daily usage; cached and reasoning tokens are subsets. */
export interface UsageBucket {
  date: string;
  provider: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  cacheWriteTokens: number;
}

export interface UsageSnapshot {
  trackingSince?: string;
  entries: UsageBucket[];
  /** AGY terminal counters are cumulative across resumed conversations. */
  agyCheckpoints?: Record<string, { usage: TokenUsage; turnCount: number }>;
}

export interface UsageReportOptions {
  conversationId?: string;
  cumulative?: boolean;
  turnCount?: number;
  freshConversation?: boolean;
}

export function validUsageCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const metricFields = [
  "requests", "inputTokens", "outputTokens", "totalTokens",
  "cachedInputTokens", "reasoningTokens", "cacheWriteTokens",
] as const;

function validReport(usage: TokenUsage): boolean {
  return [usage.inputTokens, usage.outputTokens, usage.totalTokens].every(validUsageCount) &&
    usage.totalTokens > 0 &&
    [usage.cachedInputTokens, usage.reasoningTokens, usage.cacheWriteTokens]
      .every(value => value === undefined || validUsageCount(value));
}

export function assertUsageReport(provider: string, usage: TokenUsage): void {
  if (!["agy", "codex", "chatgpt"].includes(provider)) throw new Error("Invalid usage provider.");
  if (!validReport(usage)) throw new Error("Invalid token usage.");
}

/** Decoder for untrusted persisted plugin data; never reintroduce malformed buckets. */
export function decodeUsageSnapshot(value: unknown): UsageSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { entries: [] };
  const data = value as Record<string, unknown>;
  const entries: UsageBucket[] = [];
  if (Array.isArray(data.entries)) for (const item of data.entries) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const v = item as Record<string, unknown>;
    if (typeof v.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
        typeof v.provider !== "string" || typeof v.model !== "string" ||
        !metricFields.every(field => validUsageCount(v[field]))) continue;
    entries.push(v as unknown as UsageBucket);
  }
  const checkpoints: NonNullable<UsageSnapshot["agyCheckpoints"]> = {};
  if (data.agyCheckpoints && typeof data.agyCheckpoints === "object" &&
      !Array.isArray(data.agyCheckpoints)) {
    for (const [id, raw] of Object.entries(data.agyCheckpoints)) {
      if (!/^[a-z0-9-]{8,128}$/i.test(id) ||
          !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const candidate = raw as Record<string, unknown>;
      const usage = candidate.usage;
      if (!usage || typeof usage !== "object" || Array.isArray(usage)) continue;
      const counters = usage as unknown as TokenUsage;
      if (!validReport(counters) || !validUsageCount(candidate.turnCount)) continue;
      checkpoints[id] = { usage: counters, turnCount: candidate.turnCount };
    }
  }
  return {
    trackingSince: typeof data.trackingSince === "string" ? data.trackingSince : undefined,
    entries,
    agyCheckpoints: checkpoints,
  };
}

function checkedAdd(left: number, right: number | undefined): number {
  const result = left + (right ?? 0);
  if (!Number.isSafeInteger(result)) throw new Error("Usage total exceeded safe integer range.");
  return result;
}

/**
 * Pure cumulative-to-delta projection. Does not persist, count historical
 * turns first seen after a resume, or retain raw prompts/provider content.
 * null means a duplicate/reset/unattributable report must not rewrite storage.
 */
export function accumulateUsage(
  snapshot: UsageSnapshot,
  provider: string,
  model: string,
  usage: TokenUsage,
  options: UsageReportOptions,
  now: Date,
): UsageSnapshot | null {
  assertUsageReport(provider, usage);
  const date = now.toISOString().slice(0, 10);
  const modelId = model.trim().slice(0, 128) || "(runtime default)";
  let increment = usage;
  const checkpoints = { ...snapshot.agyCheckpoints };
  if (provider === "agy" && options.cumulative) {
    if (!options.conversationId || !/^[a-z0-9-]{8,128}$/i.test(options.conversationId)) return null;
    const previous = checkpoints[options.conversationId];
    const turnCount = validUsageCount(options.turnCount) && options.turnCount > 0
      ? options.turnCount : 0;
    checkpoints[options.conversationId] = { usage, turnCount };
    if (!previous && !options.freshConversation) {
      return { ...snapshot, agyCheckpoints: checkpoints };
    }
    if (previous) {
      if (usage.totalTokens <= previous.usage.totalTokens) return null;
      const subtract = (next: number | undefined, old: number | undefined) =>
        Math.max(0, (next ?? 0) - (old ?? 0));
      increment = {
        inputTokens: subtract(usage.inputTokens, previous.usage.inputTokens),
        outputTokens: subtract(usage.outputTokens, previous.usage.outputTokens),
        totalTokens: subtract(usage.totalTokens, previous.usage.totalTokens),
        cachedInputTokens: subtract(usage.cachedInputTokens, previous.usage.cachedInputTokens),
        reasoningTokens: subtract(usage.reasoningTokens, previous.usage.reasoningTokens),
        cacheWriteTokens: subtract(usage.cacheWriteTokens, previous.usage.cacheWriteTokens),
      };
    }
  }
  if (!increment.totalTokens) return { ...snapshot, agyCheckpoints: checkpoints };
  const existing = snapshot.entries.find(item => item.date === date &&
    item.provider === provider && item.model === modelId);
  const original: UsageBucket = existing ?? {
    date, provider, model: modelId, requests: 0,
    inputTokens: 0, outputTokens: 0, totalTokens: 0,
    cachedInputTokens: 0, reasoningTokens: 0, cacheWriteTokens: 0,
  };
  const updated: UsageBucket = { ...original,
    requests: checkedAdd(original.requests, 1),
    inputTokens: checkedAdd(original.inputTokens, increment.inputTokens),
    outputTokens: checkedAdd(original.outputTokens, increment.outputTokens),
    totalTokens: checkedAdd(original.totalTokens, increment.totalTokens),
    cachedInputTokens: checkedAdd(original.cachedInputTokens, increment.cachedInputTokens),
    reasoningTokens: checkedAdd(original.reasoningTokens, increment.reasoningTokens),
    cacheWriteTokens: checkedAdd(original.cacheWriteTokens, increment.cacheWriteTokens),
  };
  return {
    trackingSince: snapshot.trackingSince ?? now.toISOString(),
    entries: existing ? snapshot.entries.map(item => item === existing ? updated : item)
      : [...snapshot.entries, updated],
    agyCheckpoints: checkpoints,
  };
}
