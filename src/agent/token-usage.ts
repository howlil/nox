/** Provider reported token counts. Cached input and reasoning are subsets, never additive. */
import type { TokenUsage } from "../types";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Ignore malformed or missing metadata instead of manufacturing estimates. */
function normalize(raw: unknown, aliases: {
  input: string; output: string; total: string; cached?: number; reasoning?: number;
  cacheWrite?: number;
}): TokenUsage | null {
  const data = object(raw);
  const inputTokens = count(data[aliases.input]);
  const outputTokens = count(data[aliases.output]);
  if (inputTokens === undefined || outputTokens === undefined) return null;
  const totalTokens = count(data[aliases.total]) ?? (inputTokens + outputTokens);
  if (!Number.isSafeInteger(totalTokens) || totalTokens < inputTokens ||
    totalTokens < outputTokens || totalTokens === 0) return null;
  const usage: TokenUsage = { inputTokens, outputTokens, totalTokens };
  if (aliases.cached !== undefined) usage.cachedInputTokens = aliases.cached;
  if (aliases.reasoning !== undefined) usage.reasoningTokens = aliases.reasoning;
  if (aliases.cacheWrite !== undefined) usage.cacheWriteTokens = aliases.cacheWrite;
  return usage;
}

export function parseChatGptUsage(response: unknown): TokenUsage | null {
  const data = object(response);
  const usage = object(data.usage);
  const input = object(usage.input_tokens_details);
  const output = object(usage.output_tokens_details);
  return normalize(usage, {
    input: "input_tokens", output: "output_tokens", total: "total_tokens",
    cached: count(input.cached_tokens), reasoning: count(output.reasoning_tokens),
    cacheWrite: count(input.cache_write_tokens),
  });
}

export function parseAgyUsage(result: unknown): TokenUsage | null {
  const usage = object(object(result).usage);
  return normalize(usage, {
    input: "input_tokens", output: "output_tokens", total: "total_tokens",
    cached: count(usage.cache_read_tokens), reasoning: count(usage.thinking_tokens),
  });
}

export function parseCodexUsage(event: unknown): TokenUsage | null {
  const usage = object(object(event).usage);
  return normalize(usage, {
    input: "input_tokens", output: "output_tokens", total: "total_tokens",
    cached: count(usage.cached_input_tokens),
  });
}
