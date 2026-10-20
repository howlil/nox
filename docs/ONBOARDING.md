# Onboarding

> **Development branch:** M1–M4 are implemented in [PR #121](https://github.com/howlil/nox/pull/121). Native desktop acceptance (M5) has **not** been completed. The current public release may differ.

## Choose your entry

| Entry | What happens |
| --- | --- |
| **Learn from a note** | Select the open Markdown note, then **Explain** or **Practice**. This does not create a learning program. |
| **Start with a goal** | Create a quick plan with `/plan`, or open guided setup to preview objectives and approve a plan. Workspace files are optional. |
| **Just chat** | Dismiss onboarding and use the composer without creating a plan. |

## Guided plan

```text
Goal → Preview objectives → Approve plan
                            ├─ Plan only
                            └─ Create workspace (optional)
         → Plan ready → Start first objective / Maybe later
```

The first objective is chosen by the adaptive learning decision, not array position. **Start first objective** runs `/focus` and then `/next` only after the saved focus is verified. No timer or inferred mastery starts automatically.

## Privacy and recovery

- A general goal never reads the active note for curriculum generation. Note-first actions pass the explicitly selected note and exclude ambient editor context.
- Note contents sent to AI can leave your device; a CLI's independent file/network permissions are **not** sandboxed by the onboarding UI.
- Approval stores a durable operation receipt **before** program commit. After a restart, Nox reconciles the receipt with the saved plan instead of rerunning AI or duplicating the plan.
- Approved workspace recovery creates only missing owned files; conflicts with existing unowned notes stop with an error.
- Interrupted/expired previews require a new preview. The ready screen stays available until the user starts or skips.

## Technical evidence

[M1 privacy](ONBOARDING_M1_PRIVACY_READINESS.md) · [M2 entry points](ONBOARDING_M2_ENTRY_POINTS.md) · [M3 first value](ONBOARDING_M3_FIRST_VALUE.md) · [M4 recovery](ONBOARDING_M4_RECOVERY.md)

[Get started](GETTING_STARTED.md) · [Providers & privacy](PROVIDERS.md) · [Troubleshooting](TROUBLESHOOTING.md)
