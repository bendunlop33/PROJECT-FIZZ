# Review: Ben's 8 decisions of 23 Oct 2026 (da0ac06..a5d1f53)

**Verdict: CHANGES NEEDED**

Scope: commits `6d815f5`..`a5d1f53` on `claude/gracious-knuth-joxqpw`. These cover the rule stall reset as an offer, the unasked extra set as an offer, the time-fit carry-over, back-offs following a coach top, Mix it up on Your workout, ⋯ Save as a variation, the Summary main-lift row, plus the coarse-kit and goal-band tests. Decision 8 (`future Pulls`) was already in place before this range (`packages/domain/src/review/progress-page.ts:1086`, tested in `progress-page.test.ts:714`).

What I ran:
- `npm run typecheck`: passes.
- ESLint on every changed `.ts`/`.tsx` file: clean.
- Vitest on the 20 changed test files plus `progress-page.test.ts`: 21 files, 450 tests, all passing.
- Three throwaway probe tests on real SQLite, written to the scratch harness and deleted afterwards. Their results are quoted below.

## Blocking

### B1. Once Ben answers the rule's reset, the coach's Summary review for that workout fails silently, for every exercise

- **Where:**
  - `packages/coach/src/executors.ts:63`: `ruleResetRowId` gives the rule row its own ID.
  - `packages/persistence/src/schema/0006-coach.ts:128`: `CREATE UNIQUE INDEX next_session_targets_one ON next_session_targets (owner_id, source_session_id, exercise_id)`.
  - `packages/persistence/src/coach.ts:503-507`: the coach write looks up the coach row ID, finds nothing, and INSERTs.
  - `apps/mobile/src/coach/coach-service.ts:2036`: `.catch(() => null)`.
- **What happens:** The rule's answer row (`origin: 'rule'`) and the coach's row share the table and its one-row-per-(source, exercise) unique index, but they have different IDs. When the coach review tries to save a target for an exercise Ben already answered, the INSERT throws a SQLite UNIQUE error. That error is not a `Rollback`, so `commit` rethrows it, and `runSummaryTurn` swallows it as `null`:
  - No note.
  - No targets for any exercise, not just the one that clashed.
  - No error state on screen.
  - Every retry fails the same way.
- **Repro (probe, real SQLite):**
  1. Use the coach-fallback "Bench 62.5 × 3–6" case and finish two short workouts offline, so the Summary offers `Reset to 55 kg × 3–6?`.
  2. Run `tapRuleReset(..., 'apply')`.
  3. Go online and run `runSummaryTurn(thirdId)` with the model calling `set_next_session_targets` for Bench at 57.5 kg.
  4. Result: the turn returns `null` and `coach.nextTargets` is `[]`.
  5. Control: the same run without step 2 gives a `completed` turn and a `proposed` 57.5 kg row.
- **Why it matters:** This is the normal online flow. The reset row can be tapped while the Summary shows `Coach reviewing…` (`next-time-view.ts:136`: the rule row is shown whenever no coach row exists yet). Offline Apply followed by a later review hits the same failure. It breaks rule 1 (the AI's status is not shown honestly: the review just disappears) and loses the coach's other exercises' targets.
- **Fix:** Pick one of these:
  - (a) Store Ben's reset answer somewhere else: its own table, or a column outside the unique key.
  - (b) Give the rule row the coach row's ID, and define what the coach's write does when Ben has already answered (for example, refuse that exercise's row with a guard note and keep the others).
  - (c) Skip exercises with a rule answer in `validateNextSessionTargets`, and make `commit` turn constraint errors into `conflict` instead of throwing.

  Whichever you pick, add a real-SQLite test: Apply the reset, then run the summary review.

### B2. "Make <lift> the main lift" can put the same exercise in the template twice

- **Where:**
  - `packages/domain/src/builder/keep.ts:375` (`withMainLift`).
  - `apps/mobile/src/builder/builder-service.ts:2878` and `:2900` (`keepMainLiftOf` / `keepMainLift`).
- **What happens:** `withMainLift` puts `to` into the main entry and leaves every other entry as stored. If `to` is already one of the template's other exercises, the template ends up holding it twice. Nothing checks for this.
- **Repro (probe, real SQLite):**
  1. Plan Push = [Bench (main), Incline dumbbell press, Cable fly, Lateral raise, Triceps pushdown].
  2. On Your workout, delete Incline dumbbell press, then swap Bench → Incline dumbbell press. The swap picker offers it.
  3. Start, then Finish.
  4. The Summary shows both `Keep for next time? · Delete Incline dumbbell press` and `Make Incline dumbbell press the main lift for Push?`.
  5. Tap Apply on the main-lift row. The template becomes `[INCLINE (main), INCLINE, Cable fly, Lateral raise, Triceps pushdown]`.
  6. The Keep row then disappears (`keepNextTimeOf` → `null`), so Ben can't remove the duplicate from the Summary.
  7. Today's next Push card reads `Incline dumbbell press, Bench press, Cable fly, …`.
- **Why it matters:** Decision 7 is "without corrupting the template". This corrupts it.
- **Fix:** In `withMainLift`, drop or refuse when another entry already has `exerciseId === to`. Removing that entry matches what Ben did today, but it's a structural change, so it's safer to fold it into this row's own before/after. Also re-check the Keep diff after the Apply so the remaining "Delete …" line is still offered or is correctly absorbed. Add this case to `keep-next-time-authorship.test.ts`.

## Should fix (not blocking)

### S1. An applied reset that goes stale disappears with no way to re-apply and no word

- **Where:** `apps/mobile/src/coach/next-time-view.ts:107-108`, together with `packages/domain/src/coach/next-session.ts` `acceptedRuleResets` (fits check).
- **What happens:** After Ben corrects a set on the source workout, `nextTargetFitsSource` fails, so the reset no longer applies and the rule holds again. In `ruleRow`, `resetApplied` is unset, but `answer.status === 'applied'` makes `open` false. The row shows the hold with no buttons and no note.
- **Repro:** Apply the reset, then correct the reps on one set of that workout. The next workout plans the hold, and the Summary row offers nothing.
- **Why it matters:** Rule 5 is honoured (the stale answer isn't applied), but Ben's Apply is silently lost.
- **Fix:** Treat an applied rule row that no longer fits like `proposed`: offer `Skip` / `Apply` again, writing a new answer at the row's version. You could also show a short `Changed since` note.

### S2. Ben's first answer to the reset can overwrite an earlier answer without a version check

- **Where:** `apps/mobile/src/coach/coach-service.ts` `tapRuleReset` (the `offer.row === null` path) and `packages/persistence/src/coach.ts:505-506`.
- **What happens:** The first answer goes through `commit`'s "a newer review replaces the rows" upsert. A Skip tapped from a view rendered before Apply's reload uses a different op ID (`rule-reset:not_now:…`), so it replaces the `applied` row with `not_applied` (version + 1) instead of being refused as stale.
- **Fix:** For `origin: 'rule'` writes, require no existing row (`expectedVersion: null`). If a row exists, return `changed_since`.

### S3. The carried sets can still be cut by a Time change on the landing day

- **Where:** `packages/domain/src/today-v2/session.ts:868-873`.
- **What happens:** The carry lands after Today's own fit, but a later Time change on Your workout for that day refits the whole workout, including the carried sets. The spec says "what Ben carried isn't cut again". Today's card meets that; Your workout doesn't.
- **Fix:** Either mark the carried slots and sets so `fitWorkoutToTime` leaves them alone, or narrow the spec to Today's card.

## Tests missing for the edge cases above

- A coach summary review after a rule reset answer (B1).
- The main lift swapped to an exercise already in the template (B2).
- An applied reset after a correction to the source workout (S1).
- Carry-over after Ben puts the cut sets back himself before Start. `carriedItems` caps it, but nothing tests that through the service.
- `followTop` when the new top rounds below the equipment minimum (the `followed ?? r.load` fallback in `packages/coach/src/builder/edit-ops.ts:41`). `settleBackoffs`' `notAbove` catches it, but nothing tests it.

## Checked and fine

- **Decision 1 (reset is an offer):**
  - `decidePrimary` holds until `acceptReset`.
  - The Apply, Undo, Apply again and Skip flows work offline.
  - Duplicate taps replay.
  - Builder, Up next and Start all read the accepted reset.
  - Tested in `coach-fallback.test.ts`.
- **Decision 2 (extra set):**
  - An unasked +1 is now `bigger`, so it becomes a `proposed` row with `Skip` / `Apply` and is no longer dropped.
  - The `droppedExtraSet` note is gone.
- **Decision 3 (carry-over):**
  - It's a real offer and is never applied without the tap.
  - It's capped at 4 sets, with at least 2 per group, from what the fit took.
  - It's never taken from the main lift.
  - The write is version-fenced and idempotent.
  - The toast's Undo and the line's Undo both clear it.
  - A Time change clears the answer.
  - It lands only after the source workout is done and stops once the target day has been started.
  - `Keep for next time?` doesn't list landed carry sets (probe: `keepNextTimeOf` → `null` on the landing day).
- **Decision 4 (back-offs follow a coach top):**
  - `followTop` keeps the same % and clamps to the D4 band's top edge.
  - The result is rounded down, and `settleBackoffs`' `notAbove` keeps it at or below the top.
  - A top Ben types ends `follow`.
  - The flag survives the draft codec.
- **Decision 5 (Mix it up):**
  - It goes through `service.edit` (versioned, op ID).
  - It never picks the main lift.
  - The pick loop terminates.
  - The toast reads `<from> → <to> · Undo`.
- **Decision 6 (Save as a variation):**
  - It checks the template version it opened.
  - It refuses a workout the extras can't reproduce.
  - The op-ID replay works.
  - Undo deletes at the version returned.
- **Decision 7 (main-lift row), apart from B2:**
  - It's its own row.
  - The Keep row and the main-lift row each write at the version the other wrote.
  - Undo is fenced on the version.
  - An isolation lift gets no row.
- **Decision 8 and the PM items:** `future Pulls` is in place, coarse kit rounds to the nearest lighter load, and goal both/unset uses the Balanced band.
- **UI copy:** Within the minimal-copy rule: `Carry over`, `✕`, `Carried over`, `No other option`, `Same as the plan day`. No rule labels or reassurance lines.

## Nits

- `nextTargetTapRecord` writes `size: 'small'` for a re-Apply of a rule reset, which is always `bigger` (`packages/coach/src/executors.ts:740`). This only affects the record.
- `Can’t save these changes as a variation` is longer than it needs to be. `Can’t save as a variation` is enough.
- The test fixture's third day is named `Legs` but holds Lateral raise and Triceps pushdown, so the carry line reads `+3 Shoulders sets on your next Legs day`. That's a fixture quirk, not a code bug, but it hides whether the day name is right.

## Spec issues

- **Carry-over ceiling.** `fit-to-time.md` (revision 23 Oct) says "several add up to at most 4 per group". Ben's decision says at most 4 sets. With two cut workouts routed to the same day, `pendingCarryOvers` can add 4 + 4 sets across two groups to one day. Ben should confirm whether the 4 is per offer, per group or per landing day.
- **"Its own sets".** `workout-builder-v3.md` §2.8 says the new main lift takes "its own sets (top set and back-offs)". `withMainLift` copies the old main lift's set templates with automatic loads. That's probably the intent, but the wording is ambiguous.
