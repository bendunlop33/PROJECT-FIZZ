# Day sheet and one-change edits (Ben, 29 Oct 2026)

Status: **Built 29 Oct 2026 for Ben's review.** Not yet run on his iPhone.

> Ben: "I also don't find it easy to see what the plan for each day is and then change what I plan on doing."
> "How can we make it easier to update the exercise for one day of the plan and no other changes too?"
> Scope default: "just have this week as default".

## 1. The day sheet

Tap any tile on Today's week (a rest day too), or a this-week day row on Library › Plan.

```
Thu · Push B                         ← weekday · plan day (a rest day: `Sun 1 Nov`)
Today                                ← Done · Today · Planned · Missed · Skipped · Rest
EXERCISE                 SETS  TARGET KG
DB shoulder press        3 × 6–8   24 ea
Incline DB press •       3 × 8–12  22 ea   ← • a this-week change
…
Push A  52 min · 16 sets  ›          ← a done day: what was done, opens its Summary
[ Start ]                            ← today only
Do today instead   Move to…   Edit   Skip this week
```

- The list is Today's card's compact list (sets × reps, target kg, `ea`, `DB`; redesign-27oct §B).
- **Start** (today's day): Today's own one-tap Start.
- **Do today instead**: Set days, swaps its weekday with today's day this week (no day today: moves it to today).
  Any days: puts it on Today's card (nothing written, as `Do today ›`).
- **Move to…**: Set days, the weekdays left this week no other day still to do holds.
- **Skip this week** / **Unskip**: out of this week's tiles, Up next and count (`3 of 5`).
- **Edit**: the day's exercises; tap one for **Swap** or **Remove**, or **＋ Add exercise**. Scope chips
  **This week only** (default from Today) and **Every week** (default from Library).
- Every change: a toast with **Undo**; the tiles, Up next and the card follow at once.
- Library adds **More ›** (the plan day's page: Open, Make next, Ask coach). Other weeks' rows still open that page.

## 2. The card picker (`Push B ⌄`)

The week's plan days: `Thu  Push B  Up next ✓`, `Fri  Pull B  Planned`, `Mon  Legs A  Done`, `Missed`, `Skipped`.
One tap puts a day on the card. No plan: Profile › Split's days, as before.

## 3. One change, nothing else

- **Swap** changes only the exercise: the row keeps its sets, reps, rest, place, superset and main mark. Suggestions
  for the same muscles first (the shared Swap / Add sheet), then search.
- **Remove** leaves one row out; **Add** puts one row last (3 × 8–12, no superset).
- Nothing is recalculated by the edit: no refit of the stored day, no reorder, no other exercise or day touched, no
  deload or block change. A second change to the same row replaces the first; swapping back is no change.
- **This week only** is stored with the plan (`weekEdits`, this block week; week 0 in the lead-in) and laid over the
  template when Today reads it. The template never changes; next week is the plan as it was.
- **Every week** is one versioned write of the template (an `update_routine` record; Undo is its revert). Done
  workouts are their own records and never change (rule 2).
- Target weight: Today's own rule from Ben's history of the new exercise; with none, `—` (no reference to estimate
  from on Today's card: see Open). A weight Ben types on a changed row is kept as typed (in the exercise's own load
  convention) and the gym learns it (a dumbbell, a plate, a machine's max; rule 4); the change's Undo takes both back.
- Writes are idempotent by op ID and refused when stale (the plan's version, the row as seen; rule 5).

## 4. Fixed with it (Ben's build 478 screenshot)

- Leg press read `BW`: compact lists treated a plate-loaded machine's `added` load as bodyweight plus. Now a kg number.
- `Both work your quads, so the second one suffers.` on Today's card: the builder's pairing advice; Today's card now
  shows only the run clash.
- `Legs` with an RDL main lift: two plan days on one split day both read the split's name on Today; they now read as
  the plan names them (`Legs A`, `Legs B`).
- The rings: on HEAD the week reads Thu Push B (today), Fri Pull B, Sat Legs B (plan3's Set days rules); with the names
  fixed no ring or sheet can borrow another day's name.

## 5. Open

- An estimate (`est.`) for a swapped-in exercise with no history isn't on Today's card yet: the card's loads have no
  related-lift reference, so it shows `—`. Start still plans it light (the first-time ceiling).
- Today's card reads a swapped-in exercise's reps from Ben's last session of it (as every card does, 21 Oct); the
  stored row keeps its own.
- A day already open as an edited Your workout draft today keeps that draft; a this-week edit shows on its next card.
- Library's `Open <day>` (Your workout from the template) doesn't lay this week's edits on yet.
