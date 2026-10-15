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
