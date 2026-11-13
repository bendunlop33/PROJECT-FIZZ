VERDICT: PASS

# Review r2: misc fixes, perf lane split and distance sets in Progress (claude/misc-fixes)

Reviewer: independent reviewer agent, 12 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/misc-fixes` (8 commits, 28 files), with a focus on the two fix commits
since r1 (`fa6291c`, `a06e355`). The r1 review is `docs/reviews/misc-fixes.md`.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=180000`: exit 0. 242 files, 4557 passed, 1 todo. No `*.perf.test.ts` ran.
  `definition-raster.test.ts` (guide D6) ran in this suite.
- `npm run test:perf`: exit 0. 7 files, 8 tests passed (serial, same budgets as before).
- A throwaway probe test, deleted afterwards, confirmed S1 below.

## r1 findings

| r1 | Status |
|---|---|
| B1 D6 raster check in the non-blocking perf lane | **Fixed.** It is now `packages/catalogue/test/definition-raster.test.ts` in the default suite, with the 180 s timeout kept as a hang guard. `perf-lane.test.ts` now has the inverse guard (every `*.perf.test.ts` must be timed) and pins the D6 file to the default suite. |
| S1 Best distance change line ignored load | **Fixed** for the Change line: `Same distance, 40 kg more than 1 Sep`, which reads down for less load, `each` for per-hand, and lb stays lb. It has tests. A related inconsistency remains in the `Best` panel line (new S1). |
| S2 test gaps | **Fixed.** The new tests cover the plate-loaded sled (points, StatStrip, table, history, 0 kg), the bodyweight-convention walking lunge, the cross-session headline tie-break, an empty-range table, weekly-best `total_distance` on `All`, and the inverse perf guard. |
| N1 0 kg inconsistent | **Fixed.** `distanceTableByLoad` now treats 0 as `No load` only for added load on equipment that isn't plate-loaded, which matches `distanceLoadText` and `compactSetText`. |
| N7 `TIMED` misses `Date.now()` | **Fixed.** It also adds `measureBlocking(`. |
| N2–N6 | Not addressed. All are still nits. N3 was deliberately kept: the lunge test asserts a single `No load` row. They are carried forward below. |
| SP1 unilateral `Total distance` | Still open for Ben. |

## Perf lane: verified

- `vitest.config.ts` excludes `**/*.perf.test.ts`. `vitest.perf.config.ts` includes only those files, under the same
  roots, runs them serially, and leaves the budgets unchanged (100% renames, and the two moved inline budgets are verbatim).
- The guards cover both directions: no timed file is outside the lane, and no untimed file is in it. This means a
  correctness check can't drift into the non-blocking lane again.
- CI: the `perf` job has the same `if:` as `check`, the same pinned actions, and `npm ci` with install scripts on. It
  has `continue-on-error: true` and nothing `needs:` it. `check` still runs `npm test`, and `build` still `needs: check`.

## Blocking

None.

## Should fix

### S1. The `Best` panel line and the StatStrip pick different sets at equal metres

`packages/domain/src/progress/exercise.ts:472-479` (`better`), used for the range best (`:537`) and for the weekly-best
points (`:523`).

`better()` breaks ties by keeping the earlier point, unless the later one has more reps. For `best_distance`, reps are
null, so at equal metres the earlier, lighter set wins. `sessionBestDistance` and `exerciseHeadline` break the same tie
by the heavier load. The probe showed this with 40 kg × 25 m on 1 Sep and 80 kg × 25 m on 1 Oct:

- StatStrip: `BEST DISTANCE 80 kg × 25 m`
- Panel: `Best 40 kg × 25 m · 1 Sep`, then `Change Same distance, 40 kg more than 1 Sep`

The same screen calls the lighter set "Best" right under a line saying Ben has since done 40 kg more. The weekly-best
chart on `All` has the same problem: a week with two equal-metre sessions plots the lighter one.

Fix: in `better()`, for a distance series, break an equal-value tie on `seriesLoadValue(fromSet)` (heavier wins), as
`sessionBestDistance` does. Add a test that the panel `Best` matches the StatStrip at equal metres, and that the weekly
point does too.

### S2. progress.md doesn't specify the new Change copy or the tie-break

`docs/design/progress.md` §6.3 / check 38a.

`Same distance, N kg more|less [each] than <date>` is new UI copy that isn't in the spec. "Longer, then heavier" is
specified for a session's best set, but not across sessions for the headline, panel or weekly point. Add both to
§6.3 and to check 38a so the next change doesn't undo them.

## Nits

- **N1. Load delta on a plate-loaded sled reads `kg`, not `kg plates`** (`exercise-view.ts:631`). The Change line says
  `40 kg more`, while every other value in the series says `kg plates`. This is minor, but it could use
  `seriesUnitText(series)`.
- **N2. Assisted convention isn't excluded from the load delta** (`exercise-view.ts:621-632`). If a distance series
  were ever logged with `assistance`, more assistance would read as `more` with direction `up`. This is unlikely for
  distance work. Guard it, or flip the direction as `top_set` does.
- **N3. Carried from r1 N2.** A set in another unit or convention can be the StatStrip/panel best (`90 lb × 25 m` in a
  kg series), but it is left out of the `BEST DISTANCE` table. The Change line then falls back to `Same as` because
  `seriesLoadValue` returns null.
- **N4. Carried from r1 N3.** An all-`No load` `BEST DISTANCE` table on an unloaded series. The test now asserts this
  behaviour, so it is a deliberate choice. That's fine, but say so in progress.md.
- **N5. Carried from r1 N4.** The axis reads `m` while values switch to `km` at 1,000 m or more.
- **N6. Carried from r1 N5.** The history unit for a sled reads `kg added × m`.
- **N7. Carried from r1 N6.** `repAll` is shared between `RepTable` and the distance table.

## Spec issues

- **SP1 (open, from r1).** For unilateral carries, `Total distance` counts only the busier side, so 40 m left plus
  40 m right reads `40 m`. Ben to decide: sum both sides, or rename the metric.
