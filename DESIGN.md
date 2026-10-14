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

Hierarchy: position → spacing → typography → surface → border → elevation →
accent. Purple is semantic, not decorative.

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

Capability cards use a mostly white surface with a restrained tone variant:

```text
white surface
  → low-contrast monochromatic wash
  → asymmetric radial glow cropped by the right edge
```

The four tone mappings are lavender/violet for Explain, pale sky blue for
Practice, soft coral for Review, and muted mint for Improve note. The tone is
ambient context, not selection. Selection remains a separate purple border
state so the card's action state cannot be confused with its capability tone.

Selection is state-driven: capability tone classes are neutral by default, and
only the card matching the current `selectedAction` receives the purple border
and tint. The intent chip, focused card, command menu selection, and prompt
placeholder must describe the same action.

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
accent tint, the popover uses the shared Nox shadow and bounded scrolling, and
focus returns to the originating control after selection or dismissal. Command
rows render the same command label and icon metadata as their capability cards.

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

## Visual system

Use a deliberate light-mode token ratio:

```text
80% white surfaces
15% soft purple canvas / inset surfaces
5% purple accent for active AI state and primary actions
```

Nox owns these semantic tokens instead of inheriting arbitrary Obsidian
theme colors. Purple means active AI intent, focus, selection, or a primary AI
action. It should not decorate every surface.

Semantic tokens have one owner in the root token block. Composition sections may
override layout for a surface, but must not redefine semantic colors, radii, or
elevation tokens.

Green = correct/success/applied.
Orange = partial/warning/review.
Red = failure/destructive/incorrect.

Typography: 11 / 12 / 12.5 / 13 / 14 / exceptional 21px.
Spacing: 4 / 6 / 8 / 10 / 12 / 16 / 24px.
Radius: 6 chip / 8 control / 10 card / 14 composer-window / pill.
Compact controls: 28px.
Borders: crisp 1px.
Shadows: tiny and structural. Popovers share one soft ambient shadow; rows do
not receive individual borders or shadows.

Text input focus keeps the composer border neutral. Purple focus treatment is
reserved for active AI intent, selected capability, primary AI actions, and
keyboard-focusable controls where a visible focus cue is required.

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

Composer radius 10px, input 13px, controls 28px. Model is visually secondary.
The plus control owns context and file actions; do not duplicate it with a
separate `No context` or context selector button.

When context exists, its chip is embedded at the leading edge of the prompt
line. Keep the compact one-line layout while the input fits; when the textarea
wraps, move the text below the chip and place controls on the following row.
Do not force a fixed-height expanded composer or create a second context bar.

## Motion

100–150ms feedback, 150–200ms menus/controls, 220–300ms expansion. Motion only
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

No saturated full-surface purple gradients, glassmorphism, glowing borders, broad SaaS shadows,
decorative nested cards, giant icons/headings, arbitrary radii, native picker
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
12. Text input focus does not create a purple ring.


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

Only opt-in fenced html-preview, svg-preview, and nox-chart blocks get a dedicated
functional container. These use existing semantic tokens, compact 11–13px labels,
small controls, keyboard focus and read-only source fallback. HTML/SVG begin on
Code tab; running previews require explicit click and isolated sandbox iframes.
Restored transcripts never auto-execute embedded code.

The learning map displays a read-only prerequisite diagram plus existing accessible
objective details. Overflow is scrollable; cycles and excessive node counts
degrade to textual hierarchy. Geometry is derived from program state; graphs
cannot change curriculum or mastery.

See docs/RESPONSE_VISUALS.md for schema, safety and manual acceptance gates.
