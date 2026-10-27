# Library › Plan v2 (one page, one list)

Status: **Built 27 Oct 2026, for Ben's review.** Mock: [prototypes/plan-tab-v2.html](prototypes/plan-tab-v2.html) (before/after at phone width, example data).

> Ben (27 Oct, build 419): "don't really understand this page. Seems poorly designed."

Supersedes the Your plan layout in [plan-builder.md](plan-builder.md) (§3 "Plans live in Library", the V6 notes on
`Move day` / `Do today ›`) and the Library › Your plan strip in [training-blocks.md](training-blocks.md) where they
differ. Every capability stays; only where it lives changes.

## 1. What was wrong (build 419)

Top to bottom: `Your plan · Since 13 Oct`, name, goal line, then a header line `6 weeks · Standard · deload week 6`
(clipped at the top edge of the scroll area when scrolled, with no edge under the segmented control), the week chips,
the week's days (`Push A … ✓ Done`, tap expands), a big `Edit plan` button, then **the same days again** as the
rotation list (rings, `Next`, `Mon`), two stat tiles, then `Ask coach to change · Pause plan · End plan`.

- The days appeared twice, with different ticks (block week vs. this week) and different taps (expand vs. open).
- No clear "where am I": the week was a chip; `deload week 6` read like the current week.
- `Edit plan` sat between the duplicates.

## 2. After

```
Plan | Workouts | Exercises
───────────────────────────────── (hairline once the page scrolls under it)
┌ Strength block                 ⋯ ┐
│ Week 3 of 6 · deload in week 6   │
│ Goal: Strength · 4 days · 60 min │
│ [✓1][✓2][ 3 ][ 4 ][ 5 ][6 · Deload]   (current: dot under; selected: filled)
└──────────────────────────────────┘
THIS WEEK                2 of 5 days · 92% sets
(✓) Push A          Mon · Bench press      Mon 20 Oct  ›
(✓) Pull A          Deadlift               Wed 22 Oct  ›
(3) Legs   NEXT     Squat                           ⋯  ›
( ) Push B          Overhead press                  ⋯  ›
( ) Pull B          Barbell row                     ⋯  ›
Run · Sat · long
Lift targets …
PREVIOUS …
```

### 2.1 Header card

- **Title:** the plan's name. `⋯` (44 pt) on the right.
- **Line:** `Week 3 of 6 · deload in week 6` (the next deload week; none left or Maintain: `Week 3 of 6`);
  in a deload week `Week 6 of 6 · Deload week`; once done `Block done` plus the `Start next block ›` row.
  Coach plans (no length): `Since 13 Oct`.
- **Paused:** `Paused · until 3 Nov · Resume` under the line (unchanged).
- **Goal:** `Goal: Strength · 4 days a week · 60 min` (the `Edit` / `Set goal` action moved into `⋯`).
- **Week chips:** `1 … N`; a deload week reads `6 · Deload`; done weeks `✓`; the **current week has a dot under its
  number**; the **selected week is filled**. They are separate states (VoiceOver: `Week 3, current, selected`).
  Opens on the current week.
- **`⋯` menu** (iOS action sheet): `Edit plan` (block running) or `Start next block` (block done) · `Pause plan` or
  `Resume` · `Ask coach to change` · `Edit goal` / `Set goal` · `End plan` (destructive; then `End this plan?` with
  `End plan` / `Cancel`, then the toast with Undo, as before). Pause opens the same in-card picker as before.

### 2.2 The days (one list, the selected week)

- Section label: `This week` on the current week, else `Week 5`; on the right `2 of 5 days · 92% sets` (current week
  only; the two stat tiles are gone, same values). A deload week shows `Deload: lighter, fewer sets` under it.
- **Row:** state mark · day name (`Next` tag) · secondary line · trailing · chevron.
  - Mark: ✓ (done that week), a numbered ring (Up next; current week only, not while paused), a plain ring (to do).
    Earlier weeks' days not done get the plain ring: nothing is called missed (D19, see §4).
  - Secondary: the weekday on Set days plans, then the day's main lifts (`Mon · Squat`); no main lift: its first two
    exercises.
  - Trailing: the date done (`Mon 20 Oct`). Coach plans: `Last 12 Oct` when not done this week.
  - `⋯` on this week's not-done days of a running block: `Do today` and `Move day` (Set days plans). Long-press
    opens the same sheet. `Move day` shows the weekday chips under the row (taken ones dimmed), then the toast with
    Undo (unchanged).
- **Tap opens the day** (Plan day screen: `Open Legs`, `Edit`, `Ask coach`, `Make next`). Opened from another week
  of a builder plan, the day shows **that week's** planned sets × reps · kg (`Week 5 of 6 · Deload`), which the
  old inline expansion showed; from this week it shows what Start would plan at this gym, as before.
- Below the list (current week only): this week's change with `Undo`, and the activity lines (unchanged).

### 2.3 Scrolling under the segmented control

The scroll area starts below the segmented control; a hairline appears at its top edge once the page scrolls, so a
half-scrolled row reads as "under the edge", never as overlapping the control.

## 3. What moved where

| Before | After |
|---|---|
| `Your plan` eyebrow + `Since 13 Oct` | dropped on builder plans (the week line says where you are); coach plans: the line |
| Goal line `Edit` / `Set goal` | goal text stays; action in `⋯` |
| `6 weeks · Standard · deload week 6` header | `Week 3 of 6 · deload in week 6`; deload chip `6 · Deload` |
| Week strip day cards (tap expands to exercises, `Move day`, `Do today ›`) | the one list; exercises on the day screen for that week; actions in row `⋯` / long-press |
| Big `Edit plan` button | `⋯` › `Edit plan` |
| Rotation list (rings, `Next`, `Mon`, `Last 12 Oct`) | folded into the one list |
| `Days this week` / `Planned sets done` tiles | the list header's right side |
| `Ask coach to change · Pause plan · End plan` | `⋯` |

Nothing is removed. No-plan state (`Set up a plan`), Lift targets and `Previous` are unchanged.

## 4. Open for Ben

1. Past weeks' days not done show a plain ring, not "missed" (D19 says nothing is called missed). OK, or say `Not done`?
2. Should `Edit plan` also be a visible button (e.g. at the bottom) rather than only in `⋯`?
