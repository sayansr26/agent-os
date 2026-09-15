## What this changes

<!-- And why. The what is in the diff; the why is not. -->

## Context cost

<!--
Agent descriptions load on every turn in every project; agent bodies do not.
Skill bodies load whole on invoke; references load only when a finding calls
for them.

Say which of those this touches and by roughly how many bytes. "No change" is
a perfectly good answer.
-->

## Checks

- [ ] `node scripts/validate-plugin.mjs` passes
- [ ] `claude plugin validate ./plugins/agent-os --strict` passes
- [ ] Loaded with `--plugin-dir` and exercised the change
- [ ] Any new agent has `memory: project` and a description that says when to use it
- [ ] Version bumped in **both** manifests, with a `CHANGELOG.md` entry (if releasing)

## Anything you could not verify

<!--
An honest "I could not test the Windows path" is more useful than silence —
it is rule 6 in the README and it applies to contributors too.
-->
