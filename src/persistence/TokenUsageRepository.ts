import { accumulateUsage, assertUsageReport, decodeUsageSnapshot,
  type TokenUsage, type UsageReportOptions } from "@nox/core";
import type { PluginDataRepository } from "./PluginDataRepository";

export type { UsageBucket, UsageSnapshot } from "@nox/core";

const KEY = "nox-token-usage-v1";

/**
 * Persistence adapter only. The existing PluginDataRepository serializes
 * updates for settings, session history and usage in one write queue.
 * Accounting arithmetic and untrusted data decoding are pure domain functions.
 */
export class TokenUsageRepository {
  constructor(private readonly data: PluginDataRepository) {}

  async snapshot(): Promise<import("@nox/core").UsageSnapshot> {
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
