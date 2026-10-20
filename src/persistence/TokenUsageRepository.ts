import type { TokenUsage } from "../types";
import type { PluginDataRepository } from "./PluginDataRepository";
import {
  accumulateUsage, assertUsageReport, decodeUsageSnapshot,
  type UsageReportOptions,
} from "../domain/usage/usage-accounting";

export type { UsageBucket, UsageSnapshot } from "../domain/usage/usage-accounting";

const KEY = "nox-token-usage-v1";

/**
 * Persistence adapter only. The existing PluginDataRepository serializes
 * updates for settings, session history and usage in one write queue.
 * Accounting arithmetic and untrusted data decoding are pure domain functions.
 */
export class TokenUsageRepository {
  constructor(private readonly data: PluginDataRepository) {}

  async snapshot(): Promise<import("../domain/usage/usage-accounting").UsageSnapshot> {
    const stored = await this.data.read();
    return decodeUsageSnapshot(stored[KEY]);
  }

  async record(provider: string, model: string | undefined, usage: TokenUsage,
    options: UsageReportOptions = {}): Promise<void> {
    assertUsageReport(provider, usage);
    const timestamp = new Date();
    await this.data.update(current => {
      const snapshot = decodeUsageSnapshot(current[KEY]);
      const result = accumulateUsage(snapshot, provider, model ?? "", usage, options, timestamp);
      return result ? { ...current, [KEY]: result } : current;
    });
  }
}
