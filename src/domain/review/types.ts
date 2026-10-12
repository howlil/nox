export type ReviewFindingKind =
  | "misconception"
  | "missing-relation"
  | "factual-error"
  | "weak-explanation";

export interface ReviewFinding {
  kind: ReviewFindingKind;
  concept: string;
  title: string;
  detail: string;
}

export interface ReviewPayload {
  kind: "review";
  findings: ReviewFinding[];
}
