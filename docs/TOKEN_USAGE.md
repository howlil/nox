# Nox Token Usage — Product / Engineering Decision

## Design thinking

**Empathize:** Learners running multiple models need to understand Nox's consumption
without confusing ChatGPT plan restrictions with token counts.

**Define:** Show accurate, local usage totals by runtime provider, model and period.
Never fabricate a quota denominator, price or historical token usage.

**Ideate:** A separate settings-only observability section avoids UI distraction
while studying. Daily aggregates avoid storing prompts and unnecessary per-turn
identifiers.

**Prototype:** Settings > Token usage has Provider (All / AGY / Codex / ChatGPT),
Model (All / specific), Period (All time / 7 / 30 days), six counters, and
breakdown by provider+model. Controls are native, keyboard accessible and
use the existing calm Obsidian/Nox layout conventions.

**Test:** Unit tests cover malformed metadata, counting subsets, AGY cumulative
deltas, duplicate terminal results, failure rollback, runtime event suppression,
and filterable aggregation. CI must run `pnpm verify`; Obsidian settings
rendering requires a local smoke test.

## Authority and data flow

```text
AGY result / Codex turn.completed / ChatGPT response.completed
  -> provider parser -> normalized usage stream event
  -> AgentRuntime consumes telemetry (not sent to LearningController)
  -> TokenUsageRepository.record()
  -> existing PluginDataRepository serialized writer
  -> nox-token-usage-v1
  -> Nox Settings > Token usage (read-only)
```

The `nox-token-usage-v1` data contains daily provider/model buckets and AGY
cumulative conversation checkpoints. It contains **no** prompts, responses,
account tokens, or API keys. Cached input and reasoning are *subsets* of input
and output respectively; do not add those fields to Total.

AGY's terminal usage can represent cumulative conversation counters. Nox saves
the last observed report and counts only increases. If a resumed conversation
has more than one historical turn with no checkpoint, Nox establishes a
baseline rather than claiming earlier tokens belonged to the tracked period.
This conservative choice can undercount the first observed resumed turn.

## Known visibility limits

- This reports **Nox-generated** requests only, after this capability is
  installed. No import from provider-wide billing histories is implied.
- A request without trustworthy token metadata is not counted. Zero recorded
  tokens does not imply zero provider usage.
- The current integrations do not expose a supported, reliable programmatic
  account-wide remaining quota / credit denominator across all three runtime
  modes. The UI explicitly shows Unavailable rather than making one up.
- ChatGPT plan limits and Codex CLI session allowances are not the same as
  OpenAI API token pricing or token-per-minute limits.
- In settings, `(runtime default)` means the CLI did not report the actual
  model and Nox did not pin one. It is not guessed. A `requested: model-id`
  bucket represents the explicitly selected model, not a confirmed model ID.
- Local plugin-data write failures must not convert a completed inference
  request to a failed learning response; Settings surfaces the tracking error.
- Daily buckets use UTC. Account provider limits, if added later, must have
  an independent authoritative API contract and explicit reset timestamp.

## Acceptance / manual smoke

1. Open Settings > Nox > Token usage; a fresh install shows empty data.
2. Submit one AI turn per configured runtime; refresh Settings, verify counts.
3. Filter All, each provider, each model, and 7/30/all periods.
4. Reopen Obsidian; totals remain and no secret data is in plugin data.
5. Resume AGY conversation; successive reported cumulative totals produce
   one increment per turn, not repeated all-history additions.
6. Force a failed plugin-data write; inference still completes, Settings shows
   the ledger error, and no fabricated counts appear.
7. Verify the light-only NOX theme inside light and dark Obsidian hosts, narrow setting panels, keyboard navigation.

## Compact visualization and manual balances (2026-10-15)

- Token usage uses a compact total hero, input/output proportional split,
  four small supporting metrics, and model rows with relative bar lengths.
- A separate `nox-credit-balances-v1` key stores **manual snapshots only**,
  via the existing serialized `PluginDataRepository` writer. It never writes
  inferred or fabricated account/provider values.
- Inputs: provider, model or shared provider scope, unit, total limit, remaining
  amount, timestamp. Model-specific snapshots override shared pools.
- A shared provider pool appears once as a canonical editable entry and can
  be echoed under member models with a Shared label. This is one pool, not
  multiple credits available to sum. No automatic debit from token usage.
- Unsupported provider account balances render **Unavailable**, not zero.
- Current transports still cannot verify provider quota, account limits,
  allowance resets or pricing. No claim of real-time remaining capacity.
- Persistence: entries are validated, malformed records ignored, deletion
  removes only the requested scope, and independent token ledger remains.
- Light-only NOX removes the Appearance selector; host Obsidian theme is
  not modified.
