import type { QuotaReading } from "../../packages/core/src/types";
export type { QuotaProvider, QuotaReading, ProviderQuotaSnapshot } from "../../packages/core/src/types";
type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => x && typeof x === "object" && !Array.isArray(x) ? x as Obj : null;
const arr = (x: unknown): unknown[] | null => Array.isArray(x) ? x : null;
const text = (x: unknown): string => typeof x === "string" ? x.trim().slice(0, 160) : "";
const pct = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 100 ? x : null;
const resetTime = (x: unknown): string | undefined => {
  if (typeof x === "number" && Number.isFinite(x) && x > 0) {
    return new Date(x * 1000).toISOString();
  }
  if (typeof x === "string" && x.length <= 60 && Number.isFinite(Date.parse(x))) {
    return new Date(x).toISOString();
  }
  return undefined;
};
/** Trim the ledger's fallback "requested:" namespace without renaming provider slugs. */
export function normalizeUsageModelId(value: string): string {
  return value.trim().replace(/^requested:\s*/i, "").trim();
}

/** AGY 1.2.16 measured read-only /usage envelope. Refuse anything resembling an AI turn. */
export function parseAgyUsage(value: unknown): QuotaReading[] {
  const root = obj(value), command = obj(root?.command), data = obj(command?.data);
  if (!root || root.status !== "SUCCESS" || command?.name !== "usage" ||
      root.num_turns !== 0 || text(root.conversation_id) !== "") {
    throw new Error("AGY did not return a verified read-only usage response.");
  }
  const groups = arr(data?.groups);
  if (!groups) throw new Error("AGY quota response has no groups array.");
  const readings: QuotaReading[] = [];
  for (const g of groups.slice(0, 40)) {
    const group = obj(g); if (!group) continue;
    const name = text(group.name); if (!name) continue;
    const buckets = arr(group.buckets) || [];
    for (const b of buckets.slice(0, 16)) {
      const bucket = obj(b); if (!bucket) continue;
      const fraction = bucket.remaining_fraction;
      if (typeof fraction !== "number" || !Number.isFinite(fraction) ||
          fraction < 0 || fraction > 1) continue;
      const label = text(bucket.name) || text(bucket.window) || text(bucket.id) || "Quota window";
      readings.push({
        provider: "agy", key: [name, text(bucket.id) || label].join(":"),
        label: name + " · " + label, kind: "window",
        remainingPercent: fraction * 100, resetAt: resetTime(bucket.reset_time),
        shared: true,
      });
    }
  }
  if (groups.length && !readings.length) throw new Error("AGY returned no valid quota windows.");
  return readings;
}

/** Optional /credits command: only accept verified provider numbers, never guess from free text. */
export function parseAgyCredits(value: unknown): QuotaReading[] {
  const root = obj(value), command = obj(root?.command), data = obj(command?.data);
  if (!root || root.status !== "SUCCESS" || command?.name !== "credits" ||
      root.num_turns !== 0 || text(root.conversation_id) !== "" || !data) {
    return [];
  }
  // The CLI may omit numeric credits (or report unsupported plans). Absence is unknown, not zero.
  const candidate = data.remaining ?? data.remaining_credits ?? data.balance ?? data.credits_remaining;
  const amount = (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0)
    ? String(candidate) : null;
  if (amount === null) return [];
  return [{ provider: "agy", key: "agy:credits", label: "AGY AI credits",
    kind: "credit", amount, shared: true }];
}

/** Codex app-server v2 GetAccountRateLimitsResponse. The snapshot has window usedPercent. */
export function parseCodexRateLimits(value: unknown): QuotaReading[] {
  const root = obj(value);
  if (!root) throw new Error("Invalid Codex rate-limits response.");
  const groups = obj(root.rateLimitsByLimitId);
  const provided = groups ? Object.entries(groups).slice(0, 40) : [
    ["codex", root.rateLimits],
  ] as Array<[string, unknown]>;
  const readings: QuotaReading[] = [];
  for (const [key, raw] of provided) {
    const g = obj(raw); if (!g) continue;
    const name = text(g.limitName) || text(g.limitId) || text(key) || "Codex";
    const model = text(g.normalModelSlug) || undefined;
    for (const window of ["primary", "secondary"] as const) {
      const w = obj(g[window]);if (!w) continue;
      const used = pct(w.usedPercent);
      if (used === null) continue;
      const duration = typeof w.windowDurationMins === "number" && w.windowDurationMins > 0
        ? " (" + w.windowDurationMins + " min)" : "";
      readings.push({ provider:"codex", key:name+":"+window, label: name+" · "+window+duration,
        kind:"window", remainingPercent:100-used, resetAt:resetTime(w.resetsAt),
        model, shared: !model });
    }
    const credits = obj(g.credits);
    const rawBalance = credits?.balance;
    if (credits?.hasCredits === true && typeof rawBalance === "string" &&
        /^\d+(?:\.\d+)?$/.test(rawBalance) && rawBalance.length < 40) {
      readings.push({ provider:"codex", key:name+":credits", label:name+" · credits",
        kind:"credit", amount:rawBalance, model, shared:!model });
    }
  }
  if (!readings.length) throw new Error("Codex returned no supported quota windows or credits.");
  return readings;
}
