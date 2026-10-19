import assert from "node:assert/strict";
import test from "node:test";
import { tokenizeCode, normalizeCodeLanguage } from "../../src/chat/code-syntax";

test("Java highlighting keeps keywords, strings and comments separate", () => {
  const text = 'public class Main { String x = "return // literal"; // only comment\nint n = 42; }';
  const tokens = tokenizeCode(text, "Java");
  assert.equal(normalizeCodeLanguage(" Java "), "java");
  assert.ok(tokens.some(t => t.kind === "keyword" && text.slice(t.from, t.to) === "class"));
  assert.ok(tokens.some(t => t.kind === "type" && text.slice(t.from, t.to) === "String"));
  assert.ok(tokens.some(t => t.kind === "string" && text.slice(t.from, t.to) === '"return // literal"'));
  assert.ok(tokens.some(t => t.kind === "comment" && text.slice(t.from, t.to) === "// only comment"));
  assert.ok(tokens.some(t => t.kind === "number" && text.slice(t.from, t.to) === "42"));
  assert.ok(!tokens.some(t => t.kind === "keyword" && text.slice(t.from, t.to) === "return"));
});

test("Python and SQL comments remain language scoped", () => {
  const python = 'def greet(name):\n  # print("not called")\n  return "hello"';
  assert.ok(tokenizeCode(python, "py").some(t => t.kind === "comment" &&
    python.slice(t.from, t.to) === '# print("not called")'));
  const sql = "SELECT * FROM users -- rest of query\nWHERE id = 8";
  const tokens = tokenizeCode(sql, "sql");
  assert.ok(tokens.some(t => t.kind === "keyword" && sql.slice(t.from, t.to) === "SELECT"));
  assert.ok(tokens.some(t => t.kind === "comment" && sql.slice(t.from, t.to) === "-- rest of query"));
});

test("token ranges are bounded, sorted and never modify learner code", () => {
  const code = "const a = true;\nconst b = 'x';\n";
  const tokens = tokenizeCode(code, "typescript");
  assert.ok(tokens.length > 0);
  for (let i = 0; i < tokens.length; i++) {
    assert.ok(tokens[i].from < tokens[i].to);
    assert.ok(tokens[i].to <= code.length);
    if (i > 0) assert.ok(tokens[i - 1].to <= tokens[i].from);
  }
  assert.deepEqual(tokenizeCode("let x=1", "unknown-dialect"), []);
  assert.deepEqual(tokenizeCode("x".repeat(40_001), "java"), []);
});
