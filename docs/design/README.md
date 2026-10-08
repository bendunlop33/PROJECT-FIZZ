# Design

Written by the `designer` agent. `design-system.md` holds the design tokens. Every other file covers one screen or flow.

First milestone screens (brief §12): Today, Active set, Rest, Summary.

| File | Covers |
|---|---|
| `design-system.md` | Tokens (colour, type, spacing, targets, motion), status styles, core components |
| `flow-first-milestone.md` | End-to-end state machine, force-close recovery, optional voice/coach/lock-screen layers, brief change proposals P1–P12 |
| `today.md` | Today tab |
| `active-workout.md` | Focused set card, Overview table, supersets, timed sets, finish sheet |
| `rest-state.md` | Rest timer, preset resolution, background behaviour, spoken cue modes |
| `workout-summary.md` | Post-workout summary |
| `coach-adjustments.md` | Coach-led progression (ADR 0006): Ben-asked and trigger-offered adjustments to today's sets, guardrail outcomes, Undo, and coach vs built-in rule `Next time` targets. Single spec; the screen files link to it |
| `workout-builder.md` | Coach-built workouts (CHANGELOG v0.5): entry points, Build sheet, generating/offline states, review screen with checks, versions and diff, Start now / Save as routine / Edit / Ask for changes; programmes (later, step 6) |

Optional layers depend on research that is still open. Search the docs for `DEP-AUDIO`, `DEP-NOTIF`, `DEP-LIVE`, `DEP-STT` and `DEP-AI`.
