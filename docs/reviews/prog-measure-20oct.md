# Review: Progress › Exercises, Total weight and one series per exercise (claude/prog-measure-20oct)

Branch `claude/prog-measure-20oct` (ba82f07, 010acf5, f9dfdd6) against merge-base `1e48041` (`claude/gracious-knuth-joxqpw`).
Scope: Ben, 20 Oct: "Add total weight per session as exercise measurement. I don't need different types of gyms or equipment in exercise measurement either they should be consolidated."

## Verdict: CHANGES NEEDED

## Validation (run by the reviewer)
- `npm run typecheck`: clean.
- `npm run lint`: the full run was OOM-killed in this sandbox twice. `npx eslint` on all 18 changed files was clean.
- Targeted vitest (7 changed test files, `--maxWorkers=2`): 181 passed.
- Full suite (`--maxWorkers=2`): 369 files, 7,203 passed, 1 todo, 0 failed.
- I used throwaway probe tests (deleted afterwards) to confirm B1, B2, S1, S2 and S3.

## What's good
- Total weight is a pure domain function (`sessionTotalWeight`). It leaves out warm-ups, counts marked sets (PG21), counts only the added mass for BW +, and isn't offered for assisted or bodyweight-only exercises. The dumbbell count comes from the catalogue's `implements`. The split-squat and one-arm-row maths are right: 2 × 2 sides and 1 × 2 sides.
- Consolidation is complete in the pickers. `seriesLabels`, the gym/equipment/`History` labels and the ordinals are gone. The menu shows only when an exercise has more than one kind. Stored sets, `source` and units are untouched (`normaliseRow` copies), so no data is lost. `seriesIdOf`/`SeriesKey` still drive PG10 record judging.
- Conversion is honest. Each converted set carries `convertedFrom`, the point tooltip notes say `Converted from lb`, and the screen-level info is an ⓘ only.
- Each point keeps its own unit text in the readout, the rep table (by weight and by reps), the top-set cell and the Weight value (`30 kg each`, `40×12 stack`).
- Tests cover every case the spec asked for.

## Blocking

**B1. The TOTAL column is labelled per hand or stack when the series is per hand or stack.**
`apps/mobile/src/screens/progress/ExercisesTab.tsx:377,392` with `packages/domain/src/progress/exercise-tab.ts:427,480`. The table header is `SESSIONS · ${table.unit}`, and `table.unit = seriesUnitText(series)`, so it reads `kg each`, `kg stack` or `kg added`. TOTAL now sums both dumbbells in plain kg.
*Failure:* Ben does dumbbell bench at 20 kg each, 2 × 10. The header reads `SESSIONS · KG EACH` and the TOTAL cell reads `800` (probe confirmed). On screen that is "800 kg each", but it is 800 kg in total, so the number is off by a factor of two. The chart axis says `kg` and the VoiceOver words say `total weight 800 kg`, so the screen disagrees with itself. This breaks "kg/lb and load convention always explicit" and the spec's "Unit kg/lb in … table".
*Fix:* give TOTAL its own unit. Either put it in the column header (`TOTAL KG`) or append the plain unit to the cell (`800 kg`). Keep the section header for the top-set and Est. 1RM convention. Add a test asserting that a per-hand series' total reads plain kg on screen.

**B2. Exercise detail Records lists per-equipment "records" that aren't records of the consolidated exercise.**
`packages/domain/src/progress/records.ts:390-401` and `packages/domain/src/progress/exercise-view.ts:994`. `exerciseRecords` now keeps every PG10 record event whose row is in the merged series, but each event was still judged within its own equipment/unit series. With the gym and equipment labels removed, nothing tells them apart.
*Failure (probe):* Ben benches 100–102.5 kg at the main gym (4 sessions), then 60–62.5 kg on the hotel barbell (4 sessions). The single consolidated Bench press screen lists `Heaviest set 62.5 kg × 5 (22 Jul)` and `Best Est. 1RM ≈73 kg (22 Jul)` next to `Heaviest set 102.5 kg × 5` and `≈119.5 kg`. A 62.5 kg set is labelled "Heaviest set" on a chart that peaks at 102.5. That is false data (rule 6) and undoes the consolidation Ben asked for. Records logged in lb also appear in lb beside a kg chart, unconverted.
*Fix:* in the consolidated view, show only events that beat everything earlier in the merged series, in Ben's unit, compared within the same convention (e.g. keep the per-record-series judging, then filter to those that are also a best across the merged series of that convention). Alternatively, show just the current best per record kind. Leave the Summary's PG10 judging alone. Add a test with two gyms and with kg + lb.

## Should fix

**S1. The detail screen's Volume chart now adds per-hand, stack and total numbers together.**
`packages/domain/src/progress/exercise.ts:360` (`sessionVolume`) now uses the widened `loadedSet` (any convention of kind `load`). Before, a series had one convention, so Volume never mixed them.
*Failure (probe):* one session with barbell 100×5 and dumbbells 30 kg each ×10 gives Volume 800. That adds 500 kg of barbell to 300 "kg each" (which is really 600 kg for two dumbbells). It also disagrees with the tab's Total weight for the same session (1,100). The spec says "don't invent conversions between stack/plates/total" and "charts/table consistent".
*Fix:* the simplest is to replace the detail `volume` metric with Total weight (the developer's Question 1; needs Ben's yes). Otherwise, restrict `sessionVolume` to `series.key.convention` as before. Add a mixed-convention test either way.

**S2. The library exercise card mixes units.**
`packages/domain/src/exercise-browse.ts:317`: `seriesOf` calls `collectExerciseSeries(mine, exerciseId)` with no `unit`, so it falls back to the latest row's unit. The card's stats come from `progressDetail`, which uses `profile.preferredUnit`.
*Failure (probe):* Ben's unit is kg and his latest bench was logged in lb. `Last` reads `225 lb × 5` (earlier kg sessions converted to lb) while `Est. 1RM` on the same card reads in kg. The series ids still match (`<id>|<kind>`), so this is only a unit mismatch, with no crash.
*Fix:* pass `profile.preferredUnit` through `ExerciseInfoInput` to `seriesOf`. Better, make `unit` a required parameter of `collectExerciseSeries`, so no caller can forget it.

**S3. `Converted from lb` shows when no visible value was converted.**
`packages/domain/src/progress/exercise.ts:170,233`: `series.convertedFrom` covers the whole history, not the period on screen.
*Failure (probe):* one lb session from 2025 and a 6-month period of kg sessions. The ⓘ still appears with `Converted from lb`, but none of the plotted values were converted. The spec says to say nothing unless a value was converted.
*Fix:* compute `converted` in `buildExerciseTabView` and `buildExerciseDetailView` from the in-window sessions' sets (`convertedFrom`), not from the series.

**S4. Total weight guesses the dumbbell count for exercises the catalogue leaves blank, without saying so.**
`packages/domain/src/progress/exercise.ts:390-391`. When `implements` is missing, the code assumes 1 per side on a unilateral lift and 2 on a bilateral one. The catalogue leaves `implements` out on purpose for lifts "commonly done either way" (`packages/schemas/src/exercise.ts:55-60`): dumbbell reverse lunge, step-up, single-leg RDL and triceps kickback are all per-hand and unilateral with no `implements`.
*Failure:* Ben does reverse lunges holding two 20 kg dumbbells, 10 each side. Total weight counts one dumbbell and reads half the true value. The catalogue says this can't be known, so the number is a guess shown as fact.
*Fix:* when the count is unknown, either hide Total weight or mark the value as an estimate (`≈`, with the reason behind the Why/ⓘ tap). Or ask Ben once and store the count on the exercise. Add a test.

## Nits
- N1. `ExercisesTab.tsx` (~line 375): the `InfoLine` sits inside a `flexDirection: 'row'` beside the section header, so when expanded, `Converted from lb` is squeezed into the row instead of wrapping below. Put the InfoLine below the header, or align it as in the detail screen.
- N2. A mixed-convention `load` series gives Total weight a stack reading plus barbell plates in one plain-`kg` number. Stack values are "not a free-weight equivalent" (schemas `common.ts:58`). This is allowed by the spec ("plot as recorded"), but worth an ⓘ or a spec decision (see Spec issues).
- N3. `exercise-view.ts:426-427`: the `DisplayUnit` type is exported but unused.
- N4. `exerciseRecords` doc comment: "the merged series lists every one of its rows'" (truncated wording).
- N5. Detail screen series menu: `menuLabel` is `Weighted · 24`. That's fine, but `accessibilityLabel` still says `Series, …` while the tab says `Type, …`. Pick one word.

## Spec issues
- **SP1. Ben's message is cut off.** The relayed request ends with "…they should be consolidated. Also". A third request may be missing. Ask Ben before closing this feature.
- **SP2. The kind split goes beyond "one series per exercise".** Ben said he doesn't want "different types of … equipment" split. An exercise done on an assisted machine and with added weight (pull-up), or bodyweight and BW + (dips), still shows a `Weighted / Assisted` or `Bodyweight / Bodyweight + weight` menu. These kinds can't share an axis, so the split is defensible, but it is an equipment-type split. Ben should confirm (developer Question 2).
- **SP3. Plotting mixed conventions "as recorded"** puts `30 kg each` beside `100 kg` on one Weight / Top set / Est. 1RM line and a plain-`kg` axis. The spec chose this, but the line's shape then means nothing (a drop from 100 to 30 is a change of implement, not a regression). Consider a marker on convention changes, or letting Ben pick a convention, as a follow-up proposal.
- **SP4. Volume vs Total weight** (developer Questions 1 and 3): two "how much" numbers with different rules (PG31 busier side vs both sides). Ben should pick one; S1 assumes Total weight.
- **SP5.** The CHANGELOG quote fixes Ben's typos ("wxercise", "excersie"). That's harmless, but it is not verbatim.

## Tests
New tests cover barbell, a dumbbell pair, goblet (1), a one-arm row, `both`-side sets, BW +, warm-ups, marked sets, assisted and bodyweight hidden, two gyms + import merged, lb↔kg, and per-point unit text. Missing:
- the TOTAL column unit on screen for per-hand series (B1)
- records in a merged series across gyms or units (B2)
- Volume with mixed conventions (S1)
- library `Last` vs stats units (S2)
- the converted flag outside the period (S3)
- the fallback count for an exercise with no `implements` (S4)
