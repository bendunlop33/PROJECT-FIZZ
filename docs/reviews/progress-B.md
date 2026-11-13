# Review: Progress slice B (Exercises list and exercise detail)

Branch `claude/progress` (commits `d02deee`..`13b6778`, diff vs `claude/gracious-knuth-joxqpw`).
Spec: `docs/design/progress.md` v1.0 §2.6, §2.7, §3.4, §4.2, §5.5, §6.2–6.3, §7, checks 26–41.
Reviewer: independent; no source edited.

## Verdict: **CHANGES NEEDED**

One blocking finding (B1): with long histories the range summary's `Latest` and `Change` lines report weekly bests as if they were the latest and first sessions. Everything else is should-fix or a nit. The domain layer is careful and well tested, and the Est. 1RM labelling is complete.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npx vitest run --testTimeout=120000` | 207 files, 4018 passed, 1 todo, 0 failed (509 s) |
| Hand-computed probes (scratch vitest file outside the repo, against `packages/domain/src`) | see below |

Hand-computed cases that matched the code:
- Epley and rounding: 100×5 → 116.67 → `≈116.5 kg`; 100×1 → `≈100 kg`; 225 lb×5 → 262.5 → `≈263 lb`; 60×8 → 76, 62.5×8 → 79.17 → 79, 65×8 → 82.33 → 82.5 (service test).
- Rep table (checks 30/31): 100×8, 100×7, 102.5×6 by weight `102.5 6`, `100 8`; by reps 1–6 → 102.5 (`from 6` below 6), 7 → 100 `from 8`, 8 → 100, nothing above 8.
- Per-dumbbell unilateral: L 30×10, R 32.5×6 → `≈40 kg each from 30 kg each × 10`. Volume is `both` plus the busier side, per hand (600 in the fixture).
- Assisted: lower is better for top set, `By weight` (lightest first) and `By reps` (least assistance for ≥ N reps).
- kg/lb never mix. An lb row's kg-tagged set is left out of every number. An lb FitNotes Est. 1RM (250×5 → 292 lb ≈ 132.4 kg) suppresses a later kg app claim of 128.5 kg.
- Marked sets (PG21) are out of the Est. 1RM, top set, rep table, records and StatStrip, and in volume. A session where every set is marked has no point and gets a `Not counted` marker and table row.
- Gaps: 24 days breaks and is labelled. 20 days doesn't break. A gap next to a session with no value still breaks the line between the plotted points.
- Ranges: `6 mo` on 8 Oct is 9 Apr – 8 Oct. Month-end clamping is right (31 Mar − 1 mo = 29 Feb 2024).
- Timezones: every point, week (`mondayOf`) and history month uses the projected local `date` (owner zone; `localDate` for imports), and `today` comes from the profile zone. A Sunday 23:30 London session stays in its own Mon–Sun week. Missing end times don't affect slice B (no durations).
- Performance: the 416-workout, 2-year perf test passes (list and every detail view under the 1 s blocking budget). 'All' reduces to weekly bests above 150 points, and the table still lists all 416 sessions.

Rules checked: rule 1 (no network or AI anywhere on these screens; the `Ask` entry frames with the exercise, series and range and sends no numbers, and the coach gets no canned chips), rule 6 (`≈` and `Est.` on the StatStrip, points, panel, table header `Est. 1RM (estimate)`, records and VoiceOver "an estimate"), rule 8 (imported exercise names reach the coach only inside the JSON `YOUR DATA` block), rule 10 (only owner history, pain flags and gym names are read). No new chart library, and no Reanimated or Animated use in the new files (check 40).

---

## Blocking

### B1. With weekly bests, `Latest` and `Change` aren't the latest or first session
`packages/domain/src/progress/exercise.ts:483` (`summary: { latest: points[...], first: points[0] }` uses the aggregated `points`); used at `packages/domain/src/progress/exercise-view.ts:649-656` and `:673` (VoiceOver "latest …").

Failure: Ben has 3 years of FitNotes bench and picks `All`. That's more than 150 points, so the chart switches to weekly bests. This week he did 140×5 on Monday 5 Oct and a light 100×5 on Thursday 8 Oct. The panel reads `Latest ≈163.5 kg · 5 Oct` and VoiceOver says "latest about 163.5 kilograms". His latest session was 8 Oct at ≈116.5 kg. `Change Up ≈35 kg since 8 Jan 2023` likewise compares week bests, not the first session in range (2 Jan). I reproduced this in a probe. Each value is real, but labelling it "Latest" is wrong, and `· weekly best` appears only in the heading. FitNotes histories regularly pass 150 sessions, so this is the normal view for `All`.

Fix: build `latest` and `first` from `trend.sessionPoints` (every session in range) and keep `best` from either list (the same value). Alternatively, label the lines `Latest week` and `Change … since week of 2 Jan`. Add a test with more than 150 sessions where the last week's best isn't its last session.

---

## Should fix

### S1. Assisted (and timed) series never have records
`packages/domain/src/progress/records.ts:366-376`; empty text at `packages/domain/src/progress/exercise-view.ts:707`.

Spec §5.5 defines the assisted record `Least assistance for 8+ reps  15 kg · 2 Oct`, and check 39 says "Records list every record of the series". `exerciseRecords` only builds records for `load`, `added_bodyweight` and `bodyweight`. Probe: five assisted pull-up sessions dropping from 30 to 15 kg of assistance give `{"items":[],"empty":"No records yet."}`. "No records yet" stays up for good, even though he clearly set one. Timed holds behave the same way, and the spec doesn't define a record for them (see SP2).

Fix: add a `least_assist` sequential record (assistance at ≥ 8 reps, lower is better, PG10 history rule, import suppression with lower-is-better), with tests. Until timed is specified, don't show "No records yet." for kinds that can't have records: hide the section or omit it.

### S2. Opening from an old workout doesn't show that workout
`apps/mobile/src/screens/progress/ExerciseDetailScreen.tsx:43`, `packages/domain/src/progress/exercise-view.ts:716`, `apps/mobile/src/services/progress-service.ts` (`exerciseDetail`: the range is the remembered value or `6m`).

Failure: Ben opens a 2025 workout's Summary (or an imported FitNotes one) and taps `Bench press`. Detail opens on the right series but the default `6 mo` range doesn't include that session, so nothing is selected (probe: `selectedSessionId: null`, `range: "6m"`). Without a newer session he sees only `None between 9 Apr and 8 Oct`. The entry point promises "this workout's point selected".

Fix: when opening with `sessionId` and the session's date is before the current range, choose the narrowest range that contains it (`trendRangeBounds` makes this cheap), only for that first load. Add a domain test.

### S3. FitNotes series labels collide
`packages/domain/src/progress/exercise-view.ts:231` and `:243` (duplicates are made unique only for `app` series).

Failure: the import produced bench sets as `total` and as `bodyweight` (or `stack`, or a timed variant) for one exercise. The series menu shows `FitNotes · kg · 1` three times (probe), and Ben can't tell them apart. PG15 keeps them separate, so their labels have to differ too.

Fix: apply the same uniqueness suffix to import series (`FitNotes · kg stack`, `FitNotes · reps`, `FitNotes · timed`), and test it.

### S4. Workout overview `History` ignores the gym's equipment
`apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:934-936`.

The pill sends only `exerciseId`, so detail opens on the series used most in the last 12 weeks. Failure: Ben is at Hotel Gym, opens the overview and taps `History` on bench. He gets the Main Gym barbell chart, a different machine, which goes against "one series = one equipment instance". `ExerciseDetailRequest.equipmentId` already exists for this ("Prefer this equipment's series (Workout overview `History`)") but nothing passes it.

Fix: pass the equipment this gym would use for the row. The overview has `view.gym`; expose the planned equipment id on `OverviewRow`, then fall back to the gym's series. Also update `docs/design/workout-overview.md` §2.2, which still says `History` is deferred (line 96, line 218).

### S5. Home records still list up to 5 inline
`packages/domain/src/progress/home.ts:326` (`recordLimit ?? 5`), `apps/mobile/src/screens/progress/ProgressScreen.tsx:390`.

Spec §2.2 region 5 asks slice B for "Up to 3 rows, newest first, then `All records (5) ›`". Slice B also adds `Best Est. 1RM` rows, so the inline list gets longer. Fix: show 3 rows plus an `All records (n) ›` row (`records.total` already exists), opening a list or the Exercises screen, per the designer.

### S6. Check 37 (PG32 `Add FitNotes history`) isn't built, and nothing says it's deferred
No `SeriesLink`, `linkImportedSeries` or hollow points: `exercise-view.ts:629` always sets `hollow: false`. That may be correct while O-PG1 is open (see SP1), but no commit, spec note or test records that slice B ships without check 37. Fix: record the deferral in progress.md §8 (as was done for check 16 / O-PG6) so a later review doesn't read this slice as complete.

---

## Nits

### N1. Wrong empty message when every eligible set is marked
`exercise-view.ts:638`. One session in range with 100×5 marked `Spotted` shows `No sets of 10 reps or fewer in this range.`, which is false. Use the `no_eligible` message only when no eligible set exists at all; otherwise use `Not counted` or the too-few message.

### N2. A null `equipmentId` is treated as a real filter
`exercise-view.ts:396`. `input.equipmentId !== undefined` is true for the `null` the service always passes. Opening a Summary where the exercise appears on a no-equipment row and a barbell row selects `No equipment` (probe) regardless of which row was tapped. Use `!= null`, and ideally pass the row's `sessionExerciseId` from the Summary.

### N3. Assisted `Change` arrow direction
`exercise-view.ts:475`. "2.5 kg less assistance" shows a down arrow. The words are right and colour isn't used, so this is only a readability question. Consider an arrow that follows "better" for assisted, or ask the designer.

### N4. The chart summary omits markers
`exercise-view.ts:670-676`. The chart's VoiceOver summary mentions gaps but not `Edited` or `Not counted` markers. The marker lane is hidden from VoiceOver, so those markers only reach VoiceOver through the table. Add a short clause.

### N5. Touch handling over the chart
`apps/mobile/src/progress/trend-chart.tsx:78-100`. The plot claims the responder on touch start, so a vertical scroll that starts on the chart first selects a point (with a haptic). There's no `onResponderTerminate`, so `grant` can go stale. Check on device, consider selecting on release for taps, and clear `grant` on terminate.

### N6. Choices are in memory only
`progress-service.ts` (`detailChoice`). The series and rep-table choices are "remembered per exercise" (§4.2) only until relaunch. This is documented and tested, so it's fine for now. The spec lists `progress.repTableBy` as an optional setting.

### N7. Record history counts differ
`records.ts:340` vs `exercise-view.ts:707`. The Est. 1RM history counts only sessions with a value. The empty text counts every logged session. With 4 sessions where one is all over 10 reps, the text says "No records yet." although the rule needs one more session. Harmless; consider aligning them.

### N8. `History` shows with no history
For an exercise Ben has never finished, the overview `History` pill opens to `No finished workouts with this exercise yet.` Consider hiding the pill when there's no history.

### N9. Navigation stacks repeat
From the `ExerciseProgress` modal, `Open workout` pushes another `Summary` (React Navigation 7 `navigate` pushes), whose rows can push another detail, and so on. This works, but check on device that back and swipe-down behave as expected.

---

## Tests

They're strong: checks 26–39 have direct domain tests (series split, kg/lb, per hand, assisted, plate-loaded vs dip belt, marked sets, gaps, weekly best, ranges, records with import suppression, history paging, opening on a workout), plus service tests (recompute after a correction, pain line, relaunch) and pure chart geometry. Missing cases:
- weekly-best `Latest`/`Change` (B1);
- assisted records (S1);
- opening on a session outside the default range (S2);
- import label collisions (S3);
- the overview `History` series choice (S4);
- an explicit timezone case where a late-evening UTC-next-day session falls into the right Mon–Sun week for weekly best (the projection handles this, but slice B has no test pinning it).

---

## Spec issues

### SP1. PG32 status contradicts itself
§8 slice B "Builds" says `Add FitNotes history` comes "once Ben confirms O-PG1". §10 O-PG1's default says "Built in slice B behind the menu item". The spec needs to say whether check 37 belongs to slice B before O-PG1 is answered.

### SP2. Records undefined for timed holds; assisted threshold unexplained
No records are defined for timed series, and the assisted record's fixed "8+ reps" threshold has no rationale. The designer should define a `Longest hold` record (or state that timed has none) and confirm 8+.

### SP3. `Latest` and `Change` undefined under weekly bests
§3.4 "Long history" doesn't say what `Latest` and `Change` mean when weekly bests are shown (see B1). Recommend: always per session.

### SP4. workout-overview.md is out of date
`docs/design/workout-overview.md` §2.2 and §8 still mark `History` as deferred; it's now built.
