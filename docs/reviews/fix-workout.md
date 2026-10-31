# Review: fix-workout (branch `claude/fix-workout` vs `claude/gracious-knuth-joxqpw`)

**Verdict: CHANGES NEEDED**

Commits reviewed: `1730fbf` (Save as routine, split exercise), `20ba97a` (side kept with draft),
`6121b75` (slow reload ordering guard).

## Checks run

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npx vitest run --testTimeout=120000`: 178 files, 3636 passed, 1 todo, 0 failed

## Does each bug have a test that fails without the fix?

I checked this in an isolated copy of the branch, with the source file(s) reverted to the base and the new tests kept:

| Bug | Test | Fails without fix? | Root fix? |
|---|---|---|---|
| 1. Save as routine duplicates a split exercise | `packages/domain/test/gym-switch.test.ts` "Save as routine keeps a split exercise as one entry…" | Yes: `expected [...] to have a length of 1 but got 2` with `routines.ts` reverted | Yes. It walks part roots and uses `blockSets`, the same as `repeat.ts` |
| 2. A slow reload overwrites a just-logged set | `apps/mobile/test/load-order.test.ts` | Yes: the source-scan case fails with `WorkoutScreen.tsx` reverted (the pure-function cases are new code) | **Partial**. See B1 |
| 3. The unilateral side is lost on minimise or restart | `packages/domain/test/unilateral.test.ts` "the side chosen before logging is saved with the draft" | Yes: both cases fail with `reducer.ts` and `commands.ts` reverted (`side` stays `both`) | Yes. Schema, reducer and both screen dispatch sites go through `saveDraftCommand`, and persistence writes the full set row, so `side` is stored |

## Blocking

**B1. The ordering guard compares the wrong field, so the bug-2 race remains for every write that doesn't bump `session.version`.**
`apps/mobile/src/workout/load-order.ts:18-19`.
`newerWorkoutData` keeps the on-screen data only when the incoming `session.version` is lower, or, at equal versions, when the incoming read has an older copy of the same rest timer. Several screen commands change state without bumping `session.version`: `pause` and `resume` (`reducer.ts:741-792`), `stop_work_interval` (`:715`), `start_work_interval` when the active set is unchanged (`:674-706`), and `tick`. For example, `pause` with no rest timer running changes neither field.
Failure scenario (reproduced with a throwaway harness test in a scratch copy, not committed): load the workout (version 2, revision 2), then dispatch `pause` (version 2, revision 3), then call `newerWorkoutData(committed, staleRead)`. It returns the stale read, so the screen shows the workout as not paused. The same thing happens in the brief's repro path: unlock on the rest or work alert, AppState `active` starts a slow `reload()`, and Ben taps Pause, or Stop on a timed set. The stale read lands last, the Pause/Resume toggle or the running work timer shows the wrong state, and it stays wrong until the next focus or foreground. This is the same "the screen lies" class the bug reported, and only the log path is fixed.
Fix: compare `aggregate.revision` (`packages/schemas/src/session.ts:614`, "bumps on every persisted change"). `reduceSession` bumps it on every changed, non-duplicate command, including `tick`. Keep `current` when `b.revision < a.revision` for the same session ID, and adopt otherwise. This also makes the rest-timer special case unnecessary. Add a test that the guard keeps the committed state after a `pause` (no rest) and after a `stop_work_interval`, alongside the existing `log_set` case.

## Should fix

**S1. The bug-2 test proves the screen's wiring by regex, not by behaviour.**
`apps/mobile/test/load-order.test.ts:90-98` scans `WorkoutScreen.tsx` text for `setData((cur) => newerWorkoutData(cur, …` and for the `if (r.duplicate)` block. A harmless refactor (renaming `cur`, or wrapping the call in a helper) breaks it, and a real regression that still matches the text (a `setData` with no newline after `(`, say) passes. That's acceptable as a tripwire, but the pure tests should also cover the commands from B1. Better still, extract the "apply a command result" step into a tested helper that the screen calls.

**S2. When a read is rejected, its fresh side data is dropped too.**
`load-order.ts:18` returns `current` wholesale, so the incoming read's history, `painFlags`, gym names and check-in are discarded along with its stale aggregate. `painOutcome` (`WorkoutScreen.tsx:626-630`) relies on `reload()` to pick up a changed pain flag. If a command commits while that reload is in flight, the screen keeps the old pain-flag set until the next reload (rule 9 is display-only here: storage is correct). The pre-existing `run()` pattern `{ ...loaded, aggregate }` (for example `WorkoutScreen.tsx:497, 696, 1531, 1585`) does the same thing from the other side: it reverts side data to the closure's `loaded`, even when `cur` has newer side data. Fix: when keeping `current`'s aggregate, take the non-aggregate fields from `incoming` (`{ ...incoming, aggregate: current.aggregate }`), and have command results merge into `cur` (`{ ...cur, aggregate: r.aggregate }`) rather than into `loaded`.

## Nits

**N1.** `apps/mobile/src/screens/workout/WorkoutScreen.tsx:540-544`: the duplicate-log path is correct. A changed-value re-tap on a stale view still surfaces the raw `operation_id_reused` message ("This operation ID was already used for a different action."), which breaks the minimal-copy convention. B1 makes this much rarer, but mapping that code to the same short "Set not saved. Try again." (or reloading silently) would be cleaner.

**N2.** `packages/domain/src/session/routines.ts:110-116`: the routine entry is now pinned to the latest part's item, which matches Repeat and next-session targets. When the two gyms' racks use different units or conventions, one routine entry holds templates in mixed units (for example `32.5` from Main and `20` from Hotel in the test). The start path snaps each template to the item, so this probably works, but no test covers starting such a routine. A one-line assertion in the new test (start the saved routine at Main and check the snapped loads) would cover it.

**N3.** `packages/domain/src/session/reducer.ts:1263`: the reused `log_set` error copy (same string as `reducer.ts:324`) never reaches the UI from the debounced save. On the off-profile path (`WorkoutScreen.tsx:615-622`) it shows as the generic "Couldn't save. Try again.", which is fine. Noted only so nobody wires the long message into a banner.

## Rules 1-10, other flows, copy

- Rule 1 (offline): unaffected. Everything is local.
- Rule 2 (completed sets): `save_draft` still rejects non-pending sets before the new side handling (`reducer.ts:1255`), so a completed set's side can't be changed through it. Companion rows can't change side (`reducer.ts:1262-1264`, tested).
- Rule 4 (equipment): routine pinning reuses the existing start-time fit and substitution path. No new extrapolation.
- Rule 5 (idempotent and versioned): see B1. The reducer is unchanged for opIds. `save_draft` has no opId and doesn't bump any version (as before).
- Rules 3 and 6-10: not touched.
- Other flows: Summary count (`facts.exercisesDone`) and `routineCounts` now agree (tested). Repeat and next-session targets are unchanged. No backup or format change: `side` was already a stored column.
- Copy: no new user-facing UI strings.

## Spec issues

None found.
