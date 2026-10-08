# Weekly plan (calendar, endurance sessions, move/skip/replace, missed, availability, trade-offs, programme blocks)

Status: v0.1 draft, 8 Oct 2026. Brief §1 (Routines and plan), §4 Programme and weekly plan, §6 (`AvailabilityRule`, `Programme` / `ScheduledSession`, `EnduranceActivity`), §7 (`rescheduleSession`, `getWeeklyTrainingSummary`), §12 Page 2; acceptance scenario 3 ("a planned long run follows tomorrow"). Playbook: `docs/training-guides/concurrent-training.md` (C1–C4, C8). Tokens: [design-system.md](design-system.md). Opened from [today.md](today.md) as the `Week` segment of the Plan hub ([routines.md](routines.md) RT1).

The plan is **prepared outside the logging loop**. Nothing on this screen runs between sets, and nothing here moves a session by itself.

## 1. Purpose

The weekly plan answers **"What's planned this week, and does it still fit my week?"**

There is **no `PrimaryButton`** on the week view: Today owns `Start workout`. The main action is **tap a session to change it** (move, skip, replace). Today's session sheet carries `Start workout` as its primary.

Secondary answers: what's done, what was missed, which endurance sessions are fixed, and where a lifting session conflicts with a key endurance session.

### Design decisions to confirm with Ben (flagged, not yet in the brief)

| # | Decision | Reason |
|---|---|---|
| WP1 | **Build in two phases.** Phase A (with routines, build step 2–4): a repeating weekly pattern of routines, this week's move/skip/replace, missed sessions. Phase B (step 6): endurance sessions, programme blocks, availability, trade-off warnings, reschedule by chat. **Brief §10 puts the whole calendar in step 6** | Today already needs `plannedSession` and `Next: …` (today.md §6), which need a schedule. Phase A is small and local |
| WP2 | **Ben's own single-session edits apply at once with Undo** (toast `timing.undoToast`): move one occurrence, skip, replace, add, mark endurance done. **Series edits ("every week"), weekly-pattern edits and everything the coach suggests go through [change-review.md](change-review.md)** | Rule 2 and ADR 0006 make future changes from the coach proposals. A one-session move by Ben is his explicit action; a review step would only add taps. Series edits touch many sessions, so Ben sees them listed first |
| WP3 | **Endurance sessions are planned entries Ben types** (sport, day, optional time, target duration or distance, `Fixed`, `Key`). A past one shows `Done` only if Ben marks it or a confirmed import matches it; otherwise `Not confirmed`, **never `Missed`** | Rule 6: the app doesn't know whether he ran. No live Garmin/Strava claims (brief §Connections) |
| WP4 | **"Heavy legs" is deterministic**: `classifySessionLoad` marks a session heavy-legs when it has **≥ 6 working or top sets of squat, hinge or lunge patterns**, or **any** such set with a target of **RPE ≥ 8 / RIR ≤ 2** or a top rep target **≤ 6**. Ben can override per routine (routines.md RT7). Thresholds are data, editable in Profile | concurrent-training C3 defines heavy lower-body as "squat/deadlift/lunge emphasis, RPE ≥ 8". A rule the UI can explain beats a model's guess |
| WP5 | **Trade-off warnings come only from playbook rules Ben has approved** (candidates C2, C3, C4). Until he approves one, no warning shows and Profile → Scheduling rules says `No scheduling rules approved yet.` Warnings never block and never move anything | Training-guide rules are candidates until Ben approves them (CLAUDE.md agent table). Avoids presenting unapproved advice as the app's rule |
| WP6 | **Missed** = a planned strength session whose day ended without a workout started from it. Missed sessions are never moved automatically. A banner offers `Move` / `Skip` for misses in the current week only | Brief §4: support missed sessions. No silent reshuffle |
| WP7 | **`Fixed` sessions are locked**: the coach never moves, replaces or shortens them, and its proposals list them under `Not changed`. Ben can move a Fixed session himself after a confirm | Brief scenario 3: don't casually overwrite a planned long run |
| WP8 | A **vertical day list**, not a 7-column grid | Readable at 390pt and at AX sizes; matches the programme preview (workout-builder §8) |
| WP9 | **Strength and endurance are counted separately** in the week summary (`1 of 3 gym sessions done · Long run planned Sat`). No combined load or fatigue score | concurrent-training C8; brief §3 |

## 2. Layout

### 2.1 Week view (normal, Phase B)

Regions top to bottom: nav bar · segmented control · programme line · week switcher · week summary · banners (0–2: missed, changes to review) · day list · `Availability this week ›` · Ask pill.

```
┌────────────────────────────────────────┐
│ ‹ Today          Plan              ⋯   │ ⋯: Edit weekly pattern, Change
│        [✓ Week  |  Routines ]          │    history, Scheduling rules
├────────────────────────────────────────┤
│ Strength + 10k · Week 2 of 6         › │ programme line
│ [◀]    This week · 12–18 Oct    [▶]    │ week switcher, 44pt buttons
│ 1 of 3 gym sessions done               │ strength (actual)
│ Long run planned Sat                   │ endurance (planned), separate
│                                        │
│ ⚠ Missed Pull A on Wed.                │ StatusBanner, warning
│   [ Move ]  [ Skip ]                   │
│ 💬 1 change to review                › │ open proposals (change-review)
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ Mon 12  ✓ Push A · Done · 54 min   │ │ DayRow; actual duration
│ ├────────────────────────────────────┤ │
│ │ Tue 13  Rest                       │ │
│ ├────────────────────────────────────┤ │
│ │ Wed 14  ! Pull A · Missed        › │ │ icon + word
│ ├────────────────────────────────────┤ │
│ │┃Thu 15 · Today                     │ │ accent bar + word "Today"
│ │┃○ Legs A · about 60 min          › │ │
│ │┃⚠ Heavy legs 2 days before your   │ │ ConflictNote (approved C3)
│ │┃  long run. Options ›              │ │
│ ├────────────────────────────────────┤ │
│ │ Fri 16  Available 30 min           │ │ availability note, no session
│ ├────────────────────────────────────┤ │
│ │ Sat 17  🔒 Long run · 90 min     › │ │ Fixed + Key
│ │         Fixed · Key · 07:30        │ │
│ ├────────────────────────────────────┤ │
│ │ Sun 18  ○ Easy ride · 60 min     › │ │ endurance, not fixed
│ └────────────────────────────────────┘ │
│ Availability this week               › │
│                             ( 💬 Ask ) │
└────────────────────────────────────────┘
```

Day row rules (`DayRow`, 52pt min per item):
- Left column: weekday and date (`Thu 15`), tabular. Today: 4pt `accent` left bar, `accent.subtle` background and the word `Today` (never colour alone).
- One line per item: status icon, name, then `about N min` (planned, `estimateRemainingDuration`) or the actual (`Done · 54 min`). Endurance items show the sport word and the target (`Long run · 90 min`, `Run · 10 km`).
- Second line (only when there's something to say): `Fixed · Key · 07:30`, `Moved from Wed`, `Replaced Push B`, a `ConflictNote`, or an availability mismatch (`⚠ About 60 min planned, 30 min available`).
- Empty day: `Rest` (when the pattern says rest), `Available 30 min` (availability set, nothing planned), or `—`.
- Items in a day are ordered by time if set, then strength before endurance only when the playbook rule C1 (lift first) is approved; otherwise in the order Ben added them.

### 2.2 Week view, Phase A (no endurance, no programme)

```
│ [◀]    This week · 12–18 Oct    [▶]    │
│ 1 of 3 gym sessions done               │
│ ┌────────────────────────────────────┐ │
│ │ Mon 12  ✓ Push A · Done · 54 min   │ │
│ │ Tue 13  —                          │ │
│ │ Wed 14  ! Pull A · Missed        › │ │
│ │ Thu 15 · Today                     │ │
│ │         ○ Legs A · about 60 min  › │ │
│ │ Fri 16  —                          │ │
│ │ Sat 17  ○ Push A · about 55 min  › │ │
│ │ Sun 18  —                          │ │
│ └────────────────────────────────────┘ │
│ Repeats every week · Edit pattern ›    │
```

### 2.3 Session sheet (tap a session; medium detent)

```
┌────────────────────────────────────────┐
│ Legs A · Thu 15 Oct              Close │
│ 6 exercises · about 60 min · Main Gym  │
│ From your weekly pattern               │ or: Programme week 2 · Moved from Wed
│ ⚠ Heavy legs 2 days before your long   │ ConflictNote, full text
│   run (Sat 17, 07:30). Options ›       │
│                                        │
│ [           Start workout            ] │ PrimaryButton: today only
│ Move to another day                  › │ rows, 52pt
│ Replace with another routine         › │
│ Skip this session                      │
│ Open routine                         › │
└────────────────────────────────────────┘
```

- Future and past days have no `Start workout`; the actions are rows. A Missed session adds `Do it today` (moves it to today, then shows `Start workout`).
- Endurance item sheet: `Long run · Sat 17 Oct · 07:30`, target, `Fixed` and `Key` switches, `Edit`, `Move`, `Remove`, and for past days `Mark done` / `Didn't happen`.

### 2.4 Move picker (pushed in the sheet)

```
┌────────────────────────────────────────┐
│ ‹ Back     Move Legs A                 │
│ [✓ This week only ] [ Every week ]     │ segmented; Every week → review
│ Tue 13  —                              │
│         ✓ No conflicts                 │ conflicts worked out per day
│ Wed 14  Pull A (missed)                │
│         ✓ No conflicts                 │
│ Thu 15  (current)                      │
│ Fri 16  Available 30 min               │
│         ⚠ 1 day before your long run   │
│         ⚠ About 60 min, 30 available   │
│ Sat 17  🔒 Long run                    │
│         ⚠ Same day as your long run    │
│ Sun 18  Easy ride                      │
│         ✓ No conflicts                 │
│ Next week ›                            │
└────────────────────────────────────────┘
```

Tapping a day moves at once (WP2). Days with warnings still work; Ben has seen them. Past days aren't offered.

### 2.5 Trade-off sheet (`Options ›` on a conflict note; medium detent)

```
┌────────────────────────────────────────┐
│ Heavy legs before your long run  Close │
│ Legs A (Thu 15) is 2 days before your  │ facts
│ long run (Sat 17, 07:30).              │
│ Your rule: keep heavy lower-body work  │ approved playbook rule, quoted
│ about 48 h away from key long runs.    │
│ (C3 · moderate evidence)  Why? ›       │
│ Legs A counts as heavy legs: 8 squat   │ classifySessionLoad reason
│ and hinge working sets.                │
│                                        │
│ Options                                │
│ Move Legs A to Tue 13 (no conflicts) › │ deterministic
│ Swap days with Push A (Sat → Thu)?     │ only if conflict-free
│ Ask the coach to lighten Legs A      › │ coach; proposal (change-review)
│ Keep as planned                        │ records the choice
└────────────────────────────────────────┘
```

- Options are worked out by `suggestConflictFreeDays`, except the coach option, which sends a request (`Lighten Legs A for this week; long run Sat`) and returns a proposal for review. Offline, the coach option shows `Coach offline` and is disabled.
- The long run is never offered as the thing to move (WP7).
- `Keep as planned` collapses the note to `⚠ Kept as planned · heavy legs before long run` (one line, still visible).

### 2.6 Availability this week (sheet)

```
┌────────────────────────────────────────┐
│ Availability · 12–18 Oct          Done │
│ From your usual week. Changes here     │
│ apply to this week only.               │
│ Mon  [Off] [30] [45] [✓60] [90] min    │ ParamChips; wrap at AX1+
│ Tue  [✓Off] [30] [45] [60] [90]        │
│ ...                                    │
│ Fri  [Off] [✓30] [45] [60] [90]        │
│ Sat  [Off] [30] [45] [60] [✓90]        │
│ Change your usual week in Profile ›    │
└────────────────────────────────────────┘
```

Mismatches show on the day row (`⚠ About 60 min planned, 30 min available`) with the session sheet offering `Move`, or (once `shortenSession` exists) `Shorter version ›`. Nothing shortens automatically.

### 2.7 Add to a day (tap an empty day, or a day's `＋` in its sheet)

`Add a workout` (routine picker = Routines list in pick mode) · `Add endurance session` · `Mark as rest day`.

Endurance form: `Sport` (`Run`, `Ride`, `Swim`, `Row`, `HYROX sim`, `Other`) · `Day` · `Time (optional)` · `Target` (`Duration [1:30 ▾]` or `Distance [10 km]`) · `Fixed: don't let the coach move this` switch · `Key session: protect it from heavy legs before it` switch (shown only when an approved rule uses it) · `Repeat every week` switch (→ change-review, WP2). Primary `Add to Sat 17`.

## 3. States

| State | Shows | Notes |
|---|---|---|
| Loading | Nothing for 300 ms, then static day rows | Local |
| No plan yet | `No weekly plan yet.` + `Pick your training days ›` (pattern editor) + `Or start from a routine` (switches to Routines). No empty calendar grid | — |
| Pattern only (Phase A) | §2.2 | — |
| Programme active | Programme line `Strength + 10k · Week 2 of 6 ›` | Deload week: `Week 4 of 6 · Deload` |
| Programme ending / ended | `Last week of Strength + 10k.` / `Strength + 10k ended 22 Nov. Your weekly pattern continues.` + `Build the next block ›` (workout-builder §8) | Never extends itself |
| Missed (current week) | Banner `Missed Pull A on Wed.` [Move] [Skip]; row `! Pull A · Missed` | WP6. Two misses: `Missed 2 sessions this week.` [Review] |
| Different workout done on a planned day | Planned row `Push A · Not started · you did Pull A` with `Count it as done` / `Move Push A` in its sheet | No guessing which counts |
| Endurance not confirmed | Past row `Long run · Not confirmed` + sheet [Mark done] [Didn't happen] | WP3 |
| Endurance confirmed by import (later) | `✓ Long run · 18.2 km · from FIT file, imported 18 Oct` | Source and date always shown |
| Conflict (approved rule) | `ConflictNote` under the session | WP5 |
| No approved scheduling rules | No conflict notes. `⋯` → `Scheduling rules` shows `No scheduling rules approved yet.` | — |
| Availability mismatch | Second line on the day | — |
| Change to review | Banner `1 change to review ›` | change-review.md |
| Proposal went stale | Banner `1 suggestion is out of date ›` (opens change-review stale state) | Rule 5 |
| Workout in progress | Today's row: `▶ Legs A · In progress` and the sheet shows `Resume` | — |
| Past week | Read-only except endurance confirmation and `Count it as done`. Done rows open summaries | — |
| Future week beyond programme / pattern | Pattern repeats; beyond 8 weeks ahead: `Plans further ahead appear as the weeks get closer.` | Bounded |
| Time zone differs from the plan's | Line under the week switcher: `Days shown in Auckland time (your plan's time zone).` [Use this phone's time zone] | Dates stored as UTC + tz (CLAUDE.md conventions) |
| Offline | No change; everything is local. Ask pill `Offline` | Rule 1 |
| Coach unavailable | No change except the coach option in trade-offs is disabled with `Coach offline` | — |
| Database error | `Couldn't open your training data.` [Try again] [Restore from backup] | — |
| Write failed | Toast `Couldn't save that change. Nothing moved.` [Try again] (same opId) | — |

Transitions (one session):

```
 Planned ──day ends, nothing started──► Missed ──Move/Do it today──► Planned (Moved from Wed)
    │  ├─Move──► Planned (other day)          └─Skip──► Skipped
    │  ├─Skip──► Skipped ──Undo/Unskip──► Planned
    │  ├─Replace──► Planned (Replaced Push B)
    │  └─Start (today)──► In progress ──finish──► Done
    └─coach proposal applied (change-review)──► Planned (new day / routine)
```

## 4. Interactions

### 4.1 Week view
| Element | Tap | Other |
|---|---|---|
| Programme line | Programme detail (the scheduled form of workout-builder §8: weeks, deloads, `Ask for changes`, `End programme early`) | — |
| `◀` / `▶` | Previous / next week | No swipe-only navigation (sweaty hands, accidental swipes) |
| Week title | Back to this week | — |
| Missed banner `Move` | Move picker for that session | `Skip`: skips at once, toast [Undo] |
| `1 change to review ›` | change-review list | — |
| Session row | Session sheet (§2.3) | Long-press: same sheet (no hidden actions) |
| Empty day | Add sheet (§2.7) | — |
| `ConflictNote` `Options ›` | Trade-off sheet (§2.5) | — |
| `Availability this week ›` | §2.6 | — |
| Ask pill | Coach sheet with the week attached as context | — |

### 4.2 Direct edits (WP2: apply at once, toast with Undo)
| Action | Call | Toast |
|---|---|---|
| Move (this week only) | `rescheduleSession(id, newDateLocal, expectedVersion)` | `Moved Legs A to Tue 13` [Undo] |
| Skip | `skipScheduledSession(id, expectedVersion, opId)` | `Skipped Pull A (Wed)` [Undo] |
| Replace | `replaceScheduledSession(id, routineId, expectedVersion)` | `Thu 15 is now Push B` [Undo] |
| Add | `addScheduledSession(input, opId)` / `upsertPlannedEndurance(input, opId)` | `Added Long run to Sat 17` [Undo] |
| Endurance done / didn't happen | `setEnduranceStatus(id, 'done' \| 'not_done', expectedVersion)` | `Marked Long run done` [Undo] |
| Count another workout as done | `linkSessionToSchedule(sessionId, scheduledSessionId)` | `Pull A counts for Wed` [Undo] |
| Keep as planned (conflict) | `acknowledgeConflict(conflictId)` | none (the note changes) |
| Move a Fixed session | Confirm first: `Long run is fixed. Move it anyway?` [Move] [Cancel], then as Move | as Move |

Undo calls `undoAction(actionId)` with the version the toast was created for. If the session changed since (e.g. it started), the toast becomes `Can't undo: Legs A has started.` and nothing changes.

### 4.3 Series edits and pattern (via change-review)
- `Every week` in the move picker, `Repeat every week` on an add, and `⋯` → `Edit weekly pattern` build a proposal with author `Ben` (`proposeScheduleChange(pattern, opId)`), then open [change-review.md](change-review.md) listing every affected date for the next 4 weeks (and the rest of the programme), with scope `Future sessions` or `This programme`.

### 4.4 Reschedule by chat or voice
- Ben asks in the coach sheet or by Talk: "I'm away Thursday and Friday", "move legs to Tuesday", "I can only do 30 minutes Friday". `classifyCoachIntent` → `reschedule`; the coach uses `get_schedule` and `propose_reschedule`.
- The reply is short, and the sheet shows a proposal card: `Moves 2 sessions this week · Review ›`. Nothing changes before Apply (rule 3: future sessions are always proposals). Fixed sessions are never in the changes; the card lists them under `Not changed`.
- The proposal names exact local dates (`Tue 13 Oct`), never "tomorrow", so a confirmation can't drift across midnight. A proposal whose earliest affected day has started expires.
- Voice confirmation rules are in change-review.md §4.4.
- Coach offline: `Rescheduling by chat needs the coach. You can move sessions here yourself.` (sheet), and the week view works as normal.

### 4.5 Trade-off warnings (WP4, WP5)
- `checkScheduleConflicts(week, approvedRules, sessionLoads)` runs locally after every change to the week. It returns notes `{ruleId, kind, itemIds, facts, options}`. The UI never writes its own advice.
- Rules shown when approved (wording from concurrent-training.md, shortened):
  - **C3**: heavy legs within ~48 h **before** a `Key` long run/ride, race or HYROX simulation. Note: `Heavy legs 2 days before your long run.` (days, or hours when both times are set: `Heavy legs 40 h before your long run.`)
  - **C2**: heavy legs and hard/long endurance on the same day less than 6 h apart (times needed). Note: `Heavy legs and your intervals are under 6 h apart.`
  - **C4**: heavy legs the day **after** a long run/ride **that was confirmed** (marked done or imported). Note: `Heavy legs the day after your long run.` With the run not confirmed, no note (rule 6).
- A note quotes facts only (days, times, the session's heavy-legs reason). It never says Ben will be fatigued.

### 4.6 Keyboard
Only the endurance form's distance field and the pattern editor's name field use a keyboard. Numeric fields use `WorkoutKeypad`; the primary (`Add to Sat 17`) sits above it.

### 4.7 Undo summary
| What | Undo |
|---|---|
| Direct edit | Toast [Undo] (8 s), then `⋯` → `Change history` → `Undo` (if still safe) |
| Series / pattern / coach change | change-review.md §4.5 |
| Skipped | `Unskip` in the session sheet while the day hasn't ended |
| Acknowledged conflict | `Show warning again` in the session sheet |

## 5. Copy

Planned values (`about 60 min`, `90 min`, `10 km`) are **targets**. `Done · 54 min` and imported distances are **actuals** with their source.

| Element | Text |
|---|---|
| Hub | `Plan` · `Week` · `Routines` |
| Week switcher | `This week · 12–18 Oct` · `Next week · 19–25 Oct` · `Last week · 5–11 Oct` |
| Summary | `1 of 3 gym sessions done` · `Long run planned Sat` · `Long run done Sat` · `No gym sessions planned` |
| Programme | `Strength + 10k · Week 2 of 6` · `Week 4 of 6 · Deload` · `Last week of Strength + 10k.` · `Strength + 10k ended 22 Nov. Your weekly pattern continues.` · `Build the next block ›` · `Repeats every week · Edit pattern ›` |
| Status words | `Done` · `Missed` · `Skipped` · `In progress` · `Moved from Wed` · `Replaced Push B` · `Not started · you did Pull A` · `Not confirmed` · `Rest` · `Today` · `Fixed` · `Key` |
| Missed banner | `Missed Pull A on Wed.` [Move] [Skip] · `Missed 2 sessions this week.` [Review] |
| Changes banner | `1 change to review ›` · `2 changes to review ›` · `1 suggestion is out of date ›` |
| Session sheet | `6 exercises · about 60 min · Main Gym` · `From your weekly pattern` · `Programme week 2` · `Move to another day` · `Replace with another routine` · `Skip this session` · `Open routine` · `Do it today` · `Start workout` · `Resume` · `Count it as done` · `Unskip` |
| Endurance sheet | `Mark done` · `Didn't happen` · `Fixed` · `Key` · `Edit` · `Move` · `Remove` · `from FIT file, imported 18 Oct` |
| Move picker | `Move Legs A` · `This week only` · `Every week` · `No conflicts` · `(current)` · `Next week ›` · `Long run is fixed. Move it anyway?` [Move] [Cancel] |
| Conflict notes | `Heavy legs 2 days before your long run.` · `Heavy legs 40 h before your long run.` · `Heavy legs and your intervals are under 6 h apart.` · `Heavy legs the day after your long run.` · `Kept as planned · heavy legs before long run` · `Options ›` |
| Trade-off sheet | `Heavy legs before your long run` · `Legs A (Thu 15) is 2 days before your long run (Sat 17, 07:30).` · `Your rule: keep heavy lower-body work about 48 h away from key long runs. (C3 · moderate evidence)` · `Legs A counts as heavy legs: 8 squat and hinge working sets.` · `Options` · `Move Legs A to Tue 13 (no conflicts)` · `Swap days with Push A` · `Ask the coach to lighten Legs A` · `Keep as planned` |
| Availability | `Availability · 12–18 Oct` · `From your usual week. Changes here apply to this week only.` · `Off` · `30` `45` `60` `90` `min` · `Available 30 min` · `About 60 min planned, 30 min available` · `Change your usual week in Profile ›` |
| Add | `Add a workout` · `Add endurance session` · `Mark as rest day` · `Sport` · `Run` `Ride` `Swim` `Row` `HYROX sim` `Other` · `Time (optional)` · `Target` · `Duration` · `Distance` · `Fixed: don't let the coach move this` · `Key session: protect it from heavy legs before it` · `Repeat every week` · primary `Add to Sat 17` |
| No plan | `No weekly plan yet.` · `Pick your training days ›` · `Or start from a routine` |
| Rules | `Scheduling rules` · `No scheduling rules approved yet.` |
| Time zone | `Days shown in Auckland time (your plan's time zone).` [Use this phone's time zone] |
| Far future | `Plans further ahead appear as the weeks get closer.` |
| Toasts | `Moved Legs A to Tue 13` · `Skipped Pull A (Wed)` · `Thu 15 is now Push B` · `Added Long run to Sat 17` · `Marked Long run done` · `Pull A counts for Wed` · all [Undo] · `Can't undo: Legs A has started.` · `Couldn't save that change. Nothing moved.` [Try again] |
| Coach | proposal card `Moves 2 sessions this week · Review ›` · offline `Rescheduling by chat needs the coach. You can move sessions here yourself.` |

Spoken (voice requests only): "I've suggested moving Legs to Tuesday the 13th and Push to Saturday. Review it on screen." Changes are never read as done before Apply.

## 6. Data needed

Existing (brief §6–8; other specs):
- `getWeeklyTrainingSummary(userId, range)` (strength and endurance kept separate), `estimateRemainingDuration`.
- `rescheduleSession(id, newTime, expectedVersion)` (one occurrence).
- `startWorkout(routineId, gymId, opId)` (links the session to its `scheduledSessionId`), `getActiveSession`.
- `getAiCapabilities`, `classifyCoachIntent`, `runCoachTurn`, tools `get_schedule`, `propose_reschedule`; `undoAction`.
- `classifySessionLoad(routineVersion)` (routines.md §6).
- `buildTodayView` reads the same schedule for `plannedSession` and `nextSession`.

**Proposed new (flagged for the developer and Ben):**

| Function | Contract |
|---|---|
| `buildWeekPlanView(ownerId, weekStartLocal, tz)` | Days `{date, availabilityMin?, items[{kind: 'strength' \| 'endurance', scheduledId, routineId?, name, estimateMin?, actualMin?, status: 'planned' \| 'in_progress' \| 'done' \| 'missed' \| 'skipped' \| 'not_confirmed' \| 'not_done', fixed, key, timeLocal?, provenance: 'pattern' \| 'programme' \| 'added' \| 'moved' \| 'replaced', notes[]}]}`, `summary` (strength and endurance separately), `programme {id, name, week, weeks, deload}`, `openProposalCount`, `staleProposalCount`, `missedThisWeek[]`. Local only |
| `skipScheduledSession(id, expectedVersion, opId)` / `unskipScheduledSession` | Occurrence only |
| `replaceScheduledSession(id, routineId, expectedVersion)` | Occurrence only |
| `addScheduledSession(input, opId)` / `removeScheduledSession(id, expectedVersion)` | Occurrence; `repeat` goes through `proposeScheduleChange` |
| `upsertPlannedEndurance(input, opId)` / `setEnduranceStatus(id, status, expectedVersion)` | Planned endurance entries (WP3); `source: 'ben'`; imported matches later carry `source` and import ID |
| `linkSessionToSchedule(sessionId, scheduledSessionId)` | "Count it as done" |
| `setWeeklyAvailability(weekStartLocal, days[], opId)` | Per-week override of `AvailabilityRule` |
| `checkScheduleConflicts(weekItems, approvedRules, sessionLoads)` | **Pure, `packages/domain`, unit-tested.** Only rules with `approved: true` in the playbook. Returns `{conflictId, ruleId, kind, itemIds, facts, text}` |
| `suggestConflictFreeDays(itemId, weekItems, approvedRules, availability)` | **Pure.** Candidate days with their notes, for the move picker and trade-off options |
| `acknowledgeConflict(conflictId)` | Stores Ben's "keep as planned" |
| `proposeScheduleChange(change, opId)` | Builds an author-`ben` proposal for series and pattern edits (change-review.md) |
| `ScheduledSession` fields | `fixed`, `key`, `kind`, `timeLocal?`, `tz`, `provenance`, `linkedSessionId?`, `seriesId?` |
| Playbook rule records | `{ruleId: 'C3', text, grade, approved, params {hours: 48, heavyLegsThresholds}}`, read by the domain, edited only by Ben |

## 7. Acceptance checks

1. **Brief scenario 3.** With C3 approved, a `Key` long run on Sat and Legs A on Thu, the Thu row shows `Heavy legs 2 days before your long run.` with `Options ›`. Nothing moves until Ben picks an option. The long run is never offered as the thing to move.
2. With C3 **not** approved, the same week shows no conflict note, and `Scheduling rules` says `No scheduling rules approved yet.`
3. A coach reschedule proposal never changes the week before Apply; a `Fixed` session never appears in its changes and is listed under `Not changed`.
4. Move one session (this week only) applies at once with a toast; Undo within 8 s puts it back; the series is unchanged.
5. `Every week` opens change-review listing every affected date; nothing changes until Apply.
6. A planned strength session whose day ended with no workout shows `Missed` (icon + word) and the current-week banner. Nothing is moved automatically.
7. A past endurance session with no confirmation shows `Not confirmed`, never `Missed` or `Done`; no distance, pace or fatigue is shown unless imported, and an imported value names its source and import date.
8. The week summary shows strength and endurance as separate lines; no combined score appears anywhere on the screen.
9. `classifySessionLoad` marks a routine with 8 squat/hinge working sets as heavy legs, one with 2 sets at RPE 7 as not, and Ben's `No` override wins (unit tests). The trade-off sheet quotes the reason.
10. C4's day-after note appears only when the long run is marked done or imported.
11. Setting Fri availability to 30 min with a 60 min session shows the mismatch line; nothing is shortened or moved.
12. A reschedule made at 23:50 for "Tue 13 Oct" lands on 13 Oct in the plan's time zone; a proposal whose first affected day has started is shown as expired, not applied.
13. With airplane mode on and no AI, every direct edit works; only chat rescheduling and the trade-off coach option show `Coach offline`.
14. Today's `Next: …` and planned card match the plan after a move, skip or replace (same data, no refresh drift).
15. Every status (Done, Missed, Skipped, Not confirmed, Fixed, Key, Today) is distinguishable in greyscale by icon and word.
16. At AX3 the day list stacks (date above items), availability chips wrap, and no number or unit is truncated. Week navigation has buttons; there are no swipe-only actions.

## Proposed design-system additions

No new colours or timing tokens.

| Component / style | Spec |
|---|---|
| Schedule status styles (extends §7) | `Planned` `circle` `text.tertiary` · `Done` `checkmark.circle.fill` `status.done` · `In progress` `arrowtriangle.right.fill` `accent` · `Missed` `exclamationmark.circle` `status.warning` · `Skipped` `slash.circle` `text.tertiary` · `Not confirmed` `questionmark.circle` `text.secondary` · `Didn't happen` `xmark.circle` `text.secondary`. Each with its word; VoiceOver reads the word |
| `FixedBadge` / `KeyBadge` | Text tags in set-type badge style: `lock.fill` + `Fixed`; `flag.fill` + `Key`. `text.secondary` on `bg.raised`. Never `accent` |
| `DayRow` | 52pt min per item; date column 64pt (tabular); today = 4pt `accent` left bar + `accent.subtle` background + the word `Today` (`type.label`). At AX1+ the date sits above its items |
| `ConflictNote` | `exclamationmark.triangle` (`status.warning`) + one or two lines `type.callout` + `Options ›` (`accent`, 44pt hit). Acknowledged variant: one line, `text.secondary`, same icon |
| `WeekSwitcher` | `chevron.left` / `chevron.right` buttons 44 × 44, title `type.headline` (tabular dates), tap title = this week |

## Cross-links

- [routines.md](routines.md): Plan hub (RT1), routine picker for Replace/Add, `classifySessionLoad` and the `Counts as heavy legs` override (RT7)
- [change-review.md](change-review.md): series edits, pattern edits, coach reschedules, stale handling
- [today.md](today.md): `Next: …`, `Reschedule` (opens this view with today's session selected) and the planned card
- [workout-builder.md](workout-builder.md) §8: programme request, preview and scheduling (programme blocks)
- [exercise-library.md](exercise-library.md): not used directly; routines link to it
- `docs/training-guides/concurrent-training.md` C1–C4, C8; `docs/training-guides/programmes.md` (deload weeks, 2–3 day templates)
