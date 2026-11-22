# Review r3: coach fallback for today's remaining sets (build 108)

**Verdict: PASS** (code). The merge is still gated on Ben's sign-off (Spec issues SP1, carried from r1 and r2, unchanged).

Reviewed: `claude/coach-fallback` at `411aef7` against `claude/gracious-knuth-joxqpw`. This round covers the two fix commits after r2:
- `6d9f067`: chip routing and the post-turn rule fallback, moved into pure helpers with tests (r2 S1)
- `411aef7`: offline Adjust copy and acceptance check 19 (r2 S2)

I also re-read the whole branch diff against rules 2, 3, 4 and 5.

Read: CLAUDE.md (rules 1–10, minimal copy), `docs/reviews/coach-fallback-diagnosis.md`, `docs/reviews/coach-fallback.md` (r1), `docs/reviews/coach-fallback-r2.md`, `docs/design/coach-adjustments.md` (CA4–CA6, §4.8, §5, §7).

Ben's report: "I just tried to do way fewer reps than stated and coach still didn't change sets for the set or session."

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | Clean |
| `npm run lint` | Clean |
| `npx vitest run --testTimeout=120000` (full) | 196 files: 3917 passed, 1 todo, 4 failed. All 4 are timing tests in files this branch doesn't touch (see below) |
| Re-run: the 3 failing files plus `coach-fallback`, `session-adjust`, `navigation`, `coach-views`, `coach-guardrails` | 486 passed, 2 failed (the same timing tests) |
| Re-run: `equipment.test.ts`, then `definition.test.ts`, alone with `--no-file-parallelism` | 40 passed, 40 passed |

**About the 4 failures.** The full run happened with a load average of about 20, while eslint and vitest from `wt-gaps`, `wt-progress` and `wt-coach-tools` were running at the same time. These were the failures:
- `catalogue/definition.test.ts › D6` hit its own 60 s timeout, which overrides `--testTimeout`. r2 saw the same failure.
- `domain/equipment.test.ts › memoised … stay cheap` took 1029 ms against a 500 ms budget.
- `persistence/backup-perf.test.ts` failed 2 thread-blocking budgets.

The branch's diff touches none of `packages/catalogue`, `packages/persistence` or `packages/domain/src/equipment*`. `backup-perf` passed on the second run, and the other two passed when run alone. So all tests pass. The failures came from load on the machine, not from this branch.

## r2 findings

| r2 | Status | Evidence |
|---|---|---|
| **S1** The hook's chip routing had no test | **Fixed** | The hook's decisions are now two pure helpers in `apps/mobile/src/coach/offer-check.ts`. `chipRoute(availability)` (`:61`) sends a chip to the coach only when availability reads `ok`. `settleTurn(...)` (`:75–94`) decides what happens after a coach turn, with the same logic the hook used to have inline. The hook only calls them (`WorkoutCoach.tsx:128–133`, `:223`, `:231`). The four cases r2 asked for run on real SQLite (`apps/mobile/test/coach-fallback.test.ts:456–513`): the coach answered "no change" (no rule write, loads stay 62.5); a network failure (rule applies, 57.5); Ben's Cancel (no rule write, via a `HangingModel` stopped mid-turn); `Offline` (rule at once, no new model request). These would catch the regressions r2 described. Dropping `coachCouldNotAnswer` or flipping the `adjustment` guard fails the "no change" test. Dropping the `cancelled` exclusion fails the Cancel test |
| **S2** Spec copy and check 19 contradicted CA6 | **Fixed** | `coach-adjustments.md` now matches the code (`slot-view.ts:152`): the §3 state table row, the §5 control caption, the §5 `Offline` and `Not connected / unavailable` rows, and check 19 (`:435`). CA6 now says that `Type…` stays when `Offline` and is hidden when not connected or unavailable |
| N1 (drop sets) | Open | Carried as N1 |
| N2 (stale spec lines) | Open | Carried as N2 |
| N3 (effort chip clears an offer) | Open, pre-existing | Carried as N3 |
| N4 (late fallback on a later state) | Open | Carried as N4 |
| N5 (double chip tap during the availability read) | Open | Carried as N5 |

## Rules re-checked on the full branch

- **Rule 3: offer, apply only on Adjust, Undo, reason, label.**
  - `checkOffer` (`coach-service.ts:658–690`) only returns a `WorkoutOffer` (`by: 'rule'`, `change`, `basis`). Nothing is written until `applyRuleOffer`.
  - Ben's own `Too hard` / `Too easy` applies at once. Rule 3 says that "when Ben asks".
  - Both paths write through `applyBuiltInAdjustment` (`packages/coach/src/executors.ts:433`). The record has `author: 'checks'`, `turnId: null` and the rule's app-text reason. Targets get `source: 'built_in_rule'` with `rule` provenance, so the banner shows `Rule` and `Why?` never says `Coach`.
  - No-coach paths make no model request (`model.requests` is checked in the tests).
- **Rule 4: achievable loads.** Every change goes through `validateTodayAdjustment` before it is shown or written (`session-adjust.ts:216`).
  - Easier loads snap with `roundToAvailableLoad(…, 'easier')` from a 5% drop. If the drop would be more than 10%, it falls back to fewer reps.
  - Assisted machines move one assistance step.
  - A raise uses `stepLoad` and is capped at the equipment max.
  - Tests cover per-hand dumbbells, lb, stack, assisted, min, max and bodyweight.
- **Rule 2: completed sets untouched.** Only `pending`, non-warm-up sets of one exercise are changed (`session-adjust.ts:170`). A too-hard change never raises (`:193`). The tests check that the logged set's actuals stay as logged, and that Undo after a later log reports `alreadyLogged`.
- **Rule 5: idempotent and versioned writes.**
  - The offer's opId is per trigger (`built-in-adjust:<triggerId>`). A chip's opId is per tap, or the turn's ID after a failed coach turn.
  - A version conflict returns `stale`.
  - `sameRuleChange` makes sure the change is only applied to the same sets with the same targets Ben saw.
- **No double offers when the coach comes back.** The rule's and the coach's offers share the CA4 log, which is persisted in `coach_offers` and survives a force-close (test `:283`). The F3 replacement isn't logged a second time. An applied rule change re-opens CA4, the same way a coach change does.
- **Coach on, off and unreachable.** Tests cover every state:
  - (a) not connected
  - (b1) reads `ok` but the turn fails: the offer falls back (F3) and the chip falls back (r2 S1)
  - (b2) `Offline`
  - (c) reachable, where the coach's answer stands
  - Ben's Cancel

## Blocking

None.

## Should fix

None.

## Nits

- **N1 (r1 N2, r2 N1, open). Drop sets are still changed.** `packages/domain/src/coach/session-adjust.ts:170` filters only `setType !== 'warmup'`, so pending `drop` sets are lowered too. §4.8 says "each remaining working set".
  - **Scenario.** Ben misses on set 2 of a lateral raise with a planned drop set. `Adjust` also lowers the drop set's load, which was already meant to be lighter.
  - **Fix.** Filter to `working` / `top` / `backoff`, or say in §4.8 that drop sets are included.
- **N2 (open). Stale spec lines in `docs/design/coach-adjustments.md`.**
  - `:37` (path B row) still says "reps short by ≥ 2", which contradicts revised CA5.
  - The new acceptance checks at `:450–453` are numbered 31–34, but 31–33 are already used at `:447–449`. Renumber them 34–37.
- **N3 (pre-existing, open).** An effort chip that re-runs `afterLog` without changing the trigger kind clears a rule offer that is showing (`WorkoutCoach.tsx:202`). CA4 then blocks the offer from coming back.
- **N4 (open). A late fallback can land on a later state.** `settleTurn` applies the rule's change to whatever is pending when the coach turn finally fails. If the turn fails at timeout after Ben has logged the next set, fewer sets change than he expected. The change is visible with Undo. Consider skipping the fallback if a `log_set` moved the version since the tap.
- **N5 (open). Two quick chip taps can both pass the availability re-read.** `askChip` (`WorkoutCoach.tsx:226–233`) awaits `availability()` before `applyRequest` sets `writing`. Two taps within that read apply two separate reductions, each with its own opId. Set `writing`, or close the row, before the await.
- **N6 (new). `settleTurn`'s F3 branch isn't run through `settleTurn`.** The (b1) test (`coach-fallback.test.ts:161–178`) calls `ruleOfferFor` directly, and the r2 S1 tests always pass `offered: null`. If someone breaks the `offered !== null && couldNotAnswer` line in `offer-check.ts:86`, no test fails. Add one `settleTurn` case with `offered` set and a `network` result, and assert that `offer.by === 'rule'` and `outcome === null`.
- **N7 (new). A test title promises more than the test checks.** `coach-fallback.test.ts:469`, "the rule's change applies now, with Undo", doesn't call Undo. Assert an Undo restores 62.5, or drop "with Undo" from the title. The test at `:381` does cover Undo for the not-connected path.

## Spec issues

- **SP1 (carried from r1 and r2, still open): built ahead of Ben's approval.** CA5 (option A) and CA6 are still marked "Pending Ben's confirmation" or "Built ahead of Ben's approval" (`coach-adjustments.md:51–52`). §4.8 and F5/F7 are in the same position.
  - `docs/brief/CHANGELOG.md` has no entry for this change.
  - ADR 0006 (`docs/decisions/0006-coach-led-progression.md`) still scopes the built-in fallback to next-session targets, with no amendment.
  - Playbook rule 5 and 7-F have no notes.
  - **Do not merge until Ben confirms two things.** First, the reading of CLAUDE.md rule 3: the built-in fallback also covers today's remaining sets, including his own `Too hard` / `Too easy`. Second, option A for "reps short". Then land the ADR 0006 amendment, the CHANGELOG entry and the playbook notes with the merge.
- **SP2 (carried). How sensitive "reps short" is.** "Any rep below the floor" is looser than rule 3's "big rep miss". For example, 8–12 with 7 reps now offers. Ben should confirm.
- **SP3 (carried). New coaching numbers.** These in-session sizes have no approved source for a rep miss without RPE. They should go to Ben or `training-researcher` as playbook candidates:
  - at least 5% lighter, otherwise the reps he managed;
  - for his own chip, one rep under the planned top.
- **SP4 (carried). Today's change carries into next session.** Accepting today's lighter load also lowers next session's target, because 7-F holds the easiest load used. The Summary shows this with `Rule`, but Ben should know.
