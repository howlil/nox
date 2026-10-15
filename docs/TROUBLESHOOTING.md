# Troubleshooting Nox

## Plugin cannot enable

On desktop, verify that `.obsidian/plugins/nox/` (or your custom configuration directory) contains `main.js`, `manifest.json`, and `styles.css` from a matching GitHub Release. The GitHub source ZIP is not installable. Mobile is unsupported.

**Old development ID:** Nox previously used `nox-obsidian`. Back up the original plugin data, close Obsidian, copy the old `data.json` into the new `nox` plugin folder **before enabling** the new ID. Preserve the old directory as backup; do not enable both.

## Sidebar is missing or stale

Use the command palette to open the Nox sidebar. Inspect **Settings → Nox → Loaded plugin build**. A manifest version alone cannot prove which JavaScript bundle is loaded. Development deployments must target the same vault and be followed by a full reload.

## AGY/Codex not available

Run and authenticate the CLI outside Obsidian. Configure its absolute executable path if PATH resolution fails. Restart Obsidian after updating environment variables. A model appearing in a list does not establish account eligibility.

## ChatGPT sign-in fails

In Nox settings review the **Last ChatGPT sign-in error** and use **Copy diagnostic**. Never share OAuth authorization codes, callback URLs, credential files, or access tokens. Windows DPAPI, network proxy and TLS settings can affect authentication. Retry authorization codes with a **fresh sign-in**; each code is single-use.

## Streaming stops

Check the loaded runtime revision and transport marker, then test a short prompt. Nox uses desktop Node HTTPS SSE; network proxy or TLS mismatches can stop streaming. Failed inference requests are **not retried automatically** to prevent duplicate processing.

## Program state or JSON cannot load

Back up the affected vault files and plugin data before any manual repair. Do not delete malformed program files simply to clear an error. Capture steps to reproduce and redacted diagnostics.

## Ask for help

Open [Nox GitHub Issues](https://github.com/howlil/nox/issues) with OS, Obsidian version, Nox build revision, runtime, steps, expected and actual results. Report vulnerabilities **privately** using the [security policy](../SECURITY.md).
