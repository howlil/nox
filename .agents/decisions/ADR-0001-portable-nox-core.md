# ADR-0001 — Portable NOX Core behind host-neutral contracts

**Status:** proposed (not accepted)
**Date:** 2026-10-24

## Context

NOX 1.3.2 runs as an Obsidian plugin. Its pure learning rules and some
application/context ports already exist, but session persistence depends on
Obsidian plugin-data operations; program/evidence stores depend on Vault;
editor mutations depend on Obsidian native editing; provider authentication
and CLI transports rely on Node/desktop capabilities. A future NOX host
must reuse the same learning behavior and safety rules without copying logic.

## Alternatives

1. **Fork the product per platform.** Minimal immediate effort, but diverges
   evidence/authorization logic and multiplies persistence migrations.
2. **Make Obsidian a remote API server.** Easy reuse of one running instance,
   but makes Obsidian and always-on connectivity authoritative for other hosts.
3. **Extract a host-neutral modular-monolith core (chosen proposal).**
   The core owns learning/transaction semantics; each host wires purposeful
   source, state, edit and provider adapters. A headless second host proves
   the seam before extracting npm packages.

## Proposed decision

Choose option 3. Keep one local authoritative workspace runtime per host.
The shared core must be executable without Obsidian, Electron, Node-only
modules, and DOM. Host-specific adapters supply authorized material reads,
atomic durable stores, provider transports, editor actions and lifecycle.
Different hosts may advertise different capabilities; unsupported actions
must not weaken approval or trust boundaries.

Preserve the existing commit and conflict semantics. First move only the
concrete dependency edges that block second-host execution; avoid replacing
`RunLearningTurn`, the program mutation queue or stored file formats.

## Consequences

- Easier to reuse learning-domain decisions in headless, desktop, web or
  editor integrations and test the same engine with substituted adapters.
- Port/host adapter ownership, bundle boundaries and conformance tests
  become permanent maintenance obligations.
- Browser/remote hosts cannot reuse Node CLI/OAuth transports directly.
- Obsidian native Undo cannot be simulated by a generic file write. Editing
  remains unavailable or copy-only on hosts without an equivalent guarantee.
- Existing stored vault/source paths require a compatibility codec before
  material identity can be made host-neutral.
- Cloud sync, server multi-tenancy, platform UI component reuse and monorepo
  packaging are not implied by this decision.

## Evidence required before acceptance

At least one real non-Obsidian host executes the same core turn + evidence
logic, with passing serialization/CAS, cancellation, authorized context and
legacy-schema tests; existing Obsidian CI and native behavior must remain
intact. Proposal review can precede the implementation proof.
