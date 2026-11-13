# Review: quick wins (F3, F4, F5, F9, F11, F12, F15, F16, F17)

Branch `claude/quick-wins`, diff vs `claude/gracious-knuth-joxqpw` (12 commits, 35 files).
Reviewer: independent, 13 Oct 2026.

## Verdict: CHANGES NEEDED

One blocking issue. The F9 fix stops the truncation, but it does it by shrinking
the Focus view's numerals well below the design floor. Everything else works and
is small. The should-fix items are gaps against what the brief asked for.

## Checks run

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npx vitest run --maxWorkers=2`: 6362 passed, 3 failed, all timeouts
  (`import-progress.test.ts` x2, `catalogue/test/motion-r3.test.ts` x1) while a second
  vitest process was running beside it. Rerun alone, both files pass (31/31). None
  of the three files is touched by this diff, so these are load flakes, not regressions.

## Item-by-item

| Item | Fixed? | Notes |
|---|---|---|
| F9 reps ≥ 10 show "1" | Truncation fixed; **see B1** | Root cause confirmed: Focus and Edit set `NumberStepper`s had no fitted size (only the Table used `tileFit`). A 38 pt numeral in a ~34 pt field scrolls, so only one digit shows. There's no `maxLength` or parse cause (`parseNumber`, `nextFieldText` and `Math.round` are fine). |
| F5 keyboard | Mostly | Log calls `Keyboard.dismiss()`. Focus has a tap-outside `Pressable` and both lists use `interactive` dismiss. The Done bar was already there. See S3. |
| F12 coach errors | Yes | Each cause gets its own line, and the reason is shown behind `Why?`. Build turns get 6 steps; the loop cap is tested. |
| F3 set type | Yes | Focus `headerLine` and the Table open row both name the type, and the VoiceOver label includes it. This matches active-workout.md line 1362. |
| F4 RPE info | Partly | Present on Focus (post-log) and Edit set. **Missing in the Table**, the default view (S1). |
| F11 one row | Yes | `compact` tiles with −/+ under the numeral, each ≥ 44 pt, ≥ 28 pt numeral. Stacks at AX or when too narrow. WT-D13 spec note updated. |
| F15 adaptive bars | Mostly | One `WeekBars` chart for every period, no `0` over empty bars, 9-week switch. Label clamping misaligns day labels (S2). |
| F16 Muscles | Yes | Column widths are shared constants, the header is one line with shrink-to-fit, and the floating room is 76 pt. |
| F17 TIME | Yes | `45 min` + `1 of 3 timed`, honest VoiceOver words, footnote kept (rule 6). |

## Blocking

### B1. F9 fix shrinks Focus LOAD/REPS numerals to 14–24 pt on standard iPhones

`apps/mobile/src/ui/workout.tsx:252-263`, `apps/mobile/src/workout/tile-fit.ts:527-534` (`STEPPER_FLOOR = 14`).

Focus lays out LOAD (flex 1.4) and REPS (flex 1) side by side, each with two 44 pt
−/+ buttons. It doesn't pass `numeralSize`, so the new per-stepper fit applies.
`stepperTexts(..., 2)` always includes `'00'`, so even single-digit reps are sized
for two digits. Using the branch's own width model (20 pt screen padding, 12 pt
gap), these are the sizes that result:

| Screen width | REPS (any value) | LOAD `102.5 kg` | LOAD `20 kg` (step 22.5) |
|---|---|---|---|
| 375 pt | 19 pt | 14.5 pt | 19 pt |
| 390 pt | 24 pt | 17.5 pt | 23 pt |
| 430 pt | 37 pt | 25.5 pt | 33 pt |

The design says 38 pt (`type.loadDisplay`, D-ActiveSet), and WT-D13 sets the floor
at 28 pt, "below that … − / + move under the numeral … only if that doesn't fit do
they stack". On a 390 pt phone, Ben would see `102.5` in roughly body-text size on
the main logging screen, which hurts glanceability at arm's length (brief §12). The
F9 tests check only that the text fits. Nothing asserts a minimum size, so this
went unnoticed.

**Fix:** give Focus (and Edit set) the same fit as the Table open row. Build
`TileSpec`s for its tiles, call `tileFit({ rowWidth: measured, tiles, stepSize: 44, … })`,
and pass `numeralSize` and `compact` (and stacked → `flex={null}` with a column row).
The F11 compact layout then keeps numerals ≥ 28 pt on one row, and the 10+ reps case
is still never clipped. Keep `stepperNumeralSize` only as the fallback for lone
steppers (Overview sheets). Add a test that Focus at 375/390 pt yields
`numeralSize >= NUMERAL_MIN` with `102.5` + `12`.

## Should fix

### S1. F4: the RPE ⓘ is missing in the Table, the default view

`apps/mobile/src/screens/workout/WorkoutScreen.tsx:1823-1829`. In Table mode, the
after-set effort block uses a plain `SET 2 EFFORT` label and no `EffortHeading`.
Only Focus (`effortBlock`, :1358) and Edit set have the ⓘ. If Ben logs in the
default Table view, he never sees the scale while rating a set, which is the moment
he asked about.

**Fix:** wrap that label in `<EffortHeading scale={effortScale}>`.

### S2. F15: clamped label boxes push the 7/14-day edge labels off their bars

`apps/mobile/src/progress/components.tsx:237` with
`apps/mobile/src/progress/chart-layout.ts:94-99`. The box is a fixed 60 pt and is
clamped whenever `centreX < 30`, so the first and last labels are always clamped
once there are more than ~5 bars. On a 7-day chart at ~330 pt, the first bar's
centre is at ~24 pt (bar 10–38 pt). The `M` is drawn left-aligned at 0–12 pt, about
18 pt left of its bar and mostly outside it. The last label has the same problem on
the right. The test only checks the box maths, not text-over-bar. This is the
"labels misalign" complaint from F15 in a different form.

**Fix:** clamp by the label's own width (`barLabelRoom(kind)` or a measured width)
instead of 60 pt. For example, use `barLabelBox(centreX, width, barLabelRoom(kind))` with a
box that size. A 1–2 character day label then stays centred under its bar.

### S3. F5: Table tap-outside is implicit and untested; the tests are source-string checks

`apps/mobile/src/screens/workout/WorkoutTable.tsx:393`. The Table has no explicit
dismiss. It relies on `keyboardShouldPersistTaps: 'handled'` (a tap on a
non-touchable area closes the pad) plus drag dismiss. The open row's own taps are
`none` (`workout/table.ts:264`), so the empty space there should dismiss. A tap on a
pending row, though, is handled (`select`, a versioned `set_active_set`). Whether the
pad then closes depends on the focused input unmounting, and nothing checks that.
`workout-keyboard.test.ts` matches source text with regexes (including a comment and
exact whitespace), so it breaks on reformatting and doesn't prove the behaviour.

**Fix:** call `Keyboard.dismiss()` on a row `select`/`edit` tap, as Log does. Make the
test check the constant and the handler call rather than the JSX layout. Mark F5 for
a device check in the Table, not only Focus.

## Nits

- **N1.** `apps/mobile/src/coach/sheet-view.ts:333-341`: the `Why?` text includes raw
  codes (`(too_many_steps)`, `(no_reply)`). It's acceptable behind Why?, but `unavailable`
  also covers 503 and usage-unavailable, so "refused the request" overstates it.
  Use "The AI service was unavailable."
- **N2.** `packages/domain/src/progress/home.ts:313` vs `:303`: the TIME note
  `1 of 3 timed` and the footnote `Time from 1 of 3 sessions` say the same thing
  twice on one card. Under the minimal-copy rule, consider dropping the footnote when
  the note is shown, but keep the footnote for the excluded-over-4 h case.
- **N3.** `apps/mobile/src/progress/components.tsx`: removing `DayStrip` also removed
  the bold "today" cell. Consider tinting today's label in day bars.
- **N4.** `apps/mobile/src/screens/workout/WorkoutTable.tsx:940-944`: the extra
  `BACK-OFF`/`WORKING` label in the open-row header has no `flexShrink`. At 320 pt
  with `Last …` it may crowd. Check this on the narrowest device.
- **N5.** `apps/mobile/src/ui/workout.tsx:276`: before the first `onLayout`, the field
  renders with font scaling on, then switches to `allowFontScaling: false` at the
  fitted size. That's a one-frame size jump on mount.
- **N6.** The spec notes cover only F11 (WT-D13) and F15 (PG24b). F17 (PG25 TIME note)
  and F12 (coach-sheet §5 lines) would each benefit from a one-line note.

## Product rules

- Rule 1 / honest AI status: F12 improves it. Distinct failure lines, no canned coach text.
- Rule 2 / 5: no write paths changed. `MAX_BUILD_STEPS` doesn't change proposal,
  versioning or idempotency, and the cap is still enforced and tested.
- Rule 6: F17 is honest. Partial totals are labelled in both the UI and the VoiceOver words.
- No secrets, logging or storage changes.

## Spec issues

- WT-D13 governs the Table. Focus (D-ActiveSet) has no stated rule for what happens
  when two 38 pt tiles don't fit side by side. B1 shows the gap. Proposed: apply
  WT-D13 (shrink to 28 → compact → stack) to every LOAD/REPS row, Focus and Edit set
  included. Ben to approve.
