# Review r3: Progress slice A (home, Muscles, Calendar, Time sheet, ResumeBar)

Branch `claude/progress` (worktree `/home/user/wt-progress`) at `ae52176`, diff against `claude/gracious-knuth-joxqpw`.
Spec: `docs/design/progress.md`, mockup `docs/design/mockups/progress.html`, CLAUDE.md rules 1, 2, 5, 6 and 10, minimal copy, accessibility. Previous rounds: `docs/reviews/progress-A.md`, `docs/reviews/progress-A-r2.md`.
Reviewer: independent reviewer agent, 11 Oct 2026.

## Verdict: **PASS**

Every r2 finding is fixed or recorded as open:
- **S1.** The base is merged in (`14bd4f0`). `git merge-tree` against the current base is now clean. The base gained two docs-only commits since then.
- **S2.** Unilateral sides now pair within a set type.
- **S3.** Muscles has `Ask`.
- **S4.** Check 16 is recorded as open on O-PG6.
- **N1, N2, N4.** Fixed.

The merged tree keeps both sides of `app-services.ts`: the serialised `updateProfile`, `progress`, `progress.prewarm()` in `afterCommand`, and the base's picker services. `listSessionTypeRows` is present in `persistence/src/sessions.ts`.

Since r2, the only change to domain metrics is `countRowSets` (`packages/domain/src/progress/muscles.ts:96-122`). My hand-computed cases agree with it. Nothing blocks.

**The suite was not green on this machine.** Every failure was a wall-clock budget, and each failing file passes when rerun on its own. See "What I ran" for the full run results and S1 for what to do about it.

## What I ran

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=120000` (run 1) | 201/203 files pass. Failures: `data-domains-perf.test.ts` (1015 ms vs < 1000) and `equipment.test.ts` memo timing (820 ms vs < 500) |
| same (run 2) | 200/203 files pass. Failures: `progress-perf.test.ts` (first open 283 ms vs < 100), `catalogue/definition.test.ts` D6 and `equipment.test.ts` timing |
| failing files rerun on their own | `data-domains-perf`, `equipment` and `definition` pass. `progress-perf` passed 2 of 6 runs (the 5-file run, and run 1 of the 4-run loop) |
| `progress-perf.test.ts` (624 workouts, 4 years) under load 16–18 | cold pass about 7.8 s (longest block 84–118 ms), first open 54–90 ms, worst switch 70–138 ms, calendar 8–21 ms |

**Machine load.** The machine had 4 cores. Load average was 10–18 throughout, from other worktrees' `tsc`, `eslint` and `vitest` processes.

**Why I don't treat the perf failures as a regression.**
- r2 measured a 26 ms worst switch on a quiet machine. The numbers above scale with load, not with the diff.
- The only metric code that changed is the unilateral branch of `countRowSets`.
- The perf fixture (`HISTORY_EXERCISES`) has no unilateral exercise, so it never runs that branch.

### Hand-computed cases (new pairing rule)

I ran these through `countRowSets` in a throwaway test. I deleted it afterwards, and the tree is clean. L is a left set and R a right set; sets are working and unrated unless stated.

| Case | Expected | Got |
|---|---|---|
| L warm-up, L, L, L, R, R, R (r2 S2) | 3 hard, 1 warm-up | 3 hard, 1 warm-up |
| L RPE 8 ×2, R RPE 5 ×2 | 2 hard (each pair has a hard side) | 2 hard |
| L RPE 8 ×2, R RPE 5 ×3 | 2 hard, 1 easy | 2 hard, 1 easy |
| L marked `pain`, R unmarked | 1 hard, marked 1 (`pain`) | same |
| L RPE 5 marked `spotted`, R RPE 8 | 1 hard, not marked (the mark is on the easy side) | same |
| L warm-up, R warm-up, L warm-up | 2 warm-ups | 2 warm-ups |
| L, unsided set, R | 2 hard (1 pair + 1 lone) | 2 hard |
| L `top`, R `working` | debatable (see N1) | 2 hard |

**Unchanged since r2.** The r2 cases still hold, because their code is unchanged and their tests pass in the full run:
- time in gym (missing end times, imported sessions, the 4 h cap, confirmed durations)
- timezone week boundaries (Los Angeles, London DST)
- lb vs kg, per-dumbbell `each`, and assisted loads (no record, still counts as work)
- marked sets, and records

The Calendar detail uses the same `countRowSets`. The r2-S2 test asserts `· 3 sets` on the calendar row (`packages/domain/test/progress.test.ts:531-541`).

## r2 findings: status

| # | Status |
|---|---|
| S1 behind base / conflict | **Fixed.** Merge `14bd4f0`; the current base merges cleanly. Both sides of `app-services.ts` are kept |
| S2 unilateral pairing ignores set type | **Fixed.** Sides pair within each set type, with hard sides paired first. There are 4 new domain tests, including one through `muscleFrequency` and the calendar |
| S3 no Ask on Muscles | **Fixed.** `AskPill` is passed as `Screen.floating` on both the normal and the empty Muscles page. `Screen` reserves 56 pt under the content |
| S4 check 16 | **Recorded as open.** The spec's check 16 and O-PG6 say slice A ships without the editor. Untagged rows have no false `›` link |
| N1 Edit times opens the whole Summary | **Fixed.** `editTimes` opens the sheet at mount. Close or Save then goes back to Progress |
| N2 a failed save drops another tap's field | **Fixed.** Each field records which tap set it, and a failure drops only the fields that tap still owns. Tested at `progress-review-a-r2.test.ts:58-123` |
| N3 projection cache is memory only | Unchanged (spec issue SP5) |
| N4 blank Muscles page | **Fixed** |
| N5 records across a unit change | Unchanged (inherited from the Summary rule) |

---

## Blocking

None.

---

## Should fix

### S1. Get one full green run before merging
- **Where.** `apps/mobile/test/progress-perf.test.ts:73` (100 ms first-open and switch budget), plus three perf or timing tests outside this slice.
- **Scenario.** No full run of `npx vitest run` passed on this machine. The failures are wall-clock budgets under 4× CPU oversubscription. My analysis above rules out this diff as the cause. But "all tests pass" is still unproven for the merged tree, and the progress budget is the one this slice owns.
- **Fix.**
  1. Before merging, run `npm run check` and `npm run test:perf:jitless` on a quiet machine, or in CI with no other worktrees running.
  2. Record the progress perf line in the merge commit.
  3. Optionally, make the timing tests skip their budget assertions when `os.loadavg()[0] > os.cpus().length`. The backup tests already make that kind of allowance for parallel contention.

---

## Nits

- **N1. Pairing when the two sides have different set types.** `muscles.ts:104-121`.
  - Pairing is strictly within a set type, so `L top` + `R working` counts as 2 hard sets instead of 1.
  - This is rare: the set types normally come from the plan, so both sides share one. But a one-off retag of one side (for example, marking the left set `top` after the fact) inflates sets per muscle by 1.
  - If it matters, pair all non-warm-up types together (top, working, backoff, drop), and keep only warm-ups separate. The checks in the spec only need warm-ups kept apart.
- **N2. The perf fixture has no unilateral or dumbbell rows.** `packages/domain/src/testing` `HISTORY_EXERCISES` has 5 bilateral barbell or stack exercises, so the 100 ms budget never covers the per-type pairing loop. Add one single-arm dumbbell exercise with L/R sets to `largeHistory`.
- **N3. The r2 UI fixes are tested by reading source text.** `apps/mobile/test/progress-review-a-r2.test.ts:21-56` uses regex over `.tsx` source, so a harmless refactor breaks these tests while a real behaviour bug passes them. They are acceptable as a regression tripwire. A render test of `SummaryScreen` with `editTimes: true` would cover "Close returns to Progress" for real.
- **N4. `Edit times` presents a page-sheet `Modal` on the first render of a screen that is still being pushed.** `SummaryScreen.tsx:41`, `useState(editTimes)`.
  - On iOS, presenting a modal during a native-stack push animation sometimes doesn't show the modal.
  - Separately, swiping down to dismiss a page sheet may not call `onRequestClose` on every React Native version. In that case `done()` never runs, and Ben is left on the Summary instead of back on Progress.
  - Check both on device. If either happens, open the sheet after `transitionEnd`, and treat the sheet's `onDismiss` as close.
- **N5. The Muscles `Ask` carries only `days`.** `MusclesScreen.tsx:66-71`. It doesn't carry the grouping or which screen it came from, so the coach can't tell "Push/Pull/Legs on Muscles" from "Progress home". Consider `{ kind: 'progress', days, grouping, screen: 'muscles' }` when the coach entry gains those fields. This is harmless now, because the context carries no numbers.

## Checks against product rules

| Rule | Status |
|---|---|
| 1 Offline / no AI | OK. Everything is local, and Ask on Muscles carries only the window |
| 2 Completed sets untouched | OK. Edit times uses the existing versioned `update_session_timing` and shows a stale-version error. Nothing changes a set |
| 4 / units | OK. lb, per-hand, and assisted loads are unchanged since r2. Unilateral counting is now correct for mixed set types |
| 5 Idempotent, versioned | OK. Edit times uses an opId and `expectedVersion`. Settings saves are serialised, and failures roll back per field |
| 6 No invented data | OK. The "recovery or fatigue" line is gone from the spec as well (r2 SP1). There is no estimate in slice A |
| 10 Your data vs Coaching knowledge | OK. Unchanged since r2 |
| Minimal copy | OK. The only new copy is `Nothing to show yet` |
| Accessibility | OK in code review. Ask has `accessibilityLabel="Ask the coach"` and a 44 pt target. The content is padded so the floating pill never covers the last row. Not verified on device |
| Secrets, logging | No secrets. The only new console output is the perf test's timing line |

## Spec issues (for the designer / Ben)

- **SP1.** The developer wrote check 14's pairing rule (`progress.md:766`) and marked it "designer to confirm". The designer should confirm or amend it, including N1 (whether `top`/`backoff`/`drop` pair with `working`).
- **SP2.** O-PG6 (check 16, the muscle editor) is open. Slice A is not complete on check 16 until Ben decides.
- **SP3–SP5.** These are carried over from r2 and still open:
  - **SP3.** Two half credits for a helper muscle add up to one "session".
  - **SP4.** Conditioning moves with leg primaries go to Legs.
  - **SP5.** There is no target for the cold pass after launch: about 4–6 s at 600 workouts on a quiet machine, and about 8 s under load.
