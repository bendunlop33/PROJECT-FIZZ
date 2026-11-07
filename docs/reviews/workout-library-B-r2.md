# Review: Workouts library, slice B (full edit before start), round 2

Branch `claude/workout-library` at `1815f01` vs `claude/gracious-knuth-joxqpw`. This round covers the fix commits `1fdf618` and `1815f01`, made after review r1 (`08c6646`, `docs/reviews/workout-library-B.md`). I also re-checked the rest of slice B (`e47cbc5`..`a372ae9`) wherever a fix touches it.
Spec: `docs/design/overview-today-edits.md` §11 (TE11–TE17, TE-B1–TE-B14), `routines.md` §A2.5, mockup `docs/design/mockups/workout-library.html`, ADR 0022 (amended note), CLAUDE.md rules 1–10, minimal copy.
Reviewer: independent reviewer, 12 Oct 2026.

## Verdict: **PASS**

All three r1 blockers are fixed, and each fix has a domain test and a service test.

- **B1:** a `load` edit now records the exercise it was typed for. The draft write stamps it, and a caller-supplied value is ignored. The load applies only while the slot holds that exercise. After a swap it waits (it is neither applied nor pruned) and comes back with an Undo or a re-swap.
- **B2:** the keypad pre-fills only a value already in its own unit and convention.
- **B3:** the card carries the draft version it was built from, and Apply sends that version. The service refuses Apply if the draft has moved since, and the card goes to `Was suggested:` as soon as the draft moves.

The three r1 should-fixes are also fixed and tested:
- S1: legacy routines drop today-only set counts, and TE-B13 now finishes the workout for both a library and a legacy routine.
- S2: stepper taps are chained, and a draft conflict says `Couldn't save that edit.`.
- S3: the service refuses a load outside the row's keypad frame.

Nits N2, N3, N4 and N6 are fixed too.

Nothing blocking remains. The should-fix and nit items below are small edge cases and spec bookkeeping.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=120000` (full) | **pass**: 203 files, 4019 tests, 1 todo (r1: 4000) |
| Migration | None. `exerciseId` is optional on the `load` edit (`packages/schemas/src/draft.ts:76`). Older drafts parse and fall back to the slot's own exercise, which is tested. No SQL change. |
| Start paths | Overview Start, next-session Start, Up next and the card's dry run still plan through `planWithTodayEdits`/`resolveTodayEdits`. The B1 wait rule is in `resolveTodayEdits` (`today-edits.ts:641`) and in `dropUnplanned` (`:807-816`), so preview equals Start. The B1 service test asserts `sameAsStart` after a load and a swap. |
| Rule 2 / template safety | Only `applyTodayEdits` changes the routine. It is now versioned on both the routine and the card's draft (`workout-services.ts:2729`), and its test proves an old card is refused and nothing is written. Typed loads still never become card lines (TE-B8). |
| Rule 5 / idempotency | Draft writes are still opId-idempotent. Chained taps send the newest known version (`nextDraftVersion`). A real conflict is still refused and the page re-reads. |
| Offline / AI | No new network or provider call. TE-B12 still holds (`model.requests` is 0 in the service tests). |
| Copy | New strings are none, apart from reusing `Couldn't save that edit.`. No explanatory copy was added. |

## Blocking

None.

## Should fix

### S1. A waiting load on the slot's own exercise isn't restored when a swap becomes unplannable

- **Where:** `packages/domain/src/session/today-edits.ts:801-816` (`dropUnplanned`), with the skip at `:641`.
- **Failure:**
  1. Ben types `100 kg` on Bench press.
  2. He swaps to DB bench press. The 100 kg load waits, which is correct.
  3. He switches to a gym with no dumbbells. `dropUnplanned` drops the swap as stale, so the slot is back on Bench press, and it removes any substitute load.
  4. Ben's waiting 100 kg Bench load was already skipped in `resolveTodayEdits`, because the slot held DB bench there. Nothing puts it back.
  5. The row shows Bench press at the planned load with no `[Ben]` tag, and Start creates those sets. The load only returns after the next draft write prunes the stale swap.
- **Impact:** Preview still equals Start, so nothing unsafe is applied. But Ben's typed intent is silently not applied on that read.
- **Fix:** In `dropUnplanned`, after deleting a swap, find the live `load` edit whose exercise is the slot's base exercise and set it into `resolved.loads` with an `applied` outcome. Equivalently, run the load pass after `dropUnplanned`. Add a domain test for load → swap → substitute not plannable, which should plan Ben's load.

### S2. The spec still says `Targets updated` for a stale draft version

- **Where:** `docs/design/overview-today-edits.md:179` (`Stale draft version | Page re-reads; toast Targets updated`), against `workout-services.ts:3038-3049` and `WorkoutOverviewScreen.tsx:668-677`.
- **Problem:** The code change is correct, and r1 S2 recommended it. The spec now disagrees with the build, though, and §11.5 (`:468`) still defines "out of date" only as Push A changing.
- **Fix:** Update the spec rows for the draft-conflict toast and the card's draft-version freshness (see Spec issues 1). Ben or the PM approves the change.

## Nits

- **N1. A queued stepper tap can outlive a session switch.**
  - **Where:** `WorkoutOverviewScreen.tsx:655`, `:779-797`.
  - **Problem:** The `switching.current` and `page` checks run when Ben taps, not when the queued write's turn comes. The `target` and `page` captured in the closure are the old workout's.
  - **Effect:** A `+` queued behind an in-flight write just before a switch lands on the old workout's draft. That is what Ben tapped. It can also raise `Couldn't save that edit.` on the new page.
  - **Fix:** Have the queued intent return `null` when `switching.current` is set or the target has changed.
- **N2. A stale write reference can cost one tap.**
  - **Where:** `overview-edits.ts:336-341`. When the page's draft is `null` but `wroteDraft` still holds an earlier draft, the next write sends that old version.
  - **Effect:** This happens when the draft expired at midnight during a page read rather than a write. One tap fails with `Couldn't save that edit.`, and the next tap works because the stale branch clears the reference.
  - **Fix:** Clear `wroteDraft` when a reload returns a draft with a different id, or none, once the reload started after the write.
- **N3 (carried from r1 N1).** The §11.4 `WorkoutKeypad` with step keys versus the built `NumberStepper`. The strings `Assist`, `Most assistance here:`, `Least here:` and `Least assistance here:` are still not in §11.8. See Spec issues 2.
- **N4 (carried from r1 N5).** A typed load on a `HELD` (pain-flagged) exercise still replaces the held load with no prompt. This needs a spec decision (Spec issues 3).
- **N5. Re-confirming a load at an lb gym overwrites the kg intent.** At an lb gym the keypad opens at the fitted `80 lb each`. Tapping `Set target` unchanged replaces the intended `37.5 kg each` with `80 lb each`, which re-fits to about 35 kg back at the kg gym. This is consistent with "Ben's own value", and nothing is relabelled. One option is to treat an unchanged value as `unchanged`.
- **N6. Edits written before the stamp follow the slot's current exercise.** A `load` edit with no stamp (written before `1fdf618`) on a slot whose routine exercise later changes, through Apply of a swap line or the editor, applies to the new exercise. Drafts expire at midnight and slice B hasn't shipped, so this is negligible. It is noted only because the schema keeps `exerciseId` optional.

## Spec issues

1. **§11.5 card freshness and the draft-conflict toast.**
   - The build makes the card `Was suggested:` when either the routine or today's draft moves, and closes an unapplied card on `Done`.
   - It shows `Couldn't save that edit.` for a draft-only conflict.
   - `overview-today-edits.md:179` and `:468` still describe the r1 behaviour. Record the change (r1 Spec issue 1 is still open in the doc).
2. **§11.4 keypad** (carried): `WorkoutKeypad` versus the stepper, and the assisted and minimum note strings.
3. **Typed load on a held movement (rule 9)** (carried): allow it with both the `HELD` marker and the `[Ben]` tag, ask first, or cap at the held load.
4. **TE-B13 versus legacy routines** (r1 Spec issue 2): the developer implemented the "trim today-only set counts" option (`withoutTodayOnlySets`), not "convert to a library routine on first edit". Ben or the PM should confirm that choice.

## Verified r1 fixes

| r1 item | Fix | Test |
|---|---|---|
| B1 | `exerciseId` is stamped in `applyDraftCommand` (`today-edits.ts:308`, caller value ignored). `sameTarget` treats loads per exercise. `clear` only affects the current exercise's load. Restore keeps the stamp. | `packages/domain/test/today-edits-full.test.ts` "review B1" (3 cases, including a forged id and unstamped edits); `apps/mobile/test/today-edits-full.test.ts` B1 ×2 (row, Start, Undo swap) |
| B2 | `keypadValue` uses only a load in the frame's unit and convention (`overview.ts:1147`) | Domain "review B2": lb rack opens at 80 lb each, kg rack at 37.5 |
| B3 | `templateCard.draftId`/`draftVersion`; Apply sends them; `updateCardState` checks the draft version; `Done` closes an unapplied card | Service B3 (old card refused, routine unchanged, fresh card applies 4 sets); screen-rule B3 |
| S1 | `withoutTodayOnlySets` (`routines.ts:527`), wired at `workout-services.ts:1208` | Domain S1; service TE-B13 for library and legacy, finishing the workout and checking the added exercise's own history |
| S2 | `createEditLane` queue, `nextDraftVersion`, `stepperCount`, `setsStepFrom`; draft-only stale message | Lane, version and count unit tests; service S2 |
| S3 | `loadInFrame` before the write (`workout-services.ts:3065`) | Service S3: total and lb refused, nothing written |
| N2/N3/N4/N6 | Card names the template's exercise; Add allows an exercise swapped away today; 250 ms debounce; >6 lines parse | Domain N2; persistence N6 |
