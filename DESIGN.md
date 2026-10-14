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

Appearance is a persisted system/light/dark preference for NOX only. System
follows Obsidian theme. Explicit choices override NOX's root and Settings
token scope without changing Obsidian globally. All three themes use flat
colors, existing NOX semantic tokens and reduced-motion support.

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

### Scoped NOX appearance — 2026-10-15

The appearance setting has four effective combinations: Obsidian Light/System →
NOX Light; Obsidian Dark/System → NOX Dark; Obsidian Dark/forced Light →
NOX Light; Obsidian Light/forced Dark → NOX Dark. The host app's theme must
never be mutated.

One light/dark palette is declared at the top of `styles.css` on
`.nox-root`, `.nox-settings`, and temporary `.nox-theme-portal` surfaces.
Dark selectors exclude `.nox-force-light`; explicit `.nox-force-dark` takes
precedence independently of the host theme. The same scope sets
`color-scheme`, scrollbar/accent colors, and a narrow bridge for Obsidian's
rendered text, form, link and code variables. Component rules should read
`--nox-*`, never host-specific color variables.

The history native DOM action menu mounts into a temporary NOX-owned theme
portal outside clipped scrolling lists. Archive/delete confirmation dialogs
receive the same NOX appearance class. Portals are disposed on close; neither
portal nor theme token scope applies to the global Obsidian body.

The interactive HTML iframe remains intentionally isolated and light by
default: its untrusted document owns its presentation, not the NOX theme.
Other native NOX components do not get an implicit white background.

Metadata and semantic badges must meet readable text contrast in both
palettes. The base palette is neutral and flat; state color is semantic.

In dark mode, `styles.css` owns a corresponding flat ramp (`#080808`
page, `#121212` surface, `#1B1B1B` inset), adjusted purple foreground
contrast and semantic success/warning/error colors. Do not use transparent
white washes that disappear against dark surfaces.

Nox owns these semantic tokens instead of inheriting arbitrary Obsidian
theme colors. Purple means active AI intent, focus, selection, or a primary AI
action—not a purple-tinted canvas across the entire thread.

Semantic tokens have one owner at the top of `styles.css`; layout blocks must
not redefine color, radius or motion variables. Preserve the Howlil spacing
rhythm `4 / 8 / 12 / 16 / 20 / 24 / 32px` and type weights
`400 / 500 / 600` (compact sidebar metadata may stay 11–12px).
Radius: 6 chip / 8 control + card / 10 composer. Pills are limited to
non-interactive status markers, not ordinary controls.
Controls: 30px for icon actions, compact 28–30px for textual controls.
Keyboard focus has **no outer outline/ring**: the focused surface must change
to a solid purple-tinted fill, border, or text treatment that remains visible.
Cards, controls, and popovers have no shadows.

Green = correct/success/applied.
Orange = partial/warning/review.
Red = failure/destructive/incorrect.

An intent chip or selected card may use soft purple. A standard user bubble
uses the same solid soft-purple fill. Quiz feedback stays semantically colored;
purple never indicates correctness. Background gradients, text shimmers,
glowing borders, glass effects and gradient scroll masks are disallowed.

## Thread rules

UserBubble: compact purple tint, max ~84%, no broad shadow.

PlainResponse: transparent outer surface, no border, 13–14px rendered Markdown.

Assistant response text is natively selectable and copyable, including streamed
text, restored Markdown, Practice/Review content, and proposal diffs. Response
surfaces explicitly allow text selection instead of inheriting panel-level
selection restrictions. Links and action buttons retain their normal behavior.

Rendered Markdown links use Obsidian workspace navigation. Internal `.md`
links and heading anchors open through `workspace.openLinkText` with the
rendering note as the source path; external URLs remain browser-owned. Cmd/Ctrl
click preserves the native new-leaf affordance.

Assistant messages persist their rendering `sourcePath` so restored history
keeps relative Markdown links anchored to the note that produced the answer.

StatusTrace: show real operational facts only. Default `Thinking · 2.4s`;
completion `Completed in 2.4s`. The trace owns the only live timer; do not
simulate tool execution with timers.

PracticeCard: neutral card with small purple concept label and inset hint.

PracticeEvaluation: green / orange / red by outcome. Purple never means
correctness.

ReviewFindingCard: one material gap per card. Finding kinds are misconception,
missing relationship, factual error, and weak explanation. Actions: Practice,
Fix.

ProposalCard: proposed → Reject or Apply → applied/stale. Never style a proposal
as already executed.

## Composer

```text
[context chip] prompt text...

longer text moves onto its own line

+                              Model ▾   send
```

Composer uses a single flat bordered **capsule** on its default one-line state,
with input and four controls in one row: `+ Attach file`, prompt input,
`@ Actions`, `bot Model`, and `Send`. The plus opens the native
file picker on a trusted user click (real text attachment, using the existing
size/type policies), not the source menu. Typing `@name` continues to search
vault notes, and slash commands continue to use the action menu. The agent
button is icon-only, but preserves the complete selected model in its
`aria-label` and tooltip.

When the input wraps, contains a newline, or displays chips, the **same**
capsule expands upwards to a soft 16px-radius two-row layout: context/intent/
attachments and prompt above, tools below. Measure wrapping at the
**collapsed** input width before switching layout to avoid oscillation.
Text height caps at 120px with internal scrolling beyond that. All controls
are 32px circles; header icons share the same visual shape and native
Obsidian/Lucide outline family. No gradients, nested text-field rectangles,
shadow, halo, or outer focus ring.
The plus control owns context and file actions; do not duplicate it with a
separate `No context` or context selector button.

When context exists, its chip is embedded at the leading edge of the prompt
line. Keep the compact one-line layout while the input fits; when the textarea
wraps, move the text below the chip and place controls on the following row.
Do not force a fixed-height expanded composer or create a second context bar.

## Motion

160ms feedback, 160–240ms menus/controls, 220–300ms expansion. Motion only
communicates state or spatial relation. Respect reduced motion.

Chat motion contract:

```text
send       → user message enters
running    → thinking trace enters and remains readable
streaming  → response resolves progressively
completed  → actions appear after the response settles
menu open  → compact popover enters from the composer edge
```

Thinking trace contract:

- The thinking trace owns the only live elapsed timer for a turn.
- The response meta row may identify the action, but must not repeat the live
  timer while the turn is running.
- The response bubble is created only after a response delta or a structured
  result needs a rendered surface.
- Trace rows represent observable milestones from normalized events; they must
  not advance from decorative delays or simulated reasoning.
- The streaming cursor appears only while response text is actively arriving,
  and disappears before terminal actions or failure status are rendered.

Use Motion for interruptible runtime transitions and layout-adjacent entry
states. Keep simple loops and hover feedback in CSS. Do not animate every token
as a separate layout shift, move the whole thread while streaming, or use
spring/bounce motion for ordinary chat content. Reduced motion removes
transform motion while preserving readable state changes.

Action and model triggers expose their open state through the same visible
surface treatment as their popovers. A menu that is open must look connected to
the trigger; a native browser popup is not an accepted substitute.

## Runtime and recovery contracts

- Settings exposes the local provider choice with immediate changes while idle,
  separate executable paths, and the existing Preferred model field. Provider
  names belong in configuration; protocol events and diagnostics stay out of chat.
  Model menus refresh after a provider change, retaining Runtime default and any
  manually selected model ID belonging to the current provider. Codex catalog
  entries use their display names; hidden entries stay out of the picker.
  Discovery failure retains default/manual choices. A busy or failed
  settings save shows a notice and restores the persisted selection.

- Transcript and history are local capabilities; they remain readable if the
  external AGY runtime is unavailable. Only actions requiring AGY are blocked.
- New/switch session is unavailable during an active turn. Async writes are
  scoped to the originating conversation ID, never the currently visible tab.
- Retry is another attempt at the same logical user message; do not append a
  second user bubble or durable message.
- Review follow-up Practice/Fix actions carry their source note path. A Fix
  cannot silently retarget a different active document.
- Failed Apply due to a missing open editor is recoverable: keep the proposal
  pending and expose Retry Apply. Stale/ambiguous source text requires a new
  proposal.
- Selection or active note is the primary visible context, not both. Supporting
  attachments and system progress remain distinguishable.

## CSS ownership

The compact composer layout has one canonical rule for its outer surface,
grid container, and footer. Do not append versioned blocks that override these
same structural declarations. Remove dead legacy selectors after verifying
their corresponding feature components no longer render them.

## Avoid

No gradients of any kind (including text shimmer and scroll masks), glassmorphism,
glowing borders, broad SaaS shadows, decorative nested cards, giant icons/headings,
arbitrary radii, native picker
popups for product controls, focus rings around the text input, fake thinking
stages, permanent animation, or hidden consequential actions.

## Acceptance

1. Primary information and next action are obvious.
2. Every card owns state/lifecycle/action.
3. Every non-neutral color has meaning.
4. Context is inspectable.
5. Running/proposed/applied/failed/evaluation states are distinct.
6. One-shot intents reset.
7. Practice remains coherent across question → answer → evaluation.
8. Keyboard and reduced motion remain usable.
9. UI feels like Obsidian, not a generic AI dashboard.
10. Capability cards and command rows use the same icon metadata.
11. Command and model popovers use one Nox surface rule with no per-row shadow.
12. No control creates an outer focus ring or decorative shadow.
13. Keyboard focus is visible via an in-surface border/fill/text state.
14. Textarea hover/focus never introduces an internal white rectangle.
15. Capability cards and Token Usage fit the compact Obsidian sidebar.


## Interactive Practice Cards

An active question must render inside the existing chat bubble with compact,
native inputs and no competing floating panel. Choice options use radio inputs,
essays use an autosizing-capable textarea, and code uses a monospace editable
textarea. Hint is optional and does not submit an answer. A card is interactive
only when its question identity is the current unanswered question; historical
cards are read-only. Feedback is a separate nearby result, with explicit
misconceptions and the existing progress/evidence workflow. Colors, spacing,
typography and focus states reuse Nox tokens. No code execution in the
Obsidian renderer.

## Practice instruction reading order (2026-10-14)

The existing in-thread Practice card must treat instructions as a reading
problem before they become an input problem. In order: question type / concept,
short title, one-sentence brief, ordered tasks, requirements, given context,
expected output, optional collapsed reference code, then the editable answer.
Use Nox tokens, compact headings, and calm list typography. A task item is not
an interactive completion indicator or learning evidence. Long service API
references are read-only; minimal starter code remains editable. For questions
without structured instructions, present the original sentences in readable
paragraphs without inventing requirements. Both live and historical questions
must use the same renderer and remain theme-responsive. Details and decisions:
docs/READABLE_PRACTICE_INSTRUCTIONS.md.

---

## Settings: provider token usage

Settings has a compact, read-only Token usage section. Provider / Model /
Period dropdowns filter daily recorded totals; 3-column numeric metrics and
a flat table use the Nox 11–13px type scale, minimal rules and Obsidian theme
variables. No usage telemetry is rendered in the active learning sidebar.
Account quota/remaining credits are visibly unavailable when the provider
does not expose a supported source of truth. See `docs/TOKEN_USAGE.md`.

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
  assertions, and manual Obsidian light/dark at 320px, 420px and wide panels.

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
  dark mode, focus and selection restoration.

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
