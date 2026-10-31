# Review: multi-day plans + plan tracker v1 (`claude/plans-19oct`, 5217386..fca1358)

**Verdict: CHANGES NEEDED** (1 blocking issue)

Reviewer: independent reviewer agent, 19 Oct 2026.

## What I checked

- `npm run typecheck`: pass. `npm run lint`: pass. Full suite (`npx vitest run --maxWorkers=2`): 322 files, 6614 passed, 1 todo.
- I read the whole diff: domain (`coach-plan.ts`, `plan-tracker.ts`, `routines.ts`), schemas, persistence (migration 20, `plan-drafts.ts`, coach store), coach (`plan.ts`, `request.ts`, `turn.ts`, `registry.ts`, `reply.ts`, `render.ts`), app services and screens, tests, and the CHANGELOG. I checked them against the spec, `docs/research/plans-and-plan-progress.md` and CLAUDE.md rules 1 to 10.
- I ran three throwaway probe tests and deleted them afterwards. None were committed.
  1. PPL split, then apply the developer's own 4-day plan (Push/Pull/Legs/Upper), then do 8 workouts following Up next.
  2. A false "I've replaced your workouts… added to your rotation" reply on a plan turn.
  3. Plan vs done with an added set. This one didn't run cleanly; the finding below comes from reading the code.

These work well:
- Apply and Undo each run in one transaction and are idempotent by operation ID.
- A stale card or older version changes nothing.
- Undo refuses rather than overwrite Ben's edits.
- Force-close keeps the plan.
- The first plan workout's loads are re-checked at Start (history, pain, gym max, kg/lb, per-hand, assisted).
- `plan_drafts` is in Your data and backups.
- False "applied/saved" claims in the reply are hidden (probe 2: both sentences hidden).
- Nothing in the UI copy says "missed".
- A plan request with no AI changes nothing.

## Blocking

### B1. With a split set, a plan day that isn't a split day is never Up next, so the plan can never be completed

- **Where:** `apps/mobile/src/services/workout-services.ts:1875-1939` (`resolveUpNext`, then `splitUpNext`, then `splitDayPlan`) and `packages/domain/src/session/coach-plan.ts:406` (`planRoutineForSplitDay`).
- **Failure (reproduced):** Ben has PPL in Profile. He asks "Build me a 4-day plan", the coach returns Push/Pull/Legs/Upper (the developer's own fixture), and he applies `Replace my workouts`. Over 8 workouts Up next went Push, Pull, Legs, Push, Pull, Legs, Push, Pull. `Upper` (Day 4 of 4) never came up. Progress stays at `Plan this week 3 of 4` forever.
  - Worse: if Ben asks for a different structure from his Profile split ("Upper/lower, 4 days"), which the spec allows ("following his Profile split **or what he asks**"), no plan day maps to a split day. The split logic then keeps planning from his old named workouts or session history, and **the applied plan is ignored by Up next**. Ben approved "Up next walks through them", and in this case it doesn't.
- **Why the tests miss it:** the split test (`coach-plans.test.ts`, "with a split…") checks only the first Up next. The behaviour is recorded as a "PM decision, pending Ben", but it breaks the approved scope, so it can't wait for that decision.
- **Suggested fix, any one of these:**
  - (a) While an applied plan exists, let the plan walk (`planUpNext`) decide Up next even with a split set. Split-day mapping then only names the days.
  - (b) In split mode, offer a non-split plan day when it is the least recently done plan day (treat each plan day as its own slot in the due order).
  - (c) At minimum, make `checkPlanProposal` map or flag every day when a split is set, and show the Apply consequence on the card. This alone does not meet the spec.
- **Tests to add:** walk a full cycle with a split and a non-split day, and apply an Upper/Lower plan while the Profile split is PPL.

## Should fix

### S1. "Over: more sets than planned" can't happen, and added sets inflate "planned"

- **Where:** `packages/domain/src/progress/plan-tracker.ts:58` (`isPlanned`) and `:93` (`combine`'s `extraDone`), together with `packages/domain/src/session/reducer.ts:1089`. `add_set` copies the template set's `planned` values.
- **Failure:** Ben adds a 4th bench set mid-workout. It inherits the planned reps, so it counts as planned. The Summary shows `4/4 sets · … · Hit` and the header `10/10 planned sets` when the plan was 9. That breaks the "numbers only from real data" requirement and contradicts the CHANGELOG rule.
- **Fix:** tell start-time sets apart from sets added after Start. Use an existing marker, or add one (for example, the set's creation op compared with the session start). Count only start-time sets as planned. Add a test.

### S2. The Consistency card counts workouts but labels them "days"

- **Where:** `apps/mobile/src/progress/consistency-view.ts:21`, where the accessibility label reads `N of M days`. The weekly counts come from `plan-tracker.ts` `consistency()`.
- **Failure:** two workouts on one day (for example a FitNotes import plus a logged one, or AM/PM sessions) count as 2 towards a "days a week" aim. A week can then be marked at the aim (✓) and counted in `Weeks at your aim` when Ben trained fewer days. VoiceOver also says "days" for a workout count.
- **Fix:** count distinct local training dates against the aim (keep a workouts count if it's wanted), or label everything as workouts. This is open question 4, but the mismatched label is a factual error either way.

### S3. Applying a second plan leaves the first plan "Applied" with an Undo that always refuses

- **Where:** `packages/domain/src/session/coach-plan.ts:300` (`applyPlan` doesn't look at other applied plans) and `packages/persistence/src/plan-drafts.ts:50` (`applied()` picks the newest).
- **Failure:** Plan A is applied, then plan B is applied with Replace. A's workouts leave the rotation (their versions go up). A's card still shows `Applied · Undo`. Tapping it says "Can't undo: Push, Pull, … changed since", naming workouts Ben never touched. If B is then undone, A becomes the active plan again without any visible change.
- **Fix:** at B's Apply, mark A as superseded inside the same transaction. Show its card as ended, and let B's Undo restore A's state. Add a test for this.

### S4. Apply saves catalogue exercises outside the Apply transaction, even when Apply then fails

- **Where:** `apps/mobile/src/services/plan-services.ts:127` (`ensureExercises`, called before the stale and duplicate checks).
- **Failure:** a stale or old card still writes exercise rows into Ben's data, and Undo leaves them behind. This is a small side effect of a proposal Apply that was refused.
- **Fix:** check stale and duplicate first, or write the exercise rows inside `repo().apply`'s transaction.

### S5. Test gaps on the edge cases above

There is no test for:
- B1: a full cycle with a split and a non-split day.
- S1: an added set against the plan.
- S3: a second plan applied over a first.
- S2: two workouts on one day against the aim.

## Nits

- N1. `packages/coach/src/plan.ts:222`: `PLAN_INSTRUCTIONS` tells the model to "build the week" when Ben asks for a block. But `planIn` refuses block requests, so `propose_plan` is never offered on that turn. The instruction contradicts the gate. `PLAN_LINE` (`:226`) is an unused export.
- N2. `render.ts` (`build_plan`): the tool-log line "Plan ready … Not applied." still shows after Apply. The rendered `accessibilityPrefix` is "Saved change." for something that wasn't applied.
- N3. `plan-services.ts:174`: the card's `replaces` list is read when the card loads. Apply takes out whatever is in the rotation inside the transaction, which can include workouts added since that the card didn't list. Undo restores them, so this is low risk.
- N4. `PlanDayView.checks` is built but never rendered. The plan-level `Why?` shows `guardNotes`, so nothing is lost, but it's dead data.
- N5. With nothing in the rotation, `Replace my workouts` and `Add alongside` do the same thing. Consider showing only Apply in that case.

## Spec issues

- **"Follow his Profile split (or what he asks)" vs "plan days map to split days".** These conflict when Ben asks for a structure that isn't his split (Upper/Lower while his Profile says PPL). The spec needs to say which one drives Up next while a plan is applied. The reviewer recommends that the applied plan drives it (see B1).
- **The consistency aim is "days a week" but the research proposal counts sessions.** Ben should choose between training days and workouts (open question 4). The UI label must match whichever he picks (S2).
- **Undo strictness (open question 1).** Refusing Undo after a rename keeps rule 2 safe, but it may surprise Ben. The trade-off is reasonable to leave for him to decide.
