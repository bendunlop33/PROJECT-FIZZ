VERDICT: PASS

# Review r3: Workout Table view (claude/workout-table)

Reviewer: independent reviewer agent, 12 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/workout-table`. Round 3 covers the three fix commits after
`docs/reviews/workout-table-r2.md` (`39df407`, `aecb7c6`, `c0f1792`). I re-checked the Table diff as a whole against
`docs/design/active-workout.md` §2A, WT1–WT42 and WT-D1–D14, the mockup `docs/design/mockups/workout-table.html`,
Ben's decisions of 11 Oct 2026, CLAUDE.md rules 1–10, one-handed use, accessibility, and whether any existing workout
feature was lost.

## Checks run

- `npm run typecheck`: exit 0.
- `npx eslint .`: exit 0.
- `npx vitest run --testTimeout=180000`: 232 of 234 files passed (4488 tests passed, 1 todo). Three timing-budget
  tests failed under full-suite load: `apps/mobile/test/progress-perf.test.ts` (cold pass) and
  `packages/persistence/test/backup-perf.test.ts` (JS-thread block, store queue hold). I re-ran those two files on
  their own and all 3 tests passed. They're the known flaky timing tests, and this branch doesn't touch them.
- The three Table test files (`workout-table.test.ts`, `tile-fit.test.ts`, `table-view.test.ts`): 84/84 pass.

## Round-2 findings: status

| r2 | Status |
|---|---|
| B1 keypad hides the focused tile; focus/keyboard event race | **Fixed.** `keypad_opened` now comes from the tile's own `onFocus` (`NumberStepper` → `OpenSetRow.onTileFocus`) and carries the `TileId`, so the `currentlyFocusedInput` race is gone. A note, rename or coach keyboard can't move the list, because only tiles send the event. `keypadScrollY` (`workout/table.ts:84`) is pure. It keeps the open row under the header when the focused tile fits, and otherwise scrolls until the tile's bottom clears the lifted bars. It's tested at 375 × 667 and 390 × 844, idle and resting, with LOAD, REPS and TIME focused. The apply waits until both the keypad height and the tile's measured box are known. See S1 for an ordering gap that remains, and SP1 for the case where the tile still can't fully fit. |
| S1 tall pinned superset header | **Fixed.** Only the group line, `Adjust`, `⋯` and the column labels pin. Member lines (with their name tap, `⋯`, pain badge and note) and the warm-up line now scroll at the top of the body. All controls are kept. |
| S2 after-set block plus stacked tiles don't fit | **Fixed as suggested.** `anchorTargetY` keeps the block under the header when the tiles still clear the bottom bars. Otherwise it scrolls just enough for the last tile to clear them, and never past the open row's top. It has pure tests: chips only, chips plus an offer, an open row that doesn't fit, and no block or tiles not yet measured. The spec text still describes the old rule (SP2). |
| S3 plate-loaded `added` shows `+100 kg` under `KG` | **Fixed.** `withUnit` takes the equipment kind. There's a test with a mixed leg-press and weighted-dip superset. |
| S4 `write_conflict` treated as quiet | **Fixed.** Only `stale_version` is quiet. `selectRow` shows `refusalText` for the rest (`WorkoutScreen.tsx:931`). It's tested. |
| N1–N8 | Unchanged; listed again below. |

## What is good

- **Rule 2 holds.** `log_set` is still sent from one place only (`WorkoutScreen.tsx:657`). The source-scan test still
  enforces that. The new focus and anchor plumbing only scrolls; it sends no command. Neither a tile focus nor a
  pending-row tap can log.
- **No progression or load computed in the UI.** The r3 changes are scroll geometry plus one domain formatting fix.
  Each kg/lb value and load convention stays explicit per cell.
- **Versioned and idempotent writes are unchanged.** A select still sends `save_draft` first, then the versioned
  `set_active_set`, each with an op ID.
- **Offline / AI.** No new network or AI paths, no new logging of health data, no credentials.
- **Testability.** Both anchor rules are now pure functions with phone-geometry tests. The wiring (only tiles send
  `keypad_opened`) is pinned by a source-scan test.

## Blocking

None.

## Should fix

**S1. The keypad anchor can apply using tile positions from before the keypad hid the plate line. It then scrolls too
far, and at 375 × 667 during rest that pushes the focused tile's stepper under the pinned header.**
`apps/mobile/src/screens/workout/WorkoutTable.tsx:163–166` (tile path), `:932` (plate line hidden while
`keypadOpen`), `:941` (`containerY` updated in `onLayout`).

- Sequence:
  1. A tile is focused, and the request is stored.
  2. `keyboardWillShow` sets `keypadOpen` and `keyboardHeight` in the same commit.
  3. That commit removes the plate line (and `Last`/`Why?`, which don't move the tiles). The tile container's `y`
     shrinks by about 28 pt (the plate line plus a gap).
  4. The effect reschedules `tryApply` because `props` changed.
  5. If that `requestAnimationFrame` runs before the container's new `onLayout` arrives (nothing guarantees the
     order), `tryApply` reads the stale `tiles.current`, scrolls about 28 pt too far, and clears the request.
  6. The corrected layout that arrives later doesn't re-apply.
- At 390 × 844 this is harmless.
- At 375 × 667 during rest, the space between the pinned header (~124 pt) and the lifted bars is ~70–95 pt. That's
  already less than a stacked tile (108 pt), so the anchor deliberately bottom-aligns the tile (SP1). The extra 28 pt
  puts about 30 pt of the 52 pt −/+ row under the header. Ben then has to scroll one-handed with the keypad up.
- It only happens with a barbell or plate-loaded exercise (where there's a plate line).
- Fix:
  - Tag each tile report with the `keypadOpen` it was measured under (or with a layout generation that bumps when
    `keypadOpen` changes).
  - On the tile path, apply only when the report matches the current `keyboardHeight > 0` state.
  - Alternatively, keep the plate line's height reserved while the keypad is open, so nothing above the tiles moves.
  - Add a test that feeds a stale report and then a fresh one, and checks that the anchor applies only after the
    fresh one.

**S2. The spec hasn't been updated for what the build now does (see SP1, SP2).** §2A.4 still says the anchor always
puts the after-set block directly under the header, and wireframe E still draws member lines inside the pinned
header. Neither change is wrong; both are what r2 asked for. But the developer's next pass (and the device pass)
will check against a spec that disagrees with the code. Bring §2A.4, §2A.8 and wireframe E into line, pending Ben's
SP1 choice.

## Nits

- **N1.** A `tile` anchor request waits for `keyboardHeight > 0` (`WorkoutTable.tsx:165`). If a tile focuses but no
  keypad appears (a hardware keyboard, or the simulator), the request stays pending. Until Ben scrolls, `tryApply`
  returns before `reportChips`, so the Done/Now chips only update from `onScroll`. Drop the request when the field
  blurs without a keyboard, or call `reportChips` on that early return.
- **N2.** `viewportClosed` is only refreshed while the keypad is closed (`:390`). It goes stale if the rest bar appears
  or disappears while the keypad is up (rest ends while Ben is typing). A focus move to another tile then uses a
  viewport that's off by the rest bar's 64 pt. In the "rest ended" direction that over-scrolls, so it's mostly
  harmless. Recompute it as `viewport + keyboardHeight` instead of keeping a snapshot.
- **N3 (r2 N1).** `rows.current` entries aren't removed when a done row unmounts, so `↑ N done` can use a stale
  position.
- **N4 (r2 N2).** Rest ended still hides `−30`/`+30`. §2A.6 removes only `Skip`.
- **N5 (r2 N3).** `restFull` isn't reset on view switch or Log.
- **N6 (r2 N4).** The VoiceOver order is document order. The member lines now sit before the after-set block in the
  body, which matches §2A.7 better than before. The `setTimeout` focus move isn't cleared on unmount (it's guarded).
- **N7 (r2 N5).** `PainBadge` is about 36 pt including `hitSlop` (`WorkoutTable.tsx:435`), next to a 44 pt `⋯` on
  each member line. Make it 44 pt.
- **N8 (r2 N6/N7/N8).** Sled push (`added`, no equipment) reads `+KG`. A bodyweight member's row in a mixed block has
  no load cell for alignment. `Plates` opens a plain `Alert`.

## Feature-loss check (Table vs Focus)

Swap, Undo swap, Remove, Skip, Notes (exercise, member and set), set types and badges, timed (Start/Stop,
`Log 0:45`, WORK tile, TIME tile anchored on focus), distance (DIST tile anchored on focus), gym switch (chip,
parts, divider, `SnapNote`), pain (per-member badge, `Pain` in `AdjustRow`, review line), exclusions, supersets (round
order, `→ A2`, the group `Adjust`/`⋯` pinned, per-member name, `⋯`, badge and note in the body), sides, coach and
rule offers (after-set block), `TimeLeftLine`, `Why?`, `How to`, target RPE, warm-up ramp (now in the body with
`Hide`), plates, copy `Last`. **Nothing found missing.**

## Spec issues

- **SP1 (r2 SP1, still open).** With 52 pt steppers, LOAD + REPS stack on every iPhone width. WT39 ("the open row …
  fully visible above [the keypad] at 375pt and AX3") can't hold for a stacked row, and at 375 × 667 during rest even
  the focused tile (108 pt) doesn't fully fit between the pinned header and the lifted bars. The build bottom-aligns
  it, so the numeral and −/+ stay visible and the label goes under the header. At AX3 (60 pt steppers) it's worse.
  Ben should still choose one of:
  - (a) accept stacked tiles and change WT39 to "the focused tile's value and −/+, and Log";
  - (b) allow 44 pt tile steppers in Table so the tiles fit side by side;
  - (c) a compact REPS tile.

  Check on the device pass at 375 × 667 resting and at AX3.
- **SP2.** §2A.4's anchoring rule needs the r3 refinement: "the after-set block under the header, unless the block
  and the open row's tiles can't both fit; then the tiles win, never past the open row's top". §2A.8 and wireframe E
  need the pinned / scrolling split for superset member lines (this closes r2 SP5).
- **SP3 (r2 SP2).** `docs/design/workout-table.md` is still headed "proposed revision, not yet approved" and points
  to `workout-table-final.html`. Mark it superseded by §2A.
- **SP4 (r2 SP3).** `Voice & alerts` and `Rest presets` in the workout `⋯` have no screen yet.
- **SP5 (r2 SP4).** WT-D11 (an open-ended workout keeps `Add exercise`) is still "Ben to confirm".
