import { App, TFile } from "obsidian";
import {
  DEFAULT_LEARNING_STATE,
  LearningState,
} from "../learning/learning-state";
import { decodeLearningState } from "./learning-state-schema";

const ROOT = "00-learning-os";
const PROGRESS_PATH = `${ROOT}/progress.json`;

function cloneDefaultState(): LearningState {
  return {
    ...DEFAULT_LEARNING_STATE,
    gaps: [],
    evidence: [],
  };
}


/**
 * Durable Learning OS state stored inside the vault so progress travels with
 * the vault instead of being trapped in Obsidian plugin data.
 */
export class VaultLearningStore {
  constructor(private readonly app: App) {}

  async load(): Promise<LearningState> {
    const file = this.app.vault.getFileByPath(PROGRESS_PATH);
    if (!file || !(file instanceof TFile)) {
      return cloneDefaultState();
    }

    const raw = await this.app.vault.cachedRead(file);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Learning state is invalid JSON: ${PROGRESS_PATH}`,
      );
    }

    try {
      return decodeLearningState(parsed);
    } catch {
      throw new Error(
        `Learning state has an unsupported shape: ${PROGRESS_PATH}`,
      );
    }
  }

  async save(state: LearningState): Promise<void> {
    await this.ensureRoot();

    const content = JSON.stringify(state, null, 2) + "\n";
    const file = this.app.vault.getFileByPath(PROGRESS_PATH);

    if (file && file instanceof TFile) {
      await this.app.vault.modify(file, content);
      return;
    }

    await this.app.vault.create(PROGRESS_PATH, content);
  }

  private async ensureRoot(): Promise<void> {
    const existing =
      this.app.vault.getAbstractFileByPath(ROOT);
    if (existing) return;

    await this.app.vault.createFolder(ROOT);
  }
}
