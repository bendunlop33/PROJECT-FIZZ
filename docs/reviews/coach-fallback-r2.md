# Review r2: coach fallback for today's remaining sets (build 108)

**Verdict: PASS** (code). The merge is still gated on Ben's sign-off. See Spec issues SP1, which is carried over from r1 and unchanged.

Reviewed: `claude/coach-fallback` at `37a4e40` against `claude/gracious-knuth-joxqpw`. This round covers the three fix commits after r1 (`cc9280a`, `29b15f3`, `37a4e40`). I also re-read the whole branch diff against rules 2, 3, 4 and 5.

Read: CLAUDE.md (rules 1–10, minimal copy), `docs/reviews/coach-fallback-diagnosis.md`, `docs/reviews/coach-fallback.md` (r1), `docs/design/coach-adjustments.md` (CA4–CA6, §4.2, §4.8, §5, §7), and `@react-navigation/routers` 7.6.4 `StackRouter` `POP_TO`.

Ben's report: "I just tried to do way fewer reps than stated and coach still didn't change sets for the set or session."

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | Clean |
| `npm run lint` | Clean |
| `npx vitest run --testTimeout=120000` | 196 files: 3915 passed, 1 todo, **1 failed**. See below |
| Re-run: `packages/catalogue/test/definition.test.ts` alone | 40 passed |
| Re-run: `coach-fallback`, `navigation`, `session-adjust` tests | 60 passed |

The single failure was `catalogue/definition.test.ts › D6`, which timed out at 60 s. That test sets its own 60 s timeout, which overrides `--testTimeout`. It ran while several other vitest runs from other worktrees were loading the machine. This branch doesn't touch `packages/catalogue`, and the file passes on its own in 29 s. So this is load flakiness, not a regression.

## r1 findings

| r1 | Status | Evidence |
|---|---|---|
| **B1** Correction sheet pushed a second Workout | **Fixed** | `EditSetScreen.tsx:84,88` now dispatches `returnToWorkout()` (`navigation/actions.ts:211`), which is `POP_TO` with `merge: true`. In 7.6.4 `POP_TO` goes back to the existing `Workout` route (`StackRouter.tsx:593–640`), and `EditSet` is only ever opened from `Workout` (`WorkoutScreen.tsx:1366`). Router tests check three things: `[Tabs, Workout, EditSet]` becomes `[Tabs, Workout]` on the same route key with params merged; repeated corrections and the toast branch don't grow the stack; a source guard rejects `navigate('Workout'` (`navigation.test.ts:113–154`) |
| **S1** No fallback for Ben's own `Too hard` / `Too easy` | **Fixed** | `Not connected` and `Unavailable` now show both chips (`slot-view.ts:152`). `askChip` reads availability again. If the coach isn't reachable, `applyRuleRequest` applies the rule's change at once and makes no AI call. If the coach looked reachable but the chip's turn can't answer, the same change applies afterwards (`WorkoutCoach.tsx:132–140, 228–240`). The write uses the same versioned `adjust_pending_targets` path as the rule's offer, with author `checks`, `Rule` tag and Undo. Domain tests cover per-hand, lb, bodyweight, assisted and pain (`session-adjust.test.ts:359–410`). Service tests cover not connected, a double tap replaying, Undo, and offline after a failed chip turn (`coach-fallback.test.ts:380–423`) |
| **S2** Stale check compared display text | **Fixed** | `WorkoutOffer.basis` carries `baseVersion`, `touchedSetIds` and canonical targets. `applyRuleOffer` refuses the change unless the sets, the targets *and* the text all match (`coach-service.ts:44–46, 605–606`). Two tests cover it: the same words on different sets is refused, and a rest edit that moves the version but not the change still applies (`coach-fallback.test.ts:211–251`) |
| **S3** No UI-level tests for F4 and F7 | **Fixed** | The hook's offer check and the screen's F4 decision moved into `coach/offer-check.ts`, which the hook and the screen both call. Tests run them on real SQLite. F4 goes through the router with the merged `corrected` key. F7 uses a real superset: A1 misses with no rest, B1 starts the round's rest, and the rule offers for A (`coach-fallback.test.ts:425–519`) |
| N1 | Fixed | Renamed (`:253`, `:264`) |
| N2 | Open | See N1 below |
| N3 | Documented | Comment at `WorkoutCoach.tsx:210–211`, as suggested |
| N4, N5 | Open | See N2 below |
| N6 | Open | Carried as N3 below |

## Rules re-checked on the full branch

- **Rule 3: offer, apply only on Adjust, Undo, reason, label.**
  - The trigger path returns an offer only. Nothing is written until `applyRuleOffer`.
  - Ben's own chip applies at once, which is what rule 3 says "when Ben asks".
  - Both paths write an `ActionRecord` with `author: 'checks'`, `turnId: null` and the rule's app-text reason (`Too hard. Lighter load for the remaining sets (8%).`).
  - Changed targets carry `source: 'built_in_rule'` and a `rule` provenance. The banner shows the `Rule` tag, `Undo` works, and `Why?` never says `Coach`.
  - No model request is made in any no-coach path (`model.requests` stays `[]`).
- **Rule 4: achievable loads.** Every change passes `validateTodayAdjustment` before it is shown or written: snapped easier, capped at the equipment max, no extrapolation. Per-hand dumbbells, stack, lb, assisted, equipment min and bodyweight are all tested. A `ben_asked` with no lighter load falls back to one rep fewer than the planned top, never below 1.
- **Rule 2: completed sets untouched.** Only `pending`, non-warm-up sets of one exercise change. A too-hard change never raises (the `isIncrease` guard). Tests assert the logged set's actuals stay as logged.
- **Rule 5: idempotent and versioned writes.**
  - The offer opId is per trigger. The chip opId is per tap, and the `writing` ref guards a double tap.
  - A version conflict at commit returns `stale`.
  - The offer's basis check stops a change being applied to different sets.
- **No double offers when the coach comes back.** The rule's and the coach's offers share the CA4 log, persisted in `coach_offers`. The F3 replacement isn't logged a second time. A rule change re-opens CA4 through `planned.coach.actionId`, which `carriesTodayAdjustment` now recognises for both sources. Covered across a force-close (`coach-fallback.test.ts:283`).
- **Rule 9: pain.** Too-easy is blocked by a movement flag or pain at check-in, for offers and for chips. Too-hard still applies.
- **Coach on, off and unreachable.** Tests cover all four diagnosis states: (a) not connected, (b1) reads `ok` but fails, (b2) `Offline`, and (c) reachable. Chips are tested not connected and offline-after-failure.

## Blocking

None.

## Should fix

### S1. The hook's chip routing (S1 fix) has no test

`apps/mobile/src/screens/workout/WorkoutCoach.tsx:132–140` (fallback after a failed turn) and `:228–240` (`askChip`).

r1's S3 was fixed by moving logic out of the hook into `offer-check.ts`. The new S1 decisions were added *inside* the hook instead. These are:
- which path a chip takes (`ok` → coach turn; otherwise re-read, then rule or coach);
- the rule only after `coachCouldNotAnswer` *and* no adjustment;
- the nested `setOutcome` ternary.

The service tests call `applyRuleRequest` directly, so none of this is tested.

**Scenario.** A refactor flips the guard to `after.adjustment !== null`, or drops `coachCouldNotAnswer`. Then a coach turn that *did* answer "no change" also gets a rule change applied, which is a change Ben wasn't given by the coach. No test fails.

**Fix.** Move the decision into a pure helper in `offer-check.ts`, for example `chipRoute(availability)` and `ruleAfterTurn({ request, result, adjustment })`. Test four cases:
- coach answered with no change → no rule write;
- coach failed with `network` → rule write;
- Ben cancelled → no rule write;
- `Offline` → rule write without a turn.

### S2. Spec copy row and acceptance check 19 now contradict CA6

`docs/design/coach-adjustments.md:357` and `:435`.

Both still say that offline `Adjust` shows `Coach offline. Your sets are unchanged…` with **only `Pain`**. The code now shows `Too hard` / `Too easy` / `Pain` when not connected (`slot-view.ts:152`), and revised CA6 says so. A tester following check 19 will report a correct build as failing.

**Fix.** Update the copy row and check 19 to match CA6. The minimal-copy pass had already removed that line from the code (`line: null`).

## Nits

- **N1 (r1 N2, open). Drop sets are still changed.** `session-adjust.ts:170` filters only `setType !== 'warmup'`, so pending `drop` sets are lowered as well. §4.8 says "each remaining working set". Either filter to `working` / `top` / `backoff`, or change §4.8 to say drop sets are included.
- **N2 (r1 N4, N5, open). Stale spec lines.**
  - `coach-adjustments.md:37` (path B row) still says "reps short by ≥ 2".
  - The new acceptance checks at `:450–453` repeat the numbers 31–34 (31–33 are already used). Renumber them 34–37.
- **N3 (r1 N6, pre-existing).** An effort chip that re-runs `afterLog` without changing the trigger kind clears a rule offer that is showing, and CA4 then blocks it from coming back.
- **N4. A late fallback can land on a later state.** If Ben taps `Too hard` with the coach reachable and the turn fails only at timeout, he may have logged the next set meanwhile. The rule then lowers only the sets still pending at that point. It is visible with Undo, so the impact is low. Consider ignoring the fallback if the session version moved by a `log_set` since the tap, the way CA7 handles the coach.
- **N5. Two quick chip taps can both pass the availability re-read.** `askChip` awaits `availability()` before `applyRequest` sets `writing`. Two taps within that read can apply two separate reductions, each with its own opId. The row closes after the first, so this is unlikely. Set `writing` (or close the row) before the await.

## Spec issues

- **SP1 (carried from r1, still open): built ahead of Ben's approval.** CA5 option A, CA6, §4.8 and F5/F7 are still marked "Pending Ben's confirmation" or "Built ahead of Ben's approval".
  - The branch has no entry in `docs/brief/CHANGELOG.md`, no ADR 0006 amendment, and no playbook rule 5 / 7-F note.
  - The S1 fix widens the scope further: the built-in rule now also answers Ben's own chips, not only triggers.
  - **Do not merge until Ben confirms** two things. First, the CLAUDE.md rule 3 reading: the built-in fallback covers today's remaining sets, including his own `Too hard` / `Too easy`. Second, option A. Then land the ADR, the CHANGELOG entry and the playbook notes with the merge.
- **SP2 (carried).** "Any rep below the floor" is looser than rule 3's "big rep miss". For example, 8–12 with 7 reps now offers. Ben should confirm the sensitivity.
- **SP3 (carried, widened).** The in-session sizes are new coaching rules with no approved source for a rep miss without RPE. They should go to Ben or `training-researcher` as playbook candidates. The sizes are:
  - at least 5% lighter, else the reps he managed;
  - for Ben's own chip, one rep under the planned top.
- **SP4 (carried).** Accepting today's lighter load also lowers next session's target through 7-F's hold on the easiest load used. It is shown on the Summary with `Rule`, but Ben should know.
