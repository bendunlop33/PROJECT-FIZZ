# 0003: Decisions from the domain-core review

**Status:** Accepted by the product manager, 2026-10-08. Ben may revise S3. Implements `docs/reviews/domain-core.md` (B1–B3, M1–M8, spec issues S1–S5).

## Context
The domain-core review (verdict CHANGES NEEDED) found three blocking bugs, eight major issues and five places where the brief and the design specs were ambiguous or contradicted each other. The product manager decided the spec issues. This ADR records those decisions, the implementation choices made while fixing the findings, and the exact doc wording the designer should change. The developer did not edit `docs/design/` or the brief.

## Product decisions (from the product manager)

### S1. Undo is guarded on the set's own version and commit order
`undo_log` carries `expectedSetVersion` (the version the UI currently shows), not the session version. It also requires the set to be the latest commit still in effect, judged by commit (audit) order rather than the client timestamp. So Log → RPE chip → Undo works within the 8 s toast. Session-version staleness still applies to coach proposals, `set_active_set`, `finish`, `discard` and `update_session_timing`.

### S3. Double progression needs every prescribed working set
A double-progression rule only progresses (load or reps) when **all** `workingSets` were completed at or above the top of the rep range within the effort limits. Otherwise it holds, with a fact such as `Only 1 of 3 working sets was logged on 2026-10-01; holding.` A session where everything was skipped becomes the latest session and holds at the last performed load (`No working sets were logged on … (all skipped); holding.`). Top-set rules need at least one top set. This is a conservative default that Ben may revise.

### B1. Planned loads always match the session exercise
`planTemplateLoad` normalises each template load to the session exercise's unit and convention:
- **Convention differs:** never converted (no machine-to-free-weight equivalence). The planned load is null and a `target_dropped` warning keeps the template value. The draft then falls back to history or stays empty.
- **Equipment present:** the template is rounded toward easier to an achievable load, with an explicit unit conversion. The rounded load is used even on an exact hit.
- **No equipment, unit differs:** converted only when the result is exact at display precision (`LOAD_DISPLAY_STEP` = 0.01). Otherwise the planned load is null and a `target_dropped` warning is raised (`unit_not_convertible`). In practice nearly every kg↔lb template is dropped here.
- `prefillDraft` also refuses fallback history in another unit or convention.
- A rule's `startingLoad` with no equipment follows the same "exact or not at all" rule.

### Conservative interpretations (S2, S4, S5)
Each takes the most conservative reading: never commit a set implicitly, never lose a timer expiry, keep original timestamps.

- **S2 (Skip):** Skip is `skip_rest` → `endRestTimer(timerId, 'skipped')`, as rest-state §4.3 says. It is not `adjustRestTimer` to zero. A −30 s that reaches zero is an expiry (Ended, cue plays); Skip is not.
- **S4 (Finish with a work timer running):** Finish is **rejected** (`work_interval_running`) while a work interval is running or paused. Ben stops it first. Stop then fills the elapsed time as a draft, and he can Log it or leave it. If he finishes without logging, the set is marked skipped but keeps the draft, so the elapsed time isn't lost. Discard is different: it is an explicit, confirmed throw-away of the whole workout, so it cancels a running interval.
- **S5 (End-time correction):** one contract with two entry points:
  - `finishWorkout(sessionId, expectedVersion, endedAt?)` takes the end time chosen on the finish sheet in the same transaction. `endedAt` must lie between the last completed set and the tap time. When it differs from the tap time, the tap time is kept as `before` in a `timingAudit` entry (`source: 'finish'`).
  - Later edits ("Edit workout times", the summary's Edit, the stale card) use `updateSessionTiming(sessionId, expectedVersion, {startedAt?, endedAt?})`. Each changed field adds a `timingAudit` entry with the previous value (`source: 'correction'`). `endedAt` can only be edited after Finish. Nothing may move into the future or outside the logged sets.

## Implementation decisions (developer)

- **M3 duplicates:** reduce results carry `superseded: true` when a duplicate's effect is no longer in place (e.g. a repeated `log_set` after Undo). Voice and coach tools must report "not saved" in that case.
- **M4 commands:** `add_set`, `add_exercise`, `delete_set`, `skip_exercise`, `discard` and `update_session_timing` are in the union, with handlers.
  - Caller-generated IDs (`newSetId`, `newSessionExerciseId`, like `restTimerId`) are excluded from fingerprints, so a retry after relaunch is a duplicate.
  - `add_exercise` carries a catalogue snapshot built by `buildAddExerciseCommand`. The service's `addExercise` resolves it from the repositories; tools must use that call rather than supplying a snapshot.
  - Deleted sets stay as audited tombstones (`status: 'deleted'`). They are excluded from execution order, history and volume. This makes the design's "Delete set → Undo" a small later addition.
  - An empty workout's phase is `empty`, not `all_done`. A set added while nothing is active becomes active.
- **M5 unilateral:** `SessionExercise.laterality` is snapshotted, and every set has `side`: `left`, `right`, `both` or null (bilateral).
  - Unilateral sets default to `both`, meaning the values are per side ("10 each side"). Ben can log a set as left or right instead.
  - `summariseVolume` counts a `both` set once with per-side reps, and a left/right pair as one set using the busier side, never the sum.
  - Open for design: how the set card offers per-side entry.
- **M6:** a rejected command still returns the clock-caught-up state. The service persists it, so an expiry is never lost. `stop_work_interval` after the interval completed is a no-op success.
- **M8:** achievable loads are memoised by the equipment's **full content**, not `id` + `version` as the review suggested. Fixtures (and potentially a careless editor) can change an instance without bumping its version, and a stale list could put a target above a new maximum (rule 4). Hashing the content costs microseconds; recomputing the loads cost about 5 ms.
- **Service errors:** a thrown save is reported as `write_failed` (the design's "Couldn't save this set. Your entry is still here.") instead of rejecting. Retrying with the same opId is safe whether or not the write landed.
- **Progression feasibility:** equipment that can make no load (e.g. `minLoad` above every position) prescribes no load and reports `loadFeasibility: 'infeasible'`. Explanations always name the prescribed load. A historical load that isn't on the equipment is reported as a fact.

### Which commands bump which counter (review nit 9)
| Command | `session.version` (content; proposals bind to it) | `revision` (storage) |
|---|---|---|
| `log_set`, `correct_set`, `undo_log`, `set_active_set` (when it changes), `finish`, `discard`, `update_session_timing`, `add_set`, `add_exercise`, `delete_set`, `skip_exercise` (when it skips anything) | bumps | bumps |
| `start_work_interval` | bumps only if it moves the active set | bumps |
| `adjust_rest`, `skip_rest`, `stop_work_interval`, `pause`, `resume`, `save_draft`, `tick` (when a timer expires) | no | bumps |
| Rejected command whose clock catch-up expired a timer | no | bumps |

## Doc wording the designer should change

| Doc | Current wording | Change to |
|---|---|---|
| flow-first-milestone §3.2, Undo row, guard | "The set is still the latest and the session version matches" | "The set is still the latest commit (by commit order) and its version matches the one shown (`expectedSetVersion`)" |
| flow-first-milestone §3.2, Resting / `Skip` row, effects | "`adjustRestTimer` to zero (status `skipped`), then `cancelObsoleteCues`" | "`endRestTimer(timerId, 'skipped')`, then `cancelObsoleteCues`. No rest-end cue" |
| flow-first-milestone §3.2, Finish row, guard | "none" | "No work timer running or paused (stop it first; its time becomes the draft)" |
| flow-first-milestone §3.2, Finish row, effects | "`finishWorkout(sessionId, expectedVersion)`: pending sets → skipped, optional end-time correction, then `cancelObsoleteCues`" | "`finishWorkout(sessionId, expectedVersion, endedAt?)`: pending sets → skipped; `endedAt` between the last set and now; the tap time is kept in the timing audit; then `cancelObsoleteCues`" |
| flow-first-milestone §4.1, Finish row | "`endedAtUtc`, skipped markers, optional timing correction with audit, then the summary" | "`endedAtUtc`, skipped markers, and a timing-audit entry keeping the tap time if a different end time was chosen; then the summary" |
| flow-first-milestone §3.3, Timed exercise | (add) | "Finish is not available while the work timer runs; Stop first." |
| active-workout §4.8, third bullet | "The chosen time is recorded through `updateSessionTiming` with an audit, and the original value is kept." | "The chosen time is passed to `finishWorkout` in the same transaction. When it differs from the tap time, the tap time is kept in the timing audit." |
| active-workout §4.8, last bullet | "`Finish` calls `finishWorkout(sessionId, expectedVersion)`" | "`Finish` calls `finishWorkout(sessionId, expectedVersion, endedAt)`" |
| active-workout §4.8, new bullet | (add) | "If a work timer is running, the finish sheet shows `Stop the timer first` with a [Stop] action instead of Finish." |
| active-workout §6 and workout-summary §6 | "`finishWorkout(sessionId, expectedVersion)`, `updateSessionTiming(sessionId, correction)`" | "`finishWorkout(sessionId, expectedVersion, endedAt?)`, `updateSessionTiming(sessionId, expectedVersion, {startedAt?, endedAt?})` (end time only after Finish)" |
| today.md §6 | "`finishWorkout` + `updateSessionTiming` for the stale card's Finish." | "`finishWorkout(…, endedAt)` for the stale card's Finish (the chosen time goes in the same call)." |
| active-workout §3, All sets done row / §4.4 | (add) | "An empty workout shows `Add an exercise to start` (phase `empty`), not `All planned sets done`." |
| Brief §3 (progression) | "Progress only when chosen rep and effort criteria are met." | "Progress only when every prescribed working set was completed and the chosen rep and effort criteria are met; otherwise hold and say why." (needs Ben's approval and a CHANGELOG entry) |
| Brief §7, `finishWorkout` row | "`finishWorkout(sessionId, expectedVersion)`" | "`finishWorkout(sessionId, expectedVersion, endedAt?)`" (CHANGELOG entry) |

S1 and S3 change product behaviour described in the brief and flow spec. They need a `docs/brief/CHANGELOG.md` entry once Ben approves.

## Consequences
- The prefilled one-tap Log can no longer be rejected for unit or convention. When the template can't be honoured, Ben sees an empty field (`Enter load`) and a warning, never a wrong number.
- Persisted aggregates gained `timingAudit`, `SessionExercise.laterality`, `WorkoutSet.side` and the `deleted` set status. No data has been persisted yet, so no migration is needed.
- **Open:**
  - Undo of a correction, of a delete and of skip-exercise
  - "This rest only" rest edits
  - Unilateral sides in progression history
  - Per-plate units (kg bar with lb plates; nit 7)
  - Validating aggregates read by the SQLite adapter (nit 8)
  - With no equipment, a rule's `loadIncrement` in another unit is still converted approximately (e.g. 2.5 kg → 5.51 lb) and marked `unchecked`
