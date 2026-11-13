VERDICT: PASS

# Review r2: premium feel pass (claude/polish)

Reviewer: independent reviewer agent, 10 Oct 2026.
Scope: `git log claude/gracious-knuth-joxqpw..HEAD`. The r2 work is 91e949d..20ee351, 16 commits answering
`docs/reviews/premium-feel.md`. I read the full branch diff against the merge base 5e42865 and checked it against
`docs/design/premium-feel.md`, the D-Today, D-ActiveSet and D-Rest mockups, and CLAUDE.md.

## Checks run

- `npm run check`: **exit 0**. That covers typecheck, lint, 109 test files with 1453 tests, catalogue validate,
  guide check and guide motion (10 of 10). The figure-suite timing warnings from r1 N12 didn't recur in this run.
- Merge readiness: the base branch has moved on by 10 commits (FitNotes import rounds 5 to 8). A trial merge
  (`git merge-tree HEAD claude/gracious-knuth-joxqpw`) is clean. Run `npm run check` again after merging, because the
  theme-tokens test was touched on both sides.
- Worklet crash risk: **none**. No changed file imports Reanimated or uses `'worklet'`, `useSharedValue` or
  `runOnJS`. All motion, including the new `PulseOnce`, uses RN `Animated` with `useNativeDriver: true` on opacity
  and transforms only. `haptic()` still swallows both sync throws and promise rejections.
- Reduce Motion: `PulseOnce` returns null motion under RM and snaps to 1 when RM is switched on mid-way. `FadeIn` now
  plays the reduced 150 ms swap when RM is on at mount, and still snaps if RM is switched on mid-way (r1 N2).
  The READY hold is a 600 ms content state, not a motion, so it's correct that it stays under RM.
- Workout-flow regressions: none found. Details below.

## r1 findings: status

| r1 | Status | Notes |
|---|---|---|
| B1 editor remount at rest end | **Fixed** | `editorSlot` (`apps/mobile/src/workout/rest-fold.ts`) always uses one `SwapIn` keyed `editor:<setId>`, so an editor opened during rest stays mounted (keyboard, focus and a half-typed `62.` survive). It animates only when the rest end brings it on screen. Covered by pure tests, including the READY-hold case. |
| B2 finish moment replays | **Fixed** | `justFinished` is now an explicit route param, set only by `replaceWithSummary`. Today and Progress visits are static. A navigation test covers it. |
| B3 copy | **Fixed** | The first-workout hint is gone. `(built-in rule)` is gone from the Up next basis line. Routine-sheet provenance is now a `Rule` tag with `Why?`. The save-sheet detail is values only. The start notices are `Using saved targets.` and `Using last time's numbers.`. The spec §10 table was updated to match. |
| S1 log haptic waits on DB | **Fixed** | `recordContext` is read when the set is focused. `recordOf` decides `commit` or `record` synchronously after the write, and falls back to `setRecord` when the context doesn't match (another set, equipment or convention changed). |
| S2 READY hold | **Fixed** | `readyHoldUntil` holds for 600 ms only for a natural end seen on screen. There's no hold for Skip, another timer, or coming back more than 2 s after the deadline. Pills are disabled during the hold. Log stays live. |
| S3 Summary records + pulse | **Fixed** | `sessionRecords` covers one line per exercise and only counts history from before the workout started. `PulseOnce` runs on the Rest star. |
| S4 ±30 s haptic | **Fixed** | `haptic('step')` on both pills. |
| S5 rename while active | Deferred to Ben | Recorded as open item 6, which is reasonable. |
| S6 bell.slash | **Fixed** | `alertsOffLabel` describes what the tap does in each permission state. The spec matches, and Ben confirms it in open item 7. |
| S7 duplicate exercise slots | **Fixed** | `planRoutineStart` and `startWorkoutFromSession` both fall back to each slot's own numbers. Tested. |
| S8 stale week "in progress" | **Fixed** | A workout counts as `live` only in this week or when it's the Resume hero. Tested. |
| N1-N5, N7, N10, N11 | Fixed | |
| N8, N9 | Deferred, recorded in §13.1 | |

## Blocking

None.

## Should fix (not blocking)

### S1. Summary now carries two "heaviest set" rules that can disagree
`packages/domain/src/session/summary.ts:314-315`, `packages/domain/src/touches.ts:99-124`,
`apps/mobile/src/screens/workout/SummaryScreen.tsx:237-243, 348-362`

`summaryHighlight` (the existing `TODAY` hero line) and the new `sessionRecords` lines both claim "Heaviest … set",
but they apply different rules:

| | Highlight | Records |
|---|---|---|
| Earlier comparable sessions needed | 1 | 3 (`RECORD_MIN_SESSIONS`) |
| Heavier imported set suppresses the claim | No | Yes |
| Set types counted | All non-warm-up (drop sets included) | Working, top and back-off only |

Failure scenario 1: on his second bench session, Ben lifts heavier than his first. The Rest screen shows no record
line, because the 3-session gate isn't met. The Summary hero then says
`Heaviest Bench press set on Olympic bar: 102.5 kg × 6`.

Failure scenario 2: a FitNotes import holds 110 kg, and Ben lifts 105 kg. The record line is correctly suppressed,
but the hero still claims "Heaviest".

Once the gate is met, both lines appear together and say the same thing twice ("Heaviest Bench press set …" in the
hero, and "Heaviest bench press set at Main gym so far" under Comparison). Spec §5.1 calls the record "the app's
only PR". This is rule 6 territory: the claim isn't false against logged data, but it contradicts the rule shown a
minute earlier.

Fix: build the highlight's heaviest claim from `findSetRecord`/`sessionRecords`, so there is one rule. Or drop the
`Heaviest` branch from `summaryHighlight` when records exist and gate it the same way. Add a test where 2 earlier
sessions give no hero heaviest claim.

### S2. The quick record path isn't inside a try
`apps/mobile/src/screens/workout/WorkoutScreen.tsx:414-415`

`services.workout.recordOf(...)` runs synchronously inside `log()` after the write. Before r2, the record check was
wrapped in `try`/`.catch`. `findSetRecord` has no throwing path today. But if a later change (for example `toMs` on a
malformed `completedAt`) makes it throw, the rest of `log()` would be skipped: no toast with Undo, no commit guard,
and edits not cleared. That would happen after a successful write, on the most frequent action in the app.

Fix: wrap `recordOf` in `try { … } catch { quick = null }`, or catch inside `recordFromContext`.

## Nits

- N1. `SummaryScreen.tsx:353` keys record rows by their text. Two slots of the same exercise (S7's heavy and light
  bench) can produce the same sentence. That gives a duplicate React key and a repeated line. `sessionRecords` also
  judges each slot only against its own earlier sets that day. Key by index or exercise ID, and dedupe the text.
- N2. The Rest line and the Summary line can differ for the same set. The Rest line (`recordContext`) uses all
  finished history except this session. The Summary uses only history from before the workout started. This only
  matters if a session was back-dated over a live one, which is rare.
- N3. `recordContext` is never cleared when the focus moves. A context loaded for set A stays in the ref until set
  B's read resolves. This is safe, because `recordFromContext` checks `setId` and returns `undefined`, which triggers
  the slow path. Clearing it on focus change would make the intent obvious.
- N4. `−30 s` down to 0:00 counts as a natural end, so READY holds for 600 ms after an explicit tap. That's arguably
  right (it's a rest end, not a Skip), but the spec only describes "at the deadline" and Skip. Add one line to §4.3.
- N5. `readyHold` state isn't cleared when Ben logs during the hold. It times out harmlessly, because `holding` also
  requires the same `timerId`.

## Product rules (CLAUDE.md)

- Completed sets are never modified. Records and the READY hold only read data.
- Logging works offline with no AI. The coach slot renders nothing when it's empty.
- Writes stay idempotent. Resume-row retry (r1 N4) uses a new opId only after a `stale_version` refusal, and only
  while the set is still pending, so it can't move focus onto newer state wrongly.
- Loads go through `fitLoadHere` and `pickEquipment`, the duplicate-slot fix doesn't touch feasibility, and assisted
  and bodyweight exercises are never records.
- No invented data. Record claims come from logged history only, with imported history suppressing (see S1 for the
  older highlight).
- Copy follows the minimal-copy rule.
- No secrets in the diff, and no new logging of health data.

## Spec issues

1. Open items 6 to 8 (rename while active, the `bell.slash` target, per-haptic switches) and the r1 items (motion
   exceptions, permission timing, Pause in ⋯, the record gate) still need Ben's sign-off before this merges to the
   main branch. The tokens remain marked "Proposed".
2. §5.1 says the record is "the app's only PR", but `workout-summary.md`'s `TODAY` highlight predates that rule and
   makes its own heaviest claim (S1). The designer should state which one owns "Heaviest" on the Summary.
3. §4.3 should say whether `−30 s` to zero gets the READY hold (N4).
