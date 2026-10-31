# Review: coach `add_exercise_today` (branch `claude/coach-builder`)

**Verdict: CHANGES NEEDED**

Scope: commits `7f7f177..d6db03c` (add_exercise placement and undo, tool contract, domain check,
migration 14, coach tool, request kind `add`, app wiring, docs). Not in scope: the r3 fixes
(`61e029f`, `08d4d95`).

Checks I ran in `/home/user/wt-builder`:

- `npm run typecheck`: passes.
- `npx eslint .`: passes.
- `npx vitest run`: 208 files, 4044 passed, 1 todo.
- A throwaway probe of the tool-exposure gate (`gateFor` + `buildTurnRegistry`, workout turn) with
  about 80 phrasings. I deleted it afterwards; the results are quoted below.

The domain and persistence work is solid. It goes through the existing `add_exercise` command
(no second path). IDs come from the opId, so a replay is a duplicate. Undo is refused once a set
on the added row is done (rule 2). Loads go through `substituteTargets` and `snapPlanToGym`: they
stay inside min/max, keep the per-hand and assisted conventions, and kg history converts on an
lb rack (rule 4). The load is blank when there is no history (B6). Pain flags are refused, not
substituted (rule 9). The migration rebuild matches 11–13. Force-close and Undo after restart
are tested against real SQLite.

The blocking problems are in the gate, which is the second half of what Ben actually reported.

---

## Blocking

### B1. The gate misses the most natural "add N sets of R <exercise>" phrasing and Ben's own verb "create", so the tool stays hidden

`packages/coach/src/request.ts:619-623` (`ADD_AMOUNT`, `ADD_FILLER`, `ADD_VERB`), `:630` (`addIn`).

`ADD_AMOUNT` allows "3 sets of" or "3x12", but nothing that names a rep count between the set
count and the exercise. `ADD_FILLER` only allows `[a-z-]+` words, and it excludes `sets?`/`reps?`.
Probe results (workout turn, write tools shown):

| Ben says | Tools the model sees |
|---|---|
| add 3 sets of 12 lateral raises | `adjust_pending_sets` only |
| add 3 sets of 12 reps of lateral raises | `adjust_pending_sets` only |
| can you add 3 sets of 12 curls after bench | `adjust_pending_sets` only |
| add 3 sets of 10-12 curls | `adjust_pending_sets` only |
| add some sets of curls | `adjust_pending_sets` only |
| give me 3 sets of curls | `adjust_pending_sets` only |
| add a set of lateral raises (not in today's workout) | `adjust_pending_sets` only |
| create 3 sets of lateral raises / can you create sets for lateral raises | nothing (`benAskedForChange` false) |
| add in some curls / add on some curls | nothing |
| superset curls with bench | nothing |
| add biceps / add triceps at the end / add rear delts / add some arm work / add something for biceps | nothing |

Failure scenario: Ben types "add 3 sets of 12 lateral raises". The model only gets
`adjust_pending_sets`, which can't add a new exercise. Ben sees "No change made.", which is the
exact complaint this work was meant to fix. With "create sets", the word from Ben's own
question, no write tool is offered and no "No change made." note appears either.

Fix:
- Let `ADD_AMOUNT` take an optional rep part: `N (sets?|rounds?) of (N(-N)? (reps? of )?)?`, and
  "N sets of N-N".
- Accept "some sets of" and "a set of <exercise>". Today "a set of <EXERCISE_WORD>" is classed
  as a set change only. When the object is an exercise word, it should also open `add`. Both
  tools are open anyway, and the domain refuses an exercise that is already in today's workout.
- Add `create|make|give me|add in|add on` to the verbs.
- Add a superset form: "superset X with Y".
- Decide (PM) whether muscle-group objects ("add biceps", "something for rear delts") count as
  `add`. The `addable` list lets the model choose the exercise, so they probably should.
- Put every row above into the `add-request.test.ts` table.

### B2. "Add curls next time / to my routine / for next week" opens the today-only, apply-at-once tool

`packages/coach/src/request.ts:630` (`addIn` has no future-scope exclusion),
`packages/coach/src/registry.ts:364`.

Probe: "add curls next time", "add curls to next session", "add curls for next week" and "can you
add curls to my routine" all open `add_exercise_today` + `adjust_pending_sets`, and do **not**
open `propose_next_workout_change`.

Failure scenario: Ben, mid-workout, says "add curls to next session". The only write tool the
model has applies to **today** and applies at once. If the model uses it, today's workout gains
a row Ben didn't ask for. If it doesn't, the future change Ben did ask for can't be proposed.
Rule 3 says future structural changes (adding exercises to future sessions or templates) are
always proposals, and coach-contract.md says "Next-time adds stay proposal-only". The gate
contradicts both.

Fix: in `addIn`, treat a clause with a future-scope marker as structural, not `add`. Markers:
`next (time|session|week|workout)`, `from now on`, `to my (routine|template|plan|split)`,
`every (week|time)`, `going forward`. Use the scope words `structuralIn`/`EX_NEXT` already use,
so it opens `propose_next_workout_change`. Add those rows to the table test, and add one app test
showing a next-time add never commits a `add_exercise_today` card.

---

## Should fix

### S1. Two adds in one turn: the second is reported as "Not added: your workout moved on."

`packages/domain/src/session/coach-add.ts:94` (exact `baseVersion` match),
`packages/coach/src/turn.ts:336-348` (`toolOutput` returns neither the new session version nor
the new `sessionExerciseId`).

Failure scenario: "add curls and lateral raises". The probe shows this opens `add`. The model
reads version v and calls `add_exercise_today` for curls, which is committed and bumps the
version to v+1. It then calls the tool for lateral raises with `baseVersion: v`, which is stale.
Ben sees one Added card and one "Not added: your workout moved on." The workout didn't move on;
the coach's own add did. The same gap blocks "add curls and superset them with bench press
after". The model is never told the new row's ID or version unless it re-reads
`get_active_session`.

Fix: return `sessionVersion` (after) and the new `sessionExerciseId` in the tool output for a
committed `add_exercise_today` (and ideally for the other versioned session tools). Say in the
tool description that the next call must use the returned version. Add an app test with two
adds in one turn.

### S2. Exercise identity is by ID only: duplicate or pain-flagged look-alikes can be listed and added

`apps/mobile/src/coach/coach-service.ts:806-808` (`addableFor`: `inWorkout` and
`painFlagCovering` compare `e.id` only), `packages/domain/src/session/coach-add.ts` step 4
(`live.some((e) => e.exerciseId === exercise.id)`).

Failure scenario: Ben's FitNotes import created a custom "Lateral Raise" (own ID, no
`catalogueKey`). Today's workout has it, or it carries an active shoulder pain flag. `addable`
still lists the catalogue's "Lateral raise", because its ID is different. "Add lateral raises"
then adds a second lateral-raise row, or adds the same movement Ben flagged for pain. Rule 9
says pain stops progression for that movement, not that row ID. Manual Add has the same
exact-ID semantics today, but there Ben chooses the exact row. Here the coach chooses.

Fix: when building `addable` and in `checkCoachAdd`, treat exercises with the same
`catalogueKey` or the same normalised name as the same movement. Exclude them if one is in
today's workout, and refuse them if one is flagged. Test this with an imported custom exercise.

### S3. The read path writes: `coachAddInputs` saves a catalogue row before the add is validated

`apps/mobile/src/services/workout-services.ts:1971` (`ensureExercise(found.id)`).

Failure scenario: the model asks to add a pain-flagged exercise, or calls with a stale
`baseVersion`. The add is refused, but a catalogue exercise row has already been saved to Ben's
exercises, outside the coach action's transaction. Refusals and retries leave rows behind that
Ben never added. That goes against audit F4 ("a row is saved only when Ben adds that exercise").

Fix: resolve without saving for the check, and call `ensureExercise` only in the `ok` branch.
Better still, do it inside the same write as the `session_command`.

---

## Nits

- **N1.** `coach-add.ts:145`: with `reps: null`, the rep range is the built-in category's, not
  the range the history-driven plan produced. So "add lateral raises" with 10 kg × 8–10 history
  plans 10 kg × the rule's range. You get a "Reps changed from last time · load not adjusted"
  note for something Ben didn't ask for. Use `fromPlan[0]?.planned.reps` when `args.reps` is
  null.
- **N2.** `add-exercise.ts:85`: a write conflict is recorded under `${opId}:refused`, and a later
  replay re-checks and records again under the plain `opId`. That's two refusal records for one
  call. Use one opId.
- **N3.** `reducer.ts:1787` (`undo_op` for `add_exercise`): pending targets Ben edited by hand
  on the added row are deleted without a version check. That's allowed by rule 2 (they're
  pending), but it differs from the other undos' "unchanged since" contract described in
  `commands.ts`. Either check set versions or document the difference.
- **N4.** `claims.ts:905`: `structural && !next` lets a today add back "added curls to your
  routine". Add "routine/template/plan" to the `next` exclusion.
- **N5.** `addable` lists every doable catalogue exercise plus all of Ben's (well over 100
  entries) on every add turn. Consider ranking by Ben's history and capping it, or narrowing by
  the named exercise words.
- **N6.** An add after a row that has a gym-switch continuation part (`continuesFromId`) is
  inserted after that row, not after the part's last continuation. It isn't tested.

## Tests

The coverage is good: a table-driven gate test, the domain check (per-hand, lb conversion,
equipment max, assisted, timed, check-in pain, clamps, refusals, stale), reducer
placement/undo/supersets, and app tests with real SQLite (Added card, Undo, B6 blank, "No change
made.", stale, replay, force-close, Undo refused after a logged set). Missing: the B1 and B2
phrasings, two adds in one turn (S1), imported look-alike exercises (S2), and no row saved on a
refused add (S3).

## Spec issues

- **SP1.** CLAUDE.md rule 3 lists "adding or removing exercises" under "Structural or broader
  future changes … always proposals". This change reads that as future plans only, and applies a
  today-only add at once because Ben asked. The PM brief for this task says so too.
  coach-contract.md flags it "For Ben/PM", but there's no CHANGELOG entry and no CLAUDE.md
  wording change. Ben should confirm, and rule 3's wording should then say "today's exercises
  Ben asks for apply at once with Undo; future structural changes are proposals". Otherwise the
  next reviewer will read this as a rule-3 violation.
- **SP2.** B6 is still listed as "pending Ben" in `open-decisions.md`. The blank-load behaviour
  matches the recommended answer, but it isn't approved yet.
