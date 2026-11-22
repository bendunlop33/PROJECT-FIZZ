VERDICT: PASS

# Review: Workout overview, merge of main and the coach rows (claude/workout-overview)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `git diff claude/gracious-knuth-joxqpw...claude/workout-overview` (40 files: what merging the branch into
main would add). I read the merge commit `7a3c2ca` and the two commits after it, `4635298` (coach rows, spec §5)
and `763ea92` (check-in copy, r3 N3). The branch doesn't yet contain main's two newest commits (`9ae4c0e`,
`da3eb87`, both build notes under `docs/device-tests/`). They don't conflict.
Checked against `docs/design/workout-overview.md` (OV1–OV17), the reviews [workout-overview.md](workout-overview.md),
[-r2](workout-overview-r2.md) and [-r3](workout-overview-r3.md), CLAUDE.md rules 1–10 and the minimal-copy rule.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npm run catalogue:validate`: exit 0 (135 valid, 0 errors, 1 warning that was already there).
- `npx vitest run --testTimeout=120000`: exit 0. 170 files, 3512 passed, 1 todo.
- `@fizz/coach` resolved from the existing workspace link, so no symlink was needed.

## What I verified

- **Nothing on main is lost.** Since main, the diff touches only the overview, the check-in sheet over it,
  Today's Up next and routine entry points, and the start and fence plumbing. These main features have no lines
  in the diff, and the full test suite (main's tests included) passes:
  - the in-workout gym switch (`GymSwitch.tsx`, `gym-switch.ts`, ADR 0019)
  - the coach sheet, AskPill, offers and the Summary's Next time with Why?/Undo
  - Time left
  - the discard confirm (Today's stale card and the FinishSheet)
  - Save as routine
  - pain flags and the pain check row
  - the Why? panel in the workout

  `RoutineSheet.tsx` was removed on purpose: spec §2.1 says there is "one pre-workout page, not two". Its Rename
  and Delete moved to the overview's `⋯` menu, Delete keeps an Undo (`undoRoutine` restore on Today), and
  Today's long-press keeps Rename and Delete.
- **Preview == what Start creates.**
  - The overview's dry run (`overviewDryRun`) and Start (`workout.startOnce`) run the same planner
    (`routineStart` / `startFromSession`) on the same inputs:
    - `nextTargetsOf`, which already layers in the coach's stored D21 targets;
    - `lastUsedFor` (gym-switch GS3);
    - main's shared `snapPlanToGym` fit.
  - Fits are read from that fit (`setFitsOf`), so the overview makes no pre-start drops of its own.
  - Tests on real SQLite compare every row with the session Start creates, including:
    - after a gym switch (capped dumbbells, no barbell);
    - with a coach target (57.5 kg).
- **Every start path.**
  - Up next `Start workout`, a hero detail row, Done-today `Start next session` and a `Your routines` row all
    open the overview.
  - `Empty workout`, the First workout hero and Repeat start directly, with the `CheckInSheet` when a check-in
    is due.
  - Resume, P6 and the stale card never reach the overview. Routines are hidden while a workout is active or
    stale.
  - There is no other `services.workout.start` caller.
- **Check-in asked once.** The inline tiles save once per page (one ID and opId). The AX `Check-in ›` sheet's
  record is linked by the gate re-read in `checkInAtStart`. Leaving the check-in alone gives `skipped`; check-ins
  off, or not a check-in day, give `not_asked`. r3 S1 is fixed: `Check-in ›` is `disabled={busy || scoring}`,
  and focus is checked again before `openStartedWorkout`.
- **Coach rows are honest.**
  - Opening the page reads stored rows only (`listNextTargets`). No model call is made, and a test counts the
    requests.
  - A row is tagged `Coach` only when the dry run's first working set has `source: 'coach'` from that record's
    action. So the tag means Start will use the coach's target. It is not a guess from the record.
  - Pain today, a pain flag, a used target or a changed source version give no tag and no `Use coach target`,
    which matches `withCoachTargets`.
  - Stored targets are in `previewKey` and in the `WriteFence` (`next_session_targets` set), so a late coach
    result or an Undo after the key check creates nothing (rule 5).
- **Undo correctness (small change).** Undo is `saved → undone` through the Summary's `tapNextTarget`, with the
  record's version. A stale version is refused with `changed_since`, and the page re-reads. `Use coach target`
  puts the target back. The toast's Undo uses the pre-Undo status, so a bigger change goes back through
  `apply`. All three are tested on SQLite.
- **Migrations untouched.** No file under `packages/persistence/src/schema/` or `migrations.ts` changes. The fence
  only reads `next_session_targets` (migration 6). Nothing new is persisted and backup is unaffected.
- **Minimal copy.** The undo toast is `… · coach target undone` (no rule label). The check-in's reassurance and
  rule lead lines are gone, and the pain rule sits behind an ⓘ.

---

## Blocking

None.

---

## Should fix

### S1. Undo on an applied (bigger) coach change leaves the row with no way to apply it again

Files: `packages/domain/src/session/overview.ts` (`overviewCoachOf`: only `status === 'undone'` gives
`built_in`) and `packages/persistence/src/coach.ts:200-206` (`applied: ['proposed']`).

Spec §5 says that after Undo "the panel offers `Use coach target` (`Apply` again for a bigger change Ben had
applied)". But Undo on an `applied` row moves it to `proposed`, not `undone`. So `overviewCoachOf` returns
`null`, and on reload the row has no tag and no pill.

Scenario: on the Summary, Ben applied a bigger coach change ("Bench 4 sets"). On the overview he taps Undo and
the toast shows. He misses its 8-second Undo. Now nothing on the page can put the change back, and only the
Summary still offers `Apply`. The data stays correct (Start uses the built-in rule, and nothing changes
silently), but the page loses the Apply the spec asks for. It also doesn't match the Summary, which shows
`Not now` / `Apply` for a `proposed` row.

The toast path itself is right: `coachTapOf('built_in', 'applied')` sends `apply`, and `proposed → applied` is
allowed.

Fix:
- Return `{ state: 'built_in', rowId }` for a `proposed` row that was applied before, or simply for any
  `proposed` row that passes the same usable checks. Label it `Apply`.
- Have `coachTapOf` send `apply` for it.
- Add a SQLite test: an applied row, then Undo, then reload. The row offers `Apply`, and tapping it restores the
  target. There is no `applied` / `proposed` app-flow test today, only the domain check that `proposed` returns
  `null` (`overview.test.ts:532`).

### S2. The device Dynamic Type check is still open (carried from r3 S2)

`docs/design/workout-overview.md` §11 still says "Not yet done". The coach row adds a `Coach` tag beside the
marker in the right column (`ui/overview.tsx`, `flexWrap: 'wrap'`). That is one more thing that could wrap or
clip at xLarge–AX3 next to a 22 pt load. Add it to the device pass on Ben's iPhone, and record the result in §11
before the first real workout.

---

## Nits

- **N1.** `WorkoutOverviewScreen.tsx:370-398` (`tapCoach`) has no guard. A double tap on `Undo` sends two taps
  with the same record version. The second is refused, and its toast `Changed since. Check it again.`
  replaces the first one's Undo toast. The data stays correct, but the message is misleading. Fix: run it
  through a `createGuard()` as the score and Start writes do, or disable the pill while the tap runs.
- **N2.** In the `built_in` state the panel offers `Use coach target` but never says what that target is. The
  Summary's undone row shows `Coach target: 57.5 kg` behind `Why?`. Consider a `COACH` panel line with the stored
  target (value only) when the state is `built_in`, so the tap isn't blind.
- **N3.** `WorkoutOverviewScreen.tsx:158`: the gym toast's Undo ignores a failed `services.gyms.select(previous)`.
  Show `r.message`, as `chooseGym` does.
- **N4.** `WorkoutOverviewScreen.tsx:305-307`: `startEmpty` dispatches `openStartedWorkout()` without the
  `navigation.isFocused()` re-check that `start()` gained for r3 S1. This is rare, because the `⋯` menu can't
  open over a sheet, but it's an easy match.
- **N5.** Only the routine path is tested with coach rows. The routine is Up next by rotation in
  `overview-merged.test.ts`. A `{ nextOf }` (non-routine) case with a stored coach target would cover the other
  resolver. It uses the same `nextTargetsOf`, so the risk is low.

---

## Spec issues

1. **§9 copy list is out of date.** It still lists the toast `Incline dumbbell press · built-in rule`, but §5 was
   changed to `… · coach target undone`. Update §9 to match.
2. **§5 / `Why?` "Built-in rule (coach offline)".** No code anywhere produces this string, on main or here. The
   active-workout `Why?` and the overview's `Why?` both explain the target from provenance only. Either drop the
   line from §5, or add the coach availability to `explainTarget` as a separate slice (it applies to the workout
   screen too).
3. **Approvals still pending (carried from r2 and r3).**
   - ADR 0021 is still "Proposed … Ben to confirm".
   - The check-in.md CI2 amendment and workout-overview §11 are still "Ben to confirm".
   - `docs/brief/CHANGELOG.md` has no entry for the overview, the CI2 amendment or the fenced start.

   Record Ben's decisions before this merges to main, or merge with them marked provisional.
4. **Older reviews cite ADR 0019 for the fence.** ADR 0021 notes the renumbering, which is enough. Mention it in
   the merge description too, so nobody reads 0019 (gym switch) as the fence ADR.

## Verdict

**PASS.** The merge keeps main's features. The overview's preview is built from the same shared fit and target
layering that Start uses. The coach rows read stored targets only and are tagged only when Start will use them.
Their Undo and `Use coach target` use the Summary's versioned command, a stale version is refused, and the stored
targets are in both the preview key and the write fence. Typecheck, lint, the full test suite and catalogue
validation all pass, and no migration changed.

S1 (no way back to `Apply` after undoing a bigger change on the page) is a gap against spec §5, but it never
applies anything silently. Fix it with S2's device check before the first real workout.
