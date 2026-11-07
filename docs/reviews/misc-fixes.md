VERDICT: CHANGES NEEDED

# Review: misc fixes, perf lane split and distance sets in Progress (claude/misc-fixes)

Reviewer: independent reviewer agent, 12 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/misc-fixes` (5 commits, 27 files). Covers the perf lane split (`vitest.config.ts`,
`vitest.perf.config.ts`, `package.json`, `.github/workflows/ios-ipa.yml`, `scripts/test/perf-lane.test.ts`, the moved
tests) and distance sets in Progress (`packages/domain/src/progress/exercise.ts`, `exercise-view.ts`, `projection.ts`,
`ExerciseDetailScreen.tsx`, `trend-chart.tsx`, `docs/design/progress.md` §6.3 and check 38a). Checked against CLAUDE.md
rules 1, 4 and 6, the kg/lb and load-convention rules, and the minimal-copy convention.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=180000`: exit 0. 241 files, 4545 passed, 1 todo. No `*.perf.test.ts` ran.
- `npm run test:perf`: exit 0. 8 files, 9 tests passed (serial, budgets as before).

## What is right

- **Default suite has no wall-clock budgets.** `vitest.config.ts` excludes `**/*.perf.test.ts`. Every test that reads
  `performance.now()`, `timingBudget(` or `process.hrtime` is now a `*.perf.test.ts`, and `perf-lane.test.ts` enforces
  that. The two inline budgets (stepper memo, FitNotes 10,000-row parse) moved verbatim with the same numbers
  (`timingBudget(500)`, `< 1500`). The five renamed files are 100% renames, so their budgets are unchanged.
- **Perf lane.** `vitest.perf.config.ts` includes only `*.perf.test.ts` under the same roots and runs files serially.
  `test:perf:jitless` points at the new names, and no stale `*-perf.test.ts` reference is left in the repo.
- **CI.** The `perf` job uses the same `if:` as `check`, the same pinned actions and `npm ci` with install scripts on.
  It has `continue-on-error: true` and nothing `needs:` it, so it can't block `check` or `build`. `app-identity.test.ts`
  now expects three `npm ci` jobs.
- **Distance series.** `seriesKind` returns `distance` for every convention before any convention branch, and
  `seriesIdOf` stops a distance series sharing an id with a reps series. `metricsFor('distance')` offers only
  `Total distance` and `Best distance`. `sessionE1rm`, `sessionTopSet`, volume, the rep table and records all return
  nothing for the kind, so no Est. 1RM or `≈` can appear (the test asserts this on the whole view JSON). Home records
  leave sleds out. Per-hand reads `each`, lb stays lb, and a sled never reads `BW +`.

## Blocking

### B1. A correctness acceptance check (guide D6) was moved into the non-blocking perf lane

`packages/catalogue/test/definition.perf.test.ts:30` (removed from `definition.test.ts`).

D6 ("one paint per pixel", exercise-guides-v2 §4.11.11) is a pixel-equality correctness check. It has no wall-clock
budget, only a generous 180 s per-test timeout. Moving it to `*.perf.test.ts` takes it out of `npm test`, out of
`npm run check` and out of the blocking CI `check` job. It now runs only in the `continue-on-error` perf job, and only
on PRs, tags and `[ios-build]` pushes.

Failure scenario: a change to `figure/draw.ts` or the faint-paint tokens brings back the darker sliver where faint
shapes overlap. `npm run check` passes, CI goes green (the perf job's red mark doesn't fail the run), and the unsigned
`.ipa` ships the regression. Nothing in `perf-lane.test.ts` catches this. It only checks that timed files are perf
files, not that perf files are timed.

Fix: put the D6 rasterisation test back in the blocking default suite. For example, keep it in its own
`definition-raster.test.ts` with its `{ timeout: 180_000 }`, which is a hang guard, not a budget. Then add the inverse
guard to `perf-lane.test.ts`: every `*.perf.test.ts` must match `TIMED`. Any slow correctness test that would have
moved then fails that guard. If the goal is to keep slow raster work out of the fast local loop, use a separate
*blocking* slow lane that `npm run check` and the CI `check` job run, not the perf lane.

## Should fix

### S1. `Best distance` change line ignores load: a heavier sled at the same distance reads "Same as"

`packages/domain/src/progress/exercise-view.ts:613-622` (`changeLine` / `same()`).

The `same()` branch only handles `top_set` with a rep difference. With `best_distance`, 25 m with 40 kg on 1 Sep and
25 m with 80 kg on 1 Oct give `Change  Same as 1 Sep` with direction `same`. On a sled push, the usual progression is
more load over a fixed distance. In this case the summary says no progress when the load doubled. The same tie-break
(longer, then heavier) is already used to pick the point, so the data is there.

Fix: in `same()`, for `best_distance` compare `fromSet` loads in the series convention and unit (`seriesLoadValue`).
Return e.g. `Same distance, 40 kg more than 1 Sep` / `… less …` with direction up/down and matching VoiceOver words.
Add a test.

### S2. Test gaps on the distance paths

`packages/domain/test/progress-distance.test.ts`, `scripts/test/perf-lane.test.ts`.

These are not covered:
- **Plate-loaded sled** (`equipmentKind: 'plate_loaded_machine'`). Every fixture uses `equipmentKind: null`, so the
  `loadText` branch of `distanceLoadText` (`40 kg plates × 25 m`), the plate-loaded branch in `compactSetText`, and the
  0 kg case (see N1) are never exercised.
- **Bodyweight-convention distance series** (walking lunge for distance). Nothing tests history unit `m`, StatStrip
  `BEST DISTANCE 50 m`, or a `BEST DISTANCE` table that is all `No load`.
- **Headline tie-break across sessions**: equal metres, heavier later session. **Empty-range table**: the screen's
  `None in this range.` branch. **Weekly-best aggregation** with `total_distance` on `All`.
- **The S1 change-line case.**
- **The B1 inverse guard**: every perf file is timed.

## Nits

- **N1. 0 kg on a plate-loaded sled reads differently in three places.** `exercise.ts:664` maps `v === 0` to `null`
  (`No load`) for every convention. For a plate-loaded series, `distanceSetText` gives `0 kg plates × 20 m` (StatStrip,
  points) and `compactSetText` (`exercise-view.ts:251`) gives `0×20 m`. Pick one rule (probably the `distanceLoadText`
  one) and use it in `distanceTableByLoad` too.
- **N2. Best distance and the `BEST DISTANCE` table disagree on sets in another unit or convention.**
  `sessionBestDistance` and `exerciseHeadline` accept any set, and show its own unit (`90 lb × 100 m` in a kg series).
  `distanceTableByLoad` drops it (`exercise.ts:662`). The StatStrip's best can then be missing from the table. Either
  is defensible, but they should match.
- **N3. Table for an unloaded series.** For a bodyweight-convention distance series, `BEST DISTANCE` is one `No load`
  row under a `Weight` header. Hide the table when every row is `No load`, since the chart's `Best distance` already
  says it.
- **N4. Axis vs values at 1 km+.** `axisUnit` is `m` for both distance metrics, while point and panel values switch to
  `km` from 1,000 m (`1.2 km`), so an axis reading `1,200` sits next to a value reading `1.2 km`. Make them agree.
- **N5. History unit for a sled reads `kg added × m`** (test asserts it). It's accurate to the convention, but `added`
  for a sled is odd next to a StatStrip that says `60 kg`. Consider `kg × m` for distance series, consistent with
  "a sled's load never reads `BW +`".
- **N6. `repAll` is shared** between `RepTable` and the distance table (`ExerciseDetailScreen.tsx:401,423`). This is
  harmless while they can't both show, but a separate state (or a reset on series change) is clearer.
- **N7. `TIMED` regex** (`perf-lane.test.ts:25`) misses `Date.now()`-based budgets. None exist today, but adding
  `Date\.now\(\)\s*-` makes the guard harder to get around.

## Spec issues

- **SP1. `Total distance` for unilateral carries counts only the busier side** (progress.md §6.3, distance row). A
  suitcase carry of 40 m left plus 40 m right shows `Total distance 40 m`, but Ben walked 80 m. Volume's busier-side
  rule makes sense for comparing per-side load. For a total of metres covered it undercounts the work done, and a
  `Total` label suggests a sum. Ben to decide: sum both sides, or keep busier-side and rename it so it doesn't read as a
  sum.
