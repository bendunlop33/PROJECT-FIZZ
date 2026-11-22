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

## Re-review decisions (2026-10-08)

Implements the "Re-review after fixes" section of `docs/reviews/domain-core.md` (R1–R4, minors 1–8, spec issues S8 and S9). Product decisions are from the product manager; implementation choices are the developer's.

### Product decisions

- **R1 / S9. Duration with corrected times.** The session stores every pause as a closed interval (`session.pauses: {startUtc, endUtc}[]`, plus the open `pause`), never just a running total. `pausedTotalMs` is removed. Active duration = (end − start) − the paused time that overlaps the current `[startedAt, endedAt]` window. Pauses fully outside the window are ignored; partial overlaps are clipped. The stored intervals are the unclipped originals, and `timingAudit` keeps the original start and end, so any later correction can be recomputed from the original record.
- **R2 / S8. Stop while paused.** `stop_work_interval` is allowed while the session is paused. The interval ends at the moment the pause began (elapsed = pause start − interval start − earlier paused time), so paused time is never counted as work. Stop does not resume the workout. The stale card's Stop → Finish path now completes.
- **R3. Equipment with no achievable loads.** `calculateNextTargets` returns the decision `no_feasible_load`, no load, `loadFeasibility: 'infeasible'`, and the summary `<Equipment> can't make any load with its current min/max settings, so no <exercise> target is set. Fix the equipment profile.` A pain flag still takes precedence (`halted_pain`). A null load is formatted as "bodyweight" only for the `bodyweight` convention (and `added` with nothing added); otherwise it reads "no load".
- **R4. Unilateral progression.** `HistorySet` carries `side`. Each side is evaluated on its own sets plus `both` sets. A `both` set counts as one prescribed set, and a Left + Right pair counts as one prescribed set, never two. "Every prescribed working set" means each prescribed set has both sides (or a Both) result meeting the criterion. The load goes up only when both sides qualify. If they differ, hold and name the lagging side (`The left side reached 8+ reps on every set but the right side didn't (lowest 7 reps); …`). Unequal side counts hold with `Only 2 of 3 working sets had both sides logged on … (left 3, right 2: the right side is behind); holding.` Mixed sided and unsided sets hold as unpairable.

### Implementation decisions (developer)

- **R4 planned-row consumption: other-side rows.** Logging a prescribed unilateral set as Left (or Right) adds a pending row for the other side. It has `pairedWithSetId` = the logged set, the same planned values and rest, and the logged values as its draft (no effort). It sits at the end of the exercise's list and becomes the next active set. So Left, Right, Left on three planned rows leaves three other-side rows pending, and the exercise is not done until each prescribed set has both sides.
  - The other-side row only accepts its own side. Undoing the single-side log, or deleting the logged set, tombstones the still-pending other-side row (audited as `deleted` under the same opId). Undo also restores the set's side from before the log (normally `both`). Deleting only the other-side row is allowed (e.g. one side injured).
  - Its ID is derived deterministically (`deriveId`, a UUID v8 from the set ID and opId), so a retried log on the same state yields the same row and a duplicate never adds a second one. No command field was added.
  - Corrections that change a set's side do not add or remove other-side rows (Open).
- **Minor 1:** the successor of a deleted active set is searched from its old position in the execution order.
- **Minor 2:** `add_set` with a `setType` copies the last live set of that type; with none, it is refused (`set_not_found`) instead of inventing a target or rest. Without a type, it copies the last live set as before. The design never passes a type, so nothing changes for the UI.
- **Minor 3:** deleting a logged set ends the undo window; deleting a pending set doesn't.
- **Minor 4:** `superseded` is also computed for duplicate `undo_log` (the set is no longer pending) and `delete_set` (the set is no longer deleted). Other commands still report `false`.
- **Minor 5:** the `add_exercise` fingerprint is `exerciseId` + `equipmentId` only.
- **Minor 6:** the exercise snapshot carries `compatibleEquipment`; `add_exercise` on an incompatible kind fails with `equipment_incompatible`.
- **Minor 7:** a top-set rule with only back-offs logged says `(no top set)`, not `(all skipped)`.
- **Minor 8:** `undo_log` is refused (`work_interval_running`) while a work timer runs or is paused on another set.

### Note on the reviewer's R1 probe numbers
The review says the probe (last set 60 min, Pause at 61, Finish at 5 h, end edited to 63) "should be 62 min". Under the decided overlap rule it is **61 min**: the window is 0–63 and the pause overlaps it from 61 to 63, so 63 − 2 = 61. The test asserts 61. The same applies to the Finish-after-Resume probe (61 min).

### Doc wording the designer should change

| Doc | Current wording | Change to |
|---|---|---|
| active-workout §2.9, "The other side" bullet | "That link calls `addSet` then `setActiveSet` on the new set, with the side preset to Right and the same values in the draft." | "The domain has already added the right side as a pending set (same values drafted) and made it active; the link just scrolls to it. Undo of the left log removes it." |
| active-workout §2.9, "Open" bullet | "sides aren't yet used by progression …" | "Progression evaluates each side; a Left + Right pair is one prescribed set; if the sides differ, `Next time` holds and names the lagging side." |
| flow-first-milestone §3.2, Stop row, guard | (none stated) | "Allowed while paused: the interval ends when the pause began" |
| workout-summary §6 | (add) | "Duration = end − start − paused time inside that window. Pauses outside a corrected start or end are not subtracted." |
| active-workout / Next time copy | (add) | "`no_feasible_load`: `<Equipment> can't make any load with its current min/max settings. Fix the equipment profile.` with [Update gym]" |

### Consequences
- Persisted aggregates changed again: `session.pauses` replaces `pausedTotalMs`; `WorkoutSet.pairedWithSetId`; `ExerciseSnapshot.compatibleEquipment`; `HistorySet.side`. Nothing is persisted yet, so no migration is needed.
- "Unilateral sides in progression history" is no longer Open.
- **Open:** side corrections and other-side rows; `superseded` for the remaining commands; Ben's approval of S1/S3 (and now R4's pairing rule) as brief changes, with a `docs/brief/CHANGELOG.md` entry.

## Third review decisions (2026-10-08)

Implements the "Third review" section of `docs/reviews/domain-core.md` (T1, follow-ups 1, 2 and 4). Follow-ups 3, 5 and 6 are recorded below and not implemented.

### Implementation decisions (developer)

- **T1. Other-side order.** `buildExecutionOrder` groups each other-side row with the set it is paired with, so it is performed immediately after its partner and belongs to the same superset round (`isRoundEnd`). After the pair, order continues normally: plain `L → R → set 2`; superset `A1 L → A1 R → B1` with the transition rest, then the full rest after B1. Deleting the pending other side continues with the next set in that order. A logged other side whose partner was deleted stays at the partner's old position. `index` is unchanged (it only keeps indexes unique); display order should come from `buildExecutionOrder`. Tests assert the exact active-set sequence (`companion-order.test.ts`).
- **Follow-up 1. Lagging-side wording.** Effort case: `The right side reached 8+ reps on every set within the effort limit, but the left side reached 8+ reps with effort above the limit; the load goes up only when both sides do.` Reps case: `The left side reached 8+ reps on every set within the effort limit, but the right side didn't (lowest 7 reps); …`.
- **Follow-up 2. Orphaned other side.** Deleting the original single-side set after its other side was logged no longer presents them as a pair. `getSetPair(state, setId)` returns the live partner and role (`first_side` / `other_side`), or null when either side is deleted; the UI's pair badge must use it. `pairedWithSetId` is kept on the completed row as provenance: changing it would silently modify a completed set, and the set snapshot in the audit doesn't carry it.
- **Follow-up 4. `superseded` for the remaining commands.** Also computed for `correct_set` (the set changed after this correction, or is no longer completed), `skip_exercise` (a set it skipped was since deleted), `add_set` (the set it added was deleted; `ProcessedOperation.createdIds` records the added set because the retry may carry a regenerated `newSetId`), and `update_session_timing` (a later edit replaced a value it set). Always `false`, with reasons in the `isSuperseded` doc comment: `finish` and `discard` (terminal), `add_exercise` (an exercise can't be removed), and transient navigation and timer commands (`set_active_set`, rest, work interval, pause, resume).

### Left open

- **Follow-up 3. Rest between sides (product question for Ben).** A Left log on a plain exercise still starts the full set rest before the Right side; inside a superset it is the transition rest. Confirm on device whether the rest between the two sides of a pair should be a transition (or 0).
- **Follow-up 5. HistorySet mapping (TODO for the persistence slice).** No `WorkoutSet → HistorySet` mapper exists yet. When it is added it must carry `side` (a null side on unilateral rows makes every sided session unpairable or double-counts L/R rows) and should use `getSetPair` rather than raw `pairedWithSetId`. Test both.

### Doc wording the designer should change

| Doc | Current wording | Change to |
|---|---|---|
| active-workout §2.9, other-side set (T-S1) | Done in `3bfb6f8` | (no further change) |
| active-workout §2.9 / pair badge | (add) | "The pair badge shows only while both sides exist (`getSetPair`); if one side is deleted, the other is shown as a standalone set." |
| workout-summary §5 row "Next time: held, side lagging" and §150 example | "`The left side reached 8+ reps on every set but the right side didn't (lowest 7 reps); holding.`" | "`The left side reached 8+ reps on every set within the effort limit, but the right side didn't (lowest 7 reps); the load goes up only when both sides do.`" |
| Stale card after Stop while paused (follow-up 6) | (add) | "After Stop on a paused workout, the card makes clear that Finish is now available; the workout stays paused (Resume is still offered but not the primary action)." |

### Consequences
- Persisted shape: `ProcessedOperation.createdIds` (optional). Nothing is persisted yet, so no migration is needed.
- "`superseded` for the remaining commands" is no longer Open.
- **Still open:** side corrections and other-side rows; follow-ups 3 and 5 above; Ben's approval of S1/S3 and the R4 pairing rule as brief changes, with a `docs/brief/CHANGELOG.md` entry.
