import { Compartment, EditorState } from "@codemirror/state";
import {
  Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate,
} from "@codemirror/view";
import { MAX_CODE_ANSWER_CHARS, tokenizeCode } from "./code-syntax";
import { watchCodeEditorRemoval } from "./code-editor-lifecycle";

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

function fallbackEditor(parent: HTMLElement, options: CodeAnswerEditorOptions): CodeAnswerEditorHandle {
  // If CodeMirror is unavailable, keep editing/answer submission usable.
  const editor = parent.createEl("textarea", { cls: "nox-quiz-editor nox-quiz-code-editor" });
  editor.rows = 3;
  editor.maxLength = MAX_CODE_ANSWER_CHARS;
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "Code answer");
  editor.value = options.source;
  editor.disabled = options.readOnly;
  const warning = parent.createDiv({ cls: "nox-code-answer-limit", attr: { "aria-live": "polite" } });
  let lastValid = options.source;
  const fit = (): void => {
    if (!editor.style || !Number.isFinite(editor.scrollHeight)) return;
    editor.style.height = "auto";
    editor.style.height = Math.max(92, editor.scrollHeight) + "px";
  };
  editor.addEventListener("input", () => {
    if (editor.disabled) return;
    if (editor.value.length > MAX_CODE_ANSWER_CHARS) {
      // Prevent clipboard/paste or scripted changes from bypassing maxlength.
      editor.value = lastValid;
      warning.textContent = "Code answer limit: 40,000 characters.";
      fit();
      return;
    }
    warning.textContent = "";
    lastValid = editor.value;
    fit();
    options.onChange(editor.value);
  });
  fit();
  let destroyed = false;
  return {
    setReadOnly(value) { if (!destroyed) editor.disabled = value; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      editor.remove();
      warning.remove();
    },
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

  let view: EditorView | null = null;
  let disconnect = () => {};
  try {
    const readonly = new Compartment();
    let warning: HTMLElement | null = null;
    const state = EditorState.create({
      doc: options.source,
      extensions: [
        lightTheme,
        EditorView.lineWrapping,
        syntaxPlugin(options.language),
        EditorState.changeFilter.of(tr => {
          if (tr.newDoc.length <= MAX_CODE_ANSWER_CHARS) {
            if (warning) warning.textContent = "";
            return true;
          }
          if (warning) warning.textContent = "Code answer limit: 40,000 characters.";
          return false;
        }),
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
    const editor = new EditorView({ state, parent: host, root: doc });
    view = editor;
    editor.dom.classList.add("nox-code-answer-editor");
    editor.contentDOM.setAttribute("aria-label", "Code answer");
    editor.contentDOM.setAttribute("spellcheck", "false");
    warning = host.createDiv({ cls: "nox-code-answer-limit", attr: { "aria-live": "polite" } });
    let destroyed = false;
    const destroy = (): void => {
      if (destroyed) return;
      destroyed = true;
      disconnect();
      editor.destroy();
    };
    disconnect = watchCodeEditorRemoval(host, destroy);
    return {
      setReadOnly(value) {
        if (destroyed) return;
        editor.dispatch({
          effects: readonly.reconfigure([
            EditorState.readOnly.of(value), EditorView.editable.of(!value),
          ]),
        });
      },
      destroy,
    };
  } catch (error) {
    // If anything fails AFTER construction, release the view and observer too.
    disconnect();
    view?.destroy();
    console.warn("[Nox] Code editor unavailable; using plain text input.", error);
    host.replaceChildren();
    return fallbackEditor(host, options);
  }
}
