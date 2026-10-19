/**
 * One owner-document observer for every mounted CodeMirror answer editor.
 * Each registration is released explicitly or after its host is detached.
 * The observer stops when its final registration is released.
 */
type Registration = {
  element: HTMLElement;
  connected: boolean;
  cleanup: () => void;
};
type Registry = {
  observer: MutationObserver;
  registrations: Set<Registration>;
};
const registries = new WeakMap<Document, Registry>();

export function watchCodeEditorRemoval(element: HTMLElement, cleanup: () => void): () => void {
  const doc = element.ownerDocument;
  const Observer = doc?.defaultView?.MutationObserver;
  if (!Observer || !doc.documentElement) return () => {};
  let registry = registries.get(doc);
  if (!registry) {
    const registrations = new Set<Registration>();
    const observer = new Observer(records => {
      for (const entry of Array.from(registrations)) {
        if (entry.element.isConnected) {
          entry.connected = true;
          continue;
        }
        // An editor can mount and unmount in the same microtask. In that case
        // isConnected is false on callback but a removal from the observed
        // document proves the host was connected, even if it was never seen.
        const wasRemoved = !entry.connected && Array.from(records).some(record =>
          Array.from(record.removedNodes).some(node =>
            node === entry.element ||
            (typeof (node as Element).contains === "function" &&
              (node as Element).contains(entry.element))));
        if (!entry.connected && !wasRemoved) continue;
        registrations.delete(entry);
        try {
          entry.cleanup();
        } catch (error) {
          // One faulty editor teardown must not prevent other editors from
          // being released or leave a document-wide observer registered.
          console.warn("[Nox] Code editor cleanup failed", error);
        } finally {
          if (registrations.size === 0) {
            observer.disconnect();
            registries.delete(doc);
          }
        }
      }
    });
    registry = { registrations, observer };
    registries.set(doc, registry);
    observer.observe(doc, { childList: true, subtree: true });
  }
  const registration: Registration = {
    element,
    connected: element.isConnected,
    cleanup,
  };
  registry.registrations.add(registration);
  const current = registry;
  return () => {
    current.registrations.delete(registration);
    if (current.registrations.size === 0) {
      current.observer.disconnect();
      if (registries.get(doc) === current) registries.delete(doc);
    }
  };
}
