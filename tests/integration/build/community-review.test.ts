import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("NOX leaves remain workspace-owned across plugin reload", () => {
  const main = source("src/main.ts");
  const unload = main.match(/onunload\(\): void \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(unload, "Obsidian plugin must implement unload cleanup");
  assert.doesNotMatch(unload, /detachLeavesOfType\s*\(/, "Never detach a workspace leaf in onunload");
  assert.match(unload, /flushSessionTime\(/, "Preserve the session-time flush");
  assert.match(unload, /\.finally\(\(\) => learning\.dispose\(\)\)/, "Finish owner cleanup after checkpoint");
});

test("Obsidian community P0 style and settings findings cannot regress", () => {
  for (const path of [
    "src/chat/composer.ts",
    "src/chat/history-list.ts",
    "src/chat/motion.ts",
    "src/chat/primitives.ts",
  ]) {
    assert.doesNotMatch(source(path), /\.style\.(?:setProperty|height|overflowY|transition|transform|willChange|removeProperty)\b/,
      path + ": avoid direct style mutation; use CSS classes or setCssProps");
  }

  const settings = source("src/settings/SettingsTab.ts");
  assert.match(settings, /getSettingDefinitions\(\)/, "Use searchable Obsidian 1.13+ settings");
  assert.match(settings, /this\.settingsDefinitions\(\)\.map/, "Each settings field must be indexed natively");
  assert.match(settings, /nox-settings-native-row/, "Native Obsidian setting rows must be mounted");
  assert.doesNotMatch(settings, /new Setting\(form\)/, "Avoid shadow settings outside the definitions");
  assert.doesNotMatch(settings, /\.setName\("Nox"\)\.setHeading\(\)/, "Do not duplicate plugin name as heading");
  assert.match(settings, /new Setting\(header\)\.setName\("Settings"\)\.setHeading\(\)/);
});

test("dynamic composer, swipe, icon and motion visuals have a scoped stylesheet contract", () => {
  const styles = source("styles.css");
  const composer = source("src/chat/composer.ts");
  const history = source("src/chat/history-list.ts");
  const motion = source("src/chat/motion.ts");

  assert.match(styles, /height:\s*var\(--nox-input-height,\s*auto\)/);
  assert.match(styles, /\.nox-input\.is-overflowing/);
  assert.match(composer, /setCssProps\(\{ "--nox-input-height":/);
  assert.match(styles, /translate3d\(var\(--nox-history-swipe-x,\s*0px\)/);
  assert.match(styles, /\.nox-history-swipe-front\.is-gesturing/);
  assert.match(history, /setCssProps\(\{ "--nox-history-swipe-x":/);
  assert.match(styles, /\.nox-motion-active\s*\{/);
  assert.match(motion, /element\.addClass\("nox-motion-active"\)/);
  assert.match(styles, /\.nox-theme-portal \.nox-icon/);
});

test("release requires verified attestations for the three official plugin assets", () => {
  const workflow = source(".github/workflows/release.yml");
  assert.match(workflow, /uses: actions\/attest@v4/);
  for (const name of ["main.js", "manifest.json", "styles.css"]) {
    assert.match(workflow, new RegExp("subject-path: dist/" + name.replace(".", "\\.")));
  }
  assert.match(workflow, /gh attestation verify "dist\/\$file"/);
  assert.ok(workflow.indexOf("Verify build provenance before publication") <
    workflow.indexOf("Publish only verified source-bound release assets"));
  assert.match(workflow, /gh attestation verify "release-proof\/\$item"/);
  assert.match(workflow, /gh release edit "\$version" --draft=false/);
  assert.match(workflow, /strict: "true"/);

  const publishing = source(".github/workflows/publish-release.yml");
  assert.match(publishing, /workflow_dispatch:/);
  assert.doesNotMatch(publishing, /desktop_acceptance/);
  assert.match(publishing, /gh attestation verify/);
  assert.match(publishing, /gh release edit "\$VERSION" --draft=false/);
});
