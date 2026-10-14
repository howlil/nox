import type { TokenUsage } from "../types";
import type { PluginDataRepository } from "./PluginDataRepository";

const KEY = "nox-token-usage-v1";

export interface UsageBucket {
  date: string; // UTC calendar day
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
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decode(value: unknown): UsageSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { entries: [] };
  const data = value as Record<string, unknown>;
  const entries: UsageBucket[] = [];
  if (Array.isArray(data.entries)) for (const item of data.entries) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const v = item as Record<string, unknown>;
    if (typeof v.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
      typeof v.provider !== "string" || typeof v.model !== "string" ||
      !["requests", "inputTokens", "outputTokens", "totalTokens", "cachedInputTokens",
        "reasoningTokens", "cacheWriteTokens"].every(k => validCount(v[k]))) continue;
    entries.push(v as unknown as UsageBucket);
  }
  return {
    trackingSince: typeof data.trackingSince === "string" ? data.trackingSince : undefined,
    entries,
  };
}

/**
 * Daily provider/model buckets preserve all-time totals without storing prompts,
 * conversations, access tokens, or an unbounded per-request history.
 * All writes use the plugin's existing serialized data writer.
 */
export class TokenUsageRepository {
  constructor(private readonly data: PluginDataRepository) {}

  async snapshot(): Promise<UsageSnapshot> {
    const stored = await this.data.read();
    return decode(stored[KEY]);
  }

  async record(provider: string, model: string | undefined, usage: TokenUsage): Promise<void> {
    if (!["agy", "codex", "chatgpt"].includes(provider)) throw new Error("Invalid usage provider.");
    if (![usage.inputTokens, usage.outputTokens, usage.totalTokens].every(validCount) ||
      usage.totalTokens === 0) throw new Error("Invalid token usage.");
    const timestamp = new Date();
    const date = timestamp.toISOString().slice(0, 10);
    const modelId = model?.trim().slice(0, 128) || "(runtime default)";
    await this.data.update(current => {
      const snapshot = decode(current[KEY]);
      const existing = snapshot.entries.find(item => item.date === date &&
        item.provider === provider && item.model === modelId);
      const next = existing ?? {
        date, provider, model: modelId, requests: 0,
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
        cachedInputTokens: 0, reasoningTokens: 0, cacheWriteTokens: 0,
      };
      const add = (left: number, right: number | undefined) => {
        const result = left + (right ?? 0);
        if (!Number.isSafeInteger(result)) throw new Error("Usage total exceeded safe integer range.");
        return result;
      };
      const updated: UsageBucket = {
        ...next,
        requests: add(next.requests, 1),
        inputTokens: add(next.inputTokens, usage.inputTokens),
        outputTokens: add(next.outputTokens, usage.outputTokens),
        totalTokens: add(next.totalTokens, usage.totalTokens),
        cachedInputTokens: add(next.cachedInputTokens, usage.cachedInputTokens),
        reasoningTokens: add(next.reasoningTokens, usage.reasoningTokens),
        cacheWriteTokens: add(next.cacheWriteTokens, usage.cacheWriteTokens),
      };
      const entries = existing ? snapshot.entries.map(item => item === existing ? updated : item)
        : [...snapshot.entries, updated];
      return { ...current, [KEY]: {
        trackingSince: snapshot.trackingSince ?? timestamp.toISOString(), entries,
      } satisfies UsageSnapshot };
    });
  }
}
