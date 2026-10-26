/**
 * M12.1 compiled-plugin lifecycle acceptance. Executes dist/main.js, not TS
 * source or a build-time facade. This is a deterministic Obsidian API harness:
 * it does not assert desktop GUI / Electron / vault integration acceptance.
 */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";

const hostRequire = createRequire(import.meta.url);
const release = resolve("dist");
const manifest = JSON.parse(readFileSync(join(release, "manifest.json"), "utf8"));
assert.equal(manifest.id, "nox");
assert.equal(manifest.isDesktopOnly, true);

const temp = mkdtempSync(join(tmpdir(), "nox-compiled-host-"));
const stored = { value: {} };
const io = { writes: 0, httpCalls: 0, registrations: [], intervals: [], lifecycle: [] };
const clone = value => JSON.parse(JSON.stringify(value));
const fakeElement = () => ({
  addClass: () => {}, removeClass: () => {}, createDiv: () => fakeElement(),
  createSpan: () => fakeElement(), createEl: () => fakeElement(),
  empty: () => {}, setText: () => {}, appendChild: () => {},
});

class Plugin {
  constructor(app, metadata) {
    this.app = app;
    this.manifest = metadata;
    this.disposables = [];
    this.views = new Map();
    this.commands = new Map();
  }
  async loadData() { return clone(stored.value); }
  async saveData(next) { stored.value = clone(next); io.writes++; }
  registerEvent(token) { this.disposables.push(token); }
  registerDomEvent(target, name, handler) {
    assert.equal(typeof handler, "function");
    io.registrations.push({ target, name });
  }
  registerInterval(handle) { io.intervals.push(handle); }
  registerView(name, factory) { this.views.set(name, factory); }
  addSettingTab(tab) { assert.ok(tab); io.lifecycle.push("settings"); }
  addRibbonIcon(name, label, action) {
    assert.equal(typeof action, "function");
    io.lifecycle.push("ribbon:" + name);
    return fakeElement();
  }
  addCommand(command) {
    assert.equal(typeof command.callback, "function");
    this.commands.set(command.id, command);
  }
}
class PluginSettingTab {
  constructor() { this.containerEl = fakeElement(); }
}
class FileSystemAdapter {
  getBasePath() { return temp; }
}
class TFile {
  constructor(path) { this.path = path; this.extension = path.split(".").at(-1); }
}
class TFolder { constructor(path) { this.path = path; } }
const obsidian = new Proxy({
  Plugin, PluginSettingTab, FileSystemAdapter, TFile, TFolder,
  Notice: class Notice { constructor() {} },
  addIcon(name, svg) {
    assert.equal(name, "nox-logo");
    assert.ok(svg.includes("image"));
    io.lifecycle.push("icon");
  },
  requestUrl() {
    io.httpCalls++;
    throw new Error("Compiled plugin startup may not issue OAuth/network requests");
  },
}, {
  get(target, name) {
    if (name in target) return target[name];
    if (typeof name !== "string") return undefined;
    return class HostOnlyStub {};
  },
});

const listeners = { workspace: [], vault: [], metadata: [] };
const app = {
  vault: {
    adapter: new FileSystemAdapter(),
    on(name, callback) {
      listeners.vault.push({ name, callback });
      return { name, off() {} };
    },
    getFileByPath() { return null; },
    getAbstractFileByPath() { return null; },
    getMarkdownFiles() { return []; },
  },
  workspace: {
    on(name, callback) {
      listeners.workspace.push({ name, callback });
      return { name, off() {} };
    },
    onLayoutReady(callback) {
      io.lifecycle.push("layout-ready-handler");
      assert.equal(typeof callback, "function");
    },
    getActiveViewOfType() { return null; },
    getLeavesOfType() { return []; },
  },
  metadataCache: {
    on(name, callback) {
      listeners.metadata.push({ name, callback });
      return { name, off() {} };
    },
  },
};
const windowHost = {
  setInterval(callback, ms) {
    assert.equal(typeof callback, "function");
    assert.equal(ms, 30_000);
    return 42;
  },
  setTimeout,
};
const doc = { hidden: false };
const nativeRequire = spec => {
  if (spec === "obsidian") return obsidian;
  if (spec === "electron") return { shell: { openExternal() {
    throw new Error("Unexpected shell invocation during startup");
  } } };
  if (spec === "@nox/core" || spec.startsWith("@nox/core/")) {
    throw new Error("Compiled plugin must bundle @nox/core, not require its source/package");
  }
  return hostRequire(spec);
};
function loadInstalledPlugin() {
  const module = { exports: {} };
  const code = readFileSync(join(temp, "main.js"), "utf8");
  const sandbox = {
    module, exports: module.exports, require: nativeRequire,
    __filename: join(temp, "main.js"), __dirname: temp,
    Buffer, process, console, crypto: webcrypto,
    TextEncoder, TextDecoder, URL, URLSearchParams,
    AbortController, structuredClone, setTimeout, clearTimeout,
    setInterval, clearInterval, performance,
    navigator: { clipboard: { writeText: async () => {} } },
    window: windowHost, document: doc,
    fetch() { io.httpCalls++; throw new Error("Unexpected network during boot"); },
  };
  runInNewContext(code, sandbox, { filename: join(temp, "main.js"), timeout: 12_000 });
  const PluginClass = module.exports.default;
  assert.equal(typeof PluginClass, "function", "compiled main.js must export plugin constructor");
  return new PluginClass(app, manifest);
}

try {
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    cpSync(join(release, file), join(temp, file));
  }
  const first = loadInstalledPlugin();
  await first.onload();
  const identity = first.getBuildDiagnostics();
  assert.match(identity.sourceSha, /^[a-f0-9]{40}$/i,
    "compiled artifact must expose exact source commit identity");
  assert.equal(identity.transport, "NOX_RUNTIME_TRANSPORT_V3:node-https-sse");
  assert.ok(first.views.has("nox-sidebar"), "actual plugin must register a view");
  for (const command of ["open-sidebar", "guided-learning-setup",
    "copy-runtime-diagnostics", "focus-composer"]) {
    assert.ok(first.commands.has(command), "missing compiled plugin command: " + command);
  }
  assert.ok(io.registrations.some(x => x.name === "visibilitychange"));
  assert.ok(io.intervals.length > 0);
  assert.ok(listeners.workspace.some(x => x.name === "file-open"));
  assert.ok(listeners.vault.some(x => x.name === "rename"));
  assert.ok(io.writes > 0, "core session initialization must use Obsidian plugin-data writer");
  assert.ok(stored.value["nox-sessions"], "startup must durably initialize sessions");
  const originalSession = first.learning.getSession().id;
  assert.ok(originalSession);
  const other = await first.learning.newSession();
  assert.notEqual(other.id, originalSession);
  const storageAfterNew = clone(stored.value);
  first.onunload();
  // The shutdown checkpoint is asynchronous; test the authoritative snapshot
  // only after its microtask chain has had a chance to complete.
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(io.lifecycle.includes("icon"));
  assert.equal(io.httpCalls, 0, "startup/unload must not call remote providers");

  const restarted = loadInstalledPlugin();
  await restarted.onload();
  assert.deepEqual(clone(restarted.getBuildDiagnostics()), clone(identity),
    "reloaded plugin must identify the same compiled artifact");
  assert.equal(restarted.learning.getSession().id, other.id,
    "real compiled plugin must restore last session from plugin data");
  assert.deepEqual(clone(stored.value["nox-settings"] ?? {}),
    clone(storageAfterNew["nox-settings"] ?? {}),
    "restart must preserve settings, not replace plugin data");
  restarted.onunload();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(io.httpCalls, 0);
  console.log("M12.1 compiled Obsidian plugin: artifact boot, UI registrations, durable restart, teardown PASSED");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
