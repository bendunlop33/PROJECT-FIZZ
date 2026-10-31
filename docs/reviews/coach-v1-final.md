VERDICT: CHANGES NEEDED

# Review: coach v1, final (branch `claude/coach`)

Reviewer, 10 Oct 2026. Range: `git log claude/gracious-knuth-joxqpw..HEAD` (49 commits, 121 files, +19.7k/−86). Checked against CLAUDE.md rules 1–10, ADR 0019, coach-contract, coach-adjustments, coach-sheet, coach-memory, and the PM decisions of 10 Oct: honesty is structural, merge the latest main first, and leave clean seams where active-set or gym-switch aren't on main.

## What I ran

- `npm run typecheck`: pass. `npm run lint`: pass.
- `npx vitest run --testTimeout=120000`: **152 files, 3201 passed, 2 todo, 0 failed.**
- Trial merge of `claude/gracious-knuth-joxqpw` into HEAD, in a throwaway worktree that I then aborted. It conflicts in 8 files (see B1).
- A probe of 26 reply sentences × 2 ledgers through `createReplyFilter`, plus 10 request phrasings through `classifyBenRequest`. The probe file was temporary and is deleted.
- Repo scan: there is no key, token, `.env` or credential file on the branch. Tokens are read only from the Keychain vault (`coachConnectionPorts`).

## What holds

- **Structural honesty (PM decision 1) is implemented.**
  - Every model step must call exactly one function (`tool_choice: 'required'`, `parallel_tool_calls: false`).
  - Text reaches Ben only as `reply.message`. Changes reach him only as cards rendered from committed `ActionRecord`s.
  - The workout slot (`slot-view.ts`) never shows model words at all, only the saved record or a fixed outcome line.
  - A sentence that states a change is kept only when it cites that change's `[[ref]]` and matches it. Everything else is dropped whole, never rewritten.
  - `No change made.` is structural: Ben asked, and the turn produced no card.
  - In my probe, 21 of 26 change-shaped sentences were hidden with or without an uncited live change. The 5 that were kept are in S3.
- **Rule 2.** `adjust_pending_targets` refuses any set that isn't pending (`set_not_pending`). Undo restores only sets that still carry this action's target.
- **Rule 3.** Ben's request applies at once with a banner and Undo. A coach-raised change is only an `offer` and is gated on acceptance. Small next-session changes are saved by default with Undo; bigger ones come back `proposed`.
- **Rules 4 and 5.**
  - Snapping, equipment caps and the machine max are tested (per-hand, assisted, kg vs lb).
  - Writes are version-gated: the reducer checks `expectedVersion`, and the store's next-target commit checks `sourceVersion`.
  - opIds are semantic hashes. Each record is written in the same transaction as its change. A replayed turn ID sends nothing.
- **Rule 7.** There is no paid route anywhere, and no error path changes the route.
- **Rule 8.** Your data goes to the model as quoted JSON in a labelled developer message. The gate reads only Ben's own input.
- **Rule 10.** Coaching knowledge and Your data are separate blocks. Playbook candidates have no owner and are never used until approved.
- **Offline (rule 1).**
  - Logging never waits for the coach.
  - Rest-card offers are a pure check (tested: 10 normal sets make no AI call and show no offer).
  - `Pain` flags offline.
  - The Summary falls back to the labelled built-in rule.
- **Device crash risk.**
  - The coach UI uses no Reanimated, worklets or Skia, and only a static elapsed label. I found no ES2023+ APIs that Hermes lacks.
  - Streaming uses `expo/fetch` with a reader. That's the same path S1 proved.
- **Force-close.** A turn left `running` becomes `interrupted` at launch, and its committed cards stay. The `⋯` → `Undo coach change` action survives a restart through `planned.coach`.
- **Minimal copy.**
  - Status is one or two words, with explanations behind `Why?`.
  - There are no reassurance lines and no rule labels in the main UI.
  - The model's reason appears in quotes only behind `Why?`.

## Blocking

### B1. The branch isn't merged with current main. Migration 5 and ADR 0019 are both double-booked.

PM decision 2 asks for the latest main to be merged first. Main has since gained 34 commits (the gym switch is merged, PASS). A trial merge conflicts in:
- `packages/persistence/src/migrations.ts`
- `packages/domain/src/session/{reducer,active-view,repeat}.ts`
- `packages/schemas/src/{session,commands}.ts`
- `packages/persistence/test/pain-retract.test.ts`
- `apps/mobile/src/screens/workout/WorkoutScreen.tsx`

The two collisions:
- **Migrations.** `packages/persistence/src/migrations.ts:30` registers `sqlMigration(5, 'coach', …)` (`schema/0005-coach.ts`). Main registers `sqlMigration(5, 'gym-switch', …)` (`schema/0005-gym-switch.ts`).
- **ADRs.** `docs/decisions/0019-coach-v1.md` and main's `0019-gym-switch-and-shared-resnap.md` share a number.

**Failure scenario.** Ben runs a main build, so his database is at `user_version` 5 with the gym-switch tables. He then installs a coach build that still numbers coach as 5. The migrator treats the database as current, so `coach_threads`, `coach_actions` and `next_session_targets` don't exist. The first `Ask` fails, and so does `nextTargetsOf` → `listNextTargets`. That one is caught as `[]`. `startTurn` is not caught, and a summary turn's store write throws.

There is also a correctness risk: the reducer and schemas conflict in the same functions the gym switch rewrote. Examples are the `TargetSource` union, the rule-4 reducer check for slots with no item, and `snapPlanToGym` in Repeat and Start.

**Fix.**
1. Merge `claude/gracious-knuth-joxqpw`.
2. Renumber coach to migration **6** (`0006-coach.ts`) and the ADR to **0020**, and update every reference in ADR 0019 §9 and the build log.
3. Add a migration test: a populated schema-5 database (with gym-switch rows) migrates to 6.
4. Route the coach's next-session targets (`withCoachTargets`) through main's `snapPlanToGym`, so a coach target saved at gym A is re-snapped when the next workout starts at gym B (rule 4). Today `withCoachTargets` (`packages/domain/src/coach/next-session.ts:275`) copies `row.target.load` as is.
5. Add `adjust_pending_targets` to main's reducer rule-4 check, so a coach load is refused on an exercise with no equipment left.
6. Re-run the full suite after the merge.

### B2. A body-part word is matched as an exercise name, which defeats the "block everything" pain fallback (rule 9)

The bug is in `apps/mobile/src/coach/coach-service.ts:100-109` (`namedExercises`): it counts an exercise as named when its **first word** of 4 or more letters appears anywhere in Ben's message. Many first words are body parts: `back` (Back squat), `chest` (Chest-supported row), `calf` (Calf raise), `shoulder` (Shoulder press).

`validateTodayAdjustment` blocks increases on **all** movements only when `messagePain.exerciseIds` is empty (`packages/domain/src/coach/adjust.ts:266`). Otherwise it blocks only the named ones.

**Failure scenario.**
1. The workout has Back squat and Romanian deadlift.
2. Ben types: "back's a bit sore, add 5 to the deadlifts".
3. `classifyPainMention` returns `unclear`.
4. `namedExercises` returns `[Back squat]`, matched from "back". "deadlifts" matches neither `romanian deadlift` nor its first word.
5. The RDL increase passes the guard and applies with a banner. Progression continues on a movement that loads the area Ben just said is sore.

**Fix.**
- Match only whole exercise names or their catalogue aliases, never a lone first word that is also a body part. Reuse `painBodyPart` and the CM6 anatomy list to exclude those words.
- Keep the conservative fallback: when the message has a pain or unclear mention and the names are ambiguous, use `exerciseIds: []`, which blocks everything.
- Add tests for "back's sore, add 5 to deadlifts", "chest is tight, more on flyes" and "calf is cramping, heavier squats".

## Should fix

### S1. The offer fires for an exercise that has no pending set left
`apps/mobile/src/coach/coach-service.ts:406-407`: the comment says "this exercise has no pending set left", but the code checks `a.sets.some(s => s.status === 'pending')` across the **whole session**.

**Failure scenario.** Ben logs the last bench set at RPE 10 while squats are still pending. The rest card offers `Adjust`. On accept, `chipForTrigger` sends `too_hard` with no exercise, and the model is free to lighten the squats, which Ben didn't find hard.

**Fix.** Filter by `set.sessionExerciseId`. Pass the trigger's exercise into the chip input or the context so the tool's scope matches the offer. Add a test.

### S2. Next-session targets: the Undo window and late answers end at *any* workout, not the next one from this source
`packages/persistence/src/coach.ts:182-186` (`startedSince`) treats any later session as "used". It's applied in `setNextTargetStatus` (line 555) and in the summary commit (line 385). coach-adjustments §284 and ADR 0019 §5 say "until a workout starts **from that source**" (or that routine's next session).

**Failure scenarios.**
- Ben finishes Push A, does Pull A the next day, then opens Push A's Summary. `Undo` on a coach row returns `Already used.`, but the target hasn't been used and will apply at the next Push A. Rule 3's one-tap Undo is gone while the change is still pending.
- A summary turn that answers after Ben has started an unrelated workout is refused as stale.

**Fix.** Treat a row as used only when `usedBySessionId` is set, or when a session started from this source or this routine exists. Test both scenarios.

### S3. A discarded workout consumes the coach's targets
`apps/mobile/src/services/workout-services.ts` (routine start and `Start next session`) calls `markNextTargetsUsed` fire-and-forget and outside the start transaction. `withCoachTargets` then skips any row with `usedBySessionId !== null`. Discard never clears it.

**Failure scenario.** Ben starts Push A (the coach's 97.5 kg target is used), discards it by mistake, and starts again. The second start silently plans the built-in rule's value, and the Summary row shows `Used`.

**Fix.**
- Mark the rows used in the same transaction as the start.
- Ignore or clear `usedBySessionId` when that session is discarded.
- Test discard-then-restart and force-close between start and mark.

### S4. Rule 6: there is no history in context, but `How am I doing?` is offered on Today
`get_recent_training`, `get_gym_equipment` and `get_progression_targets` have no executors in this build, so they are withheld (`turn.ts:186`). `NOT_AVAILABLE` (`packages/coach/src/context.ts:197`) doesn't list history. `contextInput` passes `catalogue: []`.

Yet `starterChips` (`apps/mobile/src/coach/sheet-view.ts:85`) offers `How am I doing?` on Today, where the context has no workout at all.

**Failure scenario.** Ben taps `How am I doing?`. The model gets no data and isn't told that history is missing, so it answers with plausible invented trends.

**Fix.**
- While the read ports are missing, add "Training history before this workout: not available" to `notAvailable` (and to `What the coach can see`).
- Drop or replace the Today starter chip until `get_recent_training` exists.

### S5. Gaps in the backstop that remain with structural honesty
In my probe these were **kept**, with and without an uncited live change:
- "Also sorted your knee." (already known)
- "Squat stays where it is for the rest."
- "Next push day you start on 100."

The last one is the worst. In a workout or general turn, nothing was saved for next time. On the Summary, it would sit as the coach note beside a `Next time` row that shows the built-in rule's different value.

`askPain` covers the knee case for rule 9 *during a workout* only: `CoachSheetScreen` requires `workout?.active`.

**Fix.**
- Treat future-state statements ("next <session> you start on N", "stays where it is", "X is at N") as claims that need a token.
- On the Summary, drop any coach-note sentence with a number about an exercise that has no matching `next_session_targets` row.
- Show `Sore or pain?` outside a workout too (it can flag the named movement or ask which one).

### S6. The CA4 offer log is in memory only
`offerLogs` is a `Map` in `createCoachService` (`coach-service.ts:117`). ADR 0019 §4 says "a stored offer log" (`coach_offers` in §9; not created in migration 5).

**Failure scenario.** After a force-close or relaunch mid-workout, the same offer for the same exercise and kind comes back. That is the "constant" coaching ADR 0006 rules out.

**Fix.** Store the offer log (a small Your-data table or a session field), or record the cut in ADR 0019 §10 for Ben.

### S7. `askedForMoreSets` ignores negation (D1)
`coach-service.ts:241`: `/\b(more|extra|another|add (a|one))\b.{0,20}\b(sets?|volume)\b/` matches "I don't want any more sets" and "no extra sets please". That opens +1 set next session against Ben's words. Use `classifyBenRequest` (which handles negators) or add a negation check, and add tests.

### S8. Path B′ (check-in offer) isn't wired and isn't listed as cut
`evaluateCheckInOffer` (`packages/domain/src/checkin.ts:167`) has no caller in `apps/mobile`. The `lighter_session` chip exists, but nothing raises it. Either wire it (the first set card's slot in Ready, before any log, never spoken) or list it in ADR 0019 §10 as deferred, pending Ben.

## Nits

- **N1.** Several Undo paths have no `catch`, so a store error becomes an unhandled rejection and the slot or sheet keeps its old state:
  - `WorkoutCoach.tsx:123` (`undo`);
  - `CoachSheetScreen.tsx` `undo()`;
  - SummaryScreen's `Undo all`.
  Show `Couldn't undo.` instead.
- **N2.** `WorkoutCoach.tsx:84`: the catch-all `Couldn't reach the coach. Nothing changed.` is wrong if the error is a store failure after a commit (for example `appendMessage` throws). Read the turn's actions before saying "Nothing changed".
- **N3.** `CoachSheetScreen` reloads the whole workout aggregate from SQLite every second for the workout bar. Compute the bar from the loaded rest deadline, or reload on `useDataChanged` only.
- **N4.** `\p{L}`/`\p{N}` with the `u` flag (`packages/coach/src/reply.ts:120,192`) appear for the first time in app code. Confirm on the device that Hermes in SDK 57 accepts them (the build would fail at load if not), or use an ASCII and Latin-1 class.
- **N5.** `valueChangeGuard`'s `setTimeout` in `WorkoutScreen` is never cleared on unmount.
- **N6.** Backups carry `playbook_candidates` (Coaching knowledge) in the same per-table snapshot as Your data. That's acceptable for a full-device backup, but `Delete my data` (not built) must leave them, and an export must label them separately (rule 10).
- **N7.** A summary turn cut off by a force-close is never retried (`runSummaryTurn` skips any thread with a summary turn). That's acceptable, but the Summary should show `Interrupted` rather than nothing.

## Tests

The suite covers the happy path and most guardrails: kg/lb, per-hand, assisted, machine max, completed sets, stale versions, duplicate opIds, replay by turn ID, restart recovery, timeouts and Stop, 10 normal sets with no AI call, and offline Summary labels.

Missing, matching the findings:
- body-part words as exercise names (B2);
- an offer on an exercise with no pending sets (S1);
- Undo after an unrelated workout (S2);
- discard-then-restart (S3);
- a schema-5 (gym-switch) to 6 migration after the merge (B1);
- negated "more sets" (S7);
- future-state claims (S5).

## Spec issues (for Ben and the PM)

1. **ADR 0019 is still `Proposed`, with several items marked Needs Ben**: the v1 cuts, `add_playbook_candidate` needs (`none` vs `ben_request`), the structural `No change made.` rule, and CC4 changed from "replace" to "drop". The code implements the PM decision, so the contract text (CC4) and ADR status should be updated once Ben approves.
2. **Device proof is still outstanding.**
   - S3: strict function tools with `tool_choice: "required"` on the plan route have never run.
   - S4 and S5 haven't been run.
   - The JWKS signature check hasn't run on the iPhone. ADR 0012 says this must close before the coach ships.
   - `COACH_CHAT_IN_BUILD` is already true, so the next build calls the route. That's honest, because failures map to statuses, but nothing here may be called working until C9.
3. **Ownership of the claim-pattern backstop.** It is now 1,246 lines (`packages/coach/src/claims.ts`) and still doesn't converge (S5). With honesty structural, Ben and the PM could decide to cap it: keep the token rule and the structural no-change line, and stop adding phrase rows, accepting that rare advice-shaped claims stay visible next to cards that are always true.
4. **Summary chat can't change next-session targets.** `What should I change next time?` on the Summary runs as a `general` turn, so `set_next_session_targets` isn't available. If Ben then says "do that", he gets `No change made.` The spec should say whether a Summary chat may revise the D21 targets.
