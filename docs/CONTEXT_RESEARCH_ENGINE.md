# NOX Context + Research Engine (M0–M4)

Status: implementation candidate, 2026-10-14. This contract supersedes the earlier "deferred retrieval" line in PRODUCT_DESIGN.md for local research. Live Obsidian testing is still required.

## Design thinking

**Empathize:** The learner should not select a graph algorithm, watch token counts, or manually summarize conversations to obtain a fast and grounded answer.

**Define:** Context quantity is not relevance. Long local/provider conversation state and entire vault notes cause token pressure, latency, missing evidence and hidden provider context growth.

**Ideate:** Preserve one runtime, one context authority, canonical session transcript, and explicit source permissions. Keep simple questions single-call; make vault indexing opt-in at query time; use provider-free lexical + link graph before adopting embeddings or a separate graph database.

**Prototype:** Normal Ask / Explain / Practice / Review / Edit use a bounded context envelope. Type \`/research <question>\` or search "research" in Actions to use an incremental local-vault index. A model synthesizes retrieved excerpts and cites vault sources; no web browsing is implied.

**Test:** Budget overflow, strict source constraints, adversarial note content, indexing revision/deletion, graph allowlist, provider streaming, usage provenance, process cancellation, and 200-turn sessions. Gate release on measured runtime performance and manual Obsidian smoking.

## Responsibility graph

\`\`\`text
ChatView → LearningController → RunLearningTurn
                                 ├── ContextResolver (single context authority)
                                 │     └── ObsidianContext → LocalResearchIndex
                                 ├── ContextBudget (pure bounded envelope)
                                 ├── SessionPort (canonical transcript, derived metrics)
                                 └── AgentRuntimePort
                                       ├── AGY CLI
                                       ├── Codex CLI
                                       └── ChatGPT Responses → Node HTTPS streaming
                                                             ↳ Obsidian requestUrl model catalog
\`\`\`

No new authoritative state store. Research index is in-memory, derived and revalidated by note mtime/size/link revisions on research requests. It indexes at most 600 recent Markdown files per query and at most 120KB/file. No background execution or external service. It favors correctness over pretending the graph represents factual entailment: wikilinks denote document links, not causation.

## M0: telemetry

Terminal assistant messages may include \`metrics\`: budget-estimated input/context/history tokens, number of shortened sources, retrieval count, compaction flag, first observed text delta time and elapsed time; actual input/output usage is recorded separately **only** when the provider reports it. Transcript persists these values through its schema sanitizer. No tokens are inferred to be account quota. The metric cannot prove provider-side hidden-context size or billing.

## M1: bounded context

\`prepareContextEnvelope\` accepts explicit notes, system notes, prompt and canonical local transcript. It applies a conservative UTF-8 byte heuristic, a fixed reserve, relevance-directed excerpt extraction, de-duplication, and a per-turn ceiling. Default estimated ceiling: 10k for ordinary turns, 14k for research. This is a **soft provider-agnostic estimate**, not a guarantee of actual token counts. Source-bound learning and note edits fail rather than silently shorten required source material. All authoritative note edits remain behind MutationService and the original context snapshot.

## M2: memory and runtime

Only the newest bounded transcript subset and a lossy, explicitly labelled older digest enter inference; full transcripts, rubric evaluations, and evidence continue to be persisted unmodified. The deterministic digest carries no mastery authority. CLI provider cursors are reset at periodic 24-message boundaries to reduce indefinite opaque accumulation; bounded conversation excerpts are carried on reset. ChatGPT model catalog uses a short in-memory TTL. Node HTTPS streaming enables progressive SSE consumption in Electron/Obsidian Node instead of buffered \`requestUrl\` for inference. Model discovery and OAuth remain on \`requestUrl\`. No automatic replay on uncertain inference failure. Desktop proxies may require configuration; test on Windows desktop.

## M3: local hybrid retrieval

\`LocalResearchIndex\` creates line-anchored text chunks at heading boundaries, ranks by lexical query relevance and adds adjacent wikilink evidence when useful. \`ObsidianContext.searchKnowledge\` reconciles note edits/deletions and uses \`MetadataCache.resolvedLinks\`. Source allowlists are enforced in retrieval *and* graph traversal. No vector embeddings or remote indexing are required.

## M4: graph-assisted research

The \`/research\` path decomposes a question deterministically into bounded subqueries and retrieves a maximum of eight evidence chunks plus local link edges. The model is instructed to distinguish observation/inference/conflict/gaps and cite the note paths. Edges express wiki-links only: they are not proof. This is **bounded, one-pass local research**, not recursive web research or full Microsoft GraphRAG. Expand to bounded follow-up searches only after retrieval benchmarks demonstrate a measured gain.

## Acceptance and limits

- No normal turn performs whole-vault indexing.
- Every provider receives a context envelope; history is not copied raw indefinitely.
- Fail closed for strict-source and edit budget overflow.
- No provider usage number is invented; estimated figures stay labelled.
- No research statement claims external verification.
- No new mutable persistence authority; canonical transcript and learning evidence remain unchanged.
- The new streaming transport must be tested on actual Obsidian desktop; CI cannot prove end-to-end delivery.
- Measure TTFT, TTFT-visible, P50/P95 duration, token estimates versus provider actual, answer grounding and evidence recall. Any performance improvement claim needs benchmark results.

## Rollout

1. Baseline and unit/integration CI; inspect metrics on representative vault.
2. Profile Node stream/proxy/TLS behavior on Windows Obsidian; verify cancel does not replay requests.
3. Test 200-turn sessions and verify no loss of program state or edit integrity.
4. Evaluate retrieval with labelled 20-query single-hop and multi-hop benchmark; tune source caps.
5. Only then expand to external research tools or semantic embeddings, preserving source permissions.

## Follow-up hardening (2026-10-14)

- Context digests now shrink against actual estimated token pressure, including multilingual UTF-8 text; optional memory cannot bypass the history budget.
- Local retrieval fingerprints unsaved Markdown editor buffers so a research rerun sees the current document even before Obsidian flushes it to disk.
- Chunk line anchors follow line breaks for long sections instead of repeating a section's first line. These are source pointers, not semantic citations.
- These changes require local `pnpm verify` and manual desktop tests before merge; connector-only editing does not imply verification.
