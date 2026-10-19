import { Compartment, EditorState } from "@codemirror/state";
import {
  Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate,
} from "@codemirror/view";
import { tokenizeCode } from "./code-syntax";

export interface CodeAnswerEditorOptions {
  language: string;
  source: string;
  readOnly: boolean;
  onChange(source: string): void;
}

export interface CodeAnswerEditorHandle {
  setReadOnly(value: boolean): void;
  destroy(): void;
}

/** CodeMirror core comes from Obsidian's external modules; no code is executed. */
function syntaxDecorations(view: EditorView, language: string): DecorationSet {
  const source = view.state.doc.toString();
  const ranges = tokenizeCode(source, language).map(token =>
    Decoration.mark({ class: "nox-syntax-" + token.kind }).range(token.from, token.to));
  return Decoration.set(ranges, true);
}

function syntaxPlugin(language: string) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = syntaxDecorations(view, language);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) this.decorations = syntaxDecorations(update.view, language);
    }
  }, { decorations: plugin => plugin.decorations });
}

const lightTheme = EditorView.theme({
  "&": { backgroundColor: "#FEFEFE", color: "#121212", height: "auto", maxHeight: "none" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "visible", maxHeight: "none" },
  ".cm-content": {
    minHeight: "5.5em",
    padding: "10px 12px",
    fontFamily: "var(--font-monospace, ui-monospace, monospace)",
    fontSize: "12px",
    lineHeight: "1.6",
    caretColor: "#121212",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "#121212" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-selectionBackground": { backgroundColor: "#DDE7FF" },
}, { dark: false });

/** The host owns this editor's lifetime. On transcript removal, destroy CM6. */
function observeDetach(element: HTMLElement, destroy: () => void): () => void {
  const doc = element.ownerDocument;
  const Observer = doc?.defaultView?.MutationObserver;
  if (!Observer || !doc.documentElement) return () => {};
  let seenConnected = element.isConnected;
  const observer = new Observer(() => {
    if (element.isConnected) seenConnected = true;
    else if (seenConnected) {
      observer.disconnect();
      destroy();
    }
  });
  observer.observe(doc, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function fallbackEditor(parent: HTMLElement, options: CodeAnswerEditorOptions): CodeAnswerEditorHandle {
  // Keep all Practice drafts editable if a host lacks compatible CM6 support.
  const editor = parent.createEl("textarea", { cls: "nox-quiz-editor nox-quiz-code-editor" });
  editor.rows = 3;
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "Code answer");
  editor.value = options.source;
  editor.disabled = options.readOnly;
  const fit = (): void => {
    if (!editor.style || !Number.isFinite(editor.scrollHeight)) return;
    editor.style.height = "auto";
    editor.style.height = Math.max(92, editor.scrollHeight) + "px";
  };
  editor.addEventListener("input", () => {
    fit();
    if (!editor.disabled) options.onChange(editor.value);
  });
  fit();
  return {
    setReadOnly(value) { editor.disabled = value; },
    destroy() { editor.remove(); },
  };
}

/**
 * Shared read-only/editable code input for Practice and future typed quizzes.
 * No persistence, provider authority, compiler, shell or network capability.
 * CM6 is acquired synchronously from host-compatible external packages.
 */
export function mountCodeAnswerEditor(
  parent: HTMLElement, options: CodeAnswerEditorOptions,
): CodeAnswerEditorHandle {
  const host = parent.createDiv({ cls: "nox-code-answer-host" });
  const doc = host.ownerDocument;
  if (!doc?.defaultView || typeof doc.createElement !== "function") {
    return fallbackEditor(host, options);
  }

  try {
    const readonly = new Compartment();
    const state = EditorState.create({
      doc: options.source,
      extensions: [
        lightTheme,
        EditorView.lineWrapping,
        syntaxPlugin(options.language),
        readonly.of([
          EditorState.readOnly.of(options.readOnly),
          EditorView.editable.of(!options.readOnly),
        ]),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !update.state.readOnly) {
            options.onChange(update.state.doc.toString());
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: host, root: doc });
    view.dom.classList.add("nox-code-answer-editor");
    view.contentDOM.setAttribute("aria-label", "Code answer");
    view.contentDOM.setAttribute("spellcheck", "false");
    let destroyed = false;
    let disconnect = () => {};
    const destroy = (): void => {
      if (destroyed) return;
      destroyed = true;
      disconnect();
      view.destroy();
    };
    disconnect = observeDetach(host, destroy);
    return {
      setReadOnly(value) {
        if (destroyed) return;
        view.dispatch({
          effects: readonly.reconfigure([
            EditorState.readOnly.of(value), EditorView.editable.of(!value),
          ]),
        });
      },
      destroy,
    };
  } catch (error) {
    // A broken editor should not prevent a learner from submitting an answer.
    console.warn("[Nox] Code editor unavailable; using plain text input.", error);
    host.replaceChildren();
    return fallbackEditor(host, options);
  }
}
