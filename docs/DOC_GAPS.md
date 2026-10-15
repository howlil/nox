# Documentation gap audit

Evidence basis: repository files on the Community Release Readiness branch as reviewed 2026-10-15; status labels describe documentation coverage, not runtime verification.

| Topic | Before audit | This PR | Further evidence needed |
| --- | --- | --- | --- |
| Product positioning | Technically detailed README with limited first-use guidance | Getting-started tutorial + docs index | Screenshots of live Obsidian UI |
| Installation | Dev deploy steps buried in README | Public manual/Community install instructions | Fresh-install Windows acceptance |
| Provider requirements | AGY, Codex, ChatGPT scattered through README | Provider comparison + privacy scope | Real provider account tests |
| Authentication troubleshooting | Detailed but mixed with architecture | Symptom-based troubleshooting | Live OAuth network/proxy coverage |
| Release management | Manual tag workflow only | Release PR → auto tag/build/publish | First live workflow execution |
| Version consistency | Manifest/package verification | Release plan & changelog gate | Tag-to-release download check |
| Public security reporting | Missing public policy | Security report policy | Enable private reporting in GitHub settings |
| Contribution guide | Missing | Contribution contract | Maintainer review/branch protection |
| Knowledge-base learning commands | In engineering contracts | Linked technical reference | User-facing command table with real screenshots |
| Open-source license | MIT proposed in PR | LICENSE present for review | Owner signoff and third-party attribution audit |

## Remaining high-value docs work

1. Record **actual Windows screenshots/video** showing setup, selected-note context, a practice question, and edit approval. Do not substitute mockups for product evidence.
2. Add a short compatibility matrix (Obsidian versions × OS × provider); only mark a cell verified after manual tests.
3. Publish a clearly versioned command/settings reference derived from the released UI, including errors and disabled states.
4. Audit third-party component licensing and any externally loaded assets before the first Community submission.
5. Document data retention/deletion and precise local file locations by provider and OS after runtime validation.
6. Test a migration from historical `nox-obsidian` session data to `nox`, including rollback.
7. Create concise real-user examples beyond engineering goals (e.g., learning languages, mathematics, or exam revision) after verifying behavior.

Use [Diátaxis](https://diataxis.fr/) as a tool for reader intent, not as a reason to create empty folders. Maintain one source of truth for technical boundaries in [AGENTS.md](../AGENTS.md) and its linked canonical design documents.
