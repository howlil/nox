import assert from "node:assert/strict";
import test from "node:test";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";
import {
  CREDIT_BALANCES_KEY, CreditBalanceRepository, creditForModel, decodeCreditBalances,
} from "../../src/persistence/CreditBalanceRepository";

function fixture() {
  let stored: Record<string, unknown> = {
    "nox-token-usage-v1": { entries: [{ date: "2026-10-14", totalTokens: 60 }] },
    unrelated: { preserve: true },
  };
  const data = new PluginDataRepository({
    loadData: async () => stored,
    saveData: async (value: unknown) => { stored = value as Record<string, unknown>; },
  });
  return { repo: new CreditBalanceRepository(data), read: () => stored };
}

test("Manual balances persist independently without changing the token usage ledger", async () => {
  const f = fixture();
  await f.repo.upsert({ provider: "agy", model: null, unit: "credits", limit: 100, remaining: 76 });
  await f.repo.upsert({ provider: "agy", model: "gemini-flash", unit: "usd", limit: 20, remaining: 12.5 });
  const list = await f.repo.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].model, null);
  assert.equal(list[1].remaining, 12.5);
  assert.ok(Number.isFinite(Date.parse(list[0].updatedAt)));
  assert.deepEqual(f.read()["nox-token-usage-v1"], { entries: [{ date: "2026-10-14", totalTokens: 60 }] });
  assert.deepEqual(f.read().unrelated, { preserve: true });
  assert.equal((f.read()[CREDIT_BALANCES_KEY] as unknown[]).length, 2);
});

test("Exact model balance overrides shared provider pool, which isn't duplicated in storage", async () => {
  const f = fixture();
  await f.repo.upsert({ provider: "agy", model: null, unit: "credits", limit: 200, remaining: 180 });
  await f.repo.upsert({ provider: "agy", model: "gemini", unit: "credits", limit: 50, remaining: 20 });
  const list = await f.repo.list();
  assert.deepEqual(creditForModel(list, "agy", "gemini")?.shared, false);
  assert.deepEqual(creditForModel(list, "agy", "claude")?.shared, true);
  assert.equal(creditForModel(list, "agy", "claude")?.balance.remaining, 180);
  assert.equal(creditForModel(list, "codex", "gemini"), null);
  await f.repo.upsert({ provider: "agy", model: null, unit: "credits", limit: 200, remaining: 100 });
  assert.equal((await f.repo.list()).length, 2);
  await f.repo.remove("agy", null);
  assert.deepEqual((await f.repo.list()).map(x => x.model), ["gemini"]);
});

test("Malformed amounts, non-finite values and invalid scopes cannot be saved", async () => {
  const f = fixture();
  for (const remaining of [-1, 101, Infinity, NaN]) {
    await assert.rejects(f.repo.upsert({ provider: "agy", model: null, unit: "credits",
      limit: 100, remaining }), /Invalid credit/);
  }
  await assert.rejects(f.repo.upsert({ provider: "agy", model: "test", unit: "requests",
    limit: 10, remaining: 3.5 }), /Invalid credit/);
  await assert.rejects(f.repo.upsert({ provider: "codex", model: "  bad id ", unit: "usd",
    limit: 10, remaining: 8 }), /Invalid credit/);
  await assert.rejects(f.repo.upsert({ provider: "codex", model: null, unit: "usd",
    limit: 0, remaining: 0 }), /Invalid credit/);
  assert.deepEqual(await f.repo.list(), []);
});

test("Decoder ignores invalid saved records instead of rendering fabricated balances", () => {
  const records = decodeCreditBalances([
    { provider: "agy", model: null, unit: "credits", limit: 10, remaining: 8,
      updatedAt: "2026-10-14T12:00:00.000Z" },
    { provider: "agy", model: null, unit: "credits", limit: 10, remaining: 999,
      updatedAt: "2026-10-14T12:00:00.000Z" },
    { provider: "agy", model: "m", unit: "usd", limit: -1, remaining: 0,
      updatedAt: "2026-10-14T12:00:00.000Z" },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].remaining, 8);
});

test("Failed writes do not make the new balance visible", async () => {
  const plugin = new PluginDataRepository({
    loadData: async () => ({}),
    saveData: async () => { throw new Error("write failed"); },
  });
  const repo = new CreditBalanceRepository(plugin);
  await assert.rejects(repo.upsert({ provider: "agy", model: null,
    unit: "credits", limit: 10, remaining: 9 }), /write failed/);
  assert.deepEqual(await repo.list(), []);
});
