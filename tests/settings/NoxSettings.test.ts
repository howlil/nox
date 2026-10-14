import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeNoxSettings,
  DEFAULT_NOX_SETTINGS,
  saveNoxSettings,
} from "../../src/settings/NoxSettings";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";

test("Codex is an explicit provider and keeps its executable separate from AGY", () => {
  const settings = decodeNoxSettings({ "nox-settings": {
    provider: "codex", executablePath: "/bin/agy", codexExecutablePath: "/bin/codex",
  } });
  assert.equal(settings.provider, "codex");
  assert.equal(settings.executablePath, "/bin/agy");
  assert.equal(settings.codexExecutablePath, "/bin/codex");
});

test("legacy and invalid provider settings keep the existing AGY default", () => {
  assert.equal(decodeNoxSettings({ "nox-settings": { executablePath: "/bin/agy" } }).provider, "agy");
  assert.equal(decodeNoxSettings({ "nox-settings": { provider: "unknown", codexExecutablePath: 42 } }).provider, "agy");
});

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
      provider: "agy",
      executablePath: "/bin/agy",
      codexExecutablePath: "",
      preferredModel: "",
      appearance: "system",
    },
  );
});

test("appearance validates persisted choices with a system fallback", () => {
  assert.equal(decodeNoxSettings({ "nox-settings": { appearance: "dark" } }).appearance, "dark");
  assert.equal(decodeNoxSettings({ "nox-settings": { appearance: "light" } }).appearance, "light");
  assert.equal(decodeNoxSettings({ "nox-settings": { appearance: "invalid" } }).appearance, "system");
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
    provider: "agy" as const,
    executablePath: "/bin/agy",
    codexExecutablePath: "",
    preferredModel: "model-a",
    appearance: "dark" as const,
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
