# Plan summary (Ben, 2 Nov 2026)

Prototype: `docs/design/prototypes/plan-summary-2nov.html` (dark Premium; the notes panel beside it is commentary).
Ben's words: "When you click on plan in overview of progress I think it should include a very tidy summary of the
plan"; sets per week as bars ("bars is fine"); Main lifts kept.

## Where it is

- Progress › Lifts › `This block`: the header's `Week 3 of 6 ›` (current block only) opens the summary, in the
  Progress stack (`ProgressPlan`, back `‹ Progress`). Before this, nothing in Progress opened the plan; Plan setup's
  Gym goals was reached from Library › Plan › Edit plan.
- `Edit` (top right) and the `Edit plan` button: Plan setup on the plan in use at Gym goals (`openPlanChange(…,
  'goals')`, as Change plan › Goal does), ending on its Changes review. A finished block: `Start next block`. A
  coach-built plan: Library › Plan (its Change plan sheet).

## Contents (real data only, rule 6)

1. Title `<Focus> · <N> weeks`; line `Week 3 of 6 · ends Sun 13 Dec`. Lead-in: `Starts Mon 9 Nov · ends …`. Paused:
   `Week 3 of 6 · Paused · until 9 Nov` (no end date). Done: `Block done`. The end date assumes every week from now
   is trained (`pbBlockEndsOn`; a week only counts once trained).
2. Week strip: done filled, this week bright (accent), later weeks raised; a deload week ahead dashed with `↓`.
   Deload weeks are the plan's own (`pbIsDeload`: effort, lighter weeks; skipped deloads once that lands).
3. Facts: days / week, `~60` min, effort.
4. Days (`Any days` / `Set days`): each day's main lift · exercise count for this week, the weekday on Set days, a
   green dot when done this week, `Next` on Up next (none while paused). Tap: the plan day screen (`ProgressPlanDay`).
5. Main lifts (`Now → week 6`): `80 → 85 kg × 6 est.` from the plan builder's `expect` for the plan's own answers,
   the same numbers as Gym goals' What to expect table. kg/lb per lift, `each` for per-hand. Omitted with none.
6. Sets per week (`Muscles ›`): Plan › Muscles' bars for this week from `planMuscles.muscles()` (one service, so they
   agree): range band, value, below range amber. A deload or lead-in week is neutral there and here.

A coach-built plan (no builder answers): name, `Since …`, days (no meta), sets per week; no strip, facts or lifts.

## Copy

Values and actions only. No rule explanations, no reassurance lines, no ticks.

## Open

- Coach-built plans have no This block section, so no Progress entry yet.
- Not yet seen on Ben's iPhone.
