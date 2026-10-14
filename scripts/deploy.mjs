import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { deployPlugin } from "./deploy-core.mjs";

const PLUGIN_ID = "nox-obsidian";

const DEFAULT_VAULTS = [
  path.join(
    process.env.USERPROFILE || "",
    "Documents",
    "howlil",
  ),
];

const targetVault =
  process.argv[2] ||
  process.env.OBSIDIAN_VAULT ||
  DEFAULT_VAULTS.find((vault) =>
    fs.existsSync(path.join(vault, ".obsidian")),
  );

if (!targetVault) {
  console.error(
    "❌ No Obsidian vault found. Please pass your vault path:",
  );
  console.error(
    '   pnpm run deploy "C:\\Path\\To\\Your\\Vault"',
  );
  process.exit(1);
}

try {
  const pluginDest = deployPlugin({
    targetVault,
    distDir: path.resolve("dist"),
    pluginId: PLUGIN_ID,
  });

  const digest = (file) => createHash("sha256")
    .update(fs.readFileSync(file)).digest("hex");
  const sourceHash = digest(path.resolve("dist", "main.js"));
  const installedHash = digest(path.join(pluginDest, "main.js"));
  if (sourceHash !== installedHash) {
    throw new Error("Installed main.js differs from current build. Deployment verification failed.");
  }
  console.log("\nDeployed Nox to:", pluginDest);
  console.log("SHA256(main.js):", installedHash);
  console.log("IMPORTANT: Fully reload Nox in this SAME Obsidian vault.");
  console.log("Then open Nox Settings → Loaded plugin build to confirm revision/transport.");
  console.log("If the open vault path differs from above, deploy to the correct vault.");
} catch (error) {
  console.error(
    "❌",
    error instanceof Error
      ? error.message
      : String(error),
  );
  process.exit(1);
}
