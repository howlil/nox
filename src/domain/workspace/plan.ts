import type { LearningProgram } from "../learning-program/types";

export interface WorkspaceFile { path: string; content: string }
export interface WorkspaceManifest {
  programId: string;
  root: string;
  folders: string[];
  files: WorkspaceFile[];
}

export function workspaceRoot(program: Pick<LearningProgram, "id" | "goal">): string {
  const slug = program.goal.normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 40) || "learning";
  if (!/^[a-f0-9-]{36}$/i.test(program.id)) throw new Error("Invalid workspace program ID.");
  return `00-learning-os/workspaces/${slug}--${program.id}`;
}

/** Pure, provider-independent manifest. The model never chooses vault paths. */
export function planWorkspace(program: LearningProgram): WorkspaceManifest {
  const root = workspaceRoot(program);
  const marker = `nox-program-id: "${program.id}"`;
  const overview = `---\n${marker}\n---\n# ${program.goal.replace(/[\r\n#]/g, " ").trim()}\n\nLearning program managed by NOX. Progress and assessments remain in \`00-learning-os/progress.json\`.\n\n[[Roadmap|Open learning roadmap]]\n`;
  const roadmap = `---\n${marker}\n---\n# Learning roadmap\n\n${program.objectives.map((o, i) =>
    `${i + 1}. **${o.title.replace(/[\r\n]/g, " ")}** — ${o.outcome.replace(/[\r\n]/g, " ")} (${o.estimatedMinutes} min estimate)`).join("\n")}\n\nStart a session in the NOX sidebar to practice. Lesson notes are generated only on request.\n`;
  return {
    programId: program.id, root,
    folders: ["00-learning-os", "00-learning-os/workspaces", root, `${root}/Lessons`],
    files: [
      { path: `${root}/Overview.md`, content: overview },
      { path: `${root}/Roadmap.md`, content: roadmap },
    ],
  };
}
