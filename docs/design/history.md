# Recent and History

> **New (Ben, 26 Oct).** "At the moment the app isn't very good at showing recent activity beyond the last couple of days." Today's 7-day strip shows 3 days back; the old `Recent` list (today.md) was dropped with Today v2; Past workouts listed gym workouts only and sat in Library › Workouts. Two changes:
> 1. **Today › Recent:** the last 14 days of what Ben did, workouts and activities together, under the session.
> 2. **History:** Past workouts grows into one list of everything, by week, with a filter. One list only: it replaces Past workouts (route `History`), keeping every Past workouts capability.
>
> Built by the developer on 26 Oct. Not yet run on Ben's iPhone.

## 1. Purpose

- See at a glance what was done over the last two weeks without opening Progress.
- Scroll back through every workout and run, week by week, from one place.
- Keep Past workouts' jobs (repeat, delete with Undo, Save to Workouts, Log a past workout, Recently deleted) where the history is.

## 2. Today › Recent

Below the session card and its `Build your own` / `＋ Activity` row. Hidden while a workout is open (Resume owns Today then).

```
RECENT
┌────────────────────────────────────────────┐
│ Mon 26 Oct   Push A       52 min · 16 sets ›│
│ Sun 25 Oct   Run          5.2 km · 28 min  ›│
│ Sat 24 Oct   Legs         1 h 04 min · 18 sets ›│
│ …at most 6 rows                             │
└────────────────────────────────────────────┘
All history ›
```

- **Rows:** done in the last 14 days (today included), newest first, at most 6. One compact row each: weekday + date, name, one value line. Workout: `52 min · 16 sets` (imported, date-only: `16 sets`, no duration; rule 6). Activity: distance and time (`5.2 km · 28 min`), either alone, else its effort word.
- **Only what was done.** A planned activity isn't listed (it stays on the strip, dashed, and on the calendar).
- **Tap:** a workout opens its Summary (as the strip's day sheet does); an activity opens its sheet (edit, delete, Undo toast).
- **Empty:** nothing done in 14 days shows no section and no copy.
- **Large text:** at accessibility sizes the date, name and value stack in the row.
- **VoiceOver:** each row is one button: `Monday 26 October, Push A, 52 min · 16 sets`.
- **Cost:** no extra workout read. Today already reads the last 42 days of stored history summaries; Recent uses them. One activities read covers the strip and Recent.

## 3. History

Opened from Today's `All history ›`, Library › Workouts' `All history ›` (was `Past workouts ›`) and Progress › Calendar's `All history ›`. Title `History`; `Select` top right.

```
History                                Select
[ All | Workouts | Activities ]
＋ Log a past workout

This week                  1 workout · 1 activity
┌──────────────────────────────────────────────┐
│ Mon 26 Oct · Push A                       ⋯  │
│ Bench press, Incline press, Lateral raise    │
│ Main Gym · 52 min · 16 sets                  │
├──────────────────────────────────────────────┤
│ Sun 25 Oct · Run                          ›  │
│ 5.2 km · 28 min                              │
└──────────────────────────────────────────────┘
Last week                              3 workouts
…
13–19 Oct                  2 workouts · 1 activity
…
Show more
Recently deleted (2) ›
```

- **Weeks:** Monday-first. Headers `This week`, `Last week`, then the range (`13–19 Oct`, `27 Oct – 2 Nov`; another year's: `15–21 Dec 2025`). Each header has the week's tiny total (`2 workouts · 1 activity`; one kind only: just that). Weeks with nothing aren't listed. Header and total are read as one heading.
- **Filter:** `All · Workouts · Activities` (the app's segmented control). Not saved; opens on All.
- **Paging:** this week and the five before it; `Show more` loads the next six weeks. A long gap (months off) is skipped: the next page always reaches the newest older entry. No `Show more` when nothing older exists.
- **Workout rows** are Past workouts' rows: title `Mon 26 Oct · Push A`, done exercises on one line, `Main Gym · 52 min · 16 sets` (imported: no gym). Tap opens Repeat (nothing logged: its Summary). `⋯` → `Save to Workouts`. VoiceOver action `Delete`.
- **Activity rows:** `Sun 25 Oct · Run`, value line; tap opens the activity sheet (edit, delete or cancel, Undo toast).
- **Select:** lists workouts only (an activity is deleted from its sheet); `Select all` covers what is loaded; `Delete (n)` → confirm sheet → one all-or-nothing write → toast with Undo (delete-workouts §2.3 unchanged).
- **Empty:** `Nothing logged yet.` (filtered: `No workouts yet.` / `No activities yet.`), only when nothing older exists either.
- **Unreadable:** the existing `n workouts couldn’t be read and aren’t listed.` with `Check data ›`.
- **Imported tag:** none, as Past workouts since 18 Oct (an imported row shows no gym and no duration).

## 4. Activities from other sources (Apple Health, later)

History and Recent read the activities model, not a source. A future read-only source adds rows with their own `source` (e.g. `health`). When such an activity is the same session as a gym workout (`linkedSessionId`), it is listed once, as the workout. An activity linked to a workout that isn't listed (deleted) still shows. Nothing here is built for Health yet.

## 5. Data needed

- `todaySession.load().recent`: `FeedItem[]` (domain `history-feed.ts`).
- `history.feed({ from? })`: `{ today, from, items, workouts (by session ID: the Past workouts row), unreadable, olderFrom }`. Batched reads: stored summaries in one range read, activities in one, one read each for the newest older entry; workout rows described in one go (exercises and gyms read once).
- Pure: `mergeFeed`, `recentFeed`, `groupFeedByWeek`, `weekHeader`, `weekTotalText`, `filterFeed`, `historyFirstFrom`, `historyOlderFrom` (domain); `historyView`, `historyRowTitle`, `historyWorkoutLine` (apps/mobile `history/history-view.ts`).

## 6. Acceptance checks

1. Today shows up to 6 rows from the last 14 days, workouts and done activities merged, newest first; none: no section.
2. A workout row opens its Summary; an activity row opens its sheet; `All history ›` opens History.
3. History groups by Monday-first week with `This week`, `Last week`, then date ranges, each with its total.
4. The filter shows All, Workouts or Activities; select mode shows workouts only.
5. `Show more` loads older weeks and skips a long gap; absent when nothing older exists.
6. Repeat, Select → Delete with Undo, `⋯` Save to Workouts, Log a past workout and Recently deleted all work from History.
7. A deleted workout leaves Recent and History; Undo brings it back. A retried activity add (same op ID) is listed once. A force-close shows the same list.
8. Today's cold-start perf budgets still pass (`npm run test:perf`, `test:perf:jitless`).

## 7. Open

- A planned activity whose date has passed and was never marked done isn't in History (it is on the calendar, as planned). Should it show, marked `Planned`?
- The Library link reads `All history ›` (it was `Past workouts ›`, approved 26 Oct) to match Today and the Calendar, and so it doesn't read like Library's own `From history` section.
