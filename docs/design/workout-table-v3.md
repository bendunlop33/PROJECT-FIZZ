# Active workout v3: builder format in the workout

Status: **approved by Ben, 20 Oct 2026** ("yes go ahead and build it"). Prototype: `docs/design/prototypes/workout-active-v3.html` (artifact https://claude.ai/artifact/74CATWwh5TrmtqSofmu1Wq). Supersedes the layout parts of `workout-table.md` §2–§3. Keeps the in-place cell entry from the inline-edit fix (20 Oct), the rest bar, rest alerts, force-close recovery, banners, gym chip, Finish and Summary unchanged.

Goal: the workout reads like the builder (`workout-builder-v3.md` §2): numbered rounds, `3a`/`3b`, exercise + works line, a per-set table with set types and target RPE, kg written once.

## 1. Layout

1. **Header**: `⌄` · day name · `GymChip` · elapsed · `⋯`. **`⋯` keeps every existing workout option** (`workoutMenu` in `apps/mobile/src/workout/table.ts`: Focus view, Pause/Resume, Rename, Gym at large text, spoken cues on/off, Ask the coach, Finish, Edit workout times, Discard), unchanged.
2. **Round strip** (one row, scrolls sideways when long): one chip per round, `1 2 3a·b 4 5`. Done = `✓ 1` in green on `done-sub`; current = outlined in accent; others = muted. Tap jumps to that round (VoiceOver: "Round 3, superset, 2 of 3 sets done"). At the right: `Workout` text link → overview sheet (§4).
3. **Round card** (one round at a time, `bg.surface`, `radius.lg`). A superset round shows `3a` then `3b` stacked, separated by a thin divider. **No box and no connecting line** around supersets (Ben, 20 Oct). The exercise not up next is dimmed (55 %).
4. `Up next: 4 Lateral raise` line under the card (or `3a + 3b names` for a superset).
5. **Timer bar, always shown** (Ben, 20 Oct: "where is timer for sets … make timer a bit bigger"), just above the action bar, 64 pt tall, numerals about 36 pt tabular: while resting `REST 1:29` with `−30` `+30` `Skip` (the existing drain line; rest alerts, notification and Live Activity unchanged); otherwise `SET 0:25`, counting up from when the rest ended (or the last log), in secondary ink. Timed sets keep their own work timer in the row. The header number stays the elapsed session time. Undo toast slot above the bar.
6. **Action bar**: `Chat` + Log pill. Log names the step: `3a · Set 3 · Log 7.5 kg each × 12`, `Set 2 · Log 100 kg × 6`. After a round ends: `Next round`. When the coach ask bar (`apps/mobile/src/ui/coach-ask-bar.tsx`, Wave 2) is on this branch, the Chat button becomes that bar's mic + ✦ entry, same as Today.

## 2. Exercise block

- Header row: label (`1`, `3a`; bold) · name (`title3`) with one subline under it: **works line · rep target** (`Rear delts · 8–12 reps`, `Chest, front delts, triceps · 6 top · 8 back-offs`) · progress `2/3` on the right (working sets only). Name tap opens the exercise pop-up (§7); `⋯` gives Swap, Move up / Move down, Superset with next / Unlink, Remove (today only, with Undo; same `adviseBuilder` "not recommended because…" toast as the builder).
- Columns: `#` · `KG` (`KG EACH` for per-dumbbell, `KG STACK` stays in the existing unit rules; lb shows `LB`) · `REPS` · `RPE` · `✓`. Unit only in the header.
- Rows (44 pt min):
  - Warm-ups: `W`, lighter cells, no RPE, not counted in numbering or progress.
  - Working sets numbered 1..n; a small label under the number for `Top`, `Back-off`, `Drop` (from the session's set types; plain working sets have none).
  - RPE column: target `@9` until logged, then the logged RPE (or blank).
  - **Pending rows**: kg and reps are boxed cells; tap = edit in place with the keyboard bar (−/+, Next, Done) from the inline-edit fix.
  - **Current set**: same boxed cells as the other pending rows (no row highlight); marked by a bold set number and an accent-outlined ✓.
  - **The round always fits one screen; each exercise's sets scroll inside their own box** (Ben, 20 Oct: "by scroll I meant within the specific exercise or superset so you would still only see a certain number of rows such that everything fit on one page assuming u always see at least 2 rows per exercise"; replaces the fold, `Previous sets` and whole-card-scroll ideas). The page itself doesn't scroll. The column labels stay fixed; the set rows of each exercise sit in a box sized so the whole round (headers, meta lines, Up next, timer bar, action bar) fits: if everything fits, no box scrolls; otherwise the box with the most rows shrinks first, row by row, aiming for **3 rows per exercise** and never below **2** (Ben, 20 Oct: "at least 2, can show say 3 if possible"); the `Up next` line gives way first so each exercise keeps 3. A soft fade at the top/bottom edge shows there are more rows. Each box is positioned so its current set shows with as many done sets above it as fit (up to 3), re-positioned whenever the current set changes (log, untick, round change), never while typing; Ben scrolls a box with his thumb to see older or later sets (scroll contained, it doesn't move the page). Done rows: green values without boxes, filled ✓; tapping a done value edits it as a versioned correction with Undo (rule 2). Recomputed for the rest bar, keyboard, Dynamic Type and screen size; if even 2 rows each can't fit (largest text sizes), the page scrolls as a fallback.
  - Swipe left on a pending row = Delete (Undo). On a done row = Delete with Undo, recorded as a correction. VoiceOver custom actions mirror every swipe.
- **No meta line under the rows** (Ben, 20 Oct: "wasting space at the bottom with the reps and rpe"): the rep target moves to the header subline, target RPE is already on each row (`@9`). One compact row under the table (`＋ Set` adds a set like the last working set, scrolls its box to show the new row and highlights it briefly, so it never lands out of sight; Ben, 20 Oct, "add set doesn't seem to work"): `＋ Set` as a small outlined pill (30 pt visible, 44 pt tap area) on the left, and a small underlined `Why?` text link (no circle, so it can't be mistaken for the ✓ column; Ben, 20 Oct) on the right, 44 pt tap area, VoiceOver "Why this target". `Why?` opens a small sheet: full target (`8–12 @ 9`), rest for this exercise (`Rest 1:30` / `1:30 after the round`) with `Change`, last time (`16 Oct · 7.5 × 12, 12, 12`), and the coach's or rule's reason. The rest is also visible in the timer bar while resting.
- Swap = the builder's Swap pop-up with the muscle-group dropdown (from Wave 2; today only), opened from the exercise pop-up or `⋯` (not by swipe here, see §3).

## 3. Flow

- The current set is the first not-done set of the current round, going a → b → a → b for supersets. Logging 3a goes straight to 3b (no rest); after 3b the round's rest starts.
- **Unticking a set never resets the rest** (Ben, 20 Oct: "if u accidentally click completed set and then deselect the rest time should continue as it was not reset"). Undoing a log puts back the rest that was running before that log, with its **original deadline** (it carries on counting as if nothing happened; the notification and Live Activity are rescheduled to that deadline). If that rest had already finished by then, no rest shows. The rest the accidental log started is cancelled with it.
- The set just logged is always visible just above the current one in its box, so an accidental tick is undone with one tap on its ✓, besides the Undo toast.
- When every set of the round is done, the card advances to the next round automatically after Log (the strip still allows going back).
- **Supersets scroll to the next exercise** (Ben, 20 Oct): both exercises are always on screen; after logging 3a, 3b's box shows its current set and 3b is highlighted (3a dims); after 3b, 3a's box moves to its next set.
- **Swipe left / right on the round = next / previous exercise (round)** (Ben, 20 Oct), with a short slide; it starts anywhere on the card except a set row (set rows keep swipe-left Delete). VoiceOver: the strip chips and the "Next exercise" / "Previous exercise" custom actions on the card. Because of this, **swipe right on the exercise header no longer means Swap** in the workout: Swap is in the exercise pop-up (tap the name, `Swap exercise` top right) and in `⋯`.
- Jumping to another round with the strip doesn't change the order; Log logs the shown round's current set.

## 4. Workout overview sheet

`Workout` opens a sheet with the builder's table: `#` · Exercise + works line · `Sets` (done/total) · `Top set (kg)`. Supersets shown as `3a`/`3b` rows (no box). Done rounds dimmed with ✓, current round bright. Title `Upper body · about 55 min`. Row tap jumps to that round. Reorder/Swap/Add exercise stay available from here as today-only edits (existing OverviewEditSheets).

## 5. Time

When the session is running over the plan, the header elapsed shows a small `+12 min` after it; tapping offers the builder's fit steps (shorter rests → RPE 9 → fewer sets → drop an exercise, never the main lift) as one offer with Apply/Undo. Never applied unasked (rule 3).

## 6. Accessibility

44 pt tap areas, Dynamic Type (the table wraps the works line, numbers never truncate), VoiceOver labels "Set 3, 7.5 kilograms each, 12 reps, target RPE 9, not done", custom actions for Delete, Swap, Move, Superset.

## 7. Same editing as the builder (Ben, 20 Oct)

Ben: "should generally have same functionality as when building them". Everything the builder's Your workout page and exercise pop-up can do works mid-workout, on the **same shared components** (not copies), for today's session only:

- **Exercise pop-up**: tapping an exercise name opens the builder's exercise pop-up: name + works line, `Swap exercise` top right, per-set table `# · Type · Reps · Kg · RPE` with the keyboard bar, Type picker per set (Warm-up / Working / Top set / Back-off / Drop), `+ Warm-up`, `+ Set`, rest per set type, Move up / Move down, Superset with next / Unlink, `Why this weight?`. Done sets show their logged values; editing one is a versioned correction with Undo (rule 2); its type can change too (it changes the label and counting, not the logged numbers).
- **Sets in the table**: edit live in the cell (inline-edit fix); swipe left = Delete with Undo; **press and hold a set row, then drag** to reorder sets within the exercise (pending sets only; done sets stay in logged order); a set's Type can also be changed from a long-press menu fallback (VoiceOver: custom actions "Change type", "Move up", "Move down", "Delete").
- **Exercises**: Swap from the pop-up or `⋯` (builder's Swap pop-up, muscle-group dropdown); Remove from `⋯` (Undo; an exercise with logged sets asks first and keeps them in history). Horizontal swipes on the card change exercise (§3); **press and hold the exercise header, then drag** in the round card or the Workout sheet to reorder rounds (only rounds not yet started move; done ones stay put); `＋ Add exercise` at the end of the Workout sheet and under the last round (builder's add flow, group dropdown).
- **Supersets**: Superset with next / Unlink from ⋯ or the pop-up; also by dragging one exercise onto another in the Workout sheet. A superset with a done set can't be unlinked mid-round (only for the remaining rounds).
- **Advice**: Ben's own changes get the builder's `not recommended because…` toast (adviseBuilder) with Undo; nothing is blocked except by the hard rules (equipment limits, pain flags).
- Loads for added/swapped exercises come from the builder's load sources (§9 Q12), snapped to the gym's kit.
- Drag here is the builder's press-and-hold drag (spec §9 Q18). It is built once as a shared component and turned on in the builder too, so both pages behave the same.

## 8. Out of scope

The builder keeps its superset box (planning view).

## 9. Focus view

Focus view (one set, big numbers) stays in `⋯` in this build. The round page now does most of what it was for; once Ben has used v3 in the gym, decide whether to retire it (fewer screens to keep working) or keep it as the simple view.
