import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { FileWorkspace, WorkspaceDurabilityUncertain } from "../../../headless/src/FileWorkspace";
import { openHeadlessNox, ScriptedProvider } from "../../../headless/src/composition";
import { LearningStateWriteConflict } from "../../../src/domain/persistence/errors";
import type { LearningEvent, LearningRequest } from "../../../src/application/learning-types";

const fence = String.fromCharCode(96).repeat(3);
const payload = (value: unknown) => fence + "learning-practice\n" + JSON.stringify(value) + "\n" + fence;
async function tempWorkspace<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "nox-headless-test-"));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function collect(stream: AsyncIterable<LearningEvent>): Promise<LearningEvent[]> {
  const events: LearningEvent[] = [];
  for await (const item of stream) events.push(item);
  assert.equal(events.some(x => x.type === "failed" || x.type === "cancelled"), false,
    "headless NOX must complete the real turn without a failed terminal");
  assert.equal(events.at(-1)?.type, "completed");
  return events;
}

test("M2 Ask -> pending Practice -> restart -> evaluation reuses real NOX transactions", async () => {
  await tempWorkspace(async root => {
    const first = await openHeadlessNox(root, new ScriptedProvider([
      "Atomicity means all-or-nothing.",
      payload({ kind: "question", concept: "transactions",
        question: "What is transaction atomicity?" }),
    ]));
    let pendingQuestionId: string | undefined;
    try {
      const ask = await collect(first.controller.run({ action: "ask",
        prompt: "Explain atomicity", explicitContext: [] }));
      assert.ok(ask.some(e => e.type === "response-delta"));
      const practice = await collect(first.controller.run({ action: "practice",
        prompt: "Test my understanding", freePractice: true, explicitContext: [] }));
      const question = practice.find(e => e.type === "practice-question");
      assert.equal(question?.type, "practice-question");
      pendingQuestionId = question?.type === "practice-question" ? question.questionId : undefined;
      assert.ok(pendingQuestionId);
      assert.equal((await first.workspace.learningState.load()).evidence.length, 0,
        "pending practice questions must not grant mastery");
      assert.ok(first.controller.getSession().messages.some(m =>
        m.parts?.some(part => part.type === "practice-question")));
    } finally {
      await first.close();
    }

    const second = await openHeadlessNox(root, new ScriptedProvider([
      payload({ kind: "evaluation", concept: "transactions", outcome: "correct",
        feedback: "All operations commit or none do.", misconceptions: [] }),
    ]));
    try {
      const answer = await collect(second.controller.run({ action: "practice",
        prompt: "All-or-nothing: either all changes commit or none do.",
        freePractice: true, explicitContext: [] }));
      assert.ok(answer.some(e => e.type === "practice-evaluation"),
        "the actual practice machine restores its pending challenge after restart");
      const state = await second.workspace.learningState.load();
      assert.equal(state.evidence.length, 1);
      assert.equal(state.evidence[0]?.scope, "learner");
      assert.equal(state.evidence[0]?.id.startsWith("practice:"), true);
      const committed = second.controller.getSession().messages.flatMap(m => m.parts ?? [])
        .filter(part => part.type === "practice-evaluation");
      assert.equal(committed.length, 1);
      assert.equal(committed[0]?.type === "practice-evaluation" ? committed[0].questionId : undefined,
        pendingQuestionId);
    } finally {
      await second.close();
    }
  });
});

test("M2 actual file evidence store rejects stale CAS and preserves bytes", async () => {
  await tempWorkspace(async root => {
    const workspace = await FileWorkspace.open(root);
    try {
      const left = await workspace.learningState.load();
      const right = await workspace.learningState.load();
      await workspace.learningState.save({ ...left, target: "first" }, left);
      const committed = await readFile(join(root, "progress.json"), "utf8");
      await assert.rejects(workspace.learningState.save({ ...right, target: "stale" }, right),
        LearningStateWriteConflict);
      assert.equal(await readFile(join(root, "progress.json"), "utf8"), committed);
      assert.equal((await workspace.learningState.load()).target, "first");
    } finally {
      await workspace.close();
    }
  });
});

test("M2 rejects unguarded overwrite and never repairs malformed progress by destroying it", async () => {
  await tempWorkspace(async root => {
    const workspace = await FileWorkspace.open(root);
    try {
      const original = await workspace.learningState.load();
      await workspace.learningState.save({ ...original, target: "owned" }, original);
      const committed = await readFile(join(root, "progress.json"), "utf8");
      await assert.rejects(workspace.learningState.save({ ...original, target: "unauthorized" }),
        LearningStateWriteConflict);
      assert.equal(await readFile(join(root, "progress.json"), "utf8"), committed);
    } finally {
      await workspace.close();
    }
    const invalid = "{damaged progress";
    await writeFile(join(root, "progress.json"), invalid);
    const resumed = await FileWorkspace.open(root);
    try {
      await assert.rejects(resumed.learningState.save({
        version: 2, target: "unsafe", gaps: [], evidence: [],
      }), LearningStateWriteConflict);
      assert.equal(await readFile(join(root, "progress.json"), "utf8"), invalid);
    } finally {
      await resumed.close();
    }
  });
});


test("M8 syncs the parent directory and rejects a post-rename durability failure", async () => {
  await tempWorkspace(async root => {
    const workspace = await FileWorkspace.open(root);
    const hooks = workspace as unknown as { syncParentDirectory: () => Promise<void> };
    const actual = hooks.syncParentDirectory.bind(workspace);
    let flushes = 0;
    try {
      hooks.syncParentDirectory = async () => { flushes++; await actual(); };
      await workspace.sessionData.update(current => ({ ...current, marker: "durable" }));
      assert.equal(flushes, 1, "success must flush metadata after atomic rename");
      hooks.syncParentDirectory = async () => {
        flushes++;
        throw new Error("injected post-rename directory fsync failure");
      };
      await assert.rejects(workspace.sessionData.update(current =>
        ({ ...current, marker: "commit-uncertain" })), error =>
          error instanceof WorkspaceDurabilityUncertain &&
          error.filename === "sessions.json" &&
          (error.cause as Error).message.includes("post-rename directory fsync"));
      assert.equal(flushes, 2, "post-rename sync failure must not be reported as success");
      // Renamed data may already be visible even though durability is uncertain.
      assert.equal((await workspace.sessionData.read()).marker, "commit-uncertain");
    } finally {
      hooks.syncParentDirectory = actual;
      await workspace.close();
    }
    const reopened = await FileWorkspace.open(root);
    try {
      assert.equal((await reopened.sessionData.read()).marker, "commit-uncertain");
    } finally { await reopened.close(); }
  });
});

test("M2 local runtime refuses another owner and releases workspace on disposal", async () => {
  await tempWorkspace(async root => {
    const first = await FileWorkspace.open(root);
    try {
      await assert.rejects(FileWorkspace.open(root), /already locked/);
    } finally {
      await first.close();
    }
    const restored = await FileWorkspace.open(root);
    await restored.close();
  });
});

test("M2 corrupt state fails closed without overwriting user's persisted JSON", async () => {
  await tempWorkspace(async root => {
    const original = "{this is not JSON";
    await writeFile(join(root, "sessions.json"), original);
    await assert.rejects(openHeadlessNox(root, new ScriptedProvider([])), /JSON|Unexpected/);
    assert.equal(await readFile(join(root, "sessions.json"), "utf8"), original);
    const reopened = await FileWorkspace.open(root);
    await reopened.close();
  });
});

test("M2 executable CLI demo bundles without Obsidian and commits evidence to disk", async () => {
  await tempWorkspace(async root => {
    const run = spawnSync(process.execPath, ["scripts/headless.mjs", "demo", "--data-dir", root],
      { encoding: "utf8", timeout: 30_000 });
    assert.equal(run.status, 0, (run.stderr || "") + (run.stdout || ""));
    assert.match(run.stdout, /"practiceEvaluation": true/);
    const state = JSON.parse(await readFile(join(root, "progress.json"), "utf8")) as { evidence: unknown[] };
    assert.equal(state.evidence.length, 1);
    // A second independent process must reuse the durable workspace without
    // assuming history/evidence were empty before this run.
    const again = spawnSync(process.execPath, ["scripts/headless.mjs", "demo", "--data-dir", root],
      { encoding: "utf8", timeout: 30_000 });
    assert.equal(again.status, 0, (again.stderr || "") + (again.stdout || ""));
    const resumed = JSON.parse(await readFile(join(root, "progress.json"), "utf8")) as { evidence: unknown[] };
    assert.equal(resumed.evidence.length, 2);
  });
});

test("M9 uncertain session transitions recover from persisted state without duplicate ledger", async () => {
  await tempWorkspace(async root => {
    const curriculum = {
      kind: "curriculum", objectives: [{
        id: "atomicity", title: "Atomic commits", outcome: "Explain atomic commits",
        prerequisiteIds: [], estimatedMinutes: 30, rubric: ["All or nothing"],
        sourceRefs: [], priority: "core",
      }],
    };
    const source = String.fromCharCode(96).repeat(3) + "learning-program\n" +
      JSON.stringify(curriculum) + "\n" + String.fromCharCode(96).repeat(3);
    const first = await openHeadlessNox(root, new ScriptedProvider([source]));
    try {
      await first.programs.createProgram("Atomic commits", {
        minutesPerSession: 45, sessionsPerWeek: 3,
        sourcePaths: [], sourceBound: false, excludedTopics: [],
      }, "m9-once");
      const hooks = first.workspace as unknown as { syncParentDirectory: () => Promise<void> };
      const actual = hooks.syncParentDirectory.bind(first.workspace);
      hooks.syncParentDirectory = async () => {
        throw new Error("injected metadata durability failure at session start");
      };
      try {
        await assert.rejects(first.programs.startSession(), error =>
          error instanceof WorkspaceDurabilityUncertain && error.filename === "programs.json");
      } finally { hooks.syncParentDirectory = actual; }
      // Failure is ambiguous: the durable store, not the exception, decides what happened.
      assert.ok((await first.programs.getActiveProgram())?.session,
        "rename committed the session before metadata sync failed");
      await assert.rejects(first.programs.startSession(), /already active/);
    } finally { await first.close(); }

    const second = await openHeadlessNox(root, new ScriptedProvider([]));
    try {
      assert.equal((await second.programs.getSessionTime())?.status, "recovered");
      await second.programs.resumeSession();
      const hooks = second.workspace as unknown as { syncParentDirectory: () => Promise<void> };
      const actual = hooks.syncParentDirectory.bind(second.workspace);
      hooks.syncParentDirectory = async () => {
        throw new Error("injected metadata durability failure at session end");
      };
      try {
        await assert.rejects(second.programs.endSession(), error =>
          error instanceof WorkspaceDurabilityUncertain && error.filename === "programs.json");
      } finally { hooks.syncParentDirectory = actual; }
      const after = await second.programs.getActiveProgram();
      assert.equal(after?.session, undefined);
      assert.equal(after?.sessionHistory?.length, 1);
      await assert.rejects(second.programs.endSession(), /No active session/);
      assert.equal((await second.programs.getActiveProgram())?.sessionHistory?.length, 1);
    } finally { await second.close(); }

    const third = await openHeadlessNox(root, new ScriptedProvider([]));
    try {
      const saved = await third.programs.getActiveProgram();
      assert.equal(saved?.sessionHistory?.length, 1, "reopen must not duplicate the ledger");
      assert.equal(saved?.session, undefined);
      assert.equal((await third.programs.listPrograms()).programs.length, 1);
    } finally { await third.close(); }
  });
});
