# Log a past workout, and moving a workout in time

> **New (Ben, 25 Oct).** "I should be able to freely edit times, e.g. if I want to import a workout historically from the day before or beyond." Two changes:
> 1. **Free date and time editing.** Started / Ended let Ben pick any past date and time. Moving the start moves the **whole workout**: every set, pause and rest by the same amount, so order and durations stay as logged. Ended can then be set on its own. Before this, the start could only move a day back and never past the first set (19 Oct).
> 2. **`Log a past workout`.** A workout done on another day, entered now: pick a date and start time, tick the sets, Finish asks the end. It sits in history at its date and counts for Progress, history, progression and plan weeks by that date.
>
> Built by the developer on 25 Oct (`docs/decisions/0033-moving-a-workout-in-time.md`). Not yet run on Ben's iPhone.

## 1. Purpose

- Enter a workout after the fact (forgot the phone, logged on paper, a hotel gym) on the day it happened.
- Correct a workout's date or time without the clamps getting in the way.
- Keep everything that reads "the latest workout" honest: ordering is always by the workout's date, never by when it was entered.

## 2. Moving the start moves the whole workout

Where: the Finish sheet (active-workout §4.8), Summary and a past workout's `Edit times` (workout-summary §4), and a past log's `Edit workout times`.

```
┌────────────────────────────────────────┐
│ Edit workout times                     │
│ Started      Fri 24 Oct, 18:00   ▾     │
│ Ended        Fri 24 Oct, 19:05   ▾     │
│ 1 h 5 min                              │
│ ┌────────────────────────────────────┐ │
│ │               Save                 │ │
│ └────────────────────────────────────┘ │
│ Cancel                                 │
└────────────────────────────────────────┘
```

- **Started** opens the iOS date-and-time wheel: any past day and time (back to 2000; not in the future). The workout moves with it. **Ended** moves by the same amount, so the duration shown stays the same, until Ben moves Ended himself.
- **Ended**: after the last set (where it is after the move), at least a minute after the start, not in the future.
- The rows show the date whenever the workout isn't today (and, as before, when it crosses midnight).
- Out of range: the wheel stops at the limit and one short line says why (`Start can’t be in the future`, `Sets can’t move into the future`, `End can’t be before the last set`, `Start can’t be before 2000`).
- **Save**: one `update_session_timing` with `shift: true` (the Finish sheet: `finish` with `shift: true`). Logged values never change; only times move.
- After Save: toast `Times changed` [Undo] on the Summary (`Start time changed` [Undo] in a past log). Undo is the same move back on the new version; if anything changed since, it says `Couldn’t undo: changed since`.
- **Not changed:** the live workout's own `Edit workout times` (before Finish) still moves only the start, at most a day back and never past the first set: a live workout can't move while its clock runs. See §7 Q-PL1.

## 3. Log a past workout

**Entry points:** Today's `⋯` sheet (under Empty workout / Build your own), Library › Workouts (under Empty workout), Past workouts (top of the list).

```
┌────────────────────────────────────────┐
│ Log a past workout                     │
│ Date          Fri 24 Oct         ▾     │
│ Start         18:00              ▾     │
│                                        │
│ START FROM                             │
│ Empty workout                    ›     │
│ YOUR PLAN                              │
│ Upper A                          ›     │
│ Lower A                          ›     │
│ SAVED WORKOUTS                         │
│ Push A                           ›     │
│ Cancel                                 │
└────────────────────────────────────────┘
```

- **Date** defaults to yesterday; **Start** to the time of day the latest workout started (5-minute steps), else 18:00. Not in the future.
- A row starts the workout at once: empty, a plan day, or a saved workout (its sets with the usual targets). No check-in is asked or linked; today's pre-start drafts are left alone. A retry or double tap is the same Start (one operation per opening).
- **In the workout** (Your workout / the workout screen as usual), with **no clock**:
  - Ticking a set logs it. No rest starts, no rest alert, no Live Activity, no spoken cues. Timed sets have no Start/Stop: the time is typed in.
  - The top bar shows the date and start (`Fri 24 Oct, 18:00`) instead of the running time. No Time left. `⋯` has no Pause and no spoken cues; `Edit workout times` moves the whole workout.
  - Set times are placeholders in the order ticked (a second apart from the start). They are never shown as times and never read as pace.
- **Finish** asks the end like any Finish. Ended starts an hour after the start (`(estimated)` until moved); no `Use now`.
- An open past log is the workout in progress like any other (Resume on Today shows its date). A force-close restores it as it was.

## 4. Ordering by workout date

Everything that reads "the latest" orders by the workout's start, never by when it was written:

| Reader | Rule |
|---|---|
| Last time, prefill, `lastComparableSession` | Newest by workout date. A past log never becomes last time while a newer workout of that exercise exists |
| Up next, plan rotation, plan block week, deload mark | Finished workouts by date. A past log's deload mark is read for its own date |
| Progress, calendar, weekly review | By date; history caches change with any workout's revision, so they recompute after a log or a move |
| Summary of an older workout | Compared with the workout before it; records and the highlight read only earlier workouts; no `Next time` row for an exercise done again since (the newer Summary says what's next) |
| Coach next-session targets | A past log never marks them used (it isn't the next workout) |

## 5. Data and rules

- `WorkoutSession.pastLog = { enteredAt }` (Your data, in backups). Migration 37.
- Every shift is audited: the start's timing entry keeps `before`, `after` and `shiftMs`; the original recorded times are recoverable. Pauses move only with a shift in the same write (checked by trigger and write path).
- Rule 2: logged values and set versions never change. Rule 5: operation IDs, versions; a stale sheet is refused.
- Times are stored in UTC with the workout's zone. A move across a DST change keeps durations exactly; the wheel's local time is what Ben picked.

## 6. Acceptance checks

1. Log a workout for yesterday 18:00 after logging today's: history, Progress and the calendar show it on yesterday; tomorrow's last time is today's.
2. In a past log, ticking sets starts no rest, alert, Live Activity or cue; Pause isn't offered; a timed set takes a typed time.
3. Force-close mid past log: it comes back as it was, no rest timer.
4. Move a finished workout a week back: every set, pause and the end move by a week; durations and values unchanged; `Times changed` [Undo] puts it back exactly.
5. A retried Save is a no-op; a sheet opened before another edit is refused (`The workout changed. Close and try again.`).
6. Ended can't go before the (moved) last set or into the future; Started can't go into the future or push sets past now.
7. A move across the clocks changing (e.g. late October in London) keeps durations to the minute and shows the picked local time.

## 7. Open for Ben

- **Q-PL1.** Moving Started now moves the sets too. The 19 Oct case "forgot to press Start, so the start should be earlier but the sets stay" no longer has a way on the Finish sheet or Summary. Options: (a) keep as built (move = whole workout); (b) a second row action `Only the start` that keeps the sets; (c) moving the start earlier within an hour keeps the sets, beyond that moves everything. Developer suggests (b) if Ben misses it.
- **Q-PL2.** Ticking sets in a past log is one tap each, values prefilled from the target. Should `Log a past workout` from a saved workout or plan day offer `Tick all as planned` for when it went exactly to plan?
