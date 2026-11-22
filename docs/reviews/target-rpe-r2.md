# Review r2: target RPE, deviation triggers and the built-in fallback for today's sets

Branch `claude/coach-fallback` (head `64e6beb`), diff against `claude/gracious-knuth-joxqpw`. This round re-checks the fixes since [target-rpe.md](target-rpe.md) (`8d23960..64e6beb`) and looks at the whole branch again against Ben's decisions (a) to (d) (CHANGELOG 2026-10-11 "Offers follow the target RPE" and "Built-in fallback for today's sets"), CLAUDE.md rules 2 to 5, minimal copy, schema and migration safety, and tests.

## Verdict: PASS

Both round 1 blockers are fixed and tested, and so are all three should-fix items. Nothing new blocks. One new should-fix item (S1 below) is a narrower form of the round 1 B1 class, and it only applies when Ben has set his own target for the day. It can follow in a small change.

### Checks run

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npx vitest run --testTimeout=180000`: 4129 passed, 2 failed, 1 todo (205 files). The 2 failures are the same timing tests as in round 1, in files this branch doesn't touch: `apps/mobile/test/backup-perf.test.ts` "never blocks the JS thread" and `packages/catalogue/test/definition.test.ts` D6. Run on their own they pass (`2 files, 41 passed`), so they are machine-load flakes.
- Merge: `claude/gracious-knuth-joxqpw` is an ancestor of HEAD (merge commit `764617e`). The CHANGELOG has main's "Offers follow the target RPE" entry, followed by this branch's entry.
- Migrations: no change to `packages/persistence` on this branch. The override lives in the `planned` JSON, and `SetSnapshot.targetRpe` is optional, so main's migration 8 can't collide and older backups still parse.

### Round 1 findings, re-checked

| Round 1 | Status | Evidence |
|---|---|---|
| B1: the next-session baseline ignored the resolved target | Fixed | `next-session.ts:242` uses `targetRpeOf(plannedSet ?? first, ruleTargetRpe)`. Restating a rule or plan value is not stored (`:187`). Tests: built-in plan, routine RIR 2, and a pain-blocked raise (`target-rpe-commands.test.ts:146–193`) |
| B2: no target RPE in Edit set | Fixed | `EditSetScreen.tsx:190–213`, saved through `correct_set.patch.targetRpe` (`reducer.ts:543–556`). It is version-guarded, opId-idempotent and audited (`SetSnapshot.targetRpe`), never touches `actual` or `Edited`, and warm-up and drop sets are refused. F4 re-runs the offer check. Tests cover the domain path and the service path through F4, where the shown offer clears (`coach-fallback.test.ts:571`) |
| S1: a coach RPE raise against a built-in or RIR target | Fixed | `adjust.ts:322–333` compares against `beforeEffective`. Tests cover a pain flag, a lighter session, RIR 2, and a restatement (`coach-guardrails.test.ts:1100–1143`) |
| S2: the banner could show an RPE that isn't in force | Fixed | The coach's `rpe` is dropped on sets that have Ben's override, with guard note `rpe_overridden` ("Your target RPE stays.", under `Why?`) |
| S3: half-step RIR | Fixed | `trigger.ts:100–106`, with tests |
| N1 / N2 / N3 | Fixed | §4.8 states the `Today` scope. `withExerciseInfo` is in `load-order.ts`. The open questions are moved out of the approved list |

### Ben's decisions, re-checked across the branch

- **(a)** CA6, ADR 0006 amendment 3, playbook rules 5 and 6 notes, rule T and D20 all record the built-in fallback for today's sets. It is an offer only, applies on `Adjust`, carries the `Rule` tag and has Undo. Ben's own `Too hard` / `Too easy` with no coach applies at once, because he asked (CLAUDE.md rule 3).
- **(b)** `targetRpeOf` resolves the target in this order: Ben, then the coach, then the plan (RIR read as 10 − RIR), then the rule. `builtInTargetRpe` = min(profile, 9). The target line shows `@ RPE 8`. Ben can override it from the exercise `⋯` menu (set, exercise or today) and from Edit set.
- **(c)** Rule T table tests cover every clause, including that a planned RPE 10 never fires and that D20 applies only when a set has no target.
- **(d)** 2% per point, at least 5% and at most 10%, rounded down to an achievable load, otherwise fewer reps. This holds across conventions and equipment min/max.

## Blocking

None.

## Should fix

### S1. When Ben set his own target for today, it becomes the next-session baseline, so the coach going back to the normal target turns into a proposal

- **Where:** `packages/domain/src/coach/next-session.ts:242` (`targetRpeOf(plannedSet ?? first, …)` returns Ben's `rpeOverride` first), `:187` (a restatement only counts for source `rule`/`plan`), and `:91`.
- **Failure scenario:** Ben feels flat and sets `Target RPE 7 → Today`. After the session the coach returns bench `100 → 102.5 kg × 6–8, rpe 8.5`. That is one load step, back at the normal built-in target. `last.rpe` is 7 (source `ben`), so 8.5 ≠ 7 gives `bigger` with "The effort target changes.", and a small change that should be the default needs `Apply`. If the coach instead keeps `rpe 7`, it is stored as the coach's target for next session (small, applied by default). So a one-day "easy today" choice carries forward unless Ben taps Undo. Ben's override is scoped to this workout (§4.8), so neither result matches what he chose.
- **Fix:** when `lastRpeSource === 'ben'`, also work out the target without the override (coach, then plan, then rule). Treat an `after.rpe` equal to that value as restating, so nothing is stored and it isn't a change. The coach context could also show both values (for example `@ RPE 7 (yours today; usually 8.5)`) so the coach doesn't copy a one-day value forward. Add a test for a `Today` override followed by a coach next-session target at the rule's value.

## Nits

- **N1.** ADR 0006 amendment 3 (`docs/decisions/0006-coach-led-progression.md:43`) still says Ben's override is "from the exercise `⋯` menu" only. Add "or on a logged set from `Edit set`", as the CHANGELOG and §4.8 now do.
- **N2.** `handleCorrectSet` (`reducer.ts:543–556`) accepts `targetRpe` on a finished session. The UI only offers it in an active workout (`buildSetEditView`), but a stored override on a finished workout would change the next-session baseline. Refuse `targetRpe` unless `session.status === 'active'`, which matches the sheet.
- **N3.** Edit set's chips have no `Default` choice. The only way to clear Ben's value is to tap it again, while the `⋯` menu has `Default`. Use the same choice in both places for consistency, still with minimal copy.
- **N4.** Changing a set's type to warm-up or drop in Edit set leaves any `rpeOverride` on it. It does no harm, because `targetRpeOf` ignores those types, but clearing it in the same correction keeps the audit clean.
- **N5.** The "Open questions for Ben" are now a separate heading but still sit inside `docs/brief/CHANGELOG.md`. That is acceptable for now, but move them to an open-questions file once one exists, so the CHANGELOG lists only approved changes.
- **N6.** (Carried over from round 1 N4) `WorkoutScreen.tsx` captures `expectedVersion` when the `⋯` → `Target RPE` sheets open. Re-read it just before dispatch to avoid refusals that aren't needed.

## Spec issues (for Ben; not code defects)

SP1 to SP3 from round 1 are still open and are now listed under "Open questions for Ben" in the CHANGELOG. They are:

- the built-in RPE 9 target for compound and isolation lifts, which means RPE alone never fires "too hard" and "too easy" fires at RPE 7;
- whether a ±0.5–1 next-session RPE change counts as "small" under CA8;
- a planned RPE 10 also suppressing "too easy".

S1 above depends on how SP2 is answered: if a small RPE change counts as small, the proposal half of S1 goes away, but the carry-forward half doesn't.

## What was checked and is fine

- **Rules 2 and 5.** Logged values are never changed by a target RPE edit. Every write is version-guarded and opId-idempotent, including the replay test for the service path. The coach's Undo keeps Ben's override.
- **Rule 4.** The rule's offers are snapped to achievable loads and bounded by equipment min and max, as in round 1.
- **Rule 9.** An RPE raise above the resolved target is blocked by a pain flag, both today and for next session.
- **Minimal copy.** The UI uses `Target RPE`, `@ RPE 8`, `Rule`, and "Your target RPE stays." only under `Why?`.
- **Your data.** The override is stored on the workout (owner-scoped). No coaching-knowledge store is touched.
