# Review: B3 Wave 3: weekly auto-review, Progress › Reviews, How did it feel? (truth lens)

Branch `claude/b3-wave3-21oct` (f8220ad..960ea35). Spec: `docs/design/workout-builder-v3.md` §6, §6.1, §6.2 (Goal bullet, Ben 21 Oct). Lens: rules 6 and 1 first, then rules 5, 9 and 10, caching, and the one sets-per-muscle convention.

**Verdict: CHANGES NEEDED**

## What I ran

- `npm run typecheck`: clean.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: clean.
- `npm run check:migrations`: "Migrations OK: 1 to 32".
- Targeted vitest (8 files: domain weekly and feel, coach weekly, persistence review data and feel migration, mobile service, app and screens): 51/51 pass.
- I ran temporary probe tests in `packages/coach/test` and `packages/domain/test` and deleted them afterwards. Their results are quoted below.

## What holds up

- There is no projection line or predicted date anywhere. The target is a level line through `trendLayout.targetY`, and the coach instructions say "Never predict".
- The est. 1RM is labelled on fact lines, chart headers and VoiceOver words. The stored `lift_trend` keeps `estimate` apart from the set's real load.
- Offline or not connected stores the facts only, as `Not reviewed · Offline` or `Coach not connected`, with no canned text. `retry_coach` re-asks when the inputs are the same and the coach part isn't settled. A later offline open writes nothing.
- Proposals: Apply is a versioned routine write with an `update_routine` record. A stale template is refused and marked `stale`, and Undo is refused once the template has changed since (both tested).
- Reviews and `sessions.feel` survive a backup round trip, appear in the Your data export but not the Coaching knowledge export, and are removed by Delete my data (`packages/persistence/test/weekly-review-data.test.ts`).
- Sets per muscle reuses an existing builder convention (direct, lead primary muscle, full credit; see S6 for the choice between two).
- `set_feel` is versioned, idempotent, allowed only on a finished workout, and changes no set (rule 2).

## Blocking

**B1. The claim check lets an est. 1RM through as a lifted load, so rule 6 fails in the coach text.**
`packages/coach/src/builder/weekly.ts:52-58` pushes every e1rm point value (`p.value`) into the exercise's `loads`, the same list as real set loads. The estimate check at `claims.ts:188` only fires when the sentence says "1RM" or "max". Probe with Bench e1rm points [108, 111, 114]: the coach writes `Bench press is up to 114 kg.` and `Bench press reached 114 kg for a single.` Both are **shown**, but Ben never lifted 114 kg.
*Fix:* keep e1rm values in a separate `estimates` list on the entity. In `claimSentenceOk`, accept a load that matches only an estimate when the sentence also says est./estimate/1RM. Otherwise hide it. Add these two sentences as test cases.

**B2. Session counts in coach text are checked against one pooled set of numbers, so wrong counts pass.**
`weekly.ts:73-74` puts `week.done`, `planned`, `workouts`, `rpe.sessions`, the feel counts, stalled counts and edit counts into a single `sessions` set. Any number followed by "sessions", "workouts" or "days" passes if it matches any of them (`claims.ts:289`). Probe (2 of 3 done, 1 missed, no feel taps, 1 repeated edit over 2 sessions): `You missed 2 sessions.` and `You did 2 hard sessions.` are both **shown**. Ben tapped Hard zero times. That is an invented signal in exactly the place the brief says code checks every number.
*Fix:* make the claims entity-scoped, as loads already are. `hard|easy|good` → the feel counts. `missed` → planned − done. `stalled`/`no new best` → the stalled count. Bare `N sessions` → done, planned or workouts only. Add the probe sentences as test cases.

**B3. The RPE drift fact compares RPE averaged over all sets with a target averaged only over sets that had one.**
`packages/domain/src/review/weekly.ts:546-560`. Probe: bench 2×5 at RPE 8 with target 8, and curls 2×10 at RPE 10 with no target. The card shows `RPE 9 · target 8`. That reads as drift on the very sets that hit their target exactly, and the coach is told to judge it. This is a code fact, not a coach slip, so rule 6 fails at the source.
*Fix:* when a target is shown, take the mean only over sets that have a `targetRpe`, and store the plain mean only when no set had a target. Better still, report "sets above target / with target". Test the mixed case.

**B4. Missed days are named wrongly when days are paused, and the stored view names days missed that the live view doesn't.**
- `weekly.ts:493` lists every plan day not done once `done < planned`. Probe (3-day plan, 2 paused days, 1 done): planned is 2, yet it names **two** missed days (`Back`, `Legs`) when one is missed.
- `views.ts:96` (`weekDataOfReview`) recomputes `missed` from the stored dots with no `done < planned` check. Probe (3-day plan, 2 paused days, 2 of 2 done): the live view shows nothing missed, but the stored review shows `Missed: Legs`. The Latest card (`weekly-review-service.ts:443-445`), the history row (`views.ts:263`) and the full review all read the stored view. So a deload week where Ben did everything planned shows up as a miss. Spec §6.2 says "missed planned days named".
- A Sunday-evening review (incomplete week) is also read back with `complete: true` (`views.ts:92`), so days still to come are named missed.
*Fix:* store `missed` as its own fact, for example `{ kind: 'week_missed', names }`, computed only when the week is complete, and read it back as stored. When days are paused, name at most `planned − done` days, or name none and show `n of m` only. Test the paused-day and Sunday-evening cases on the stored path.

**B5. A plan tweak can be applied to an exercise that was pain-flagged after the review (rule 9).**
`checkWeeklyReview` and `repeatedEdits` exclude pain-flagged exercises only when the review is built. `applyProposal` (`weekly-review-service.ts:498-543`) never re-checks pain flags, and `inputsHashOf` (`:295-297`) doesn't include them, so a new flag doesn't re-run or supersede the review. Scenario: on Sunday the review offers `Bench on Chest: 3 → 4 sets`. On Monday Ben logs shoulder pain on bench. On Tuesday the card still offers Apply, and tapping it adds volume to the flagged movement.
*Fix:* in `applyProposal`, read `painFlags.listActive` and refuse when the exercise is flagged. Mark the proposal `stale` (or add a `blocked` state) and show `Out of date`. Add the active pain-flag exercise IDs to the inputs hash. Test it.

## Should fix

**S1. `was → now → target` doesn't say "est."** `views.ts:161-165` returns `was 110 → now 122.5 → target 130 kg` for a 1RM target (probe). Both `was` and `now` are estimates, and `was.isEstimate` is available but unused. The chart header above labels it, but this line is often read alone, by VoiceOver and in a table. *Fix:* `est. 1RM was 110 → now 122.5 → target 130 kg` when `metric === 'e1rm'` or `was.isEstimate`. The same applies to the history row's spark words (`views.ts:266`).

**S2. With a days-a-week aim, "planned" grows to match what was done.** `weekly.ts:360` sets `planned: Math.max(days, input.aim)`. Probe (aim 3, 4 days trained) gives `4 of 4 sessions`, while the existing consistency card shows `4/3` (`plan-tracker.ts:334-345`). Paused days also don't reduce the aim here, though they do on the card. The developer says this matches the consistency card, and for aim weeks it doesn't. *Fix:* reuse `weekOf`/`aimWithPause` from `plan-tracker` for aim weeks.

**S3. A force-close during Apply or Undo leaves the proposal stuck.** Each tap gets a new `opId` (`ReviewsSection.tsx:91-97`).
- If the app dies after `applyRoutineChange` but before the `:mark` write, the next Apply has a new opId. `prior` is null, the version has moved, so `markStale` runs and the template change is live with no Undo on the card.
- Undo has the same problem: `undoRoutineChange` returns `already_undone`, which is shown as "Can't undo: … changed since", and the proposal stays `applied` with an Undo button.

*Fix:* before writing, look for a committed `update_routine` action whose `routineId` matches and `versionBefore === p.change.expectedVersion`, made by this review, and mark the proposal applied. Map `already_undone` to marking it `undone`. Test both cases.

**S4. A coach that keeps failing is called on every return to the app.** `failed` is never settled (`reviewCoachSettled`), so `Root.tsx` foreground → `runOnOpen` makes a new high-effort call every time, for example on invalid tool arguments. That spends Ben's plan quota. *Fix:* after a `failed` result, don't retry until a minimum interval has passed (for example 6 h) or the inputs change. Store `lastAskedAtUtc` on the review.

**S5. Plan sets per muscle come from the current plan's templates, even for a week under an older plan.** At `weekly.ts:509-516`, if `current.plan` is an older plan, no templates match and every group shows `plan 0` instead of no plan line. *Fix:* when no template matches `plan.planId`, set `planned` to null.

**S6. Two builder conventions exist, and the choice needs Ben.** The builder's visible coverage (`packages/coach/src/builder/focus.ts:53-65`) gives half credit to other foci, and the weekly review reuses the direct, full-credit-only `groupSets` (`review.ts:56`). The two numbers will disagree on screen. For example, the builder shows Triceps 6 (half credit from pressing) where the weekly review shows Triceps 2. Tests pin "nothing to secondaries" (`weekly-review.test.ts:154`). This is acceptable as "reuse one existing convention", but say so to Ben, and decide whether the goal ranges (6–20) assume fractional counting.

**S7. The Feel tap can fail silently.** `FeelRow.tsx:41` sends `expectedVersion` from when the row loaded. If anything else on Summary bumps the version first (rename, duration, note), the tap returns `stale_version`, nothing is shown, and the row just reloads. *Fix:* re-read the version and retry once, as `changeProposal` does, or show `Couldn't save`.

**S8. Tests are missing for:**
- B1–B5.
- The stored-view `missed` under pause or partial week.
- Force-close between Apply and mark.
- Pain flag added after the review.
- Aim weeks with more days than the aim.
- A coach that keeps failing (no backoff).

## Nits

- N1. A `stale` code proposal is carried forward by `routineId|exerciseId` (`weekly-review-service.ts:340-342`), so the same repeated-edit suggestion is never offered again after the template changes.
- N2. Lift targets in a different convention from the newest logged set are silently not drawn (`weekly.ts:440`). Consider a short "target in other units" note behind Why?.
- N3. Weeks when the app wasn't opened never get a review (only the latest due week is run), which leaves gaps in History. That is acceptable, but note it for Ben.
- N4. `weekDataOfReview` sets `basis: 'plan'` for aim weeks too (`views.ts:89-93`, `sessions_vs_plan` exists for both), so stored aim weeks lose their placeholder dots.
- N5. `requests.ts:93` has a stray blank line.

## Spec issues

- **SP1.** §6.2 says "missed planned days named". Plan days are a flexible weekly set and aren't tied to dates, and pauses are dates. So with pauses there is no correct way to say *which* day was missed. The spec should say whether to name days only when nothing is paused, or to show counts only.
- **SP2.** §6.1's "RPE drift vs target" doesn't define the comparison set (see B3). Propose "sets above their own target RPE, of sets with a target".
- **SP3.** The spec doesn't say which builder volume convention (full credit, or half for secondaries) "sets per muscle vs range" uses, and the playbook ranges depend on it (S6). Ben should decide. The proposed goal bands (muscle 6–20, strength 4–10, both 6–20) also need his confirmation.
- **SP4.** §6.1's "3 stalled sessions flag" and "repeated same edit" thresholds (developer chose 3 and 2) are not in the brief or spec. They need Ben's approval and a CHANGELOG entry.
