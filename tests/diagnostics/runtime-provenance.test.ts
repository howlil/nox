import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runtimeProvenanceReport } from "../../src/settings/runtime-provenance";

const identity = { revision: "release/1.3.0", sourceSha: "a".repeat(40), builtAt: "reproducible-release",
  transport: "NOX_RUNTIME_TRANSPORT_V3:node-https-sse",
  vaultDir: "(non-file-system vault)", pluginDir: "(unknown plugin directory)" };

test("diagnostic works when no native vault directory exists", async () => {
  const report = await runtimeProvenanceReport(identity);
  assert.match(report, /loadedTransport=NOX_RUNTIME_TRANSPORT_V3/);
  assert.match(report, /loadedSourceSha=/);
  assert.match(report, /diskMatchesLoadedIdentity=unknown/);
  assert.doesNotMatch(report, /bearer|credential|token=/i);
});

test("diagnostic reports on-disk hash and detects a stale installed bundle", async () => {
  const root = mkdtempSync(join(tmpdir(), "nox-runtime-"));
  const relative = join(".obsidian", "plugins", "nox");
  try {
    mkdirSync(join(root, relative), { recursive: true });
    const current = "release/1.3.0 " + identity.sourceSha + " NOX_RUNTIME_TRANSPORT_V3:node-https-sse";
    const file = join(root, relative, "main.js");
    writeFileSync(file, current);
    const args = { ...identity, vaultDir: root, pluginDir: relative };
    const report = await runtimeProvenanceReport(args);
    assert.match(report, /diskMatchesLoadedIdentity=yes/);
    assert.match(report, new RegExp("installedMainSha256=" + createHash("sha256").update(current).digest("hex")));
    writeFileSync(file, "old main.js");
    assert.match(await runtimeProvenanceReport(args), /diskMatchesLoadedIdentity=no/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing installed file is visible without crashing diagnostics", async () => {
  const report = await runtimeProvenanceReport({ ...identity,
    vaultDir: "/nonexistent/vault", pluginDir: ".obsidian/plugins/nox" });
  assert.match(report, /installedMainSha256=unavailable/);
});
