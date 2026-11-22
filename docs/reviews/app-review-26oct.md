# App review: the real iPhone app, 26 Oct 2026

Reviewer: independent `reviewer` agent. Ben asked (26 Oct) for a detailed review of the shipped app's design and functionality: every main screen and flow in `apps/mobile/src`, checked against `docs/design` (README index), the CLAUDE.md product rules and the minimal-copy rule. I used his recent device feedback as the pattern to look for elsewhere:

- too much scrolling
- defaults that ignore his data
- truncated text
- slow screens
- wrong landing pages
- editors that look different
- near-duplicate exercises
- Swap that can't reach every exercise
- a hard-to-find empty workout

## Verdict: **CHANGES NEEDED**

No product rule is broken in a way that loses or silently changes data. The logging loop, Undo, versioned writes and the honest AI status hold up. But Ben's feedback classes are not fixed across the app, only on the screens he named:

- **Progress is still the slowest screen.** First open after a launch takes 2.4 s (3.1 s without the JIT), with about a 1 s freeze. Every tab switch reloads everything.
- **The empty workout lands on an old picker.** It isn't the Swap/Add sheet fixed on 25 Oct.
- **Two screens still diverge.** The exercise-progress screen and the workout editor each have a sibling that looks and behaves differently.
- **Past workouts can't be reached.** The full list of past workouts (with bulk delete and Repeat) has had no entry point since 22 Oct.

## What I reviewed and ran

- **Code.** Committed `HEAD` = `746eac9` ("Progress › Lifts: main-lift chips at the top", 26 Oct). Line numbers below are at that commit.
  - Another developer is working in the same checkout. Uncommitted changes seen during the review: the Today `Empty workout` button, Overview lift names wrapping, Library › Workouts. I reviewed them only where noted (marked *in progress*).
  - That uncommitted Today change failed `npm run typecheck` once: `TodayScreen.tsx:846`, `onEmpty={… : undefined}` under `exactOptionalPropertyTypes`. Fix: `{...(actions.emptyOnCard ? { onEmpty: startEmptyNow } : {})}`.
- **Typecheck.** Passes on the committed code (clean worktree at `9a90ca4`).
- **Perf lane** (`npm run test:perf`). 9 files, 13 tests, all within budget. Today cold 355 ms, Set up a plan cold 109 ms, Your workout from Today 355 ms, Swap sheet 243 ms, Log a set 51–71 ms, Finish 125 ms.
- **Extra measurement** (scratch test in a throwaway worktree, not committed; same ~800-workout dataset as `app-paths.perf.test.ts`). The perf lane has no budget for these paths:

| Path (what the screen awaits) | Node | No JIT |
|---|---|---|
| Progress opened cold, before the launch's prewarm finishes: `reviews.progress()` (Overview) | **2,407 ms, longest block 881 ms** | **3,063 ms, block 1,049 ms** |
| Then `progress.home()` (Training totals, read on the same focus) | 1,697 ms | 2,076 ms |
| The launch's background `progress.prewarm()` | 4,347 ms (block 680) | 4,189 ms (block 462) |
| Progress focus after prewarm (home + consistency + reviews) | 350 ms | 410 ms |
| **Progress focus again, nothing changed** | **198 ms** | **338 ms** |
| Lifts tab open (`exerciseTab` + list) | 137 ms | 221 ms |
| Lifts: change the period (one dropdown pick) | 158 ms | 292 ms |

- **Mobile tests.** On the committed code (clean worktree at `9a90ca4`): 226 files, 2,429 passed, 1 todo.

## Already fixed from Ben's list (verified in code)

- **Lifts defaults and scrolling** (`746eac9`, today). Chips of main lifts sit at the top, with the chart straight under them, and the last pick is remembered. Finding 5 covers what is still wrong.
- **Set up a plan landing.** It opens at step 1 with his last answers (`PlanSetupScreen.tsx:91–110`, `pbFirstPage`). Only Edit plan opens on Your plan.
- **Swap / Add reaches every exercise.** True on Your workout, the one editor, and the live table's `＋ Add` / Swap. Finding 2 covers the paths that still use the old picker.
- **Near-duplicates.** Code-built days no longer pick them. Swap / Add lists them as `Like …`.
- **Empty workout on Today.** *In progress* (uncommitted, with the typecheck error above).

## Top 10 to fix next

| # | Fix | Why Ben will notice |
|---|---|---|
| 1 | Make Progress fast: cache its reads by data version (as Today does), load only the visible tab, add perf budgets (finding 1) | Progress takes 2–3 s with a ~1 s freeze on first open, and 0.2–0.35 s on every tab switch |
| 2 | Send every "Add exercise" in a workout (empty workout, all sets done, Focus, `Superset with…`) to the shared Swap / Add sheet (finding 2) | The empty workout he asked for lands on a different, older picker with no muscle chips, `Like …` or `＋ Add your own` |
| 3 | Give Past workouts an entry again: `All workouts ›` in Library › Workouts and on Progress › Training (finding 3) | He can't list all his workouts, bulk-delete test sessions or Repeat an old one |
| 4 | One exercise-progress screen: Summary / workout / Library `History` and Progress › Lifts show the same component (finding 4) | The same lift has two different charts, controls and period names depending on where he taps |
| 5 | One list of "main lifts": his own `Edit lifts` picks first, then the plan's, then most-trained (finding 5) | Overview and Lifts show different lifts. His own pick on Overview is ignored by Lifts |
| 6 | Finish the one-editor work: the same Time control, and autosave the editor's draft (finding 6) | The plan-day editor still looks different from Your workout, and a force-close loses all edits |
| 7 | Move Your workout's option rows (Main lift, Accessories, Abs, Supersets, Mix it up) below the table, or into one `Options ›` row (finding 7) | Up to 5 rows of settings sit above the workout, so the exercises start low on the screen |
| 8 | Stop Today re-rendering every second when no workout is open (finding 8) | Today redraws the whole page once a second, all the time |
| 9 | Lifts tab: one batched read for targets, and no full recompute per dropdown pick (finding 9) | Each period or measure change takes ~0.3 s on a Hermes-like engine |
| 10 | The coach bar does the same thing everywhere: open the coach sheet, not an `Alert.prompt` (finding 10) | On Your workout, typing to the coach opens a bare iOS text box with no thread or status |

## Findings, most to least severe

### High

**1. Progress is slow to open and slow to come back to.** (Progress › Overview, Lifts, Training)
- **What Ben sees.**
  - Opening Progress soon after launching the app takes about 2.4 s (3.1 s without the JIT). The JS thread freezes for about 0.9–1.05 s, so taps and scrolling stall.
  - Every return to the Progress tab re-reads everything, with nothing changed: 0.2 s, or 0.34 s without the JIT. That is before React renders every chart again.
  - This is the "things were slow" class on the one screen the perf lane doesn't measure.
- **Where.**
  - `shell/context.tsx:105`: `useScreenData` reloads on every focus, whatever the data version.
  - `ProgressScreen.tsx:52,54`: `progress.home()` (Training's totals) and `plans.consistency()` load even when Overview is showing.
  - `reviews/ReviewsSection.tsx:305`: `reviews.progress()`.
  - Every tab that has been seen stays mounted (`ProgressScreen.tsx:207–248`), so all of their `useScreenData` hooks re-run on each focus.
  - `weekly-review-service.ts:724` (`progress()` → `gather`, `liftHistory`) has no cache keyed on the stored version.
  - There is no perf budget for any of these (`apps/mobile/test/*.perf.test.ts`).
- **Fix.**
  - Key `useScreenData` results on `useDataVersion()` the way `useTodaySessionData` does (`TodayScreen.tsx`, ADR 0032 pattern), so a refocus with nothing changed costs nothing.
  - Load Training's `home()` and `consistency()` only when Training is first opened.
  - Make `reviews.progress()` read the stored history summaries and cache per version.
  - Add budgets for cold Overview (< 500 ms, < 1.5 s without the JIT, as Today has), refocus (< 50 ms) and a Lifts dropdown change (< 150 ms).

**2. The empty workout, and some Add paths in a live workout, open the old exercise picker.** (Active workout)
- **What Ben sees.**
  - Starting an empty workout auto-opens `ExercisePickerScreen`, a different full-screen modal. It has no muscle chips (Chest, Back…) and no `Like …` near-duplicate marking. It has no `Not at <gym>` grouping and no `＋ Add your own`, and it doesn't look like the Swap / Add sheet.
  - The same old picker opens from:
    - `Superset with…`
    - Focus view's `Add exercise`
    - the `All planned sets done` screen's `Add exercise`
  - The table's own `＋ Add` opens the new sheet. The same action looks different depending on the button.
  - The 25 Oct changelog says the one sheet covers "the workout in progress".
- **Where.** `WorkoutScreen.tsx:591` (auto-open on an empty workout), `:1073` (`superset_with`), `:1896` (Focus primary), `:2493` (Focus `Then Add exercise`) and `:2995` (all done). The shared sheet is `workoutEdits.openAdd()` (`:1069`, `:2904`) → `SwapSheet` (`WorkoutEdits.tsx:483`).
- **Fix.**
  - Route all five to `workoutEdits.openAdd()`, and auto-open it for an empty workout.
  - Give the sheet a `supersetWith` mode for the pairing case: partners first, then the full list.
  - Retire `ExercisePickerScreen` once nothing uses it.
  - Test that no live-workout path navigates to `ExercisePicker`.

**3. The Past workouts list is unreachable.** (History; delete-workouts spec)
- **What Ben sees.**
  - There is no list of all his workouts. He can't:
    - Select several and delete them (the "clear out test sessions" flow)
    - Repeat an old workout from a list
    - Reach `Recently deleted` except through Profile › Data & backup
- **Where.**
  - The route is registered (`AppNavigator.tsx:357`), but nothing navigates to it. Its only entry was the session picker, removed in `df0ef78` (22 Oct, "Retire the Workout overview").
  - `delete-workouts.md:45` still says "Today → `Past workouts`".
  - `LogPastWorkoutSheet.tsx` and `log-past-workout.md` say the sheet is reached from Past workouts.
  - `navigation.test.ts:163` still tests the `PastWorkouts → Repeat → CheckIn` flow, so the tests pass on a path Ben can't reach.
- **Fix.**
  - Add `All workouts ›` under Library › Workouts' `From history` section, and a `Past workouts ›` link on Progress › Training (Calendar header).
  - Add a test that every root-stack route has at least one `navigate`/`dispatch` to it, excluding probe screens. It would also catch finding 15.

**4. Two different exercise-progress screens.** (Progress › Lifts vs Exercise detail)
- **What Ben sees.** Tapping an exercise on a Summary, in the workout's `History`, in the editor or on Library's exercise page opens Exercise detail. It has range chips `3 mo · 6 mo · 1 yr · All`, metric chips, a rep table, records and history. Progress › Lifts shows the same lift with dropdowns, `1 month … 6 months`, a trailing average and a sessions table. This is the same class as "two editors looked different".
- **Where.** `SummaryScreen.tsx:574`, `WorkoutScreen.tsx:1045`, `BuilderWorkoutScreen.tsx:802`, `EditWorkoutScreen.tsx:523` and `ExerciseInfoScreen.tsx:200` all go to `ExerciseProgress` → `ExerciseDetailScreen`. Progress uses `ExercisesTab` (`ProgressScreen.tsx:213`). The period labels differ: `exercise-view.ts:107` vs `window.ts:13–15`.
- **Fix.**
  - Pick one. Make `ExerciseProgress` render the Lifts tab's body for that exercise (no chip row, same controls), with the record and history extras as sections below.
  - Or make Lifts' chart a compact view of Exercise detail.
  - Use one period vocabulary.

**5. The Lifts tab's main lifts ignore the lifts Ben chose on Overview.** (Progress › Lifts vs Overview)
- **What Ben sees.** Overview's Lifts card has `Edit` (up to 6 lifts he picks, saved as `progress_lifts`). The new Lifts chips use the plan's main lift per day, or his most-trained compounds. They never look at his own picks. A lift he added on Overview, such as a hip thrust, isn't a chip on Lifts. With no plan, Overview and Lifts can show different lifts.
- **Where.** `packages/domain/src/progress/lift-picks.ts` (`defaultLiftPicks`: plan mains, history or recent). `progress-service.ts` (`exerciseTab` passes only `planMains`). `ReviewsSection.tsx:197–296` (`LiftsShownSheet` writes `progress_lifts`).
- **Fix.** One "tracked lifts" source used by both, in this order: his `progress_lifts` picks, then the plan's mains, then most-trained compounds, then recent. Overview's `All lifts ›` opens Lifts on the same set. Add a test that a lift picked on Overview is a Lifts chip.

### Medium

**6. The "one editor" still differs from Your workout, and it loses edits on a force-close.** (Library › Workouts / plan day Edit vs Your workout)
- **What Ben sees.**
  - The table is shared, but the page around it differs. The editor's `Time` is a read-only value (or `—`), while Your workout's is a stepper with the fit note. The name is a large text field. The bottom bar is `Save` only, with no Ask bar, Start or Review.
  - Nothing is saved until Save. A long plan-day edit is lost if iOS kills the app. Your workout saves every change as a versioned draft.
- **Where.** `EditWorkoutScreen.tsx:424–431` (Time is read-only) and `:57` (the doc comment says edits are lost on a force-close), compared with `BuilderWorkoutScreen.tsx:613–629`.
- **Fix.**
  - Use the same `TimeNoteRow`, or drop Time from the editor until it can change.
  - Keep a local editor draft (opId plus the routine's base version) that restores on reopen, with `Resume edits / Discard`. Save stays one versioned write (rule 5).

**7. Your workout puts its settings above the workout.** (Your workout from Today)
- **What Ben sees.** These rows sit above the first exercise:
  - title
  - Time
  - Main lift chips
  - Accessories `Focused | Varied`
  - Abs
  - Supersets
  - `Mix it up`
  - any status lines

  With the bottom bar (Ask bar, Start, Review), the first exercise row starts about two-thirds of the way down a 375×667 screen. At large text it is off-screen. This is the "too much scrolling to see what matters" class again.
- **Where.** `BuilderWorkoutScreen.tsx:632–637` (`TodayOptionRows` at the top of the scroll area); `TodaySession.tsx:376–401`.
- **Fix.** Put the table first and the options under it. Or use one `Options · Main Bench · Abs on ›` row that opens a sheet. Spec §2.3a places them "above the workout", so this needs Ben's OK (see Spec issues).

**8. Today re-renders every second.** (Today)
- **What Ben sees.** Nothing visible, but the whole Today page renders once a second, all the time, even with no workout open: header, strip, card and sheets. This costs battery and makes scrolling and taps less smooth on a big card.
- **Where.**
  - `TodayScreen.tsx:268` (`setInterval(… setNow …, 1000)`, unconditional).
  - The strip (`:648`) and day segments (`:651`) are recomputed on every render without `useMemo`.
  - Only the Resume hero's rest countdown needs the tick.
- **Fix.** Run the 1 s tick only while `main.kind === 'resume'` and resting, or move the countdown into its own small component with its own timer. Memoise `strip` and `segs` on `session`, `selection` and `main.kind`.

**9. The Lifts tab does sequential full workout reads on every change.** (Progress › Lifts)
- **What Ben sees.** Each period, measure, series or exercise pick re-runs the whole `exerciseTab`. That takes 158 ms in Node and 292 ms without the JIT, so taps feel sticky.
- **Where.** `progress-service.ts:323–336` (`targetsFor` awaits `repos().sessions.get(id)` one at a time, for up to 20 full workouts, on every call). `getMany` is already used at `:273`.
- **Fix.** Use `sessions.getMany(ids)`. Cache targets per exercise and data version. Don't rebuild targets when only the period or measure changes.

**10. The coach bar behaves differently on different screens.** (Today vs Your workout)
- **What Ben sees.** With no voice, tapping the Ask bar on Today opens the coach sheet (thread, status, Undo). On Your workout it opens a bare iOS `Alert.prompt` text box.
- **Where.** `TodayScreen.tsx:904` vs `BuilderWorkoutScreen.tsx:757–761`.
- **Fix.** Open the coach sheet with the workout's entry and the draft focused, the same as Today. Keep `askWorkout` for spoken words.

**11. Overview lift names are cut off.** (Progress › Overview, Lifts card) *In progress.*
- **What Ben sees.** Under the chart, `Barbell bench press` becomes `Barbell b…`. The table gives the name a quarter of the width, the same as the narrow `× 6` reps column.
- **Where.** `reviews/charts.tsx:474` (`numberOfLines={1}`, `flex: 1`); `lifts-layout.ts:156,162` (4 equal columns).
- **Status.** An uncommitted change in the shared checkout wraps or stacks the name (`liftRowStacked`). When it lands, check 320 pt and AX1–AX3, and give the reps column a fixed narrow width so the name gets its share. The Muscles card's header row (`charts.tsx:691`, `numberOfLines={1}`) has the same risk.

**12. The plan builder hides or hard-codes units.** (Set up a plan: Gym goals, Check your lifts)
- **What Ben sees.** `What to expect` heads its table `kg × 6` whatever the gym's unit. Check your lifts shows `100`, `112.5` with no unit. Dumbbells show `each`, but barbell and machine values show no unit at all.
- **Where.** `PlanSetupScreen.tsx:323`; `plan-builder-view.ts:264–268` (`kgText`).
- **Fix.** Take the unit from the kit or profile (`kit.unit`), and put it in the headers: `6 reps (kg)`, `1RM est. (kg)`. This matches the CLAUDE.md convention "kg/lb … always explicit".

**13. Your data and Coaching knowledge are mixed in Profile.** (Profile)
- **What Ben sees.** `Memory` (Your data) and `Playbook` (Coaching knowledge) sit together under `Coach`. Rule 10 asks for the two domains to stay separate in the UI. This was flagged on 22 Oct (V31) and is still open.
- **Where.** `ProfileScreen.tsx:150–175`.
- **Fix.** Put `Memory` and `Pain flags` in a "Your data" group, and `Playbook` in "Coaching knowledge", with the same names as Data & backup.

### Low and nits

**14. Today text is cut at large text sizes and 320 pt.** The day-control segment labels (`TodaySession.tsx:230`, `numberOfLines={1}`, no shrink or cap) cut `Shoulders` and `Full body` at xxxLarge, before the AX list kicks in. The header's `· Week 6 of 6 · Deload` (`:58`) is cut beside the title and the coach bar at 320 pt. Fix: `adjustsFontSizeToFit` with `maxFontSizeMultiplier`, and switch to the `Day ›` list from xxxLarge.

**15. Dead routes.** `ImportIntro` (`AppNavigator.tsx:196`) and `ProgressExercise` (`:152`) are never navigated to. Remove them, or cover them with the reachability test from finding 3.

**16. The check-in can't be turned back on.** Settings aren't saved and there's no settings screen (`workout-services.ts:368`; `check-in.md` §2.8). Ben chose off by default (23 Oct), but there is no way to switch it on. Add one row under Training details.

**17. A blank page with no way out while loading.** `PlanSetupScreen.tsx:135` returns an empty `Screen` until its read finishes. The route is a `fullScreenModal` with the gesture disabled and no Close button. `ImportHistoryScreen` does the same. A slow or hung read is a dead end. Show the top bar's Close at once and a placeholder after `timing.placeholderDelay`.

**18. Long lists render every row.** Library › Exercises (`LibraryScreen.tsx:112,158`) and the Swap / Add sheet (`swap-sheet.tsx:139–149`) render about 240 rows in a `ScrollView` and re-render all of them on each search keystroke. That's fine in Node, but it should be checked on the phone. Fix: `SectionList`, and debounce the search by about 100 ms.

**19. Error recovery goes to different places.** Today's error offers `Restore from a backup` and opens Data & backup (`TodayScreen.tsx`). Progress's opens Restore directly (`ProgressScreen.tsx:180`). Pick one: Restore.

**20. Plan setup's loading state has no placeholder** (`PlanSetupScreen.tsx:135`), unlike Library and Progress. It is covered by the fix for finding 17.

## Product rules (CLAUDE.md)

- **Rules 1, 2, 3, 5:** no new violations found.
  - Logging and Progress are local.
  - The coach status is honest (`sheet-view.ts:57–61`).
  - Small next-session changes are auto-applied with Undo, and bigger ones wait for Apply (`weekly-review-service.ts:664–678`, matching Ben's 9 Oct and D2 decisions).
  - Start, Apply plan, Undo and editor Save each use op IDs and expected versions.
- **Rule 4 / convention:** finding 12 (units in the plan builder).
- **Rule 10 in the UI:** finding 13.
- **Durability:** finding 6 (the editor loses unsaved edits on a force-close). Today, Your workout and the live workout are fine: drafts and the session are stored.

## Spec issues

1. **`workout-builder-v3.md` §2.3a** places Today's options above Your workout's table. On a phone this pushes the workout below the fold (finding 7). Ben should decide: table first, or one `Options ›` row.
2. **`delete-workouts.md:45` and `log-past-workout.md`** still name `Today → Past workouts`, but that entry was retired with the Workout overview (22 Oct). The specs need a new owner for the list (finding 3).
3. **`progress.md` (Exercise detail) and `progress-goals.md` (Lifts)** define two exercise-progress views with different controls and period words. One spec should own "an exercise over time" (finding 4).
4. **`progress-goals.md` (Lifts card `Edit`) and the 26 Oct Lifts chips** define "main lifts" two ways (finding 5).
5. **`workout-summary.md` §2** puts `Next time` (with its Undo) after the full exercise list. With 6–8 exercises, Ben scrolls past everything to reach the changes he might undo. Consider a one-line `Next time: 3 changes ›` near the top.
6. **`check-in.md` §2.8** settings have no screen (finding 16).

## Tests

- The perf lane has no budget for Progress Overview (cold and refocus), Lifts dropdown changes or `progress.home()`. These are the slowest everyday paths I measured (finding 1).
- `navigation.test.ts:163` tests the `PastWorkouts → Repeat` flow, but no test checks that a route is reachable (findings 3 and 15).
- No test pins that the live workout's Add paths use the shared Swap / Add sheet (finding 2).
- No test that a lift chosen in Overview's `Edit` shows as a Lifts chip (finding 5).

Mobile tests on the committed code (clean worktree at `9a90ca4`): 226 files, 2,429 tests passed, 1 todo. In the shared checkout, 4 `device-prefs` tests failed on the other developer's uncommitted 26 Oct changes, which were later committed in `746eac9`. Not a defect in committed code.
