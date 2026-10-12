# Review r2: Progress slice B (Exercises list and exercise detail)

Branch `claude/progress` at `9f917bf` (fix commits `5037ec3`, `412c4a9`, `9f917bf` on top of the r1 head `13b6778`; full diff vs `claude/gracious-knuth-joxqpw`).
Spec: `docs/design/progress.md` §2.6, §2.7, §3.4, §4.2, §5.5, §6.2–6.3, §8 checks 26–41. Previous review: `docs/reviews/progress-B.md`.
Reviewer: independent; no source edited.

## Verdict: **PASS**

The r1 blocker (B1) is fixed and tested. S1–S6 are addressed, as are N1, N2, N4, N5 and N8. Nothing new is blocking. Three should-fix items remain, all edge cases of the r1 fixes: S1 (opening an old workout under weekly bests doesn't select its point), S2 (the widened opening range sticks as the remembered range), and S3 (two timed FitNotes series can still share a label). Fix them in the next touch of this screen. They don't need another review round.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npx vitest run --testTimeout=120000` (full) | 208 files, 4036 passed, 1 todo, **1 failed**: `apps/mobile/test/progress-perf.test.ts` (slice A home timing, 512 ms vs a 400 ms load-scaled budget) at load average about 16 on 4 cores, with other agents' suites running |
| `progress-perf.test.ts` + `progress-exercise-perf.test.ts` alone | the exercise-detail perf test passed. The home perf test failed once at 277 ms vs 267 ms (load 13), then passed 3 of 3 runs as load fell. See N1. |
| Second full run | 208 files, 4034 passed, 3 failed: the same home timing test (935 ms vs 400) plus two `backup-perf` timings (not in this slice). The backup-perf timings pass alone. The home timing test failed 3 more times alone at load 13–18 (378–457 ms vs 357–400 ms budgets) and passed 4 times. Every failure is a wall-clock budget on an overloaded shared machine, and every functional test passes. |
| A/B of the only slice B change on the home path (`recordLimit` 5 → all) | 624 sessions, 4 windows, 15 interleaved runs: median 259 ms (limit 5) vs 276 ms (all) under load, about 4 ms per build. Not the cause of the timing failures. |
| Hand-computed probes (scratch vitest file outside the repo, importing `packages/domain/src`) | see below |

### Hand-computed cases

All of these matched the code except where marked.

- **B1, weekly bests.** Mon 140×5 and Thu 100×5 every week from 2 Jan 2023 gives more than 150 points on `All`. Panel: `Latest ≈116.5 kg · 8 Oct` (100×5 → 116.67 → 116.5), `Best ≈163.5 kg` (140×5 → 163.33 → 163.5), `Change Down ≈47 kg since 2 Jan 2023`. VoiceOver says "latest about 116.5 kilograms on 8 October". When the first session in range has every set marked, `first` moves to the next counted session (4 Jan 2024 in my probe), and `Change` reads `Same as 4 Jan 2024`.
- **Assisted records (S1).** The sessions were 30×8, 30×8, 27.5×8, 27.5×10, 25×7 and 22.5×8 kg of assistance. Only 22.5 kg on 12 Sep is a record: 27.5 on 5 Sep has only 2 prior sessions, 27.5×10 ties, and 25×7 is under 8 reps. Output: `Least assistance for 8+ reps  22.5 kg · 12 Sep`. A FitNotes 20 kg × 8 assisted import suppresses it (lower is better). Test-covered as well.
- **Per-dumbbell lb.** 50/55/60 lb each × 10/8/6, two sets each. Est. 1RM `≈67 / ≈70 / ≈72 lb each`. Top set `60 lb each × 6`. Volume `1,000 / 880 / 720 lb each × reps` (per hand, as r1). No records with 3 sessions.
- **Timezones.** `localDateOf(2026-10-04T23:30Z, Europe/London)` = 5 Oct (Monday), `mondayOf('2026-10-04')` = 28 Sep. `localDateOf(2026-10-05T05:30Z, America/Los_Angeles)` = 4 Oct. The projection (`toProgressSession`) uses the owner zone, or `localDate` for imports, as in r1.
- **Opening an old workout (S2).** A workout from Jun–Aug 2025 (before `1 yr` on 8 Oct 2026) opens on `All`. That is correct, but see S1 below.
- **Labels (S3).** Total, stack, bodyweight and timed imports of one unit read differently. Two bodyweight imports in kg and lb plus a kg total import read `FitNotes · reps`, `FitNotes · lb`, `FitNotes · kg`. **Not unique:** a timed `total` kg and a timed `bodyweight` import both read `FitNotes · timed · kg` (S3 below).
- **Missing end times, imported sessions, kg/lb mixing, flagged sets.** Unchanged since r1 and still covered by tests. Slice B shows no durations, so missing end times don't affect it.

### Rules

- **Rule 1.** Still no network or AI on these screens.
- **Rule 6.** `≈`, `Est.` and "an estimate" are on every Est. 1RM value, including the new `Change` and VoiceOver paths. The assisted record is an actual value and isn't labelled as an estimate. Correct.
- **Rule 10.** The detail still reads only owner history, pain flags and gym names.
- **Minimal copy.** The new strings (`All records (n)`, `Least assistance for 8+ reps`, `No counted sets in this range.`) are values and actions, not explanations.
- **Accessibility.** `All records (n)` is a 44 pt button with a label and a hint. The chart summary now mentions edited and not-counted sessions (r1 N4).

---

## Blocking

None.

---

## Should fix

### S1. Opening an old workout under weekly bests doesn't select its point
`packages/domain/src/progress/exercise-view.ts:788`, together with `openingRange` at `:418`.

**Failure:** Ben has more than 150 bench sessions (normal after a FitNotes import). He opens a 2025 workout's Summary and taps `Bench press`. `openingRange` correctly widens to `All`, but `All` then draws weekly bests. Unless that workout was its week's best, no point has its `sessionId`, so `selectedSessionId` is null. My probe got `range: 'all'`, `selected: false`, for both a 2023 and a 2025 workout. The `this workout's point selected` promise from r1 S2 is still unmet for exactly the long-history case that triggers the widening. The S2 tests use short histories, so they don't catch this.

**Fix:** when the aggregation is `weekly_best` and the opening session isn't a point, select the week point that contains it. Show that workout's own value in the panel (it's in `trend.sessionPoints`), with `Open workout ›` pointing at the opened workout. Alternatively, while a workout is being opened, plot session points for the narrowest range that holds it. Add a test with more than 150 sessions where the opened workout isn't its week's best.

### S2. The widened opening range becomes the remembered range
`apps/mobile/src/screens/progress/ExerciseDetailScreen.tsx:79` (`if (opening.sessionId) setRange(view.range)`), and `apps/mobile/src/services/progress-service.ts:224-237`.

**Failure:** after the first load, the screen copies `view.range` (for example `all`) into state. The next fetch sends it as an explicit `range`. That includes the automatic refetch from `useFocusEffect` when Ben comes back from `Open workout ›`, and any chip tap. `exerciseDetail` then stores it in `detailChoice`. For the rest of the app run, opening bench from Progress home or the Exercises list starts on `All` (often weekly bests) instead of `6 mo` or Ben's own last choice. The service doc says opening on a workout picks the series "without overwriting the remembered one". The series already had the same leak in r1, and this change extends it to the range.

**Fix:** keep the opening range in screen state without sending it as a choice. For example, send `openingRange` as a separate, non-remembered request field until Ben changes the range himself. Or have the service skip remembering `range` and `seriesId` when they equal what an opening derived. Add a service test: open on an old workout, refocus, then open the same exercise from home, and expect the remembered range (default `6 mo`).

### S3. Two timed FitNotes series can still share a label
`packages/domain/src/progress/exercise-view.ts:242-254`.

**Failure:** a FitNotes plank exists both unweighted (`bodyweight`, timed) and weighted (`total` kg, timed). Step 1 gives both `FitNotes · timed`, and step 2 appends the unit, which is the same, so both read `FitNotes · timed · kg` (probe). The series menu shows two identical entries apart from the session count.

**Fix:** for timed series, use the convention as well (`FitNotes · timed`, `FitNotes · timed · kg added` or `· weighted`). Or make step 2 append the full `seriesUnitText` plus the convention, and add a last-resort ordinal. Extend the S3 test with this pair.

---

## Nits

### N1. The home perf test is load-sensitive
`apps/mobile/test/progress-perf.test.ts:92` (slice A). It failed in the full run (512 ms vs a 400 ms budget) and once alone (277 ms vs 267 ms), then passed 4 of 7 isolated runs; the failures track the load average. `timingBudget` uses the one-minute load average sampled at assertion time, which lags bursts from parallel suites. The only slice B change on this path is `recordLimit` → `Infinity` in `home.ts:337`, which is a slice and map over at most a window's records. That's negligible and not the cause. Consider sampling the load at the start and end and using the larger value, or retrying the timing once before failing.

### N2. The weekly-best timezone test doesn't test a timezone
`packages/domain/test/progress-exercise-review.test.ts:125`. The "late" session is 22:30Z on Sunday 4 Oct, which is Sunday in both UTC and London, and the fixture sets `date` directly. The test can't tell local-date bucketing from UTC-date bucketing. Use 23:30Z Sunday (00:30 BST Monday) through `toProgressSession`, or a zone west of UTC, and assert the week it lands in. Behaviour is correct (probe), so this only pins it.

### N3. `All records (n)` stays expanded across windows
`apps/mobile/src/screens/progress/ProgressScreen.tsx:294`. `recordsAll` isn't reset when Ben changes the window, so after `All records (5)`, switching from `30 days` to `7 days` keeps the list expanded. Reset it on a window change, or key the component by window.

### N4. Carried from r1, not addressed (acceptable)
r1 N3 (assisted `Change` arrow direction: "7.5 kg less assistance" still shows a down arrow, with correct words), N6 (choices in memory only), N7 (record history counts differ) and N9 (navigation stacks repeat; check on device).

---

## Tests

The new `packages/domain/test/progress-exercise-review.test.ts` covers B1 (more than 150 sessions, latest that isn't the week's best), S1 (assisted records, the 8+ threshold, marked sets, ties, import suppression, kg vs lb, timed hides the section), S2 (widening to `1 yr` and `All`, keeping a range that already holds the workout, an imported workout), S3, S4/N2 (equipment, then gym, then default; the tapped Summary row wins), S5 (3 rows then `All records (5)`), and N1/N4. `overview.test.ts` covers `equipmentId` and `hasHistory`. Missing:

- opening an old workout under weekly bests (S1);
- the remembered range after an opening, through the service (S2);
- the timed-label pair (S3);
- a real timezone case for weekly bests (N2).

---

## Spec issues

### SP1. Build notes added to the design doc by the developer
`9f917bf` adds "(Build: …; designer to confirm)" notes to `docs/design/progress.md` (§2.2 region 5 `All records` destination, §3.4 Latest/Change under weekly bests, §5.5 timed records) and records check 37 and O-PG1 as deferred. The notes are accurate and flagged, but they are design decisions waiting for the designer and Ben. The `All records (n) ›` destination in particular is still undecided. Confirm or replace them in the next designer pass.

### SP2. Carried from r1
SP2 (no record defined for timed holds, and the assisted 8+ threshold has no stated rationale) is still open. The build now hides the records section for timed series, which is a reasonable default.
