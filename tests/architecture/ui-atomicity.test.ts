import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync("src/chat/ChatView.ts", "utf8");

test("ChatView delegates proposal and empty state rendering, without a second data store", () => {
  assert.match(view, /new ProposalPresenter\(this\.thread/);
  assert.match(view, /this\.proposalUi\?\.append\(event\.edit\)/);
  assert.match(view, /this\.proposalUi\?\.restore\(message\)/);
  assert.match(view, /renderEmptyPrimary\(slate,/);
  assert.match(view, /renderEmptyContext\(slate, this\.currentContext\)/);
  assert.doesNotMatch(view, /private appendProposalActions\(/);
  assert.doesNotMatch(view, /private renderProposal\(/);
  assert.doesNotMatch(view, /private renderEmptyPrimary\(/);
});

test("Composer has one ephemeral attachment/context source and blocks late file reads", () => {
  assert.match(view, /private readonly attachmentDraft = new ComposerAttachmentDraft\(/);
  assert.doesNotMatch(view, /private extraCtx:/);
  assert.doesNotMatch(view, /private attachments:/);
  assert.match(view, /explicitContext:\s*\[\.\.\.this\.attachmentDraft\.contexts\(\)\]/);
  const i = view.indexOf("private async handleFiles(");
  const end = view.indexOf("private toActionMenuContext(", i);
  assert.ok(i > 0 && end > i);
  const handler = view.slice(i,end);
  assert.ok(handler.indexOf("const epoch = this.viewEpoch;") < handler.indexOf("await file.text()"));
  assert.ok(handler.indexOf("await file.text()") < handler.indexOf("epoch !== this.viewEpoch"));
});

test("ProposalPresenter has no direct host, vault, provider or repository authority", () => {
  const proposal = readFileSync("src/chat/proposal-presenter.ts", "utf8");
  assert.doesNotMatch(proposal, /from ["'][^"']*(?:LearningController|Vault|Repository|AgentRuntime)/);
  assert.match(proposal, /await this\.port\.apply\(edit\.id\)/);
  assert.match(proposal, /await this\.port\.reject\(edit\.id\)/);
  assert.match(proposal, /await this\.port\.retryStatus\(proposalId\)/);
  assert.match(proposal, /if \(!wrap\.isConnected\) return;/);
});

test("Onboarding keeps only one approval state machine and an explicit application port", () => {
  const onboarding = readFileSync("src/chat/onboarding-flow.ts", "utf8");
  assert.match(onboarding, /type OnboardingLearningPort = Pick<LearningController/);
  assert.match(onboarding, /private readonly learning: OnboardingLearningPort/);
  assert.match(onboarding, /private async approve\(withWorkspace: boolean\)/);
  assert.match(onboarding, /private operationId\?: string/);
  const empty = readFileSync("src/chat/empty-slate-renderer.ts", "utf8");
  assert.doesNotMatch(empty, /OnboardingDraft|approveLearningProgram|VaultProgramStore/);
});

test("CSS splits authoring files but does not change the three-file Obsidian release contract", () => {
  const build = readFileSync("esbuild.config.mjs", "utf8");
  assert.match(build, /tailwindCliPath\(\), "-i", "styles\.css"/);
  assert.match(build, /path\.join\("dist", "styles\.css"\)/);
  const check = readFileSync("scripts/check-css-sources.mjs", "utf8");
  assert.match(check, /cssFiles\("styles"\)/);
});
