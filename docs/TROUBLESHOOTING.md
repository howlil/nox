# Troubleshooting

| Problem | Check |
| --- | --- |
| **Plugin won't enable** | Use Obsidian desktop 1.13.0+. Install matching `main.js`, `manifest.json`, `styles.css` in `.obsidian/plugins/nox/` (or your custom config directory), **not** the source ZIP. |
| **Old Nox data missing** | The former development ID was `nox-obsidian`. Back up both folders, close Obsidian, migrate `data.json` into `nox` **before** enabling it. Never enable both IDs. |
| **Sidebar missing / stale** | Open Nox from the command palette. Run **Nox: Copy runtime diagnostics** to compare the in-memory revision and transport marker with the installed `main.js` SHA-256. Verify the vault path before reloading Obsidian. |
| **AGY/Codex unavailable** | Authenticate the CLI in a terminal, verify its executable path, and restart Obsidian after PATH changes. |
| **ChatGPT sign-in fails** | Check **Last ChatGPT sign-in error** in Nox settings. Retry with a fresh sign-in; OAuth codes are single-use. Verify proxy/TLS and Windows DPAPI permissions. |
| **Streaming stops** | Try a short prompt; check runtime diagnostics and proxy/TLS. Nox does not automatically replay failed inference. |
| **Learning data cannot load** | Back up vault/plugin data first. Do not delete malformed JSON to bypass a read error. |
| **Background learning activity could not save** | Check vault storage and write permissions. Nox reports a background error once per affected operation until a write succeeds; timed checkpoints and rename updates retry on subsequent ticks while the plugin is running. Rename retries are in-memory only and are not guaranteed after closing Obsidian. Use session recovery if necessary; do not assume unobserved downtime was counted. |
| **Workspace recovery fails** | Use **Resume recovery** and inspect conflicts with existing notes. Nox does not overwrite unowned files. |

When asking for help, share your OS, Obsidian version, Nox build revision, provider, reproduction steps, and redacted error—not tokens, private notes, or OAuth callback URLs.

[Open an issue](https://github.com/howlil/nox/issues) · [Report a vulnerability privately](../SECURITY.md) · [Providers & privacy](PROVIDERS.md)
