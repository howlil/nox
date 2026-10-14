import type { AgentModel } from "../types";

/** Show manual model IDs too when the runtime has no discovery catalog. */
export function modelMenuItems(models: AgentModel[], selected?: string): AgentModel[] {
  return [
    { id: "", name: "Runtime default" },
    ...models,
    ...(selected && !models.some((model) => model.id === selected)
      ? [{ id: selected, name: selected }] : []),
  ];
}
