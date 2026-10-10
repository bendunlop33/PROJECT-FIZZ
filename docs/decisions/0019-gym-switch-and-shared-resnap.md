# 0019: Gym switch and the shared re-snap (`snapPlanToGym`)

**Status:** Proposed, 2026-10-10 (developer; for review). Built and tested on Linux only (domain, SQLite on Node, app services with the fake expo-sqlite). **Not yet run on an iPhone.**

## Context
Ben approved competitor follow-up 6 (CHANGELOG 2026-10-09): a mid-workout gym switch that re-fits pending loads as a proposal with Undo (GE7), sharing one fit with Repeat so Repeat can never keep a load the gym can't make (slice-3 review B1). The design is `docs/design/gym-switch.md` (GS1–GS13), which asks for an ADR on its schema proposals GS-S1–S5 before building. The same gap as B1 existed in `startWorkout`: a routine pinned to an item the gym lacks kept its load unchecked (§6.6).

## Decision

### One pure fit (GS1–GS4)
- `packages/domain/src/session/snap.ts`: `snapPlanToGym({mode, slots, gym, lastUsedHere?, painFlagged?, ownerUnit})`. Modes `start`, `repeat`, `gym_switch`, `equipment_update`.
- Mapping (GS3): same item → last used here → first usable of the same kind → first usable of another listed kind → `not_here`. A slot whose plan had no equipment stays `none_needed`.
- Each set is fitted from its **intended** target (GS2), rounded toward easier through `roundToAvailableLoad`, never above a max, dropped (never rounded up) below the easiest load, dropped with no equipment. With no equipment either side a load is kept only in the slot's own unit and convention.
- Pain (rule 9): in the switch modes a load never gets harder than the set's current target; a dropped load doesn't come back (`reason: 'pain_flag'`, an addition to the spec's reason list).
- Callers: `startWorkout` (mode `start`), Repeat (`startWorkoutFromSession` → `startWorkoutWithMode(…, 'repeat')`), the switch (`buildGymSwitchProposal`) and `add_set` after a switch. Repeat's `pickEquipment`, its B1 branch and its "harder" drop are gone; B1 is now a property of the shared function.
- Wording is fixed text keyed by outcome (`snap-text.ts`): the card says "here", the set card names the gym, Repeat says "last time".
- A seeded property test (400 generated gyms × plans, all four modes, kg and lb, min/max, empty gyms, assisted machines) checks the §6.1 invariant and that every branch is reached.

### Schema (GS-S1–S5), migration 4
- **GS-S1** `PlannedSet.snap?` `{intended, intendedOn {equipmentId, kind, gymId, name}, outcome, reason?, painHeld?, equipmentId, gymId, by}`. Written only by the fit; absent when the load is exactly the intended target. Kept apart from `source` (who set it). The parallel `Why?` work may later fold it into `TargetProvenance.fit`; the shape is the same. Stored inside the existing `planned` JSON, so no column.
- **GS-S2** `WorkoutSession.gymChanges?` (append-only; column `sessions.gym_changes`). **Change from the spec:** each `change` entry also keeps `before` (every exercise row and moved set as they were) and `afterFingerprint`, because there is no proposals/actions store yet (coach, build step 4) and Undo must survive a relaunch.
- **GS-S3** `equipmentSnapshot` is append-only and unique by `(id, version)` (enforced in the reducer). `SessionExercise.equipmentVersion?` (column `equipment_version`). **Change from the spec:** absent means the *latest* entry with that ID (not "the only one"); when a newer version of an item is appended, rows already on it are pinned to the version they used. Done sets therefore always resolve their original item, and rows added later get the current one.
- **GS-S4** `SessionExercise.continuesFromId?` (column `continues_from_id`). An exercise with done, skipped or excluded sets keeps them on its row; its pending sets move (same set IDs) to a continuation row on the new equipment. Rows are never deleted (DB trigger), so **Undo leaves an empty continuation row**; views and the summary skip empty parts.
- **GS-S5** Commands `change_gym` and `undo_change_gym` (opId-idempotent; the action and continuation IDs are outside the fingerprint). `change_gym` is bound to a plan fingerprint (gym, snapshot, every row's equipment, every set's status, version and row), so logging, correcting, Undo, adding, skipping or deleting makes it stale, and changing the active set, editing a draft or adjusting rest doesn't (GS7). The reducer re-checks rule 4 itself: every pending set (minus GS11's exclusions) must be in the command, and every load must be achievable on its slot's item at the new gym.
- **No `Proposal` record.** There is no proposal store yet, so the switch proposal is a pure value (`GymSwitchProposal`), recomputed from the session and the chosen gym. It is not persisted: after a force-close the open card does not come back (the switch itself is one transaction, so the workout is either switched or not).

### Behaviour changes to existing code
- `startWorkout`: a pinned item that isn't here now maps by kind (Main's dumbbells → Hotel's rack, capped), or gives no load target. A stack template on a gym with only a barbell now maps to the barbell (GS3 step 4) with the load dropped, where it used to keep `equipmentId: null`. A template in another unit with no equipment is dropped even when the conversion is exact (spec §6.1 rule 1, as Repeat already did under SP5).
- Repeat notes use the spec's wording (`Capped: the most here is 100 kg. Last time 102.5 kg.`, `…the lightest here is…`, the gym named when known).
- After a switch, `add_exercise` accepts only the current gym's items, and `add_set` on an exercise whose row is on another gym's item needs a continuation built by the service (else `equipment_not_found`).
- History buckets a switched workout's sets by their own item's gym; the summary's gym line reads `Main Gym → Hotel · Lisbon` and an exercise done at both gyms is one row with each part's gym.

### In the app (2026-10-10)
- Workout screen: a `GymChip` in the status row opens `Gym for this workout`; choosing another gym shows the card in the coach slot (under the rest timer while resting, under the target lines otherwise); choosing the current gym dismisses it. `Switch` (or the review sheet's for 5+ lines) applies with one opId per card, so `Try again` after a write error is the same command. The toast's `Undo` restores exactly or, when refused, shows the `Switch back to …` card. When `Switch` changes the Log label, Log ignores taps for `timing.valueChangeGuard`. The card's states come from `apps/mobile/src/workout/gym-switch-card.ts` (pure, tested on real proposals).
- Set card: `SnapNote` under the target, `GymPartDivider` and done-set gym captions in the set list; `Add set` goes through the service, so it lands on the current gym's item.
- Repeat: `Checked for [gym ▾]` re-checks the preview and starts nothing; `Start` uses that gym. Dropped-load notes are warnings. `Start next session` uses the same history mapping as its preview.
- Gym detail during a workout there: `[Use changes today]` opens `Use updated …` on the workout.
- Past workouts and the Summary read `Main Gym → Hotel · Lisbon`.
- `parseGymCommand` / `gymCommandStrip` (GS9) are built and tested but not called: there is no voice yet.

## Not built (needs something that doesn't exist yet)
- **GS5 swaps:** there is no `rankSubstitutions` or Swap sheet in the app. A `not_here` exercise gets no load target and the card says `Enter your own load, or skip it after switching.` instead of offering `Swap ›`; Repeat's preview has no `Swap ›` either.
- **GS8 coach slot:** no coach in the app yet, so nothing to hold or cancel. The card sits where the coach slot will be.
- `validateRoutineForGym` (routines aren't wired), `Why?` (follow-up 3, another branch), the `Check ›` / `Add equipment ›` card actions, the stored card across force-close, `Machine busy`, Overview (not built). The computing state shows at once rather than after 300 ms.
- **Not run on an iPhone.** Every check above ran on Linux (domain, SQLite on Node, services with the fake expo-sqlite, typecheck of the screens). The screens need a device pass: the 3-tap path, VoiceOver labels, AX3 on a 375pt screen and the 1 s Log guard (checks 14, 20, 25).

## Consequences
- One function and one property test guard every path a load target reaches a set by. A future swap or coach adjustment after a switch must fit through it too.
- Older backups restore at their schema version and migrate forward; sessions written before schema 4 read unchanged (all new fields are optional and absent).
