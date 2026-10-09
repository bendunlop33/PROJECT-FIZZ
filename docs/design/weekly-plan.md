# Weekly plan (calendar, endurance sessions, move/skip/replace, missed, availability, trade-offs, programme blocks)

> **Revision 2026-10-09 (playbook v1 review fixes).**
> - **One switch definition.** The endurance switch is on only when a **hard, long or key** session is in the plan (planned or usual) or logged (imported or reported). An easy run, ride or class never turns it on. `Class or HIIT` and `Match or sport` entries start on `Hard or long`, and Ben can change that.
> - **WP11, the rule 13 line, follows the goal.** It shows only when endurance is one of Ben's goals (`Support other training`, `Endurance` under also matters, or a dated endurance-type event within ~8 weeks), and never when he lifts fewer than 2 days a week. A Muscle lifter with a weekly jog no longer gets a weekly nudge towards heavy sets.
> - **WP13, the lift-first hint, follows the priority.** "Lift first, keep the run easy" appears only when lifting is the priority. With `Support other training` as the focus, or a priority endurance-type event in phase, only the key-session order applies.
> - Both conditions come from `resolveTrainingContext` (`rule13Active`, `liftFirstApplies`), not the UI.
> - Changed: header, WP11–WP13, §2.1, §2.7, §3, §4.5, §5, §6, §7 checks 18, 20–22 and new 23–25.

> **Revision 2026-10-09 (playbook v1, approved by Ben 9 Oct; "stop with hyrox").** Scheduling now follows [playbook-v1.md](../training-guides/playbook-v1.md) instead of the concurrent-training candidates:
> - **Rule renumbering:** rule **11** (same-day order, was C1), rule **12** (≥ 6 h spacing and keeping heavy legs out of the 48 h before a key session, was C2 + C3) and rule **13** (≥ 2 heavy strength sessions a week, was C5). C4 (day after a long run) isn't in v1, so its note is withdrawn.
> - **Endurance switch:** rules 11–13 work only while it's on (rule G). It's on when a hard, long or key endurance, class or sport session is in the plan (planned or usual in Profile) or logged (imported or reported); revised in the review fixes above. Otherwise the week shows no spacing notes and never mentions them.
> - **No sport special cases.** `HYROX sim` is removed from the endurance form, which now offers `Class or HIIT` and `Match or sport`. `Key` can be set on any session.
> - **New:** usual other training from Profile shows as `Usual` items (WP10); a rule 13 week line (WP11); an optional `Effort` on endurance entries for rule 12's 6 h check (WP12); same-day order from rule 11 (WP13); and an after-match note for confirmed matches (rule 12 applied to sport, rule G).
> - The weekly pattern's default number of gym days comes from `Days a week you lift` (Profile).
> - Changed: header, WP4, WP5, WP10–WP13, §2.1, §2.5, §2.7, §3, §4.5, §5, §6, §7 checks 1, 2, 10 and 17–22.

> **Revision 2026-10-08 (consolidation).** `Scheduling rules` (WP5, `⋯` menu) is not a separate Profile screen: it opens Guides & playbook ([coaching-playbook.md](coaching-playbook.md)) filtered to the scheduling rules C2–C4, where Ben approves them. The heavy-legs thresholds (WP4) are stored with rule C3's parameters in the playbook (Coaching knowledge) and shown on that rule's detail as a `Linked setting` (coaching-playbook PB10); the per-routine override stays in the routine (Your data). Plans, availability and endurance entries are Your data (design-system §7.2). Component additions are merged into design-system (§7.1 schedule statuses, §9.35 `DayRow`, §9.43 `NoteLine` for `ConflictNote`, `WeekSwitcher`, `FixedBadge` / `KeyBadge` on the `Tag` frame).

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** The session sheet's `Start workout` goes through the check-in gate ([check-in.md](check-in.md) §2.1). The check-in's `Feeling ill` step uses this spec's existing actions: `Skip workout` calls `skipScheduledSession` (toast `Skipped Push A (Thu 8 Oct)` [Undo]) and `Reschedule` opens the move picker (§2.4) for today's session. Neither is pushed: the check-in only offers them, next to `Train anyway`. No other change.

Status: v0.1 draft, 8 Oct 2026. Brief §1 (Routines and plan), §4 Programme and weekly plan, §6 (`AvailabilityRule`, `Programme` / `ScheduledSession`, `EnduranceActivity`), §7 (`rescheduleSession`, `getWeeklyTrainingSummary`), §12 Page 2; acceptance scenario 3 ("a planned long run follows tomorrow"). Playbook: [playbook-v1.md](../training-guides/playbook-v1.md) rules 11–13, G (endurance switch) and the data-honesty guardrail (strength and endurance counted separately; was C8). Library background: `docs/training-guides/concurrent-training.md`. Tokens: [design-system.md](design-system.md). Opened from [today.md](today.md) as the `Week` segment of the Plan hub ([routines.md](routines.md) RT1).

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
| WP4 | **"Heavy legs" is deterministic**: `classifySessionLoad` marks a session heavy-legs when it has **≥ 6 working or top sets of squat, hinge or lunge patterns**, or **any** such set with a target of **RPE ≥ 8 / RIR ≤ 2** or a top rep target **≤ 6**. Ben can override per routine (routines.md RT7). Thresholds are data, shown and edited with **rule 12**'s defaults in Guides & playbook (was C3; coaching-playbook §2.2b) | concurrent-training C3 defines heavy lower-body as "squat/deadlift/lunge emphasis, RPE ≥ 8". A rule the UI can explain beats a model's guess |
| WP5 | (Revised 9 Oct.) **Trade-off notes come only from approved playbook rules (11, 12, 13; playbook v1) and only while the endurance switch is on** (`resolveTrainingContext().enduranceRulesActive`). If Ben removes a rule from his playbook, its notes stop. With the switch off, the week shows no spacing note, no rule 13 line and no mention of interference. Notes never block and never move anything | Rule G: rules 11–13 are "dormant and not mentioned" without endurance-type training. Approved rules only, as before |
| WP6 | **Missed** = a planned strength session whose day ended without a workout started from it. Missed sessions are never moved automatically. A banner offers `Move` / `Skip` for misses in the current week only | Brief §4: support missed sessions. No silent reshuffle |
| WP7 | **`Fixed` sessions are locked**: the coach never moves, replaces or shortens them, and its proposals list them under `Not changed`. Ben can move a Fixed session himself after a confirm | Brief scenario 3: don't casually overwrite a planned long run |
| WP8 | A **vertical day list**, not a 7-column grid | Readable at 390pt and at AX sizes; matches the programme preview (workout-builder §8) |
| WP9 | **Strength and endurance are counted separately** in the week summary (`1 of 3 gym sessions done · Long run planned Sat`). No combined load or fatigue score | concurrent-training C8; brief §3 |
| WP10 | (9 Oct) **Usual other training from Profile shows as `Usual` items**, e.g. `Running · usual`. They aren't planned sessions: they don't count in the summary, can't be `Done` or `Missed`, and vanish when Ben adds a real entry that day. Key usual days are protected by rule 12 like planned key sessions. Notes that would rely on a past usual session having happened (after-match) are never shown | Rule G counts Ben's stated usual training for the endurance switch, but "usual sessions are confirmed before they're relied on". Showing them makes the switch visible and lets Ben confirm with one tap (`Add to this week`) |
| WP11 | (9 Oct; revised in the review fixes) **Rule 13 week line.** Shown only when rule 13 applies: the switch is on, endurance is one of Ben's goals (`resolveTrainingContext().rule13Active`), and he lifts 2 or more days a week. Then, if fewer than 2 sessions this week count as heavy strength, one info line shows under the summary: `ⓘ 1 heavy strength session planned. Rule 13 keeps 2 while you train for endurance. Options ›`. `classifySessionLoad` marks a session heavy strength when it has ≥ 2 working sets of a squat, hinge, press or pull compound with a top rep target ≤ 6. With 1 lifting day it never shows; the coach says once, when Ben asks it to plan, that two heavy sessions aren't possible | Makes the approved floor visible in the plan, deterministically, without the coach raising it, and only for the "endurance phases" the rule is about. Options are a coach suggestion (proposal) or `Keep as planned` |
| WP12 | (9 Oct; revised in the review fixes) **Endurance entries get an optional `Effort`: `Easy` / `Hard or long`.** Rule 12's same-day 6 h check fires only on `Hard or long` or `Key` entries. With no effort set, only `Key` counts. The same test decides whether an entry turns the endurance switch on. `Class or HIIT` and `Match or sport` start on `Hard or long` | Rule 12 spaces heavy legs from "hard or long endurance". Without this the app would have to guess intensity (rule 6) |
| WP13 | (9 Oct; revised in the review fixes) **Same-day order follows rule 11.** With a lifting session and an endurance item on the same day and no times set: if the endurance item is `Key`, it's listed first with `ⓘ Key run first today. Ask the coach to lighten Legs A ›`. Otherwise, **only when lifting is the priority** (`liftFirstApplies`: the main focus isn't `Support other training` and no priority endurance-type event is in phase), lifting is listed first with `ⓘ Same day: lift first, keep the run easy.` When endurance is the priority, items keep Ben's order and there's no hint | Applies rule 11 as a hint, not a move, under its own condition, "strength as the priority". Times set by Ben always win the order |

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
│ │ Tue 13  ◌ Running · usual        › │ │ WP10: from Profile, not planned
│ ├────────────────────────────────────┤ │
│ │ Wed 14  ! Pull A · Missed        › │ │ icon + word
│ ├────────────────────────────────────┤ │
│ │┃Thu 15 · Today                     │ │ accent bar + word "Today"
│ │┃○ Legs A · about 60 min          › │ │
│ │┃⚠ Heavy legs 2 days before your   │ │ ConflictNote (rule 12)
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
- (Revised 9 Oct and in the review fixes, WP13) Items in a day are ordered by time if set. Without times, with the endurance switch on, rule 11 applies: a `Key` endurance item goes first; otherwise lifting goes first only when lifting is the priority. Each case has its one-line hint. Otherwise items show in the order Ben added them, with no hint.
- (9 Oct, WP10) `Usual` items: `circle.dotted` + the type and the word `usual` (`Running · usual`, `Match · usual · Key`), in `text.secondary`. Tap → a small sheet: `Running · usual on Tue (from Profile)` · `Add to this week` (creates a planned entry, toast with Undo) · `Not this week` (hides it for this week) · `Edit in Profile ›`.
- (9 Oct, WP11) The rule 13 line, when shown, sits under the week summary as a `NoteLine` (info):

```
│ 1 of 3 gym sessions done               │
│ Long run planned Sat                   │
│ ⓘ 1 heavy strength session planned.    │ NoteLine, info (rule 13; only
│   Rule 13 keeps 2 while you train for  │ when endurance is a goal and
│   endurance. Options ›                 │ 2+ lifting days)
```

  `Options ›` opens the trade-off sheet (§2.5) with `Ask the coach to add heavy sets to Push A ›` (a suggestion via change-review) and `Keep as planned`.

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
│ Your rule: keep heavy leg work out of  │ approved playbook rule, quoted
│ the 48 h before a key session.         │
│ (Rule 12 · Moderate)  Why? ›           │ Why? → rule 12 detail
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

Endurance form (revised 9 Oct): `Type` (`Run`, `Ride`, `Swim`, `Row`, `Class or HIIT`, `Match or sport`, `Other` + name field) · `Day` · `Time (optional)` · `Target` (`Duration [1:30 ▾]` or `Distance [10 km]`; hidden for `Match or sport`) · `Effort (optional)` `Easy` / `Hard or long` (WP12; starts on `Hard or long` for `Class or HIIT` and `Match or sport`) · `Fixed: don't let the coach move this` switch · `Key session: keep heavy legs away from it` switch (always shown; rule 12 is approved. For `Match or sport` it starts on, as the playbook treats matches as key, and Ben can turn it off) · `Repeat every week` switch (→ change-review, WP2). Primary `Add to Sat 17`. No type names a race brand or event format; an event Ben is training for lives in Profile (`Working towards`).

## 3. States

| State | Shows | Notes |
|---|---|---|
| Loading | Nothing for 300 ms, then static day rows | Local |
| No plan yet | `No weekly plan yet.` + `Pick your training days ›` (pattern editor) + `Or start from a routine` (switches to Routines). No empty calendar grid. (9 Oct) The pattern editor shows `You lift 3 days a week (Goals & schedule)` above the day chips, with Ben's usual days preselected only if he set them; it never adds sessions by itself | — |
| Pattern only (Phase A) | §2.2 | — |
| Programme active | Programme line `Strength + 10k · Week 2 of 6 ›` | Deload week: `Week 4 of 6 · Deload` |
| Programme ending / ended | `Last week of Strength + 10k.` / `Strength + 10k ended 22 Nov. Your weekly pattern continues.` + `Build the next block ›` (workout-builder §8) | Never extends itself |
| Missed (current week) | Banner `Missed Pull A on Wed.` [Move] [Skip]; row `! Pull A · Missed` | WP6. Two misses: `Missed 2 sessions this week.` [Review] |
| Different workout done on a planned day | Planned row `Push A · Not started · you did Pull A` with `Count it as done` / `Move Push A` in its sheet | No guessing which counts |
| Endurance not confirmed | Past row `Long run · Not confirmed` + sheet [Mark done] [Didn't happen] | WP3 |
| Endurance confirmed by import (later) | `✓ Long run · 18.2 km · from FIT file, imported 18 Oct` | Source and date always shown |
| Conflict (approved rule) | `ConflictNote` under the session | WP5 |
| No approved scheduling rules | No conflict notes. `⋯` → `Scheduling rules` shows `No scheduling rules in your playbook.` (only if Ben removed 11–13; v1 has them approved) | — |
| Endurance rules off (9 Oct) | No conflict notes, no rule 13 line, no same-day hints, no `Usual` items. `Scheduling rules` shows rules 11–13 with `Off now: <reason>` | Rule G switch |
| Only easy other training (review fixes) | Same as "Endurance rules off". Easy planned entries still show on their days as ordinary endurance items, with no notes | Switch counts hard, long or key only |
| Usual training only (9 Oct) | `Usual` items on their days; 48 h-before-key notes against key usual days; no after-match or 6 h notes (no times, nothing confirmed) | WP10 |
| Heavy strength below 2 (9 Oct; revised in the review fixes) | Rule 13 line under the summary, only when endurance is a goal and Ben lifts 2+ days a week | WP11 |
| Switch on, endurance not a goal (review fixes) | Rule 12 notes and rule 11 hints as normal; no rule 13 line | WP11 |
| Endurance is the priority (review fixes) | No "lift first" hint; key sessions still go first | WP13 |
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
- `checkScheduleConflicts(weekItems, approvedRules, sessionLoads, context)` runs locally after every change to the week, and after any Profile change to goal, days or other training. It returns notes `{ruleId, kind, itemIds, facts, options}`. `context` is `resolveTrainingContext` (endurance switch, key sessions, usual items). With the switch off it returns nothing. The UI never writes its own advice.
- Notes from approved playbook v1 rules (revised 9 Oct; wording from playbook-v1.md, shortened). The examples say "long run"; the note always names the actual item (`intervals`, `class`, `match`, `ride`).
  - **Rule 12, before a key session:** heavy legs within 48 h **before** any `Key` item (planned or usual): a long run or ride, race, match, class or anything Ben marks `Key`. Note: `Heavy legs 2 days before your long run.` (days, or hours when both times are set: `Heavy legs 40 h before your long run.`)
  - **Rule 12, same day:** heavy legs and a `Hard or long` or `Key` endurance item on the same day, under 6 h apart (times needed; WP12). Note: `Heavy legs and your intervals are under 6 h apart.`
  - **Rule 12 for sport (rule G):** heavy legs within 48 h **after** a match **that was confirmed** (marked done, imported or reported). Note: `Heavy legs the day after your match.` With the match not confirmed, or only usual, no note (rule 6).
  - **Rule 11, same day without times:** ordering and hint only (WP13). The lift-first hint needs `context.liftFirstApplies`.
  - **Rule 13, week:** fewer than 2 heavy strength sessions (WP11), only when `context.rule13Active` and stated days ≥ 2.
  - **Withdrawn:** C4's "day after a long run" note. It isn't in playbook v1. Rule 12's spacing covers the hard-session case, and an easy day after a long run is Ben's call. If he wants the note back, it would come as a new candidate rule.
- A note quotes facts only (days, times, the session's heavy-legs reason). It never says Ben will be fatigued.
- Event-specific movements or tapers aren't scheduled here. An event in Profile (`Working towards`) affects the week only through a programme or plan suggestion Ben applies (workout-builder §8; playbook rule G).

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
| Conflict notes (revised 9 Oct) | `Heavy legs 2 days before your long run.` · `Heavy legs 40 h before your long run.` · `Heavy legs 2 days before your match.` · `Heavy legs and your intervals are under 6 h apart.` · `Heavy legs the day after your match.` · `Kept as planned · heavy legs before long run` · `Options ›` |
| Rule 11 and 13 lines (9 Oct; revised in the review fixes) | `Same day: lift first, keep the run easy.` (only when lifting is the priority) · `Key run first today. Ask the coach to lighten Legs A ›` · `1 heavy strength session planned. Rule 13 keeps 2 while you train for endurance. Options ›` (only when endurance is a goal and 2+ lifting days) · `Ask the coach to add heavy sets to Push A` |
| Usual items (9 Oct) | `Running · usual` · `Match · usual · Key` · sheet `Running · usual on Tue (from Profile)` · `Add to this week` · `Not this week` · `Edit in Profile ›` · toast `Added Running to Tue 13` [Undo] |
| Trade-off sheet | `Heavy legs before your long run` · `Legs A (Thu 15) is 2 days before your long run (Sat 17, 07:30).` · `Your rule: keep heavy leg work out of the 48 h before a key session. (Rule 12 · Moderate)` · `Legs A counts as heavy legs: 8 squat and hinge working sets.` · `Options` · `Move Legs A to Tue 13 (no conflicts)` · `Swap days with Push A` · `Ask the coach to lighten Legs A` · `Keep as planned` |
| Availability | `Availability · 12–18 Oct` · `From your usual week. Changes here apply to this week only.` · `Off` · `30` `45` `60` `90` `min` · `Available 30 min` · `About 60 min planned, 30 min available` · `Change your usual week in Profile ›` |
| Add (revised 9 Oct) | `Add a workout` · `Add endurance session` · `Mark as rest day` · `Type` · `Run` `Ride` `Swim` `Row` `Class or HIIT` `Match or sport` `Other` · `Time (optional)` · `Target` · `Duration` · `Distance` · `Effort (optional)` `Easy` `Hard or long` · `Fixed: don't let the coach move this` · `Key session: keep heavy legs away from it` · `Repeat every week` · primary `Add to Sat 17` |
| No plan | `No weekly plan yet.` · `Pick your training days ›` · `Or start from a routine` · (9 Oct) `You lift 3 days a week (Goals & schedule)` |
| Rules | `Scheduling rules` · `No scheduling rules in your playbook.` · `Off now: <reason>` |
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
| `checkScheduleConflicts(weekItems, approvedRules, sessionLoads, context)` (revised 9 Oct and in the review fixes) | **Pure, `packages/domain`, unit-tested.** Only rules with `approved: true` in the playbook (11, 12, 13), and nothing at all when `context.enduranceRulesActive` is false (the switch counts only hard, long or key items). `same_day_order` with lift-first only when `context.liftFirstApplies`; `heavy_floor` only when `context.rule13Active` and `context.daysPerWeek.value ≥ 2`. Returns `{conflictId, ruleId: '11' \| '12' \| '13', kind: 'before_key' \| 'same_day_gap' \| 'after_match' \| 'same_day_order' \| 'heavy_floor', itemIds, facts, text}`. Uses usual items for `before_key` only |
| `suggestConflictFreeDays(itemId, weekItems, approvedRules, availability, context)` | **Pure.** Candidate days with their notes, for the move picker and trade-off options |
| `resolveTrainingContext(ownerId, date)` (9 Oct; contract in coaching-playbook.md §6) | Endurance switch, its reason, key sessions (planned and usual), days a week for the pattern editor |
| `listUsualItems(ownerId, weekStartLocal, tz)` (9 Oct) | `Usual` items for the week from Profile → Other training, minus days where Ben hid them or added a real entry. `hideUsualItem(entryId, dateLocal, opId)` for `Not this week` |
| `classifySessionLoad(routineVersion)` additions (9 Oct) | Adds `heavyStrength: boolean` and its reason (≥ 2 working sets of a squat, hinge, press or pull compound with top rep target ≤ 6), for rule 13 (WP11) |
| `acknowledgeConflict(conflictId)` | Stores Ben's "keep as planned" |
| `proposeScheduleChange(change, opId)` | Builds an author-`ben` proposal for series and pattern edits (change-review.md) |
| `ScheduledSession` fields | `fixed`, `key`, `kind`, `timeLocal?`, `tz`, `provenance`, `linkedSessionId?`, `seriesId?`; (9 Oct) endurance entries add `type: 'run' \| 'ride' \| 'swim' \| 'row' \| 'class' \| 'sport' \| 'other'`, `label?`, `effort?: 'easy' \| 'hard'` |
| Playbook rule records | (revised 9 Oct) `{ruleId: '12', text, grade, approved, params {hoursBeforeKey: 48, hoursAfterMatch: 48, minGapHours: 6, heavyLegsThresholds}}`, `{ruleId: '13', params {minHeavySessions: 2}}`, read by the domain, edited only by Ben (coaching-playbook §2.2b) |

## 7. Acceptance checks

1. **Brief scenario 3.** With rule 12 approved (playbook v1), a `Key` long run on Sat and Legs A on Thu, the Thu row shows `Heavy legs 2 days before your long run.` with `Options ›`. Nothing moves until Ben picks an option. The long run is never offered as the thing to move.
2. With rule 12 removed from Ben's playbook, the same week shows no conflict note, and `Scheduling rules` doesn't list it.
3. A coach reschedule proposal never changes the week before Apply; a `Fixed` session never appears in its changes and is listed under `Not changed`.
4. Move one session (this week only) applies at once with a toast; Undo within 8 s puts it back; the series is unchanged.
5. `Every week` opens change-review listing every affected date; nothing changes until Apply.
6. A planned strength session whose day ended with no workout shows `Missed` (icon + word) and the current-week banner. Nothing is moved automatically.
7. A past endurance session with no confirmation shows `Not confirmed`, never `Missed` or `Done`; no distance, pace or fatigue is shown unless imported, and an imported value names its source and import date.
8. The week summary shows strength and endurance as separate lines; no combined score appears anywhere on the screen.
9. `classifySessionLoad` marks a routine with 8 squat/hinge working sets as heavy legs, one with 2 sets at RPE 7 as not, and Ben's `No` override wins (unit tests). The trade-off sheet quotes the reason.
10. (Revised 9 Oct) No "day after a long run" note appears in any case (C4 isn't in playbook v1). The after-match note appears only when the match is marked done, imported or reported, never for a usual or unconfirmed match.
11. Setting Fri availability to 30 min with a 60 min session shows the mismatch line; nothing is shortened or moved.
12. A reschedule made at 23:50 for "Tue 13 Oct" lands on 13 Oct in the plan's time zone; a proposal whose first affected day has started is shown as expired, not applied.
13. With airplane mode on and no AI, every direct edit works; only chat rescheduling and the trade-off coach option show `Coach offline`.
14. Today's `Next: …` and planned card match the plan after a move, skip or replace (same data, no refresh drift).
15. Every status (Done, Missed, Skipped, Not confirmed, Fixed, Key, Today) is distinguishable in greyscale by icon and word.
16. At AX3 the day list stacks (date above items), availability chips wrap, and no number or unit is truncated. Week navigation has buttons; there are no swipe-only actions.
17. (9 Oct) The endurance form's types are `Run`, `Ride`, `Swim`, `Row`, `Class or HIIT`, `Match or sport` and `Other`. No option, placeholder or note names HYROX or any other race brand.
18. (9 Oct; revised in the review fixes) With no hard, long or key endurance, class or sport entries this week, none imported or reported in the last 7 days, and other training `None`, `Not set` or only `Easy`, the week shows no conflict note, rule 13 line, same-day hint or `Usual` item. Unit test: `checkScheduleConflicts` returns `[]` when the switch is off.
19. (9 Oct) With `Running · Tue, Sat · Sat key` set as usual in Profile and nothing planned, Tue and Sat show `Running · usual`. Legs A on Thu gets `Heavy legs 2 days before your run.` The summary still counts only gym sessions, and `Add to this week` turns the usual item into a planned entry with Undo.
20. (9 Oct; revised in the review fixes) With the switch on, `Endurance` under also matters, 3 lifting days, and only Legs A (heavy) and two light sessions planned, the rule 13 line shows `1 heavy strength session planned…`. Adding a heavy session removes it. With the switch off, with endurance not one of Ben's goals, or with 1 lifting day, it never shows.
21. (9 Oct) A Thu run at 07:00 and Legs A at 11:00 (4 h apart): with the run marked `Easy` or no effort set, there's no note. Marked `Hard or long` or `Key`, it shows `Heavy legs and your run are under 6 h apart.` Moving Legs A to 13:00 (6 h apart) removes the note. Unit tests cover 5 h 59 min and 6 h 00 min.
22. (9 Oct; revised in the review fixes) Same day, no times, switch on, Strength focus: the lifting session is listed above a normal run with `Same day: lift first, keep the run easy.`, and below a `Key` run with `Key run first today…`. Nothing is moved or retimed.
23. (Review fixes) Same day, no times, switch on, `Support other training` as the focus: a normal run and a lifting session keep Ben's order with no hint, and a `Key` run still goes first with its hint. No screen says "lift first" to this user.
24. (Review fixes) Muscle focus with one usual `Easy` jog and nothing else: the week shows nothing about rules 11–13. Marking the jog `Hard or long` turns rule 12 notes and rule 11 hints on, but still no rule 13 line (endurance isn't a goal).
25. (Review fixes) A `Class or HIIT` entry opens with `Hard or long` selected. Changing it to `Easy` removes any 6 h note it caused and, if it was the only hard item, turns the switch off.

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
- [playbook-v1.md](../training-guides/playbook-v1.md) rules 11–13 and G (endurance switch, key sessions); [coaching-playbook.md](coaching-playbook.md) §2.1a and §2.2 (on/off status and rule 12's defaults); [profile-and-settings.md](profile-and-settings.md) §2.2 (days a week, other training, usual and key days)
- Library background: `docs/training-guides/concurrent-training.md` C1–C5, C8; `docs/training-guides/programmes.md` (deload weeks, 2–3 day templates)
