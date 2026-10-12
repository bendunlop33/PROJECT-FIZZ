# Review: ben-bugs (Progress 30/60-day windows, custom period, Live Activity in real workouts)

Branch `claude/ben-bugs` vs `claude/gracious-knuth-joxqpw` (95be22f..f2e8b94). Reviewer: independent, 12 Oct 2026.

## Verdict: **CHANGES NEEDED**

One blocking defect, in the custom period Ben asked for: the period's only on-screen label drops the year, so the `1 year` preset reads `13 Oct – 12 Oct` and a period from last year looks like this year's. The Live Activity wiring is sound in code. It still needs the L1–L15 device run before anyone calls the "doesn't show in workout mode" bug fixed.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run` (default suite) | 264 files, 4926 passed, 1 todo, 0 failed |
| `npm run check:entitlements` | **not runnable here**: it needs `apps/mobile/ios` from `expo prebuild`, which the worktree doesn't have. Fallback: the diff touches no `app.config.ts`, `plugins/`, `package.json`, `patches/` or workflow file. `enablePushNotifications: false` and `frequentUpdates: false` are unchanged (`apps/mobile/app.config.ts:42-43`). No push-token API is called anywhere in `apps/mobile/src`. The expo-port uses only `start` / `update` / `end` / `getInstances`. Free-provisioning entitlements are unchanged by this branch. The CI `--signed` gate still applies to the built `.ipa`. |
| Hand computation (below) | matches |

### Hand-computed 30/60 days: mixed imported + logged, across the DST end and week boundaries

Owner zone Europe/London; today Mon 2 Nov 2026 (BST ended Sun 25 Oct). Logged dates go through the same `localDateOf(startedMs, ownerTz)` that `toProgressSession` uses; imported ones keep their `localDate`.

| Session | Stored | Local date |
|---|---|---|
| A logged | 2026-10-25T23:30Z (GMT) | Sun 25 Oct |
| B logged | 2026-10-04T23:30Z (BST) | **Mon 5 Oct** 00:30 |
| C logged | 2026-10-03T22:30Z (BST) | Sat 3 Oct 23:30 |
| D imported | 2026-10-04 | Sun 4 Oct |
| E imported | 2026-09-02 | Wed 2 Sep |
| F logged | 2026-09-03T23:15Z (BST) | **Fri 4 Sep** 00:15 |
| G imported | 2026-08-31 | Mon 31 Aug |
| H logged | 2026-11-01T23:59Z (GMT) | Sun 1 Nov |
| I logged | 2026-11-02T00:30Z | Mon 2 Nov (today) |

- **30 days**: 4 Oct – 2 Nov (starts Sunday). Sessions B, D, A, H, I = **5**. Previous (4 Sep – 3 Oct): C, F = **2**. Bars: `4 Oct only 1 · wk 5 Oct 1 · 12 Oct 0 · 19 Oct 1 · 26 Oct 1 · 2 Nov only 1` (sum 5). Per week 5 / (30/7) = **1.2**. Time: 4 timed of 5 (D is imported).
- **60 days**: 4 Sep – 2 Nov (starts Friday). F, C, D, B, A, H, I = **7**. Previous (6 Jul – 3 Sep): G, E = **2**. Bars: `4–6 Sep 1 · 7 Sep 0 · 14 Sep 0 · 21 Sep 0 · 28 Sep 2 · 5 Oct 1 · 12 Oct 0 · 19 Oct 1 · 26 Oct 1 · 2 Nov only 1` (sum 7). Per week **0.8**. Time: 6 of 7.

`countSessions`, `timeInGym` and `buildProgressHomeView` (words and AX rows) gave exactly these numbers. The window arithmetic, previous window, part-week flags and zone mapping are correct.

---

## Blocking

### B1. The custom period's dates line has no year: `1 year` reads `13 Oct – 12 Oct`, and last year's September reads as this year's
`packages/domain/src/progress/home.ts:360` (`datesLine: rangeText(window)`), `packages/domain/src/progress/text.ts:48-50`, `packages/domain/src/display.ts:52-55`; the same string is used at `home.ts:232-236` (`span`), the records empty line (`home.ts:369`), `apps/mobile/src/coach/sheet-view.ts:428` (`Sees: Progress · …`) and `coach-service.ts` (`Opened from` label).

**Failure:** with a custom period no segment is selected, so the dates line is the only label for the window (`components.tsx`: `custom ? datesLine : …`; in AX the header button *is* `datesLine`).
- Ben taps `1 year` → Show. The home shows `13 Oct – 12 Oct`, which looks like one day or nonsense.
- Ben picks 1 Sep – 30 Sep **2025** with the month stepper (the sheet shows the year, `shortDateText(date, true)`). The home and the coach sheet show `1 Sep – 30 Sep`, which is identical to 2026. Ben reads the wrong year's numbers as this September's. That breaks rule 6's spirit (numbers on screen must not mislead).
- A 6-month period over New Year reads `1 Nov – 30 Apr` (the branch's own test, `packages/domain/test/progress-period.test.ts:192`, asserts this ambiguous string).

**Fix:** add the year to `rangeText`/`rangeWords` (and the coach label) when the range isn't inside the current year, or when `from` and `to` are in different years: `13 Oct 2025 – 12 Oct 2026`, `1 Sep – 30 Sep 2025`. Leave the presets ending today as they are. Test the `1y` preset, a past-year month, and a range crossing New Year.

---

## Should fix

### S1. The `6 months` preset switches between week bars and month bars depending on today's date
`packages/domain/src/progress/activity.ts:38` (`WEEK_BARS_MAX_DAYS = 182`), `:79`; `window.ts` `presetProgressRange`.
`6 months` ending today is 181–184 days. Over 2026 it gets **month bars on 183 days and week bars on 182 days**: for example, 7 month bars on 12 Oct (183 days) and 26 week bars on 1 Mar (181 days). The same preset changes chart type from one week to the next. The branch's test only checks 12 Oct (`progress-period.test.ts:176-178`).
**Fix:** choose the bar unit from the preset when there is one (`3m` weeks; `6m` and `1y` months), or set the threshold at about 31 weeks so every 6-month period gets one unit. Test a sweep of `today` values.

### S2. The Live Activity controller applies whatever aggregate arrives last, even an older one
`apps/mobile/src/live-activity/controller.ts:121-176` (no version check); reconciles come from `app-services.ts:377` (after a command), `:484`/`:501` (after start, and after a coach change, which re-reads the session after an LLM turn, `coach-service.ts:712-714`), and `Root.tsx:55-66` (launch and foreground, from an async `sessions.active()` read).
**Failure:** a coach turn finishes and re-reads the session at version *n*. Before its reconcile is queued, Ben logs a set (version *n+1*, Resting) and that reconcile runs first. The coach's version-*n* reconcile then runs and puts the Lock Screen back to **Ready** with no countdown, until the next commit or foreground. The same can happen with the launch/foreground read racing a Log. Each reconcile is atomic, but they can arrive out of order.
**Fix:** keep the last applied `(sessionId, session.version)` and ignore a reconcile with an older version for the same session (null and finished still pass). Add a test: reconcile v2, then v1, and expect still Resting.

### S3. The spec still says 28pt; the build ships 56pt / 44pt (Ben asked for "a bit bigger")
`apps/mobile/src/live-activity/RestCountdownActivity.tsx:35,68` versus `docs/design/lock-screen-and-alerts.md:58,433` (`type.liveCountdown`: banner 28pt semibold, expanded 24pt).
That is double the size, in light weight, with no design note. The 44pt expanded-trailing numeral with `lineLimit(1)` risks truncating to `2:…` in the narrow Dynamic Island trailing region, and `1:02:30` (a long rest) is wider still.
**Fix:** have the designer update `type.liveCountdown` (or add a build note like progress.md's), and add a long-rest case (`≥ 10:00`) to device test L9/L10.

### S4. Tests: the timezone and lifecycle edges this change depends on aren't covered
- The two-year sweep (`packages/domain/test/progress-period.test.ts:31-34, 86-105`) builds every session at 17:30 UTC with `date` precomputed, so it never runs the owner-zone projection. It only checks that `countSessions` agrees with the fixture's own dates. **Add** the near-midnight, across-DST case above through `toProgressSession` (logged at 23:30Z / 00:30 local in BST and GMT, plus an imported workout on the same local date).
- Live Activity at the services level: only Start → Log → force-close → Finish is tested (`apps/mobile/test/live-activity.test.ts:291`). **Add:** restore while a workout's activity is showing (`restore-service.ts:91` → ended); a coach adjustment during rest (`onSessionChanged` → line2 target updated, countdown unchanged); Undo of the last set (SetUndone → back to Ready / earlier set); and the out-of-order case from S2.

### S5. The diagnosis of "something is wrong with the 30 and 60 day overviews" is a guess. Confirm it with Ben before closing the bug.
`docs/design/progress.md:5-9`. Ben didn't say what looked wrong. The branch fixes part-week bars at the ends, which is real and correct. It also flags, without changing it, that TIME/AVG come only from logged sessions when the window is mostly FitNotes. My hand check found no counting error. **Ask Ben** which number looked wrong (a screenshot would settle it) before marking this done. The build note was written by the developer ("designer to confirm"); it still needs the designer's sign-off.

---

## Nits

### N1. Muscles' `Last trained` isn't bounded by a past period's end
`packages/domain/src/progress/muscles.ts:262-266`. On a past custom period (e.g. 1–30 Sep), a group can show `Last trained 10 Oct`, after the period shown. The activity card's `Last workout` *is* bounded (`activity.ts:72`). Pick one rule: probably "up to the window end" for a past period.

### N2. Running the Capability probe during a workout kills the workout's activity for the rest of the run
`apps/mobile/src/probe/runners.ts` ends every `RestCountdown` instance before starting its own. The controller then sees the workout's activity missing and records it as swiped (`controller.ts:143-146`), so no Lock Screen countdown appears until relaunch. Either skip instances the controller owns, or make the probe say a workout is in progress.

### N3. A refused start disables the activity for the whole workout
`controller.ts:160-165`. A start that fails for a transient reason (for example, the app wasn't foreground when a coach turn's reconcile landed with `current === null`) adds the session to `skip` for the rest of the run, and `status` stays `failed`. Consider retrying on the next foreground reconcile, while still not retrying after a swipe.

### N4. The set number on the Lock Screen ignores gym-switch parts
`packages/domain/src/session/lock-screen.ts:52-60, 96-101` compares `sessionExerciseId`, not `partRootOf` as `active-view.ts:561` does. After a gym switch, the next part of the same exercise reads `Next: Bench press` with numbering restarted, which differs from the in-app header.

### N5. Part bars differ from whole ones by colour only
`chart-layout.ts` `PARTIAL_BAR_MIX`. The lighter tone (and a lighter count) is the only visual cue. VoiceOver and the AX list name the days, so this passes, but a small tick or a dotted top would follow "never colour alone" (design-system).

### N6. Reversed dates collapse to a single day instead of swapping
`window.ts` `normaliseProgressRange` turns `from > to` into `to..to`, while the app test is titled "reversed dates are put right" (`apps/mobile/test/progress-period.test.ts:59-65`). The sheet's bounds stop this happening from the UI, so either fix the test title or swap the dates.

---

## Checked and fine

- **Window maths:** inclusive `from`/`to`, previous window the same length, part-week flags at both ends, month bars that add up, `perWeek` over real days, and past periods never worded "last".
- **Custom period is in memory only:** tied to the open store, cleared by a preset, gone after relaunch. No stale fixed range is saved in Your data, and no write path changes (rule 5 not engaged).
- **One activity per workout:** started on Start (`afterStart`) and updated in place on Log, ±30 s, Skip, Pause, Resume and coach changes. It ends on Finish, Discard, restore (`reconcile(null)`), Delete my data (`endAll`, keeping the active workout), and a stale workout (≥ 6 h). Reconciles are serialised and de-duplicated by a props key, so repeats are harmless.
- **Force-close:** the first reconcile after launch adopts one running instance and ends any others. `expo-widgets` `getInstances()` lists only `.active`/`.stale` (`LiveActivityFactory.swift:47`), so a swiped (dismissed) activity is correctly treated as gone, as §4.2 specifies ("until the next app launch reconcile").
- **Capability handling:** loaded lazily and guarded, and every port error is caught. Logging and the rest notification never depend on it (rule 1). Status is honest (`not_in_build` / `failed`).
- **Content:** built from committed state only. `Until hh:mm` keeps `0:00` honest with the app suspended, and targets are worded "target" (no invented data).
- **Privacy:** the activity carries exercise, target and times only, with nothing logged beyond `lastError`.

## Spec issues

1. **progress.md v1.0 vs the build note:** the custom period, month bars and 26-week threshold were designed by the developer inside a "designer to confirm" note. The designer should own this section (and should settle S1 and B1's label format there).
2. **lock-screen-and-alerts.md §2.1 / design-system `type.liveCountdown`** still say 28pt. Ben's "a bit bigger" needs a designed size, not doubling (S3).
3. **lock-screen-and-alerts.md §4.2** says a tap opens `fizz://workout`, but the app has no URL scheme (the device-test doc says so). Either the spec or the backlog should record that the deep link is deferred.
4. Ben's other requests in the same message (Workout Split naming and default, muscle-group taxonomy without forearms and with traps/lats/chest sub-groups, a set-duration setting, an exercise-progress dropdown with line graphs, profile criteria, coach- vs self-driven workout selection, session length ±5/10/15 min, choosing the main lift) are **not in this branch**. They need design and brief changes approved by Ben, not developer guesses. The Muscles grouping and the window picker touched here will be reshaped by the Workout Split request.
