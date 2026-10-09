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
compact history menu and rehydrates the selected transcript. History labels are
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
