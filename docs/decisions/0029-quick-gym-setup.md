# 0029: Quick gym setup: assumed equipment, learned while training

**Status:** Ben asked on 20 Oct 2026 (CHANGELOG, same date). Built, not run on his iPhone yet. Everything is TypeScript plus migration 25, so a new JS bundle or `.ipa` carries it. No native change.

## Context

The gym editor asked for each item's numbers (plates, rack, stacks). Ben: "too time consuming … just assume a gym has lots of dumbbells and plates. Just ask for the interval for dumbbells … default main gym has everything and if it doesn't then we update as we go." Rule 4 (loads achievable on the gym's real equipment) is unchanged. What changes is how the app comes to know the equipment.

## Decision

1. **Assumed vs confirmed reuses `detailsSource`** (`'preset'` = assumed, `'user'` = confirmed). It was already there for presets ("typical values, not checked"), so a second field (`source: 'assumed' | 'confirmed'`) would duplicate it. Snapping treats assumed items like any other: loads only from the item's list, never past its max.
2. **Quick setups** are pure domain builders (`buildQuickGymDraft`: `full`, `small`, `home`), written natively in kg or lb. The gym records how it was described (`Gym.setup`), which the coach reads as one line (`full gym (assumed)`).
3. **Learning is a `GymEdit`**: the gym and item records before and after. It is applied in one transaction with every record version-checked, and a retry that already landed is a duplicate (rule 5). Undo saves each `before` as a new version, or retires an item the edit added. It is refused once anything changed since. Make full gym, Not at this gym, Put back, the learn chip and the coach all use it.
4. **`Not at this gym` is per exercise** (`EquipmentInstance.notFor`). `mapEquipment` and the pickers skip an item marked not for the exercise. Every build, swap and picker already goes through them, and the workout snapshot carries the field, so no caller needed changing. A whole kind Ben says is missing is retired and remembered in `Gym.missingKinds`, which `Make full gym` respects.
5. **The coach's `update_gym`** is offered when Ben's words are about a gym (`mentionsGymSetup`). It applies when he said it (`gymChangeAsked`: his words, or a verified quote that states a gym fact). Otherwise it is a card with exactly the edit, which Ben's Apply saves as his own record (`proposalId`). The coach store writes and undoes the edit in the same transaction as the record. Migration 25 adds the action kind.

## Consequences

- A gym can have loads that don't exist (an assumed 23 kg dumbbell at a 1 kg step). The learn chip and `Not at this gym` correct it the first time Ben meets it. The gym screen and `Why?` say which items are assumed.
- Kinds with no gym-profile schema (kettlebells, EZ / trap bar, Smith machine, benches) are still not modelled. The full gym can't assume them until an equipment slice adds them.
- Stack steps learned from one load are a guess (the most common step that divides it). So they are only ever offered, never applied silently, and only for assumed stacks.
