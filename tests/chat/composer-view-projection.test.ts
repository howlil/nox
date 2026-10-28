import assert from "node:assert/strict";
import test from "node:test";
import type { LearningContext } from "@nox/core";
import { projectComposerPlaceholder, projectComposerContextChips } from "../../src/chat/composer-view-projection";

const note = { path: "Guides/deep/java.md", content: "note bytes" };
const selection = { file: "Guides/selection.md", content: "selected bytes" };
const context = (fields: Partial<LearningContext> = {}): LearningContext => ({
  explicit: [], ...fields,
});

test("M4 composer placeholders retain exact action and context policy", () => {
  const none = context();
  const chosen = context({ selection });
  const currentNote = context({ activeNote: note });
  assert.equal(projectComposerPlaceholder("ask", none, false), "Ask Nox...");
  assert.equal(projectComposerPlaceholder("ask", chosen, false), "Ask about this selection...");
  assert.equal(projectComposerPlaceholder("ask", currentNote, false), "Ask about this note...");
  assert.equal(projectComposerPlaceholder("explain", chosen, false), "What should I explain about this selection?");
  assert.equal(projectComposerPlaceholder("explain", none, false), "What should I explain?");
  assert.equal(projectComposerPlaceholder("practice", chosen, false), "Practice this selection...");
  assert.equal(projectComposerPlaceholder("practice", currentNote, false), "What should we practice?");
  assert.equal(projectComposerPlaceholder("review", currentNote, false), "What should I review in this note?");
  assert.equal(projectComposerPlaceholder("review", none, false), "What should I review?");
  assert.equal(projectComposerPlaceholder("edit", currentNote, false), "How should I improve this note?");
  assert.equal(projectComposerPlaceholder("edit", chosen, false), "What should I improve?");
  for (const action of ["ask", "explain", "practice", "review", "edit"] as const) {
    assert.equal(projectComposerPlaceholder(action, chosen, true),
      "Answer or clarify the current question · /pause to leave");
  }
});

test("M4 context chips show selection before note and avoid duplicate note", () => {
  const selected = context({ activeNote: note, selection });
  assert.deepEqual(projectComposerContextChips(selected, null, "ask", []), [
    { key: "selection", text: "@selection", title: selection.file, icon: "file-text" },
  ]);
  assert.deepEqual(projectComposerContextChips(context({ activeNote: note }), null, "ask", []), [
    { key: "note", text: "@java.md", title: note.path, icon: "file-text" },
  ]);
  assert.deepEqual(projectComposerContextChips(context(), null, "ask", []), []);
});

test("M4 pinned review source takes precedence only for practice/edit", () => {
  const selected = context({ selection, activeNote: note });
  for (const action of ["practice", "edit"] as const) {
    assert.deepEqual(projectComposerContextChips(selected, "Reviews/finding.md", action, []), [
      { key: "review-source", text: "@finding.md",
        title: "Pinned review source: Reviews/finding.md", icon: "file-text" },
    ]);
    assert.deepEqual(projectComposerContextChips(selected, selection.file, action, []).map(x => x.key),
      ["selection"], "same-path pin must not duplicate the automatic source");
    assert.deepEqual(projectComposerContextChips(context({ activeNote: note }), note.path, action, [])
      .map(x => x.key), ["note"]);
  }
  assert.deepEqual(projectComposerContextChips(selected, "Reviews/finding.md", "ask", []).map(x => x.key),
    ["selection"]);
  assert.deepEqual(projectComposerContextChips(selected, "Reviews/finding.md", "review", []).map(x => x.key),
    ["selection"]);
});

test("M4 pinned source and system context remain distinct and correctly ordered", () => {
  const files = ["AGENTS.md", "Policies/study.md"];
  const result = projectComposerContextChips(context({ activeNote: note }),
    "Review/needs-practice.md", "practice", files);
  assert.deepEqual(result, [
    { key: "review-source", text: "@needs-practice.md",
      title: "Pinned review source: Review/needs-practice.md", icon: "file-text" },
    { key: "system", text: "@nox-system", title: "AGENTS.md\nPolicies/study.md", icon: "file-text" },
  ]);
  assert.deepEqual(projectComposerContextChips(null, null, "ask", files).map(x => x.key),
    ["system"]);
  assert.deepEqual(files, ["AGENTS.md", "Policies/study.md"],
    "display projection must not mutate caller-owned source list");
});
