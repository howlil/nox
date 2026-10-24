## Release candidate verification

The release candidate is published from `release/x.y.z` **before** merging
the manifest version bump into `master`, so the default-branch version always
matches an already public GitHub Release.

- [ ] Development CI succeeded for the candidate source commit
- [ ] `release-certified` passed: Linux reproducibility, Windows provider tests and Community scanner
- [ ] `manifest.json`, `package.json`, `versions.json`, changelog and release plan match
- [ ] Artifact allowlist contains exactly `main.js`, `manifest.json`, `styles.css`
- [ ] Source SHA, signed attestations and remote SHA-256 asset digests match
- [ ] Release publication was explicitly dispatched for the exact candidate branch
- [ ] Public-release parity passed before merging version metadata

See [release documentation](../docs/RELEASE_CI.md). A green preflight does not
claim live-provider, native editor or Community Directory acceptance.
