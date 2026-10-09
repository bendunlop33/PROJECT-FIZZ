# 0015: FitNotes import (parser, preview, commit, Undo import)

**Status:** Proposed, 2026-10-09 (developer; for review). Built and tested on Linux only. **Not yet run on an iPhone, and not yet run against Ben's real export** (spec check 16 says to re-run detection on his file before calling this done).

## Context
Build step 3 adds FitNotes import (data-import-export.md §2.5, §3.4, §4.3, checks 16–27; brief §6–§7, scenario 6). The research (`docs/research/fitnotes-export-format.md`, fact-checked 2026-10-09) found three header families (Android ≤ v1.23, Android v24+, FitNotes 2), no time of day in any of them, per-row units in two of them, and an ambiguous Android `Time` format. Only Ben's real file can settle which one he has.

## Decision

### Where the code lives
- **Pure (`packages/domain/src/import/`):** CSV reader, header detection and row parsing (`fitnotes.ts`), name matching (`match.ts`), effort ratings in comments (`effort.ts`), the preview/answers/plan (`plan.ts`, `answers.ts`), the imported workout builder (`session.ts`) and the results CSV. Synthetic fixtures only (`test/fixtures/fitnotes/*.synthetic.csv`).
- **Storage (`packages/persistence`):** schema 3 and `SqliteImports`.
- **Orchestration (`apps/mobile/src/import/import-service.ts`)** and pure view-models (`views.ts`). Screens only render view-models and call the service.

### Formats and rows
- Exactly seven headers are recognised: A1-kg, A1-lb, A2-kg, A2-lb, B1, B2 and C (research §2). Cells are trimmed; matching is case-sensitive. Comma, semicolon and tab are tried and accepted only when the header then matches. Anything else stops with the first line shown (DX5). The unverified two-column Android header (Kinoku) is not accepted.
- A file is classified by content, never its name: SQLite magic → "FitNotes backup, not CSV"; zip or binary → "not a CSV"; `Date` without `Exercise` → Body Tracker message.
- Units are per row and never converted (A: header; B: `kgs`/`lbs`/`kg`/`lb`, any case; C: whichever column is filled). C rows with both columns filled are asked once per file. A decimal comma, a non-whole rep count, a bad or future date, or a wrong number of cells makes the row unreadable with its raw text kept; nothing is guessed.
- **Row classes:** weight and/or reps → imported. A distance with no weight or reps → cardio (skipped, P-I4). **Time only (a plank or a bike session; the columns can't tell them apart), time or distance with weight or reps, and weight with no reps → "timed, distance or weight-only sets", skipped and listed** until spec change S3 is decided. Because time is never imported, the ambiguous two-part Android `Time` is never read.
- A date after today is a planned workout in FitNotes, not one done, so it is listed as unreadable.

### Mapping (nothing pre-selected, nothing invented)
- Names: `Matched` (equal to an exercise's name or catalogue name, or Ben's earlier answer), `Check` (a word-based suggestion), `No match`. Candidates are the app's exercises plus the bundled catalogue (reps-measured only). Answers are remembered as `ExerciseAlias` rows at commit.
- Conventions: dumbbells (each / both) and barbell (total / plates only) are group questions with per-exercise overrides; a bodyweight exercise with any non-zero weight gets its own question with the value range. Stack, plates-added and assisted-machine exercises follow the exercise.
- **Bar weights (review S1):** the bar comes from the matched exercise's equipment (`barbell`, `ez_bar`, `trap_bar`). The Olympic bar keeps the spec's editable 20 kg / 45 lb default; EZ and trap bars have **no default** (they vary), so their plates-only rows wait (the question stays open) until Ben enters that bar's weight. `total` exercises with no bar (kettlebell, medicine ball, sandbag) aren't in the barbell question: imported as written and listed under "Kept as written". An exercise with no single bar recorded can't have a bar added: its plates-only rows are unreadable.
- **Bodyweight answers (review B3):** `Weight added` / `Assistance` / and, only when the exercise's values span zero, `Negative = assistance, positive = added`. Under `Assistance`, a positive value in a file that also has negative values for that exercise is unreadable, never flipped into assistance; a one-way file (all positive machine numbers, or all negative) is read as assistance. Same-day assisted and weighted sets become two exercise entries (one convention each).
- **Negative weights (provisional, Ben to confirm):** read as that much assistance only where the convention is assistance (Ben's bodyweight answer, or an assisted-machine exercise). Anywhere else the row is unreadable.
- Loads are imported as written: never snapped to equipment (rule 2), never converted.
- RPE is set only on rows Ben ticked after choosing `Review and import as RPE`.

### Imported workouts
- One workout per date (FitNotes keeps one per calendar date), `finished`, `source: 'import'`, linked to its job, **date-only** (`localDate`). `startedAt` is only an ordering anchor at 12:00 local on that date in the phone's zone at import; there is no end time, and timing edits are refused for these workouts.
- **Date-only everywhere it shows (review B2, N3):** `dateOnlyOf(session)` / `workoutDurationMs` (null for date-only). Today matches it by its own date (not the anchor in the phone's current zone) and says `Workout done` with no duration; Summary shows `<date> · date only` with no time range, no Active time and no `Edit times`. Past workouts already show the date only.
- No equipment instance is attached (the file doesn't say which machine or bar). Under the existing comparable-history rule, imported sets therefore don't feed "Last" values or targets for exercises logged on equipment. **P-I3 stays open**; this is option (a) by default, not a decision.
- Every set is a working set (FitNotes has no warm-up flag; research S6). Unilateral sets are `both` (the logger's default). The rest snapshot is `0 s`, source `not_recorded` (`Not recorded (imported)`; a set-only rest source that never reaches a rest timer, review N6). Each set gets one `logged` audit entry stamped with the commit time.
- Comments are kept with each row as the original (provenance). There is no set-notes field yet, so "kept as notes" means kept and shown as the original comment.

### Storage (schema 3)
- `import_jobs` (document; status `committing` / `committed` / `reverted`; one `committing` per owner), `import_rows` (every source row with raw cells, result, detail and the set it became; triggers forbid UPDATE and DELETE), `exercise_aliases` (owner-scoped: Ben's naming is Your data, rule 10).
- **`sessions` is rebuilt** because SQLite can't change a CHECK or NOT NULL in place: `status` gains `reverted`; `gym_id` may be NULL for imported workouts only (Gym: Not recorded); `import_job_id` and `local_date` are added. The rebuild copies, drops and re-creates the table inside the migration's transaction with foreign keys deferred; re-inserting the rows under the same name resolves the children's references before commit. Tested from schema 2 with data and with foreign keys enforced (node:sqlite), and through the existing schema-1 backup restore.
- Integrity checks validate import jobs, aliases and every import row. Backups carry everything (they copy every table). Restore analysis ignores reverted workouts like discarded ones and counts import jobs and aliases as Your data.

### Commit, resume and undo
- The preview lives in memory; nothing is saved until commit. Every answer bumps `mappingVersion`; a stale answer or commit is refused. At commit the data the preview was checked against (exercise list, remembered names, dates in the app, earlier imports) is re-read; if it changed, the preview is rebuilt and Ben confirms again (rule 5).
- Refused while a workout is unfinished (DX4) and while another import is unfinished. Backs up on this phone first (reason `before_import`; a failure stops the import) and after (`after_import`). The commit-time staleness check also covers the profile's unit, the gym list and each exercise's equipment (review N9).
- One transaction writes the job, every source row, new custom exercises (`Add new`, deterministic ID per owner and name), catalogue exercises the rows use that aren't stored yet (same catalogue IDs), and the remembered names. Then one transaction per workout, oldest first, each idempotent by its start operation (`<operationId>:<date>`) with deterministic session, exercise and set IDs. `Stop` and a force-close leave whole workouts only; `Continue import` (or the same commit retried) finishes with exactly the planned workouts.
- **Unfinished means `committing`, whatever the count (review B1).** Only `committed` is shown as finished. A `committing` import not being written by this app run is `paused` and offers `Continue import`, including one whose workouts are all in (closed or failed right before it was marked finished: `Import not finished. All 412 workouts are in your history; Continue import finishes it.`). The next read of past imports, the paused import or the same file finishes such an import (with its `after_import` backup); a failure leaves it paused. A failed final step is reported (`finish_failed`), never shown as finished.
- **One write loop per import (review N2):** a second `Import` tap joins the commit in flight; `Continue import` while it runs joins the same loop; Undo is refused (`busy`) until it ends.
- Same file (SHA-256 of the text, any name) with an import still in effect → "Nothing new to import"; if that import is unfinished, it says where it stopped and points to it instead (review N1). Dates that came in with an import still in effect (committing or committed) are always skipped, so a newer export never overwrites a set corrected in the app. Dates with a workout logged in the app are skipped by default (question).
- `Undo this import`: versioned and idempotent per operation; the job's workouts become `reverted` (version and storage revision bump, so a stale copy can't be saved over them) and nothing is deleted (DX7). Refused while the import is being written and while a workout is unfinished. Remembered names and custom exercises are kept. The file can then be imported again.

## Differences from the spec (for the designer / PM)
1. **Extra skip category** `timed, distance or weight-only sets` and results code `skipped_unsupported` (research S3). Time-only rows aren't called cardio.
2. **`Undo this import` is also blocked by an unfinished workout** (DX4's reasoning applies: it reshapes the history the workout reads). The spec only says this for restore and import.
3. **`Copy first line` is `Share first line`** (the iOS share sheet has Copy), plus selectable text. The app has no clipboard module; adding one is a native dependency and a new build.
4. **No row-count progress while reading** (`Reading file… 2,000 of 4,212 rows`): parsing is synchronous and fast on Linux (below); the button reads `Reading file…`.
5. **Row-by-row results CSV is saved through the folder picker** (like `Save a copy to Files`, ADR 0009) and read back before it says saved, instead of the share sheet.
6. **"Kept as notes"** is the original comment kept with each row (no set-notes field exists).
7. **Provenance** (`Imported from FitNotes on … · row …` / `Original: …`) is shown after the import on the results screen: `Imported workouts (n)` lists each date, and each opens its sets with the file, row and original values (check 24; review S2). It's also available as `imports.provenance(setId)`. There is no history set-detail screen yet; when one exists it should show the same two lines.
8. Not built: the onboarding Ready screen's `Import FitNotes history` link, export, delete.
9. Copy says GymSmarter, not Fizz.
10. **Bodyweight question has a third answer** for mixed-sign values (`Negative = assistance, positive = added`), shown only when values span zero (review B3; spec issue SP5). Copy to confirm with the designer.
11. **Bar weight per bar kind** (Olympic / EZ / trap; EZ and trap have no default), and no-bar `total` exercises (kettlebell) aren't asked (review S1; spec issue SP4). The spec has one `Bar weight` for the group.
12. **Date-only rules on Today and Summary** as above (review B2; spec issue SP6: the spec only says FitNotes workouts "show the date only").
13. Extra copy: `Import not finished. All n workouts are in your history; Continue import finishes it.`; the same file while its import is unfinished: `You started importing this file on Thu 8 Oct. Import paused at x of y workouts. … Continue that import instead.`; a failed final step: `n workouts are in, but the import couldn't be marked finished: <reason>. Try again to finish it.`
14. The preview can't be swiped away (its back is `Cancel`, which confirms); leaving it any way drops the draft (review N8).

## Consequences
- Measured on Linux (V8) for a synthetic 10,000-row file: parse 74 ms, preview 137 ms, re-preview after an answer ~94 ms, freezing the rows ~250 ms. Hermes will be several times slower; check 27 (summary within 5 s on the iPhone) still needs measuring on the phone.
- **Device checks needed:** migration 3 under expo-sqlite (the sessions rebuild) on a phone with real workouts, after a backup to Files; the CSV document picker (`text/csv`, `text/plain`) from iCloud Drive, On My iPhone and a file saved from FitNotes 2's email export; Stop / force-close / Continue; Undo; 10,000-row timings.
- No new dependency and no new native code; the next cloud build only needs the JS.
- **Still open after review fixes:** the week count on Today still uses the anchor (a date-only workout in a zone 12+ hours from the import zone can fall in the neighbouring week); a weight with `0` reps imports as a 0-rep set and an Android `0.0,0` cardio row with a distance lists as "timed, distance or weight-only" (N4, check on Ben's file); Undo changes session status without a per-session audit entry (the job records the undo; N5); per-answer re-analysis and the SHA-256 run on the JS thread and need timing on the phone (N10, check 27).
- **Open for Ben:** which app and version; kg or lb; whether dumbbell weights are per dumbbell; whether barbell weights include the bar and its weight; how assisted pull-ups were logged (negative weights?); whether warm-ups were logged (they'd arrive as working sets); whether comments hold effort ratings; where the workouts were; and the domain decision P-I3.
