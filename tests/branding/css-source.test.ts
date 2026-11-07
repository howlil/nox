import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { noxCssSource } from "../support/css-source";

for (const newline of ["\n", "\r\n"]) {
  test(`CSS source preserves import order and theme selectors with ${newline === "\n" ? "LF" : "CRLF"}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "nox-css-source-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "styles"));
    const imports: string[] = [];
    const expected: string[] = [];
    for (let index = 0; index < 14; index++) {
      const name = `style-${index}.css`;
      imports.push(`@import "./styles/${name}";`);
      const content = `.nox-root,\n.nox-settings,\n.nox-theme-portal { --fixture: ${index}; }\n`;
      expected.push(content);
      writeFileSync(join(root, "styles", name), content.replace(/\n/g, newline));
    }
    writeFileSync(join(root, "styles.css"), imports.join(newline));
    assert.equal(noxCssSource(root), expected.join(""));
  });
}
