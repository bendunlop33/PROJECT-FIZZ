VERDICT: CHANGES NEEDED

# Review r2: Workout overview (claude/workout-overview)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `git diff claude/gracious-knuth-joxqpw...claude/workout-overview` (36 files), with the fix round
`69313b9..82fc593` (6 commits) read against the r1 findings in [workout-overview.md](workout-overview.md).
Checked against `docs/design/workout-overview.md` (OV1–OV17), the mockup, `check-in.md`, `today.md`,
CLAUDE.md rules 1–10 and the minimal-copy convention.

## Checks run

- Typecheck, lint, `vitest run --testTimeout=120000`, `catalogue:validate`, `guide:check --all --verify` and
  `guide:motion --all` (the steps of `npm run check`, run one at a time so the timeout reaches vitest): **all exit 0**.
  136 test files, 1889 passed, 2 todo.
- A throwaway probe on real SQLite (not committed, deleted afterwards) confirmed B1 below.

## r1 findings: status

| r1 | Status |
|---|---|
| B1 false `Targets updated` after a score | **Fixed** for the inline tiles. `startFromOverview` re-reads, compares with `samePage`, and restarts with the same opId. Start waits for the score write. Tested on SQLite (score then Start, Done then Start, a visible change, routine deleted). |
| B2 large Dynamic Type | **Fixed in code** (`minHeight`, label `minWidth`, stacked panel lines, `checkInRowLayout` by `onLayout`, chip under the bar at AX). Not yet checked on a device (S3). The stat strip wasn't covered (S2). |
| S1 `Why?` and the reused check-in | Fixed, tested. |
| S2 Empty workout double start | Fixed: shared guard, one opId per page, works from the load-failed state. Tested. |
| S3 stale check outside the transaction | Fixed: `WriteFence` checked inside `SessionRepository.save`'s write (ADR 0019, proposed). The fence SQL matches the repositories' queries. Tested in persistence and service. |
| S4 History | Deferred in the spec (§3.8 and §11.3 agree). |
| S5 Up next resolver | Fixed: `resolveUpNext` is shared and tested. |
| S6 tests | Mostly fixed: no-gym Start with a failed first write, OV4 for equipment, source revision and check-in. The sheet's exits are tested only through a pure helper plus source greps. |
| S7 double tap on a tile | Fixed: `scoreGuard` plus `scoring` disables the tiles. |
| N1, N2, N3, N5, N7 | Fixed. |
| N4, N6 | Still open (N1, N2 below). |

What's good: every entry point checks out. Today's Up next `Start workout`, a hero detail row, `Start next session`
and a routine row all route to the overview. `Empty workout`, the First workout hero and Repeat still start
directly, with the check-in sheet when it's due. Resume and P6 never reach the page. A double tap on Today
opens one overview. Opening the page writes nothing and makes no provider call. On the inline path the
check-in is asked once: `ask` → tiles, `reuse` → pre-selected, ignored → `skipped`, off or not a check-in
day → `not_asked`, so the in-workout pending prompt can't fire again. A force-close before Start leaves no
session, and a tapped score is reused within 2 h. No coach UI renders.

---

## Blocking

### B1. At AX text sizes, a check-in from the `Check-in ›` sheet can be dropped by Start, and a pain mention then doesn't hold loads (rule 9)

`apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:545-551, 207-224`;
`apps/mobile/src/screens/workout/CheckInScreen.tsx:268-273`; `apps/mobile/src/workout/overview.ts:47-51`.

On the collapsed path (`checkInFit === 'collapsed'`, at AX1+ or when there's no room for the tiles), the sheet
records **its own** check-in (`StartCheckIn`'s `checkInId`). It then calls `changed()` and `goBack()`. It hands
nothing back to the overview. `tappedRef` stays null, so the overview only learns about the check-in when its
reload lands and the gate returns `reuse`. `useScreenData` keeps rendering the old page during that reload
(`shell/context.tsx:87-112`), and Start stays enabled. If Ben taps Start first:

- `startCheckIn(page.checkIn = ask, row.record = null)` sends `{kind: 'skipped'}`.
- `previewCheck` builds the key with no check-in (the check-in is only read when it's `answered`). That matches
  the old page's key, so the start is `fresh` and goes through. No stale path catches it.

Failure scenario (reproduced on real SQLite): text size AX1+, check-in due. Ben taps `Check-in ›`, then `2`, ticks
`Pain` and `Done`, then `Not now` on the pain step. The sheet closes, and he taps `Start workout` before the
reload lands. That reload runs the dry run plus a history read per exercise, so on a phone with imported FitNotes
history it can take a second. Result: the session's check-in is `{kind: 'skipped'}`, and Bench is planned at
**62.5 kg (UP)**. The reloaded page would have shown **60 kg (HELD)**, because `unspecifiedPain` holds loads.
So:

- pain was mentioned but progression went ahead (rule 9);
- the check-in is left unlinked, so the next start within 2 h reuses it (the check-in is linked to the wrong
  workout, or to none);
- the session records `skipped` although Ben answered (rule 6, honest records).

Fix (either):
(a) Have the sheet return its check-in to the overview. For example, in overview mode use
    `navigation.popTo('WorkoutOverview', {target, checkInId}, {merge: true})`, or a shared ref or callback. The
    overview then sets `tapped` from it before Start can run, as `pickScore` does.
(b) In `start()`, when nothing is tapped, re-read the gate (`services.checkIns.gate()`) after
    `await scoreWrite.current`. If it returns `reuse` with a check-in that isn't on the rendered page, send
    `answered` with it. The existing `samePage` and stale path then handle any change to the rows.
Add a service-level test: page loaded with gate `ask`, a check-in with an unflagged pain reason recorded
behind it, then `startFromOverview` with the rendered page. Expect a `stale` result whose fresh rows are
`HELD`, or a start linked as `answered` with held loads, but never `skipped` with progression.

---

## Should fix

### S1. A low score followed quickly by Start skips What's up?

`WorkoutOverviewScreen.tsx:197, 213, 227, 577`. Start is not disabled while a score is being written (only the
tiles are). Start does `await scoreWrite.current`, and that write ends by pushing `CheckIn` (What's up?) for a
score at or below the setting. Start then carries on, and `openStartedWorkout` RESETs the stack, which tears
the sheet down.

Scenario: Ben taps `2` and then `Start workout` within the write. The What's up? sheet flashes and the workout
opens. The reasons step the spec routes this score through (§2.2: score ≤ setting → What's up? → Overview →
Start) never happens. It's a data loss, not just a UI glitch: a pain mention he would have given there can't
hold loads.

Fix: after awaiting the score write, abort the Start (clear `busy`) if that write opened What's up?. For
example, `pickScore` records `openedReasons = true` and `start()` returns early when it's set. Alternatively,
disable Start while `scoring`. Add a test via the helpers.

### S2. The stat strip doesn't stack until AX1, and `≈ 19:05` can break mid-number at xLarge–xxxLarge

`apps/mobile/src/ui/overview.tsx:35-60`. The numerals are 32 pt with `maxFontSizeMultiplier` 1.6 in three
`flex: 1` columns. At 390 pt each column is about 103 pt of text width after the 14 pt left padding. `≈` plus
`19:05` in 32 pt light tabular digits is about 95–110 pt at the default size. At font scale 1.12–1.35, which
is below the 1.6 `stacked` threshold, it no longer fits. With no space in the string, iOS breaks it inside the
time (`≈19:0` / `5`). OV14's intent is that no number truncates or breaks. The r1 fix measured the check-in row
but not the strip. These widths are estimates.

Fix: stack the strip by measured width, as `checkInRowLayout` does, or give each value `numberOfLines={1}`
with `adjustsFontSizeToFit` and a `minimumFontScale` floor. Check it on the device at the same time as S3.

### S3. B2 still needs the on-device check

The B2 commit says "Not yet checked on a device at xxxLarge or AX3". The source-grep test pins the absence of
fixed boxes, but it can't show clipping or overflow. Before a real workout depends on this page, check it on
Ben's iPhone at xLarge, xxxLarge and AX3: the top bar and chip, panel lines, the check-in row in all three
modes, the strip (S2), and Start staying visible. Record the result in the spec's §11 follow-ups.

### S4. The screen-level flows are still tested only through helpers and source greps

The pure helpers are well tested on SQLite. Nothing exercises the screen's own glue: the `page` closure versus
the re-read, `tappedRef` versus the sheet's check-in (B1), Start while `scoring` (S1), or the `goBack` of the
`CheckIn` sheet in overview mode (`workout-overview-screen.test.ts:84-108` greps the source). Add tests for the
B1 and S1 orderings at the level of `startFromOverview` / `saveScore` (the B1 probe above is a template). If the
screen's glue can't run on Linux, move more of the decision into `overview-start.ts`. For example, a
`checkInForStart(rendered, tapped, gateNow)` that is pure and tested.

---

## Nits

- **N1** (r1 N6, still open). A reused check-in that ages past 2 h while the page stays open is still sent as
  `answered` (`overview.ts:47-48`), and `startOnce` doesn't re-check its age. Either re-check the gate in Start
  or note in §8 that the page's reuse decision stands.
- **N2** (r1 N4, still open). `CheckInScreen.tsx:389`: Step 1's lead `Before your workout. Saved with it. Nothing
  changes unless you say so.` is a reassurance line, and it now shows on the overview's AX path.
  `WorkoutOverviewScreen.tsx:307`: `Past workouts keep their name.` explains a rule. Trim both.
- **N3.** `CheckInScreen.tsx:426`: in overview mode the What's up? `Skip` keeps the VoiceOver hint "Keeps your
  score and starts the workout.", but there it returns to the overview. That's untrue to VoiceOver users. Drop
  the "starts the workout" part when `overview` is set.
- **N4.** `CheckInScreen.tsx:312-316`: in overview mode, a score that fails to save calls
  `start({kind: 'skipped'}, toast)`, which just `goBack()`s. The failure is silent and the toast text ("Your
  workout started as normal") would be wrong anyway. Show the error on the sheet, or a toast on the overview.
- **N5.** Spec §2.1 says "Close (chevron-down, or swipe down from the top)". The route is
  `presentation: 'fullScreenModal'` (`AppNavigator.tsx:243-247`), which iOS doesn't dismiss interactively, and
  the screen adds no gesture. So swipe-down does nothing (the chevron and the VoiceOver escape do work). Either
  add a pan-down, or drop the swipe from the spec.

---

## Spec issues

1. **§8 (Dynamic Type AX1+) and §2.2 don't say how a check-in made in the `Check-in ›` sheet reaches the
   overview's Start.** They say only that "a score there returns to the overview". Because nothing is passed
   back, the implementation relies on a reload (B1). The spec should say that the sheet's check-in becomes the
   page's tapped check-in, as an inline tap does, before Start can send anything.
2. **§2.2 doesn't say what happens to a Start tapped while a low score's What's up? is opening** (S1). State
   that a score at or below the setting always shows What's up? before Start can proceed.
3. **Approvals pending.** ADR 0019 (a `SessionRepository.save` port change) is `Proposed … Ben to confirm`.
   check-in.md's CI2 amendment and workout-overview §11.1–11.3 are also marked "Ben to confirm". None appears in
   `docs/brief/CHANGELOG.md`. Per CLAUDE.md, record Ben's decisions before this merges to the main line, or
   merge with those items explicitly flagged as provisional.
4. **§2.1 swipe-down** conflicts with `fullScreenModal` (N5). One of them needs to change.

## Verdict

**CHANGES NEEDED.** The r1 blockers are fixed: B1 on the inline path, and B2 in code. The fix round is careful:
the fence, the shared resolver and the guards are all tested on real SQLite. One new blocking path remains. B1:
on the AX `Check-in ›` path, a Start tapped before the reload drops the check-in and lets a pain mention go
unheld (rule 9), and I reproduced this on SQLite. Fix B1 with a test. S1 (low score then a quick Start) should
land in the same round. S2/S3 need the device check at xLarge, xxxLarge and AX3 before the first real workout.
