# Review: Today 18 Oct (Recent, split-day Up next, no "20 min" Up next)

Branch `claude/today-18oct`, diff `5237060..HEAD` (d0eff32, b94dd7d, c0455a2, 529c476, 7874117).
Reviewer: independent; no source edited.

## Verdict: CHANGES NEEDED

Items 1–3 (This week, lift card, Sessions rows replaced by Recent) are built and traced
end to end. Item 4 (Pull after a back day) is fixed for Ben's scenario. Item 5 is only
partly fixed. Two blocking problems remain: removing the Sessions rows broke the Done
today path for starting a second session, and the new rule plans Up next from an older
named workout even when a newer workout trained the same day, so targets go backwards.

## Validation run by the reviewer

- `npm run typecheck`: pass. `npm run lint`: pass.
- Targeted: the 7 touched/new test files, 100/100 pass.
- Full suite (`npx vitest run --maxWorkers=2`): 330/330 files, 6713 passed, 1 todo.

## Ben's 5 points, traced

| # | Point | Status |
|---|---|---|
| 1 | This week dots removed | Done (`TodayScreen.tsx`, `WeekStrip` deleted). `s.today.view` still computes `week` (dead work, N3) |
| 2 | Lift card removed | Done (`LiftCard` deleted). `today.liftHighlight` service is now dead code (N3) |
| 3 | Sessions rows under Start removed, Change kept | Done for Up next. **Regression in Done today (B1)** |
| 1–3 | Recent (last 5, any source, name · day · sets, tap opens past workout) | Done: `history.pastWorkouts({limit:5})` → `recentWorkoutRows` (domain, tested) → `RecentRow`, same `summary`/`Repeat` routing as Past workouts |
| 4 | Pull after a back day | Fixed for the scenario (domain + service test). Source choice regresses targets (B2); coach and Build card still disagree (S1, S3) |
| 5 | 20 min Up next | Title `· 20 min` stripped; short sources de-preferred. Spec's "use Profile session length / full plan estimate" not done (S2, Spec issue SP2) |

## Blocking

**B1. Done today: no way left on Today to start Up next or another session when Ben has any routine.**
`apps/mobile/src/screens/TodayScreen.tsx:470–481`. The Done today hero shows `Start next session`
only when `routines.length === 0` (the comment says "a routine row below"), and `Change` is only on
the Up next hero (`:499`). The `Sessions` list that this branch removed was the Done today path
(`todaySessions(sessions, { includeUpNext: main.kind === 'done_today' })`; session-picker.md §76: "In
Done today the `SESSIONS` list is the way to start another session", §219). The `Your workouts`
fallback shows only when `sessions === null`.
Scenario: Ben has one saved routine and finishes a workout this morning. In the evening Today shows
Done today with `View summary` and `Empty workout` only. Up next, the picker and every routine can't be
reached from Today. The brief keeps `Change` as "the way to pick another session", and here it isn't
offered.
Fix: in Done today, show `Start next session` whenever `next` exists, and the `Change` label action
whenever `hasChoice(sessions)`, as on the Up next hero. Update the stale hero comment and
session-picker.md §76/§219. Add a source/render test for the Done today state.

**B2. Up next plans from an older *named* workout even when a newer workout trained that day, so the
targets go backwards.** `apps/mobile/src/services/workout-services.ts:1889–1893`.
`byName = preferFullSource(inWindow) ?? newestNamed…` wins outright, and `splitDaySource` (newest by
muscles) is used only when no workout carries the day's name. `nextTargetsOf(p, source)` (`:1333`)
derives loads and reps from the source's own sets, and the D21 coach targets are keyed to the source.
Scenario (Ben's real week, and the branch's own test at `apps/mobile/test/session-picker.test.ts:575`,
which asserts it): `Legs` is named on 7 Oct, and an unnamed coach-built legs workout ran on Wed 14 Oct.
Up next = `Legs`, planned from 7 Oct. Wednesday's heavier sets and any coach next-session targets saved
for it are ignored, so the card offers last-but-one week's loads. Rule 3 says targets come from the
latest evidence. The old longest-gap rule had the same flaw for named types only, but this branch now
counts unnamed workouts for *which* day is due and still ignores them for *what* to plan.
Fix: pick the source as the newest full workout that was mainly that day, by muscles (`splitDaySource`),
and use the name or routine only for the title (a live routine with the day's name can still win as the
plan). If a named workout is kept, require it to be the newest that was mainly that day. Change the test
to expect the 14 Oct workout and add one for "named older vs. unnamed newer".

## Should fix

**S1. The coach's build context still names the rotation's Up next.** `apps/mobile/src/coach/coach-service.ts:1016–1017,1024`
uses `nextInRotation` directly. With a split saved and the last workout from a routine (Pull A), Today
shows the least recently trained split day, but the coach is told `upNext: Legs A`, the next routine in
the rotation. The coach can then say something different from the screen. That is the confusion Ben
reported, and the coach is reasoning from a stale fact. Fix: expose `resolveUpNext`'s name (or a shared
helper) and pass it to the coach context. Add a test that the two agree.

**S2. Item 5 is partly fixed, and the root cause is inferred, not verified.** The spec asked for the Up
next plan to use the Profile `sessionMinutes` when set, never the short actual length of a workout that
was cut short. `splitWorkoutOf` / `preferFullSource` only *de-prefer* short sources. When the only
source for the day is a cut-short or 20-minute build, it is still planned as-is, because
`startFromSession` copies only the sets that were done. Now it is titled `Pull` and no longer says
`· 20 min`, so it is less obvious that it is short. The minutes still show as `about N min`. The root
cause ("Pull · 20 min" became its own session type) comes from reading the code. Nothing checks it
against Ben's backup.
Fix (minimal): for a cut-short source, plan the skipped and unlogged working sets too, so the estimate
is the full plan's. Check the root cause against Ben's data or a backup before calling it fixed. See SP2
for the session-length part.

**S3. The Build card's preselected day still uses "the day after the last one".**
`apps/mobile/src/services/training-service.ts:90` (`nextSplitDay`). Example: last workout Push, Legs
least recent. Up next = Legs, but Build with coach preselects Pull. This is the inconsistency Ben's
point 4 is about. The developer raised it as a question; it should be decided before this ships. Fix:
use `splitDaysByDue(...)[0]` for `nextDayId`.

**S4. If no day in the pool can be planned, the fallback can still pick the day just trained.**
`workout-services.ts:1866–1870` returns null when no pool day has a plan, and then
`longestGapUpNext` (name-based, no muscles) runs. Scenario: a split is set, the only Push and Legs
workouts are older than 42 days, and back was yesterday. Up next falls through to longest gap and can
be Pull. Fix: when the pool has no plan, try the remaining split days (excluded last), or stop
`longestGapUpNext` from returning a type whose newest session trained the excluded days. Add a test.

**S5. The card title and the started workout's name differ.** `workout-services.ts:1906` sets
`title: day.name` (e.g. `Legs`). Start names the new session `upNextName(source) ?? 'Workout'`
(`:2221`, `:2391`). Scenario: the source is an unnamed coach build that was mainly legs. The card and
overview say `Legs`, but the workout and Recent say `Workout` or the derived title. Fix: pass the
resolved title as `name` on Start from Up next, or don't rename on the card.

**S6. Test gaps.** Item 5 has no service-level test: a stored `Pull · 20 min` coach build passed over for
a full one, and its title stripped on the card, the overview and the started name. Also missing:
split set with the last workout from a routine (split wins over rotation); S4's fallback; Done today
on Today (B1). `session-picker.test.ts:419–422` was weakened: it now builds a synthetic routine target
instead of using the row's real target. So "routine deleted while the picker is open" no longer runs
through the recommended row, which now opens `{kind:'next'}` and would silently open a different plan.
Keep a test on the real row's behaviour.

**S7. The design docs weren't updated.** `docs/design/today.md` §5 and acceptance checks 7 and 25 (This
week, pinned lift) and session-picker.md §76/§219 (Done today `SESSIONS`) now describe UI that's gone.
CHANGELOG has the entry. The specs should mark these as superseded so the next reviewer doesn't check
against them.

## Nits

- **N1.** A `Workout · 45 min` coach build: `upNextName` returns `Workout` (`workout-services.ts:1397`), not null, so the derived title (`Push`) is skipped. Return null when `baseWorkoutName` is the generic name.
- **N2.** Recent shows coach-build names with `· 45 min` next to `Yesterday · 16 sets`. Read together, the 45 min looks like how long the workout took. Use the same stripped name as Up next (the developer raised this, question 5).
- **N3.** Dead code: `today.liftHighlight`, `weekStripLabel`, the `view.week` computation, `todaySessions` and `lastDoneText`, which Today no longer uses. Remove them or stop computing them on every Today load.
- **N4.** `splitUpNext` reads 42 days of full aggregates plus one `exerciseById` per exercise, in sequence, and `resolveUpNext` runs from preview, sessions.list, overview and library on each Today load. Fine at Ben's volume. Cache per load if Today gets slow.
- **N5.** An unreadable session in the window (`listFinishedBetweenReadable`'s `unreadable`) is silently ignored. If it was yesterday's, its day can come up next. Acceptable, but worth a comment.
- **N6.** The Done today workout appears in both the hero and Recent (`Today`). That's fine; just noting it.
- **N7.** `newestFirst`'s tie-breaker returns -1 for equal IDs (not a consistent comparator). Harmless with unique IDs.

## Product rules check

1. Offline/no AI: all new logic is local; the test asserts no model requests. OK.
2. Completed sets: nothing writes. OK.
3. Deterministic targets: see B2 (stale source) and S1/S3 (inconsistent Up next).
4. Equipment: unchanged path (`startFromSession` / `routineStart` fit). OK.
5. Idempotent writes: there are no new writes, and preview op IDs are unchanged. OK.
6. No invented data: `0 sets` and set counts are honest. Imported workouts get no duration. OK.
7. Secrets: none. 8. Imported content: names are shown as data only. OK.
9. Pain: unchanged (targets still go through `builtInNextTargetsOf` pain holds). OK.
10. Your data / knowledge: Recent reads owner history only. OK.
UI copy: minimal; no new explanatory lines. The `split` basis falls back to `From <date>`. OK.

## Regressions checked

- No split set: the rotation still wins when the last workout came from a routine (`nextInRotation` needs `refs[0]` to come from a routine). Otherwise PPL by muscles. OK.
- No history: `splitDaysByDue` returns [], so the old fallback runs, then First workout. OK.
- Workout in progress: Resume hero, and Recent is shown. Finished workouts only. OK.
- Done today: **B1**.

## Spec issues

- **SP1 (causes B2).** The spec says "plan that day from the routine/session type with that day's name if one exists, otherwise from the newest workout that trained that day's body parts". Putting the name first makes an older named workout beat a newer one, and with source-based targets that regresses loads. Proposed wording: plan from the newest full workout that was mainly that day; a routine with the day's name is the plan only if Ben saved one.
- **SP2.** "Up next plan uses Ben's Profile session length". Making a plan fit a longer session means adding exercises or sets. That is a structural change, which rule 3 reserves for the coach as a proposal. The developer was right not to stretch plans. Proposed: show the plan's honest estimate, and offer `Build with coach` when it is well under the Profile length. Ben to decide.
- **SP3.** Removing the Sessions rows conflicts with session-picker.md's Done today flow (B1). The spec should say where Change lives in Done today.
- **SP4.** The 42-day window, the 1/3 day share and the 25% cut-short threshold are PM picks. They are recorded as pending Ben.

## Full suite

Reviewer run on HEAD 7874117: 330/330 files, 6713 passed, 1 todo, 0 failed.
