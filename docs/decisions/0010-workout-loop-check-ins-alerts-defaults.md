# 0010: Workout loop: check-in storage, rest alerts, starter exercises, built-in default rule

**Status:** Proposed, 2026-10-09 (developer, overnight slice 2; for review). Items marked *provisional* need Ben.

## Context
Slice 2 builds Today → check-in → Active set → Rest → Summary on the foundation (ADR 0009). It needed storage for check-ins and pain flags, a way to keep exactly one rest-end notification in step with the workout, exercises to pick from before the catalogue package is wired, and a progression rule for exercises that have none.

## Decision

### Schema 2 (migration `0002-check-ins`)
- `check_ins` and `pain_flags` are document tables (Your data, owner-scoped), validated like the others and covered by integrity checks and backups (backups copy every table, so no format change).
- `sessions.check_in` (JSON `SessionCheckIn`) and `sessions.check_in_id`, with a partial unique index: a check-in is linked to at most one workout, **in the same transaction as the session**. The link therefore lives only on the session; `CheckIn.outcome` records only `not_started`, `skipped_workout` or `rescheduled` (check-in.md §6 had `started` and `CheckIn.link`; both are derived instead, so there is one source of truth).
- Older sessions read `checkIn: null`. A schema-1 backup restores at version 1 and migrates forward (tested).

### Check-in rules
- `shouldAskCheckIn`, `asksReasons`, `evaluateCheckInOffer`, check-in patching (versioned, history, idempotent per opId) and pain status are pure in `packages/domain`. Settings use the check-in.md defaults until the settings screen exists.
- `Pain` with movements sets pain flags (`source: 'check_in'`) that halt `calculateNextTargets` for those exercises. `Pain` with no movement sets no flag; the summary shows the `You mentioned pain…` line. With no coach in this build, "pain unspecified" has nothing else to block (CI8).
- The coach is never reachable in this build, so no check-in offer and no "not connected" line appear (CI7).

### Rest-end alerts
- `planRestAlert` (pure) derives the single notification that should be pending from committed state, keyed by timer ID + version + active set + session version. `decideAlertActions` cancels or replaces by a fixed identifier per workout (`fizz.rest.<sessionId>`), so Skip, early Log, ±30 s, Undo, Pause/Resume, Finish, Discard, a passed deadline and a relaunch all end with one alert or none.
- The controller runs after every committed command and after launch recovery, never awaited by the write, and never throws into logging. In the foreground, rest alerts show no banner; the app's own cue (one haptic, dropped if > 5 s late) is the alert, and the expiry is persisted with a `tick`.
- Permission is asked in context at the first rest (rest-state.md §3), never at launch. Level `active`; no Time Sensitive (ADR 0004). Default sound: `rest-end.caf` doesn't exist yet.

### Starter exercises (*provisional*)
- 29 reps-based exercises seeded at launch into the shared `exercises` table (Coaching knowledge, no owner), only missing IDs added. IDs are `deriveId('catalogue:<key>')` with catalogue-style keys, so wiring `packages/catalogue` later keeps every ID and its history. Timed exercises are left out until the work-timer UI exists.

### Built-in default rule (*provisional, Ben to confirm*)
- Exercises with no progression rule (every exercise added to an empty workout) use **double progression, 8–12 reps, up to RPE 9, over the working sets done that session**, increment 2.5 kg / 5 lb rounded to the equipment, reduce 10 % after 2 missed sessions. The brief names double progression but no default range. Summary rows are tagged `Built-in rule (coach not connected)`.

### Dependencies
- `expo-haptics` 57.0.3 (SDK 57 bundled). Native module: needs a new cloud build; no entitlement (prebuild entitlement check passes).

## Consequences
- A new cloud build is needed (expo-haptics, plus react-native-screens/expo-symbols from ADR 0008).
- Device checks still needed: formSheet check-in sheet and swipe-down, rest notification at the deadline while locked and force-closed, no banner while in the app, haptics, the number pad's Done bar, ActionSheet menus.
- Not built: Overview (`All`) table, custom keypad, timed exercises, rest preset editor, check-in settings, delete/undo of check-ins, `Choose movements` from the summary, routines and the weekly plan (so no planned card or Reschedule), Live Activity.

## Amendment 1 (2026-10-09, slice 3): one exercise ID scheme (review workout-loop B2, SP5)

- The "Starter exercises" section above said IDs were `deriveId('catalogue:<key>')`. That differed from ADR 0011's catalogue IDs, so wiring the catalogue would have split every exercise's history and pain flags. **Superseded:** there is one scheme for catalogue exercises, ADR 0011's `Exercise.id = UUIDv5(key, FIZZ_CATALOGUE_NAMESPACE)` (`catalogueExerciseId`). Its implementation moved to `@fizz/domain` (`catalogue-id.ts`); `@fizz/catalogue` re-exports it, so the app and the catalogue can't drift.
- Starter keys now follow the catalogue's (`barbell-bent-over-row`, `dumbbell-seated-shoulder-press`, `machine-seated-leg-curl`, `machine-assisted-pull-up`, `machine-assisted-dip`, `dumbbell-incline-bench-press`), and starters carry `catalogueKey`, `mechanic` and `family`. A test checks that every starter the catalogue has is the same exercise there (ID, name, laterality, equipment, convention, mechanic, family, pattern).
- No migration: nothing real was logged on the earlier build. At launch, pre-amendment starter rows that no workout or pain flag refers to are removed so nothing shows twice; referenced ones are kept as history.

## Amendment 2 (2026-10-09, slice 3): built-in default rule by exercise category (*provisional, Ben to confirm*)

Replaces the single "8–12 reps, RPE 9" default above, which would have cut the load on Ben's 5-rep barbell work (review SP1, critic T2).

| Category (`ruleCategory`) | Which exercises | Built-in rule |
|---|---|---|
| `main_barbell` | Done on a barbell (or `total` load with a barbell-compatible exercise) and a main strength lift: family `squat`, `front_squat`, `bench_press`, `deadlift`, `overhead_press`, `row`; with no family, the squat, horizontal/vertical push or horizontal pull pattern | Double progression, 3–6 reps, progress only at RPE ≤ 8.5, rep cap 8 at a ceiling |
| `compound` | Every other compound (Romanian deadlift, hip thrust, dumbbell presses, pulldowns, leg press, split squats, pull-ups…) | Double progression, 6–10 reps, RPE ≤ 9, cap 12 |
| `isolation` | `mechanic: isolation`, or a single-joint pattern when the mechanic is unknown; also any exercise with no catalogue info | Double progression, 8–12 reps, RPE ≤ 9, cap 15 |

- All: increment 2.5 kg / 5 lb rounded to the equipment, 10 % reduction after 2 missed sessions, working sets = the sets actually done. The rule's name says it's built-in, which category, and *provisional* (e.g. `Double progression, 3–6 reps up to RPE 8.5 (built-in default for a main barbell lift, provisional)`). The PM brief named "other compounds 6–10" without an RPE; RPE 9 (the old default) is assumed.
- **Next time is the next plan** (review S3, PM decision): `nextTargetsFor` (domain) is the one function behind the Summary's `Next time` and the sets planned when that exercise is next added (`Target (built-in rule) …`, `PlannedSet.source = 'built_in_rule'`). It is recomputed from history rather than stored, so a later correction (brief scenario 5) changes the next plan too and nothing goes stale. This differs from "store a per-exercise next target" in the PM note; the result is the same targets with no stale copies.
- **Pain with no movement chosen** (review SP3, PM decision): holds every exercise's targets for that workout (its Summary and anything added during it), and so the next plan that Summary produced. A flagged movement still holds only that movement, until Ben clears it.

## Amendment 3 (2026-10-20): gym items for kettlebells, EZ / trap bar, Smith machine, benches and racks

The exercise-only kinds `kettlebell`, `ez_bar` and `trap_bar` (`EquipmentKindSchema`) are now also gym items, with a new `smith_machine` kind and presence-only `bench` and `rack`. Their loads are snapped and capped like any other item. See ADR 0030.
