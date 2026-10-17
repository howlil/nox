import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const policy = "scripts/ci/obsidian-critical-policy.mjs";
function check(source: string) {
  const dir = mkdtempSync(join(tmpdir(), "nox-community-p0-"));
  try {
    const file = join(dir, "SettingsTab.ts");
    writeFileSync(file, source);
    return spawnSync(process.execPath, [policy, file], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Community: reject manual HTML headings, including aliased containers", () => {
  for (const source of [
    'const header = surface.createDiv(); header.createEl("h2", { text: "General" });',
    'function nested() { return surface.createEl("h4", { text: "General" }); }',
  ]) {
    const out = check(source);
    assert.equal(out.status, 1, out.stderr);
    assert.match(out.stderr, /manual-html-heading/);
  }
});

test("Community: reject the exact 1.1.3 Settings heading regression", () => {
  for (const heading of ["Settings", "Plugin settings", "Options", "Nox"]) {
    const out = check('new Setting(header).setName("' + heading + '").setHeading();');
    assert.equal(out.status, 1, heading + ": " + out.stderr);
    assert.match(out.stderr, /problematic-settings-heading/);
  }
});

test("Community: reject a named settings heading stored in a variable", () => {
  const out = check('const heading = new Setting(header).setName("Settings"); heading.setHeading();');
  assert.equal(out.status, 1, out.stderr);
  assert.match(out.stderr, /problematic-settings-heading/);
});

test("Community: allow real section headings and labels without headings", () => {
  for (const source of [
    'new Setting(group).setName("Provider accounts").setHeading();',
    'new Setting(form).setName("Settings").addText(() => {});',
    'header.createEl("p", { text: "Manage your agent runtime." });',
  ]) {
    const out = check(source);
    assert.equal(out.status, 0, out.stderr);
  }
});
