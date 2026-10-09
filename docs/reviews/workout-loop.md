# Review: workout loop (overnight slice 2) and foundation review fixes

**Verdict: CHANGES NEEDED**

Reviewed: `270d66e..2eb78b4` on `claude/gracious-knuth-joxqpw` (schema 2, foundation fixes, domain views, rest alerts, services, workout UI kit, Today, check-in, Active set, Rest, Summary, ADR 0010), plus HEAD `7a71d64` because the catalogue merge (`9f76eaf`) changes one finding (B2). I ignored `packages/catalogue/guides`, as asked. The re-review of the foundation fixes is appended to `app-foundation.md`.

Specs read: CLAUDE.md (rules 1–10), `provisional-2026-10-09.md`, ADR 0010, and these design docs: `check-in.md`, `today.md`, `active-workout.md`, `rest-state.md`, `workout-summary.md`, `flow-first-milestone.md` (§8), `lock-screen-and-alerts.md` (§3, §4), `system-states.md`, `design-system.md` (§9.1–9.10). I also read `@react-navigation/routers` 7.6.4 (`StackRouter` NAVIGATE) and `packages/catalogue/src/uuid.ts` to check assumptions the code relies on.

## What I ran

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, test, catalogue validate, guide check) | Clean. 48 test files, 689 tests, all passing |
| `expo export --platform ios` (scratchpad) | The Hermes bundle builds (3.7 MB). Export deleted |
| `expo prebuild --platform ios --no-install --clean` in a scratch copy, then `node scripts/check-entitlements.ts --prebuild` | OK. Both `.entitlements` files contain only `com.apple.security.application-groups`, and there is no `UIBackgroundModes`. expo-haptics adds no entitlement. Scratch copy deleted |
| Scratch: `StackRouter` fed the app's real navigation actions | Confirms B1: `Tabs > Summary > Tabs > Workout > Tabs` |
| Scratch: `deriveId('catalogue:<key>')` vs `catalogueExerciseId(key)` | Confirms B2. For example, bench press is `da3825f3-…` in the app and `9da003c7-…` in the catalogue |
| Grep for `console.*`, hex colours, secrets in the diff | None in the new code. The one `#fff` is the old developer probe route |

## What is solid

- **Log correctness and idempotency.** `buildActiveSetView` builds the label and `logValues` from the same values, including side. `log_set` saves `cmd.values` unchanged. The opId is `log:<setId>:<undoCount>`, and `restTimerId` is left out of the fingerprint, so a double tap is `duplicate: true`. This is tested end to end on SQLite. The 1 s guard and `busy` cover the next-set double tap.
- **Achievable-load steppers.** `stepLoad` and `getAchievableLoads` drive ±. At the max, the button is disabled and the reason is shown (`Rack maximum 32.5 kg each`). An assisted machine reads `+ = more assistance`. Per-dumbbell, stack, lb and bodyweight are all tested. An off-profile typed load warns and still logs, which is correct for actual values.
- **Rest alert planner.** `planRestAlert` (pure) uses one identifier per workout, `fizz.rest.<sessionId>`, so the phone can never hold two alerts for one workout. After a relaunch, the controller cancels or replaces by that identifier. It is never awaited by a write, and a failing notifier is recorded rather than thrown. ±30 s, Skip, early Log, Pause/Resume, Undo, Finish and relaunch are tested. Discard is covered by `status !== 'active'`.
- **Force-close recovery.** Draft (`Unsaved edit restored`), rest remaining after a relaunch, a rest that ended while closed (Ready, `Rest ended at`, alert cancelled), and the check-in sheet (nothing started, score reusable for 2 h) all work. They run on the expo-sqlite stand-in with real relaunches.
- **Check-in gate and storage.** The check-in is created before the session (CI1). The link is written in the same transaction as the session, and a partial unique index allows one workout per check-in. Reuse is limited to undeleted, unlinked `not_started` check-ins under 2 h. Skip writes `skipped` and no record. Updates are versioned and audited, and a retried opId is a no-op.
- **Migration 0002.** It is additive. Old sessions read `checkIn: null`, and the `check_in_id` and `check_in` columns are checked against each other on read. Integrity checks and backups cover the new tables with no format change. A schema-1 backup restores at v1 and migrates forward (tested).
- **Summary honesty.** The comparison is like-for-like: same equipment instance, unit and convention, working sets, earlier sessions only. Next time comes from `calculateNextTargets`, tagged `Built-in rule (coach not connected)`, and names its rule. The coach note says `Coach not connected`. A test shows check-ins never change Next time. Pain flags halt progression for the flagged movement (rule 9), and no copy diagnoses.
- **Foundation fixes** (details in `app-foundation.md`): B1, B2, S1, S2, S3, S4, S6 and N8 are fixed with tests. S5 is fixed at launch only (see B1 below).

---

## Blocking

### B1. Summary `Done` and in-workout Discard push a second Today on top instead of returning to it
`apps/mobile/src/screens/workout/SummaryScreen.tsx:35-37`, `apps/mobile/src/screens/workout/WorkoutScreen.tsx:387` (and the `close()` fallback at `:240`)

In React Navigation 7, `navigate(name)` returns to an earlier route only when that route is the current one, or when `pop: true` is passed. Otherwise it **pushes** (`StackRouter.tsx:385-466`). So `navigation.navigate('Tabs', { screen: 'Today' })` from Summary pushes a new `Tabs` card above the full-screen Summary. My router run shows the stack after one normal workout and one discarded workout:

`Tabs > Summary > Tabs > Workout > Tabs`

Failure scenario: Ben finishes, taps `Done`, and Today slides in as a card inside the Summary modal. An iOS edge swipe goes back to the summary. Every workout leaves another Summary and another Tabs (with its own Today: a 1 s interval and `useScreenData` listeners) mounted, until the app is relaunched. After an in-workout Discard, the discarded `WorkoutScreen` stays mounted underneath. It still has its 1 s timer, its AppState reload of *the active session* and its rest-end tick/haptic. On the next workout, Ben gets a doubled rest-end haptic and two screens dispatching `tick`.

This is the same defect class as foundation S5, which was fixed only for the launch stack.

Fix:
- Use `navigation.popTo('Tabs', { screen: 'Today', params })` (v7). Alternatively, `dispatch(StackActions.popToTop())` and then set Today's params.
- Do the same in `CheckInScreen` and anywhere else that wants to land on Today.
- Add a navigation test that runs `StackRouter` through Start → Finish → Done → Start, and Start → Discard, and asserts the stack is `[Tabs]` / `[Tabs, Workout]`. A Linux test can do this; I did it in a scratch file.

### B2. Starter exercise IDs won't match the catalogue, despite ADR 0010's guarantee
`packages/domain/src/starter-exercises.ts:52-54`, `docs/decisions/0010-workout-loop-check-ins-alerts-defaults.md` ("wiring `packages/catalogue` later keeps every ID and its history")

The starter list uses `deriveId('catalogue:<key>')`, an FNV-style version-8 UUID. The catalogue package merged at `9f76eaf` uses `catalogueExerciseId(key) = UUIDv5(key, FIZZ_CATALOGUE_NAMESPACE)` (`packages/catalogue/src/uuid.ts:102-112`). They differ for every key; bench press is `da3825f3-…` here and `9da003c7-…` there. Some keys also don't exist in the catalogue. For example, `barbell-row` exists only as a dangling variation `barbell-bent-over-row`.

Failure scenario: Ben logs his first real workouts on this build, as the milestone intends. When the catalogue is wired, `Bench press` exists twice. The catalogue entry has no history, so `Last (…)`, prefill, comparison and Next time are empty. Pain flags keyed by the starter ID no longer halt the catalogue exercise, which is a rule 9 gap. Fixing it later needs a data migration across `session_exercises`, `pain_flags` and every backup.

Fix:
- Derive starter IDs with `catalogueExerciseId(key)`. It is pure TypeScript and Hermes-safe; move it to `@fizz/domain`, or import it.
- Use the catalogue's keys.
- Add a test that every starter key present in `packages/catalogue/data/exercises` has the same ID and name.
- Do this before any real workout is logged. Nothing is on a phone yet, so no migration is needed now.

---

## Should fix (before real workouts or the next slice)

### S1. A rest ends silently when Fizz is open on Today or Profile (the workout minimised)
`apps/mobile/src/alerts/notifier.ts:138-145`, `apps/mobile/src/screens/workout/WorkoutScreen.tsx:207-222`

The notification handler hides every `fizz.rest.*` notification while `AppState` is `active`, on the grounds that "the in-app cue is the alert". The cue (haptic plus the expiry `tick`) lives only in `WorkoutScreen`, and `⌄ Minimise` pops that screen.

Failure scenario: during a 3:00 rest, Ben minimises to Today to check the week line. At the deadline there is no banner, no sound and no haptic. Today's card also stays at `Rest 0:00 left` (`TodayScreen.tsx:146`, `Math.max(0, …)`).

This breaks lock-screen-and-alerts §3 row K and flow check 9's "exactly one alert".

Fix: own the in-app rest-end cue at app level, for example a `RestCue` next to `ForegroundAlerts` in `Root.tsx` that reads the active session. Alternatively, suppress the banner only while the Workout route is focused (a flag set from `useFocusEffect`).

### S2. The Workout and Summary screens have no error state: a failed load is a blank full-screen modal you can't leave
`apps/mobile/src/screens/workout/WorkoutScreen.tsx:86-96, 224`, `apps/mobile/src/screens/workout/SummaryScreen.tsx:39`

`reload()` is `void`ed. If `services.workout.load()` throws, `data` stays `'loading'` and the screen renders an empty `View`. The route has `gestureEnabled: false` and there are no buttons. `SummaryScreen` renders the same blank view for `state: 'error'`.

`load()` reads the full history of each exercise (`listExerciseHistory` → `readAggregate` → zod). A single finished session that fails to decode throws. That is the foundation B2 "schema tightened" scenario.

Failure scenario: Ben is mid-workout when this happens. The screen is blank and stays blank. A relaunch within 6 h auto-opens the same blank screen (P6), so he can't log for the rest of the session (rule 1).

Fix:
- Catch errors in both screens and show `StatusLine` with `Try again` and `Go to Today`.
- In `load()`, catch history failures per exercise and fall back to `previous: null` (`No previous result`), so a bad old record never stops today's logging.

### S3. `Next time` shows targets that the next workout never uses
`packages/domain/src/session/summary.ts:227-256`, `packages/domain/src/session-service.ts:140-149`

Every exercise in this build is added to an empty workout, and `addExercise` creates sets with no planned target. The summary still says, for example, `Target 62.5 kg × 8–12`. In the next workout, the set card says `No target for this set` and prefills last time's 60 kg (`From 8 Oct`).

Rule 3 says the fallback rule's suggestion is "recorded with its reason". Here it is shown once and then dropped silently.

Fix (pick one, and say which in ADR 0010):
- When an exercise is added, plan its working sets from the latest built-in Next time result for that exercise and equipment, labelled `Built-in rule`.
- Or reword the summary row honestly: `Suggested next time (not saved as a plan yet)`.

See also SP1: the 8–12 default would currently suggest load cuts for 5-rep work.

### S4. The check-in note isn't shown in full on the summary
`apps/mobile/src/screens/workout/SummaryScreen.tsx:102`

`numberOfLines={2}` cuts off a note of up to 280 characters with an ellipsis. Check-in acceptance 21 and workout-summary §2a require "the note exactly as given". Remove the limit, or add `More`.

### S5. While typing in the load field, the stepper changes the Log label but not the field
`apps/mobile/src/ui/workout.tsx:103-107`

`text` re-syncs from `value` only when the field isn't focused. `keyboardShouldPersistTaps="handled"` keeps the field focused when + or − is tapped.

Failure scenario: Ben types `100` and then taps `+`. The field still shows `100`, but the action bar reads `Log 102.5 kg × 8`, and 102.5 is what gets saved. The label matches what is saved, but the field contradicts it.

Fix: resync whenever `parseNumber(text) !== value`. Alternatively, blur the field when a step button is pressed.

### S6. `−30 s` that ends a rest plays no rest-end cue
`WorkoutScreen.tsx:207-222`, `packages/domain/src/session/reducer.ts:568-578`

`adjust_rest` to 0 or below returns the timer already `expired`. The cue effect only fires for a `running` timer that passes its deadline. rest-state check 5 and flow check 14 require "`−30 s` to zero: exactly one rest-end cue".

Fix: play the cue (once per timer key) on a `RestEnded { reason: 'expired' }` event in a command result too.

### S7. Pain flags can't be cleared after the 8 s toast
`apps/mobile/src/services/workout-services.ts:190-200` (only caller: the toast), `apps/mobile/src/screens/workout/CheckInScreen.tsx:264-274`

There is no Pain flags screen. Once the toast has gone, a flag set from the check-in halts progression for that movement until a future build, and `Pain flag: no increases` stays on every set card. This is the safe direction for rule 9, but Ben has no way to undo a mis-tapped movement. Also, when `Pain` and `Feeling ill` are both picked, `Train anyway` shows the plain check-in toast, so the pain Undo is never offered.

Fix:
- Make the `PainFlagNote` line tappable: `Clear pain flag for Bench press?` with Clear and Cancel, calling `pain.clear`.
- Keep the pain toast after the ill step.
- Or list "can't clear pain flags yet" under ADR 0010's "Not built" so Ben knows.

### S8. Device risks to check first on the new build (likely to fail)

- **Sheet detents** (`AppNavigator.tsx` CheckIn and EditSet options). UIKit doesn't shrink a sheet's view at smaller detents: the content keeps the largest detent's height and the bottom is off-screen. The check-in `Sheet` puts `Skip` (Step 1) and `Done` (Step 2) in a bottom bar. At the 0.55 detent they may be hidden until the sheet is dragged up. If they are hidden, move the actions to the top of the content, or use `[1.0]` or `'fitToContents'`.
- **Navigating while an RN `Modal` is dismissing.** `FinishSheet` → `onFinished` replaces `Workout` with `Summary` in the same tick as `setFinishOpen(false)` (`WorkoutScreen.tsx:735-739`, `TodayScreen.tsx:292-296`). Presenting or dismissing a native-stack modal while a pageSheet `Modal` is closing is a known source of stuck or blank presentations. If it misbehaves, navigate from the Modal's `onDismiss`.

---

## Nits

- **N1 Rule 10 in the API.**
  - `checkIns` and `pain` are top-level service namespaces, not under `yourData`.
  - The header comment in `app-services.ts:38` doesn't list check-ins or pain flags.
  - The rule-10 test doesn't cover them.
  - Storage, ownership and backups are correct.
- **N2 Check-in linked to a discarded workout.** A check-in linked to a 0-set workout that was discarded counts as linked (`SqliteCheckIns.linkedIds` includes discarded sessions). Starting again after "started by mistake" asks the check-in again.
- **N3 Pain toast Undo.** Undo clears the flags but leaves `CheckIn.painFlagIds` set, so the summary's `You mentioned pain…` line doesn't come back.
- **N4 Tap targets.**
  - The rest-alert permission card's `Not now` and `Allow` are `TextButton`s at 44pt. design-system asks for 52pt on the workout screen.
  - The ill step's `SecondaryButton`s are 44pt; check-in.md §2.5 asks for 52pt.
- **N5 VoiceOver.**
  - The Log button reads its visual label (`Log 60 kg × 8`). design-system §9.1 asks for "Log set 2, 100 kilograms, 8 reps".
  - Toasts auto-hide after 8 s even with VoiceOver on (§9.10 says they stay until dismissed).
- **N6 Time zone of edits.** `EditTimesSheet` saves edited times with the phone's current zone (`SummaryScreen.tsx:309-310`), not the session's.
- **N7 Finish sheet resets.** `FinishSheet` resets the chosen end time and opId whenever `aggregate` changes while it is open, for example a rest-expiry `tick` (`FinishSheet.tsx:49-56`).
- **N8 `weekdayOf` throws** a `RangeError` on unexpected `Intl` output (`calendar.ts:45`). That would fail Today's loader and Start. A fallback (`every_workout`) is safer on Hermes.
- **N9 Leg press logs 0 kg plates.** It is `added` and plate-loaded, so with no load entered it logs `0 kg plates` rather than asking for a load (`active-view.ts:274`).
- **N10 Unchecked loads.** Summary rows for exercises added as "Not at this gym · loads won't be checked" show Next time targets without that caveat.
- **N11 Integrity check.** No check confirms that a session's `check_in_id` names an existing check-in.
- **N12 Missing tests.**
  - Discard is not covered in `rest-alerts.test.ts`.
  - The navigation test covers only the launch stack (see B1).
  - Nothing covers the minimised-workout alert (S1).

---

## Spec issues

- **SP1. The built-in default rule cuts loads for strength-range training.** ADR 0010 (provisional) and `summary.ts:27-47` set the default to double progression 8–12 at RPE ≤ 9, reducing 10% after 2 sessions below 8. Ben's 5×5 bench at a steady 100 kg would show `Next time: reduce` after two workouts. Options for Ben:
  - Take the rep floor and ceiling from what he actually did.
  - Choose a default range by movement type.
  - Show no Next time row for an exercise with no rule until he sets one.
- **SP2. Where does a next-time target live without routines?** workout-summary assumes it flows into the routine; this build has only empty workouts (S3). The spec needs a rule for this build.
- **SP3. Pain with no movement (CI8).** Without a coach, `Pain` + `Not now` blocks nothing, and `Choose movements ›` isn't built. The only path left is the next check-in. Until the Pain flags screen exists, consider holding every increase in that session's Next time. That is the safe direction, and it matches CI8's session-wide block for the coach.
- **SP4. Foreground rest alerts.** lock-screen-and-alerts §4.3 ("never shown as a banner; the in-app cue is the alert") assumes the cue is app-wide. Say so explicitly, or allow the banner when the workout screen isn't visible (S1).
- **SP5. One ID scheme for catalogue exercises.** ADR 0010 and ADR 0011 describe different exercise ID schemes. Record one (B2).

---

## Re-review of the fixes (9 Oct 2026, `811c3c3..30103be`)

**Verdict for the fixes: done, with one regression.** The regression is a new Today failure on unreadable records; it is tracked as S1 in `slice-3-and-s1.md`. Other open items from slice 3 are in that file.

| Item | Status | Evidence |
|---|---|---|
| B1 Done/Discard push a second Today | Fixed | `navigation/actions.ts` sends `POP_TO Tabs` for Done, Discard, `Go to Today` and Summary → Data & backup, `RESET [Tabs, Workout]` after a start from the check-in or Repeat, and `REPLACE` for Finish → Summary. `navigation.test.ts` runs the real `StackRouter`: Start → Finish → Done → Start, Discard (same `Tabs` key), check-in → Start/Skip, and Repeat → check-in → Start. The remaining `navigate('Tabs', …)` calls are made from inside Tabs (Today, BannerList), so they don't push. |
| B2 Starter IDs differ from the catalogue | Fixed | `catalogueExerciseId` moved to `@fizz/domain` (pure TS) and is re-exported by the catalogue. Starters use the catalogue's keys. `starter-ids.test.ts` checks that ID, name, laterality, equipment, convention, mechanic, family and pattern match for every starter the catalogue has. Unreferenced legacy rows are removed at launch; referenced ones are kept. ADR 0010 amendment 1. |
| S1 Silent rest end while minimised | Fixed (device check pending) | The notification handler hides the banner only while the Workout screen is focused (`presentation.ts`, set from `useFocusEffect`, tested). The Today card reads `Rest over · ready for next set` after the deadline. |
| S2 Blank Workout/Summary on a load failure | Fixed, with a regression | Workout and Summary show an error with `Try again` and `Go to Today`/`Done`. `load()` and `planFor` catch history failures per exercise. An unreadable unfinished workout isn't auto-opened, and Today offers `Restore from a backup` (tested in `unreadable-records.test.ts`). **Regression:** Today's new `repeat.candidates(1)` decodes a year of finished sessions and throws on one bad record, so Today itself fails (probe confirmed). See slice-3 S1. |
| S3 Next time never used | Fixed | `nextTargetsFor` is shared by the Summary and `addExercise`, and planned sets carry `source: 'built_in_rule'` (`next-target-prefill.test.ts`). Recomputed, not stored (ADR 0010 amendment 2). |
| S4 Check-in note cut off | Fixed | `numberOfLines` removed from the Summary note. |
| S5 Field vs stepper | Fixed | `nextFieldText` keeps partial typing but follows `±` (`number-text.test.ts`). The equipment editor uses the same rule. |
| S6 `−30 s` to zero: no cue | Fixed | `restEndCueKey` finds `RestEnded{expired}` in a command result, and each key plays once (`presentation.test.ts`). |
| S7 Pain flags can't be cleared | Fixed, with a gap | Profile › Pain flags (with confirm), Clear on the set card (with confirm), Summary `Choose movements`, and Pain → Ill keeps the pain toast with its Undo. **Gap:** Summary's per-flag `Clear` has no confirm or Undo. See slice-3 S4. |
| S8 Sheet detents, navigating mid-dismiss | Addressed (device check pending) | The check-in actions scroll with the content. Finish → Summary runs from the Modal's `onDismiss`, with a 700 ms fallback (`after-dismiss.test.ts`), on both Workout and Today. |
| N6 Edited times use the phone's zone | Fixed | `EditTimesSheet` uses the session's `tz`. |
| SP1 / SP3 / SP5 | Addressed (provisional) | Defaults by category: main barbell 3–6 at RPE 8.5, compound 6–10, isolation 8–12. Unspecified pain holds every increase for that workout. One ID scheme. All recorded in ADR 0010 amendments 1–2 and `provisional-2026-10-09.md`; the defaults await Ben's confirmation. |
| N1–N5, N7–N12 | Not in this pass | Still open unless listed above. The navigation part of N12 is now covered. |
