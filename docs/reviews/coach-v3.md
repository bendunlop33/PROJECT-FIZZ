# Review: Coach v3 (branch `claude/coach-v3`, 3d1d51a..b596bb3)

**Verdict: CHANGES NEEDED**

Reviewer checks, run in `/home/user/wt-coach3`:

- `npm run typecheck` passes.
- `npm run lint` passes.
- `npx vitest run --maxWorkers=2` passes: 342 files, 6859 tests, 1 todo. This confirms the developer's inferred count.

All of this ran against a scripted model only. Nothing has run on Ben's iPhone or the real plan route, including `reasoning.effort`, the mid-workout model and the 30 s cap.

## What holds

- **Ben's report 1, "make it 40".** Traced through `coach-service.send`, `buildTurn`/`buildGym`, `createBuildExecutor`, `buildMinutesFor` and the draft card. The draft is stored as `Shoulders · 40 min` at the hotel gym, and the card shows that gym. A gym name Ben hasn't saved is refused and nothing is built. B2 covers what happens after the card.
- **Ben's report 2, "Too easy" and "Working set".** `lastLogged` and `lastWorkingSet` are in YOUR DATA. A chip tap with a working set applies with Undo. A chip after warm-ups only becomes an offer. A verbatim "Working set" applies with Undo. All three are tested through the app services on SQLite.
- **The quote can't be invented.** `quoteInWords` (`packages/coach/src/intent.ts:61`) matches whole words in order against this turn's message only. The model's own words never count. A quote that isn't found falls back to the word lists. `benAsked:false` always becomes an offer.
- **Future-scope veto.** `todayScopeRefused` runs before the ask verdict (`turn.ts:870`). The accept path can't reach it with future-scope words.
- **Offers apply exactly what was stored.**
  - `acceptEditOffer` applies the stored command with no model call.
  - The version is checked inside the write, after the operation-ID check. A double tap replays the first result; a stale offer is refused.
  - Tested across a restart.
- **`edit_today`.**
  - `planCoachEdit` reuses `validateTodayAdjustment`, `checkCoachAdd` and the swap checks.
  - It refuses set counts below the sets already done, and moves and removals of rows with no pending sets.
  - A refused structural op refuses the whole edit.
  - The reducer runs every step or none, with one version bump.
  - `revert_coach_edit` undoes each step, last first, or nothing. Sets logged since stay as logged (rule 2).
  - The assisted-machine maximum, the stack maximum, per-hand loads and kg/lb are tested.
- **Read cap.** `MAX_READ_CALLS = 4`, with a per-turn cache keyed by opId. Cached reads don't count toward the cap. The 6-step limit still bounds the turn.
- **Rule 7.** The 400 retry resends to the same model on the same route without `reasoning` (`plan-model-port.ts`). `think_harder` only moves to Ben's own main model on the same plan route. The mid-workout model can only be picked from the plan's listed models, and the app never picks one.
- **Builder v2 guarantees.** BD15 start/save, BD17 questions, the claim backstop, "one build per turn" and the typical-gym fallback are unchanged. The updated tests cover only the approved changes: minutes, the 600-character message and checked numbers.
- **No secrets** in the diff. Imported text and transcripts are still wrapped as data. `COACH-V3-PLAN.local.md` was deleted and never committed.

## Blocking

### B1. Accepting an offer skips pain flags set after the offer (rule 9)

`packages/coach/src/edit-today.ts:143-175` (`acceptEditOffer`). Its deps are `Pick<EditTodayDeps, 'store' | 'loadSession' | 'inputs' | 'onSessionChanged'>`, so it never reads pain flags. The only freshness check is the session version. A pain flag is a separate document: `workout-services.ts` `pain.flagMovement` saves it without touching the session, so the version doesn't move.

**Failure:**
1. The coach offers "bench +2.5 kg" or "swap to incline DB press", stored as `proposed` at version 7.
2. Ben taps `Pain` on bench in the workout's Adjust row. The flag is saved and the version stays 7. While the coach is `offline`, `WorkoutScreen.tsx:1280` sends no new coach turn, so the offer stays the last message.
3. Ben taps `Adjust`. The increase, or the swap to a flagged movement, applies.

Before v3, Adjust ran a fresh model call through `validateTodayAdjustment`, which held increases on pain. This is a regression.

**Fix:** at accept, read the active pain flags and the session's unspecified pain. Then either re-run `planCoachEdit` on the current aggregate with the stored ops and refuse unless the command matches, or refuse when any flag covers an exercise whose target rises, gets more sets, or is added or swapped to. Add a test: offer, then `flagMovement`, then accept, and assert it is refused and nothing changes.

### B2. A draft built at the hotel gym opens and starts at the current gym (Ben's report 1, only half fixed)

`apps/mobile/src/services/workout-services.ts:4790-4799`. Only the draft card reads `version.request.gymId`. `rg "request.gymId" apps/mobile/src` finds only the card and `buildGym`. Opening the draft, the overview dry-run and `start` all still plan at the selected gym (the developer's own open item).

**Failure:** Ben, at the hotel, gets `Shoulders · 40 min · Hotel gym`. He taps Open and Start. The workout runs at Main Gym: loads are snapped to Main Gym's dumbbell rack (rule 4, against the wrong gym), and the history is filed under Main Gym. Meanwhile the card he tapped said Hotel gym.

**Fix:** open and start a draft at its own gym (`request.gymId`) while that gym is saved and not archived. Show the gym on the overview with the existing gym switcher, and fall back to the current gym only when the draft's gym is gone. Add an app-level test: build at the hotel, open it, and check that the overview's gym and its loads are the hotel's.

## Should fix

### S1. The number check counts planned targets as logged sets (rule 6)

`packages/coach/src/numbers.ts:69,77`. `PAIR_JSON` takes every `"value":N … "reps":M` in the context JSON. That includes pending sets' `target` objects, not just logged `actual` values.

**Failure:** today's bench target is 105 kg × 8 and Ben has never done it. "Last time you did 105 kg × 8" passes the "set stated as done must be a logged set" check. The developer's summary says this case is caught.

**Fix:** build `pairs` only from logged results: `actual` in the workout context and the set lines of history and records reads. Keep targets as plain values. Add a test where the target pair is present and the past-tense claim is hidden.

### S2. An unlabelled load in Ben's newest message becomes the workout length

`packages/coach/src/build.ts:378-401` (`bareNumbers`, `buildMinutesFor`). `apps/mobile/src/coach/coach-service.ts:1141-1145` passes `benNumbers: bareNumbers(said)` on every build turn.

**Failure:** "Leg session, I want to work up to 140 on squat". The model says 60. `bareNumbers` gives [140], which differs from the model's number, so the draft becomes 140 min. Likewise "hotel room 215" gives 180.

**Fix:** let a bare number override the model only when the message is a revision of a draft in context or a follow-up ("make it 40", "40 instead"), or when the model gave no minutes. Add tests for both strings above.

### S3. The quote check proves the words are Ben's, not that he asked

`packages/coach/src/intent.ts:83`. Any two consecutive words of his message pass.

**Failure:** Ben types "Bench felt easy, what do you think?" The model sends `benAsked:true` with `benQuote:"felt easy"`, and the change applies at once. Ben asked a question, and rule 3 with his own 18 Oct words ("Agree on asking before changing") says the coach should offer.

**Fix (pick one, Ben to choose):**
- A verified quote counts only when it is the whole message (an answer such as "Working set") or when the word fallback also reads a request.
- Or keep the current rule, but record this weaker guarantee in ADR 0027 and add a test that fixes the chosen behaviour.

See also Spec issues.

### S4. "Adjust" on an offer with no stored edit applies whatever a new model call picks

`packages/coach/src/turn.ts:648-651,858,950-953`. An offer can come from the model's own `reply.offer`, or from `filter.noTodayToolHidden`, with no `proposed` edit stored. In that case `editOfferIn` returns null. The accept falls through to a model turn where `acceptedOffer` counts as asking for any sets-only edit.

Numbers are now allowed in replies, so the offer text can name loads ("Want me to drop bench to 55 kg?"), and the change that applies can differ (50 kg). That breaks the "offers apply exactly what was shown" guarantee.

**Fix:** either show `adjust_today` only when a stored `proposed` edit exists, or on such an accept run the edit as an offer again and ask for a second confirm. Add a test.

### S5. "Never ask which set" is only an instruction (Ben's report 2 can come back)

There is no code fallback. On a `too_easy` or `too_hard` chip with a `lastWorkingSet`, a model that replies with a question and no tool call reproduces build 156 exactly. Every test uses a compliant scripted model.

**Fix:** on a difficulty chip that has a working set and ends with no committed or proposed today-change, either apply the labelled built-in rule (as `offer-check.ts` does when the coach isn't ok), or turn the reply into an `adjust_today` offer backed by the rule's change. Test it with a non-compliant model.

### S6. A gym named in an older message keeps steering builds

`apps/mobile/src/coach/coach-service.ts:1198` (up to 6 earlier messages from Ben) and `:875` (`gymNamedIn` over newest and earlier words).

**Failure:** two days after the hotel trip, in the same thread, Ben says "build me a leg day". It is built at Hotel gym, dumbbells only, because the old message still names it.

**Fix:** use earlier messages only within the current build request or draft chain (`buildQuestionChain`/`followUp`/draft in context), not the whole thread. Add a test.

### S7. A mid-workout model missing from the plan is not shown and fails every live turn

`packages/providers/src/openai/connection.ts` (`textCoachState`) and `apps/mobile/src/ai/coach-connection-view.ts`. Settings keeps showing `Mid-workout: <name>`, and the AI status stays ok. Every live-workout turn then fails with `model_gone` (the developer's open item 4).

**Fix:** when the model list refreshes, mark a missing workout model as unavailable in the row ("not available"), and show the turn error as the mid-workout model being gone. Never silently use another model.

## Nits

- **N1.** `packages/domain/src/session/coach-edit.ts:174`: `pending.slice(pending.length - n)` uses only unpaired pending sets. If fewer of those exist than need removing, the slice start goes negative and removes the wrong number, while the line still says `4 → 1 sets`. Refuse when `n > pending.length`.
- **N2.** The "Working set" answer turn runs with `intent: 'general'` (nearest rounding), not the `too_easy` rounding of the original tap (developer open item). Carry the intent from the question's turn.
- **N3.** "make it 40" makes a new draft instead of a new version of the thread's last draft, so two drafts sit in the thread.
- **N4.** `recordReasoningCapability` is per model, not per effort. A model that rejects only `low` is marked `rejected` for every effort.
- **N5.** `undoMove` refuses the whole edit's Undo after any change in row order, including a manual add. All-or-nothing is by design, but the Undo error should say why.
- **N6.** `selectWorkoutModel(slug=null)` rebuilds settings field by field, so any future settings field is silently dropped. Use `{ ...s }` and delete the two keys instead.
- **N7.** Earlier commits don't typecheck on their own (developer note). This is fine for a branch, but squash or check before merging if bisectability matters.

## Tests: gaps

The tests cover the happy paths, stale versions, duplicate taps and restarts well. Missing:

- B1: pain flag set after the offer.
- B2: open and start of a draft built at another gym.
- S1: target pair against a "you did" claim.
- S2: unlabelled load in the newest message.
- S3: statement vs request quote.
- S4: an offer with no stored edit.
- S5: a non-compliant model on a difficulty chip.
- S6: stale gym name in the thread.

## Spec issues

- **SP1.** ADR 0027 / CHANGELOG 18 Oct, "the model decides whether Ben asked". The quote check only bounds the model to Ben's words, not to a request (S3). Ben should confirm whether a statement with no request ("felt easy") may apply a change at once, or must stay an offer. As written, it conflicts with CLAUDE.md rule 3: "When the coach raises a change on its own, it offers".
- **SP2.** `docs/design/workout-builder.md` is out of date:
  - BD1 (line 47) still says `propose_workout` has "no minutes, gym or equipment field".
  - §6 (line 165) and §8 (line 455) still say the message is ≤ 240 characters.
  - No design spec covers `edit_today` (swap, add, remove, move, set count), its offer card, the history reads, or the Settings "Mid-workout" row.

  CLAUDE.md's slice order (design → build → review) was skipped for these. The designer should update or add them before the device test.
- **SP3.** Ben's "gauge itself whether it's needed or if a lighter model can be used" is built as a Settings choice: "Same as coach" by default, plus a `think_harder` step up. The coach never chooses a lighter model itself. This is reasonable, but it is a reading of his words. Confirm it with Ben.
