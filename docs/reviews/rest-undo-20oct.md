# Review: unticking a set restores the rest it replaced (rest-undo-20oct)

Branch `claude/rest-undo-20oct`, diff `6898445..HEAD` (3 commits). Spec: `docs/design/workout-table-v3.md` §3, first two bullets. Ben, 20 Oct: "If u accidentally click completed set and then deselect the rest time should continue as it was not reset".

## Verdict: PASS

There are no blocking issues. The code does what §3 says. One spec gap needs Ben's decision (see "Spec issues"): a rest that had already finished, with "Rested m:ss" counting up, is still wiped by an accidental tick and untick.

## Validation (run by the reviewer)

- `npm run typecheck`: clean.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: clean.
- `npm run check:migrations`: "Migrations OK: 1 to 31, none reserved or empty."
- Targeted vitest (`rest-undo`, `rest-resume-migration`, `sqlite-repositories`, `rest-alerts`, `live-activity`, `--maxWorkers=2`): 5 files, 73 tests passed.
- The full suite was not re-run by the reviewer. The developer reports 418 files and 7951 tests passed.

## What was checked and holds

- **Original deadline.** `resumableAfterLog` (`packages/domain/src/rest.ts:168`) copies the live timer before the log ends it, including any −30/+30 already applied. `restoreAfterUndo` brings it back with the same `deadlineUtc`, clears `endedAtUtc`, and sets the version to the stored version + 2. That is above the `ended_early` copy's version, so alerts keyed by `(id, version)` reschedule.
- **Deadline already passed** (including exactly at the deadline): no rest is restored and no alert is planned. `planRestAlert` returns null for a past deadline.
- **Paused.** Logging is refused while the workout is paused (`reducer.ts:425`), so a stored rest only becomes paused through `handlePause` → `mapResumable`. It is restored paused with `remainingMsAtPause`. On resume it gets `now + remaining`, the same as the live timer.
- **No rest started by the accidental log** (superset a→b, the final planned set). The ended previous timer carries the stack, and undo restores from it.
- **Chain and double undo.** The stack pops one rest per undo. A retried op ID is deduplicated. A second undo of the same set fails with `set_not_completed`. The `not_latest_set` and `stale_version` refusals are unchanged and leave the timer alone.
- **Other rest flows.** `adjust_rest`, `skip_rest` and expiry by tick all spread the timer, so the stack survives them. Start work, Finish and Discard clear it. Gym switch and set edits don't touch `restTimer`.
- **App rescheduling.** The notification key, the Live Activity props key and the spoken-cue key (`rest:<id>:<deadline>`) are all derived from committed state. The restored timer reschedules all three. Its end cue was never played because it was replaced before its deadline, so it isn't blocked as already played. The app tests cover reschedule-to-original and cancel-when-passed.
- **Force-close.** Migration 31 adds a nullable `json_valid` column. Writes use delete-then-insert, so an empty stack writes NULL and no old JSON is left behind. The real-file SQLite test reopens the database and undoes successfully. Export opens the column as JSON automatically through `jsonColumns`, and backup is table-generic.
- **Rules 2 and 5.** No completed set is changed beyond the existing undo. The session version is bumped and idempotency is unchanged.
- **Undo paths.** The toast and coach chat undo both go through `undo_log`. Coach chat undo is tested. The table's ✓-untick isn't built yet (the v3 table is pending) and must send `undo_log` when it is.

## Blocking

None.

## Should fix (non-blocking)

**S1. Missing tests for flows that touch the accidental rest before undo.** `packages/domain/test/rest-undo.test.ts` has no case where the accidental rest is skipped (`skip_rest`), adjusted (`adjust_rest`, including −30 down to expired), or expires by tick before the undo. These paths work today only because each handler spreads the timer and so keeps `resumeOnUndo`. A future refactor that rebuilds the timer object would silently drop the stack.
- Failure scenario: Ben ticks by accident, taps Skip on the new rest, then unticks. Today the earlier rest comes back. After such a refactor it wouldn't, and no test would fail.
- Fix: add three cases (skip, adjust to zero, tick-expiry of the accidental rest, then undo restores the earlier deadline). Also add one Discard-clears-stack case (only Finish is tested) and one final-set-of-planned-workout case (the `nextActive === null` branch, `reducer.ts:527`).

**S2. The `MAX_RESUMABLE_RESTS` cap is not tested.** `withResumable` keeps the newest 20 entries (`rest.ts`, `stack.slice(-MAX_RESUMABLE_RESTS)`) and the schema enforces `.max(20)`. Without a test, a change to the slice direction would drop the newest entry, which is the one undo needs, or would fail schema validation on write.
- Fix: one unit test with 21 quick ticks. Assert that the length is 20 and that the top entry is the newest.

## Nits

**N1. The undo audit entry doesn't record the restored rest** (`reducer.ts`, the `:undone` audit in `handleUndoLog`). For debugging a "my rest came back wrong" report, it would help to record the restored timer ID and deadline, or that none came back because the deadline had passed. Optional.

**N2. Migration number 31 may collide at merge.** The developer already flagged this. Renumbering means updating the file name, `migration-list.ts`, and the hardcoded `31` in the six persistence tests and `withoutSchema31`.

**N3. Not yet seen on device.** Notification and Live Activity rescheduling to an earlier, original deadline has only been tested in Node. Add it to the next real-iPhone check: tick by accident mid-rest, untick, lock the phone, and confirm the alert fires at the original time.

## Spec issues

**SP1. "If that rest had already finished by then, no rest shows" doesn't match Ben's request.** The spec line is `docs/design/workout-table-v3.md:35`. The code is `packages/domain/src/rest.ts:171`, which only keeps `running`/`paused` timers with time left.

After a rest ends, the Ready phase shows "Rested m:ss" counting up (`packages/domain/src/session/view.ts:45`, which uses `restOverrunMs` on a `running`-past-deadline or `expired` timer). In two cases an accidental tick then untick leaves the cancelled accidental timer as `restTimer`, so the "Rested" count-up disappears:

- (a) The rest had already ended when Ben ticked by accident.
- (b) The rest ran out between the tick and the untick.

That is "reset" in the sense of Ben's message ("the rest time should continue as it was"), and it contradicts the spec's own "carries on counting as if nothing happened". It is not a code bug against the current spec text.

Proposal for Ben: undo restores the replaced timer in its natural state at undo time:
- running if its deadline is in the future (as now);
- `expired`, with `endedAtUtc = deadline`, if it has run out, so "Rested m:ss" keeps counting with no alert and no late cue.

This means `resumableAfterLog` also keeps `expired` and run-out timers, and the spec line changes to "If that rest had already finished, it shows as finished ('Rested …'), with no alert."

**SP2. §3 bullet 2 (one-tap ✓ to untick a done row) has no implementation yet**, because the v3 table isn't built. That isn't a defect of this branch. The v3 table build's acceptance checks should include "✓ on the just-logged row sends `undo_log` and restores the earlier rest".
