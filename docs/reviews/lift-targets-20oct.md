# Review: Lift targets, on or off (branch `claude/lift-targets-20oct`)

Reviewer: independent reviewer agent, 20 Oct 2026
Diff: `1e48041..2f9e2ed` (merge-base with `claude/gracious-knuth-joxqpw`), 46 files, +2192/−41
Spec: Ben's request ("Yeah let's do lift targets as something that can be turned on or off") and the design described to him (task text). There is no `docs/design/` spec for this feature.

## Verdict: CHANGES NEEDED

One blocking issue (rule 3: an offered target can be applied with values Ben never agreed to). The rest is solid. The setting gates every view, the tool and the coach context. The est. labelling is right. Hit counts only logged sets. kg/lb and per-hand handling are correct. Writes are versioned and idempotent with Undo, and targets are included in backups.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| Targeted vitest (domain, coach, app lift-target tests, training-profiles, registry, chart layout; `--maxWorkers=2`) | 58/58 pass |
| Full suite `--maxWorkers=2` | 372 files, 7243 passed, 1 todo, 0 failed |
| Migration 25 vs 23 `coach_actions` rebuild | Same columns, indexes and no-delete trigger. The CHECK list is 23's plus `set_lift_target`. |

## Blocking

### B1. A "yes" applies whatever target the model sends, not the one it offered (rule 3)
- `packages/coach/src/turn.ts:964`, `packages/coach/src/lift-target.ts:151-153`, `packages/coach/src/intent.ts:91`
- When the coach has the idea itself, nothing is recorded. The model is only told to ask. On the next turn, `liftTargetAsked` accepts any message of 4 words or fewer if the model quotes it verbatim (`q === w && words <= MAX_ANSWER_WORDS`). Nothing ties that "Yes" to an earlier lift-target offer or to its values.
- Failure scenario 1: the coach asks "Want a 100 kg bench target by March?", Ben says "Yes", and the model calls `set_lift_target` with `load: 110` or `byDate: null`. The app saves 110 kg, which Ben never agreed to.
- Failure scenario 2: the coach asks "Want me to drop the last set?", Ben says "Yes", and a confused model calls `set_lift_target`. A target is saved. The card has Undo, but rule 3 says an offered change "doesn't apply until Ben accepts" *that* change.
- The coach test (`packages/coach/test/lift-target.test.ts:61-65, 90-100`) asserts this behaviour (`liftTargetAsked('Yes', …) === true`) without any offer context.
- Precedent in this repo: `edit_today` offers are saved as `proposed` records, and an accepted offer applies exactly the recorded proposal. Coach messages already carry an `offer` (`turn.ts:624-626`, `previousOffer`).
- Fix: when Ben didn't ask, record the checked target as a `proposed` `set_lift_target` action, using `prepare` and the same convention and units. Show it as an offer card. Ben's "Yes" (or a tap on Apply) then applies that recorded proposal on the profile version it read, and is rejected if stale. Don't accept a new model call. Alternatively, accept a quoted "yes" only when the previous coach turn has an unapplied `set_lift_target` with the same semantic args (`semanticArgs`). Add tests for: a yes with changed values is refused; a yes with no prior lift-target offer is refused.

## Should fix (not blocking)

### S1. Editing a target resets its hit and its "was"
- `apps/mobile/src/services/lift-target-service.ts:153`, `packages/domain/src/lift-targets.ts:350-352`
- Every Save builds a new target with `setAtUtc = now`, `setOnDate = today` and `was` recomputed. Hit is measured from `setAtUtc` (`liftTargetHit`).
- Failure scenario: Ben hits Bench 100 kg on 2 Dec, then opens the row and adds a date or re-saves it unchanged. "Hit 2 Dec" disappears and "was" now shows his current est. 1RM, not the value from when he first set it. The spec says a hit target "stays listed until Ben sets a new one or removes it". Changing only the date is not a new target.
- Fix: when the exercise, kind, load, unit and reps are unchanged, keep `setAtUtc`, `setOnDate`, `was` and `id`, and change only `byDate`. Add a domain test.

### S2. No list of targets unless a plan is in use
- `apps/mobile/src/screens/routines/WorkoutsScreen.tsx:273` renders `YourPlanBlock` (and so `LiftTargetsBlock`) only when `plan !== null`.
- Failure scenario: Ben has no plan in use and turns Lift targets on. Nowhere shows his targets or offers `Add target` except Progress › exercise detail, one exercise at a time. The only signs of a coach-set target are its card and the exercise detail.
- Fix: render `LiftTargetsBlock` on Workouts even when there is no plan, or give it a home in Training details next to the switch. See Spec issues.

### S3. A history read error looks like "nothing logged" and hides Hit
- `apps/mobile/src/services/lift-target-service.ts:80` (`deps.history().catch(() => null)`, then `sessions ?? []`)
- Failure scenario: `progress.libraryHistory()` throws. Every row then drops its est. 1RM and Best, and a hit target loses "Hit 2 Dec", but it still shows "8 weeks left". The screen looks normal but is wrong. The coach gets the same views (`coachViews`), so it is told the target isn't hit and has no current value. Rule 6 says don't invent data, and this effectively invents "no progress".
- Fix: carry a `historyUnavailable` flag. Show the title only, with a short "Couldn't load" status, and leave `liftTargets` out of the coach context (or mark it unavailable). Add a test.

### S4. The coach isn't told the convention when it sets a target
- `packages/coach/src/registry.ts:357` ("the load and unit he said")
- The convention comes from Ben's newest set (`liftTargetChoices`). The tool description and context never say that a dumbbell target is per hand.
- Failure scenario: Ben says "I want to DB bench 80 kg". He means the pair, but the target is saved as `80 kg each`, which is double his intent. The card shows "each", so he can catch it, but it is easy to miss.
- Fix: describe the convention in the tool description ("dumbbells per hand, machines the stack"). Return the saved convention text in the tool output so the reply repeats it. Or refuse a per-hand target above about 1.5× his best per-hand set and ask.

### S5. "To go" comes from the estimate but isn't labelled
- `packages/domain/src/lift-targets.ts:217`. For 1RM targets, `toGo` = target − est. 1RM, so "6.5 kg to go" is an estimate. The row above it says `est.`, and the spec wording allows this. On the exercise detail, though, the progress line can sit apart from the detail line. Consider "≈6.5 kg to go", or putting it on the same line as the est. value. See Spec issues.

## Nits

- N1. `packages/domain/src/lift-targets.ts:193`: a 1RM target counts as hit with any reps ≥ 1 at the weight, for example a triple at 100 kg. That is reasonable, but the CHANGELOG and spec say "a single". Align the wording, or test it explicitly.
- N2. `LiftTargetSheet.tsx:143`: the date is free-text `YYYY-MM-DD` on iPhone, which is hard to type and easy to get wrong. Use the existing date wheel (the start/end time wheels already exist). Already listed as open for Ben.
- N3. `liftTargetChartValue` (`lift-targets.ts:374`) draws a weight × reps target on the Top set measure. A top set of 92.5 × 2 is drawn above a "90 × 5" line even though it isn't a hit. That is acceptable with no pass/fail colours, but worth a "Why?" note.
- N4. A target far above current values (e.g. 300 kg) is added to the y-range (`trend-layout.ts`) and flattens the chart. Consider clamping or showing an edge marker.
- N5. Lift targets combine every gym and equipment ID of an exercise, while Progress splits series by equipment. That is fine, but leg-press machines at two gyms count as one target.
- N6. No React render tests. Gating in the UI is checked only through the service (`on: false` → `lines: []`). `ExerciseLiftTarget` and `LiftTargetsBlock` gate correctly on reading, but a render test of "off renders nothing" would catch regressions during the parallel merges.
- N8. Turning the setting off doesn't hide earlier conversation. Ben's own words ("I want to bench 100 kg by March") and the coach's replies stay in the thread history sent to the model (`context.ts` `historyItems`). That is acceptable, since it is his conversation, but note it next to "the coach doesn't see them".
- N7. `set_lift_target` is only offered in `general` and `workout` turns. "I want to bench 100 by March" in a build or plan turn gets no tool. Acceptable, but say so in the CHANGELOG.

## Rules checklist

| Rule | Status |
|---|---|
| 1 Offline / honest AI | Local service, no network. |
| 2 Completed sets untouched; Undo | Targets never touch sets. Save, Remove and the coach card all have Undo. Coach Undo is refused once the target has changed since (`persistence/src/coach.ts:727-736`). |
| 3 Asked vs offered | Asked: applied with Undo. Offered: not saved. **B1**: the "yes" isn't bound to the offer. |
| 4 Equipment | Targets aren't snapped or capped (see Spec issues). The coach's planning line keeps the existing guardrails. |
| 5 Versioned / idempotent | Profile version and `recentOps`. A double tap replays. Stale writes are refused. Coach target and record are written in one transaction. Undo uses its own op. Tested. |
| 6 No invented data | `est.` on e1RM, `isEstimate: true` in the coach view, no predictions, hit only from logged sets (warm-ups and marked sets excluded, date-only imports from the next day). See S3 and S5. |
| 7 Secrets | None added. |
| 8 Imports as data | Imported sets count only as sets. |
| 9 Pain | Unchanged. The planning line repeats the pain limits. |
| 10 Your data | On `training_profiles`, which is in data-domains, backup and restore. The round trip is tested. Coach context sits under YOUR DATA. |
| Minimal copy | Values only. The error toasts are short. |

## Spec issues (for Ben / PM, not the developer)

1. **No design spec.** The feature was built straight from the task text, so there is no `docs/design/lift-targets.md` and no acceptance list to check against. The designer step was skipped.
2. **Where the list lives.** The spec puts targets in the "Your plan block", which only exists while a plan is in use (S2). It needs a home that doesn't depend on having a plan.
3. **Equipment max (rule 4).** "Never extrapolate past a machine's max" covers prescribed loads. A goal above a machine's stack max (e.g. a 120 kg stack target on a 100 kg stack) can never be hit. Ben should decide whether to refuse it, warn, or allow it.
4. **"8 kg to go" for 1RM targets** is target minus an estimate, but the spec shows it without a label. Under rule 6 it should probably read as approximate (S5).
5. **Hit targets count toward the 3** until removed, and the spec doesn't say whether "Hit" should free a slot. This is already open for Ben in the CHANGELOG.
6. **"A single at ≥ weight"** for 1RM hits: confirm that a multi-rep set at or above the weight also counts (N1).
