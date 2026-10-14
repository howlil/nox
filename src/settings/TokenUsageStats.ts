export interface UsageViewEntry {
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


export type UsageFilters = { provider: string; model: string; range: "all" | "7d" | "30d" };

/** Pure, filterable projection from provider-reported daily buckets. */

export function summarizeTokenUsage(
  entries: UsageViewEntry[], filters: UsageFilters, now = new Date(),
): { totals: Omit<UsageViewEntry, "date" | "provider" | "model">; rows: UsageViewEntry[] } {
  const cutoff = filters.range === "all" ? "" : new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() -
      (filters.range === "7d" ? 6 : 29),
  )).toISOString().slice(0, 10);
  const selected = entries.filter(entry =>
    (filters.provider === "all" || entry.provider === filters.provider) &&
    (filters.model === "all" || entry.model === filters.model) &&
    (!cutoff || entry.date >= cutoff));
  const empty = (): UsageViewEntry => ({
    date: "", provider: "", model: "", requests: 0, inputTokens: 0,
    outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0,
    cacheWriteTokens: 0,
  });
  const totals = empty();
  const grouped = new Map<string, UsageViewEntry>();
  for (const row of selected) {
    const key = JSON.stringify([row.provider, row.model]);
    const target = grouped.get(key) ?? { ...empty(), provider: row.provider, model: row.model };
    for (const field of ["requests", "inputTokens", "outputTokens", "totalTokens",
      "cachedInputTokens", "reasoningTokens", "cacheWriteTokens"] as const) {
      totals[field] += row[field];
      target[field] += row[field];
    }
    grouped.set(key, target);
  }
  return {
    totals,
    rows: [...grouped.values()].sort((a, b) => b.totalTokens - a.totalTokens ||
      a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)),
  };
}

