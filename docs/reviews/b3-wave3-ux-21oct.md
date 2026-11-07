# Review: B3 Wave 3, weekly auto-review and Progress › Reviews (UX lens), 21 Oct 2026

Branch `claude/b3-wave3-21oct` (`f8220ad..960ea35`). Spec: `docs/design/workout-builder-v3.md` §6, §6.1, §6.2 (including Ben's 21 Oct Goal bullet), and the prototype `docs/design/prototypes/progress-reviews.html`.

**Lens:** fidelity to the prototype and §6.2, chart accessibility, empty and short-history states, offline and `Not reviewed` states, and navigation from Today and Summary.

**Checks I ran:** `npm run typecheck` passes. The 8 targeted test files (domain weekly review, session feel, coach weekly, persistence review and feel migration, app service, app wiring, screens) pass with 51 tests. I did not re-run lint or the full suite.

## Verdict: CHANGES NEEDED

The structure is right and matches §6.2's 21 Oct Goal bullet:
- Consistency comes first.
- The training goal sets the order of what follows.
- Ben can choose any logged exercise, up to 6.
- A lift target is drawn as a level line, with no projection.
- Every chart has a Table toggle and a VoiceOver summary.
- A state is shown by a mark or shape, never by colour alone.

Four problems block it. Two of them show a dishonest or stale AI status (rule 1), and two put duplicated or unlabelled estimate values on screen (rule 6 and the minimal-copy convention).

## Blocking

**B1. A coach review whose verdict was hidden shows the headline "Not reviewed" above the coach's lines.**
- **Where:** `packages/domain/src/review/views.ts:228`, together with `packages/coach/src/builder/weekly.ts:122,149`.
- **What goes wrong:**
  1. `checkWeeklyReview` returns `verdict: null` when the verdict sentence has a wrong number, but keeps the lines that passed.
  2. `verdictOf` then returns `verdict: 'Not reviewed'` with `reviewed: true` and those lines.
- **Scenario:** the coach writes "Solid week, 5 of 4 sessions." plus two correct lines. Ben sees the headline **Not reviewed** in primary colour, followed by two coach lines. The status contradicts what is on the card (rule 1).
- **Fix:** when the coach answered but the verdict was hidden, show the first line that passed as the headline. If no line passed, use a neutral headline such as `Reviewed`. Never use `Not reviewed` when `status === 'reviewed'`. Add a test for "verdict hidden, lines kept".

**B2. When the review finishes, the screen is not refreshed, so `Not reviewed · Pending` stays up after the coach has answered.**
- **Where:** `apps/mobile/src/reviews/weekly-review-service.ts:417-424`, `apps/mobile/src/services/startup.ts:141`, `apps/mobile/src/shell/Root.tsx:80-83`.
- **What goes wrong:**
  1. `run()` first stores the review with `coach: { status: 'pending' }`, then waits for the model.
  2. `useScreenData` reloads only on focus, on `reload()`, or when the app's data version changes (`shell/context.tsx:103-117`).
  3. `runOnOpen` never bumps the data version.
- **Scenario:**
  1. Ben opens the app on Sunday evening and goes straight to Progress, or comes back to the app while Progress is the visible tab.
  2. The card shows `Not reviewed · Pending`, or no card at all on the first run.
  3. Ten seconds later the coach answers and the proposals are stored, but the screen keeps showing Pending until he leaves the tab and comes back.

  This is a stale AI status (rule 1), and Apply/Skip on the new proposals cannot be seen.
- **Fix:** have `runOnOpen` take an `onChanged` callback (or emit on the app's change bus), and call it after each stored write (the pending write and the coach write). Wire it to `changed()` in startup and `Root`. Add a service or app test that the callback fires on both writes.

**B3. The lift chart header repeats its label: `est. 1RM · kg · est. 1RM 97.5 kg`.**
- **Where:** `apps/mobile/src/reviews/charts.tsx:208`, with `packages/domain/src/review/views.ts:425,437`.
- **What goes wrong:** `chart.metric` is already `est. 1RM · kg`, and `chart.now` comes from `liftNowText`, which adds `est. 1RM 97.5 kg` again. A best-set chart reads `Best set · kg · Best set 100 kg × 5`.
- **Scenario:** this appears on every lift chart in the Goal view and in the full review. It breaks the minimal-copy convention, and it is the most visible line on the chart.
- **Fix:** show the metric label once, for example `est. 1RM · 97.5 kg` or `Best set · 100 kg × 5`. Either add a `nowValue` field to the view model without the label, or drop `metric` when `now` is shown. Add a view-model test that pins the exact header string.

**B4. The lift Table view and its VoiceOver rows give estimate values with no unit and no "est." label.**
- **Where:** `packages/domain/src/review/views.ts:445`, `apps/mobile/src/reviews/charts.tsx:40-55,216`.
- **What goes wrong:** the `value` cell is `formatNumber(p.value)`, and `TableRows` has no header row.
- **Scenario:** the Table view is the accessible alternative to the chart, so VoiceOver relies on it. Each row is read as one element, "13 Oct, 97.5, 100 kg × 5". Nothing says 97.5 is an estimated 1RM, or that it is in kg. Rule 6 requires an estimate to be labelled, and the table is where a VoiceOver user meets the number.
- **Fix:** either format the value cell with its unit, and with the estimate label when `metric === 'e1rm'` (`est. 97.5 kg`), or add a header row (`Date · est. 1RM (kg) · Set`) that is spoken with each row. The same applies to the Sets table (see S8).

## Should fix

**S1. The Latest card's 5 facts fill up with lift values, which push out the flags that matter.**
- **Where:** `packages/domain/src/review/views.ts:171-189,236`.
- **Scenario:** with 6 lifts chosen, `reviewFactLines` produces the sessions line, then the missed days, then 6 lift lines. `slice(0, 5)` drops "Legs: 7 sets ▼ 10–16", "Squat: no new best in 3 sessions", RPE and feel. Those are the facts the prototype's card leads with ("legs light ▲ 1 to look at"). The doc comment says "most telling first", but the order does not do that.
- **Fix:** order the lines as sessions, missed, out-of-range muscles, stalled lifts, RPE drift, feel, and only then lift values. Alternatively, include a lift only when it set a new best or has a target.

**S2. The Reviews block is very long and pushes the existing Progress content far down.**
- **Where:** `apps/mobile/src/screens/progress/ProgressScreen.tsx:120`, `apps/mobile/src/reviews/ReviewsSection.tsx:256-331`.
- **Scenario:** the screen stacks:
  - the Latest card, with up to 4 proposals;
  - Consistency;
  - up to about 10 sets-per-muscle rows;
  - **up to 6 full 150 pt Skia charts**, each with its header and progress line;
  - 4 history rows.

  That adds up to about 2,000 pt above the Activity, Exercises and Calendar segments on every Progress visit. The prototype instead uses a `Reviews | Lifts | Training` segment, one hero trend, and compact two-column lift tiles.
- **Fix:** match the prototype. Use one full chart for the first lift and compact tiles for the rest (name, now, was → now → target, sparkline), each opening the full chart. Alternatively, make Reviews a segment. The developer listed this as decision 3; Ben should choose.

**S3. A chosen lift with no sessions in the window disappears silently. A lift that has a target is not shown unless Ben chooses it.**
- **Where:** `packages/domain/src/review/weekly.ts:529-532`, `apps/mobile/src/reviews/weekly-review-service.ts:285-294`.
- **What goes wrong:** `liftSeries` returns null when there are no sessions in the 16-week window, and the lift is dropped without any message.
- **Scenario 1:** Ben ticks Overhead Press, which he last did 5 months ago. The sheet says "3 of 6", but the Goal view shows 2 charts and gives no reason.
- **Scenario 2:** Ben has a lift target on Deadlift, but Deadlift is not a plan main lift. The target line §6.2 asks for never appears unless he finds the Lifts shown sheet.
- **Fix:** give a chosen lift with no recent sets an empty row, for example `Overhead Press · No sets in 16 weeks`. Include lift-target exercises in the default list, after the main lifts and up to 6.

**S4. Dynamic Type cuts off muscle names and bar labels.**
- **Where:** `apps/mobile/src/reviews/charts.tsx:152` sets a fixed `width: 96` with `numberOfLines={1}`. `charts.tsx:109,117` set a bar column of about 45 pt with `numberOfLines={1}`.
- **Scenario:** at accessibility text sizes, "Hamstrings" and "Shoulders" truncate to "Hamstr…". A week label with runs, `13 · R2`, truncates, so the run count is lost visually.
- **Fix:**
  - Sets rows: when `fontScale` is large, stack the label above the bar, or let the label column grow (`minWidth` with `flexShrink: 0`) and the bar take the rest.
  - Week bars: move the runs to a second line under the date (`R2`), or show runs only in the summary and table at large sizes.

**S5. When Skia fails to load, the lift chart is a blank box with y-axis numbers.**
- **Where:** `apps/mobile/src/reviews/charts.tsx:227-249`.
- **What goes wrong:** `loadTrendCanvas()` failure is handled elsewhere: the existing `TrendChart` falls back to its table (`progress/load-charts.ts` doc, `trend-chart.tsx:87`). `LiftTrend` instead renders an empty 150 pt area and still draws the tick labels.
- **Fix:** when `!canvas.ok`, render `TableRows`, as `TrendChart` does. Better still, reuse `TrendChart`, which already has the target line, selection and table.

**S6. When the coach is offline, every past week's history title reads `Not reviewed · …`.**
- **Where:** `packages/domain/src/review/views.ts:261-267`.
- **Scenario:** Ben goes weeks without a coach connection, or does not connect the ChatGPT plan at first. The Past weeks list then becomes 4 to 26 identical titles reading "Not reviewed · Coach not connected", and the useful part is in the small detail line.
- **Fix:** make the title the week's facts (`w/c 6 Oct · 4 of 4`). Show the verdict, or a small `Not reviewed` tag, as secondary text.

**S7. A rejected `How did it feel?` tap does nothing visible.**
- **Where:** `apps/mobile/src/reviews/FeelRow.tsx:304-314`.
- **Scenario:** the Summary does another versioned write first (a rename, `Count it`, a next-time Undo), and FeelRow's `version` is now old. Ben taps **Hard**, the dispatch fails with `stale_version`, and nothing changes. Only a second tap works.
- **Smaller issue:** the row renders `null` while it loads, so the Summary layout jumps when it appears.
- **Fix:** on a `stale_version` failure, reload and retry once with the new version (it is Ben's explicit tap, so this is safe). Reserve the row's height while it loads.

**S8. The Sets table shows a raw status code.**
- **Where:** `apps/mobile/src/reviews/charts.tsx:147`.
- **What goes wrong:** the cell `r.status ?? ''` shows `in`, `below` or `above`. The view model already has the words (`STATUS_MARK[st].word`), so the table shows "in" where it should say "in range".
- **Fix:** add a `statusWord` field to `SetsRowView` and use it in the table.

**S9. The Today → Reviews link appears only when a pre-session nudge is showing, and does not land on Reviews.**
- **Where:** `apps/mobile/src/screens/TodayScreen.tsx:775-789`, `apps/mobile/src/screens/today/TodaySession.tsx:593-598`.
- **What goes wrong:**
  - The link sits inside `offerCard`, which §6.1 keeps silent unless there is a clear signal. A finished weekly review therefore usually has no entry point from Today. This follows the spec's wording; see Spec issue 1.
  - Navigating to `ProgressHome` does not scroll to the top. If Ben left Progress scrolled down, the link lands him in the Activity segment, not on Reviews.
- **Fix:** pass a `focus: 'reviews'` parameter (or a scroll-to-top) to `ProgressHome`. See Spec issue 1 for the missing entry point.

## Nits

- **N1.** `views.ts:163`: `was 90 → now 97.5 → target 110 kg` does not label `was` and `now` as estimates when the metric is est. 1RM. The header labels it once (after the B3 fix), which is probably enough. Consider `was est. 90`, since a stored `was.isEstimate` is available.
- **N2.** `ReviewsSection.tsx:115,120`: coach lines and facts use their text as React keys, so two identical lines give a duplicate key. Use the index.
- **N3.** `ReviewsSection.tsx:225-236`: Lifts shown sheet.
  - It lists only exercises logged in the last ~23 weeks (`SESSION_WEEKS`), not "any exercise he logs".
  - It has no search on a list that may run to 50+ rows.
  - At 6 lifts, unticked rows can still be tapped but silently do nothing. Disable them instead (`accessibilityState.disabled`).
  - The order is the order of ticking, and Ben cannot reorder.
- **N4.** `views.ts:264-265`: the history sparkline uses raw values, so for an assisted lift it rises as he needs more assistance (gets worse). Invert the values when `lowerIsBetter` is set.
- **N5.** `charts.tsx:239`: the dotted target line has no label on the chart (the prototype has `Target 110`). Add a small right-aligned `Target` tick label.
- **N6.** `views.ts:51`: `Not reviewed · Pending` reads oddly while the call is in flight. Use `Reviewing…`, and after an interrupted run `Not reviewed`.
- **N7.** `ReviewsSection.tsx:250`: a load error renders nothing at all. The rest of Progress uses `unreadableText`. Show the same one-line error.

## Tests

- The UI tests (`apps/mobile/test/reviews-screens.test.ts`) only search the source for strings. Nothing renders the header text (B3), the table cells (B4, S8), or the hidden-verdict card (B1). Add view-model tests for each of these.
- No test checks that a run on open notifies the UI (B2).
- No test covers a chosen lift with no sets in the window (S3).

## Spec issues

1. **§6.2: "Today only ever shows the one-line pre-session nudge, linking here."** The nudge is silent most days (§6.1), so in practice a weekly review never surfaces from Today. Ben should decide whether a fresh weekly review may add its own one-line link on Today (for example on Monday: `Week reviewed ›`), or whether Progress is the only way in.
2. **Prototype versus spec placement.** The prototype makes Reviews a segment, but §6.2 says "a Reviews section at the top" of Progress. Stacking the Goal view and its charts above the existing segments makes Progress very long (S2). The spec should choose.
3. **Lift targets versus Lifts shown.** §6.2 says lift targets are drawn "when set", but defaults Lifts shown to the plan's main lifts. A target on a lift that is not a main lift is then invisible by default (S3). The spec should state that target exercises are included.
4. **The sets-per-muscle range by goal** (muscle 6–20, strength 4–10, both 6–20) is not in the spec or an approved playbook rule. It is the developer's proposal for Ben to confirm.
