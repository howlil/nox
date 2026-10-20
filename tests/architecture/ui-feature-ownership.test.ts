import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateArchitecture } from "../../scripts/boundaries.mjs";

test("feature-owned view packages permit only explicit presentation imports", () => {
  const sources = [
    {path:"src/features/learning/view/LearningPresenter.ts",source:
      'import type { NoxProgramOverview } from "../../../application/learning-types";\n' +
      'import type { ActivitySummary } from "../../../domain/activity/aggregation";\n' +
      'import { setNoxIcon } from "../../../chat/primitives";'},
    {path:"src/features/conversation/view/response-actions-presenter.ts",source:
      'import { appendMessageActions } from "../../../chat/message-actions";\n' +
      'import { createNoxIconButton } from "../../../chat/primitives";'},
    ...["src/application/learning-types.ts","src/domain/activity/aggregation.ts","src/chat/primitives.ts",
      "src/chat/message-actions.ts"].map(path => ({path,source:""})),
  ];
  assert.deepEqual(validateArchitecture(sources), []);
  const forbidden = [
    'import { VaultProgramStore } from "../../../persistence/VaultProgramStore";',
    'import { AgentRuntime } from "../../../agent/AgentRuntime";',
    'import { Menu } from "obsidian";',
    'import { PracticePresenter } from "../../practice/view/PracticePresenter";',
  ];
  for (const source of forbidden) {
    const extra = [
      {path:"src/features/learning/view/ForbiddenPresenter.ts",source},
      ...["src/persistence/VaultProgramStore.ts","src/agent/AgentRuntime.ts",
        "src/features/practice/view/PracticePresenter.ts"].map(path=>({path,source:""})),
    ];
    assert.ok(validateArchitecture(extra).length > 0, source);
  }
});

test("ChatView delegates feature UI state without creating another data authority", () => {
  const view = readFileSync("src/chat/ChatView.ts", "utf8");
  const practice = readFileSync("src/features/practice/view/PracticePresenter.ts", "utf8");
  const learning = readFileSync("src/features/learning/view/LearningPresenter.ts", "utf8");
  const actions = readFileSync("src/features/conversation/view/response-actions-presenter.ts", "utf8");
  assert.match(view, /this\.practiceUi\.renderQuestion/);
  assert.match(view, /this\.practiceUi\.renderEvaluation/);
  assert.match(view, /this\.learningUi\.toggleActivity/);
  assert.match(view, /this\.learningUi\.toggleMap/);
  assert.match(view, /renderResponseActions\(/);
  for (const legacy of [/quizDraftTimer/, /learningGraphEl/, /learningActivityEl/, /sessionClockTimer/]) {
    assert.doesNotMatch(view, legacy);
  }
  assert.match(practice, /session\.practiceDrafts\?\.\[questionId\]/);
  assert.match(practice, /this\.actions\.saveDraft/);
  assert.match(practice, /this\.actions\.submit/);
  assert.match(practice, /epoch === this\.epoch/);
  assert.match(learning, /epoch !== this\.epoch/);
  assert.match(learning, /this\.clockTimer = window\.setInterval/);
  assert.match(actions, /onSelectVersion\(/);
  assert.doesNotMatch(practice + learning + actions, /new Vault(?:Program|Learning)Store|new PluginDataRepository/);
});

test("all learning turns flush Practice drafts before any composer clear or provider call", () => {
  const view = readFileSync("src/chat/ChatView.ts", "utf8");
  const start = view.indexOf("  private async runTurn(");
  const end = view.indexOf("  private handleLearningEvent(", start);
  assert.ok(start >= 0 && end > start);
  const turn = view.slice(start, end);
  const admission = turn.indexOf("this.turnStarting = true");
  const flush = turn.indexOf("await this.practiceUi.flushDraft()");
  const release = turn.indexOf("this.turnStarting = false");
  const guard = turn.indexOf("epoch !== this.viewEpoch");
  const clear = turn.indexOf('this.input.value = ""');
  const running = turn.indexOf('this.setUIState("RUNNING")');
  assert.ok(admission >= 0 && admission < flush && flush < release &&
    release < guard && guard < clear && clear < running);
  const newSessionStart = view.indexOf("newBtn.addEventListener");
  const newSessionEnd = view.indexOf("const moreBtn", newSessionStart);
  const newSession = view.slice(newSessionStart, newSessionEnd);
  assert.ok(newSession.indexOf("await this.practiceUi.flushDraft()") <
    newSession.indexOf("await this.learning.newSession()"));
});


test("a closed or superseded Obsidian leaf cannot accept late streaming events", () => {
  const view=readFileSync("src/chat/ChatView.ts","utf8");
  const start=view.indexOf("  private async runTurn(");
  const end=view.indexOf("  private handleLearningEvent(",start);
  assert.ok(start>=0 && end>start);
  const turn=view.slice(start,end);
  const iterator=turn.indexOf("for await (const event of this.learning.run(");
  const epochGuard=turn.indexOf("if (epoch !== this.viewEpoch) {",iterator);
  const cancel=turn.indexOf("this.learning.cancel();",epochGuard);
  const dispatch=turn.indexOf("this.handleLearningEvent(event);",iterator);
  const restoration=turn.indexOf("epoch === this.viewEpoch && request.regenerate");
  const catchGuard=turn.indexOf("if (epoch !== this.viewEpoch) return;",dispatch);
  assert.ok(iterator>=0 && epochGuard>iterator && cancel>epochGuard &&
    dispatch>cancel && restoration>dispatch && catchGuard>dispatch,
    "epoch guard must intercept late activity, regenerate restoration and errors");
  assert.match(view,/async onClose\(\): Promise<void> \{\s*\+\+this\.viewEpoch;/);
  assert.match(view,/private invalidateSessionPresentation\(\): void \{\s*\+\+this\.viewEpoch;/);
});

test("presenters do not duplicate domain repositories or persistence authority",()=>{
  for(const filename of [
    "src/chat/thinking-presenter.ts",
    "src/chat/prompt-menu-presenter.ts",
    "src/chat/model-menu.ts",
    "src/features/practice/view/PracticePresenter.ts",
    "src/features/learning/view/LearningPresenter.ts",
  ]){
    const text=readFileSync(filename,"utf8");
    assert.doesNotMatch(text,/from ["'][^"']*(?:VaultProgramStore|VaultLearningStore|PluginDataRepository|AgentRuntime)/,
      filename+" must not import a persistence or provider adapter");
    assert.doesNotMatch(text,/new (?:VaultProgramStore|VaultLearningStore|PluginDataRepository|SessionController)\(/,
      filename+" must not instantiate durable data ownership");
  }
});
