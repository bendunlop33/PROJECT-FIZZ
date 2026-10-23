# Review: D2 offers (v5offers): weekly review, Summary stall resets, pre-start nudge

**Verdict: CHANGES NEEDED** (23 Oct 2026). Two blocking issues, B1 and B2. Both were reproduced on real SQLite.

**Scope:** `9261625..b2fc778` on `claude/v5offers-23oct`. The commits are 8e6a760 (weekly review), 4c1b66a (Summary stall reset) and b2fc778 (schema comment).

**Checked against:**
- Ben's D1–D9 (22–23 Oct), D2 in particular.
- CLAUDE.md rules 1–10 and the minimal-copy rule.
- `coach-adjustments.md` CA8.
- `progress-goals.md` §3 and §3.6.
- `workout-builder-v3.md` §2.0.3 and §6.1.
- `fit-to-time.md`.
- `playbook-v1.md` rule 8.

## Checks I ran

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test` (full suite) | 473 files, 8808 passed, 2 todo, exit 0 |
| Reviewer probe 1: a temporary real-SQLite test using Your workout's Time, deleted afterwards | Reproduced B1 |
| Reviewer probe 2: a temporary real-SQLite test of Apply → Undo → Redo on a weekly offer, deleted afterwards | Reproduced B2 and S1 |

The tree was clean after the probes were deleted.

## What holds up

- **Background review of a pre-start draft (D2, part 1).** It is already an offer. `preSessionNudge` returns a `NudgeOffer`, and only Ben's `applyNudge` writes it. That write is version-checked (`recheckBuilderProposal`), uses one op per proposal (`builderApplyOpId`) and has Undo. Coach review (§2.9) is opened by Ben, and its suggestions need Apply. I found no other path where the coach writes a pre-start draft unasked. The coach-authored `fit_today` record only runs when Ben picks a time.
- **The weekly gate (D2, part 2).** `weeklyOfferReasons` and `autoApplicable` (`packages/domain/src/review/progress-page.ts:980`, `:1003`) are pure and deterministic, and they read only stored facts. These are always offers:
  - any added set;
  - a move of more than one set;
  - any change on a lift with a `stalled_lift` fact;
  - a change with no reason.

  `autoApply` runs on every open and after the coach's part lands, and it skips offers. An offer survives a force-close and relaunch (`weekly-review-plan.test.ts`, D2 test).
- **Writes (rule 5).**
  - Ben's Apply on an offer stays per-exercise version-guarded (`templateWorkingSets === fromSets`), refuses a stale write and is recorded as `author: 'ben'`.
  - The same tap twice writes once, because the op ID comes from the proposal.
  - Undo restores that one exercise.
  - Skip writes nothing, and a later open doesn't apply a skipped offer.
- **Summary stall reset (D2, part 3).**
  - `isStallReset` handles kg and lb by unit, per-hand dumbbells, and assisted machines in the right direction: more assistance counts as easier, via `compareDifficulty` and `loadDirection`.
  - A reset becomes `bigger`, and the built-in rule plans next time until Apply.
  - The app-level test fails without the fix (I didn't re-verify this) and covers suggestion → preview unchanged → Apply → Undo.
  - Holding, one set fewer and one step heavier stay CA8-small.
- **Honest states.** An open offer never reads `Not applied`, and open small changes still do. Pain-held rows still read `Held · pain`. `Keep as is` is gone everywhere.
- **No secrets, no new logging, no new network paths.**

## Blocking

### B1. Two short (Time-fitted) days become a plan change on the next app open, with no tap

**Where:**
- `packages/domain/src/review/weekly.ts:141`: `plannedWorking` leaves out every `skippedBy: 'before_start'` set and every set a fit never created.
- `packages/domain/src/review/weekly.ts:647-661`: `repeatedEdits`.
- `packages/coach/src/builder/weekly.ts:103`: `codeProposals` always gives a reason.
- `packages/domain/src/review/progress-page.ts:980-1004`: `autoApplicable` treats a code `−1` as CA8-small.
- `apps/mobile/src/reviews/weekly-review-service.ts:664-669`: `autoApply`.

**What happens:** a Time fit is today's only. D1 says "Time changes never ask (a short day isn't a new plan)". `fit-to-time.md:10` says "the saved workout and the plan never change", and `builder-service.ts:831` keeps fits out of plan writes. But the session only stores the fitted set counts, and the weekly review's repeated-edit rule reads them as Ben's own edit. `autoApplicable` then counts a code `−1` as small, so the review writes it into the plan template on app open.

**Repro (probe 1, real SQLite, coach giving no weekly answer):**
1. Apply a 3-day plan. Push has 5 exercises × 3 sets.
2. On two days that week, open Push in Your workout and step Time down until the fit cuts sets. It cut Dumbbell shoulder press, Triceps pushdown and Lateral raise from 3 to 2. Start with `today`, log and finish.
3. On Monday, `runOnOpen()` returns `not_reviewed`.

The Push template goes from `[3,3,3,3,3]` to `[3,3,2,2,2]`. Three `source: 'code'` proposals are `applied` (`author: 'checks'`), and Coach's changes shows three made rows with Undo. Two short days have become the plan.

This also breaks:
- D1: set-count changes Ben makes come back as "Keep for next time?" with Apply/Skip on the Summary, never applied unasked.
- CLAUDE.md rule 3: template changes are proposals.
- `workout-builder-v3.md:782`: "repeating the same edit **suggests** a template update".
- `progress-goals.md` §3.6: "With no AI there are none".

Before this branch it applied `+1` too. This branch narrowed the gate but kept the `−1` path open, and the gate is where D2 and D1 meet.

**Fix:**
1. Make every `source: 'code'` proposal an offer. Add a `from_edits` offer reason in `weeklyOfferReasons`, or have `autoApplicable` return false when `p.source === 'code'`. A repeated edit is Ben's own structure, which D1 says is kept only by his Apply.
2. Stop Time fits from counting as edits. Either compute `plannedWorking` from the plan before the fit (the draft's `timeFit` record or a fit marker on cut sets), or skip sessions that had a live fit for that exercise. Otherwise step 1 still asks after two short days, which D1 says never to do.
3. Add a real-SQLite test along the lines of probe 1 (two Time-fitted days → no plan change, no offer), plus a Ben-edit variant (two days with a set removed by hand → an offer, never applied on open).

### B2. Redo on an undone offer calls Apply and fails with "Out of date"

**Where:** `apps/mobile/src/reviews/ReviewsSection.tsx:63` (`onRedo={onApply}`), with `packages/domain/src/review/progress-page.ts:1097` (`canRedo` is true for any undone non-structural row) and `:1131` (offers stay in `asks`).

**What happens:** offers are no longer structural, so after Ben applies one and taps Undo, `AskRow` draws `ChangeRow` with a `Redo` button. That button calls `applyProposal`. `applyOne` refuses any status other than `open` (`weekly-review-service.ts:627`), so Ben sees `Out of date` and nothing changes. The message is false: nothing moved, and `redoProposal` would have worked. Before this branch nothing undone ever reached `AskRow`.

**Repro (probe 2):** coach `+1` on Lat pulldown, then Apply, then Undo. The row reads `{status: 'undone', offer: true, canRedo: true}`. Calling `applyProposal`, which the UI wires, returns `{ok: false, reason: 'out_of_date', message: 'Out of date'}` and the plan stays `[3,3]`. Calling `redoProposal` on the same row works.

**Fix:** pass `onRedo` to `AskRow` and wire it to `actions.redo(r)`, or set `canRedo` to false for offers so Undo returns them to `Apply / Skip`. Add a test for the UI path: Apply → Undo → Redo, written once, with Undo again.

## Should fix (not blocking)

### S1. After `Got it`, waiting offers are hidden behind `No changes for next week ›`

**Where:** `progress-page.ts:1136`. The test `weekly-review-service.test.ts` (D2, "an added set …") asserts this text with two open offers.

`collapsed` counts only applied changes. Once Ben taps `Got it`, Coach's changes collapse to "No changes for next week" while an Apply/Skip offer is still waiting (probe 2: `collapsed: 'No changes for next week'` with one open offer). D2 turned most weekly changes into offers, so this is now the common case.

**Fix:** count open offers in the collapsed line (e.g. `1 to review ›`), or keep the section expanded while any offer is open. Test both.

### S2. The Summary's "stalled" misses a stall at the lightest available load

**Where:** `next-session.ts:300` and `progression.ts:1038-1061`.

`stalled` is true only when the built-in rule returns `reduce_load`. When the miss streak is reached but "No easier load is available on this equipment" (lightest dumbbell, stack minimum), the rule returns `hold_after_miss`. A coach rep-scheme change there (8–10 → 6–8) is then classed small and saved without a tap. That is a rule 8 reset that D2 says always needs Apply.

**Fix:** mark the basis stalled when the streak reaches `failuresBeforeReduce`, whatever load is available (e.g. a `stalled` flag in the rule's provenance), and add the lightest-load case to `coach-next-session.test.ts`.

### S3. `A reset after a stall.` is never shown

**Where:** `next-session.ts:61` and `next-time-view.ts:54`.

The constant is documented as "app text, behind `Why?`", but `coachRow` builds `why` from the coach's reason, guard notes and the rule line only. `NextSessionRow.reasons` is never rendered. Either put the CA8 reason behind `Why?` on `Suggested` rows, or correct the comment and commit text.

### S4. The weekly coach is told every tweak is Ben's to apply

**Where:** `packages/coach/src/builder/requests.ts:57`.

The tool description says "Ben applies or skips each tweak". A one-set-fewer tweak is applied by the review itself, so the coach's own lines can describe it wrongly. Say which kind is applied with Undo and which is offered.

## Nits

- **N1.** `NEW` comes back on a re-run while a code offer is still open. Code's open proposals aren't carried over (`carriedProposals`), so `codeProposals` makes the same one again as `fresh`, and `fresh.length > 0` drops `seenAtUtc` (`weekly-review-service.ts:463`, `:481`). Before D2 they were applied and carried. If B1's fix makes code changes offers, carry code's open offers like the coach's.
- **N2.** `isStructuralProposal` / `structural` is dead for the weekly review: the schema's only `change.kind` is `template_sets`. It's harmless but makes `weeklyOfferReasons` look broader than it is.
- **N3.** The Summary still says `Not now` while weekly offers say `Skip`. That's for the copy pass, as the builder noted.

## Tests

- **Good:**
  - domain classification for each offer reason;
  - stall resets on barbell, dumbbells, assisted and lb;
  - "no open ever writes an offer", checked through the deterministic auto record;
  - Apply once as Ben's, Skip, Undo;
  - an offer across force-close and relaunch;
  - the Summary flow after two misses.
- **Missing:**
  - B1: Time-fitted or hand-edited repeated sessions;
  - B2: Redo on an undone offer through the path the UI uses;
  - S1: collapsed text with open offers;
  - S2: lightest-load stall.

  `reviews-screens.test.ts` only checks that strings appear in the source, so it can't catch B2's wiring.

## Spec issues (for Ben or the spec track, not the code)

- **SP1. Summary `+1` sets.** D2 says unasked `+1` sets "ALWAYS need Apply". CA8 (`coach-adjustments.md:58`) says an unasked `+1` is dropped and listed under `Why?`. Dropping never applies it, but Ben never sees an Apply either. Ben to say whether the Summary should offer it. The builder raised this too.
- **SP2. The built-in rule's own reset.** 7-F / ADR 0006 lowers the load one step after repeated misses with no tap. That happens offline, when the coach's target equals it, and after `Not now` on the coach's bigger reset. D2 says stall resets "ALWAYS need Apply", and playbook rule 8 says "Resets are proposals". Ben to decide whether the fallback's reset becomes a suggestion too.
- **SP3. CLAUDE.md rule 3 vs Progress v3 / D2.** Rule 3 says template changes are always proposals. D2 lets a CA8-small weekly change apply itself, and that weekly write is permanent (a template version), while CA8 defines "small" for the *next session*. CLAUDE.md, the brief and `progress-goals.md` need to say one thing.
- **SP4. Scope wording.** Weekly rows and offers read `next Pull`, but Apply changes every future Pull until undone. Rule 2 asks for an honest scope (today only vs future template). `progress-goals.md:28` uses `next Pull` for the same permanent change, and §5 still mentions `Next Pull` / `Future Pulls` chips that aren't built.
- **SP5. Specs still describe automatic changes.**
  - `progress-goals.md:28` ("small … changes … are automatic", example `Row 3 × 8 → 4 × 6`, which is exactly V5).
  - §3.6: "With no AI there are none" (code's rule writes offline, see B1); "At most 2 proposals", where code allows 4 and probe 1 produced 3.
  - `workout-builder-v3.md` §2.0.3 step 2 ("a small load/reps/sets change is applied").

  All of these need the D2 wording.
- **SP6. Repeated-edit rule vs D1.** With D1's Summary "Keep for next time?" (not built on this branch), the weekly "same edit repeated" rule (§6.1) overlaps it. If Ben taps Skip twice on the Summary, the weekly review would still raise, or today apply, the same change. Decide whether to retire the weekly rule or have it respect Ben's Summary answers.

## Fixes (builder, 23 Oct)

Commits `a09fa2c`, `02f1e2c`, `3451920`, `2d0623c` on `claude/v5offers-23oct`. I confirmed each item against the code first. Items 1 and 5 need Ben, so they are not changed.

| Item | Status | What changed |
|---|---|---|
| B1 (weekly part) | Fixed | `weeklyOfferReasons` adds `from_edits`: code's own (repeated-edit) change is always an offer and never applied by the review. Real-SQLite test: Ben's own set removed twice → one offer. No open and no relaunch applies it, and Apply writes it as Ben's, with Undo. |
| B1 (Time fits) | Fixed | New `SessionPlanDay.notEdited` lists exercises whose working sets Ben didn't set himself, recorded at Start by `notEditedOfBuilderDraft`. It covers two sources: (1) Your workout's live Time fit (sets cut or exercises left out); (2) Today's card, meaning any count Ben left as the newest Today-written version on the draft's line had it. That includes Today's Time, the coach's applied pre-start offer, and the main lift's top set and back-offs. `reviewSessionOf` reads those as `plannedWorking: null`, so `repeatedEdits` never counts them. Real-SQLite tests: two Time-fitted days from Your workout, and two short days from Today's card, give no plan change and no offer. |
| B2 / 2 | Fixed | One mapping decides each row's buttons: domain `changeRowTaps` gives open → Apply/Skip, applied → Undo, undone → Redo. One function runs them (`runChangeTap`), and Progress and Past weeks both use it. `ChangeRow` and `AskRow` take `onTap` only. Test: Apply → Undo → Redo → Undo through the same mapping and function the screens use. Redo writes once, as Ben's. |
| 3 / S1 | Fixed | The collapsed line now counts open, answerable rows: `1 change for next week · 1 to review`, or `1 to review`. It never reads `No changes` while an offer is open. |
| 4 | Fixed | New `ReviewProposal.offer` mark. It is stamped when a review stores a proposal, and on carry-over it is stamped under the previous review's facts. A fresh coach tweak that replaces an offer keeps the mark. Test: the reviewer's repro (stalled → re-run not stalled) stays open, and the plan doesn't move. |
| N1 | Fixed | Code's open offer carries over with its ID kept, as long as the week still holds the same edit. A re-run doesn't make it again as new, and `Got it` is kept. Covered in the real-SQLite test. |
| 6 / S2 | Fixed (part) | `NextTargets.stalled` and `TargetProvenance.rule.stalled` are set when the miss streak reaches `failuresBeforeReduce`, including at the lightest load (`hold_after_miss`). Summary bases read them. Still open: an exercise with no built-in plan (`builtIn` null) has no rule floor to measure a miss against. Also, weekly's "no new best in 3 sessions" and the Summary's "missed twice at the same load" remain two definitions. Unifying them is a spec call. |
| 7 | Fixed | Review detail draws offers with `AskRow` (Apply/Skip, with the status in the line). On Progress, `AskRow` also hides Apply/Skip on a pain-held open row. |
| 1 | Not changed (Ben) | Confirmed in code: on a stalled lift the built-in rule's `reduce_load` still plans next time with no Apply, both offline and after `Not now`. It is also used when the coach's target equals it (`validateNextSessionTargets` drops a same-as-rule row) or when the coach doesn't mention the lift. Holding by default and offering the reset with Apply would change ADR 0006's fallback. That is the review's SP2, and Ben needs to decide it. The rule's −12.5% at 60 kg comes from rounding a 10% reduction down to an achievable load, which is outside playbook rule 8's 5–10% band. That is also ADR 0006 / playbook territory. |
| 5 | Not changed (Ben) | Confirmed: an unasked Summary +1 is still dropped and only noted behind `Why?` (`droppedExtraSet`). D2 vs CA8 is SP1. |

Not in this list and not touched: S3 (`A reset after a stall.` not shown), S4 (the weekly tool description), N2, N3, SP3–SP6. SP6 still stands: the weekly repeated-edit rule now only offers, but it overlaps D1's unbuilt Summary `Keep for next time?`.

**Limits:**
- Workouts started before this change have no `notEdited`, so an old short day can still count toward one offer. It is never applied.
- Today's card counts are compared per exercise by its first slot.

**Checks after the fixes:**

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test` | 474 files, 8824 passed, 2 todo, exit 0 |
