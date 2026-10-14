# NOX performance engineering: critical path and retrieval

Status: implementation branch (2026-10-15). Results from production Obsidian and provider calls are **not yet measured**.

## Ownership graph

```text
ChatView -> RunLearningTurn -> ContextResolver + LearningState + Policy
                          -> ContextBudget -> serialized SessionController write
                          -> AgentRuntime -> provider adapter -> parser -> UI
                          -> terminal validation -> durable outcome
```

No additional mutable source of truth. The sparse lexical index is an in-memory derivative of Obsidian notes, rebuilt from revision stamps, vault events and live editor hashes. It must not be used to authorize edits or infer mastery.

## Changes

- Preflight overlaps independent context resolution, policy loading, and learning-state loading.
- Recovery checks existing evidence operation IDs before invoking transitions. Partially committed Review outcomes retain their stable indexed IDs.
- Context preparation reuses its encoder, stopword set and serialized cost estimates.
- Bounded top-K file selection avoids full-vault sorting when the candidate count exceeds 600, preserving stable modification-time ties.
- LocalResearch stores postings per term and chunk, so warm query work depends on matching postings, not the entire vault's token count. Edits/deletions/renames invalidate indexed versions. Buffer fingerprint still protects unsaved editors.
- CLI event queues use an amortized O(1) head-index dequeue and bounded periodic compaction. AGY uses StringDecoder to preserve split UTF-8 sequences.
- Session restoration yields periodically while retaining every transcript message, actions, and native Markdown render.
- Provider event timing uses monotonic performance.now deltas; it does not claim to measure provider-internal model computation.

## Test and benchmark protocol

1. `pnpm verify` and `pnpm lint`; do not merge if failing.
2. `pnpm bench:research`; repeat with NOX_BENCH_FILES=200 and NOX_BENCH_FILES=600. Record environment and compare pinned baseline.
3. In Windows Obsidian: measure at least 20 cold/warm Ask, Practice, Edit and /research turns per provider/model. Capture contextMs, preparationMs, providerFirstTextMs, firstVisibleMs, providerDurationMs, elapsedMs. Report median/P95 and heap use.
4. Assert output validity (including no phantom Practice questions), unchanged source allowlist behavior, stale-note editing protection, and cancelled/failed turn rollback.
5. Test a 200-turn session, large Unicode notes, bursty SSE, interrupted CLI processes, editor unsaved buffers, and vault rename/delete while research is active.

## Known limits

- Plugin data still uses full snapshots for durability; changing that contract requires a separate migration and crash-recovery proof.
- Indexed lookup is asymptotically cheaper for sparse queries but can use more memory than a scan. Ranking still sorts all matching chunks; implement bounded top-K only after profiling dense queries.
- Provider inference time depends on model, traffic, hidden context and output length. No inferred quota or guaranteed speedup is claimed.
- Model routing remains explicit/user-selected. Automatic fast-model routing must not silently replace the selected model.
- Progressive history restoration yields frames, but does not virtualize the entire message list; only introduce virtualization if profiling justifies its state/scroll complexity.
