import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deployPlugin, verifyDeployedPlugin } from "../../../scripts/deploy-core.mjs";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "nox-deploy-test-"));
}

function addRequiredBuildAssets(dist: string) {
  writeFileSync(join(dist, "manifest.json"), JSON.stringify({ id: "nox" }));
  writeFileSync(join(dist, "styles.css"), "/* nox styles */");
}

const silent = {
  log: () => {},
  warn: () => {},
};

test("deploy copies dist and enables Nox without removing existing plugins", () => {
  const root = tempRoot();
  const dist = join(root, "dist");
  const vault = join(root, "vault");
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });

  writeFileSync(join(dist, "main.js"), "bundle");
  addRequiredBuildAssets(dist);
  writeFileSync(join(dist, "styles.css"), "styles");
  writeFileSync(
    join(vault, ".obsidian", "community-plugins.json"),
    JSON.stringify(["other-plugin"]),
  );

  const target = deployPlugin({
    targetVault: vault,
    distDir: dist,
    logger: silent,
  });

  assert.equal(
    readFileSync(join(target, "main.js"), "utf8"),
    "bundle",
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(vault, ".obsidian", "community-plugins.json"),
        "utf8",
      ),
    ),
    ["other-plugin", "nox"],
  );
});

test("deploy does not duplicate an already-enabled plugin", () => {
  const root = tempRoot();
  const dist = join(root, "dist");
  const vault = join(root, "vault");
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(join(dist, "main.js"), "bundle");
  addRequiredBuildAssets(dist);
  writeFileSync(
    join(vault, ".obsidian", "community-plugins.json"),
    JSON.stringify(["nox"]),
  );

  deployPlugin({
    targetVault: vault,
    distDir: dist,
    logger: silent,
  });

  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(vault, ".obsidian", "community-plugins.json"),
        "utf8",
      ),
    ),
    ["nox"],
  );
});

test("invalid community plugin JSON does not block file deployment", () => {
  const root = tempRoot();
  const dist = join(root, "dist");
  const vault = join(root, "vault");
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(join(dist, "main.js"), "bundle");
  addRequiredBuildAssets(dist);
  writeFileSync(
    join(vault, ".obsidian", "community-plugins.json"),
    "{bad json",
  );

  const target = deployPlugin({
    targetVault: vault,
    distDir: dist,
    logger: silent,
  });

  assert.equal(
    readFileSync(join(target, "main.js"), "utf8"),
    "bundle",
  );
});

test("missing dist fails before touching the vault", () => {
  const root = tempRoot();

  assert.throws(
    () =>
      deployPlugin({
        targetVault: join(root, "vault"),
        distDir: join(root, "missing"),
        logger: silent,
      }),
    /dist\/ directory not found/,
  );
});

test("rejects a directory which is not an actual Obsidian vault", () => {
  const root = tempRoot();
  const dist = join(root, "dist");
  const notVault = join(root, "wrong-vault");
  mkdirSync(dist, { recursive: true });
  mkdirSync(notVault, { recursive: true });
  writeFileSync(join(dist, "main.js"), "bundle");
  addRequiredBuildAssets(dist);
  assert.throws(() => deployPlugin({
    targetVault: notVault, distDir: dist, logger: silent,
  }), /not an Obsidian vault/);
  assert.equal(existsSync(join(notVault, ".obsidian", "plugins")), false);
});

test("rejects missing or mismatched plugin build before touching the vault", () => {
  const root = tempRoot();
  const dist = join(root, "dist");
  const vault = join(root, "vault");
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(join(dist, "main.js"), "bundle");
  assert.throws(() => deployPlugin({
    targetVault: vault, distDir: dist, logger: silent,
  }), /Missing required plugin build output/);
  addRequiredBuildAssets(dist);
  writeFileSync(join(dist, "manifest.json"), JSON.stringify({ id: "wrong-plugin" }));
  assert.throws(() => deployPlugin({
    targetVault: vault, distDir: dist, logger: silent,
  }), /manifest plugin id/);
  assert.equal(existsSync(join(vault, ".obsidian", "plugins")), false);
});

test("production deploy removes only the managed development hot-reload marker", () => {
  const root = tempRoot();
  const dist = join(root, "dist");
  const vault = join(root, "vault");
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(join(dist, "main.js"), "bundle");
  addRequiredBuildAssets(dist);

  const target = deployPlugin({ targetVault: vault, distDir: dist, logger: silent });
  const marker = join(target, ".hotreload");
  writeFileSync(marker, "managed by NOX development orchestrator\n");
  deployPlugin({ targetVault: vault, distDir: dist, logger: silent });
  assert.equal(existsSync(marker), false);

  writeFileSync(marker, "user-owned");
  deployPlugin({ targetVault: vault, distDir: dist, logger: silent });
  assert.equal(readFileSync(marker, "utf8"), "user-owned");
});

test("verification detects changed installed manifest, CSS and main bytes", () => {
  const root = tempRoot();
  const dist = join(root, "dist"), vault = join(root, "vault");
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(join(dist, "main.js"), "release/1.3.0");
  addRequiredBuildAssets(dist);
  const target = deployPlugin({ targetVault: vault, distDir: dist, logger: silent });
  const expected = verifyDeployedPlugin({ distDir: dist, pluginDir: target });
  assert.match(expected["main.js"], /^[0-9a-f]{64}$/);
  for (const name of ["manifest.json", "styles.css", "main.js"]) {
    const original = readFileSync(join(target, name));
    writeFileSync(join(target, name), "corrupted");
    assert.throws(() => verifyDeployedPlugin({ distDir: dist, pluginDir: target }),
      new RegExp("Installed artifact mismatch: " + name.replace(".", "\\.")));
    writeFileSync(join(target, name), original);
  }
});

test("production deploy leaves unrelated build output out of the plugin folder", () => {
  const root = tempRoot();
  const dist = join(root, "dist"), vault = join(root, "vault");
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(join(dist, "main.js"), "bundle");
  addRequiredBuildAssets(dist);
  writeFileSync(join(dist, "local-only-debug.txt"), "never deploy");
  const dest = deployPlugin({ targetVault: vault, distDir: dist, logger: silent });
  assert.equal(existsSync(join(dest, "local-only-debug.txt")), false);
});
