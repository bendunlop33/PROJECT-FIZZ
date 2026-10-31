# Review: target RPE, deviation triggers and the built-in fallback for today's sets

Branch `claude/coach-fallback` (head `011b2b1`), diff against `claude/gracious-knuth-joxqpw` (merge base `c91a724`).
Checked against: Ben's decisions (a) to (d) (CHANGELOG 2026-10-11 "Offers follow the target RPE", and his build 108 report that the coach "didn't change sets for the set or session"), CLAUDE.md rules 2 to 5, minimal copy, schema and migration safety, and tests.

## Verdict: CHANGES NEEDED

Most of the work is solid. Rule T now compares each set with its target RPE, as Ben specified, and every case in (c) has its own test row. The built-in rule's change for today's sets only offers, applies on `Adjust`, carries the `Rule` tag and has one-tap Undo. That write is versioned and idempotent, and the stale-offer check compares the change worked out again now with the one Ben was shown. Ben's `set_target_rpe` is version-gated, opId-idempotent, never touches logged, warm-up or drop sets, and survives the coach's Undo. There is no new migration (the override lives in the `planned` JSON), so migration 8 on main can't collide. The docs (CHANGELOG, ADR 0006 amendment 3, CA5, CA6, §4.8, playbook rule T, rules 5 and 6, D20) cover (a) to (d).

Two things block merging. The next-session classifier compares the coach's target RPE with the wrong baseline, so the coach's small changes quietly turn into proposals (B1). And Ben's explicit "Edit set" entry point for the override isn't built (B2).

### Checks run

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npx vitest run --testTimeout=180000`: 4115 passed, 2 failed, 1 todo (205 files). The two failures are in files this branch doesn't touch: `packages/catalogue/test/definition.test.ts` D6 (60 s timeout) and `packages/persistence/test/backup-perf.test.ts` "never block the JS thread" (1047 ms against a 1000 ms limit). Both pass when re-run on their own (`42 passed`), so they are machine-load flakes.
- I also ran a probe script outside the repo against `classifyNextSessionChange`, `evaluateCoachTrigger` and `tooHardDropPct` to confirm B1, S3 and SP1.

## Blocking

### B1. A coach next-session target that restates the current target RPE becomes a proposal, so its small change isn't applied by default (rule 3; decision (b))

- **Where:** `packages/domain/src/coach/next-session.ts:226` (`lastRpe = planned?.rpeOverride ?? planned?.rpe ?? null`) and `:83` (`after.rpe !== (last.rpe ?? null)` → `'The effort target changes.'`).
- **Cause:** the baseline is only the stored `planned.rpe` or override. It isn't the set's resolved target (`targetRpeOf`). On a built-in plan, `next-target.ts:80` stores `rpe: null`, and a routine RIR isn't counted either. But the coach *sees* the resolved value: `context.ts` `workoutView` shows `targetRpeOf(..., ruleTargetRpe)`, and the summary turn gets `ruleTargetRpe` (`coach-service.ts:319`).
- **Failure scenario:** Ben finishes a squat session on the built-in plan. The coach's context shows the squat target as `@ RPE 8.5`. It returns `100 → 102.5 kg × 3–6, rpe 8.5`, which is one step and the same effort. `last.rpe` is null, so 8.5 ≠ null makes the row `bigger`. The one-step load change becomes a proposal needing `Apply`, not the default with Undo. The same happens on a routine with `rir: 2` when the coach sends `rpe: 8`. Probe output: `classifyNextSessionChange({100 kg, 3–6}, 3, {100 kg, 3–6, rpe 8.5}, 3, …)` → `{ size: 'bigger', reasons: ['The effort target changes.'] }`. Ben's complaint was that the coach "didn't change" things, and this reproduces it for next time.
- **Test gap:** `packages/domain/test/target-rpe-commands.test.ts:122` only covers a `last` that already has an explicit `rpe: 8`.
- **Fix:** build `last.rpe` from the resolved target. Pass the rule RPEs into `nextSessionBases`, use `targetRpeOf(set, ruleRpe)`, and count RIR as 10 − RIR. Treat an `after.rpe` equal to that as unchanged. Add tests for a built-in-plan session (no stored RPE) and for a routine RIR target.

### B2. Ben's override isn't reachable from Edit set, as his decision (b) says

- **Where:** `apps/mobile/src/screens/workout/EditSetScreen.tsx` has no target RPE control. Only `WorkoutScreen.tsx:675`/`pickTargetRpe` (exercise `⋯`) sets it. `handleSetTargetRpe` refuses logged sets (`reducer.ts` `set_not_pending`).
- **Decision text:** "(b) … Ben can override it for a set, an exercise, or today (Edit set + exercise ⋯; stored as Your data, versioned)".
- **Failure scenario:** Ben planned an all-out last set but didn't set it beforehand. He logs RPE 10 against the built-in 8.5 and gets "That looked hard." He opens the set's Edit sheet to say it was planned at 10, but there is no control there. The only route is `⋯` on the *next* set, which can't change the judged set or clear the offer.
- **Why it blocks:** the developer flagged this as "Implementation choices for Ben to confirm" (`docs/brief/CHANGELOG.md:178`), which is the right instinct. But it reverses an explicit Ben decision, and CLAUDE.md says Ben approves brief changes. The branch shouldn't merge as "(b) done" until he has answered.
- **Fix:** either add `Target RPE` to Edit set, or get Ben's explicit sign-off on the deviation. If added, cover both pending sets and the just-logged set: a versioned correction of `planned.rpeOverride`, recorded in the audit, never touching `actual`. Then re-run the offer check through the existing F4 `corrected` path, and add tests for the stale version, the replay and the offer clearing.

## Should fix

### S1. A coach raise of target RPE isn't treated as an increase when the plan has no stored RPE, so pain flags and a lighter session don't block it (rule 9)

- **Where:** `packages/domain/src/coach/adjust.ts:220` (`after.rpe != null && b.rpe != null && after.rpe > b.rpe`), with `b` from `targetOf` (`:235`), which reads only `planned.rpe`.
- **Failure scenario:** bench has an active shoulder pain flag. The plan is built-in, so the effective target is 8.5 and `planned.rpe` is null. Ben says "push these last sets". The coach sends the same load with `rpe: 10`, `b.rpe` is null, so it isn't an increase and the change applies. Every remaining bench set now targets RPE 10 on a painful movement, and rule T stops offering "too hard" on them, since a planned all-out set never triggers.
- **Fix:** compare against the resolved target (`targetRpeOf` with the rule value, RIR as 10 − RIR). Add a test for a pain flag with no stored RPE.

### S2. The banner can announce a coach target RPE that isn't in effect

- **Where:** `packages/coach/src/render.ts:73` (`… @ RPE 9` in the before/after), `reducer.ts` `coachTarget` (stores `planned.rpe` while Ben's `rpeOverride` still wins).
- **Failure scenario:** Ben set `RPE 7` for this exercise. The coach changes the remaining sets to `95 kg × 5, rpe 9`. The banner reads `100 → 95 kg × 5 @ RPE 9`, but the target line and the trigger both use Ben's 7. The UI states a target that isn't the one in force (rule 1 honesty, rule 2 visible change).
- **Fix:** in `validateTodayAdjustment`, drop `rpe` for sets with an override and add a short guard note (behind `Why?`), or leave the RPE out of the banner for those sets. Add a test.

### S3. The RIR-scale fact can show a half RIR

- **Where:** `packages/domain/src/coach/trigger.ts:96–98`.
- **Failure scenario:** a main barbell lift with the built-in 8.5 target, logged as RIR 0, shows `RIR 0 on set 1 (target RIR 1.5)` (probe output). RIR is a whole-rep scale, so this reads like a bug.
- **Fix:** when the target isn't a whole RIR, show `(target RPE 8.5)`, or round toward the safer side. Add a test.

## Nits

- **N1.** `set_target_rpe` with scope `today` (`reducer.ts:1481`) applies only to sets that exist at the time. An exercise added afterwards keeps the coach's or the rule's target. This is acceptable, but say so in §4.8 or apply the today-level value on `add_exercise`.
- **N2.** `exerciseInfo` is loaded once per workout load (`workout-services.ts`). A newly added exercise has no `@ RPE` and no `Target RPE` menu item (`f.targetRpe === null`) until the next reload. The trigger path (`ruleRpesOf`) reads fresh, so offers are unaffected. Reload the info after `add_exercise`.
- **N3.** `docs/brief/CHANGELOG.md:178` puts "Implementation choices for Ben to confirm" into the log of approved changes. Move them to an open-questions list (or the review) until Ben answers, then record his answers.
- **N4.** `WorkoutScreen.tsx:720` captures `expectedVersion` when the first sheet opens. Any version bump while the two sheets are up gives "The workout changed. Try again." This is correct (rule 5), and a re-read before dispatch would avoid needless refusals.

## Spec issues (for Ben; not code defects)

- **SP1. The built-in target of RPE 9 for compound and isolation lifts changes how often offers fire, in both directions.**
  - With "harder" at target + 1.5, a target of 9 needs RPE 10.5, so RPE alone never fires "too hard" on compound or isolation lifts. Only main barbell lifts (8.5) fire on RPE 10. The test row `'RPE 10 at target 9: none'` confirms this.
  - "Easier" at target − 2 fires at RPE 7. That is a normal accessory rating for Ben, and before this change the threshold was ≤ 6. This works against rule 3's "never adjusts constantly".
  - The `rpe` in `default-rule.ts:61–62` is a *progression ceiling* ("progress only at RPE 9 or easier"), not a prescribed effort. Playbook rule 3 says working sets default to RPE 7–9.
  - Suggest Ben confirm, or choose a built-in target of 8 for compound and isolation lifts. That keeps both triggers meaningful: harder at ≥ 9.5, easier at ≤ 6.
- **SP2. CA8 versus decision (b).** CA8 says effort targets don't change for "small" changes. So any coach recommendation of a different target RPE for next session is always a proposal, while (b) names the coach's next-session recommendation as the source of the target. Ben should decide whether a ±0.5 to 1 RPE change counts as small.
- **SP3. Extensions of Ben's decisions that need his confirmation.** A planned RPE 10 also suppresses "too easy" (approved rule T supports this), and "too easy" never fires on a set whose reps were short. Both are reasonable, and the developer has flagged them.

## What was checked and is fine

- **Rule T (c):** ≥ target + 1.5. Any rep below a range floor counts, or a short of ≥ 2 on a single-number target, unless effort ≤ target − 1, and a miss with no effort logged still counts. "Easier" is ≤ target − 2 with ≤ 12 reps. A planned RPE 10 never fires. D20 applies only with no target. All of these are in table tests (`coach-guardrails.test.ts:542–584`).
- **Change size (d):** 2% per point, with a 5% floor and a 10% cap, rounded down to an achievable load, falling back to fewer reps (`tooHardDropPct`, `easierLoad`). Per-hand dumbbells, lb bars, stacks, assisted machines (more assistance), equipment min and max, and bodyweight are all tested (`session-adjust.test.ts`).
- **Rules 2 and 5:** logged sets are never changed. Rule offers re-check the shown change before applying (`sameRuleChange`). opIds are deterministic per trigger, so a double tap applies once. Undo restores `before` and keeps Ben's override.
- **Durability:** a force-close and a replayed `set_target_rpe` are tested (`0e41f71`). No schema migration is needed or added.
- **Minimal copy:** `@ RPE 8`, `Rule` tag, `Target RPE`, `Default`, `This set` / `This exercise` / `Today`. No explanatory lines in the main UI.
