# Today

> **Revision 2026-10-08.** Aligned with [ADR 0003](../decisions/0003-domain-review-decisions.md) S4 and S5: the stale card's Finish passes the chosen end time to `finishWorkout(…, endedAt)` in one call, and is blocked with a Stop prompt if a work timer was left running. `Empty workout` now opens the empty-workout state. Discard of a 0-set workout has no Undo.
>
> **Revision 2026-10-08 (re-review).** Aligned with ADR 0003 "Re-review decisions" S8: the stale card's Stop → Finish path also completes when the workout was left paused (Stop ends the interval at the pause start and doesn't resume) (§3 transitions, §4).
>
> **Revision 2026-10-08 (coach-led progression, v0.4).** Per [ADR 0006](../decisions/0006-coach-led-progression.md): when a finished workout has unapplied, non-stale coach next-time proposals, the `Next:` row shows one extra line `2 coach suggestions to review ›` that opens that workout's summary (§2, §3, §4, §5, check 15). Nothing on Today applies a change. Readiness still never changes targets.

> **Revision 2026-10-08 (workout builder, v0.5).** The alternatives row and the No-plan link row gain a `Build a workout` text link that opens the Build sheet in [workout-builder.md](workout-builder.md). It is never a primary button and is hidden in the Resume state. Today still makes no AI call (§2, §4, §5).

Status: v0.1 draft, 8 Oct 2026. Flow: [flow-first-milestone.md](flow-first-milestone.md). Tokens: [design-system.md](design-system.md).

## 1. Purpose

Today answers **"What am I training now, and where?"**

Its single primary action is **Start workout**, or **Resume** when a workout is unfinished. There is never more than one primary button on screen.

Supporting answers on the screen:
- which gym is selected
- how the week is going (in one line)
- what comes next

Today is the first tab. Detailed charts belong in Progress. Routines and the weekly plan open from here.

## 2. Layout

Regions, top to bottom:

1. **Header (compact).** The date (`Thu 8 Oct`) on the left and the `GymChip` on the right. There's no large title; the space goes to the main card.
2. **Main card.** Either Today's plan + `Start workout`, Resume, the stale-workout card, or No plan. Only one of these shows at a time.
3. **Alternatives row.** Text buttons: `Other routine`, `Empty workout`, `Build a workout` ([workout-builder.md](workout-builder.md)), `Reschedule`, and `Shorter session` (shown only when a plan exists). It is hidden while a workout is in progress.
4. **Readiness (optional).** `How do you feel today?` with chips [Normal] [Tired] [Sore]. It is hidden during and after today's workout.
5. **This week.** `2 of 4 planned sessions done`, plus one pinned lift line. The data is static, with no chart animation.
6. **Next session.** One row, which opens the weekly plan. If the last finished workout has unapplied coach proposals for the next session, a second line `2 coach suggestions to review ›` opens that summary's `Next time` section ([coach-adjustments.md](coach-adjustments.md) §4.6).
7. **Ask pill.** The `TalkButton` pill, floating bottom-trailing above the tab bar. Content has a bottom inset so the pill never covers the Start button.
8. **Tab bar.** Today · Progress · Profile.

### Wireframe: planned session (normal)

```
┌────────────────────────────────────────┐
│ Thu 8 Oct                [⌂ Main Gym ▾]│
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ Today's plan                       │ │
│ │ Push A                             │ │
│ │ Chest · shoulders · triceps        │ │
│ │ 5 exercises · about 55 min         │ │
│ │                                    │ │
│ │ ┌────────────────────────────────┐ │ │
│ │ │          Start workout         │ │ │
│ │ └────────────────────────────────┘ │ │
│ └────────────────────────────────────┘ │
│  Other routine · Empty workout         │
│  Build a workout · Reschedule          │
│  Shorter session                       │
│                                        │
│ How do you feel today?  (optional)     │
│ [ Normal ]  [ Tired ]  [ Sore ]        │
│                                        │
│ This week                              │
│ 2 of 4 planned sessions done           │
│ Bench press best set                   │
│ 100 kg × 8 (6 Oct) · was 97.5 kg × 8   │
│ (29 Sep)                               │
│                                        │
│ Next: Pull A · Sat 10 Oct            › │
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
│ │ 7 of 18 sets done                  │ │
│ │ ⏱ Rest 1:12 left                   │ │
│ │ ┌────────────────────────────────┐ │ │
│ │ │             Resume             │ │ │
│ │ └────────────────────────────────┘ │ │
│ └────────────────────────────────────┘ │
│ Next: Pull A · Sat 10 Oct            › │
└────────────────────────────────────────┘
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

### Wireframe: no plan / first use

```
│ ┌────────────────────────────────────┐ │
│ │ Nothing planned today              │ │
│ │ ┌────────────────────────────────┐ │ │
│ │ │       Start empty workout      │ │ │
│ │ └────────────────────────────────┘ │ │
│ │ Choose a routine · Create a routine│ │
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
| Planned | A scheduled session today, none started | Plan + `Start workout` | All regions |
| Resume | Unfinished session < 6 h old (Ben came back to Today with the chevron) | Resume card with live rest or paused status | Alternatives and readiness hidden |
| Stale unfinished | Unfinished, last activity ≥ 6 h ago | `Finish (ended about hh:mm)` primary, `Resume instead` link. With nothing logged: `Discard (nothing logged)` primary instead | Alternatives hidden |
| Done today | A session finished today and no other is planned | `✓ Push A done · 54 min` + `View summary` link. The primary becomes `Start another workout` as a secondary button. **No primary button** | Readiness hidden |
| No plan | No scheduled session | `Start empty workout` primary, routine links | This week shows text, not an empty chart |
| Rest day | The plan marks today as rest | `Rest day in your plan` + secondary `Start a workout anyway` | Next session prominent |
| No gym | No gym profile exists | Normal card. The gym chip reads `Add gym`. The start button stays enabled | Banner: `No gym selected. Loads won't be checked against equipment.` [Add gym] |
| Sparse data | < 2 weeks of history | Normal | This week: `1 workout logged this week.` The pinned lift line is replaced by `Pin a lift in Progress to see it here.` |
| Database error | SQLite open or read failed | `Couldn't open your training data.` [Try again], plus a link `Restore from backup` | Hidden |
| AI unavailable | `getAiCapabilities` reports no text route | No change to the main card | The Ask pill shows `Offline` with the slashed icon |
| Offline | No network | No change. Today needs no network | No banner (nothing here needs it). The Ask pill shows `Offline` if the coach needs the network |
| Coach suggestions waiting | The last finished workout has unapplied, non-stale coach next-time proposals, and their routine hasn't started again | No change | `Next:` row gains `2 coach suggestions to review ›`. It disappears once each is applied, set to Not now, or expired (the routine started). Starting the routine without reviewing uses the built-in rule's targets |

Transitions:
- Planned → Start → Active workout (pushed full-screen).
- Active workout → chevron-down (minimise) → Today in the Resume state.
- Resume → Resume → Active workout.
- Stale → Finish → finish sheet with the end time prefilled → Summary. With a work timer left running or paused (even in a paused workout): finish sheet → [Stop] → Finish → Summary.
- Finished → Done → Today (Done today).

## 4. Interactions

| Element | Tap | Other |
|---|---|---|
| `Start workout` | `startWorkout(routineId, gymId, opId)`, then open Active workout. Disabled for 1 s after the tap so it can't double-start. The opId stops a second session being created | none |
| `Resume` | Opens Active workout in the persisted state | none |
| `Finish (ended about 19:24)` | Opens the finish sheet (see active-workout.md §4.8) with the end time prefilled as the last set time + 3 min. Ben can edit it between the last set and now. `Finish` calls `finishWorkout(sessionId, expectedVersion, endedAt)` once; the tap time is kept in the timing audit. If a work timer was left running or paused, the sheet shows `Stop the timer first` with [Stop] (the elapsed time is kept as that set's draft), then the normal Finish. This works even when the stale workout is paused: Stop ends the interval at the moment the pause began, leaves the workout paused, and Finish completes without a Resume. After Stop, the sheet's primary button is `Finish`; Resume stays available as a secondary action, never the primary one. Stale cards with 0 logged sets show `Discard (nothing logged)` instead of Finish | none |
| Gym chip | Opens the gym switcher sheet: a list of gyms with a check on the selected one, plus `Add gym` and `Edit gyms` (→ Profile). Choosing a gym before starting just selects it. During an unfinished session, it calls `setActiveGym(gymId, sessionId)`, which returns a proposal shown as a `ChangeReviewCard` in Active workout | none |
| Readiness chip | Writes `recordReadiness(level)` immediately. The chip shows a selected state (check icon plus the `accent.subtle` fill). `Sore` reveals an optional one-line `Where? (optional)` field. Tapping the selected chip again clears the entry | Doesn't change targets (P11) |
| Pinned lift line | Opens that exercise's history in Progress | none |
| `Next: …` row | Opens the weekly plan | none |
| `… coach suggestions to review ›` | Opens the summary of the workout they came from, scrolled to `Next time`. Apply/Undo happen there | none |
| `Build a workout` | Opens the workout builder's Build sheet (workout-builder.md §3.1), or its offline frame (§3.7) when `getAiCapabilities` reports no text route. Nothing starts without a later tap on `Start now` | none |
| `Reschedule` | Opens the weekly plan with today's session selected (move / skip / replace) | Out of milestone scope. The link exists but may route to a placeholder labelled `Coming soon` |
| `Shorter session` | Out of milestone scope. Hide it until `shortenSession` exists | none |
| Ask pill | Opens the coach sheet with Today's context attached. Long-press starts push-to-talk if voice is available | none |

Voice equivalents (when voice is available): "Start my workout" maps to the Start action through the coach tool path. It needs no confirmation because it is reversible: an empty session can be discarded.

Undo:
- Starting by mistake: in Active workout, the menu offers `Discard workout`. With 0 sets logged, it discards at once with the toast `Workout discarded` (no Undo; nothing was logged, so Ben just starts again).
- `Empty workout` / `Start empty workout` call `startWorkout(null, gymId, opId)` and open Active workout in the empty state (`Add an exercise to start`, active-workout §2.10).
- A readiness tap is undone by tapping the chip again.

## 5. Copy

| Element | Text |
|---|---|
| Date header | `Thu 8 Oct` (locale short weekday, day, month) |
| Plan card eyebrow | `Today's plan` |
| Duration | `about 55 min` (from `estimateRemainingDuration`, so always "about") |
| Primary | `Start workout` / `Resume` / `Start empty workout` / `Finish (ended about 19:24)` / `Discard (nothing logged)` |
| Resume eyebrow | `In progress · started 18:02` |
| Resume lines | `Now: Bench press · set 3 of 4`, `7 of 18 sets done`, then one of `Rest 1:12 left` / `Ready for next set` / `Paused` |
| Stale eyebrow | `Unfinished workout · Wed 7 Oct` |
| Stale lines | `Last set logged at 19:21`, link `Resume instead`. With a work timer left running: extra line `Dead hang timer still running` |
| Stale, nothing logged | `Nothing logged` and primary `Discard (nothing logged)`, link `Resume instead` |
| Readiness prompt | `How do you feel today?` with `(optional)` in secondary text |
| Readiness chips | `Normal`, `Tired`, `Sore` |
| Readiness confirmation (inline, 3 s) | `Saved. Targets don't change automatically.` |
| This week | `2 of 4 planned sessions done` / `3 workouts this week` (no plan) |
| Pinned lift | `Bench press best set` then `100 kg × 8 (6 Oct) · was 97.5 kg × 8 (29 Sep)`. These are actual results. If the two aren't comparable (different equipment or convention): `Bench press: not comparable with last time (different bar).` |
| Next session | `Next: Pull A · Sat 10 Oct` |
| Coach suggestions | `1 coach suggestion to review ›` / `2 coach suggestions to review ›` |
| Done today | `✓ Push A done · 54 min` and the link `View summary` |
| Errors | `Couldn't open your training data.` [Try again] [Restore from backup] |
| No-gym banner | `No gym selected. Loads won't be checked against equipment.` [Add gym] |
| Ask pill | `Ask` / `Offline` |
| Builder link | `Build a workout` |

Spoken cue: none on Today. Starting a workout can trigger the optional set intro cue in Active workout.

## 6. Data needed

- `buildTodayView(ownerId, localDate)` is the single view call. It returns: `resume` (session summary, state, rest deadline), `plannedSession` (routine, focus, exercise count, `estimateRemainingDuration` result), `selectedGym`, `weekCounts` (from `getWeeklyTrainingSummary`), `pinnedLift` (from `getComparableHistory`, with a comparability flag) and `nextSession`. It has no AI dependency.
- `getActiveSession(userId)` runs on cold start for the auto-open decision (P6).
- `startWorkout(routineId?, gymId, operationId)`.
- `setActiveGym(gymId, sessionId?)`.
- `recordReadiness(ownerId, localDate, level, note?)` is a **proposed new function**.
- `getAiCapabilities(userId)` sets the Ask pill state.
- `finishWorkout(…, endedAt)` for the stale card's Finish (the chosen time goes in the same call).
- `discardWorkout(sessionId, expectedVersion)` for a stale card with nothing logged.
- `buildTodayView` also returns `pendingCoachProposals {sessionId, count}` (unapplied, non-stale, not expired). Local read; no AI call.

## 7. Acceptance checks

1. With an unfinished session started 30 min ago, a cold launch opens straight into Active workout. With one 8 h old, Today shows the stale card with `Finish (ended about …)` set to the last set time + 3 min.
2. From Today in the Resume state, exactly one tap (`Resume`) shows the current set or rest. The rest time shown is correct.
3. Only one `PrimaryButton` is visible in every state. The Ask pill never overlaps it at any Dynamic Type size, including AX3.
4. With airplane mode on and no AI connected, Today renders fully. The only AI sign is the `Offline` Ask pill, and there is no error banner.
5. Selecting `Tired` saves a readiness entry and the confirmation says targets don't change. Starting the workout shows the same targets as without it.
6. Double-tapping `Start workout` creates one session.
7. The pinned lift line never compares different equipment or load conventions. With no comparable data, it shows the "not comparable" or "pin a lift" text, not a blank chart.
8. All text is at least 16pt by default, and numbers use tabular numerals.
9. In light mode, all tokens switch and contrast meets design-system §2.
10. There are no animations other than standard navigation and sheet transitions.
11. Finishing a stale workout with the end time at 19:24 makes one `finishWorkout` call with `endedAt` 19:24; the summary shows `(end time edited)` and the audit keeps the tap time. No separate `updateSessionTiming` call is made.
12. A stale workout with a work timer left running shows `Stop the timer first` in the finish sheet; after [Stop], Finish succeeds and the timed set is skipped with its elapsed time kept as a draft.
13. A stale workout left **paused** with a work timer running: [Stop] succeeds without resuming, the stopped time ends at the pause start (paused hours never count as work), and Finish then reaches the summary.
14. `Empty workout` opens `Add an exercise to start`, not `All planned sets done`.
15. After a workout with 2 unapplied coach proposals, Today shows `2 coach suggestions to review ›`, which opens that summary's `Next time`. Starting the routine without reviewing them uses the built-in rule's targets, and the line disappears. Today never applies a change itself and makes no AI call.
