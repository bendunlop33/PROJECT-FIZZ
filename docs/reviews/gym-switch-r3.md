# Review round 3: gym switch and shared re-snap (`claude/gym-switch`)

**Verdict: PASS** (nothing blocking; 2 should-fix items and nits below)

Reviewer: independent reviewer agent, 2026-10-10.
Scope: `git log claude/gracious-knuth-joxqpw..HEAD`, 24 commits. This round concentrates on the 4 commits after round 2 (`56a477f..HEAD`: 4754733, d14258c, 4aa8baa, 248c4f1), and re-reads the code they touch (`nextTargetBlocks`, `nextTargetsForBlock`, `nextTargetsOf`, the Summary's `Next time`, `afterSwitchRefused`, `gymSwitchRefusal`, `reviewOpenAfterCheckAgain`).
Checked against `docs/design/gym-switch.md`, ADR 0019, CLAUDE.md rules 2–6, 9 and 10, rounds 1 and 2 (`docs/reviews/gym-switch.md`, `docs/reviews/gym-switch-r2.md`), and competitor-landscape #2(g) and #6.

## How this was checked

- `npm run check` in the worktree exits 0. Typecheck, lint, catalogue validate, guide check and guide motion all pass, and `vitest run` passes 107 files and 1450 tests.
- I compared the branch with the merge base (`git diff claude/gracious-knuth-joxqpw...HEAD`). The two-dot diff also shows FitNotes import files, but those changed on main and aren't part of this branch.
- I ran two throwaway domain probes through the real reducer, `nextTargetBlocks`, `nextTargetsForBlock` and `buildWorkoutSummary`. I deleted them and didn't commit them.
  - (a) Main → Hotel → back to Main, one Incline set per part. Main decides, `otherPartsDone` = 1, the rule reads the 2 Main sets of this workout, and the target is 35 kg each × 8–12 for 3 sets. This is correct.
  - (b) A same-gym `Use updated Main Gym` (equipment_update, rack v1 → v2) after Incline set 1. The block is flagged `split: true`, and the Summary says "Done at more than one gym…". See M1.

### Round 2 status

| Round 2 | Status |
|---|---|
| B1 next-session targets per row | **Fixed.** `nextTargetBlocks` + `nextTargetsForBlock` (`packages/domain/src/session/gym-switch.ts:119-188`) are used by Start next session, Today's card (`workout-services.ts:413-420`) and the Summary (`summary.ts:279-311`). The service-level test (`apps/mobile/test/gym-switch.test.ts:209-275`) logs 1 set at Main, switches, logs 2 at Hotel and finishes. It then checks one `Next time` row, Today's preview line, and 3 `built_in_rule` sets at Start. |
| M1 silent non-write refusal | **Fixed.** `afterSwitchRefused` closes the card with the reason as a toast, and `gymSwitchRefusal` refuses up front in `proposeGym` and in the gym-detail `checkGym` path. Both are tested (`gym-switch.test.ts:321-326`). |
| N1 version-exact equipment | Fixed (`equipmentOfRow` in `nextTargetBlocks`). |
| N3 Check again closes the sheet | Fixed (`reviewOpenAfterCheckAgain`), and tested. |
| N2, N4, N5 | Unchanged. That's acceptable (see Nits). |
| Spec issues 1–2 | Recorded in the spec as GS-S4a "pending Ben", plus the GS-S4 readers row, GS-S3 as built, and §3.2 force-close deferred. |

What is good: one pure function decides next-session targets for every reader. History from the same workout on other items is excluded explicitly, so the "earlier session left out" and "Only n of m" facts can't misfire. The block's full set count survives at Start. Rule 4 is still enforced by the shared fit at Start. Refusals are now said, never silent.

## Blocking

None.

## Should fix (not blocking)

### M1. A same-gym "Use updated …" mid-exercise makes the Summary claim "Done at more than one gym"
- `packages/domain/src/session/gym-switch.ts:140` (`split: done.length > 1`)
- `packages/domain/src/session/gym-switch.ts:184-188` (`splitDeciderFact`)

`applyChangeGym` creates a continuation row whenever a row with done sets moves to a different item **or version** (`sameEquipment` compares versions). A `Use updated Main Gym` (mode `equipment_update`, gym-editor §4.9) therefore splits an exercise at the **same** gym on the **same** item ID. `nextTargetBlocks` marks the block `split` because it has more than one part with done sets.

**Failure path (probe-confirmed):**
1. At Main, Ben logs Incline set 1 at 32.5 kg × 12.
2. In the gym editor he adds 42.5 and 45 kg dumbbells and taps `Use changes today` → `Apply`.
3. He logs sets 2–3 and finishes.

The Summary's `Next time` row says: `Done at more than one gym: target from your Main Gym sets, for all 3 sets.` This is false. The workout never left Main, and the reason line is what rule 3 relies on ("recorded with its reason"; rule 6, don't state things that aren't so). The numbers are right (`otherPartsDone` is 0, and history merges both parts under one item ID), so only the reason text is wrong.

**Fix:** derive the split from the parts' gyms, not their count. One option: `split = new Set(done.map(x => equipmentOfRow(...)?.gymId ?? null)).size > 1`. Another: base it on `otherPartsDone > 0`, and use a separate "same equipment, updated mid-workout" case that adds no fact. Add a domain test for an equipment_update continuation.

### M2. Start next session at the original gym silently takes the lighter gym's load, with no reason shown at Start
- `apps/mobile/src/services/workout-services.ts:413-424`
- `apps/mobile/test/gym-switch.test.ts:257,264` (the test asserts this outcome)

The GS-S4a rule (the latest part with equipment decides) is documented and pending Ben. The way it's built makes the consequence invisible where it matters. In the committed service test, Ben did Incline at **32.5 kg** each at Main and then 20 kg at Hotel. `Start next session` **at Main** builds 3 × **22.5 kg** each, a 30% drop at his own gym. Today's card shows `3 sets · 22.5 kg each × 6–10 …` with no note. The only explanation ("target from your Hotel · Lisbon sets") is on the previous workout's Summary, which Ben may never reopen. He gets a big unexplained regression on returning from a trip. That's the travel scenario competitor #6 was approved for.

**Fix (until Ben decides GS-S4a):** when the deciding part's gym differs from the gym the next session is started at, add a Repeat note to the preview and the start warnings. The pipeline for this exists (`RepeatNote`, tone `info`). Suggested wording: `Incline DB press: target from your Hotel · Lisbon sets (20 kg each); last time here 32.5 kg each.` Also see Spec issue 1, which proposes changing the rule itself.

## Nits

- **N1.** The claim that Start and the Summary "can't disagree" (`gym-switch.ts:88`, ADR 0019 GS-S4, spec GS-S4a) is overstated. Start passes `rule: null` and `count: 'done'` (`workout-services.ts:420`). The Summary passes the routine's rule (`block.root.progressionRuleId`) and `count: 'prescribed'` (`summary.ts:293-295`). With a routine rule, or a skipped set, the two still give different targets. This predates the branch and isn't caused by the split, but the docs should state the remaining difference rather than claim full agreement.
- **N2.** The deciding part can differ from Repeat's source item. `nextTargetBlocks` ignores warm-ups (`isDoneWorkingSet`), while `repeat.ts:88-100` `sourceEq` counts any completed set. If the last part had only a warm-up, Start pins the template to that part's item, but the targets come from the earlier part's item, unit and convention. `snapPlanToGym` may then convert or drop the load. This is rare, and one shared helper for "which part decides" would remove it.
- **N3.** With a `top_set_backoff` routine rule split across gyms (top set at Main, back-offs at Hotel), the deciding Hotel part has no top set in this workout's history. The Summary row may then fall back to an older session or no target. Only the Summary reads routine rules, and none can be authored in the app yet. Add a test when rule editing lands.
- **N4.** For a split block, the rule's explanation facts describe the deciding part's own count ("every counted set reached 12+…" over 2 sets), while the first fact says "for all 3 sets". This is readable, but a test that pins the full fact list would stop the two drifting apart.
- Round 2 N2 is still open: the reducer doesn't check that the slot item's kind is in the exercise's compatible kinds. The app can't reach this, but a future coach tool path could. Round 2 N4 and N5 are unchanged and accepted.

## Tests

The new tests cover round 2's gaps: the service path for next-session targets after a split (preview, Start and Summary in one scenario), Summary `Next time` for a split block including the held case, the reason facts, the refusal mapping and up-front cap refusal, and the review-sheet reopen rule. Still missing:

- A continuation created by `equipment_update` at the same gym (M1).
- A note at Start when the deciding part's gym differs from the start gym (M2, once built).
- A split block under a routine `double_progression` rule whose `workingSets` is less than or equal to `otherPartsDone` (the `Math.max(1, …)` floor at `gym-switch.ts:166`).

## Spec issues (for the designer / Ben, not the developer)

1. **GS-S4a's "latest part decides" carries a lighter travel gym back to the home gym.** The only Start-time input that can tell which loads suit the gym is the gym the session is started at. That gym is known at Start, and `lastUsedAtGym` already exists. Proposal for Ben:
   - At Start, the deciding part is the part on the starting gym's equipment, when the block has one. Otherwise it's the latest part with equipment.
   - The Summary's `Next time` keeps today's rule but words it as conditional. Example: "From your Hotel · Lisbon sets. At Main Gym, Start uses your Main Gym sets."
   - This needs Ben's decision before the first real trip. Until then, M2's note keeps it visible.
2. Note for later: whole-workout Start next session from a workout done entirely at another gym has the same "lighter gym's load at home" effect. That's outside this branch, but it's worth deciding together with GS-S4a.
3. Round 1 spec issue 1 (the unchecked load on an unpinned equipped exercise) is still open in `docs/design/gym-switch.md`.
