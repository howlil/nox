import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DevPublishQueue, syncDevelopmentArtifacts, validateDevVault,
} from "../../../scripts/dev-core.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nox-dev-test-"));
  const vault = join(root, "vault");
  const dist = join(root, "dist");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "manifest.json"), JSON.stringify({ id: "nox-obsidian" }));
  writeFileSync(join(dist, "main.js"), "bundle-v1");
  writeFileSync(join(dist, "styles.css"), "styles-v1");
  return { root, vault, dist, plugin: join(vault, ".obsidian", "plugins", "nox-obsidian") };
}

test("rejects an invalid vault before writing plugin files", () => {
  const f = fixture();
  try {
    assert.throws(() => validateDevVault(join(f.root, "wrong")), /not an Obsidian vault/);
    assert.equal(existsSync(join(f.root, "wrong", ".obsidian")), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("rejects an incomplete or mismatched build without changing installed files", () => {
  const f = fixture();
  try {
    syncDevelopmentArtifacts({ targetVault: f.vault, distDir: f.dist });
    writeFileSync(join(f.dist, "manifest.json"), JSON.stringify({ id: "wrong-id" }));
    assert.throws(
      () => syncDevelopmentArtifacts({ targetVault: f.vault, distDir: f.dist }),
      /Manifest plugin ID/,
    );
    assert.equal(readFileSync(join(f.plugin, "main.js"), "utf8"), "bundle-v1");
    writeFileSync(join(f.dist, "manifest.json"), JSON.stringify({ id: "nox-obsidian" }));
    rmSync(join(f.dist, "styles.css"));
    assert.throws(
      () => syncDevelopmentArtifacts({ targetVault: f.vault, distDir: f.dist }),
      /Missing development artifact/,
    );
    assert.equal(readFileSync(join(f.plugin, "main.js"), "utf8"), "bundle-v1");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("only changed artifacts are synchronized and hot-reload marker is opt-in", () => {
  const f = fixture();
  try {
    const first = syncDevelopmentArtifacts({ targetVault: f.vault, distDir: f.dist });
    assert.deepEqual(first.changed, ["manifest.json", "styles.css", "main.js"]);
    assert.equal(existsSync(join(f.plugin, ".hotreload")), false);
    const unchanged = syncDevelopmentArtifacts({ targetVault: f.vault, distDir: f.dist });
    assert.deepEqual(unchanged.changed, []);
    const before = statSync(join(f.plugin, "main.js")).mtimeMs;
    writeFileSync(join(f.dist, "styles.css"), "styles-v2");
    const css = syncDevelopmentArtifacts({ targetVault: f.vault, distDir: f.dist, reloadMode: "hot-reload" });
    assert.deepEqual(css.changed, ["styles.css"]);
    assert.equal(readFileSync(join(f.plugin, "styles.css"), "utf8"), "styles-v2");
    assert.equal(existsSync(join(f.plugin, ".hotreload")), true);
    assert.equal(statSync(join(f.plugin, "main.js")).mtimeMs, before);
    syncDevelopmentArtifacts({ targetVault: f.vault, distDir: f.dist, reloadMode: "cli" });
    assert.equal(existsSync(join(f.plugin, ".hotreload")), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("CLI mode rejects an unmanaged Hot-Reload marker instead of double-reloading", () => {
  const f = fixture();
  try {
    syncDevelopmentArtifacts({ targetVault: f.vault, distDir: f.dist });
    writeFileSync(join(f.plugin, ".hotreload"), "user-owned");
    assert.throws(
      () => syncDevelopmentArtifacts({ targetVault: f.vault, distDir: f.dist, reloadMode: "cli" }),
      /conflicts with CLI reload/,
    );
    assert.equal(readFileSync(join(f.plugin, ".hotreload"), "utf8"), "user-owned");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("publish queue coalesces multiple changes and supports recovery after failures", async () => {
  let attempts = 0;
  const errors: unknown[] = [];
  const queue = new DevPublishQueue({
    delayMs: 200,
    publish: async () => {
      attempts++;
      if (attempts === 1) throw new Error("CLI unavailable");
    },
    onError: (error: unknown) => errors.push(error),
  });
  queue.schedule();
  queue.schedule();
  await queue.flush();
  assert.equal(attempts, 1);
  assert.equal(errors.length, 1);
  queue.schedule();
  await queue.flush();
  assert.equal(attempts, 2);
  await queue.stop();
});

test("publish queue never overlaps reloads", async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const queue = new DevPublishQueue({
    delayMs: 1,
    publish: async () => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      if (calls === 1) await blocked;
      active--;
    },
  });
  queue.schedule();
  const first = queue.flush();
  queue.schedule();
  release();
  await first;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(peak, 1);
  assert.equal(calls, 2);
  await queue.stop();
});
