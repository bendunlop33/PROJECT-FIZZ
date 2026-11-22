# Review: Progress v3 data and Coach's changes (B3 wave 3 rework, 21 Oct 2026)

**Branch:** `claude/b3-wave3-21oct`, commits `3a68a67..9f72c3d` (merge of `claude/gracious-knuth-joxqpw` plus the Progress v3 rework).
**Lens:** the numbers. Covers % of planned reps, tracked reps, real vs estimated points, the projection, sets per muscle, automatic small changes, stale refusal, offline honesty, the merge and migrations.
**Spec:** `docs/design/progress-goals.md` "Progress v3 (agreed)", `prototypes/progress-simple.html`, CLAUDE.md rules 1, 3, 5, 6, 9 and 10.

## Verdict: **CHANGES NEEDED**

Two blocking bugs, both confirmed with temporary probe tests (since deleted):

- A weekly review with two small changes on the same plan day applies the first and marks the second "Out of date".
- The `at this rate` date and `On track` can show for a lift whose recent weeks fell.

The rest of the data layer is in good shape:

- % of planned reps is correct. A probe confirmed warm-ups are left out, a skipped set counts 0, a set added in the workout counts as done, and an other-side companion isn't counted twice.
- Tracked reps follow target, then plan, then picked, then logged. Estimates use Epley on 3–12-rep sets, matching `estimateOneRepMax`.
- The apply op ID is deterministic, so a force-close mid-apply is safe.
- A pain flag blocks a change, and stale templates are refused.
- Offline reads `Not reviewed · Offline`.
- The merge is clean, and migrations run 1–32 OK.

### Validation (run by the reviewer)
- `npm run typecheck`: pass
- `npm run check:migrations`: "Migrations OK: 1 to 32"
- Targeted vitest (`progress-page`, `lifts-layout`, `weekly-review-service`, `weekly-review-app`, `reviews-screens`): pass
- `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: pass
- Full suite `npx vitest run --maxWorkers=2`: 452 files, 8438 passed (1 todo)
- Probe tests, all deleted afterwards:
  - two changes on one routine
  - eta with stale real points
  - a `one_rm` target
  - a plateau
  - per-hand estimates
  - a lb set on a kg profile
  - muscles counting uncountable sets
  - a real-reducer session with a warm-up, a skipped exercise and an added set (planned 36, done 24, as expected)

---

## Blocking

### B1. The second small change on the same plan day is always refused as stale (rule 3, rule 5 misapplied)
`apps/mobile/src/reviews/weekly-review-service.ts:560`, `:574-580`. Every proposal carries the template `expectedVersion` read when the review was made. `autoApply` writes them in turn, and each write bumps the routine version. Any later proposal on the **same routine** then fails `withTemplateWorkingSets` with `expectedVersion` v ≠ v+1, so it is marked `stale`.
- **Failure (probe):** Legs gets `Leg curl 3 → 4` and `Bench 3 → 4` in one review. After the next open the statuses are `[["p1","applied"],["p2","stale"]]`. Coach's changes then shows a change Ben never saw as `Out of date`, and the coach's legitimate change is lost. This is the normal case, since code's repeated-edit suggestions and the coach's tweaks cluster on one plan day.
- The existing test (`weekly-review-service.test.ts` "applies the small changes itself") uses the **same exercise** for p1 and p2, so it can't catch this.
- **Fix:** guard each small change at the **exercise** level, not the routine version. Redo already does this (`templateWorkingSets(routine, exerciseId) === fromSets ? routine.version : null`). Apply should accept the current version when the exercise's working sets still equal `fromSets` and the routine's version is newer only through changes this review made. The simplest form: re-read the routine and pass `routine.version` when `templateWorkingSets === fromSets`, otherwise refuse as stale.
- Undo needs the same treatment. `undoRoutineChange` restores the whole `before` snapshot, so undoing p1 after p2 was written would either refuse (`changed_since`) or roll back p2 too. Make Undo the inverse per-exercise write (`toSets → fromSets` while it is still `toSets`), recorded as its own `update_routine`/undo action.
- Add a test with two exercises on one routine covering: both applied, Undo of the first leaves the second, and Redo of the first.

### B2. `On track` and `about … at this rate` can show on old real points while recent weeks fell (rule 6; spec "only after ≥4 weeks of rising top sets")
`packages/domain/src/review/progress-page.ts:349-372`. `liftEta` takes the last 4 **real** points wherever they fall in the 8 weeks. It ignores newer estimated points, and it dates the projection from that old point's week.
- **Failure (probe):** real 90, 92.5, 95, 97.5 × 6 in weeks 0–3, then only 85 × 4 in weeks 5 and 7 (est. 80.5 × 6). The output is `current ○ 80.5`, `onTrack: true`, `eta: "about mid-Oct at this rate"`. Ben is told he's on track to 110 this month while his latest estimate dropped 17 kg.
- **Fix:** require the 4 rising real points to be the **most recent** weeks with a point. If any newer point exists, or the newest real point isn't in the last 2 weeks, return null. Project from the newest point (real or estimated) and refuse when the newest point is below the run. Add tests for this case and for gaps.
- **Related nit:** "rising" accepts flat runs (100, 100, 100, 102.5 passes) because the check is `<`, not `<=`. Decide whether a plateau counts as "rising"; the spec says rising.

---

## Should fix

### S1. A `one_rm` target tracks the lift at 1 rep, so any set counts as a "real" 1-rep top set
`progress-page.ts:393-398`, `:427`. `LiftTarget.reps` is 1 for `one_rm`, and a point is real when `x.reps >= reps`.
- **Failure (probe):** a 120 kg 1RM target with 97.5 × 5 logged. The row shows `× 1` and current `97.5`, and the subtitle reads `Top set × 1 (target reps) · 97.5 now`. That shows a 5-rep set as his 1RM (rule 6, a filled point presented as a 1-rep top).
- It is also `On track`, with `about mid-Dec at this rate` toward 120 projected from 5-rep sets.
- `liftTargetStatus` uses est. 1RM for this kind, so the two screens disagree.
- **Fix:** for a `one_rm` target, a real point is a single (reps = 1). Other sets give an est. 1RM point (hollow, labelled), using the existing 1–10-rep e1RM rule or the agreed 3–12. Alternatively, track `one_rm` lifts at the plan's reps and show the target only in the gutter. This needs a call from Ben; see Spec issues.

### S2. The Muscles plan line re-judges past weeks against today's templates
`progress-page.ts:575-588`. `planned` for each of the 8 past weeks comes from `input.templates`, the **current** templates.
- **Failure:** B1's own auto-apply (Leg curl 3 → 4) raises the plan line for all 7 earlier weeks of the plan. Weeks that were "At plan" turn faded "Under", and the VoiceOver line `At plan in n of 7 weeks` changes after the fact. The earlier design pinned past weeks to their stored values.
- **Fix:** use each week's planned sets as snapshotted on that week's plan sessions (`WorkoutSet.planned`, as `plannedVsDone` does), or the stored `group_sets.planned` from that week's review. Use today's templates only for the current week.

### S3. The same-machine rule for stacks and plate-loaded lifts was dropped
`progress-page.ts:414`, `:425`. Points are filtered by load convention only. The spec says "Same-machine rule for stacks/plate-loaded kept" (`SeriesKey`/`equipmentId`).
- **Failure:** Lat pulldown at two gyms (a 5 kg stack and a 7 kg stack with different cams) is drawn as one line, with fake jumps, a fake `On track` and a fake eta.
- **Fix:** carry `equipmentId` on `ReviewExercise`. For `stack` and plate-loaded `added`, keep only the newest equipment's series, as `SeriesKey` does elsewhere.

### S4. The Summary doesn't say what the % hides
The agreed spec says: "Because extras can offset a skipped set, the Summary detail always names what was short or skipped. Tap → that workout's Summary with `156 of 170 planned reps` and what was short." Nothing on Summary shows planned reps (`grep "planned reps" apps/mobile/src` finds only the chip's VoiceOver label).
- **Failure:** Ben skips Row entirely but adds extra bench sets, sees `Mon – 100%`, taps through, and nothing tells him Row was skipped.
- **Fix:** add the `n of m planned reps` line and the short/skipped names to Summary's plan detail, from the same `plannedReps`/`doneReps`. Alternatively, record it as explicitly deferred with Ben.

### S5. Coach's changes always shows the newest stored review, however old, under "for next week"
`weekly-review-service.ts:620`, `progress-page.ts:697-715`.
- **Failure:** reviews stop for 3 weeks (no workouts, so `weeklyReviewWorthwhile` is false). The page still shows the 3-week-old review's changes as `for next week` with `NEW`/`Got it`.
- **Fix:** show it only when `weekMonday` is the latest reviewable week. Otherwise show the collapsed line with its week (`w/c 29 Sep`), or move it under Past weeks.

### S6. Plan reps use the low end of the range, never a single planned target
`packages/domain/src/review/weekly.ts:148`, plus `topRepsOf` and `templatesOf` in `weekly-review-service.ts`. The spec example ("10 for an 8–12 set planned at 10") can't be met: `planned.reps` is only a `{min,max}` range, so an 8–12 set always counts as 8. The % is inflated, and a lift's tracked reps sit lower than the plan's working target.
- **Fix:** if double progression stores the session's target as `min = max`, document that and add a test. If not, use the set's single target where one exists, then the low end. A fixture with an 8–12 template set and a progressed target of 10 should give planned 10.

---

## Nits
- **N1.** `progress-page.ts:496-499`: a 4th main lift (or a main lift beyond 3) is listed under the `Accessories` header. Use a separate unlabelled group, or cap it.
- **N2.** Lifts' 8 weeks end with the current week, but Muscles' 8 weeks end last week (`progress-page.ts:384` vs `:561`). Same header, `last 8 weeks`, but different windows. Align them, or label the difference behind an info tap.
- **N3.** `lifts-layout.ts:67-75`: the focused chart always uses steps of 5. A lift spanning 40 → 200 kg gets 33 tick labels on top of each other. Choose the step from the range.
- **N4.** `lifts-layout.ts:84`: the dotted eta line always runs 2 columns, whatever the date, so its slope isn't the rate. It's acceptable because the label carries the date, but consider capping its x at the eta week.
- **N5.** `weekly.ts:146`: a planned exercise removed mid-workout (`remove_exercise` → `deleted`) leaves the denominator, so it isn't counted 0 like a skipped set. This matches `plannedVsDone`, but the spec says "skipped planned sets count 0". Confirm the convention with Ben.
- **N6.** `ReviewDetailScreen.tsx` `PastWeeksScreen`: the `error` state renders nothing. Add the one honest line used on the main page.
- **N7.** `thisWeekView`: when one plan day is done twice in a week, only the later session shows. The earlier one appears nowhere in This week.

## Tests missing (beyond those named above)
- `reviewSessionOf` `plannedReps`/`doneReps` edge cases (warm-up, a skipped set, an added set, an other-side companion, `before_start`) have no unit test. Only one integration line (120% / 200%) covers them. The reviewer's probe passed; keep it as a test.
- No test that an auto-applied change isn't re-applied after Ben's Undo across a **re-run with a new review ID**. Carried proposals are filtered by `keyOf`; pin it.
- No test for `autoApply` when the run returns `nothing` after a force-close. Recovery runs only on `cached`/`reviewed`/`not_reviewed`.

## Rules check
- **Rule 1:** offline tag honest, local data only. OK.
- **Rule 2:** completed sets untouched. OK.
- **Rule 3:** small changes auto-applied with reason and Undo/Redo; structural changes asked. OK, apart from B1.
- **Rule 5:** op IDs deterministic and versioned. Stale refusal works but over-fires (B1).
- **Rule 6:** estimates labelled. Not met: B2 and S1.
- **Rule 9:** pain blocks the write. OK.
- **Rule 10:** `seenAtUtc` and `progressLiftReps` are owner-scoped. OK.
- **Minimal copy:** no rule labels. OK.
- **Native dependencies:** none added; Skia goes through the guarded loader. OK.
- **Secrets:** none.

---

## Spec issues (for the PM and Ben, not code defects)
1. **The design moved after this task was written.** `claude/gracious-knuth-joxqpw` now has 7 newer docs-only commits (`570d950..b822f69`), and CHANGELOG "2026-10-21: Progress v3 (Ben's decisions)" records the following as agreed:
   - a **Week | Month calendar** that replaces `Last 4 weeks ▾`, with letters and Cardio dots;
   - **`2 cardio`** instead of `2 runs`;
   - **PB rings** and a PB tag;
   - `TRENDS · last 8 weeks`;
   - Progress tabs **Overview | Lifts | Training**.

   This build follows the older text in the task (squares grid, `runs`, no PBs). Ben or the PM needs to decide whether those are this slice or the next one. The developer's "Decision 1" is now settled by Ben: the calendar.
2. **`one_rm` targets vs "track at the target's reps"** (S1). The spec doesn't say what a 1-rep tracked lift means. Propose: a real point only from a single, estimated otherwise.
3. **3–12 reps for estimates vs the existing e1RM limit of ≤ 10** (`E1RM_MAX_REPS`). The spec says "same e1RM formula" and also "3–12". The two charts can now disagree for 11–12-rep sets. Ben should pick one band.
4. **Plan days have no weekday**, so `Thu – missed` and `Sat – moved` from the spec can't be shown truthfully. The developer correctly shows `missed`/`to do` without a day. Either the spec drops the day on open chips, or plan days get a scheduled weekday (a schema change).
5. **Muscles' "Last week" vs the prototype.** The prototype's last bar is the current, unfinished week; the build uses the last complete week. Confirm which.
6. **Rule 3 wording.** CLAUDE.md says the coach "offers" when it raises a change on its own. Ben's 21 Oct CHANGELOG entry says small next-session changes are applied with Undo. The build follows the newer decision; CLAUDE.md rule 3 should be updated so reviewers don't flag it.
