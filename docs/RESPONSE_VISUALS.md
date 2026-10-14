# NOX Rich Response Visuals — implementation contract

Status: current response renderer contract. CI validation and manual Obsidian smoke tests are separate release gates.
Scope: Ask/Explain response rendering and read-only program map. No new provider, storage, runtime protocol or learning-state authority.

## Design thinking: problem → acceptance

**Understand** — plain responses were rendered by Obsidian MarkdownRenderer after streaming, the learning map listed objectives without spatial arrows, and Practice/Review already used typed cards.

**Define** — improve legibility and interactive previews without converting prose into cards, executing model code in the plugin origin, introducing a competing session store, or loading large graph libraries for every turn.

**Ideate / choose** — keep Obsidian Markdown and Mermaid native. Enhance only opt-in response code fences after native rendering. Native Markdown tables receive NOX-scoped styling and exact status icons. Bounded chart/card/flow specs add no runtime dependencies. Session rehydration derives UI from stored source text.

**Prototype** — implemented by src/chat/response-spec.ts, response-visuals.ts, response-rich.ts, response-graph-layout.ts, learning-graph-layout.ts, and existing ChatView.ts / learning-graph.ts.

**Verify** — unit tests cover schemas, security document policy, graph layout, cycles, size limits. Runtime browser/Obsidian verification remains manual.

## Responsibility graph

model text → existing StructuredStreamParser (learning protocol unchanged)
→ existing SessionController (persists original text)
→ ChatView (stream text → native Markdown at terminal)
→ response-visuals (post-process opt-in code fences)
→ Markdown tables/status icons OR chart/card/top-down SVG OR click-to-run sandbox iframe OR original Markdown

For history: persisted assistant Markdown → native MarkdownRenderer → same enhancer.

For programs: NoxProgramOverview → learning-graph-layout (derived geometry) → learning-graph (read-only SVG and existing accessible details).

No renderer may commit Practice evidence, execute editor mutation, or read vault files.

## Model-visible formats

Ordinary Markdown remains preferred; Mermaid is already supported by native Obsidian Markdown.

An explicitly requested HTML demo uses a fenced language html-preview:

~~~html-preview
<button onclick="this.textContent='Clicked'">Click</button>
~~~

A requested SVG demo uses svg-preview:

~~~svg-preview
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80">
  <circle cx="40" cy="40" r="22" fill="#2468F2"/>
</svg>
~~~

A chart uses fenced nox-chart JSON:

~~~nox-chart
{"type":"line","title":"Latency (ms)","labels":["Mon","Tue","Wed"],"values":[120,80,65]}
~~~

Chart constraints: 1–16 points; nonnegative finite values <= 1e9; labels <= 80 chars; title <= 120 chars. Horizontal bar charts use `type: "horizontal-bar"` with the same schema. Unsupported/invalid JSON preserves source.

## Rich response formats (2026-10-15)

Default answers remain plain Markdown. Renderer-owned typography differentiates
h1/h2/h3/h4 by font size without rewriting user-authored headings. The
application requests unnumbered headings for normal Ask/Explain but never
strips meaningful numeric prefixes. Native Markdown tables receive a compact,
horizontal-divider style inside a scrollable, keyboard-focusable region. The
last column gets native Obsidian status icons **only** for an exact allowlist
of status strings (e.g. Completed, Pending, Failed); text remains unchanged.

Optional read-only comparison, metrics and status-table cards use fenced
`nox-card` JSON:

~~~nox-card
{
  "version": 1,
  "kind": "comparison",
  "title": "AGENTS.md",
  "description": "Measured source lengths",
  "items": [
    {"label": "Before", "value": 9479, "unit": "chars"},
    {"label": "After", "value": 2438, "unit": "chars"}
  ]
}
~~~

Allowed kinds: `metrics`, `comparison`, `status-table`. Up to 12 items.
Each item has label, string/finite number value and optional unit, detail,
semantic status (success/pending/warning/error). All values are textContent,
never HTML. Status icons come exclusively from `setNoxIcon` in NOX primitives.

For compact top-down diagrams, use fenced `nox-flow` JSON:

~~~nox-flow
{
  "version": 1,
  "title": "NOX request flow",
  "direction": "TB",
  "layout": "vertical-stack",
  "nodes": [
    {"id": "sidebar", "label": "NOX Sidebar"},
    {"id": "composer", "label": "Composer", "kind": "focus"},
    {"id": "run", "label": "Run agent"},
    {"id": "result", "label": "Response", "kind": "result"}
  ],
  "edges": [
    {"from": "sidebar", "to": "composer"},
    {"from": "composer", "to": "run"},
    {"from": "run", "to": "result"}
  ]
}
~~~

Valid layouts: `vertical-stack` or `layered`, both top-down and one column
at narrow sidebar width (layered improves sibling order, not horizontal sprawl).
Nodes have stable ID, text label and optional semantic kind:
default/decision/focus/result. Max 24 nodes, 48 edges, no cycles, duplicate IDs,
missing endpoints or self-loops. Invalid specs retain source with warning.
The renderer positions nodes by longest-path rank, uses vertical arrows and
side rails for cross-level connections, and supplies keyboard-accessible
textual step/connection details. Diagram scrolling stays vertical. Mermaid
remains the fallback for cyclic or unsupported graph formats.

The existing learning prerequisite graph now follows the same top-down
principle: one centered column, vertical scrolling, bounded 40 objectives,
explicit cycle/oversize fallback and native program authority.

No fabricated analytics: charts and cards display only supplied data; the
model must not invent token counts, benchmarks, percentages or status evidence.
Model format hints are injected only where relevant, to limit prompt size.

## Sandbox and failure policy

- Renderer never evaluates model strings in plugin window.
- Preview is user-activated; restored history never auto-runs it.
- iframe sandbox uses allow-scripts ONLY for HTML, without allow-same-origin, navigation, popups or forms.
- srcdoc CSP denies remote fetch, connections, nested frames, form posts, remote scripts/styles/fonts/images; permits local inline styles and scripts (HTML only).
- HTML output must never become an Obsidian command or vault mutation.
- Code tab removes running iframe; Reset starts new execution realm.
- Source limit is 80,000 UTF-16 characters. Oversize keeps source with warning.
- Invalid charts must not crash transcript; original Markdown persists.

## Manual Obsidian smoke tests

1. Ask for Mermaid sequence/flowchart; verify native Mermaid and restored history.
2. Ask for a fenced html-preview counter. Verify Code initial, Run preview executes, Reset restarts, Code stops iframe. Check blocked network and inaccessible parent DOM in DevTools.
3. Ask for svg-preview. Verify static rendering, scripts blocked.
4. Render nox-chart bar and line; verify data table, narrow sidebar, dark/light themes and keyboard focus.
5. Render invalid and oversize blocks; verify source fallback.
6. Reload/switch sessions; verify raw code persists but iframe never autostarts.
7. Open learning program map; verify arrows and accessible details. Cycles and >40 objectives show text fallback.
8. Verify Practice hints/evaluation, Review, Edit Apply, internal Markdown links and streaming still work.\n9. Verify native Markdown tables (320/400/500px), semantic last-column status icons, no global heading numbering, dark/light themes.\n10. Verify valid/invalid nox-card and nox-flow fences, >4 branches in one column, cross-rank connections, keyboard-readable fallbacks, restore parity and source safety.\n11. Verify learning prerequisite map scrolls down rather than right with no changes to program state or practice progression.

## Out of scope

- Arbitrary compiled React bundles, remote mini-apps, backend commands or execution in plugin origin.
- New learning persistence, arbitrary interactive widgets and curriculum edits from graph.
- Vega/React Flow dependencies until complexity justifies them.


## Responsive response system (2026-10-15)

Design thinking: reproduce overflow in native Mermaid and custom visuals,
define one 768px reading-column constraint, enhance existing Obsidian output
instead of adding a second renderer, and verify width, keyboard, history and sandbox.

Graph: AI stream -> RunLearningTurn -> SessionController -> ChatView ->
MarkdownRenderer -> response-visuals -> native Mermaid viewport or code sandbox.

- Thread width: max 768px centered, width 100% in narrow panes.
- Native Mermaid: Obsidian-owned SVG enhanced with Fit, Zoom and Expand.
  Late native diagrams use a bounded observer; the raw source persists.
- Zoom changes inner diagram width, never the chat/document width.
- Standard code fences: copy at top-right. HTML/JavaScript run only after
  explicit click, inside opaque-origin sandbox iframes; source stays visible.
- HTML, JS, SVG preview: icon-only Play, Code, Reset with accessible labels.
  Never auto-run restored content.
- The iframe denies network, nested frames, popup/navigation, and form posts
  by CSP; do not add allow-same-origin.
- Regenerate only the last plain Ask/Explain answer. New turn ID; exclude
  replaced user prompt and answer from prior provider history; rotate cursor.
  Persist up to eight alternatives atomically after successful generation.
  Failed regeneration leaves the original intact. Selecting a version clears
  the opaque provider cursor and is handled by SessionController.
- Non-browser code (Go, Java, Spring) must NOT execute inside Obsidian or with
  inherited vault/filesystem authority. A separately isolated, resource-limited,
  network-denied execution service is a prerequisite for such code.

Acceptance: 320/390/768/1440 widths, no page-level horizontal scrollbar,
Mermaid zoom/fit/fullscreen, keyboard and aria labels, sandbox behavior,
restart and stale-write regression tests, pnpm verify, manual Obsidian check.
