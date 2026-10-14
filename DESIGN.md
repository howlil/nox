# Nox Design System

## Design contract

Nox is a compact Learning OS control surface inside Obsidian.

```text
user intent
→ product state
→ information responsibility
→ correct UI primitive
→ interaction
→ visual treatment
```

Target: calm, precise, compact, technical, functional, AI-native, and native
beside Obsidian.

Hierarchy: position → spacing → typography → surface → border → accent.
Purple is semantic, not decorative. NOX adopts the neutral-first foundation of
`howlil-app`, while preserving the existing Obsidian Learning OS component graph.
All color fills are flat; gradients, glows, shimmer text and decorative shadow
are forbidden. The interaction state, not a card's category, controls purple.

## Root graph

```text
Nox
├── Header
├── Thread
│   ├── EmptyContextStrip?
│   ├── EmptyIntro?
│   ├── FocusedActionGrid?
│   ├── UserBubble
│   ├── StatusTrace
│   ├── PlainResponse
│   ├── PracticeCard
│   ├── PracticeEvaluation
│   ├── ReviewFindingCard
│   ├── ProposalCard
│   └── ErrorRow
└── Composer
    ├── IntentChip?
    ├── AttachmentChip*
    ├── PromptInput
    └── AddContext / Model / Send
```

Session history remains session-owned. `SessionController` exposes persisted
sessions and performs the current-session switch; `ChatView` only renders the
compact history menu and rehydrates the selected transcript.
Practice questions, evaluations, and Review findings persist as typed
session parts and use the same card renderers after reload. An unanswered
practice restores the practice composer intent and displays its pinned origin
note instead of silently following a newly active note. History labels are
derived from the first user prompt, latest visible message, and update time;
there is no second transcript store.

The empty thread is a compact workspace entry surface, not a separate landing
page:

```text
current context
      ↓
focused action cards
      ↓
intent chip + composer
```

Focused cards expose only the existing one-shot actions: Explain, Practice,
Review, and Improve note. Ask remains the implicit composer default. The
learning loop is entered through the existing action and slash-command
contracts.

Card selection sets the composer intent and focus. It does not send a request.
The same capability metadata powers the cards and `/` menu so labels,
descriptions, commands, and icons cannot drift.

## Shared UI contracts

Reusable primitives own stable visual and interaction grammar:

```text
NoxIcon / NoxIconButton
NoxButton
NoxChip
NoxStatus
NoxSurface
NoxMenuRow + NoxMenuState
NoxPopover
NoxComposer
NoxMessageMeta
```

Feature components own learning-specific presentation, while the controller
owns learning effects. `src/chat/learning-card-renderers.ts` creates Practice
and Review card DOM for both live and restored transcripts; callbacks execute
actions through `ChatView`, never directly through persistence.

Feature components own learning meaning and domain actions:

```text
CapabilityCard
PracticeCard
ReviewFindingCard
ProposalCard
```

Do not promote a feature component to a global primitive only because it looks
similar to another surface. Promote it when responsibility, interaction
contract, and reuse are stable. Global primitives must not own learning state,
agent execution, persistence, or mutation policy.

Context rendering, menu popovers, and response metadata must compose these
contracts instead of creating parallel DOM structures. Learning-specific cards
remain feature components and should not be generalized into product-wide
primitives.

`NoxComposer` owns the reusable prompt surface behavior: input, file picker,
context chips, intent chip, command/model popover anchors, cancel, and send
controls. The host controller supplies callbacks and domain data; it remains
the owner of learning actions, context resolution, model persistence, and turn
state. This keeps the composer reusable without making the global UI layer
aware of Learning OS rules.

`NoxSelectionActions` is the reusable selection affordance. It appears only
when `ContextResolver` returns non-empty selected text, exposes `@selection`
and the source note, and offers compact Explain/Improve actions with optional
Shorten/Tone/Grammar disclosure. It owns only local visibility, disclosure,
and disabled state. The host maps an action to the existing learning request,
so selection actions do not create a parallel streaming or result lifecycle.
The same resolved selection remains visible in the composer context chip and
is resolved again by the controller at send time.

Capability cards share one neutral, solid-fill design:

```text
normal      → white surface + subtle neutral full border
hover       → solid neutral inset + stronger neutral border
selected    → solid soft purple fill + purple border
icon        → purple semantic foreground (no per-card color wash)
metadata    → small, plain muted text (no decorative pill)
```

The old `purple/blue/coral/green` capability tone identifiers remain metadata
for compatibility with existing callers. They must not generate per-card
colored fills. Selection is driven only by `selectedAction`: the intent chip,
focused card, command-menu row and prompt placeholder must describe the
same action. Choosing a card never sends an AI request.

Source and command pickers are composer-owned popovers. They open from the
composer, stay compact (`max-width: 440px`), and expose keyboard selection
without changing the layout of the thread.

The model picker follows the same rule. Product controls must not use a native
`select` when its popup cannot inherit Nox surfaces, borders, spacing, or
selection states. Model selection uses a composer-owned custom popover with a
visible selected row, compact chevron trigger, keyboard navigation, and an
outside-click close path.

All composer pickers share one interaction recipe: the trigger exposes
`aria-expanded` and `aria-controls`, the active option uses the same restrained
accent tint, the popover has a flat solid surface, complete subtle border,
no shadow, and bounded scrolling. Focus returns to the originating control
after selection or dismissal. Command rows render the same command label and
icon metadata as their capability cards.

## Card decision

```text
owns state / lifecycle / action?
├── no  → inline
└── yes
    ├── consequential → ApprovalCard
    └── otherwise     → ContentCard
```

Normal AI explanation is PlainResponse, not a card.

## Intent

Ask is implicit default.

Explain, Review, Edit are one-shot. Practice is persistent until the practice
session completes or the user exits it. The intent remains Practice after a
question is emitted; it must not reset merely because the question-generation
agent turn completed. Session switching restores the in-memory active Practice
intent for that session.

`/` chooses intent, creates an IntentChip, and removes command text from the
actual prompt.

## Context

Backend modes reuse the intent chip and slash menu. Free is the default.
`/mode assessment` and `/mode focused` are submitted commands. The chip shows
`Backend · Assessment`, `Backend · Focused`, or `Backend · Paused`; its control
prepares `/pause` or `/resume` for explicit submission. Another intent cannot
clear the lock. The placeholder describes `/pause` as the escape route.

Locked responses stay behind the thinking trace until scope validation. OOS
shows a brief plain response with the active question and `/pause`, with no
evaluation card or progress update. Protocol failure offers Retry and retains
the question. Local mode commands work even when the runtime is unavailable.

```text
Primary  = selection or current note
Explicit = @vault-note / attachment
System   = learning policy / progress
```

The composer shows a compact summary such as `@index.md · selection +2`.
Typing `@name` searches vault Markdown notes and adds real context.

Selecting text exposes a contextual action bar above the composer:

```text
@selection  note.md · 18 words
[Explain] [Improve]                         [⌄]
```

Actions are direct shortcuts into the existing Explain/Edit learning flow;
they do not simulate a second response stream or bypass context resolution.

## Chat history triage and appearance

The header history popover is a compact, local conversation manager. Active and
Archived are derived views over the same persisted session map. Selection and
swipe open state are presentation-only; no second history store is permitted.

- Select enables checkboxes and Select All for the current tab only.
- Batch Archive/Restore/Delete are a single serialized SessionController write.
- Archived chats retain their transcript/model metadata and can be restored.
- Delete always requires a count-specific confirmation and cannot be undone.
- Archiving or deleting the current chat selects the newest available active
  chat; if none remains, it creates one empty active chat in the same write.
- While a turn, plan, editor apply or status recovery is active, mutations are
  rejected by LearningController. Failed writes leave UI and durable state intact.
- Swipe left reveals Archive/Restore and Delete; swipe right reveals primary
  Archive/Restore. Full swipe commits only non-destructive Archive/Restore.
  A keyboard- and mouse-accessible More actions button exposes the same actions.
- UIArc Swipe Actions interaction semantics are adapted to Obsidian native DOM,
  not installed as a React runtime dependency.

NOX uses a single flat light palette for the sidebar, Settings and owned
modal/menu portals. NOX has no Appearance selector or dark theme override.
Obsidian's theme setting remains untouched; NOX surfaces keep their own
light-scoped tokens even if the host uses dark mode.

## Visual system

Adopt the `howlil-app` neutral-first foundation and retain NOX purple as the
semantic AI identity. Light palette:

| Token | Solid value | Responsibility |
| --- | --- | --- |
| `--nox-page` / `--nox-canvas` | `#FEFEFE` | main reading surface |
| `--nox-surface` | `#FEFEFE` | cards, thread, popovers |
| `--nox-inset` | `#F7F7F7` | composer, quiet grouping |
| `--nox-hover` | `#F5F5F5` | neutral hover |
| `--nox-ink` | `#161616` | primary text |
| `--nox-ink-2` / `--nox-ink-3` | `#626262` / `#949494` | metadata |
| `--nox-line` | `#EAEAEA` | subtle complete border |
| `--nox-accent` / `--nox-accent-hover` | `#8653D5` / `#7541C4` | primary action |
| `--nox-accent-ink` | `#7140BC` | active icon and copy |
| `--nox-accent-soft` | `#F4EDFF` | selected surface |
| `--nox-accent-border` | `#C9B0ED` | selection and focus |

### Light-only NOX surfaces — 2026-10-15

One light palette lives in the top of `styles.css` and is shared across
`.nox-root`, `.nox-settings`, and temporary `.nox-theme-portal` menus and dialogs.
Dark-mode toggles and force-dark classes are removed. Never override the
Obsidian global document styles.

### Hint, reveal, and feedback interaction contract (2026-10-14)

The complete ownership/state graph, test cases, and failure policy live in
`docs/QUIZ_INTERACTION_DESIGN.md`.

- Every question keeps one in-thread answer surface. Get hint explicitly
  records `/hint` through the canonical Practice controller and only then
  reveals an inline, collapsible nudge. Its assisted flag is derived from
  the canonical transcript, never stored in component-local persistence.
- Reveal correct answer is post-evaluation disclosure only, keyed to the
  committed question ID. MCQ may show the stored correct option; essay and
  code never invent reference answers.
- Feedback immediately shows the evaluation and learning gaps. Optional
  rubric criteria use a keyboard-accessible native details control.
  An assisted evaluation explicitly distinguishes correctness from
  independent mastery.
- Evaluating disables duplicate submission. Failure leaves the draft
  intact and permits retry. A successful evaluation locks the input.
- The next-activity affordance prepares an existing composer command
  rather than bypassing the learner's consent or program constraints.
- Animate only in-card disclosure (160ms opacity/position); reduced-motion
  removes nonessential animation. Use `NoxButton` and `NoxSurface`;
  do not create another CSS button or feedback-card design system.


## Rich response visualization — 2026-10-14

Plain Markdown remains the default response. Obsidian MarkdownRenderer owns headings,
tables, links, mathematics, syntax highlighting, and Mermaid diagrams.

Only opt-in fenced html-preview, svg-preview, nox-chart, nox-flow and nox-card
blocks get a dedicated functional container. Native Markdown tables use a
NOX-scoped horizontal-divider/scroll treatment and native status icons only
for exact known status text. Unnumbered heading style is a model presentation
preference, never a destructive rewrite of heading text. The polished diagram
path is a bounded, read-only top-down SVG; normal Mermaid still belongs to
Obsidian. Cards and chart data never imply unverified measurements.
These surfaces reuse NOX tokens, compact 11–13px labels, keyboard focus and
read-only source fallback. HTML/SVG begin on
Code tab; running previews require explicit click and isolated sandbox iframes.
Restored transcripts never auto-execute embedded code.

The learning map displays a centered vertical read-only prerequisite diagram plus
existing accessible objective details. Overflow scrolls down, never sideways;
cycles and excessive node counts degrade to textual hierarchy. Geometry is derived from program state; graphs
cannot change curriculum or mastery.

See docs/RESPONSE_VISUALS.md for schema, safety and manual acceptance gates.


## Live AI activity (2026-10-14)

The activity row is an existing inline `StatusTrace`, not a new card, overlay,
dashboard, or separate reasoning surface. A compact status + elapsed duration
is always visible during a turn; chronological details and the existing
`NoxRunInspector` are user-expandable. Stages represent application-observed
events only: context resolved, request prepared, runtime invoked, raw output
received, terminal result committed. Never present synthetic thoughts, bogus
tool actions, percentages, or unsupported completion estimates.

Keep current `--nox-*` theme variables, `--nox-radius-*` tokens, NOX logo,
Obsidian icon primitives (`setNoxIcon`), existing easing, and native type scale.
No preview-only cobalt tokens, emoji glyph icon substitutes, new icon packages,
or decorative panels belong in the shipped UI. Unreached stages stay hidden;
failure/cancel stops on the observed stage. Render output progressively without
per-word DOM creation. Reduced motion and compact sidebar behavior remain
governing constraints. Details: `docs/AI_LATENCY_LIVE_ACTIVITY.md`.


## Adaptive activity stream (2026-10-14 revision)

The earlier always-collapsed chronological checklist has been replaced by a
compact, BeUI-inspired **adaptive disclosure**. During a run, the actual observed
timeline is visible automatically in a height-capped viewport and follows its
newest event. On terminal completion it collapses into a one-line duration
summary, with user override preserved.

The structural contract is:
```text
Status header (Nox icon + working label + elapsed)
└─ one collapsible panel grid child (required to avoid leakage)
   ├─ activity viewport (observed phases + actual tools)
   └─ optional collapsed source/diagnostics inspector
```

Only runtime-observed steps may enter the visible timeline; never pre-render
all possible steps and never simulate tools or reasoning to fill quiet provider
time. Actual context documents are not activities and remain behind a separate
compact source-count disclosure. Default is no border, no extra card chrome,
only the existing Nox logo, native Obsidian icons, `--nox-*` variables and
reduced-motion-safe shimmer. While waiting for provider output, communicate
the lack of updates honestly; rich animations cannot make model inference
faster. Reference interaction pattern:
https://beui.dev/components/agents/agent-activity .

## Compact flat visual audit — 2026-10-15

The latest source refines the Howlil × NOX design after real Obsidian
screenshots revealed inconsistent native hover, pill overuse and excessive
card/settings whitespace. Product behavior remains unchanged.

```text
Root UI tokens (styles.css)
├── chrome → Header: transparent icon controls and compact timer row
├── welcome → neutral Continue row + four compact capability cards
├── composer → flat single surface → prompt row + 30px toolbar
├── learning → quiz, review, proposal use semantic state colors
├── settings → native Setting controls + compact Token Usage
└── focus → interior fill/border treatment (no outer ring)
```

- All actionable icons use the same Obsidian/Lucide outline family,
  normalized to 16px and consistent stroke weight; logo is an image.
- Hover never uses lift, halo, drop shadow or a contrasting rectangular
  patch within the textarea.
- Plain capability metadata is muted text, not a chip. Selected intent alone
  carries a purple-tinted surface.
- Continue Learning is a neutral functional row, not a framed hero.
- Token Usage places Refresh next to the section title; filters are full-width
  aligned selects, statistics are compact and tables use 6px row padding.
- Preserve source ownership: typography/colors/shapes in `styles.css`,
  icon primitive in `src/chat/primitives.ts`, capability glyph metadata in
  `src/chat/capabilities.ts`, native settings layout in
  `src/settings/TokenUsageSection.ts`. No shadow/ring overrides appended
  to the end to fight legacy declarations.
- Regression gates: lint/typecheck/unit/integration/build, source design
  assertions, and manual light-only NOX at 320px, 420px and wide panels, including dark host Obsidian.

## Native Obsidian capsule composer — 2026-10-15

**Design thinking:**
- Observe: the two-row default composer consumes unnecessary vertical space;
  model labels truncate in the sidebar; the user needs both direct file upload
  and a short, recognizable action/model trigger.
- Define: a compact single capsule that expands only when content demands it,
  with distinct and predictable file, action, and model responsibilities.
- Implement: `NoxComposer` owns layout measurements and semantic controls;
  `ChatView` routes trusted file picker click and preserves existing context,
  command and model state; `styles.css` owns geometry.
- Verify: test the collapsed and multiline composition, narrow panels,
  keyboard navigation, actual text attachments, model disclosure, file cancel,
  focus and selection restoration in light-only NOX.

```text
Composer
├── collapsed:  [+]  [Ask Nox…             ]  [@] [bot] [↑]
└── expanded:   [context chips / attachments / text ↵   ]
                [+]                         [@] [bot] [↑]
```

Rounded-full applies specifically to header icon buttons and the capsule
controls; existing functional cards and settings preserve their compact
rectangular shape. Keyboard focus stays visible as a flat in-surface color
change. No new learning state or model registry is created.


### Response viewport and variants (2026-10-15)

Thread reading content is capped at 768px and centered; narrow Obsidian panes
take 100% available width. Native Mermaid is fit to the local viewport with
icon-only Zoom/Fit/Expand; wide diagrams pan only in their own region.
Source-code Copy sits at top right. Browser-executable HTML/JavaScript offers
explicit, sandboxed Run/Stop. Assistant message actions are icon-only and
consistent between newly streamed and restored history.

Regenerate is distinct from retry. Only the latest Ask/Explain answer can be
regenerated; alternatives are durable (maximum eight). A failed generation
leaves canonical transcript state unchanged; selections go through the existing
serialized SessionController writer and invalidate provider cursor state.

## Token Usage Compact + Remaining Credits — 2026-10-15

Design thinking: observe the existing six-number wall and lack of account
credit support; define quick answers to usage/traffic/remaining; prioritize
flat light-only compact surfaces, visual relative bars, and truthful provenance.

```text
Usage record → daily buckets → filtered totals
             → Total hero + input/output split
             → compact metrics + model ranking
Manual snapshot → serialized plugin-data repository → model or shared-provider pool
                → visible Remaining Credits row, status, progress
```

- All amounts are reported NOX-local usage; cached and reasoning are not added.
- No inference from tokens to credits, no account-availability percentages.
- Manual entries always show the manual provenance and snapshot time.
- Model-specific entries supersede shared-provider pools. Provider pools have
  exactly one canonical editable/deletable row and may be echoed under models,
  explicitly labeled Shared. Never sum model echoes as separate balances.
- Each pool has a unit (credits/USD/requests), total, remaining and timestamp.
  Validate finite, positive limits and remaining between zero and limit.
- NOX is light-only, regardless of Obsidian host theme. No Appearance switch,
  shadow, gradient or outer keyboard focus ring.
