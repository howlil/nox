import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface RuntimeBuildIdentity {
  revision: string;
  sourceSha: string;
  builtAt: string;
  transport: string;
  pluginDir: string;
  vaultDir: string;
}

/** Inspect the installed file separately from the in-memory build identity. */
export async function runtimeProvenanceReport(identity: RuntimeBuildIdentity): Promise<string> {
  const lines = [
    "NOX runtime diagnostic",
    "loadedRevision=" + identity.revision,
    "loadedSourceSha=" + identity.sourceSha,
    "loadedAtBuild=" + identity.builtAt,
    "loadedTransport=" + identity.transport,
    "vaultDir=" + identity.vaultDir,
    "pluginDir=" + identity.pluginDir,
  ];
  if (identity.vaultDir.startsWith("(") || identity.pluginDir.startsWith("(")) {
    return [...lines, "installedMainSha256=unavailable", "diskMatchesLoadedIdentity=unknown"].join("\n");
  }
  const pluginPath = path.isAbsolute(identity.pluginDir)
    ? identity.pluginDir : path.resolve(identity.vaultDir, identity.pluginDir);
  try {
    const installed = await readFile(path.join(pluginPath, "main.js"));
    lines.push("installedMainSha256=" + createHash("sha256").update(installed).digest("hex"));
    // A changed file is not proof the running Electron module has reloaded.
    const text = installed.toString("utf8");
    lines.push("diskMatchesLoadedIdentity=" + (text.includes(identity.revision)
      && text.includes(identity.sourceSha) && text.includes(identity.transport) ? "yes" : "no"));
  } catch {
    lines.push("installedMainSha256=unavailable", "diskMatchesLoadedIdentity=unknown");
  }
  return lines.join("\n");
}
