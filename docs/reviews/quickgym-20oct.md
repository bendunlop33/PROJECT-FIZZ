# Review: Quick gym setup (claude/quickgym-20oct, 20 Oct)

**Verdict: CHANGES NEEDED**

Scope: diff `1e48041..aeb8902` (6 commits) against Ben's 20 Oct request, CLAUDE.md rules 2–6 and 10, ADR 0029 and the CHANGELOG entry. Checked by the reviewer:

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npm run check:migrations`: "Migrations OK: 1 to 25".
- Targeted vitest (domain quick-gym, coach gym-update, migration 25, app quick-gym, backup, coach-store): 6 files, 94 tests passed.
- Full suite (`vitest run --maxWorkers=2`): 373 files passed, 7242 tests passed, 1 todo, exit 0.
- I also ran a throwaway probe (deleted afterwards) of `gymChangeAsked`, `gymLearnFor`/`planGymLearn` and `dumbbellLoadsFor`. Its output is quoted below.

What holds up well:
- Add gym is one screen. Full gym is preselected, so it takes a name, an optional step chip and Save.
- Presets are written natively in kg and lb.
- Assumed/confirmed reuses `detailsSource`, and the gym screen shows it.
- `GymEdit` is version-checked with a before/after and has Undo.
- `notFor` goes through `mapEquipment` and `equipmentForExercise`, so every build, swap and picker respects it.
- Make full gym keeps every item and respects `missingKinds`.
- Migration 25 copies migration 23's table, indexes and no-delete trigger exactly.
- The new gym fields round-trip through backup.
- Existing gyms are only changed by Make full gym.

## Blocking

### B1. `update_gym` applies the coach's change at once on questions, hedges and unrelated sentences (rule 3)
`packages/coach/src/gym-update.ts:22` (`GYM_FACT`), `:45-51` (`gymChangeAsked`), used at `:111`.

`GYM_FACT` matches a bare `\bno\b`, `there is`, `go up in`, `broken` and similar. `gymChangeAsked` treats any match as Ben stating a fact. It applies in two cases:
- the model claims `benAsked: true` with a quote that contains a match;
- there is no claim (`benAsked` null or absent), and the whole message matches.

Unlike `verifyAsked`/`quoteAsks`, it never checks `OPINION_ONLY` or whether the sentence is a question. Probe results (`mentionsGymSetup` → `gymChangeAsked`):

| Ben's message | claim | applies at once? |
|---|---|---|
| "the dumbbells here go up in 2s maybe? what do you think" | `benAsked: true`, quote "the dumbbells here go up in 2s" | **true** |
| same | none | **true** |
| "No idea what this gym has, what do you think I should do today?" | none | **true** |
| "Does this gym have no leg press? not sure" | `true`, quote | **true** |
| "there is a queue for the leg press here" | none | **true** |

Failure scenario: Ben asks "No idea what this gym has, what do you think?" The model calls `update_gym` with `remove: weight_stack` and no claim. Every cable and machine at the gym is retired and added to `missingKinds` straight away, and the app shows it as done rather than offering it. Rule 3 says a change the coach raises itself must be offered and not applied until Ben accepts. Undo limits the damage but doesn't make this acceptable. The app test at `apps/mobile/test/quick-gym.test.ts:186` only passes because the stub model sends `benAsked: false`.

Fix:
- Route through `verifyAsked` with a gym fallback, so a verified quote must also pass `quoteAsks`, and opinion-only or question messages become offers.
- Drop the bare `no` from `GYM_FACT`, or require a negation next to an equipment noun ("no leg press", "doesn't have a …").
- With no claim, default to an offer unless the message is a plain declarative gym fact without `?`.
- Add tests for the rows above.

### B2. One accepted "Stack goes up in 7 kg?" rewrites every machine (or every cable) at the gym and marks it confirmed (rule 4)
`packages/domain/src/quick-gym.ts:466-473` (`gymLearnFor` stack branch), `:489-504` (`planGymLearn` stack branch).

A full gym has one `Machines` weight-stack item for every selectorised machine and one `Cable station` item for every cable exercise.

Failure scenario: on leg extension Ben types 7 kg. The chip says "Stack goes up in 7 kg?" and doesn't name the item. He taps it:
1. `Machines` becomes `[7, 14, …, 119]` with `detailsSource: 'user'`.
2. Chest press, leg curl, shoulder press and every other machine exercise now snap to multiples of 7 (40 → 42), which those machines may not be able to make.
3. Because the item is now "confirmed", `gymLearnFor` won't offer a stack chip again (`!isAssumed(eq)` at `:466`). `Why?` stops saying "Assumed stack step", and the gym screen drops the Assumed tag.

The wrong model then spreads silently, with no learn path to correct it. The step guess is also weak:
- 12 kg proposes a 6 kg step;
- 3 kg proposes a 3 kg step for the whole family;
- 22.5 kg proposes 2.5 kg, which doubles the possible loads on every machine.

Fix: learn a stack step per exercise, not per family. On accept, add a confirmed `weight_stack` item for that machine (for example "Leg extension", with the learned step and the family's top) and mark the family item `notFor` that exercise, reusing the existing `notFor` mechanism so `mapEquipment` picks the new item. Alternatively, name the item in the chip ("Machines go up in 7 kg?") and leave the family assumed. Add a test that a learned step on one machine exercise leaves another machine exercise's snapping unchanged.

## Should fix

### S1. Learning one value marks the whole item confirmed (rule 6 honesty)
`packages/domain/src/quick-gym.ts:483, 488, 504`.

`add_dumbbell` and `stack_max` set `detailsSource: 'user'` on the whole rack or stack. After "Add 22 kg dumbbells here?", the other 20 assumed values (2.5–50 at 2.5) show as confirmed on the gym screen, and `Why?` no longer says "Assumed dumbbells". Ben confirmed one dumbbell, not the rack.

Fix: keep `'preset'` when the learn only adds a value. Confirm only on an explicit edit or confirm, or on a learned whole-rack step.

### S2. A 1 kg dumbbell step assumes 1 kg steps up to 50 kg, and nothing learns that a value is missing
`packages/domain/src/quick-gym.ts:74-79`, `FULL_DUMBBELL_MAX` `:45`.

`dumbbellLoadsFor('kg', 1, 50)` gives 1, 2, …, 50, so it assumes 23, 27, 33 and 47 kg dumbbells. lb 2.5 gives 2.5 → 120 in 2.5 steps. The task asked for "1–10 kg in 1s if step 1, then the step".

ADR 0029's Consequences says "the learn chip and Not at this gym correct it the first time Ben meets it", but no path removes an assumed value. The chip only adds loads, and Not at this gym only removes exercises. If the progression targets 23 kg and Ben uses 22 or 24, the 23 kg dumbbell stays assumed forever.

Fix: a realistic ladder (1 kg to 10 then 2 or 2.5; lb 2.5 to 25 then 5). Also either a "No 23 kg here" learn, when Ben logs a different load next to an assumed target that he couldn't use, or correct the ADR wording.

### S3. Undo of a learned load reports success even when today's workout keeps the change
`apps/mobile/src/services/app-services.ts:571-574`.

`loop.gymSwitch.undo(...)` is awaited with `.catch(() => null)`, and its `{ ok: false }` result is ignored. `gymSwitch.undo` refuses once the fingerprint moved, for example after Ben logs the 22 kg set. The gym is still reverted and `{ ok: true }` is returned, so the toast says it's undone while today's snapshot still has the 22 kg dumbbell.

Fix: check the result. If today can't be undone, still revert the gym but return a message such as "Gym undone; today keeps it", or refuse both. Add a test where a set is logged between accept and Undo.

### S4. The learn chip is missing from Table mode
`apps/mobile/src/screens/workout/WorkoutScreen.tsx:2032` (Focus only). The request was for when Ben "logs or types a load". Table mode is a primary logging surface, and there an off-profile load only gets the warning. The developer has flagged this as open. It should be built, or Ben should explicitly accept it.

### S5. Test gaps on the risky paths
These are not covered:
- the B1 message shapes;
- the B2 cross-exercise effect;
- S3 (Undo after the workout moved on);
- a concurrent or stale `tapGymProposal` after Ben's Undo of an applied card;
- the `GymSetupFlow` screen itself, beyond the service path (type switching state, see N1).

## Nits

- **N1** `apps/mobile/src/screens/setup/GymSetupFlow.tsx:59, 117-139`. Choose Home → "None", then switch to Hotel / small. `dumbbellMax` stays null, no "Dumbbells up to" chip is selected, the step row is hidden, and the hotel gym saves with no dumbbells. Reset `dumbbellMax` to the default when leaving Home.
- **N2** `GymSetupFlow.tsx:56`. The name defaults to "Main gym" on every Add gym, including a second or hotel gym. Default to empty, or to "Main gym" only on the first gym.
- **N3** `quick-gym.ts:599`. The coach's `dumbbells` op keeps an existing `maxLoad`. "Up to 60" on a rack with `maxLoad: 50` silently caps at 50. `planGymLearn` handles this case at `:488`; this op doesn't.
- **N4** `quick-gym.ts:463`. The dumbbell chip fires for any 0.25-multiple up to 100 kg ("Add 23.75 kg / 97.5 kg dumbbells here?" for a typo). Bound it relative to the rack, for example ≤ top + 2 steps, on a 0.5 grid.
- **N5** `quick-gym.ts:340-345`. Make full gym adds only missing *kinds*. A gym with one confirmed cable stack never gets the `Machines` stack, so machine exercises snap to the cable's range. This is acceptable but should be documented in the ADR.
- **N6** The "offered once" memory (`learnAnswered`) is in component state. It is lost on force-close and on remount. The developer has flagged this.
- **N7** `docs/design/gym-editor.md` and `docs/design/onboarding.md` still describe the checklist flow.

## Spec issues

1. **Brief text still says the opposite.** The brief's gym-editor paragraph (`training-app-build-brief.md:573`: "Gym creation starts with a name and broad equipment checklist, then adds exact details…"; "'This gym has no cable machine' updates the saved inventory only through an explicit edit") and `getEquipmentSnapshot` ("confirmed permanent setup", `:279`) conflict with assumed-by-default equipment and with the coach applying on Ben's words. The CHANGELOG entry should say it supersedes those lines, and the v0.2 amendment summary at the top of the brief should mention it.
2. **"Set stack step for a machine family" conflicts with rule 4.** One weight-stack item stands for every machine, so any family-level step learned from one machine is wrong for the rest. This is the root of B2. The equipment model needs per-machine stacks, or at least per-exercise overrides, before stack learning is safe.
3. **"Marks the needed equipment kind missing"** would remove every cable and machine exercise for one missing leg extension. The per-exercise `notFor` choice is right. Ben should confirm it (it's listed as open).
4. **Kettlebells, EZ / trap bar, Smith machine, benches and racks** were requested in the full gym, but no gym equipment kind exists for them (ADR 0010). They need their own slice. Until then kettlebell and EZ-bar exercises can't be planned at a "full gym", which Ben may find surprising.
5. **The design step was skipped.** No `docs/design/` spec exists for quick setup, so there are no designer acceptance checks to verify against. The defaults (2.5 kg step, 50 kg top, 5 kg stacks, 8 plates, hotel cables on) and the no-gym "typical gym" staying on the old preset are open decisions for Ben.

## Test runs (reviewer)

All green: typecheck, lint, migrations 1–25, and the full suite (373 files, 7242 passed, 1 todo). The blocking findings are logic and rule issues that the current tests don't exercise, not test failures.
