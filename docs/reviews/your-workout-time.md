# Review: Your workout Time control and the 22 Oct overview follow-ups

**Verdict: CHANGES NEEDED** (22 Oct 2026)

Scope: `fe5c67a..90daca6` on `claude/yourworkout-time-22oct` (3e1def9, a5310e4, 484d28d, 8ad1f25, ade79a6, 90daca6).
Checked against the six items in the task, `docs/design/fit-to-time.md` (22 Oct revision), `docs/design/workout-builder-v3.md` §2.1 and §2.3–§2.5, CLAUDE.md rules 1–5 and 9, and the minimal-copy convention.

## Checks I ran

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npx vitest run` (full suite) | 471 files, 8749 passed, 2 todo, exit 0 |
| Reviewer probe: a temporary test on real SQLite with 4 cases, deleted afterwards (tree clean) | Reproduced B1, B2 and B3 below |

## What holds up

- **Item 1, the basics.**
  - Today and Your workout share one `TimeStepper`, and Today looks the same. The screen only calls `services.builder.setTime`; it has no fit logic of its own.
  - It reuses `fitToMinutes` with `grow: false`. That path never pairs exercises, so V14 (no supersets when Supersets is off) holds whatever the setting is.
  - Loads never change. `keepEffort` stops the RPE 9 bump.
  - Writes are idempotent by op ID and version-fenced. A stale write is refused, and the same length again writes nothing. The fit survives a force-close.
  - There's no coach call (the model's request count doesn't change) and no network dependency.
  - Start creates the fitted workout: the plan stores concrete rest seconds. The saved library workout is untouched, and the Start prompt ignores the cuts.
- **Item 2.**
  - Timed and cardio sets round-trip through `DraftPlanSchema`, which allows reps or a time/distance, never both.
  - Start creates them with `reps: null` and `durationS`/`distanceM` exactly as saved. This is covered by a real-SQLite test in `builder-open-sources`.
  - A repeated exercise becomes separate slots. Coach edit ops target `slotKey`, so duplicates are unambiguous for the coach bar.
- **Item 3.** The button is renamed, and no other `Start` wording is left on `PlanDayScreen`.
- **Item 4.** Doc only (see SP1).
- **Item 5.**
  - The wording comes from the domain's `mayHurtConfirm`.
  - `painFlagged` and `painLine` both use `painFlagCovering`, so a row tagged `May hurt` always asks first.
  - The active workout uses the same sheet.
- **Item 6.** Same routes and conditions as the retired overview (`df0ef78~1:apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:1460-1500`). The pop-up closes first.

## Blocking

### B1. Time leaks into the plan: `Update … in your plan` saves the Time length as the plan day's length

**Where:** `apps/mobile/src/builder/builder-service.ts:811`, `:828`. `updatePlanDay` reaches the same code at `:1653`. `setTime` writes the length at `:1299`.

**What happens:** `planWriteFor` strips the fit's cuts (`untimed`, `:817`) but still sets `planDay.minutes = setup.minutes`. `setup.minutes` is now whatever Time was stepped to. Today's card and the builder both open the day at `planDay.minutes` (`packages/domain/src/today-v2/plan-days.ts:72`; `builder-service.ts:1135`, `:1771`).

**Repro (probe, real SQLite):**
1. Apply a plan.
2. Library › Push › `Open Push`.
3. Step Time down from 60 until an exercise drops (45).
4. Add a set to bench.
5. Start, then choose `Update Push in your plan`.

The template's `planDay.minutes` goes from unset (60 default) to **45**. On the next Push day, Today's card opens at 45 min and fits the workout to 45 again. A today-only cut has become the plan.

It also happens when Time was lowered without any cut. In that case no `timeFit` is stored, so there's no record of the length before Time at all.

The doc line "on a plan day the Start prompt and `Update … in your plan` ignore the cuts" (`docs/design/workout-builder-v3.md:382`) is not true for the length. The plan-day test (`apps/mobile/test/your-workout-22oct.test.ts:355-395`) checks exercises and set counts but not `planDay.minutes`.

**Fix:**
- Whenever Time is used, record the length from before the first Time change, not only while a cut is live (e.g. a `timeFrom` on the stored set-up).
- Use that length, not `setup.minutes`, for `planDayField`.
- Assert `planDay.minutes` in the plan-day test, including the "lowered without a cut" case.

### B2. Going back to Set up after a Time fit throws the fit away: the cuts and shortest rests stay, the note and Undo disappear, and more time restores nothing

**Where:** `apps/mobile/src/builder/builder-service.ts:1365`, `:1391`. `storedSetup` rebuilds the set-up without `timeFit` but carries `restLevel` over.

**Repro (probe):**
1. Set up Push at 60 min with Supersets off, then Next.
2. Step Time down until `−1 exercise` (6 → 5 exercises, Time 40, rests shortened).
3. ‹ Set up, turn Supersets on, Next (the merge path).

Result: `time: null` and no note. Moving Time back to 60 still gives 5 exercises, rests still `shortest`, ≈ 37 min.

The merge path shows no toast, so there's no Undo. Your workout has no rest-level control, so Ben can't get the rests back from the page, and nothing tells him they're shortened.

This breaks two requirements on a normal builder path: more time restores trimmed work up to the original, and every fit shows an honest note with a one-step Undo. The developer's notes say gym change, Reload and a coach version drop the fit. Set up isn't mentioned or tested.

**Fix:** in `changeSetup`, do one of these:
- Undo the fit first (`untimed`, minutes back to `timeFit.fromMinutes`, rest level back to the base's), then merge into the original.
- Keep `timeFit` through a merge (its slot keys survive one) and fit again afterwards.

Whichever you choose, never keep a fit's rest level once its record is dropped. Add a test.

### B3. "Never the main lift" fails for a past workout (History › do again): its main lift loses sets

**Where:**
- `apps/mobile/src/builder/builder-service.ts:634`: `main` comes only from a routine, so a session source always gets `null`.
- `packages/domain/src/builder/from-planned.ts:182`: no slot gets marked main.
- `packages/domain/src/builder/fit.ts:128`: every non-main slot can be trimmed.

**Repro (probe):**
1. Log bench 5 × 100 kg, incline DB press 2 sets and lateral raise 2 sets.
2. Open that workout from History with "do again", which opens Your workout. No slot is `main`.
3. Step Time down once.

The detail reads `Shortest rests` · `Bench press 5 → 4 sets`. Further steps trim bench toward 2 sets before anything is dropped.

The 22 Oct revision says "The main lift is never cut". fit-to-time §4.2 says a history source uses the WL9 default main. Saved library workouts are fine: `saveFrom` marks a main (the probe showed `[true, true, false]`).

**Fix:** for session sources, and any source whose main is null, work out the main with the same default `saveFrom` uses (WL9 at read) before building the slots, or have `fitWorkoutToTime` protect that default. Add a test for the do-again path.

## Should fix

### S1. On a draft from Today's `Edit`, more time brings nothing back, and Time no longer matches the workout

**Where:** `packages/domain/src/builder/time-fit.ts:122-123`.

Today's card has already fitted the workout. The committed draft stores Today's length as `setup.minutes`, with no `timeFit`. On Your workout, `+` uses `fromMinutes = setup.minutes`, so `to >= fromMinutes` returns the workout unchanged. Time says 50 min while the workout is still Today's 45-minute cut. Going down and back up only restores Today's cut, never the full plan day.

**Fix:** either store Today's fit as a `timeFit` when the draft is committed (base = the day before fitting), or agree with Ben that Your workout's Time only undoes its own cuts and write that into the spec (SP6).

### S2. Time goes the wrong way on a workout that was already over its length

**Where:** `time-fit.ts:122-123`.

Take a plan day that opens at 60 min with a 70-min estimate (`⚠ Over 60 min`). One step down to 55 fits it to about 55. One step back up to 60 brings back the 70-minute original, not a 60-minute fit.

**Fix:** for the first fit, use `max(setup.minutes, ceil(estimate))` as `fromMinutes`, or fit to 60 when the original is over.

### S3. After Gym changed or the coach's version, shortened rests stay with no note once the toast is gone

**Where:** `builder-service.ts:1272`, `:1838`.

Both delete `timeFit` but keep `restLevel` and the cuts. Undo only works from the toast. After that, there's no note, `+` restores nothing, and rests stay `shorter`/`shortest` with no control on the page to change them. The developer documented this, but it leaves the same stuck state as B2.

**Fix:**
- On gym change, apply the existing re-gym step to the base as well and keep the fit.
- On the coach version, either keep a rests-only note or put rests back to the base level.

### S4. The tests miss the cases that broke

Nothing tests:
- `planDay.minutes` after an Update (B1)
- a Set up change after a fit (B2)
- a do-again source's main lift (B3)
- a draft opened from Today's `Edit` (S1)
- a workout that was already over its length (S2)
- Supersets on. "No superset made, ever" is only tested with `supersets: false`. It holds because `grow: false`, but no test pins that down.
- a timed or cardio slot trimmed and restored by Time
- `keepEffort` with Ben's own RPEs
- two copies of an exercise reordered, then Gym changed

The new screen parts (Time row, detail sheet, pop-up links, swap confirm) are only checked by source-string tests. There's no render test and no device run.

## Nits

- **N1.** `packages/domain/src/builder/estimate.ts:41`: a distance-only cardio set (`5,000 m`) counts as 45 s. The title and the fit then understate the workout, and the fit can decide it "fits" with a 20-minute row in it. It's not invented data, but consider a pace from history, or show that the row's time isn't counted.
- **N2.** `builder-service.ts:1240-1252`: copies of a repeated exercise are matched by their order. If Ben swaps the order of the two bench copies and then the gym changes, each copy gets the other's saved sets. Match by slot key against the source's slots instead.
- **N3.** `time-fit.ts:48-51`:
  - If Ben adds a dropped exercise back by hand after a fit, `+` also brings back the fit's copy, so it appears twice (duplicates are allowed now).
  - If Ben's additions take the workout to 10 exercises, the remaining dropped slots are skipped with no note.
- **N4.** `packages/domain/src/builder/from-planned.ts:182`: if the main lift is listed twice, both copies get `main: true`. That's harmless for the fit. Check nothing downstream assumes a single main slot: ordering, hiding `Superset with next`, and the session's main-lift progression.
- **N5.** Rule 4 for loaded timed sets: `reloadSlotLoads` now skips timed slots. A weighted carry or plank from a chat draft, or one Ben edited, keeps the old gym's load after Gym changed until Start's planner re-fits it. Until then the page can show a load the new gym can't make.
- **N6.** Each Time step replaces the draft's single Undo record. A `Deleted · Undo` toast still showing from just before a Time tap then answers `Can't undo`. Other edits without a toast do the same.
- **N7.** The note and detail have their own wording rather than `todayFitLine`, which the task named. Today's card still says `last sets pushed to RPE 9` and `drops …`. That's correct per the 22 Oct revision, but the two screens now describe the same fit differently.

## Spec issues

- **SP1. Who decided items 2–6.** The only request from Ben in this run is "can you add option to reduce time?" (item 1).
  - The docs now record items 2–6 as "Ben's decision as relayed by the PM".
  - `workout-builder-v3.md` changes rep ranges (`3–6`) from "pending Ben" to "approved".

  Confirm with Ben before merging. If he agrees, record it as CLAUDE.md asks. If he doesn't, revert the "approved" marking.
- **SP2. One length field, four meanings.** `setup.minutes` is Set up's Length, Your workout's Time, Today's Time and, under review S8, the plan day's length. If Time is today-only, the spec has to say which length a plan update saves. This is the root cause of B1.
- **SP3. Old rules still in fit-to-time.md.** The 22 Oct revision sits on top of the v1.0 body. That body still says FT3 ("never shortens rest") and FT8/FT-C5 (Start sets `finishBy`), and still describes the `How long?` sheet and the coach fit. The new header covers the sheet and the coach fit as belonging to the retired overview. FT3 and FT8 directly contradict what's built and aren't marked superseded. Either mark them superseded or keep them as open items: Start doesn't set `finishBy`, and Today's Start doesn't either.
- **SP4. Superset wording.** Revision step 1 says "then supersets if they're off". The task says never make supersets when Supersets is off (V14). The written step reads the opposite way; change it to "if Supersets is on".
- **SP5. "The same fit as Today" against the revision.** The revision's cheapest-cut weights, its superset saving and the week carry-over all need the shared fit changed, which changes Today's card too. Today's card also still pushes accessory last sets to RPE 9; Your workout doesn't. Ben should decide whether Today's card moves to the revision as well.
- **SP6. What "the original" means for a draft Today's card already fitted** (see S1).

## Other notes

- The developer reported running `pkill -f` on typecheck command patterns around 22:04. That could have killed a run in `/home/user/PROJECT-FIZZ`. It's not a code issue, but anything there that failed around that time should be rerun.
- Plan-day templates still drop cardio and timed rows without saying so. This was already the case, the developer flagged it, and it's out of scope here.

## Fixes (22 Oct 2026)

Each issue from the review round was checked in the code first. The service-level ones were reproduced by new real-SQLite tests that fail on the reviewed service (10 failures) and pass after the fix.

Commits: `316f9cf`, `49a70ff`, `9bec090`, `fe3c4e4`, plus this doc.

### Blocking and High

| Issue | Confirmed | Fix |
|---|---|---|
| **B1 / High: Time length saved as the plan day's length** | Yes. `planWriteFor` wrote `setup.minutes`, and nothing recorded the length before Time when there was no cut. | The set-up stores `timeFrom`, the length before the first Time change. `setTime` writes it and drops it once Time is back at that length with nothing cut. `planWriteFor` saves `timeFrom` (or a legacy `timeFit.fromMinutes`, else `minutes`), so Start's `Update … in your plan` and Coach review's `Update plan day` never save Time's length. Every Time step also fits from that length. Tests: `planDay.minutes` is asserted in the plan-day test (cut case), plus a no-cut case (Time raised, then lowered without a cut) and the Coach review path (`your-workout-time-fixes`). |
| **B2: back to Set up dropped the fit and kept its rests** | Yes. `changeSetup` rebuilt the set-up from `storedSetup` (no `timeFit`) and copied the fit's `restLevel`. | `changeSetup` first undoes the fit (`untimed`, base rest level). If Length is left as Set up showed it (Time's), the change merges into the original at the set-up's length and Time fits it again (`retimed`): the note, Undo and more time keep working. A new Length in Set up is Ben's set-up length and ends Time. The rest level always comes from the merged or fitted workout, never a stale stored one. On a new Day or Main lift (a rebuild), the set-up's length stays recorded for the plan. Tests: Supersets turned on after a fit; a new Length after a fit. |
| **B3 / High: a do-again main lift was trimmed** | Yes. For a session, `sourcePlanOf` always gave `main = null`, so `fit.ts` treated bench as an accessory. | A past workout gets its main by the WL9 rule at read (`defaultMain` over the slots that open, with compound read from the exercise's mechanic, as `saveFrom` does). A library workout with no stored `Main` uses `mainFlags` (Ben's flags, else WL9). Test: do-again with bench 5×100; every Time step leaves bench's rows unchanged and the detail never names it. |

### Medium

| Issue | Confirmed | Fix |
|---|---|---|
| **Gym change after a fit left set cuts restored, rests shortened, no note** | Yes (`changeGym` deleted `timeFit` after `regym`). | `changeGym` undoes the fit, moves the whole original (dropped exercises included) to the new gym, then fits it to Time again. The note, more time and Undo keep working. The toast's Undo still puts the old gym and the fit back. The existing test now asserts this, including more time at the new gym bringing everything back. |
| Coach version / Reload dropped the record | Coach version: yes. Reload: by design. | An applied coach version keeps a rests-only record (base = the coach's version at the original rest level): `shorter rests` shows with Undo, and Undo puts normal rests back on the coach's version. The fit's cuts are not re-applied over the coach's workout because they can't be told apart from the coach's own changes. **Reload** already resets to the source at the set-up's length and rest level (`withoutTimeFit`, which now also clears `timeFrom`). Nothing trimmed remains after a Reload, so there's nothing to restore. Test: coach version over a fit. |
| **Copies of an exercise matched by order on Gym changed** | Yes (`copyKeys` was `id#n`). | The seed the source's slot keys were made with is stored (`slotSeed`, set at open and Reload, kept through a Set up merge). `changeGym` re-plans the source with that seed and matches each slot to its own planned slot by key and exercise. A reordered or deleted copy keeps its own sets. Drafts opened before this fix have no seed and keep the old order matching; they are today-only and expire in 14 days. Tests: reorder, and delete the first copy (both fail on the old code). |
| **A later edit made a set cut permanent** | Yes (`unfitWorkout` and `timeFitChanges` skipped touched slots). | The fit records `cut` (working sets taken per kept slot). For a slot Ben touched afterwards, the cut sets come back as they were in the original (after his rows, drops last), never past the original count or his own added sets, and a set he removed himself stays removed. The detail keeps listing them. A fit stored without `cut` reads as before. If Time is stepped down again after such an edit, that slot is Ben's (FT5) and is not cut again. Domain tests: the RPE-edit probe, the cap, the legacy record. |

### Low

| Issue | Confirmed | Fix |
|---|---|---|
| Both copies marked main | Yes. | `plannedAsDraftPlan` marks only the first copy of the main lift. Domain test added. |
| `Add anyway` skipped the May hurt confirm | Yes (screen path). | `addAnywayConfirm` (pure, in `builder-view`) gives the same `swapPainConfirm` words (`Cable fly may hurt` · `Choose another` / `Add anyway`), and the screen asks before adding. The service's `add_exercise` doesn't refuse flagged exercises: like every other add or swap path, the confirm is Ben's choice in the UI, and loads stay held by the pain rules. Tests: the helper, real facts, and the screen source. |
| Time detail `key={l}` collides | Yes. | Lines are keyed by place (`${i}:${l}`). Source test. |
| Today's fit ladder changed | Yes (`band()` gave 0 for any no-group slot, for every caller). | Now opt-in: `noGroupFirst`, passed only by Your workout's Time. Today's card reads a no-group exercise as before this batch. Domain test compares both. |
| Reps + time/distance set opened as reps only | Yes. | Such an exercise is left out and named (`N left out`), as before this batch. Domain test. |
| A loaded timed set kept the old gym's load (plausible) | Yes (`reloadSlotLoads` returned timed slots unchanged). | Its loads are fitted at the new gym: rounded down, never past the item's max, held on pain, in the item's unit, or dropped when nothing there can make them (rule 4). Times and distances are kept. Domain test covers kg, an lb rack, and no item. |

### Spec

- **SP1. Only item 1 (Time) is Ben's own request in this run.**
  - In `workout-builder-v3.md`, items 2–6 (cardio, timed sets and twice; How to / History; the May hurt confirm; `Open <name>`) are now marked "relayed by the PM as Ben's decision, pending Ben's confirmation".
  - Saved rep ranges (`3–6`) are back to "[Proposal …; pending Ben]".
  - The code for items 2–6 is still built. **Ben needs to confirm before merge**, or those commits should be reverted.
  - `fit-to-time.md` notes the fixes and that no-group-first applies to Your workout only.

### Behaviour change to note

- The detail's `Undo` now goes back to the length before the first Time change. Before, it went back to the length just before the first cut.

### Still open (not in this round's list)

- S1: a draft from Today's `Edit` only restores Your workout's own cuts.
- S2: a workout already over its length jumps back to the long original at the original length.
- N1: distance-only cardio counts 45 s.
- N3: a dropped exercise re-added by hand comes back twice; drops past 10 exercises are skipped silently.
- N6: one Undo record per draft.
- N7: Today's and Your workout's wording differ.
- SP2–SP6: the meaning of the single length field; the old FT3/FT8 rules in `fit-to-time.md`; the superset wording; whether Today's card moves to the 22 Oct revision; what "the original" means for a Today-fitted draft.
- Pre-existing, seen while fixing: a Set up merge drops `sourceVersion`, `leftOut` and `gymKept` from the stored set-up (only `slotSeed` is now carried).
- Nothing here has run on a device: the Time row, the detail sheet, the pop-up links and both confirms are covered only by service, view and source tests.
