import type { ExplicitContextRef } from "../../packages/core/src/context/context-types";

export interface ComposerAttachment {
  name: string;
  ref: ExplicitContextRef;
}

/**
 * One ephemeral owner for explicit Composer sources. Context refs are derived,
 * never kept in a second independently mutable array.
 */
export class ComposerAttachmentDraft {
  private itemsValue: ComposerAttachment[] = [];

  get length(): number { return this.itemsValue.length; }
  items(): readonly ComposerAttachment[] { return this.itemsValue; }
  contexts(): ExplicitContextRef[] { return this.itemsValue.map(item => ({ ...item.ref })); }
  hasNote(path: string): boolean {
    return this.itemsValue.some(item => item.ref.kind === "vault-note" && item.ref.path === path);
  }
  add(name: string, ref: ExplicitContextRef): ComposerAttachment {
    const item = { name, ref };
    this.itemsValue.push(item);
    return item;
  }
  remove(item: ComposerAttachment): boolean {
    const index = this.itemsValue.indexOf(item);
    if (index < 0) return false;
    this.itemsValue.splice(index, 1);
    return true;
  }
  clear(): void { this.itemsValue = []; }
}
