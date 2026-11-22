# Review: Active workout v3 core slice: spec, prototype, copy, accessibility

Branch `claude/wo-v3-20oct`, `f16d3f5..baf0d54` (5 commits). Reviewer lens: fidelity to
`docs/design/workout-table-v3.md` and `docs/design/prototypes/workout-active-v3.html`, minimal
copy, accessibility, box-fitting logic, and nothing lost from the old screen. These items are
out of scope for this slice and are not counted against it: builder pop-up, Swap pop-up, set Type
picker, drag, superset link/unlink, `＋ Add exercise` under the last round, the coach ask bar,
untick restoring the rest, and the time-over Apply offer.

## Verdict: **CHANGES NEEDED**

## Validation run

- `npm run typecheck`: clean.
- `npx eslint` on the changed source files: clean.
- Targeted vitest (`workout-rounds`, `workout-table`, `table-view`, `workout-inline-entry`,
  `workout-keyboard`, `workout-inline-cell`, `set-pager`): 7 files, 143 tests, all pass.

## What is right

- Round model (`rounds.ts`) is pure and well tested. Working-set numbering skips warm-ups, `W`
  rows show no RPE, and `Top` / `Back-off` / `Drop` labels are shown. The RPE cell shows the
  target `@9`, then the logged value. Supersets order a → b → a and dim the member that isn't
  up next. Strip text matches the prototype (`✓ 1`, `3a·b`). The Log pill names the step
  (`3a · Set 3 · Log …`) and shows `Next round` on a done round.
- `fitRoundBoxes` follows the spec's order. It shrinks the box with the most rows first, aims
  for 3 rows, drops Up next before any box goes below 3, never goes below 2, and falls back to
  page scroll. Anchoring shows up to 3 rows above the current set, matching the prototype. Boxes
  are re-positioned on log, untick or round change, and never while typing.
- VoiceOver:
  - Row labels match §6 ("Set 3, 7.5 kilograms each, 12 reps, target RPE 9, not done").
  - Delete is a custom action on every row, including the open row (baf0d54).
  - Next/Previous exercise are custom actions on each exercise header, and strip chips are
    buttons with round labels.
- Nothing lost from the old screen:
  - The workout `⋯` (`workoutMenu`) and the exercise `⋯` (`exerciseMenu`) are unchanged.
  - Banners, gym chip, Adjust/AdjustRow, the warm-up ramp, pain badge and pain-flag links,
    off-profile and snap notes, gym-learn chips, the cardio time+distance pair, timed-set work
    timers, the Focus view and the rest screen (tap on REST) all survive.
  - Time left moves to the header elapsed (§5), and `＋ Add exercise` is in the Workout sheet.
- Swipe-delete uses the audited `delete_set` with Undo. A done row's ✓ uses the idempotent
  `undo_log` opId. Stale or not-latest refusals show a short toast.
- Copy is minimal. No rule or reassurance text was added.

## Blocking

**B1. Set numbers disagree across the same screen whenever an exercise has warm-ups.**
v3 numbers working sets 1..n without warm-ups (`apps/mobile/src/workout/rounds.ts:107-135`).
Every other place on the screen still uses the domain's `setNumber`/`number`, which counts
warm-ups (`packages/domain/src/session/active-view.ts:627, 894, 1133, 1308`):
- the Log toast `✓ Set N saved` (`WorkoutScreen.tsx:797`)
- the delete toasts (`:907`, `:985`)
- the set menu title (`:1044`)
- `Rest after set N` from `⋯` (`:1070`, `:2859`)
- the correction toast `Set N updated` (`:1137`)
- the effort heading `SET N EFFORT` (`:2298`)
- the correction editor's VoiceOver label (`:2358`)

Scenario: bench with 4 warm-ups and 4 working sets (the prototype's round 1). Ben logs the row
labelled `1`, and the toast says `✓ Set 5 saved`. The effort chips ask for `SET 5 EFFORT`. He
corrects row `2`, and the toast says `Set 6 updated`. `Why?` → `Change` reads `Rest after set 2`
for the same set that `⋯` calls `Rest after set 6`.

Fix: put one shared label (the v3 `stepName`: `Set 2` / `Warm-up`) on the domain row and focus
views, or give `rounds.ts` a `stepNameOf(setId)` lookup. Use it in every toast, sheet title and
VoiceOver label above. Add a test with warm-ups that checks the Log toast, effort heading and
correction toast against the row label. Spoken cues and the Live Activity should follow (they
belong to other branches, but they should get the same helper).

**B2. A new set can land out of sight after `＋ Set`.** This is the bug Ben reported on 20 Oct.
`WorkoutTable.tsx:241-254` calls `recompute()` (rAF A) and then `scrollToEnd` (rAF B) when the
new row lays out. If the box was showing every row (`height === null`), the extra row can make
it start scrolling. `fit` then gets a height, so the position key `positionKey|height`
(`:146-160`) changes. The positioning effect runs after rAF B and scrolls the box back to the
anchor.

Scenario: 3 sets that all fit, current set 1. Ben taps `＋ Set`, the box shrinks to 3 rows and
re-anchors on set 1, and set 4 flashes off-screen.

Fix: pass the added set into the positioning step. When `highlightSetId` is set, anchor on the
new row instead of the current set (or skip the positioning effect for that box until the
highlight is consumed). Call `onHighlightShown` only after the positioned scroll. Cover the
anchor choice with a unit test, for example a `fitRoundBoxes` / `boxFirstRow` variant with an
`ensureVisible` row.

**B3. With the keypad open, the page-scroll fallback hides the cell being typed in.** This
regresses an earlier blocking fix (WT39, review r2 B1). Those keypad-anchor tests were deleted
in 85d3d07 and nothing replaced them.

With the keypad and its accessory open, `available` shrinks by about 260 pt. Rough sums put a
superset round on a 667–852 pt phone, and many single exercises on an SE, under the "2 rows
each" floor, so the fallback will be common when typing. In the fallback:
- `fitRoundBoxes` returns every row unbounded with Up next shown (`rounds.ts:438`), which makes
  the content as tall as possible.
- `keepInView` only runs for bounded boxes (`WorkoutTable.tsx:178`).
- Nothing scrolls the page to the focused cell, and `keyboardDismissMode: 'interactive'` means
  Ben's own drag closes the keypad.

So the REPS cell of the current 3b set can sit behind the keypad, and the whole round reflows
from 3-row boxes to full lists while he types.

Fix:
1. In the fallback, keep each box at `BOX_MIN_ROWS` and hide Up next. Only the page scrolls,
   never full lists.
2. While `editingSetId !== null` and `pageScroll`, scroll the page so that the row's window
   position (box frame y + row y − box offset) plus its height clears the bottom.
3. Add a test of the fallback output at a keypad-open `available` for a two-member round.

## Should fix

**S1. Up next can oscillate and clip by the content gap.** `WorkoutTable.tsx:131` subtracts
only `x.upNext` from the content when Up next shows. The 8 pt container `gap` before it
(`:221`) stays in `fixed` while Up next is shown and disappears when it is hidden. Within that
8 pt window the fit flips between showing and hiding Up next on every recompute (a flicker). It
can also clip the bottom by 8 pt, because the page doesn't scroll. Fix: measure Up next as
`layout.height + gap`, or read its `layout.y + height` and subtract from there.

**S2. Browsing writes `set_active_set`, and rapid swipes bounce.** `goToRound`
(`WorkoutScreen.tsx:1079-1090`) selects the first set of every round Ben merely looks at. That
changes what the rest notification, Live Activity and spoken cues call "next". It also races:
the effect at `:473` clears `pickedRound` on every `activeSetId` change. A fast swipe 3→4→5
shows 5, jumps back to 4 when the first select lands, then goes to 5 again. `selecting` also
goes false while the second select is in flight. Fix (preferred): don't select on browse. On
Log in an off-round page, send `set_active_set` then `log_set` (or a single log with a set ID).
Otherwise, serialise selects with a sequence number and ignore stale completions.

**S3. The Workout sheet is missing Swap and Reorder** (§4: "Reorder/Swap/Add exercise stay
available from here as today-only edits (existing OverviewEditSheets)").
`RoundSheets.tsx:21-94` offers only row tap → round and `＋ Add exercise`. Swap is available
through `⋯`, but not from the sheet. Fix: add a per-row `⋯` (or a long-press) that opens the
existing `openCardMenu`. Leave Reorder for the drag slice and record that in the slice notes.

**S4. The `Back-off` set-type label probably truncates at default text size.**
`WorkoutTable.tsx:668`: 10 pt uppercase with 0.6 letter-spacing and `numberOfLines={1}`,
inside `NUM_W` 52 − 4 pt padding, roughly 57 pt needed for `BACK-OFF`. §6 says labels never
truncate. Fix: drop `textTransform`/letter-spacing (the prototype uses mixed case `Back-off`),
or widen `NUM_W` to 60. Check at 375 pt and at the largest non-AX size.

**S5. 44 pt targets.**
- Strip chips are `minWidth: 36` with only vertical hitSlop (`WorkoutTable.tsx:1271`), so a
  single-digit chip is about 36 pt wide.
- `PainBadge` (`:556`) is about 18 pt tall plus 8 pt hitSlop, about 34 pt.

Fix: chips `minWidth: 44` (or horizontal hitSlop 4 with the 6 pt gap kept). Pain badge
`minHeight: 28` + hitSlop 8.

**S6. The VoiceOver Untick action is offered on rows where it will always be refused.**
`TableSetRow` gives every done row an `Untick` custom action and a "Untick set N" ✓ label
(`WorkoutTable.tsx:712`, `:724`), but the domain only allows the latest log. Fix: pass `canUntick`
(latest completed set) from `rounds.ts`. Offer Untick only there. On other done rows, label the
✓ "Set 2 done" and rely on the cells' correct actions.

**S7. The SET clock counts pause time** (`WorkoutScreen.tsx:2265-2266`). After Pause 10 min →
Resume, the SET clock jumps by 10 minutes. Fix: when the session's pause log is later than the
clock start, subtract paused intervals (the elapsed clock already does this), or start from the
resume time.

## Nits

- N1. Strip VoiceOver for a superset reads "4 of 6 sets done" (member sets,
  `rounds.ts:291`). The spec's example is "2 of 3 sets done" (rounds). Pick one and match the
  spec (see Spec issues).
- N2. The dimmed superset member isn't announced. Add "up next" to the header label of the
  member that is up next (`WorkoutTable.tsx:443`).
- N3. `Why?` on a finished exercise anchors on its last done row (`rounds.ts:602`). The sheet's
  "Target" then shows logged values with no RPE. Use the last working set's planned target.
- N4. The refusal toast "Only the last set can be unticked" explains a rule. Something shorter
  fits the copy rule better, e.g. "Can't untick: not the last set".
- N5. `recompute` re-runs every second because `props.afterSet` is a new element each tick
  (`WorkoutTable.tsx:142`). It's cheap, but key it on the after-set's set ID instead.
- N6. The `Workout` sheet header says `Top set (kg)` while lb rows read `45 lb`. That's fine,
  but the header could follow the profile unit.
- N7. The "All planned sets done." heading from the old footer is gone. The Log pill falls back
  to the view's primary (Finish / Add exercise). That's acceptable; just confirm it is
  intended.

## Spec issues (for Ben / designer)

- SP1. §3 conflict: "swipe left on the round = next exercise" and "swipe left on a set row =
  Delete" share a gesture, and set rows fill most of the card. A swipe meant to go to the next
  round will often start on a row and delete a set, including a done set (§2: "On a done row =
  Delete with Undo"). Undo mitigates it, but on a done row this is a one-gesture change to
  logged history. Proposal: on done rows, swipe reveals a Delete button (tap to confirm), or
  round swipes only start on the header, strip or below the rows.
- SP2. §3 "Jumping to another round … Log logs the shown round's current set" doesn't say
  whether browsing changes the active set. That choice drives Live Activity and cue text (see
  S2). Please decide.
- SP3. §1.2's example "Round 3, superset, 2 of 3 sets done": state whether superset progress
  counts rounds or member sets.
- SP4. The branch copy of `workout-table-v3.md` §3 differs from main on what happens when the
  restored rest has already finished ("no rest shows" vs "SET clock keeps counting, no alert").
  That belongs to the untick-restores-rest branch, but the two copies need reconciling before
  merge.
- SP5. §2 "aim 3 rows" with the current set always the bottom visible row (up to 3 above) means
  the next pending set never shows below the current one until the last sets. This matches the
  prototype, but Ben may expect to see the next set too. Worth checking on device.
