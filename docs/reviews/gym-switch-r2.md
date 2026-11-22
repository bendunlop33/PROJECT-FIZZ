# Review round 2: gym switch and shared re-snap (`claude/gym-switch`)

**Verdict: CHANGES NEEDED**

Reviewer: independent reviewer agent, 2026-10-10.
Scope: `git log claude/gracious-knuth-joxqpw..HEAD`, 20 commits. This round concentrates on the 8 fix commits after round 1 (`93a1bef..b5f2f61`: 2d6169e, 503d86c, 9dfbbe3, b871153, f169e0a, 6f6912a, 0d029a7, b5f2f61), and re-reads the code they touch.
Checked against `docs/design/gym-switch.md`, ADR 0019, CLAUDE.md rules 2–6, 9 and 10, round 1 (`docs/reviews/gym-switch.md`) and competitor-landscape #2(g) and #6.

## How this was checked

- `npm run check` in the worktree: typecheck, lint, catalogue and guide checks pass, and `vitest run` passes 107 files and 1445 tests. The 30 s `testTimeout` (N8) made the run stable under load.
- I read every diff in the fix commits and the service code that feeds them (`nextTargetsOf`, `planFor`, `applySwitch`).
- I ran throwaway probe tests against the real `finishedAcrossGyms()` fixture, `nextTargetsFor` and `buildWorkoutSummary`. They're deleted and weren't committed. They confirm B1 below.

### Round 1 status

| Round 1 | Status |
|---|---|
| B1 Repeat / next-session duplicate the split exercise | **Partly fixed.** Repeat copies the block once, and Past workouts lists it once (`doneExerciseNames`). The *targets* that feed Start next session are still computed per row. See new B1. |
| B2 Summary unit/convention across parts | Fixed. Each part carries its own unit when they differ, and there's a kg→lb test. |
| B3 Review sheet Out of date / write error | Fixed. `reviewSheetView` reads `switchCardView`, so it shows `Check again`/`Dismiss` and `Try again`, and it's tested. A remaining gap with non-write errors is M1 below. |
| M1 Reducer rule 4 for slots with no equipment | Fixed (`gym-switch.ts:536-543`), and tested. The suggested compatible-kind check isn't done (N2). |
| M2 Log during apply | Fixed. `logBlockedBySwitch` holds Log from `applying` until the reload, and `reload()` never rejects, so the card can't stick in `applying`. |
| M3 Unsaved edits after the card opened | Fixed. The check now uses the reducer's `draftsReplaced` plus `editFitsCurrentEquipment`. |
| M4 Force-close card restore | Deferred to the proposals store and recorded in ADR 0019. Accepted. |
| N1–N8 | N1, N3, N4, N5, N6 and N8 are fixed. N2 has been decided (`Not now` dismisses and `Close` keeps the card). N7 hasn't changed, which is acceptable. |

What is good: one shared fit path, exact Undo that survives a relaunch, fingerprint-bound stale rejection (rule 5), pain holds (rule 9), the per-visit equipment list (`GymChange.equipment`) with stack-aware Undo, the cap refusal before the schema limit, and voice yes/no scoped to an open card. The new tests cover the round-1 gaps well, including the double switch (Main → Hotel → Home → Main).

## Blocking

### B1. Start next session and the Summary's "Next time" still treat each part of a split exercise as its own exercise. The next session silently drops sets, and the Summary shows two conflicting targets.
- `apps/mobile/src/services/workout-services.ts:409-425` (`nextTargetsOf`)
- `packages/domain/src/session/summary.ts:281-311` (the `Next time` loop over `exercises`)

`nextTargetsOf` loops over `source.exercises` row by row and keeps the **first** row per `exerciseId` (`out.has`). It passes `workingSets: done.length` for that row only, and uses that row's equipment. For a continuation block, that row is the root part, which holds only the sets done before the switch.

**Failure path (probe-confirmed with `finishedAcrossGyms()`):**
1. Ben does Incline DB press, set 1 at Main (32.5 kg each × 9).
2. He switches to Hotel and does sets 2–3 there (20 kg each × 12, × 11), then finishes.
3. The next day, Today's `Start workout` card (`next.preview`, `:848`) and `Start` (`:471`) call `nextTargetsOf`.

The rule is built with `workingSets: 1` on Main dumbbells, so `plannedSetsFromTargets` returns **one** set (`[[32.5, 8–12]]`). `startWorkoutFromSession` then uses that one-entry target list instead of the three done sets (`repeat.ts:110-114`). The next session has **1** set of Incline instead of 3, labelled `built_in_rule`, and nothing says why. Round 1's doubling became a cut to a third. The new domain test (`gym-switch.test.ts`, "Start next session … applies the targets once") hand-builds a 3-entry target map, so it never runs the service path.

The Summary has the same problem. `Next time` evaluates every row separately. With Main 32.5×12 and Hotel 20×12, 20×12 the probe gives **two** rows for one exercise: `Incline DB press: Target 35 kg each × 8–12` and `Incline DB press: Target 20 kg each × 13`. The Summary contradicts itself, and neither row matches what Start next session will build. This breaks rule 3 (deterministic targets, each shown with its reason) and GS-S4 ("every reader that treats a row as an exercise groups by `continuesFromId` first"), which ADR 0019 now says is done for "Start next session".

**Fix:** group by `partRootOf` in both places, using one shared pure domain helper so the service and the Summary can't disagree:
- Set `workingSets` to the block's done working sets.
- Choose one deciding part and record the choice in the reason. Suggested: the latest part that has equipment, which matches `repeat.ts` `sourceEq`. This is a spec decision; see Spec issue 1.
- Emit one `Next time` row per block.

Add a service-level test (harness: log 1 set at Main, switch, log 2 at Hotel, finish, then `next.preview` and `next.start`) that expects one Incline exercise with 3 sets. Add a Summary test that expects one `Next time` row for the block.

## Should fix (not blocking)

### M1. A non-write refusal from `Switch` is silent: the card goes back to Ready with `Switch` enabled, and the reducer's reason is never shown
`apps/mobile/src/screens/workout/WorkoutScreen.tsx:511-516`.

On `!r.ok` with any code other than `write_failed`, the card is reset to `status: 'ready'` and `reload()` runs. That suits `stale_version`, because the fingerprint changed and the card then shows Out of date. It doesn't suit `invalid_values`, where the plan didn't change, so the card isn't stale.

**Failure path:** the new N5 cap. Once a workout has 49 change/Undo records, `Switch` returns `invalid_values` "This workout has changed gym too many times…". The screen drops that message, the card shows `Switch` again, and every tap does nothing. The same happens for any other reducer refusal (rule-4 rejection, "equipment belongs to another gym"). This is the "never a silent failure" gap round 1 B3 was about, by another route. The new N5 message is tested in the domain but never reaches Ben.

**Fix:** for codes other than `write_failed` and `stale_version`, show `r.error.message` (a toast, or the card's warning line) and dismiss the card, or put it in a terminal "Can't switch" state without `Switch`. Better still, have `propose` refuse up front when the cap is reached. Add an app test.

## Nits

- **N1.** `nextTargetsOf` resolves equipment with `equipmentSnapshot.find((e) => e.id === sx.equipmentId)` (`workout-services.ts:414`). That ignores `equipmentVersion` (GS-S3) and can pick an older version of an item edited mid-workout. Use `equipmentOfRow`, as `repeat.ts` does. Fold this into the B1 fix.
- **N2.** The reducer's rule-4 check still accepts a slot item whose `kind` isn't in the exercise's compatible kinds (round 1 M1, second half). The app can't reach this today, and a future coach or tool path could.
- **N3.** `sheetClosesOn('check_again')` closes the review sheet (`gym-switch-card.ts`). If the re-checked card again has 5 or more lines, Ben has to tap `Review all …` again to reach `Switch`. Consider keeping the sheet open over the replaced card.
- **N4.** Repeat of a plates→stack (or kg→lb) split block copies the earlier part's sets as templates in that part's convention. `snapPlanToGym` drops them with `convention_mismatch`, or converts the units. The warning note covers the drop, but a block-level note ("first set was on a different set-up") would read better. Low priority.
- **N5.** The cap check is `length + 2 > 50`, so a workout that ends with an odd number of records refuses at 49, not 50. That's harmless, and it's documented as "a change and its Undo". It's mentioned only so the boundary is clear.

## Tests

The fix commits add good coverage: B2 kg→lb, Repeat once per block, the reducer null-slot rejection, `editFitsCurrentEquipment`, the double switch, the per-visit equipment list, the cap, the review sheet's error and stale states, and `logBlockedBySwitch`. Still missing:

- The service path of next-session targets for a split workout (B1). The current test supplies the targets by hand.
- Summary `Next time` for a split block (B1).
- An `invalid_values` refusal on `Switch` in the app (M1).

## Spec issues (for the designer / Ben, not the developer)

1. **The spec doesn't say which part of a split exercise drives next-session targets.** The candidates are the gym of the last part (Hotel 20 kg), the original gym (Main 32.5 kg), or the part on the equipment of the gym the next session is started at. That gym is only known at Start, so the Summary's `Next time` would need to commit to one. Proposal: the Summary uses the latest part with equipment and says so in the reason ("from your Hotel sets"). At Start, the shared fit maps it to the chosen gym, as Repeat does. `workingSets` is the block total. Add this to §6.5/§8 next to the GS-S4 grouping rule.
2. Round 1 spec issues 1, 2 and 4 are still open in `docs/design/gym-switch.md`: the unchecked load for an unpinned equipped exercise, the grouping rule for every reader (now in ADR 0019 but not in the spec), and the meaning of GS-S3. Issue 3 (force-close card) is recorded as deferred in ADR 0019, and the spec's §3.2 should say the same.
