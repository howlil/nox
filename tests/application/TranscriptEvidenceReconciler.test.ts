import assert from "node:assert/strict";
import test from "node:test";
import { TranscriptEvidenceReconciler } from "../../packages/core/src/features/conversation/turn/TranscriptEvidenceReconciler";
import { LearningStateWriteConflict } from "../../src/persistence/PersistenceError";
import { recordReviewFindings } from "../../src/domain/learning-state/transitions";
import type { LearningState } from "../../src/domain/learning-state/types";
import type { LearningStatePort } from "../../src/application/ports";
import type { ChatSession } from "../../src/types";

const empty = (): LearningState => ({ version: 2, target: null, gaps: [], evidence: [] });
const findings = [{ kind: "weak-explanation" as const, title: "Weak explanation",
  concept: "Distributed systems", detail: "State the consistency tradeoff." }];
const appendReview = (before: LearningState) => recordReviewFindings(before, {
  findings, source: "notes/a.md", reviewId: "review:one",
});

test("a duplicate evidence projection does not write a second time", async () => {
  let writes = 0;
  let current = empty();
  const store: LearningStatePort = {
    load: async () => current,
    save: async next => { writes++; current = next; },
  };
  const reconciler = new TranscriptEvidenceReconciler(store);
  const first = await reconciler.appendSafely(appendReview);
  const second = await reconciler.appendSafely(appendReview);
  assert.equal(first.appended, true);
  assert.equal(second.appended, false);
  assert.equal(writes, 1);
  assert.equal(current.evidence.length, 1);
});

test("CAS conflict triggers a fresh authoritative load before replay", async () => {
  let writes = 0;
  let loads = 0;
  let current = empty();
  const store: LearningStatePort = {
    load: async () => { loads++; return structuredClone(current); },
    save: async next => {
      writes++;
      if (writes === 1) throw new LearningStateWriteConflict();
      current = structuredClone(next);
    },
  };
  const reconciler = new TranscriptEvidenceReconciler(store);
  const outcome = await reconciler.appendSafely(appendReview, empty());
  assert.equal(outcome.appended, true);
  assert.equal(writes, 2);
  assert.equal(loads, 1);
  assert.equal(current.evidence.length, 1);
});

test("unrecoverable write failures propagate; no silent successful state", async () => {
  const store: LearningStatePort = {
    load: async () => empty(),
    save: async () => { throw new Error("disk unavailable"); },
  };
  const reconciler = new TranscriptEvidenceReconciler(store);
  await assert.rejects(reconciler.appendSafely(appendReview), /disk unavailable/);
});

test("committed review is replayed once from transcript after projection failure", async () => {
  let current = empty();
  let saves = 0;
  const store: LearningStatePort = {
    load: async () => structuredClone(current),
    save: async next => { saves++; current = structuredClone(next); },
  };
  const reconciler = new TranscriptEvidenceReconciler(store);
  const session = {
    id: "session-one",
    messages: [{
      role: "assistant", content: "Review",
      parts: [{ type: "review-findings", reviewId: "review:one", findings, sourcePath: "notes/a.md" }],
    }],
  } as ChatSession;
  await reconciler.reconcileTranscript(session, empty());
  await reconciler.reconcileTranscript(session, current);
  assert.equal(current.evidence.length, 1);
  assert.equal(saves, 1);
});
