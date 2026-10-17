import assert from "node:assert/strict";
import test from "node:test";
import { decodeProgramCollection, migrateProgramCollectionV1, prepareProgramCollectionWrite } from "../../src/persistence/program-schema";

const old = { version: 1, activeProgramId: "p", programs: [{
  version: 1, id: "p", goal: "Learn", createdAt: 1, planVersion: 1,
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false,
    sourcePaths: [], excludedTopics: [] },
  objectives: [{ id: "o", title: "Focus", outcome: "Explain", prerequisiteIds: [],
    estimatedMinutes: 30, rubric: ["Explain"], sourceRefs: [], priority: "core" }],
  focus: { id: "f", programId: "p", objectiveId: "o",
    curriculumRevision: 1, status: "paused", startedAt: 5 },
  deferredNotes: [{ id: "n", focusSessionId: "f", objectiveId: "o",
    createdAt: 5, text: "Explore deadlocks" }],
  sessionHistory: [{ startedAt: 1, endedAt: 2, minutesSpent: 1 }],
}] };

test("v1 to v2 preserves every historical field and never mutates input", () => {
  const original = structuredClone(old);
  const v2 = migrateProgramCollectionV1(old as never);
  assert.equal(v2.version, 2);
  assert.equal(v2.programs[0].version, 2);
  assert.deepEqual({ ...v2, version: 1, programs: v2.programs.map(p => ({ ...p, version: 1 })) }, old);
  assert.deepEqual(old, original);
  assert.deepEqual(migrateProgramCollectionV1(v2), v2);
});

test("decoder rejects mixed versions, duplicate IDs, malformed identity and unsupported future versions", () => {
  for (const bad of [
    { ...old, version: 2 },
    { ...old, programs: [...old.programs, ...old.programs] },
    { ...old, programs: [{ ...old.programs[0], id: "" }] },
    { ...old, version: 3 },
    { ...old, activeProgramId: "absent" },
  ]) {
    assert.throws(() => decodeProgramCollection(bad), /Unsupported|Duplicate|Active/);
  }
});


test("application writer normalizes a v1 draft within v2 without relaxing persisted decoder", () => {
  const current = migrateProgramCollectionV1(old as never);
  const draft = structuredClone(old.programs[0]);
  draft.id = "q";
  const mixed = { ...current, programs: [...current.programs, draft] };
  assert.throws(() => decodeProgramCollection(mixed), /Unsupported/);
  const normalized = prepareProgramCollectionWrite(mixed as never);
  assert.equal(normalized.version, 2);
  assert.deepEqual(normalized.programs.map(x => x.version), [2, 2]);
});
