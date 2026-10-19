import assert from "node:assert/strict";
import test from "node:test";
import { validateArchitecture } from "../../scripts/boundaries.mjs";

const base = [
  { path: "src/domain/practice/PracticeStateMachine.ts", source: "export class PracticeStateMachine {}" },
  { path: "src/application/RunLearningTurn.ts",
    source: 'import { PracticeStateMachine } from "../domain/practice/PracticeStateMachine";' },
];

test("domain and application may use owned domain contracts", () => {
  assert.deepEqual(validateArchitecture(base), []);
});
test("a new feature may not bypass the application boundary into persistence", () => {
  const files = [...base, { path: "src/persistence/VaultLearningStore.ts", source: "" },
    { path: "src/chat/FutureView.ts",
      source: 'import { VaultLearningStore } from "../persistence/VaultLearningStore";' }];
  assert.ok(validateArchitecture(files).some((message: string) => message.includes("forbidden dependency")));
});
test("domain cannot depend on Obsidian, a provider or presentation", () => {
  const files = [{ path: "src/domain/practice/NewRule.ts",
    source: 'import { App } from "obsidian";\nimport { ChatView } from "../../chat/ChatView";' },
  { path: "src/chat/ChatView.ts", source: "" }];
  assert.equal(validateArchitecture(files).length, 2);
});
test("application cannot reach into concrete persistence or Obsidian adapters", () => {
  const files = [...base, { path: "src/persistence/VaultLearningStore.ts", source: "" },
    { path: "src/context/ObsidianContext.ts", source: "" },
    { path: "src/application/FutureTurn.ts", source:
      'import { VaultLearningStore } from "../persistence/VaultLearningStore";\n' +
      'import { ObsidianContext } from "../context/ObsidianContext";' }];
  assert.equal(validateArchitecture(files).length, 2);
});
test("unknown directories, removed legacy paths and broken imports fail", () => {
  const files = [...base,
    { path: "src/helpers/RandomUtils.ts", source: "" },
    { path: "src/learning/OldPractice.ts", source: "" },
    { path: "src/chat/BadView.ts", source: 'import { X } from "../domain/nope";' }];
  assert.equal(validateArchitecture(files).length, 3);
});
test("application-owned port and normalized parser stay usable", () => {
  const files = [...base,
    { path: "src/application/ports.ts", source: "" },
    { path: "src/agent/StructuredStreamParser.ts", source: "" },
    { path: "src/application/FutureTurn.ts", source:
      'import type { SessionPort } from "./ports";\n' +
      'import { StructuredStreamParser } from "../agent/StructuredStreamParser";' }];
  assert.deepEqual(validateArchitecture(files), []);
});

test("chat owns presentation helpers without another ui layer", () => {
  const files = [
    { path: "src/chat/ChatView.ts",
      source: 'import { render } from "./primitives";' },
    { path: "src/chat/primitives.ts", source: "export const render = () => {};" },
  ];
  assert.deepEqual(validateArchitecture(files), []);
  assert.ok(validateArchitecture([
    ...files, { path: "src/ui/another-popover.ts", source: "" },
  ]).some((message) => message.includes("unrecognized module owner")));
});

test("only concrete runtime adapters may own provider process I/O", () => {
  assert.deepEqual(validateArchitecture([{ path: "src/agent/CodexAdapter.ts", source: 'import { spawn } from "child_process";' }]), []);
  assert.ok(validateArchitecture([{ path: "src/agent/CodexProtocol.ts", source: 'import { spawn } from "child_process";' }])
    .some((message) => message.includes("provider/process I/O")));
});

test("M1 view and view helper cannot reach into domain command parsers", () => {
  const domain = [
    { path: "src/domain/practice/learning-scope.ts", source: "" },
    { path: "src/domain/learning-program/commands.ts", source: "" },
  ];
  for (const caller of ["src/chat/ChatView.ts", "src/chat/chat-state.ts"]) {
    const files = [...domain, {
      path: caller,
      source: 'import { parseScopeCommand } from "../domain/practice/learning-scope";\n' +
        'import { parseProgramCommand } from "../domain/learning-program/commands";',
    }];
    const issues = validateArchitecture(files);
    assert.equal(issues.length, 2, caller);
    assert.ok(issues.every((issue: string) => issue.includes("forbidden dependency")));
  }
});

test("M1 still permits presentation-only domain shapes and application queries", () => {
  const files = [
    { path: "src/chat/ChatView.ts", source:
      'import type { PracticeQuestion } from "../domain/practice/types";\n' +
      'import { LearningController } from "../application/LearningController";' },
    { path: "src/domain/practice/types.ts", source: "" },
    { path: "src/application/LearningController.ts", source: "" },
  ];
  assert.deepEqual(validateArchitecture(files), []);
});

test("M4 context resolver may use its structural port but not ObsidianContext", () => {
  const sources = [
    { path: "src/context/ContextSourcePort.ts", source: "" },
    { path: "src/context/ObsidianContext.ts", source: "" },
  ];
  const good = validateArchitecture([...sources,
    { path: "src/context/ContextResolver.ts", source:
      'import type { ContextSourcePort } from "./ContextSourcePort";' },
  ]);
  assert.deepEqual(good, []);
  const bad = validateArchitecture([...sources,
    { path: "src/context/ContextResolver.ts", source:
      'import type { ObsidianContext } from "./ObsidianContext";' },
  ]);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /forbidden dependency/);
});

test("M5 public facades can import only their own private feature collaborators", () => {
  const sources = [
    { path: "src/features/conversation/turn/StructuredTurnBuffer.ts", source: "" },
    { path: "src/features/learning/program/ProgramMutationQueue.ts", source: "" },
    { path: "src/features/conversation/view/transcript-presenter.ts", source: "" },
    { path: "src/application/RunLearningTurn.ts", source:
      'import { StructuredTurnBuffer } from "../features/conversation/turn/StructuredTurnBuffer";' },
    { path: "src/application/LearningProgramOrchestrator.ts", source:
      'import { ProgramMutationQueue } from "../features/learning/program/ProgramMutationQueue";' },
    { path: "src/chat/ChatView.ts", source:
      'import { TranscriptPresenter } from "../features/conversation/view/transcript-presenter";' },
  ];
  assert.deepEqual(validateArchitecture(sources), []);
  const illegal = validateArchitecture([...sources,
    { path: "src/chat/BadView.ts", source:
      'import { ProgramMutationQueue } from "../features/learning/program/ProgramMutationQueue";' },
  ]);
  assert.ok(illegal.some((message: string) => message.includes("forbidden dependency")));
});

test("M5 feature modules cannot bypass a writer or reach another private feature", () => {
  const sources = [
    { path: "src/features/conversation/turn/StructuredTurnBuffer.ts",
      source: 'import { VaultProgramStore } from "../../../persistence/VaultProgramStore";' },
    { path: "src/features/learning/program/ProgramMutationQueue.ts",
      source: 'import { StructuredTurnBuffer } from "../../conversation/turn/StructuredTurnBuffer";' },
    { path: "src/persistence/VaultProgramStore.ts", source: "" },
  ];
  const violations = validateArchitecture(sources);
  assert.equal(violations.length, 2);
  assert.ok(violations.every((message: string) => message.includes("forbidden dependency")));
});

test("M5 refuses unknown feature subpackages and unresolved relative imports", () => {
  const issues = validateArchitecture([
    { path: "src/features/learning/services/Fake.ts", source: "" },
    { path: "src/features/learning/program/Good.ts",
      source: 'import type { Unknown } from "./Missing";' },
  ]);
  assert.ok(issues.some((m: string) => m.includes("unknown feature package")));
  assert.ok(issues.some((m: string) => m.includes("unresolved import")));
});

test("M5 feature modules cannot import Obsidian or node filesystem", () => {
  const issues = validateArchitecture([
    { path: "src/features/conversation/turn/Fake.ts",
      source: 'import { App } from "obsidian"; import { readFile } from "fs";' },
  ]);
  assert.equal(issues.length, 2);
});

test("public session message types must pass through the stable transcript contract", () => {
  const contracts = [
    { path: "src/session/message-types.ts", source: "export interface ChatMessage {}" },
    { path: "src/session/transcript-types.ts", source:
      'export type { ChatMessage } from "./message-types";' },
  ];
  const publicRoot = { path: "src/types.ts", source:
    'export type { ChatMessage } from "./session/transcript-types";' };
  assert.deepEqual(validateArchitecture([...contracts, publicRoot]), [],
    "public transport compatibility should use the approved session type gateway");
  const direct = { path: "src/types.ts", source:
    'export type { ChatMessage } from "./session/message-types";' };
  assert.ok(validateArchitecture([...contracts, direct])
    .some((issue: string) => issue.includes("forbidden dependency")),
  "root must not bypass the stable transcript type contract");
});
