VERDICT: CHANGES NEEDED

# Review r2: Workout Table view (claude/workout-table)

Reviewer: independent reviewer agent, 12 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/workout-table`. Round 2 covers the three fix commits after
`docs/reviews/workout-table.md` (`fb27e95`, `d421976`, `d207d6e`), and I re-checked the whole Table diff against
`docs/design/active-workout.md` §2A and WT1–WT42 / WT-D1–D14, the mockup `docs/design/mockups/workout-table.html`,
Ben's decisions of 11 Oct 2026, CLAUDE.md rules 1–10, one-handed use, accessibility, and whether any existing workout
feature was lost.

## Checks run

- `npm run typecheck`: exit 0.
- `npx eslint .`: exit 0.
- `npx vitest run --testTimeout=180000`: 233 of 234 files passed (4467 tests passed, 1 todo). The one failure was the
  timing budget in `apps/mobile/test/progress-perf.test.ts` under full-suite load. Run on its own it passes (1/1). It's
  the known flaky timing test and isn't related to this branch.
- The three Table test files (`workout-table.test.ts`, `tile-fit.test.ts`, `table-view.test.ts`): 61/61 pass.
- I ran `tileFit` myself for window widths from 375 to 440 pt at the default text size. With 52 pt steppers, LOAD + REPS
  **stack on every iPhone width**. The REPS tile alone can't hold 2 digits beside 2 × 52 pt at flex 1 below about
  450 pt. The layout therefore never flips between side by side and stacked while Ben steps the load, which is good.
  But the open row is now always the tall, stacked version (see B1 and SP1).

## Round-1 findings: status

| r1 | Status |
|---|---|
| B1 tiles clip at 375/390 | **Fixed.** `tileFit` is pure and tested. Numerals shrink to fit and are never clipped, and the tiles stack when they can't fit at 28 pt or more. The measured width replaces the window estimate. This is the WT-D13 rule as written. The side effect is in B1 below. |
| B2 mixed superset columns | **Fixed.** Each row now has its own `columns`. A shared header shows only when every row agrees; otherwise each cell carries its own unit (`25 lb each`, `+10 kg`, `12 reps`, `0:45`). Tests cover bodyweight + loaded, kg + lb, reps + timed, and members that agree. |
| B3 superset controls and menu target | **Fixed.** `Adjust` and `AdjustRow` show while the group is current. The group `⋯` uses the domain's `menuTarget` (the open member, else the next one in lifting order). Each member line opens its own sheet, and has its own `⋯`, pain badge and note. There's a test. |
| S1 warm-up | **Fixed.** It's in the current card or superset header, with `Hide`. |
| S2 AX plates / Last | **Fixed.** The sheet has `Plates` (every target load, plus `Now:`) and, at AX1+, `Last …` (copy). |
| S3 keypad anchor | **Partly fixed.** Other keyboards no longer move the list. The open row is anchored instead of the after-set block. See B1 for what's still wrong. |
| S4 non-current `⋯` | **Fixed.** It now has `Target RPE`, `Undo coach change` / `Undo change` and `Undo swap`, using `exerciseCardFacts` with the same flags as Focus. |
| S5 VoiceOver | **Mostly fixed.** Focus moves to the open row's header after a Log and on open. The list itself is still in document order (N4). |
| S6 tests | **Fixed.** `selectRowFlow` is extracted and tested: draft then select, a failed save, and refusals. There are tests for tile fit, mixed supersets and the menu target. |
| N1–N10 | N9 is fixed. N1, N3–N7 are unchanged (listed again below). N2, N8 and N10 are unchanged, and the spec items behind them are still open. |

## What is good

- **Rule 2 still holds.** `log_set` is still sent from one place only (`WorkoutScreen.log`), and the source-scan test
  enforces that. `selectRowFlow` sends only `save_draft` and the versioned `set_active_set`. Tests confirm that a
  pending-row tap can never log, including when the save fails or the select is refused.
- **No load or target is computed in the UI.** `exerciseCardFacts` reads the stored next pending set, its coach
  change (checked with `coachUndoRefusal`), its swap, and plate lines for stored target loads. `withUnit` only formats.
  The kg/lb and convention are always shown on mixed rows, which fixes the r1 breach of the CLAUDE.md convention.
- **Versioned writes.** The non-current `Delete this set` sends the next set's `expectedSetVersion`. `Target RPE` goes
  through the existing versioned `set_target_rpe` path. A stale select is reloaded quietly.
- No new network calls, AI text, logging of health data or credentials. Offline behaviour is unchanged from r1.

## Blocking

**B1. With the tiles now always stacked, the keypad anchor still lines up the top of the open row, not the tile being
edited. So when Ben types into REPS (or TIME/DIST) at 375 or 390 pt, that tile sits under the keypad (WT39). The
check for which keyboard opened also depends on an event order that isn't guaranteed.**
`apps/mobile/src/workout/table.ts:87` (`keypad_opened` → `target: 'open_row'`);
`apps/mobile/src/screens/workout/WorkoutTable.tsx:143–147` (scrolls so the open row's top sits under the pinned
header); `apps/mobile/src/screens/workout/WorkoutScreen.tsx:240–247`;
`apps/mobile/src/screens/workout/WorkoutTable.tsx:766–771` (tile layout).

- Arithmetic at 390 × 844, using this branch's tokens:
  - Stacked tile: 2 × 16 padding + 16 label + 8 gap + 52 stepper = 108 pt.
  - The open row's top line is 44 pt. From the top of the open row to the bottom of the REPS tile is about
    44 + 8 + 108 + 8 + 108 = 276 pt.
  - Space above the keypad: 844 − 47 status − about 52 top bar − about 124 pinned card header (more with the warm-up
    line) − 291 number pad − 44 Done bar − about 76 Log bar ≈ 210 pt.
  - So the REPS tile's stepper row ends about 60 pt below the top of the keypad. At 375 × 667 (number pad 216 + 44) only
    about 150 pt is left, and even the LOAD tile is borderline.
  - WT39 says "the open row and Log are fully visible above it at 375pt and AX3". After the stacking change, that
    can't be met for the whole row. The focused tile must still be visible, and it isn't.
- Failure scenario:
  1. Ben finishes a set and taps the REPS numeral to type `12`.
  2. The list scrolls so that `Set 2 · NOW` sits under the header, and the REPS field he's typing into is behind the
     keypad.
  3. He types blind. Only the Log pill shows the value, and only if it fits.
  4. Stepping `−`/`+` on REPS means dismissing the keypad first.
- The focus check reads `TextInput.State.currentlyFocusedInput()` inside `keyboardWillShow`.
  - RN sets that value from the TextInput's `onFocus` event. The keyboard notification reaches JS through a different
    channel (`RCTDeviceEventEmitter`), and React Native doesn't promise which arrives first.
  - If the keyboard event wins, `isTileFocused` returns false and the list doesn't move at all. The test
    (`workout-table.test.ts:53`) only covers the identity comparison, so it can't catch this.
- Fix:
  - Drive the anchor from the tile itself. Add an `onFocus` prop to `NumberStepper` that sends
    `anchorEvent({ kind: 'keypad_opened', tile })`. This makes the check deterministic and removes the
    `currentlyFocusedInput` race.
  - Scroll so the **focused tile's** bottom (and the Log bar) clears the keyboard top. Use the
    `keyboardWillShow` `endCoordinates.height`, and the tile's measured `y` inside the open row.
  - Make it a pure function in `workout/table.ts` and unit-test it at 375 × 667 and 390 × 844 with LOAD, REPS and TIME
    focused.
  - Confirm on the device pass (WT39 is already listed there).

## Should fix

**S1. The pinned superset header is now very tall, and it pushes the open row's tiles off screen at 375–390 pt.**
`WorkoutTable.tsx:487–556`, with each member line at `minHeight: theme.target.workout.height` (`:519`).

- The B3 fix put a 52 pt pressable line per member, its `⋯`, its note, the warm-up line and `Adjust` inside the
  **sticky** header.
- A 2-member superset pins about 12 + 8 + 52 + 2 × 52 + 32 ≈ 208 pt. That's about 250 pt with a member note or the
  warm-up line, and a giant set (3–4 members) pins about 300 pt.
- Wireframe E shows two compact bracket lines.
- On 375 × 667 during rest, the list area is about 667 − 20 − 52 − 208 − 76 Log − 64 rest bar ≈ 250 pt. The anchor puts
  the after-set block (effort chips, maybe an offer) first, so the open row's stacked tiles start below the fold on
  every round. Ben has to scroll one-handed each set. This is the "pinned header plus after-set block" risk that §8.4
  flags for the device pass, and this branch makes it worse.
- Fix:
  - Pin only the group line (`Superset A · Round 2 of 3 · Adjust · ⋯`) and the column labels, and let the member list,
    notes and warm-up scroll with the body.
  - Or make the member lines compact, with the 44/52 pt hit area coming from `hitSlop` rather than a visual
    `minHeight`.
  - Apply the same to `CardHeader`'s warm-up line (`:475`).

**S2. Stacked tiles make the open row about 100 pt taller, so the after-set block plus the open row no longer fit
together, even outside supersets.**
- At 390 × 844 during rest, the visible list is about 844 − 47 − 52 − 124 − 76 − 64 ≈ 480 pt.
- Effort chips and the eyebrow take about 100 pt, and a `CoachOfferLine` about 150 pt. Add the open row (top line,
  plate line, two tiles, target line, `Rest after`), which is about 360 pt, and the REPS stepper falls below the rest
  bar whenever an offer is showing.
- This is the consequence of SP1. Ben should choose there. Until he does, the anchor could favour the open row's tiles
  when they can't all fit with the after-set block.
  - One option: when the after-set block plus the open row don't fit, anchor the open row and leave the block just
    above it.
  - Add a pure test of that rule.

**S3. A mixed-unit block labels a plate-loaded `added` load as `+100 kg`, but the column header for the same exercise
reads `KG`.**
`packages/domain/src/session/table-view.ts:245`. `tableColumns` and `loadCell` both treat
`eq.kind === 'plate_loaded_machine'` as a plain load, but `withUnit` doesn't take `eq`. Pass the equipment kind into
`withUnit` and add it to the mixed-superset tests.

**S4. `selectRowFlow` treats `write_conflict` as a quiet double tap.**
`apps/mobile/src/workout/table.ts:210`. `write_conflict` means "The workout kept changing; try again"
(`session-service.ts:309`). That's a real failure, not a duplicate tap, so Ben sees a dead tap. Keep only
`stale_version` quiet and show the others with `refusalText`.

## Nits

- **N1 (r1 N1).** `rows.current` entries are still not removed when a done row unmounts (delete, or block removed),
  so `↑ N done` can use a stale position (`WorkoutTable.tsx:288–293`).
- **N2 (r1 N3).** Rest ended still hides `−30`/`+30`. §2A.6 removes only `Skip`.
- **N3 (r1 N4/N5).** `restFull` isn't reset on view switch or Log. After a relaunch, the after-set block comes back
  only while rest is still running.
- **N4.** The VoiceOver order is still the document order (folded and done blocks first). The focus move after
  open/Log makes up for most of it.
  - Moving focus on `opened` skips the top bar, whereas §2A.7 starts at the top bar. That's a reasonable choice, but
    note it in the spec.
  - The `setTimeout` in `tryApply` (`WorkoutTable.tsx:163`) isn't cleared on unmount (it's guarded, so this is harmless).
- **N5 (r1 N6).** `PainBadge` is still about 36 pt including `hitSlop` (`WorkoutTable.tsx:393`). It now sits next to
  a 44 pt `⋯` on every superset member line, so stray taps are more likely. Make it 44 pt.
- **N6 (r1 N7).** Sled push (`added`, no equipment) still reads `+KG`.
- **N7.** In a mixed block, a bodyweight member's row has no load cell, so `8 reps` sits in the column where the
  loaded member shows `10 kg each`. It's readable because each cell carries its unit, but the columns don't line up.
  Consider an empty load cell for alignment.
- **N8.** The exercise sheet's `Plates` opens a plain `Alert`. It's fine for now, but the design system's sheet would
  keep the Direction D styling.

## Feature-loss check (Table vs Focus)

Swap, Undo swap, Remove, Skip, Notes (exercise and set), set types and badges, timed (Start/Stop/`Log 0:45`, WORK
tile), distance, gym switch (chip, parts, divider, captions, `SnapNote`), pain (badge, note, `Pain` in `AdjustRow`,
review line), exclusions (in the correction sheet), supersets (round order, `→ A2`, per-member menus, now complete),
sides (Side control, L/R badges, the auto-added other side), coach and rule offers (after-set coach slot), `TimeLeftLine`,
`Why?`, `How to`, target RPE, warm-up ramp, plates, copy `Last`. **Nothing found missing.**

## Spec issues

- **SP1 (r1 SP2, still open, now forced).** With 52 pt steppers, LOAD + REPS stack on every iPhone width. The REPS
  tile alone can't fit 2 digits at 28 pt below about 450 pt.
  - So WT-D13's "side by side, shrink to 28 pt" never happens on a phone. The build has in effect used the
    alternative the table rejected ("Always stacked tiles (taller open row)").
  - The mockup and wireframes A–F still show side-by-side tiles.
  - WT39 ("the open row … fully visible above [the keypad]") can't hold for a stacked row at 375–390 pt.
  - Ben should choose one of:
    - (a) accept stacked tiles and change WT39 to "the focused tile and Log";
    - (b) allow 44 pt tile steppers in Table so the tiles fit side by side;
    - (c) a compact REPS tile (numeral with the −/+ above and below).
- **SP2 (r1 SP1).** `docs/design/workout-table.md` is still headed "proposed revision, not yet approved", and still
  points to `workout-table-final.html`. Mark it superseded by active-workout §2A.
- **SP3 (r1 SP3).** §4.6 `Voice & alerts` and `Rest presets` in the workout `⋯` have no screen yet.
- **SP4 (r1 SP4).** WT-D11 (an open-ended workout keeps `Add exercise`) is still "Ben to confirm".
- **SP5.** Wireframe E's compact member lines don't account for the controls B3 needed (a per-member menu, a name tap,
  a note). The spec should say which of those are pinned (see S1).
