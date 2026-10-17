import assert from "node:assert/strict";
import test from "node:test";
import { buildCurriculumEdit, renderCurriculumRevisionEditor } from "../../src/chat/learning-revision-editor";
import type { LearningObjective } from "../../src/domain/learning-program/types";
import type { StructuralRevisionPreview } from "../../src/domain/learning-program/structural-revision";

const objective: LearningObjective = {
  id: "basics", title: "Fundamentals", outcome: "Explain basics",
  estimatedMinutes: 40, prerequisiteIds: ["intro"], sourceRefs: [],
  priority: "core", rubric: ["Explain concepts"],
};
const other: LearningObjective = {
  ...objective, id: "intro", title: "Introduction", prerequisiteIds: [],
};
test("native curriculum editor sends only typed, narrow changes to application", () => {
  assert.deepEqual(buildCurriculumEdit("basics", "revise", "title",
    "  Foundations  ", []), {
    kind: "revise", objectiveId: "basics", changes: { title: "Foundations" },
  });
  assert.deepEqual(buildCurriculumEdit("basics", "revise", "estimatedMinutes", "30", []), {
    kind: "revise", objectiveId: "basics", changes: { estimatedMinutes: 30 },
  });
  assert.deepEqual(buildCurriculumEdit("basics", "change-prerequisites", "title", "",
    ["intro", "intro"]), {
    kind: "change-prerequisites", objectiveId: "basics", prerequisiteIds: ["intro"],
  });
  assert.deepEqual(buildCurriculumEdit("basics", "deprecate", "title", "", []), {
    kind: "deprecate", objectiveId: "basics",
  });
  assert.throws(() => buildCurriculumEdit("basics", "revise", "estimatedMinutes",
    "-5", []), /positive/);
  assert.throws(() => buildCurriculumEdit("basics", "revise", "title",
    " ", []), /updated/);
});

type Options = { cls?: string; text?: string; type?: string; value?: string; placeholder?: string };
class FakeElement {
  readonly children: FakeElement[] = [];
  readonly handlers = new Map<string, Array<() => void>>();
  hidden = false;
  disabled = false;
  checked = false;
  value = "";
  type = "";
  min = "";
  maxLength = 0;
  text = "";
  readonly attributes: Record<string, string> = {};
  constructor(readonly tag = "div", readonly cls = "") {}
  createEl(tag: string, options: Options = {}): FakeElement {
    const next = new FakeElement(tag, options.cls);
    next.type = options.type ?? "";
    next.value = options.value ?? "";
    next.text = options.text ?? "";
    this.children.push(next);
    if (tag === "option" && this.tag === "select" && this.children.length === 1) {
      this.value = next.value;
    }
    return next;
  }
  createDiv(options: Options = {}) { return this.createEl("div", options); }
  createSpan(options: Options = {}) { return this.createEl("span", options); }
  addEventListener(type: string, cb: () => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), cb]);
  }
  trigger(type: string): void { for (const cb of this.handlers.get(type) ?? []) cb(); }
  setAttribute(key: string, value: string): void { this.attributes[key] = value; }
  setText(value: string): void { this.text = value; }
  empty(): void { this.children.splice(0); }
  focus(): void {}
  find(cls: string): FakeElement | undefined {
    if (this.cls.split(" ").includes(cls)) return this;
    for (const item of this.children) {
      const next = item.find(cls);
      if (next) return next;
    }
  }
  findAll(cls: string): FakeElement[] {
    const result = this.cls.split(" ").includes(cls) ? [this] : [];
    return [...result, ...this.children.flatMap(item => item.findAll(cls))];
  }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("editor is inline: preview never writes, approval is separate, and change invalidates diff", async () => {
  const root = new FakeElement();
  const staged: StructuralRevisionPreview = {
    operationId: "manual:preview", programId: "p", fromVersion: 1, toVersion: 2,
    kind: "revise", rationale: "Change the learning title", changedFields: ["title"],
    before: objective, after: { ...objective, title: "Foundations" },
  };
  const calls: string[] = [];
  renderCurriculumRevisionEditor(root as never, objective, [objective, other], {
    preview: async (action, rationale) => {
      calls.push("preview:" + action.kind + ":" + rationale);
      return staged;
    },
    approve: async id => { calls.push("approve:" + id); return {}; },
    onApproved: () => calls.push("refresh"),
  });
  const toggle = root.find("nox-curriculum-edit-toggle")!;
  const editor = root.find("nox-curriculum-editor")!;
  const inputs = root.findAll("nox-curriculum-input");
  const action = root.findAll("nox-curriculum-select");
  const preview = root.find("nox-curriculum-actions")!.children[1];
  const approve = root.find("nox-curriculum-approve")!;
  assert.equal(editor.hidden, true);
  assert.equal(approve.hidden, true);
  toggle.trigger("click");
  assert.equal(editor.hidden, false);
  assert.equal(toggle.attributes["aria-expanded"], "true");
  inputs[1].value = "Reasonable curricular update";
  inputs[1].trigger("input");
  inputs[0].value = "Foundations";
  preview.trigger("click");
  await tick();
  assert.deepEqual(calls, ["preview:revise:Reasonable curricular update"]);
  assert.equal(approve.hidden, false);
  inputs[0].value = "Changed again";
  inputs[0].trigger("input");
  assert.equal(approve.hidden, true, "editing invalidates approval and requires a new preview");
  preview.trigger("click");
  await tick();
  assert.equal(calls.filter(v => v.startsWith("preview:")).length, 2);
  approve.trigger("click");
  await tick();
  assert.deepEqual(calls.slice(-2), ["approve:manual:preview", "refresh"]);
  assert.equal(approve.hidden, true);
  assert.equal(action[0].value, "revise");
});

test("cancel and preview rejection never trigger approval", async () => {
  const root = new FakeElement();
  let approvals = 0;
  renderCurriculumRevisionEditor(root as never, objective, [objective, other], {
    preview: async () => { throw new Error("Cannot edit while focused"); },
    approve: async () => { approvals++; return {}; },
    onApproved: () => {},
  });
  root.find("nox-curriculum-edit-toggle")!.trigger("click");
  root.find("nox-curriculum-actions")!.children[1].trigger("click");
  await tick();
  assert.match(root.find("nox-curriculum-status")!.text, /while focused/);
  assert.equal(root.find("nox-curriculum-approve")!.hidden, true);
  root.find("nox-curriculum-actions")!.children[0].trigger("click");
  assert.equal(root.find("nox-curriculum-editor")!.hidden, true);
  assert.equal(approvals, 0);
});
