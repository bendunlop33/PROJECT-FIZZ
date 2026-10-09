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
