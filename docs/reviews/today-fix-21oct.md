# Review: Today fixes from Ben's Build B screenshot (claude/today-fix-21oct)

Range: `39b91f3..HEAD` (7d35d66, 1441cdc, 6091cf5, 8720a4f). Reviewer: independent. Date: 21 Oct 2026.

## Verdict: CHANGES NEEDED

The header, the safe-area padding and the error handling are good work. Two problems remain. The likely cause of Ben's `No plan` was not reproduced or fixed: he has a split or routines in rotation but no applied coach plan, and Today v2 drops that case. And the strip's longest day names still end in `…` at 375 pt.

## Checks run (by the reviewer, in the worktree)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `NODE_OPTIONS=--max-old-space-size=6144 npm run lint` | pass |
| `npm run check:migrations` | `Migrations OK: 1 to 32, none reserved or empty.` |
| `npx vitest run --maxWorkers=2` | 454 files, 8473 passed, 1 todo, 0 failed (the developer had not re-run the full suite) |

## Blocking

### B1. `No plan` for Ben is still unexplained, and the likely case is a regression from the old Today
`apps/mobile/src/services/today-session.ts:379`, `:392`, `:575`; compare `apps/mobile/src/services/workout-services.ts:1958-2045` (`resolveUpNext`).

What the code does: Today v2 counts a plan only when there is an applied `PlanDraft` with at least one live workout. The old Today's Up next fell back in order: applied plan → Profile split (`splitUpNext`) → rotation routines (`nextInRotation`) → longest gap. Today v2 has no fallback after the plan. The developer's fixture (an applied plan from the 19 Oct builder with `planDay` removed) proves that an applied old-style plan still works. That was the less likely case. The screenshot points to the other one: Mon `Le…` (Legs) and Tue `Ch…` (Chest) are split-day workouts, and the developer could not see his data.

Failure scenario: Ben has a Profile split (Chest/Back/Legs/Shoulders) and his saved workouts in rotation, but either never pressed Apply on a coach plan or ended it. The old Today showed `Up next: Back`. Today v2 shows `No plan` and the generic `Full body / Upper / Push` chips. His own workouts can no longer be reached from Today at all (only from Library). The task said this case "is a bug: fix it". The developer handed it to Ben as a product decision and added no test that shows what Today does in this state.

Fix (pick one, and test it with a fixture of split + rotation routines + no applied plan):
- (a) Read-time fallback: with no applied plan, build `days` from the rotation routines (or the Profile split's days, matched to routines by `planDayKeyOf`/`splitDayId`). Take `NEXT` from the existing `upNextRoutineId` resolver, which already handles split and rotation, and label the status `plan` (or a `rotation` status that shows the day control without `Plan paused`/plan copy).
- (b) If the PM or Ben rules that only an applied plan counts, at least show the resolver's Up next routine as the No-plan card (`Up next: Back`, Start) so Ben doesn't lose the old one-tap path. Record the decision in the spec and CHANGELOG.

Before closing either way, do a one-line check on Ben's data (Library › Your plan shows a plan? Profile has a split? number of rotation routines), so the review of the fix rests on his real state, not a guess.

### B2. Long strip labels still end in `…` at 375 pt
`apps/mobile/src/screens/today/TodaySession.tsx:56`, `:64`, `:105`; `apps/mobile/src/today/strip-style.ts` (`STRIP_LABEL_FIT`).

Arithmetic with Ben's theme (screenMargin 20): a cell is (375 − 40 − 12 gaps − 1 divider) / 7 ≈ 46 pt. Take away 2 × 2 cell padding, 2 × 2 pill padding and 2 × 1 border, and about 36 pt is left for the text. `Shoulders` at the 12 pt base is about 55 pt wide, and about 41 pt at the 0.75 floor (9 pt). It still doesn't fit, so iOS truncates with `…`. The same happens to `Full body` and `Upper body`, and to the Today cell's chosen-day pill. At non-AX Dynamic Type sizes (fontScale up to 1.6 before the list view takes over), even `Chest` overflows. The prototype starts its `.pip` at 9.5 px with −0.02 em tracking. That is why 0.75 works there.

Fix: use a smaller base for the pill text (about 10 pt, as the prototype), add slight negative letterSpacing, and cap `maxFontSizeMultiplier` on strip labels (for example 1.2) so the pill row can't outgrow its fixed column. Alternatively cut the horizontal padding to 1. Add a pure test that checks the width budget for `Shoulders` at 375 pt with the chosen base and scale. The current test only checks that cells are ≥ 44 pt.

## Should fix

### S1. The error state still sits under the status bar
`apps/mobile/src/screens/TodayScreen.tsx:582`. The `data.state === 'error'` screen (`Couldn't open your training data`, Try again, Restore from a backup) uses `paddingTop: theme.space['8']` (32 pt). The status bar on Ben's iPhone is about 59 pt tall, so the warning line renders under the clock. The task asked for the inset on every Today state. Fix: `paddingTop: insets.top + theme.space['3']` there too, and extend the safe-area source test to cover it.

### S2. "Couldn't load" removes every way to start a workout from Today
`apps/mobile/src/screens/TodayScreen.tsx:708`, `:907-913`. When `todaySession.load()` rejects, the screen shows only `Couldn't load · Try again` and `＋ Activity`. `Build your own` and `Empty workout` are hidden because they depend on `session !== null`. The branch also widens what can reject: the plan read and `routines.listByOwner` no longer catch errors, so one routine row that fails to decode makes the whole card fail. Scenario: a corrupt or old routine document means Ben can't start any workout from Today until he goes through Library. The hook's own comment says an unreadable plan "never blocks Today or Start". Fix: in the failed state, still render `Build your own` (primary) and an `Empty workout` chip next to `Couldn't load · Try again`.

### S3. Gym chip moved off the header, so it is hidden while loading, on failure and during a workout
`apps/mobile/src/screens/TodayScreen.tsx:716`. The chip now lives inside `sessionBlock`. It is gone while the session loads, in the `Couldn't load` state and while a workout is open. Moving it is defensible: the prototype `.hdr` has no gym, and the spec contradicts itself (see Spec issues). But it needs Ben's approval as the developer says, and the loading/failed cases should keep the chip visible: render the row's Eyebrow and chip before the `session === null` early return.

### S4. Tests are mostly source-string checks
`apps/mobile/test/today-header-strip.test.ts`, `today-v2-screen.test.ts:196-258`. The safe-area, header, compact coach and No-plan checks assert on source text (`toContain('paddingTop: insets.top …')`), so a refactor breaks them without any change in behaviour, and wrong behaviour can still pass. The strip-fit test asserts `46 ≥ 44` but never checks a label width (that would have caught B2). There is no test for the B1 state (split/rotation without a plan) or for the S2 failed state still offering Start. Add those, and keep the source checks as secondary guards.

## Nits

- N1. `TodayHeader` (`TodaySession.tsx:37`): the coach group has `flexShrink: 0`, so at large text sizes the pill (callout, unbounded) keeps its width and the day name shrinks to 0.75, then truncates (`Wedn…`). Cap the pill's `maxFontSizeMultiplier`, or move the coach under the title at AX sizes.
- N2. The light-mode cardio tint (`RUN_TINT.light`) is the developer's own choice and not a token. It's fine as a stopgap. Ask the designer for a token.
- N3. The old-plan fixture keeps `createdFromPlan.splitDayId` and the Profile split. A second variant without them would exercise the `day-<n>` fallback in `todayPlanDays` (it works on reading, but no test covers it).
- N4. Library's `active()` (`plan-services.ts:237`) still turns a failed read into `null` (no plan), while Today now shows `Couldn't load`. The developer's summary says the two match. They don't fully.

## Rules check

- Rule 1 (offline, honest AI): the compact pill shows the honest `Offline`/`No coach` word, ✦ dims with the status, and the shared mic's ⊘ and on-device dictation are unchanged. Pass.
- Rule 2/5 (completed sets, proposals, versioned writes): no write paths changed. Pass.
- Rule 6 (no invented data): the strip shows only logged or told items, the ✓ is removed from cells and kept in the list view. Pass.
- Accessibility: the pill, mic and No-plan chips are ≥ 44 pt with labels, and done/planned are distinguishable by fill vs dashed outline plus the VoiceOver word. Pass, apart from N1.
- Minimal copy: `Couldn't load` + `Try again` only. Pass.
- No new native deps; `react-native-safe-area-context` is already used. Pass.
- No secrets or `*.local.png` committed. Pass.

## Spec issues

- SP1. `docs/design/workout-builder-v3.md` §2.0.2 items 1–2 and the wireframe (lines 73–74, 88–91) still show `Tuesday [⌂ Main Gym ▾]` and a full-width `✦ Ask the coach` bar. Line 174 and the prototype say compact `✦ Coach` + mic next to the date, and the prototype has no gym chip. The designer must settle where the gym chip goes.
- SP2. §2.0.8 acceptance check 6 ("done items carry ✓") and line 162 (`✓ Shoulders`, "Colour is never the only signal (✓ …)") contradict Ben's 21 Oct change in line 75 (no ✓). Update them to "filled vs dashed outline + VoiceOver word".
- SP3. §2.0.4 `No plan` says "`⋯` content (recent workouts) shows as a list". Line 182 replaced the `⋯` contents with Other sessions, and Ben has now asked for the state to be compact. Write down the chip layout the developer built.
- SP4. The spec never says whether a Profile split or routines in rotation with no applied plan counts as a plan on Today (B1). §2.0.9 replaces the old Up next card without saying what happens to split/rotation users. It needs Ben's decision.
- SP5. The fixed `minimumFontScale 0.75` (line 75) can't fit `Shoulders` in a 375 pt column unless the base size is about 10 pt or less. The spec should state the base size, or say "shrink to fit" without a fixed floor.
