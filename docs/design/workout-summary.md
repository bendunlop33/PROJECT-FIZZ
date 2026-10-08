# Workout summary

> **Revision 2026-10-08.** Aligned with [ADR 0003](../decisions/0003-domain-review-decisions.md): `Next time` also lists exercises held because not every prescribed working set was done, with the domain's reason (S3); end time comes from `finishWorkout(…, endedAt?)`, later edits from `updateSessionTiming(sessionId, expectedVersion, …)` (S5). Deleted sets are excluded; unilateral exercises show per-side totals.
>
> **Revision 2026-10-08 (re-review).** Aligned with ADR 0003 "Re-review decisions": `Next time` also lists holds that name a lagging side (R4) and `no_feasible_load` with `Fix the equipment profile` guidance, never "bodyweight" (R3). Active time subtracts only paused time inside the final start–end window (S9; §3, §5, §6, check 4).
>
> **Revision 2026-10-08 (coach-led progression, v0.4).** Aligned with [ADR 0006](../decisions/0006-coach-led-progression.md). `Next time` now has a named **source** on every row. With the coach available, each changed exercise shows the coach's proposal as before (built-in rule) → after (coach), with its reason, guard notes, `Why?`, `Not now`, `Apply` and Undo, source `Coach`. Without it, rows show the built-in rule's targets labelled `Built-in rule (coach offline)` / `(coach unavailable)`. One coach call per workout produces both the note and the proposals. Exercise rows mention in-workout coach adjustments. Behaviour shared with the workout screen is in [coach-adjustments.md](coach-adjustments.md). Changed: §1, §2 (regions 5–7, wireframes), §3, §4, §5, §6, checks 7, 9 and 16–22. This supersedes proposal P8's "rule named" wording (flow §7).

Status: v0.1 draft, 8 Oct 2026. Flow: [flow-first-milestone.md](flow-first-milestone.md). Tokens: [design-system.md](design-system.md).

## 1. Purpose

The summary answers **"Is my workout saved, and how did it go compared with last time?"**

The save has already happened before this screen appears. The summary shows facts first; interpretation comes second and is optional. It also answers **"What will I lift next time, and who decided?"**: every next-time target names its source (`Coach` or `Built-in rule`).

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
5. **Exercises.** One compact row per exercise: the name, the set count, and the actual results for the working sets. If the coach adjusted that exercise's sets during the workout, one extra line says so: `Coach adjusted sets 3–4 (RPE 10 on set 2)`.
6. **Next time.** One row per exercise whose next target changes or is held for a listed reason. Each row names its source:
   - **Coach available and answered:** a proposal (`CoachTargetProposal`): before = the built-in rule's target (what happens if Ben does nothing), after = the coach's target, the coach's one-sentence reason, any guard notes, `Why? ›`, [Not now] [Apply]. Source tag `Coach`.
   - **Coach agrees with the rule:** `Coach agrees: 100 kg × 6–8`, no buttons.
   - **Coach offline, not connected or failed:** the built-in rule's target with `Built-in rule (coach offline)` or `Built-in rule (coach unavailable)`, and the rule's own explanation.
   - **Coach still working:** the built-in rule's target labelled `Built-in rule` and the line `Coach is reviewing…`.
   - With two or more coach proposals, a secondary text button `Apply all coach targets` sits under the heading.
7. **Coach note (optional, loads later).** One observation. It comes from the same single coach call as the proposals.
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
│ Built-in rule (coach offline)          │ source tag
│ Rule: double progression · Why? ›      │
│ Triceps pushdown                       │
│ Same target: 35 kg stack × 10–12       │
│ Only 1 of 3 working sets was logged on │
│ 8 Oct; holding.                        │
│ Built-in rule (coach offline)          │
│ Rule: double progression · Why? ›      │
│                                        │
│ Coach note                             │
│ Coach not connected. Your workout is   │
│ saved; a note can be added later.      │
├────────────────────────────────────────┤
│ [ Edit workout ]  [      Done        ] │
└────────────────────────────────────────┘
```

**Wireframe: Next time with the coach available**

```
│ Next time            Apply all coach   │ secondary text button (2+ proposals)
│                      targets           │
│ Bench press                  [Coach]   │ TargetSourceTag
│ From next Push A                       │ scope
│ Built-in rule   100 kg × 6–8           │ before (target)
│ Coach           97.5 kg × 6–8          │ after (target)
│ Set 2 hit RPE 10 and sets 3–4 fell     │ coach reason (one sentence)
│ short; hold a little lighter.          │
│ Rounded to 97.5 kg: nearest your bar   │ guard note (deterministic)
│ and plates allow.                      │
│ Why? ›          [ Not now ] [ Apply ]  │
│                                        │
│ Overhead press               [Coach]   │
│ Not increasing: you flagged shoulder   │ pain block, no Apply
│ pain. Same target: 50 kg × 6–8         │
│                                        │
│ Incline DB press                       │
│ Coach agrees: 32.5 kg each × 8–10      │ no buttons
│                                        │
│ Coach note                             │
│ Bench moved well until set 2; the      │
│ rest of the session was on target.     │
```
Built-in rule text comes from `calculateNextTargets`. Coach reasons come from the coach's stored proposal; guard notes come from `validateCoachProposal`. The UI never writes its own explanation. An exercise appears under Next time when the rule changed its target, **or** when it held because the session was incomplete, **or** when it held because one side lagged (unilateral), **or** when no feasible load exists on the equipment (`no_feasible_load`). Progression needs every prescribed working set completed at or above the top of the rep range within the effort limits (ADR 0003 S3, Ben may revise); a top-set rule needs at least one top set. A hold for any other reason (reps not yet at the top) isn't listed, to keep the section short. **With the coach available, an exercise is also listed when the coach proposes a target different from the built-in rule's.** Rows where the coach agrees with a listed rule change show `Coach agrees: …`.

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
| Next time: held, side lagging | Unilateral exercise where one side met the rule and the other didn't, or the sides have unequal set counts | `Single-arm cable row` · `Same target: 25 kg stack × 8–10` · domain fact, e.g. `The left side reached 8+ reps on every set within the effort limit, but the right side didn't (lowest 7 reps); holding.` or `Only 2 of 3 working sets had both sides logged on 8 Oct (left 3, right 2: the right side is behind); holding.` |
| Next time: no feasible load | `calculateNextTargets` returns `no_feasible_load` | `Lat pulldown` · `No load target` · `Cable stack can't make any load with its current min/max settings, so no Lat pulldown target is set. Fix the equipment profile.` [Update gym]. Never shown as "bodyweight" |
| Unilateral exercise | `laterality` is unilateral | Row reads `Single-arm cable row 3 sets (per side)` and, when sides differ, `L 28 reps · R 26 reps`. A Left + Right pair counts as one set (`summariseVolume`) |
| Deleted sets | Sets deleted during the workout | Not shown and not counted. Visible only in the edit history |
| Next time: at equipment max | The rule hits the equipment maximum | `Dumbbells max out at 30 kg each at Main Gym. Next time: aim for more reps at 30 kg.` (from the domain, not invented) |
| Pain reported during session | A pain note was logged for a movement | `Progression paused for Overhead press because you noted pain. Targets stay the same until you clear it.` [Review] (rule 9). No diagnosis |
| Coach: not connected | No AI route | Note: `Coach not connected. Your workout is saved; a note can be added later.` Next time rows: built-in rule targets tagged `Built-in rule (coach offline)` |
| Coach: offline | The route exists but there's no network | Note: `Coach note will be added when you're back online.` (it retries when the app is next opened with a connection, never in a background loop). Rows tagged `Built-in rule (coach offline)`. When the coach answers later, its proposals appear in this session's summary in history and Today shows the review hint |
| Coach: loading | Request in flight | Note: `Coach note: writing…` (static icon, no spinner animation beyond the system activity indicator). Rows show the built-in rule target tagged `Built-in rule` plus `Coach is reviewing…`. **Done stays enabled** |
| Coach: ready | Note and proposals received | 2–3 sentence note. Rows with a different coach target show the `CoachTargetProposal` (before built-in rule → after coach, reason, guard notes, `Why?`, Not now, Apply), tag `Coach` |
| Coach: agrees | Coach target equals the built-in rule target | `Coach agrees: 100 kg × 6–8`. No buttons |
| Coach: guard applied | `validateCoachProposal` snapped or capped the coach's load | Guard note under the reason, e.g. `Rounded to 97.5 kg: nearest your bar and plates allow.` / `Capped at 30 kg each: the most Main Gym's rack goes to.` |
| Coach: pain-blocked | The coach proposed an increase on a pain-flagged movement | `Not increasing: you flagged shoulder pain. Same target: 50 kg × 6–8`. No Apply. The built-in rule also holds (`halted_pain`) |
| Coach: failed | Error or quota | Note: `Couldn't get a coach note (limit reached).` [Try again]. Rows tagged `Built-in rule (coach unavailable)`. It never falls back to a paid route |
| Proposal applied | Apply tapped | The row collapses to `✓ Coach target applied to next Push A: 97.5 kg × 6–8` [Undo]. Tag `Coach` |
| Proposal not now | Not now tapped | The row collapses to `Built-in rule: 100 kg × 6–8 next time` with a link `Show coach suggestion`. Nothing changes |
| Proposal undone | Undo tapped | Back to the unapplied proposal (before/after, Apply) |
| Proposal stale | The template or history changed since the proposal was made (e.g. an Edit workout correction) | `Out of date` styling, Apply disabled, [Dismiss]. Rows recompute the built-in rule; the coach is not re-called automatically |
| Proposal expired | The next session of that routine started without Apply | Status `expired`; shown in history as `Not applied`. The built-in rule's target was used |

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
| `Next time` row (built-in rule) | `Why?` expands the rule explanation (the `calculateNextTargets` explanation string) |
| `Next time` row (coach) | `Why?` opens the evidence sheet (`getDecisionEvidence`): what the coach used, the built-in rule's result for comparison, and guard notes. `Apply` calls `confirmProposal` → `applyCoachProposal` (scope `future_template`, next occurrence of this routine). `Undo` calls `undoAction`. `Not now` records the rejection; the built-in rule target stays |
| `Apply all coach targets` | Applies every unapplied, non-stale coach proposal in one transaction, one `actionId`. Toast `3 coach targets applied to next Push A` [Undo] (undoes all three) |
| `⋯` → `Share / export` | Plain-text or CSV export of this session through the iOS share sheet. This is secondary |
| Voice | Nothing is read aloud except the `Workout saved. Your summary is ready.` cue (Set cues mode). In Conversation mode, Ben may ask "how did that compare?". The coach answers from the same facts |

Undo:
- Finishing by accident: the summary's `⋯` menu has `Reopen workout`. It is available for 30 min after finishing and returns the session to Ready on its first skipped set, with an audit.
- Corrections: the edit screen's toast [Undo].
- Applied proposals: [Undo] on the collapsed row, available until the next session of that routine starts. After that the change is history; a new proposal is needed to change it.

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
| Next time row (built-in rule) | `Incline DB press: target 32.5 kg each × 8–10` (a **target**) + reason `You did 10 reps on every set at 30 kg.` + source tag + `Rule: double progression` |
| Source tags | `Coach` · `Built-in rule` · `Built-in rule (coach offline)` (no route or no network) · `Built-in rule (coach unavailable)` (error or limit) |
| Next time row (coach) | Scope `From next Push A`; `Built-in rule 100 kg × 6–8` → `Coach 97.5 kg × 6–8` (both **targets**); coach reason (one sentence); guard note; `Why? ›` · `Not now` · `Apply` |
| Coach agrees | `Coach agrees: 100 kg × 6–8` (a **target**) |
| Coach reviewing | `Coach is reviewing…` |
| Applied | `✓ Coach target applied to next Push A: 97.5 kg × 6–8` [Undo] · bulk: `Apply all coach targets` → toast `3 coach targets applied to next Push A` [Undo] |
| Not now | `Built-in rule: 100 kg × 6–8 next time` · link `Show coach suggestion` |
| Pain-blocked | `Not increasing: you flagged shoulder pain. Same target: 50 kg × 6–8` |
| In-workout adjustment line | `Coach adjusted sets 3–4 (RPE 10 on set 2)` (the trigger fact or `you asked`) |
| No change | `Same targets next time.` |
| Held (side lagging) | `Same target: 25 kg stack × 8–10` (a **target**) + the domain's fact naming the lagging side, e.g. `… within the effort limit, but the right side didn't (lowest 7 reps); holding.` |
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
- `calculateNextTargets(history, rule, equipment)` returns the changed targets and an explanation for each, with equipment bounds applied. It is always computed: it is the offline fallback and the "before" value of every coach proposal.
- `buildWorkoutSummary(sessionId)` also returns `nextTime[]`: `{exerciseId, builtIn, coachStatus: 'unavailable' | 'offline' | 'loading' | 'ready' | 'failed', coachProposal?: {proposalId, after, reason, guardNotes, scope, status}}`, and per exercise `adjustments[]` from the workout (coach-adjustments §6).
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
7. Built-in rule values under `Next time` come from `calculateNextTargets` and match the domain unit tests. Every `Next time` value, from either source, is labelled as a target, carries a source tag, and never exceeds equipment maximums.
8. Pressing `Done` while the coach note is loading returns to Today without an error. The note appears later in the session history.
9. A coach next-time proposal shows its scope (`From next Push A`), the built-in rule value as before and the coach value as after, the coach's reason, Apply and Undo, and it never edits completed sets.
10. Editing the end time keeps the original timestamp in the audit, and the summary shows `(end time edited)`.
11. Only `Done` is styled as primary. There are no animated elements.
12. Finish a workout with 2 of 4 prescribed bench working sets done, both at the top of the range. `Next time` shows `Same target` with the domain's "Only 2 of 4…; holding." fact, never an increase.
13. Deleted sets never appear in the exercise rows or counts. A unilateral Left + Right pair counts as one working set.
14. A unilateral exercise where the right side fell short shows `Same target` under `Next time` with the domain's fact naming the right side, never an increase.
15. An exercise whose equipment can make no load shows `No load target` with `Fix the equipment profile.` and [Update gym] under `Next time`, never "bodyweight".
16. With airplane mode on, every `Next time` row is tagged `Built-in rule (coach offline)` and shows the rule's explanation; no row says `Coach` and no coach text appears.
17. With the coach connected, finishing makes exactly **one** coach call (note + proposals). Nothing changes for the next session until `Apply`; without Apply, the next Push A uses the built-in rule's targets.
18. A coach proposal of 98 kg on a 2.5 kg-step barbell shows 97.5 kg with `Rounded to 97.5 kg: nearest your bar and plates allow.`; a proposal above a rack maximum shows the capped value and `Capped at …`.
19. With a pain flag active, a coach increase for that movement shows `Not increasing: you flagged … pain.` with no Apply.
20. Apply → the row collapses with [Undo]; Undo restores the unapplied proposal and the next session's target is the built-in rule's again.
21. Correcting a set in Edit workout after a coach proposal makes that proposal `Out of date` (Apply disabled); no coach call is made automatically.
22. An exercise adjusted by the coach mid-workout shows `Coach adjusted sets 3–4 (…)` in its row; its logged values are the actual results, unchanged by the adjustment.
