import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeNoxSettings,
  DEFAULT_NOX_SETTINGS,
  saveNoxSettings,
} from "../../src/settings/NoxSettings";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";

test("decodes settings field-by-field with safe defaults", () => {
  assert.deepEqual(
    decodeNoxSettings(null),
    DEFAULT_NOX_SETTINGS,
  );

  assert.deepEqual(
    decodeNoxSettings({
      "nox-settings": {
        executablePath: "/bin/agy",
        preferredModel: 42,
      },
    }),
    {
      executablePath: "/bin/agy",
      preferredModel: "",
    },
  );
});

test("saving settings preserves unrelated plugin data", async () => {
  let saved: unknown;

  const plugin = {
    loadData: async () => ({
      unrelated: { keep: true },
    }),
    saveData: async (data: unknown) => {
      saved = data;
    },
  };

  const settings = {
    executablePath: "/bin/agy",
    preferredModel: "model-a",
  };

  await saveNoxSettings(
    new PluginDataRepository(plugin as never),
    settings,
  );

  assert.deepEqual(saved, {
    unrelated: { keep: true },
    "nox-settings": settings,
  });
});
