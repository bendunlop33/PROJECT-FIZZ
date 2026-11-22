# Review: Progress v3b (design fidelity), 21 Oct 2026

Branch `claude/progress-v3b-21oct` (`git diff 2108e61..HEAD`, 4 commits). Checked against
`docs/design/progress-goals.md` "Progress v3 (agreed)" (Structure, Space, Also agreed for Build B),
`docs/design/prototypes/progress-simple.html`, CLAUDE.md rules 1–10 and `docs/reviews/build-b-21oct.md` S1–S3.

## Verdict: **PASS** (no blocking issues; should-fixes S1–S4 before a real-device sign-off)

## Checks run by the reviewer

- `npm run typecheck`: clean.
- `npm run lint` (6 GB heap): clean.
- `npm run check:migrations`: `Migrations OK: 1 to 32, none reserved or empty.`
- Targeted vitest (6 changed test files): 94 passed.
- Full suite `npx vitest run --maxWorkers=2`: 8474 passed, 3 failed, 1 todo. The failures are timeouts in `fitnotes-import-r8.test.ts` (2) and `live-activity.test.ts` (1), files this branch doesn't touch. Both files pass when run alone (32/32), so these look like load flakes, not regressions.

## What matches

- Tabs: `Overview | Lifts | Training`, with Overview as the default. Today's `Reviews ›` lands on Overview. `All lifts ›` opens Lifts, `Open <name> ›` opens that lift's page, and `Details ›` opens Training. The section header reads `TRENDS · last 8 weeks`.
- Header: `THIS WEEK · 13–19 OCT` / `LAST 5 WEEKS` with a `Week | Month` switch. It uses tablist/tab roles and selected state, and each half is a 26 pt pill with hitSlop, giving a 44 pt target. The Month header shows `N weeks on plan`. The count line reads `3 of 4 · 2 cardio`, and "runs" is renamed to "cardio".
- Calendar: `This wk` row in bold and first, then 4 earlier weeks, M–S columns. Done sessions sit on the logged day with a letter; cardio shows as a dot; paused rows are outlined and empty with `Paused`; `n of m` is on the right; the key reads `Done · Missed · Planned · Cardio`. Each row is one VoiceOver sentence, and rows with a stored review open it. Missed and planned sessions are never given an invented weekday (rule 6).
- `weeksOnPlan` (`packages/domain/src/review/progress-page.ts:259`): only completed weeks count; paused weeks are skipped; a short week or a week with no plan ends the count; there's no "broken" copy. It is capped by the history loaded, so it can only understate.
- PBs: real top sets only, at tracked reps; estimates never count and never set the bar; assisted lifts count less assistance as better; same-machine rule; kg↔lb are compared in the display unit; the first-ever set is not a PB; ties are not PBs. The all-lifts view rings only the latest PB point; the focused view rings every PB; a ring tap shows `PB · Bench 100 × 6 · week of 13 Oct`. The table has the `PB` tag before Current and the key `Top set · ◎ PB · ○ est. · Edit`. Load suffix (`each`/`stack`/`assist`/`added`) and the kg/lb unit appear in the column header. The Summary's `New best · …` uses the same `bestSets`/`liftTermsOf` logic.
- S1, S2 and S3 from build-b-21oct are addressed and tested (see S2 and S3 below for gaps).
- No new native dependencies, no new copy beyond what the design specifies, no network on the Progress or Summary paths.

## Blocking

None.

## Should fix

**S1. The `Current` / `Target` cells can truncate the number itself.** `apps/mobile/src/reviews/charts.tsx:446-463`.
- Current shares a single `flex:1` column with the PB tag (about 27 pt including the gap), a 13 pt number and an 11 pt suffix, all with `numberOfLines={1}`.
- At 390 pt the column is about 74 pt. `PB 32.5 each` needs about 80 pt and renders as `32.5 ea…`.
- At 320 pt the column is about 56 pt. `PB 102.5 stack` renders as `10…`, which is a wrong-looking weight. Larger text makes it worse.
- The design asks for numbers that never wrap at 320 pt.
- Fix: drop the suffix from the cell and say it once per row (for example after the name, or under the `Reps` column), or let the suffix wrap below the number. Never ellipsize the number. Add a layout test at 320 pt for a per-dumbbell PB and a stack PB, and check on the device.

**S2. A failed lift-history read overstates PBs (rule 6).** `apps/mobile/src/reviews/weekly-review-service.ts:217-224`.
- `liftHistory` swallows a read error (`.catch(() => [])`), and PBs are then judged against the loaded ~22 weeks only.
- Scenario: a FitNotes import holds a 110 × 6 bench from 2024, and the history read fails. A 105 × 6 today then shows a PB ring and `New best · Bench 105 × 6` on the Summary. That is invented data.
- Fix: if any tracked lift's history can't be read, mark that lift's PBs unknown (no ring, tag or `New best`) instead of falling back to the window. Add a service test with a throwing `listExerciseHistory`.

**S3. `Held · pain` stays after the pain flag is cleared.** `packages/domain/src/review/progress-page.ts:1005`.
- `pain` is true for any `stale` proposal with `held: 'pain'`, whatever the current flags say. Once Ben resolves the flag, the row still reads `Held · pain` with no Apply or Redo, which is now untrue.
- Fix: show `Held · pain` only while `painFlagged.has(exerciseId)`. Once the flag is cleared, fall back to `Out of date`, or reopen the proposal and let Apply's version check (rule 5) decide. Add a domain test with `held: 'pain'` and an empty `painFlagged`.

**S4. `Reviewing…` can stick when the coach call throws instead of returning.** `apps/mobile/src/reviews/weekly-review-service.ts:475-480`.
- `asking` is reset in `.finally`, but the only `emit()` after the call is on the return paths.
- If `askCoach` throws (for example `weeklyContextText` or `checkWeeklyReview` on an unexpected answer, or an abort that rejects), `runOnOpen`'s `.catch` returns `failed` without emitting. The page keeps `Reviewing…` until something else reloads it.
- Fix: `emit()` inside the same `finally` (or in `runOnOpen`'s catch). Add a test where the model port rejects.

## Nits

**N1. Load cost of opening Progress.** `weekly-review-service.ts:694` reads the full history of up to 6 lifts on every `progress()` call. The build-b S2 fix (`Reviewing…`) adds 2–3 extra emits per app open, and each one reloads the page. With years of FitNotes history this repeats on every emit. Consider caching per data version, or reading only rows at or above the tracked reps. Time it on the iPhone (the developer flagged this too).

**N2. Summary for an older workout outside the loaded window.** `progress-page.ts:753`.
- `liftHistorySessions` gives one single-exercise entry per lift, all sharing the same `sessionId`. `findIndex` picks the first one only.
- A Summary opened for a workout older than about 22 weeks therefore lists at most one lift's `New best`.
- Fix: merge history entries by `sessionId` in `withEarlier`.

**N3. A ring tap blocks focusing a line.** `charts.tsx:528`. In the all-lifts view, a tap near the latest point of a PB lift shows the PB text and doesn't focus the lift. Tapping the newest point is the most natural way to focus a line. Consider: first tap focuses, a ring tap in focus shows the detail. Or keep it, but say so to Ben.

**N4. Inconsistent letters for a plan day done twice in a week.** `progress-page.ts:227-234`. The second session falls back to `planDayLetters([name])`, which gives `P` for `Push`, while the plan letter is `Ps`. Look it up by `routineId` instead.

**N5. The calendar's right column (`CAL.right` 46 pt) can clip `Paused`.** `charts.tsx:179`. At `maxFontSizeMultiplier` 1.3, `Paused` is about 51 pt. Two sessions on the same day (`PsPl`) can also clip in a roughly 23 pt cell at 320 pt. Check at the largest text size.

**N6. Two links named "All lifts" in one card.** The focused header's `All lifts` returns to the all-lifts chart; the unfocused footer's `All lifts ›` goes to the Lifts tab. The prototype has the same split, and the `›` and position tell them apart, but VoiceOver users hear "All lifts" for both. The footer's label (`All lifts. Opens the Lifts tab`) already helps; the header one could say "Show all lifts".

**N7. Flaky timeouts under full-suite load** (`fitnotes-import-r8`, `live-activity`). These are unrelated to this branch but make the "full suite passes" claim environment-dependent.

## Spec issues (for Ben, not code defects)

1. **Missed and planned sessions on a weekday.** The design and the prototype draw `mL` and `nL` on a specific day (Sat), but plan days carry no weekday. The build correctly lists them after the row with no day (rule 6), so the Month view will never look like the prototype. Either accept "listed after the row" in progress-goals.md, or add an optional scheduled weekday to plan days in a later slice.
2. **What counts as cardio** (run/ride/swim; `sport` and `other` excluded) isn't defined in the design. Ben to confirm.
3. **Training › `Totals | Calendar`** is a developer addition so the old Calendar tab stays reachable. The Structure section doesn't mention it. Approve it or remove it.
4. **`New best` next to the existing `Heaviest…` record lines on the Summary** can say overlapping things. The design should state whether `New best` replaces the tracked lifts' `Heaviest…` lines.
5. The design says the Lifts card key is `Top set · ○ est. · Edit` (Space) in one place and `Top set · ◎ PB · ○ est. · Edit` (Blocks) in another. The build follows the latter, which is the later agreement. Update the Space bullet.

## Not verified (needs the iPhone)

Calendar and switch at 320 pt and at the largest Dynamic Type, the Skia PB rings and their hit area, the tab bar at large text, VoiceOver order through Month rows, and Progress/Summary load time with the full FitNotes history.
