import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const policy = "scripts/ci/obsidian-critical-policy.mjs";
function check(source: string) {
  const dir = mkdtempSync(join(tmpdir(), "nox-policy-"));
  try {
    const file = join(dir, "SettingsTab.ts");
    writeFileSync(file, source);
    return spawnSync(process.execPath, [policy, file], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("an intermediate variable cannot bypass Obsidian heading lint", () => {
  const result = check('const header = surface.createDiv(); header.createEl("h2", { text: "Settings" });');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /settings heading h2/);
});
test("nested headings fail, not just top-level createEl", () => {
  const result = check('function mount() { const heading = view; heading.createEl("h4", { text: "Settings" }); }');
  assert.equal(result.status, 1);
});
test("native Setting heading remains valid", () => {
  const result = check('new Setting(header).setName("Settings").setHeading();');
  assert.equal(result.status, 0, result.stderr);
});
