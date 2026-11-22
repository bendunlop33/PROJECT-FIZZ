# Review: Progress v3b (data / truthfulness lens), 21 Oct 2026

Branch `claude/progress-v3b-21oct`, diff `2108e61..HEAD` (4 commits). Spec: `docs/design/progress-goals.md` "Progress v3 (agreed)", prototype `progress-simple.html`, review `build-b-21oct.md` S1–S3.

**Verdict: CHANGES NEEDED** (one blocking item, B1; the rest are should-fixes and nits).

## Checks run by the reviewer

- `npm run typecheck`: clean.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: clean.
- `npm run check:migrations`: `Migrations OK: 1 to 32, none reserved or empty.`
- Targeted vitest (6 changed test files): 94 passed.
- Full suite `npx vitest run --maxWorkers=2`: 453 files, 8477 passed, 1 todo.

## What holds up (lens items)

- **Calendar never invents a weekday.** Done sessions sit on the local date they were logged (`progress-page.ts:234`). Missed and planned sessions go into `open` and are drawn after the row with no day (`progress-page.ts:243-251`, `charts.tsx` `MonthCalendar`). No plan schema has a weekday, so nothing can be placed truthfully, and nothing is. `This wk` is first and bold. The key, `Paused` rows, `n of m`, cardio dots and VoiceOver row sentences are all present.
- **Weeks on plan** (`progress-page.ts:259`): this counts only complete weeks (from last week back). A paused week continues the count, and a short week or a week with no plan ends it. It is capped at the loaded history (`SESSION_WEEKS - 1`), so it can understate but never overstate. Tested, including pauses and a late-applied plan.
- **PB definition** (`bestSets`, `liftsView`, `sessionNewBests`): only real sets at or above the tracked reps count, and estimates never set the bar. A PB must be strictly heavier (or, for assisted lifts, use strictly less assistance); a tie or the first-ever set is not a PB. Stacks, assisted stacks and plate-loaded machines only compare with the same `equipmentId`. Older history comes in through `listExerciseHistory`, which reads finished workouts only. The chart and the Summary share `liftTermsOf`, `liftRows` and `bestSets`, so they agree. Tests cover kg/lb, per-hand, stack, assisted, older history and PBs within the same week.
- **Load type labels:** `each`, `stack`, `assist` and `added` appear on Current and Target and in the PB detail, and the column headers show the unit.
- **S2:** `Reviewing…` is shown only while the call is out and the review is not yet reviewed. `.finally` clears it, and the page is told on every return path. Tested with a gated availability check.
- **S3:** a refusal because of pain returns `reason: 'pain'`, stores `held: 'pain'`, and shows `Held · pain` with no Apply or Redo. The new schema field is optional, so no migration is needed. Tested at the domain and service levels.
- Rules 2 and 5: nothing on the page writes. Apply is still guarded per exercise (`fromSets`), and the carried ask in the S1 test applies only through that guard.

## Blocking

**B1. Carried coach asks skip the claim check, so their reason can be false on the re-run review (rule 6; S1 asked for "let the claim check and staleness decide").** `apps/mobile/src/reviews/weekly-review-service.ts:441`.
The re-run happens because the inputs changed, but a carried open coach proposal keeps the `reason` that was checked against the *previous* facts. `ReviewProposalSchema.reason` is documented as "words already checked by the claim check", and that is no longer true for these. The developer's own test shows the risk: `weekly-review-plan.test.ts` carries `'Row 17 sets last week.'` across a re-run caused by logging another Pull workout, after which Row's set count for the week is different. Progress then shows a stale numeric claim next to an Apply button.
A second problem: the carried ask is passed to `checkWeeklyReview` as `taken` (`packages/coach/src/builder/weekly.ts:138,146`). If the coach, given the new data, proposes a different change for the same routine and exercise, that change is refused as `duplicate`, and the outdated unanswered ask stays.
**Fix:**
- When carrying an open coach ask, re-check its reason against the new facts (`checkClaims(reason, weeklyClaimFacts(f))`). If it fails, set `reason` to null (or drop the ask).
- Let a fresh coach tweak for the same routine and exercise replace an *unanswered* carried one. Keep refusing duplicates of answered ones.
- Add tests for both.

## Should fix

**S1. `Held · pain` stays after the pain flag is cleared, and the change can never be applied.** `packages/domain/src/review/progress-page.ts:1005`, `weekly-review-service.ts:614-617`.
Apply refused for pain marks the proposal `stale` with `held: 'pain'`. The view then shows `Held · pain` forever, whatever `painFlagged` says now. Coach-sourced stale proposals are also carried over on re-runs (line 441 keeps every non-code stale one). Scenario: Ben flags shoulder pain, taps Apply on `OHP 3 → 4 sets`, and it shows `Held · pain`. He then clears the flag. The row still says `Held · pain` with no Apply, which is untrue once the flag is cleared. Separately, a plain `stale` (plan moved) proposal on a movement that is flagged now reads `Held · pain` instead of `Out of date`, because the second disjunct also matches `stale`.
**Fix:** derive the pain state from the active flags at read time. A `held: 'pain'` proposal with no active flag should read `Out of date`, or be reopened through a versioned write (`open`, `held` removed) so that Apply's own checks decide. Limit the live-flag disjunct to `open` proposals. Add a test that clears the flag.

**S2. PB history reads `counts` differently from the window.** `progress-page.ts:794`.
In the window, `counts` is `isSetCountable(s, 'record')` (`weekly.ts:166`). In history it is `exclusions.length === 0`. If `isExcluded` normalises exclusions (for example, ignoring unknown or blank entries), the same set could count in one place and not the other, and the chart, the Summary and the window could disagree about a PB. **Fix:** use `isSetCountable(x, 'record')` in `liftHistorySessions`.

**S3. Cost of full history on every refresh.** `weekly-review-service.ts:217, 694, 712`.
`progress()` reads the full history of up to 6 lifts every time it runs. S2 adds 1–2 more `emit()` calls per open, including offline, and each one triggers another `progress()`. `sessionBests` runs a full 22-week `gather()` plus the history reads on every Summary open. With years of FitNotes data this could make Progress or Summary slow on the phone. This is not a truthfulness bug, but Progress has to be fast and work offline. **Fix:** cache the history per lift per data version, or compute each lift's best-before value once. At minimum, time it on the iPhone before the device test signs off.

**S4. Missing tests for the edge cases above.** None of these is tested:
- An S1 carried ask whose reason no longer matches the facts.
- A carried ask on a template that moved (Apply refused and marked `Out of date`).
- A pain flag cleared after `held: 'pain'`.
- A carried open ask dropped because of a new pain flag (the filter at line 441).
- At the service level, the Summary PB matching the chart ring for a stack or assisted lift.

## Nits

- **N1.** `Reviewing…` is set before `deps.availability()` resolves (`weekly-review-service.ts:475`), so it can show briefly while the check will end up `Offline` or `Not connected` (rule 1 honesty). Set `asking` only once availability is `ok`.
- **N2.** An off-plan workout's letter comes from its own name (`progress-page.ts:234`), so it can match a plan day's letter. For example, an off-plan "Pull" shows `P` next to the plan's `Ps` or `Pl`. VoiceOver says the name, but visually the two can be confused.
- **N3.** The header `CURRENT kg` / `TARGET kg` (`charts.tsx:590`) sits over bodyweight rows that show `12 reps`.
- **N4.** `packages/domain/test/progress-page.test.ts:530` has two statements and a comment on one line (a formatting slip that lint didn't catch).
- **N5.** A plate-loaded or weighted lift reads `100 added`. This is explicit, but `added` isn't one of the spec's words (`each`, `stack`). Worth Ben seeing.
- **N6.** An open marker is assigned to the first undone plan days *in plan order*, not in rotation order. This is the same as the chips, so the two views are consistent, but a rotation plan can't truthfully say *which* day was missed. Consider showing `2 missed` without letters when the rotation position isn't known.

## Spec issues

- **SP1.** In the prototype (`progress-simple.html:307-336`, `HISTCAL` `mX` cells) and the design's chip copy (`Thu – missed`, `planned Thu, moved to Sat`), missed and planned sessions are placed on weekdays. Plan days have no weekday in any schema, so this can't be done truthfully (rule 6). The build correctly lists them after the row instead. The design and prototype should be updated to match, or a scheduled-weekday field should be added to plans if Ben wants day placement.
- **SP2.** The design defines **Cardio** without saying which activity kinds count. The build counts `run`, `ride` and `swim` and excludes `sport` and `other`. Ben should confirm.
- **SP3.** The design doesn't give Training a home for the old Calendar tab. The `Totals | Calendar` switch is the developer's own addition and needs Ben's OK.
- **SP4.** Under the PB definition, a heavier set at fewer reps doesn't count (for example, `110 × 4` doesn't stop `95 × 6` being a PB at × 6). This is correct as specified, but it can look odd next to the Lifts tab's rep maxes, and the Summary's `New best` line can sit next to a `Heaviest…` line that reads differently. Ben should confirm.
