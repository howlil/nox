import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertCompiledPluginCss, assertLandingDialogCss,
} from "../../../scripts/css-artifact-policy.mjs";

test("compiled Obsidian styles contain no Tailwind input-only syntax", () => {
  assert.doesNotThrow(() => assertCompiledPluginCss(".nox-root { color: #161616; }"));
  for (const source of [
    "@source './src';",
    "@theme inline { --color-ink: #000; }",
    ".foo { @apply p-2; }",
    '@import "tailwindcss/utilities.css";',
  ]) {
    assert.throws(() => assertCompiledPluginCss(source), /uncompiled Tailwind/);
  }
});

test("landing dialog CSS separates @supports with actual newline characters", () => {
  const css = readFileSync("landing/src/components/arc/dialog/dialog.module.css", "utf8");
  assert.doesNotThrow(() => assertLandingDialogCss(css));
  assert.throws(
    () => assertLandingDialogCss(String.raw`}.a{}\\n@supports (height: 100dvh) {}`),
    /literal newline escape/,
  );
});
