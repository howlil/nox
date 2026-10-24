import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileWorkspace } from "../../../headless/src/FileWorkspace";
import { openHeadlessNox, ScriptedProvider } from "../../../headless/src/composition";
import { ProgramWriteConflict } from "../../../src/domain/persistence/errors";
import type { LearningEvent } from "../../../src/application/learning-types";
import type { LearningProgram, ProgramConstraints } from "../../../src/domain/learning-program/types";

const constraints: ProgramConstraints = {
  minutesPerSession: 45, sessionsPerWeek: 3,
  sourceBound: false, sourcePaths: [], excludedTopics: [],
};
const curriculum = {
  kind: "curriculum", objectives: [
    { id: "atomicity", title: "Transaction atomicity", outcome: "Explain atomic commits",
      prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Explain atomic commits"],
      sourceRefs: [], priority: "core" },
    { id: "recovery", title: "Crash recovery", outcome: "Describe durable recovery",
      prerequisiteIds: ["atomicity"], estimatedMinutes: 40,
      rubric: ["Explain recovery"], sourceRefs: [], priority: "core" },
  ],
};
const block = (type: string, data: unknown) =>
  "```" + type + "\n" + JSON.stringify(data) + "\n```";
const fixtureProgram = (): LearningProgram => ({
  version: 1, id: "headless-program", createdAt: Date.now(),
  goal: "Learn transactions", planVersion: 1, constraints,
  objectives: structuredClone(curriculum.objectives) as LearningProgram["objectives"],
});
async function inWorkspace(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "nox-m8-program-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function command(controller: Awaited<ReturnType<typeof openHeadlessNox>>["controller"],
  prompt: string, action: "ask" | "practice" = "ask"): Promise<LearningEvent[]> {
  const events: LearningEvent[] = [];
  for await (const event of controller.run({
    prompt, action, explicitContext: [], turnId: crypto.randomUUID(),
  })) events.push(event);
  assert.equal(events.at(-1)?.type, "completed",
    prompt + ": " + JSON.stringify(events.find(event => event.type === "failed")));
  return events;
}

test("M8 FileWorkspace programs serialize, preserve CAS, and share v1/v2 validation", async () => {
  await inWorkspace(async root => {
    const ws = await FileWorkspace.open(root);
    try {
      const old = await ws.programs.load();
      const stale = await ws.programs.load();
      const program = fixtureProgram();
      await ws.programs.save({ version: 1, activeProgramId: program.id,
        programs: [program] }, old);
      const committed = await readFile(join(root, "programs.json"), "utf8");
      await assert.rejects(ws.programs.save({ version: 1, programs: [] }, stale),
        ProgramWriteConflict);
      await assert.rejects(ws.programs.save({ version: 1, programs: [] }),
        ProgramWriteConflict);
      assert.equal(await readFile(join(root, "programs.json"), "utf8"), committed);
      const next = await ws.programs.load();
      const updated = structuredClone(next);
      updated.programs[0].focus = {
        id: "focus-one", programId: program.id, objectiveId: "atomicity",
        curriculumRevision: 1, chatSessionId: "session-a",
        status: "active", startedAt: Date.now(),
      };
      await ws.programs.save(updated, next);
      assert.equal((await ws.programs.load()).version, 2);
      assert.equal((await ws.programs.load()).programs[0].version, 2);
    } finally { await ws.close(); }
    const reopened = await FileWorkspace.open(root);
    try {
      assert.equal((await reopened.programs.load()).programs[0].focus?.id, "focus-one");
    } finally { await reopened.close(); }
  });
});

test("M8 malformed persisted programs fail closed and cannot be overwritten", async () => {
  await inWorkspace(async root => {
    const unsafe = '{"version":1,"programs":';
    await writeFile(join(root, "programs.json"), unsafe);
    const ws = await FileWorkspace.open(root);
    try {
      await assert.rejects(ws.programs.load(), /JSON|Unexpected/);
      await assert.rejects(ws.programs.save({ version: 1, programs: [] }),
        ProgramWriteConflict);
      assert.equal(await readFile(join(root, "programs.json"), "utf8"), unsafe);
    } finally { await ws.close(); }
    const invalid = JSON.stringify({ version: 2, programs: [{
      ...fixtureProgram(), version: 2, objectives: [],
    }] });
    await writeFile(join(root, "programs.json"), invalid);
    const next = await FileWorkspace.open(root);
    try {
      await assert.rejects(next.programs.load(), /Curriculum|objective|Invalid|1–60/);
      assert.equal(await readFile(join(root, "programs.json"), "utf8"), invalid);
    } finally { await next.close(); }
  });
});

test("M8 one real core handles program planning, focused assessment, restart, and evidence", async () => {
  await inWorkspace(async root => {
    const first = await openHeadlessNox(root, new ScriptedProvider([
      block("learning-program", curriculum),
      block("learning-practice", { kind: "question", concept: "atomicity",
        question: "Explain atomic commits." }),
    ]));
    let programId = "";
    try {
      const preview = await first.programs.prepareProgram("Understand transactions", constraints);
      assert.equal((await first.programs.listPrograms()).programs.length, 0,
        "a provider-generated preview is never a durable program");
      const approved = await first.programs.commitPrepared(preview.id, "approve-one");
      programId = approved.id;
      assert.equal((await first.programs.commitPrepared(preview.id, "approve-one")).id, programId,
        "repeated approval must not create a second program");
      await assert.rejects(first.programs.startFocus("recovery", first.session.getSession().id),
        /Prerequisites are not mastered/);
      await command(first.controller, "/focus atomicity");
      const proposed = await command(first.controller, "/next");
      assert.ok(proposed.some(event => event.type === "practice-question"));
      assert.equal((await first.workspace.learningState.load()).evidence.length, 0);
      assert.equal((await first.workspace.programs.load()).programs[0].focus?.status, "active");
    } finally { await first.close(); }

    const second = await openHeadlessNox(root, new ScriptedProvider([
      block("learning-practice", { kind: "evaluation", concept: "atomicity",
        outcome: "correct", feedback: "A transaction commits all changes or none.",
        misconceptions: [], rubricResults: [
          { criterion: "Explain atomic commits", met: true,
            evidence: "The answer explained all-or-nothing changes." },
        ] }),
    ]));
    try {
      const focused = await second.programs.getActiveProgram();
      assert.equal(focused?.focus?.status, "paused",
        "a crashed or closed host cannot silently resume the former focus");
      // The first controller turn loads the persisted focus admission identity.
      const resumed = await command(second.controller, "/resume-focus");
      assert.ok(resumed.some(event => event.type === "response-delta"));
      assert.equal(second.controller.hasActivePracticeQuestion(), true,
        "the committed question is rehydrated under its resumed focus identity");
      const evaluated = await command(second.controller,
        "All writes commit together or they all roll back.");
      assert.ok(evaluated.some(event => event.type === "practice-evaluation"));
      const evidence = (await second.workspace.learningState.load()).evidence;
      assert.equal(evidence.length, 1);
      assert.equal(evidence[0]?.programId, programId);
      assert.equal(evidence[0]?.objectiveId, "atomicity");
      assert.equal(evidence[0]?.evidenceVersion, 3);
      assert.equal(evidence[0]?.scope, "learner");
      assert.equal((await second.programs.listPrograms()).programs.length, 1);
    } finally { await second.close(); }

    const third = await openHeadlessNox(root, new ScriptedProvider([]));
    try {
      assert.equal((await third.workspace.learningState.load()).evidence.length, 1);
      assert.equal((await third.programs.listPrograms()).activeProgramId, programId);
      assert.equal((await third.programs.getActiveProgram())?.focus?.status, "paused");
      assert.ok((await third.programs.progressSummary()).includes("Understand transactions"));
    } finally { await third.close(); }
  });
});

test("M8 durable learning session recovery excludes offline time and retains the ledger", async () => {
  await inWorkspace(async root => {
    const first = await openHeadlessNox(root, new ScriptedProvider([
      block("learning-program", curriculum),
    ]));
    try {
      await first.programs.createProgram("Learn transactions", constraints, "session-plan");
      await first.programs.startSession();
      assert.ok((await first.programs.getSessionTime())?.budgetMs === 45 * 60_000);
    } finally { await first.close(); }

    const second = await openHeadlessNox(root, new ScriptedProvider([]));
    try {
      const time = await second.programs.getSessionTime();
      assert.equal(time?.status, "recovered");
      await second.programs.resumeSession();
      await second.programs.endSession();
      const current = await second.programs.getActiveProgram();
      assert.equal(current?.session, undefined);
      assert.equal(current?.sessionHistory?.length, 1);
    } finally { await second.close(); }
  });
});

test("M8 headless host refuses source-bound plans without explicitly authorized material", async () => {
  await inWorkspace(async root => {
    const adapter = new ScriptedProvider([block("learning-program", curriculum)]);
    const host = await openHeadlessNox(root, adapter);
    try {
      await assert.rejects(host.programs.createProgram("Private source",
        { ...constraints, sourceBound: true, sourcePaths: [] }), /Open or select a source note/);
      assert.equal(adapter.seen.length, 0, "reject before invoking the provider");
      assert.equal((await host.workspace.programs.load()).programs.length, 0);
    } finally { await host.close(); }
  });
});
