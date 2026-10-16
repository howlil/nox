## Release candidate acceptance

**Merging this PR creates an attested DRAFT only, never a public release.**
The final publish step is a separate manual workflow requiring the exact merged SHA and desktop acceptance.

- [ ] Dev CI passed for the PR
- [ ] Release CI ran against the candidate SHA: policy, artifacts and Windows DPAPI passed
- [ ] Official scanner findings reviewed (advisory warnings must not be called clean)
- [ ] Version, manifest, compatibility mapping and changelog agree
- [ ] Reviewed code diff and approved creation of the draft

### After merging (before publication)

- [ ] Draft contains three attested assets built on the merged master SHA
- [ ] Installed those exact artifacts in an isolated Obsidian 1.13+ desktop vault
- [ ] Verified core learning, settings tabs, keyboard, sign-in, streaming, reload and popout
- [ ] Verified migration from the supported previous version without data loss
- [ ] Recorded operating system, tested version, SHA and acceptance outcomes
- [ ] Manually dispatched publish-release.yml against the exact merged master SHA

See docs/RELEASE_CI.md. Never publish from the candidate PR's pre-merge SHA.
