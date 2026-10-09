# Review round 3: FitNotes import (build step 3)

**Verdict: PASS.** The round-2 blocker (B1: repeating an imported workout skipped the equipment check, and imported history counted as "Last" when there was no equipment) is fixed. P-I3 option (a) is now enforced explicitly everywhere history is read, and it is tested on real SQLite. S1 and N1–N5 from round 2 are fixed. There are no blockers.

Two new should-fixes should land before Ben runs his real import. Both are cheap:
- **S1.** "Both dumbbells together" halves one-dumbbell exercises.
- **S2.** After the older of two imports is undone, the newer file says "Nothing new to import".

The device and real-file conditions below still apply before this step is called done.

Reviewed: `fc1b3f8..c21b787` on `claude/fitnotes-import`. Round 2 covered up to `35c6946`. This round re-checks the 5 fix commits (`49d04d1..c21b787`) and takes a fresh pass over the import's mapping, duplicate detection and undo.

Specs read:
- CLAUDE.md.
- The brief's "Validation before claiming it is better" (scenario 6), the §10 additional scenarios (home gym with dumbbells to 30 kg) and §12.
- `docs/design/data-import-export.md`: §0, §2.5, §3.4, §4.1a, §4.3 and checks 16–27.
- `docs/research/fitnotes-export-format.md`.
- ADR 0015.
- Rounds 1 and 2.

## What I ran

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, tests, catalogue validate, guide check) | Clean. 86 test files and 1,123 tests pass. The catalogue has 1 warning (landmine press, which predates this branch). Guides: 10/10 |
| Temporary probes on real SQLite (`apps/mobile/test/zz-reviewer-r3-probe.test.ts`, deleted, not committed) | Confirmed S1, S2 and N1. Two previews of one file committed one after the other: the second is refused as stale, rebuilt with 0 workouts and then `not_ready`, so there is 1 job and no duplicate (brief scenario 6 holds). After an import, a workout logged in the app shows no "Last" for the imported exercise, and the Summary says `Earlier Lat pulldown sets were imported from FitNotes. Not compared.` |
| Grep of the diff for `console.*`, storage of secrets or tokens, `eval` | None found |

## Round-2 findings: status

| # | Status | Evidence |
|---|---|---|
| B1 Repeat of an imported workout, and imported "Last" with no equipment | **Fixed** | `HistorySession.imported` (`progression.ts:55`, set in `history.ts`) is checked in `lastComparableSession` (`active-view.ts:49`), `comparableSessions` (`progression.ts:258`) and `summaryHighlight` (`touches.ts:112`). Repeat: `listRepeatableIds` uses `source = 'manual'` (`sessions.ts:593`); `candidates` skips imports (`workout-services.ts:524`); `startFromSession` refuses with `imported_not_repeatable` (`session-service.ts:140`), so a stale link reads "That workout has nothing to repeat." `planFor` (adding an exercise) reads `previous.sessionId`, which is filtered too. The Summary of an imported workout has no comparison, highlight or Next time. The comparison names the compared workout's own gym (`summary.ts:129`). Tests: the reviewer's home-dumbbells scenario end to end (`fitnotes-import.test.ts:340`), no equipment on either side (`summary-today.test.ts`), and the rule (`history.test.ts`). ADR 0015 records option (a) and widens P-I3 |
| S1 Cleared bar weight | **Fixed** | `barWeightEntry` (`views.ts:538`) puts the stored weight back when editing ends and warns while the field is blank. Tested. One leftover case is N1 below |
| N1–N5 | Fixed | The same unfinished file says Continue once, and a running import isn't called paused. Data & backup uses `pausedLine`. The set line reads `imported as …`. `writeFailedLine` says "may not have saved". A chosen `split` answer stays visible after the values stop spanning zero. Each is tested |
| N6–N8 | Open, acknowledged in ADR 0015 | Unchanged |

## Blocking

None.

## Should fix

### S1. "Both dumbbells together" halves exercises done with one dumbbell (one-arm row, kickback, goblet squat, pullover)

- **Where:**
  - `packages/domain/src/import/plan.ts:463`: `half(value)` is applied to every per-hand exercise under the group answer or a `both` override.
  - `apps/mobile/src/import/views.ts:496-511`: `perHandOptions` shows one example only.
  - `apps/mobile/src/screens/import/ImportQuestionScreen.tsx:43-60, :71`: the override list shows the FitNotes name with `Same / Each / Both together`, and doesn't say what each exercise will import as.
- **Failure path (probe):**
  1. The file has `Dumbbell Bench Press 60 × 8`, `One-Arm DB Row 30 × 10` and `Goblet Squats 24 × 10`.
  2. Ben logs his dumbbell presses as the pair total, so he answers "Both dumbbells together".
  3. The import gives: bench `30 kg each` (correct), one-arm row **`15 kg each`** and goblet squat **`12 kg each`**.
  4. A one-arm row or a goblet squat uses one dumbbell, so "both together" can't apply. Two years of rows and squats are recorded at half their load. Nothing on the question screen says so.
- **Why it matters:** this is a load-convention error on completed history, the authoritative record ("load convention always explicit"; rule 6). Ben can avoid it only by overriding each such exercise, and only if he notices. In the catalogue, `dumbbell-one-arm-row`, `dumbbell-triceps-kickback`, `dumbbell-three-point-row`, `kettlebell-press` and others are `per_hand` + `unilateral`. `dumbbell-goblet-squat` and `dumbbell-pullover` are `per_hand` + `bilateral` but use one implement.
- **Fix (any of these, smallest first):**
  1. In the "Different for some?" list, show what each exercise will import as under the current answer, for example `One-Arm DB Row · 30 → 15 kg each`, so the consequence is visible.
  2. Leave `unilateral` per-hand exercises out of the group answer, and give them their own explicit question with no default (DX6). Note that split squats and lunges hold two dumbbells, so this can't be automatic.
  3. Add an implement count to the catalogue (see Spec issues).
- **Tests:** a file with a one-arm row under "both", and the override applied.

### S2. After the older of two imports is undone, re-opening the newer file says "Nothing new to import", but its older dates are no longer in the app

- **Where:**
  - `apps/mobile/src/import/import-service.ts:423`: any job with the same checksum that isn't reverted returns `same_file`.
  - `views.ts:166`: `You imported this file on … Nothing new to import.`
- **Failure path (probe):**
  1. Ben imports `a.csv` (1 Sep).
  2. He imports a newer export, `b.csv` (1 Sep and 8 Sep). It skips 1 Sep as `Came in with an earlier import (a.csv)` and imports 8 Sep.
  3. He finds a wrong answer in the first import and undoes `a.csv`. 1 Sep is now hidden.
  4. He re-opens his latest export, `b.csv`, to bring 1 Sep back. The app says `You imported this file on Thu 8 Oct (1 workout). Nothing new to import.`
  5. 1 Sep is in neither import, and this file can't bring it back. The way out isn't obvious: undo `b.csv` as well, or find `a.csv`, or export a fresh file.
- **Why it matters:** "Nothing new to import" is a false statement about Ben's data. It also gets in the way of the natural recovery after an undo (DX7 promises "You can import the file again", but that only holds for the undone file). Brief scenario 6 (no duplicates) doesn't depend on the checksum short-cut: dates from imports still in effect are always skipped.
- **Fix:** before returning `same_file`, check whether every date in the file is covered by `importedDates` or `appDates`. If one isn't, show the normal preview, with a line naming the earlier import of this file. Or keep `same_file` only when the earlier import's dates still cover the file. Add the probe as a test.

## Nits

- **N1.** A bar weight above the schema maximum (100 kg / 220 lb, `schemas/src/import.ts:113`) is refused, but the field keeps showing it, because `barWeightEntry('150', …)` returns `save: 150, endText: '150', warning: null`. Only a raw zod message shows at the top of the screen: `Too big: expected number to be <=100` (`import-service.ts:469`, `ImportQuestionScreen.tsx:179`). 20 kg is still added, which is the round-2 S1 situation again with a typo such as `200`. Fix: bound the value in `barWeightEntry` and give it an app-voice warning, for example `Enter a bar weight up to 100 kg. Until you do, 20 kg is added.`
- **N2.** The Olympic bar field is always shown (`views.ts:563`). When it's cleared, the warning says `Until you do, 20 kg is added.` (`views.ts:543`) even when every barbell exercise is answered "Total", so nothing is added. Say "is added to plates-only values" or omit the warning when `needed` is false.
- **N3.** The gym question's footnote (`ImportQuestionScreen.tsx:170`) says imported sets "show in your history". With Past workouts now leaving them out and Progress a placeholder, the only place they're listed is Data & backup → Past imports → an import → Imported workouts. Progress also counts them as `n workouts logged` (`ProgressScreen.tsx:25`). Consider "they're kept and listed under Past imports" until a history view exists.
- **N4.** `repeat.last()` runs `candidates(1)`, which now also runs `countImportedFinished` (`workout-services.ts:542`) on every Today load just to throw the count away. This is cheap with today's data volumes. Consider a `withCount` flag.
- **N5.** Undoing an older import doesn't mention that a later import skipped its dates (follows on from S2). Once S2 is fixed, the undo alert could say `n of these dates were skipped by <later file>; import a file again to bring them back.`

## Tests

**Good:**
- The round-2 gaps are covered: Repeat of an imported workout at the `home_dumbbells` gym (no 40/140/90 planned, refused when asked directly); no FitNotes "Last" with no equipment on either side; the Summary's gym naming; the bar-weight entry rules; the persistence query and count.
- Existing tests were changed to find imported workouts through `importedRows` instead of Repeat candidates, so the earlier assertions still run.

**Missing:**
- A one-dumbbell exercise under "Both dumbbells together" (S1).
- Undo of the older import followed by re-opening the newer file (S2).
- A bar weight above the maximum (N1).

## Conditions before calling this done (unchanged, not code defects)

- Check 16: re-run detection against Ben's real export and add its first line as a fixture.
- Check 27: preview within 5 s for 10,000 rows on the iPhone, plus per-answer latency and the results screen's full row decode (round-2 N8).
- Device checks in ADR 0015:
  - migration 3 under expo-sqlite after a copy is saved to Files;
  - the CSV picker from iCloud Drive, On My iPhone and FitNotes 2 email;
  - Stop, force-close and Continue;
  - Undo.
- Ben's answers listed in ADR 0015 "Open for Ben". Ask in particular how he logged one-arm and goblet exercises (S1).

## Spec issues

- **SP1. P-I3 is still the main open decision** (Domain owner and PM; open-decisions B7). Option (a) is now enforced consistently and labelled in the copy, which is correct while the decision is open. Option (a) means years of imported history don't help the next workout, which was the point of the import. The decision also needs to cover Repeat, and how loads with `Gym: Not recorded` are checked at today's gym.
- **SP2. The dumbbell question has no answer for one-implement exercises** (S1). §2.5 step 3b treats every per-hand exercise as a pair. The designer should say how one-arm and one-dumbbell exercises are asked about, or shown, under "Both dumbbells together". The catalogue owner should consider an `implements: 1 | 2` field, because `laterality` can't tell a one-arm row from a split squat.
- **SP3. "Same file" vs "nothing new"** (S2). §3.4's "Same file again" row assumes the file's earlier import still covers everything in it. The spec should say what happens once another import that the file depended on has been undone.
- **SP4. Which domain do aliases belong to?** Checks 13a and 30 list "aliases" under Coaching knowledge. ADR 0015 stores FitNotes `ExerciseAlias` rows as owner-scoped Your data (Ben's own naming), and restore counts them that way. Probably both are meant (catalogue synonyms are Coaching knowledge; Ben's import answers are Your data), but rule 10's split for backup, export and delete needs this written down. The same goes for custom exercises from `Add new`, which the Coaching-knowledge export (§2.6) lists.
- **SP5. ADR 0015 differences 10–19 still need designer or PM acceptance.** The ADR is still "Proposed". workout-summary.md and system-states.md should carry the date-only rules and the new Summary wording (difference 16).
- **Still open from earlier rounds:**
  - Smith machine and other bars (r2 SP3);
  - timed and distance strength sets (r1 SP2);
  - brief v0.2's "RPE is not expected as a column", and research S6 on warm-ups. This needs Ben (r1 SP8).
