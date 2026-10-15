# Review: Workouts library, slice C (fit to time), round 2

Branch `claude/workout-library` at `bf06569` vs `claude/gracious-knuth-joxqpw`. This round covers the fix commits `3c0f711` (code and tests) and `bf06569` (ADR notes) after round 1 (`1351b62`, `docs/reviews/workout-library-C.md`).
Spec: `docs/design/fit-to-time.md` (FT1–FT10, FT-C1–FT-C18), mockup `docs/design/mockups/workout-library.html` frames 3 and 4, ADR 0022, ADR 0006, CLAUDE.md rules 1–10, minimal copy.
Reviewer: independent reviewer, 12 Oct 2026.

## Verdict: **PASS**

Round 1's blocking issue (B1) is fixed, and S1, S2 (main case), S3, S4 and S5 are addressed. N2 and N5 are fixed too. Nothing new blocks. The remaining items are nits and spec questions for Ben.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=120000` (full) | **pass**: 208 files, 4085 tests, 1 todo. Round 1 reported 233 / 4444. No test file was deleted or renamed since `1351b62` (`git diff --diff-filter=D` is empty, and 208 `*.test.ts` files exist on disk), so round 1's count looks like a miscount rather than lost tests. |
| Migration | Unchanged since round 1 (`0008-today-fit`, the spec's 9). Renumber at merge if needed. |
| Secrets / logging | No `console.*` and no credentials added. |

## Round 1 findings

| # | Status | Evidence |
|---|---|---|
| B1 Cancel/Start after the answer still wrote | **Fixed** | `workout-services.ts:3437–3524`: `aborted()` is checked after every await following the model call, and immediately before the write. `drafts.ts:192–201`: `applyCoachFit` re-checks `cancelled()` and a **start fence** (a count of manual sessions, read at request time) **inside the write transaction**, so the abort/Start race is closed where it matters. Start's own session write is serialised behind or ahead of this transaction, so the fit either lands first (and Start's `expectedPreviewKey` catches it) or is refused. Screen (`WorkoutOverviewScreen.tsx:864–868`): a fit whose write was already under way when Cancel landed is undone at once. Tests: Start with no draft (the round 1 probe case) and Cancel after the answer arrived, with and without a draft (`fit-to-time-coach.test.ts:357–410`), plus fence and cancel at the persistence level (`drafts.test.ts:594–600`). |
| S1 Fit/Fill direction | **Fixed** | `fitShortens` (`domain/coach/fit.ts:102`) is the one comparison used by the validator and the request (`shorten` in `TodayFitContext`). The estimate is sent to one decimal. Boundary tests: `packages/coach/test/fit-request.test.ts`, plus an end-to-end test (`fit-to-time-coach.test.ts:472`). |
| S2 Clear fit audit | **Fixed (main case)** | A coach fit's `Clear fit` goes through `undoCoachFit`, so there is one `undo` row and the record is marked undone. It checks the version first, and a retry is idempotent (tested). The secondary case, `Trim to N` replacing a coach fit, is still open. See N2 below. |
| S3 ADR notes | **Done, pending Ben** | ADR 0022 has an amendment for the one coach request, coach-authored edits and the start fence. ADR 0006 has a note on the built-in trim as the offline fallback. Both are marked "pending Ben". |
| S4 Coach-fit Start, cancellation tests | **Fixed** | `fit-to-time-coach.test.ts:437`: Start with a coach `add` and `sets`. Rows equal the preview (`sameAsStart`), `fitted.by = 'coach'`, `cuts` include `add`, `finishBy` = start + minutes rounded up to 5, and the added curl's targets come from Ben's history (12.5 kg), not the model. |
| S5 Airplane mode | **Fixed (with the accepted one-attempt limit)** | `unavailable` now shows `Coach offline` with a `wifi.slash` icon (`fit-view.ts:57`, `ui/fit.tsx:228`). The screen disables `Ask coach` afterwards. `coach-service.ts:152` holds the offline state, so reopening the sheet stays disabled until the hold expires. The first tap in airplane mode still reaches for the provider. See spec issue 2. |
| N2 `Not now` kept on remount | Fixed for the app's run (module-level set, keyed by actionId). It is not stored, so a relaunch shows the suggestion again. That is acceptable. |
| N5 haptic on `Fits already` | Fixed. |
| N1, N3, N4, N6 | Not addressed. They are carried below. |

## Blocking

None.

## Should fix

None.

## Nits

- **N1. `Trim to N` over a coach fit leaves the `fit_today` record `committed`** (`today-edits.ts`, the `fit` command marks the coach edits `replaced`). This is round 1 S2's secondary case. `get_recent_actions` would report the coach fit as in place while the trim is live. Its Undo brings the coach fit back, so the record is right again afterwards. Suggested fix: when a trim replaces a coach fit, mark the record as superseded, or have the coach context read "in place" from the draft rather than from the record.
- **N2. All-rejected answers leave no log** (round 1 N1). FT-C10 mentions a validator log. Only partial refusals are kept, in the `fit_today` record (`workout-services.ts:3460`). Suggested fix: record a `rejected`-status action or a request-log entry.
- **N3. `clearFit`'s coach branch always returns `duplicate: false`** (`workout-services.ts:3577`), even when `undoCoachFit` replayed. No user-visible effect today, because the screen's `clearFit` shows no toast. Suggested fix: pass the replay through.
- **N4. `unavailable` covers more than unreachable.** `requestCoachFit` returns `unavailable` when `ctx.coachFit` isn't wired or the minutes are invalid (`workout-services.ts:3432`), and the card then reads `Coach offline` and disables `Ask coach`. Minutes come from validated chips, so this is unreachable in practice. Suggested fix: return `failed` for invalid minutes.
- **N5. The "Start with no draft" service test accepts `plan_changed` or `cancelled`** (`fit-to-time-coach.test.ts:376`). It doesn't pin that the start fence is what refused the write. The outcome is still asserted (no draft, no record, plain session), and the fence is unit-tested in `drafts.test.ts`, so this is coverage precision only.
- **N6. Carried from round 1:** Bring back on a fit-skipped row shows `✎ EDITED` (N3). `goal`/`priorityGroups` are hard-coded empty (N4). `Now ≈ 45` sits beside `Trim to 45 min` at 46 min (N6).
- **N7. Cancel during the write leaves an applied-then-undone pair in the coach log**, with the undo authored as `ben` (`WorkoutOverviewScreen.tsx:866`). This is honest, because the write did happen and Ben's Cancel took it back, and the window is a single transaction. Recorded so nobody is surprised by it in `get_recent_actions`.

## Spec issues

1. **`Clear fit` on a coach fit can leave a fit.** §5.3 says `Clear fit` on a coach fit behaves as its Undo, and "a built-in fit it replaced comes back". If Ben trimmed to 45 and then asked the coach for 30, `Clear fit` shows `Fitted to 45 min` again. That is what the spec says, but the label suggests no fit afterwards. Ben should choose one of these:
   - `Clear fit` removes every fit;
   - keep the current behaviour and call the button `Undo coach fit` when the live fit is the coach's.
2. **FT-C9 "no provider call"** (round 1 spec issue 2) is still unresolved in the spec. The build now shows `Coach offline` after the first failed attempt and disables the button until the offline hold expires. Accept that in the spec, or decide on a reachability probe (an ADR-level choice).
3. **§4.5 minutes, goal, priority groups and preferred length, and the migration number:** round 1 spec issues 1, 3 and 4 still stand.
4. **Open decisions for Ben:**
   - FT6 Decision 2 (apply at once vs Apply);
   - brief §7 `shortenSession` "proposes" vs rule 3;
   - the two ADR notes marked "pending Ben".
