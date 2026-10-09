# Review: FitNotes import (build step 3)

**Verdict: CHANGES NEEDED.** There are three blockers:
- B1: a force-close after the last workout is written wedges the import.
- B2: a FitNotes workout dated today shows an invented time and duration.
- B3: "Assistance" turns weighted pull-ups into assisted ones.

Reviewed: `fc1b3f8..43c5c21` on `claude/fitnotes-import` (8 commits: research, schemas, domain, persistence schema 3, service, screens, ADR 0016, the DX4 pause).

Specs read:
- CLAUDE.md.
- The brief's "Validation before claiming it is better" scenarios (especially 6), the §10 additional scenarios and §12.
- `docs/design/data-import-export.md`: §0 DX4–DX7 and DX10, §2.5, §3.4, §4.3, §6, and checks 16–27.
- `docs/research/fitnotes-export-format.md`.
- ADR 0016.

## What I ran

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, tests, catalogue validate, guide check) | Clean. 86 test files and 1,097 tests pass. The catalogue has 1 warning (landmine press, which predates this branch). Guides: 10/10 |
| Temporary probes on real SQLite (`apps/mobile/test/zz-reviewer-tmp.test.ts`, deleted after the run, not committed) | Confirmed B1, B2, B3, S1, N1 and N2. The results are under each finding |
| Grep of the diff for `console.*`, secrets and tokens | None found |

## What is solid

- **Parsing never guesses.**
  - The 7 exact headers are checked case-sensitively. The delimiter only counts when the header then matches.
  - File kinds are told apart by content: SQLite, zip, NUL bytes, Body Tracker.
  - The CSV reader is strict RFC 4180 and keeps both the record number and the line number.
  - Units are read per row. Decimal commas, fractional reps and future dates are unreadable and keep their raw text.
- **Nothing is converted or snapped.** kg and lb stay as written, and imported loads are completed sets taken as written (rules 2 and 4). Load-convention questions have no default (DX6), and "Both dumbbells together" halves the value with integer scaling.
- **Duplicate import (brief scenario 6, check 21).** Three cases are covered:
  - The same file under any name is caught by SHA-256 and imports nothing.
  - A newer export skips every date an earlier import (still in effect) brought in, so sets corrected in the app are never overwritten.
  - A concurrent double commit with the same operation ID wrote 3 sessions, not 6 (probe).
- **Writes are idempotent and versioned (rule 5).**
  - The job ID is the draft ID. Session, exercise and set IDs are derived from it, and each workout's start operation is unique per owner.
  - Each answer bumps `mappingVersion`.
  - At commit, the exercise list, aliases, app dates and imported dates are re-read. If any changed, the commit is refused and the preview rebuilt (tested with a workout logged after the preview).
- **Undo deletes nothing (DX7).**
  - The session status becomes `reverted` and both version and revision are bumped, so a stale copy can't be saved over it.
  - Every history, Progress and target query filters on `status = 'finished'`, so reverted workouts are hidden everywhere.
  - Undo is idempotent per operation and refused with a stale version.
- **Storage.**
  - `import_rows` is append-only through triggers.
  - A CHECK keeps `gym_id` required for workouts logged in the app.
  - Schema 3 rebuilds `sessions` with every index and the no-delete trigger restored, and is tested from schema 2 with foreign keys enforced.
  - The integrity check and backups cover the new tables.
- **Imported text is treated as data (rule 8).** It is stored and shown as text, and the results CSV defuses cells that start with `=+-@`. The coach and voice can't reach any of this (DX10).
- **DX4.** Commit, resume and undo are blocked while a workout is unfinished, and a workout started mid-import pauses the import before the next write (tested).

## Blocking

### B1. A force-close (or a failed `finishJob`) after the last workout is written leaves the import stuck in `committing` for good. It is shown as "Finished", there's no Continue, and every later import is refused

- **Where:**
  - `apps/mobile/src/import/import-service.ts:260-264`: `stateOf` reports `finished` when `written >= counts.workouts`, even though `status` is still `committing`.
  - `import-service.ts:301-306`: the `finishJob` result is ignored and `status: 'finished'` is returned whatever it says.
  - `apps/mobile/src/import/views.ts:98` and `:555`: `Continue import` appears only for the `paused` state.
  - `apps/mobile/src/screens/data/DataBackupScreen.tsx:55`.
- **Failure path (probe R1):**
  1. The commit writes workout 2 of 2, then the app is killed before `finishJob` (or `finishJob` throws).
  2. On relaunch, `paused()` returns `{state: 'finished', job.status: 'committing'}`. Past imports shows "Finished". Intro shows `Choose CSV file`, not `Continue import`.
  3. Ben picks another export and answers the questions. `commit` returns `another_import`, and the run screen shows "Another import isn't finished yet (f.csv). Continue or undo it first."
  4. "See this import" opens results with "Import finished", `Done` and no Continue.
- **Effect:** The only way out is `Undo this import`, which hides history that was imported correctly. The `after_import` backup never runs. The window is one transaction wide, but iOS kills apps that are swiped away or backgrounded, and nothing reconciles the job on launch.
- **Fix:**
  - Treat any `committing` job that isn't running in this process as resumable. Offer Continue (it will just call `finishJob`), or finish it automatically in `paused()`/`list()` when every planned date is written.
  - Return an error from `writeWorkouts` when `finishJob` returns `ok: false`.
  - Add a test that kills the run between the last `commitWorkout` and `finishJob`.

### B2. A FitNotes workout dated today shows an invented time and duration on Today and Summary (rule 6)

- **Where:**
  - `packages/domain/src/import/session.ts:126-127`: the anchor is `startedAt` 12:00 local and `endedAt: null`.
  - `packages/domain/src/session/today.ts:114-117`: `done_today` with `getActiveDurationMs`.
  - `packages/domain/src/session/view.ts:77-83`: when `endedAt` is null, the duration runs to *now*.
  - `apps/mobile/src/screens/workout/SummaryScreen.tsx:80` and `:219`.
- **Failure path (probe R5, clock 18:00 BST):** Ben trains with FitNotes in the morning, exports and imports the same day.
  - Today shows `Workout done · 6 h 00 min`. Tapping it opens Summary with `12:00–` and `Active time 6 h 00 min`.
  - Before noon the duration reads `0 min` and the start time is in the future.
- **Why it matters:** ADR 0016 says the anchor "is never shown". It is shown, and so is a duration computed from it. Neither exists in the file.
- **Fix:**
  - When `session.localDate` is set, treat the workout as date-only everywhere. There is no duration (`activeMs: null` → `Workout done`) and no time range, and Summary shows the date only.
  - Alternatively, keep date-only workouts out of `done_today` and Summary.
  - Add a test with an import that contains today's date.

### B3. "Assistance from a machine" turns weighted (positive) bodyweight sets into assistance

- **Where:**
  - `packages/domain/src/import/plan.ts:404-409`: `Math.abs(value)` is applied to every row once the answer is `assistance`.
  - `apps/mobile/src/import/views.ts:477-489`: the option says only "A negative value is read as that much assistance".
- **Failure path (probe R4):**
  1. The file has `Pull-up,-20,8` (assisted) and `Pull-up,10,5` (weighted). This is the usual FitNotes habit, and the research names negative weights as the assisted case.
  2. The question shows `Values in your file: -20 to 10, some negative`, and Ben picks Assistance.
  3. Both rows import as assistance: 20 kg and **10 kg**. The weighted set is now recorded as an assisted one, a 20 kg error in the authoritative record that is never flagged.
  4. Picking "Added" instead loses every assisted set as unreadable.
- **Why it matters:** this is a silent load-convention error on completed history. No answer imports a mixed file correctly.
- **Fix:**
  - When the range spans zero, offer "Negative = assistance, positive = added" (or apply that split automatically and say so).
  - Otherwise, under `assistance`, mark positive values unreadable instead of flipping their meaning.
  - Add a test for a mixed-sign file.

## Should fix

### S1. EZ-bar and trap-bar exercises are in the "Barbell" group, and "Plates only" adds the 20 kg / 45 lb Olympic bar to them

- **Where:**
  - `packages/domain/src/import/plan.ts:312` and `:392-397`.
  - `apps/mobile/src/import/views.ts:459-475`.
  - The catalogue has `defaultLoadConvention: total` for `ez-bar-curl`, `ez-bar-skull-crusher` and `trap-bar-deadlift`.
- **Failure path (probe R4):** with "Plates only", `EZ-bar skull crusher 20 × 10` imports as **40 kg** total. The override can only switch between `total` and `plates_only`, so no answer gives the right total for an EZ bar or trap bar logged as plates only.
- **Fix:** ask for a bar weight per bar kind (barbell, EZ bar, trap bar), using the matched exercise's `compatibleEquipment`. Alternatively, ask per exercise for any non-barbell `total` exercise. Add a test. (This is also a spec gap; see SP4.)

### S2. Check 24 is only half met: after commit, no screen shows an imported set's source file, row number and original values

- **Where:**
  - `apps/mobile/src/import/views.ts:571` (`provenanceLines`) and `import-service.ts:599` (`provenance`) are never called by any screen.
  - `ImportResultsScreen.tsx:122-146` lists skipped rows only.
  - The preview's per-row original (`ImportRowsScreen`) disappears with the draft at commit.
- **Failure path:** Ben imports, then wonders why a set reads 11.25 kg each. Nowhere in the app shows `FitNotes row 4,180: … 22.5 …`.
- **Fix:** list imported rows (original → mapped) on the results screen, which the job already stores. Alternatively, get the PM to defer the UI half of check 24 explicitly, and add it to ADR 0016's differences.

## Nits

- **N1.** Re-opening the same file while its import is paused says `You imported this file on … (2 workouts). Nothing new to import.` when 0 of 2 are in (probe R2; `import-service.ts:349-350`, `views.ts:123-128`). The intro usually offers Continue first, so this mostly shows after B1. It should say "paused at x of y" and offer Continue.
- **N2.** A double tap on `Import` runs two write loops (probe R3). No data is duplicated, but the first loop's `finally` clears `running` while the second is still writing, so Undo is enabled mid-write (`import-service.ts:268-308`). Fix: keep one in-flight promise per job.
- **N3.** Date-only workouts still take their displayed date from `startedAt` in the viewer's current zone, and nothing reads `localDate` for display. In a zone 12 or more hours from the import zone, the date moves by a day: London noon is 00:00 the next day in Auckland. This should be folded into the B2 fix.
- **N4.** An Android cardio row exported as `0.0,0` with a distance would be listed as "timed, distance or weight-only" instead of cardio (`fitnotes.ts:313-316`). A row with weight and `0` reps imports as a completed 0-rep set. Check both against Ben's real file.
- **N5.** `revertJob` changes session status with a raw `UPDATE` (`packages/persistence/src/imports.ts:257-260`). The job document records the undo, but nothing is written per session in any audit table.
- **N6.** `IMPORTED_REST` uses `source: 'global_default', seconds: 0` (`session.ts:23`). The label is honest, but the enum claims a global-default rest of 0 s. A `not_recorded` source would be safer before any rest analytics read it.
- **N7.** Truncation is silent in two places (`plan.ts:549-550`, `match.ts:41`):
  - `nameKey` truncates to 200 characters, so two long names can collide.
  - Rows with more than 64 cells, or cells over 20 kB, are truncated with no note.
- **N8.** Swiping back from the preview (only the header button is replaced, the gesture isn't disabled) leaves the parsed draft in memory until relaunch.
- **N9.** The commit-time staleness stamp leaves out the gym list and `preferredUnit` (`import-service.ts:233-238`). It's harmless today: the gym is checked when answered, and the unit only labels weightless rows.
- **N10.** Every answer re-runs `analyseImport` synchronously, which takes about 94 ms on V8 for 10,000 rows. Hermes may take several times longer. The SHA-256 of the whole text runs in pure JS too. Both belong in check 27's device timing.

## Tests

Good coverage of:
- parsing edge cases;
- every header;
- no pre-selection;
- the dumbbell and lb maths;
- same file and newer export;
- stale preview;
- Stop, force-close and Continue at a mid-point;
- Undo (both persistence and service);
- the DX4 pause;
- provenance storage;
- instruction-like text;
- migration from schema 2;
- a backup round trip.

Missing:
- A force-close between the last `commitWorkout` and `finishJob` (B1).
- An import containing today's date, checked on Today and Summary (B2).
- A mixed-sign bodyweight file under each answer (B3).
- EZ-bar or trap-bar exercises under "Plates only" (S1).
- Undo of a paused import through the service, and the results screen's `canUndo` for it.
- A double commit with the same operation ID (no duplicates; `running` stays set).

## Conditions before calling this done (known, not code defects)

- Check 16: re-run detection against Ben's real export and add its first line as a fixture. ADR 0016 already says this.
- Check 27: preview within 5 s for 10,000 rows on the iPhone, and per-answer latency (N10).
- Device checks listed in ADR 0016:
  - migration 3 under expo-sqlite on a phone with real workouts, after a copy saved to Files;
  - the CSV picker from iCloud Drive, On My iPhone and FitNotes 2 email;
  - Stop, force-close and Continue;
  - Undo.

## Spec issues

- **SP1. Check 16 names the pre-2023 Android header only.** Research S1 found three layout families. The developer accepts 7 exact headers. The designer should update check 16 and the detection copy (research S1/S2).
- **SP2. Timed and distance strength sets are undecided (research S3).**
  - Planks and carries are skipped as "timed, distance or weight-only sets", but §2.5 step 3a shows `Plank (timed)` being matched.
  - The spec needs a decision, including what to do with the ambiguous two-part Android `Time`.
- **SP3. P-I3 is still open.**
  - Imported sets have no equipment instance, so under the current rule they never feed "Last" values or targets for equipment exercises (option (a) by default). For a migration from FitNotes, that removes most of the point of importing.
  - The gym question's copy (§2.5 step 3c) depends on the decision.
  - The Domain owner and PM need to decide; the designer recommends (b).
- **SP4. One bar weight can't cover several bar types.** §2.5 step 3b's barbell question has one `Bar weight` for the whole group, so it can't represent EZ bars or trap bars (S1). It should ask per bar kind.
- **SP5. The bodyweight question needs a mixed-sign answer.** It offers only "added" or "assistance" per exercise, but FitNotes users commonly log assisted sets as negative and weighted sets as positive under one exercise (B3). Add a third answer for that case.
- **SP6. Date-only workouts need app-wide rules.** The spec says FitNotes workouts "show the date only" but doesn't say what Today, Summary, durations or week totals do with a workout that has no time (B2, N3). system-states or workout-summary should cover date-only workouts. Research S5 also asks to state that FitNotes keeps one workout per date.
- **SP7. ADR 0016's differences need PM acceptance.** The ADR is still "Proposed". The differences are:
  - the extra `skipped_unsupported` category;
  - Undo also blocked by an unfinished workout;
  - `Share first line` instead of `Copy first line`;
  - no row-count progress while reading;
  - the results CSV saved through the folder picker;
  - provenance not shown after commit (S2).
- **SP8. One brief change is still waiting for Ben.** Research proposes changing brief v0.2's "RPE is not expected as a column" (FitNotes 2 has recorded RPE, RIR and warm-ups since v5, and v14 mentions them in CSV import/export). Research S6 (mark imported set type "not recorded") is also undecided. Imported warm-ups currently arrive as working sets, which the preview says.
