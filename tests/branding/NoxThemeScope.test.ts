import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("styles.css", "utf8");
const history = readFileSync("src/chat/history-list.ts", "utf8");
const view = readFileSync("src/chat/ChatView.ts", "utf8");

function block(header: string): string {
  const index = css.indexOf(header);
  assert.ok(index >= 0, "missing theme selector: " + header);
  const open = css.indexOf("{", index);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}
const light = block(".nox-root,\n.nox-settings,\n.nox-theme-portal {");
const variable = (section: string, name: string) => {
  const match = section.match(new RegExp(`(?:^|\\n)\\s*${name}:\\s*(#[a-f0-9]{6});`, "i"));
  assert.ok(match, `missing palette token ${name}`);
  return match[1];
};
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("NOX has one light-only palette owner across chat, settings and overlays", () => {
  assert.match(light, /color-scheme:\s*light;/);
  assert.doesNotMatch(css, /\.theme-dark \.nox-root|\.nox-force-dark|\.nox-force-light/);
  assert.doesNotMatch(css, /(?:^|\n)\s*body\s*\{[^}]*--nox-page:/s);
});

test("Obsidian-rendered controls inherit only NOX-scoped semantic colors", () => {
  for (const variableName of [
    "--background-primary", "--background-secondary", "--background-modifier-border",
    "--text-normal", "--text-muted", "--text-error", "--interactive-accent",
    "--code-background", "--code-normal", "--link-color",
  ]) assert.ok(light.includes(variableName + ":"), "missing Obsidian bridge " + variableName);
  assert.match(css, /\.nox-markdown pre\s*\{[^}]*background:\s*var\(--nox-inset\)/s);
  assert.match(css, /\.nox-markdown a\s*\{[^}]*color:\s*var\(--nox-accent-ink\)/s);
  assert.match(css, /\.nox-usage-metric span\s*\{[^}]*color:\s*var\(--nox-ink-2\)/s);
  assert.match(css, /\.nox-usage-warning\s*\{[^}]*color:\s*var\(--nox-red\)/s);
  assert.doesNotMatch(css, /rgba\(52,\s*199,\s*89/);
});

test("Light palette keeps readable text and metadata contrast", () => {
  const page = variable(light, "--nox-page");
  const surface = variable(light, "--nox-surface");
  for (const key of ["--nox-ink", "--nox-ink-2", "--nox-ink-3"]) {
    const ink = variable(light, key);
    assert.ok(contrast(ink, page) >= 4.5, `${key} fails page contrast`);
    assert.ok(contrast(ink, surface) >= 4.5, `${key} fails surface contrast`);
  }
});

test("NOX dialogs and history menus keep light palette in owned portals", () => {
  assert.match(history, /setUseNativeMenu\(false\)/);
  assert.match(history, /setParentElement\(portal\)/);
  assert.match(history, /menu\.onHide\(\(\) => portal\.remove\(\)\)/);
  assert.doesNotMatch(history, /appearance\(\)/);
  assert.match(view, /modal\.modalEl\.addClass\("nox-theme-portal"\)/);
  assert.match(css, /\.nox-menu-portal \.menu\s*\{[^}]*background:\s*var\(--nox-surface\)/s);
});
