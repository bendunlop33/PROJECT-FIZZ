# Review: Ben's decisions 20 Oct, slice "runs" (items 6, 12, 13, 14, 15)

Branch `claude/ben-runs-20oct` (708fb7b, 5a4cd27, 6538cfa), diffed from its merge-base with `claude/gracious-knuth-joxqpw` (c62ef40).

**Verdict: CHANGES NEEDED**

The checks I ran myself all pass: `npm run typecheck` passes, `eslint .` is clean, and `vitest run --maxWorkers=2` reports 399 files, 7674 passed and 1 todo. Items 13 and 14 match the code, and so does the Cancel write: it is the versioned tombstone with stale and duplicate refusal and Undo, and that is tested. The `Time to train` / `Pull is next · …` wording matches item 6.

Two problems block the slice. The first is a rule 6 honesty problem: a planned run on today's date is shown and given to the coach as done before it has happened. The second is that a day-1 reminder can name a session that Up next won't show.

## Blocking

### B1. A planned run dated today shows as done and the coach is told `done` before it happens (rule 6)
- **Where:** `packages/domain/src/activity.ts:74-76` (`activityAhead` uses `date > today`), `:201` (`activityRow`), `:221-223` (`activityStatusOn`); used at `apps/mobile/src/services/week-services.ts:403` (the coach's week view).
- **Scenario:** at 07:00 Ben plans a long run for 18:00 today. Today's Recent drops `Planned` and lists `Run · Today · 18 km · long`, which reads as finished. The coach's week context gets `Run · Tue 2026-10-20 · done · 18 km · long`, so the coach can say "nice run today" or reason from a run that hasn't happened. The test `packages/domain/test/activity.test.ts` ("no Planned word once its date has come") asserts `activityStatusOn(plannedToday) === 'done'`, so the test locks the bug in.
- **Why it matters:** item 12 says a planned run *counts* on its date for **the leg rule and week facts**. It does not say the run should be relabelled as done. Rule 6 forbids presenting data we don't have, and the developer raised this case as open question 3.
- **Fix:** keep display and coach status separate from "counts".
  - `legRunNear` and `weekFacts` keep counting the run as built.
  - `activityRow` keeps `Planned` while `date >= today`.
  - The coach line keeps `planned` for today. For past dates use a precise word such as `planned (counts)` rather than `done`, or keep `planned`; see Spec issue 1.
  - Update the domain test and `apps/mobile/test/week-flex.test.ts` to match.

### B2. A `Make next` pin is moved off day 1 when that day falls tomorrow, so the reminder names a session Up next won't show
- **Where:** `packages/domain/src/morning-reminder.ts:192-199` (`placeReminderSessions`) and `apps/mobile/src/reminders/forecast.ts:53` (`exact.legs` is set but the pinned flag is never carried).
- **Scenario:**
  1. Ben pins Legs with `Make next`, and a long run is planned for Saturday.
  2. On Thursday after 07:00, the first slot is Friday, so `exact` is false.
  3. `pool[0].legs` is true and `legRunNear(Fri)` finds the run, so the code takes the first non-leg session.
  4. Friday's notification reads `Time to train · Push is next …`.
  5. On Friday, Up next (`planDue`, `workout-services.ts` ~2043) keeps the pinned Legs first, so Today shows Legs.
- **Why it matters:** nothing changes overnight to trigger a reschedule, so the wrong notification fires. This breaks the earlier review's rule (morning-20oct B1: never name a session Up next wouldn't name). It also contradicts the developer summary and CHANGELOG ("a `Make next` pin stays first"). Only `planDaysAhead` keeps the pin, and that only covers days 2 onwards.
- **Fix:**
  - Add `pinned?: boolean` to `ReminderSession`.
  - Set it from `next.routine` / the plan pin in `readUpNextForecast`.
  - Never defer a pinned session in `placeReminderSessions`.
  - Add a domain test (pinned leg day 1 on a later date with a run the next day stays put and keeps its wording) and an end-to-end test in `apps/mobile/test/morning-reminder.test.ts`.

## Should fix

### S1. For a rotation, "the leg day waits" doesn't match how Up next walks a rotation
- **Where:** `packages/domain/src/morning-reminder.ts:186-201`. The test `packages/domain/test/morning-reminder.test.ts` ("no legs the day after or before a long run…") expects `Thu: Legs is next`.
- **Scenario:**
  1. The rotation is Push, Pull, Legs, Upper, with Pull done Tuesday and a long run planned Thursday.
  2. The reminders predict Wed Upper (correct), then **Thu Legs** and Fri Push.
  3. Up next for a rotation is "the one after the last done" (`rotationOrder(…, refs[0])`, `workout-services.ts:1949`). After Upper on Wednesday, Thursday is **Push**, not Legs. The leg day is skipped in the rotation, not held back.
- **Impact:** the forecast recomputes after each finished workout, so each day-1 reminder ends up right. Days 2-7 are still predicted wrongly whenever the rule moves a rotation day.
- **Fix:** for `cycle` forecasts, continue the walk from the session actually picked, as `rotationOrder` does. Keep the "waits" model only where it matches the resolver. For plans that is already handled by `planDaysAhead`, so the second pass over plan sessions in `placeReminderSessions` is mostly redundant and should be skipped for `ahead` sessions apart from day 1. Fix the test expectation.

### S2. The CHANGELOG records unapproved behaviour as approved
- **Where:** `docs/brief/CHANGELOG.md`, last entry.
- **Problem:** under "Ben approved", the entry lists "Recent and the calendar drop `Planned` once the date has come; the coach's week reads it as `done`". Ben approved counting the run for the leg rule and week facts (item 12), not relabelling it.
- **Fix:** move this to an open question for Ben, or fix it together with B1.

### S3. A non-pinned plan day 1 deferred to tomorrow may name a different day from Up next
- **Where:** `packages/domain/src/morning-reminder.ts:193-196`.
- **Problem:** when day 1 is tomorrow and is deferred, it takes the pool's first non-leg session, which is `ahead[0]`. That entry was predicted *assuming the leg day was done first*. Tomorrow's real Up next is `planDue` ordered by least-recently-trained without that assumption, so it can pick a different non-leg day.
- **Fix:** for the plan path, have the service predict day 1 for `dates[0]` too, via `planDue` with `nearOn(dates[0])`, rather than reordering the pool in the domain.

## Nits
- **N1.** `activityCounts` (`packages/domain/src/activity.ts:69`) is exported and tested but no production code uses it. The leg rule and week facts re-implement "live, any status". Use it, or drop it.
- **N2.** `workout-services.ts:4102` sorts `dates` twice inline, and the dates are already in order from `reminderSlots`. Use `dates[0]` / `dates.at(-1)`.
- **N3.** A planned run from a past date shows as done in Recent (B1 aside) while its sheet still offers `Cancel run`. Once B1 is settled, make sure the row and the sheet agree.
- **N4.** The forecast runs `reminderSlots` itself, and then the schedule runs it again with the same inputs. That works today, but the two could drift. Consider passing the slots through.

## Checked and fine
- Cancel uses the existing versioned `deleteActivity`. It gives a stale or duplicate refusal and its Undo restores counting, which is tested in both domain and mobile. The toast says `Run cancelled` / `Activity cancelled` with Undo. Copy is minimal.
- `legRunNear` counts a long or hard run yesterday or tomorrow whether planned or done, and ignores deleted ones. Easy runs and long rides are excluded (item 13). Distances are km only (item 14).
- `weekFacts.blocked` counts run dates from `start` to Sunday only, so past runs don't reduce the remaining days. `legNote` only names runs from today on.
- Activities read around the reminder dates cover the day before the first date to the day after the last, with an exclusive end (`between(first-1, last+2)`).
- `planDaysAhead.nearOn(i)` lines up with `dates.slice(1)`, so `ahead[i]` belongs to slot `i+1`.
- There are no new logs of health data and no secrets.

## Spec issues
1. **What "counts" means for display and the coach (item 12).** Ben approved counting the run for the leg rule and week facts. It is not decided whether a past planned run that was never confirmed should be *shown* or *given to the coach* as done. Recommendation: show it as `Planned` until its date, show nothing extra afterwards, and tell the coach `planned (counts)` rather than `done`. Ben to confirm.
2. **The long run's own day.** `legRunNear` only checks the day before and the day after. On the day of the long run, Up next and the reminder may say `Legs is next`, which the test asserts. Meanwhile `weekFacts` treats that date as taken (not an open gym day). Ben should say whether a gym reminder should fire at all on a long or hard run day, and whether legs are acceptable that day.
3. **Day 1 on a later date (developer open question 2).** When today's reminder time has passed, day 1 fires tomorrow worded `Today: X`, unless the run rule moved it. That is technically a prediction for tomorrow. Item 6 says "today's (day 1)", so this case is not covered. Ben to confirm.
4. **Cancel deletes rather than recording "didn't happen" (developer open question 1).** This fits rule 2 and Undo. If Ben wants cancelled runs kept in history, that needs a schema `cancelled` status.
