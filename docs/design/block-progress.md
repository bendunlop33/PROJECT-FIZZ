# Block progress

Status: **Approved by Ben, 31 Oct 2026.** Prototype: [prototypes/block-progress.html](prototypes/block-progress.html) (four phone frames, example data). Builds on [training-blocks.md](training-blocks.md) (plan length = block 1, 23 Oct; lead-in, 28 Oct; edits never restart the block, 30 Oct) and [progress.md](progress.md). Tokens: [design-system.md](design-system.md). Minimal copy (Ben, 10 Oct): values and actions only.

The question it answers: is each main lift actually going up across the 6-week block?

## 1. Progress › Lifts: `This block`

At the top of Lifts, above the existing per-lift charts (unchanged).

```
THIS BLOCK                       Week 3 of 6   Blocks ›
┌──────────────────────────────────────────────────────┐
│ Bench press          ▁▃▅ ▁ ▁ ┆      +5%           › │
│ 100×6 → 105×6 kg                                     │
│ Barbell row          ▅▅▅ ▁ ▁ ┆    [Stalled]       › │
│ 95×8 → 95×8 kg                                       │
│ DB shoulder press    ▃▅ ▁ ▁ ▁ ┆     +6%           › │
│ 32×8 → 34×8 kg ea                                    │
│ Pull-up              ▃▅ ▁ ▁ ▁ ┆    +5 kg          › │
│ BW×8 → BW+5×8 kg                                     │
└──────────────────────────────────────────────────────┘
■ Up / held   ■ Stalled   ┆ Deload
```

- Header: `This block` left; `Week N of 6` right (`Lead-in` in the lead-in week, `Block done` after the last week; a coach plan with no length: `Week N`). `Blocks ›` opens §4.
- One row per **main lift of the plan in use**: each plan day's main lift (as its template has it now, so a swapped main lift shows), deduplicated, in day order.
- A row: name; `week-1 best → this block's best` (one week trained: that set alone); one mini bar per block week; the change, or a `Stalled` pill.
- Bars: green = up or held, amber = stalled, dashed = deload week, grey = no session of the lift that week or not reached yet. A trained bar's height is its Est. 1RM within the lift (load when no estimate).
- Legend under the list. A row opens §2. Nothing shows when no plan has been applied (no block).

## 2. Lift block detail

```
‹ Progress        Barbell row
[Stalled 2 weeks]
Top set 95×8 kg, 3 weeks running.
 95×8  95×8  95×7
 ███   ███   ██▇
 W1    W2    W3
WEEK      TOP SET     SETS   EST. 1RM
Lead-in   92.5×8 kg   3      117 est.
1         95×8 kg     3      120 est.
2         95×8 kg     3      120 est.
3         95×7 kg     3      117 est.
┌ Next week ────────────────────────────┐
│ Barbell row        3×8 → 4×6 · 97.5   │
│ Why?   Skip   Apply                   │
└───────────────────────────────────────┘
```

- Pill: `Stalled N weeks` (amber), else the change (`+5%`, green when a gain). One line: stalled `Top set <best>, N weeks running.`; else `first → best`.
- Weekly chart of the best set (one column per week reached; `Lead-in` and `Deload` labelled).
- Table: Week · Top set · Sets · Est. 1RM. Estimates always read `est.` (rule 6). The lead-in row reads `Lead-in`, never week 1. Weeks with no session read `—`.
- **Next week** (a stalled lift in the current block): one concrete fix with `Why?`, `Skip`, `Apply`; after Apply, `Undo`. It is the existing next-time machinery, not a new decision: the Summary's own `Next time` row for that lift on its newest workout in the block (the coach's small change or bigger offer; with no AI, the built-in rule's stall reset, ADR 0006). Its taps are the Summary's own writes (versioned, one op ID per tap, offline). It changes the next session of that workout only (next week). Loads are the machinery's, snapped to the gym (rule 4). A pain flag on the lift hides Apply and shows `Held · pain` (rule 9). With no fix from the machinery, the card isn't shown (nothing invented).

## 3. Library › Plan

One line under the week circles: `5 lifts up · 1 stalled ›` (zero parts left out; hidden until a lift is up or stalled). It opens §1's view on its own screen.

## 4. Every block kept: Progress › Lifts › Blocks

```
‹ Progress           Blocks
Block 3 · Muscle                                [Now] ›
2 Nov – 13 Dec · week 3 of 6
Block 2 · Muscle                                      ›
21 Sep – 1 Nov · 32 of 36 sessions
5 up · 1 stalled · Bench press +7.5 kg
Block 1 · Strength                                    ›
3 Aug – 13 Sep · 22 of 24 sessions
4 up · Back squat +10 kg
Earlier training
1 Jun – 2 Aug · 31 sessions

BENCH PRESS BY BLOCK
[Bench press] [Back squat] [Barbell row] …
BLOCK         START       END        CHANGE
1 · Strength  109 est.    117 est.   +8%
2 · Muscle    115 est.    125 est.   +8%
3 · Muscle    120 est.    126 est.   +5%
```

- Each row: `Block N · Goal`; dates; `X of Y sessions` (plan workouts done, of days a week × weeks; the current block: `week N of 6`); `N up · M stalled`; the biggest load gain (`ea` per hand). A row opens that block's §1 view (past blocks: title `Block 2 · Muscle`, their dates in place of the week, no `Blocks ›`).
- **Comparison** for one lift (chips: every block's main lifts, the current block's first): Block · Start · End · Change. When the blocks' rep ranges differ (their week-1 best sets' reps differ), Start and End are Est. 1RM, labelled `est.`.
- Reached from `Blocks ›` in §1's header and from Library › Plan's `Previous` heading.
- `Earlier training`: history before the first block (not tappable).

## 5. Rules (code: `packages/domain/src/progress/block-lifts.ts`, `block-history.ts`)

| | |
|---|---|
| Best set (per lift, per week) | The heaviest working load, then the most reps at it. Warm-ups and sets marked `Spotted`, `Pain`, `Form broke`, `Other equipment` don't count. kg and lb compare by mass. Assisted: less assistance is heavier. Bodyweight-plus: the added load (bodyweight alone = 0). |
| Up | More load, or more reps at the same load, than the best so far. |
| Held | Equal. Green, no `+`. |
| Stalled | No gain for 2 or more trained weeks in a row; every week of that run reads amber. One week with no gain (held or lower) is not a stall yet. A later gain ends it (the amber weeks stay in the history). |
| Deload, no session | Never a stall and never break one: skipped. |
| Lead-in | Week 0, shown as `Lead-in` in the detail, never compared. Week 1 is the baseline (or the first trained week after it). |
| Δ | Est. 1RM % from week 1's best to the block's best (`+5%`, `0%`, `−2%`). Bodyweight-plus: `+5 kg`. Assisted: `Assist −5 kg`. Same load, no estimate (> 10 reps) or bodyweight only: `+2 reps`. |
| Units | `kg` / `lb` at the line's end; `ea` per hand. Mixed units: each side keeps its own. |

## 6. Blocks from stored data (no migration)

- Blocks are never stored. Each applied plan document (status applied, superseded or ended) belongs to one block: the block of the documents its `applied.block.plans` names (30 Oct: a re-apply that continued the block), else a block that starts at its own Apply. Its start is `applied.block.startedAtUtc ?? applied.atUtc` (`pbBlockStartUtc`). The key is the block's first plan document's ID.
- **Plans applied before blocks existed (23 Oct and earlier)** have no `block` field: each is its own block. History before the first applied plan is `Earlier training`.
- A block ends at the next block's start, else at its last document's End or supersede; the one with a plan in use is current.
- Its weeks are `pbBlockWeekOf`'s at the block's end (the same derivation as Today's header: Monday weeks with a plan workout, pauses skipped, lead-in before week 1). A coach plan with no length counts its weeks so far, with no deload.
- Every finished workout inside the block's weeks and its window counts for its lifts: plan, off-plan and imported. A calendar week with only off-plan workouts isn't a block week (the block waits, D19), so its sets don't show in a block.
- Main lifts: the current block reads the plan's templates (a swapped main lift shows); past blocks read the newest plan document's main slots.

## 7. Up next moved by you (Ben, approved: "it should move everything")

A day Ben moves onto today (`Move to…`, `Do today instead`) is already Up next. Today's card and Library's NEXT row show one small line under it: `Moved by you · Undo`. Undo puts the move back: the day sheet's own Undo when that move was its last change (an earlier move of the day comes back too), else this week's move of the day is taken back (`unmove`; a day it displaced goes back too). Versioned against the plan as read, one op ID per tap.

## 8. Copy

`This block` · `Week 3 of 6` · `Lead-in` · `Block done` · `Blocks ›` · `Stalled` · `Stalled 2 weeks` · `Up / held` · `Deload` · `Top set 95×8 kg, 3 weeks running.` · `Week` · `Top set` · `Sets` · `Est. 1RM` · `est.` · `Next week` · `Why?` · `Skip` · `Apply` · `Undo` · `Held · pain` · `5 lifts up · 1 stalled` · `Block 2 · Muscle` · `32 of 36 sessions` · `5 up · 1 stalled` · `Now` · `Earlier training` · `Bench press by block` · `Block` · `Start` · `End` · `Change` · `Moved by you` · `Move undone`.

## 9. Open (Ben to decide)

1. **Next week for top / back-off main lifts.** The Summary's `Next time` lists only exercises with straight working sets, so a builder plan's main lift (top set + back-offs) has no next-time row, and the card can't offer a fix for it. Options: (a) extend the Summary's next-time to top / back-off main lifts (the rule plans the top set; one change for every reader), or (b) a block-only proposal for the main lift (needs a new typed proposal and its own Apply / Undo). Until then the detail shows the stall with no card.
2. **The built-in rule rarely offers its stall reset with reps from history:** when reps drop, its range follows them, so a miss below the range is rare. With no AI, a stalled lift often has no fix to show.
3. **One week below the best** (not yet a stall) reads green with a lower bar. Alternative: grey or outline.
4. **"This block's best"** is the best so far (the prototype's `95×8 → 95×8` after a `95×7` week), and Δ uses it too.
