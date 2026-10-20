/**
 * Checks the two reviewed CSS boundaries without enforcing Tailwind syntax on
 * the plugin's source input. Built CSS must be consumable by Obsidian directly.
 */
export function assertCompiledPluginCss(css) {
  if (/@(?:source|theme|apply)\b/.test(css) ||
      /@import\s*["']tailwindcss(?:\/[^"']*)?["']/.test(css)) {
    throw new Error("Production CSS contains uncompiled Tailwind directives.");
  }
}

/** Prevent a previous landing regression where literal backslash-n preceded @supports. */
export function assertLandingDialogCss(css) {
  if (/\\n@supports\b/.test(css)) {
    throw new Error("Landing dialog CSS contains literal newline escape before @supports.");
  }
}

/** A valid CSS file can still be a partial or stale release artifact.
 * Settings is a native Obsidian tab, so missing its CSS silently breaks the UI.
 */
export function assertNoxSettingsStyleContract(css) {
  for (const selector of [
    "--nox-accent:",
    ".nox-settings-shell",
    ".nox-settings-surface",
    ".nox-settings-tabs",
    ".nox-settings-native-row",
    ".nox-usage-overview",
    ".nox-token-chart-bars",
  ]) {
    if (!css.includes(selector)) {
      throw new Error("Production CSS is missing Nox settings style: " + selector);
    }
  }
}
