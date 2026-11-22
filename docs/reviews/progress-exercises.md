# Review: Progress restructure — Activity · Exercises · Calendar (D2, D3)

Branch `claude/progress-exercises` vs `claude/gracious-knuth-joxqpw` (commits 02f5e6a..d4f585e).
Spec: `docs/brief/ideas-2026-10-12.md` ("Ben's D1–D8 answers" D2, D3; "Progress › Exercises"), `docs/design/progress.md` (PG11, PG15, PG21, PG24a, PG26), CLAUDE.md rules 1–10.

**Verdict: CHANGES NEEDED**

## Checks run

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npx vitest run --maxWorkers=2`: 312 files, 6426 passed, 1 todo
- A throwaway probe (scratchpad, not committed) run against `buildExerciseTabView` / `workingWeight` confirmed B1, S1 and S2 below.

## What's good

- The tabs are now Activity · Exercises · Calendar. Each segment stays mounted once you've opened it, so it keeps its place.
- The domain view model is pure and reuses `collectExerciseSeries`, `sessionE1rm`, `sessionTopSet` and `sessionVolume`. PG15 series are never merged, so kg and lb, gyms, conventions and imports each stay in their own series. PG21 countable sets are respected.
- Estimates carry `≈` and `Est.` in the readout, stat line, table header and VoiceOver words (rule 6).
- The trailing average looks back across sessions before the period. `Other` is validated to 2–50, and the overlay shares the line's Y scale (tested).
- The X labels are thinned by measured width, and the 1-year collision is covered by a test.
- The Period control is shared (`PeriodPicker` with `leading`), and only one dropdown can be open at a time.
- D2: the parent rows open in place. Sub-rows are muscles for body parts and exercises for Push/Pull/Legs. There's no 10–20 band.
- Everything is local only, with no AI and no writes, so rules 1, 5 and 7 are not at risk here.

## Blocking

### B1. Exercises done for more than 10 reps open to a blank chart with no explanation
`packages/domain/src/progress/exercise-tab.ts:305` (measure default), `:386` (`empty` only when there are no sessions at all); `apps/mobile/src/screens/progress/ExercisesTab.tsx:155-167`.

**Scenario:** Ben opens lateral raises or leg extensions, which he always does for 12–15 reps. `E1RM_MAX_REPS` is 10, so every session is ineligible for Est. 1RM. The default measure is still `e1rm`, so `chart.points` is empty while `view.empty` is null. The screen shows a 260 pt chart with no line, an axis unit, and Y ticks fitted to an empty range. The stat line reads `Est. 1RM —`. The probe confirmed this: `measure e1rm points 0 empty null`. This is a common case: most isolation work is above 10 reps. It breaks the spec's empty-state requirement and gives a misleading picture (it looks like nothing was done).

**Fix:** choose the default measure as the first one in `measuresFor(kind)` that has at least one point in the series, so Est. 1RM falls back to Weight or Top set. And when the chosen measure has no points but the period has sessions, return an `empty` line naming the measure (e.g. `No Est. 1RM in this period`, with the ≤10-reps reason behind `Why?`). Add a test for both.

## Should fix

### S1. The Sessions table drops the load convention (per-hand, assisted, stack)
`exercise-tab.ts:342` (`table.unit = series.key.unit`), `:345` (`${formatNumber(load)}×${reps}`); `ExercisesTab.tsx:347`.

**Scenario:** on an assisted pull-up machine the table header reads `SESSIONS · KG`, the row reads `30×8`, and VoiceOver says "top set 30 by 8". The stat line and the readout correctly say `Assist 30 kg × 8`. For dumbbells, `12×12` with volume `144` reads as total load when it is per hand (`12 kg each`). CLAUDE.md requires the load convention to always be explicit, so this violates it and gives a misleading number on assisted machines.

**Fix:** set `table.unit` to `seriesUnitText(series)`, e.g. `kg each`, `kg stack` or `kg assist`, matching the chart's `measureUnit`. For assisted series, either prefix the cell or use the `loadText` form in `words`. Add per-hand and assisted table tests.

### S2. Working weight counts each side of a unilateral pair as a separate set
`exercise-tab.ts:111-122` (counts every `workingLoaded` set), compared with `workingSetCount` (`:136`), which counts a left and right pair once.

**Scenario:** in one session, 2× (L+R) at 16 kg each and 3 bilateral sets at 18 kg each. Working weight is 16 kg with "4 sets" (probe: `{"value":16,"sets":4}`), but the session really had 2 sets at 16 and 3 at 18. The Weight line understates the session, and its set count disagrees with the table's Sets column.

**Fix:** tally per row with `countRowSets` semantics: for unilateral rows count `both`/null sets plus the busier side, as `sessionVolume` does. Add a test.

### S3. Records and the old list still open the old exercise detail, not the Exercises tab
`ProgressScreen.tsx:205-211` (`onRecord` → `ProgressExercise`), `AppNavigator.tsx:141-142`.

**Scenario:** the brief says the per-exercise list and detail move into Exercises. Tapping a record still pushes the old detail screen, which has a different chart, metrics and period range (`3m/6m/1y/all`). Ben now has two different exercise views that can disagree. `ProgressExercises` (the list) is now unreachable dead code.

**Fix:** route a record tap to the Exercises tab with that exercise, series and point selected. Then remove the old list route, or ask Ben whether the old detail stays (see Spec issues).

### S4. Tapping a table row whose session has no value for the measure does nothing visible
`ExercisesTab.tsx:182-188`, `exercise-line-chart.tsx:31-44`.

**Scenario:** with Est. 1RM selected, Ben taps a 12-rep session row. The row highlights, but `points.findIndex` returns −1, so the chart shows no selection and no readout. In general, tapping a row also gives no feedback when the chart is scrolled off screen.

**Fix:** if the session has no point, show the readout as `8 Oct · Est. 1RM —`. Consider scrolling the chart into view when a row is selected.

### S5. Unreadable workouts aren't flagged on the Exercises tab
`progress-service.ts` (`exerciseTab` returns `unreadable`); `ExercisesTab.tsx` never renders it.

**Scenario:** a workout that can't be read is missing from an exercise's chart and table, and the warning only appears on the Activity tab. Rule 1 and 6 honesty requires saying so where the data is shown.

**Fix:** render the same one-line `StatusLine` when `tab.unreadable > 0`.

### S6. Test gaps
There are no tests for B1 (all sessions over 10 reps), S1 (table units for per-hand and assisted), S2 (unilateral working weight), or a row selection with no matching point. There is also no render or snapshot coverage for `ExercisesTab`, `XLabels` measurement, or `FrequencySubRows`.

## Nits

- **N1.** `exercise-line-chart.tsx:86-87`: Y-tick `key={t.label}` can repeat if two ticks format to the same label. Use the index or the value as the key.
- **N2.** Two sessions on the same date share an x position. `nearestPointIndex` always returns the first, so the second can only be selected from the table.
- **N3.** `ExercisesTab.tsx:44`: when `data.value === null` (no profile) the tab renders nothing at all. It should show the same empty line as `view === null`.
- **N4.** `muscles.ts` sub-rows: one exercise that credits two muscles in the same group (lats 1, traps ½) makes the sub-rows add up to more than the parent (Back 3 → Lats 3 + Traps 1.5). This follows the stated rule, but it can surprise. Consider an info tap, or accept it.
- **N5.** `ProgressScreen.tsx`: muscle rows no longer open the Muscles screen. It's now reachable only through the "no muscles set" line, so the per-week view and contributors are effectively gone from navigation. Confirm with Ben (see Spec issues).
- **N6.** `ExercisePicker` runs `progress.exercises({query})` on every render cycle even while the list is closed. Load it only when the list is open.
- **N7.** `chart-layout.ts` `guessLabelWidth` is 9 pt per character. That is generous at 1×, but at a 1.4× AX cap the first frame could still overlap before measurement. Scale the guess by `min(fontScale, 1.4)`.

## Spec issues

1. **"Never overlap, always show first and last" can't both hold at extreme widths.** `thinLabelsByWidth` keeps only the last label when the first and last would touch. That's a reasonable call, but Ben should confirm it, or the brief could say "first and last when they fit".
2. **"Weight = load with most sets, ties to the harder when ≥2 sets" is ambiguous** for pyramids where every load has 1 set. The code then picks the heaviest load, which makes Weight equal Top set. Ben should say what Weight shows when no load has 2 or more sets (heaviest? last? none?).
3. **"Imported FitNotes sessions included"** conflicts with PG15 (imports are their own series unless PG32 merges them). The code keeps imports as a separate series, offered through the series dropdown, and makes it the default when it has the most sessions in the period. So Sessions, the line and the trailing average never span app and import history together. Ben should confirm whether "included" means merged, which would mean turning PG32 on.
4. **The fate of the old exercise detail and Muscles screens isn't stated** (S3, N5). The brief should say whether they're retired or kept.
5. **Out of scope here:** Ben's D8 profile (gender, birth year, height, weight, lifting experience, used in the coach context) and the other D-items are not in this branch. They still need their own slice.
