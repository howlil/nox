import { spawnSync } from "node:child_process";
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Validate the artifact as a self-contained package: no source checkout,
// workspace path aliases, or Node module resolution into the NOX repository.
const built = spawnSync(process.execPath, [resolve("scripts/build-core.mjs")], {
  stdio: "inherit",
});
if (built.status !== 0) process.exit(built.status ?? 1);

const root = await mkdtemp(join(tmpdir(), "nox-core-external-consumer-"));
try {
  const packageDirectory = join(root, "node_modules", "@nox", "core");
  await mkdir(packageDirectory, { recursive: true });
  await cp(resolve("packages/core/dist"), join(packageDirectory, "dist"), { recursive: true });
  await copyFile(resolve("packages/core/package.json"), join(packageDirectory, "package.json"));

  const smoke = `import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  AgentRuntime, LearningController, LearningProgramOrchestrator,
  SessionController, SessionStore, ContextResolver,
  DEFAULT_LEARNING_STATE, PersistenceError, LearningStateWriteConflict,
} from "@nox/core";
const require = createRequire(import.meta.url);
const commonjs = require("@nox/core");
for (const symbol of [
  AgentRuntime, LearningController, LearningProgramOrchestrator,
  SessionController, SessionStore, ContextResolver,
  PersistenceError, LearningStateWriteConflict,
]) assert.equal(typeof symbol, "function");
assert.equal(typeof commonjs.LearningController, "function");
assert.equal(typeof commonjs.SessionController, "function");
assert.equal(DEFAULT_LEARNING_STATE.evidence.length, 0);
let data = {};
const port = {
  read: async () => structuredClone(data),
  update: async mutate => {
    const next = mutate(structuredClone(data));
    data = structuredClone(next);
  },
};
const sessions = new SessionController(port, new SessionStore({
  now: () => 42,
  uuid: () => "consumer-session",
}));
await sessions.init();
await sessions.recordUserMessage("standalone @nox/core", "consumer-session", "ask");
assert.equal(sessions.getSession().messages[0].content, "standalone @nox/core");
assert.ok(data["nox-sessions"]);
console.log("@nox/core standalone ESM and CJS smoke passed");
`;
  await writeFile(join(root, "consumer.mjs"), smoke);

  const tsSource = `import {
  AgentRuntime, SessionController, SessionStore, DEFAULT_LEARNING_STATE,
  type AgentAdapter, type AgentRuntimePort, type SessionDataPort,
  type SessionPort, type LearningState, type LearningRequest,
} from "@nox/core";
const data: SessionDataPort = {
  read: async () => ({}),
  update: async (_change) => {},
};
const sessions: SessionPort = new SessionController(data, new SessionStore());
const adapter: AgentAdapter = {
  check: async () => ({ status: "ready" }),
  listModels: async () => [],
  send: async function* () { yield { type: "completed" }; },
};
const runtime: AgentRuntimePort = new AgentRuntime(adapter);
const request: LearningRequest = { prompt: "hello", action: "ask", explicitContext: [] };
const state: LearningState = DEFAULT_LEARNING_STATE;
void [sessions, runtime, request, state];
`;
  await writeFile(join(root, "consumer.ts"), tsSource);
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022", "DOM"], types: [],
      strict: true, skipLibCheck: false, noEmit: true,
    },
    include: ["consumer.ts"],
  }));
  const runtime = spawnSync(process.execPath, [join(root, "consumer.mjs")], {
    encoding: "utf8", cwd: root, timeout: 20_000,
  });
  if (runtime.status !== 0) throw new Error("External runtime smoke failed:\n" +
    runtime.stdout + "\n" + runtime.stderr);
  process.stdout.write(runtime.stdout);

  const compiler = spawnSync(process.execPath, [
    resolve("node_modules/typescript/bin/tsc"), "--project", join(root, "tsconfig.json"),
  ], { encoding: "utf8", cwd: root, timeout: 60_000 });
  if (compiler.status !== 0) throw new Error("External TypeScript consumer failed:\n" +
    compiler.stdout + "\n" + compiler.stderr);
  const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
  if (manifest.private !== true) throw new Error("M4 must not publish the unapproved core package");
  console.log("@nox/core external package API and standalone TypeScript declarations verified");
} finally {
  await rm(root, { recursive: true, force: true });
}
