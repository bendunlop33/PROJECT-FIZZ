# 0029: Quick gym setup: assumed equipment, learned while training

**Status:** Ben asked on 20 Oct 2026 (CHANGELOG, same date). Built, not run on his iPhone yet. Everything is TypeScript plus migration 26 (written as 25, renumbered on merge after plan-pause), so a new JS bundle or `.ipa` carries it. No native change.

## Context

The gym editor asked for each item's numbers (plates, rack, stacks). Ben: "too time consuming … just assume a gym has lots of dumbbells and plates. Just ask for the interval for dumbbells … default main gym has everything and if it doesn't then we update as we go." Rule 4 (loads achievable on the gym's real equipment) is unchanged. What changes is how the app comes to know the equipment.

## Decision

1. **Assumed vs confirmed reuses `detailsSource`** (`'preset'` = assumed, `'user'` = confirmed). It was already there for presets ("typical values, not checked"), so a second field (`source: 'assumed' | 'confirmed'`) would duplicate it. Snapping treats assumed items like any other: loads only from the item's list, never past its max.
2. **Quick setups** are pure domain builders (`buildQuickGymDraft`: `full`, `small`, `home`), written natively in kg or lb. The gym records how it was described (`Gym.setup`), which the coach reads as one line (`full gym (assumed)`).
3. **Learning is a `GymEdit`**: the gym and item records before and after. It is applied in one transaction with every record version-checked, and a retry that already landed is a duplicate (rule 5). Undo saves each `before` as a new version, or retires an item the edit added. It is refused once anything changed since. Make full gym, Not at this gym, Put back, the learn chip and the coach all use it.
4. **`Not at this gym` is per exercise** (`EquipmentInstance.notFor`). `mapEquipment` and the pickers skip an item marked not for the exercise. Every build, swap and picker already goes through them, and the workout snapshot carries the field, so no caller needed changing. A whole kind Ben says is missing is retired and remembered in `Gym.missingKinds`, which `Make full gym` respects.
5. **The coach's `update_gym`** is offered when Ben's words are about a gym (`mentionsGymSetup`, loose). It applies only when he said it (`gymChangeAsked`, strict, review B1): like `verifyAsked`, a model "he didn't ask" is taken and a quote must be his words this turn; then the sentence must be a plain statement with a negation or "has" right next to an equipment noun ("no leg press"), an item and its steps with a number, or an outright ask. Questions, hedges, "broken" and opinion-only messages are cards. Otherwise it is a card with exactly the edit, which Ben's Apply saves as his own record (`proposalId`). The coach store writes and undoes the edit in the same transaction as the record. Migration 25 adds the action kind.

6. **A machine's own stack (review B2).** One `weight_stack` item (`Machines`, `Cable station`) stands for many machines, so a step learned on one machine must not change the rest. Accepting `Leg extension goes up in 7 kg?` adds a confirmed item named for the exercise with `onlyFor: [exercise]`, and lists the exercise in the shared item's `notFor`. `mapEquipment` maps the exercise to its own item first; `equipmentForExercise` and `planNotHere` skip items that are only for other exercises. The coach's `stack_step` takes an `exerciseId` for the same edit. Only steps real stacks use are offered (5, 2.5, 10, 7, 4.5 kg; 10, 5, 15, 12.5, 20, 2.5 lb).

## Consequences

- A gym can have loads that don't exist (an assumed 47.5 kg dumbbell at a 2.5 kg step). Light racks follow a ladder (1 kg to 10, then 2.5; 2.5 lb to 25, then 5) to keep that rare. The learn chip only **adds** a value, and `Not at this gym` removes an exercise; nothing removes one assumed value yet (Ben edits the rack). The gym screen and `Why?` say which items are assumed. Adding one learned dumbbell leaves the rack assumed.
- `Make full gym` adds only missing *kinds* (review N5): a gym with one confirmed cable stack doesn't get the shared `Machines` stack, so machine exercises use the cable's range there.
- Kinds with no gym-profile schema (kettlebells, EZ / trap bar, Smith machine, benches) are still not modelled. The full gym can't assume them until an equipment slice adds them.
- Stack steps learned from one load are a guess. They are only offered, only for assumed shared stacks, and only ever change that one machine.
