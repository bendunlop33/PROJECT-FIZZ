VERDICT: PASS

# Review r3: Workout overview (claude/workout-overview)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `git diff claude/gracious-knuth-joxqpw...claude/workout-overview` (38 files), with the fix round
`4fe06de..a3936eb` (3 commits) read against the r2 findings in [workout-overview-r2.md](workout-overview-r2.md).
Checked against `docs/design/workout-overview.md` (OV1–OV17), the mockup, `check-in.md`, `today.md`,
CLAUDE.md rules 1–10 and the minimal-copy convention.

## Checks run

- `npm run typecheck`, `npm run lint`, `npx vitest run --testTimeout=120000`, `catalogue:validate`,
  `guide:check -- --all --verify`, `guide:motion -- --all` (the steps of `npm run check`, one at a time so the
  timeout reaches vitest): **all exit 0**. 136 test files, 1903 passed, 2 todo (r2: 1889).

## r2 findings: status

| r2 | Status |
|---|---|
| B1 AX `Check-in ›` check-in dropped by an early Start | **Fixed.** `checkInAtStart` re-reads the gate when nothing was tapped on the page. `checkInForStart` links a `reuse` check-in. The answered check-in then goes into the preview key, so the old page is `stale`, and the re-read shows the held load. The stale `reload()` (tapped null) still plans with the sheet's check-in, because `overviewCheckIn` falls back to the gate's reuse. Tested on real SQLite (`overview-start.test.ts`, "r2 B1"): score 2 + Pain + Not now behind the page gives `stale`, then 60 kg, then a start linked `answered`. Score 4 starts at once, linked. A failed gate read falls back to the page. |
| S1 low score, then a quick Start, skips What's up? | **Fixed.** Start captures the score write still running at the tap. If that write opened What's up?, Start returns before `startOp` is set or anything is written. Tested by replaying the screen's glue on SQLite. |
| S2 stat strip breaks below AX | **Fixed in code.** `onTextLayout` with `lines.length > 1` stacks the strip, sticky per width and font scale. Still needs the device check (S2 below). |
| S3 device check | **Open**, now recorded in spec §11. Carried as S2. |
| S4 screen glue untested | **Mostly fixed.** The check-in decision moved into the pure, SQLite-tested `checkInAtStart` / `checkInForStart` / `scoreStepOf`. The `!navigation.isFocused()` guard and the `pending` capture are covered only by source greps (N1). |
| N1 reused check-in aging past 2 h | Decided and documented (§2.2): the shown check-in stands. Tested. |
| N2 reassurance and rule copy | Fixed (check-in Step 1 lead, both Delete confirms, spec copy tables). |
| N3 VoiceOver hint on What's up? `Skip` | Fixed. |
| N4 silent score-save failure over the overview | Fixed: `Check-in wasn't saved.` shows on the sheet. |
| N5 swipe-down | The spec now says a `fullScreenModal` has no swipe-down dismiss (§2.1, §2.2 diagram, OV1). |

## Re-verified this round

- **Start paths.** The only Today change this round is the Delete confirm copy. Up next `Start workout`, a hero
  detail row, `Start next session` and a routine row still open the overview. `Empty workout`, the First workout
  hero and Repeat start directly, with the `CheckInSheet` when one is due. Resume and P6 never reach the page.
- **Check-in asked exactly once.** All four paths agree:
  - The inline tile is saved once per page (one `checkInId` and `opId`).
  - The AX sheet's own record is now linked by the gate re-read.
  - Leaving the check-in alone gives `skipped`.
  - Off, or not a check-in day, gives `not_asked`, so the in-workout pending prompt can't fire.

  A `reasons_open` stop leaves `startOp` unset, and the next Start sends the tapped record as `answered`.
- **Idempotency.** There is one `startOp` per page. A stale result creates nothing, and the retry reuses the opId.
  The fence (ADR 0019) is checked inside the write.
- **Force-close.** There is still no session before Start. A score saved on the page or in the sheet is unlinked
  and reused for 2 h, and the gate re-read never links it to the wrong workout.
- **No coach.** No coach UI, provider call or canned coach copy on the page. Targets come from the built-in
  rules and the dry run only.

---

## Blocking

None.

---

## Should fix

### S1. `Check-in ›` stays tappable while Start is running, so a check-in made then is thrown away

`apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:554-560` (the collapsed `TextButton` has no
`disabled`), with `:213-238`.

The inline tiles are `disabled={busy || scoring}`, but the AX `Check-in ›` button isn't. Start checks
`navigation.isFocused()` once, before `alertsAsk.ensureAsked()` and `startFromOverview`. On a phone with imported
history, those can take most of a second: preview check, dry run and fence.

Scenario: at AX1+ with a check-in due, Ben taps `Start workout`, then `Check-in ›` straight away (both sit in the
bottom bar). The sheet opens and he taps `2`. Meanwhile Start finishes with `{kind: 'skipped'}`, and
`openStartedWorkout` resets the stack, so the sheet disappears under his finger. The check-in he just gave is
left unlinked, and the session says `skipped`. A pain mention at that point wouldn't hold loads in the workout
that just started (rule 9). Rare, but it's the same class of bug as r2 B1 and S1.

Fix: `disabled={busy || scoring}` on the `Check-in ›` button, matching the tiles. Optionally re-check
`navigation.isFocused()` just before `dispatch(openStartedWorkout(…))`, and if it fails, leave the started
session for Today's Resume rather than reset over a sheet. Add a source check next to the existing
`disabled={busy || scoring}` one.

### S2. The on-device Dynamic Type check is still open (r1 B2, r2 S2/S3)

`docs/design/workout-overview.md` §11 now records it as "Not yet done". The strip's wrap detection and the
check-in row's measured layout are plausible, but nothing on Linux can show clipping, the one-frame column then
stack flash, or whether `onTextLayout` reports a mid-number break as a second line for the nested `≈` /
value / suffix text. Before the first real workout, check on Ben's iPhone at xLarge, xxxLarge and AX3: the top
bar and chip, panel lines, all three check-in row layouts, the strip with `≈ 19:05`, and Start staying visible.
Record the result in §11.

---

## Nits

- **N1.** `WorkoutOverviewScreen.tsx:222`: the `reasons_open || !navigation.isFocused()` stop and the
  `pending = scoreGuard.running() ? …` capture at `:211` are pinned only by source greps
  (`workout-overview-screen.test.ts:283-288`). The S1 test replays the glue by hand. That's acceptable on Linux,
  but if the screen ever gets a render test harness, this ordering is the first thing to cover.
- **N2.** `CheckInScreen.tsx:336`: What's up? `Done` always uses opId `${recordOp}:reasons`. Within one sheet,
  `Done [Pain]` → pain step → back to `What's up?` → change the reasons → `Done` is a no-op duplicate
  (`applyCheckInPatch` returns `duplicate`). The record keeps the first reasons and note, though the sheet acts on
  the second. This is on the base branch too, not this slice, but it now feeds the overview's preview key. Fix:
  a fresh opId per `Done`, held across retries of that same Done.
- **N3.** Copy now shown over the overview, carried over from check-in.md:
  - The ill step's lead, `You picked Feeling ill. It's your call. Nothing changes either way.`, is a reassurance
    line.
  - The pain step's lead, `No increases on these until you clear the flag. This isn't a diagnosis.`, explains a
    rule. Its "not a diagnosis" half is defensible under rule 9.

  Trim the first and consider moving the rule half behind `Why?`. This needs a check-in.md copy change.
- **N4.** `ui/overview.tsx:218`: the window width stands in for the strip's width. That's fine on iPhone. If a
  sheet or split view ever hosts the page, use the strip's own `onLayout` width.

---

## Spec issues

1. **Approvals still pending (carried from r2).** ADR 0019 is `Proposed … Ben to confirm`. check-in.md's CI2
   amendment and workout-overview §11 are also "Ben to confirm", and `docs/brief/CHANGELOG.md` has no entry
   for the overview, the CI2 amendment or the fence. Per CLAUDE.md, record Ben's decisions before this merges
   to the main line, or merge with them flagged as provisional.
2. **§2.2 "Start and the check-in"** says a sheet check-in is linked "as soon as the sheet closes". It should
   also say the check-in row is not tappable while Start is running (S1). Otherwise the spec leaves that window
   undefined.

## Verdict

**PASS.** r2's blocker (B1) and S1 are fixed at the right layer. The check-in decision is now a pure,
SQLite-tested step, and the existing stale-preview check holds a pain mention instead of starting past it. No
start path, idempotency, force-close or honesty regression was found. The full check passes. S1 (disable
`Check-in ›` while Start runs) is a one-line fix and should land before the first real workout. So should the
device check (S2). Neither blocks merging the slice.
