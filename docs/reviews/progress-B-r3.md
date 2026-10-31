# Review r3: Progress slice B (Exercises list and exercise detail)

Branch `claude/progress` at `b468fae`. The fix commits since r2 are `0270fd5`, `b50e78d`, `a744559` and `b468fae`, on top of the r2 head `9f917bf`. The full diff is against `claude/gracious-knuth-joxqpw`.
Spec: `docs/design/progress.md` §2.7, §3.4, §4.2, §5.5, §8 checks 26–41. Previous reviews: `docs/reviews/progress-B.md`, `docs/reviews/progress-B-r2.md`.
Reviewer: independent. No source code was edited.

## Verdict: **PASS**

All of the r2 findings are fixed and tested: S1 (opening an old workout under weekly bests), S2 (opening choices leaking into the remembered range and series), S3 (timed label collisions), and N1–N3. Nothing is blocking.

One should-fix item is new, and it comes from the S1 fix. The chart highlights the week's point, but the panel describes the opened workout. The chart's VoiceOver value and its double-tap action follow the week's point, not the workout shown in the panel (S1 below). Fix it the next time this screen is touched. It doesn't need another review round.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npx vitest run --testTimeout=120000`, first run | 208 files: 207 passed, 1 failed. 4043 passed, 1 todo. The failure was `apps/mobile/test/app-services.test.ts:305` ("catches up a backup at launch…", `integrity.last()` undefined) at load average about 11 on a shared machine. That file passed 3 of 3 runs on its own. It isn't slice B code. See N3. |
| `npx vitest run --testTimeout=120000`, second run | **208 files passed. 4044 passed, 1 todo.** |
| Perf | `progress-perf.test.ts` (home on about 600 workouts, now with a load sample at the start and end plus one repeat) and `progress-exercise-perf.test.ts` passed in both full runs. The new `openedSelection` adds two linear `find`s over the points (150 or fewer) and the session points, which is negligible. |
| Hand-computed probes | A scratch vitest file outside the repo, importing `packages/domain/src`. Results below. |

### Hand-computed cases

- **r2 S1, kg barbell.** Mon 140×5 and Thu 100×5 every week from 2 Jan 2023 gives more than 150 sessions, so `All` shows weekly bests. Opening Thu 12 Jun 2025 widens the range to `all` and sets `selectedSessionId` to the Thursday. `selection.index` points at Mon 9 Jun (140×5 → 163.33 → `≈163.5 kg`). The panel shows the Thursday: `Est. 1RM ≈116.5 kg from 100 kg × 5` (100 × 1.1667 = 116.67 → 116.5). This matches the new test.
- **r2 S1, per-dumbbell lb.** Mon 60 lb each × 6 and Thu 50 lb each × 10 weekly, opening Thu 16 May 2024.
  - `Est. 1RM`: the week point is `≈72 lb each` (60 × 1.2). The panel shows `≈67 lb each from 50 lb each × 10` (66.67).
  - `Top set`: the week point is `60 lb each × 6`. The panel shows `50 lb each × 10`.
  - `Volume`: the Thursday is the week's best (500 > 360 lb each × reps), so its own point is selected at the same index. That's correct.
  - Every value says `each`, and every estimate carries `≈`.
- **Opened workout with every set marked (`pain`).** `range: 'all'`, `selectedSessionId: null`, `selection: null`. The panel falls back to the range summary. Correct: there's no value to show.
- **r2 S3 labels.** These pairs now read differently:
  - bodyweight timed and `total` timed: `FitNotes · timed` and `FitNotes · timed · weighted`;
  - kg and lb of each: `… · kg` and `… · lb`;
  - a set of four timed series (bodyweight, assisted, total and per-hand): `FitNotes · timed`, `FitNotes · kg assist`, `FitNotes · timed · weighted`, `FitNotes · kg each`.

  All of these are unique. See N1 for wording.
- **r2 S2, service.** I traced it in the code and the new service test covers it. An opening sends `openedSeriesId` / `openedRange` on later fetches. `exerciseDetail` uses them only when no explicit `seriesId` / `range` is sent, and never writes them into `detailChoice`. After an opening plus a refocus, opening the exercise from home starts on `6m`. A `3m` choice survives an opening.
- **Timezones (r2 N2).** The new test projects 23:30Z on Sunday 4 Oct through `toProgressSession`. In London that is Mon 5 Oct, in week 5 Oct. In Los Angeles it is Sun 4 Oct, in week 28 Sep. I checked independently that `openedSelection` buckets with `mondayOf` on the projected local date, for both the session and the point, so it stays consistent.
- These cases are unchanged since r2 and still covered by tests: missing end times (not shown on slice B), imported sessions, kg/lb series separation, assisted records, and flagged sets.

### Rules

- **Rule 1.** These screens make no network or AI calls.
- **Rule 6.** Every Est. 1RM value on the new selection path (`pointView` for the opened workout) carries `≈`, and its detail reads `Est. 1RM … from …`. Nothing is invented. A workout with no counted value gets no selection.
- **Rule 10.** Unchanged. The screens read only owner history, pain flags and gym names.
- **Minimal copy.** The only new strings are labels: `timed · weighted` and the `(n)` ordinal.
- **Accessibility.** See S1.

---

## Blocking

None.

---

## Should fix

### S1. Under weekly bests, the chart's VoiceOver value and double-tap open a different workout from the panel
`apps/mobile/src/progress/trend-chart.tsx:54-66` and `:82-98`, with `apps/mobile/src/screens/progress/ExerciseDetailScreen.tsx:132-134` and `:283-286`.

**Failure:** Ben opens Thu 12 Jun 2025 from its Summary. Bench has more than 150 sessions, so the chart shows weekly bests. `selIndex` is the week's index, so the chart's `sel` is `points[selIndex]`, which is Mon 9 Jun. With VoiceOver on, after switching from the table to the chart:
- `accessibilityValue` reads Monday's words ("… about 163.5 kilograms … Double-tap to open the workout.");
- the `activate` action calls `onOpen(points[selected].sessionId)`, which opens **Monday's** workout;
- meanwhile the panel says `Thu 12 Jun 2025 · Est. 1RM ≈116.5 kg from 100 kg × 5`, and `Open workout ›` opens Thursday.

So the screen says one workout and opens another.

Sighted use has the same mismatch in a milder form. The enlarged dot sits at about 163.5 while the panel shows 116.5, and nothing says the dot is the week's best. Tapping the highlighted dot hits the `wasSelected` branch and clears the selection instead of showing Monday.

**Fix:** pass the selection into `TrendChart`, for example as a `selectedPoint` override holding `words` and `sessionId` from `view.selection.point`. Use it for `accessibilityValue` and `activate`, so both describe and open the workout in the panel. Then add a short note to the panel when the selection is inside a week point, for example a `Tag` reading `Week best ≈163.5 kg`. The wording needs the designer (see SP1). Add a component or screen-level test that the chart's activate action opens the opened workout's `sessionId`.

---

## Nits

### N1. The ordinal fallback can read `FitNotes · kg · kg (1)`
`packages/domain/src/progress/exercise-view.ts:253-270`. The last-resort test builds two series with an identical key (`FitNotes · kg · kg (1)`, `(2)`). Real series ids come from the key, so this shouldn't be reachable, and the label is ugly only in that case. Related, and older than this round: an unweighted timed FitNotes import reads `FitNotes · kg` when its only neighbour is an assisted import, because the import base label ignores `bodyweight`. If the base label showed `timed` or `reps` for bodyweight, that would read better. This is cosmetic.

### N2. Changing series after an old-workout opening also drops the widened range
`apps/mobile/src/screens/progress/ExerciseDetailScreen.tsx:189`. `setHeld(null)` clears `held.range` together with the series. After opening a 2023 workout on `All`, picking another series jumps the range back to the remembered `6 mo`. The comment says this is intended ("until Ben picks his own series or range"), and the selection is cleared anyway. Worth a check on the device, because the range chip moves without a tap on it.

### N3. `app-services` backup catch-up test is load-sensitive (outside slice B)
`apps/mobile/test/app-services.test.ts:303-305`. The loop waits for the `-auto.json` file to land and for `isRunning` to be false, then asserts on `integrity.last()`. Under load (about 11 on 4 cores), the check hadn't been recorded yet. It passed 3 of 3 runs alone and passed in the second full run. If the integrity check is part of the catch-up, wait for it as well (for example on `backups.whenIdle()`), or poll `integrity.last()` in the same loop. Slice A's `prewarm()` after Finish (`app-services.ts:370`) adds work on that path, so keep an eye on it.

### N4. Carried, acceptable
r1 N3 (the assisted `Change` arrow direction), r1 N6 (choices are kept in memory only), r1 N7 (record history counts), and r1 N9 (navigation stacks; check on the device).

---

## Tests

New since r2:
- `progress-exercise-review.test.ts`:
  - r2 S1: two old Thursdays that aren't their week's best. The test checks the week index, the panel value, the title and the detail; that a week-best Monday selects its own point; that `selectSessionId` reselects; and that `selectSessionId` doesn't widen the range.
  - r2 S3: weighted vs unweighted timed, the four-way kg/lb set, and the ordinal.
  - r2 N2: a real London vs Los Angeles projection.
- `progress-exercise-service.test.ts`: covers r2 S2 from start to finish through the service.
- `progress-perf.test.ts`: covers r2 N1.

Missing:
- The chart's VoiceOver value and activate action for an opened workout inside a week point (S1). This needs a component or screen test, because the domain tests can't see it.
- An opened workout with every set marked under weekly bests (selection null). My probe confirms the behaviour, but no test pins it.

---

## Spec issues

### SP1. The design doesn't say what selection means under weekly bests
`docs/design/progress.md` §3.4 ("Long history" row) and §4.2 define weekly-best points and the selection panel, but not:
- what a selected week point stands for (the week's best workout, or the workout Ben opened);
- whether the panel should say that the highlighted dot is a week's best.

The build now highlights the week and shows the opened workout in the panel. That is reasonable, but it's the designer's call, and S1's panel note needs wording. Add it to the next designer pass, together with r2 SP1 (the build notes waiting for confirmation) and r1 SP2 (records for timed holds, and the reason for the assisted 8+ threshold). Both are still open.
