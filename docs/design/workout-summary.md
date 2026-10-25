# Workout summary

> **Revision (Ben, 25 Oct).** `Edit times`: Started takes any past date and time and moves the whole workout (sets, pauses, rests) with it; Ended can then be set on its own; `Times changed` [Undo] after Save ([log-past-workout.md](log-past-workout.md) §2). A workout dated before newer ones is read as of its date: compared with the one before it, records and highlight from earlier workouts only, no `Next time` row for an exercise done again since (§4 there).

> **Revision (Ben, 23 Oct).** (1) **The built-in rule's stall reset is an offer:** its `Next time` row holds (`Same target: 60 kg × 6–8`) with `Reset to 52.5 kg × 6–8?` `Skip` / `Apply`; applied: `Target 52.5 kg × 6–8` and `Undo`; skipped: no buttons (coach-adjustments revision 23 Oct). (2) **An unasked extra set from the coach** is a suggestion row with `Skip` / `Apply`, never dropped. Suggestion buttons read `Skip` / `Apply` (were `Not now`). (3) **A main lift Ben swapped** gets its own row before `Keep for next time?`: `Make Incline barbell press the main lift for Chest?` `Skip` / `Apply`, then `Incline barbell press · main lift for Chest` with `Undo` (workout-builder-v3 §2.8).

> **Revision (Ben, 22–23 Oct, D1, D2).** One new row after `Next time`: **`Keep for next time?`** `Apply` / `Skip`, shown only when Ben changed the workout's structure (swapped, added or removed exercises, or changed set counts) against the plan day's template or saved workout it started from; never for a Time change or the fit's cuts, pairing, a deload, loads, reps or coach edits (review 23 Oct: only his own changes are listed). Apply changes that plan day (or saved workout) only, with Undo. `Done` stays the only primary. Owner and full spec: [workout-builder-v3.md](workout-builder-v3.md) §2.8 (it replaces the Start prompt). Coach next-session changes: CA8 `small` ones stay applied with Undo; a stall reset or an extra set Ben didn't ask for is an offer with Apply ([coach-adjustments.md](coach-adjustments.md) revision 22–23 Oct). Prototype: `prototypes/app/` Summary.

> **Revision 2026-10-08.** Aligned with [ADR 0003](../decisions/0003-domain-review-decisions.md): `Next time` also lists exercises held because not every prescribed working set was done, with the domain's reason (S3); end time comes from `finishWorkout(…, endedAt?)`, later edits from `updateSessionTiming(sessionId, expectedVersion, …)` (S5). Deleted sets are excluded; unilateral exercises show per-side totals.
>
> **Revision 2026-10-08 (re-review).** Aligned with ADR 0003 "Re-review decisions": `Next time` also lists holds that name a lagging side (R4) and `no_feasible_load` with `Fix the equipment profile` guidance, never "bodyweight" (R3). Active time subtracts only paused time inside the final start–end window (S9; §3, §5, §6, check 4).
>
> **Revision 2026-10-08 (coach-led progression, v0.4).** Aligned with [ADR 0006](../decisions/0006-coach-led-progression.md). `Next time` now has a named **source** on every row. With the coach available, each changed exercise shows the coach's proposal as before (built-in rule) → after (coach), with its reason, guard notes, `Why?`, `Not now`, `Apply` and Undo, source `Coach`. Without it, rows show the built-in rule's targets labelled `Built-in rule (coach offline)` / `(coach unavailable)`. One coach call per workout produces both the note and the proposals. Exercise rows mention in-workout coach adjustments. Behaviour shared with the workout screen is in [coach-adjustments.md](coach-adjustments.md). Changed: §1, §2 (regions 5–7, wireframes), §3, §4, §5, §6, checks 7, 9 and 16–22. This supersedes proposal P8's "rule named" wording (flow §7).

> **Revision 2026-10-08 (consolidation).** Applied data-import-export.md X2 with the approved "backups in the app by default" wording: one line under the saved banner from `getBackupStatus` (§2 region 1): `Backed up on this phone · 19:05` / `Backing up…` / `⚠ Last backup on this phone didn't save. Open Data & backup ›`. It never mentions off-phone copies, never blocks `Done`, and the automatic backup runs after the summary is shown. `⋯` → `Share / export` stays a per-session export of **Your data** only.

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** The session's check-in ([check-in.md](check-in.md)) is shown **as given** in a `CheckInLine` under the title line, above the facts (region 2a): `How you said you felt: 2 of 5`, reasons, the note in quotes. It is not a fact row, is never combined with any number on this screen, and doesn't change `Next time` (the built-in rules ignore it). When Ben picked `Pain` without choosing movements, a `NoteLine` asks him to flag them. The single coach call may read this session's check-in as Ben's words (check-in.md CI10). Changed: §2, §3, §4, §5, §6, checks 23–26.

> **Revision 2026-10-09 (playbook v1 review fixes).** The "built-in rule" on this screen is playbook rule **7-F**: equipment-aware double progression. It uses the smallest achievable step at this gym, adds reps first when that step is over ~10% or the equipment is at its max, then holds. It never adds sets (playbook D2). Each built-in target now shows its % change from the last working load (`Target 32.5 kg each × 8–10 · +8.3%`), as rule 7 requires. **Who sets next time's target when the coach is connected and Ben doesn't tap Apply is still the built-in rule.** That's what CLAUDE.md rule 3 allows today (future-session changes are always proposals). The screen already says so honestly: `Built-in rule` is the "before" value and the `Not now` result. Playbook **D21** asks Ben whether the coach's target should apply instead. If he chooses that (option A, which needs a CLAUDE.md rule 3 and ADR 0006 change), this screen changes as described in §3 "If D21 option A". Until this build enforces 7-F's 10% limit, built-in targets can jump more (coaching-playbook PB15); the `Why?` text names the real step either way. Changed: §2 region 6, §3, §5, §6, checks 7, 17 and 27–28.

> **Revision 2026-10-09 (gym switch, competitor follow-up 6; [gym-switch.md](gym-switch.md)).** A workout can now use more than one gym (`session.gymChanges`).
> - **Title line:** every gym in order, `Thu 8 Oct · Main Gym → Hotel · Lisbon · 18:02–19:04`. Past workouts use the same wording.
> - **Exercise row:** an exercise done at both shows each part with its gym, `Incline DB press · 32.5 kg each × 9 (Main Gym) · 20 kg each × 12, 11 (Hotel · Lisbon)`. A swap made by the switch reads `Bench press → DB bench press for sets 3–4 (no Olympic bar at Hotel · Lisbon)`.
> - **Comparison and `Next time`:** these stay per equipment (check 5). They never pair the two gyms' items.
> - **Holds:** an exercise whose prescribed sets were split by a switch is held under ADR 0003 S3 with the reason `Held: sets 3–4 moved to Hotel · Lisbon.`
> - **Coach:** the coach's next-session targets (D21) follow the same per-equipment rule. A switch counts as "equipment changed" for rule 3's structural proposals, but only as a proposal.
>
> No layout change.

> **Revision 2026-10-09 (Ben's decision D21; CLAUDE.md rule 3, ADR 0006 amendment 2; competitor follow-up 7).** The coach's next-session targets are now the default. This replaces the review-fix wording above ("still the built-in rule") and the "If D21 option A" row, which is now the live behaviour.
> - **Small changes are saved without a tap.** After the single coach call, its load, rep and set changes on the same exercises (coach-adjustments CA8) are saved for the next session of this routine. Each `Next time` row shows the target and its %, the coach's reason, guard notes, `Rule: …`, `Why?` and one-tap `Undo`. `Not now`, `Apply` and `Apply all coach targets` are gone from these rows; `Undo all` replaces the bulk button.
> - **Bigger changes** (more than one load step, more than ±2 reps or ±1 set, stall resets, deloads) still come as a `CoachTargetProposal` with Apply; the built-in rule's target stays in use until Ben applies.
> - **The built-in rule (playbook 7-F) is the labelled fallback**: coach offline or unavailable, no coach target for an exercise, or Ben's Undo.
> - **New region 6b:** a structural suggestion (swap, add or remove exercises, order) appears only when Ben asked for variety or something changed: goal, schedule, equipment or pain (coach-adjustments CA9). One `ChangeReviewCard` with `Because: …`, Apply and Undo.
> - **Late answers apply** until this routine's next session starts (CA10).
> - **Honesty contract** ([coach-contract.md](coach-contract.md)): every number and "changed" line here is app text from the saved action. A coach note sentence that claims a change that wasn't saved is hidden, with a note.
> - **Rotation (D19):** "next Push A" is the next time Push A comes round in Ben's rotation, or when he starts it himself (weekly-plan WP14). The heading names the routine.
> - Changed: §1, §2 (region 6, new 6b, wireframe, the note under it), §3, §4, §5, §6, checks 9, 17, 20, 21 and new 29–39.

Status: v0.1 draft, 8 Oct 2026. Flow: [flow-first-milestone.md](flow-first-milestone.md). Tokens: [design-system.md](design-system.md).

## 1. Purpose

The summary answers **"Is my workout saved, and how did it go compared with last time?"**

The save has already happened before this screen appears. The summary shows facts first; interpretation comes second and is optional. It also answers **"What will I lift next time, and who decided?"**: every next-time target names its source (`Coach` or `Built-in rule`). Since D21 the coach's small changes are already saved when they appear; Ben only acts if he disagrees, with one tap on `Undo`.

Its single primary action is **`Done`**, which returns to Today. `Edit workout` is secondary.

## 2. Layout

The summary replaces the Active workout screen after `finishWorkout` commits. It has no back navigation into the finished workout; corrections go through Edit.

Regions, top to bottom:

1. **Saved banner.** `✓ Workout saved on this phone`, on the `status.done.subtle` background with the done icon. This is shown only after the local commit. Under it, one `type.callout` `text.secondary` line from `getBackupStatus` (consolidation, X2): `Backing up…` (static icon) → `Backed up on this phone · 19:05`, or `⚠ Last backup on this phone didn't save. Open Data & backup ›` (`status.warning` icon + text). The line updates in place, never delays `Done` and never mentions copies in Files.
2. **Title block.** The workout name and date, then the gym and the time range.
2a. **Check-in (2026-10-09, only when answered).** `CheckInLine` (design-system §9.56): `How you said you felt: 2 of 5 ›`, reasons, note. Tap → edit sheet (check-in.md §4.6). If `Pain` was picked with no movement flagged, a `NoteLine` follows: `⚠ You mentioned pain before this workout. Flag the movements that hurt so loads don't go up.` [Choose movements ›]. Absent when skipped or not asked.
3. **Facts.** (Design pass, Ben approved 20 Oct) The shared `StatStrip`: `Active`, `Exercises 5/5`, `Sets 16` (working sets only; warm-ups are never counted in it), and with a plan `Planned 14/15`. Skipped sets are said on each exercise's plan line. The title is capped at 2 lines.
4. **Comparison.** One comparable lift: today vs the last comparable session, plus a line explaining why they count as comparable.
5. **Exercises.** (Design pass, 20 Oct) At most 3 lines per exercise: the name (2 lines max) with a right-aligned verdict Tag and icon (`Hit` / `Short` / `Over`, with a plan); the actual results for the working sets with the unit note on that line (`30×10 · 30×10 (kg each)`); one plan line `3/3 · of 8 · 1 skipped` (no plan: `4 sets · 1 skipped`), uneven sides on the same line. When a lighter (or heavier) load, not the reps, gave the verdict, the line says the planned load: `3/3 · of 8 · 100 kg planned`, so `Short` with every rep hit isn't a contradiction. If the coach adjusted that exercise's sets during the workout, one extra line says so: `Coach adjusted sets 3–4 (RPE 10 on set 2)`.
6. **Next time** (revised 9 Oct for D21). Heading `Next time · Push A` (the routine just done; it comes round again in the rotation). One row per exercise whose next target changes or is held for a listed reason. Each row names its source and shows its % change from the last working load. Built-in values come from playbook rule 7-F (equipment-aware):
   - **Coach answered, small change (the default):** a `CoachTargetRow` (§8): tag `Coach`, `Target 97.5 kg × 6–8 · −2.5%` (from the saved action), the coach's one-sentence reason in quotes, guard notes, `Rule: 100 kg × 6–8` (`text.secondary`), `Why? ›` and [Undo]. It is already saved: nothing to apply. When at least one row is a coach target, the line `Set by the coach from today's workout.` sits under the heading, and with two or more, a secondary text button `Undo all`.
   - **Coach agrees with the rule:** `Coach agrees: 100 kg × 6–8`, no buttons.
   - **Coach gave no target for this exercise:** the built-in rule's target tagged `Built-in rule` and `No coach target for this one.`
   - **Coach's change is bigger than small** (coach-adjustments CA8), including stall resets (rule 8) and deloads (rule 10): the built-in rule's target stays in use, tagged `Built-in rule`, with the coach's `CoachTargetProposal` under it: `More than a small change: tap Apply to use it.`, before (built-in) → after (coach), reason, `Why? ›`, [Not now] [Apply].
   - **Coach offline, not connected or failed:** the built-in rule's target with the tag `Rule`, and the rule's own explanation.
   - **Coach still working:** the built-in rule's target tagged `Built-in rule` and the line `Coach is reviewing…`. When the coach's answer is saved, each row updates in place.
6b. **Suggested change to Push A (rare; 9 Oct, D21).** Only when Ben asked for variety, or `getStructuralChangeSignals` reports that something changed: goal, schedule, equipment or pain (coach-adjustments CA9). At most one `ChangeReviewCard` (author `Coach`): `Because: …` (app text from the signal), scope `Push A from now on`, change lines (`Cable fly → Pec deck`), the coach's reason, `Why? ›`, [Not now] [Apply]. Never shown without a request or signal.
7. **Coach note (optional, loads later).** One observation. It comes from the same single coach call as the targets. Its sentences pass the claim check ([coach-contract.md](coach-contract.md) CC3): a sentence that claims a change that wasn't saved is hidden, with `ⓘ Only the changes shown were made · 1 line hidden`
8. **Footer bar (fixed).** [Edit workout] (secondary) and [Done] (primary). `Share / export` sits in the overflow `⋯` in the title row.

```
┌────────────────────────────────────────┐
│ ✓ Workout saved on this phone          │ saved banner
├────────────────────────────────────────┤
│ Push A                             ⋯   │
│ Thu 8 Oct · Main Gym · 18:02–19:04     │
│ How you said you felt: 3 of 5        › │ CheckInLine (2026-10-09; what
│ Tired                                  │ Ben said, only if answered)
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
│ Next time · Push A                     │
│ Incline DB press                       │
│ Target 32.5 kg each × 8–10 · +8.3%     │ % from code (buildStepCard)
│ You did 10 reps on every set at 30 kg. │
│ Rule                                   │ source tag
│ Rule: smallest step at Main Gym ·      │ 7-F explanation
│ Why? ›                                 │
│ Triceps pushdown                       │
│ Same target: 35 kg stack × 10–12       │
│ Only 1 of 3 working sets was logged on │
│ 8 Oct; holding.                        │
│ Rule                                   │
│ Rule: holding · Why? ›                 │
│                                        │
│ Coach note                             │
│ Coach not connected. Your workout is   │
│ saved; a note can be added later.      │
├────────────────────────────────────────┤
│ [ Edit workout ]  [      Done        ] │
└────────────────────────────────────────┘
```

**Wireframe: Next time with the coach available (revised 9 Oct for D21)**

```
│ Next time · Push A                     │ heading names the routine
│ Set by the coach from today's workout. │ only with ≥ 1 coach target
│ Undo all                               │ secondary text button (2+)
│                                        │
│ Bench press                  [Coach]   │ TargetSourceTag
│ Target 97.5 kg × 6–8 · −2.5%           │ saved target, % from code
│ "Set 2 hit RPE 10 and sets 3–4 fell    │ coach reason, in quotes
│ short; hold a little lighter."         │ (claim-checked)
│ Rounded to 97.5 kg: nearest your bar   │ guard note (validator)
│ and plates allow.                      │
│ Rule: 100 kg × 6–8                     │ text.secondary (a target)
│ Why? ›                       [ Undo ]  │ 44pt+ hit areas, ≥ space.8 apart
│                                        │
│ Overhead press               [Coach]   │
│ Not increasing: you flagged shoulder   │ pain block: nothing saved,
│ pain. Same target: 50 kg × 6–8         │ no Undo
│                                        │
│ Incline DB press                       │
│ Coach agrees: 32.5 kg each × 8–10      │ no buttons
│                                        │
│ Suggested change to Push A   [Coach]   │ region 6b: only with a request
│ Because: you asked for more variety    │ or signal (app text)
│ on 8 Oct.                              │
│ Push A from now on                     │ ScopeBadge
│ Cable fly → Pec deck                   │ ChangeLine
│ "Same muscles on a new machine; cable  │ coach reason (claim-checked)
│ fly has held for 3 sessions."          │
│ Why? ›          [ Not now ] [ Apply ]  │ Apply: secondary accent button
│                                        │
│ Coach note                             │
│ Bench moved well until set 2; the      │
│ rest of the session was on target.     │
```

**Wireframe: one row after Undo**

```
│ Bench press          [Built-in rule]   │
│ Target 100 kg × 6–8 · same as last     │ built-in rule's target, now in use
│ You undid the coach's target.          │
│ Use coach target: 97.5 kg × 6–8        │ text button, 44pt
```

Built-in rule text comes from `calculateNextTargets`. Coach targets, % changes and status lines come from the saved `ActionRecord` (`renderActionResult`, coach-contract CC1); coach reasons are the stored reason text, in quotes; guard notes come from `validateCoachProposal`. The UI never writes its own explanation. An exercise appears under Next time when the rule changed its target, **or** when it held because the session was incomplete, **or** when it held because one side lagged (unilateral), **or** when no feasible load exists on the equipment (`no_feasible_load`). Progression needs every prescribed working set completed at or above the top of the rep range within the effort limits (ADR 0003 S3, Ben may revise); a top-set rule needs at least one top set. A hold for any other reason (reps not yet at the top) isn't listed, to keep the section short. **With the coach available, an exercise is also listed when the coach's target differs from the built-in rule's** (saved by default when small, a proposal when bigger). Rows where the coach agrees with a listed rule change show `Coach agrees: …`.

## 3. States

| State | Trigger | Display |
|---|---|---|
| Saving | `finishWorkout` in progress (normally < 200 ms) | The Finish sheet shows `Saving…`. The summary isn't shown until the commit |
| Save failed | The SQLite write failed | Stay on Active workout with the banner `Couldn't finish. Try again.` [Try again]. **Never show a summary that isn't saved** |
| Normal | Commit OK | As in the wireframe |
| No comparison available | No compatible previous session | `First time` |
| Not comparable | History exists but with different equipment, convention or set type | `Not compared · different equipment` |
| Short or empty workout | 0 working sets | Facts only. The comparison and next-time sections are hidden. The footer adds `Discard workout` as a danger text link (confirmation required) |
| Skipped sets | Pending sets at finish | (20 Oct) Each exercise's plan line says `1 skipped`; `Sets` counts the done working sets |
| Timing corrected | The end time chosen in the finish sheet differs from the tap time (`finishWorkout` `endedAt`), or a time was edited later with `updateSessionTiming` | The title line reads `18:02–19:24 (end time edited)` or `(start time edited)`. The timing audit keeps the original values. Active time is recomputed: only paused time inside the new start–end window is subtracted (a pause after the corrected end isn't) |
| Next time: no change | The rules keep the same targets | `Same targets next time` |
| Next time: held, incomplete | Fewer completed working sets than the rule prescribes | `Bench press` · `Same target: 100 kg × 6–8` · domain fact, e.g. `Only 2 of 4 working sets were logged on 8 Oct; holding.` |
| Next time: held, all skipped | Every working set of an exercise was skipped | `No working sets were logged on 8 Oct (all skipped); holding.` The target stays at the last performed load |
| Next time: held, side lagging | Unilateral exercise where one side met the rule and the other didn't, or the sides have unequal set counts | `Single-arm cable row` · `Same target: 25 kg stack × 8–10` · domain fact, e.g. `The left side reached 8+ reps on every set within the effort limit, but the right side didn't (lowest 7 reps); holding.` or `Only 2 of 3 working sets had both sides logged on 8 Oct (left 3, right 2: the right side is behind); holding.` |
| Next time: no feasible load | `calculateNextTargets` returns `no_feasible_load` | `Lat pulldown` · `No load target` · `Cable stack can't make any load with its current min/max settings, so no Lat pulldown target is set. Fix the equipment profile.` [Update gym]. Never shown as "bodyweight" |
| Unilateral exercise | `laterality` is unilateral | Row reads `Single-arm cable row 3 sets (per side)` and, when sides differ, `L 28 reps · R 26 reps`. A Left + Right pair counts as one set (`summariseVolume`) |
| Deleted sets | Sets deleted during the workout | Not shown and not counted. Visible only in the edit history |
| Next time: at equipment max | The rule hits the equipment maximum | `Dumbbells max out at 30 kg each at Main Gym. Next time: aim for more reps at 30 kg.` (from the domain, not invented) |
| Pain reported during session | A pain note was logged for a movement | `Progression paused for Overhead press because you noted pain. Targets stay the same until you clear it.` [Review] (rule 9). No diagnosis |
| Coach: not connected | No AI route | Note: `Coach not connected. Your workout is saved; a note can be added later.` Next time rows: built-in rule targets tagged `Rule` |
| Coach: offline | The route exists but there's no network | Note: `Coach note will be added when you're back online.` (it retries when the app is next opened with a connection, never in a background loop). Rows tagged `Rule`. When the coach answers later, and this routine hasn't started again, its small changes are saved then (coach-adjustments CA10) and show in this session's summary in history, with Undo |
| Coach: loading | Request in flight | Note: `Coach note: writing…` (static icon, no spinner animation beyond the system activity indicator). Rows show the built-in rule target tagged `Built-in rule` plus `Coach is reviewing…`. **Done stays enabled**. When the answer is saved, rows update in place with no animation, and VoiceOver announces once, politely: `Coach set 2 targets for next Push A.` |
| Coach: ready, saved (D21) | Note and targets received; small changes saved in one action | 2–3 sentence note. Each changed row is a `CoachTargetRow`: `Target 97.5 kg × 6–8 · −2.5%`, tag `Coach`, reason, guard notes, `Rule: 100 kg × 6–8`, `Why? ›`, [Undo]. Heading line `Set by the coach from today's workout.` |
| Coach: agrees | Coach target equals the built-in rule target | `Coach agrees: 100 kg × 6–8`. No buttons |
| Coach: no target for an exercise | The coach answered but gave no target for it, or its target was dropped by the checks | Built-in target tagged `Built-in rule` + `No coach target for this one.` `Why?` names any dropped target and its reason (e.g. `Not used: an extra set you didn't ask for.`) |
| Coach: bigger change (CA8) | The coach's target is more than one load step, ±2 reps or ±1 set, or a stall reset or deload | Not saved. Built-in target in use (`Built-in rule`), with the `CoachTargetProposal` below: `More than a small change: tap Apply to use it.` + before/after, reason, [Not now] [Apply]. Apply / Not now / Undo / Out of date / Expired follow change-review.md (CR7, CR8) |
| Coach: guard applied | `validateCoachProposal` snapped or capped the coach's load | Guard note under the reason, e.g. `Rounded to 97.5 kg` / `Max here 30 kg each` The saved target is the guarded one |
| Coach: pain-blocked | The coach gave an increase on a pain-flagged movement | `Not increasing: you flagged shoulder pain. Same target: 50 kg × 6–8`. Nothing saved for that exercise, no Undo. The built-in rule also holds (`halted_pain`) |
| Coach: failed | Error or quota | Note: `Couldn't get a coach note (limit reached).` [Try again]. Rows tagged `Rule`. It never falls back to a paid route. A successful `Try again` saves the coach's small changes as above |
| Coach target undone | `Undo` on a row | That exercise only: the built-in rule's target is in use, tagged `Built-in rule`, with `You undid the coach's target.` and `Use coach target: 97.5 kg × 6–8`. Other rows keep their coach targets |
| Coach target used again | `Use coach target` | Back to the saved state with [Undo] (Ben's own request, saved at once) |
| All undone | `Undo all` | Every coach row as "undone", in one transaction. Toast `Built-in rule for next Push A (3 exercises)` [Undo] |
| Based on edited sets | A set that an applied coach target was based on was corrected in Edit workout | Nothing changes by itself (rule 2). The row adds `⚠ Based on set values you've since edited.` with [Use built-in rule: 100 kg × 6–8] and [Ask the coach again]. The coach is not called automatically |
| Next session started | This routine's next session started | Rows lose Undo and read `Used in Push A, 10 Oct.` In that workout, the set card's `Why?` → `Use built-in rule` (active-workout AW4) changes that day's sets |
| Structural suggestion (region 6b) | Ben asked for variety, or a signal exists (CA9), and the coach proposed a structural change | One `ChangeReviewCard`: `Because: …`, scope `Push A from now on`, change lines, reason, [Not now] [Apply]. Applied: `✓ Applied to Push A from now on` [Undo]. Out of date or expired as change-review.md (CR8: expires when Push A next starts) |
| Structural, no request or signal | The coach returned a structural change anyway | Not shown. `Why?` → `Not used: changing exercises wasn't asked for.` (coach-contract CC10) |
| Hidden coach line | A note or reason sentence claims a change that wasn't saved | The sentence is hidden; `ⓘ Only the changes shown were made · 1 line hidden` (coach-contract CC3) |
| Built-in step over 10% (review fixes) | 7-F's next achievable load is more than ~10% heavier (e.g. 10 → 12 kg dumbbells, +20%) | `Same load, one more rep: 10 kg each × 13` (a **target**) + `Next dumbbell is 12 kg, +20%: adding reps first.` No added set. At the rep cap: `Holding at 10 kg each × 15. Next step is +20%. Microplates or the coach can help.` |
| Check-in answered (2026-10-09) | `session.checkIn.kind = 'answered'` | Region 2a `CheckInLine` with score, reasons and note exactly as given |
| Check-in skipped / not asked | `skipped` or `not_asked` | No check-in line; nothing says it was skipped |
| Pain mentioned, not flagged | Check-in has `Pain` and no `painFlagIds` | Region 2a `NoteLine` + [Choose movements ›] until a flag is set from it or the check-in is edited |
| Lighter session applied | The check-in offer was accepted | The exercise rows' adjustment line reads `Coach adjusted sets 2–6 (lighter session; you said 2 of 5)` |
| Check-in edited | Changed from the line | The line shows the new values; `Edit history` lists `Check-in 3 → 2`. Nothing else recomputes |

Transitions:
- Finish commit → Normal.
- Done → Today, with the main card in the `Done today` state.
- Edit workout → the edit screen. Saving there returns to the summary, recomputed.
- (9 Oct, D21) Per coach row: `Coach is reviewing…` → saved (`Undo`) ⇄ undone (`Use coach target`) → `Used in Push A, 10 Oct` when the routine next starts. A bigger change: proposal → applied (`Undo`) / not now / out of date / expired.

```
 Coach is reviewing… ──small──► Saved ──Undo──► Undone (built-in in use)
        │                        ▲  │              │
        │                        └──┼── Use coach target
        ├──bigger──► Proposal ─Apply─► Applied     │
        │                           │              │
        └──offline / failed──► Built-in (coach offline / unavailable)
                    next Push A starts ──► Used (no Undo here; AW4 in the workout)
```

## 4. Interactions

| Element | Action |
|---|---|
| `Done` | Returns to Today. Leaving doesn't cancel the coach note: if it's still loading, it attaches to the session and appears in history when ready |
| `CheckInLine` (2026-10-09) | Opens the check-in edit sheet: same score and reasons, `Save changes`, `Delete check-in` (check-in.md §4.6). `updateCheckIn` / `deleteCheckIn`; never changes sets, adjustments or `Next time` |
| `Choose movements ›` (2026-10-09) | Pain flag Add sheet (coach-memory §2.6) with this workout's exercises first; `setPainFlag(…, source: 'check_in')` |
| `Edit workout` | Opens the session in edit mode (Overview table layout). Ben can correct values, set types, add a forgotten set or change start and end times. Every change calls `correctSet` / `updateSessionTiming(sessionId, expectedVersion, {startedAt?, endedAt?})` with an audit, and the original timestamps are kept. Time pickers allow only times that keep every logged set inside the workout and nothing in the future. A skipped timed set that kept a stopped time shows it as `Not logged: 0:38` with a `Log it` action (a correction). Editing doesn't regenerate the plan with AI. Next-time targets are recomputed deterministically |
| Comparison block | Opens the exercise history in Progress, filtered to the same equipment |
| Exercise row | Opens that exercise's sets read-only, with an `Edit` button |
| `Next time` row (built-in rule) | `Why?` expands the rule explanation (the `calculateNextTargets` explanation string) |
| `Next time` row (coach target, saved; D21) | `Why?` opens the evidence sheet (`getDecisionEvidence`): what the coach used, the built-in rule's result for comparison, guard notes, anything dropped (`Not used`) and any hidden coach lines (`Not shown`, coach-contract CC9). `Undo` calls `undoAction(actionId, {exerciseId})`: that exercise goes back to the built-in rule's target. `Use coach target` calls `reapplyCoachTarget(actionId, exerciseId, expectedVersion, opId)`. Both only until this routine's next session starts |
| `Undo all` | One `undoAction(actionId)` for the whole summary action, in one transaction. Toast `Built-in rule for next Push A (3 exercises)` [Undo] (puts the coach targets back) |
| `Next time` row (bigger change, proposal) | As before: `Apply` calls `confirmProposal` → `applyCoachProposal({kind: 'review_apply'})` (scope `future_template`, the next occurrence of this routine); `Not now` keeps the built-in rule's target; Undo on the collapsed row |
| `Ask the coach again` (based on edited sets) | One coach call on the corrected sets, because Ben asked. Its small changes are saved as the default, with Undo; bigger ones come as proposals |
| Region 6b card (structural) | change-review.md §4: `Apply` → `confirmProposal` (rejects `stale_context` if the goal, setup, equipment or routine changed) → `applyCoachProposal`. `Not now` hides it (CR7). Undo on the collapsed card. Voice "yes" never applies it (CR6: `future_template` needs a tap) |
| `⋯` → `Share / export` | Plain-text or CSV export of this session through the iOS share sheet. This is secondary |
| Voice | Nothing is read aloud except the `Workout saved. Your summary is ready.` cue (Set cues mode). In Conversation mode, Ben may ask "how did that compare?". The coach answers from the same facts |

Undo:
- Finishing by accident: the summary's `⋯` menu has `Reopen workout`. It is available for 30 min after finishing and returns the session to Ready on its first skipped set, with an audit.
- Corrections: the edit screen's toast [Undo].
- Coach targets saved by default (D21): [Undo] on each row and `Undo all`, until the next session of that routine starts. After that, the set card's `Why?` → `Use built-in rule` (active-workout AW4) changes that day's pending sets.
- Applied proposals (bigger changes, structural changes): [Undo] on the collapsed row or card, available until the next session of that routine starts. After that the change is history; a new proposal is needed to change it.

## 5. Copy

| Element | Text |
|---|---|
| Saved banner | `Workout saved on this phone` |
| Backup line | `Backing up…` · `Backed up on this phone · 19:05` · `⚠ Backup didn't save ›` |
| Title line | `Thu 8 Oct · Main Gym · 18:02–19:04` |
| Check-in (2026-10-09) | `How you said you felt: 2 of 5` · reasons `Tired · Poor sleep` · note `"Baby was up at 3"` (what Ben said, as given) · pain prompt `⚠ Pain mentioned · which movements?` [Choose movements] · adjustment line `Coach adjusted sets 2–6 (lighter session; you said 2 of 5)` |
| Facts labels (20 Oct) | `Active`, `Exercises`, `Sets`, `Planned` |
| Fact values | `54 min`, `5/5`, `16`, `14/15` |
| Comparison heading | `Compared with last time` |
| Comparison rows | `Today 102.5 kg × 6` / `1 Oct 100 kg × 8`. Both are **actual results** |
| Comparability line | `Same barbell at Main Gym, working sets` |
| Estimates (if shown) | `Estimated 1RM 123 kg (estimate, Epley formula)`. This is optional and off by default. If it appears, it always says "estimate" |
| Not comparable | `Not compared · different equipment` |
| First time | `First time` |
| Next time heading | `Next time · Push A` · (9 Oct, D21) `Set by the coach from today's workout.` · `Undo all` |
| Next time row (built-in rule) | `Incline DB press: target 32.5 kg each × 8–10 · +8.3%` (a **target**; % from code) + reason `You did 10 reps on every set at 30 kg.` + source tag + `Rule: smallest step at Main Gym` (revised in the review fixes; was `Rule: double progression`) · held rows `Rule: holding` · big step `Next dumbbell is 12 kg, +20%: adding reps first.` · at the cap `Holding at 10 kg each × 15. Next step is +20%. Microplates or the coach can help.` |
| Source tags | `Coach` · `Rule` (every built-in row; the coach's state is the `Coach note` line) · `Suggested` |
| Next time row (coach, saved by default; 9 Oct) | `Target 97.5 kg × 6–8 · −2.5%` (a **target**) · reason in quotes (one sentence) · guard note · `Rule: 100 kg × 6–8` (a **target**) · `Why? ›` · `Undo` |
| Undone (9 Oct) | `Target 100 kg × 6–8` + tag `Built-in rule` + `You undid the coach's target.` + `Use coach target: 97.5 kg × 6–8` · toast after `Undo all`: `Built-in rule for next Push A (3 exercises)` [Undo] |
| No coach target (9 Oct) | `No coach target for this one.` · `Why?` → `Not used: an extra set you didn't ask for.` |
| Bigger change (9 Oct) | `More than a small change: tap Apply to use it.` · `Built-in rule 100 kg × 6–8` → `Coach 90 kg × 6–8` (both **targets**) · `Why? ›` · `Not now` · `Apply` · applied `✓ Coach target applied to next Push A: 90 kg × 6–8` [Undo] |
| Based on edited sets (9 Oct) | `Based on set values you've since edited.` [Use built-in rule: 100 kg × 6–8] [Ask the coach again] |
| Used (9 Oct) | `Used in Push A, 10 Oct.` |
| Structural card (9 Oct, region 6b) | `Suggested change to Push A` · `Because:` + one of `you asked for more variety on 8 Oct.` · `you flagged pain on Overhead press.` · `your goal changed to Muscle on 9 Oct.` · `you now lift 3 days a week (was 4).` · `Main Gym's equipment changed on 9 Oct.` · `you switched to Hotel · Lisbon in this workout.` · scope `Push A from now on` · `Not now` · `Apply` · applied `✓ Applied to Push A from now on` [Undo] |
| Hidden coach line (9 Oct) | `Only the changes shown were made · 1 line hidden` |
| Coach agrees | `Coach agrees: 100 kg × 6–8` (a **target**) |
| Coach reviewing | `Coach is reviewing…` · VoiceOver on arrival `Coach set 2 targets for next Push A.` |
| Pain-blocked | `Not increasing: you flagged shoulder pain. Same target: 50 kg × 6–8` |
| In-workout adjustment line | `Coach adjusted sets 3–4 (RPE 10 on set 2)` (the trigger fact or `you asked`) |
| No change | `Same targets next time.` |
| Held (side lagging) | `Same target: 25 kg stack × 8–10` (a **target**) + the domain's fact naming the lagging side, e.g. `… within the effort limit, but the right side didn't (lowest 7 reps); holding.` |
| No feasible load | `No load target` + the domain's summary ending `Fix the equipment profile.` + [Update gym]. A null load reads "bodyweight" only for the `bodyweight` convention (or `added` with nothing added); otherwise "no load" |
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
- `calculateNextTargets(history, rule, equipment)` returns the changed targets and an explanation for each, with equipment bounds applied. It is always computed: it's the fallback when the coach is offline, gives no target or is undone (D21), and the comparison value (`Rule: …`, or "before" on a bigger-change proposal) on every coach row. (Review fixes) It implements playbook rule 7-F: the smallest achievable step, reps first when the step is over ~10% or at max, then hold, never an added set. Each result carries `pctChange` from `buildStepCard`. Until the build enforces the 10% limit (`maxLoadJump: null` today), `getRuleImplementationStatus` reports the gap (coaching-playbook PB15).
- `buildWorkoutSummary(sessionId)` also returns `nextTime[]`: `{exerciseId, builtIn, coachStatus: 'unavailable' | 'offline' | 'loading' | 'ready' | 'failed', coachTarget?: {actionId, after, pctChange, reason, guardNotes, status: 'saved' | 'undone' | 'used' | 'based_on_edited', rendered}, coachProposal?: {proposalId, after, reason, guardNotes, scope, status}, dropped?: [{kind, detail}]}`, and per exercise `adjustments[]` from the workout (coach-adjustments §6). (9 Oct, D21) `coachTarget` is a small change saved by default; `coachProposal` is now only for bigger changes. It also returns `routine {id, name}` for the heading, `structuralProposal?: {proposalId, signal: {kind, fact, at}, changes, reason, scope, status}` (region 6b) and `hiddenLines[]` for the coach note (coach-contract §6).
- (9 Oct, D21) The summary coach turn: `runCoachTurn` with the summary context and the tool `set_next_session_targets` (plus the structural proposal tools only when `getStructuralChangeSignals` returns a signal or Ben asked, coach-contract CC10). Its result goes through `validateCoachProposal`, then `classifyNextSessionChange` (coach-adjustments CA8). Small changes are saved with `applyCoachProposal(id, {kind: 'default_next_session', expectedVersion, opId})`: one transaction, one `actionId`, one `ActionRecord` with the reason, evidence and guard notes. Per-row Undo is `undoAction(actionId, {exerciseId})`; `Use coach target` is `reapplyCoachTarget`. Every row line and number is `renderActionResult` output (coach-contract CC1); the note and reasons go through `checkReplyClaims` (CC3).
- `correctSet` for edits (timing as above).
- (2026-10-09) `buildWorkoutSummary` adds `checkIn?: {checkInId, score, reasons, note?, recordedAtUtc}` and `painMentionedNotFlagged`; `updateCheckIn`, `deleteCheckIn`, `setPainFlag` (check-in.md §6). The summary coach turn receives this session's check-in labelled as Ben's words; `calculateNextTargets` never reads it.
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
7. Built-in rule values under `Next time` come from `calculateNextTargets` and match the domain unit tests. Every `Next time` value, from either source, is labelled as a target, carries a source tag and its % change from the last working load, and never exceeds equipment maximums.
8. Pressing `Done` while the coach note is loading returns to Today without an error. The note appears later in the session history.
9. (Revised 9 Oct, D21) A small coach next-time target is already saved when its row appears. The row shows the target with its %, the `Coach` tag, the coach's reason, `Rule: …`, `Why?` and Undo, under the heading `Next time · Push A`, and it never edits completed sets. A bigger change shows as a proposal with the built-in value as before, the coach value as after, Apply and Undo.
10. Editing the end time keeps the original timestamp in the audit, and the summary shows `(end time edited)`. (Ben, 25 Oct) Moving the start a week back moves every set and pause with it; the audit keeps the original start and the offset; `Times changed` [Undo] restores every time exactly.
11. Only `Done` is styled as primary. There are no animated elements.
12. Finish a workout with 2 of 4 prescribed bench working sets done, both at the top of the range. `Next time` shows `Same target` with the domain's "Only 2 of 4…; holding." fact, never an increase.
13. Deleted sets never appear in the exercise rows or counts. A unilateral Left + Right pair counts as one working set.
14. A unilateral exercise where the right side fell short shows `Same target` under `Next time` with the domain's fact naming the right side, never an increase.
15. An exercise whose equipment can make no load shows `No load target` with `Fix the equipment profile.` and [Update gym] under `Next time`, never "bodyweight".
16. With airplane mode on, every `Next time` row is tagged `Rule` and shows the rule's explanation; no row says `Coach` and no coach text appears.
17. (Revised 9 Oct, D21) With the coach connected, finishing makes exactly **one** coach call (note + targets). Its small changes are saved with no tap, and the next Push A plans them (the set card's `Why?` row `Set by` reads `Coach · after Push A, 8 Oct`, active-workout §2.12). Exercises with no coach target use the built-in rule's, tagged `Built-in rule`. The playbook screen reads 7-F `In use: when there's no coach target`, never "not in use".
18. A coach proposal of 98 kg on a 2.5 kg-step barbell shows 97.5 kg with `Rounded to 97.5 kg`; a proposal above a rack maximum shows the capped value and `Capped at …`.
19. With a pain flag active, a coach increase for that movement shows `Not increasing: you flagged … pain.` with no Apply or Undo, and nothing is saved for it.
20. (Revised 9 Oct, D21) `Undo` on the Bench press row → that row shows the built-in rule's target with `Use coach target`, the other coach rows are unchanged, and the next Push A plans the built-in rule's bench target. `Use coach target` puts the coach's back. `Undo all` reverts every coach row in one transaction, and its toast's Undo restores them.
21. (Revised 9 Oct) Correcting a set in Edit workout after coach targets were saved adds `Based on set values you've since edited.` to the affected rows; the saved targets don't change and no coach call is made until Ben taps `Ask the coach again`. A bigger-change proposal becomes `Out of date` (Apply hidden).
22. An exercise adjusted by the coach mid-workout shows `Coach adjusted sets 3–4 (…)` in its row; its logged values are the actual results, unchanged by the adjustment.
23. (2026-10-09) A workout with a check-in of 2 (`Tired`, note "Baby was up at 3") shows exactly `How you said you felt: 2 of 5`, `Tired` and the note in quotes under the title line, and no other check-in-derived text or number anywhere on the screen.
24. (2026-10-09; revised 9 Oct for D21) A skipped check-in leaves no line. Built-in rule targets under `Next time` are identical for the same logs with a check-in of 1, of 5, or skipped. If a saved coach target used the check-in, its `Why?` lists it as Ben's words (`You said 2 of 5`), never as a score.
25. (2026-10-09) Editing the check-in from the line versions it, shows in `Edit history`, and changes nothing else on the summary.
26. (2026-10-09) `Pain` picked with no movement flagged shows the pain prompt; `Choose movements ›` → flag Bench press sets a flag with source `check_in` and the prompt disappears.
27. (Review fixes) Lateral raise at 10 kg each with every set at the top of the range, on a rack whose next step is 12 kg: `Next time` shows the same load with more reps and `Next dumbbell is 12 kg, +20%: adding reps first.`, never 12 kg and never an extra set (on a build that enforces 7-F's limit; otherwise the PB15 card is shown on the playbook screens).
28. (Review fixes) Over three sessions at the rep cap with a +20% next step, the target holds at the same load, reps and set count, and the explanation names the step.
29. (9 Oct, D21) Stub the coach to return Bench 100 → 97.5 kg on a 2.5 kg-step bar: the row is saved with no tap and shows `−2.5%`. Return 100 → 90 kg instead: nothing is saved, the row is tagged `Built-in rule` with the proposal and Apply under it (coach-adjustments CA8).
30. (9 Oct, D1) Stub the coach to add a fourth set to Incline DB press when Ben hasn't asked for more sets: nothing is saved or offered for it; the row shows `No coach target for this one.` and `Why?` lists `Not used: an extra set you didn't ask for.`
31. (9 Oct, CA9) A workout with no request or signal never shows region 6b, and the provider request has no structural proposal tool. After Ben says "give me some variety on Push A" earlier in the week, the next Push A summary can show one card with `Because: you asked for more variety on …`; Apply changes Push A from now on, Undo restores it, and a voice "yes" doesn't apply it.
32. (9 Oct, CA9) A pain flag set on Overhead press during the workout is a signal. Any structural card's reason contains no diagnosis (instruction test), and a suggested swap never brings back a pain-flagged movement (the validator removes it, as workout-builder WB4).
33. (9 Oct, CA10) Tap `Done` while `Coach is reviewing…`: when the answer arrives, its small changes are saved; the summary in history shows them with Undo; starting Push A uses them. If Push A starts before the answer arrives, the answer's targets are dropped as stale and Push A uses the built-in rule's.
34. (9 Oct) With airplane mode on, every row is tagged `Rule` and no row says `Coach`. Back online before the next Push A, the coach's answer saves its small changes and the history summary shows them.
35. (9 Oct) Once the next Push A has started, this summary's coach rows read `Used in Push A, 10 Oct.` with no Undo.
36. (9 Oct, coach-contract) Every target number under `Next time` equals the saved `ActionRecord` value (same unit and convention). Stub the coach note to say "I've raised overhead press to 52.5 kg" while a pain flag blocks it: the sentence is hidden, the note shows the hidden-line note, and the row shows `Not increasing: you flagged shoulder pain.`
37. (9 Oct) `Undo` and `Use coach target` have ≥ 44pt hit areas, are ≥ `space.8` from `Why? ›`, and only `Done` is styled as primary, with region 6b showing.
38. (9 Oct) VoiceOver reads a coach row as "Bench press, coach target, 97.5 kilograms, 6 to 8 reps, down 2.5 percent. Rule: 100 kilograms." and the source is never conveyed by colour alone.
39. (9 Oct, D19) The `Next time` heading names the routine just done (`Next time · Push A`), and those targets are used the next time Push A starts, whether the rotation offers it or Ben picks it himself.

## 8. Components (9 Oct; for the design-system owner to merge, this spec doesn't edit design-system.md)

No new colours or timing tokens.

| Component | Spec |
|---|---|
| `CoachTargetRow` | The D21 default state of `CoachTargetProposal` (design-system §9.16), summary only. Rows: exercise name (`type.headline`) + `TargetSourceTag` `Coach`; `Target 97.5 kg × 6–8 · −2.5%` (`type.body`, tabular; % in `text.secondary`); reason in quotes (`type.callout`, 2 lines max, the rest in `Why?`); optional guard note (`type.callout`, `text.secondary`, `info.circle`; pain uses `exclamationmark.triangle` in `status.warning`); `Rule: 100 kg × 6–8` (`type.callout`, `text.secondary`); action row `Why? ›` (left) and `Undo` (right), `accent` text buttons, ≥ 44pt hit areas, ≥ `space.8` apart. Variants: **undone** (tag `Built-in rule`, line `You undid the coach's target.`, `Use coach target: …` text button), **based on edited** (`exclamationmark.triangle` + text, two text buttons), **used** (no buttons, `Used in Push A, 10 Oct.`). No animation when a row updates from `Coach is reviewing…` |
| `CoachTargetProposal` | Unchanged frame; now only for bigger changes. Adds the first line `More than a small change: tap Apply to use it.` |
| Region 6b | The existing `ChangeReviewCard` (design-system §9.11) with author `Coach`, a `Because:` line (`type.callout`, `text.secondary`) above the scope, and Apply as a secondary accent button so `Done` stays the only primary |
