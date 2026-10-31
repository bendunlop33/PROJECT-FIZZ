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

---

# Re-review after fixes

**Verdict: CHANGES NEEDED**

Reviewed: commits `6ec884a`..`454710a` (10 commits after `753adf6`), ADR 0003, 8 Oct 2026. Specs: same as above. I also read the designer's **uncommitted** revisions to `docs/design/{flow-first-milestone,active-workout,rest-state,today}.md` (working tree, not in any commit), because they now describe the new commands.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 9 files, 220 tests, all passing (was 152) |
| Probes (scratch, not committed) | 14 probes. I re-ran the original B1/B2/B3/M3/M6/M7/M8 cases and probed the new commands, the timing rules and the infeasible-equipment path. They confirm R1–R4 below |
| Secrets / logging grep | still no credentials or `console.*` in `packages/` |

The fixes are careful and well tested. Every original blocking and major finding is fixed. In each case the new regression test pins the behaviour the review asked for, so it would fail if the fix were reverted. I checked that claim by reading each test against its fix: for example, the M3 test commits B1 with an earlier `at` than W, and the M8 test mutates `maxLoad` without bumping `version`. One new blocking bug was introduced, in the pause/timing interaction that the M7/S5 work created.

## Previous findings: status

| Finding | Status | Evidence |
|---|---|---|
| B1 planned load unit/convention | **Fixed** | All four probe rows now prefill a load that `log_set` accepts. When a load can't be honoured, the planned load is null with a `target_dropped` warning that keeps the template. Rows 1–4 plus a mixed-input invariant are tested (`start-normalisation.test.ts`) |
| B2 incomplete session progresses | **Fixed** | 1 of 3 → `hold` with fact; 2 of 3 holds; all-skipped latest session holds at the last performed load. Top-set rule needs a top set |
| B3 explanation names historical load | **Fixed, with a residual** | Rack max 20, history 30: `increase_reps` at 20 kg each, and the text names 20 and adds a fact about 30. Equipment with no achievable loads now reports `infeasible`, but its text says "bodyweight" (see R3) |
| M1 cap below rep range | **Fixed** | Schema refines on both rule types; tested |
| M2 timed progression | **Fixed** | `unsupported`, honest text |
| M3 undo order / duplicate after undo | **Fixed** | Commit-order "latest"; duplicate after undo returns `superseded: true` |
| M4 missing commands / empty dead end | **Fixed** | Six commands with handlers. An empty workout's phase is `empty` |
| M5 unilateral | **Fixed for logging and volume**; progression gap (R4) | `laterality` snapshotted, `side` on sets, `summariseVolume` never sums sides |
| M6 stop after deadline / lost expiry | **Fixed** | Stop at 46 s on a 45 s interval is a no-op success with the 45 s draft. Rejected commands return the caught-up state, and the service persists it (tested through the service) |
| M7 finish end time | **Fixed** | Future and before-last-set are rejected; the tap time is kept in `timingAudit`. The pause interaction is broken (R1) |
| M8 recompute per call | **Fixed** | Content-keyed LRU of 64 entries. An in-place `maxLoad` edit is picked up (probe) |
| Nits 1, 2, 4, 5, 10 | **Fixed** | Shuffled-order and tie determinism; failed save through the service; `correct_set` refused on discarded; log before start refused; completed ⇔ actual invariant |
| Nits 3, 6 | **Documented** | Recovery tick requirement; weighted bodyweight uses `added` |
| Nits 7, 8, 9 | **Deferred in ADR (acceptable)** | Per-plate units; SQLite read validation; counter table in ADR |
| Test gaps list | **Closed** | Every listed gap now has a test |
| S1–S5 | **Decided in ADR 0003** | Design docs updated, but uncommitted (see Spec issues) |

---

## Blocking

### R1. A chosen or corrected end (or start) time ignores pauses outside the new window, so the recorded duration is wrong, down to 0
`packages/domain/src/session/reducer.ts:648-650` (finish), `:728-731` (update_session_timing); `packages/domain/src/session/view.ts:63`

`pausedTotalMs` is a single running total. Neither Finish with `endedAt` nor `update_session_timing` clips it to the new `[startedAt, endedAt]` window. `getActiveDurationMs` then subtracts pauses that happened after the chosen end (or before the chosen start). Probes:

- **Summary Edit after a forgotten Finish.** Last set at 60 min, Pause at 61 min, app left, `Finish` tapped at 5 h (duration correctly 61 min, paused 239 min). Ben then edits the end time to 63 min on the summary (the designed correction path). Result: **duration 0 min**. It should be 62 min.
- **Finish sheet with a chosen time after Resume.** Same as above, but Ben resumes (to look at something) and then finishes with `endedAt` = 63 min. Result: `pausedTotalMs` = 120 min, **duration 0**.
- **Start-time correction.** Ben starts the workout at home by mistake, pauses for an hour, then resumes at the gym and edits the start to the arrival time. The hour of pause is still subtracted, so the duration is an hour short.

Impact: the summary and weekly duration are wrong, and the stored data can't be repaired later. Only the total is kept, not the pause intervals, so once SQLite persists these rows the true duration can't be recomputed. This is the same class as rule 6 ("don't invent data"): a 0-minute workout is invented data. The tests for S5 have no pauses, so this path is untested.

Fix:
- Store pause intervals (`pauses: {startUtc, endUtc}[]`) instead of, or alongside, `pausedTotalMs`.
- Compute the paused time as the overlap with `[startedAt, endedAt]` in Finish, in `update_session_timing`, and in `getActiveDurationMs`.
- Add tests for each case above.

---

## Major (non-blocking, fix before the UI slice builds on them)

### R2. Stale-card Finish with a paused work timer can't be completed as designed
`reducer.ts:609-613` (Finish refuses `paused` intervals), `:537` (Stop refuses while the session is paused)

A work interval can only be `paused` when the whole session is paused. In that state Finish returns `work_interval_running` and Stop returns `session_paused` (probe). The designer's (uncommitted) today.md says the stale sheet shows `Stop the timer first` with [Stop], "then the normal Finish". That [Stop] fails. A running interval almost never survives to the stale card, because `applyClock` completes it at its deadline. So the paused case is the main one this design covers, and it is the case that breaks. The only route that works is `Resume instead` → Resume (which restarts the timer and its cue) → Stop → Finish.

Fix: let `stop_work_interval` succeed while paused, with elapsed time = `pausedAtUtc − startedAtUtc − pausedMs` (no clock). Alternatively, let Finish on a paused session convert a paused interval's elapsed time into the draft. Add a test for "paused session + paused interval → Stop → Finish".

### R3. Infeasible equipment: the explanation says "bodyweight" for a weighted machine, and the decision is still `increase_reps`/`hold`
`packages/domain/src/progression.ts:127, 401-418, 490-495`

When `feasibleHold` returns null, `fmt(ctx, null)` → `formatLoad(null)` → `'bodyweight'`. Probe: cable stack with `minLoad: 100` (schema allows it), history 3 × 8 at 50 kg stack:
- `increase_reps`, load null, summary **`Add a rep: aim for 9 at bodyweight, because Cable stack has no achievable loads.`**
- With a miss, `hold`: **`Stay at bodyweight and work toward 8 reps on every set.`**

`loadFeasibility: 'infeasible'` is correct, but the text tells Ben to do a cable row at bodyweight. This is the remaining case of B3: an explanation that doesn't describe the prescription.

Fix: on `ctx.infeasible`, return a distinct decision (e.g. `no_feasible_load`) with text such as `Cable stack can't make any load with its current min/max; fix the equipment profile.` Never format a null load as "bodyweight" unless the convention is `bodyweight`. Add the hold-path case to the existing infeasible test.

### R4. Unilateral sides aren't seen by progression, so B2's "every prescribed set" rule can be met with one side
`progression.ts:23-29` (`HistorySet` has no `side`), `:164-166`, `:196`

Under the interim model the left and right sides are separate rows. Progression counts rows. Probes and reasoning:
- **Left only.** 3 planned rows logged as Left, Left, Left at the top of the range give 3 counted working sets → `increase_load`, though the right side was never trained.
- **Two sets per side.** L, R for two planned sets with the third skipped gives 4 counted sets ≥ 3 → can progress on two sets per side, which is the B2 situation ADR 0003 S3 forbids.

Separately, logging Left/Right onto planned rows consumes them: L, R, L on a 3-set plan reaches `all_done` with the right side done once (probe; volume shows `left 2, right 1`). The design's `Log right side ›` link avoids this by adding a set, but voice or manual side selection doesn't.

active-workout §2.9 promises that "Next time … says so if the domain reports it", but the domain reports nothing. ADR 0003 lists this as open, which is acceptable only if progression is honest about it.

Fix, either option:
- Add `side` to `HistorySet` and count `both` as one set per side, and L/R per side (progress only if each side meets the rule).
- Or, until then, have `calculateNextTargets` hold with a fact (`Left and right sets aren't compared yet; holding`) whenever any counted set is `left`/`right`.

Test both.

---

## Minor

1. **Deleting the active set jumps back to an earlier pending set.** `reducer.ts:742-756`. `repointActive` calls `nextPendingSet(current)` after `current` is deleted. Deleted sets are excluded from the execution order, so `indexOf` returns −1 and the search restarts from the top. Probe: Ben jumps past the warm-up to B1, logs it, then deletes B2 (active). The active set becomes **W (the skipped-over warm-up)**, not R1. Fix: compute the successor from the deleted set's position before removing it from the order.
2. **`add_set` with a `setType` override copies the last set's planned load and rest anyway.** `reducer.ts:770-782`; the schema comment at `commands.ts:158` says "unless `setType` is given". Probe: `Add warm-up` after the bench working sets gives a warm-up with planned 100 kg and the 180 s Heavy rest. Either copy from the last set of that type (falling back to empty planned values and the type's rest preset), or fix the comment and have the UI never pass a different type.
3. **After deleting the latest logged set, `undo_log` will undo an older set.** `latestCommittedSetId` skips deleted sets, so "Undo" (for example a voice "undo that") reverts the set before it. Consider treating a `deleted` audit entry as ending the undo window.
4. **`superseded` is computed for `log_set` only.** A duplicate `undo_log` after the set was re-logged, or a duplicate `delete_set`, reports `superseded: false`. That's fine for now; extend it before voice or coach tools issue those commands.
5. **The `add_exercise` fingerprint includes the catalogue snapshot and the resolved rest.** If the exercise's default rest or the profile unit changes between a failed attempt and its retry, the retry is rejected as `operation_id_reused` instead of being a duplicate. Fingerprint on `exerciseId` + `equipmentId` only, or document the behaviour.
6. **`add_exercise` doesn't check that the equipment kind is in the exercise's `compatibleEquipment`.** The service could reject, for example, a barbell exercise on a dumbbell rack (which would give a `per_hand` session exercise).
7. **Fact wording for top-set rules.** `No top sets were logged on … (all skipped)` is used when back-off sets were logged (and the test at `progression.test.ts:332` enshrines it). Say `(no top set)` instead when other sets exist.
8. **Undo while a work timer runs on another set.** Undo moves `activeSetId` to the undone set and leaves the interval running on the other set. That's harmless today; add a guard or a test when the timed UI is built.

---

## Developer deviations (asked to judge)

- **Content-keyed cache: agree.** It is strictly safer than `id` + `version`, because a stale list could put a target above a new maximum (rule 4), and the probe confirms in-place edits are seen. `stableStringify` of one instance per call is cheap next to the about 5 ms enumeration it replaces. Metadata (name, `updatedAtUtc`) is part of the key, so a rename causes a harmless miss.
- **Refusing Finish while a work timer runs: agree with the principle** (never commit implicitly, never lose elapsed time, Stop keeps it as a draft on the skipped set; tested). The implementation leaves the paused case unreachable from the designed stale-card flow (R2). Stop must work while paused for this decision to hold.
- **Interim unilateral model: agree for logging and volume.** `both` as the default keeps the one-tap Log, and L/R pairs never double-count in `summariseVolume`. It isn't yet safe for progression (R4), and the domain gives the UI no signal to say so.

## Durability and security notes

- **Failed saves:** `write_failed` is returned instead of throwing, and the retry with the same opId is a duplicate whether or not the write landed. Both cases are tested through the service.
- **Generated IDs:** `newSetId` and `newSessionExerciseId` are excluded from the fingerprint, so a retry after relaunch is a duplicate (tested).
- **Version guards:** `discard`, `finish` and `update_session_timing` check the session version. `delete_set` and `undo_log` check the set version.
- **No new credentials, network, logging or imported-content paths.**

## Spec issues

- **S6. Design revisions are uncommitted.** The flow, active-workout, rest-state and today revisions that align with ADR 0003 exist only in the working tree. Commit them, so the code and its spec move together.
- **S7. Brief changes still need Ben.** ADR 0003 is "Accepted by the product manager", but S1 (undo guard) and S3 ("every prescribed working set") change brief behaviour, and CLAUDE.md says Ben approves brief changes. The brief §3 and §7 wording and `docs/brief/CHANGELOG.md` are unchanged. Get Ben's approval and record it before the UI ships those behaviours.
- **S8. Stale-card Stop on a paused session (R2) is a spec–code mismatch.** today.md assumes Stop works there. Whichever way R2 is fixed, state in the flow §3.2 guards whether Stop is allowed while paused.
- **S9. Duration semantics with chosen times.** No spec says how pauses outside a corrected `[start, end]` window count. R1 assumes they're excluded (the only reading that can't produce 0). The design should state it in workout-summary §6.

---

# Third review (2026-10-08)

**Verdict: CHANGES NEEDED** (one blocker, T1; everything else is fixed or is a follow-up)

Scope: commits `cd6d0ab` to `a6cd7fd` (after "Add re-review of domain core: one new blocker"), plus the "Re-review decisions" section of ADR 0003. `npm run typecheck`, `npm run lint` and `npm test` all pass (11 files, 261 tests). I re-ran my earlier probes and added new ones in a scratch vitest config outside the repo. No source files were edited.

## Previous findings: status

| Finding | Status | Evidence |
|---|---|---|
| R1 duration with corrected times | **Fixed** | `session.pauses` holds unclipped intervals. `pausedMsWithin` (`view.ts:63`) clips each one to `[startedAt, endedAt]`. Finish and Discard close an open pause at the tap time. All three probes are tested (`timing-pauses.test.ts:34-118`), plus "end moved back out restores 61". |
| R1 probe value: 61 vs 62 | **61 is correct** | Window 0–63, pause 61→300, overlap 2 min, so 63 − 2 = 61. My "62" was an arithmetic slip. The rule is sound for Ben: he really was paused from 61 to 63, so any end he picks between 61 min and the tap time gives 61 min. The result is monotone, can only be 0 for a genuinely empty window, and can be recomputed from the stored originals. |
| R2 Stop while paused | **Fixed** | The interval ends at `pause.pausedAtUtc` and elapsed time excludes earlier pauses, capped at `durationS`. Stop doesn't resume the workout, and Finish then completes. Tested, including "Resume after Stop doesn't restart" and "Stop with no interval still refused". |
| R3 infeasible equipment | **Fixed** | `no_feasible_load` is checked after pain and before history. The summary names the equipment. `formatLoad(null)` is "no load" except for `bodyweight` and `added`. The hold, miss, skipped and no-history paths are tested. |
| R4 unilateral progression | **Fixed in progression**; new ordering bug in the reducer (T1) | `prescribedDone = both + min(left, right)`. Left-only gives `None of 3 …`; 2 per side gives 2 of 3; the lagging side is named; mixed sided and unsided sets are unpairable. Planned rows are no longer consumed: Left, Right, Left leaves three other-side rows pending. |
| Minor 1 delete active set | **Fixed** | `nextPendingSet(…, orderFrom = state.sets)`. Probe B1 → delete B2 now lands on R1. |
| Minor 2 add_set type | **Fixed** | Copies the last live set of that type, and refuses when there is none. |
| Minor 3 undo after delete | **Fixed** | A `deleted` entry whose `before.status` is `completed` ends the window. Tombstoned pending companions (whose `before` is pending) correctly don't end it. |
| Minor 4 superseded | **Fixed** for `undo_log` and `delete_set` | |
| Minor 5 add_exercise fingerprint | **Fixed** | `exerciseId` + `equipmentId` |
| Minor 6 equipment compatibility | **Fixed** | `equipment_incompatible`, also checked through the service |
| Minor 7 top-set fact wording | **Fixed** | `(no top set)` / `(only other set types)` |
| Minor 8 undo while timer runs | **Fixed** | Refused with `work_interval_running` |
| S6 design revisions | **Resolved** (`dae19bf`, and the docs now carry the re-review revisions) | |
| S8, S9 | **Resolved** in flow §3.2 and workout-summary §6 and §187 | |

---

## Blocking

### T1. After the other side of a set is logged (or deleted), the active set jumps to the next exercise, skipping that exercise's remaining sets
`packages/domain/src/session/reducer.ts:373-378` (`makeCompanion`: `index = max + 1`), `:328` (`nextPendingSet(set.id, …)` after logging the companion), `packages/domain/src/session/order.ts:40-56` (execution order is by `index`), and `:855` (`repointActive` on delete)

The companion row is appended at the end of the exercise's list, so in execution order it sits after every other set of that exercise. Logging it makes it active, which is correct. When the companion itself is logged, `nextPendingSet` searches forward from the companion's position. That position is the last of the exercise, so the search lands on the next exercise and only wraps back to the remaining sets after everything later.

Probes (scratch tests, fixtures from `unilateral.test.ts`):
- **Plain exercise.** Split squat ×3 (both), then Bench. Ben logs set 1 Left; active = `Split squat#3/right` (correct). He logs the right side; **active = `Bench press#0`**, with split squat sets 2 and 3 still pending. Order: `SS#0/left, SS#1, SS#2, SS#3/right(pair), Bench#0`.
- **Superset.** One-arm cable row (unilateral) + Face pull, 2 rounds, then Bench. A1 Left → right companion (15 s transition), then right logged → **active = `Bench press#0`**, skipping Face pull round 1 and the whole of round 2. The 90 s rest is also started as if the round had ended.
- **Deleting the other side** (the injured-side case the design allows): delete the pending companion → **active = `Bench press#0`**.

This is the default per-side flow: Left, then the prefilled Right, then expect set 2. Every time, the "Up next", the one-tap Log target and the rest kind point at the wrong exercise. In a superset it also breaks the round structure. No data is lost, and the wrong order is recoverable by tapping a set. But it is a set-order correctness bug in the main path of the feature added to fix R4, so I'm blocking on it. The existing tests miss it: `unilateral.test.ts` logs `s2` explicitly after `r1` and only asserts that the active set is *some* pending split-squat row.

Fix: make a companion follow its paired set in execution order, rather than taking a later `index` slot:
- In `buildExecutionOrder`, emit each live companion immediately after its `pairedWithSetId` set, or after its pair's position when that set is deleted.
- In `isRoundEnd`, treat a companion as belonging to its paired set's round. Then Left → Right → partner exercise (superset) or set 2 (plain).
- `nextPendingSet`, `repointActive`, "Up next" and the rest kind all follow from the order. Leave `index` for display, or renumber it.

Add tests for:
- plain: L → R → active is set 2;
- superset: A1 L → A1 R → active is B1, and the rest is transition;
- deleting a pending companion → set 2;
- Left, Right, Left in order, asserting the exact active-set sequence.

(See also spec issue T-S1: the spec wording "sits at the end of this exercise's list" causes this.)

---

## Follow-ups (non-blocking, later slices)

1. **Lagging-side wording for effort.** `progression.ts:487-490` produces `The right side reached 8+ reps on every set but the left side didn't (effort above the limit)`, but the left side did reach 8+. Phrase it as "met the progression criteria" or "reached 8+ reps within the effort limit". The test at `progression.test.ts:546` enshrines the current text.
2. **Orphaned completed companion.** Deleting the original Left set after its Right companion was logged leaves a completed `right` row with `pairedWithSetId` pointing at a tombstone. Volume (`right 1, left 0`) and progression (hold, right side ahead) both handle it honestly. The UI should still not show a "pair" badge to a deleted set. This sits alongside the side-correction gap already Open in ADR 0003.
3. **Rest between sides.** A Left log starts the full set rest before the Right side (by design, active-workout §2.9: "Rest keeps running"). Many lifters go straight to the other side. Worth confirming with Ben on device. A `transition`-kind rest (or 0) between the sides of a pair may fit better. Revisit with T1's round handling.
4. **`superseded` for the remaining commands** (Open in ADR 0003). Needed before voice or coach tools issue `correct_set`, `skip_exercise` and so on.
5. **HistorySet mapping.** No WorkoutSet → HistorySet mapper exists yet. When the persistence slice adds one, it must carry `side`, and test it. A dropped `side` (null) on unilateral rows would make every sided session look unpairable, or count L/R rows as separate sets again.
6. **Stop while paused leaves the session paused.** That's correct per ADR. The stale card should make it obvious that Finish is now available, not Resume (UI copy, not domain).

## Regression check
- Pause/Resume of rest and work timers, clock catch-up, recovery tick, undo order, duplicate detection, Finish bounds, start normalisation and volume all still pass their earlier tests, and my earlier probes for M3, M6, M7 and B1–B3 give the same results.
- The minor 1 change (`orderFrom`) only affects searches whose start set has left the order. Other callers pass the default.
- `deriveId` produces a valid v8 UUID (aggregate schema round-trip tested). The seed is set ID + opId, so a retry derives the same companion and a re-log after undo derives a new one. There is a collision guard.
- `undo_log` restores the pre-log side and tombstones the pending companion under the same opId (audited, `SetDeleted` event). `delete_set` cascades the same way. Neither cascade ends the undo window.

## Durability and security
- **New persisted fields:** `pauses`, `pairedWithSetId`, `compatibleEquipment`, `HistorySet.side`. Nothing is persisted yet, so no migration is needed.
- **Pause intervals:** stored unclipped with the original start and end in `timingAudit`, so corrections stay reversible.
- **No new credentials, network, logging or imported-content paths.**

## Spec issues
- **T-S1. Companion placement.** active-workout §2.9 says the other-side set "sits at the end of this exercise's list and becomes the next active set". It doesn't say what comes after it. Taken literally, the end-of-list position is what sends the next set to the following exercise (T1). Change it to: "It is performed immediately after its paired set (same superset round); after it, the order continues with the next set after the pair."
- **S7 (still open).** Ben's approval and `docs/brief/CHANGELOG.md` entries are still missing for:
  - S1 (undo guard);
  - S3 ("every prescribed working set");
  - the R4 pairing rule (a Left + Right pair is one prescribed set, and the load goes up only when both sides qualify).

  These change brief §3 behaviour. Record them before the UI ships.

---

# Final review (2026-10-08)

**Verdict: PASS**

Scope: commits `3bfb6f8` to `93d39e1` (after "Add third review of domain core: one blocker (T1)"), plus the "Third review decisions" section of ADR 0003. `npm run typecheck`, `npm run lint` and `npm test` all pass (13 files, 273 tests). I checked the new tests against the old logic in a detached worktree in the scratchpad, and ran extra probes there. No source files were edited.

## Previous findings: status

| Finding | Status | Evidence |
|---|---|---|
| T1 other-side order | **Fixed** | `unitsOf` (`order.ts:35-45`) groups each set with the live other-side rows paired to it. `buildExecutionOrder` emits unit by unit, so a superset round is a unit, not a single row. `isRoundEnd` finds the round by unit. `nextPendingSet`, `repointActive` and the rest kind all follow from this. |
| Follow-up 1 lagging-side wording | **Fixed** | `progression.ts:486-494`: the effort case now reads "…reached 8+ reps with effort above the limit". The test enshrines the new text. |
| Follow-up 2 orphaned other side | **Fixed** (domain side) | `getSetPair` (`view.ts:164`) returns null once either side is deleted. `pairedWithSetId` stays on the completed row as provenance, which is the right call under rule 2. An orphan keeps its partner's old position in the order. |
| Follow-up 4 `superseded` | **Fixed** | `isSuperseded` (`reducer.ts:1128`) is now an exhaustive `switch` over command types (typecheck enforces this), and each "always false" case is documented. `createdIds` is recorded for `add_set`, so a retry with a regenerated `newSetId` still finds the original row. |
| Follow-ups 3, 5, 6 | Recorded as open in ADR 0003 (3 and 5) or as design copy (6) | |

## T1 probes, re-run

All of these give the expected result. The developer's `companion-order.test.ts` asserts each one exactly:
- **Plain exercise.** Split squat ×3. The sequence L → R → set 2, then L → R → set 3, then L → R → Bench.
- **Superset.** One-arm row (unilateral) + Face pull, 2 rounds. A1 L → A1 R → B1 → A2 L → A2 R → B2 → Bench. Rests are `transition 15, transition 15, rest 90` for each round.
- **Deleting the pending other side.** Plain → set 2. Superset → Face pull 1, the same round.
- **Out-of-order logs.** Set 2 is logged Left before set 1 Right. The order is `1R, 1L, 2L, 2R*, 3, Bench`.

**Tests fail against the old logic, as claimed.** I swapped in each old file from `fdb30f1` with everything else at HEAD:
- Old `order.ts`: all 6 order and orphan tests in `companion-order.test.ts` fail.
- Old `progression.ts`: the 2 lagging-side wording tests fail.
- Old `reducer.ts`: all 4 `superseded` tests fail (`correct_set`, `skip_exercise`, `add_set`, `update_session_timing`).

## Extra regression probes (scratch only)

- **The unilateral exercise is the *last* superset member** (Face pull, then One-arm row). The order is right: F1 → R1 L → R1 R → F2 → R2 L → R2 R → Bench. The rest between the two sides is the full 90 s, because the row is at the round's end. See follow-up F1 below.
- **Uneven superset** (unilateral A ×3, B ×2). The order is A1 L, A1 R, B1, A2 L, A2 R, B2, A3 L, A3 R, Bench. Under the old index order the other-side rows also shifted the round alignment. That no longer happens.
- **Deleting a single-side set while its other side is pending.** The other side is tombstoned under the same opId, and the active set becomes set 2.
- **Undoing the first side after the other side was logged** is refused (`not_latest_set`). A second other-side row can't be created by undo and re-log.
- **Chains.** An other-side row never gets its own other-side row (`reducer.ts:307` requires `pairedWithSetId === null`). `add_set` always writes `pairedWithSetId: null`. Every live row therefore belongs to exactly one unit, so nothing drops out of the order.
- **`index` users.** The other places that read `index` (`add_set`'s `last`, `prefillDraft`'s comparable-set match) don't depend on execution order. Other-side rows have a draft, so prefill uses the draft.
- **Undo window, timers, duplicate detection, Finish bounds and volume.** All the earlier tests still pass unchanged.

## Blocking

None.

## Follow-ups (non-blocking, later slices)

1. **F1. Rest between sides when the unilateral exercise ends a superset round.** ADR 0003 says that inside a superset the rest between sides "is the transition rest". That holds only when a later member follows in the round. When the unilateral exercise is the last member, `isRoundEnd` is true for the first side, so a full rest runs before the other side. This is the same product question as follow-up 3. Correct the ADR's statement and settle both cases together with Ben.
2. **F2. Design copy is not yet updated for the ADR table rows.**
   - `workout-summary.md` (§5 row and the "Held (side lagging)" example) still ends with `; holding.`, but the domain text ends with `; the load goes up only when both sides do.` Make them match. Better still, have the UI show the domain fact verbatim.
   - The pair-badge rule (`getSetPair`) is not in `active-workout.md` yet.
   - The "after Stop on a paused workout" stale-card copy is not in the spec yet.

   The ADR assigns all three to the designer.
3. **F3. `index` no longer matches the order sets are performed in.** The UI must order rows with `buildExecutionOrder` and must not sort by `index`. When the UI slice lands, add a short note to the schema comment on `WorkoutSet.index`, or a lint rule or test.
4. **F4. Superset round when a member exercise has `transitionRestS`.** This is not new. If the exercise that ends a round has `transitionRestS` set and has no more sets, it gets the transition instead of the full round rest, even though other members still have rounds to go. Example: B2 in an A×3 / B×2 superset. This only happens with uneven supersets and per-member transitions. Check it when supersets are built in the UI.
5. Carried over: follow-up 5 (the `HistorySet` mapper must carry `side` and use `getSetPair`), side corrections on other-side rows, and S7 (Ben's approval and `docs/brief/CHANGELOG.md` entries for S1, S3 and the R4 pairing rule).

## Durability and security
- **New persisted field:** `ProcessedOperation.createdIds` is optional and capped at 4. Older records without it parse, and `add_set` duplicates on those records just report `superseded: false`. Nothing is persisted yet, so no migration is needed.
- **No new credentials, network, logging or imported-content paths.**

## Spec issues
- **T-S1 is resolved** (`3bfb6f8`).
- **S7 is still open** (see follow-up 5).
