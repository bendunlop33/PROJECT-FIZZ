# Weekly plan (rotation, week log, endurance sessions, availability, trade-offs, programme blocks)

> **Revision 2026-10-09 evening (Ben's decision D19: rotation by last session; [playbook-v1.md](../training-guides/playbook-v1.md) "Decisions by Ben").** Lifting no longer has weekdays. **The next workout is the routine after the one Ben last did.** This rewrites the lifting half of this spec; the endurance half (WP3–WP5, WP7, WP10–WP12) is unchanged except where it placed lifting on a day.
> - **Your rotation** (new WP14): an ordered list of routines. `Next` is worked out from the last counted workout, never from the date. Doing a routine out of order is fine: the rotation carries on from it.
> - **No missed lifting sessions** (WP6 revised, new WP15). The week log shows what Ben did, against his stated `Days a week you lift` as an aim (`2 of your 3 days done`), never "planned" or "missed".
> - **Move, skip, replace and "count it as done" are withdrawn for lifting** (there's no date to move). Ben edits the rotation's order instead (new WP19), with Undo. Endurance entries keep their dates and their move/mark-done actions.
> - **Rule 12 becomes a time window** on the next heavy-legs routine (new WP16): `Heavy legs: keep it out of Thu 07:30 – Sat 07:30 (48 h before your long run).` Today's card says it plainly when Ben is inside the window, with `Do Push A today instead` among the options.
> - **Rule 13's week line uses a projection at Ben's aim** (new WP17), labelled as such. **Rule 11's same-day hint** moves to today's row and Today's card (WP13 revised).
> - **Programmes** (new WP18): weeks follow the calendar (deloads, phases and tapers stay dated); within a week, workouts follow the rotation.
> - Coach changes to the rotation are structural, so they're proposals, raised only when Ben asks or something changed (coach-adjustments CA9).
> - Changed: title, §1, WP1, WP2, WP6, WP9, WP11, WP13, new WP14–WP19, all of §2 (wireframes; new §2.3 routine sheet and §2.4 rotation editor; the move picker is endurance-only), §3, §4, §5, §6, §7 (rewritten; old checks kept where they still apply), design-system additions.

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
> - The weekly pattern's default number of gym days comes from `Days a week you lift` (Profile). (Superseded by the rotation revision above: the stated days are now the week's aim.)

> **Revision 2026-10-08 (consolidation).** `Scheduling rules` (WP5, `⋯` menu) is not a separate Profile screen: it opens Guides & playbook ([coaching-playbook.md](coaching-playbook.md)) filtered to the scheduling rules C2–C4, where Ben approves them. The heavy-legs thresholds (WP4) are stored with rule C3's parameters in the playbook (Coaching knowledge) and shown on that rule's detail as a `Linked setting` (coaching-playbook PB10); the per-routine override stays in the routine (Your data). Plans, availability and endurance entries are Your data (design-system §7.2). Component additions are merged into design-system (§7.1 schedule statuses, §9.35 `DayRow`, §9.43 `NoteLine` for `ConflictNote`, `WeekSwitcher`, `FixedBadge` / `KeyBadge` on the `Tag` frame).

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** The session sheet's `Start workout` goes through the check-in gate ([check-in.md](check-in.md) §2.1). The check-in's `Feeling ill` step used this spec's `Skip workout` and `Reschedule` actions. (Rotation revision: there's nothing dated to skip or move for lifting now. `Skip workout` just records that Ben isn't training today and leaves the rotation where it is; `Reschedule` isn't offered. **check-in.md needs the matching follow-up.**)

Status: v0.1 draft, 8 Oct 2026; lifting rewritten for the rotation 9 Oct (D19). Brief §1 (Routines and plan), §4 Programme and weekly plan, §6 (`AvailabilityRule`, `Programme` / `ScheduledSession`, `EnduranceActivity`), §7 (`getWeeklyTrainingSummary`), §12 Page 2; acceptance scenario 3 ("a planned long run follows tomorrow"). Playbook: [playbook-v1.md](../training-guides/playbook-v1.md) rules 1 (short weeks), 11–13, G (endurance switch), D19 and the data-honesty guardrail (strength and endurance counted separately). Library background: `docs/training-guides/concurrent-training.md`. Tokens: [design-system.md](design-system.md). Opened from [today.md](today.md) as the `Week` segment of the Plan hub ([routines.md](routines.md) RT1).

The plan is **prepared outside the logging loop**. Nothing on this screen runs between sets, and nothing here moves an endurance session or changes the rotation by itself.

## 1. Purpose

The weekly plan answers **"What's next, and does my week still fit around it?"**

There is **no `PrimaryButton`** on the week view: Today owns `Start workout`. The main actions are **tap a routine in the rotation** (see it, or start it instead of the next one) and **tap a day** (endurance sessions and availability). A routine's sheet carries `Start workout` as its primary.

Secondary answers: what Ben did this week against his aim, which endurance sessions are fixed, and when the next heavy-legs workout would clash with a key endurance session.

### Design decisions to confirm with Ben (flagged, not yet in the brief)

| # | Decision | Reason |
|---|---|---|
| WP1 | (Revised 9 Oct evening) **Build in two phases.** Phase A (with routines, build step 2–4): the rotation, the week log of finished workouts, availability. Phase B (step 6): endurance sessions, programme blocks, trade-off notes, rescheduling endurance by chat. **Brief §10 puts the whole calendar in step 6** | Today needs `upNext` (today.md §6), which needs the rotation. Phase A is small and local |
| WP2 | (Revised 9 Oct evening) **Ben's own edits apply at once with Undo** (toast `timing.undoToast`): the rotation (WP19), availability, and single endurance entries (add, move, mark done, remove). Repeating endurance series (`Repeat every week`) and **everything the coach suggests** go through [change-review.md](change-review.md) | Rule 2 and ADR 0006 make future changes from the coach proposals. Ben's own edits are explicit; a review step would only add taps. A series touches many dates, so Ben sees them listed first |
| WP3 | **Endurance sessions are planned entries Ben types** (sport, day, optional time, target duration or distance, `Fixed`, `Key`). A past one shows `Done` only if Ben marks it or a confirmed import matches it; otherwise `Not confirmed`, **never `Missed`** | Rule 6: the app doesn't know whether he ran. No live Garmin/Strava claims (brief §Connections) |
| WP4 | **"Heavy legs" is deterministic**: `classifySessionLoad` marks a routine heavy-legs when it has **≥ 6 working or top sets of squat, hinge or lunge patterns**, or **any** such set with a target of **RPE ≥ 8 / RIR ≤ 2** or a top rep target **≤ 6**. Ben can override per routine (routines.md RT7). Thresholds are data, shown and edited with **rule 12**'s defaults in Guides & playbook (coaching-playbook §2.2b) | concurrent-training C3 defines heavy lower-body as "squat/deadlift/lunge emphasis, RPE ≥ 8". A rule the UI can explain beats a model's guess |
| WP5 | **Trade-off notes come only from approved playbook rules (11, 12, 13; playbook v1) and only while the endurance switch is on** (`resolveTrainingContext().enduranceRulesActive`). If Ben removes a rule from his playbook, its notes stop. With the switch off, the plan shows no spacing note, no rule 13 line and no mention of interference. Notes never block and never move anything | Rule G: rules 11–13 are "dormant and not mentioned" without endurance-type training |
| WP6 | (Revised 9 Oct evening) **No "Missed" for lifting.** Lifting has no dates, so a day without a workout is just a day. The rotation waits; nothing is moved or flagged. Endurance keeps `Not confirmed` (WP3) | D19. Marking a never-scheduled day as missed would invent a failure (rule 6) |
| WP7 | **`Fixed` endurance sessions are locked**: the coach never moves, replaces or shortens them, and its proposals list them under `Not changed`. Ben can move a Fixed session himself after a confirm | Brief scenario 3: don't casually overwrite a planned long run |
| WP8 | A **vertical day list**, not a 7-column grid | Readable at 390pt and at AX sizes; matches the programme preview (workout-builder §8) |
| WP9 | (Revised 9 Oct evening) **Strength and endurance are counted separately** in the week summary (`2 of your 3 days done · Long run planned Sat`). The strength number is actual workouts against Ben's stated days, worded as his aim. No combined load or fatigue score | concurrent-training C8; brief §3; WP15 |
| WP10 | (9 Oct) **Usual other training from Profile shows as `Usual` items**, e.g. `Running · usual`. They aren't planned sessions: they don't count in the summary, can't be `Done` or `Missed`, and vanish when Ben adds a real entry that day. Key usual days are protected by rule 12 like planned key sessions. Notes that would rely on a past usual session having happened (after-match) are never shown | Rule G counts Ben's stated usual training for the endurance switch, but "usual sessions are confirmed before they're relied on". Showing them makes the switch visible and lets Ben confirm with one tap (`Add to this week`) |
| WP11 | (9 Oct; revised in the review fixes and 9 Oct evening) **Rule 13 week line.** Shown only when rule 13 applies: the switch is on, endurance is one of Ben's goals (`resolveTrainingContext().rule13Active`), and he lifts 2 or more days a week. It counts heavy strength sessions as WP17 projects them. If fewer than 2, one info line shows under the summary: `ⓘ At 3 days, this week has 1 heavy strength session (Legs A). Rule 13 keeps 2 while you train for endurance. Options ›`. `classifySessionLoad` marks a routine heavy strength when it has ≥ 2 working sets of a squat, hinge, press or pull compound with a top rep target ≤ 6. With 1 lifting day it never shows | Makes the approved floor visible, deterministically, without the coach raising it, and only for the "endurance phases" the rule is about. Options are a coach suggestion (proposal) or `Keep it` |
| WP12 | (9 Oct; revised in the review fixes) **Endurance entries get an optional `Effort`: `Easy` / `Hard or long`.** Rule 12's 6 h check fires only on `Hard or long` or `Key` entries. With no effort set, only `Key` counts. The same test decides whether an entry turns the endurance switch on. `Class or HIIT` and `Match or sport` start on `Hard or long` | Rule 12 spaces heavy legs from "hard or long endurance". Without this the app would have to guess intensity (rule 6) |
| WP13 | (9 Oct; revised in the review fixes and 9 Oct evening) **Same-day order follows rule 11, as a hint for today.** When an endurance item is on today (and the switch is on): if it's `Key`, today's row and Today's card say `ⓘ Key run today: run first and keep leg work light. Ask the coach to lighten Legs A ›`. Otherwise, **only when lifting is the priority** (`liftFirstApplies`), `ⓘ Run today too: lift first, keep the run easy.` When endurance is the priority, there's no lift-first hint. A time Ben set on the item always wins | Applies rule 11 as a hint, not a move. Lifting has no time of day, so the hint is about today |
| WP14 | (9 Oct evening, D19) **Your rotation.** An ordered list of Ben's routines (Your data, versioned). **Next** is the routine after the most recent **counted** workout from a routine in the rotation; after the last routine it wraps to the first. A workout counts when it was finished with at least one working set and was started from a rotation routine, or is a Repeat of one (it counts as that routine). Empty workouts, coach drafts not in the rotation, and discarded workouts don't move it. If Ben does a routine out of order, the rotation carries on from that one. With no counted workout yet, or if the last one's routine was removed, Next is the first routine | Ben's decision D19: "the next workout follows what Ben last trained". Defining "counted" in code makes Today, the week and the coach agree. Repeat counting as its routine matches what Ben actually trained |
| WP15 | (9 Oct evening) **The week log shows actuals against Ben's aim.** Each day lists finished workouts (`✓ Push A · 54 min`) and dated endurance items. The summary is `2 of your 3 days done` from `Days a week you lift` (Profile), labelled as his aim; without it, `2 workouts this week`. Future days show only endurance, availability and `—` | Rotation has no dated lifting, so there is nothing "planned" to put on a future day. Projecting routines onto days would invent a schedule |
| WP16 | (9 Oct evening) **Rule 12 as a time window.** `checkScheduleConflicts` gives each heavy-legs routine in the rotation the windows to avoid: the 48 h before a key item, at least 6 h either side of a hard or long item, and the 48 h after a confirmed match. The rotation row shows them (`⚠ Heavy legs: keep it out of Thu 07:30 – Sat 07:30 (48 h before your long run).`). When the **next** routine is heavy legs and now is inside a window, Today's card shows `⚠ Heavy legs 37 h before your long run (Sat 07:30). Options ›`. Options: `Do Push A today instead` (the first routine after it with no clash, with the resulting order shown), `Ask the coach to lighten Legs A` (a proposal for the next Legs A only), `Keep it`. Nothing moves by itself | Brief scenario 3 still works without dates. A window tells Ben when, which is the only choice he has with a rotation |
| WP17 | (9 Oct evening) **Projection for rule 13, labelled.** Heavy strength sessions this week = counted workouts this week that are heavy strength + the next (aim − done) routines in the rotation that are, if days remain. The line says `At 3 days` so it reads as a projection at Ben's stated aim, not a plan | Rule 13 is a weekly floor; without dates, the honest version is "if you train your usual number of days, in rotation order" |
| WP18 | (9 Oct evening) **Programmes: calendar weeks, rotation inside.** A programme's week number follows the calendar from its start date, so deloads, event phases and tapers stay on their dates. Within a week, the next workout follows the rotation, using that week's version of each slot. A short week carries on where it stopped (nothing is made up, rule 1). The programme's rotation replaces Ben's own for its weeks; his own resumes afterwards | Keeps dated things dated (tapers, deloads) and undated things undated (which workout is next). **Alternative for Ben:** a week only advances when all its workouts are done |
| WP19 | (9 Oct evening) **Ben edits the rotation directly; the coach proposes.** `Edit rotation` (reorder, add, remove) saves at once with Undo, because the editor shows the whole order. A coach change to the rotation (a new split, new routines) is structural: a proposal with Apply and Undo, raised only when Ben asks or a signal exists (coach-adjustments CA9) | Replaces the old pattern and series edits. Rule 3 for the coach; no extra tap for Ben's own choice |

## 2. Layout

### 2.1 Week view (normal, Phase B)

Regions top to bottom: nav bar · segmented control · programme line (in a programme) · `Your rotation` · banners (0–2: changes to review, out of date) · week switcher · week summary (+ rule 13 line) · day list · `Availability this week ›` · Ask pill.

```
┌────────────────────────────────────────┐
│ ‹ Today          Plan              ⋯   │ ⋯: Edit rotation, Change history,
│        [✓ Week  |  Routines ]          │    Scheduling rules
├────────────────────────────────────────┤
│ Strength + 10k · Week 2 of 6         › │ programme line (programme only)
│                                        │
│ Your rotation                  Edit ›  │ section header + text button
│ ┌────────────────────────────────────┐ │
│ │ ▶ Next  Legs A · about 60 min    › │ │ RotationRow (next)
│ │   After Pull A on Wed 14           │ │ basis (actual)
│ │   ⚠ Heavy legs: keep it out of     │ │ ConflictNote, window (rule 12)
│ │   Thu 07:30 – Sat 07:30 (48 h      │ │
│ │   before your long run). Options › │ │
│ ├────────────────────────────────────┤ │
│ │ 2  Push A · about 55 min         › │ │ RotationRow
│ ├────────────────────────────────────┤ │
│ │ 3  Pull A · about 55 min         › │ │
│ └────────────────────────────────────┘ │
│ Next is the routine after the one you  │ type.callout, text.secondary
│ last did.                              │
│ 💬 1 change to review                › │ open proposals (change-review)
│                                        │
│ [◀]    This week · 12–18 Oct    [▶]    │ week switcher, 44pt buttons
│ 2 of your 3 days done                  │ strength: actual vs your aim
│ Long run planned Sat                   │ endurance (planned), separate
│ ┌────────────────────────────────────┐ │
│ │ Mon 12  ✓ Push A · 54 min          │ │ DayRow; actual
│ ├────────────────────────────────────┤ │
│ │ Tue 13  ◌ Running · usual        › │ │ WP10: from Profile, not planned
│ ├────────────────────────────────────┤ │
│ │ Wed 14  ✓ Pull A · 51 min          │ │
│ ├────────────────────────────────────┤ │
│ │┃Thu 15 · Today                     │ │ accent bar + word "Today"
│ │┃Available 60 min                   │ │ availability note
│ ├────────────────────────────────────┤ │
│ │ Fri 16  Available 30 min           │ │
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

Rotation rules (`RotationRow`, 52pt min):
- Order is the rotation's order **starting from Next**, so the top row is always what Today offers. The position number is the order from Next (`▶ Next`, `2`, `3`), tabular.
- Line 1: name + `about N min` (`estimateRemainingDuration` at the selected gym; always "about"). Line 2 (Next only): the basis, as an actual: `After Pull A on Wed 14` · `Start of your rotation` · `Only routine in your rotation`. Optional `ConflictNote` (window) on any heavy-legs row while a key, hard or long item is within the next 7 days.
- A workout in progress shows as the top row `▶ In progress: Legs A` (sheet offers `Resume`); the row after it reads `Next after this one`.
- No dates on rotation rows, ever (WP15).

Day row rules (`DayRow`, 52pt min per item):
- Left column: weekday and date (`Thu 15`), tabular. Today: 4pt `accent` left bar, `accent.subtle` background and the word `Today` (never colour alone).
- One line per item: a finished workout as an actual (`✓ Push A · 54 min`; also `✓ Empty workout · 40 min`, `✓ Coach workout · 45 min`, which don't move the rotation), an in-progress workout (`▶ Legs A · In progress`), or an endurance item with its sport word and target (`Long run · 90 min`, `Run · 10 km`).
- Second line (only when there's something to say): `Fixed · Key · 07:30`, a `ConflictNote` (after-match), a same-day hint (WP13, today only), availability (`Available 30 min`), or an availability mismatch for today (`⚠ Legs A is about 60 min; 30 min available today`).
- Empty day: `Available 30 min` (availability set), `Off` (availability off), or `—`. There's no `Rest` or `Missed` for lifting.
- (9 Oct, WP10) `Usual` items: `circle.dotted` + the type and the word `usual` (`Running · usual`, `Match · usual · Key`), in `text.secondary`. Tap → a small sheet: `Running · usual on Tue (from Profile)` · `Add to this week` (creates a planned entry, toast with Undo) · `Not this week` (hides it for this week) · `Edit in Profile ›`.
- The rule 13 line (WP11, WP17), when shown, sits under the week summary as a `NoteLine` (info):

```
│ 2 of your 3 days done                  │
│ Long run planned Sat                   │
│ ⓘ At 3 days, this week has 1 heavy     │ NoteLine, info (rule 13; only
│   strength session (Legs A). Rule 13   │ when endurance is a goal and
│   keeps 2 while you train for          │ 2+ lifting days)
│   endurance. Options ›                 │
```

  `Options ›` opens the trade-off sheet (§2.6) with `Ask the coach to add heavy sets to Push A ›` (a proposal via change-review) and `Keep it`.

### 2.2 Week view, Phase A (no endurance, no programme)

```
│ Your rotation                  Edit ›  │
│ ▶ Next  Legs A · about 60 min        › │
│         After Pull A on Wed 14         │
│ 2  Push A · about 55 min             › │
│ 3  Pull A · about 55 min             › │
│ Next is the routine after the one you  │
│ last did.                              │
│ [◀]    This week · 12–18 Oct    [▶]    │
│ 2 of your 3 days done                  │
│ ┌────────────────────────────────────┐ │
│ │ Mon 12  ✓ Push A · 54 min          │ │
│ │ Tue 13  —                          │ │
│ │ Wed 14  ✓ Pull A · 51 min          │ │
│ │ Thu 15 · Today  —                  │ │
│ │ Fri 16  —                          │ │
│ │ Sat 17  —                          │ │
│ │ Sun 18  —                          │ │
│ └────────────────────────────────────┘ │
```

### 2.3 Routine sheet (tap a rotation row; medium detent)

```
┌────────────────────────────────────────┐
│ Push A                           Close │
│ 5 exercises · about 55 min · Main Gym  │
│ 2nd in your rotation · last done Mon 12│ last done = actual
│ Starting it now makes Pull A next.     │ consequence (not on the Next row)
│                                        │
│ [           Start workout            ] │ PrimaryButton
│ Open routine                         › │ rows, 52pt
│ Edit rotation                        › │
└────────────────────────────────────────┘
```

- On the Next row the third line reads `Next in your rotation · after Pull A on Wed 14`, with any `ConflictNote` in full under it, and no consequence line.
- `Start workout` goes through the check-in gate (check-in.md §2.1) and `startWorkout(routineId, gymId, opId)`. Any routine can be started; the rotation then carries on from it (WP14).
- A workout in progress: its own sheet shows `Resume`; other sheets show `Start workout` disabled with `Finish or discard Legs A to start this.`
- Endurance item sheet (unchanged): `Long run · Sat 17 Oct · 07:30`, target, `Fixed` and `Key` switches, `Effort`, `Edit`, `Move`, `Remove`, and for past days `Mark done` / `Didn't happen`.

### 2.4 Edit rotation (pushed; new 9 Oct evening)

```
┌────────────────────────────────────────┐
│ Cancel        Edit rotation            │
├────────────────────────────────────────┤
│ Your workouts go in this order. Next   │ type.callout, text.secondary
│ is the one after the one you last did. │
│ ┌────────────────────────────────────┐ │
│ │ ≡ 1 Push A        [↑] [↓]  Remove  │ │ ReorderRow + Remove (44pt each)
│ │ ≡ 2 Pull A        [↑] [↓]  Remove  │ │
│ │ ≡ 3 Legs A        [↑] [↓]  Remove  │ │
│ └────────────────────────────────────┘ │
│ ＋ Add a routine                       │ Routines list in pick mode
│                                        │
│ Last workout: Pull A, Wed 14.          │ text.secondary (actual)
│ In this order, next is Legs A.         │ live, from getNextInRotation
├────────────────────────────────────────┤
│ [                Save                ] │ PrimaryButton
└────────────────────────────────────────┘
```

- The drag handle is never the only way to reorder: `Move up` / `Move down` buttons are on every row (44 × 44).
- `Save` disabled with `No changes` until something changes. A rotation needs at least one routine: removing the last one asks `Clear your rotation? Today will offer an empty workout until you set one up.` [Clear] [Cancel].
- In a programme (WP18), this screen is replaced by a note: `You're in a programme until 22 Nov. Its order is set by the programme.` [Programme ›].

### 2.5 Move picker (endurance items only)

```
┌────────────────────────────────────────┐
│ ‹ Back     Move Long run               │
│ [✓ This week only ] [ Every week ]     │ segmented; Every week → review
│ Tue 13  ✓ No conflicts                 │
│ Wed 14  ✓ No conflicts                 │
│ Thu 15  ✓ No conflicts                 │
│ Fri 16  ⚠ Legs A (next, heavy legs)    │ windows recomputed for the
│           would need to stay out of    │ candidate day
│           Wed 07:30 – Fri 07:30.       │
│ Sat 17  (current)                      │
│ Sun 18  ✓ No conflicts                 │
│ Next week ›                            │
└────────────────────────────────────────┘
```

Tapping a day moves the item at once (WP2). Days with notes still work; Ben has seen them. Past days aren't offered. Lifting is never in this picker.

### 2.6 Trade-off sheet (`Options ›` on a conflict note; medium detent)

```
┌────────────────────────────────────────┐
│ Heavy legs before your long run  Close │
│ Legs A is next. Your long run is Sat   │ facts
│ 17 at 07:30, in 37 h.                  │
│ Your rule: keep heavy leg work out of  │ approved playbook rule, quoted
│ the 48 h before a key session.         │
│ (Rule 12 · Moderate)  Why? ›           │ Why? → rule 12 detail
│ Legs A counts as heavy legs: 8 squat   │ classifySessionLoad reason
│ and hinge working sets.                │
│                                        │
│ Options                                │
│ Do Push A today instead              › │ deterministic; opens Push A's
│   Then Pull A, then Legs A.            │ sheet; the resulting order
│ Ask the coach to lighten Legs A      › │ coach; proposal, next Legs A only
│ Keep it                                │ records the choice
└────────────────────────────────────────┘
```

- `Do … today instead` comes from `suggestConflictFreeRoutine`: the first routine after the next one with no clash now. It opens that routine's sheet (§2.3); nothing starts without the `Start workout` tap. Its second line shows the order that follows, so Ben sees that Legs A moves back.
- `Ask the coach to lighten Legs A` sends a request (`Lighten Legs A for its next time; long run Sat 07:30`) and returns a proposal, scope `Next Legs A only`, for review. Offline: `Coach offline`, disabled.
- `Keep it` collapses the note to `⚠ Kept · heavy legs before long run` (one line, still visible).
- The long run is never offered as the thing to move (WP7).
- Opened outside the window (e.g. on Mon), the facts line reads `Legs A is next. If you train it between Thu 07:30 and Sat 07:30, it's within 48 h of your long run.`

### 2.7 Availability this week (sheet)

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

A mismatch shows on today's row and on Today's card when the next routine's estimate is longer than today's availability (`⚠ Legs A is about 60 min; 30 min available today`), with (once `shortenSession` exists) `Shorter version ›`. Nothing shortens automatically.

### 2.8 Add to a day (tap an empty day, or a day's `＋` in its sheet)

`Add endurance session` · `Set availability for Thu 15`. (Lifting isn't added to days; it follows the rotation.)

Endurance form (revised 9 Oct): `Type` (`Run`, `Ride`, `Swim`, `Row`, `Class or HIIT`, `Match or sport`, `Other` + name field) · `Day` · `Time (optional)` · `Target` (`Duration [1:30 ▾]` or `Distance [10 km]`; hidden for `Match or sport`) · `Effort (optional)` `Easy` / `Hard or long` (WP12; starts on `Hard or long` for `Class or HIIT` and `Match or sport`) · `Fixed: don't let the coach move this` switch · `Key session: keep heavy legs away from it` switch (always shown; rule 12 is approved. For `Match or sport` it starts on, as the playbook treats matches as key, and Ben can turn it off) · `Repeat every week` switch (→ change-review, WP2). Primary `Add to Sat 17`. No type names a race brand or event format; an event Ben is training for lives in Profile (`Working towards`).

## 3. States

| State | Shows | Notes |
|---|---|---|
| Loading | Nothing for 300 ms, then static rows | Local |
| No rotation yet | `No rotation yet.` + `Set up your rotation ›` (opens §2.4 empty, with `＋ Add a routine`) + `Or start from a routine` (switches to Routines). Above it: `You lift 3 days a week (Goals & schedule)` when set. The week log still shows finished workouts | Today offers `Start empty workout` (today.md) |
| Rotation, nothing done yet | Next is the first routine; basis `Start of your rotation` | WP14 |
| Rotation of one | One row `▶ Next  Push A`; basis `Only routine in your rotation` | — |
| Normal | §2.1 / §2.2 | — |
| Routine done out of order | Rows re-order from the new Next; basis `After Push A on Thu 15` | WP14: the rotation carries on from it |
| Last workout not from the rotation | Basis still names the last rotation workout; the day row shows `✓ Empty workout · 40 min` or `✓ Coach workout · 45 min` | They don't move the rotation |
| Last routine removed from the rotation | Next is the first routine; basis `Start of your rotation (Legs B was removed)` | — |
| Workout in progress | Top row `▶ In progress: Legs A` (sheet: `Resume`); next row `Next after this one`; today's row `▶ Legs A · In progress` | — |
| Programme active | Programme line `Strength + 10k · Week 2 of 6 ›`; the rotation shows this week's programme routines; `Edit ›` becomes `Programme ›` | WP18. Deload week: `Week 4 of 6 · Deload` |
| Programme ending / ended | `Last week of Strength + 10k.` / `Strength + 10k ended 22 Nov. Your rotation continues: Push A, Pull A, Legs A.` + `Build the next block ›` (workout-builder §8) | Never extends itself |
| Days a week not set | Summary `2 workouts this week`; no rule 13 line | Playbook "Missing inputs" |
| Short week | Summary `1 of your 3 days done`; no warning, no make-up | Rule 1: short week, don't make up |
| Endurance not confirmed | Past row `Long run · Not confirmed` + sheet [Mark done] [Didn't happen] | WP3 |
| Endurance confirmed by import (later) | `✓ Long run · 18.2 km · from FIT file, imported 18 Oct` | Source and date always shown |
| Conflict window (approved rule) | `ConflictNote` on the heavy-legs rotation row; Today's card when now is inside a window for the Next routine | WP16 |
| No approved scheduling rules | No conflict notes. `⋯` → `Scheduling rules` shows `No scheduling rules in your playbook.` (only if Ben removed 11–13; v1 has them approved) | — |
| Endurance rules off (9 Oct) | No conflict notes, no rule 13 line, no same-day hints, no `Usual` items. `Scheduling rules` shows rules 11–13 with `Off now: <reason>` | Rule G switch |
| Only easy other training (review fixes) | Same as "Endurance rules off". Easy planned entries still show on their days as ordinary endurance items, with no notes | Switch counts hard, long or key only |
| Usual training only (9 Oct) | `Usual` items on their days; windows against key usual days; no after-match or 6 h notes (no times, nothing confirmed) | WP10 |
| Heavy strength below 2 (revised 9 Oct evening) | Rule 13 projection line under the summary, only when endurance is a goal and Ben lifts 2+ days a week | WP11, WP17 |
| Switch on, endurance not a goal (review fixes) | Rule 12 windows and rule 11 hints as normal; no rule 13 line | WP11 |
| Endurance is the priority (review fixes) | No "lift first" hint; key sessions still go first | WP13 |
| Availability mismatch | Today's row and Today's card | §2.7 |
| Change to review | Banner `1 change to review ›` | change-review.md |
| Proposal went stale | Banner `1 suggestion is out of date ›` (opens change-review stale state) | Rule 5 |
| Past week | Read-only except endurance confirmation. Workout rows open their summaries. No rotation block (it's about now) | — |
| Future week | Endurance and availability only, plus `Lifting follows your rotation, not days.` under the switcher | WP15 |
| Beyond 8 weeks ahead | `Plans further ahead appear as the weeks get closer.` | Bounded |
| Time zone differs from the plan's | Line under the week switcher: `Days shown in Auckland time (your plan's time zone).` [Use this phone's time zone]. Windows use the same time zone | Dates stored as UTC + tz (CLAUDE.md conventions) |
| Offline | No change; everything is local. Ask pill `Offline` | Rule 1 |
| Coach unavailable | No change except coach options show `Coach offline` (disabled) | — |
| Database error | `Couldn't open your training data.` [Try again] [Restore from backup] | — |
| Write failed | Toast `Couldn't save that change. Nothing moved.` [Try again] (same opId) | — |

Transitions (the rotation's Next):

```
 finish a rotation routine (≥ 1 working set) ──► Next = the routine after it
 finish a Repeat of a rotation workout ────────► same, counted as that routine
 empty / unsaved coach draft / discarded ──────► Next unchanged
 Edit rotation → Save ─────────────────────────► Next recomputed from the last counted workout
 coach rotation proposal → Apply (change-review)► new order; Next recomputed
 programme starts / ends ──────────────────────► programme rotation / Ben's rotation resumes
```

One endurance item:

```
 Planned ──Move──► Planned (other day)     Planned ──day passes──► Not confirmed
    │                                          ├─Mark done──► Done
    └─Remove──► gone (Undo)                     └─Didn't happen──► Didn't happen
```

## 4. Interactions

### 4.1 Week view
| Element | Tap | Other |
|---|---|---|
| Programme line | Programme detail (the scheduled form of workout-builder §8: weeks, deloads, `Ask for changes`, `End programme early`) | — |
| Rotation row | Routine sheet (§2.3) | Long-press: same sheet (no hidden actions) |
| `Edit ›` / `⋯` → `Edit rotation` | §2.4 | — |
| `ConflictNote` `Options ›` | Trade-off sheet (§2.6) | — |
| `1 change to review ›` | change-review list | — |
| `◀` / `▶` | Previous / next week | No swipe-only navigation (sweaty hands, accidental swipes) |
| Week title | Back to this week | — |
| Finished workout row | That workout's summary | — |
| Endurance row | Endurance sheet (§2.3) | — |
| Empty day | Add sheet (§2.8) | — |
| `Availability this week ›` | §2.7 | — |
| Ask pill | Coach sheet with the rotation and the week attached as context | — |

### 4.2 Direct edits (WP2: apply at once, toast with Undo)
| Action | Call | Toast |
|---|---|---|
| Save rotation | `updateRotation(rotationId, routineIds[], expectedVersion, opId)` (or `createRotation`) | `Rotation saved · next is Legs A` [Undo] |
| Move an endurance item (this week only) | `rescheduleSession(id, newDateLocal, expectedVersion)` | `Moved Long run to Sun 18` [Undo] |
| Add an endurance item | `upsertPlannedEndurance(input, opId)` | `Added Long run to Sat 17` [Undo] |
| Remove an endurance item | `removeScheduledSession(id, expectedVersion)` | `Removed Easy ride (Sun 18)` [Undo] |
| Endurance done / didn't happen | `setEnduranceStatus(id, 'done' \| 'not_done', expectedVersion)` | `Marked Long run done` [Undo] |
| Availability | `setWeeklyAvailability(weekStartLocal, days[], opId)` | `Availability saved for 12–18 Oct` [Undo] |
| Keep it (conflict) | `acknowledgeConflict(conflictId)` | none (the note changes) |
| Move a Fixed session | Confirm first: `Long run is fixed. Move it anyway?` [Move] [Cancel], then as Move | as Move |

Undo calls `undoAction(actionId)` with the version the toast was created for. If the thing changed since (e.g. an endurance item was marked done), the toast becomes `Can't undo: Long run changed since.` and nothing changes. Undoing a rotation save is always safe; Next is recomputed.

Withdrawn for lifting (D19): move, skip, unskip, replace, `Do it today`, `Count it as done`, `Every week` moves and the weekly pattern editor.

### 4.3 Proposals (via change-review)
- **Coach rotation changes** (WP19): Ben asks ("switch me to upper/lower", "give me a 4-day split") or a signal exists (coach-adjustments CA9: goal or days changed). `propose_rotation_change` returns a proposal with scope `Your rotation from now on`, listing the old and new order and any new routines (as coach drafts until applied). Nothing changes before Apply.
- **Endurance series** (`Repeat every week`): a proposal with author `Ben` (`proposeScheduleChange(change, opId)`), opening [change-review.md](change-review.md) with every affected date for the next 4 weeks (and the rest of the programme).
- **Lighten the next heavy-legs routine** (trade-off option): scope `Next Legs A only`, expiring when Legs A next starts (change-review CR8).

### 4.4 Reschedule by chat or voice
- Ben asks in the coach sheet or by Talk: "I'm away Thursday and Friday", "move my run to Sunday", "I can only do 30 minutes Friday". `classifyCoachIntent` → `reschedule`; the coach uses `get_rotation`, `get_schedule` and `propose_reschedule` for endurance items and availability.
- Asking to move lifting ("move legs to Tuesday") gets a fixed app line, not a coach guess: `Lifting follows your rotation, not days, so there's nothing to move. Legs A is next whenever you train. To do something else first, start it from Plan.`
- The reply is short, and the sheet shows a proposal card: `Moves 1 session this week · Review ›`. Nothing changes before Apply (rule 3). Fixed sessions are never in the changes; the card lists them under `Not changed`.
- The proposal names exact local dates (`Tue 13 Oct`), never "tomorrow", so a confirmation can't drift across midnight. A proposal whose earliest affected day has started expires.
- Voice confirmation rules are in change-review.md §4.4. Spoken replies never say something moved before Apply ([coach-contract.md](coach-contract.md)).
- Coach offline: `Rescheduling by chat needs the coach. You can move your endurance sessions here yourself.` (sheet), and the week view works as normal.

### 4.5 Trade-off warnings (WP4, WP5, WP16, WP17)
- `checkScheduleConflicts(context, rotationView, weekItems, approvedRules, sessionLoads, now)` runs locally after every change to the rotation or the week, after every finished workout, and after any Profile change to goal, days or other training. It returns notes `{ruleId, kind, routineId?, itemIds, window?, facts, options}`. `context` is `resolveTrainingContext` (endurance switch, key sessions, usual items). With the switch off it returns nothing. The UI never writes its own advice.
- Notes from approved playbook v1 rules (wording from playbook-v1.md, shortened). The examples say "long run"; the note always names the actual item (`intervals`, `class`, `match`, `ride`).
  - **Rule 12, before a key session (window):** for each heavy-legs routine in the rotation, the 48 h before any `Key` item (planned or usual) in the next 7 days. Row note: `Heavy legs: keep it out of Thu 07:30 – Sat 07:30 (48 h before your long run).` With no time on the key item, whole days: `Heavy legs: keep it out of Thu and Fri (before your long run on Sat).`
  - **Rule 12, same day (window):** at least 6 h either side of a `Hard or long` or `Key` item that has a time (WP12). Row note: `Heavy legs: keep it at least 6 h from your intervals (Thu 07:00).`
  - **Rule 12 for sport (rule G):** the 48 h after a match **that was confirmed** (marked done, imported or reported). Row note: `Heavy legs: keep it out of the 48 h after your match (until Mon 15:00).` With the match not confirmed, or only usual, no note (rule 6).
  - **Today's version (`kind: 'if_today'`):** when the Next routine is heavy legs and now is inside one of its windows, Today's card shows `Heavy legs 37 h before your long run (Sat 07:30).` / `Heavy legs under 6 h from your intervals (07:00 today).` / `Heavy legs the day after your match.` with `Options ›`.
  - **Rule 11, same day (WP13):** a hint on today's row and Today's card when an endurance item is today. The lift-first hint needs `context.liftFirstApplies`.
  - **Rule 13, week (WP11, WP17):** the projection line, only when `context.rule13Active` and stated days ≥ 2.
  - **Withdrawn:** C4's "day after a long run" note. It isn't in playbook v1. If Ben wants it back, it would come as a new candidate rule.
- A note quotes facts only (days, times, the routine's heavy-legs reason). It never says Ben will be fatigued.
- Event-specific movements or tapers aren't scheduled here. An event in Profile (`Working towards`) affects the plan only through a programme or plan suggestion Ben applies (workout-builder §8; playbook rule G).

### 4.6 Keyboard
Only the endurance form's distance field uses a keyboard. Numeric fields use `WorkoutKeypad`; the primary (`Add to Sat 17`) sits above it. The rotation editor has no text fields.

### 4.7 Undo summary
| What | Undo |
|---|---|
| Direct edit (rotation, endurance, availability) | Toast [Undo] (8 s), then `⋯` → `Change history` → `Undo` (if still safe) |
| Coach change, endurance series | change-review.md §4.5 |
| Kept conflict | `Show warning again` in the routine sheet |

## 5. Copy

`about 60 min`, `90 min`, `10 km` and availability are **targets** or Ben's plan. `✓ Push A · 54 min`, `last done Mon 12`, the basis line and imported distances are **actuals**, with their source where imported. `2 of your 3 days` is **actual against Ben's stated aim**.

| Element | Text |
|---|---|
| Hub | `Plan` · `Week` · `Routines` |
| Rotation | `Your rotation` · `Edit ›` · `▶ Next` · `After Pull A on Wed 14` · `Start of your rotation` · `Start of your rotation (Legs B was removed)` · `Only routine in your rotation` · `▶ In progress: Legs A` · `Next after this one` · `Next is the routine after the one you last did.` |
| Routine sheet | `5 exercises · about 55 min · Main Gym` · `2nd in your rotation · last done Mon 12` · `Next in your rotation · after Pull A on Wed 14` · `Starting it now makes Pull A next.` · `Start workout` · `Resume` · `Open routine` · `Edit rotation` · `Finish or discard Legs A to start this.` |
| Edit rotation | `Edit rotation` · `Your workouts go in this order. Next is the one after the one you last did.` · `Move up` · `Move down` · `Remove` · `Add a routine` · `Last workout: Pull A, Wed 14.` · `In this order, next is Legs A.` · `Save` · `No changes` · `Cancel` · `Clear your rotation? Today will offer an empty workout until you set one up.` [Clear] [Cancel] · programme note `You're in a programme until 22 Nov. Its order is set by the programme.` [Programme ›] |
| No rotation | `No rotation yet.` · `Set up your rotation ›` · `Or start from a routine` · `You lift 3 days a week (Goals & schedule)` |
| Week switcher | `This week · 12–18 Oct` · `Next week · 19–25 Oct` · `Last week · 5–11 Oct` · future weeks `Lifting follows your rotation, not days.` |
| Summary | `2 of your 3 days done` · `2 workouts this week` (no days set) · `Long run planned Sat` · `Long run done Sat` |
| Programme | `Strength + 10k · Week 2 of 6` · `Week 4 of 6 · Deload` · `Last week of Strength + 10k.` · `Strength + 10k ended 22 Nov. Your rotation continues: Push A, Pull A, Legs A.` · `Build the next block ›` · `Programme ›` |
| Status words | `Done` · `In progress` · `Not confirmed` · `Didn't happen` · `Today` · `Fixed` · `Key` · `usual` · `Off` |
| Day items | `✓ Push A · 54 min` · `✓ Empty workout · 40 min` · `✓ Coach workout · 45 min` · `▶ Legs A · In progress` · `Available 30 min` · `⚠ Legs A is about 60 min; 30 min available today` |
| Endurance sheet | `Mark done` · `Didn't happen` · `Fixed` · `Key` · `Effort` · `Edit` · `Move` · `Remove` · `from FIT file, imported 18 Oct` |
| Move picker | `Move Long run` · `This week only` · `Every week` · `No conflicts` · `(current)` · `Next week ›` · `Long run is fixed. Move it anyway?` [Move] [Cancel] |
| Conflict notes (rule 12) | `Heavy legs: keep it out of Thu 07:30 – Sat 07:30 (48 h before your long run).` · `Heavy legs: keep it out of Thu and Fri (before your long run on Sat).` · `Heavy legs: keep it at least 6 h from your intervals (Thu 07:00).` · `Heavy legs: keep it out of the 48 h after your match (until Mon 15:00).` · today: `Heavy legs 37 h before your long run (Sat 07:30).` · `Heavy legs under 6 h from your intervals (07:00 today).` · `Heavy legs the day after your match.` · `Kept · heavy legs before long run` · `Options ›` |
| Rule 11 and 13 lines | `Run today too: lift first, keep the run easy.` (only when lifting is the priority) · `Key run today: run first and keep leg work light. Ask the coach to lighten Legs A ›` · `At 3 days, this week has 1 heavy strength session (Legs A). Rule 13 keeps 2 while you train for endurance. Options ›` (only when endurance is a goal and 2+ lifting days) · `Ask the coach to add heavy sets to Push A` |
| Usual items (9 Oct) | `Running · usual` · `Match · usual · Key` · sheet `Running · usual on Tue (from Profile)` · `Add to this week` · `Not this week` · `Edit in Profile ›` · toast `Added Running to Tue 13` [Undo] |
| Trade-off sheet | `Heavy legs before your long run` · `Legs A is next. Your long run is Sat 17 at 07:30, in 37 h.` · outside the window `Legs A is next. If you train it between Thu 07:30 and Sat 07:30, it's within 48 h of your long run.` · `Your rule: keep heavy leg work out of the 48 h before a key session. (Rule 12 · Moderate)` · `Legs A counts as heavy legs: 8 squat and hinge working sets.` · `Options` · `Do Push A today instead` + `Then Pull A, then Legs A.` · `Ask the coach to lighten Legs A` · `Keep it` |
| Availability | `Availability · 12–18 Oct` · `From your usual week. Changes here apply to this week only.` · `Off` · `30` `45` `60` `90` `min` · `Available 30 min` · `Change your usual week in Profile ›` |
| Add | `Add endurance session` · `Set availability for Thu 15` · `Type` · `Run` `Ride` `Swim` `Row` `Class or HIIT` `Match or sport` `Other` · `Time (optional)` · `Target` · `Duration` · `Distance` · `Effort (optional)` `Easy` `Hard or long` · `Fixed: don't let the coach move this` · `Key session: keep heavy legs away from it` · `Repeat every week` · primary `Add to Sat 17` |
| Rules | `Scheduling rules` · `No scheduling rules in your playbook.` · `Off now: <reason>` |
| Time zone | `Days shown in Auckland time (your plan's time zone).` [Use this phone's time zone] |
| Far future | `Plans further ahead appear as the weeks get closer.` |
| Toasts | `Rotation saved · next is Legs A` · `Moved Long run to Sun 18` · `Added Long run to Sat 17` · `Removed Easy ride (Sun 18)` · `Marked Long run done` · `Availability saved for 12–18 Oct` · all [Undo] · `Can't undo: Long run changed since.` · `Couldn't save that change. Nothing moved.` [Try again] |
| Coach | proposal cards `Changes your rotation from now on · Review ›` · `Moves 1 session this week · Review ›` · fixed line `Lifting follows your rotation, not days, so there's nothing to move. Legs A is next whenever you train. To do something else first, start it from Plan.` · offline `Rescheduling by chat needs the coach. You can move your endurance sessions here yourself.` |

Spoken (voice requests only): "I've suggested moving your run to Sunday the 18th. Review it on screen." Changes are never read as done before Apply.

## 6. Data needed

Existing (brief §6–8; other specs):
- `getWeeklyTrainingSummary(userId, range)` (strength and endurance kept separate), `estimateRemainingDuration`.
- `rescheduleSession(id, newTime, expectedVersion)`: endurance occurrences only now.
- `startWorkout(routineId, gymId, opId)`, `startWorkoutFromSession` (Repeat), `getActiveSession`.
- `getAiCapabilities`, `classifyCoachIntent`, `runCoachTurn`, tools `get_rotation`, `get_schedule`, `propose_reschedule`, `propose_rotation_change` ([coach-contract.md](coach-contract.md) §6.1); `undoAction`.
- `classifySessionLoad(routineVersion)` (routines.md §6).
- `buildTodayView` reads `getNextInRotation` for `upNext` and the same conflict notes (`if_today`).

**Proposed new (flagged for the developer and Ben):**

| Function | Contract |
|---|---|
| `Rotation` (Your data, 9 Oct evening) | `{rotationId, ownerId, routineIds[], version, source: 'ben' \| 'programme', programmeId?, createdAtUtc, updatedAtUtc, tz}`. One active rotation; a programme's rotation overrides it for the programme's weeks (WP18) |
| `getNextInRotation(ownerId, at)` (9 Oct evening) | **Pure, `packages/domain`, unit-tested.** → `{routineId, position, basis: {kind: 'after_last' \| 'start' \| 'only' \| 'after_removed', lastSessionId?, lastRoutineId?, lastEndedAtUtc?, removedRoutineName?}, then: routineId[], inProgress?: {sessionId, routineId}}`. Counted workouts per WP14 (finished, ≥ 1 working set, started from a rotation routine or a Repeat of one). Shared by Today, this view, the routine list, `resolveTrainingContext().plan` and the coach context |
| `buildRotationView(ownerId, gymId, now)` (9 Oct evening) | Rows `{routineId, name, estimateMin, isNext, positionFromNext, heavyLegs, heavyStrength, notes[], startingMakesNext?}` plus `basis`. Local only |
| `createRotation(routineIds[], opId)` / `updateRotation(rotationId, routineIds[], expectedVersion, opId)` (9 Oct evening) | Versioned; Undo via `undoAction`. Rejects an empty list (use `clearRotation`) and routines that are deleted |
| `buildWeekPlanView(ownerId, weekStartLocal, tz)` (revised) | Days `{date, availabilityMin?, items[{kind: 'workout' \| 'endurance', sessionId?, scheduledId?, routineId?, name, actualMin?, estimateMin?, status: 'done' \| 'in_progress' \| 'planned' \| 'not_confirmed' \| 'not_done', countsForRotation?, fixed, key, timeLocal?, provenance, notes[]}]}`, `summary {done, aim?: {days, source: 'stated'}, endurance[]}`, `programme {id, name, week, weeks, deload}`, `openProposalCount`, `staleProposalCount`. No strength `planned` or `missed` items. Local only |
| `upsertPlannedEndurance(input, opId)` / `setEnduranceStatus(id, status, expectedVersion)` / `removeScheduledSession(id, expectedVersion)` | Planned endurance entries (WP3); `source: 'ben'`; imported matches later carry `source` and import ID |
| `setWeeklyAvailability(weekStartLocal, days[], opId)` | Per-week override of `AvailabilityRule` |
| `checkScheduleConflicts(context, rotationView, weekItems, approvedRules, sessionLoads, now)` (revised 9 Oct evening) | **Pure, `packages/domain`, unit-tested.** Only rules with `approved: true` (11, 12, 13), and nothing when `context.enduranceRulesActive` is false. Returns `{conflictId, ruleId: '11' \| '12' \| '13', kind: 'before_key_window' \| 'same_day_gap_window' \| 'after_match_window' \| 'if_today' \| 'same_day_order' \| 'heavy_floor', routineId?, itemIds, window?: {fromUtc, toUtc, tz}, facts, text}`. `same_day_order` lift-first only when `context.liftFirstApplies`; `heavy_floor` only when `context.rule13Active` and `context.daysPerWeek.value ≥ 2`, with `projection {done, projectedRoutineIds[]}` (WP17). Usual items count for `before_key_window` only |
| `suggestConflictFreeRoutine(rotation, notes, now)` (9 Oct evening) | **Pure.** The first routine after Next with no clash now, and the order that would follow it (`Then Pull A, then Legs A.`) |
| `resolveTrainingContext(ownerId, date)` (coaching-playbook.md §6) | Endurance switch, its reason, key sessions (planned and usual), days a week; (9 Oct evening) adds `plan: {kind: 'rotation', routineIds[], nextRoutineId?, rotationVersion}` |
| `listUsualItems(ownerId, weekStartLocal, tz)` (9 Oct) | `Usual` items for the week from Profile → Other training, minus days where Ben hid them or added a real entry. `hideUsualItem(entryId, dateLocal, opId)` for `Not this week` |
| `classifySessionLoad(routineVersion)` additions (9 Oct) | Adds `heavyStrength: boolean` and its reason (≥ 2 working sets of a squat, hinge, press or pull compound with top rep target ≤ 6), for rule 13 (WP11) |
| `acknowledgeConflict(conflictId)` | Stores Ben's "keep it" |
| `proposeScheduleChange(change, opId)` | Builds an author-`ben` proposal for endurance series (change-review.md) |
| `ScheduledSession` fields (revised) | Endurance only: `fixed`, `key`, `kind: 'endurance'`, `timeLocal?`, `tz`, `provenance`, `seriesId?`, `type: 'run' \| 'ride' \| 'swim' \| 'row' \| 'class' \| 'sport' \| 'other'`, `label?`, `effort?: 'easy' \| 'hard'`. Strength `ScheduledSession` rows are no longer created |
| Withdrawn for lifting (9 Oct evening) | `skipScheduledSession`, `unskipScheduledSession`, `replaceScheduledSession`, `addScheduledSession` (strength), `linkSessionToSchedule`, weekly-pattern `proposeScheduleChange`. The check-in's `Skip workout` records "not training today" without touching the rotation (check-in.md follow-up) |
| Playbook rule records | (revised 9 Oct) `{ruleId: '12', text, grade, approved, params {hoursBeforeKey: 48, hoursAfterMatch: 48, minGapHours: 6, heavyLegsThresholds}}`, `{ruleId: '13', params {minHeavySessions: 2}}`, read by the domain, edited only by Ben (coaching-playbook §2.2b) |

## 7. Acceptance checks

1. **Brief scenario 3 (rotation).** With rule 12 approved, a `Key` long run on Sat 17 at 07:30 and Legs A next: the Legs A rotation row shows `Heavy legs: keep it out of Thu 07:30 – Sat 07:30 (48 h before your long run).` On Thu at 18:00, Today's card shows `Heavy legs 37 h before your long run (Sat 07:30). Options ›`. Nothing changes until Ben picks an option, and the long run is never offered as the thing to move.
2. With rule 12 removed from Ben's playbook, no window note appears anywhere, and `Scheduling rules` doesn't list it.
3. **Next follows the last workout.** Rotation Push A, Pull A, Legs A: finishing Push A makes Pull A next; finishing Legs A instead (out of order) makes Push A next. Unit tests on `getNextInRotation` cover wrap-around, one routine, no history and a removed routine.
4. **What counts.** An empty workout, an unsaved coach draft, a discarded workout and a finished workout with 0 working sets don't change Next. A Repeat of a Pull A workout counts as Pull A.
5. **No missed lifting.** A week with no workouts shows `0 of your 3 days done`; no `Missed` word, icon or banner appears anywhere for lifting.
6. `Edit rotation` → move Legs A to the top → `Save`: the toast reads `Rotation saved · next is …` with Undo; Undo within 8 s restores the old order; Next is always recomputed from the last counted workout.
7. Removing the last-done routine from the rotation makes the first routine Next, with `Start of your rotation (Legs B was removed)`.
8. A coach rotation proposal (after Ben asks for a new split) never changes the rotation before Apply, lists old and new order, and a `Fixed` endurance session never appears in its changes. With no request and no signal, no rotation proposal appears (coach-adjustments CA9).
9. `Do Push A today instead` (rotation Legs A next, then Push A, Pull A) shows `Then Pull A, then Legs A.` and opens Push A's sheet; nothing starts without the `Start workout` tap.
10. Moving an endurance item (this week only) applies at once with a toast; Undo within 8 s puts it back; `Every week` opens change-review listing every affected date; nothing changes until Apply.
11. A past endurance session with no confirmation shows `Not confirmed`, never `Missed` or `Done`; no distance, pace or fatigue is shown unless imported, and an imported value names its source and import date.
12. The week summary shows strength and endurance as separate lines; no combined score appears anywhere on the screen. Without `Days a week you lift`, the strength line reads `2 workouts this week`.
13. `classifySessionLoad` marks a routine with 8 squat/hinge working sets as heavy legs, one with 2 sets at RPE 7 as not, and Ben's `No` override wins (unit tests). The trade-off sheet quotes the reason.
14. No "day after a long run" note appears in any case (C4 isn't in playbook v1). The after-match window appears only when the match is marked done, imported or reported, never for a usual or unconfirmed match.
15. Today's availability set to 30 min with Legs A next (about 60 min) shows the mismatch on today's row; nothing is shortened or moved.
16. Windows are computed in the plan's time zone: a Sat 07:30 Auckland key run gives `Thu 07:30 – Sat 07:30` in Auckland time, and the line `Days shown in Auckland time…` appears on a phone in another time zone.
17. With airplane mode on and no AI, the rotation, its editor and every direct edit work; only chat rescheduling and the coach options show `Coach offline`.
18. Today's Up next card and this view's `▶ Next` row always name the same routine with the same basis (same `getNextInRotation` call), after a workout, an edit or an Undo.
19. Every status (Done, In progress, Not confirmed, Didn't happen, Fixed, Key, Today, usual) is distinguishable in greyscale by icon and word.
20. At AX3 the day list stacks (date above items), rotation rows wrap without truncating names or minutes, availability chips wrap, and the rotation editor's `Move up` / `Move down` / `Remove` stay ≥ 44pt. There are no swipe-only or drag-only actions.
21. The endurance form's types are `Run`, `Ride`, `Swim`, `Row`, `Class or HIIT`, `Match or sport` and `Other`. No option, placeholder or note names HYROX or any other race brand.
22. With no hard, long or key endurance, class or sport entries this week, none imported or reported in the last 7 days, and other training `None`, `Not set` or only `Easy`, the plan shows no conflict note, rule 13 line, same-day hint or `Usual` item. Unit test: `checkScheduleConflicts` returns `[]` when the switch is off.
23. With `Running · Tue, Sat · Sat key` set as usual in Profile and nothing planned, Tue and Sat show `Running · usual`, and Legs A's row shows the window before Saturday. The summary still counts only workouts, and `Add to this week` turns the usual item into a planned entry with Undo.
24. With the switch on, `Endurance` under also matters, 3 lifting days, 1 workout done this week (light) and the next two in the rotation being Legs A (heavy) and a light routine, the rule 13 line reads `At 3 days, this week has 1 heavy strength session (Legs A)…`. Reordering so two heavy routines come next removes it. With the switch off, with endurance not one of Ben's goals, or with 1 lifting day, it never shows.
25. A Thu run at 07:00 marked `Hard or long` (or `Key`) and Legs A next: Legs A's row says `keep it at least 6 h from your intervals (Thu 07:00)`; at 11:00 Thu Today's card says `Heavy legs under 6 h from your intervals (07:00 today).`; at 13:00 it doesn't. Marked `Easy` or no effort: no note. Unit tests cover 5 h 59 min and 6 h 00 min.
26. Same day, switch on, Strength focus, a normal run on today: today's row and Today's card show `Run today too: lift first, keep the run easy.`; with a `Key` run, `Key run today: run first and keep leg work light…`. Nothing is moved or retimed.
27. Same day, switch on, `Support other training` as the focus: no screen says "lift first"; a `Key` run still gets its hint.
28. Muscle focus with one usual `Easy` jog and nothing else: nothing about rules 11–13 appears. Marking the jog `Hard or long` turns rule 12 windows and rule 11 hints on, but still no rule 13 line (endurance isn't a goal).
29. A `Class or HIIT` entry opens with `Hard or long` selected. Changing it to `Easy` removes any 6 h window it caused and, if it was the only hard item, turns the switch off.
30. **Programme weeks (WP18).** A 6-week programme from Mon 12 Oct with 3 workouts a week: on Mon 19 Oct the line reads `Week 2 of 6` whatever was done in week 1; with 2 of 3 done in week 1, the first workout of week 2 is slot 3, using week 2's version. A deload week shows on its dates.
31. When the programme ends, the line reads `Strength + 10k ended 22 Nov. Your rotation continues: Push A, Pull A, Legs A.` and Next follows Ben's last counted workout in his own rotation.
32. With a workout in progress, the rotation's top row reads `▶ In progress: Legs A` with `Resume` in its sheet, and the row after it reads `Next after this one`.

## Proposed design-system additions

No new colours or timing tokens. (Not merged here: another agent owns design-system.md right now.)

| Component / style | Spec |
|---|---|
| Schedule status styles (extends §7; revised 9 Oct evening) | `Done` `checkmark.circle.fill` `status.done` · `In progress` `arrowtriangle.right.fill` `accent` · `Planned` (endurance) `circle` `text.tertiary` · `Not confirmed` `questionmark.circle` `text.secondary` · `Didn't happen` `xmark.circle` `text.secondary`. Each with its word; VoiceOver reads the word. `Missed` and `Skipped` are no longer used for lifting |
| `RotationRow` (new) | 52pt min; `bg.surface`, rows divided by `border.divider`. Leading position column 44pt wide: `▶` + `Next` (`type.label`, `accent` icon, word always shown) or the number (tabular, `text.secondary`). Name `type.headline`; `about N min` `type.callout` `text.secondary`; basis line `type.callout` `text.secondary`; optional `ConflictNote`. Trailing chevron. The whole row is the button. VoiceOver: "Next, Legs A, about 60 minutes, after Pull A on Wednesday the 14th. Warning: heavy legs, keep it out of Thursday 07:30 to Saturday 07:30." |
| `ConflictNote` window variant | Same frame (`exclamationmark.triangle` `status.warning` + `type.callout` + `Options ›`, 44pt hit); text from `checkScheduleConflicts`, times tabular |
| `FixedBadge` / `KeyBadge` | Text tags in set-type badge style: `lock.fill` + `Fixed`; `flag.fill` + `Key`. `text.secondary` on `bg.raised`. Never `accent` |
| `DayRow` | 52pt min per item; date column 64pt (tabular); today = 4pt `accent` left bar + `accent.subtle` background + the word `Today` (`type.label`). At AX1+ the date sits above its items |
| `WeekSwitcher` | `chevron.left` / `chevron.right` buttons 44 × 44, title `type.headline` (tabular dates), tap title = this week |

## Cross-links

- [today.md](today.md): the Up next card, `Then: …` row and the `if_today` note read the same rotation
- [routines.md](routines.md): Plan hub (RT1), `Your rotation` section in the list, `Add to rotation` (RT9), `classifySessionLoad` and the `Counts as heavy legs` override (RT7)
- [change-review.md](change-review.md): coach rotation proposals, endurance series, stale handling (**follow-up:** CR1's scope `Your weekly pattern from now on` becomes `Your rotation from now on`, and `Thu 15 Oct only` applies to endurance items, with `Next Legs A only` for one-off routine changes)
- [check-in.md](check-in.md): **follow-up**: `Skip workout` no longer calls `skipScheduledSession`, and `Reschedule` isn't offered for lifting
- [onboarding.md](onboarding.md) and [profile-and-settings.md](profile-and-settings.md) §2.2: **follow-up**: usual lifting weekdays no longer schedule anything; they can feed availability, and `Days a week you lift` is the week's aim
- [workout-builder.md](workout-builder.md) §8: programme request, preview and scheduling (programme blocks), as a rotation per week (WP18)
- [coach-adjustments.md](coach-adjustments.md) CA9: when the coach may propose rotation or routine changes
- [playbook-v1.md](../training-guides/playbook-v1.md) rules 1, 11–13, G and D19; [coaching-playbook.md](coaching-playbook.md) §2.1a (`Plan` row) and §2.2 (rule 12's window line)
- Library background: `docs/training-guides/concurrent-training.md` C1–C5, C8; `docs/training-guides/programmes.md` (deload weeks, 2–3 day templates)
