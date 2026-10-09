# Review round 2: FitNotes import (build step 3)

**Verdict: CHANGES NEEDED.** All three round-1 blockers and both should-fixes are fixed and tested. One new blocker remains:

- **B1.** Repeating an imported FitNotes workout plans loads that no equipment has checked. In an exercise with no equipment, imported history also counts as "Last" and in the comparison. This breaks rule 4 and the brief's home-dumbbell scenario, and it settles P-I3 in code without anyone deciding it.

Reviewed: `fc1b3f8..35c6946` on `claude/fitnotes-import`, the whole branch. Round 1 covered up to `43c5c21`; this round re-checks the 5 fix commits and how imports interact with existing features.

Specs read:
- CLAUDE.md.
- The brief's "Validation before claiming it is better" (scenario 6), §10 additional scenarios and §12.
- `docs/design/data-import-export.md`: §0, §2.5, §3.4, §4.3, §6 and checks 16–27.
- `docs/research/fitnotes-export-format.md`.
- ADR 0016.
- Round 1: `docs/reviews/fitnotes-import.md`.

## What I ran

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, tests, catalogue validate, guide check) | Clean. 86 test files and 1,113 tests pass. The catalogue has 1 warning (landmine press, which predates this branch). Guides: 10/10 |
| Temporary probes on real SQLite (`apps/mobile/test/zz-reviewer-r2-*.test.ts`, deleted, not committed) | Confirmed B1 and N1. Re-checked round-1 B1 with a different kill point (below) |
| Grep of the fix diff for `console.*`, secrets and tokens | None found |

## Round-1 findings: status

| # | Status | Evidence |
|---|---|---|
| B1 stuck `committing` import | **Fixed** | `import-service.ts:287-291`: only `committed` is finished. `:304-313`: `settle()` finishes an import whose workouts are all in, from `paused()`, `list()`, `job()`, `open()` and the commit pre-check. `:362-380`: `finish_failed` is reported, never shown as finished. Tests at `fitnotes-import.test.ts:401-458`. A probe with a different kill point (the last `commitWorkout` committed, then the process died) also recovers. On relaunch the same file reads "Nothing new to import", the job is `committed` and the after-import backup runs |
| B2 invented time and duration | **Fixed** | `view.ts:91-101` (`dateOnlyOf`, `workoutDurationMs`), `today.ts:115-119`, `summary.ts:258`, `SummaryScreen.tsx:118/220/283` and `TodayScreen.tsx:252`. Tests: `summary-today.test.ts`, plus the service test with today's date. `EditSet` (`Done at hh:mm`) can't be reached for a finished workout, so it doesn't leak the anchor |
| B3 mixed-sign bodyweight | **Fixed** | `plan.ts:478-497`: there is a third answer, `split`. Under `assistance`, positive values in a mixed file are unreadable and never flipped. Each answer is tested; same-day sets become two entries |
| S1 EZ-bar and trap-bar get the Olympic bar | **Fixed** | `plan.ts:87` (`barOf`), `:371-389` and `:466-476`. EZ and trap bars have no default, so their rows wait for a weight. A kettlebell isn't asked about. With more than one bar or none, plates-only rows are unreadable. Tested |
| S2 provenance after commit (check 24) | **Fixed** | `ImportResultsScreen.tsx:125-148` → `ImportedWorkoutScreen.tsx`, with file, row and original values. Tested (`fitnotes-import-views.test.ts:229`) |
| N1, N2, N3, N6, N7, N8, N9 | Fixed | N3 is fixed for Today's "done" card. The week count still uses the anchor (open in ADR 0016) |
| N4, N5, N10 | Open, acknowledged in ADR 0016 | Unchanged. Check them against Ben's file and on the device |

## Blocking

### B1. Repeating an imported workout skips the equipment check, and imported history counts as "Last" for exercises with no equipment (rules 4 and 6, P-I3 decided in code)

**Where:**
- `apps/mobile/src/services/workout-services.ts:503` and `:529`: imported workouts are Repeat candidates (`· from FitNotes`). That includes Today's `Repeat last workout` (`TodayScreen.tsx:55`, `:166`), which right after an import is the newest imported workout.
- `packages/domain/src/session/repeat.ts:58`: `pickEquipment(null, …)` returns `null` straight away.
- `repeat.ts:100` and `:113`: with no source equipment, `missingEq` is `null`, so the load target is kept.
- `create.ts:73-74`: `planTemplateLoad` keeps a target as written when `equipment === null`, so nothing snaps it or bounds it by a maximum.
- `active-view.ts:44` (`lastComparableSession`) and `progression.ts:255` (`comparableSessions`): `h.equipmentId !== ex.equipmentId` treats `null === null` as the same set-up. Imported history therefore feeds "Last" and the summary comparison for any exercise with no equipment.
- `summary.ts:198`: `why: "Same set-up at <today's gym>"` is used even when the compared workout's gym was "Not recorded".

**Failure path (probe on real SQLite):**
1. The gym is the `home_dumbbells` preset (dumbbells 2.5–25 kg, no bar, no cable).
2. Ben imports FitNotes rows: `Dumbbell Bench Press 40 × 8` (answered "Each dumbbell"), `Flat Barbell Bench Press 140 × 5` and `Lat Pulldown 90 × 10`.
3. On Today he taps `Repeat last workout`, which is the imported workout. The preview and the started workout plan:
   - `40 kg each × 8`, `140 kg × 5` and `90 kg stack × 10`;
   - `equipmentId: null` on every exercise;
   - no notes and no warnings.

   A workout logged in the app and repeated at this gym gets "Rounded down… this gym stops at 25 kg" and "No Olympic bar here: no load target".
4. In that workout, "Last" for Dumbbell bench press is the FitNotes set (`40 kg each × 8`, 1 Oct). Ben logs 40 kg each, which is accepted because there's no equipment to check against. Summary says `Same set-up at Main Gym, working sets`, comparing against a FitNotes workout whose gym was never recorded.

**Why it blocks:**
- It breaks CLAUDE.md rule 4 ("achievable on the selected gym's real equipment") and the brief's additional scenario ("Home gym has only dumbbells up to 30 kg: no unavailable dumbbell or cable prescriptions").
- It is reachable in one tap from Today on the first day after an import.
- It contradicts ADR 0016, which says imported sets "don't feed 'Last' values or targets" (option (a) of P-I3). In practice, any exercise with no equipment gets option (b) without the designer's `Last (FitNotes, …)` label.
- The "Same set-up at Main Gym" wording invents a fact (rule 6).
- The built-in rule reads the same comparable set (`progression.ts:255`) with no equipment to snap to. I didn't probe a progression step-up.

**Fix (pick one and record it in ADR 0016):**
- (a) Until P-I3 is decided, leave `source: 'import'` workouts out of Repeat candidates and `Repeat last workout`. Also skip imported history in `lastComparableSession` and `comparableSessions`, for example with an `imported` flag on `HistorySession`, rather than relying on `equipmentId === null`.
- (b) In `startWorkoutFromSession`, when the source exercise has no equipment, choose the first available equipment at this gym that suits the exercise (`compatibleEquipment`). Run the target through `planTemplateLoad` with it: round toward easier and never go above the maximum. When the gym has none, drop the load and keep a note.

Either way:
- Make the summary's `why` name the compared workout's gym, or say `Gym not recorded`, instead of today's gym.
- Add tests: Repeat of an imported workout at the `home_dumbbells` gym never plans 40 kg each, 140 kg or 90 kg. An exercise with no equipment doesn't show a FitNotes "Last" unless P-I3 (b) is chosen and labelled.

## Should fix

### S1. Clearing the Olympic bar weight field shows a blank field and no warning, while 20 kg / 45 lb is still added (a regression from round 1)

- **Where:** `apps/mobile/src/screens/import/ImportQuestionScreen.tsx:191`. `invalid` is now `text.trim() !== '' && …`, and the barbell's `missing` is always `null` because a default exists. Before this change, a blank field showed `Enter a bar weight above 0.`
- **Failure path:**
  1. Ben answers "Plates only" and deletes the `20` to type his bar's weight.
  2. He leaves the field without typing, because he isn't sure.
  3. The field stays blank with no message, and every plates-only barbell row still gets 20 kg added.
- **Why it matters:** the screen shows nothing while the load mapping changes. That breaks the "conventions are always explicit" rule.
- **Fix:** keep the warning for a blank field that has a stored value, or put the stored value back on blur (`onEndEditing`) when the text is empty.

## Nits

- **N1.** The same file reopened while its import is unfinished with every workout in reads: `… Import not finished. All 2 workouts are in your history; Continue import finishes it. Continue that import instead.` (probe, `views.ts:126-133`). "Continue" appears twice. Separately, for `state: 'running'` it says "paused".
- **N2.** The Data & backup row subtitle at `DataBackupScreen.tsx:204` builds its own copy: `Import paused at 2 of 2 workouts`, using `String()` rather than `formatCount`. It should use `pausedLine`, so that the "all in, not finished" case reads correctly.
- **N3.** `ImportedWorkoutScreen.tsx` titles each set with the value as frozen at import (`row.imported`). Its docstring says "as it is in the app". If finished sets can be corrected later, show the current set or label the line `Imported as …`.
- **N4.** If `commitWorkout`'s transaction commits but its promise rejects, the screen says `Couldn't save workout 2 … Nothing was half-saved` even though workout 2 is in (probe). The next run recovers correctly. Consider wording that doesn't state the save failed ("may not have saved; Try again checks").
- **N5.** A `split` answer stays after the file is no longer mixed (for example, after the negative rows are skipped by name or date). The question screen then has no option selected, but the preview row still shows the answer. It's harmless because `split` reads by sign. Consider clearing it or always offering it once chosen.
- **N6.** With `split`, same-day assisted and weighted sets become two entries both called `Pull-up`. In Summary or Repeat they look like a duplicate. Add the convention to the label, for example `Pull-up (assisted)`.
- **N7.** Smith machine and other bars without an equipment kind can only use the Olympic 20 kg / 45 lb, or be overridden to "Total". Plates-only Smith logs have no correct answer (see Spec issues).
- **N8.** `job()` decodes every row (about 10,000 zod parses) each time the results screen gets focus or `changed()` fires. Add it to the check 27 device timing (round-1 N10).

## Tests

**Good:** every missing test from round 1 was added:
- force-close or failure between the last workout and `finishJob`;
- today's date on Today and Summary, and the far-zone case;
- a mixed-sign file under each answer;
- EZ, trap and kettlebell under "Plates only";
- Undo of a paused import through the service;
- double commit and Continue while running;
- a unit change after the preview.

**Missing:**
- Repeat of an imported workout at a gym with less equipment (B1).
- "Last" or the comparison for an exercise with no equipment against imported history (B1).
- A blank bar-weight field (S1). This is UI and could be a view-model check.

## Conditions before calling this done (unchanged, not code defects)

- Check 16: re-run detection against Ben's real export.
- Check 27: preview within 5 s for 10,000 rows on the iPhone, plus per-answer latency (round-1 N10 and N8 above).
- Device checks in ADR 0016:
  - migration 3 under expo-sqlite after a copy is saved to Files;
  - the CSV picker from iCloud Drive, On My iPhone and FitNotes 2 email;
  - Stop, force-close and Continue;
  - Undo.

## Spec issues

- **SP1. P-I3 can't wait any longer** (Domain owner and PM). The code now behaves two ways: (a) for exercises on equipment, and unlabelled (b) for exercises with no equipment and for Repeat (B1). The decision must also say whether imported workouts can be repeated, and how loads from "Gym: Not recorded" are checked at the current gym.
- **SP2. ADR 0016 differences 10–14 need designer or PM acceptance.** They answer round-1 SP4–SP6:
  - the third bodyweight answer and its copy;
  - one bar weight per bar kind, with no EZ or trap default;
  - date-only rules on Today and Summary;
  - the extra unfinished and finish-failed copy;
  - the preview can't be swiped away.

  workout-summary.md and system-states.md should carry the date-only rules (round-1 SP6). The ADR is still "Proposed".
- **SP3. The bar question has no Smith machine** (and no other non-Olympic bar besides EZ and trap). Consider a per-exercise bar weight, or a "Smith machine" equipment kind (N7).
- **Still open from round 1:**
  - SP1: check 16 names one header family.
  - SP2: timed and distance strength sets.
  - SP7: the other ADR differences.
  - SP8: brief v0.2's "RPE is not expected as a column", and research S6 on warm-ups. This needs Ben.
