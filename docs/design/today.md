# Today

> **Revision 2026-10-08.** Aligned with [ADR 0003](../decisions/0003-domain-review-decisions.md) S4 and S5: the stale card's Finish passes the chosen end time to `finishWorkout(…, endedAt)` in one call, and is blocked with a Stop prompt if a work timer was left running. `Empty workout` now opens the empty-workout state. Discard of a 0-set workout has no Undo.
>
> **Revision 2026-10-08 (re-review).** Aligned with ADR 0003 "Re-review decisions" S8: the stale card's Stop → Finish path also completes when the workout was left paused (Stop ends the interval at the pause start and doesn't resume) (§3 transitions, §4).
>
> **Revision 2026-10-08 (coach-led progression, v0.4).** Per [ADR 0006](../decisions/0006-coach-led-progression.md): when a finished workout has unapplied, non-stale coach next-time proposals, the `Next:` row shows one extra line `2 coach suggestions to review ›` that opens that workout's summary (§2, §3, §4, §5, check 15). Nothing on Today applies a change. Readiness still never changes targets.

> **Revision 2026-10-08 (workout builder, v0.5).** The alternatives row and the No-plan link row gain a `Build a workout` text link that opens the Build sheet in [workout-builder.md](workout-builder.md). It is never a primary button and is hidden in the Resume state. Today still makes no AI call (§2, §4, §5).

> **Revision 2026-10-08 (consolidation).** Links now point at the new specs: `Other routine` opens the Plan hub's `Routines` segment ([routines.md](routines.md) RT1); `Next: …` and `Reschedule` open its `Week` segment ([weekly-plan.md](weekly-plan.md)), no longer a `Coming soon` placeholder once Phase A lands; `Edit gyms` opens [gym-editor.md](gym-editor.md); `Restore from backup` opens [data-import-export.md](data-import-export.md) §2.3. Banners above the main card follow [system-states.md](system-states.md) §2.2 (at most two; the only backup banner is a **failed** on-phone backup, since backups now live in the app by default and off-phone copies never nag). Today still makes no AI call.

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** The readiness region (`How do you feel today?` with `Normal` / `Tired` / `Sore`) and `recordReadiness` are **removed**; [check-in.md](check-in.md) replaces them. `Start workout` (and every other start on this screen, plus `Resume` of a session with no set ever logged and an unanswered check-in) now goes through `shouldAskCheckIn`: when check-ins are on and due, a `CheckInSheet` asks `How are you feeling today?` (1–5, `Skip`) before the session is created; when off or not due, Start is still one tap. Today gains one rare line for an unlinked check-in (§2 region 4). Today still makes no AI call. Changed: §2 region 4 and the planned wireframe, §3 (rows Resume, Done today, new rows), transitions, §4 (Start, check-in line, voice, undo), §5, §6, checks 5, 6 and new 16–18. P11 is superseded (flow-first-milestone.md §7).

> **Revision 2026-10-09 (competitor follow-ups 8 and 10; approved by Ben, CHANGELOG 2026-10-09).** Two small, local additions; Today still makes no AI call and still has one primary button. (1) **Pain flag check (region 4b, rare):** when a pain flag's two-weekly `Still hurts?` check is due and no workout is in progress, one quiet row: `⚠ Still hurts? Overhead press · flagged 16 days ago ›`. It opens the pain flag sheet ([active-workout.md](active-workout.md) §2.14.4). It is never a banner (it doesn't count towards the two-banner limit), never a notification, and never clears a flag. (2) **Time left on the Resume card:** `7 of 18 sets done · about 35 min left` from `estimateRemainingDuration` (active-workout.md §2.15), worded as an estimate. Changed: §2 (region 4b, Resume wireframe), §3, §4, §5, §6, checks 19–22.

> **Revision 2026-10-09 evening (Ben's decision D19: rotation by last session; [weekly-plan.md](weekly-plan.md) WP14).** Today no longer reads a weekday plan. **The main card offers the routine after the one Ben last did.** Rotation changes only; nothing else on this screen changes.
> - The `Today's plan` card becomes **`Up next`**, with a fact line saying what it follows: `After Pull A on Wed 14`. `Start workout` is still one tap (plus the check-in when due).
> - The `Next: Pull A · Sat 10 Oct` row becomes **`Then: Pull A · Legs A ›`** (no dates; opens Plan → Week).
> - `This week` reads **`2 of your 3 days done`**, against `Days a week you lift` as Ben's aim; `2 workouts this week` without it. Never "planned".
> - **`Reschedule` is removed** from the alternatives row (lifting has no dates to move). The `Rest day` state is withdrawn (rotation has no rest days). `Other routine` stays; whatever Ben trains, the rotation carries on from it.
> - Rotation-driven notes on the Up next card, from `checkScheduleConflicts` (weekly-plan WP13, WP16): `⚠ Heavy legs 37 h before your long run (Sat 07:30). Options ›` when Ben is inside a rule 12 window; the rule 11 same-day hint; and an availability mismatch. At most one note shows (priority in that order).
> - `No plan` becomes **`No rotation yet`**.
> - Changed: §1, §2 (regions 2, 3, 5, 6 and wireframes), §3 (rows Planned, Rest day, Workout skipped, No plan; new rows), transitions, §4, §5, §6, checks 23–30.

Status: v0.1 draft, 8 Oct 2026. Flow: [flow-first-milestone.md](flow-first-milestone.md). Tokens: [design-system.md](design-system.md).

## 1. Purpose

Today answers **"What am I training now, and where?"**

Its single primary action is **Start workout**, or **Resume** when a workout is unfinished. There is never more than one primary button on screen.

Supporting answers on the screen:
- which gym is selected
- how the week is going (in one line)
- what comes after it in the rotation (revised 9 Oct evening, D19)

Today is the first tab. Detailed charts belong in Progress. Routines and the weekly plan open from here.

## 2. Layout

Regions, top to bottom:

1. **Header (compact).** The date (`Thu 8 Oct`) on the left and the `GymChip` on the right. There's no large title; the space goes to the main card.
2. **Main card.** Either Up next + `Start workout`, Resume, the stale-workout card, or No rotation. Only one of these shows at a time. (Revised 9 Oct evening, D19.) The Up next card names the routine `getNextInRotation` returns and a fact line about why: `After Pull A on Wed 14` (an actual), `Start of your rotation`, or `Only routine in your rotation`. Under it, at most one rotation note (priority order): a rule 12 window Ben is inside now (`⚠ Heavy legs 37 h before your long run (Sat 07:30). Options ›`, weekly-plan WP16), the rule 11 same-day hint (`ⓘ Run today too: lift first, keep the run easy.`, WP13), or an availability mismatch (`⚠ About 60 min; 30 min available today`).
3. **Alternatives row.** Text buttons: `Other routine`, `Empty workout`, `Build a workout` ([workout-builder.md](workout-builder.md)), and `Shorter session` (shown only when a rotation exists). It is hidden while a workout is in progress. (9 Oct evening: `Reschedule` removed; lifting has no dates.)
4. **Check-in line (rare; revision 2026-10-09).** Shown only when a check-in from the last 2 h isn't linked to a workout yet (the sheet was swiped away, or the app closed mid-sheet): `Check-in saved at 18:02: 3 of 5 · Tired. It'll be used when you start.` Tap opens the check-in edit sheet. Otherwise absent. The check-in itself is asked on Start ([check-in.md](check-in.md)), not on this screen.
4b. **Pain flag check (rare; revision 2026-10-09).** Shown only while a pain flag's `Still hurts?` check is due (14 days after it was set or last checked) and no workout is in progress: `⚠ Still hurts? Overhead press · flagged 16 days ago ›` (`exclamationmark.triangle` in `status.warning` + `type.callout` text, the whole row a ≥ 44pt button). With two or more due: `⚠ Still hurts? 2 pain flags to check ›`. Tap opens the pain flag sheet ([active-workout.md](active-workout.md) §2.14.4), or the Pain flags list ([coach-memory.md](coach-memory.md) §2.1) when several are due. It sits under the alternatives row and above `This week`. It isn't a banner and isn't dismissible: it goes away when every due check is answered, and answering it in a workout counts too.
5. **This week.** `2 of your 4 days done` (actual workouts against `Days a week you lift`, Ben's aim; `2 workouts this week` when it isn't set), plus one pinned lift line. The data is static, with no chart animation. (Revised 9 Oct evening, D19; was `2 of 4 planned sessions done`.)
6. **Then.** One row, `Then: Pull A · Legs A ›`: the next two routines after Up next, no dates. It opens the weekly plan. (Revised 9 Oct evening, D19; was `Next: Pull A · Sat 10 Oct`.) If the last finished workout has unapplied coach proposals for the next session, a second line `2 coach suggestions to review ›` opens that summary's `Next time` section ([coach-adjustments.md](coach-adjustments.md) §4.6).
7. **Ask pill.** The `TalkButton` pill, floating bottom-trailing above the tab bar. Content has a bottom inset so the pill never covers the Start button.
8. **Tab bar.** Today · Progress · Profile.

### Wireframe: up next (normal; revised 9 Oct evening for the rotation)

```
┌────────────────────────────────────────┐
│ Thu 8 Oct                [⌂ Main Gym ▾]│
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ Up next                            │ │ eyebrow
│ │ Push A                             │ │
│ │ Chest · shoulders · triceps        │ │
│ │ 5 exercises · about 55 min         │ │ estimate
│ │ After Legs A on Tue 6 Oct          │ │ basis (actual), text.secondary
│ │                                    │ │
│ │ ┌────────────────────────────────┐ │ │
│ │ │          Start workout         │ │ │
│ │ └────────────────────────────────┘ │ │
│ └────────────────────────────────────┘ │
│  Other routine · Empty workout         │
│  Build a workout · Shorter session     │
│                                        │
│ This week                              │
│ 2 of your 4 days done                  │ actual vs Ben's aim
│ Bench press best set                   │
│ 100 kg × 8 (6 Oct) · was 97.5 kg × 8   │
│ (29 Sep)                               │
│                                        │
│ Then: Pull A · Legs A                › │ no dates
│                                        │
│                            ( 💬 Ask )  │
├────────────────────────────────────────┤
│   Today        Progress       Profile  │
└────────────────────────────────────────┘
```

### Wireframe: unfinished workout (Resume)

```
┌────────────────────────────────────────┐
│ Thu 8 Oct                [⌂ Main Gym ▾]│
│ ┌────────────────────────────────────┐ │
│ │ ▶ In progress · started 18:02      │ │
│ │ Push A                             │ │
│ │ Now: Bench press · set 3 of 4      │ │
│ │ 7 of 18 sets done · about 35 min   │ │ estimate (2026-10-09)
│ │ left                               │ │
│ │ ⏱ Rest 1:12 left                   │ │
│ │ ┌────────────────────────────────┐ │ │
│ │ │             Resume             │ │ │
│ │ └────────────────────────────────┘ │ │
│ └────────────────────────────────────┘ │
│ Then: Pull A · Legs A                › │ the two after this workout
└────────────────────────────────────────┘
```

### Wireframe: up next with a rule 12 note (9 Oct evening)

```
│ ┌────────────────────────────────────┐ │
│ │ Up next                            │ │
│ │ Legs A                             │ │
│ │ 6 exercises · about 60 min         │ │
│ │ After Pull A on Wed 14             │ │
│ │ ⚠ Heavy legs 37 h before your long │ │ ConflictNote (if_today), one only
│ │   run (Sat 07:30). Options ›       │ │ → weekly-plan §2.6 trade-off sheet
│ │ ┌────────────────────────────────┐ │ │
│ │ │          Start workout         │ │ │ still enabled: a note never blocks
│ │ └────────────────────────────────┘ │ │
│ └────────────────────────────────────┘ │
```

### Wireframe: stale unfinished workout (≥ 6 h since last activity)

```
│ ┌────────────────────────────────────┐ │
│ │ ⚠ Unfinished workout · Wed 7 Oct   │ │
│ │ Push A · 12 of 18 sets done        │ │
│ │ Last set logged at 19:21           │ │
│ │ ┌────────────────────────────────┐ │ │
│ │ │    Finish (ended about 19:24)  │ │ │
│ │ └────────────────────────────────┘ │ │
│ │ Resume instead                     │ │
│ └────────────────────────────────────┘ │
```

### Wireframe: no rotation / first use (revised 9 Oct evening)

```
│ ┌────────────────────────────────────┐ │
│ │ No rotation yet                    │ │
│ │ ┌────────────────────────────────┐ │ │
│ │ │       Start empty workout      │ │ │
│ │ └────────────────────────────────┘ │ │
│ │ Choose a routine · Create a routine│ │
│ │ Set up your rotation               │ │
│ │ Build a workout                    │ │
│ └────────────────────────────────────┘ │
│ This week                              │
│ No workouts logged yet this week.      │
```

## 3. States

| State | Trigger | Main card | Other regions |
|---|---|---|---|
| Loading | Cold start before `buildTodayView` returns | Nothing for the first 300 ms, then static grey blocks (no shimmer) | Hidden |
| Opening active workout | Cold start with an unfinished session < 6 h old | Today isn't shown. The app opens Active workout directly (P6) | none |
| Up next (revised 9 Oct evening; was Planned) | A rotation exists and no workout is unfinished | `Up next` + routine + basis line + `Start workout` | All regions. `Then: …` row |
| Up next, rule 12 window (9 Oct evening) | The Up next routine is heavy legs and now is inside one of its windows (weekly-plan WP16, `kind: 'if_today'`) | Card adds `⚠ Heavy legs 37 h before your long run (Sat 07:30). Options ›`. `Start workout` stays enabled | Only while the endurance switch is on and rule 12 is approved |
| Up next, same-day hint (9 Oct evening) | An endurance item is on today (switch on) | Card adds `ⓘ Run today too: lift first, keep the run easy.` (only when lifting is the priority) or `ⓘ Key run today: run first and keep leg work light. Ask the coach to lighten Legs A ›` | Weekly-plan WP13. Not shown when a window note is showing |
| Up next, availability (9 Oct evening) | Today's availability is less than the Up next estimate | Card adds `⚠ About 60 min; 30 min available today` | Lowest priority of the three notes |
| Up next, nothing done yet (9 Oct evening) | A rotation exists, no counted workout yet | Basis line `Start of your rotation` | — |
| Up next, one routine (9 Oct evening) | The rotation has one routine | Basis line `Only routine in your rotation`; no `Then` row | — |
| In a programme (9 Oct evening) | A programme is active | Up next is this week's programme routine; eyebrow `Up next · Week 2 of 6` | Weekly-plan WP18 |
| Resume | Unfinished session < 6 h old (Ben came back to Today with the chevron) | Resume card with live rest or paused status | Alternatives hidden. `Resume` never shows the check-in once any set has been logged (check-in.md §2.1) |
| Stale unfinished | Unfinished, last activity ≥ 6 h ago | `Finish (ended about hh:mm)` primary, `Resume instead` link. With nothing logged: `Discard (nothing logged)` primary instead | Alternatives hidden |
| Done today | A session finished today | `✓ Push A done · 54 min` + `View summary` link, then `Up next: Pull A` (`type.callout`, revised 9 Oct evening). The primary becomes `Start another workout` as a secondary button, which starts Up next. **No primary button** | `Start another workout` asks the check-in again (a new session), unless check-ins are off or not due |
| Check-in sheet up | `Start workout` tapped, check-in due (check-in.md §2.1) | Today stays underneath, dimmed by `color.scrim`; Start is disabled while the sheet is up | The sheet is the only interactive layer |
| Check-in saved, not started | A check-in < 2 h old isn't linked (sheet swiped away after a score, or app closed) | Normal | Region 4 line. The next Start uses it without asking |
| Workout skipped from the check-in | `Skip workout` chosen in the check-in's `Feeling ill` step | The card reads `Not training today. Push A is still next.` with secondary `Start a workout anyway` (no primary). The rotation doesn't move (revised 9 Oct evening) | Toast `Not training today` [Undo]. check-in.md follow-up: no `skipScheduledSession` call |
| No rotation (revised 9 Oct evening; was No plan) | No rotation set up | `No rotation yet` + `Start empty workout` primary, links `Choose a routine · Create a routine · Set up your rotation · Build a workout` | This week shows text, not an empty chart |
| ~~Rest day~~ | Withdrawn 9 Oct evening (D19): the rotation has no rest days. The basis line (`After Pull A on Wed 14`) shows how recently Ben trained; whether to rest is his call | — | — |
| No gym | No gym profile exists | Normal card. The gym chip reads `Add gym`. The start button stays enabled | Banner: `No gym selected. Loads won't be checked against equipment.` [Add gym] |
| Sparse data | < 2 weeks of history | Normal | This week: `1 workout logged this week.` The pinned lift line is replaced by `Pin a lift in Progress to see it here.` |
| Days a week not set (9 Oct evening) | `Days a week you lift` is empty | Normal | This week: `2 workouts this week` (no aim) |
| Database error | SQLite open or read failed | `Couldn't open your training data.` [Try again], plus a link `Restore from backup` | Hidden |
| AI unavailable | `getAiCapabilities` reports no text route | No change to the main card | The Ask pill shows `Offline` with the slashed icon |
| Offline | No network | No change. Today needs no network | No banner (nothing here needs it). The Ask pill shows `Offline` if the coach needs the network |
| Coach suggestions waiting | The last finished workout has unapplied, non-stale coach next-time proposals, and their routine hasn't started again | No change | `Next:` row gains `2 coach suggestions to review ›`. It disappears once each is applied, set to Not now, or expired (the routine started). Starting the routine without reviewing uses the built-in rule's targets |
| Pain flag check due (2026-10-09) | A pain flag's check is due (`timing.painReview`, 14 days) and no workout is in progress | No change | Region 4b row. Hidden in Resume and stale states (the workout asks in place instead). Offline and AI-unavailable: unchanged, because it's local |
| Pain flag check answered (2026-10-09) | `Still hurts` or a cleared flag, from here or in a workout | No change | Row gone; a toast from the sheet (`Pain flag kept · next check 3 Nov` [Undo] or `Pain flag cleared for Overhead press` [Undo]) |
| Resume, time left (2026-10-09) | Unfinished session < 6 h old | Resume card adds `about 35 min left` to the sets line (`Paused · about 35 min left after you resume` when paused) | Estimate from `estimateRemainingDuration`; recomputed when Today appears and once a minute |

Transitions:
- Up next → Start → Active workout (pushed full-screen). With check-ins on and due: Up next → Start → check-in sheet → (score, `Skip`, `Done` or `Train anyway`) → Active workout; swipe-down → Up next, nothing started; `Skip workout` → Workout skipped (rotation unchanged). (9 Oct evening: the check-in's `Reschedule` isn't offered for lifting.)
- (9 Oct evening, D19) Finishing a workout from a rotation routine (≥ 1 working set) → Up next becomes the routine after it. `Other routine` → any routine → finish → the rotation carries on from that one. An empty or discarded workout leaves Up next unchanged.
- Active workout → chevron-down (minimise) → Today in the Resume state.
- Resume → Resume → Active workout.
- Stale → Finish → finish sheet with the end time prefilled → Summary. With a work timer left running or paused (even in a paused workout): finish sheet → [Stop] → Finish → Summary.
- Finished → Done → Today (Done today).

## 4. Interactions

| Element | Tap | Other |
|---|---|---|
| `Start workout` | Creates the opId, then `shouldAskCheckIn`. Not due: `startWorkout(upNext.routineId, gymId, opId, {checkIn: {kind: 'not_asked', reason}})` and open Active workout (one tap, as before). Due: the check-in sheet; the sheet's score / `Skip` / `Done` / `Train anyway` then calls `startWorkout(…, opId, {checkIn})` with the same opId (check-in.md §4.1). Disabled for 1 s after the tap and while the sheet is up, so it can't double-start. The opId stops a second session being created | none |
| `Resume` | Opens Active workout in the persisted state | none |
| `Finish (ended about 19:24)` | Opens the finish sheet (see active-workout.md §4.8) with the end time prefilled as the last set time + 3 min. Ben can edit it between the last set and now. `Finish` calls `finishWorkout(sessionId, expectedVersion, endedAt)` once; the tap time is kept in the timing audit. If a work timer was left running or paused, the sheet shows `Stop the timer first` with [Stop] (the elapsed time is kept as that set's draft), then the normal Finish. This works even when the stale workout is paused: Stop ends the interval at the moment the pause began, leaves the workout paused, and Finish completes without a Resume. After Stop, the sheet's primary button is `Finish`; Resume stays available as a secondary action, never the primary one. Stale cards with 0 logged sets show `Discard (nothing logged)` instead of Finish | none |
| Gym chip | Opens the gym switcher sheet: a list of gyms with a check on the selected one, plus `Add gym` and `Edit gyms` (→ Profile). Choosing a gym before starting just selects it. During an unfinished session, it calls `setActiveGym(gymId, sessionId)`, which returns a proposal shown as a `ChangeReviewCard` in Active workout | none |
| Check-in line (region 4, rare) | Opens the check-in edit sheet (check-in.md §4.6) | Never changes targets; the built-in rules ignore check-ins |
| Pain flag check row (region 4b, rare; 2026-10-09) | Opens the pain flag sheet (active-workout.md §2.14.4) with `Still hurts?` first: [Still hurts] keeps the flag (`recordPainFlagReview`), [Better: clear…] opens the clear confirmation (`clearPainFlag` only on `Clear flag`). Several due: opens the Pain flags list | Voice: "my shoulder still hurts" while the sheet is open = `Still hurts`; clearing is never done by voice alone. Undo: the toast from the sheet (8 s) |
| Pinned lift line | Opens that exercise's history in Progress | none |
| `Then: …` row (revised 9 Oct evening) | Opens the weekly plan (Plan → Week, with the rotation at the top) | none |
| Rotation note `Options ›` (9 Oct evening) | Opens the trade-off sheet (weekly-plan §2.6): `Do Push A today instead` (opens that routine's sheet), `Ask the coach to lighten Legs A` (proposal), `Keep it` | `Keep it` collapses the note to `⚠ Kept · heavy legs before long run` |
| `… coach suggestions to review ›` | Opens the summary of the workout they came from, scrolled to `Next time`. Apply/Undo happen there | none |
| `Build a workout` | Opens the workout builder's Build sheet (workout-builder.md §3.1), or its offline frame (§3.7) when `getAiCapabilities` reports no text route. Nothing starts without a later tap on `Start now` | none |
| ~~`Reschedule`~~ | Withdrawn 9 Oct evening (D19): lifting has no dates to move. To do something else first, Ben uses `Other routine` | — |
| `Shorter session` | Out of milestone scope. Hide it until `shortenSession` exists | none |
| Ask pill | Opens the coach sheet with Today's context attached. Long-press starts push-to-talk if voice is available | none |

Voice equivalents (when voice is available): "Start my workout" maps to the Start action through the coach tool path, for the Up next routine (9 Oct evening). "What's next?" is answered from `getNextInRotation`: "Push A is next, after Legs A on Tuesday." It needs no confirmation because it is reversible: an empty session can be discarded. With check-ins due it opens the check-in sheet; "start my workout, feeling a 3, tired" starts and checks in at once (check-in.md §4.5). A bare "feeling a 3" on Today saves nothing and says how to check in.

Undo:
- Starting by mistake: in Active workout, the menu offers `Discard workout`. With 0 sets logged, it discards at once with the toast `Workout discarded` (no Undo; nothing was logged, so Ben just starts again).
- `Empty workout` / `Start empty workout` call `startWorkout(null, gymId, opId)` and open Active workout in the empty state (`Add an exercise to start`, active-workout §2.10).
- A check-in is changed or deleted from its `Change` toast (before the first set), the summary, the past workout or Progress (check-in.md §4.6). `Skip workout` from the check-in has a toast [Undo].

## 5. Copy

| Element | Text |
|---|---|
| Date header | `Thu 8 Oct` (locale short weekday, day, month) |
| Plan card eyebrow | `Up next` (revised 9 Oct evening; was `Today's plan`) · in a programme `Up next · Week 2 of 6` |
| Basis line (9 Oct evening) | `After Pull A on Wed 14` (an **actual**) · `Start of your rotation` · `Only routine in your rotation` |
| Rotation notes (9 Oct evening) | `Heavy legs 37 h before your long run (Sat 07:30).` · `Heavy legs under 6 h from your intervals (07:00 today).` · `Heavy legs the day after your match.` · `Options ›` · `Kept · heavy legs before long run` · `Run today too: lift first, keep the run easy.` · `Key run today: run first and keep leg work light. Ask the coach to lighten Legs A ›` · `About 60 min; 30 min available today` |
| Duration | `about 55 min` (from `estimateRemainingDuration`, so always "about") |
| Primary | `Start workout` / `Resume` / `Start empty workout` / `Finish (ended about 19:24)` / `Discard (nothing logged)` |
| Resume eyebrow | `In progress · started 18:02` |
| Resume lines | `Now: Bench press · set 3 of 4`, `7 of 18 sets done · about 35 min left` (2026-10-09; an **estimate**; paused: `· paused, about 35 min left after you resume`), then one of `Rest 1:12 left` / `Ready for next set` / `Paused` |
| Pain flag check (2026-10-09) | `Still hurts? Overhead press · flagged 16 days ago` · several: `Still hurts? 2 pain flags to check` · VoiceOver "Pain flag check due: Overhead press, flagged 16 days ago. Button." |
| Stale eyebrow | `Unfinished workout · Wed 7 Oct` |
| Stale lines | `Last set logged at 19:21`, link `Resume instead`. With a work timer left running: extra line `Dead hang timer still running` |
| Stale, nothing logged | `Nothing logged` and primary `Discard (nothing logged)`, link `Resume instead` |
| Check-in (sheet) | All copy in check-in.md §5 (`How are you feeling today?`, `1 = rough`, `5 = great`, `Skip`) |
| Unlinked check-in line | `Check-in saved at 18:02: 3 of 5 · Tired. It'll be used when you start.` (what Ben said) |
| Skipped from check-in | `Not training today. Push A is still next.` · `Start a workout anyway` · toast `Not training today` [Undo] (revised 9 Oct evening) |
| This week | `2 of your 4 days done` (**actual** workouts against Ben's stated days; revised 9 Oct evening) / `2 workouts this week` (days a week not set) |
| Pinned lift | `Bench press best set` then `100 kg × 8 (6 Oct) · was 97.5 kg × 8 (29 Sep)`. These are actual results. If the two aren't comparable (different equipment or convention): `Bench press: not comparable with last time (different bar).` |
| Then row | `Then: Pull A · Legs A` (revised 9 Oct evening; was `Next: Pull A · Sat 10 Oct`) · Done today: `Up next: Pull A` |
| No rotation | `No rotation yet` · `Choose a routine` · `Create a routine` · `Set up your rotation` · `Build a workout` |
| Coach suggestions | `1 coach suggestion to review ›` / `2 coach suggestions to review ›` |
| Done today | `✓ Push A done · 54 min` and the link `View summary` |
| Errors | `Couldn't open your training data.` [Try again] [Restore from backup] |
| No-gym banner | `No gym selected. Loads won't be checked against equipment.` [Add gym] |
| Ask pill | `Ask` / `Offline` |
| Builder link | `Build a workout` |

Spoken cue: none on Today. Starting a workout can trigger the optional set intro cue in Active workout.

## 6. Data needed

- `buildTodayView(ownerId, localDate)` is the single view call. It returns: `resume` (session summary, state, rest deadline), `upNext` (revised 9 Oct evening; was `plannedSession`: routine, focus, exercise count, `estimateRemainingDuration` result, and `basis` from `getNextInRotation`, weekly-plan §6), `selectedGym`, `weekCounts` (from `getWeeklyTrainingSummary`: `{done, aim?: {days, source: 'stated'}}`), `pinnedLift` (from `getComparableHistory`, with a comparability flag), `then[]` (the next two routines; was `nextSession`) and `rotationNote?` (one note, from `checkScheduleConflicts` `kind: 'if_today'` or `same_day_order`, or the availability mismatch). It has no AI dependency.
- `getNextInRotation(ownerId, at)` (weekly-plan §6) is the only source of `upNext` and `then[]`, so Today, Plan → Week and the coach always agree.
- `getActiveSession(userId)` runs on cold start for the auto-open decision (P6).
- `startWorkout(routineId?, gymId, operationId)`.
- `setActiveGym(gymId, sessionId?)`.
- ~~`recordReadiness(ownerId, localDate, level, note?)`~~ **withdrawn** (revision 2026-10-09). Check-in calls instead: `shouldAskCheckIn`, `recordCheckIn`, `updateCheckIn`, `setCheckInOutcome`, `startWorkout(…, opts.checkIn)` (check-in.md §6). `buildTodayView` drops `readiness` and adds `unlinkedCheckIn?`.
- `getAiCapabilities(userId)` sets the Ask pill state.
- `finishWorkout(…, endedAt)` for the stale card's Finish (the chosen time goes in the same call).
- `discardWorkout(sessionId, expectedVersion)` for a stale card with nothing logged.
- `buildTodayView` also returns `pendingCoachProposals {sessionId, count}` (unapplied, non-stale, not expired). Local read; no AI call.
- (2026-10-09) `buildTodayView` adds `painChecksDue: [{flagId, exerciseName, area?, setAt, days}]` (from `getPainFlagChecksDue`) and `resume.timeLeft` (the `estimateRemainingDuration` result, active-workout.md §2.15.2). The sheet uses `recordPainFlagReview`, `clearPainFlag` and `getPainReference` (active-workout.md §6).

## 7. Acceptance checks

1. With an unfinished session started 30 min ago, a cold launch opens straight into Active workout. With one 8 h old, Today shows the stale card with `Finish (ended about …)` set to the last set time + 3 min.
2. From Today in the Resume state, exactly one tap (`Resume`) shows the current set or rest. The rest time shown is correct.
3. Only one `PrimaryButton` is visible in every state. The Ask pill never overlaps it at any Dynamic Type size, including AX3.
4. With airplane mode on and no AI connected, Today renders fully. The only AI sign is the `Offline` Ask pill, and there is no error banner.
5. (Revised 2026-10-09.) Today shows no readiness chips. With check-ins on, `Start workout` → `3` → `Tired` → `Done` saves a check-in and opens the workout with the same targets as a skipped check-in (any change only follows a coach offer Ben accepts; check-in.md checks 14–19).
6. Double-tapping `Start workout` creates one session, with or without the check-in sheet in between.
7. The pinned lift line never compares different equipment or load conventions. With no comparable data, it shows the "not comparable" or "pin a lift" text, not a blank chart.
8. All text is at least 16pt by default, and numbers use tabular numerals.
9. In light mode, all tokens switch and contrast meets design-system §2.
10. There are no animations other than standard navigation and sheet transitions.
11. Finishing a stale workout with the end time at 19:24 makes one `finishWorkout` call with `endedAt` 19:24; the summary shows `(end time edited)` and the audit keeps the tap time. No separate `updateSessionTiming` call is made.
12. A stale workout with a work timer left running shows `Stop the timer first` in the finish sheet; after [Stop], Finish succeeds and the timed set is skipped with its elapsed time kept as a draft.
13. A stale workout left **paused** with a work timer running: [Stop] succeeds without resuming, the stopped time ends at the pause start (paused hours never count as work), and Finish then reaches the summary.
14. `Empty workout` opens `Add an exercise to start`, not `All planned sets done`.
15. After a workout with 2 unapplied coach proposals, Today shows `2 coach suggestions to review ›`, which opens that summary's `Next time`. Starting the routine without reviewing them uses the built-in rule's targets, and the line disappears. Today never applies a change itself and makes no AI call.
16. (2026-10-09) Check-ins off or not due today: `Start workout` opens the workout in one tap with no sheet. Due: exactly one extra tap (a score or `Skip`) for scores above the "What's up?" setting.
17. (2026-10-09) Swiping the check-in sheet away returns to Today in the Up next state (was Planned) with no session created.
18. (2026-10-09) With an unlinked check-in < 2 h old, Today shows the region 4 line, and `Start workout` opens the workout without the sheet.
19. (2026-10-09) A pain flag set 14 days ago (no check since) shows the region 4b row; a flag set 13 days ago doesn't. With a workout in progress the row is hidden.
20. (2026-10-09) The row never clears a flag: `Still hurts` keeps it and moves the next check 14 days on; only `Clear flag` in the confirmation clears it, with Undo. No notification is ever scheduled for a check.
21. (2026-10-09) The pain flag check row isn't counted as a banner, never pushes `Start workout` out of the first screen at the default text size, and only one `PrimaryButton` is visible.
22. (2026-10-09) The Resume card's `about N min left` matches the workout's `TimeLeftLine` for the same moment, and always reads "about".
23. (9 Oct evening, D19) Rotation Push A, Pull A, Legs A; last finished workout Pull A on Wed: Today shows `Up next` · `Legs A` · `After Pull A on Wed 14` and `Then: Push A · Pull A`. One tap on `Start workout` (with check-ins off or not due) opens Legs A.
24. (9 Oct evening) Finish Push A via `Other routine` instead: Today then shows `Up next` · `Pull A` · `After Push A on …`. An empty workout or a discarded one leaves Up next unchanged.
25. (9 Oct evening) No date appears for Up next or on the `Then` row, and no screen state says a lifting session was missed. With 2 workouts this week and `Days a week you lift` = 4, `This week` reads `2 of your 4 days done`; with it unset, `2 workouts this week`.
26. (9 Oct evening) There is no `Reschedule` link and no `Rest day` state. The alternatives row reads `Other routine · Empty workout · Build a workout` (+ `Shorter session` once it exists).
27. (9 Oct evening) With a key long run Sat 07:30, Legs A up next, and the time Thu 18:00: the card shows `Heavy legs 37 h before your long run (Sat 07:30). Options ›`, and `Start workout` still works in one tap. At Thu 07:00 (48.5 h before) the note isn't shown. With the endurance switch off, it never shows.
28. (9 Oct evening) At most one rotation note shows on the card, in the order window → same-day hint → availability, and the card still fits `Start workout` on the first screen at the default text size; at AX3 the note wraps above the button and the Ask pill never overlaps it.
29. (9 Oct evening) `Skip workout` from the check-in shows `Not training today. Push A is still next.`; tomorrow Today still offers Push A.
30. (9 Oct evening) Today's Up next and Plan → Week's `▶ Next` always name the same routine and basis (same `getNextInRotation` result), including straight after an Undo of a rotation edit.
