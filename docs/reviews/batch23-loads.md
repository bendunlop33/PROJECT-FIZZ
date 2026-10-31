# Review: batch 23 Oct, track `loads` (D4 back-offs, D6, O1)

**Verdict: PASS** (re-review after fix round 1, 23 Oct 2026). B1, B2 and B3 are fixed and verified; see "Re-review (fix round 1)" at the end. The first-round verdict (CHANGES NEEDED, three blocking issues in the D4 back-off rule) is kept below for history.

Scope: `9261625..6de08ae` on `claude/loads-23oct` (1f23220 O1, 1b1eb2f D4, 6de08ae D4 wiring).
Checked against Ben's decisions D1–D9 (22–23 Oct), `docs/training-guides/set-structures.md` SS4, `docs/training-guides/history-targets.md` HT8, `docs/design/workout-builder-v3.md` §3.1, CLAUDE.md rules 1–10 and the minimal-copy convention.

## Checks I ran

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test` (full suite) | 478 files, 8837 passed, 2 todo, exit 0 |
| Reviewer probes: two temporary domain tests, deleted afterwards | Reproduced B1, B2 and B3 below |
| Commit trailers | All three end with the required two lines |
| `docs/design/*` untouched | Yes |

## What holds up

- **O1 (rule 4) is fixed in the shared planner.**
  - `startWorkoutWithMode` (`packages/domain/src/session/create.ts:287`) maps an unpinned slot whose loads need an item through `swapSource`. Start, `routines.planned`, Today's one-tap Start and Repeat all go through it.
  - The reviewer's pushdown (no item, Fixed 400 kg) now plans at the stack's max on the stack, with a `capped` snap.
  - Tests cover kg/lb per-hand rounding, the rack max, assisted (dropped, never harder), last used here, a gym with none of its kinds (dropped, reps kept), Repeat, a duplicate op ID and a force-close on real SQLite.
  - The no-kinds exception is narrow. The catalogue has no exercise without kinds, and FitNotes import only creates exercises with a chosen kind (`import/plan.ts:1411`, `import-service.ts:1032`).
  - Rows 2/2b in `start-normalisation.test.ts` still test unit handling on a no-kinds exercise.
- **D6.** I confirmed the app has no `Check your lifts` / `Still right` flow and no stale-lift step-down. The step-down exists only in `plan-builder.md` and its prototype. No code is needed now.
- **D4, the default build.** `setRowsFor` works back-offs out from reps and RPE (Epley on the anchor), keeps them below the top, and rounds them down on the item.
  - Default rows: 6 @ 8 top, 8 @ 8 back-offs. Strength and Balanced give 95 % (inside their bands). Muscle is capped at 92 %.
  - A pain hold now lowers back-offs below the held top (100 → 90 gives back-offs of 85, not 90).
  - Assisted and added-weight lifts keep the working load.
  - Lighter-top edits are idempotent by op ID, Undo restores them, and they survive a force-close (real-SQLite test).
  - The goal is read in both `builder-env` and Today's session, so Your workout, Today and the coach's edits use the same band.
- No UI copy was added, no logging was added, and the change has no network or AI dependency (rule 1).
- D1–D3, D5 and D7–D9 aren't touched by this track, and I found no regressions against them. The fit (D9) never changes main-lift loads. The pain-hold lowering is a deterministic guardrail, not an unasked coach change (D2).

## Blocking

### B1. Back-offs ratchet down when Ben raises the top and then lowers it again

**Where:** `packages/domain/src/builder/set-rows.ts:314` (`lowerBackoffs(rows, row.load, …)`) and `:343`. The coach path does the same at `packages/coach/src/builder/edit-ops.ts:153-154` and `:166`.

**What happens:** "same % lower" is measured from the *previous* top, whatever it was, not from the top the back-offs were worked out from. Raising the top leaves the back-offs alone (by design). Lowering it afterwards then scales them down by the ratio from the raised value.

**Repro (probe, Balanced, bench rule 100 × 6 @ 8, 2.5 kg steps):**

| Step | Top | Back-offs |
|---|---|---|
| Built | 100 | 95, 95 |
| Ben types 110 | 110 | 95, 95 |
| Ben types 100 again | 100 | **85, 85** |
| 110 → 100 once more | 100 | **75, 75** |
| Then `Gym changed` | 100 | 95, 95 |

The top ends where it started, but the back-offs are 21 % lighter. The coach does the same: if Ben typed 110 and the coach steps it to 107.5, back-offs fall from 95 to 92.5 even though the top is still above the built 100. `reloadSlotLoads` measures from the formula top (`:470`), so `Gym changed` jumps them back up. The two paths disagree.

**Fix:** make the lowered back-off a function of the current top, measured from the top it was worked out from, not a running edit:
`backoff = min(built, roundDown(built × top / builtTop))`.
For formula slots, `builtTop` is the top at its reps/RPE from `slot.anchorE1rm` (as `reloadSlotLoads` does). For a saved workout, it's the saved top. Use the same helper in `editSetRow`, `withWorkingLoad` and `reloadSlotLoads`. Add tests for 100 → 110 → 100 (back to 95), for the coach stepping down from a typed heavier top, and for `Gym changed` agreeing with the edit path.

### B2. Changing the top's reps or RPE lowers the top but leaves the back-offs at or above it

**Where:** `packages/domain/src/builder/set-rows.ts:319-335`. The `reps` and `rpe` patches recalculate only the edited row (`:333-334`), and `lowerBackoffs` runs only on a typed load (`:314`).

**What happens:** D4 says back-offs are never above the top, and HT8 says a lowered top lowers them by the same %. The builder's report says "A back-off is never at or above the top." Editing the top set's reps or RPE in Your workout lowers its load by the formula, and the back-offs don't move.

**Repro (probe, bench rule 100 × 6 @ 8):**

| Edit on the Top set | Balanced / Strength | Muscle |
|---|---|---|
| Reps 6 → 10 | top **90**, back-offs **95, 95** (above the top) | top 90, back-offs 90, 90 (equal) |
| Reps 6 → 8 | top 95, back-offs 95, 95 (equal) | top 95, back-offs 90 |
| RPE 8 → 6 | top 95, back-offs 95, 95 (equal) | top 95, back-offs 90 |

`Start` plans exactly this, so the active workout gets back-offs heavier than the top. `Gym changed` re-derives them below the new top, so the two paths disagree again. The coach's `reps`/`rpe` op is fine, because it recalculates every row.

**Fix:** when an edit (reps, RPE or type) changes the top row's load downward, apply the B1 helper to the back-offs Ben didn't type. Then add one final invariant after every row edit, `changeSetType` and `setWorkingCount`: an untyped back-off is never above `top × (1 − band.min)`, rounded down. Add tests for top reps 6 → 10 and 6 → 8 and top RPE 8 → 6 in each focus.

### B3. The band's lower edge makes back-offs heavier than their reps and RPE allow, including sets past failure

**Where:** `packages/domain/src/builder/backoff.ts:57-59` (`Math.min(highest, Math.max(lowest, raw))`). It's used by `recalcLoad` (`set-rows.ts:214`) and by every other back-off path. It's asserted by `packages/domain/test/builder-backoffs-d4.test.ts:61-62`.

**What happens:** when the reps/RPE load is further below the top than the band allows, it is clamped **up** to the band's floor. D4 and SS4 say back-offs are "worked out from their reps and effort". The floor turns any longer back-off into a fixed % of the top and raises it past what the formula says Ben can do. That is the opposite of a guardrail (rule 3), and it breaks the playbook's "working sets on compounds stay at RPE 7–9".

**Repro (probe, bench top 100 × 6 @ 8, so est. max 126.7; Ben edits a back-off's reps in Your workout):**

| Focus | Back-off asked | Load given | Reps to failure at that load (Epley) |
|---|---|---|---|
| Balanced / Strength | 12 @ 8 | 90 | ~12.2, so about RPE 10, not 8 |
| Balanced / Strength | 15 @ 8 | 90 | ~12.2, so **15 reps is impossible** |
| Muscle | 15 @ 8 | 85 | ~14.7, so impossible |
| Strength (the test at `:61`) | 12 @ 6 | 92 before rounding | ~11.3, so impossible; the test asserts it |

The same floor raises a back-off after Ben types a heavier top. With a typed top of 115, re-entering 8 reps on one back-off moves it from 95 to **102.5**, while the other stays at 95. That contradicts HT8's "raising the top never raises back-offs".

**Fix:** clamp toward lighter only: `Math.min(highest, raw)`. Treat the lower edge as a check: keep the reps/RPE load, and if wanted say so behind `Why?`. Update the tests at `:61-62` and add feasibility tests: for every focus, the given load × (1 + (reps + RIR)/30) ≤ est. max. If Ben wants the floor as a hard limit, it needs a rule that lowers reps instead of raising load (SP1).

## Should fix (not blocking)

- **S1. The coach raising the top raises back-offs, and Ben typing a heavier top doesn't.**
  - `edit-ops.ts:166` works heavier tops out from the new anchor.
  - `builder-coach-backoffs-d4.test.ts` ("heavier top (100 → 102.5)") asserts it.
  - The builder's report says "Raising the top never raises back-offs." Both behaviours may be right, but they need one rule (SP2), and the report should say which.
- **S2. Back-offs in chat-built workouts don't get the band.**
  - `packages/domain/src/session/coach-draft.ts:529-533` only checks that they aren't harder than the top (`checkSlotLoads`), so a back-off equal to the top passes.
  - The builder listed this as not done.
  - Apply at least the "below the top" edge (`top × (1 − band.min)`) as a guardrail on the coach's back-off load.
- **S3. Callers of `setWorkingCount` without load inputs still copy the top's kg as a back-off.**
  - The variation `set_count` op on a main lift: `packages/domain/src/builder/variation.ts:88`.
  - The fit calls at `fit.ts:153`, `:196` and `:269` (accessories only, so they're safe today).
  - The builder flagged the time-fit case.
  - Pass `ctx.loads(slot.exerciseId)`.

## Nits

- **N1.** At the item's lightest load (top 5 kg on a 5–100 stack, or 2.5 kg dumbbells), the back-offs get no load (`—`). This was already the case, but D4 makes every back-off land below the minimum. Consider the lightest load with fewer reps, or say so in `Why?`.
- **N2.** A back-off Ben typed stays above a lowered top (`builder-backoffs-d4.test.ts:199`: top 90, back-offs 92.5 and 85). Keeping his number is right, but nothing shows that it is now heavier than the top. Consider a `May hurt`-style flag (SP5).
- **N3.** The band is read from the profile goal at request time. If the goal changes while a draft is open, a later back-off edit uses the new band and the untouched back-offs keep the old one, so one slot can mix two bands.
- **N4.** The report's claims "A back-off is never at or above the top" and "Raising the top never raises back-offs" are not true as written (B2, B3, S1).

## Tests

- **Good:** the O1 domain and real-SQLite tests; idempotent replay, Undo and force-close for a lighter top; kg/lb, per-hand, stack max and assisted cases in the D4 domain test.
- **Missing:**
  - The ratchet (B1).
  - A top reps/RPE edit (B2).
  - Back-off feasibility at its reps and RPE (B3).
  - The coach stepping down from a typed heavier top (B1).
  - `Gym changed` agreeing with the edit path.
- **Wrong:** `builder-backoffs-d4.test.ts:61` asserts a 12 @ 6 back-off at a load Ben can't lift 12 times.
- **Loose:** the real-SQLite band tests allow 2.5 kg below the floor and never check an exact value, so they wouldn't catch a band applied from the wrong top.

## Spec issues

- **SP1. What the sanity band does when the reps/RPE load falls outside it.** D4 and SS4 call it a "sanity band", and HT8 calls E9's band "a sanity check". Neither says whether it clamps, warns, or changes reps. My recommendation is to clamp toward lighter only (B3). Ben should confirm.
- **SP2. HT8's "raising the top never raises back-offs" against the coach's load op.** **Resolved (Ben, 23 Oct):** §3.1 step 2 wins: when Ben asks the coach for a heavier or lighter top, the back-offs follow both ways by the same %, inside the D4 band, snapped down, never above the top. A top Ben types himself still never raises them (`followTop`). When Ben asks the coach for a heavier bench, should the back-offs follow? `workout-builder-v3.md` §3.1 step 2 ("every other set follows from the working load") says yes; HT8 says no. Ben needs to choose one.
- **SP3. HT8's precedence (1), "last comparable back-offs → their own HT7 decision", is not implemented.** D4 reads as formula-only. The training guide and D4 should be reconciled.
- **SP4. Goal → band mapping.** **Resolved (PM, 23 Oct):** `both` / not set → Balanced (`mainFocusOf`). `both` / not set → Balanced, and there's no Fitness band. The plan builder's Main focus (Strength / Muscle / Balanced / Fitness) isn't in the app yet. When it is, the band should follow the plan's focus. Ben should confirm, and the decision should be recorded.
- **SP5. SS4 says "back-off RPE is never above the top set's".** D4 doesn't mention it, and the builder lets Ben type it. Decide whether to block, cap, or allow it with a flag.
- **SP6. Mid-session.** HT8 lists Ben lowering today's top as a trigger, but logging a lighter top in the active workout doesn't move pending back-offs. Changing pending sets automatically needs a rule 2/3 call from Ben.
- **SP7. Doc updates for the design track.**
  - `workout-builder-v3.md` §3.1: step 2, the open "90 % vs 95 %" question in step 9, and the "next build 102.5 × 6 with back-offs at 95 × 8" example (now 92.5 for Muscle).
  - The one-format example `102.5 / 92.5`.
  - `plan-builder.md` §1a (line 57): the open "step lighter after `Still right`?" question, which D6 answers.
  - D4 and D6 need CHANGELOG entries.

## Other notes

- During this review another process briefly created untracked probes in this worktree (`zz-adv-probe.test.ts` under `apps/mobile/test`, `packages/coach/test` and `packages/domain/test`). They weren't mine, so I didn't touch them; they were gone before this commit, and the tree is clean.

## Fixes (23 Oct 2026, builder)

Commits: `a2818c6` (B3), `31d4aa7` (B1, B2, domain), `45474c3` (B1, the coach), `7a7c791` (real SQLite).
Every issue was reproduced first with temporary probes (domain and coach), which have been deleted. The numbers matched the review exactly: 95 → 85 → 75 with Gym changed back to 95; top 90 with back-offs at 95; 12 @ 8 and 15 @ 8 at 90; 97.5 after an easier back-off; a drop of 77.5 under a top of 70; the coach giving 92.5 and 85.

**One rule on every path.** A back-off Ben didn't type is now a function of the slot's top as it is now. It never depends on the edits before.
- `backoffTarget` (pure, `backoff.ts`): `built` is the back-off from its reps and RPE below `builtTop`, rounded down on the item. `builtTop` is the top worked out from the anchor at its own reps and RPE, rounded down here without the pain hold. The result is then `min(built, built × topNow / builtTop)`, rounded down. This is the review's formula and matches HT8's worked example, which scales the back-off as shown.
- `setRowsFor`, `reloadSlotLoads` (Gym changed), `recalcLoad` and `backoffFromTop` all use it.
- `settleBackoffs` runs after every `editSetRow`, `changeSetType` and `setWorkingCount` call that has load inputs.

| Issue | Status | What changed / why not |
|---|---|---|
| **B1** ratchet | Fixed | 100 → 110 → 100 gives 95 again, in every focus. Toggles never compound. A lighter top gives the same back-offs whatever came before it. Pain hold (cap 90): built 85; typing 95 gives 90; typing 90 again gives 85 (was 80). A seeded run of 300 edits per focus matches Gym changed after every edit. Saved and coach-built back-offs have no anchor, so they now carry `backoffFrom` (the top they were set for). It is an optional `DraftLoad.backoffFrom`, kept through the codec and a force-close, and Start ignores it. A saved 100/90 workout goes 80 → 70, then back to 100 → 90. Gym changed on an edited saved slot (`slotAtNewGym`, now given load inputs) settles the planned back-offs against the top Ben kept, so a back-off of 90 no longer sits over a top of 80. |
| **B1** coach | Fixed | `withWorkingLoad` first gives each back-off its basis (`withBackoffBases`), then settles. 'heavier' then 'set 100' gives 95 (was 92.5). Ben's typed 110, then coach 'set 100' or 'lighter' (107.5), gives 95 (was 85 / 92.5). 97.5 then 100 restores. |
| **B2** top reps / RPE / type | Fixed | Bench rule 100 × 6 @ 8. Top reps 6 → 10: top 90, back-offs 87.5 / 85 / 82.5 (Strength / Balanced / Muscle). Top reps 6 → 8, or RPE 8 → 6: top 95, back-offs 92.5 / 90 / 85. Gym changed agrees. With an anchor, "never above top × (1 − band.min), rounded down" holds by construction and is tested after every seeded edit. A back-off made Top works too. Real SQLite: top reps 6 → 10, and Start plans the back-offs at least 4 % below the top. |
| **B3** / MEDIUM-HIGH floor clamp | Fixed (SP1 still Ben's) | `backoffLoad` clamps only toward lighter. `belowBackoffBand` is a pure check with no UI copy. 12 @ 8 gives 85 and 15 @ 8 gives 80 in every focus. The wrong 12 @ 6 → 92 test now expects 82.6 (82.5 on the bar). Feasibility is tested for every focus, reps 3–15 and RPE 6–10. With a typed top of 115, re-entering 8 reps keeps 95. |
| MEDIUM (a) easier back-off got heavier | Fixed | With a typed top of 110: back-off reps 10 gives 90 (was 97.5); RPE 7 gives 92.5 (was 97.5). |
| MEDIUM (b) coach raise vs Ben's raise | Fixed toward HT8; **Ben to confirm (SP2)** | A heavier coach top now leaves the back-offs, as Ben typing one does. The coach's load still becomes the slot's anchor, so later reps or RPE edits follow it. If Ben prefers §3.1 step 2 ("every other set follows"), only `withBackoffBases` changes. |
| MEDIUM (c) coach reps guard | Fixed for the reported case | With a typed heavier top, the coach's "more reps" never raises a back-off (tested). Still true and not changed: with fewer reps and a typed top, the back-offs follow the formula from the same anchor (≤ formula top × (1 − band.min), and the pain hold), but the guard still checks only the top. |
| LOW-MEDIUM back-off RPE ≤ top's (SS4) | Not changed; **Ben** | The coach's `rpe` op sets one RPE on every working set, so only Ben's own typed RPE can break this. Blocking, capping or flagging his input is a product call that needs copy (SP5). SS4 is a candidate rule, and D4 approves its load part. |
| LOW typed back-off above a lowered top | Not changed; **Ben / design** | Ben's own kg is kept, as before. A `May hurt`-style flag needs design copy (N2, SP5). |
| LOW drop after the top | Fixed | A drop Ben didn't type follows the set it drops from whenever that set's load moves, in either direction, and is never at or above it. Top 100 + drop 77.5: typing 70 gives 52.5; typing 100 gives 77.5. This now also applies after Ben types a load on the set before a drop. |
| LOW coarse items | Not changed; **Ben** | With B3 fixed the band no longer pulls back-offs up, but its top edge still keeps them strictly below the top. On 2.5 kg dumbbells or a 5 kg stack that can be a whole step. At the item's lightest load nothing is lighter, so there is no load (`—`), as before D4. Options: allow equal-to-top on coarse items, or use the lightest load. |
| INFO chat-built back-offs | Partly | In Your workout they now follow the top by the same % and are never above it. `checkSlotLoads` still doesn't apply the band (S2). |
| INFO `setWorkingCount` without loads | S3 fixed for the plan variation's `set_count`. Fit calls left | The fit only changes accessory set counts, never the main lift. The coach's swap and add use it on new non-main slots. |
| INFO active workout, Ben's typed top with no source, CHANGELOG, §3.1 step 9 | Not changed | Respectively: SP6 (a rule 2/3 call for Ben); HT8 (2) needs a source and `est.` label decision; Ben's approvals are recorded by the PM; design track. |
| N3 band mixing | Mostly fixed | Any edit re-derives every untyped back-off in an anchored slot with the current band. A slot nobody has touched keeps its build-time band until an edit or Gym changed. |

**Behaviour changes to note:** a pain-held Muscle top now scales the back-off as shown. Built 90 under a top of 100, with the top held at 90, gives 80 (was 82.5).

**Found, not changed (outside this review):** `reloadSlotLoads` works an untyped top out from the anchor. When the rule yields to history (rule 100 × 6 @ 8, own est. max 140), the build plans 100 but Gym changed to the same bar gives a top of 102.5, with back-offs of 97.5. The same applies to an accessory's last set @ 9, which Gym changed makes heavier than the others. This needs its own fix and review.

**Checks:** `npm run typecheck` exit 0; `npm run lint` exit 0; `npm run test` 480 files, 8878 passed, 2 todo, exit 0.

## Re-review (fix round 1), 23 Oct 2026

**Verdict: PASS.** No blocking issues remain.

Scope: `c7b75ed..3a44b0e` (`a2818c6`, `31d4aa7`, `45474c3`, `7a7c791`, `3a44b0e`).

### Checks I ran

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test` (full suite) | 480 files, 8878 passed, 2 todo, exit 0 |
| Reviewer probe: one temporary domain test (top reps/RPE edits, a typed top then a reps edit, set-type changes, a back-off edit under a lowered top), deleted afterwards | Results below |
| Commit trailers | All five end with the required two lines |
| `docs/design/*` untouched; no UI copy changed; worktree clean | Yes |

### Blocking issues from round 1

- **B1 (ratchet): fixed.** Every untyped back-off in an anchored slot is now a function of the slot's current top. `backoffTarget` (`packages/domain/src/builder/backoff.ts:103`) calculates `min(built, built x topNow / builtTop)`, where `builtTop` comes from the anchor at the top's own reps and RPE. `settleBackoffs` (`packages/domain/src/builder/set-rows.ts:367`) runs after every `editSetRow`, `changeSetType` and `setWorkingCount` that has load inputs, and in the coach's `withWorkingLoad`. `reloadSlotLoads` and `setRowsFor` use the same helper, so the edit path and Gym changed can't disagree. The 300-step seeded test checks that against Gym changed after every edit, in each focus. Saved and coach-built back-offs have no anchor, so they carry `backoffFrom`. It is optional in `DraftLoadSchema`, so older drafts still parse. It is kept through the codec and stripped wherever a back-off is re-derived or typed (`editSetRow`, `reloadSlotLoads`, `timedLoadsHere`, `slotAtNewGym`). The real-SQLite test covers replaying the same op ID, a stale basis, a force-close and Start.
- **B2 (top reps/RPE): fixed.** My probe matched the claims: top reps 6 -> 10 gives top 90 with back-offs 87.5 / 85 / 82.5 (Strength / Balanced / Muscle). In an anchored slot, "never above top x (1 - band.min)" holds by construction, and the seeded test asserts it.
- **B3 (band floor): fixed.** `backoffLoad` (`backoff.ts:59-63`) now clamps only toward lighter. The old test now expects 82.5, and a feasibility sweep covers reps 3-15 and RPE 6-10 in every focus.
- The round-1 MEDIUM (a), MEDIUM (b), MEDIUM (c) and LOW drop findings are fixed as the fix note says, and each one is tested.

### Should fix (not blocking)

1. **A top reps or RPE edit that makes the top heavier can still raise the back-offs. Ben typing a heavier top, or the coach raising it, never does.** In my probe (Muscle, top 100 x 6 @ 8, back-offs 90), top RPE 8 -> 9 gives top 102.5 with back-offs 92.5. Top reps 6 -> 4 gives top 105 with back-offs 95. The band's top edge moves with `builtTop` (`set-rows.ts:374`, `builtTopOf(anchor, top, ctx)`). Both loads are feasible for their reps and RPE (95 x 8 @ 8 is exactly what the est. max gives), so this isn't a safety problem. It is consistent and doesn't depend on edit history. It is, though, a third reading of HT8's "raising the top never raises back-offs". Fold it into SP2 for Ben. If he wants HT8 to apply here too, measure the band's top edge from the top as first built.
2. **`belowBackoffBand` (`backoff.ts:70`) has no production caller.** The "lower edge is a check" exists only in tests. That is acceptable until Ben answers SP1, but either wire it to a Why? note or remove it once he does.
3. **Edited slots at a new gym re-derive back-offs from the anchor (`from-planned.ts:268`).** When `planned.anchorE1rm` isn't null, `settleBackoffs` replaces the planner's back-off loads with the builder's formula. That only happens for a slot Ben edited; an untouched slot keeps the planned rows. Today `plannedAsDraftPlan` sets `anchorE1rm: null` (`from-planned.ts:195`), so this isn't reachable now. It becomes a mismatch if a planned anchor is ever added.
4. **Pre-existing, found by the builder and confirmed as outside this diff.** When the rule yields to Ben's history, `reloadSlotLoads` derives an untyped top from the anchor, so Gym changed to the same bar gives a top 2.5 kg heavier (102.5) than the build planned (100). It is deterministic and snapped to the bar, but it should get its own ticket and review.

### Nits

- With Ben's typed top of 110 and the top reps then set to 10, the back-offs drop to 87.5 / 85 / 82.5. They are worked out below the top at 10 reps from the est. max, while the typed 110 x 10 stays. That is consistent with "never raised by a heavier top", but Ben may find it odd. No change needed.
- The coach `reps` op still sets one rep count on the top and every back-off (pre-existing).

### Spec issues (carried, for Ben)

- SP1: what the band's lower edge means (a check, not a clamp, as implemented).
- SP2: whether a heavier top, from the coach or a top reps/RPE edit (item 1 above), raises the back-offs. Workout-builder-v3 §3.1 step 2 conflicts with HT8 here.
- SP5: back-off RPE above the top's (SS4), and a typed back-off above a lowered top. Both need a flag and copy.
- Coarse items (2.5 kg dumbbells, 5 kg stacks): back-offs a whole step below the top, or no load at all at the item's minimum.
- The active workout: a lighter logged top doesn't move the pending back-offs.
- D4 and D6 still need CHANGELOG entries, and workout-builder-v3 §3.1 step 9 still needs its update.

## Resolved by Ben's 23 Oct follow-up decisions

- SP2: **Resolved (Ben, 23 Oct):** §3.1 step 2 wins: when Ben asks the coach for a heavier or lighter top, the back-offs follow both ways by the same %, inside the D4 band, snapped down, never above the top. A top Ben types himself still never raises them (`followTop`).
- SP4: **Resolved (PM, 23 Oct):** `both` / not set → Balanced (`mainFocusOf`).
