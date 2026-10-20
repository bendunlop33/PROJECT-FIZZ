# Active workout v3: builder format in the workout

Status: **approved by Ben, 20 Oct 2026** ("yes go ahead and build it"). Prototype: `docs/design/prototypes/workout-active-v3.html` (artifact https://claude.ai/artifact/74CATWwh5TrmtqSofmu1Wq). Supersedes the layout parts of `workout-table.md` §2–§3. Keeps the in-place cell entry from the inline-edit fix (20 Oct), the rest bar, rest alerts, force-close recovery, banners, gym chip, Finish and Summary unchanged.

Goal: the workout reads like the builder (`workout-builder-v3.md` §2): numbered rounds, `3a`/`3b`, exercise + works line, a per-set table with set types and target RPE, kg written once.

## 1. Layout

1. **Header** (unchanged): `⌄` · day name · `GymChip` · elapsed · `⋯`.
2. **Round strip** (one row, scrolls sideways when long): one chip per round, `1 2 3a·b 4 5`. Done = `✓ 1` in green on `done-sub`; current = outlined in accent; others = muted. Tap jumps to that round (VoiceOver: "Round 3, superset, 2 of 3 sets done"). At the right: `Workout` text link → overview sheet (§4).
3. **Round card** (one round at a time, `bg.surface`, `radius.lg`). A superset round shows `3a` then `3b` stacked, separated by a thin divider. **No box and no connecting line** around supersets (Ben, 20 Oct). The exercise not up next is dimmed (55 %).
4. `Up next: 4 Lateral raise` line under the card (or `3a + 3b names` for a superset).
5. Rest bar and undo toast slot (unchanged).
6. **Action bar**: `Chat` + Log pill. Log names the step: `3a · Set 3 · Log 7.5 kg each × 12`, `Set 2 · Log 100 kg × 6`. After a round ends: `Next round`. When the coach ask bar (`apps/mobile/src/ui/coach-ask-bar.tsx`, Wave 2) is on this branch, the Chat button becomes that bar's mic + ✦ entry, same as Today.

## 2. Exercise block

- Header row: label (`1`, `3a`; bold) · name (`title3`) with the **works line** under it (`builderGroupOf` / works text from `packages/schemas/src/builder-groups.ts`) · progress `2/3` on the right (working sets only). Name tap opens the existing exercise sheet; `⋯` gives Swap, Move up / Move down, Superset with next / Unlink, Remove (today only, with Undo; same `adviseBuilder` "not recommended because…" toast as the builder).
- Columns: `#` · `KG` (`KG EACH` for per-dumbbell, `KG STACK` stays in the existing unit rules; lb shows `LB`) · `REPS` · `RPE` · `✓`. Unit only in the header.
- Rows (44 pt min):
  - Warm-ups: `W`, lighter cells, no RPE, not counted in numbering or progress.
  - Working sets numbered 1..n; a small label under the number for `Top`, `Back-off`, `Drop` (from the session's set types; plain working sets have none).
  - RPE column: target `@9` until logged, then the logged RPE (or blank).
  - **Pending rows**: kg and reps are boxed cells; tap = edit in place with the keyboard bar (−/+, Next, Done) from the inline-edit fix.
  - **Current set**: same boxed cells as the other pending rows (no row highlight); marked by a bold set number and an accent-outlined ✓.
  - **Done rows**: values in green without boxes, filled green ✓. Tapping a value still edits it as a versioned correction with Undo (rule 2).
  - Swipe left on a pending row = Delete (Undo). On a done row = Delete with Undo, recorded as a correction. VoiceOver custom actions mirror every swipe.
- Meta line under the rows: target (`8–12 @ 9`, `6 @ 8 top · 8 @ 8 back-offs`) · `Rest 1:30 ›` (rest per set type; opens the existing rest adjuster) · `Why?`. For a superset, rest shows on the last exercise of the round as `Rest 1:30 after round`; the first shows none. The old `Last 16 Oct: …` subline moves inside Why? together with the target reason.
- `＋ Set` text link under the meta line.
- Swipe right on the exercise header = Swap (the builder's Swap pop-up with the muscle-group dropdown, from Wave 2; today only).

## 3. Flow

- The current set is the first not-done set of the current round, going a → b → a → b for supersets. Logging 3a goes straight to 3b (no rest); after 3b the round's rest starts.
- When every set of the round is done, the card advances to the next round automatically after Log (the strip still allows going back).
- Jumping to another round with the strip doesn't change the order; Log logs the shown round's current set.

## 4. Workout overview sheet

`Workout` opens a sheet with the builder's table: `#` · Exercise + works line · `Sets` (done/total) · `Top set (kg)`. Supersets shown as `3a`/`3b` rows (no box). Done rounds dimmed with ✓, current round bright. Title `Upper body · about 55 min`. Row tap jumps to that round. Reorder/Swap/Add exercise stay available from here as today-only edits (existing OverviewEditSheets).

## 5. Time

When the session is running over the plan, the header elapsed shows a small `+12 min` after it; tapping offers the builder's fit steps (shorter rests → RPE 9 → fewer sets → drop an exercise, never the main lift) as one offer with Apply/Undo. Never applied unasked (rule 3).

## 6. Accessibility

44 pt tap areas, Dynamic Type (the table wraps the works line, numbers never truncate), VoiceOver labels "Set 3, 7.5 kilograms each, 12 reps, target RPE 9, not done", custom actions for Delete, Swap, Move, Superset.

## 7. Out of scope

The builder's own superset box stays as it is (planning view). Drag to reorder (spec §9 Q18) follows later.
