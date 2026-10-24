import type { ProviderQuotaSnapshot, QuotaProvider, QuotaReading } from "../../packages/core/src/types";

type Reader = (signal: AbortSignal) => Promise<QuotaReading[]>;

/** Application owner of ephemeral read-only quota cache, retry and stale status. */
export class QuotaSync {
  private readonly cache = new Map<QuotaProvider, ProviderQuotaSnapshot>();
  private readonly failures = new Map<QuotaProvider, number>();
  private readonly inflight = new Map<QuotaProvider, Promise<ProviderQuotaSnapshot>>();
  private readonly abort = new AbortController();

  constructor(private readonly readers: Record<QuotaProvider, Reader>,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 90_000,
    private readonly failureBackoffMs = 30_000) {}

  async read(force = false): Promise<ProviderQuotaSnapshot[]> {
    return Promise.all((["agy","codex"] as const).map(provider => this.one(provider,force)));
  }

  dispose(): void {
    this.abort.abort();
    this.inflight.clear();
  }

  private one(provider: QuotaProvider, force: boolean): Promise<ProviderQuotaSnapshot> {
    const timestamp = this.now();
    const cached = this.cache.get(provider);
    const pending = this.inflight.get(provider);
    if (pending) return pending;
    if (!force && cached?.checkedAt &&
      timestamp - Date.parse(cached.checkedAt) < this.ttlMs) {
      return Promise.resolve({ ...cached, readings:[...cached.readings] });
    }
    if (!force && this.failures.has(provider) &&
      timestamp - (this.failures.get(provider) || 0) < this.failureBackoffMs) {
      return Promise.resolve(cached || { provider, status:"unavailable", readings:[], error:"Refresh temporarily unavailable." });
    }
    if (this.abort.signal.aborted) {
      return Promise.resolve({ provider,status:"unavailable",readings:[],error:"Quota reader is closed." });
    }
    const request = this.readers[provider](this.abort.signal).then(readings => {
      const result: ProviderQuotaSnapshot = {
        provider,status:"live",checkedAt:new Date(this.now()).toISOString(),
        readings,
      };
      this.cache.set(provider,result);this.failures.delete(provider);
      return result;
    }).catch(():ProviderQuotaSnapshot => {
      this.failures.set(provider,this.now());
      const existing = this.cache.get(provider);
      if (existing) {
        const result:ProviderQuotaSnapshot = { ...existing,status:"stale",readings:[...existing.readings],
          error:"Provider refresh failed; displaying an older snapshot." };
        this.cache.set(provider,result);return result;
      }
      return { provider,status:"unavailable",readings:[],
        error: provider === "agy"
          ? "AGY quota unavailable. Requires AGY CLI 1.2.15+ and an authenticated account."
          : "Codex quota unavailable. Sign in with Codex CLI and ensure app-server is supported." };
    }).finally(()=>this.inflight.delete(provider));
    this.inflight.set(provider,request);
    return request;
  }
}
