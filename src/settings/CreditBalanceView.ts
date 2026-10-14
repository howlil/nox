/** Presentation port for manually entered credit balances.
 * The settings owner cannot import the persistence owner by architecture rule.
 * main.ts composes the structurally compatible persistence and UI contracts. */
export type CreditProvider = "agy" | "codex" | "chatgpt";
export type CreditUnit = "credits" | "usd" | "requests";

export interface CreditBalance {
  provider: CreditProvider;
  model: string | null;
  unit: CreditUnit;
  limit: number;
  remaining: number;
  updatedAt: string;
}
export type CreditBalanceInput = Pick<CreditBalance, "provider" | "model" | "unit" | "limit" | "remaining">;

export function creditForModel(
  balances: readonly CreditBalance[], provider: string, model: string,
): { balance: CreditBalance; shared: boolean } | null {
  // Token ledgers may use `requested: model-id` when the provider omits the
  // resolved model. Compare canonical IDs without changing persisted balances.
  const canonical = (value: string): string =>
    value.trim().replace(/^requested:\s*/i, "").trim().toLowerCase();
  const specific = balances.find(b => b.provider === provider && b.model !== null &&
    canonical(b.model) === canonical(model));
  if (specific) return { balance: specific, shared: false };
  const shared = balances.find(b => b.provider === provider && b.model === null);
  return shared ? { balance: shared, shared: true } : null;
}
