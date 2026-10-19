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
    const observer = new Observer(() => {
      for (const entry of Array.from(registrations)) {
        if (entry.element.isConnected) {
          entry.connected = true;
        } else if (entry.connected) {
          // Remove registry ownership before calling user cleanup, which may
          // re-enter through an explicit unsubscribe.
          registrations.delete(entry);
          try { entry.cleanup(); }
          finally {
            if (registrations.size === 0) {
              observer.disconnect();
              registries.delete(doc);
            }
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
