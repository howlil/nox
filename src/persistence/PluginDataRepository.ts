import type { Plugin } from "obsidian";

export type PluginData = Record<string, unknown>;

type PluginDataAccess = Pick<Plugin, "loadData" | "saveData">;
type PluginDataMutation = (current: PluginData) => PluginData;

/**
 * Single serialized writer for Obsidian plugin data.
 *
 * Domain-specific decoders remain outside this class. This boundary only owns
 * read/modify/write ordering so independent settings/session updates cannot
 * overwrite each other from stale snapshots.
 */
export class PluginDataRepository {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly plugin: PluginDataAccess) {}

  async read(): Promise<PluginData> {
    return ((await this.plugin.loadData()) ?? {}) as PluginData;
  }

  update(mutate: PluginDataMutation): Promise<void> {
    const operation = this.writeTail.then(async () => {
      const current = await this.read();
      const next = mutate({ ...current });
      await this.plugin.saveData(next);
    });

    this.writeTail = operation.catch(() => undefined);
    return operation;
  }
}
