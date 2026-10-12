export class TFile {
  public readonly basename: string;

  constructor(
    public path: string,
    public stat: { mtime: number } = { mtime: 0 },
  ) {
    const name = path.split("/").pop() ?? path;
    this.basename = name.replace(/\.md$/i, "");
  }
}

export class MarkdownView {
  constructor(
    public file: TFile | null,
    public editor: {
      getValue(): string;
      getSelection(): string;
      offsetToPos(offset: number): unknown;
      replaceRange(
        replacement: string,
        from: unknown,
        to: unknown,
      ): void;
    },
  ) {}
}

export class Plugin {
  registerEvent(_event: unknown): void {}
  async loadData(): Promise<Record<string, unknown> | null> {
    return null;
  }
  async saveData(_data: unknown): Promise<void> {}
}

export class App {}

export function setIcon(_element: unknown, _icon: string): void {}
