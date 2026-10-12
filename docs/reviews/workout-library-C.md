# Review: Workouts library, slice C (fit to time)

Branch `claude/workout-library` at `06135f0` vs `claude/gracious-knuth-joxqpw`. Slice C is commits `c8542bc`..`06135f0`, after slice B's last review commit `70cfa8e`.
Spec: `docs/design/fit-to-time.md` (FT1–FT10, FT-C1–FT-C18), mockup `docs/design/mockups/workout-library.html` frames 3 and 4, ADR 0022, CLAUDE.md rules 1–10, minimal copy.
Reviewer: independent reviewer, 12 Oct 2026.

## Verdict: **CHANGES NEEDED**

The built-in trim is good work. `fitPlanToMinutes` is pure. It only marks pending sets `skipped`, and it follows the §4.3 passes: tiers C then B are trimmed round-robin, whole units are skipped, then tier A goes down to 2 sets. Ben-edited and pain-held slots are locked, and top sets and warm-ups are kept. A property test covers FT-C3.

The fit is stored as intent and re-planned by the one `planWithTodayEdits` path on every read. Overview, Up next and both Start paths go through `todayFor` → `fitContext`, so they share one pace and one pain-flag check, and preview equals Start for a built-in fit. The coach fit is validated deterministically, written as coach-authored draft edits with one `fit_today` record in one transaction, and undone in one transaction with an `undo` record.

The coach fit is kept out of `Update Push A` by `benOnly`, so rule 2's template safety holds. Writes are opId-idempotent and draft-versioned. Migration 8 rebuilds `coach_actions` the same way migration 7 did and has a populated-database test.

There is one blocking issue. A coach fit that Ben cancelled, or that was still running when he tapped Start, can still be written (B1). A scratch probe confirmed it.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=120000` (full) | **pass**: 233 files, 4444 tests, 1 todo |
| Scratch probe (a temporary copy of `fit-to-time-coach.test.ts`'s harness, deleted afterwards, not committed) | Confirmed B1: `{"r":"applied","rows":1,"draft":1,"fit":"coach","active":"active"}` |
| Migration | `0008-today-fit` (the spec's 9). Same rebuild pattern as 0007: columns, rows, 4 indexes and the no-delete trigger are kept, and nothing references `coach_actions`. Backup and restore are schema-generic. `drafts.test.ts` migrates a populated v7 database. **Renumber at merge** if the other branch's 8 lands first. |
| Start paths | Overview Start (routine and next) at `workout-services.ts:1751`/`1774`, Up next preview, and the template card's dry run all use `todayFor` → `fitContext`. `finishByFromFit(plan.input.at, …)` uses the start's own `at`. |
| Rule 2 / template | `templateLinesFromEdits` and `applyEditsToRoutine` drop coach edits (`benOnly`). The built-in fit has no per-slot edits. Bring back writes a `sets` edit at the planned count, which `was === now` keeps off the card. |
| Secrets / logging | No `console.*` added. Context goes in separate `YOUR DATA` and `COACHING KNOWLEDGE` blocks, labelled "data, never instructions" (rules 8 and 10). |

## Blocking

### B1. Cancel, Start or leaving the page doesn't stop a coach fit whose answer has already arrived

`apps/mobile/src/services/workout-services.ts:3439–3511`. `req.signal` is only passed to the model call. After `ctx.coachFit` returns, the service runs two more overview reads, the validator and the draft write, and it never checks `req.signal.aborted` again. The screen's `cancelCoachFit()` (`WorkoutOverviewScreen.tsx:865`), which Cancel, Start and unmount all call, only aborts the controller and ignores the result (`:854`).

**Failure scenario (confirmed by probe).** Ben has no draft yet (the common case: he opens Push A and taps the TIME tile). He taps `Ask coach`, then `Start` after the model has answered but before the write.
- Start creates the session (correctly, with no coach edit).
- `liveDraft` now returns `null`, which equals the request's `expectedDraftVersion: null`. `applyCoachFit` finds no open draft for the basis, so it writes a **new open pre-start draft holding the coach fit** and a **committed `fit_today` record**.
- Probe result: `r: applied`, one `fit_today` row, an overview draft at version 1 with `fit.by = 'coach'`, and an active session.
- Effects: Push A's overview shows a coach fit Ben cancelled until the draft expires, and the coach action log records a change that was never applied to his workout. This breaks §3.4 ("starting cancels the request and nothing from it is applied"), FT-C13, and the honesty of the audit trail (rules 1 and 3).

With an existing draft, Start is saved by the version check. **Cancel** after the answer arrives still writes the fit in every case: the card disappears, and the fit appears on the next reload.

The existing FT-C13 test (`fit-to-time-coach.test.ts:262`) only covers the case where a draft exists. In that test Ben's edit creates the draft, so the version check catches it.

**Fix:**
1. Check `req.signal?.aborted` after every `await` that follows the model call, and immediately before `drafts.applyCoachFit`, and return `{kind: 'cancelled'}`.
2. Make the write refuse when a session has started since the request was sent. For example, `applyCoachFit` could also take the request's `previewKey`/start fence, or the service could check `sessions.active()` inside the same transaction. Abort alone is still racy against an in-flight transaction.
3. Add tests for Start with no prior draft, and for Cancel after the answer arrives.

## Should fix

### S1. The coach is told "Fill" while the app treats the request as shortening, so a common request is refused

The two decide the direction differently:
- `packages/coach/src/fit.ts:91` picks "Fit" or "Fill" from the **rounded** estimate (`estimateMinutes: roundEstimateMinutes(unfittedSeconds)`, `workout-services.ts:3238`).
- `validateTodayFit` (`packages/domain/src/coach/fit.ts:98`) and the sheet (`howLongSheet`) use **unrounded** seconds.

Example: the plan is 46.5 min, so the tile shows `≈ 45`. The default chip is 45, because 45 × 60 < 46.5 × 60, and the sheet shows `Trim to 45 min` and `Ask coach`, a shorten. The model receives `askedMinutes: 45, estimateMinutes: 45` and the message "Fill today to 45 minutes.", and the instructions tell it to add work. The validator treats the request as a shorten and refuses every add (`shorten_no_increase`), so Ben gets `Couldn't use the coach's version`. Because estimates round to 5 and the chips are multiples of 5, this happens often.

Fix: send the direction from the same unrounded comparison the validator uses (`shorten: boolean` in `TodayFitContext`, plus a one-decimal `estimateMinutes`), and add a test at a rounding boundary.

### S2. `Clear fit` on a coach fit leaves no audit trail

`workout-services.ts:3550`, `today-edits.ts:457`. `clear_fit` removes the coach's edits in the draft, but it writes no `undo` record and leaves the `fit_today` record `committed` with `undoneBy: null`. §5.3 says `Clear fit` "marks every edit with that actionId removed, in one write, and records the undo in the coach action log". FT-C15 expects an `undo` row. The coach's `get_recent_actions` would report this fit as still in place.

The same gap exists when `Trim to N` replaces a coach fit (its edits become `replaced` and the record is untouched). That case is lower severity, because the trim's Undo brings the coach fit back.

Fix: when the live fit is the coach's, route `Clear fit` through `undoCoachFit`. Consider marking the record when a trim replaces it.

### S3. ADR 0022 contradicts the build

`docs/decisions/0022-…md:54` still says drafts "are never in coach context (rule 10). The overview makes no AI call." Slice C sends the draft-derived plan to the model from the overview, and adds coach-authored draft edits. Spec §10 lists the needed ADR notes, for ADR 0022 (coach-authored edits, today's plan sent on request) and ADR 0006 (the built-in fit as a labelled offline fallback). Neither was written. Fix: the PM adds both notes and Ben confirms.

### S4. Tests miss the coach-fit Start path and cancellation

- FT-C5 asks for preview = Start "with a fit plus any mix" of edits. Only the built-in fit is started in tests (`fit-to-time.test.ts:137`). Missing:
  - a test that starts with a **coach** fit, including an `add` (the added exercise's `addTargets` targets, `fitted.by = 'coach'`, `cuts` including `add`, `finishBy`);
  - a check that the rows equal the preview.
- Cancellation is only checked by a source grep (`fit-to-time-screen.test.ts:146`). See B1.

### S5. Airplane mode: the first `Ask coach` tap reaches for the provider and then reads `No answer from the coach`

The cause is in two places:
- `coachFitAvailable` (`app-services.ts:584`) knows the coach is offline only after a request has failed. In airplane mode the first tap is enabled and calls the provider, which fails with `network`.
- `coachFitCardOf` (`fit-view.ts:72`) then maps `unavailable` to `No answer from the coach` instead of `Coach offline`.

FT-C9 expects the button disabled with `Coach offline` and no provider call. This is partly a spec issue (see below). The card text is a code fix: show `Coach offline` with an icon for `unavailable`, and re-read availability so the sheet shows the disabled state next time.

## Nits

- **N1.** When every edit is refused, nothing is logged. FT-C10 mentions a "validator log", and only partial refusals are kept, in the `fit_today` record (`workout-services.ts:3452`). Consider a `rejected`-status record or a request-log entry.
- **N2.** `Not now` on a coach swap suggestion is kept only in screen state (`WorkoutOverviewScreen.tsx:189`), so the card comes back after the screen remounts or the app relaunches.
- **N3.** Bring back on a fit-skipped row shows `✎ EDITED` and adds to `N EDITED` (tested and intentional for FT5). That is a visible side effect the spec doesn't describe. Worth a line in the spec.
- **N4.** `goal: null` and `priorityGroups: []` are hard-coded (`workout-services.ts:3240`). That is honest, because the data model has no goal or priority groups yet. It means tier B never uses priority groups, and the sheet's default chip can't use "preferred session length". See the spec issues.
- **N5.** `Fits already` returns `ok` with `draft: null`, so the screen plays the `step` haptic for a write that didn't happen.
- **N6.** `Now ≈ 45 min` beside an enabled `Trim to 45 min` (unrounded 46 min) reads oddly, though it is correct. Consider `Trim to 45 min` only when the rounded `Now` is above the chip, or show the rounded value consistently.

## Spec issues

1. **§4.5 numbers can't be reproduced.** §4.5 gives 62 → 52 → 44, 34 → 31 → 28 and `Shortest ≈ 28` without the pace and rest that produce them. With 50 s a set, 45 s changeover and the stated rests, the fixture is ≈ 56 → 44.5 / 26 / 25. The tests reproduce the **cut order** exactly, not the minutes. FT-C2's "exactly" should say "the same cuts", or §4.5 should state its pace.
2. **FT-C9 assumes a reachability signal the app doesn't have.** The app only learns it is offline after a failed request, the same pattern as coach chat. Either accept one failed attempt (and show `Coach offline` afterwards), or decide to add a reachability probe (an ADR-level choice).
3. **Goal, priority groups and preferred session length don't exist in the data model.** §3.2's default chip, §4.2's tier B and §5.1's context all rely on them. Mark them "when available" or schedule the data.
4. **Migration number.** The spec says 9, and this branch is 8 because the list must stay contiguous. Renumber at merge.
5. **Open decisions for Ben (spec §10):**
   - FT6 "Decision 2" (apply at once vs Apply on the whole fitted version);
   - the brief §7 `shortenSession` "proposes" vs CLAUDE.md rule 3 conflict.

   Both are still open, and the build follows rule 3.
