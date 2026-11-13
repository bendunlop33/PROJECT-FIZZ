# Review: Progress v3 (Progress › Reviews rework), branch `claude/b3-wave3-21oct`

Reviewer, 21 Oct 2026. Scope: commits `9649372..9f72c3d` after the merges `3a68a67` and `6047f0e`. Lens: how closely the build matches `progress-goals.md` "Progress v3 (agreed)" and `prototypes/progress-simple.html` (order, copy, layout, sizes, colours, collapsed states, taps, accessibility, nothing left over from the old design), plus the CLAUDE.md product rules.

**Verdict: CHANGES NEEDED**

## Validation (run by the reviewer)

- `npm run typecheck`: pass.
- Targeted vitest (`progress-page`, `lifts-layout`, `weekly-review-service`, `weekly-review-app`, `reviews-screens`): 5 files, 51 tests passed.
- `weekly-review` in domain and coach, plus `guide-isolation`: 3 files, 52 tests passed.
- Lint, the migration check and the full suite were not re-run here; the developer reports them green.

## What matches

- **Page order.** The page is the same for every goal: This week → `PROGRESS · last 8 weeks` (Lifts, Muscles) → Coach's changes at the bottom. The Latest card, goal-ordered sections, the 6-week bars, sets-per-muscle bars and per-lift tiles are all gone, and a source test pins this.
- **This week.**
  - `Sessions 3 of 4 · 2 runs` uses the 15/20 pt sizes.
  - Chips are 12/11 pt, `Mon – 100%` sits on one line with no-break spaces, and there's no tick.
  - Chip states: done is soft green with a green edge, missed is a faint fill with no border, upcoming has a 1.5 pt outline.
  - `Last 4 weeks ▾` / `Hide past weeks ▴` toggle the grid. Its squares are 34×14 with a 4 pt radius (done 0.45 green, missed 0.10, paused dashed), with `n of m` on the right. Tapping a row opens that week's review.
- **Lifts.**
  - The header reads `Lifts` + `Top set · ○ est. · Edit` on one line; when focused it shows `All lifts`.
  - Focused subtitle: `Bench · Top set × 6 (target reps) · 100 now · about mid-Nov at this rate est.` The `On track` pill matches.
  - Chart geometry matches the prototype: L30/T14/B22, gutter 34 or 12, steps of 10 or 5, point radii 4.5/3.4/2.8, gutter bar plus faint guide, dashed target, and a dotted ETA line two columns on.
  - The colours are `#3987e5`, `#d95926`, `#199e70`.
  - The table has four equal columns, numbers right-aligned, and a hollow-dot `Accessories` sub-header.
  - Tracked reps follow target → plan → picked → logged. Estimates come from 3–12-rep sets using Epley, and the `now × n` marker is there.
- **Muscles.**
  - The header reads `Muscles` + `At plan · Under · ┄ Plan` on one line.
  - Columns are `MUSCLE · SETS VS PLAN · LAST WEEK` (1fr / 120 / 1fr), with 120×26 bars: full or 0.45 alpha, a grey stub for paused weeks, and a dotted plan line.
  - Every working set counts whatever its RPE. The VoiceOver text matches the spec (`Legs: 9 sets last week, plan 14. At plan in 4 of 7 weeks.`).
- **Coach's changes.**
  - Each row shows `Row ~~3 sets~~ → 4 sets` and `next Pull · reason`, with Undo, or `kept …` with Redo once undone.
  - `NEW` shows in the section label until Got it, then the section collapses to `3 changes for next week ›` (52 pt). `Past weeks ›` and `Got it` share the footer row.
  - Offline shows `Not reviewed · Offline`.
  - Auto-apply uses one deterministic op per proposal. Stale and pain-flag refusals are covered by tests.
- **Accessibility.**
  - Every visual has a summary label, and the lift table doubles as the chart's table view.
  - Tap targets are at least 44 pt, including the 34 pt lift rows and 28 pt links.
  - At large text sizes, chips go two to a row and muscle rows wrap.
  - No new native dependencies; the Skia canvas loads lazily behind the guarded loader.

## Blocking

### B1. A small change that isn't applied yet is shown as already made

**Where:** `packages/domain/src/review/progress-page.ts:672-694` (an `open` small row has `statusText: null` and `canUndo: false`), `apps/mobile/src/reviews/charts.tsx:555-584`, `ReviewsSection.tsx:134-150`, `screens/progress/ReviewDetailScreen.tsx:80-92`.

`ChangeRow` draws an `open` small change exactly like an applied one: `Row ~~3 sets~~ → 4 sets · next Pull · reason`. It has no Undo and no status word. Three real cases reach this state with the template unchanged:

1. **During the coach call.** `run()` stores the review and `emit()`s it (`weekly-review-service.ts:433`), then awaits `askCoach` (`:435`). Auto-apply only runs after that (`:592`, `autoApply` `:574`). For the whole coach call the page reads "Coach's changes … Row 3 → 4 sets", but nothing has been written. A force-close during the call leaves it like that until the next open.
2. **When auto-apply fails.** If `painFlags.listActive` or `applyRoutineChange` throws, `applyOne` returns `failed` and the proposal stays `open`. The page then shows a made change, indefinitely.
3. **On past weeks.** Auto-apply only touches the newest review. That leaves two groups stuck: open proposals stored before this rework, and those on a review that a new week superseded before an open could apply them. Neither is ever applied. Past weeks › a week lists them as made changes with no action.

This breaks rule 6 (no invented data) and the honesty part of rules 1 and 2: Ben is told his plan changed when it didn't.

**Fix:**
- Give `open` small rows their own presentation, or hide them until applied. For example, add `statusText: 'Not applied'` and offer `Apply` for past weeks.
- Or run the auto-apply before `emit()`/`askCoach`, so code's changes land before the page can show them.
- In past weeks, show a never-applied small change as `Not applied`, not as made.
- Add a view-model test for an `open` non-structural row and a service test for "progress() while the coach call is pending".

### B2. Redo isn't restart-safe and can leave a change in place with no Undo

**Where:** `apps/mobile/src/reviews/weekly-review-service.ts:763-780`, with `redoOp` at `:770`; `ReviewsSection.tsx:42`, which makes a fresh UUID per tap.

`redoOp` comes from the per-tap `opId`. Suppose a force-close lands after `writeChange` commits but before `changeProposal` marks the proposal:
- The template now has `toSets`, but the proposal is still `undone`.
- The next Redo tap has a new op, so the `prior` lookup misses. `templateWorkingSets === fromSets` is false, so it returns `changed_since`.
- `canUndo` needs `applied`, so no Undo is offered.

The row says "kept 3 sets / Undone", the plan has 4 sets, and Progress can't take it back. Apply and Undo already handle this case (`applyOne` uses a deterministic op; Undo maps `already_undone`); Redo is the one path that doesn't. This conflicts with rule 5 and the force-close requirement.

**Fix:**
- Derive the redo op from the proposal state, for example `review-redo:${deriveId(`${reviewId}|${proposalId}|${p.actionId}`)}` (the undone apply's action ID changes each cycle), and look it up before writing.
- Alternatively, when `templateWorkingSets === toSets` and the newest `update_routine` action for that routine is a redo of this proposal, mark it `applied` with that action ID.
- Add a crash-between-write-and-mark test for Redo.

### B3. A change can be applied automatically with no reason

**Where:** `apps/mobile/src/reviews/weekly-review-service.ts:574-580`; `packages/coach/src/builder/weekly.ts:155` (`reason: check(t.reason) ?? null`).

When the claim check hides the coach's reason (a wrong number in it), the proposal is stored with `reason: null`, and `autoApply` still applies it. The row then shows `next Legs` with no why. Rule 3 says each automatic change is "recorded with its reason", and the agreed design says "each with reason and Undo". The service test fixture itself seeds a coach proposal with `reason: null` as auto-applicable (`apps/mobile/test/weekly-review-service.test.ts:333`).

**Fix:** only auto-apply small changes whose `reason !== null`. Keep reason-less ones as an ask (Apply / Keep as is), or drop them. Add a test.

## Should fix

### S1. The same-machine rule isn't applied on the Lifts chart

**Where:** `packages/domain/src/review/progress-page.ts:413-436`.

The agreed text says "Same-machine rule for stacks/plate-loaded kept". `liftsView` merges every set with the same `convention` into one line, across machines and gyms. Example: a Lat pulldown on a 5 kg-step stack at Gym A and a 7 kg-step stack at Gym B become one line. They can produce a false "up 10 kg", or an `On track` / `about mid-Nov` built on non-comparable loads.

**Fix:** carry `equipmentId` into `ReviewExercise`/`ReviewSet` (the progress projection already has it). For `stack` and plate-loaded `added`, compare only sets on the newest equipment, as the `SeriesKey` does.

### S2. The Summary the chip opens doesn't show the planned-reps detail

The spec says a tap opens "that workout's Summary with `156 of 170 planned reps` and what was short… the Summary detail always names what was short or skipped" (needed because extras can push the % past 100 and hide a skipped set). Nothing renders this: `planned reps` appears nowhere in the Summary code. As built, `Wed – 92%` leads to a Summary that never explains the 92.

**Fix:** add the line to the Summary, or get Ben to explicitly defer it and record that.

### S3. A main lift with no sets in 8 weeks is listed under "Accessories"; without mains, non-main lifts are drawn

**Where:** `packages/domain/src/review/progress-page.ts:494-500`.

`drawn` requires `points.length > 0`, so the plan's Squat, if not done for 8 weeks, is filed under `Accessories`. With no plan mains, the first three chosen lifts are drawn, although the spec says accessories are listed and not drawn.

**Fix:**
- Decide `accessory` by membership in `mains`, and keep a main lift with no points in the main section (`–` current, no line).
- With no mains, draw nothing, or ask Ben.

### S4. Muscles re-judges past weeks with today's templates

**Where:** `packages/domain/src/review/progress-page.ts:575-588`.

The plan line for all 8 weeks is the current plan's templates as they are now. An auto-applied `+1 set` (this very feature) or any template edit moves the plan line for every past week under that plan, so earlier weeks flip from At plan to Under. It also assumes every plan day happens once a week, whatever the days-a-week aim.

**Fix:** for past weeks, use the planned sets stored for that week. Either use the `group_sets.planned` fact on that week's stored review, or the `plannedWorking` snapshot on that week's sessions. Use live templates only for weeks with no record.

### S5. Got it can fail silently

**Where:** `apps/mobile/src/reviews/ReviewsSection.tsx:92-100`; `weekly-review-service.ts:660-680`.

If auto-apply or the coach's part bumps the review version after the page loaded, `markSeen` returns `false`. The tap collapses and then reloads back to `NEW` with no feedback. That's the common first-open sequence: the page renders, then auto-apply finishes.

**Fix:** on `false`, reload and, if the only change since is proposal statuses (no new coach text or proposals), retry once at the fresh version.

### S6. The "Got it or acted on all" collapse rule is missing

The spec collapses the section "once Ben taps `Got it` (or Undo/Apply on all of them)". Only Got it is wired; this is developer decision 7.

**Fix:** implement it, or have Ben confirm the deviation.

### S7. Test gaps

- `reviewSessionOf`'s `plannedReps`/`doneReps` (which drive `Mon – 100%`) are only ever `null`/`0` in fixtures. Nothing tests:
  - warm-ups excluded;
  - other-side companions not counted twice;
  - `addedInWorkout` sets counting toward done but not planned;
  - sets skipped mid-workout counting 0;
  - sets removed before Start excluded.
- Auto-apply has no test of a crash between write and mark. Only the manual Apply path is covered (`weekly-review-service.test.ts:290`), although `autoApply` reuses it.
- There are no tests for B1 to B3.

## Nits

- **N1.** `progress-page.ts:435`, `charts.tsx:406`: tapping an estimated point shows `est. 92.5 × 6 from 100 × 4` without the lift and week. The prototype's text is `Bench, week of 1 Sep: est. …`. Add `name` and `week of …` to `detail`.
- **N2.** `charts.tsx:541-543`: Muscles `9 of 14` uses one style. The prototype draws ` of 14` smaller (12 pt, weight 500, `text.secondary`).
- **N3.** `ReviewsSection.tsx:333`: `LiftsCard` renders with only the table header when `d.lifts.empty`. Show just the Edit affordance, or one short `No lifts yet` line.
- **N4.** `progress-page.ts:349-371`: "rising" accepts flat steps (95, 95, 95, 97.5), and `On track` disappears once the latest real top set reaches the target. Consider requiring a strict rise in at least 3 of the 4 steps, and showing nothing or a hit state at the target.
- **N5.** A stale small row reads `Row 3 sets → 4 sets · … · Out of date`. Strike the after-value, as for Undone, so it doesn't read as made.
- **N6.** `screens/progress/ProgressScreen.tsx:128`: the comment still says "the latest weekly review, the Goal view, past weeks".
- **N7.** `REVIEW_COPY` (`views.ts:18-51`) still carries old-design strings (`latest`, `goal`, `consistency`, `sets`, `legendRange`, `goalNotSet`, …). Remove any that are now unused.
- **N8.** `palette.ts:35`: light mode reuses the data colour as `text.primary` and the dark-mode line slots. Flag it for the design-system token pass, as the developer did.

## Spec issues (for the PM / Ben, not the developer)

- **SP1. The agreed design changed during the build.**
  - `PROJECT-FIZZ` commits `570d950`, `a14fbcb`, `62406ff`, `7201bac` and `0f8f572` landed 13:59–14:19 on 21 Oct, after this branch's last merge (`6047f0e`, 13:37). The current "Progress v3 (agreed)" text and prototype now specify:
    - a **Week | Month** switch with a Mon–Sun calendar (`This wk` row, session letters, `Cardio` dots, key `Done · Missed · Planned · Cardio`), replacing `Last 4 weeks ▾`;
    - `· 2 cardio` instead of `· 2 runs`;
    - **PB rings** and a `PB` tag, with the header key `Top set · ◎ PB · ○ est. · Edit`;
    - Progress tabs **Overview | Lifts | Training**, with `All lifts ›`, `Open Bench ›`, `Details ›` and `TRENDS · last 8 weeks`;
    - Month-view `5 weeks on plan`, and a PB moment on the Summary.
  - The branch matches the version in the task, not the current file. Before this ships, the next task should merge `claude/gracious-knuth-joxqpw` again and rework This week, the Lifts header, the section label and the tabs.
- **SP2. Template set changes vs CLAUDE.md rule 3.** Rule 3 lists "templates" under structural or broader future changes that are always proposals. It treats only *next-session targets* as small, automatic and undoable. The agreed design auto-applies `template_sets`, a permanent edit to the plan-day template for all future sessions. This needs Ben's explicit ruling, recorded in the brief CHANGELOG or CLAUDE.md, rather than the code silently taking one side. (CLAUDE.md: "Where CLAUDE.md and the brief disagree, flag it".)
- **SP3. No structural proposals exist.** `ReviewProposal.change` only has `template_sets`, so the agreed structural ask (`Move Legs to Sat` / `Keep as is`) can't occur. `AskRow` is effectively dead code. Day-move, swap and add/remove proposals need a schema and an engine first.
- **SP4. Undated plan days.**
  - `Thu – missed` and `Sat – moved` (spec and prototype) can't be shown truthfully, because rotation days have no weekday (D19).
  - On the live This week card, `missed` never appears at all, because the current week is never complete.
  - The spec should say what an undone plan day shows mid-week (`to do`).
- **SP5. Load convention is invisible in the Lifts table and chart.** CLAUDE.md requires the convention to be explicit. The prototype's bare numbers would put per-dumbbell, stack and barbell-total loads on one kg axis and in one `Current` column with no marker, and only VoiceOver says `kg each`. Ben should decide on a compact marker (e.g. `30 ea`), or separate axes.
- **SP6. Three smaller spec conflicts.**
  - **Muscle counting:** the prototype's comment says helpers count ½; the agreed text says "the builder's counting convention", which is first-primary-muscle full credit. The code follows the text.
  - **Muscles window:** it ends last week, while Lifts includes the current week.
  - **Estimate rep range:** estimates use 3–12 reps, while the existing e1RM check accepts at most 10.
