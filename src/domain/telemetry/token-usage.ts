/** Provider-neutral usage receipts. Missing provider fields remain unknown, never estimated. */
export interface AgentUsageRecord {
  id: string;
  at: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** API responses and CLI adapters may omit usage entirely. */
export function decodeTokenUsage(value: unknown): {
  inputTokens: number; outputTokens: number; cachedInputTokens?: number;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const input = row.input_tokens ?? row.inputTokens;
  const output = row.output_tokens ?? row.outputTokens;
  if (!count(input) || !count(output)) return null;
  const detail = row.input_tokens_details;
  const details = detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail as Record<string, unknown> : {};
  const cached = row.cached_input_tokens ?? row.cachedInputTokens ?? details.cached_tokens;
  return { inputTokens: input, outputTokens: output,
    ...(count(cached) && cached <= input ? { cachedInputTokens: cached } : {}) };
}

export function isAgentUsageRecord(value: unknown): value is AgentUsageRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && row.id.length > 0 && row.id.length <= 150 &&
    count(row.at) && typeof row.provider === "string" && row.provider.length <= 80 &&
    typeof row.model === "string" && row.model.length <= 150 &&
    count(row.inputTokens) && count(row.outputTokens) &&
    (row.cachedInputTokens === undefined ||
      (count(row.cachedInputTokens) && row.cachedInputTokens <= row.inputTokens));
}

export function summarizeUsage(records: readonly AgentUsageRecord[]) {
  return records.reduce((sum, item) => ({
    requests: sum.requests + 1,
    inputTokens: sum.inputTokens + item.inputTokens,
    outputTokens: sum.outputTokens + item.outputTokens,
    cachedInputTokens: sum.cachedInputTokens + (item.cachedInputTokens ?? 0),
  }), { requests: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
}
