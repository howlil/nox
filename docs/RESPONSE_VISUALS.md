# NOX Rich Response Visuals — implementation contract

Status: feature branch; CI and Obsidian smoke tests required before merge.
Scope: Ask/Explain response rendering and read-only program map. No new provider, storage, runtime protocol or learning-state authority.

## Design thinking: problem → acceptance

**Understand** — plain responses were rendered by Obsidian MarkdownRenderer after streaming, the learning map listed objectives without spatial arrows, and Practice/Review already used typed cards.

**Define** — improve legibility and interactive previews without converting prose into cards, executing model code in the plugin origin, introducing a competing session store, or loading large graph libraries for every turn.

**Ideate / choose** — keep Obsidian Markdown and Mermaid native. Enhance only opt-in response code fences after native rendering. A bounded chart spec and prerequisite layout avoid new runtime dependencies. Session rehydration derives UI from stored source text.

**Prototype** — implemented by src/chat/response-spec.ts, response-visuals.ts, learning-graph-layout.ts, and existing ChatView.ts / learning-graph.ts.

**Verify** — unit tests cover schemas, security document policy, graph layout, cycles, size limits. Runtime browser/Obsidian verification remains manual.

## Responsibility graph

model text → existing StructuredStreamParser (learning protocol unchanged)
→ existing SessionController (persists original text)
→ ChatView (stream text → native Markdown at terminal)
→ response-visuals (post-process opt-in code fences)
→ chart SVG OR click-to-run sandbox iframe OR original Markdown

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

Chart constraints: 1–16 points; nonnegative finite values <= 1e9; labels <= 80 chars; title <= 120 chars. Unsupported/invalid JSON preserves source.

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
8. Verify Practice hints/evaluation, Review, Edit Apply, internal Markdown links and streaming still work.

## Out of scope

- Arbitrary compiled React bundles, remote mini-apps, backend commands or execution in plugin origin.
- New learning persistence, arbitrary interactive widgets and curriculum edits from graph.
- Vega/React Flow dependencies until complexity justifies them.
