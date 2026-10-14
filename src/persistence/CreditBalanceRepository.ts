import type { PluginDataRepository } from "./PluginDataRepository";

export const CREDIT_BALANCES_KEY = "nox-credit-balances-v1";
export type CreditProvider = "agy" | "codex" | "chatgpt";
export type CreditUnit = "credits" | "usd" | "requests";

export interface CreditBalance {
  provider: CreditProvider;
  /** Null is one provider-wide pool shared across models. */
  model: string | null;
  unit: CreditUnit;
  limit: number;
  remaining: number;
  /** User-reported snapshot time, not a provider verification timestamp. */
  updatedAt: string;
}
export type CreditBalanceInput = Pick<CreditBalance, "provider" | "model" | "unit" | "limit" | "remaining">;

const isProvider = (value: unknown): value is CreditProvider =>
  value === "agy" || value === "codex" || value === "chatgpt";
const isUnit = (value: unknown): value is CreditUnit =>
  value === "credits" || value === "usd" || value === "requests";
const validAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000_000;
const validModel = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.trim().length > 0 &&
    value.trim().length <= 128 && value === value.trim());
const validBalance = (value: unknown): value is CreditBalance => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return isProvider(v.provider) && validModel(v.model) && isUnit(v.unit) &&
    validAmount(v.limit) && v.limit > 0 &&
    validAmount(v.remaining) && v.remaining <= v.limit &&
    (v.unit !== "requests" || (Number.isSafeInteger(v.limit) && Number.isSafeInteger(v.remaining))) &&
    typeof v.updatedAt === "string" && Number.isFinite(Date.parse(v.updatedAt));
};

export function decodeCreditBalances(raw: unknown): CreditBalance[] {
  if (!Array.isArray(raw)) return [];
  const byScope = new Map<string, CreditBalance>();
  for (const item of raw) {
    if (!validBalance(item)) continue;
    const balance = item as CreditBalance;
    byScope.set(JSON.stringify([balance.provider, balance.model]), {
      provider: balance.provider, model: balance.model, unit: balance.unit,
      limit: balance.limit, remaining: balance.remaining, updatedAt: balance.updatedAt,
    });
  }
  return [...byScope.values()];
}

/** Manual snapshots never decrement from tokens or masquerade as provider balances. */
export class CreditBalanceRepository {
  constructor(private readonly data: PluginDataRepository) {}

  async list(): Promise<CreditBalance[]> {
    const stored = await this.data.read();
    return decodeCreditBalances(stored[CREDIT_BALANCES_KEY]);
  }

  async upsert(input: CreditBalanceInput): Promise<void> {
    const record = { ...input, updatedAt: new Date().toISOString() };
    if (!validBalance(record)) throw new Error("Invalid credit limit, remaining amount or scope.");
    await this.data.update(current => {
      const balances = decodeCreditBalances(current[CREDIT_BALANCES_KEY]);
      const next = balances.filter(item =>
        item.provider !== record.provider || item.model !== record.model);
      next.push(record);
      return { ...current, [CREDIT_BALANCES_KEY]: next };
    });
  }

  async remove(provider: CreditProvider, model: string | null): Promise<void> {
    if (!isProvider(provider) || !validModel(model)) throw new Error("Invalid credit balance scope.");
    await this.data.update(current => ({
      ...current,
      [CREDIT_BALANCES_KEY]: decodeCreditBalances(current[CREDIT_BALANCES_KEY])
        .filter(item => item.provider !== provider || item.model !== model),
    }));
  }
}

/** Model-specific snapshots override a shared provider pool, without double counting either pool. */
export function creditForModel(
  balances: readonly CreditBalance[], provider: string, model: string,
): { balance: CreditBalance; shared: boolean } | null {
  const specific = balances.find(b => b.provider === provider && b.model === model);
  if (specific) return { balance: specific, shared: false };
  const shared = balances.find(b => b.provider === provider && b.model === null);
  return shared ? { balance: shared, shared: true } : null;
}
