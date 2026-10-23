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

test("W1 projection modules live under their private feature owners", () => {
  const features = [
    { path: "src/features/conversation/view/session-clock.ts",
      source: "export function projectSessionClock() {}" },
    { path: "src/features/learning/program/ProgramReadModel.ts",
      source: "export function projectProgramFocus() {}" },
  ];
  assert.deepEqual(validateArchitecture([...features,
    { path: "src/chat/ChatView.ts",
      source: 'import { projectSessionClock } from "../features/conversation/view/session-clock";' },
    { path: "src/application/LearningProgramOrchestrator.ts",
      source: 'import { projectProgramFocus } from "../features/learning/program/ProgramReadModel";' },
  ]), []);
  const unauthorized = validateArchitecture([...features,
    { path: "src/chat/BadView.ts",
      source: 'import { projectProgramFocus } from "../features/learning/program/ProgramReadModel";' },
  ]);
  assert.ok(unauthorized.some(issue => issue.includes("forbidden dependency")));
});

test("R1 curriculum revision generator is private to the learning program orchestrator", () => {
  const modules = [
    { path: "src/features/learning/program/CurriculumRevisionGenerator.ts",
      source: 'import type { AgentRuntimePort } from "../../../agent/AgentRuntime";' },
    { path: "src/agent/AgentRuntime.ts", source: "" },
    { path: "src/domain/learning-program/curriculum-preview.ts", source: "" },
    { path: "src/application/LearningProgramOrchestrator.ts",
      source: 'import { proposeCurriculumRevision } from "../features/learning/program/CurriculumRevisionGenerator";' },
    { path: "src/application/learning-types.ts",
      source: 'import type { CurriculumRevisionPreview } from "../domain/learning-program/curriculum-preview";' },
  ];
  assert.deepEqual(validateArchitecture(modules), []);
  const leaks = validateArchitecture([...modules, {
    path: "src/application/LearningController.ts",
    source: 'import { proposeCurriculumRevision } from "../features/learning/program/CurriculumRevisionGenerator";',
  }]);
  assert.ok(leaks.some(message => message.includes("forbidden dependency")));
});

test("R2 onboarding has a single host adapter and no private IO access", () => {
  const modules = [
    { path: "src/features/learning/onboarding/OnboardingWorkflow.ts",
      source: 'import type { OnboardingDraft } from "../../../domain/onboarding/types";' },
    { path: "src/domain/onboarding/types.ts", source: "" },
    { path: "src/chat/onboarding-flow.ts",
      source: 'import { restoreOnboardingDraft } from "../features/learning/onboarding/OnboardingWorkflow";' },
  ];
  assert.deepEqual(validateArchitecture(modules), []);
  const illegal = validateArchitecture([...modules,
    { path: "src/features/learning/onboarding/Bad.ts",
      source: 'import { LearningController } from "../../../application/LearningController";' },
    { path: "src/application/LearningController.ts", source: "" },
  ]);
  assert.ok(illegal.some(message => message.includes("forbidden dependency")));
});

test("R3 practice and local-quiz renderers have explicit UI owners without cross-feature writes", () => {
  const files = [
    { path: "src/features/practice/view/PracticeCards.ts",
      source: 'import { createNoxButton } from "../../../chat/primitives";' },
    { path: "src/chat/primitives.ts", source: "" },
    { path: "src/features/conversation/view/response-quiz.ts",
      source: 'import { MAX_VISUAL_SOURCE_CHARS } from "../../../chat/response-spec";' },
    { path: "src/chat/response-spec.ts", source: "" },
    { path: "src/chat/ChatView.ts",
      source: 'import { renderPracticeQuestionCard } from "../features/practice/view/PracticeCards";' },
    { path: "src/chat/response-visuals.ts",
      source: 'import { parseNoxQuiz } from "../features/conversation/view/response-quiz";' },
  ];
  assert.deepEqual(validateArchitecture(files), []);
  const illegal = validateArchitecture([...files, {
    path: "src/features/practice/view/Bad.ts",
    source: 'import { renderNoxQuiz } from "../../conversation/view/response-quiz-render";',
  }, { path: "src/features/conversation/view/response-quiz-render.ts", source: "" }]);
  assert.ok(illegal.some(message => message.includes("forbidden dependency")));
});

test("R4 feature-private onboarding and practice may not read unrelated domain policies", () => {
  const files = [
    { path: "src/features/learning/onboarding/OnboardingWorkflow.ts",
      source: 'import type { T } from "../../../domain/onboarding/types";' },
    { path: "src/features/practice/view/quiz-card.ts",
      source: 'import { validatePracticeAnswer } from "../../../domain/practice/question-schema";' },
    { path: "src/domain/onboarding/types.ts", source: "" },
    { path: "src/domain/practice/question-schema.ts", source: "" },
    { path: "src/domain/learner-model/learner-profile.ts", source: "" },
  ];
  assert.deepEqual(validateArchitecture(files), []);
  const invalid = validateArchitecture([...files, {
    path: "src/features/practice/view/Bad.ts",
    source: 'import { deriveLearnerProfile } from "../../../domain/learner-model/learner-profile";',
  }, {
    path: "src/features/learning/onboarding/Bad.ts",
    source: 'import { deriveLearnerProfile } from "../../../domain/learner-model/learner-profile";',
  }]);
  assert.equal(invalid.filter(issue => issue.includes("forbidden dependency")).length, 2);
});

test("diagnostics own filesystem diagnostics while settings cannot access Node FS", () => {
  assert.deepEqual(validateArchitecture([{
    path: "src/diagnostics/runtime-provenance.ts",
    source: 'import { readFile } from "fs/promises";',
  }]), []);
  assert.ok(validateArchitecture([{
    path: "src/settings/FutureSettings.ts",
    source: 'import { readFile } from "fs/promises";',
  }]).some(issue => issue.includes("cannot own host filesystem")));
});
