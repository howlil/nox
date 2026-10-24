import { build } from "esbuild";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runChrome(stage) {
  const profile = join(directory, "chrome-profile");
  const url = `http://127.0.0.1:${port}/?stage=${stage}`;
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    "--disable-extensions", "--disable-sync", "--no-proxy-server",
    "--remote-debugging-port=0", "--remote-allow-origins=*",
    "--user-data-dir=" + profile, url,
  ];
  const child = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", data => { stderr += data.toString(); });
  let socket;
  try {
    let debugPort;
    for (let attempt = 0; attempt < 140; attempt++) {
      try {
        const meta = await readFile(join(profile, "DevToolsActivePort"), "utf8");
        debugPort = Number(meta.split("\n")[0]);
        if (Number.isInteger(debugPort) && debugPort > 0) break;
      } catch { /* Chrome has not started DevTools yet. */ }
      if (child.exitCode !== null) throw new Error("Chrome exited before DevTools was available");
      await sleep(150);
    }
    if (!debugPort) throw new Error("Chrome did not expose remote DevTools");
    let page;
    for (let attempt = 0; attempt < 70; attempt++) {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      page = targets.find(target => target.type === "page" && target.url.includes("stage=" + stage));
      if (page) break;
      await sleep(150);
    }
    if (!page) throw new Error("Chrome did not open the M6 proof page");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let id = 0;
    const requests = new Map();
    socket.addEventListener("message", event => {
      const packet = JSON.parse(event.data);
      if (!requests.has(packet.id)) return;
      const settle = requests.get(packet.id);
      requests.delete(packet.id);
      if (packet.error) settle.reject(new Error(JSON.stringify(packet.error)));
      else settle.resolve(packet.result);
    });
    const evaluate = expression => new Promise((resolve, reject) => {
      const current = ++id;
      requests.set(current, { resolve, reject });
      socket.send(JSON.stringify({
        id: current, method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });
    let lastResult = "not started";
    for (let attempt = 0; attempt < 140; attempt++) {
      const result = await evaluate(`({
        status: document.documentElement.dataset.proofStatus || "running",
        text: document.getElementById("result")?.textContent || "no result element"
      })`);
      const value = result.result?.value;
      lastResult = JSON.stringify(value ?? result);
      if (value?.status === "passed" && value.text === "NOX_BROWSER_PROOF_PASS:" + stage) {
        console.log("Real Chromium/IndexedDB stage " + stage + ": PASS");
        return;
      }
      if (value?.status === "failed") throw new Error("NOX browser page failed: " + lastResult);
      if (child.exitCode !== null) throw new Error("Chrome exited mid-proof: " + lastResult);
      await sleep(200);
    }
    throw new Error("Timed out waiting for async browser proof: " + lastResult);
  } catch (error) {
    throw new Error("Chrome stage " + stage + ": " + error.message + "\n" + stderr.slice(-1400));
  } finally {
    socket?.close();
    if (child.exitCode === null) {
      const closed = new Promise(resolve => child.once("close", resolve));
      child.kill("SIGTERM");
      await Promise.race([closed, sleep(3000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
}

try {
  for (const stage of ["one", "two", "three"]) await runChrome(stage);
  console.log("M6 real Chrome IndexedDB Ask → Practice → restart → evaluate → CAS conformance passed");
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
