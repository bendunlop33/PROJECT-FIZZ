# Workout summary

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
│                                        │
│ Coach note                             │
│ Coach not connected. Your workout is   │
│ saved; a note can be added later.      │
├────────────────────────────────────────┤
│ [ Edit workout ]  [      Done        ] │
└────────────────────────────────────────┘
```
The reason and rule text come from `calculateNextTargets`. The UI never writes its own explanation. An exercise appears under Next time only when the rule changed its target.

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
| Timing corrected | The end time was changed in the finish sheet | The title line reads `18:02–19:24 (end time edited)` |
| Next time: no change | The rules keep the same targets | `No target changes. Same targets next time.` |
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
| `Edit workout` | Opens the session in edit mode (Overview table layout). Ben can correct values, set types, add a forgotten set or change start and end times. Every change calls `correctSet` / `updateSessionTiming` with an audit, and the original timestamps are kept. Editing doesn't regenerate the plan with AI. Next-time targets are recomputed deterministically |
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
| Coach heading | `Coach note` |
| Coach states | see §3 |
| Footer | `Edit workout`, `Done` |
| Spoken (Set cues) | "Workout saved. Your summary is ready." |

The summary makes **no personal-best claims** unless the domain confirms that the lift is comparable: same exercise, equipment instance (or a group Ben defined), load convention, unit and set type. When it qualifies, the text is factual: `Heaviest bench press top set at Main Gym so far.` There are no badges, confetti or scores.

## 6. Data needed

- `finishWorkout(sessionId, expectedVersion)`, which commits before navigation.
- `buildWorkoutSummary(sessionId)`, which works locally. It returns:
  - facts (active duration excluding pauses, exercise count, working and warm-up sets counted separately, skipped count)
  - `comparison` (chosen lift, today and last, a comparability explanation or a `not_comparable` reason)
  - exercise rows
  - `timingEdited`
- `getComparableHistory(exerciseId, equipmentId, filters)` is used inside the summary build.
- `calculateNextTargets(history, rule, equipment)` returns the changed targets and an explanation for each, with equipment bounds applied.
- `updateSessionTiming(sessionId, correction)` and `correctSet` for edits.
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
4. Active time excludes paused time. It matches the start-to-end time minus pauses, to within 1 min.
5. The comparison never pairs different equipment instances, conventions (e.g. per-dumbbell vs total) or units. Test with a hotel-gym session in history.
6. Any estimated 1RM text contains the word "estimate". No PR or "best" claim appears for non-comparable lifts.
7. `Next time` values come from `calculateNextTargets`. They match the domain unit tests, are labelled as targets, and never exceed equipment maximums.
8. Pressing `Done` while the coach note is loading returns to Today without an error. The note appears later in the session history.
9. A proposed future change shows scope `Future sessions`, before and after values, Apply and Undo, and it never edits completed sets.
10. Editing the end time keeps the original timestamp in the audit, and the summary shows `(end time edited)`.
11. Only `Done` is styled as primary. There are no animated elements.
