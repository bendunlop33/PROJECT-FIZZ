# Review: domain core (build step 1): `packages/schemas`, `packages/domain`, root tooling, ADR 0002

**Verdict: CHANGES NEEDED**

Reviewed: commits `ca8a857`..`c9c5078` (excluding the docs-only `6b3fb2e`), 8 Oct 2026.
Specs checked: CLAUDE.md product rules; brief v0.2 §1 "First release", §4, §6, §7, §9, §10, and "Validation before claiming it is better"; `docs/design/flow-first-milestone.md` (state machine, invariants 1–6, §4.2 recovery table, P1–P12, §8 acceptance); `rest-state.md`; `active-workout.md`.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 6 files, 152 tests, all passing |
| Probe tests (scratch, not committed) | 21 targeted probes against `startWorkout`, `reduceSession`, `calculateNextTargets` and `getAchievableLoads`. They confirmed findings B1–B3 and M1–M8 below |
| Secrets / logging grep | no credentials, keys or `console.*` in `packages/` |

Overall this is a strong slice. The reducer is pure, time is always injected, timer state is deadline-based, and opId idempotency survives a force-close. Expiry never commits a set, and corrections never touch rest. Load maths uses scaled integers and exposes a clear assisted-machine direction. Most rules in the flow spec are implemented faithfully and tested. The blocking issues sit where templates and history meet equipment, unit and convention.

---

## Blocking

### B1. `startWorkout` can plan loads in a different unit or convention from the session exercise, so the one-tap Log is rejected
`packages/domain/src/session/create.ts:84-85, 93-108`

The session exercise takes its unit and convention from the equipment, or falls back to `exercise.defaultLoadConvention` and `owner.preferredUnit`. The planned load is only replaced when rounding succeeds **and** the request was not an exact hit. In every other case the template's own load is kept, even when its unit or convention differs. `prefillDraft` then copies that load into the draft, and `handleLogSet` rejects it. I confirmed four paths with probes:

| Scenario | Planned load | Session exercise | Result of tapping prefilled `Log` |
|---|---|---|---|
| Template in lb on kg equipment, conversion lands exactly (e.g. 220.462 lb → 100.000 kg) | `220.46 lb total` (no warning) | kg | `unit_mismatch` |
| No equipment on the routine exercise, owner prefers lb, template in kg | `100 kg` | lb | `unit_mismatch` |
| Template `30 kg total` on a dumbbell rack (`per_hand`) | `30 kg total` (warning `target_not_checkable`) | `per_hand` | `convention_mismatch` |
| Equipment missing at this gym (hotel gym / retired cable), template `40 kg stack`, exercise default `total` | `40 kg stack` | `total` | `convention_mismatch` |

Impact:
- The core loop breaks: the primary action fails on a set Ben didn't edit (flow §8 check 1, active-workout acceptance 1 and 4).
- The convention-mismatch case also shows an unbounded `Target 30 kg` on a per-hand rack whose maximum it was never checked against. That conflicts with CLAUDE.md rule 4 and the brief §10 scenario "dumbbells up to 30 kg … loads are per hand".
- The missing-equipment case is exactly the brief's "switch to a hotel gym" situation.

Fix:
- After choosing the session exercise's unit and convention, normalise every planned load to them.
- **Convention differs:** never convert. Set `planned.load = null`, keep the template target in the warning (and later as provenance), and let the draft fall through to history or empty.
- **Equipment present, unit differs:** always use `rounded.load`, including on an exact hit.
- **No equipment, unit differs:** either convert explicitly with a `target_converted` warning, or give the session exercise the template's unit. Pick one and record it in the ADR.

Add a test per row of the table above.

### B2. Double progression increases the load after an incomplete session
`packages/domain/src/progression.ts:155, 188, 319`

`comparableSessions` judges "all hit top" only over the sets that were logged. `rule.workingSets` is never used in the evaluation. Probe: rule `workingSets: 3`; history has one working set at 100 kg × 8 (Ben cut the session short, and the other two sets were skipped at Finish). Result: `increase_load` to 102.5 kg.

Brief §3 says to progress "only when chosen rep and effort criteria are met". A prescription met on one set out of three doesn't meet it, and this is the main job of the rule engine (CLAUDE.md rule 3). Top-set/back-off has the same problem in a milder form: a session with no `top` set is silently skipped, so an older session becomes "latest".

Fix:
- Require `counted.length >= rule.workingSets` (and exactly one or more `top` sets for top-set rules) before `increase_load` or `increase_reps`.
- Otherwise return `hold` with a fact such as `Only 1 of 3 working sets was logged on 1 Oct; holding.`
- Add tests for the 1-of-3 case and for a session where every set was skipped.

### B3. The explanation contradicts the target when the last load is not on the current equipment
`packages/domain/src/progression.ts:213, 314-338, 380, 391`

`lastText` always formats the historical load `L`. Meanwhile `feasibleHold` and `nextHarderLoad` may move the target elsewhere. Probe: the rack now tops out at 20 kg, and history shows 3 × 8 at 30 kg each. This can happen because off-profile loads are deliberately allowed and flagged, or because the rack was edited. Output:

- decision `increase_reps`, target load **20 kg each**;
- summary `Add a rep: aim for 9 at 30 kg each, because 30 kg each is the heaviest load available on Home dumbbells.`

Both halves of the summary are false: 30 kg isn't available, and the target isn't 30. The hold path does the same (`Stay at 30 kg each …` with a 20 kg target). Rule 3 requires targets to be inspectable. An explanation that names a different load from the one prescribed will lead Ben to lift the wrong weight. It is also a mild case of rule 6 (stating something that isn't true).

There is a related problem at `:213`. When the equipment has no achievable loads at all (e.g. `minLoad` above every stack position, which the schema allows), `feasibleHold` returns the raw, unachievable value, and `loadFeasibility` still reports `'checked'` (`:452`).

Fix:
- Build summary text from the **target** load, not `L`.
- When `L` is not achievable, take the "rep step because of ceiling" path only if the held load really is the ceiling. Otherwise, use a separate decision or fact: `Last load 30 kg each isn't on this rack; using 20 kg each.`
- In `feasibleHold`, return `null` (or a distinct `no_feasible_load` decision) instead of the raw value when rounding fails, and don't report `'checked'` in that case.
- Add tests for history above the current max, on both the all-top and the hold paths.

---

## Major (non-blocking, fix before the UI slice builds on them)

### M1. `ceilingRepCap` below the top of the rep range produces an invalid rep range
`packages/schemas/src/routine.ts:93, 105`; `packages/domain/src/progression.ts:324-328`

Probe: repRange 8–12, `ceilingRepCap: 10`, at the stack maximum → `ceiling_reached` with reps `{min: 12, max: 10}`. That fails `RepRangeSchema` and would render as `12–10`.

Fix: add a refine `ceilingRepCap >= repRange.max` (and `>= topSet.repRange.max`) to the rule schemas, plus a test.

### M2. Timed exercises: progression claims there is no history
`packages/domain/src/progression.ts:155, 308`

`counted` drops sets with `reps === null`, so a dead-hang history returns `insufficient_data` with `No comparable Dead hang history yet`. That is untrue when history exists, which edges toward rule 6.

Fix: until duration progression exists, return `unsupported` with honest text (`Time-based progression isn't supported yet`). Add a test.

### M3. Undo uses the client timestamp, not commit order; a duplicate log after undo reports success
`packages/domain/src/session/reducer.ts:348-362, 677`

`latestCompletedSet` ranks by `completedAt` (the command's `at`). Probe: set W logged with `at=100`, then a delayed voice turn logs B1 with `at=50`. Undo on B1, the set that was actually committed last and is showing the toast, fails with `not_latest_set`.

Separately, after Undo, a late duplicate of the original log (for example a repeated voice transcript) returns `{ok: true, duplicate: true}` while the set is **pending**. A tool or voice layer that reports "committed" on `ok` would tell Ben the set was saved when it wasn't (brief §8: tool outputs must clearly report committed state).

Fix:
- Pick "latest" by append order in `audit` (the last `logged` entry not followed by `undone`).
- Return the current set status, or a `superseded` flag, on duplicates.
- Test both cases.

### M4. The command contract is missing operations the specs depend on; an empty workout is a dead end
`packages/schemas/src/commands.ts`; `packages/domain/src/session/create.ts:158`

These have no command: `addSet`, `addExercise`, `deleteSet`, `skipExercise`, discard (the `discarded` status is unreachable), `updateSessionTiming`, undo of a correction, and "This rest only" rest edits. Flow §6 and active-workout §4.4, §4.8 and §4.9 rely on them.

The concrete failure: brief §1 requires "Start from a routine or empty session". `startWorkout` with `routine: null` gives `activeSetId: null`, so `getSessionPhase` returns `all_done` immediately and nothing can be logged.

This slice is "service contracts", so add at least `add_exercise` / `add_set` / `delete_set` / `skip_exercise` / `discard` to the union now, even if their handlers come in step 2.

### M5. Unilateral exercises can't be logged per side
`packages/schemas/src/exercise.ts:27`; `packages/schemas/src/session.ts` (`SessionExercise`, `WorkoutSet`)

`laterality` exists on `Exercise`, but it isn't snapshotted onto `SessionExercise`, and `WorkoutSet` has no `side`. Brief §4 says "For unilateral exercises record per side and avoid double-counting volume."

Fix: snapshot `laterality`, and add `side: 'left' | 'right' | 'both' | null` to sets (or a per-side values pair) before history accumulates.

### M6. Stopping a work timer just after its deadline fails, and a failed command discards the clock update
`packages/domain/src/session/reducer.ts:487-492, 688`

Probe: a 45 s interval, then Stop at 46 s. `applyClock` completes the interval first, so the handler returns `work_interval_not_running`. The reducer then returns the **original** state, which also throws away the expiry. Ben sees an error on the button the UI was still showing.

Fix:
- Make `stop_work_interval` succeed as a no-op when the interval has already `completed` for that set.
- Generally, on handler failure, still persist `clocked.state` when it changed. Or the service can tick first.

### M7. Finish accepts any end time and doesn't keep the original
`packages/domain/src/session/reducer.ts:555-559`

`endedAt` may be in the future (probe: +26 h accepted) or before the last completed set. Active-workout §4.8 says the chosen time is recorded "with an audit, and the original value is kept". Here the original tap time survives only in `processedOps`.

Fix:
- Require `lastCompletedAt <= endedAt <= at`.
- Store `endedAt` plus `endedAtOriginal` (or an audit entry).
- Add tests.

### M8. Feasibility helpers recompute the whole achievable-load set on every call
`packages/domain/src/equipment.ts:175, 190`

On a realistic commercial plate inventory (10 plate sizes × 40), `stepLoad` takes about 5 ms per call on this Linux box. That runs on every stepper tap and every `isLoadAchievable`. On an iPhone, in JS, during a set, this will add up.

Fix: memoise `getAchievableLoads` by equipment `id` + `version`.

---

## Nits

1. `packages/domain/test/progression.test.ts:292`: the determinism test calls the function twice on the same object, so it would pass for almost any implementation. Test input-order independence, including equal `performedAtUtc` ties (currently broken only by input order), and run it with history arrays in shuffled order.
2. `packages/domain/test/recovery.test.ts:83-88`: "Case 1" only shows that a derived ID is stable and that one log succeeds. Make it simulate a failed save (the repository throws) through the service, then retry.
3. `packages/domain/src/session/recovery.ts:44`: `rest_ended_while_closed` fires for any expiry first observed at recovery. That includes a rest that ended while the app was open, if the UI never dispatched a `tick`. Either document that the app must persist a tick at the deadline, or compare against an "app last foregrounded" time.
4. `reducer.ts:681`: `correct_set` is accepted on `discarded` sessions too. Restrict it to `active | finished`.
5. `log_set` accepts `at` earlier than `session.startedAt`. Reject it, or clamp it with a flag.
6. The `bodyweight` convention forces `value === 0`, so weighted dips and pull-ups need `added` with no equipment. Document that in the schema comment, or add `bodyweight_plus`.
7. `PlateCount` has no per-plate unit, so a kg bar with lb plates (common in some gyms) can't be described. Fine for now; note it in the ADR.
8. `session-service.ts`: aggregates read from the repository aren't validated, although the ADR says "persisted rows … go through validate". The memory repo makes this moot. Make sure the SQLite adapter does it.
9. Naming: `session.version` (content) vs `revision` (storage) vs `RecordMeta.version`. Consider `contentVersion`, and list the bumping commands in one place (the schema comment is good; repeat it in the ADR table).
10. Consider adding a schema-level invariant: `status: 'completed'` ⇔ `actual !== null && completedAt !== null`.

---

## Developer choices (asked to judge)

- **Two counters (`session.version` vs `revision`): agree.** It matches flow §5 rule 6: proposals go stale on commits, corrections, undo and gym switches, not on ±30 s or pause. Optimistic concurrency needs a counter that moves on every write. Both are tested (`+30 s … don't stale proposals`, write-conflict retry). One interaction belongs with the spec, not the code: see Spec issue S1.
- **Logging without `expectedVersion`: agree.** Exactly-once comes from the opId plus the `pending` status check, and the setId is explicit. A version guard would reject a legitimate one-tap Log after harmless commits, such as an RPE chip tap during rest. The actual values are what Ben lifted, so there is no stale state to protect. The voice path should still bind its parsed set to the setId shown to Ben (it does, via `setId`).
- **Logging refused while paused: agree.** It matches active-workout §3 ("Log is hidden until Resume") and acceptance 13. The UI or voice path needs a clear `Resume to log` response, not a generic error.
- **Off-profile loads (allowed and flagged): agree.** It matches active-workout §4.3 and acceptance 6. Flags are recomputed on correction. The weak spot is downstream: B3 shows how off-profile history produces a misleading explanation.

## Durability and security notes (no action beyond the findings above)

- Force-close: deadline-based timers, stale (≥ 6 h) handling, paused-state restore, draft restore and work-timer-ended-while-closed are all implemented and tested. Retry after a crashed write reuses the deterministic opId and commits once.
- Duplicates: opId fingerprints exclude `at` and `restTimerId`, so a regenerated retry still matches. A reused ID with different intent is rejected. Duplicate detection runs before the finished-session guard, so a retried Finish is a no-op. Good.
- Stale writes: `undo_log`, `set_active_set` and `finish` check the session version, and `correct_set` checks the set version. There are no proposals yet.
- Security: no credentials, network or logging in this slice. `validate()` is used at the service boundary for commands.

## Tests: gaps that would let wrong logic pass

Untested today, each matching a finding or a focus area:
- template unit and convention normalisation (B1);
- incomplete sessions (B2);
- history above the current maximum (B3);
- cap below the rep range (M1);
- timed progression (M2);
- undo ordering and duplicate-after-undo reporting (M3);
- stop just after the deadline (M6);
- finish end-time bounds (M7);
- weight stack with add-ons **and** `maxLoad` (behaviour is correct by probe, but untested);
- assisted `minLoad`/`maxLoad` bounds;
- lb dumbbells;
- stale `set_active_set`;
- supersets with uneven set counts;
- out-of-order logging wrap-around in `nextPendingSet`;
- service retry exhaustion and the `recover()` save-conflict path;
- `findByStartOperation` after the session has finished.

---

## Spec issues (brief and design, not code)

- **S1. The undo guard conflicts with P3.** Flow §3.2 guards Undo with "the session version matches". P3 puts the effort chips in the rest card right after Log, and a chip tap is a `correctSet`, which bumps the session version (as the flow's own staleness rules require). So "Log → tap RPE 8 → Undo" within the 8 s toast is always rejected as stale. Proposal: guard Undo on the **set's** version plus "still the latest commit". Keep session-version staleness for coach proposals only. Needs Ben's approval and a CHANGELOG entry.
- **S2. Skip is described two ways.** Flow §3.2 says Skip = "`adjustRestTimer` to zero (status `skipped`)". rest-state §4.3 says `endRestTimer(timerId, 'skipped')`. The code follows rest-state. Align the flow doc.
- **S3. "Criteria met" is undefined for partial sessions.** Brief §3 says "Progress only when chosen rep and effort criteria are met" but doesn't say whether all prescribed working sets must be completed. B2 assumes they must. Ben should confirm.
- **S4. Finish with a running work timer is unspecified.** Neither the flow nor active-workout says what Finish does to a timed set whose work interval is running. The code cancels it and marks the set skipped, so elapsed time is lost. Decide whether Finish should first offer `Log 0:38`.
- **S5. The end-time correction has two homes.** Brief §7 `finishWorkout(sessionId, expectedVersion)` has no end-time parameter. Active-workout §4.8 routes it through `updateSessionTiming` with an audit. The code folds it into `finish.endedAt`. Pick one contract.
