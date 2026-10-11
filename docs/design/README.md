# Design

**Name:** the app is called **GymSmarter** (approved 9 Oct 2026). "Fizz" in older specs means GymSmarter.

Written by the `designer` agent. Last consolidated 8 Oct 2026. Added 9 Oct 2026: `check-in.md` (brief v0.9), with revision notes in the specs it touches.

- **Tokens and components:** `design-system.md` is the only source. If a screen needs a value that isn't there, add it there first. Old component names still used in some specs are listed as aliases in design-system §11.
- **Open questions for Ben and gaps for the developer:** `open-decisions.md` (one deduplicated list).
- **Every other file** covers one screen, flow or area. Each spec has Purpose, Layout, States, Interactions, Copy, Data needed and Acceptance checks. Revision notes at the top of a file say what changed and why.

## Your data and Coaching knowledge

Everything Fizz stores belongs to one of two domains (approved by Ben, 8 Oct 2026). Specs, backups, exports, deletes and the coach's "What the coach can see" view always use these two names.

| Domain | What's in it | Where Ben manages it |
|---|---|---|
| **Your data** (about Ben, owner-scoped) | Profile, goals and week; workout history; pre-workout check-ins; coach memories; pain flags; gyms and equipment; routines and plans; conversations; settings; his guide files | Profile, Plan, Progress; Data & backup → backup, restore, `Export: My data`, `Delete my data (keep coaching knowledge)` |
| **Coaching knowledge** (general, nothing about Ben) | Approved playbook rules with evidence and sources; research candidate rules; the guide library's index and excerpt metadata; the exercise catalogue and aliases; default presets | Guides & playbook; Data & backup → backup, restore, `Export: Coaching knowledge only`, `Reset coaching knowledge` |

Credentials (ChatGPT sign-in, API keys) are in the Keychain, in neither domain, and never in a backup or export. A general training rule said in chat goes to the playbook as a candidate, never into memory (coach-memory.md CM9). Backups hold both domains in two sections that restore independently (data-import-export.md DX11).

**Backups** are kept in the app by default (automatic, after each workout). A copy off the phone is optional: `Save a copy to Files` any time, or turn on automatic off-phone backups. Fizz uses exactly three phrases so Ben always knows where his data is: `Saved on this phone`, `Backed up on this phone`, `Copy saved to Files` (design-system §7.1).

## Index

### Foundations

| File | Purpose |
|---|---|
| `design-system.md` | Colour, type, spacing, touch targets, motion and timing tokens; status vocabularies; data-domain labels; every shared component with one canonical name |
| `open-decisions.md` | Every decision still waiting for Ben (preference, bulk-approve defaults, device tests) and the schema/domain gaps the developer needs |
| `system-states.md` | App-wide states and wording: offline, coach availability, durability, permissions, signing expiry, builds, data integrity, blocking covers; banner priority; the App status screen; app icon and launch screen |

### The logging loop (first milestone)

| File | Purpose |
|---|---|
| `flow-first-milestone.md` | End-to-end state machine (Today → set → rest → summary), persistence and force-close recovery, how optional layers attach, brief proposals P1–P12, dependency status (`DEP-*`) |
| `today.md` | Today tab: what to train now and where; Start or Resume as the single primary |
| `check-in.md` | Pre-workout check-in on Start (1–5, Skip): "What's up?" reasons, pain-flag and feeling-ill steps, the coach's lighter-session offer, how check-ins are shown, settings, voice (added 9 Oct; replaces the Today readiness chips) |
| `active-workout.md` | Focused set card and Overview table: one-tap Log, keypad, supersets, timed and unilateral sets, pain flag note, finish sheet |
| `gym-switch.md` | Mid-workout gym switch (card, Undo, switch back) and `snapPlanToGym`, the one function that fits any plan to a gym's equipment: routine Start, Repeat, the switch and `[Use changes today]` (added 9 Oct; closes review B1 by design) |
| `rest-state.md` | Rest timer inside the workout: presets, adjust/skip, background behaviour, spoken cue modes and scripts |
| `workout-summary.md` | Post-workout facts, comparisons, `Next time` targets (coach or built-in rule), backup line |
| `lock-screen-and-alerts.md` | Lock-screen Live Activity, rest-end notifications, loud alerts (AlarmKit), speak-while-locked experiment, alert arbitration and Test rest alert |

### Setup and settings

| File | Purpose |
|---|---|
| `onboarding.md` | First run: units and rest presets, first gym from a preset, a short "how your data is kept" explainer, optional training profile and coach; restore from a backup on Welcome; in-context permissions |
| `profile-and-settings.md` | The Profile hub: goals, logging, rest presets, gyms, Voice & alerts layout, coach rows, Data & backup row, appearance, App status and About this build |
| `gym-editor.md` | Gyms and equipment that targets must fit: plates, dumbbell racks, stacks, assisted and plate-loaded machines; travel gyms; mid-workout gym switch |

### Plan and library

| File | Purpose |
|---|---|
| `routines.md` | Plan hub `Routines` segment: list, detail, editor, duplicate, repeat last workout, start |
| `weekly-plan.md` | Plan hub `Week` segment: weekly pattern, move/skip/replace, missed sessions, endurance entries, approved trade-off warnings, programme blocks |
| `exercise-library.md` | One exercise picker in four modes (pick one, pick several, swap, browse), custom exercises, history shortcut, substitutions |
| `workout-builder.md` | Coach-built workouts: Build sheet, generating and offline states, checked review with versions, Start now / Save as routine; programmes later |

### Coach

| File | Purpose |
|---|---|
| `coach-adjustments.md` | Coach-led progression (ADR 0006): Ben-asked and trigger-offered changes to today's sets, guardrails, Undo, coach vs built-in `Next time` |
| `coach-sheet.md` | The conversation sheet: entry points, workout bar, context view grouped by data domain, action cards, history and retention, `Why?` evidence |
| `coach-memory.md` | What the coach may assume about Ben (personal facts only) and pain flags: memory list, editor, suggestions, pain set/clear |
| `coaching-playbook.md` | Approved rules, research candidates, Ben's guides, conflicts, guardrails and citations |
| `ai-connection.md` | ChatGPT-plan sign-in, optional OpenAI API key, model choice, spend caps and usage estimates, coach reply voice |
| `voice.md` | Tap-to-talk, deterministic spoken set logging and commands, clarifications, spoken replies, audio routes |
| `change-review.md` | The one way any broad change is shown, scoped, applied, undone, expired or rejected as out of date |

### Progress and data

| File | Purpose |
|---|---|
| `progress.md` | Progress tab (v1.0, 11 Oct): sessions and time in gym over 7/14/30/60 days, muscle frequency (body parts or push/pull/legs), records, calendar; exercise detail with Est. 1RM, top set, volume, rep table and records. Two build slices. Mockup: `mockups/progress.html` |
| `data-import-export.md` | Data & backup: automatic backups on this phone, optional copies to Files, check, restore by domain, FitNotes import, export (`My data` / `Coaching knowledge only`), `Delete my data` / `Reset coaching knowledge` |

## How specs relate

```
                      design-system.md  (tokens, components, statuses, data domains)
                              │ used by every spec
     ┌────────────────────────┼─────────────────────────────────────────────┐
     │                        │                                             │
  LOGGING LOOP            COACH (optional layer; never blocks logging)   SET-UP & DATA
  flow-first-milestone ◄── coach-adjustments ── change-review            onboarding
    today ── check-in ───► coach-adjustments, coach-memory               profile-and-settings (hub)
                           coach-sheet ── coach-memory
    active-workout ◄────── voice            coaching-playbook               ├ gym-editor
    rest-state ◄────────── lock-screen-and-alerts                           ├ ai-connection
    workout-summary        ai-connection (connection, keys, voice out)      ├ coach-memory, coaching-playbook
                                                                             ├ data-import-export
  PLAN & LIBRARY           PROGRESS                                          └ system-states (App status)
  routines ─ weekly-plan   progress ◄── workout-summary (past workouts)
  exercise-library         
  workout-builder ──► change-review / routines

  system-states: wording and priority of every app-wide state shown by any screen
  open-decisions: what Ben still has to decide, and what the developer still needs
```

Single owners of shared things (other specs link here rather than redefine):

| Thing | Owner |
|---|---|
| Coach adjustments to today's sets, `Next time` sources | coach-adjustments.md |
| Any reviewable plan or template change (scopes, stale, undo) | change-review.md |
| Pain flags list, set and clear; `setPainFlag` signature | coach-memory.md |
| API keys, caps, usage, coach reply voice | ai-connection.md |
| Voice strip states and spoken set logging | voice.md |
| Cue modes and cue scripts | rest-state.md §5 |
| Rest-alert layers, Alert check, Test rest alert | lock-screen-and-alerts.md |
| Backup status (`getBackupStatus`), restore, import, export, delete/reset | data-import-export.md |
| Banner priority, durability wording, App status | system-states.md |
| Equipment and achievable-load editing | gym-editor.md |
| Fitting a plan to a gym (start, Repeat, mid-workout switch); `snapPlanToGym` | gym-switch.md |
| Exercise picker and substitutions | exercise-library.md |
| Pre-workout check-in: when it's asked, its record, settings, offer conditions, spoken grammar | check-in.md |

## Research dependencies

Optional layers depend on device tests. Search the specs for `DEP-AUDIO`, `DEP-NOTIF`, `DEP-LIVE`, `DEP-STT`, `DEP-AI`, `DEP-ALARM`, `DEP-FILES` and `DEP-UPDATE-FEED`. Their status after device probe build 7 is in flow-first-milestone.md §2 and open-decisions.md.
