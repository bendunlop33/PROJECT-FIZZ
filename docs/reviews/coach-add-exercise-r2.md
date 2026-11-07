# Review r2: coach `add_exercise_today` (branch `claude/coach-builder`)

**Verdict: CHANGES NEEDED**

Scope: the r1 fixes `9c110d2..c699b79` (gate, returned session version and row ID, same-movement identity, save
the catalogue exercise in the add's own write), checked against `docs/reviews/coach-add-exercise.md`.
I also re-read the original add work `7f7f177..d6db03c` for context. The r3 builder fixes (`61e029f`, `08d4d95`)
are out of scope.

Checks I ran in `/home/user/wt-builder`:

- `npm run typecheck`: passes.
- `npx eslint .`: passes.
- `npx vitest run`: 271 files, 5103 passed, 1 todo.
- A throwaway probe of `gateFor` + `buildTurnRegistry` (workout turn, write tools) with about 100 phrasings.
  I deleted it afterwards; the results are quoted below.

## What r1 asked for, and what is now true

| r1 | Status |
|---|---|
| B1: gate misses "N sets of R", "create", "give me", "add in", superset | **Fixed** for every row r1 listed. All of these open `add_exercise_today` + `adjust_pending_sets`: "add 3 sets of 12 lateral raises", "3 sets of 10-12", "create 3 sets of lateral raises", "give me 3 sets of curls", "add in some curls", "superset curls with bench". The table test covers them. The muscle-group objects are still open (SP2). |
| B2: future add opens the today tool | **Partly fixed.** The markers r1 named now go to `propose_next_workout_change`. Other common future wordings still open only today's apply-at-once tool (B1 below). |
| S1: second add in one turn is stale | **Fixed.** `toolOutput` returns `sessionVersion` and `sessionExerciseId` (`turn.ts:251`). There's an app test with two adds in one turn and a superset on the first. `after = base + 1` matches the reducer's single `bumpVersion` for `add_exercise`. |
| S2: identity by ID only | **Fixed.** `exercise-identity.ts` matches on ID, catalogue key or normalised name. It's used in `addableFor`, the domain's "already in the workout" check and the pain-flag check (rule 9). There's an app test with a real FitNotes import. |
| S3: read path saves a catalogue row | **Fixed.** `coachAddInputs` only reads. `saveExercise` is written inside the `session_command` transaction, after the version check (`persistence/src/coach.ts:489`). The app test shows that stale and rejected adds leave no row and a committed add saves one. |
| N1–N6 | Not addressed. These are still nits; see below. |

Rules 2, 4, 5 and 8 hold as in r1. The add goes through the reducer's `add_exercise` only, Undo is refused once
a set is done, loads use the shared fit and snap with blank load when there's no history, and writes are
version-gated and idempotent on the opId. Exercise names in `addable` are context data. Rule 9 is stronger than
in r1.

---

## Blocking

### B1. Many future-scope adds still open only today's apply-at-once tool

`packages/coach/src/request.ts:647` (`ADD_FUTURE`), `packages/coach/src/registry.ts:364`.

`ADD_FUTURE` is a closed list of markers. In the probe, every one of these opens
`add_exercise_today,adjust_pending_sets` and **not** `propose_next_workout_change`:

| Ben says (mid-workout) | Tools the model sees |
|---|---|
| add curls in future | add_exercise_today, adjust_pending_sets |
| add curls in future workouts | add_exercise_today, adjust_pending_sets |
| add curls to future sessions | add_exercise_today, adjust_pending_sets |
| add curls to my next workouts | add_exercise_today, adjust_pending_sets |
| add curls permanently | add_exercise_today, adjust_pending_sets |
| add curls to push days / to every push day | add_exercise_today, adjust_pending_sets |
| add curls for the rest of the block / month | add_exercise_today, adjust_pending_sets |
| add curls from today on | add_exercise_today, adjust_pending_sets |

Failure scenario: Ben says "add curls to every push day". The only tool that can add an exercise applies to
**today**, at once. If the model uses it, today's workout gets a row Ben didn't ask for. That is an
unprompted apply, which rule 3 forbids. If the model doesn't use it, the future change Ben did ask for can't be
proposed. This is the same failure as r1 B2. The fix covered the examples r1 gave, not the class.

Fix. Don't rely on the marker list alone:
- Open `propose_next_workout_change` on every `add` request as well (`REQUEST_KINDS_BY_TOOL`). The model then
  always has the right tool for the scope Ben stated. The proposal still needs Apply, so offering it costs nothing.
- In the `add_exercise_today` description, add: "Today only. If Ben names a future scope (next time, future,
  routine, every X day, permanently), use propose_next_workout_change instead."
- Extend `ADD_FUTURE` with `in (?:the )?future`, `future (sessions|workouts)`, `next (sessions|workouts)`,
  `permanently`, `always`, `every \w+ day`, `\w+ days` (plural day names), `for the rest of the (block|month|cycle)`,
  `from (today|now) on`.
- Add the rows above to `add-request.test.ts`.

---

## Should fix

### S1. "Today" plus "plan" is read as a future change, so today's add is hidden

`packages/coach/src/request.ts:647`. The clause `(to|in|…) (the|my)? … plan` matches without checking for
"today".

Probe: "add curls to today's plan", "add curls to the plan for today", "add curls to my plan today" and "add
curls in the plan" all open **only** `propose_next_workout_change`.

Failure scenario: Ben says "add curls to today's plan". The model can't add to today. At best Ben gets a
future-template proposal he didn't ask for. At worst he gets "No change made." for the exact request this
feature exists for.

Fix: don't treat the clause as future when it also contains `today`, `this (workout|session)` or `now`. Treat a
bare "the plan" (no `my`, routine or template word) as ambiguous, and open both tools. Add these rows to the
table test.

### S2. Common ask forms still open nothing, so the "No change made." line is lost too

`packages/coach/src/request.ts:205` (`ASK_PREFIX`), and the `addMatch` verb forms.

Probe (no tools, `benAskedForChange` false):

- "I'd like to add curls" (straight or curly apostrophe), and "i'd like some curls". `ASK_PREFIX` has
  `i (?:…|'d like)`, which needs a space before `'d`, so "I'd" never matches. "I would like to add curls" works.
- "can I get 3 sets of curls", "we should add curls", "maybe add some curls".
- "pair curls with bench", "do curls as a superset with bench".
- "add 3 sets of 12 on lateral raises" opens only `adjust_pending_sets`, so the add can't happen when lateral
  raises aren't in the workout.

Failure scenario: Ben types "I'd like to add some curls". The model has no write tool. Because
`benAskedForChange` is false, a reply such as "Sure, go for it" carries no "No change made." line. The claim
check still hides a false "Added curls", so this isn't dishonest. But it's exactly the "why can't it create
sets?" complaint.

Fix: in `ASK_PREFIX`, allow `i'?d like` / `i’d like` (and normalise curly apostrophes before matching if that
isn't already done). Accept `can i (get|have)`, `we should`, `maybe` as ask prefixes for `add`. Accept
`pair X with Y` and `do X as a superset with Y`. Allow `on` before the object in `ADD_REPS` only after a set
count. Put each phrasing in the table test, along with the `benAskedForChange` assertion.

### S3. The design docs weren't updated for the r1 fixes and now say the opposite of the code

`docs/design/coach-contract.md:3` still says "Next-time adds stay proposal-only (and not offered yet)". The
gate now offers `propose_next_workout_change` for them. Neither coach-contract.md nor coach-adjustments.md
records:

- the same-movement rule (catalogue key or name) for "already in the workout" and for pain flags,
- the `sessionVersion` / `sessionExerciseId` returned after a committed session change,
- the catalogue exercise being saved only inside the add's write.

Fix: add a short "r2" line to each revision note.

---

## Nits

- **N1** (r1 N1, open). `coach-add.ts:154`: with `reps: null` the rep range is the built-in category's, not the
  history plan's, so a "Reps changed from last time · load not adjusted" note appears for something Ben didn't
  ask for. Use `fromPlan[0]?.planned.reps` when `args.reps` is null.
- **N2** (r1 N2, open). `add-exercise.ts:88`: a write conflict is recorded under `${opId}:refused`, and a replay
  records again under `opId`.
- **N3** (r1 N3, open). `undo_op` on an add deletes pending targets Ben edited, with no version check. That's
  allowed by rule 2, but it isn't documented.
- **N4** (r1 N4, open). `claims.ts:905`: `structural && !next` still lets a today add back "added curls to your
  routine".
- **N5** (r1 N5, open). `addable` is uncapped (100+ entries on every add turn).
- **N6** (r1 N6, open). An add after a row with a gym-switch continuation part is untested.
- **N7.** "make 3 sets of bench lighter" and "give me 3 sets of bench at 100" open `add_exercise_today` because
  `ADD_MAKE` reads "bench" as the object. This is harmless (the domain refuses an exercise already in the
  workout), but a trailing load or comparative word could exclude it.
- **N8.** `movementNameKey` drops a trailing "s" on any word longer than 2 letters, so a name like "Abs" and "Ab"
  or "Glutes" and "Glute" match. That's intended. But two genuinely different exercises can still share a
  normalised name (e.g. Ben's custom "Lateral Raise" meant as the cable version). Excluding an addable entry on a
  name match is the safe direction, so this needs no change. It's worth a line in the doc.

## Tests

The new tests are real and target the r1 findings. They cover the gate rows for B1, the B2 markers, an app test
showing a next-time add never commits today's add, two adds in one turn, a FitNotes look-alike (in the workout
and flagged, by name and by catalogue key, cleared flag ignored), and no exercise row left by a stale or
rejected add. Missing:

- the future-scope rows in B1,
- the today-plus-plan rows in S1,
- the ask forms in S2.

## Spec issues

- **SP1** (r1 SP1, still open). CLAUDE.md rule 3 lists "adding or removing exercises" under structural changes
  that are "always proposals". This feature applies a today-only add at once because Ben asked.
  coach-contract.md flags it "For Ben/PM", but there's still no CHANGELOG entry or rule-3 wording change. Ben
  should confirm it, and rule 3 should then say "today's exercises Ben asks for apply at once with Undo; future
  structural changes are proposals".
- **SP2** (r1 B1 sub-point, still undecided). Should "add biceps", "add some arm work", "add something for rear
  delts" and "add triceps at the end" count as an add request (the coach picks from `addable`)? Today they open
  nothing and get no "No change made." line. This needs a PM decision.
- **SP3** (r1 SP2). B6 (blank load with no history) is still "pending Ben" in `open-decisions.md`.
