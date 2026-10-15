/** Obsidian desktop exposes Electron at runtime; it is external to the plugin bundle. */
declare module "electron" {
  export const shell: {
    openExternal(url: string): Promise<void>;
  };
}
