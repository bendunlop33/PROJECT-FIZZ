# Plan › Muscles, one muscle count, Rebalance (Ben, 1 Nov 2026)

Prototype: `docs/design/prototypes/plan-muscles.html` (example numbers only; its `4–8` was unsourced and isn't used).
Ben's words: "the coach should have caught that my plan barely trains biceps"; "You need to look at it holistically";
"if they're trained a bit with other muscles then clearly we could have fewer sets eg 4".

Tab roles (redesign-27oct): **Library looks forward** (Plan › Muscles is planned only), **Progress looks back**
(Progress › Training's `Muscles · sets` is the only done view; Plan › Muscles links to it, `Done by week ›`).

## 1. Where it is

- Library › Plan card: `Muscles · Biceps low ›`, `Muscles · Biceps, Calves low · Chest high ›` or
  `Muscles · all in range ›`. Nothing with no goal (playbook "No goal set").
- Plan › Muscles: the week chips (lead-in, 1–N, `6 · Deload`, `Block avg`), default **this week** with this week's
  one-change edits, skips and moves; one bar per group (Chest, Back, Shoulders, Quads, Hamstrings, Glutes, Triceps,
  Biceps, Calves, Core: the app's `MUSCLE_GROUPS` less Forearms; "Abs" is the existing `Core` group); `+7 assisted`
  under a bar; a tap shows its Why? line; a thin marker for done so far that week; `Done by week ›`; the gap lines
  and **Rebalance**; By day (each day's direct sets per group). A later week shows its own version (a future template
  change); done weeks their own days.
- Flags only from the **typical week** (the plan's days as their workouts run now: every day, no deload, no skips).
  A deload, the lead-in or a week with a skipped day shows neutral bars and one note (`Deload`, `Lead-in`,
  `1 day skipped`).

## 2. One count (option C, Ben 1 Nov)

`muscleSetCredits` (`packages/domain/src/progress/muscle-sets.ts`) is the only muscle count. Per set, per group:

- **direct**: 1 for the exercise's lead group (first primary muscle with a builder group: rear delts → Back;
  forearm-only work → Forearms). This is exactly what the builder and the weekly review counted before.
- **assisted**: the rest of playbook V1's credit (another primary group 1, a secondary ½).
  `direct + assisted` is always V1's number (Progress's number before 1 Nov).

Bars, ranges and flags use **direct** only (Ben, 1 Nov: "the 6–10 range is judged against direct sets only,
meaning the curl and extension exercises"). Assisted is shown alongside and picks which range applies.

## 3. Ranges (sources)

Approved playbook rule 1 / V4 (`docs/training-guides/README.md` rule 1 "Revised and approved";
`volume-by-frequency.md` V4), as amended by Ben on 1 Nov (V4 amendment recorded there):

| Goal | Direct sets a week |
|---|---|
| Muscle (and `both`) | 6–10; **4–8** when the group gets ≥ 6 assisted sets a week (Ben, 1 Nov); priority groups 10–20 |
| Strength (other groups) | 4–10 |
| General fitness (a builder plan's Fitness focus) | 4–10 |
| No goal | none: no range, no flags |

The goal is the training profile's; with none, a builder plan's focus (Balanced reads as `both`). Priorities are a
builder plan's picks (`Arms` → Biceps and Triceps); Ben has none now. `WEEKLY_SET_RANGE` (the weekly review) is
reconciled to these: Muscle was 6–20 (a Proposal reading), now 6–10.

## 4. No lost functionality: every reader, before → after

| Reader | Before | After |
|---|---|---|
| `muscleFrequency` (Progress › Training Muscles · sets, Muscles screen, recap) | V1 credit only (`sets`) | `sets` unchanged; adds `direct`, `assisted`, `directPerWeek` |
| Progress › Training `Muscles · sets` row | number and bar = V1 | number, bar and per-week = **direct**; `+N assisted` beside the label; range shaded (per week × weeks); sessions, last trained, sub-rows, contributors (× ½) unchanged |
| Monthly recap muscles | V1 this month vs last | **direct** this month vs last (same comparison); `assisted` kept on the row and in its words; a helper-only group stays listed |
| `muscleGroupCredits` (exercise filter chips) | primary groups | unchanged (moved to `muscle-sets.ts`) |
| `leadMuscleGroup` (weekly review, Progress › Reviews tracker) | lead group | unchanged (moved to `muscle-sets.ts`) |
| Weekly review sets per muscle, planned vs done, marks, wording | direct, range 6–20 Muscle | same counts and marks; range per group from `directRange` (6–10, 4–8 covered) |
| `workoutGroups` / `workoutGroupsOf` (Up next, plan-day matching, D19 ticks) | first primary group | untouched |
| `pbRange`, `PB_EFFORT` (builder bands, rates) | builder's own | untouched |

Tests changed: `weekly-review.test.ts` (two expectations: Muscle range 6–20 → 6–10, reconciled). Tests that asserted
½ numbers as Progress's primary display: none needed changing (they assert `sets`, which is unchanged).

## 5. Rebalance (one proposal for the whole plan)

`rebalancePlan` (`packages/domain/src/plan-builder/rebalance.ts`), the same engine for Plan › Muscles and the coach's
check. Every candidate is simulated on the whole plan and taken only if its group gets closer to range and **no other
group leaves its range**. Order (Ben, 1 Nov): trim an overshoot (never a main lift, never below 2 sets a row) → swap
an accessory for a catalogue alternative (no time added) → a new isolation superset with a non-competing accessory
(no shared muscle group, after the last main lift) → straight sets last. New work goes to the group's own split days
(`PRESET_SPLITS`: Biceps with Back on the pull days), at most two days, split evenly, sized to the **lower edge** of the
range. Never past a day's minutes: estimate = 10 + 3 min per set (approved rule 1), 2.3 inside a superset (the
builder's pace); a day already at its cap gets nothing added. Never a not-preferred exercise, one with a pain flag,
one the gym can't do, or one Ben took out of that day himself.

The card: each change a line (skip any), the bars before → after, the day lengths before → after, Why? (two lines),
Apply. Apply is one `applyPlanEdit` from this week on (op ID; a stale card is refused; this week's done days never
change); Undo is `undoPlanEdit`. Builder plans only (a coach plan has no weeks to edit; the card says so).

## 6. The coach catches gaps

- `propose_plan`: `planMuscleGapLines` runs on the checked days; each gap is a `muscle_gap` plan check: on the card
  (`Biceps 2/wk · below 4–8`) and in the guard notes the coach gets back, so it can adjust. Never blocks the plan.
  Builder plan cards are checked the same way when shown.
- YOUR DATA `plan.inUse.muscles`: the typical week per group, direct (assisted), range, status.
- The offer, once: after Apply (the plan card) or in the weekly review (Library › Changes), `Biceps only 0 sets a
  week · Rebalance?` with Rebalance / Skip. One record per plan state (`trainingProfile.muscleOffer`, versioned, op ID):
  whichever surface raises it first keeps it; Skip silences it until the plan changes. No Today nag.

## 7. Open, for Ben

1. **Frequency.** "Each group ≥ 2×/week" is in playbook v1's profile table (rule G, graded Practice), not a numbered
   approved rule. Rebalance doesn't enforce it; it only spreads new sets over the group's own split days.
2. **V5 step size.** V5 says add 1–2 sets per group at a time; Rebalance sizes to the range's lower edge (Ben, 1 Nov),
   which can be +4. Ben's 1 Nov rule wins here; V5 should say so.
3. **Swaps rarely help direct sets**: alternatives of a back exercise lead with Back, so a swap mostly moves the range
   (more assisted), not the direct count. Superset first is what usually happens.
4. **A 6-day PPL often reads Chest/Back "high"** at Muscle's 6–10 (non-priority). That is V4 as approved; picking
   priorities (10–20) is the way to say otherwise.
5. Progress's range on a month is the weekly range × the window's weeks.
6. Not run on Ben's iPhone.
