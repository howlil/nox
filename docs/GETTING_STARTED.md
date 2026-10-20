# Get started with Nox

Nox runs in **Obsidian desktop 1.13.0+**. Use a separate test vault when installing an unpublished build.

## 1. Install

- **Community Plugins:** If listed, open **Settings → Community plugins → Browse**, search **Nox**, then install and enable it.
- **Manual:** Download \`main.js\`, \`manifest.json\`, and \`styles.css\` from the same [GitHub release](https://github.com/howlil/nox/releases). Put them in \`<vault>/.obsidian/plugins/nox/\`, then enable Nox. Do not install the GitHub source ZIP.

## 2. Connect AI

In **Settings → Nox**, select an authenticated **AGY CLI**, **Codex CLI**, or eligible **ChatGPT plan**. Nox does not provide AI credits; provider permissions and charges are separate. [Setup details →](PROVIDERS.md)

## 3. Learn something

Open a Markdown note and launch Nox from the ribbon or command palette. On first-run onboarding, choose:

| Start with | Result |
| --- | --- |
| **Learn from a note** | Choose **Explain** or **Practice** with that note's context. |
| **Start with a goal** | Enter a goal and create a quick learning plan, or choose guided setup to review the curriculum before approving optional workspace files. |
| **Just chat** | Open the normal chat composer without creating a plan. |

You can also select text and ask Nox to explain it. Note-first Practice is separate from tracked program mastery.

## 4. Continue a learning plan

\`\`\`text
/plan Learn networking fundamentals | minutes=30 | sessions=3
/progress
/focus <objective-id>
/next
\`\`\`

Use an objective ID shown by \`/progress\`. After a guided plan is approved, **Start first objective** selects the adaptive next activity; **Maybe later** returns to chat. Focus is self-paced—no timer is required.

**Need help?** See [Troubleshooting](TROUBLESHOOTING.md) or [Learning commands](LEARNING_ORCHESTRATOR.md). Real Obsidian/provider behavior requires desktop testing; CI does not prove account eligibility.
