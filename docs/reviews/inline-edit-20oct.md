# Review: inline cell entry (Ben, 20 Oct)

Branch `claude/inline-edit-20oct` (cf0eae8..3f29ea9, 5 commits). Reviewed against Ben's request ("it should just use the original input and change there, no need to have a second line"), CLAUDE.md and `docs/design/workout-table.md`.

## Verdict: PASS

There are no blocking issues. The second `− value + Done` line is gone for KG, REPS, TIME and DIST on both the open row and done-row corrections. The tapped cell is now the field: the value is selected for overwrite, the keypad is decimal for load and number for reps, and the border is a 2 pt accent. The −/+ steps come from the domain's achievable-load `StepTarget`s (`buildActiveSetView` / `buildSetEditView`), so the snap and clamp rules are unchanged. Log keeps tracking the draft. Done-row edits stay a draft until Done or a tap elsewhere, then save one versioned `correctSet` with Undo. Before merging, fix the should-fix items below and check the result on a device.

## Checks run

- `npm run typecheck`: clean
- `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: clean
- Targeted vitest (inline-cell, inline-entry, keyboard, table): 102 passed
- Full suite (`--maxWorkers=2`): 417 files, 7942 passed, 1 todo
- `grep variant="inline" | InlineEditor`: only cardio's two-value pair still uses the under-row editor (disclosed)

## Blocking

None.

## Should fix

**S1. The VoiceOver increase/decrease actions on the cell never fire.** `apps/mobile/src/ui/workout.tsx:368-380`
The cell variant adds `accessibilityActions` `increment` / `decrement` to the `TextInput`. Two things stop them working. First, in RN 0.86 Fabric, `RCTTextInputComponentView` returns the backing `UITextField` as its `accessibilityElement` (`RCTTextInputComponentView.mm:178`), so the RN view's `accessibilityIncrement` is never reached. Second, the element never gets `UIAccessibilityTraitAdjustable`, because there is no `accessibilityRole="adjustable"`. VoiceOver only offers swipe up/down on adjustable elements.
Failure scenario: a VoiceOver user on "Set 3 weight, 7.5 kg each" swipes up and nothing happens. The developer summary and the test at `workout-inline-cell.test.ts` ("with increment / decrement actions") both claim this works, but the test only checks the source string.
Fix: remove the dead actions and rely on the labelled keypad-bar −/+ (they already read "Increase weight to 10 kg each"), or prove the actions work on device. Either way, update the test so it doesn't assert something that can't happen.

**S2. The home-indicator inset is doubled when the bar shows without the keypad.** `apps/mobile/src/ui/workout.tsx:137` and `apps/mobile/src/screens/workout/WorkoutScreen.tsx:2656`
`ActionBar` gets `keypadOpen={keypadOpen}`, so with the keypad down it adds the bottom inset under Log (`bottomBarPadding`). `CellKeypadBarView` then adds `insets.bottom` again. If a cell is being edited while the keyboard is down (a hardware keyboard, a VoiceOver focus change, or iOS hiding the keypad), you get a gap of about 34 pt between Log and the −/+ bar, plus the inset again under the bar.
Fix: pass `keypadOpen || cellBar !== null` to `ActionBar` so only the lowest element owns the inset. Alternatively, render the bar only while `keypadOpen`.

## Nits

**N1. Done-row VoiceOver labels a superset member by set number, not tag.** `WorkoutScreen.tsx:2269`
The done-row label uses `setLabel={String(correctionView.setNumber)}`, so a done A2 row reads "Set 2 weight". The open row uses `memberTag ?? setNumber` (`WorkoutTable.tsx:994`). Use the row's member tag here too.

**N2. At AX sizes a done-row correction field still draws under the row.** `WorkoutTable.tsx:373`
The rows become blocks at AX sizes, so the field (now without −/+) goes on its own line under the row. This is disclosed and reasonable, but it is still a "second line" at large text sizes. Check it with Ben on device.

**N3. Cardio's `TIME · DIST` pair still uses the old under-row editor with its own Done.** This includes the distance editor shown while the timer runs. It's justified because the cell holds two values, and the change is disclosed in the CHANGELOG and spec. Ben hasn't confirmed this exception.

**N4. Most tests check source code, not behaviour.** `workout-inline-cell.test.ts`, plus the six updated assertions, mostly match exact source strings, for example `'</InlineEditor> </View> ) : null} {plates}'`. They will break on reformatting, and they don't prove behaviour such as "no second editor rendered". The pure-logic tests are good: real dumbbell rack, lb, assisted, rack-max reason, Log label, draft-only correction, stale version refused. Add a renderer (`@testing-library/react-native`) in a later slice so "tap KG → one TextInput, no InlineEditor" can be asserted for real.

**N5. The `+` limit text on the bar ("Rack maximum 30 kg each") is fine under the minimal-copy rule.** It states a value and keeps the rule-4 reason visible. No change needed.

## Rule checks

- **Rule 2 (completed sets).** A done row's bar steps and typing call `editCorrection` → `mergeCorrection` (draft only). `closeCellEditors` saves through `correctSet` with `expectedSetVersion` and an `opId`. An unchanged value sends nothing (`correctionPatch` returns null). A stale version is rejected, and this is tested. OK.
- **Rule 4 (achievable loads).** Bar steps are the domain `StepTarget`s, nothing is computed in the UI, and `+` is disabled at the max. OK.
- **Rule 5 (idempotent writes).** The existing correction path is unchanged. OK.
- **Offline / AI.** Not affected.
- **Secrets / privacy.** No new logging or storage. `BEN-INLINE.local.png` is not committed. OK.
- **Durability.** The open-row draft still goes through `setValues` (saved draft). Done-row correction drafts stay in memory as before, so a force-close mid-correction loses an unsaved correction, which is the same as before this change.

## Device checks (before calling it done)

1. The bar's position under Log while the keypad is up, and how much of the list stays visible on the smallest supported iPhone (slim rest strip + Log + bar + keypad).
2. `Next ›` from KG to REPS keeps the keypad up. The old field unmounts as the new one autofocuses, which matches the old swap but hasn't been checked on device.
3. The edited cell scrolls above the keypad (`send()` now uses offset 0 for in-place cells).

## Spec issues

- **The request asked for an iOS keyboard accessory bar, but `InputAccessoryView` can't attach to in-cell fields.** I confirmed this in `RCTInputAccessoryComponentView.mm:66-75`: it looks the field up by `nativeID` once, in `didMoveToWindow`, so fields mounted later never get the accessory. The developer used a normal bar in the bottom chrome instead. That is a reasonable change, but it departs from the request, and the CHANGELOG records it as if Ben had approved it. Ben should confirm the change.
- **The same mechanism probably means the shared `NumberAccessory` (`WorkoutScreen.tsx:2453`) never shows for any number field mounted after the workout screen.** That covers Focus mode, Edit set, and the cardio pair. Ben's screenshot shows no keypad bar, which fits. On the decimal pad, those fields may have no Done or Next at all. This is outside this slice's scope, so it should be a separate item.
