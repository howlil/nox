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



export interface TokenDailyBucket {
  startDate: string;
  endDate: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Real UTC daily-bucket projection for the settings chart.
 * A 30-day view uses ten three-day bars; seven days stay daily. The
 * all-time view plots the latest fourteen tracked days, not invented usage.
 */
export function tokenUsageTimeline(
  entries: readonly UsageViewEntry[], filters: UsageFilters, now = new Date(),
): TokenDailyBucket[] {
  const filtered = entries.filter(entry =>
    (filters.provider === "all" || entry.provider === filters.provider) &&
    (filters.model === "all" || entry.model === filters.model) &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.date));
  if (filtered.length === 0) return [];

  const rangeDays = filters.range === "7d" ? 7 : filters.range === "30d" ? 30 : 14;
  const intervalDays = filters.range === "30d" ? 3 : 1;
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const recentDay = Math.max(...filtered.map(entry => Date.parse(entry.date + "T00:00:00Z"))
    .filter(Number.isFinite));
  const end = filters.range === "all" ? Math.min(recentDay, currentDay) : currentDay;
  const first = end - (rangeDays - 1) * 86_400_000;
  const buckets: TokenDailyBucket[] = [];

  for (let offset = 0; offset < rangeDays; offset += intervalDays) {
    const start = first + offset * 86_400_000;
    const last = Math.min(end, start + (intervalDays - 1) * 86_400_000);
    buckets.push({
      startDate: new Date(start).toISOString().slice(0, 10),
      endDate: new Date(last).toISOString().slice(0, 10),
      inputTokens: 0,
      outputTokens: 0,
    });
  }
  for (const entry of filtered) {
    const day = Date.parse(entry.date + "T00:00:00Z");
    if (!Number.isFinite(day) || day < first || day > end) continue;
    const index = Math.floor((day - first) / (86_400_000 * intervalDays));
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.inputTokens += Math.max(0, entry.inputTokens);
    bucket.outputTokens += Math.max(0, entry.outputTokens);
  }
  return buckets;
}
