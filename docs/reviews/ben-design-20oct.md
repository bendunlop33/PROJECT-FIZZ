# Review: Ben's 20 Oct decisions, design slice (items 1–4)

Branch `claude/ben-design-20oct`, diff from merge-base `c62ef40` (with `claude/gracious-knuth-joxqpw`), commits `2e2bd26`..`f5d8670`.

## Verdict: PASS

There are no blocking issues. All four approved items are built as Ben agreed them, the matching design docs and source-check tests are updated, and `VISUAL-AUDIT.local.md` is not in the tree or the history. The S items below are worth a follow-up but do not hold the merge.

## Checks run by the reviewer

- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `vitest run --maxWorkers=2`: 399 files, 7665 passed, 1 todo, 0 failed.
- No schema or persistence change, so no migration is needed. This slice has no writes, proposals or Undo paths.
- I could not re-read `VISUAL-AUDIT.local.md`, because it was already deleted (correctly) when this review started. I checked conformance against the decision text and the updated docs instead.

## Rule check

- **Rule 1 (offline/AI):** not touched.
- **Rule 2/5 (completed sets, versioning):** not touched. The slim strip has no actions, and the rest deadline logic is unchanged (it is the same `rest` view, re-rendered each second).
- **Rule 6 (honesty):** the measure dropdown shows the label it is given (`Est. 1RM`), so the estimate is still labelled. Nothing is invented.
- **Minimal copy:** no explanatory lines were added. The strip reads `Rest 1:47` / `Ready · rested 3:12`, and the dropdowns read `Est. 1RM ▾` `6 mo ▾`.
- **Secrets/privacy:** nothing new is logged or stored.

## Blocking

None.

## Should fix (non-blocking)

**S1. Two design docs still give the old 12pt / 1.4 label.**
- `docs/design/workout-overview.md:67` says "`type.sectionLabel`, 12/600, tracked 1.4".
- `docs/design/progress.md:753` says "except Direction D's 12pt tracked section labels".
- Failure: the next designer or developer works from these and reintroduces 12pt or 1.4 tracking.
- Fix: change both to 13/18, tracking 1.2. Also reword `workout-overview.md:226` ("the 12 pt `sectionLabel` vs the 16 pt floor").

**S2. `design-system.md:247` says the label is "one theme token, not per-screen overrides", but the code still overrides it.**
- `apps/mobile/src/screens/library/YourPlanBlock.tsx:323` renders the `NEXT` tag as `sectionLabel` at `fontSize: 11`, so it stays below the new 13pt and now looks even smaller next to the other labels.
- `TodayScreen.tsx:628` and `WorkoutScreen.tsx:2425` set `fontSize: 13`, which is now a redundant copy of the token.
- `YourPlanBlock.tsx:353` sets the next-day dot numeral to 12pt.
- Failure: Ben asked for small labels to grow "across the app", and the `NEXT` tag on Your plan does not grow.
- Fix: either drop the 11pt and 13pt overrides now (the 13pt ones are no-ops), or soften the doc sentence and list these under the already-noted `type.listLoad` / `type.statValue` cleanup.

**S3. The Exercise detail measure list can be left open with no button to close it.**
- Location: `apps/mobile/src/screens/progress/ExerciseDetailScreen.tsx:227`. `DropdownPanel` for `metric` renders whenever `controlOpen === 'metric'`, but its `DropdownButton` (line 205ff) only renders when `view.metrics.length > 1`.
- Failure: Ben opens `Est. 1RM ▾`, then uses the series menu below to pick a bodyweight or assisted series that has only one measure. The button disappears, but the open list stays, showing a single option. The only way to close it is to tap that option.
- Fix: render the panel only when `controlOpen === 'metric' && view.metrics.length > 1`, or reset `controlOpen` when the series changes. Add a source-check for it.

## Nits

**N1. The slim strip has no visible "paused" word.**
- Location: `apps/mobile/src/screens/workout/WorkoutTable.tsx:1363`. The full bar shows `REST · PAUSED`, while the slim strip shows only the pause icon and `Rest 1:47` in tertiary colour. VoiceOver does get "paused".
- Fix: optionally use `Paused 1:47` as the text in the paused state. This is honest and still one short line.

**N2. The slim strip appears for any keyboard, not only the weight keypad.**
- `keypadOpen` follows `keyboardWillShow` (`WorkoutScreen.tsx:278`), so a notes field also gets the slim strip. That matches the workout-table.md "Keypad open" wording, and it is probably what Ben wants. Noting it so it is a deliberate choice.

**N3. The Library filter row hides its scroll indicator.**
- Location: `LibraryScreen.tsx:111`. Bleeding the row to the screen edge gives a partly cut chip as the affordance, but the earlier review S8 asked chip rows to show and flash the indicator.
- Fix: check on the phone at 375pt whether `Movement ▾` reads as more to scroll. If it does not, add `showsHorizontalScrollIndicator` + `flashScrollIndicators()` as the old `ChipScroll` did.

**N4. The tests only check source, not behaviour.**
- Examples are the regexes in `workout-inline-entry.test.ts` and `progress-design-pass.test.ts`. That matches the repo's pattern for screens, but nothing covers S3 or "full bar returns when the keypad closes" (that check is only `slim={keypadOpen}`).
- Fix: acceptable as is. Add a source-check with the S3 fix.

**N5. The `exercise-library.md:721` sketch annotation ends with "52pt".**
- It is the chip height (`target.workout`), but next to "scrolls sideways" it reads like a row measurement. Suggested wording: "chips 52pt".

## Spec issues

- **EL-B16 (`exercise-library.md:980`)** requires "AX3 at 375pt with no sideways scroll", and **progress.md §2.7 Dynamic Type (line 753)** says "Nothing scrolls horizontally at AX3". The approved one-row Library filter chips now scroll sideways by design. One fix is to amend EL-B16 to "no page-level sideways scroll; the filter chip row may scroll". The other is to have the chip row wrap at AX1+. Ben or the designer should pick one.
- **progress.md regions 5 and 7 still list `Volume`.** This is deferred to the item 9 branch, as the developer noted. Make sure that branch updates the same lines so the merged doc is consistent.

## Still to check on the phone (not verified here)

- The rest strip keeps counting down with the keypad open, and the full bar returns on close. The layout of the table above it does not jump.
- The 13pt `SESSIONS` / `PER WEEK` headers fit at 375pt. The estimate is 80.3 / 75.1pt against 84 / 80pt columns, which is tight, and `adjustsFontSizeToFit` is the fallback.
- The exercise chart starts higher. My estimate is about 55–60pt when there are several series and about 100pt when there is one, not a flat 80pt.
