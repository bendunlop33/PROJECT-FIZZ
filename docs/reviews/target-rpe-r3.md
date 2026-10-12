# Review r3: target RPE, deviation triggers and the built-in fallback for today's sets

Branch `claude/coach-fallback` (head `67777e7`), diff against `claude/gracious-knuth-joxqpw`. This round re-checks the round 2 fixes ([target-rpe-r2.md](target-rpe-r2.md), `885b32d..67777e7`) and looks at the whole branch again against Ben's decisions (a) to (d) (CHANGELOG 2026-10-11 "Offers follow the target RPE" and "Built-in fallback for today's sets"), CLAUDE.md rules 2 to 5, minimal copy, schema and migration safety, and tests.

## Verdict: PASS

All of round 2's findings are fixed and tested (S1, N1 to N4 and N6; N5 is moved to `open-decisions.md` §D). Nothing blocks. One new should-fix item (S1 below) is a narrow rule 5 gap in the rule's `Adjust` path. I confirmed it with a probe test. The UI usually clears the offer before Ben can tap it, so it can follow in a small change.

### Checks run

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npx vitest run --testTimeout=180000`: 205 files, 4136 passed, 1 todo, 0 failed. No timing flakes on this run.
- Merge: `claude/gracious-knuth-joxqpw` is an ancestor of HEAD (merge commit `764617e`). `docs/brief/CHANGELOG.md` has main's "Offers follow the target RPE" entry, then this branch's "Built-in fallback for today's sets; target RPE details" entry. Only approved changes are listed. The open questions are now in `docs/design/open-decisions.md` §D.
- Migrations: `packages/persistence` is unchanged on this branch. The override lives in the `planned` JSON (`rpeOverride`, optional). `SetSnapshot.targetRpe` and `CoachTarget.rpe` are optional. There is no number clash with main's migration 8, and older rows and backups still parse.
- Probe, not committed: a copy of `coach-fallback.test.ts` with one added assertion, then deleted. It showed S1.

### Round 2 findings, re-checked

| Round 2 | Status | Evidence |
|---|---|---|
| S1: Ben's one-day override became the next-session baseline | Fixed | `next-session.ts:251–256` uses `usualTargetRpeOf` (`target-rpe.ts:44`), which leaves out `rpeOverride`. A coach target back at the rule's 8.5 is `small`, and its RPE isn't stored. Repeating Ben's 7 is `bigger` (Ben applies it). Tests at `target-rpe-commands.test.ts:174–194`, including RIR 2 under an override |
| N1: ADR 0006 named the `⋯` menu only | Fixed | `0006-coach-led-progression.md:43` adds "or on a logged set from `Edit set`" |
| N2: `targetRpe` was accepted on a finished workout | Fixed | `reducer.ts:519` returns `session_finished`. Other corrections on a finished workout still apply (test `target-rpe-commands.test.ts:263`) |
| N3: Edit set had no `Default` | Fixed | `targetRpeChips` (`exercise-menu.ts:102`) is shared with the sheet. Test at `exercise-menu.test.ts:67` |
| N4: the override stayed on a set changed to warm-up or drop | Fixed | Cleared in the same correction (`reducer.ts:520–524, 542`), and audited before and after (test `target-rpe-commands.test.ts:273`) |
| N5: open questions sat in the CHANGELOG | Fixed | Moved to `open-decisions.md` §D |
| N6: `expectedVersion` was taken when the `⋯` sheet opened | Fixed | `WorkoutScreen.tsx:131–136, 726–727` read `latestData` when Ben picks |

### Ben's decisions, re-checked across the branch

- **(a)** The CHANGELOG entry, ADR 0006 amendment 3, CA6 and the revision note in `coach-adjustments.md` (line 17 and line 54), playbook rules 5 and 6 (notes plus JSON `short`), rule T and D20 all record the decision. The fallback is an offer only, applies on `Adjust` and has the `Rule` tag and Undo. `applyRuleOffer` uses one opId per trigger and is version-gated through `adjust_pending_targets` (`executors.ts:437–465`). Undo goes through `revert_target_adjustment` with `carriesTodayAdjustment`.
- **(b)** `targetRpeOf` resolves the target in this order: Ben, then the coach, then the plan (RIR read as 10 − RIR), then the rule. `builtInTargetRpe` = min(profile, playbook 9), which gives 8.5 / 9 / 9. Ben can override it with `set_target_rpe` for a set, an exercise (all parts) or today, and from Edit set (`correct_set.patch.targetRpe`). The override is versioned, idempotent and owner-scoped on the workout. The target line shows `@ RPE 8` (`display.ts:150`).
- **(c)** `trigger.ts:157–164` implements every clause. Harder is ≥ target + 1.5. Reps are short when any rep is below a range's floor, or a single number is missed by ≥ 2, unless effort ≤ target − 1. Easier is ≤ target − 2 with reps ≤ 12. A target of 10 never fires. D20 applies only when there is no target. Each clause has table tests in `coach-guardrails.test.ts`.
- **(d)** `tooHardDropPct` uses 2% per point, at least 5% and at most 10%. `easierLoad` rounds down to an achievable load and switches to the same load with fewer reps when the drop would be more than 10% or there is no lighter load. Assisted loads move one assistance step. Equipment min and max are respected through `stepLoad` and `roundToAvailableLoad`.

## Blocking

None.

## Should fix

### S1. `Adjust` on the rule's offer applies even after the set no longer triggers it

- **Where:** `apps/mobile/src/coach/coach-service.ts`, `applyRuleOffer` (about lines 628–640). It works out the change again with `ruleAdjustment(session, offer)` and compares the sets and targets (`sameRuleChange`). It never re-checks that the logged set still triggers `offer.kind`.
- **Failure scenario:** Offline, Ben logs bench set 1 at RPE 10 against the built-in 8.5. The rest card shows `That looked hard.` with `Next sets: 95 kg × 3–6 [Rule]`. Ben opens Edit set, picks `Target RPE 10` (he meant it as all-out), or changes the logged RPE to 8, and saves. He returns to the card and taps `Adjust` before the asynchronous F4 re-check has cleared the offer (it reads availability and the database first). The change applies to sets 2 and 3, even though the reason for the offer no longer holds. I confirmed this. In the B2 test (`coach-fallback.test.ts:571`), after the correction, `applyRuleOffer(shown)` returns `{ status: 'applied' }` where `stale` was expected. The banner and Undo make the change visible, but rule 5 says a stale offer should be refused rather than applied to newer state. The window is also open for the effort chips on the rest card (r3 N3 path).
- **Fix:** in `applyRuleOffer` (and in `ruleOfferFor`), return `{ status: 'stale' }` unless `(await triggerOf(session, offer.setId))?.kind === offer.kind`. Add the assertion above to the B2 test, plus a logged-RPE correction case (10 → 8).

## Nits

- **N1.** `NextSessionBasis.benRpe` (`next-session.ts:36, 251, 265`) is computed but nothing reads it. In the summary turn, the coach's context (`render.ts` `workoutView`) shows the resolved target, which is Ben's one-day `@ RPE 7`, and doesn't show the usual 8.5. A coach that repeats what it sees now gets a `bigger` proposal ("The effort target changes.") where a small default would fit. Show both values to the coach (for example `@ RPE 7 (Ben, today; usual 8.5)`) or remove the unused field.
- **N2.** A failed catalogue read gives the accessory profile rather than "unknown". `workout-services.ts` (`exerciseById(id).catch(() => null)`) and `coach-service.ts` `ruleRpesOf` (`.catch(() => null)`) both map a read error to `null`. `ruleTargetRpes` treats `null` as "no catalogue entry, accessory profile 9". So a main barbell lift whose read failed shows and is judged at `@ RPE 9` rather than 8.5. Map errors to `undefined` (the row is left out, and its target falls back to D20) and keep `null` for a real "not in the catalogue".
- **N3.** The short form of playbook rule 5 (`playbook-v1.json`, `playbook-v1.md` table row 5) says "reps below the range minimum". It leaves out the single-number "short by ≥ 2" case and the "unless effort ≤ target − 1" exception that rule T and the CHANGELOG state. The coach reads the short form. Copy the rule T wording or refer to it.

## Spec issues (for Ben; not code defects)

These are still open in `open-decisions.md` §D and are unchanged since round 2:

- **SP1:** The built-in target of RPE 9 for compound and isolation lifts follows Ben's decision (b) exactly. It means RPE alone never fires "too hard" on those lifts (it would need 10.5), while "too easy" fires at 7. Suggested: 8.
- **SP2:** Decision (b) says the coach's recommendation drives the target RPE, but CA8 makes any change to the next-session RPE `bigger` (a proposal). Ben needs to say whether ±0.5–1 counts as small.
- **SP3:** A planned RPE 10 also suppresses "too easy", and "too easy" is skipped when reps were short. Both are extensions of approved rule T, not Ben's words.

## What was checked and is fine

- **Rule 2:** Neither `set_target_rpe` nor a `targetRpe` correction touches `actual` or `Edited`. `set_target_rpe` changes pending working sets only. The coach's Undo keeps Ben's override (`reducer.ts` revert, `withRpeOverride`).
- **Rule 3:** The rule's offers apply only on `Adjust`. Ben's own chips apply at once with Undo. A coach answer, even one with no change, is never replaced by the rule. Ben's Cancel isn't treated as a failure.
- **Rule 4:** Snapping and equipment min/max hold in every convention. An increase is never made after a miss (`session-adjust.ts:208`, and the guardrail).
- **Rule 5:** All writes are version-gated and opId-idempotent: `set_target_rpe`, `correct_set`, `applyRuleOffer` and `applyRuleRequest`. There are replay tests for each, plus restart tests (the override and the rule change with its Undo survive a force-close). The one gap is S1.
- **Rule 9:** A coach RPE raise above the resolved target is blocked by a pain flag today and for the next session. The rule's "too easy" is blocked by a pain flag or by pain at check-in.
- **Honest AI status and minimal copy:** captions are `Offline`, `Not connected` and `Unavailable`. Labels are `Rule`, `Adjusted sets 2–3`, `Change undone.`, `Nothing to change.`, `Out of date. Nothing changed.` and `@ RPE 8`. "Your target RPE stays." appears only under `Why?`. No reassurance lines and no canned coach replies.
- **Your data:** the override is stored on the owner's workout. No coaching-knowledge store is written.
