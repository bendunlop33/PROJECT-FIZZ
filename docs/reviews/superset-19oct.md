# Review: superset-19oct (same exercise twice, Superset with…, Finish time wheels)

Branch `claude/superset-19oct` (9 commits, `69d7798..a8079cb`), diffed against its merge-base with `claude/gracious-knuth-joxqpw` (`6ddcc11`). Reviewer: independent, 19 Oct 2026.

## Verdict: CHANGES NEEDED

Two blocking issues. Both come from rules that pick a winner without looking at the data:

- B1: the direction of a link (which row joins which) decides whether the sets alternate. For some directions, the exercise Ben is in the middle of jumps to the end of the workout.
- B2: the "main copy" heuristic can promote a lighter copy. When it does, the heavier copy's logged sets vanish from the exercise's history and next time is planned from the lighter load.

Everything else is close. The schema and migration, versioning and idempotency, Undo, the reducer guards on finished sessions, the time-wheel bounds and the picker pin are all sound.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npx vitest run --maxWorkers=2` (full) | 370 files, 7182 passed, 1 todo, exit 0. The total includes one temporary probe file of mine, since deleted. |
| Picker pin | `apps/mobile/package.json` and the lockfile have `@react-native-community/datetimepicker` `9.1.0`. `node_modules/expo/bundledNativeModules.json` (expo 57.0.27) also says `9.1.0`. It has no entitlements and no config plugin is added, so the app stays free-provisionable. |
| Screenshots | `BEN-SUPERSET.local.png` and `BEN-FINISH.local.png` are absent from the worktree and from every commit. |
| Migration | 24 (`round_offset`, nullable with a CHECK of 1..60). Backup is table-generic and the older-schema backup tests drop the column. Persistence and mobile tests show the value survives a restart. |
| Rule 2 | `link_superset` and `split_superset` touch only rows and order (tests assert `sets` are equal). The `finish` start edit is audited and changes no sets. |
| Rule 5 | Both commands carry `expectedVersion` and `opId`. A duplicate returns `duplicate` with `superseded`. Undo refuses once the rows have moved. |

Probes I ran (in temporary test files, since deleted) are quoted under each finding.

## Blocking

### B1. The link direction decides whether sets alternate; the in-progress exercise can jump to the end of the workout

- **Where:**
  - `packages/domain/src/session/reducer.ts:2294`: `const [joiner, anchor] = a.supersetGroup === null ? [a, b] : [b, a];`
  - `reducer.ts:2316`: the round offset is computed only for the joiner.
  - `packages/domain/src/session/order.ts` `joinRoundOffset`, which never goes below 0.
  - `apps/mobile/src/services/workout-services.ts:2988`: the picker sends the partner as `sessionExerciseId`, so the partner always joins.
  - `packages/schemas/src/coach.ts:305`: for the coach's `superset` op, "the first joins the second's".
- **What happens:** when neither row is in a superset, the row named first always joins. It moves to just after the other row and is the only one that gets a `roundOffset`. If the joiner is the row that is further along, its offset clamps to 0 and the anchor is never offset. The joiner's done rounds then pair with the anchor's pending sets, and the joiner is moved past every exercise between the two rows.
- **Failure scenario (probe):** take the fixture order Bench, Cable row:A, Face pull:A, Dead hang. Ben has logged bench's warm-up and set 1. He opens the ⋯ menu on Dead hang, taps Superset with…, and picks Bench under "In this workout". The coach op `{op:'superset', sessionExerciseId: bench, withSessionExerciseId: hang}` ("superset bench with dead hangs") does the same.
  - Result: Bench moves to order 3, after Cable row, Face pull and Dead hang.
  - The pending execution order becomes Cable row, Face pull, Cable row, Face pull, Dead hang, then bench set 3.
  - The dead hang is paired with bench's done round, and bench set 3 is left alone. Nothing alternates, and after the current set the app sends Ben to a different exercise.
  - The opposite direction works (the menu on Bench, then pick Dead hang), and that is the only direction the tests cover (`superset-link.test.ts:28,144`, `edit-today.test.ts` "pull-up moves after bench").
  - Ben's own case, the coach adding a new copy with `supersetWithSessionExerciseId`, goes through `handleAddExercise` and is fine.
- **Fix:**
  - Make the order and offset independent of argument order. When neither row is grouped, the anchor should be the row with more rounds done (or the earlier row in order), and the other row joins after it.
  - Alternatively, let either side carry the offset: compute it for whichever row is behind, and keep the row that is in progress in its place.
  - Add tests for both argument orders, through the reducer, the picker service and the coach `superset` op. Each should assert the alternation and that the next pending set is still the in-progress exercise.

### B2. The "main copy" choice can hide Ben's heavier logged sets from history and plan next time from the lighter copy

- **Where:**
  - `packages/domain/src/history.ts:100`, which picks the main copy by "most done working sets, then heaviest, then first".
  - `mainCopies` drops every non-main copy from `toHistorySessions`. That function feeds the history repo (`packages/persistence/src/store.ts:112`), the coach's training view and recent history.
  - `nextTargetBlocks` (`gym-switch.ts`, `byItem = false`) marks the heavier row as `copy`. Summary Next time, `nextSessionBases` and the workout-services next-time plan then all skip it.
- **Failure scenario (probe):** Bench has 2 working sets done at 80 kg. Ben (or the coach) adds a second Bench copy on the same bar at 20 kg and logs 6 sets.
  - `nextTargetBlocks` marks the 80 kg row `copy: true` and makes the 20 kg row the decider.
  - `toHistorySessions(…, BENCH)` returns only `[20,20,20,20,20,20]`. The 80 kg sets no longer appear in exercise history, Last, Progress or e1RM, and the coach doesn't see them.
  - Next time is planned from 20 kg.
  - Ben's own case triggers this too. A seated calf raise copy at 0 with one more set than the weighted row (a common burnout pattern, or the coach adding 4 at 0 when 3 weighted are done) becomes main across items. Next time for Seated calf raise then comes from the 0-load, no-equipment copy.
  - This contradicts the CHANGELOG and ADR 0028 claim that "a 0 kg copy never pulls its targets down". Completed sets aren't changed, but they silently stop counting, which is the kind of quiet data loss rules 2 and 6 guard against.
  - `duplicate-copies.test.ts:45` covers only a lighter copy with fewer sets.
- **Fix:**
  - Don't remove copies from history. History should hold every completed set, and each copy is already a separate row with its own sets.
  - Decide "main" for next-time planning only, from a stable fact: the planned or routine slot (or the original row, i.e. not the one created by `add_exercise` or a coach add as a second copy), else the heaviest. Set count must never decide it.
  - Add tests where the lighter or 0 copy has more sets than the weighted one.

## Should fix

### S1. The Progress "Targets hit" history merges two copies into one row

- **Where:** `packages/domain/src/progress/plan-tracker.ts:321` (`exerciseTargetHistory`). This file isn't in the diff, but this branch is what makes the case reachable.
- **Scenario:** weighted 3×12 plus a 0 kg copy at 3×20 shows as one row, "6 × 12", with the actual "12, 12, 12, 20, 20, 20" and one combined verdict. The brief requires plan-vs-done per slot, never merged.
- **Fix:** show one row per `sessionExerciseId` (or main copy only, labelled), plus a test.

### S2. Overview (before Start) "Superset with…" isn't built

- The developer disclosed this; the brief scoped it ("row/exercise ⋯ menu in WorkoutScreen/WorkoutTable and the overview").
- **Scenario:** before Start, Ben adds a second Seated calf raise and has no way to pair it until the workout starts.
- **Fix:** either build it (a superset edit kind in today-edits), or get Ben's or the PM's explicit deferral and record it in the CHANGELOG's "Open for Ben" (it is mentioned there, but as a fact, not as a deferral Ben approved).

### S3. The pre-Finish "Edit workout times" in the workout screen still uses ± buttons

- **Where:** `apps/mobile/src/screens/workout/WorkoutScreen.tsx:2936-2974`.
- Ben asked for scrolling. One screen now has wheels and the other has steppers for the same field.
- **Fix:** reuse `WorkoutTimesRows`, start only.

### S4. In time-only mode the wheels can't cross midnight

- **Where:** `apps/mobile/src/screens/workout/WorkoutTimesRows.tsx:697` (`mode` follows `timesNeedDate`).
- **Scenario:** a workout recorded as starting at 00:05 that really started at 23:50 the day before. In `time` mode the wheel keeps today's date, so 23:50 clamps to the first set ("Start can't be after the first set"). The date column only appears once the dates already differ, so there's no way to get there.
- **Fix:** use `datetime` mode whenever the bounds (`startMinMs`..`endMaxMs`) span two local dates, not only when the current values do.

## Nits

- **N1.** `packages/coach/src/intent.ts:76`: adding `pair` to `REQUEST_CUE` means "the pair of 20s felt heavy" can validate a `benAsked` quote. "superset" alone is enough; consider `pair (?:it|this|that|with)`.
- **N2.** `classifyBenRequest` returns `null` for "superset it with itself at 0", "split the superset" and "I want to superset this with …". `edit_today` is open on every live turn, so this doesn't block, but `superset`/`split` should map to `change` for consistency.
- **N3.** Superset letters skip after an Undo (disclosed). This is cosmetic, but Ben will see "B" with no "A".
- **N4.** `round_offset` is capped at 60 by the schema and the CHECK, but `joinRoundOffset` is unbounded. Clamp it or refuse, so a pathological workout can't fail validation on read.
- **N5.** `handleFinish` checks a moved start against the first set but not against an earlier pause, unlike `update_session_timing`. Duration clipping covers it, but the two checks should match.

## Spec issues

- **Overview supersets** need a design decision: today-edits have no superset kind, and pairing slots before Start touches ordering and template rules. The brief listed it as if it were a small menu item. Recommend a separate slice with Ben's sign-off (see S2).
- **"Matching set count by default"** is defined only for a newly added partner. When two existing rows are linked, their counts stay as they are and the extras run as straight sets. The spec should say whether linking should offer to match counts.
- **Which copy is "the exercise" for next time** (B2) isn't settled by the brief. "Per slot" alone doesn't say which slot's result plans next session when a routine has the exercise once and today had it twice. Ben should confirm: the planned slot wins, and an ad-hoc copy never plans next time.
