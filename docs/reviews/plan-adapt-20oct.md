# Review: plan-adapt-20oct (adaptive Up next, Make next, Pause, End restores)

Branch `claude/plan-adapt-20oct`, diff from merge-base with `claude/gracious-knuth-joxqpw` (7 commits, 46 files).
Reviewer: independent. Date: 20 Oct 2026.

## Verdict: **CHANGES NEEDED**

There are 2 blocking issues and 5 should-fix issues. The core domain is sound and well structured:
- The adaptive pick, Make next, the pause window, End's restore and its Undo are all pure, versioned and idempotent.
- Migration 25 keeps every kind from migration 23.
- Today's `Day N of M` and Your plan's `Next` are both suppressed while the plan is paused.

Two problems block it. Ending (or superseding) a paused plan permanently disables the weekly aim. The coach's pause gate also treats statements about a *future* holiday (and "I'm back …") as a request to pause or resume *now*.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --maxWorkers=2`: **370 files, 7182 passed, 1 todo**, exit 0. The developer reported 373 files and 7253 tests, which does not reproduce in this worktree (see N1).
- `npm run check:migrations`: "Migrations OK: 1 to 25".
- I probed the domain and coach directly with tsx scripts (kept in the scratchpad, not committed) to confirm B1, B2, S1, S2, S3 and S4 below.

## Blocking

### B1. Ending or superseding a paused plan leaves an open pause that cancels the weekly aim from then on
- Files: `packages/domain/src/session/coach-plan.ts:462` (`endPlan`), `:335` (supersede in `applyPlan`), `packages/domain/src/session/plan-adapt.ts:225-235` (`pausedDates`), `apps/mobile/src/services/plan-services.ts:559` (the consistency service reads the pauses of every plan, ended ones included).
- `endPlan` and supersede set `status` but leave `pauses` alone, so a running pause keeps `endedAtUtc: null`. With `untilDate: null`, `pausedDates` treats every date from the pause's start up to the end of the current week as paused (capped at 400 days). The consistency service deliberately includes the pauses of ended plans.
- **Failure:**
  1. Ben taps Pause plan ("Until I resume") on 1 Oct, then on 5 Oct taps End plan (or applies a new plan).
  2. From then on, every Consistency week has 7 paused days: `aim: null`, `atAim: null`, and the text is the bare count.
  3. "Weeks at your aim" stops counting new weeks. A newly applied plan's `Plan this week` reads `N of N`, because `planWeekOf` = max(done, 0).
- I confirmed this. A pause from 1 Oct with `untilDate: null` gives 60 paused dates through 29 Nov, and the week of 16 Nov is shown as `{"aim":null,"pausedDays":7,"text":"4"}`.
- This breaks the spec ("don't count *paused* days against the aim") and rule 6 (the Consistency card silently stops judging), and no UI can resume an ended plan.
- **Fix:** in `endPlan` and the supersede `bump`, close a running pause at `at.utc` (`endedBy: 'end'` or `'ben'`). Restore it in `undoEndPlan` and in Undo of Apply's restore of a superseded plan, as before. As a backstop, have `pausedDates` cap an open pause at the plan's `ended.atUtc` or `supersededBy.atUtc`. Add tests for End while paused → Consistency next week judged, and for Apply-over-paused.

### B2. The coach's pause gate treats future holiday mentions and "I'm back …" as a request to apply now (rule 3)
- Files: `packages/coach/src/request.ts:806-818` (`PAUSE_PLAN` and `RESUME_PLAN`), with `packages/coach/test/pause-plan.test.ts` asserting `'going on holiday next week'` "asks".
- `pause_plan` is `needs: 'ben_request'` and applies at once. The gate matches future forms (`going`, `heading`, `i will be`, `i'll be`, `off … on leave`), but a pause always starts **now** because there is no start date. `RESUME_PLAN` matches a bare `i'm back`.
- I confirmed:
  - "going on holiday next week" opens the tool.
  - "im off on leave in december" opens it.
  - "I'm back to 100 kg on bench" opens it, so the model may resume a holiday pause.
- **Failure:** on 20 Oct Ben says "going on holiday next week, anything I should do before?". The model has `pause_plan`, and the turn counts as Ben asking, so it pauses the plan from today. That costs a week of plan-driven Up next and the aim, and nothing was offered first. Rule 3 says a change the coach raises on its own is offered ("Want me to adjust?") and doesn't apply until Ben accepts.
- **Fix:**
  - Drop the future forms (`going`, `heading`, `i will be`, `i'll be`, `we'll be`, `off on`) and keep present-tense or imperative ones ("pause my plan", "I'm on holiday (till …)", "I'm away until …").
  - Require `back` to be followed by end-of-clause or `from (holiday|…)` / `home`.
  - For the future cases, let the coach *offer* (no tool), or add an explicit start date (see Spec issue SP1).
  - Add negative tests for these phrases.

## Should fix

### S1. Your plan ✓ and Up next disagree for a plan workout Ben turned into another day
- Files: `packages/domain/src/session/plan-adapt.ts:123-128` (`planDaysDoneBy`: a plan workout counts for its own day only), compared with `:106-116` (`planDaysCredited`: own day + main day + twins).
- The spec says ✓ applies to "a plan workout for it OR any workout that mainly trained its body parts".
- **Failure:** Ben starts the plan's Pull day at a busy gym and does only squats and RDLs. I confirmed that Your plan shows Pull ✓ and Legs not ✓, while Up next treats Legs as just done and offers Push. Legs is never ticked that week even though he trained it, and Pull is ticked although no pulling was done.
- **Fix:** have `planDaysDoneBy` return `own ∪ (main day if it differs from own)`, the same credit Up next uses minus twins. Or decide the rule with Ben and make both functions use one definition. Add a test.

### S2. A Make next pin is cleared by a workout that didn't do the pinned day
- File: `packages/domain/src/session/plan-adapt.ts:141-146` (`activePin` uses `planDaysTrained`: own day + every day with at least a third of the sets).
- The schema doc and CHANGELOG say the pin lasts "until it is done", and ✓ says a plan workout counts for its own day only.
- **Failure:** the plan is Push/Pull/Legs/Upper. Ben pins Upper, then does the Pull plan day (all back and biceps). I confirmed `activePin` returns `null`, so the pin is gone, yet Upper is not ✓ and Ben never did it.
- **Fix:** clear the pin with the same predicate as ✓ (`planDaysDoneBy`, after S1). Add a test for a Pull workout after an Upper pin, expecting the pin to stay.

### S3. A pin comes back after its completing workout leaves the 42-day window, and PlanDay and Up next disagree
- Files: `apps/mobile/src/services/workout-services.ts` (`planDue` passes only `SPLIT_WINDOW_DAYS` of workouts to `planDaysByDue` → `activePin`), compared with `apps/mobile/src/services/plan-services.ts:470` (PlanDay reads every workout since the pin, with no window). The pin is never removed from storage when it is done.
- **Failure:** Ben pins Legs and does it the same day, then goes on holiday for six weeks. When he gets back, the Legs workout is outside the window, so Up next shows Legs as pinned again. PlanDay meanwhile shows "Make next" (not pinned), and tapping it writes a second pin.
- I confirmed that `activePin(pin, days, [])` returns the pin.
- **Fix:** when Up next or a finish sees a pin as done, write `pin: null` (versioned), or store `doneBySessionId`. At minimum, have `activePin` treat a pin older than the window as expired, and give both callers the same workouts.

### S4. The date from Ben's words wins even when the parser picks the wrong date
- Files: `packages/coach/src/pause-plan.ts:27-29, 49-67, 86`.
- The parser takes the *first* day-month in the text, and a day-month equal to today rolls over to next year. Because words always win, the model cannot correct either case.
- **Failures** (both confirmed):
  - "I'm on holiday from 25 Oct to 3 Nov" → `until 2026-10-25`, so the pause ends the day his holiday starts.
  - "away until 20 Oct", said on 20 Oct → `2027-10-20`, a one-year pause.
- **Fix:**
  - Prefer the date after `till`, `until`, `to` or `back on`, and fall back to the last date in the text.
  - When the words name more than one date, use the model's date if it is one of them.
  - Treat a same-day date as `bad_date`, not next year.
  - Add tests for these cases.

### S5. Nothing covers the pause and pin edge cases above, or the coach gate's false positives
- Files: `packages/domain/test/plan-adapt.test.ts`, `apps/mobile/test/plan-adapt.test.ts`, `packages/coach/test/pause-plan.test.ts`.
- The happy-path flow is well tested. Missing:
  - End or Apply while paused (B1)
  - a plan workout done as another day, and its ✓ (S1)
  - a pin cleared by a different day (S2)
  - a pin past the window (S3)
  - multi-date and same-day phrases (S4)
  - "I'm back to …" and future-holiday phrases (B2)
  - auto-resume across a timezone change
  - Undo of pause after auto-resume (should be stale)
- **Fix:** add these cases.

## Nits

- **N1.** The developer reported 373 test files and 7253 tests. This worktree gives 370 and 7182. Re-run and report the real figures.
- **N2.** `YourPlanBlock` computes `today` and the wheel's `minimumDate` in `now.tz`, but `validPauseUntil` uses `p.timezone`. When Ben is abroad (the main pause case), the earliest date on the wheel can be refused with "Pick a date after today." Use one zone for both.
- **N3.** Auto-resume is written only on cold start (`startup.ts`). Reads are already correct, but a plan left in memory past `untilDate` keeps an open stored pause, so the Resume or Pause path has to close it. This works but is fragile. Also run `autoResume` on app foreground.
- **N4.** `pinPlanDay` doesn't refuse while paused (only the UI hides the button). A stale screen can pin during a pause. This is harmless but unspecified.
- **N5.** If the replaced workouts include an older plan's days (Replace over a superseded plan), End puts them back as ordinary rotation workouts. The older plan stays `superseded`. Check that this is what Ben expects from "as they were before Apply".
- **N6.** Migration 25 rebuilds `coach_actions`. At merge, renumber it after any branch's 25. Its CHECK must be the union of both branches' kinds.

## Rules checklist

- **Rule 1** (offline, honest AI): pass. All of this is local; the claim check only allows a "paused your plan" line when a `pause_plan` was committed.
- **Rule 2** (completed sets untouched, proposals with Undo): pass. Plan days and sets are untouched; pin, pause, resume and End each have Undo.
- **Rule 3** (asked vs offered): **fail** (B2).
- **Rule 5** (versioned, idempotent writes, stale rejected): pass. Domain guards plus `saveDocumentIn` expected versions; the coach Undo checks `versionAfter`; a stale Undo changes nothing.
- **Rule 6** (no invented data): **fail** (B1, the aim stops being judged).
- **Rule 7**: no secrets added.
- **Rule 8**: Ben's words are parsed only for dates and gating, never executed.
- **Rule 10**: the plan pause view goes in Your data.
- **Minimal copy**: pass (`Paused · until 3 Nov · Resume`, `Make next`, `Why?`).

## Spec issues

- **SP1. Holidays usually start in the future.** The spec gives Pause only an optional `until`, so "I'm going on holiday next week until 3 Nov" can't be represented and the pause starts today. Propose an optional `from` date (date wheel, default today) so the coach and the UI can schedule a pause. Ben to decide. Until then, B2's fix should make the coach offer rather than apply for future-tense mentions.
- **SP2. ✓ vs "take turns".** The spec defines ✓ by muscles for *any* workout. The PM decision "overlapping days take turns" limits a plan workout's credit, so ✓, Up next and the pin each use a different definition (S1, S2). Ben should confirm a single rule.
- **SP3. "Till 3 Nov".** It is ambiguous whether this means back in use *on* 3 Nov or *after* it. The build chose "on". This is reasonable, but it is recorded only as a pending PM decision.
