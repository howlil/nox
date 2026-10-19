/** Bounded lexical coloring for NOX answer editors (presentation only).
 * This is intentionally not a compiler, linter or grammar parser. */
export type CodeTokenKind = "keyword" | "type" | "number" | "string" | "comment" | "literal";
export interface CodeToken { from: number; to: number; kind: CodeTokenKind }

const COMMON = new Set(("if else for while do return break continue try catch finally throw throws " +
  "switch case default new class interface enum extends implements import package public private protected " +
  "static final void abstract synchronized this super instanceof const let var function async await " +
  "export from as typeof yield in of def lambda pass with self nonlocal global elif except raise " +
  "True False None and or not is match print select where join group order by having insert into values " +
  "update delete create table alter drop index primary key foreign references null not limit offset " +
  "distinct union on left right inner outer asc desc").split(/\s+/));
const TYPES = new Set(("String Integer Long Boolean Double Float Object List Map Set Array Optional " +
  "Promise Error Record number string boolean unknown never any void int long short byte char float double " +
  "bool str dict tuple list set NoneType").split(/\s+/));
const LITERALS = new Set(["true", "false", "null", "undefined", "None", "True", "False", "NULL", "TRUE", "FALSE"]);
const MODES = new Set(["java", "javascript", "js", "typescript", "ts", "tsx", "jsx", "python", "py", "sql"]);
const REGEX = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|#[^\n]*|--[^\n]*|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|\x60(?:\\.|[^\x60\\])*\x60?|\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b|\b[A-Za-z_]\w*\b/g;

export function normalizeCodeLanguage(language: string): string {
  return language.trim().toLowerCase();
}

/** A small conservative lexer: strings and comments take precedence over words.
 * Output is ordered, nonoverlapping and never executes or transforms source. */
export function tokenizeCode(source: string, language: string): CodeToken[] {
  if (source.length > 40_000 || !MODES.has(normalizeCodeLanguage(language))) return [];
  const mode = normalizeCodeLanguage(language);
  const tokens: CodeToken[] = [];
  const matcher = new RegExp(REGEX.source, "g");
  for (const match of source.matchAll(matcher)) {
    const text = match[0], from = match.index ?? 0;
    const first = text[0];
    let kind: CodeTokenKind | null = null;
    if ((text.startsWith("//") && mode !== "sql" && mode !== "python" && mode !== "py") ||
        (text.startsWith("/*") && mode !== "python" && mode !== "py") ||
        (first === "#" && (mode === "python" || mode === "py")) ||
        (text.startsWith("--") && mode === "sql")) kind = "comment";
    else if (first === '"' || first === "'" || (first === String.fromCharCode(96) && ["js","jsx","ts","tsx","javascript","typescript"].includes(mode))) kind = "string";
    else if (LITERALS.has(text)) kind = "literal";
    else if (COMMON.has(text.toLowerCase()) || COMMON.has(text)) kind = "keyword";
    else if (TYPES.has(text)) kind = "type";
    else if (/^\d|^0x/i.test(text)) kind = "number";
    if (kind) tokens.push({ from, to: from + text.length, kind });
  }
  return tokens;
}
