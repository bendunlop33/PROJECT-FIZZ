# Review r2: Progress slice A (home, Muscles, Calendar, Time sheet, ResumeBar)

Branch `claude/progress` (worktree `/home/user/wt-progress`) at `cfcab0e`, diff against `claude/gracious-knuth-joxqpw`.
Spec: `docs/design/progress.md` v1.0 (now committed, `e4d9e9f`), mockup `docs/design/mockups/progress.html`, CLAUDE.md rules 1, 2, 5, 6 and 10, minimal copy, accessibility. Previous round: `docs/reviews/progress-A.md`.
Reviewer: independent reviewer agent, 11 Oct 2026.

## Verdict: **PASS**

All three round-1 blockers are fixed:
- **B1.** Catalogue tooling and `npm run check` run again.
- **B2.** The `Count it` Undo can be reached.
- **B3.** The window and grouping are one shared setting.

Most of the round-1 should-fix items and nits are also fixed. The metrics match my own hand-computed cases. On the spec's history size, window switches stay well under budget.

Nothing below blocks the merge. Two items must be done before or during the merge, or soon after:
- S1: the branch is now behind its base and conflicts with it.
- S2: one unilateral miscount.

## What I ran

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=120000` | pass: 200 files, 3890 tests, 1 todo |
| `npm run catalogue:validate` | pass: 135 files valid, 0 errors (B1 fixed) |
| `npm run guide:check -- --all --verify`, `npm run guide:motion -- --all` | pass: 10/10 |
| `progress-perf.test.ts` (624 workouts, 4 years) | JIT: cold pass 3992 ms (longest block 27 ms), first open 49 ms, worst switch 26 ms, calendar 6 ms |
| same, `--pool=forks --execArgv=--jitless` | cold pass 6044 ms (longest block 34 ms), first open 60 ms, worst switch 38 ms, calendar 6 ms |
| `git merge-tree HEAD claude/gracious-knuth-joxqpw` | **conflict** in `apps/mobile/src/services/app-services.ts` (see S1) |

### Hand-computed cases

I ran these through the real domain functions in a throwaway test. I deleted it afterwards, and the tree is clean.

**Timezones and week boundaries.**
- In `America/Los_Angeles`, `2026-10-12T05:30Z` falls on Sun 11 Oct and `07:30Z` on Mon 12 Oct.
- A 30-day window ending Tue 13 Oct has a last bar of `12–13 Oct`, partial, with 1 session. The bar before it ends Sun 11 Oct, with 1 session. Correct per PG16 and PG24b.
- Round 1's London DST cases still hold. There is now also a service-level DST test (`progress-review-a.test.ts:225`).

**Time in gym, 14 days.** Inputs:
- one 45 min workout
- one imported workout
- one with no end time
- one at 4 h + 1 ms, unconfirmed
- one at 5 h, confirmed
- one at exactly 4 h

Result: total 9 h 45 min, timed count 3, average 3 h 15 min. Imported 1, no end 1, over cap 1. Correct: exactly 4 h is not "over", and the confirmed workout counts.

**Muscles, 7 days.** One logged bench workout with four sets:
- a working set marked `pain`
- a working set at 225 lb
- a warm-up
- a set at RPE 5

Plus one imported bench workout with 2 unrated sets.
- Chest reads `2 sessions · 4 sets` and Triceps `2 · 2`.
- `markedCounted` is 1. Not counted shows 1 warm-up and 1 easy set.
- So lb sets count the same as kg, imported sets count, and marked sets count (PG21). Correct.

**Records.** History is 3 earlier logged sessions of each:
- bench 185 lb × 5
- DB press 30 kg per hand × 8
- assisted pull-up 30 kg assistance × 8

The new workout has:
- bench 190 lb × 5, marked spotted
- bench 185 lb × 6
- DB press 32 kg each × 8
- assisted pull-up 20 kg × 8

Result:
- Bench gives `Most reps at 185 lb · 6`. The spotted 190 lb set is correctly not a record.
- DB press gives `Heaviest set · 32 kg each × 8`.
- The assisted pull-up gives nothing.
- Record keys now use `sessionExerciseId` (N5 fixed). VoiceOver says "185 pounds".

**PPL.** The assisted pull-up counts 1 Pull set, because the work was done. Correct.

**Unilateral.** A left warm-up, then 3 left working sets and 3 right working sets give **4 hard sets**. The answer should be 3 hard and 1 warm-up (S2).

## Round-1 findings: status

| # | Status |
|---|---|
| B1 catalogue imports domain barrel | **Fixed.** The table is in `@fizz/schemas/src/muscle-groups.ts`. `check` passes |
| B2 Undo hidden behind modal | **Fixed.** `runCountIt` closes the sheet before `show`, and a refusal closes it too. The order is tested (`progress-review-a.test.ts:128-158`) |
| B3 window/grouping not shared | **Fixed.** Neither screen keeps local state. The service holds `chosen`, which is set synchronously, tied to the store and dropped on a failed save. Tested at `:46-84` |
| S1 Ask under ResumeBar | **Fixed.** The floating area ends above the ResumeBar. Ask rises above the toast |
| S2 Ask with Today context | **Fixed.** New `{ kind: 'progress', days }` entry. The context gets `openedFrom` dates and no numbers, and history stays `not available` (honest, rule 1/6) |
| S3 settings write race | **Fixed.** `updateProfile` takes a merge function and serialises writes. Tested |
| S4 perf fixture/budget | **Fixed** for check 25: 624 sessions, 100 ms budget asserted, `prewarm()` after launch and after Finish. The cold pass is still 4–6 s, memory only (N3, SP5) |
| S5 check 16 set-muscles route | **Open.** It waits on Ben/designer (SP2). There is no false `›` on the `Not counted` list rows. See S4 below |
| S6 unilateral per-category max | **Mostly fixed.** Sides are paired, then each pair is classified. The pairing ignores set type (S2) |
| S7 spec not committed | **Fixed** (`e4d9e9f`) |
| S8 test gaps | **Mostly fixed.** DST through the service, shared setting, write race, Undo order and sheet copy are now tested. Still missing: the mixed-type unilateral case (S2) and lb in muscles/time |
| N1–N6, N9, N10 | **Fixed** |
| N7 `Edit times` opens Summary | Unchanged (N1 below) |
| N8 conditioning with leg primaries | Unchanged; spec question SP4 still open |

---

## Blocking

None.

---

## Should fix

### S1. The branch is behind `claude/gracious-knuth-joxqpw` and conflicts with it
- **Where.** `git merge-tree` reports `CONFLICT (content)` in `apps/mobile/src/services/app-services.ts`. The base gained the session-picker merge (`c32f1bf`) and 9 other commits after this branch forked at `e725a56`. Both sides edit `app-services.ts`: this branch serialises `updateProfile`, adds `progress` and prewarms in `afterCommand`.
- **Failure scenario.** A hand-resolved merge drops one side. For example, it loses `progress.prewarm()` in `afterCommand`, or loses the base's picker services. A two-dot diff also shows the base's `listSessionTypeRows` missing from `persistence/src/sessions.ts`, so a careless "ours" resolution would delete it. Nothing in this review covers the merged tree.
- **Fix.** Rebase or merge the base into `claude/progress` and resolve `app-services.ts`, keeping both sides. Then rerun `npm run check` and the jitless perf script on the merged tree before merging.

### S2. Unilateral pairing ignores set type, so a one-sided warm-up turns into an extra hard set
`packages/domain/src/progress/muscles.ts:93-101` (`countRowSets`), used by Muscles and Calendar.
- **Cause.** Left and right sets are paired by position among all sides, whatever their set type.
- **Failure scenario.** Ben logs a single-arm row as: L warm-up, then L, L, L, then R, R, R (no right warm-up). The pairs become (L warm-up, R1), (L1, R2), (L2, R3), (L3). `unitKind` makes the first pair hard, so the row counts **4 hard sets, 0 warm-ups**. The correct count is 3 hard and 1 warm-up.
- **Effect.** Back sets per week are overstated, and `Not counted` under-reports warm-ups. The same happens with a single easy side set logged before the working pairs.
- **Fix.** Pair within set-type groups: warm-ups with warm-ups, and working/top/backoff/drop with their own group. Then classify each pair. Add the case above as a test, plus the round-1 mixed-RPE case, which already passes.

### S3. No `Ask` on the Muscles screen
`apps/mobile/src/screens/progress/MusclesScreen.tsx` (whole file, no `AskPill`).
- Spec §2.1 says "The `Ask` pill floats bottom-trailing on every Progress screen … and attaches the current screen's context".
- **Failure scenario.** Ben drills into Chest to ask "is this enough chest work?" and has no way to ask from there.
- **Fix.** Add `AskPill` with `{ kind: 'progress', days: home.days }` (or a grouping-aware frame) and the same bottom offset rules as home.

### S4. Check 16 is still unmet (carried from round 1 S5)
`Not counted` lists untagged exercises, and the "none at all" line (`ProgressScreen.tsx:358-367`) opens Muscles. Neither leads to a muscle editor, because none exists.
- This is acceptable only if Ben moves check 16 to the slice that builds the editor (SP2).
- Record that decision in the spec's slice A checks, so a later review doesn't treat slice A as complete.

---

## Nits

- **N1.** `ProgressScreen.tsx:243-246`: `Edit times` still opens the whole Summary rather than the time correction, and does not return to Progress after saving (§2.3). It costs one extra tap.
- **N2.** `progress-service.ts:239-256`, `saveSettings`. Scenario:
  1. Tap A (grouping) is saved, but the write fails.
  2. Tap B (window) succeeds.
  3. `chosen` still holds A's grouping, because `chosen !== mine` for A. The screen shows a grouping that isn't saved, and it reverts after a relaunch.

  This is rare and harmless, but it could drop the failed field from `chosen` instead.
- **N3.** `progress-service.ts` projection cache is memory only. Every launch re-projects the whole history in the idle-gated prewarm: 4–6 s of sliced CPU at 600 workouts, more as history grows.
  - It never blocks for long (longest block 34 ms jitless). But if Ben opens Progress within seconds of launch, he waits on it, and it costs battery on every launch.
  - Consider persisting projections keyed by `(id, revision)` later (SP5).
- **N4.** The Muscles screen with no profile still renders `<Screen>{null}</Screen>` (`MusclesScreen.tsx:58`). It's unreachable in practice, because home shows the empty state first.
- **N5.** Records across a unit change: a series is per unit (`records.ts:81`, mirroring `findSetRecord`). So after an equipment item is switched from kg to lb, three lb sessions at a light weight can claim `Heaviest set` below the kg history.
  - This is inherited from the Summary rule and not new here.
  - If it matters, convert manual series as the import suppression already does.

## Checks against product rules

| Rule | Status |
|---|---|
| 1 Offline / no AI | OK. Everything is local. Ask on Progress carries only the window. No `How am I doing?` chip while history is unavailable |
| 2 Completed sets untouched; Undo | OK. `Count it` changes no set. Undo is reachable and bound to the produced version |
| 4 / units | OK. lb, per-hand (`each`), assisted (no records, still counts as work), and `BW +` VoiceOver words are all correct in my cases. See S2 for the unilateral count |
| 5 Idempotent, versioned | OK. `confirm_session_duration` is opId-idempotent and rejects stale versions. Double taps are guarded. Profile writes are serialised and merge on retry |
| 6 No invented data | OK. `—` rather than `0 min`; imported workouts add no time; no recovery or fatigue wording (check-23 test now covers the sheets); records are actual results and `isEstimate: false`; Est. 1RM is not shown in slice A |
| 10 Your data vs Coaching knowledge | OK. `durationConfirmedAt` and `profile.progress` are Your data, backed up (migration 8); the muscle table and `split` are catalogue knowledge in `@fizz/schemas` |
| Minimal copy | OK. Explanations live only behind `How this is counted ›` and the Time sheet footer |
| Accessibility | OK in code review. VoiceOver strings use full words ("5 October to 11 October", "185 pounds", "body weight plus 10 kilograms"), and the floating Ask stays reachable above the toast and ResumeBar. Not verified on device |
| Secrets, logging | No secrets. The only console output is the perf test's timing line |

## Spec issues (for the designer / Ben)

- **SP1.** (Round 1.) The developer dropped "This counts work done. It doesn't measure recovery or fatigue." from `How this is counted` to satisfy check 23. The spec §2.4 text still contains it, so update the spec to match.
- **SP2.** (Round 1, still open.) Check 16 needs a muscle editor that doesn't exist. Ben should either move the check to a later slice or add the editor to slice A.
- **SP3.** (Round 1, still open.) Two helper halves make a Triceps "session" (1 bench + 1 OHP set). The sheet says "at least 1 counted set". Confirm that half credits summing to 1 is intended.
- **SP4.** (Round 1, still open.) Conditioning moves with leg primaries go to Legs, because the primary muscle wins before the "no clear region → Other" rule.
- **SP5.** (Round 1, still open.) There is no target for the cold first open after launch on a long history (about 4–6 s of background projection today).
- **SP6.** (New.) PG7 and the "unilateral pair" rule don't say how to pair sides when set types differ, or when the side counts differ. Add "pair within set type" to PG7 so S2's fix has a spec.
