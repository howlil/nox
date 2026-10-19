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

For an explicitly requested custom top-down diagram, use fenced `nox-flow` JSON:

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


## Content-sized response surfaces (2026-10-15)

Problem evidence: a restored thinking row aligned differently in wide panes,
HTML quizzes were locked inside 240-480px frames with nested vertical scrolling,
and native Mermaid always stretched to 100% regardless of intrinsic graph width.
Layered nox-flow previously sorted by rank but still placed one node per row.

Ownership graph:
ChatView/thread -> thinking column (shared 768px) ->
  MarkdownRenderer -> response-visuals ->
  [Mermaid natural SVG with fit/zoom; sandbox preview height bridge;
   nox-flow intrinsic bounded layout].

- Thinking inherits the centered 768px response column; only inner trace is
  compact. Do not center a separate 380px thinking block.
- HTML/JavaScript sandbox emits no more than one ResizeObserver update per
  animation frame. The one host listener accepts messages only from the
  registered iframe contentWindow, opaque origin "null", matching preview ID,
  finite height, and a bounded update cadence. Heights are limited to 12,000px
  to prevent unbounded resource usage. Beyond this safety limit, internal
  overflow is allowed as an explicit fallback. Preview restore remains Code,
  never auto-executed. Switching Code/Reset/Stop unregisters the frame.
- Keep CSP prohibiting fetch, top-level navigation, nested frames, forms and
  remote assets; never enable allow-same-origin. SVG preview remains scriptless,
  so it uses its static fallback sizing.
- Native Mermaid's viewBox gives intrinsic size, with optional whitespace
  cropping based on actual SVG graphics bounds. Small graphs do not enlarge
  to fill the entire chat. Wide graphs fit to the local viewport and zoom
  changes only their inner width. Diagram height is not fixed and uses the
  ordinary transcript scroll.
- nox-flow vertical-stack preserves the existing 360px canvas contract.
  The layered variant groups by topological depth, applies four bounded
  barycentric sweeps, places <=3 siblings per row, and renders at most 638px
  wide. It is deterministic and uses O(V+E) storage on <=24 nodes/48 edges.
- Prompt guidance separates boot/startup topology and HTTP-request lifecycle,
  uses short node labels, and avoids unnecessary cross-links.

Verification: test native Mermaid at 2, 10, 24 nodes; preview quiz expand and
reset; repeated history load; 320/390/768/1440 pane widths; keyboard fit/zoom
controls; and bounds-check malicious iframe resize messages. Native Obsidian
visual smoke test is still required after CI.


## Thinking alignment regression (2026-10-15)

Reproduced from the live wide-pane screenshot: assistant content starts at the
left of the reading column, while the running thinking activity starts much
farther right. Root cause was two competing CSS owners: the earlier 768px
thinking rule and the later, more-specific .nox-root .nox-thinking rule that
constrained the OUTER activity to 430px and applied align-self:flex-start.
In a column flex container, auto horizontal margins consumed spare space,
centering the narrow activity wrapper.

Ownership invariant:
- .nox-thread declares --nox-reading-width: 768px.
- Every non-user direct child, including working/restored .nox-thinking and
  .nox-bubble--agent, uses the same maximum reading width.
- The INNER activity panel, not the outer flex child, has max-width 430px.
- Do not reintroduce a more specific selector narrowing the outer thinking
  element; never use JS offsets or !important to fix alignment.

Regression test: tests/chat/thinking-layout.test.ts checks CSS column
ownership and both activity variants being direct thread children.
Manual smoke check: test 320/390px sidebar and >1200px wide Obsidian pane.
Trigger Ask; inspect the left edges of live Waiting, settled Completed,
assistant content and restored history. They must align.


## Flat HTML preview and progressive question UI (2026-10-19)

### UX contract

- An explicitly requested HTML playground receives the **light, flat** design baseline from
  `howlil/howlil-app/src/styles/global.css` (a local pinned subset in
  `src/chat/preview-design-tokens.ts`); default page #FEFEFE, surface #F7F7F7,
  text #121212, border #BFBFBF, accent #9BB1FF, pill controls, no gradients,
  drop shadows or dark variant. Custom user-authored inline CSS may override
  the baseline *inside the sandbox only*.
- For a request such as “generate 10 quiz questions as HTML preview”, the model
  should generate a **single visible question** per view, with clear “X of N” progress,
  keyboard-accessible Previous/Next, persistent answers while navigating,
  no auto-advance, and a finish state. Remaining questions live in a JS data
  array, not as ten expanded DOM cards or a horizontal scrolling gallery.
  This is a **model presentation rule** for HTML; it does not change the
  native one-question-per-turn Practice protocol, grading or learner evidence.
  Because free-form HTML is model-produced, the renderer cannot guarantee
  the model's quiz interaction structure without a future typed quiz contract.
- Embed a fragment (not a full HTML document) when possible; existing full-document
  HTML and JS/SVG preview content remain supported.

### Design-thinking implementation graph

```text
Request for HTML prototype
  -> buildActionInstruction: flat-light + progressive-question constraints
  -> model: opt-in fenced html-preview source
  -> createNoxPreviewDocument: local tokens + CSP + opaque-origin sandbox
  -> renderPreview: user clicks Run -> isolated iframe
  -> ResizeObserver: measure #nox-preview-content, not iframe document viewport
  -> postMessage(id,height) to owning Obsidian window
  -> preview-frame: verify exact source window, origin null, matching id, bounds
  -> coalesced frame.style.height = intrinsic content height
  -> NOX transcript scrolls naturally; no nested scroll on normal-sized HTML
```

### A / E / R / lifetime

**A:** A single `html-preview` response contains the requested number of
questions as *data* but renders one question at a time. Local transition
`next/previous` changes only the sandbox DOM and triggers ResizeObserver.
The host tracks only height; it never reads an answer or stores quiz state.

**E:** Invalid/oversized source retains original code; untrusted or mismatched
resize messages are rejected; very large reported heights remain capped at
12,000 px; if script execution is blocked, the iframe retains its static
fallback height. A hostile or broken preview cannot access Obsidian vault,
network, plugin origin, or parent DOM. It is not a trusted evaluation engine.

**R:** The prebundled token snapshot, native iframe, browser ResizeObserver,
postMessage and Obsidian owner document. No CDN, font download, runtime network
calls, database, or extra renderer framework.

**Scope:** Starting/restarting source preview replaces the old execution realm
and releases its message registration. Switching to code view cancels any
pending trailing height update. Source Markdown remains authoritative for
restored chats; ephemeral JS quiz answers live only inside the iframe.

### Verification

- Assertions for token palette, no gradient, sandbox policy and intrinsic
  wrapper measurements; browser pop-out ownership preserved.
- Regression test for rapid shrinking height changes and final size delivery.
- Acceptance: 1/10 -> Next -> Previous -> final screen; no nested scrollbar,
  fit at 320px sidebar and wide pane, iframe shrinks after a long question,
  no CSS leak to NOX, no remote assets, source/preview toggle and restart work.
- Visual acceptance remains Obsidian Desktop-specific; passing CI alone is
  insufficient to claim pixel-perfect or scroll behavior.


## Typed one-question-at-a-time NOX quiz (2026-10-19)

The native **read-only quiz** is a response visualization, not the
`learning-practice` question/evaluation protocol. It is intended for
an explicitly requested multi-question quiz and never commits mastery,
grade evidence, or edits to the vault.

### Source contract

The AI emits one JSON block using the fenced `nox-quiz` language:

~~~nox-quiz
{
  "version": 1,
  "kind": "quiz",
  "title": "Backend Engineering",
  "questions": [
    {
      "id": "q1",
      "question": "What does idempotency guarantee?",
      "description": "Consider a retry of an HTTP request.",
      "options": [
        {"id": "a", "text": "Every retry is faster"},
        {"id": "b", "text": "Repeating has no extra intended effect"}
      ],
      "correctOptionId": "b",
      "explanation": "Repeated requests produce the same intended effect."
    }
  ]
}
~~~

1–50 uniquely identified questions, each with 2–6 unique answer options,
one `correctOptionId` referencing a local option, bounded text lengths,
an optional description and optional result explanation.
Malformed/oversized JSON remains in its original code block with a
non-blocking warning. No untrusted HTML, CSS, or JavaScript is evaluated
for this presentation format.

### A / E / R and scope

```text
User asks for 10-question interactive quiz
  -> Ask/Explain instructions request fenced nox-quiz
  -> MarkdownRenderer preserves original source
  -> response-visuals recognizes nox-quiz fence
  -> parseNoxQuiz validates source and answer references
  -> renderNoxQuiz creates one visible question using textContent
  -> selection stored in local Map<QuestionId, OptionId>
  -> Next/Previous changes index only; answer Map persists
  -> Finish shows score + optional expanded answer review
  -> Restart clears answers
```

**A:** At most one question/options DOM view is visible at any time.
NOX owns page navigation, progress, selections, finish/review/restart.
The host container grows with ordinary DOM content and has no inner
fixed-height iframe.

**E:** Missing answer keys, duplicate question/option IDs, invalid references,
excessive options or payloads fail closed to the original source.
Correctness is model-supplied and is appropriate only for formative
self-checks—not verified examinations. The model's correct answer can
still be inspected from the original Markdown source.

**R:** Existing Obsidian DOM/Markdown renderer, scoped flat white NOX CSS,
zero new runtime dependencies or iframe execution.

**Scope:** Answers exist only while this visual instance is mounted.
Transcript restoration re-renders questions from source and begins a fresh
attempt. Native Practice persistence, hint, evaluation and outcomes are
untouched; no automatic conversion between the protocols.

**Verification:** Validate parser bounds and hostile content; exercise
real event listeners with a fake DOM to verify one question per view,
choice retention, skip scoring, finish/review and restart. Desktop
acceptance checks overflow at 320px, dark-host light-only appearance,
keyboard interaction and transcript restore. Maintain a separate draft PR
until acceptance; coordinate rebase with the unmerged graph-rendering PR.

## Graph presentation parity (M1–M3, 2026-10-19)

**Choice and authority (A):** Application prompts prefer fenced Mermaid `flowchart TB` or
`flowchart LR` for ordinary architecture, dependency and flow diagrams.
`nox-flow` is still accepted as an explicit user-requested format or when
rehydrating existing conversations. Stored Markdown remains the sole source
of diagram truth. NOX does not infer missing edges or rewrite user diagrams.

**Rendering graph (A):** Persisted Markdown -> Obsidian MarkdownRenderer ->
native Mermaid SVG -> NOX shared graph viewport. A validated `nox-flow`
block instead follows `parseNoxFlow` -> `layoutNoxFlow` -> NOX SVG ->
the same shared graph viewport. The viewport only adjusts presentation,
not nodes, edges, learning state, or storage.

**Shared interaction:** `src/chat/graph-viewport.ts` adds Fit, Zoom 75–300%,
Expand, Escape-to-close, mouse drag-to-pan when overflowing, and native
touch/trackpad scrolling. Sizing is clamped to the diagram's intrinsic width
and stays within the current Obsidian chat pane. Owner document support
preserves pop-out windows. Native Mermaid remains owned by the Obsidian host.

**Visual conventions:** Nodes use compact, light-blue styling; explicit
`nox-focus` Mermaid node classes may be used for purple emphasis.
Only diagram-scoped CSS is changed, and unrelated Markdown content remains
unchanged.

**Failure handling (E):** Invalid `nox-flow` specs keep their JSON source,
oversized visual blocks keep their source, and late native Mermaid uses
the existing bounded MutationObserver. Any graph not supported by the
limited custom DAG schema should use native Mermaid instead.

**Dependencies (R):** No additional runtime or third-party graph libraries.
This milestone does not add ELK.js, alter `nox-flow` v1, or introduce a new
persistence store. A more capable layout engine remains a separate M4
decision, justified by measured layout failures rather than visual guesswork.

**Verification:** Unit tests cover graph routing and viewport width bounds.
CI and Obsidian desktop verification are distinct. Desktop acceptance must
cover native and custom diagrams in 320/390/768/1440px panes, fit/zoom/expand,
mouse pan, pop-out behavior, invalid formats, and transcript restoration.


## M4 — Advanced graph v2 with ELK layout (2026-10-19)

Source-of-truth: `nox-flow` v1 remains valid, unchanged and synchronous. `nox-flow`
v2 is explicitly opt-in; native Obsidian Mermaid remains the default for
ordinary architecture and learning diagrams.

### Typed shapes and trust boundary

```nox-flow
{
  "version": 2,
  "title": "NOX runtime",
  "direction": "TB",
  "layout": "layered",
  "groups": [{"id":"app","label":"Application Layer"}],
  "nodes": [
    {"id":"ui","label":"ChatView"},
    {"id":"runner","label":"RunLearningTurn","group":"app","kind":"focus"},
    {"id":"provider","label":"AgentRuntime"}
  ],
  "edges": [
    {"from":"ui","to":"runner","label":"request"},
    {"from":"runner","to":"provider","label":"execute"}
  ]
}
```

Limits: 40 nodes, 80 edges, 8 non-empty groups, one group per node, one-level
groups only, valid bounded IDs/labels, no unknown references or duplicates.
TB and LR directions are permitted; cycles may be represented. Validation
converts untrusted source to `NoxFlowSpecV2` before ELK is invoked.
No user-provided layout options, CSS, arbitrary HTML or executable code.

### A — Successful execution graph

```
persisted or new Markdown
  -> Obsidian MarkdownRenderer
  -> response-visuals / detect nox-flow
  -> parseNoxFlow(v1) OR parseNoxFlowV2(v2)
  -> v1 existing layout OR async ELK layered layout
  -> bounded coordinate/edge validation
  -> DOM-only SVG with textContent
  -> shared zoom / fit / expand viewport
```

For v2, the layout uses `elk.algorithm=layered`,
`elk.edgeRouting=ORTHOGONAL`, and hierarchy handling
`INCLUDE_CHILDREN`, to represent grouping with crossing dependencies.
The heavy ELK module is initialized only when v2 rendering is requested.
The rendered SVG and graph positions are derived caches, never persisted.

### E — Failure and cancellation

Invalid input leaves the source in the original code fence. An ELK error,
missing route, non-finite geometry, unsupported cross-hierarchy layout or
oversized coordinates yields a visible source fallback. Detached chat views
must not be rewritten by an older async render. Source is always available for
restoration; no graph mutation has vault authority.

### R — Dependencies and review risks

Pinned `elkjs@0.11.0` bundles into `dist/main.js` (Obsidian community
three-file install), avoiding remote assets, dynamic worker URLs or network
requests. ELK is an EPL-2.0 OR GPL-3.0-or-later dependency and must retain
applicable license notices on distribution. Build size and first render latency
are explicit acceptance metrics.

### Tests and acceptance

Schema adversarial cases, duplicate IDs/edges, cyclic graph acceptance, grouped
cross-boundary edge routing, LR orientation, v1 compatibility and all existing
tests. Compare release artifact size to base before merging.
Obsidian Desktop acceptance remains mandatory for light/dark host themes,
a narrow side panel, a full window and a pop-out. If the bundled dependency
makes startup or install unacceptably large, retain the v2 schema behind an
explicit feature gate and reassess the layout engine.
