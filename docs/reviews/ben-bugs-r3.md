# Review r3: ben-bugs (Progress 30/60-day windows, custom period, Live Activity in real workouts)

Branch `claude/ben-bugs` at 63f274c, diffed against `claude/gracious-knuth-joxqpw`. This round covers the fixes since r2 (70ca48c..63f274c: c5fa6af, f92e10a, 63f274c) and re-checks the whole branch. Reviewer: independent, 12 Oct 2026.

## Verdict: **PASS**

Every r2 nit the developer took on is fixed and tested:

- r2 N1: a late launch or foreground read is dropped by a read ticket.
- r2 N2: `Sees:` uses the profile zone.
- r2 N3: the dates line shrinks and wraps only at the dash.
- r1 N2: the probe no longer ends the workout's activity.
- r1 N3: a refused start is tried again.
- r1 N4: Lock Screen set numbers run across gym-switch parts.
- r1 N6: reversed dates are swapped.

There are no blocking defects. My second hand count (Australia/Sydney, DST start, a local-midnight "today") matches the code exactly. The entitlement check passes on a fresh prebuild.

The two process gates from r2 still apply before Ben's bug reports are **closed**:

- the L1–L17 device run; and
- Ben's answer on what looked wrong in the 30/60-day view.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run` (default suite) | 264 files, **4946 passed**, 1 todo, 0 failed (r2: 4940; +6 new tests) |
| `npm run check:entitlements` | **ran.** `expo prebuild --platform ios --no-install` (offline), then `Entitlement check: OK (no forbidden keys)`. App and `ExpoWidgetsTarget` entitlements hold only `com.apple.security.application-groups` (`group.com.projectfizz.fizz`). `Info.plist`: `NSSupportsLiveActivities = true`, `NSSupportsLiveActivitiesFrequentUpdates = false`. The diff touches no `app.config.ts`, `plugins/`, `package.json`, `patches/` or workflow file. I deleted the generated `ios/` (git-ignored) and the tree is clean. |
| Mutation checks | I disabled the read-ticket drop in `rest-alerts.ts`: 2 tests fail (`rest-alerts.test.ts`, `live-activity.test.ts`). I put back `skip.add` on a refused start in `controller.ts`: 1 test fails. Both reverted. The new guards are really covered. |
| Native start path | `node_modules/expo-widgets/ios/LiveActivityFactory.swift:17-38`: `start` **throws** when Live Activities are off or `Activity.request` fails. It never returns a dead instance, so the new "retry a refused start" can't turn into a false "swiped" skip. |

### Independent hand count: Australia/Sydney, AEST→AEDT (Sun 4 Oct 2026 02:00), "today" just after local midnight

Now: 2026-11-30T13:30Z, which is **Tue 1 Dec 00:30 AEDT**. UTC is still 30 Nov. Weeks run Monday–Sunday in the owner zone. I ran this through `toProgressSession` → `countSessions` in a throwaway test (not committed, deleted).

| Session | Stored | Local date (owner zone) |
|---|---|---|
| S1 logged | 2026-10-03T14:30Z (AEST +10) | **Sun 4 Oct** 00:30 |
| S2 logged | 2026-10-01T13:59Z | Thu 1 Oct 23:59 |
| S3 logged | 2026-11-01T13:30Z (AEDT +11) | **Mon 2 Nov** 00:30 |
| S4 logged | 2026-11-01T12:30Z | **Sun 1 Nov** 23:30 |
| S5 logged | 2026-11-30T13:00Z | **Tue 1 Dec** 00:00 (today) |
| S6 logged | 2026-11-29T13:30Z | Mon 30 Nov 00:30 |
| I1–I4 imported (startedAt zone London, irrelevant) | 2026-11-02, 2026-10-02, 2026-08-02, 2026-12-01 | as stored |

- **30 days** (2 Nov – 1 Dec): S3, I1, S6, S5, I4 = **5**. The previous window (3 Oct – 1 Nov) has S1 and S4 = **2**. Per week: 5 × 7 / 30 = **1.2**. Bars are `2 Nov 2 · 9 Nov 0 · 16 Nov 0 · 23 Nov 0 · 30 Nov–1 Dec 3 (part)`, which sum to 5. Code: identical.
- **60 days** (3 Oct – 1 Dec): S1, S4, S3, I1, S6, S5, I4 = **7**. I2 (2 Oct) and S2 are excluded. The previous window (4 Aug – 2 Oct) has S2 and I2 = **2**; I3 (2 Aug) is excluded. Per week: 7 × 7 / 60 = **0.8**. Bars are `3–4 Oct 1 (part) · 0 · 0 · 0 · 26 Oct 1 · 2 Nov 2 · 0 · 0 · 0 · 30 Nov–1 Dec 3 (part)`, which sum to 7. Code: identical.
- **Custom, reversed** `{from: 1 Nov, to: 4 Oct}` is swapped to 4 Oct – 1 Nov (29 days). Count **2** (S1, S4). The previous window (5 Sep – 3 Oct) has S2 and I2 = **2**. Per week: 2 × 7 / 29 = **0.5**. Week bars start `4 Oct (part)`. The label is `4 Oct – 1 Nov`. Code: identical.
- **Custom, one day** (4 Oct, the DST day): 1, previous 0, no per-week figure, one day cell. Code: identical.
- **Custom, long** (1 Jan 2026 – 1 Mar 2027) is clamped to 1 Jan – 1 Dec 2026. It shows 12 month bars: Aug 1, Oct 3, Nov 4, Dec 2 (part). The total is 10. Code: identical.

Together with r2's London and Los Angeles counts, the window arithmetic has now been checked by hand in three zones, both DST directions and a positive UTC offset where today's local date is ahead of the UTC date. The checks cover inclusive ends, the previous window, part-week flags, month bars, reversed or clamped custom periods, and imported dates kept as provenance. All are correct.

## Status of r2 findings

| r2 | Status | Evidence |
|---|---|---|
| S1 device run L1–L15 | **Open** (now L1–L17) | `docs/device-tests/2026-10-12-live-activity-rest.md`. The results table is still empty. L16 (probe during a workout) and L17 (Live Activities turned back on) were added for this round's changes. |
| S2 designer / Ben sign-off | **Open** | `docs/design/progress.md` build note; `type.liveCountdown`. |
| N1 late null / other workout | **Fixed** | `apps/mobile/src/alerts/rest-alerts.ts:136-182`. `reconcileFromRead` takes a ticket when the read *starts*, and a result older than any later-issued reconcile is dropped (before the Live Activity is touched). `Root.tsx:52-63` uses it for launch and foreground. Tests: `rest-alerts.test.ts:152` (late null, another workout's state, a failing read) and `live-activity.test.ts:477` (through services: the late null leaves Ready, no `end`). |
| N2 `Sees:` zone | **Fixed** | `coach-service.ts:930-938` (`today()` at :935) , `CoachSheetScreen.tsx:142-144,472`. Test `progress-period.test.ts` (apps) checks 00:30 London BST → 13 Oct. |
| N3 early-January dates line | **Mitigated** | `components.tsx:140-141` (`flexShrink: 1`). The domain test asserts the only breakable spaces are around the dash. Whether presets ending today should ever show the year is still the designer's call (Spec issues). |
| N4 / r1 N2 probe ends workout activity | **Fixed** | `live-activity/probe-ledger.ts`, `probe/runners.ts:512-538`. Only this run's probe IDs are ended. |
| N4 / r1 N3 refused start disables it for the workout | **Fixed** | `controller.ts:165-176`. A refusal no longer adds to `skip`; the next reconcile (a Log, a foreground, the deadline recheck) tries again. Only a swipe skips. |
| N4 / r1 N4 set numbers ignore gym-switch parts | **Fixed** | `packages/domain/src/session/lock-screen.ts:55-56,98`. `blockSets` and `partRootOf` are the same helpers the in-app header uses (`active-view.ts:350-352,510`). Test `lock-screen.test.ts:68`. |
| N4 / r1 N6 reversed dates collapse | **Fixed** | `packages/domain/src/progress/window.ts:504-515`, tests in both suites. |
| N4 / r1 N1, N5 | **Open** | Nits N1 and N2 below. |

## Live Activity lifecycle re-check (whole branch)

The rest paths are Start, Log, ±30 s, Skip, Pause and Resume, Undo, coach adjust and its Undo, chat Log, Finish, Discard, restore, Undo restore, Delete my data, force-close (adopt or end), swipe, and a refused start. Each path starts, updates or ends **one** activity. A duplicate or equal-version reconcile changes nothing (the props-key dedupe). An older version is dropped by the version guard, and a read older than a commit is dropped by the new ticket.

All reconcile call sites go through the one `restAlerts` controller:

- `afterCommand` and `afterStart`
- coach `onSessionChanged` (a fresh `sessions.get`, never null)
- recovery
- restore (`null`)
- the permission-granted path
- launch and foreground

The rest notification is always scheduled independently of the activity (rule 1). Port errors never reach logging.

---

## Blocking

None.

---

## Should fix

### S1. Keep Ben's "countdown doesn't show in workout mode" bug open until L1–L17 have run on the phone
`docs/device-tests/2026-10-12-live-activity-rest.md` (Results table empty).
Every Live Activity test still runs against a fake port. This round changes real-device behaviour in three ways:

- a refused start now retries;
- the probe leaves the workout's activity, so two activities can show during L16;
- the launch/foreground read can be dropped.

**Failure:** the branch merges, the bug is marked fixed, and the next real workout still shows nothing on the Lock Screen. **Fix:** build the `.ipa` and run L1–L17. L8 (force-close), L12 (swipe), L14/L17 (Live Activities off, then on) and L16 (probe) matter most. Fill in the table before closing the bug.

### S2. Designer sign-off and Ben's answer on the 30/60-day bug are still outstanding
`docs/design/progress.md` build note ("Designer to confirm", "Open (review ben-bugs S5)"); `type.liveCountdown` in `docs/design/lock-screen-and-alerts.md`.
These are still developer decisions waiting for the designer:

- the 20-week bar threshold;
- the year format;
- part-week styling;
- the 56/44pt countdown;
- "swap reversed dates".

Three independent hand counts now agree with the code. If Ben still sees something wrong, it is a presentation or expectation issue, not arithmetic. **Fix:** ask Ben for a screenshot of what looked wrong, and route the build note to the designer. This is process work, not code.

---

## Nits

### N1. Muscles `Last trained` ignores the end of a past period and drops the year
`packages/domain/src/progress/muscles.ts:263-267` (`lastTrained` is updated for every session, in the window or not); `packages/domain/src/progress/home.ts:331` (`dayMonth`, no year).
**Scenario:** Ben picks the custom period Sep 2025. The Muscles rows read `Last trained 8 Oct`, which is a date in 2026, outside the period and without its year. `Last workout` on the home card *is* bounded by `window.to` (`activity.ts`, `lastSessionDate`), so the two disagree. **Fix:** only take `s.date <= window.to`, and use `rangeYears`-style formatting when the date isn't this year. Alternatively, have the designer confirm "last trained ever" is intended.

### N2. Part-week bars still differ from whole weeks by colour alone
`apps/mobile/src/progress/components.tsx:183,209,224`, `WeekBarsCanvas.tsx:37-38`. Lighter fill and a tertiary label colour are both colour cues. Check that the VoiceOver label says "part week", and consider a non-colour cue (a dashed top or a narrower bar). The designer decides (carried from r1 N5).

### N3. The probe ledger is tested by re-implementing the runner's loop, not through `runLiveActivityProbe`
`apps/mobile/test/live-activity.test.ts:308-329` drives `createProbeActivityLedger` by hand. The real loop in `probe/runners.ts:512-517` (getInstances → `toEnd` → `end` → `ended`) has no direct test, because it imports `expo-widgets`. After a relaunch the ledger is empty, so a new probe run won't end a probe activity left from the previous run. The workout controller's first reconcile then either ends it or adopts it (`running[0]`, possibly the probe's) and rewrites it with workout content. That is harmless because only one activity remains, but it isn't covered. **Fix (optional):** inject the factory into a small `endOwnProbeActivities(factory, ledger)` helper and test that, or note it in L16.

### N4. The coach sheet's `profileToday` is read once when the sheet opens
`apps/mobile/src/screens/coach/CoachSheetScreen.tsx:142-144`. If the sheet stays open across midnight, the `Sees:` year logic uses yesterday. This is cosmetic and only matters around New Year.

---

## Checked and fine

- **Ticket semantics:** reads take `++issued` at start, and commits take `++issued` at issue. A read is dropped only if something was issued after it started. Two overlapping foreground reads resolve newest-wins. A dropped read never reaches the Live Activity controller. A rejecting read resolves without throwing. The version guard still protects against the coach's late re-read (same workout, older version).
- **Refused-start retry:** `failed` and `lastError` clear on the next successful start. A swipe still adds to `skip`. An activity ended by iOS is treated as a swipe, as documented. There are no duplicates: `start` either throws or returns a real ID, and `current` is set only on success.
- **Probe:** it ends only its own IDs, and the workout's activity is never seen as swiped. Both use the same widget factory name, so a leftover probe activity is adopted or ended at the next launch.
- **Lock Screen numbering:** `Set n of m` and "same exercise" both use the block root, matching the in-app header after a gym switch.
- **Custom period:** the sheet's steppers already keep `From ≤ To`. The service normalises again (swap, clamp to today, about 3 years). The period stays in memory only.
- **Rules:** rule 1 (logging never waits on the activity or alerts), rule 5 (stale versions and reads dropped), rule 6 (estimates and targets labelled, no invented data), and rule 7 (no secrets or credentials touched). Privacy: the activity carries exercise, target and times only, and nothing health-related is logged. No new copy explains rules (UI copy convention).

## Spec issues

1. **`type.liveCountdown`** still says 28pt banner / 24pt expanded; the build ships 56/44pt with `minimumScaleFactor(0.6)`. The designer should set the size using Ben's L10 answer (carried).
2. **progress.md** holds the custom period, the 20-week threshold, the year format, part-week styling and (new) the reversed-date swap only as a developer build note. The designer should fold them into the spec, including whether presets ending today ever show the year (r2 N3), and whether Muscles `Last trained` is bounded by the period (N1 above).
3. **lock-screen-and-alerts §4.2:** the `fizz://workout` deep link is deferred because there is no URL scheme. Record it in the spec or backlog (carried; the device-test doc now lists it as a known limit).
4. **Ben's other requests from the same message are still not in this branch** and need design work and brief changes he approves:
   - Workout Split as the default view
   - Muscle-group taxonomy: no forearms; traps and lats; chest sub-groups
   - Set-duration setting
   - Exercise dropdown with line graphs and trailing averages (Activity / Strength / Calendar)
   - Profile criteria
   - Coach-driven vs self-driven workout selection
   - 45 min ± 5/10/15 session length
   - Main-lift choice
   - His questions about Memory › Data vs pain flags, and about the Coaching playbook

   The Muscles grouping and the window picker touched here will be reshaped by the Workout Split and exercise-progress work.
