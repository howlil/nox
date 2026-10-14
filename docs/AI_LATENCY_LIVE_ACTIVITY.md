# NOX AI latency and Live Activity (2026-10-14)

Status: implemented as an incremental UI/observability slice; end-to-end Obsidian desktop latency is **not benchmarked yet**. This document describes actual shipped contracts and remaining measurement work.

## Design thinking (evidence-led)

- **Empathize:** learners should know if NOX is preparing a vault context, awaiting AI output, receiving text, or persisting results. A long wait with a generic "Thinking" label is not useful.
- **Define:** distinguish technical latency (context, preflight, model, rendering/persistence) from perceived latency. Neither a timer nor a simulated reasoning log improves actual inference speed.
- **Ideate:** one inline compact status row with an opt-in chronological trace, contextual source details in the existing inspector, and text as soon as it arrives.
- **Prototype:** extend existing `ChatView`/thinking trace and `NoxRunInspector`. Do not create another controller, panel, spinner framework, or authoritative store.
- **Test:** normalize lifecycle facts, measure phases, retain source restrictions and durable proposal/practice guards, check Obsidian small-width/dark theme and cancellation.

## Ownership and flow

```text
ChatView (intent) → LearningController → RunLearningTurn
                                             ├─ context + state resolution
                                             ├─ bounded prompt + transcript persistence
                                             ├─ AgentRuntime → ChatGPT/AGY/Codex adapters
                                             └─ validated terminal commit
                     ← LearningEvent: context-ready / activity-phase / delta / terminal
ChatView: present derived stage, inspector, streaming response
SessionStore: whitelist persisted optional timings
```

The three additive `activity-phase` events from the application boundary are:
- `waiting-model` — about to invoke the runtime. **Not proof of network send** (CLI may still initialize, ChatGPT may refresh auth/model catalog).
- `receiving-output` — first observed provider text event, **not necessarily visible answer text** (structured content may be withheld until validation).
- `finalizing` — provider completed successfully and NOX is validating/committing output. This step does not appear on aborted/failed runs.

Existing `context-ready` drives the transition out of context resolution. Every UI stage is derived from these observed facts, with no percentage or fabricated tools/thoughts. Cancelled and failed runs do not mark not-yet-reached stages as complete. Local operations such as deterministic MCQ grading need not trigger a model stage.

## Timing contract

`AgentTurnMetrics` includes optional:
- `contextMs`: elapsed from turn start to the context-ready boundary.
- `preparationMs`: elapsed from turn start through prompt preflight, just before runtime invocation.
- `firstVisibleMs`: elapsed to first visible `response-delta`, if any.
- `firstTokenMs`: legacy time from the model-turn deadline clock to first raw provider text; do not conflate with first visible output.
- `elapsedMs`: wall-clock turn time through validated terminal processing, before the transcript save completes.

All durations use millisecond wall-clock deltas; they can drift with system clock adjustments. They are diagnostics, not model usage, quota, or verified E2E first paint. A future benchmark should add monotonic timer samples without changing the transcript source of truth.

Provider usage is still recorded separately by `AgentRuntime`. Do not claim actual token usage when only `ContextBudget` estimates are available.

## Render behavior and design system

- One text node receives accumulated provider deltas; a pending `requestAnimationFrame` batches visible changes. Completion/cancellation flushes pending text before Markdown rendering.
- Avoid per-word `span` creation, DOM animation per word, and frequent 100ms timer updates.
- Existing NOX logo, `setNoxIcon` (Obsidian icon resolver) and `--nox-*` theme tokens are reused.
- Keep native 11–13px type, the existing compact sidebar width, neutral ink and border tokens, and existing opening/closing motion.
- Activity details start collapsed. The user controls expansion; auto-expanding the trace on every delta was removed.
- A prolonged absence of new model output is labeled exactly as such. No claim of internal reasoning access or inferred token progress.
- Historical transcripts retain their existing presentation format and still use normalized icons.

## Performance hypotheses, not benchmarks

1. Frame batching and a single text node should reduce streamed DOM mutations and associated style/layout cost compared with word spans. It does **not** accelerate model computation.
2. The native HTTPS socket inactivity timeout increased from 65s to 290s to stop premature disconnects in deep-reasoning cases. The existing 300s application deadline still provides overall cancellation. This protects correctness for long silences; it may increase wait before a timeout for stuck connections.
3. CLI adapters still spawn per turn. Keeping them warm would require an explicit lifecycle benchmark and process security review, not a blind new singleton.
4. Token-usage persistence is awaited in `AgentRuntime`. Measure how much it affects terminal delivery before altering durability semantics.

## Release gate

- `pnpm check:boundaries`, `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build`.
- Unit regressions: phase ordering, failed turn without finalizing phase, transcript metric sanitization.
- Manual Obsidian Windows checks: ChatGPT true SSE, AGY/Codex long responses, nested Markdown and code fences, cancellation during preflight and during stream, error and retry, theme switching, reduced motion, vault note selection, 1-minute silent model, 5-minute hard deadline.
- Benchmark at least 20 representative turns per provider/model with warm and cold samples; report median/P95 for first visible output, total duration, input-size estimates, and streaming render CPU. Do not assert a speedup until measured against a pinned baseline.
