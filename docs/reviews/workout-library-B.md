# Review: Workouts library, slice B (full edit before start)

Branch `claude/workout-library` at `a372ae9` vs `claude/gracious-knuth-joxqpw`. Slice B is commits `e47cbc5`..`a372ae9`, after slice A's last commit `d1ba06b`.
Spec: `docs/design/overview-today-edits.md` §11 (TE11–TE17, TE-B1–TE-B14), `routines.md` §A2.5, mockup `docs/design/mockups/workout-library.html`, ADR 0022 (TE13 note), CLAUDE.md rules 1–10, minimal copy.
Reviewer: independent reviewer, 12 Oct 2026.

## Verdict: **CHANGES NEEDED**

The structure is sound. Every Start path (overview Start, next-session Start, Up next preview, the template card's dry run) plans through the one `planWithTodayEdits` path. The draft is fenced into the Start write. Writes are opId-idempotent and version-checked. Apply and Undo of `Update Push A` run in one transaction with Ben's `ActionRecord`. There is no migration: the new kinds live in the draft's JSON and are additive. Nothing in §11 calls the coach or needs the network.

There are three blocking issues:
- B1: Ben's typed load follows a swap onto a different exercise.
- B2: the load keypad opens in the wrong unit at an lb gym.
- B3: the `Update Push A` card can apply values Ben never saw.

B1 and B2 are load-convention and kg/lb errors. B3 is a stale proposal applied to newer state (rule 5). None of the three is covered by a test.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=120000` (full) | **pass**: 203 files, 4000 tests, 1 todo |
| Scratch probes (a temporary domain test file, deleted afterwards, not committed) | They confirmed B1 and B2 (outputs quoted below) and the superset sets behaviour (a member's `+` adds to that member only, and set indexes stay contiguous). |
| Migration | None. `TodayEditSchema` gains four variants and optional `author`/`actionId`. `SessionTodayEdits.added`/`edited` are optional. `update_routine.changes` max goes from 6 to 40 and `draft.editIds` is optional. Old drafts, sessions and action records still parse. |

## Blocking

### B1. A typed `load` survives a swap and is applied to the other exercise in the old convention

- **Where:** `packages/domain/src/session/today-edits.ts:303-307`, `:606-616`, `packages/domain/src/session/today-shape.ts:72-79`, `packages/domain/src/session/overview.ts:1123`.
  - The swap branch of `applyDraftCommand` leaves the slot's live `load` (and `reps`) edit alone.
  - `resolveTodayEdits` applies a `load` edit to whatever exercise the slot holds now.
  - `shapeTemplates` writes that load onto the working sets after the substitute's own targets are in place.
- **Failure:** Ben types `100 kg` on Bench press, finds the rack taken, and swaps to DB bench press.
  - Probe result: DB bench press, which has history that plans `35 kg each`, now plans `[null, null, null]`. The 100 kg `total` load replaced its own target, and the fit then dropped it because the convention doesn't match.
  - The row shows `—` with the `[Ben]` tag. The keypad opens at `100` in a `kg each` frame.
  - Start creates no-load sets.
  - The same happens in reverse: a per-hand load typed on the substitute lands on the barbell slot after `Undo swap`.
  - A `reps` edit carried onto a timed substitute is the same class of bug.
- **Rules broken:** TE6/TE16 ("own targets, never from another exercise") and the explicit-convention rule. Preview still equals Start, but both are wrong.
- **Fix:**
  - When a write changes the slot's exercise (swap, `clear_swap`, Undo of a swap, a swap's restore), remove the slot's `load` edit as `replaced` and have the swap's Undo bring it back.
  - Or, in `resolveTodayEdits`, apply a `load` only when it was made after the slot's current swap (or with no swap) and its convention matches the slot's exercise. Otherwise leave it un-applied but not pruned.
  - Add domain and service tests for: load then swap (the substitute's own target is planned, no `[Ben]` tag) and Undo swap (Ben's load is back).

### B2. The load keypad pre-fills Ben's intended value in the current gym's unit

- **Where:** `packages/domain/src/session/overview.ts:1093`, `:1123`. The frame unit is the item's (`eq.unit`). The pre-filled `value` is `benLoad.value` with no unit or convention check.
- **Failure:** Probe: Ben sets `37.5 kg each` on Incline (TE-B5) and then switches to a gym with an lb rack.
  - The row correctly shows `80 lb each`.
  - The keypad opens at `37.5 lb each`, the `{"unit":"lb","convention":"per_hand","value":37.5}` frame.
  - If he taps `Set target` without retyping, it stores `37.5 lb each` (about 17 kg), less than half his intent. Nothing says so.
  - Through B1, the same path also produces convention mismatches (`100` in `kg each`).
- **Fix:**
  - Pre-fill `benLoad` only when its unit and convention equal the frame's. Otherwise pre-fill the fitted planned value, which is already in the frame.
  - Or convert explicitly and show the converted value. Never relabel a number with another unit.
  - Add a test with an lb gym and a kg intent.

### B3. The `Update Push A` card is a stale proposal: Apply writes the current draft's values, not the lines shown

- **Where:** `apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:846-856` and `:859-868`, and `apps/mobile/src/services/workout-services.ts:2724-2728`.
  - `openUpdate` copies `page.templateCard.lines` into local state once. Nothing refreshes them while the card is open.
  - `applyUpdate` sends `draft.expectedVersion: page.draft.version`, which is the latest draft version, not the one the card was built from.
  - The service rebuilds the card from the current draft and keeps the lines whose `key` matches. Keys are per slot (`sets:<slotKey>`, `reps:<slotKey>`), not per value.
- **Failure:** Ben opens the card, which shows `Sets  Incline DB press 3 → 4`. He taps `[+]` on Incline (5 sets; the card stays open in Edit mode and the page reloads to draft v+1), then taps Apply. Push A is saved with **5** incline sets.
  - The same applies to a reps change made after the card opened.
  - `Done` hides the card but keeps its state, so it reappears with the old lines when Edit mode is reopened.
  - `updateCardState` only checks the routine's version, so the card never shows `Was suggested:` for a draft change.
- **Rules broken:** rule 5 (stale proposals are rejected, never applied to newer state) and rule 2 (a proposal's before/after is what Apply does).
- **Fix:**
  - Store the draft version (and the lines) on the card when it opens, and send that as `draft.expectedVersion`. The service then refuses with `stale`.
  - Have `updateCardState` treat a draft-version change like a routine change (`Was suggested:` and `Dismiss`). Alternatively, rebuild the lines from each fresh page and reset the ticks when they change.
  - Add a service test that rejects Apply with a card built at draft v3 when the draft is at v4. Add a screen-rule test for the out-of-date state.

## Should fix

### S1. Legacy routines carry today-only sets and reps into the next session (TE-B13)

- **Where:** `packages/domain/src/session/routines.ts:519-537` and `apps/mobile/src/services/workout-services.ts:1109`. A routine with no `source` (from before the library) is planned set for set from the last workout's next targets (`legacyTemplates`), and those are built with `count: 'done'`.
- **Failure (from code reading, no test exercises it):** Ben uses a legacy Push A, adds a 4th Incline set for today and finishes. The next Push A plans 4 Incline sets, with reps progressed from his today-only range, even though he never applied the change.
- **Test gap:** the TE-B13 service test (`apps/mobile/test/today-edits-full.test.ts:247`) discards the workout rather than finishing it. It therefore checks neither this nor "face pull's own history is updated".
- **Fix:**
  - Finish the workout in the TE-B13 test, once with a library routine and once with a legacy one.
  - For legacy routines, trim the planned entries to the template's working-set count for slots listed in the source session's `todayEdits.edited` with `sets`. If that seems wrong, see Spec issues.

### S2. Quick stepper taps are lost behind a misleading "Targets updated" toast

- **Where:** `apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:636-650` and `:748-752`. Each write sends `page.draft.version`. The page reloads asynchronously after `changed()`.
- **Failure:** Ben taps `[+]` twice quickly (3 → 5).
  - A tap during the in-flight write is silently dropped by the guard.
  - A tap after the write lands but before the reload sends the old version. It is rejected as `stale`, and the toast says `Targets updated` (`OVERVIEW_COPY.stale`), which is untrue.
  - TE14 promises steppers that "apply at once" with no toast.
- **Fix:**
  - Chain the next write on the version the previous write returned (`w.draft.version`), with the stepper value computed from that write's result. Or queue taps per slot.
  - Use `Couldn't save that edit.` (or a silent re-read) for a draft-only conflict, not `Targets updated`.

### S3. `overview.edit` accepts a `load` in any unit or convention

- **Where:** `apps/mobile/src/services/workout-services.ts:3198`; `inRange` at `today-edits.ts:180-181` checks only `0 ≤ value ≤ 2000`.
- **Failure:** The service stores a load whose convention doesn't match the slot's item or exercise, such as a `total` load on a dumbbell slot. The fit then drops it to no load. B1 and B2 both pass through here.
- **Fix:** Validate the load against the row's keypad frame (the item's unit and convention, else the exercise's) and return `invalid` otherwise. Test it.

## Nits

- **N1.** §11.4 specifies `WorkoutKeypad` with this gym's feasible step keys. The build uses a `NumberStepper` (the editor's Fixed load control). Some strings are not in §11.8: the stepper label `Assist` (`OverviewEditSheets.tsx:136`), and the notes `Most assistance here:`, `Least here:` and `Least assistance here:` (`overview.ts`, `todayLoadNote`). They are reasonable, but they should be added to the spec or brought into line with it.
- **N2.** `today-template.ts:79-109`: a `Sets` or `Reps` line on a swapped slot uses the substitute's name (`DB bench press 3 → 4`). If Ben leaves the `Changed` line unticked, Apply changes the Bench press slot. Name the template's exercise when the swap line isn't applied, or both.
- **N3.** `workout-services.ts:3236`: the Add list hides every base exercise, including one swapped away today. After swapping Bench to DB bench, Bench can't be added back.
- **N4.** `addCandidates` re-runs on every keystroke, with up to 40 history reads each time. Debounce the search.
- **N5.** A typed load on a `⚠ HELD` (pain-flagged) exercise replaces the held load with no prompt, and the marker still reads `HELD`. This is Ben's own choice, not progression, but see Spec issues.
- **N6.** The persistence test for Apply and Undo (`drafts.test.ts`, "Update Push A") builds the action by hand. The service test covers the real path, so this is fine. Add one assertion that `changes.length` above 6 parses, since the cap was raised for this card.

## Spec issues

1. **Card freshness (§11.5).** "Out of date" is defined only as "Push A changed since the page loaded". The card can also be overtaken by Ben's own draft edits while it is open, which is the B3 scenario. The spec should say the card follows the draft, or goes `Was suggested:` when the draft moves.
2. **TE-B13 versus legacy routines.** The acceptance check assumes the template's set count wins next time. Legacy (pre-library) routines are planned set for set from the last workout by design (ADR 0019 era). Ben or the PM should decide whether today-only edits are excluded from that copy (S1), or whether legacy routines are converted to library routines on first edit.
3. **Typed load on a held movement (rule 9).** §11 doesn't say what happens. Options: allow it with the `HELD` marker and the `[Ben]` tag both shown; ask first, as EL9 does for a flagged pick; or cap at the held load.
4. **§11.4 keypad.** `WorkoutKeypad` with step keys versus the built stepper (N1). Pick one.

## Positive notes

- `planWithTodayEdits` is the single planning path for the dry run, Start, Up next and the card (TE-B2). The mixed-kinds test covers every combination.
- TE-B5 is tested for the rack max, lb, assisted (toward more assistance) and back-off sets keeping their loads.
- Added exercises plan from their own history or with no load, and never from another exercise. `Remove` and Undo carry the slot's own edits with them.
- Apply goes through the editor's `editRoutine` (versions, opId, Main, structure times). Apply is idempotent on `update-routine:<opId>`, refused once the routine moves, and Undo brings the draft edits back with `keepLive`.
