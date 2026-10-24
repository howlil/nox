import { build } from "esbuild";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const app = await build({
  entryPoints: ["browser/src/proof.ts"], bundle: true, platform: "browser",
  format: "iife", target: "es2022", write: false, metafile: true, logLevel: "silent",
});
const modules = Object.keys(app.metafile.inputs);
const forbidden = modules.filter(path => path.includes("/node_modules/obsidian/") ||
  path.includes("/node_modules/electron/") || path.includes("/src/host/obsidian/") ||
  path.includes("packages/core/dist/"));
const externals = Object.values(app.metafile.outputs).flatMap(output =>
  output.imports.filter(value => value.external).map(value => value.path));
if (forbidden.length || externals.length) {
  throw new Error("Browser bundle imports host/externals: " + [...forbidden, ...externals].join(", "));
}
if (!modules.some(path => path.endsWith("packages/core/src/index.ts"))) {
  throw new Error("Browser did not consume public @nox/core facade");
}
const code = app.outputFiles[0].text;
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<h1>NOX Browser M6 Headless Proof</h1><pre id="result">RUNNING</pre>
<script src="/proof.js"></script></body></html>`;
const server = createServer((req, res) => {
  if (req.url === "/proof.js") {
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    res.end(code);
  } else {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    res.end(html);
  }
});
const directory = await mkdtemp(join(tmpdir(), "nox-m6-real-browser-"));
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
const chrome = process.env.CHROME_BIN || "google-chrome";

function runChrome(stage) {
  return new Promise((resolve, reject) => {
    const args = [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
      "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
      "--disable-extensions", "--disable-sync", "--no-proxy-server",
      "--virtual-time-budget=8000", "--dump-dom",
      "--user-data-dir=" + join(directory, "chrome-profile"),
      `http://127.0.0.1:${port}/?stage=${stage}`,
    ];
    const child = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 45000);
    child.stdout.on("data", part => { stdout += part.toString(); });
    child.stderr.on("data", part => { stderr += part.toString(); });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", code => {
      clearTimeout(timeout);
      if (code !== 0 || !stdout.includes("NOX_BROWSER_PROOF_PASS:" + stage)) {
        reject(new Error(`Chrome stage ${stage} failed (status ${code})\n` +
          stdout.slice(-3000) + "\n" + stderr.slice(-4000)));
      } else {
        console.log("Chromium real browser " + stage + ": PASS");
        resolve();
      }
    });
  });
}
try {
  for (const stage of ["one", "two", "three"]) await runChrome(stage);
  console.log("M6 real Chrome IndexedDB Ask → Practice → restart → evaluate → CAS conformance passed");
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
