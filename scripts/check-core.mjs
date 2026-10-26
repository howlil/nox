import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// First run package-owned build/verify, then validate the artifact as a
// self-contained external package with no source checkout:
// workspace path aliases, or Node module resolution into the NOX repository.
const built = spawnSync(process.execPath, [resolve("packages/core/scripts/verify.mjs")], {
  stdio: "inherit",
});
if (built.status !== 0) process.exit(built.status ?? 1);

// Prove the source itself compiles without a root checkout or TS project.
const isolated = spawnSync(process.execPath, [resolve("scripts/check-core-source.mjs")], {
  stdio: "inherit",
});
if (isolated.status !== 0) process.exit(isolated.status ?? 1);

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
  SessionController, SessionStore, ContextResolver, LocalResearchIndex, validateProgram, isLocallyExecutableCommand,
  DEFAULT_LEARNING_STATE, PersistenceError, LearningStateWriteConflict, SessionWriteConflict, ProgramWriteConflict,
  OnboardingReceiptWriteError, planReplacement, planWorkspace, planObjectiveLesson,
  feasibility, validatePracticeAnswer, accumulateUsage, assertUsageReport, decodeUsageSnapshot,
} from "@nox/core";
const require = createRequire(import.meta.url);
const commonjs = require("@nox/core");
const esm = await import("@nox/core");
assert.deepEqual(Object.keys(esm).sort(), Object.keys(commonjs).sort(),
  "ESM and CJS must expose the same complete runtime API");
for (const symbol of [
  AgentRuntime, LearningController, LearningProgramOrchestrator,
  SessionController, SessionStore, ContextResolver, LocalResearchIndex, validateProgram, isLocallyExecutableCommand,
  PersistenceError, LearningStateWriteConflict, ProgramWriteConflict,
]) assert.equal(typeof symbol, "function");
assert.equal(typeof commonjs.LearningController, "function");
assert.equal(typeof commonjs.SessionController, "function");
for (const [name, exported] of Object.entries({
  AgentRuntime, LearningController, LearningProgramOrchestrator,
  SessionController, SessionStore, ContextResolver, LocalResearchIndex, validateProgram, isLocallyExecutableCommand,
  PersistenceError, LearningStateWriteConflict, SessionWriteConflict, ProgramWriteConflict,
})) assert.strictEqual(commonjs[name], exported,
  "ESM/CJS constructor mismatch: " + name);
assert.ok(new commonjs.LearningStateWriteConflict() instanceof LearningStateWriteConflict);
assert.ok(new commonjs.SessionWriteConflict() instanceof SessionWriteConflict);
assert.equal(DEFAULT_LEARNING_STATE.evidence.length, 0);
assert.equal(decodeUsageSnapshot(null).entries.length, 0);
assert.ok(new OnboardingReceiptWriteError() instanceof OnboardingReceiptWriteError);
for (const symbol of [planReplacement, planWorkspace, planObjectiveLesson,
  feasibility, validatePracticeAnswer, accumulateUsage, assertUsageReport]) {
  assert.equal(typeof symbol, "function");
}
assert.throws(() => validateProgram({ version: 1 }), /Invalid learning program/);
assert.equal(isLocallyExecutableCommand("/hint"), true);
assert.equal(isLocallyExecutableCommand("ordinary question"), false);
const researchIndex = new LocalResearchIndex();
researchIndex.upsert({ path: "allowed.md", content: "Network latency signal", links: [], revision: "1" });
researchIndex.upsert({ path: "private.md", content: "Network latency signal", links: [], revision: "1" });
assert.deepEqual(researchIndex.search("network latency",
  { allowedPaths: ["allowed.md"] }).hits.map(hit => hit.path), ["allowed.md"]);
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
  isLocallyExecutableCommand,
  type AgentAdapter, type AgentRuntimePort, type SessionDataPort,
  type SessionPort, type LearningState, type LearningRequest,
  LocalResearchIndex, validateProgram, type ResearchResult, type LearningPolicy,
  type AgentRuntimeConfig, type OnboardingDraft, type LearningProgram,
  type LearningActionKind, type NoxProgramOverview, type ActivitySummary,
  type PracticeAnswer, type PracticeQuestion, type PracticeEvaluation,
  type ReviewFinding, type CurriculumOperation, type ChatReplyReference,
  type QuotaReading, type QuotaProvider, type ProviderQuotaSnapshot, type UsageSnapshot,
  type UsageReportOptions, type OnboardingStage, type ProposedEdit,
  type TurnContextSnapshot, type AgentFailureCode, type LearningObjective,
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
const policy: LearningPolicy = { path: "AGENTS.md", rawInstructions: "" };
const research: ResearchResult = new LocalResearchIndex().search("network");
const adapterConfig: AgentRuntimeConfig = { executablePath: "codex" };
const draft: OnboardingDraft = { version: 1, stage: "welcome", goal: "", interests: [],
  purpose: "career", level: "beginner", minutesPerSession: 30,
  sessionsPerWeek: 3, sourceBound: false };
const validatePersistedProgram: (program: LearningProgram) => void = validateProgram;
const uiAction: LearningActionKind = "ask";
const uiContracts: [NoxProgramOverview, ActivitySummary, PracticeAnswer,
  PracticeQuestion, PracticeEvaluation, ReviewFinding, CurriculumOperation,
  ChatReplyReference] | null = null;
const hostCommand: (input: string) => boolean = isLocallyExecutableCommand;
const hostTypes: [QuotaReading, QuotaProvider, ProviderQuotaSnapshot, UsageSnapshot,
  UsageReportOptions, OnboardingStage, ProposedEdit, TurnContextSnapshot,
  AgentFailureCode, LearningObjective] | null = null;
void [sessions, runtime, request, state, policy, research, adapterConfig, draft,
  validatePersistedProgram, uiAction, uiContracts, hostCommand, hostTypes];
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
  // M11.4: compile the Obsidian entrypoint from a separate HOST-ONLY source
  // checkout plus the built @nox/core package. No package source, root TS
  // aliases, monorepo src shims, or core checkout exists inside this stage.
  await cp(resolve("src"), join(root, "src"), { recursive: true });
  const isolatedHost = await build({
    entryPoints: [join(root, "src/main.ts")],
    bundle: true, format: "cjs", platform: "node", target: "node22",
    write: false, metafile: true, logLevel: "silent",
    // Third-party Obsidian/plugin dependencies are host runtime externals,
    // but the public core package MUST be bundled from the staged artifact.
    packages: "external",
    plugins: [{
      name: "resolve-staged-core",
      setup(bundle) {
        bundle.onResolve({ filter: /^@nox\\/core$/ }, () =>
          ({ path: join(packageDirectory, "dist", "index.mjs") }));
      },
    }],
  });
  const hostInputs = Object.keys(isolatedHost.metafile.inputs)
    .map(path => path.replaceAll(String.fromCharCode(92), "/"));
  if (!hostInputs.some(path => path.includes("node_modules/@nox/core/dist/index.cjs")) ||
      !hostInputs.some(path => path.includes("node_modules/@nox/core/dist/index.mjs")) ||
      hostInputs.some(path => path.includes("packages/core/src/") ||
        path.includes("packages/core/dist/"))) {
    throw new Error("Isolated Obsidian host must consume only staged @nox/core dist");
  }
  const externalCore = Object.values(isolatedHost.metafile.outputs)
    .flatMap(output => output.imports).filter(item => item.external)
    .map(item => item.path).filter(path => path.includes("@nox/core"));
  if (externalCore.length) throw new Error("Isolated Obsidian host left core unresolved");
  console.log("M11.4 isolated Obsidian host entry compiled against package-only core dist");

  // M5: exercise a portable session transaction from the STAGED artifact
  // under browser resolution, with no Node process, fs or require globals.
  const browserEntry = `import { SessionController, SessionStore } from "@nox/core";
globalThis.__noxBrowserCheck = async () => {
  let committed = {};
  const store = {
    read: async () => structuredClone(committed),
    update: async mutate => { committed = structuredClone(mutate(structuredClone(committed))); },
  };
  const session = new SessionController(store, new SessionStore({
    uuid: () => "browser-session", now: () => 5,
  }));
  await session.init();
  await session.recordUserMessage("portable browser slice", undefined, "ask");
  return session.getSession().messages[0]?.content === "portable browser slice" &&
    Boolean(committed["nox-sessions"]);
};`;
  const browser = await build({
    stdin: {
      contents: browserEntry, sourcefile: "browser-consumer.ts",
      resolveDir: root, loader: "ts",
    },
    platform: "browser", format: "iife", target: "es2022",
    bundle: true, write: false, metafile: true, logLevel: "silent",
  });
  if (browser.outputFiles.length !== 1) throw new Error("Browser smoke output missing");
  const externals = Object.values(browser.metafile.outputs)
    .flatMap(output => output.imports).filter(item => item.external).map(item => item.path);
  if (externals.length) throw new Error("Browser core has runtime externals: " + externals.join(", "));
  const browserRealm = {
    structuredClone, crypto: webcrypto, performance, AbortController,
    TextEncoder, TextDecoder, URL, setTimeout, clearTimeout,
    setInterval, clearInterval, console,
  };
  runInNewContext(browser.outputFiles[0].text, browserRealm, { timeout: 5000 });
  if (typeof browserRealm.__noxBrowserCheck !== "function" ||
      await browserRealm.__noxBrowserCheck() !== true) {
    throw new Error("Bundled browser-like portable session transaction failed");
  }
  console.log("@nox/core isolated browser-target bundle and JS realm smoke passed");

  const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
  if (manifest.private !== true) throw new Error("M4 must not publish the unapproved core package");
  console.log("@nox/core external package API and standalone TypeScript declarations verified");
} finally {
  await rm(root, { recursive: true, force: true });
}
