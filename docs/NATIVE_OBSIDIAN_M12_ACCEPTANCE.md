# M12.2 — Native Obsidian Desktop Acceptance

**Status:** native desktop execution pending. CI tests the runner itself, not the Obsidian desktop executable. Never mark the native milestone complete from GitHub Actions alone.

## Boundary and requirements

M12.1 executes `dist/main.js` against simulated Obsidian APIs. M12.2 instead runs the **real installed Obsidian desktop** and talks to it through the official Obsidian CLI. This is an opt-in, destructive **scratch-vault only** test: it copies a built plugin, disables restricted mode for the scratch vault, creates a test Markdown note and an extra NOX chat session, restarts Obsidian, then disables the plugin.

Official Obsidian CLI documentation: https://obsidian.md/help/cli

Requirements:
- Obsidian desktop with a **1.12.7+ installer** and CLI enabled in **Settings → General → Command line interface**.
- `obsidian` available in the local terminal (`Obsidian.com` on Windows).
- A separately created, expendable local Obsidian vault. **Never use your real vault.**
- The vault must be open in Obsidian and its name must uniquely resolve via the CLI.
- Node.js/pnpm and a verified NOX production build from the repository.
- The test will **restart the desktop application**. Save other open work first.

## Run on Windows / PowerShell

First create and open a disposable vault named `Nox-M12-Scratch` in Obsidian. In PowerShell, from the repository:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test:artifacts

$vault = "C:\temp\Nox-M12-Scratch" # change to the actual full path
New-Item -ItemType Directory -Force -Path (Join-Path $vault ".obsidian") | Out-Null
Set-Content -NoNewline -Path (Join-Path $vault ".obsidian\nox-m12-scratch-marker.txt") -Value "NOX_M12_DESTRUCTIVE_SCRATCH_VAULT_ONLY"

obsidian 'vault=Nox-M12-Scratch' version
node scripts/acceptance/obsidian-native.mjs "--vault-dir=$vault" "--vault-name=Nox-M12-Scratch"
```

If the vault has a different name, change `--vault-name`. If the CLI binary is not on PATH, use `--cli=<absolute CLI executable path>`. The marker is a deliberately explicit safeguard. The runner additionally checks Obsidian's own reported vault path **before** installing files, toggling restricted mode or enabling NOX.

The runner refuses to overwrite a NOX installation it did not create. Reuse only the same disposable vault for another attempt, or create a fresh scratch vault. The test is not meant to preserve the scratch vault after acceptance.

## Observable native assertions

| ID | Actual desktop observation |
|---|---|
| N01 | CLI is connected to the expected local scratch vault |
| N02 | Built `main.js`, `manifest.json` and `styles.css` are installed and the JavaScript checksum matches |
| N03 | NOX plugin boots with a 40-character source commit SHA and expected HTTP transport |
| N04 | `nox:open-sidebar` opens a real `.nox-root` DOM panel |
| N05 | CLI writes and reads a disposable Markdown note from the actual vault |
| N06 | Screenshot of the real sidebar is captured in the scratch vault |
| N07 | Native `LearningController.newSession()` creates a distinct session ID |
| N08 | Official `obsidian restart` replaces the renderer; the plugin restores the new session ID and the original build identity |
| N09 | Markdown scratch note survives the restart |
| N10 | `plugin:disable id=nox` unregisters the NOX plugin |

The runtime probe records only derived metadata: an anonymized vault **name**, source SHA, JavaScript bundle SHA-256, Obsidian version, check IDs, verdict, and a local screenshot path. The local screenshot could still contain user-visible material; capture **only a disposable vault** and review before sharing. No credentials, chat messages, Markdown contents or full vault paths are recorded in JSON evidence. The script **does not upload any evidence**.

Evidence is written to the scratch vault's `.obsidian/nox-m12-native-evidence.json`. A run is PASS only if all native assertions complete; otherwise it is FAIL. Do not use the offline check as evidence of native acceptance:

```bash
pnpm test:native-runner
```

That last command is what GitHub CI runs, alongside regular build and integration tests. It validates runner syntax and fail-closed assertions **without starting desktop Obsidian**.

## Certification limits

This native script verifies the installed-plugin boundary, renderability of the sidebar root, vault I/O, session durability over a real desktop restart and plugin disable. It does **not** exercise actual provider network access, visual correctness of the screenshot, screen reader compatibility, complete UI interactions, multiple displays or production migration of a user's existing vault. A screenshot requires human review for layout, clipping and accessibility. Therefore passing this automated script is **one native desktop acceptance slice**, not the entire release qualification.

Keep `@nox/core` private until host, source compatibility, packaging and public API compatibility are approved separately. Never merge or publish solely because an offline harness check reports success.
