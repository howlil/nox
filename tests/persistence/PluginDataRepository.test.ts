import assert from "node:assert/strict";
import test from "node:test";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";

test("serializes overlapping plugin-data updates without losing unrelated keys", async () => {
  let data: Record<string, unknown> = {
    "nox-settings": { preferredModel: "old" },
    "nox-sessions": { currentSessionId: "s1" },
  };

  let releaseFirstSave!: () => void;
  const firstSaveBlocked = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });
  let saveCount = 0;

  const plugin = {
    loadData: async () => structuredClone(data),
    saveData: async (next: Record<string, unknown>) => {
      saveCount += 1;
      if (saveCount === 1) {
        await firstSaveBlocked;
      }
      data = structuredClone(next);
    },
  };

  const repository = new PluginDataRepository(plugin as never);

  const settingsWrite = repository.update((current) => ({
    ...current,
    "nox-settings": { preferredModel: "model-a" },
  }));

  const sessionWrite = repository.update((current) => ({
    ...current,
    "nox-sessions": { currentSessionId: "s2" },
  }));

  releaseFirstSave();
  await Promise.all([settingsWrite, sessionWrite]);

  assert.deepEqual(data, {
    "nox-settings": { preferredModel: "model-a" },
    "nox-sessions": { currentSessionId: "s2" },
  });
});

test("a failed write does not poison later plugin-data updates", async () => {
  let data: Record<string, unknown> = {};
  let fail = true;

  const repository = new PluginDataRepository({
    loadData: async () => structuredClone(data),
    saveData: async (next: Record<string, unknown>) => {
      if (fail) {
        fail = false;
        throw new Error("disk unavailable");
      }
      data = structuredClone(next);
    },
  } as never);

  await assert.rejects(
    () => repository.update((current) => ({ ...current, first: true })),
    /disk unavailable/,
  );

  await repository.update((current) => ({ ...current, second: true }));

  assert.deepEqual(data, { second: true });
});
