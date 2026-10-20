import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { transform } from "esbuild";
import { assertLandingDialogCss } from "./css-artifact-policy.mjs";

function cssFiles(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? cssFiles(path)
      : path.endsWith(".css") ? [path] : [];
  });
}

const files = ["styles.css", ...cssFiles("styles"), ...cssFiles("landing/src")];
for (const path of files) {
  const css = readFileSync(path, "utf8");
  if (path.endsWith("dialog.module.css")) assertLandingDialogCss(css);
  // esbuild parses CSS including at-rules, with sourcefile in diagnostics.
  // Tailwind input-only directives are permitted here but forbidden in dist/.
  await transform(css, { loader: "css", sourcefile: path, logLevel: "silent" });
}
console.log("CSS syntax parsed successfully (" + files.length + " source files).");
