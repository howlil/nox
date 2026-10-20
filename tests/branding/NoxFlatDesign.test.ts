import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("styles.css", "utf8");

// Protect the design contract at source level, not with a late !important patch.
test("Nox uses Howlil neutral foundations and a solid purple accent", () => {
  for (const [token, value] of [
    ["--nox-page", "#FEFEFE"],
    ["--nox-inset", "#F7F7F7"],
    ["--nox-ink", "#161616"],
    ["--nox-accent", "#8653D5"],
    ["--nox-accent-soft", "#F4EDFF"],
    ["--nox-radius-window", "10px"],
    ["--nox-space-8", "32px"],
  ]) {
    assert.ok(css.includes(`${token}: ${value};`), `missing flat token ${token}`);
  }
  assert.doesNotMatch(css, /\.theme-dark \.nox-root|\.nox-force-dark|\.nox-force-light/);
  assert.match(css, /\.nox-root,\s*\.nox-settings,\s*\.nox-theme-portal\s*\{/);
});

test("Nox presentation contains no decorative gradients or shimmer", () => {
  assert.doesNotMatch(css, /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i);
  assert.doesNotMatch(css, /\bmask-image\s*:/i);
  assert.doesNotMatch(css, /\bnox-activity-shimmer\b/);
  assert.match(css, /--nox-popover-shadow:\s*none;/);
  assert.match(css, /--nox-composer-shadow:\s*none;/);
});

test("Capability cards are neutral, with purple reserved for selection", () => {
  const start = css.indexOf(".nox-capability-card {");
  const end = css.indexOf(".nox-capability-card-top {", start);
  assert.ok(start >= 0 && end > start, "capability styles missing");
  const cards = css.slice(start, end);
  assert.match(cards, /background:\s*var\(--nox-surface\)/);
  assert.match(cards, /\.nox-capability-card\.is-selected\s*\{[^}]*background:\s*var\(--nox-accent-soft\)/s);
  assert.doesNotMatch(cards, /\.nox-capability-card--(?:blue|coral|green|purple)\s*\{/);
  assert.doesNotMatch(cards, /--nox-card-(?:glow|wash|meta-ink)/);
});

test("Learning surfaces and actions keep their canonical selectors", () => {
  for (const selector of [
    ".nox-empty-context",
    ".nox-learning-start",
    ".nox-composer-box",
    ".nox-send-btn:not(:disabled)",
    ".nox-quiz-option.is-checked",
    ".nox-practice-evaluation",
    ".nox-review-card",
    ".nox-proposal",
    ".nox-learning-graph",
    ".nox-visual",
    ".nox-history-menu",
    ".nox-model-menu",
    ".nox-usage",
  ]) {
    assert.ok(css.includes(selector), `missing canonical surface ${selector}`);
  }
});

test("compact visual grammar uses high-contrast inset focus, never an outer ring", () => {
  assert.match(css, /outline:\s*2px solid var\(--nox-accent-ink\)/);
  assert.match(css, /outline-offset:\s*-2px/);
  assert.match(css, /\.nox-root \.nox-model-menu-row\.is-active\s*\{[^}]*outline-offset:\s*-2px;/s);
  assert.match(css, /\.nox-composer-controls\s*\{[^}]*grid-template-rows:\s*32px;/s);
  assert.match(css, /\.nox-input-line\s*\{[^}]*grid-column:\s*2;/s);
  assert.match(css, /\.nox-composer-box\.is-expanded \.nox-composer-controls\s*\{[^}]*grid-template-rows:\s*auto 32px;/s);
  assert.match(css, /\.nox-composer-box\.is-expanded \.nox-input-line\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
  assert.ok(css.includes("textarea.nox-input:is(:hover, :focus, :focus-visible, :active)"));
  assert.match(css, /\.nox-composer-box:focus-within\s*\{[^}]*border-color:\s*var\(--nox-accent-ink\);/s);
  assert.ok(css.includes(".nox-usage-header {"));
  assert.match(css, /\.nox-capability-card\s*\{[^}]*min-height:\s*90px;/s);
  assert.match(css, /\.nox-capability-meta\s*\{[^}]*background:\s*transparent;/s);
});

test("native rounded composer keeps the file picker, action menu and accessible model", () => {
  const composer = readFileSync("src/chat/composer.ts", "utf8");
  const view = readFileSync("src/chat/ChatView.ts", "utf8");
  assert.match(composer, /label: "Attach a text file"/);
  assert.match(composer, /this\.promptPlusBtn\.addEventListener\("click", options\.onOpenFilePicker\)/);
  assert.match(view, /onOpenFilePicker: \(\) => \{[\s\S]*?this\.fileInput\.click\(\);/);
  assert.match(composer, /nox-action-menu-key", text: "@"/);
  assert.match(composer, /setNoxIcon\(this\.modelTrigger, "bot"\)/);
  assert.match(composer, /aria-label", `Learning model: \$\{label\}`/);
  assert.match(css, /\.nox-composer-box\s*\{[^}]*border-radius:\s*var\(--nox-radius-pill\);/s);
  assert.match(css, /\.nox-header-right > :is\(\.nox-map-btn, \.nox-history-btn, \.nox-new-btn, \.nox-more-btn\)/);
  assert.match(css, /\.nox-prompt-plus\s*\{[^}]*border-radius:\s*var\(--nox-radius-pill\);/s);
  assert.match(css, /\.nox-model-trigger\s*\{[^}]*width:\s*32px;/s);
  assert.ok(composer.includes("wrapsAtCapsuleWidth"));
  assert.ok(composer.includes("const maxHeight = 120;"));
});

test("Settings use searchable Obsidian definitions and native usage/token pages", () => {
  const settings = readFileSync("src/settings/SettingsTab.ts", "utf8");
  const token = readFileSync("src/settings/TokenUsageSection.ts", "utf8");
  const usage = readFileSync("src/settings/ProviderUsageSection.ts", "utf8");
  assert.match(settings, /getSettingDefinitions\(\): SettingDefinitionItem\[\]/);
  assert.match(settings, /role: "tablist"/);
  assert.match(settings, /"aria-selected"/);
  assert.match(settings, /role: "tabpanel"/);
  assert.match(settings, /mountSettingsSurface\(setting\)/);
  assert.doesNotMatch(settings, /type: "page"/);
  assert.doesNotMatch(settings, /Loaded plugin build|Copy build diagnostic/);
  assert.ok(settings.includes("mountProviderUsageSection"));
  assert.ok(settings.includes("mountTokenUsageSection"));
  assert.doesNotMatch(settings, /display\(\): void|\.display\(\)/);
  assert.match(token, /cls:\s*"nox-usage-overview"/);
  assert.match(usage, /cls:\s*"nox-quota-progress"/);
  for (const source of [settings, token, usage]) {
    assert.doesNotMatch(source, /[Cc]redit[Bb]alance|Manual [Bb]alances|Add balance|Set balance/);
  }
});

test("Settings native rows and panels share one local style scope and explicit CSS failure state", () => {
  const settings = readFileSync("src/settings/SettingsTab.ts", "utf8");
  assert.match(settings, /this\\.containerEl\\.addClass\\("nox-settings"\\)/);
  assert.match(settings, /setting\\.settingEl\\.addClass\\("nox-settings-native-row"\\)/);
  assert.match(settings, /getComputedStyle\\(surface\\)\\.getPropertyValue\\("--nox-accent"\\)/);
  assert.match(settings, /Nox styles are missing/);
  assert.match(css, /\\.nox-settings \\.nox-settings-native-row \\.setting-item-name/);
  assert.match(css, /\\.nox-settings \\.nox-settings-style-warning\\[hidden\\]/);
  assert.match(css, /\\.nox-settings-surface \\.nox-settings-tabs\\s*\\{[^}]*width: min\\(460px, 100%\\)/s);
  assert.match(settings, /requestAnimationFrame\\(\\(\\) =>\\s*this\\.containerEl\\.querySelector<HTMLButtonElement>/);
});
