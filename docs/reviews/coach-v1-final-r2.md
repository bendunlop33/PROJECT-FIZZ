VERDICT: CHANGES NEEDED

# Review: coach v1, final r2 (branch `claude/coach`)

Reviewer, 11 Oct 2026. Range: `git log claude/gracious-knuth-joxqpw..HEAD`, which is 126 files and +20.8k/−98 against main. I checked it against:
- CLAUDE.md rules 1–10 and the minimal-copy convention;
- ADR 0020, which was ADR 0019 before the renumber;
- the coach specs;
- the PM decisions of 10 Oct: honesty is structural, merge main first, and leave clean seams.

This round re-checks the fixes for `coach-v1-final.md` (B1–B2, S1–S8, N1–N7) and looks for anything new.

## What I ran

- `npm run typecheck`: pass. `npm run lint`: pass.
- `npx vitest run --testTimeout=120000`: **152 files, 3201 passed, 2 todo, 0 failed.**
- `git merge-base --is-ancestor claude/gracious-knuth-joxqpw HEAD`: true. Main is fully merged.
- A probe test in `packages/domain/test` (temporary, deleted): coach adjust at Main, then a gym switch to the hotel, then the coach's Undo. Result below in B1.
- Scans of the changed files:
  - no Reanimated, worklets or Skia in the coach UI;
  - no `console.*` logging of health data;
  - no keys, tokens or `.env` files;
  - only Hermes-safe APIs (`.at()` is fine).

## Prior findings: status

| Prior | Status |
|---|---|
| B1 merge main, renumber migration and ADR | **Fixed.** Main is merged. Coach storage is migration 6 (`0006-coach.ts`) and the ADR is 0020. `schema5-in-place.test.ts` migrates a populated schema-5 database. `withCoachTargets` output goes through the shared snap (`coach-targets-gym.test.ts`: 35 kg each is capped to the hotel's 20). The reducer's rule-4 check covers `adjust_pending_targets`, including max and no-equipment-left. |
| B2 body-part word as exercise name | **Fixed.** `exercisesNamedForPain` (`packages/domain/src/coach/pain-words.ts:487`) matches whole names only, and returns `[]` whenever a body part is named, so every increase is blocked. Tested. |
| S1 offer with no pending set on that exercise | **Fixed.** The check is per row, and the accepted offer is scoped to that row in `createAdjustExecutor` (`onlySessionExerciseId`). |
| S2 / S3 used-by semantics, discard | **Fixed.** `next_target_uses` is keyed by the start's opId and resolved at read time against live, non-discarded sessions. An unrelated workout and a discarded start no longer consume the targets. Tested in `coach-flow.test.ts:413`. |
| S4 rule 6, no history | **Fixed.** `NO_TRAINING_HISTORY` is in context, and the Today chip is gone. |
| S5 future-state claims | **Fixed as a backstop.** `futureStateClaim` is added, the Summary note drops numbered sentences without a live row, and `Sore or pain?` now shows outside a workout. |
| S6 offer log in memory | **Fixed.** It is stored in `coach_offers`. |
| S7 negated "more sets" | **Fixed.** `asksForMoreSets` handles it, with tests. |
| S8 path B′ | **Recorded** as deferred in ADR 0020 §10, Needs Ben. |
| N1, N2, N3, N5, N7 | Fixed. |
| N4, N6 | Unchanged. Still device-only or later items. |

Still in place from the last round:
- Structural honesty: a strict reply function, cards only from committed `ActionRecord`s, and the slot shows no model words.
- Version-gated, opId-idempotent writes.
- No paid route.
- Your data and Coaching knowledge kept separate.
- Logging offline.

## Blocking

### B1. Undoing a coach change after a gym switch restores the old gym's load, which can be past the new gym's max (rule 4)

The bug is in `packages/domain/src/session/reducer.ts:1377-1405` (`handleRevertTargetAdjustment`):
- It restores `s.planned.coach.before` verbatim.
- `applyChangeGym` (`packages/domain/src/session/gym-switch.ts:719`) re-fits `planned.load`, but it keeps `planned.source: 'coach'` and `planned.coach.before` from the old gym.
- `isSuperseded` still reports the adjustment as in place, so the slot banner, the `⋯` → `Undo coach change` action and the sheet card all still offer Undo.
- The store's undo (`packages/persistence/src/coach.ts:502`) just runs the reducer. Nothing checks the restored load against the row's current equipment.

**Failure scenario (reproduced with the probe):**
1. Push A at Main: Incline DB press is 32.5 kg each.
2. Ben asks the coach for lighter sets, and it sets 17.5 kg each.
3. He switches to Hotel · Lisbon, where the rack's max is 20 kg each. The 17.5 kg target stays.
4. He taps Undo on the coach change. All three pending sets go back to **32.5 kg each** at the hotel. The reducer accepts this (`ok: true`, `gymId` is still the hotel).

The set card now shows a target the hotel rack can't make, past the equipment's max. The same applies to sets the coach removed: `removedSetIds` comes back with the old gym's `planned` and `sessionExerciseId`, which may be a pre-split row.

**Fix (either is fine):**
- (a) In `handleRevertTargetAdjustment`, run every restored `before` through the shared fit (`snapPlanToGym`/`equipmentOfRow`) for the row's current equipment. Remap removed sets to their current row, the same way the gym switch moves sets.
- (b) Refuse the revert when a `change_gym` entry is newer than the adjustment, and return `changed_since` ("Couldn't undo: gym changed."). Also mark the adjustment superseded in `isSuperseded`, so the Undo button disappears.

Either way, add tests for:
- adjust at Main, switch to the hotel, Undo: the result is capped or refused, never 32.5;
- adjust at the hotel, switch to Main, Undo;
- a removed set after a switch that split the row.

## Should fix

### S1. In a workout, `Pain` flags the exercise in focus, not the one Ben named (rule 9)

The code is in `apps/mobile/src/screens/coach/CoachSheetScreen.tsx:236-238` (`pain()`) and `:184`. In an active workout, a pain/unclear answer always offers `Pain`, which flags `workout.exercise`, the current focus row.

**Failure scenario.** Ben is on squats and types "bench earlier hurt my shoulder, go lighter".
- The turn's `messagePain` blocks increases for this turn only.
- Tapping `Pain` saves a flag for **Back squat** (`Pain noted for Back squat.`).
- No flag is saved for Bench press, so the built-in rule and the coach's next-session targets can still increase bench next time.

**Fix.** In a workout too, use `exercisesNamedIn(words, session exercises)`:
- if exactly one movement is named, flag it;
- if several are named, show them as chips (the outside-workout picker already exists);
- fall back to the focus row only when nothing is named.

Add a test.

## Nits

- **N1.** `asksForMoreSets` (`packages/coach/src/request.ts:598`) counts questions as asks. "Should I do more sets?" opens D1's +1 set next session, though Ben only asked a question. Skip clauses that are questions (`isQuestion`).
- **N2.** `summaryNoteSentences` (`apps/mobile/src/coach/next-time-view.ts:134`) checks only that a live row exists for the exercise, not that the sentence's number matches the row. "Bench goes to 100 next time" beside a saved 97.5 row is kept. It also misses aliases ("RDL" for Romanian deadlift). This is a backstop only, so it is a low priority.
- **N3.** `offerAfterLog` and `offerLogOf` (`apps/mobile/src/coach/coach-service.ts:115`): two logs in quick succession can both read an empty log before the first `recordOffer` lands. The `offerCheck` ref shows only the latest offer, so this is cosmetic.
- **N4.** `0006-coach.ts` was edited in place in this round (new `next_target_uses` and `coach_offers` tables). That is fine only because migration 6 has never been in a build Ben installed. From the first `[ios-build]` of this branch onward, add a migration 7 rather than editing 6.
- **N5.** The refusal text `Only <name> was in question. Sets unchanged.` (`packages/coach/src/executors.ts`) is longer than the minimal-copy convention wants. `Only <name>. No change.` would do.
- **N6.** The prior N4 (Hermes `\p{L}` regexes) and N6 (playbook candidates in backups) still stand until a device build and the Delete/Export feature exist.

## Tests

The coverage is good. The new tests cover:
- body-part pain fallback;
- per-row offers and scope;
- the offer log surviving a relaunch;
- unrelated workout vs. a start from the source;
- discard-then-restart;
- the schema-5 to 6 migration;
- the coach target re-snapped at another gym;
- reducer rule-4 checks on coach loads;
- negated "more sets";
- future-state claims;
- Undo error paths.

Missing:
- coach Undo after a gym switch (B1);
- in-workout pain naming another exercise (S1);
- a question about more sets (N1).

## Spec issues (for Ben and the PM)

1. **ADR 0020 is still `Proposed`**, with Needs Ben items:
   - the v1 cuts (including path B′ and history reads);
   - `add_playbook_candidate` needs;
   - the structural `No change made.`;
   - CC4 changed from "replace" to "drop".

   The code follows the PM decision. The contract text and the ADR status need Ben's sign-off.
2. **Device proof is still outstanding.**
   - C0/S3: no strict function-tool round trip has run on the plan route.
   - S4 and S5 haven't run.
   - The JWKS check hasn't run on the iPhone.
   - `COACH_CHAT_IN_BUILD = true` (`apps/mobile/src/ai/coach-connection-view.ts:49`). That is honest, because failures map to statuses, but nothing in the coach may be called working until it runs on the device.
3. **The claim backstop keeps growing.** It is now 1,265 lines (`packages/coach/src/claims.ts`). With honesty structural, the PM or Ben should cap it rather than keep adding phrase rows.
4. **Summary chat still can't revise next-session targets.** It runs as a `general` turn. The spec should say whether it may.
5. **The gym switch spec doesn't cover coach-sourced targets.** gym-switch §4 and coach-adjustments §4.3 don't say what a coach adjustment's Undo means after the gym changed (see B1). Pick re-fit or refuse, and record the choice in ADR 0019 or 0020.
