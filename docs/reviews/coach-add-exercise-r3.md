# Review r3: coach `add_exercise_today` (branch `claude/coach-builder`)

**Verdict: PASS**

Scope: the r2 fixes `c441898` (gate) and `ff4c2f3` (docs), checked against `docs/reviews/coach-add-exercise-r2.md`.
The add itself (`7f7f177..c699b79`) was reviewed in r1 and r2 and is unchanged since. The builder r3 commits
(`61e029f`, `08d4d95`) are out of scope.

Checks I ran in `/home/user/wt-builder`:

- `npm run typecheck`: passes.
- `npx eslint .`: passes.
- `npx vitest run`: 271 files, 5146 passed, 1 todo.
- A throwaway probe of `gateFor` + `buildTurnRegistry` (workout turn, write tools, `benAskedForChange`) with
  55 phrasings. I deleted it afterwards; the results are quoted below.

## What r2 asked for, and what is now true

| r2 | Status |
|---|---|
| B1: future-scope adds open only the today tool | **Fixed.** `ADD_FUTURE_TIME` covers in future, future sessions/workouts, next sessions, permanently, always, every/each X day, plural day names, rest of the block/month, from today/now on (`request.ts:660`). Every `add` also opens `propose_next_workout_change` (`registry.ts:367`, `needMet` at `registry.ts:397`). The `add_exercise_today` description says "Today only … never this tool" for future scopes. All r2 rows are in the table test. |
| S1: "today's plan" hidden | **Fixed.** `futureScope` (`request.ts:666`) treats a plan clause as today when it names today, tonight, this workout/session or now, and a bare "the plan" opens both tools. "to my plan" stays future, which is reasonable. |
| S2: ask forms open nothing | **Fixed** for every listed form: "I'd like" (straight and curly), "can I get/have", "we should", "maybe", "pair X with Y", "do X as a superset", "3 sets of 12 on X". All of them also count as `benAskedForChange`, so a reply with no card gets `No change made.`. The negative rows ("we shouldn't add curls", "maybe add some curls?", "I'd like to know why you added curls") are pinned. |
| S3: docs out of date | **Fixed.** coach-contract.md and coach-adjustments.md now have r2 notes covering the gate, same-movement identity, the returned `sessionVersion`/`sessionExerciseId`, and the catalogue save inside the add's write. The old "not offered yet" wording is gone. The docs say plainly that the proposal tool can't add exercises yet, so a future add gets `No change made.`. That's honest (rule 1). |

Probe results that matter:

- Clause splitting keeps unrelated "always"/"every week" words from turning a today add into a future one.
  "add some curls, I always forget them", "add lateral raises, my shoulders need work every week" and "add curls,
  we always do them on fridays" all still open `add_exercise_today`.
- Mixed scopes ("add curls today and next time", "add curls today, and to my routine") open both tools.
- "add some curls for the rest of the session/workout" stays today. "add face pulls at the end of each workout"
  and "add 3 sets of curls on push days" are future only.
- Unrelated wants and gets ("I need some rest", "can I get some water", "I would like some feedback", "can I have
  a break") open nothing.
- "add another set" and "add a set to bench" still open only `adjust_pending_sets`.

Rules 2, 4, 5, 8 and 9 hold as in r2. This round changed no write path: the add still goes through the
reducer's `add_exercise` only, is version-gated and idempotent on the opId, uses the shared fit with a blank
load when there's no history, refuses pain-flagged movements by the same-movement identity, and Undo is refused
once a set on the added row is done. Rule 3: the today tool is offered only on Ben's add words; future scopes
reach only a tool that proposes.

---

## Blocking

None.

## Should fix

### S1. Every plain today add now also exposes the swap/remove/reorder proposal tool, which can't add

`packages/coach/src/registry.ts:367` (`propose_next_workout_change: ['add']`) and `registry.ts:397`.

r2 B1 suggested this, and it does guarantee that a future scope always has a proposal-only tool. The side
effect is that "put in some curls" now also shows the model a tool whose description says it can swap, remove
or reorder next workout's exercises, and that "adding exercises is not possible yet". In a today-add turn that
tool can do nothing Ben asked for, but it can do things he didn't ask for.

Failure scenario: Ben says "put in some curls" mid-workout. The model takes the hint and proposes "swap cable
fly for curls next time". This isn't silent, because it's a proposal that needs Apply. But it's a structural
proposal Ben didn't ask for, and rule 3 says those are "raised only when Ben asks … or something has changed".
If the model makes only that call, the turn has a card, so neither the today add nor "No change made." happens.

Fix (either):
- Open `propose_next_workout_change` on an `add` only when `futureScope` matched or the scope is ambiguous: a
  bare "the plan", or a clause with both today and future words. Keep `structural` for the pure-future rows as
  now. The table test's `ADD` rows then drop back to two tools.
- Or keep it open, but add one line to its description: "On a today add, don't use this unless Ben named a
  future scope." Then add an app/turn test where an add turn's only call is a proposal, and pin what Ben sees.

## Nits

- **N1.** Suggestion prefixes apply only to exercise adds. "we should add curls" and "maybe add some curls"
  open the add (`benAskedForChange` true). "we should add a set to bench", "maybe add another set", "maybe add
  weight" and "we should add weight" open nothing and get no `No change made.`. That's inconsistent within the
  same feature. Either feed `ADD_SUGGEST_PREFIX` bodies to the `change` reading too, or document that hedged set
  changes are deliberately left as conversation.
- **N2.** Hedged forms ("maybe add some curls", "we could add curls", "might as well add curls") now apply at
  once. Undo covers it, and r2 asked for "maybe", but "we could" and "might as well" are closer to musing than
  asking. Consider dropping those two from `ADD_SUGGEST_PREFIX`, or leave them and note it in the doc.
- **N3.** "add curls to push day" (singular, no "every") opens today's add. That's probably right when today is
  push day, and the propose tool is open too. No change needed; worth one table row so the behaviour is pinned.
- **N4.** "pair curls and bench" opens nothing, although `ADD_PAIR` allows `and`. The clause splitter cuts on
  "and" first. Drop `|and` from the regex or add the row.
- **N5.** `ADD_TODAY` includes bare `now`, so "add curls to my routine now" opens both tools. That's fine (the
  description routes "routine" to the proposal), just noting that it's ambiguity handled by the model, not code.
- **N6.** r2 N1–N8 (r1 N1–N6) are still open and still nits: rep range from the built-in category when
  `reps: null` (`coach-add.ts:154`), the conflict record key, undocumented Undo of edited pending targets,
  `claims.ts:905` letting a today add claim "to your routine", the uncapped `addable` list, an untested gym-switch
  continuation part, `ADD_MAKE` reading "bench" in "make 3 sets of bench lighter", and normalised-name collisions.
  Only the last one is now documented.

## Tests

`add-request.test.ts` now pins the r2 B1 future rows, the S1 today's-plan rows, the S2 ask forms, their
`benAskedForChange`, and four negative rows. These are real assertions on the gate's output, not snapshots.
Missing: the "always/every week in another clause stays today" rows from the probe, which guard against the
easiest regression in `ADD_FUTURE_TIME`. Also N1/N4 rows, and (if S1 is kept as is) a turn test where an add turn
returns only a proposal.

## Spec issues

- **SP1** (r1/r2 SP1, still open). CLAUDE.md rule 3 lists "adding or removing exercises" as structural changes
  that are "always proposals". This feature applies a today-only add at once because Ben asked. coach-contract.md
  flags it "For Ben/PM", but there's no CHANGELOG entry or rule-3 wording change. Ben should confirm it.
- **SP2** (still open). Muscle-group objects ("add some arm work", "add something for rear delts") are not adds,
  so they open nothing and get no `No change made.`. This needs a PM decision.
- **SP3** (still open). B6 (blank load with no history) is still "pending Ben" in `open-decisions.md`.
- **SP4** (new). Future adds are now routed honestly to a tool that can't add, so "add curls to every push day"
  always ends in `No change made.`. If Ben wants that request to work, `propose_next_workout_change` needs an
  add operation. That's a scope decision for the next slice, not a defect here.
