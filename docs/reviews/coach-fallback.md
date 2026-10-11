# Review: coach fallback for today's remaining sets (build 108)

**Verdict: CHANGES NEEDED**

Reviewed: `claude/coach-fallback` (`a3610bf`) against `claude/gracious-knuth-joxqpw`. That is 5 commits and 24 files: trigger F1, `evaluateSessionAdjustment` F2, service and UI wiring F2/F3/F7, the correction re-check F4, the Summary hold F5, and the CA5/CA6 spec edits.

Read: CLAUDE.md (rules 1–10, minimal copy), `docs/reviews/coach-fallback-diagnosis.md`, `docs/design/coach-adjustments.md` (CA4–CA6, §4.2, new §4.8, §5 copy, §7 checks), and `@react-navigation/routers` 7.6.4 `StackRouter` NAVIGATE.

Ben's report: "I just tried to do way fewer reps than stated and coach still didn't change sets for the set or session."

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | Clean |
| `npm run lint` | Clean |
| `npx vitest run --testTimeout=120000` | 196 files, 3901 passed, 1 todo, 0 failed |
| Scratch: `StackRouter` fed `Tabs → navigate Workout → navigate EditSet → navigate('Workout', { corrected })` | `Tabs > Workout > EditSet > Workout`. This confirms B1 |

## What is solid

- **Ben's case is fixed in every connection state.** With 62.5 kg × 3–6 and 2 reps, the reachable coach offers. Not signed in, or `Offline`, shows the rule's offer `Next sets: 57.5 kg × 3–6 [Rule]`. In (b1), when the Adjust turn fails on the network, the rule's offer replaces the failure line. Tests on real SQLite cover all four states (`apps/mobile/test/coach-fallback.test.ts:92–185`).
- **Rule 3 (offer, apply only on Adjust, Undo, reason, label).**
  - `checkOffer` only *returns* an offer. Nothing is written to the session until `applyRuleOffer`.
  - The write goes through the same `adjust_pending_targets` command as the coach's, with an `ActionRecord` (author `checks`, `turnId: null`) and the reason as app text.
  - Each changed target is `source: built_in_rule` with a `rule` provenance. `Why?` reads `Built-in rule · …`, never `Coach`.
  - The banner says `Adjusted sets 2–3 [Rule]`, the menu says `Undo change`, and after Undo it reads `Change undone.`
  - With no network or AI, no model request is made (`model.requests` stays empty).
- **Rule 4 (achievable).**
  - The load step is `roundToAvailableLoad(…, 'easier')` from a 5% drop. If that would be more than 10% lighter, or there is nothing lighter (equipment min, empty bar, bodyweight), it falls back to fewer reps.
  - Assisted machines get one assistance step. A raise uses `stepLoad` and is capped by the max.
  - Every result passes through `validateTodayAdjustment` *before* it is shown, so the offer text is exactly what gets written.
  - Tests cover per-hand dumbbells, stack, lb equipment, assisted, equipment min and max, and bodyweight (`packages/domain/test/session-adjust.test.ts:193–298`).
- **Rule 2 (completed sets untouched).** Only `pending`, non-warm-up sets of the triggering exercise are changed. A too-hard intent never raises (the `isIncrease` guard). Set 1 keeps its 2 reps and 62.5 kg (test `:117–118`). Undo after set 2 was logged restores only set 3 and reports `alreadyLogged: [2]`.
- **Rule 5 (idempotent, stale rejected).**
  - The opId is `built-in-adjust:<triggerId>`, so a double tap replays the same record.
  - `applyRuleOffer` re-works the change on the current workout and refuses it as `Out of date` unless it is still what Ben saw.
  - A version conflict at commit returns `stale`. Tests are at `:187–202` and `:347`.
- **No double offers when the coach comes back.** Rule and coach offers share the CA4 log per exercise and kind, persisted in `coach_offers`. The F3 replacement isn't logged a second time. An applied rule change re-opens CA4 through `planned.coach.actionId` (`todayAdjustmentIds`), the same way a coach change does. The force-close test covers this (`:234–260`).
- **Rule 9.** A too-easy change is never offered with a pain flag on the movement or pain at check-in. A too-hard change is still allowed. If a flag is added after the offer, Adjust returns `unchanged`.
- **F5.** The Summary now lists `hold_after_miss` (`Same target: 62.5 kg × 3–6` / `Target 57.5 kg × 3–6`), so the miss is no longer invisible. Next session never raises, and a second miss reduces (7-F, tested).

## Blocking

### B1. F4 pushes a second Workout screen on every rep or effort correction

`apps/mobile/src/screens/workout/EditSetScreen.tsx:87` (and `:83`)

**Scenario.** Ben logs 6 reps, opens the correction sheet, and changes it to 2. `save()` now calls `navigation.navigate('Workout', { corrected })` where it used to call `goBack()`.

In React Navigation 7, `navigate` only returns to an existing route when that route is the current one or `pop: true` is passed. Otherwise it **pushes**. The repo already documents this in `docs/reviews/workout-loop.md` B1 and `src/navigation/actions.ts`. My `StackRouter` run gives `Tabs > Workout > EditSet > Workout`.

The consequences:
- Every correction leaves the old `WorkoutScreen` and the `EditSet` modal mounted underneath, so the stack grows by two routes each time.
- Two `WorkoutScreen` instances each run their own rest-timer ticks and coach hook.
- The F4 offer check runs on the new instance. The old instance still holds its own `offer`, `adjustment` and `heldSets` state.

The exclusion-toast branch at `:83` already had this bug. This change spreads it to the common path: every rep, RPE or RIR fix.

The F4 test (`coach-fallback.test.ts:262`) only calls `offerAfterLog` at the service level, so it can't catch this.

**Fix.**
- Return with `navigation.popTo('Workout', params, { merge: true })`, or `navigate('Workout', params, { pop: true, merge: true })`. Do this for both branches.
- Add a case to `apps/mobile/test/navigation.test.ts` asserting that `[Tabs, Workout, EditSet]` becomes `[Tabs, Workout]` with the `corrected` params merged.

## Should fix

### S1. With no AI, Ben's own `Too hard` / `Too easy` request still gets no fallback

`apps/mobile/src/coach/slot-view.ts:152–154`, `WorkoutCoach.tsx` `ask`

**Scenario.** Ben is offline and, without a trigger, taps `Adjust → Too hard` because the bar felt slow. There are two cases:
- In `Offline` the chip is shown and the turn fails with `Couldn’t reach the coach. Nothing changed.` F3 only falls back when the turn came from an offer (`askedOffer`).
- In `Not connected` the chips are hidden (only `Pain`).

CLAUDE.md rule 3 says "When Ben asks, changes to today's remaining sets apply immediately… With no AI available, the simple built-in progression rules are the labelled fallback." The new `evaluateSessionAdjustment` already does exactly this for a `too_hard` or `too_easy` intent.

**Fix.**
- When the coach isn't reachable, or a chip turn fails without answering, route `too_hard` / `too_easy` chips on the focused exercise through `evaluateSessionAdjustment`. Its trigger fact would be Ben's request.
- Show `too_hard` / `too_easy` in `Not connected` too.
- Spec CA6 needs a line for this (see Spec issues SP3).

### S2. The stale check compares display text, not the version Ben saw

`apps/mobile/src/coach/coach-service.ts:576`

`applyRuleOffer` recomputes on the *current* aggregate and applies it if `adjustment.change === offer.change`. The record's `entityVersions.before` is the current version, not the one the offer was computed on.

**Scenario.** The offer is computed for sets 2–3 (`Next sets: 57.5 kg × 3–6`). During the same rest, Ben adds a set or the order changes, so the remaining sets become a different pair with the same targets. The text is identical, so Adjust applies to sets Ben wasn't shown.

This is narrow (the offer clears on each log and when rest ends), but rule 5 says stale proposals are "never applied to newer state."

**Fix.** Carry `baseVersion` and the `touchedSetIds` in `WorkoutOffer`. On Adjust, accept only if the recomputed `touchedSetIds` *and* the targets match. Keep the text compare as an extra check if wanted. Then the content check is a deliberate rule rather than a coincidence of formatting.

### S3. F4 and F7 have no UI-level tests

`apps/mobile/test/coach-fallback.test.ts:262, 331`

- F4 is tested only as a service call. The screen wiring (route param, `firstTime` key, reload, `afterLog`) is where B1 lives.
- F7 tests only the pure `offerCandidates`. Nothing checks that a superset's 0 s transition miss shows the offer when the round's rest starts, or that the held list is per workout.

**Fix.** After B1, add a router test. Add a `useWorkoutCoach`-level or harness test: log A1 short (no rest) → log B1 (rest starts) → offer for A with `by: 'rule'` when offline.

## Nits

- **N1.** A test name promises more than the test checks. `coach-fallback.test.ts:204` is titled "the last set, or a raise blocked by pain" but tests only the last set. Pain is covered at `:215`. Rename it.
- **N2.** Drop sets can be changed. `session-adjust.ts:158` filters `setType !== 'warmup'`, so pending **drop** sets with a planned load are changed too. §4.8 says "each remaining working set". Either filter to `working` / `top` / `backoff`, or say so in §4.8.
- **N3.** Held sets aren't persisted. `WorkoutCoach.tsx:62` keeps F7's `heldSets` only in a ref. A force-close between a 0 s-transition miss and the next rest loses the check. This is low impact, but worth a comment.
- **N4.** A spec line is now stale. `coach-adjustments.md:37` (the path B row) still says "reps short by ≥ 2". Update it to match revised CA5.
- **N5.** Acceptance checks are numbered twice. The new ones at `coach-adjustments.md:449–452` restart at 31–34, duplicating the existing 31–33. Renumber them 34–37.
- **N6 (pre-existing, now more visible).** An effort chip can hide an offer that is showing. With a `reps_short` rule offer on screen, tapping an effort chip that doesn't change the trigger kind (for example RPE 8) re-runs `afterLog`. That clears the offer, and CA4 then blocks it from coming back. Consider leaving the offer in place when the re-check returns the same `triggerId` kind already shown.

## Spec issues

- **SP1. Built ahead of Ben's approval.** F1 (option A), F2/CA6, F5 and F7 are all marked "[Ben]" in the diagnosis. Revised CA5 and CA6 say "Pending Ben's confirmation" and "Built ahead of Ben's approval".
  - ADR 0006 still scopes the built-in fallback to next-session targets. Playbook rule 5 and 7-F are unchanged, and there is no entry in `docs/brief/CHANGELOG.md`.
  - CLAUDE.md requires Ben to approve brief changes, and requires an ADR for architecture changes.
  - **Do not merge until Ben confirms** the CLAUDE.md rule 3 reading (built-in fallback covers today's remaining sets) and option A. Then land the ADR 0006 amendment, the playbook notes and the CHANGELOG entry with it.
- **SP2. Option A's threshold.** "Any rep below the floor" is a looser test than CLAUDE.md rule 3's "big rep miss". 8–12 with 7 reps, or 6–10 with 5, now offers. CA4 keeps this to once per exercise and kind, but Ben should confirm the sensitivity he wants. The `repsShortBy` threshold no longer affects ranges, so if a thresholds screen ships, its copy must say that.
- **SP3. Size of the rep-miss change.** No approved rule gives an in-session size for a rep miss without RPE (diagnosis §5). §4.8 picks "at least 5% lighter, else the reps he managed". That is a reasonable conservative choice, but it is a new coaching rule and should go to Ben or `training-researcher` as a playbook candidate. Separately, CA6 doesn't cover Ben-initiated chips offline (S1), and it should.
- **SP4. Lighter load today changes next session's target.** After the rule lowers today's sets, 7-F holds the easiest load used, so the next session's target drops too (62.5 → 57.5 kg, test `:309`). It is shown on the Summary with `Rule`, but Ben should know that accepting today's offer also sets next time's load.
