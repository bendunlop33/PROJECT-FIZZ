# Review: coach weight limits and imported targets (Ben, 19 Oct)

Branch `claude/limits-19oct`, diff `42f2b88..212e835` (5 commits).
Reviewer: independent reviewer agent, 19 Oct 2026.

## Verdict: PASS

There are no blocking findings. The two approved changes are implemented as Ben's words read, and the deterministic guards are intact. Three should-fix items and three spec issues need a PM or Ben decision before he relies on the new targets with his real FitNotes data.

## What I ran

- `npm run typecheck`: clean.
- `npm run lint`: clean.
- Targeted: `imported-min-sets`, `builder-loads`, `coach-draft-loads`, `coach-plan`, `load-choice` and `progression*`. 6 files, 166 tests, all passing.
- Full suite, `--maxWorkers=2`: 356 files, 7076 passed, 1 todo.
- A throwaway probe test (synthetic data, deleted afterwards, not committed) to check the imported-sets reading, sided sets and the planned set count.

## What I checked

| Check | Result |
|---|---|
| `capE` 1.05 → 1.2 and `capLastTop` 1.1 → 1.2 (`builder-loads.ts:57-58`) | Done |
| `clampHigh` stays above the caps: 1.3, and `limit = max(1.3·E, cap)` (`builder-loads.ts:60, 554-558`) | Done. The error line can never fall below the cap. |
| Build, plan and Start re-check all use one check | Yes. Each goes through `checkProposedLoad`: `coach-draft.ts:497`, `recheckDraftLoad` at `builder-loads.ts:1047`, and `checkPlanProposal`. |
| Other places with 5%/10% coach bounds | None in code. `edit_today` (`adjust.ts:293`) never had one. `session-adjust.ts` (Too hard / Too easy) and `default-rule.ts` (7-F) are different rules and correctly left alone. |
| Instructions treat 20% as a ceiling and ask for an evidence-based choice | Yes. `LOAD_CHOICE_LINE` is in the build, scoped-build and plan instructions, and `LIVE_LOAD_CHOICE_LINE` is in the live-workout instructions. The percentage is read from the constants. |
| Snap, equipment max, pain hold, assisted direction, `est.` labels | Unchanged code paths. The new tests cover a pain hold on a +15% jump and the equipment max with imported history. |
| `MIN_IMPORTED_SETS = 3` is a named constant, with documented semantics and a CHANGELOG entry | Done (`progression.ts:218`) |
| Tests: +15% accepted, +25% capped, far past E refused, 3 imported sets progress, 2 hold | All present |
| CHANGELOG has one "Ben approved 19 Oct" entry quoting his words | Present |
| No real data or secrets committed | None found |

## Blocking

None.

## Should fix

**S1. The imported-history count has no time limit, so one set can now raise a load** (`packages/domain/src/progression.ts:221-228`, `setsToJudge` at 235-241)

`importedHistorySets` adds up judged sets from every imported session behind the latest one, back to the first in-app session, however old.

*Scenario (probe, synthetic data):* the latest FitNotes session is `20 kg each × 10` with a single set, on a 3 × 8–10 rule. The only other imported session is `10 kg each × 8, × 8` from January 2022. The result is `increase_load` to 22.5 kg each for 3 sets, with the fact "Judged on the 1 working set … 3 sets of imported history are enough."

Ben's FitNotes history goes back years, so in practice the minimum becomes "this exercise has ever had 3 judged sets in FitNotes". That will release nearly every hold, including ones whose latest session was a single set. This reading is looser than the brief's "the most recent imported sessions used for the basis".

*Fix:* limit the run, for example to imported sessions within the builder's `gapDays` or a 28-day window, or to the last 2–3 imported sessions, or to sessions at the same working load. Then add a test where a single set followed by stale history still holds. If the PM keeps the unlimited reading, show Ben the one-set example and record it in the CHANGELOG.

**S2. Missing edge-case tests for the imported rule** (`packages/domain/test/imported-min-sets.test.ts`)

There is no test for a latest session with one judged set, for stale earlier history (see S1), or for sided sets. My probe found that sided pairs work: one L/R pair plus two earlier pairs progresses. The "per-hand" case in the developer summary is the `per_hand` convention, not left/right sides.

*Fix:* add those three cases.

**S3. The instruction wording can be misread against the context the model is given** (`packages/coach/src/build.ts:567`)

The line says "Never more than 20% above his estimated level". The only "estimate" the model sees in `loadReferences` is `e1rmEst`, which is a one-rep max. The cap actually applies to `E`, the load that estimate supports at the slot's reps and RPE. The model may read the limit as 20% above the 1RM, which is far heavier. Code still caps the load, so this isn't a safety problem, but it causes avoidable `capped` notes and pushes the coach's note under `NOT USED`.

The line also says "the app caps it there". That isn't true for assisted and added loads, which are bounded by equipment steps, or for `est.` paths (FitNotes machine, personal ratio, related lift), which are capped at 1.0·E.

*Fix:* say "the weight his estimate supports for those reps". Either drop "the app caps it there" or make it "the app may cap it lower".

## Nits

- **N1.** `docs/design/workout-builder.md:583` (WB26), `:589` (WB-L3) and `:592` (WB-L5) still say 1.25·E. The outcomes are unchanged (40 kg is still past 1.3·E ≈ 34.1), but the numbers are stale.
- **N2.** The `builder-loads.test.ts:163-165` test is described as "a +15% jump with a clear signal is allowed". Code accepts +15% with or without a signal, because the signal is the model's job. Rename it, or add a comment, so nobody reads it as a code check.
- **N3.** `CEILING_PERCENT` (`build.ts:560`) takes the larger of the two caps. If they ever differ, the instruction would state the looser one for both. Either state each cap separately or assert they are equal.
- **N4.** Raising `clampHigh` to 1.3 also widens the clamp band on the `est.` paths (`builder-loads.ts:554, 587`). A related-lift proposal between 1.25 and 1.3 × `E_rel` used to be rejected and is now clamped to `E_rel`. That is harmless, and arguably safer, but the CHANGELOG doesn't mention it.
- **N5.** Next-session coach targets (Summary, `set_next_session_targets`) don't get the "consider" line. Small targets there are one step by definition, so this matters only for the "bigger" proposals (see SP2).

## Spec issues

**SP1. The 20% cap also applies to the offline re-check at Start after a newer bad session** (`builder-loads.ts:1047`; CHANGELOG last paragraph)

"gpt should consider" can't happen there: no model runs at Start. After Ben logs `100 × 5 @10`, a stored `102.5` now stands, and a stored `115` becomes `110` (it was 95). That means a load up to about 10% above a set he just failed can be planned without any judgement. The developer recorded this for Ben.

*Recommendation:* ask Ben whether the re-check should keep a tighter bound, for example the old 1.05·E or "never above the newer missed load", as its own named constant.

**SP2. The question to Ben described the limits as covering everything the coach suggests, but code applies them only to builds, plans and the Start re-check.**

- `edit_today` (`adjust.ts:293`) has no percentage limit in code. 20% is a prompt-only rule there, and only "unless Ben names the weight".
- "Bigger" next-session proposals have no percentage limit either.

Both stay within rule 3: Ben accepts offers, and code still snaps loads, respects equipment max and holds on pain. But Ben may think there is a 20% guard everywhere. He should decide whether `edit_today` offers he didn't ask for (`benAsked: false`) and "bigger" next-session proposals get the same 1.2 cap in code.

**SP3. The meaning of "3 sets of imported history" is still an assumption.** The brief suggested counting across "the most recent imported sessions used for the basis". The build counts across all imported history (see S1). Before this goes onto his iPhone, Ben should see a concrete example: a single 1-set FitNotes session plus older history now progresses.
