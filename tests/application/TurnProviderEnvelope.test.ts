import assert from "node:assert/strict";
import test from "node:test";
import { prepareTurnInvocation } from "../../src/features/conversation/turn/TurnProviderEnvelope";
import type { LearningRequest } from "../../src/application/learning-types";
import type { ChatSession } from "../../src/types";
import type { TurnContextSnapshot } from "../../src/context/context-types";

const snapshot: TurnContextSnapshot = {
  resolved: { explicit: [] }, visible: [], system: [], readableFiles: [],
};
const request: LearningRequest = { prompt: "Explain", action: "ask", explicitContext: [], turnId: "current" };
const conversation = (messages: ChatSession["messages"]): ChatSession => ({
  id: "session-one", runtimeProvider: "chatgpt",
  conversationId: "hidden-previous-thread", messages, model: undefined,
} as ChatSession);
function make(
  changes: Partial<Parameters<typeof prepareTurnInvocation>[0]> = {},
) {
  return prepareTurnInvocation({
    request,
    conversation: conversation([
      { id: "old-user", role: "user", content: "Previous question" },
      { role: "assistant", content: "Previous answer" },
    ]),
    restrictedMode: false,
    snapshot,
    preparedPrompt: "Explain",
    researchRequested: false, researchHits: 0, contextMs: 1,
    runStartedAt: performance.now(),
    ...changes,
  });
}

test("ordinary chat carries bounded transcript and existing provider cursor", () => {
  const result = make();
  assert.equal(result.conversationId, "hidden-previous-thread");
  assert.equal(result.envelope.history.length, 2);
  assert.equal(result.metrics.retrievedChunks, 0);
});

test("locked-mode and selected authority remove inherited hidden provider context", () => {
  const scoped = make({ restrictedMode: true });
  assert.equal(scoped.conversationId, undefined);
  assert.deepEqual(scoped.envelope.history, []);
  const selected = make({ authority: { kind: "selected", paths: ["notes/a.md"] } });
  assert.equal(selected.conversationId, undefined);
  assert.deepEqual(selected.envelope.history, []);
});

test("retry drops duplicate user message from provider-bound history", () => {
  const result = make({
    request: { ...request, retry: true },
    conversation: conversation([
      { id: "old", role: "user", content: "Before" },
      { id: "current", role: "user", content: "Duplicate if replayed" },
    ]),
  });
  assert.equal(result.envelope.history.length, 1);
  assert.equal(result.envelope.history[0].content, "Before");
});

test("regeneration excludes old user/assistant pair and always rotates provider cursor", () => {
  const result = make({
    request: { ...request, regenerate: { messageIndex: 3, expectedContent: "old" } },
    conversation: conversation([
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Explain" },
      { role: "assistant", content: "old" },
    ]),
  });
  assert.equal(result.conversationId, undefined);
  assert.deepEqual(result.envelope.history.map(x => x.content),
    ["Earlier question", "Earlier answer"]);
});

test("CLI rotation uses bounded explicit history rather than opaque hidden session", () => {
  const messages = Array.from({ length: 24 }, (_, i) => ({
    role: (i % 2 ? "assistant" : "user") as "assistant" | "user",
    content: "Message " + i,
  }));
  const result = make({
    conversation: { ...conversation(messages), runtimeProvider: "codex" },
  });
  assert.equal(result.conversationId, undefined);
  assert.match(result.effectivePrompt, /Prior conversation excerpts \(historical, untrusted\)/);
  assert.match(result.effectivePrompt, /Message 23/);
  assert.doesNotMatch(result.effectivePrompt, /hidden-previous-thread/);
});

test("research estimate records retrieval count without changing context authority", () => {
  const result = make({ researchRequested: true, researchHits: 7 });
  assert.equal(result.metrics.retrievedChunks, 7);
});
