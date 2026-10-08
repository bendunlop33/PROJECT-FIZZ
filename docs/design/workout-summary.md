# Workout summary

> **Revision 2026-10-08.** Aligned with [ADR 0003](../decisions/0003-domain-review-decisions.md): `Next time` also lists exercises held because not every prescribed working set was done, with the domain's reason (S3); end time comes from `finishWorkout(…, endedAt?)`, later edits from `updateSessionTiming(sessionId, expectedVersion, …)` (S5). Deleted sets are excluded; unilateral exercises show per-side totals.
>
> **Revision 2026-10-08 (re-review).** Aligned with ADR 0003 "Re-review decisions": `Next time` also lists holds that name a lagging side (R4) and `no_feasible_load` with `Fix the equipment profile` guidance, never "bodyweight" (R3). Active time subtracts only paused time inside the final start–end window (S9; §3, §5, §6, check 4).

Status: v0.1 draft, 8 Oct 2026. Flow: [flow-first-milestone.md](flow-first-milestone.md). Tokens: [design-system.md](design-system.md).

## 1. Purpose

The summary answers **"Is my workout saved, and how did it go compared with last time?"**

The save has already happened before this screen appears. The summary shows facts first; interpretation comes second and is optional.

Its single primary action is **`Done`**, which returns to Today. `Edit workout` is secondary.

## 2. Layout

The summary replaces the Active workout screen after `finishWorkout` commits. It has no back navigation into the finished workout; corrections go through Edit.

Regions, top to bottom:

1. **Saved banner.** `✓ Workout saved on this phone`, on the `status.done.subtle` background with the done icon. This is shown only after the local commit.
2. **Title block.** The workout name and date, then the gym and the time range.
3. **Facts.** These are label–value rows:
   - Active time
   - Exercises
   - Working sets (with the skipped count)
   - Warm-up sets, shown separately
4. **Comparison.** One comparable lift: today vs the last comparable session, plus a line explaining why they count as comparable.
5. **Exercises.** One compact row per exercise: the name, the set count, and the actual results for the working sets.
6. **Next time.** The deterministic next-session targets that changed, with the rule named. This section is proposal P8.
7. **Coach note (optional, loads later).** One observation, and optionally one `ChangeReviewCard` with scope `Future sessions`.
8. **Footer bar (fixed).** [Edit workout] (secondary) and [Done] (primary). `Share / export` sits in the overflow `⋯` in the title row.

```
┌────────────────────────────────────────┐
│ ✓ Workout saved on this phone          │ saved banner
├────────────────────────────────────────┤
│ Push A                             ⋯   │
│ Thu 8 Oct · Main Gym · 18:02–19:04     │
│                                        │
│ Active time            54 min          │
│ Exercises              5 of 5          │
│ Working sets           16 (2 skipped)  │
│ Warm-up sets           4               │
│                                        │
│ Compared with last time                │
│ Bench press · top set                  │
│ Today       102.5 kg × 6               │
│ 1 Oct       100 kg × 8                 │
│ Same barbell at Main Gym, working sets │
│                                        │
│ Exercises                              │
│ Bench press      4 sets                │
│   102.5×6 · 100×8 · 100×7 · 100×7      │
│ Incline DB press 3 sets (kg each)      │
│   30×10 · 30×10 · 30×10                │
│ …                                      │
│                                        │
│ Next time                              │
│ Incline DB press                       │
│ Target 32.5 kg each × 8–10             │
│ You did 10 reps on every set at 30 kg. │
│ Rule: double progression · Why? ›      │
│ Triceps pushdown                       │
│ Same target: 35 kg stack × 10–12       │
│ Only 1 of 3 working sets was logged on │
│ 8 Oct; holding.                        │
│ Rule: double progression · Why? ›      │
│                                        │
│ Coach note                             │
│ Coach not connected. Your workout is   │
│ saved; a note can be added later.      │
├────────────────────────────────────────┤
│ [ Edit workout ]  [      Done        ] │
└────────────────────────────────────────┘
```
The reason and rule text come from `calculateNextTargets`. The UI never writes its own explanation. An exercise appears under Next time when the rule changed its target, **or** when it held because the session was incomplete, **or** when it held because one side lagged (unilateral), **or** when no feasible load exists on the equipment (`no_feasible_load`). Progression needs every prescribed working set completed at or above the top of the rep range within the effort limits (ADR 0003 S3, Ben may revise); a top-set rule needs at least one top set. A hold for any other reason (reps not yet at the top) isn't listed, to keep the section short.

## 3. States

| State | Trigger | Display |
|---|---|---|
| Saving | `finishWorkout` in progress (normally < 200 ms) | The Finish sheet shows `Saving…`. The summary isn't shown until the commit |
| Save failed | The SQLite write failed | Stay on Active workout with the banner `Couldn't finish the workout. Nothing was lost; try again.` [Try again]. **Never show a summary that isn't saved** |
| Normal | Commit OK | As in the wireframe |
| No comparison available | No compatible previous session | `First time logging Bench press with this barbell at Main Gym. Nothing to compare yet.` |
| Not comparable | History exists but with different equipment, convention or set type | `Last bench press was at Hotel Gym (different bar). Not compared.` |
| Short or empty workout | 0 working sets | Facts only. The comparison and next-time sections are hidden. The footer adds `Discard workout` as a danger text link (confirmation required) |
| Skipped sets | Pending sets at finish | `Working sets 16 (2 skipped)`. Skipped sets appear in the exercise rows as `skipped` text |
| Timing corrected | The end time chosen in the finish sheet differs from the tap time (`finishWorkout` `endedAt`), or a time was edited later with `updateSessionTiming` | The title line reads `18:02–19:24 (end time edited)` or `(start time edited)`. The timing audit keeps the original values. Active time is recomputed: only paused time inside the new start–end window is subtracted (a pause after the corrected end isn't) |
| Next time: no change | The rules keep the same targets | `No target changes. Same targets next time.` |
| Next time: held, incomplete | Fewer completed working sets than the rule prescribes | `Bench press` · `Same target: 100 kg × 6–8` · domain fact, e.g. `Only 2 of 4 working sets were logged on 8 Oct; holding.` |
| Next time: held, all skipped | Every working set of an exercise was skipped | `No working sets were logged on 8 Oct (all skipped); holding.` The target stays at the last performed load |
| Next time: held, side lagging | Unilateral exercise where one side met the rule and the other didn't, or the sides have unequal set counts | `Single-arm cable row` · `Same target: 25 kg stack × 8–10` · domain fact, e.g. `The left side reached 8+ reps on every set but the right side didn't (lowest 7 reps); holding.` or `Only 2 of 3 working sets had both sides logged on 8 Oct (left 3, right 2: the right side is behind); holding.` |
| Next time: no feasible load | `calculateNextTargets` returns `no_feasible_load` | `Lat pulldown` · `No load target` · `Cable stack can't make any load with its current min/max settings, so no Lat pulldown target is set. Fix the equipment profile.` [Update gym]. Never shown as "bodyweight" |
| Unilateral exercise | `laterality` is unilateral | Row reads `Single-arm cable row 3 sets (per side)` and, when sides differ, `L 28 reps · R 26 reps`. A Left + Right pair counts as one set (`summariseVolume`) |
| Deleted sets | Sets deleted during the workout | Not shown and not counted. Visible only in the edit history |
| Next time: at equipment max | The rule hits the equipment maximum | `Dumbbells max out at 30 kg each at Main Gym. Next time: aim for more reps at 30 kg.` (from the domain, not invented) |
| Pain reported during session | A pain note was logged for a movement | `Progression paused for Overhead press because you noted pain. Targets stay the same until you clear it.` [Review] (rule 9). No diagnosis |
| Coach: not connected | No AI route | `Coach not connected. Your workout is saved; a note can be added later.` |
| Coach: offline | The route exists but there's no network | `Coach note will be added when you're back online.` (it retries when the app is next opened with a connection, never in a background loop) |
| Coach: loading | Request in flight | `Coach note: writing…` (static icon, no spinner animation beyond the system activity indicator). **Done stays enabled** |
| Coach: ready | Note received | 2–3 sentences, plus an optional `ChangeReviewCard` (scope `Future sessions`) |
| Coach: failed | Error or quota | `Couldn't get a coach note (limit reached).` [Try again]. It never falls back to a paid route |
| Proposal applied | Apply tapped | The card collapses to `✓ Applied to future Push A sessions` [Undo] |
| Proposal stale | The template changed since the proposal was made | `Out of date` styling, Apply disabled |

Transitions:
- Finish commit → Normal.
- Done → Today, with the main card in the `Done today` state.
- Edit workout → the edit screen. Saving there returns to the summary, recomputed.

## 4. Interactions

| Element | Action |
|---|---|
| `Done` | Returns to Today. Leaving doesn't cancel the coach note: if it's still loading, it attaches to the session and appears in history when ready |
| `Edit workout` | Opens the session in edit mode (Overview table layout). Ben can correct values, set types, add a forgotten set or change start and end times. Every change calls `correctSet` / `updateSessionTiming(sessionId, expectedVersion, {startedAt?, endedAt?})` with an audit, and the original timestamps are kept. Time pickers allow only times that keep every logged set inside the workout and nothing in the future. A skipped timed set that kept a stopped time shows it as `Not logged: 0:38` with a `Log it` action (a correction). Editing doesn't regenerate the plan with AI. Next-time targets are recomputed deterministically |
| Comparison block | Opens the exercise history in Progress, filtered to the same equipment |
| Exercise row | Opens that exercise's sets read-only, with an `Edit` button |
| `Next time` row | `Why?` expands the rule explanation (the `calculateNextTargets` explanation string) |
| Coach `ChangeReviewCard` | Apply calls `confirmProposal` → `applyCoachProposal` (scope `future_template`). Undo calls `undoAction` |
| `⋯` → `Share / export` | Plain-text or CSV export of this session through the iOS share sheet. This is secondary |
| Voice | Nothing is read aloud except the `Workout saved. Your summary is ready.` cue (Set cues mode). In Conversation mode, Ben may ask "how did that compare?". The coach answers from the same facts |

Undo:
- Finishing by accident: the summary's `⋯` menu has `Reopen workout`. It is available for 30 min after finishing and returns the session to Ready on its first skipped set, with an audit.
- Corrections: the edit screen's toast [Undo].
- Applied proposals: [Undo].

## 5. Copy

| Element | Text |
|---|---|
| Saved banner | `Workout saved on this phone` |
| Title line | `Thu 8 Oct · Main Gym · 18:02–19:04` |
| Facts labels | `Active time`, `Exercises`, `Working sets`, `Warm-up sets` |
| Fact values | `54 min`, `5 of 5`, `16 (2 skipped)`, `4` |
| Comparison heading | `Compared with last time` |
| Comparison rows | `Today 102.5 kg × 6` / `1 Oct 100 kg × 8`. Both are **actual results** |
| Comparability line | `Same barbell at Main Gym, working sets` |
| Estimates (if shown) | `Estimated 1RM 123 kg (estimate, Epley formula)`. This is optional and off by default. If it appears, it always says "estimate" |
| Not comparable | `Last bench press was at Hotel Gym (different bar). Not compared.` |
| First time | `First time logging Bench press with this barbell at Main Gym. Nothing to compare yet.` |
| Next time heading | `Next time` |
| Next time row | `Incline DB press: target 32.5 kg each × 8–10` (a **target**) + reason `You did 10 reps on every set at 30 kg.` + `Rule: double progression` |
| No change | `Same targets next time.` |
| Held (side lagging) | `Same target: 25 kg stack × 8–10` (a **target**) + the domain's fact naming the lagging side, e.g. `… but the right side didn't (lowest 7 reps); holding.` |
| No feasible load | `No load target` + the domain's summary ending `Fix the equipment profile.` + [Update gym]. A null load reads "bodyweight" only for the `bodyweight` convention (or `added` with nothing added); otherwise "no load" |
| Time-edit helper (under the start/end pickers in Edit workout) | `Active time counts from start to end, minus pauses inside that window.` |
| Held (incomplete) | `Same target: 100 kg × 6–8` (a **target**) + the domain's fact, e.g. `Only 2 of 4 working sets were logged on 8 Oct; holding.` |
| Coach heading | `Coach note` |
| Coach states | see §3 |
| Footer | `Edit workout`, `Done` |
| Spoken (Set cues) | "Workout saved. Your summary is ready." |

The summary makes **no personal-best claims** unless the domain confirms that the lift is comparable: same exercise, equipment instance (or a group Ben defined), load convention, unit and set type. When it qualifies, the text is factual: `Heaviest bench press top set at Main Gym so far.` There are no badges, confetti or scores.

## 6. Data needed

- `finishWorkout(sessionId, expectedVersion, endedAt?)`, which commits before navigation, and `updateSessionTiming(sessionId, expectedVersion, {startedAt?, endedAt?})` (end time only after Finish) for later edits.
- `summariseVolume` (inside the summary build) for per-exercise working sets and reps, with per-side tallies for unilateral exercises.
- `buildWorkoutSummary(sessionId)`, which works locally. It returns:
  - facts (active duration excluding pauses, exercise count, working and warm-up sets counted separately, skipped count). Duration = end − start − paused time inside that window. Pauses outside a corrected start or end are not subtracted; a pause that straddles the start or end counts only for its part inside. Computed by the domain from the stored pause intervals (`session.pauses`), never by the UI
  - `comparison` (chosen lift, today and last, a comparability explanation or a `not_comparable` reason)
  - exercise rows
  - `timingEdited`
- `getComparableHistory(exerciseId, equipmentId, filters)` is used inside the summary build.
- `calculateNextTargets(history, rule, equipment)` returns the changed targets and an explanation for each, with equipment bounds applied.
- `correctSet` for edits (timing as above).
- Optional layers:
  - `getAiCapabilities`
  - `runCoachTurn` with the summary context, attached later
  - `validateCoachProposal`, `confirmProposal`, `applyCoachProposal`, `undoAction`, `getDecisionEvidence`
- Comparison lift selection, which is deterministic and done inside `buildWorkoutSummary`:
  1. Ben's pinned lift, if it was trained today.
  2. Otherwise, the first working exercise in routine order that has comparable history.
  3. Otherwise, none.

## 7. Acceptance checks

1. The summary appears only after the local commit. If the write is made to fail (a test hook), the summary doesn't appear and nothing is lost.
2. With airplane mode on and no AI, the summary renders in full, with an honest coach state, and `Done` works at once.
3. Warm-up sets are counted separately and are never included in `Working sets`.
4. Active time excludes paused time. It matches the start-to-end time minus the paused time inside that window, to within 1 min. Probe: last set at 60 min, Pause at 61, Finish hours later with the end edited to 63 → `61 min` (not 63, and not reduced by the hours of pause after 63).
5. The comparison never pairs different equipment instances, conventions (e.g. per-dumbbell vs total) or units. Test with a hotel-gym session in history.
6. Any estimated 1RM text contains the word "estimate". No PR or "best" claim appears for non-comparable lifts.
7. `Next time` values come from `calculateNextTargets`. They match the domain unit tests, are labelled as targets, and never exceed equipment maximums.
8. Pressing `Done` while the coach note is loading returns to Today without an error. The note appears later in the session history.
9. A proposed future change shows scope `Future sessions`, before and after values, Apply and Undo, and it never edits completed sets.
10. Editing the end time keeps the original timestamp in the audit, and the summary shows `(end time edited)`.
11. Only `Done` is styled as primary. There are no animated elements.
12. Finish a workout with 2 of 4 prescribed bench working sets done, both at the top of the range. `Next time` shows `Same target` with the domain's "Only 2 of 4…; holding." fact, never an increase.
13. Deleted sets never appear in the exercise rows or counts. A unilateral Left + Right pair counts as one working set.
14. A unilateral exercise where the right side fell short shows `Same target` under `Next time` with the domain's fact naming the right side, never an increase.
15. An exercise whose equipment can make no load shows `No load target` with `Fix the equipment profile.` and [Update gym] under `Next time`, never "bodyweight".
