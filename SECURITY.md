# Security policy

Nox interacts with local Markdown notes, external AI providers, executable CLIs, and optional ChatGPT OAuth credentials. Security reports should not expose user data.

## Report privately

Use GitHub's **Report a vulnerability** option at [Security advisories](https://github.com/howlil/nox/security/advisories/new) when private vulnerability reporting is enabled. If the option is unavailable, open a minimal non-sensitive issue asking for a secure reporting channel; **do not include exploit details, tokens, note contents, private credentials, or OAuth callback URLs** in a public issue.

Include affected release/version, operating system, a safe minimal reproduction, expected/actual behavior, and likely impact. Do not attach your real vault.

## Coverage

The currently maintained public release line receives security fixes on a best-effort basis; older builds are not promised support. Desktop only. Privately disclose credential storage weaknesses, prompt-injection paths leading to unintended local edits, dangerous external command execution, and unauthorized file/network access.

Nox does not guarantee third-party provider security or availability. Review provider permissions before connecting an account. If credentials may be compromised, revoke or disconnect them with the provider and Nox settings.
