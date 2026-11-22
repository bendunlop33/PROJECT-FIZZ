# Coach adjustment after a rep miss: diagnosis (build 108)

*Reviewer diagnosis, 11 Oct 2026, branch `claude/coach-fallback` (from main `08120f2`). No code changed. Traced in code and with a throwaway service test on real SQLite (harness `createHarness` + scripted model; deleted after the run).*

**Ben's report (build 108).** "The coach adjustment doesn't really work. I just tried to do way fewer reps than stated and coach still didn't change sets for the set or session."

**Verdict: two independent causes, plus one gap the specs created on purpose.**

1. **The trigger compares against the bottom of the rep range, but the app shows Ben the top.** This explains the report even with the coach signed in and reachable. The Log button is prefilled with `planned.reps.max` (`prefillDraft`, `packages/domain/src/session/view.ts:161`), so Ben sees `Log 62.5 kg × 6`. `reps_short` fires only when `range.min − reps ≥ 2` (`packages/domain/src/coach/trigger.ts:121`). On the built-in rule's main-lift range 3–6 that means **only 0 or 1 rep fires**. Doing 2 when the button says 6 is silent everywhere.
2. **With no reachable coach, nothing appears at all.** `WorkoutCoach.tsx:139` passes `coachReachable: now.status === 'ok'`. `shouldShowCoachOffer` (`trigger.ts:161`) returns false when that's false. There is no deterministic fallback for today's remaining sets.
3. **The spec says so on purpose (gap, not a bug).** coach-adjustments.md **CA6**: "With the coach offline, no in-session adjustment is offered (the brief's deterministic `evaluateSessionAdjustment` isn't used)… that would need a brief change." ADR 0006 and playbook 7-F scope the built-in fallback to **next-session** targets only. CLAUDE.md rule 3 says, without that scope, "With no AI available, the simple built-in progression rules are the labelled fallback." **That is a CLAUDE.md vs ADR/spec disagreement, flagged here for Ben, not resolved.**

Then at Summary, one bad session is a deliberate "bad day" hold, and it isn't shown at all: `Same targets next time`.

## 1. Trace: Ben's scenario in three connection states

Fixture: workout 1 was Bench press 60 kg × 8, 8, 8. Workout 2 was started from it, so the built-in rule planned **62.5 kg × 3–6**, working sets, `rpe: null`, `source: built_in_rule`. Ben logs 2 reps, then 1, then 2. Then he finishes and starts workout 3. What the test observed, using the same calls `WorkoutCoach.afterLog` makes:

| Step | (a) Not signed in | (b1) Signed in, no network, no failed request in the last 60 s | (b2) Signed in, a request failed < 60 s ago | (c) Signed in, reachable |
|---|---|---|---|---|
| `availability().status` | `not_connected` | **`ok`** (status comes from Keychain/settings only, with no network probe) | `offline` (`OFFLINE_HOLD_MS` = 60 s) | `ok` |
| Set 1: **2 reps** vs 3–6 (button showed × 6) | trigger `null`, no offer | trigger `null`, no offer | trigger `null`, no offer | trigger `null`, **no offer** |
| Set 2: **1 rep** | trigger `reps_short`; gate false, **no offer** | **offer shown** `That looked hard. Adjust remaining sets?` / `1 reps on set 2 (target 3–6)` | trigger fires; gate false, **no offer** | **offer shown** |
| Ben taps Adjust | n/a | turn **fails** `network`, slot: `Couldn’t reach the coach. Nothing changed.` + Try again | n/a | LLM turn (`too_hard` chip); result depends on the model |
| `Adjust` header control | caption `Not connected`, chips: `Pain` only | caption none, all chips (they fail) | caption `Offline`, all chips (they fail) | all chips |
| Set 3 targets | unchanged 62.5 × 3–6 | unchanged | unchanged | unchanged unless the coach applied |
| Last set (no pending set left) | no offer (no pending set, no rest) | same | same | same |
| Summary `Next time` | `rows: []`, **`Same targets next time`** | same | same | built-in row is the same; a coach row only if the summary turn produces one |
| Workout 3 targets | 62.5 × 3–6 ×3 (`hold_after_miss`) | same | same | built-in hold unless the coach's target applies |
| Second miss session at 62.5 | Summary row `Target 55 kg × 3–6`, `reduce_load` ("Repeated misses at 62.5 kg: reduce to 55 kg and build back up.") | same | same | same baseline |

So in **every** state, Ben's "way fewer than stated" at 2 reps produced nothing. At 1 rep, only (b1) and (c) show the offer. In (b1) the offer is a dead end: Adjust can only fail.

## 2. When the trigger fires (pure `evaluateCoachTrigger`, `repsShortBy` = 2)

| Planned target | Logged | Result | Note |
|---|---|---|---|
| 8–10 | 7 | none | short of floor by 1 |
| 8–10 | 6 | `reps_short` | |
| single 8 (`min = max`) | 6 | `reps_short` | single numbers work as expected |
| single 8 | 7 | none | |
| **3–6 (built-in main lift)** | **2** | **none** | Ben's case: 4 below the number on the button |
| 3–6 | 1 | `reps_short` | |
| 6–10 (built-in compound) | 5 | none | 5 below the button's 10 |
| no planned reps (`reps: null`: first time, empty set, added set) | any | none | nothing to compare with |
| timed set (`reps: null`, `durationS`) | any | none | no duration-short trigger exists |
| bodyweight with a rep target | short by ≥ 2 | `reps_short` | load null is fine |
| warm-up / drop set | any | none | by rule T |
| top / back-off set | short by ≥ 2 of floor | `reps_short` | |
| planned RPE 10 or RIR 0 | 3 of 8–10 | none | `plannedAllOut` suppresses **reps_short too**, not only effort (rule T: "never triggers") |
| logged RPE 10, no planned RPE | any | `rpe_high` | effort beats reps in priority |

Other conditions that silence a firing trigger (`checkOffer`, `shouldShowCoachOffer`):
- **Not resting.** `resting` is `restTimer.status === 'running'` at the moment of logging. These are silent: a superset's non-round-end set (transition 0 s), any exercise with rest 0, and the final set of a planned workout.
- **No pending set left on that exercise.** A miss on the last set never offers anything.
- **CA4.** Once per exercise and kind per workout, unless an adjustment was applied since. A dismissed offer won't come back on the next, bigger miss.
- **Edits.** `EditSetScreen` saves reps through `services.workout.correctSet` and never calls `coach.afterLog`. Correcting a set's reps down after logging never re-runs the trigger. Only the effort chip on the just-saved set (`WorkoutScreen.tsx:949`) does.
- **Coach request pending.**

## 3. What the rest card shows

The offer is rendered only inside the rest view's `CoachSlot` (`WorkoutScreen.tsx:1107`). Outside rest, offers are filtered out (`:1165`), and the offer is cleared when rest ends (`:465–468`).
- **(a) and (b2):** nothing for the miss. The `Adjust` control shows the caption `Not connected` (chip `Pain` only) or `Offline`. `adjustControlView(...).line` is `null` in every state. The spec's `Coach offline. Your sets are unchanged…` line was removed by the minimal-copy pass, so there's no "Why?".
- **(b1):** the offer, then a failure line after Adjust.
- **(c):** the offer, Ben-initiated chip turn, banner with Undo if the model calls `adjust_pending_sets`. Otherwise `No change made.`

## 4. Summary and next session

- The built-in rule (7-F) **counts the miss**: `anyBelowFloor` against the *rule's* range (`progression.ts:320, 608`). One session is a `hold_after_miss` ("bad day, not a trend"). Two in a row at the same load reduce 10% and snap easier (62.5 → 55 kg on the commercial preset, a 12% drop).
- The Summary **doesn't list** `hold_after_miss` unless the facts end with `; holding.` (`summary.ts:182–184`). So after Ben's miss, the Summary reads `Same targets next time` and the miss is invisible. The `Why?` with "One session below 3 reps is treated as a bad day" is never reachable.
- The built-in rule always uses its own category range (`next-target.ts:44`, rule `null` from `workout-services.ts:913, 968`) unless a routine names a rule. "Below floor" means below 3 for a main barbell lift, even if Ben's routine or last session was 8.
- (c): `runSummaryTurn` runs one coach review. Its small changes apply by default (D21, ADR 0006 amendment). With (a) or (b) it is skipped (`status !== 'ok' && !== 'offline'`), or it fails on network, leaving only the built-in rule.

## 5. Playbook: is there an approved within-session rule for a missed set?

**Partly. The rule is approved, but only as a coach offer, and it has no deterministic fallback.**
- **Rule 5 "Too hard" offer (approved 9 Oct).** After reps short by ≥ 2 (or unplanned RPE ≥ 9.5), "the coach **offers** a change to the remaining sets of that exercise. Either −5–10% load (≈ 2–4% per RPE point over target, rounded down to an achievable load), or the same load with fewer reps." Guardrail: "If the next lighter load is > 10% lighter, the coach prefers the same load with fewer reps." Per-goal row (§ table line 110): Strength prefers the same load with fewer reps; Hypertrophy prefers less load with the same reps.
- **D22 arithmetic** is RPE-based only: 2–4% per RPE point, min 5%, max 10%. **No reps-based mapping exists** for a rep miss without RPE, which is Ben's case.
- **Rule 7-F** (built-in) is next-session only. **CA6** explicitly rules out an offline in-session rule pending a brief change. The brief's service list still has `evaluateSessionAdjustment(activeSession, effort, constraints)`, "candidate changes to pending sets", which was never built.

So a built-in in-session fallback is **not** approved. It needs Ben's decision, then a brief CHANGELOG entry, an ADR 0006 amendment, playbook rule 5 and CA6 edits, and a decision on the reps-miss arithmetic.

## 6. Proposed fixes

Ordered by impact on Ben's report. **[Ben]** = needs his approval before building. **[Bug]** = within approved rules.

| # | Fix | Type | Where |
|---|---|---|---|
| F1 | **Make "short" match what Ben was shown.** Options for Ben: **(A, recommended)** fire on any rep **below the range floor** for ranges, and keep "short by ≥ 2" for single-number targets. 3–6, did 2 → fires; did 3 → no. **(B)** compare with the prefilled number (range max) by ≥ 2. Simpler to explain, but it fires on a normal bottom-of-range double-progression set (3–6, did 4). Thresholds stay editable data. | **[Ben]** rule T wording ("short of target"); trigger.ts + tests | `packages/domain/src/coach/trigger.ts:117–123` |
| F2 | **Built-in in-session fallback when the coach can't answer** ((a), (b2), and after an (b1) failure). Show the same rest-card offer; Adjust applies a **deterministic, labelled** change to that exercise's pending sets with visible change and one-tap Undo. Through the existing `adjust_pending_sets` command path (opId, version check, snap easier, min/max, pain block). Rule 5 maths: next achievable load down within −5…−10%; if the next lighter load is > 10% lighter, or the goal is strength, the same load with target reps = what Ben achieved (floored at 1). "Too easy": +1 achievable step ≤ 5%, else +1–2 reps, blocked by pain flag. Tag `Rule`, reason behind `Why?`. Implement as the brief's `evaluateSessionAdjustment` (pure, `packages/domain`). | **[Ben]** CA6, ADR 0006, playbook rule 5/7-F, brief CHANGELOG; also resolves the CLAUDE.md rule 3 vs ADR scope conflict | domain + `coach-service.checkOffer` gate + `WorkoutCoach` |
| F3 | **(b1) dead end.** When Adjust on an offer fails with `network`, fall through to F2's built-in proposal instead of only `Couldn’t reach the coach. Nothing changed.` Without F2: at least don't show offers whose only action will fail? Not detectable before trying, so F2 is the real fix. | depends on F2 | `WorkoutCoach.ask` catch / `slotAfterTurn` |
| F4 | **Re-run the trigger after a set correction.** After a successful `correctSet` on a completed set in the active workout, run the same `offerAfterLog` check. The trigger ID is per set version, so it is idempotent and CA4 still applies. | **[Bug]** (rule T: "every logged working set") | `EditSetScreen.tsx:70` → shared coach hook or a service-level check |
| F5 | **Show the miss at Summary.** List `hold_after_miss` as a `held` row (`Same target: 62.5 kg × 3–6`, tag `Rule`). The rule's existing words go behind `Why?`. Minimal copy: no new lead text. | **[Bug]**-ish (rule 6/honesty: the decision exists but is hidden); small design note | `packages/domain/src/session/summary.ts:181–184` |
| F6 | **Pass a reachable-now signal, not "never offer".** Even without F2, (a) should still record the trigger, so the next-session path or a later coach turn can cite it (`coach_offers` row with a `shown: false` reason). Optional. | design | `checkOffer` |
| F7 | **Offers outside a running rest.** A miss on the last set of an exercise, or a superset/0 s transition, is silent. Proposal: the last set of an exercise is fine as is (nothing to adjust). For a 0 s transition, evaluate when the round's rest starts. | **[Ben]**/design (CA §2.3 "only in rest card") | `WorkoutCoach.afterLog`, `WorkoutScreen` |
| F8 | Copy: `1 reps on set 2` → `1 rep on set 2`. | **[Bug]** trivial | `trigger.ts:123` |
| F9 | Add regression tests for Ben's exact case: built-in 3–6, 2 reps → offer (after F1). (a)/(b2) → built-in offer (after F2). Edit → offer (F4). Summary lists the hold (F5). | tests | `packages/domain/test`, `apps/mobile/test/coach-flow.test.ts` |

**Not bugs (by approved design, listed so they aren't "fixed" by accident):**
- Planned all-out sets never trigger.
- Warm-up and drop sets never trigger.
- CA4 is once per exercise and kind.
- Offers need Ben's tap before anything changes.
- A single bad session holds; two in a row reduce 10% (7-F).

**Decision needed from Ben (one message):**
1. F1 option A or B.
2. Approve F2: a labelled built-in in-session fallback, offered and applied only on Adjust with Undo, using rule 5's maths and the reps-miss mapping above.
3. Confirm that CLAUDE.md rule 3's "built-in fallback" covers today's remaining sets, not only next session. ADR 0006 and CA6 currently say next session only.
