export interface ContextDocument {
  type: "selection" | "note";
  path: string;
  content: string;
  source: "auto" | "explicit";
}

export type ExplicitContextRef =
  | {
      kind: "vault-note";
      path: string;
    }
  | {
      kind: "attachment";
      name: string;
      content: string;
    };

export interface LearningContext {
  activeNote?: {
    path: string;
    content: string;
  };

  selection?: {
    file: string;
    content: string;
  };

  explicit: ContextDocument[];
}

export interface LearningPolicy {
  path: string;
  rawInstructions: string;
}

export interface TurnContextSnapshot {
  resolved: LearningContext;
  visible: import("../types").AgentContext[];
  system: import("../types").AgentContext[];
  readableFiles: string[];
  mutableFile?: string;
}
