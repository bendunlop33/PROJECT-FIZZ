# Library › Plan v2 (one page, one list)

Status: **Built 27 Oct 2026, for Ben's review; amended the same day by the UX review (`ux-review-27oct.md` §P4, PM):
`Edit plan` stays visible on the card, Do today / Move are row swipes, Library opens on Plan while a plan runs.** Mock: [prototypes/plan-tab-v2.html](prototypes/plan-tab-v2.html) (before/after at phone width, example data).

> Ben (27 Oct, build 419): "don't really understand this page. Seems poorly designed."

Supersedes the Your plan layout in [plan-builder.md](plan-builder.md) (§3 "Plans live in Library", the V6 notes on
`Move day` / `Do today ›`) and the Library › Your plan strip in [training-blocks.md](training-blocks.md) where they
differ. Every capability stays; only where it lives changes.

> **This week's count (Ben, 28 Oct):** one workout fills one plan day and a plan day takes one workout (a Monday leg workout ticks Legs, not Legs B too); a pull led with rows is the row day. The count runs Monday–Sunday, in the plan's first week too (earlier workouts that week count); a plan started mid-week expects only the days still possible from its start (`2 of 5`). A plan applied after its Monday has a lead-in week (`Starts Mon 2 Nov` in the header); week 1 starts the next Monday (Ben, 28 Oct; training-blocks §4.1). CHANGELOG 2026-10-28 (plan week fixes).

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
│ Edit plan                        │
└──────────────────────────────────┘
THIS WEEK                2 of 5 days · 92% sets
(✓) Push A          Mon · Bench press      Mon 20 Oct  ›
(✓) Pull A          Deadlift               Wed 22 Oct  ›
(3) Legs   NEXT     Squat                           ⋯  ›   ← swipe right: Do today · swipe left: Move
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
- **`Edit plan`** (UX review §P4): a visible text button on the card under the chips while the block runs;
  `Block done · Start next block` once done. Coach plans have none (`Ask coach to change` is in `⋯`).
- **`⋯` menu** (iOS action sheet): `Pause plan` or `Resume` · `Ask coach to change` · `Edit goal` / `Set goal` ·
  `End plan` (destructive; then `End this plan?` with `End plan` / `Cancel`, then the toast with Undo, as before).
  Pause opens the same in-card picker as before.

### 2.2 The days (one list, the selected week)

- Section label: `This week` on the current week, else `Week 5`; on the right `2 of 5 days · 92% sets` (current week
  only; the two stat tiles are gone, same values). A deload week shows `Deload: lighter, fewer sets` under it.
- **Row:** state mark · day name (`Next` tag) · secondary line · trailing · chevron.
  - Mark: ✓ (done that week), a numbered ring (Up next; current week only, not while paused), a plain ring (to do).
    Up next's order is training-blocks.md §4.1a: once a gym workout is finished today it plans from tomorrow (Ben, 31 Oct).
    Earlier weeks' days not done get the plain ring: nothing is called missed (D19, see §4).
  - Secondary: the weekday on Set days plans, then the day's main lifts (`Mon · Squat`); no main lift: its first two
    exercises.
  - Trailing: the date done (`Mon 20 Oct`). Coach plans: `Last 12 Oct` when not done this week.
  - This week's not-done days of a running block **swipe** (UX review §P4): right reveals `Do today` (leading),
    left reveals `Move` (trailing, Set days plans). The same two are in the row's `⋯`, on long-press and as VoiceOver
    actions. `Move` shows the weekday chips under the row (taken ones dimmed), then the toast with Undo (unchanged).
- **Tap opens the day** (Plan day screen: `Open Legs`, `Edit`, `Ask coach`, `Make next`). Opened from another week
  of a builder plan, the day shows **that week's** planned sets × reps · kg (`Week 5 of 6 · Deload`), which the
  old inline expansion showed; from this week it shows what Start would plan at this gym, as before.
- Below the list (current week only): this week's change with `Undo`, and the activity lines (unchanged).

### 2.3 Library opens on Plan while a plan runs

Library remembers its last segment; with a plan in use it opens on `Plan` instead (a link's own segment still wins,
and a segment Ben taps first is kept). The remembered segment is unchanged and applies again once no plan is in use.
Checked once each time Library mounts (app launch), not on every tab switch.

### 2.4 Scrolling under the segmented control

The scroll area starts below the segmented control; a hairline appears at its top edge once the page scrolls, so a
half-scrolled row reads as "under the edge", never as overlapping the control.

## 3. What moved where

| Before | After |
|---|---|
| `Your plan` eyebrow + `Since 13 Oct` | dropped on builder plans (the week line says where you are); coach plans: the line |
| Goal line `Edit` / `Set goal` | goal text stays; action in `⋯` |
| `6 weeks · Standard · deload week 6` header | `Week 3 of 6 · deload in week 6`; deload chip `6 · Deload` |
| Week strip day cards (tap expands to exercises, `Move day`, `Do today ›`) | the one list; exercises on the day screen for that week; actions as row swipes, row `⋯`, long-press |
| Big `Edit plan` button | `Edit plan` text button on the header card |
| Rotation list (rings, `Next`, `Mon`, `Last 12 Oct`) | folded into the one list |
| `Days this week` / `Planned sets done` tiles | the list header's right side |
| `Ask coach to change · Pause plan · End plan`, goal `Edit` | `⋯` |

Nothing is removed. No-plan state (`Set up a plan`), Lift targets and `Previous` are unchanged.

## 4. Open for Ben

1. Past weeks' days not done show a plain ring, not "missed" (D19 says nothing is called missed). OK, or say `Not done`?
2. ~~Should `Edit plan` be visible?~~ Yes (UX review §P4): visible on the card.
3. The UX review also suggests `Edit goal` open a goal sheet in place instead of Profile › Training details; not
   built here (it still opens Training details, as before).
