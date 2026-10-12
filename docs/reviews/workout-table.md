VERDICT: CHANGES NEEDED

# Review: Workout Table view (claude/workout-table)

Reviewer: independent reviewer agent, 12 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/workout-table` (6 commits, 20 files). Checked against
`docs/design/active-workout.md` §2A, §3.1, §4.5, §4.6 and checks WT1–WT42 (and §8.4 WT-D1–D14), the mockup
`docs/design/mockups/workout-table.html`, Ben's decisions of 11 Oct 2026, and CLAUDE.md rules 1–10. I also checked
one-handed use, accessibility, and whether any existing workout feature was lost.

## Checks run

- `npm run typecheck`: exit 0.
- `npx eslint .`: exit 0.
- `npx vitest run --testTimeout=180000`: 243 of 244 files passed (4536 tests passed, 1 todo). The one failure was the
  timing budget in `apps/mobile/test/progress-perf.test.ts` (193 ms against a 103 ms budget, under full-suite load).
  Run on its own it passes, so it's the known flaky timing test and not related to this branch.

## What is good

- **Rule 2 holds for logging.** `log_set` appears once in the app (`WorkoutScreen.log`), and a test enforces that
  (`workout-table.test.ts:123`). The open row has no tick (WT11). A pending-row tap goes through
  `rowTap` → `selectCommand` (`set_active_set`, versioned) and can never log (`table.ts:139–154`). A done-row tap
  opens the versioned correction sheet. The Log label is the active view's own `primary.label`, plus a prefix or
  suffix (`tableLogLabel`), so the pill always names exactly what `log_set` saves.
- **One source for both views.** `buildWorkoutTableView` reuses `buildSetRows` (moved out of `buildFocus` without
  changing behaviour), `targetText`, `targetRpeOf` and the stored targets. It never computes a load or a target.
  The open row is the `FocusView` itself.
- **Anchoring is derived, not stored** (WT-D12). The reducer (`anchorReducer`) moves the list only on open, Log,
  `Now`, keypad and view switch. Timers, toasts, effort, offers and reloads don't move it, and Ben's drag cancels a
  pending move. The force-close test (`workout-table.test.ts:219`) restores the same open row, its draft and the
  stored rest deadline on real SQLite.
- `selectRow` saves the open row's unsaved edit before `set_active_set`, so the 300 ms debounce can't lose it
  (`save_draft` doesn't bump the session version, so the follow-up select isn't refused as stale).
- Finish is never in the list. It's in `⋯`, and in the Log slot only when the domain's primary is `finish`.
  Open-ended workouts keep `Add exercise` (WT-D11).
- Rest bar: the countdown comes from the stored deadline, the pills have 52 pt hit areas, they're disabled while
  paused, and the drain isn't animated between seconds.
- Offline: the end-to-end tests run with the coach unavailable. `Chat` opens the coach screen, which shows its own
  honest status. No canned coach text is added anywhere.
- No new logging, network calls or storage of health data. `workoutView` is a device preference only.

## Blocking

**B1. The open row's LOAD and REPS tiles can't fit side by side at 390 or 375 pt with 52 pt steppers, and nothing
shrinks or stacks them. Numerals get clipped, and the reps `+` overflows the tile.**
`apps/mobile/src/screens/workout/WorkoutTable.tsx:701–736, 768`; `apps/mobile/src/ui/workout.tsx:57–61, 176–186`.

- Width at 390 pt: the list's horizontal padding is 2 × 16, the card body's is 2 × 12, and the open row adds −4 + 15
  + 12. That leaves about 315 pt, minus an 8 pt gap.
  - LOAD tile (flex 1.35): about 176 pt. After 16 pt of padding and 2 × 52 pt steppers, 56 pt is left for a 38 pt
    numeral. `100` needs about 66 pt and `102.5` about 110 pt.
  - REPS tile (flex 1): about 131 pt. After padding, 115 pt has to hold 52 + 36 (TextInput `minWidth`) + 52 = 140 pt.
    The row overflows by about 25 pt.
- At 375 pt it's worse.
- WT-D13 and WT40 require numerals to shrink to fit (down to 28 pt) or the tiles to stack, and say a number is
  "never clipped". The code does neither. `stepSize={52}` was added and the side-by-side layout kept. Before this
  branch, Focus didn't hit this because its steppers were 44 pt in a 350 pt-wide card.
- Failure: Ben at 390 pt with 102.5 kg sees `102.` or overlapping glyphs in the tile, and the reps `+` sits partly
  outside the card. The values on the pill are still right, but the main editing control is broken on the default
  screen.
- Fix: measure the row, and stack LOAD over REPS whenever the 28 pt numeral plus 2 × 52 pt doesn't fit. That will
  probably be always at 375/390 for two tiles. Or shrink the numeral with a measured font size. Add a layout test
  (pure width calculation) for 375 and 390 at default text size and xxxLarge, and confirm with a simulator
  screenshot.

**B2. A superset card uses the first member's columns for every member, so a later member's loads are hidden or
labelled with the wrong unit or measurement.**
`packages/domain/src/session/table-view.ts:410`; rendered by `WorkoutTable.tsx:280` and `:595` (the load cell is
drawn only when `columns.loadLabel !== null`).

- A1 Chin-up (bodyweight) with A2 Dumbbell curl: `loadLabel` is null, so A2's pending targets and **done actual
  loads** don't appear in any row.
- A1 Cable fly (kg stack) with A2 lateral raise on a lb dumbbell rack: the label says `KG` over A2's lb values. That
  breaks the CLAUDE.md convention that kg/lb are always explicit.
- A2 Plank (duration): the column says `REPS` over `0:45`.
- No test covers a mixed superset. The only superset fixture has two kg-stack members
  (`table-view.test.ts:151`).
- Fix: give each round row its own columns (`row.columns`, or per-member columns on `SupersetMember`). Either render
  a label per member, or keep the shared header only when all members agree. Unit-test the bodyweight + loaded,
  kg + lb and reps + duration cases.

**B3. In a superset, the Table loses controls that Focus had, and the card's `⋯` acts on the wrong exercise.**
`WorkoutTable.tsx:216–218, 464–501` (`menuFor = superset.members[0]`); `WorkoutScreen.tsx:824–870`.

- `SupersetHeader` has no `Adjust` (it's passed only to `CardHeader`). With A1 or A2 current, the inline
  `AdjustRow` (`Too hard`, `Too easy`, `Pain`) can't be opened. That breaks WT22 and coach-adjustments §2.2 for
  superset exercises, and removes the rule-3 "when Ben asks" path in the default view.
- The superset `⋯` always calls `onMenu(A1)`. While A2's set is open, `openCardMenu(A1)` takes the non-current path.
  - `Delete this set` deletes **A1's** next pending set, and `Skip`, `Remove` and `Swap` act on A1.
  - A2's `Swap`, `Remove`, `Notes`, `Target RPE`, `How to` and `Undo swap` can't be reached from Table.
  - Superset members also have no name tap (no exercise sheet, so no How to or History), no note line and no
    `+ Add set`.
- The brief for this review asks that no existing workout feature is lost. In Focus, all of these exist for the
  current member.
- Fix:
  - Put `Adjust` on the superset header when the group is current, acting on the open row's exercise.
  - Make each member line in the bracket a button that opens that member's sheet and menu.
  - Route the group `⋯` to the open member, or ask which member.
  - Add a test that the group menu acts on the current member.

## Should fix

**S1. The warm-up ramp suggestion is missing from Table.** §2A.3 puts `Warm-up · 20 × 10 · 60 × 5 · 80 × 3` with
`Hide` in the card header (as built in Focus, `WorkoutScreen.tsx:~1498`). `FocusView.warmUp` is available but
`OpenSetRow` and `CardHeader` never render it. This is a lost feature in the default view. Render it in the current
card's header, reusing `hiddenWarmUps`.

**S2. At AX1+, the plate line and `Last` disappear instead of moving into the exercise sheet.**
`WorkoutTable.tsx:751, 763` hide them when `ax`. §2A.10 says they "move into the exercise sheet", but
`openExerciseSheet` (`WorkoutScreen.tsx:872`) has no `Plates` and no `Last`, and §2A.7 also lists `Plates` for
everyone. So an AX user loses the plate breakdown and the copy-last shortcut entirely. Add `Plates` and `Last …`
(copy) items to the sheet.

**S3. Keypad-open anchoring can hide the open row under the keyboard, and fires for unrelated keyboards.**
`WorkoutScreen.tsx:242` sends `keypad_opened`, which anchors the after-set block's top under the pinned header
(`WorkoutTable.tsx:140`).

- With effort chips and an offer (about 250 pt) above the open row, the tiles land below a 340 pt keyboard at 375 pt.
  That breaks WT39: "the open row and Log are fully visible above it".
- The same listener fires when the NoteSheet, Rename or a coach text field opens. The list behind them then moves,
  which goes against "Ben's own scrolling always wins".
- Fix: for `keypad_opened`, anchor to the open row (or the focused tile), not the after-set block. Only react when a
  tile input has focus.

**S4. The `⋯` menu on a non-current card is missing items that §2A.7 lists.** `openCardMenu` calls
`exerciseMenu(howTo, false, {canSwap, canRemove})`, so `Target RPE` (on its next pending set), `Undo coach change`
and `Undo swap` are missing for exercises that aren't current. Pass the same flags derived for that exercise (the
target RPE of its next pending set, its `coachActionId`, `swappedFrom`).

**S5. VoiceOver order and focus after auto-advance aren't handled.** §2A.7 asks for: top bar → current card header →
after-set block → open row → Log, then the rest of the list. The list is in plain document order, so VoiceOver
starts on folded exercises and done rows that are scrolled above the viewport. After a Log, nothing moves
accessibility focus to the new open row. One option is `AccessibilityInfo.setAccessibilityFocus` on the open row
after `logged` and `opened`.

**S6. The tests miss the riskiest new code.**
- There's no test for mixed-member supersets (B2), the superset menu target (B3), the tile-fit rule (B1), or
  `selectRow`'s draft-then-select order.
- `workout-table.test.ts:192` re-creates the sequence by hand instead of exercising the screen helper. Extract
  `selectRow`'s logic (save the draft, then select with the returned version) into `workout/table.ts` and test it,
  including a refused select.

## Nits

- **N1.** `rows.current` (measured done rows) is never cleaned up when a row unmounts (delete) or turns pending
  again (Undo with an unchanged height, so `onLayout` doesn't fire). `firstDoneTop` can then come from a stale
  position, and `↑ N done` shows or hides wrongly (`WorkoutTable.tsx:271–276, 107–110`). Clear entries in a ref
  callback or on unmount, or key the map by `row.state`.
- **N2.** When the next set is in another exercise, §2A.5 puts the after-set block above the next card's header. It
  renders inside the next card's body instead, below its pinned header (`WorkoutTable.tsx:244–257`). The eyebrow
  copes (`BENCH PRESS · SET 3 EFFORT`), but it doesn't match the spec.
- **N3.** The rest bar's ended state hides `−30` and `+30` too. §2A.6 only removes `Skip` (`WorkoutTable.tsx:958–960`).
- **N4.** `restFull` is never reset. If the full rest view is open, then Ben switches to Focus and back, it reopens.
  It also stays open showing `Ready 0:00` after rest ends. Clear it on view switch and on Log.
- **N5.** On restore, the after-set block comes back only if rest is still running (`WorkoutScreen.tsx:407`).
  §2A.5 keeps it until the next Log, so a relaunch after rest ended loses the effort chips for the set just saved.
- **N6.** `PainBadge` has about 20 pt visual height plus an 8 pt `hitSlop`, so about 36 pt. That's below the 44 pt
  minimum (`WorkoutTable.tsx:377`).
- **N7.** A distance exercise with the `added` convention and no equipment gets `+KG` (sled push in
  `table-view.test.ts:246`). Wireframe F and the §2A.3 table show `KG` for loaded distance.
- **N8.** The TIME tile edits seconds (`unit="s"`), but wireframe F shows `0:45` in the tile. This was already true
  in Focus and is only noted here.
- **N9.** `selectRow` ignores a refused `set_active_set`. A double tap reloads silently, which is fine, but any other
  refusal looks like a dead tap. Show `refusalText` as Focus's menu actions do.
- **N10.** The top `⋯` keeps `Ask the coach`, which duplicates `Chat` in the bar. It's missing `Voice & alerts` and
  `Rest presets` from §4.6 (see Spec issues).

## Spec issues

- **SP1.** `docs/design/workout-table.md` is still headed "proposed revision, not yet approved" and is now stale:
  - It points to `workout-table-final.html`, but the file is `mockups/workout-table.html`.
  - It says "With AI unavailable, no offer card appears", which contradicts WT-D5/CA6.
  - It uses the `C` badge, which WT-D9 replaced.
  - It says Table "restyles `buildWorkoutOverview`", which §2A.12 says was an error.

  Mark it superseded by active-workout §2A, or delete it, so later agents don't build from it.
- **SP2.** WT38 (52 pt steppers) and WT-D13 (side-by-side tiles, numerals never below 28 pt) can't both hold for
  LOAD + REPS in the open row at 375–390 pt (B1 has the arithmetic). The spec should say that LOAD and REPS stack in
  Table at default size, or allow 44 pt tile steppers there. Ben should choose. The mockup shows them side by side.
- **SP3.** §4.6 lists `Voice & alerts` and `Rest presets` in the workout `⋯`, but no such in-workout screens exist
  yet. Either mark them as later or point them at the existing Settings rows.
- **SP4.** WT-D11 (an open-ended workout keeps `Add exercise` as the primary) is still marked "Ben to confirm". The
  code implements the recommendation.
