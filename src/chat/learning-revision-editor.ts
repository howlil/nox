import type { LearningObjective } from "../domain/learning-program/types";
import type { StructuralRevisionAction, StructuralRevisionPreview } from "../domain/learning-program/structural-revision";
import { createNoxButton } from "./primitives";

export interface CurriculumRevisionActions {
  preview: (action: StructuralRevisionAction, rationale: string) => Promise<StructuralRevisionPreview>;
  approve: (operationId: string) => Promise<{ warning?: string }>;
  onApproved: () => void;
}

type Field = "title" | "outcome" | "estimatedMinutes" | "priority";
type Mode = StructuralRevisionAction["kind"];

export function buildCurriculumEdit(
  objectiveId: string, mode: Mode, field: Field, value: string, prerequisiteIds: string[],
): StructuralRevisionAction {
  if (mode === "deprecate") return { kind: "deprecate", objectiveId };
  if (mode === "change-prerequisites") {
    return { kind: "change-prerequisites", objectiveId,
      prerequisiteIds: [...new Set(prerequisiteIds)] };
  }
  if (field === "estimatedMinutes") {
    const number = Number(value);
    if (!value.trim() || !Number.isSafeInteger(number) || number <= 0) {
      throw new Error("Enter a positive number of minutes.");
    }
    return { kind: "revise", objectiveId, changes: { estimatedMinutes: number } };
  }
  if (field === "priority") {
    if (value !== "core" && value !== "supporting" && value !== "optional") {
      throw new Error("Select a valid priority.");
    }
    return { kind: "revise", objectiveId, changes: { priority: value } };
  }
  if (!value.trim()) throw new Error("Enter the updated value.");
  return { kind: "revise", objectiveId,
    changes: field === "title" ? { title: value.trim() } : { outcome: value.trim() } };
}

function fieldValue(objective: LearningObjective, field: Field): string {
  return String(objective[field]);
}

function readableChange(value: unknown, objectives: LearningObjective[]): string {
  if (Array.isArray(value)) return value.length ? value.map(id =>
    objectives.find(objective => objective.id === id)?.title ?? id).join(", ") : "None";
  if (typeof value === "boolean") return value ? "Retired" : "Active";
  return value === undefined || value === null ? "Not set" : String(value);
}

/** Small, inline, confirmation-first editor; all writes are owned by the application. */
export function renderCurriculumRevisionEditor(
  parent: HTMLElement, objective: LearningObjective, objectives: LearningObjective[],
  actions: CurriculumRevisionActions,
): void {
  const trigger = createNoxButton(parent, {
    cls: "nox-curriculum-edit-toggle", variant: "quiet", text: "Adjust objective",
    label: "Adjust " + objective.title,
  });
  const editor = parent.createDiv({ cls: "nox-curriculum-editor" });
  editor.hidden = true;
  const title = editor.createDiv({ cls: "nox-inspector-heading", text: "Adjust " + objective.title });
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "4");
  const modeLabel = editor.createEl("label", { cls: "nox-curriculum-field" });
  modeLabel.createSpan({ text: "Change" });
  const modeControl = modeLabel.createEl("select", { cls: "nox-curriculum-select" });
  for (const [value, label] of [
    ["revise", "Details"], ["change-prerequisites", "Prerequisites"], ["deprecate", "Retire objective"],
  ]) modeControl.createEl("option", { value, text: label });
  const reviseField = editor.createEl("label", { cls: "nox-curriculum-field" });
  reviseField.createSpan({ text: "Field" });
  const fieldControl = reviseField.createEl("select", { cls: "nox-curriculum-select" });
  for (const [value, label] of [
    ["title", "Title"], ["outcome", "Learning outcome"],
    ["estimatedMinutes", "Estimated minutes"], ["priority", "Priority"],
  ]) fieldControl.createEl("option", { value, text: label });
  const valueField = editor.createEl("label", { cls: "nox-curriculum-field" });
  valueField.createSpan({ text: "New value" });
  const textValue = valueField.createEl("input", { cls: "nox-curriculum-input", type: "text" });
  const priority = valueField.createEl("select", { cls: "nox-curriculum-select" });
  for (const option of ["core", "supporting", "optional"]) {
    priority.createEl("option", { value: option, text: option });
  }
  const dependencies = editor.createDiv({ cls: "nox-curriculum-dependencies" });
  dependencies.createDiv({ text: "Required objectives", cls: "nox-curriculum-caption" });
  const checks: Array<{ id: string; input: HTMLInputElement }> = [];
  for (const candidate of objectives) {
    if (candidate.id === objective.id || candidate.deprecated) continue;
    const label = dependencies.createEl("label", { cls: "nox-curriculum-check" });
    const input = label.createEl("input", { type: "checkbox" });
    input.checked = objective.prerequisiteIds.includes(candidate.id);
    label.createSpan({ text: candidate.title });
    checks.push({ id: candidate.id, input });
  }
  const rationaleLabel = editor.createEl("label", { cls: "nox-curriculum-field" });
  rationaleLabel.createSpan({ text: "Why change this?" });
  const rationale = rationaleLabel.createEl("input", { cls: "nox-curriculum-input",
    type: "text", placeholder: "Explain the change in one sentence" });
  rationale.maxLength = 500;
  const status = editor.createDiv({ cls: "nox-curriculum-status" });
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const actionsRow = editor.createDiv({ cls: "nox-curriculum-actions" });
  const cancel = createNoxButton(actionsRow, { variant: "quiet", text: "Cancel" });
  const previewButton = createNoxButton(actionsRow, { variant: "secondary", text: "Preview change" });
  const diff = editor.createDiv({ cls: "nox-curriculum-diff" });
  diff.hidden = true;
  const approveButton = createNoxButton(editor, {
    cls: "nox-curriculum-approve", variant: "primary", text: "Approve & save",
  });
  approveButton.hidden = true;
  let staged: StructuralRevisionPreview | null = null;
  let busy = false;
  let editRevision = 0;

  const invalidate = () => {
    editRevision++;
    staged = null;
    diff.empty();
    diff.hidden = true;
    approveButton.hidden = true;
    status.setText("");
  };
  const sync = () => {
    const mode = modeControl.value as Mode;
    const field = fieldControl.value as Field;
    reviseField.hidden = mode !== "revise";
    valueField.hidden = mode !== "revise";
    priority.hidden = mode !== "revise" || field !== "priority";
    textValue.hidden = mode !== "revise" || field === "priority";
    textValue.type = field === "estimatedMinutes" ? "number" : "text";
    if (field === "estimatedMinutes") textValue.min = "1";
    dependencies.hidden = mode !== "change-prerequisites";
    previewButton.disabled = busy;
    cancel.disabled = busy;
    approveButton.disabled = busy;
    trigger.disabled = busy;
    modeControl.disabled = busy;
    fieldControl.disabled = busy;
    textValue.disabled = busy;
    priority.disabled = busy;
    rationale.disabled = busy;
    for (const { input } of checks) input.disabled = busy;
  };
  const initialValue = () => {
    const field = fieldControl.value as Field;
    textValue.value = fieldValue(objective, field);
    priority.value = objective.priority;
  };
  const setBusy = (value: boolean) => { busy = value; sync(); };
  trigger.addEventListener("click", () => {
    if (busy) return;
    editor.hidden = !editor.hidden;
    trigger.setAttribute("aria-expanded", String(!editor.hidden));
    if (!editor.hidden) {
      initialValue();
      modeControl.focus();
    } else invalidate();
  });
  modeControl.addEventListener("change", () => { invalidate(); sync(); });
  fieldControl.addEventListener("change", () => { invalidate(); initialValue(); sync(); });
  for (const node of [textValue, priority, rationale]) {
    node.addEventListener("input", invalidate);
    node.addEventListener("change", invalidate);
  }
  for (const { input } of checks) input.addEventListener("change", invalidate);
  cancel.addEventListener("click", () => {
    if (busy) return;
    editor.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    invalidate();
    trigger.focus();
  });
  previewButton.addEventListener("click", () => { void (async () => {
    if (busy) return;
    invalidate();
    const requestedRevision = editRevision;
    setBusy(true);
    try {
      const field = fieldControl.value as Field;
      const action = buildCurriculumEdit(objective.id, modeControl.value as Mode,
        field, field === "priority" ? priority.value : textValue.value,
        checks.filter(item => item.input.checked).map(item => item.id));
      const result = await actions.preview(action, rationale.value.trim());
      if (requestedRevision !== editRevision) return;
      staged = result;
      diff.hidden = false;
      diff.createDiv({ cls: "nox-curriculum-caption",
        text: "Plan v" + result.fromVersion + " → v" + result.toVersion +
          " · Preview only, nothing saved" });
      for (const key of result.changedFields) {
        const row = diff.createDiv({ cls: "nox-curriculum-diff-row" });
        row.createDiv({ cls: "nox-curriculum-caption", text: key.replace(/([A-Z])/g, " $1") });
        row.createDiv({ cls: "nox-curriculum-old", text: readableChange(
          result.before[key as keyof LearningObjective], objectives) });
        row.createDiv({ cls: "nox-curriculum-new", text: "→ " + readableChange(
          result.after[key as keyof LearningObjective], objectives) });
      }
      approveButton.hidden = false;
      status.setText("Review the diff before approving.");
    } catch (error) {
      status.setText(error instanceof Error ? error.message : "Unable to preview change.");
    } finally {
      setBusy(false);
    }
  })(); });
  approveButton.addEventListener("click", () => { void (async () => {
    if (busy || !staged) return;
    setBusy(true);
    try {
      const approved = await actions.approve(staged.operationId);
      status.setText(approved.warning ?? "Curriculum updated.");
      staged = null;
      approveButton.hidden = true;
      actions.onApproved();
    } catch (error) {
      status.setText(error instanceof Error ? error.message : "Change was not approved.");
      invalidate();
    } finally {
      setBusy(false);
    }
  })(); });
  initialValue();
  sync();
  trigger.setAttribute("aria-expanded", "false");
}
