# Review r2: ben-bugs (Progress 30/60-day windows, custom period, Live Activity in real workouts)

Branch `claude/ben-bugs` at 5933be1, diffed against `claude/gracious-knuth-joxqpw` (merge base cbbc55a). This round covers the fixes since the first review (7a394a6..5933be1) and re-checks the whole branch. Reviewer: independent, 12 Oct 2026.

## Verdict: **PASS**

The r1 blocker (B1, no year on a custom period's dates) is fixed and tested. S1, S2 and S4 are fixed in code with tests. S3 and S5 are recorded as open questions for the designer and for Ben. No new blocking defects. Two gates remain before Ben's bug reports can be **closed**, but they don't block merging this branch:

- the L1–L15 device run, the only proof that the Live Activity now appears during a real workout; and
- Ben's confirmation of what looked wrong in the 30/60-day view.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run` (default suite) | 264 files, **4940 passed**, 1 todo, 0 failed |
| `npm run check:entitlements` | **ran.** I generated `apps/mobile/ios` with `expo prebuild --platform ios --no-install` (offline) and got `Entitlement check: OK (no forbidden keys)`. The generated entitlements (app and widget extension) hold only `com.apple.security.application-groups`, the same as before this branch. `Info.plist` has `NSSupportsLiveActivities = true` and `NSSupportsLiveActivitiesFrequentUpdates = false`. The diff touches no `app.config.ts`, `plugins/`, `package.json`, `patches/` or workflow file. I deleted the generated `ios/` afterwards; it is git-ignored. |
| Hand computation, London (r1 table) | Now a regression test (`packages/domain/test/progress-period.test.ts`, "30 and 60 days across the DST end"). It goes through `toProgressSession` and matches my r1 figures exactly. |
| Hand computation, Los Angeles (new, below) | matches |

### Independent hand count: America/Los_Angeles, PDT→PST (Sun 1 Nov 2026), week boundaries at local midnight

Today: 2026-11-02T20:00Z, which is Mon 2 Nov 12:00 PST. I ran this through `localDateOf` + `countSessions` in a throwaway scratch test, not committed.

| Session | Stored | Local date (owner zone) |
|---|---|---|
| L1 logged | 2026-10-05T05:30Z (PDT) | **Sun 4 Oct** 22:30 |
| L2 logged | 2026-10-12T06:59Z | **Sun 11 Oct** 23:59 |
| L3 logged | 2026-10-12T07:01Z | Mon 12 Oct 00:01 |
| L4 logged | 2026-09-13T06:30Z | **Sat 12 Sep** 23:30 |
| L5 logged | 2026-11-02T07:30Z (PST) | **Sun 1 Nov** 23:30 |
| L6 logged | 2026-11-02T08:30Z | Mon 2 Nov 00:30 |
| I1, I2, I3 imported | 2026-10-12, 2026-09-14, 2026-09-12 | as stored |

- **30 days** (4 Oct – 2 Nov): L1, L2, L3, I1, L5, L6 = **6**. Previous window (4 Sep – 3 Oct): L4, I2, I3 = **3**. Per week 6 × 7 / 30 = **1.4**. Bars: `4 Oct only 1 · 5 Oct 1 · 12 Oct 2 · 19 Oct 0 · 26 Oct 1 · 2 Nov only 1`, which sums to 6. The code gives exactly this.
- **60 days** (4 Sep – 2 Nov): all **9**. Previous window (6 Jul – 3 Sep): **0**. Per week **1.1**. Bars: `4–6 Sep 0 · 7 Sep 2 · 14 Sep 1 · 21 Sep 0 · 28 Sep 1 · 5 Oct 1 · 12 Oct 2 · 19 Oct 0 · 26 Oct 1 · 2 Nov only 1`, which sums to 9. The code gives exactly this.
- **Custom period** 13–14 Sep: **1** (I2; both 12 Sep sessions excluded). The previous window is 11–12 Sep. The label is `13 Sep – 14 Sep` (this year, so no year). A range of 2020–2030 is clamped to `2023-11-01 – 2026-11-02` (about 3 years, ending today).

The window arithmetic, the inclusive ends, the previous window, the part-week flags, the owner-zone projection on both sides of a DST change, and imported dates kept as provenance are all correct.

## Status of r1 findings

| r1 | Status | Evidence |
|---|---|---|
| B1 year on a period's dates | **Fixed** | `packages/domain/src/progress/text.ts:47-72` (`rangeYears`): both years when the range crosses New Year, the end's year when it isn't this year. Used by `datesLine`/`datesWords`, `span`, the records empty line, the coach `Opened from` label (`coach-service.ts:625`) and `Sees:` (`sheet-view.ts:430`). Tests cover 1y, a past-year month vs this year's, New Year, and the short form for this year's presets. |
| S1 6-month unit flip | **Fixed** | `activity.ts:43` threshold is now 20 weeks (140 d), between 3m (89–92 d) and 6m (181–184 d). A day-by-day sweep over 2025–2026 asserts one unit per preset. |
| S2 out-of-order reconciles | **Fixed** | A `(sessionId, version)` guard in both `controller.ts:129-130` and `rest-alerts.ts:131-132`; null clears it. Tests are pure (`live-activity.test.ts:142`) and through services (`:418`, `rest-alerts.test.ts:138`). |
| S3 numeral size vs spec | **Mitigated; spec open** | `minimumScaleFactor(0.6)` on both large countdowns (`RestCountdownActivity.tsx:41,74`). Device tests L9/L10 now include a 10:00+ rest and ask Ben about the size. `type.liveCountdown` still says 28/24pt (see Spec issues). |
| S4 test gaps | **Fixed** | The DST/midnight case runs through `toProgressSession`. Service-level tests cover the late read, Undo of the last set, restore and Undo restore, and a coach change during rest. |
| S5 confirm diagnosis with Ben | **Recorded, open** | Added to the `progress.md` build note. |
| N1–N6 | **Open** (unchanged, still non-blocking) | See N4 below. |

---

## Blocking

None.

---

## Should fix

### S1. Don't mark "the countdown doesn't show in workout mode" fixed until L1–L15 have run on the phone
`docs/device-tests/2026-10-12-live-activity-rest.md` (the results table is empty).
Every Live Activity test here runs against a fake ActivityKit port. Ben's report was specifically that the probe works and the workout doesn't, so the difference is in the real `expo-widgets` start/update path and this new layout (Spacer, 56/44pt, `minimumScaleFactor`). None of that has run on a device. **Failure:** the branch merges, the bug is closed, and Ben's next workout still has no Lock Screen countdown. **Fix:** build the `.ipa`, run L1–L15 (L8 force-close, L9/L10 with a 10:00+ rest, L12 swipe), fill in the table, then close the bug.

### S2. The designer's sign-off and Ben's answer are still outstanding
`docs/design/progress.md:5-9` (build note, "Designer to confirm" and "Open (review ben-bugs S5)"); `docs/design/lock-screen-and-alerts.md` `type.liveCountdown`.
The 20-week bar threshold, the year format on dates, part-week styling and the 56/44pt countdown are all developer decisions waiting for the designer. **Fix:** route these to the designer, and ask Ben which 30/60-day number looked wrong (a screenshot settles it). This is process, not code.

---

## Nits

### N1. The version guard doesn't cover a late **null** or a late read of a **different** workout
`apps/mobile/src/live-activity/controller.ts:129-130`, `apps/mobile/src/alerts/rest-alerts.ts:131-132`, `apps/mobile/src/shell/Root.tsx:55-65`.
The launch/foreground `sessions.active()` read runs outside the chain. If it resolves `null` before a Start commits but is queued after Start's reconcile, `apply(null)` ends the workout's new activity. It comes back on the next commit (the next Log), so the first set has no Ready card. The cross-workout case (a stale read of workout A applied after B started) needs a finish and a new start inside one read, so it is practically unreachable. The guard compares versions within one workout only, by design.
**Fix (optional):** give each read a monotonically increasing sequence number taken when the read *starts*, and drop a result older than the last applied one. Alternatively, do the `active()` read inside the controller's chain.

### N2. The `Sees:` label takes "today" from the device zone; the coach context uses Ben's profile zone
`apps/mobile/src/screens/coach/CoachSheetScreen.tsx:467` (`localDateOf(…, services.now().tz)`) vs `apps/mobile/src/coach/coach-service.ts:625` (`p.timezone`).
They differ only across New Year while travelling, when one shows the year and the other doesn't. **Fix:** use the profile timezone in both, as `progress-service.ts:268/320` does.

### N3. The year now shows on the 7/14/30/60-day presets in early January
`text.ts:54` names both years whenever the range crosses New Year, so on 5 Jan the `30 days` dates line reads `7 Dec 2026 – 5 Jan 2027`. That is correct and arguably useful, but it is wider than the rest of the year. Check that the line under the `WindowPicker` (`components.tsx:141`) doesn't wrap at the largest Dynamic Type size, or have the designer decide that presets ending today never need the year.

### N4. r1 nits N1–N6 are still open
- Muscles `Last trained` isn't bounded by a past period's end.
- The capability probe ends the workout's activity.
- A refused start disables the activity for the whole workout.
- The Lock Screen set numbering ignores gym-switch parts (`partRootOf`).
- Part-week bars differ by colour alone.
- Reversed dates collapse to one day.

None of these is a regression, but N2 (probe) and N3 (refused start) both turn the Lock Screen countdown off for the rest of the workout, which is the exact symptom Ben reported. Keep them in mind if L-tests show it missing.

---

## Checked and fine

- **Version guard semantics:** only strictly older versions of the same workout are dropped. An equal version passes, and the props-key dedupe keeps it a no-op. A restore calls `reconcile(null)` (`restore-service.ts:91`), which clears the guard so the backup's older version can be shown. Tested, including Undo restore.
- **Lifecycle on every rest path:** Start, Log, ±30 s, Skip, Pause/Resume, Undo, coach adjust, Finish, Discard, restore, Delete my data, force-close adopt/end, swipe. Each starts, updates or ends one activity, and a duplicate reconcile changes nothing.
- **Rule 1:** port errors are caught and logging never waits on the activity. The rest notification is always scheduled independently.
- **Rule 6:** content comes from committed state only. Targets say "target", and nothing is invented.
- **Free-provisioning:** the entitlement check passes on a fresh prebuild, and the only entitlement is the existing App Group. No push token or `frequentUpdates`.
- **Privacy:** the activity carries exercise, target and times only, and no health data is logged.
- **Custom period:** in memory only (nothing stale is saved in Your data) and clamped to about 3 years ending today. Past periods are never worded "last".

## Spec issues

1. **`type.liveCountdown`** (design-system / lock-screen-and-alerts §2.1) still says 28pt banner / 24pt expanded. The build ships 56/44pt to answer Ben's "a bit bigger". The designer needs to set the size, and Ben's L10 answer should inform it.
2. **progress.md** carries the custom period, the 20-week threshold and the year format only as a developer build note. The designer should fold them into the spec proper, including N3's question.
3. **lock-screen-and-alerts §4.2** says tapping opens `fizz://workout`, but the app has no URL scheme (carried from r1). Record in the spec or backlog that the deep link is deferred.
4. Ben's other requests from the same message are **not in this branch** and need design work plus brief changes he approves:
   - Workout Split as the default view
   - Muscle-group taxonomy: no forearms; traps and lats instead of just "back"; chest sub-groups
   - Set-duration setting
   - Exercise dropdown with line graphs and trailing averages
   - Profile criteria (age, weight, height, goals, frequency)
   - Coach-driven vs self-driven workout selection
   - Session length of 45 min ± 5/10/15
   - Main-lift choice
   - His questions about Memory › Data vs pain flags, and about the Coaching playbook

   The Muscles grouping and the window picker touched here will be reshaped by the Workout Split and exercise-progress requests.
