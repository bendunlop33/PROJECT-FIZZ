# Redesign v3 — approved by Ben, 27 Oct 2026

Prototype (the visual spec, example data): `docs/design/prototypes/app-redesign-v3.html`
(open it in a browser; the screen picker lists every frame; "Show before" flips Today, Active and Summary to v1).
Earlier inputs: `docs/design/ux-review-27oct.md`, `docs/design/ia-simplify-27oct.md`, `docs/design/plan-tab-v2.md`.
Product rules in CLAUDE.md still win (minimal copy, rules 1–10). Where this file and the prototype disagree, this file wins.

## Roles of the tabs
- **Today**: start today's session. Gym first.
- **Library**: looking forward — the plan, saved workouts, exercises, and the coach's changes to come.
- **Progress**: looking back — calendar, totals, lifts, body, and the full list of workouts.
- **Profile**: settings.

## A. Today (and Your workout before Start)
1. Header: `Tuesday` / `27 October` (two lines), coach ✦ and mic as 44 pt icon buttons. No cramped single line.
2. Under the header, one grey line from Apple Health with room around it (≈40 pt row, 16 pt icon, body-size secondary text, ≈4 pt above / ≈8 pt below): `♥ Sleep 7h 05m · RHR 58 ›` (tap → Progress › Body; long-press → choose what shows: Sleep, RHR, Bodyweight). Hidden when Health is off or there is no data. No card.
3. Day strip **bigger and clearer** (Ben, 27 Oct): more vertical space, not bigger dates (Ben): cells ≈104 pt tall with ≈12 pt top/bottom padding and ≈7 pt between weekday, date and pills; date ≈17 pt semibold, weekday 12 pt, pills 12 pt; today's cell filled (accent-soft) with an accent border; activity pills read just `Run` (no distance). No ticks. Above the strip a row: `This week` (section label) left, `Plan week 3 of 6` right (`· Deload` appended in a deload week; nothing without a plan). Under the strip a legend: green `Strength`, blue `Activity`, dashed `Planned` (Ben, 27 Oct). Today's pills keep these three styles (per-plan-day colours are only in Progress's calendar).
4. Day control labelled with a small section header **`Your split`** above `Push | Pull | Legs | ⋯` (no `NEXT` inside the segment). ⋯ = Other: other plan days, Build your own, Log a past workout, ＋ Activity.
5. Workout card **collapsed by default**: a section label **`Up next`** above the card, styled exactly like `Your split` (grey uppercase; reads `Today` when Ben picks another day than the next one); in the card: `Push`, `5 exercises · 45 min`, `Edit` link top right, `Show exercises` link. When the coach has a change for today, a small `✦ 1 change` tag beside Show exercises opens the offer (Apply/Skip). Expanded: gym (`Main Gym ⌄`), `1 left out to fit 45 min` link, and the full WorkoutList (no `+N more`); the affected row shows the coach's value as `✦ 22 ea` (tap → the offer). Remember open/closed per user.
6. Bottom dock (pinned): **Start Plan Workout** (primary; starts the selected day) and **Start Empty Workout** (secondary) under it. Remove the small `Empty workout` link and the `History` row from Today (History moves to Progress).
7. Conditional single lines only when they apply: deload (This week row), active pain flag (`Left shoulder · progression paused ›`), schedule shift (`Legs moved to Fri · long run Thu`), Resume replaces the card when a workout is unfinished. Nothing else (no readiness scores, streaks, charts).
8. Your workout (Edit before Start): keep the folded **Options** row but make it a clear card: bold `Options` label, taller row (≥ 56 pt), collapsed summary of what's on (`Abs · Supersets`); open shows Main lift, Accessories, Abs (switch), Supersets (switch), Mix it up.
9. Remove the `Edits from <date> · Use edits` status line(s) from Your workout; when earlier unused edits exist, offer `Use earlier edits` in the ⋯ menu instead.

## B. Compact lists (WorkoutList on Today, Plan day, saved workouts)
1. Per-dumbbell loads read `ea`, not `each` (`24 ea`; header `KG EA`). VoiceOver still says "each".
2. In compact lists only, `Dumbbell` → `DB` in exercise names (`DB shoulder press`, `Incline DB press`). Full names elsewhere. Do not abbreviate Barbell.
3. Sets and Target kg text smaller (≈14 pt, sets in secondary colour) so each stays on one line; headers ≈11 pt.

## C. Progress
1. Header: `Progress` + `All workouts` link top right (every Progress tab).
2. Tabs `Lifts | Training | Body`; under them one period bar `Week | Month | 3M | 6M | 1Y` with `‹ ›` to step back; Lifts, Training and Body all follow it. Default Month on Training.
3. Month view (Training): calendar where every day is its own lightly shaded tile; days with any workout or activity are light green; one coloured dot per gym session by plan day name (e.g. Push orange, Pull blue, Legs violet; Upper/Lower/Full body get their own set; non-plan workouts neutral), hollow ring for runs/other activities; legend under the grid (never colour alone); today outlined; future days faded. Roomy spacing (≈7 px gaps). Tap a day → that workout. Under the legend a row `October workouts · 11 ›` (follows ‹ ›) → that month's list. Then totals vs previous period (sessions, time, sets with `+2 vs Sep`), Consistency (8 weeks), Muscles · sets.
4. Week view: the 7 days and the same totals vs last week. 3M/6M/1Y: a bar per week (sessions; weeks under aim greyed), totals, muscles.
5. Remove from Progress: the plan's `This week` card and `Coach's changes` (both move to Library). Remove Overview › Months and Training › Calendar segment (replaced by the above).
6. History becomes **All workouts**: list only (no month grid), filter All/Workouts/Activities, `Log a past workout` at top, Recently deleted at bottom; back goes to Progress.

## D. Library
1. Plan header card: plan name + ⋯ (Pause, Ask coach), `Goal: Muscle · 3 days a week · 45 min`, week circles spread evenly (done = green ✓, this week = white numbered, later = outlined numbered, `Deload` caption under a deload week; tap a circle shows that week).
2. Under it, when there are any: `✦ 3 changes · next week ›` → **Changes** screen: small coach tweaks with Why? and Undo; structural proposals with Apply/Skip; `Earlier changes ›`. A changed number in a plan day carries a small dot; tap → was/now + Undo.
3. `This week` list (days with Next / done date) — the only plan-vs-week view in the app.
4. Full-width **Edit plan** button at the bottom → sheet **Change plan**: Days and time (summary line), Goal, A day's exercises (Push/Pull/Legs → that day's editor), ✦ Ask the coach, **End plan** (red; confirm `End plan?` · `Week 3 of 6 · history kept` · End plan / Keep plan). Days and time and Goal end on the Changes review (per-line Accept/Reject, Apply to This week / Week N onward, Apply with Undo).
5. Saved workouts (no plan): a workout with a coach change shows `✦1`; its page shows a `Next time` card with Undo and the dot on the number. Ad-hoc next-time targets follow the exercise.
6. Workout editor (plan day, saved workout, Today's Edit share it): keep swipe left Delete / right Swap, hold-drag (edge = move, middle = superset), hold menu; **tap a card expands it in place** to edit every set (kg, reps, RIR, warm-ups, ＋ Add set, Rest, Warm-up, Superset / Swap / ⋯) instead of the pop-up. Add the **Options** card (Abs, Supersets switches) to the plan-day / saved-workout editor too; in a plan day it applies this week onward with Undo.

## E. Active workout, Summary
1. Keypad: `Log ✓` replaces Done. Finish always in the top bar. Empty workout uses the same table.
2. Summary order: Saved line, New best card, Time/Sets/Exercises, Next time (one list, Undo all, Why?/Undo per line, proposals Apply/Skip), Exercises done, Feel, Health line, `Ask about this workout`, Done. Edit times / Save as workout / Delete in ⋯.
3. Swap sheet mid-workout on the main lift: the plan's main-lift alternatives first, then the rest (Ben, 27 Oct).

## F. Training rules (Ben, 27 Oct)
- Fit to time, when exercises must be cut: on Chest, Back, Shoulders, Push and Pull days (any day whose main group isn't arms), **arm isolations (biceps/triceps) go first** — trimmed and left out before the day's main-group accessories lose sets. Main lift untouched as before.
