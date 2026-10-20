# Review: Ben's progress decisions, 20 Oct (items 5, 7, 8, 9) (ben-progress-20oct)

Branch `claude/ben-progress-20oct`, diff from merge-base `c62ef40` (claude/gracious-knuth-joxqpw), 3 commits (`2295adb`, `2d4bc8b`, `eb7d3c4`).
Ben approved these on 20 Oct ("Yes to all"):
- 5: Targets hit on the split day's main lift only.
- 7: Total weight counts both dumbbells and both sides.
- 8: Bodyweight and weighted as one series, with bodyweight as +0.
- 9: Total weight replaces Volume on exercise detail.

## Verdict: PASS

No blocking issues. All four decisions are implemented as Ben worded them:
- **Item 5.** `Main` flags no longer count anywhere `Targets hit` is shown. That covers the plan day, the Exercises tab and exercise detail, which all go through `splitMainLiftIds` / `mainLiftIds`.
- **Item 7.** Total weight already counted both dumbbells and both sides, as built. The per-hand `≈` assumption is still labelled.
- **Item 8.** Bodyweight rows join the BW + series as `+0`:
  - The stored sets are untouched. Only the read model maps them, and a test checks this.
  - These rows never get an Est. 1RM, because `sessionE1rm` returns null for anything except `load` series, and a test checks this.
  - They add 0 to Total weight.
  - The BW + lift-target dotted line now draws on the merged series' Top set. Plate-loaded and one-rep-max targets are correctly kept off it.
- **Item 9.** `Volume` is gone from code and UI, with no stale `'volume'` metric left: the only remaining uses are the `CountPurpose` exclusion key, which is fine. `Total weight` draws as bars on a plain kg/lb axis.

Copy stays minimal. The assumed-count note and `Converted from …` sit behind the info tap.

The should-fix items are two data-display gaps that the merge creates, plus stale doc and comment text.

## Checks run

- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm run check:migrations`: `Migrations OK: 1 to 28`. No migration in this diff, which is correct because this is a read-model change only.
- Full suite (`vitest --maxWorkers=2`): 400 files, 7666 passed, 1 todo, 0 failed.
- A reviewer probe (temporary test, deleted afterwards) confirmed S1 and S2 below with concrete output.

## Blocking

None.

## Should fix

### S1. A bodyweight `Most reps` record disappears once the exercise has one weighted session
`packages/domain/src/progress/records.ts:454`, with `packages/domain/src/progress/exercise.ts:224-227`.
`exerciseRecords` only runs `bodyweightRepRecords` when `series.kind === 'bodyweight'`. After the merge, any exercise with even one BW + row is `added_bodyweight`. For those, records come only from `recordsInWindow`, which skips bodyweight rows because they have no load, and from `inMergedSeries`.

- **Scenario (probe):** BW pull-ups of 10, 10, 10 and then 20 reps give `most_reps 20` on 4 Sep. Add one `BW + 10 kg × 5` session on 5 Sep and the records list becomes `[]`. Ben's real 20-rep record vanishes from exercise detail.
- **Cause:** nothing in decision 8 asked to drop records. The brief only said bodyweight rows have no e1RM. This is real data silently disappearing from view, although it is not invented data.
- **Fix:** on `added_bodyweight` series, also run the bodyweight rep records over the bodyweight rows. Either keep `most_reps` as is, or better, express it as `most_reps_at_load` at `BW` (+0) so it uses the same judging as the weighted rows. Add a test with exactly the probe's history. The developer raised this as open question 2. Ben should confirm the label, but the default should be to keep the record, not lose it.

### S2. Imported BW + rows with a blank weight drop off the merged series, while app-logged bodyweight rows plot as +0
`packages/domain/src/progress/exercise.ts:181` (`asAddedZero` is applied only when `rowKind(r) === 'bodyweight'`, line 238), with `packages/domain/src/import/plan.ts:1081` and `:1101`.
The FitNotes importer stores `added`-convention sets with `load: null` when the weight cell is blank. History reads those sets as `BW` (`loadText(null, 'added')`). But `loadedSet` rejects `load === null`, so they get no Top set point, no Total weight and no rep-table row.

- **Scenario (probe):** an imported dip session on 1 Aug, `added` with blank weight × 12 and × 10, then an app BW session and a BW + 10 session. Total weight gives `[null, 0, 80]` and Top set points are `['BW × 12', 'BW + 10 kg × 8']`. The 1 Aug session is missing from the chart, even though History shows it as `BW × 12`.
- **Why it matters:** decision 8 says bodyweight counts as +0. Two spellings of the same thing, bodyweight-convention BW and blank `added`, now chart differently inside one series.
- **Fix:** in the merged series, map `added` sets whose `load === null` to `+0` in the series unit as well. Generalise `asAddedZero` to any row in an `added_bodyweight` series and leave plate-loaded rows alone. App logging already writes `0` for blank (`session/active-view.ts:676`), so only imports and older data are affected. Add a test.

### S3. Stale comment and spec text
- `apps/mobile/src/services/plan-services.ts:475` still says "this day's own `Main` and the split's main lifts (review S1)". That is now false and misleads the next developer. Change it to "the split days' main lifts only (Ben, 20 Oct decision 5)".
- `docs/design/progress.md` still specifies `Volume` in about 12 places, including PG31 (line 71), the chart heading in region 7 and `Volume draws bars` in region 8. Only region 5 got an italic note. The spec is what reviewers and designers read, so update PG31 to define Total weight and replace the other `Volume` mentions. The CHANGELOG entry is fine.

## Nits

- N1. The `Total weight` info tap on a BW + series only appears when there is a conversion or an assumed dumbbell count. Ben may read `Total weight 0 kg` on a bodyweight-only session as broken. A short `Added weight only` line in the same info text (`exercise-view.ts:1033`) would be honest without adding copy to the main UI. This is optional.
- N2. `mainLiftIds(src: MainLiftSources)` in `targets-hit.ts` is now a one-field wrapper that the app no longer calls, because both services read `splitMainLiftIds` directly. Either drop it or have the services use it, so there aren't two definitions.
- N3. The changes were tested in the domain and through `plan-overview.test.ts`. No test covers the detail view's `info` string holding both `Converted from lb` and the assumed-count line together (the `join('\n')` path). It's cheap to add.

## Tests

The new `progress-bodyweight-merge.test.ts` covers these cases:
- one series
- stored sets untouched
- only-bodyweight series stays reps
- timed and assisted stay separate
- no e1RM
- 0 total weight
- kg/lb at +0 without conversion
- the Exercises tab
- the lift-target line

`lift-targets.test.ts` covers the plate-loaded, one-rep-max and wrong-kind exclusions. `plan-overview.test.ts` checks that `Main` on every workout no longer counts while a Profile main-lift pick does, and it runs through a force-close and relaunch.

Missing: the S1 record case, the S2 import null-load case and the N3 info join.

## Spec issues (for Ben)

- **SP1. Bodyweight-only sessions plot as 0 on Top set and Total weight inside a merged series.** This follows from "counts as +0", but in a mixed history the Top set line zig-zags to 0 on every BW day, and Total weight and the Exercises tab trailing average are pulled down. Ben should confirm he wants +0 points, or prefer leaving BW-only sessions out of the mass charts and showing them on Reps only. This is the developer's open question 1.
- **SP2. "The split day's main lift" is implemented as the union of every split day's main lift.** A Pull-day main lift that also appears on Push shows `Targets hit` on Push too. Per-day matching would need the plan day mapped to a split day. Ben should confirm whether the union is what he meant. It is the simpler reading and matches the previous behaviour for split mains.
- **SP3. Merge scope.** Only bodyweight with BW + is merged. Bodyweight versus a dumbbell or barbell total (goblet squat vs bodyweight squat) stays separate, and an old FitNotes BW + entry turns a long bodyweight history into a BW + series. Both look right to me, but they go beyond Ben's one-line wording. This is the developer's open question 3.
