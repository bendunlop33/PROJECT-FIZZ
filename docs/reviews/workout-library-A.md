# Review: Workouts library, slice A

Branch `claude/workout-library` (8 commits, `4435e7a..afa3c57`) vs `claude/gracious-knuth-joxqpw`.
Spec: `docs/design/routines.md` Part A (WL1–WL10, §A2–§A7), mockup `docs/design/mockups/workout-library.html`, CLAUDE.md rules 1–10, minimal copy.
Reviewer: independent reviewer, 11 Oct 2026.

## Verdict: **CHANGES NEEDED**

One blocking issue. The coach's saved next-session target (D21) replaces the structure of a library workout. That breaks WL-A4 ("The overview shows the new structure") whenever the coach is connected, and it silently undoes Ben's editor changes. Everything else is in good shape. Versioning and idempotency are sound, editor Undo survives a force-close, nothing touches completed sets, there is no migration, no provider call is made, and the UI has no "routine" strings. The remaining items are should-fix or nits.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`eslint .`) | pass |
| `npx vitest run --testTimeout=120000` | 3914 pass, 2 fail, 1 todo. The 2 failures are timing tests in files this branch doesn't touch: `catalogue/test/definition.test.ts` D6 (its own 60 s timeout) and `domain/test/equipment.test.ts` M8 (503 ms against a 500 ms bound). Both passed when rerun alone (80/80). They were load flakes, not regressions |
| Scratch check (not committed) | `routineTemplatesWithTargets` called with a workout of `Top 4–6 + 3 × Back-off 6–8` and a coach target of 3 × 100 kg × 5. It returns `warm-up, top 100×5, top 100×5, top 100×5`, so the back-off sets are gone. This confirms B1 |

## Blocking

### B1. A D21 coach target overrides the saved workout's structure: set types, set count, reps and Ben's editor changes

- `packages/domain/src/session/routines.ts:436` (`if (o.legacy || fromCoach)`), fed by `packages/domain/src/coach/next-session.ts:303`.
- For a library workout (`source` set), the built-in-rule path correctly treats the workout as the structure. The coach path doesn't. As soon as any planned entry has `source: 'coach'`, the exercise's working templates are thrown away and replaced by the coach rows. `withCoachTargets` builds those rows as N copies of one set type (`working[0].setType`) with the same load and reps. Only Fixed pins survive, matched by index within a type.
- Failure scenario (coach connected, which is the default under D21):
  1. Ben finishes Push A. The coach saves a small next-session target for Bench: 3 × 5 at 100 kg.
  2. In the editor Ben restructures Bench as `1 Top 4–6` + `3 Back-off 6–8`, adds a 4th working set to Incline, and changes its reps to 6–8. He saves and sees `Saved Push A`.
  3. The overview and Start show Bench as 3 × `Top` at 100 kg × 5 with the back-offs gone, and Incline back at the coach's set count and reps.
  4. Ben's edit is silently not honoured. His later, explicit change loses to an older automatic target. This breaks WL-A4, WL7 ("keeps … set types and counts, rep ranges") and the intent of rule 3 (small coach adjustments shouldn't override Ben's structural choices). Editing the workout doesn't invalidate the coach row either: `nextTargetFitsSource` checks only the source session's version.
- Fix, for library workouts (`!legacy`):
  - Keep the workout's templates as the structure, as the built-in path does.
  - Apply the coach row's load and reps to the Auto working sets of the matching type.
  - Honour a coach set-count change only when the workout's templates haven't changed since the target was set (`routine.updatedAtUtc <= row.createdAtUtc`). Otherwise the template wins and the coach target is shown as not applied.
  - Never collapse Top/Back-off/Drop into one type.
- Tests to add:
  - Domain: `routineTemplatesWithTargets` with mixed set types and a coach row.
  - Service level: edit after a saved coach target; overview equals Start equals the edited structure.
- See also the first spec issue below.

## Should fix

### S1. Undo of Duplicate can't be reached
- `apps/mobile/src/screens/routines/WorkoutsScreen.tsx:132-140`; same pattern in `WorkoutOverviewScreen.tsx` `duplicateRoutine`.
- The `Saved Push A copy` [Undo] toast is set on the list (or overview), and then the editor is pushed over it straight away. The toast expires after 8 s (`TIMING.undoToast`), and Ben is in the editor by then.
- The only way back is `Cancel`, which leaves the copy saved. If he saves, the toast he gets back reverts the edit, not the duplicate.
- WL-A7 ("toast Undo removes it") is only met at the service level.
- Fix: either carry the delete-Undo into the editor (`Cancel` on an untouched fresh copy offers `Discard copy`, or the editor shows the toast), or hand the toast back on return when nothing was saved.

### S2. Saving from a workout's overview drops Ben's Fixed pins and `Main` choices
- `apps/mobile/src/services/workout-services.ts:1249` (`routineFromPlan` gets no `fixedSetIds`); `packages/domain/src/session/library.ts:292`, `:323`.
- Failure: Push A has Bench pinned at Fixed 60 kg and `Main` turned off on the 2nd exercise. Ben uses overview `⋯` → `Save to Workouts` to make `Push A · 30 min`. The copy has every load set to `Auto`, and `Main` is recomputed by the rule. His explicit settings are lost without a word.
- WL-A12 says Ben's `Main` toggle survives Save and Duplicate, and Duplicate does keep both.
- Fix: when the target is a routine, map each plan slot back to its routine slot and keep that slot's Fixed `targetLoad` and `main`. Pass `fixedSetIds` for those sets.

### S3. Keep both on a pre-library workout turns stale actual loads into Fixed pins
- `apps/mobile/src/screens/routines/WorkoutEditorScreen.tsx:203`, `:208`.
- The editor opens a legacy routine (`source` undefined) through `editableExercises`, so loads read as `Auto`. The conflict merge then compares that base with `stale.current.exercises` raw.
- If the newer version is still legacy (for example a rename from Today, or `Change Push A too ›`), every slot looks "changed by them". Each slot Ben didn't touch takes "theirs", which still carries last time's actual loads. The merged workout is then saved with `source: 'ben'`, so those actuals become Fixed pins. That breaks WL7 and RT3, and it happens unseen.
- Fix: pass `stale.current` through `editableExercises` before merging, and set `base.current` from it too.

### S4. Repeat's `Save to Workouts` saves the source workout, not the Repeat preview
- `apps/mobile/src/screens/repeat/RepeatScreen.tsx` (`saveSheet.open({ kind: 'session', sessionId, keepLoads: true })`).
- §A2.6 says Repeat saves "The Repeat preview". The preview fits loads to the selected gym (`snapPlanToGym`) and may include Ben's `Swap ›`. The save instead pins last time's raw actuals and the original exercises as Fixed.
- Example: Repeat at Hotel gym (dumbbells up to 30 kg), last done 36 kg each at Main gym. The saved workout has Fixed 36 kg each. Start caps it, but the workout carries a load that isn't achievable here, and it differs from what the screen showed.
- This was pre-existing, but the slice renamed and re-wired this entry point. Either save the preview's planned loads, or record the deviation in the spec.

### S5. Saving from a plan freezes default rest into the workout
- `packages/domain/src/session/library.ts:299`.
- `routineFromPlan` copies the resolved rest of the first set of each type into `restBySetType`. Rest that came from the exercise default or the global default (`source` `exercise_default` / `global_default`) becomes a workout preset. Changing the exercise default later no longer affects the saved workout. Per-set `restOverrideS` values are dropped.
- Fix: copy only rest whose source is the routine's own set-type preset (or a set override, into `restOverrideS`). Leave the rest to fall through.

## Nits

- **N1.** Parts of §A2.1 and §A3 are missing without a note: the `＋` menu goes straight to the editor (no `New with coach` / `Coach offline`), there is no `Edit order` on `YOUR ROTATION`, no `Set up rotation ›` when the rotation is empty, no `New with coach` in the empty state, and no Plan hub `Week · Workouts` segment (a `Workouts ›` link was added to Today instead). These depend on screens that don't exist yet: workout builder, Plan hub, Edit rotation. That's acceptable, but say so in the spec or the commit (see the first spec issue below).
- **N2.** `packages/domain/src/session-service.ts:106` still returns `Routine not found.` to the UI (WL-A16).
- **N3.** `WorkoutsScreen` delete toast reads `Push A deleted`, but overview Delete (pre-existing) pops to Today with `Deleted Push A`. Use one wording (§A5: `Push A deleted`).
- **N4.** `routineChangeLines` on the first editor save of a pre-library workout reports every exercise as edited, because loads go to Auto. Run `editableExercises` on `before` for the lines, or add a dedicated line.
- **N5.** `services.routines.duplicate` (`workout-services.ts:2455`) doesn't refuse a tombstoned routine. The UI can't reach this today, but `writeRoutine`'s siblings do refuse.
- **N6.** Saving a `FROM HISTORY` row under a different name (e.g. `Shoulders A`) links only the newest session through `createdFromSessionId`. The older `Shoulders` sessions stay as a `FROM HISTORY` row with an older last-done date.
- **N7.** The editor's Fixed load uses `NumberStepper`, whose up step is disabled at the rack max. Getting 37.5 kg on a 30 kg rack (WL-A4) needs typed entry. Spec §A2.3 says `WorkoutKeypad`. Confirm typed entry works on device.
- **N8.** `PastWorkoutsScreen.tsx:71` keeps the lead paragraph "Pick a workout to do again. Its sets become today's targets; nothing is marked done." (minimal copy, 10 Oct). Pre-existing, but the screen was touched.
- **N9.** `routineFromPlan` pins `equipmentId` to the item chosen at today's gym (`library.ts:305`), even for slots that were unpinned in the source workout.

## What's good

- **Rule 5:** every library write goes through `routineWrite`, or through `createOnce` with an ID derived from the opId. Retries replay; an older `expectedVersion` returns the newer version for the conflict sheet. Editor save and its `ActionRecord` are written in one transaction (`applyRoutineChange`). Undo is version-checked (`versionAfter`), recorded as its own `undo` record, and survives a force-close (tested). Stale preview saves write nothing (`previewKey`, tested).
- **Rule 2:** saving from Summary or Past workouts never changes the finished workout (tested). Editing a workout while it is in progress leaves the running sets byte-identical (tested). `Delete` is a tombstone with Undo back to the same rotation place (tested).
- **Rule 4:** a Fixed 37.5 kg each pin on a 30 kg rack saves with a warning and is capped at Start (tested in domain and services).
- **Rules 1, 7:** the library, editor, save, duplicate, delete and undo make no provider calls (tested). No secrets and no new logging.
- **Migration:** none. All new fields are optional JSON. Backup and restore keep `Main` (tested).
- **Rule 10:** `update_routine` records reach the coach only as rendered one-line text (`turn.ts` `renderActionResult`), never the stored `before` routine.
- **Preview == start:** library rows, the overview and Start share `routineStart` and `planRoutineStart` (`preview: true` vs a real start). The editor estimate uses the same planner.
- No "routine" strings in the library UI (WL1, WL-A16), apart from N2.

## Tests: gaps to close with the fixes

- B1: a coach target and a later editor change, with mixed set types, through to Start.
- S2: an overview save of a routine with a Fixed pin and a `Main` toggled off.
- S3: Keep both on a legacy routine.
- S1: a navigation or UI test that Duplicate's Undo can still be reached.

## Spec issues

1. **Coach target vs Ben's later structure (B1).** WL7 says next targets come from "the coach's D21 target or the built-in rule". D21 lets the coach's small adjustments change set count. Nothing says which wins when Ben edits the workout after the coach saved a target. Proposal: a library workout's templates are the structure. A coach target supplies load and reps for the matching Auto sets, and it changes set count only if the workout hasn't been edited since the target was saved. Ben should confirm.
2. **`routineFromPlan` contract (§A6) loses Ben's settings (S2).** "loads `Auto` except slots whose load Ben set by hand today" should also keep the source workout's own Fixed pins and `main` flags when the overview's target is a saved workout.
3. **Part A assumes screens that don't exist yet (N1).** It assumes the Plan hub with its `Week` segment, `Edit rotation` (weekly-plan §2.4) and the workout builder (`New with coach`). Mark these as later, or as depending on those slices, so slice A's acceptance doesn't silently cover them.
4. **WL-A10's fixture relies on FitNotes Category types.** `SESSION_PICKER_DECISIONS.groupImportsByCategory` is `false` (Decision 1 still open), and `typeIndex` doesn't pass `importCategories` (pre-existing). So `FROM HISTORY` can only list named imported workouts today. The check should say "named imported type" until Decision 1 is made.
