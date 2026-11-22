# Review: builder loads from history (branch `claude/builder-loads-21oct`, diff vs 39b91f3)

**Verdict: CHANGES NEEDED**

Ben's report (Build B): a new Back day built through Set up → Next: exercises (or Describe the workout, which only fills Set up, so the loads come from `builder-env` too) set barbell row targets far too light, even though his recent 80 × 12 @ 6 and 90 × 12 were known. In his words: "It knew my history but wasn't using it."

## Checks run

- `npm run typecheck`: clean (exit 0).
- `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: clean (exit 0).
- `npx vitest run --maxWorkers=2`: 454 files, 8473 passed, 1 todo, 0 failed. The developer reported 455 / 8479; the counts differ slightly but nothing fails.
- I ran a scratch probe (not committed) through the real `loadReferences → nextTargetsFor → ruleAnchorOf → setRowsFor` path with a 20 kg bar and a standard plate set. Main lift: 1 top × 6 + 3 back-offs × 8.

| History | Rule decision / anchor | Source | Built rows (top / back-offs) |
|---|---|---|---|
| A. Ben: FitNotes 3×60×10, then Fri top 80×12@6 + 70×12, Sat top 90×12 + 80×12 | increase 92.5, anchor 92.5×3@8.5 | calc | 97.5×6 / 92.5×8 ✔ |
| C. 3 × 100×6 @8 (plain working sets) | increase 102.5, anchor 102.5×3@8.5 | rule | 102.5×6 / **87.5×8** |
| F. builder format: top 100×6@8, back-offs 3 × 95×8 | increase 102.5 | rule | 102.5×6 / **87.5×8** (did 95×8 last time) |
| D. 3 × 100×5 @8 | hold 100 | rule | 100×6 / **85×8** |
| B. 2 × 90×12, 20 days ago | hold 90 | rule | 90×6 / **77.5×8** (the est. max after the gap cut gives 85×8) |
| H. builder format top 90×12 + 80×12, 20 days ago | increase 92.5 | rule | 92.5×6 / **77.5×8** |
| E. 3×100×8, then two sessions of 3×70×10 (his own lighter choice, no pain flag) | increase 72.5 | calc | **100×6 / 95×8** |

Ben's exact case is fixed. But the same defect class (back-offs derived low from the rule's rep floor) is still present in every case where the 90 % override doesn't trigger. That includes the builder's own default format (case F) and the spec's own worked example (§3.1.2: top 100×6 @ 8 means back-offs at 95×8).

## Blocking

**B1. Back-offs are still derived from the rule's 3-rep floor, so they come out about 8–10 % light. This is the "wrong rep target so load estimated down" failure mode.**
`packages/domain/src/builder/loads.ts:134` (`ruleAnchorOf` sets `reps: s.reps.min`, which is 3 for `main_barbell` 3–6) and `:96` (rule loads are used as is for the top set, and the other sets derive from the anchor's e1RM).
- **Failure scenario.** Ben logs the builder's own Pull day: top 100×6 @ 8, back-offs 3 × 95×8. The next new Pull day builds top 102.5×6 with back-offs at **87.5×8**, 7.5 kg below what he just did. Case D (100×5 ×3 @ 8) gives back-offs at 85. After a 14–20 day gap (cases B and H), back-offs are 77.5×8 after 90×12 / 80×12. That is lighter than even the gap-cut estimate (85).
- **Why it matters.** The 92.5 load is the rule's target for 3–6 reps, and the builder uses it for 6. Treating it as a 3-rep @ 8.5 effort understates the e1RM by about 10 %. Fix 2 only rescues Ben's case because that understatement pushes the anchor under the 90 % threshold, so the outcome depends on the threshold rather than the rule.
- **Suggested fix.** When a rule load is used as the top set at N reps, derive the other sets from the e1RM of that load at the reps it is actually used for: `anchor.reps = set reps` for the top set, or the rule range max when the rule progressed from hitting the top of the range. Or derive back-offs from the greater of that and the gap-cut history e1RM, never heavier than the top set. Add tests for cases C, D, F and B/H asserting back-offs ≥ last session's back-off load (when not a miss or reduction) and ≥ the gap-cut est.

**B2. Plan loads still override fresher history on plan days started from Today.**
`apps/mobile/src/services/today-session.ts:328` (`planFirstLoad: … anchorOf(fromPlan)`, never `yieldsToHistory`).
- **Failure scenario.** Ben accepts a plan on Monday whose week-1 row load came from older 60 kg history. He logs 90×12 on Saturday, then starts the plan day from Today. It still prescribes the plan's 60-based load. The developer flags this as "left open", but the acceptance bar for this fix is that plan/template loads never override fresher history on any new-workout path.
- **Suggested fix.** Mirror the `newerThanPlan` check in `builder-env.ts:219` in the Today path: the plan version's `createdAt` against `refs.latest.performedAtUtc`. Add a mobile test that starts a plan day from Today after a newer, heavier session.

## Should fix

**S1. The override estimate is the best set from the last 3 sessions, not the last session, so it undoes a deliberate drop in load.**
`packages/domain/src/builder/loads.ts:111` uses `input.e1rm` (`ownReferenceOf`, `session/builder-loads.ts:219`, max over 3 sessions / 180 days).
- **Failure scenario (case E).** Ben drops himself from 100×8 to 70×10 for two sessions (technique reset, a niggle he didn't flag). The rule says `increase_load` 72.5, which yields, and the new workout jumps straight back to 100×6 / 95×8. Only rule reductions (`reduce_load`, `hold_after_miss`) and pain are protected; Ben's own lighter choice isn't. The brief asks for "last session's working sets … progressed by the deterministic rules".
- **Suggested fix.** Use the e1RM of the latest comparable session (or require the driving set to be from it) for the override. Keep the 3-session max for the coach's ceilings only. Add a test.

**S2. The rule reads other bars of the same mass (fix 3) only in the builder.**
`apps/mobile/src/services/today-session.ts:309` (`substituteTargets` is called without `comparableEquipmentIds`).
- **Failure scenario.** Summary "Next time", Today and swaps still plan from the exact item, so Today can plan from older, lighter history that the builder now ignores. The same lift then gets two different "next" loads, and the developer report's claim that all callers "pick this up" holds only for fix 1.
- **Suggested fix.** Thread `comparableEquipmentIds` through `substituteTargets` / `NextTargetsInput` at every rule call site, or compute it inside `nextTargetsFor`.

**S3. The rule anchor's RPE differs between the builder and Today.**
`builder/loads.ts:132-134` uses the rule's `maxRpeToProgress` (8.5, an upper limit to progress, not a target). `today-session.ts:313` uses `planned.rpe ?? 8`. The same rule load therefore implies different e1RMs, override decisions and derived sets depending on the entry path. Pick one: the rule's target RPE (`builtInTargetRpe`) everywhere.

**S4. Fix 1 judges builder-format sessions on the back-offs but plans from the top set.**
`packages/domain/src/progression.ts:485`, `:625`. Lighter back-offs make "every counted set reached the top of the range" easier to satisfy, and the progressed load is then the top-set load for **all** `workingSets` wherever the rule's load is used as a working load. Examples are Today on a plain working-set routine and the coach-chat `propose_workout` rule fallback in `session/coach-draft.ts`, which I did not verify end to end. Ben's case: top 90×12 + 80×12 back-offs → 3 × 92.5 working sets, a 15 % jump in sustained load. Either judge only the top set for the increase, or plan working-set slots from the back-off load. Add a Today-path test.

**S5. The end-to-end test does not check the Why text.**
`apps/mobile/test/builder-history-loads.test.ts:97` asserts only `why.length > 0`. It should assert the line reads `Est. max … (estimate)` (rule 6), and that a rule-sourced slot's Why names the session the load came from (the developer's known gap: `builder-service.ts:1098`, `ruleLine(env.lastTopOf…)`).

**S6. The design doc was not updated.**
`docs/design/workout-builder-v3.md` §3.1 still documents the old Q12 order, with no history override and no `HISTORY_WINS_SHARE`. The code now diverges from the spec silently. See Spec issues.

## Nits

- N1. The gap test (`packages/domain/test/builder-loads-history.test.ts:211-216`) pins top 90 but not back-offs, which are 77.5 (B1). Once B1 is fixed, add a back-off assertion.
- N2. `RULE_YIELDS` includes `hold`, which also covers "reps hit but effort above the limit". A hold driven by a too-hard last session can still give way to an e1RM from that same session. At 0.9 this didn't trigger in my probes; worth a test.
- N3. `ruleYieldsToHistory` and `RULE_YIELDS` live in `builder/loads.ts` but are decisions about the progression rule. `progression.ts` is the more natural home.

## Product rules

- Rule 2 (completed sets): untouched. Rule 4 (equipment max): holds; the override is rounded down and capped (tested). Rule 9 (pain): `halted_pain` never yields and `painCap` still applies (tested). Rule 5 (idempotent and versioned writes): no write paths changed, and `historyVersion` still drives the Start re-derive. Rule 6 (no invented data): the override shows as `calc` / estimate. Rule 1 (offline): pure local code. Security and privacy: no new logging, credentials or imports.
- Rule 3 / ADR 0006: the built-in rule's load is no longer "used as is" whenever it yields. That is a change to the approved fallback and needs Ben's approval (see below).

## Spec issues

1. **Q12 order and `HISTORY_WINS_SHARE` (0.9) are unapproved.** Fixes 2 and 4 put "est. max from his own recent sets" ahead of the rule and the plan when those are more than 10 % lower. §3.1 and Q12 still say coach → plan → rule → est. max. Ben's report implies he wants this, but he hasn't approved the order change or the threshold. It needs his decision, a CHANGELOG entry and a §3.1 update. It also needs an ADR 0006 amendment, since the rule's load is no longer authoritative when it yields.
2. **The §3.1 spec doesn't say what reps and RPE a rule load "means" when the builder uses it at a different rep count.** The rule is 3–6 reps; the builder top set is 6 and the back-offs 8. Review B3 ("used as is, other sets derive at the rule's reps") produces B1. The spec should state that derived sets come from the reps the rule load is used at.
3. **Which history counts is unspecified.** Is it "last session" (the brief's wording in this report) or the existing "best of the last 3 sessions"? S1 depends on that answer.
4. **Unchecked against real data.** Nobody has checked whether Ben's stored rows use the same `exerciseId` as the catalogue's Barbell row. History is matched by exact exercise ID, so a mismatch would hide all of it. This needs a check on his device data before claiming the bug is fixed.

## Fixes (developer, 21 Oct)

- **B1.** `builderLoad` no longer derives other sets from the rule's 3-rep floor. When the rule's load is the top set, back-offs come from the e1RM at the reps and RPE that set is used at (`ruleDerivedE1rm`). When the rule yields and the last session's gap-cut est. max is higher, that is used instead, capped so a set of one more rep at the same RPE is never heavier than the top set. A reduction never borrows the higher estimate. The override test still reads the rule load at its floor and target RPE, so Ben's case is unchanged (97.5 × 6 / 92.5 × 8). Re-run on the probe cases: C 102.5 / 95, F 102.5 / ≥ 95, D 100 / 95, B 90 / 85, H 92.5 / 87.5. Tests are in `packages/domain/test/builder-loads-history.test.ts`, including the N1 back-off assertion on the gap test.
- **B2.** On Today, a plan workout's first loads (`planFirstLoads`, coach scope `build`) are read as the plan's week-1 loads, as `builder-env` reads them. They give way to newer, heavier history (`planAnchor`: the plan version's `createdAt`, falling back to Apply's time, against `refs.latest`). Before this they were classed as coach targets, which never give way. Test: `today-session.test.ts`, "builder-loads review B2". It fails with the yield turned off.
- **S1.** The override and the B1 floor read the newest comparable session's e1RM only (`lastSessionE1rm` → `SlotLoadInput.lastE1rm`). The best-of-3 `e1rm` still drives the no-anchor estimate and the coach ceilings. Case E now builds a top set of 75 or less with back-offs of 72.5 or less, not 100 / 95.
- **S2.** `substituteTargets` passes `comparableEquipmentIds` from `comparableSessions`, which covers Today's rule load, swaps and adds. Summary "Next time" and `planFor` plan on the item just used, whose session is the newest anyway, so they are unchanged.
- **S3.** Today's rule anchors (own rule and the dry run's) use `builtInTargetRpe(ruleCategory(...))`. That is the value `ruleAnchorOf` gives for the built-in rule (main barbell 8.5).
- **S4.** When the session the rule planned from is builder-format, double progression plans its first working set at the progressed top load and the rest at the back-off load moved by the same step. They are rounded toward easier and are never harder than the first set (`builderFormatOtherLoad`, with a fact behind Why?). Ben's case gives 92.5, 82.5, 82.5, not 3 × 92.5. Judging is unchanged: top and back-offs.
- **S5.** The end-to-end test asserts `Est. max … kg (estimate) · 6 reps @ RPE 8`. A new end-to-end case covers the builder format (100 × 6 @ 8 + 95 × 8 → 102.5 × 6, back-offs ≥ 95), with Why? `Last time + 2.5`.
- **S6.** `docs/design/workout-builder-v3.md` §3.1 now describes the implemented order and is marked PROPOSED, awaiting Ben.
- **Not done (need Ben):** approval of the order and the 90 % share, the CHANGELOG entry, and the ADR 0006 amendment. Also still open: whether "recent history" means the last session or the best of 3, and the exercise-ID check on Ben's device data.
- **Seen while testing, not investigated:** a builder workout whose main lift had no load at all (no history) seemed to log rows the next build didn't read. The new end-to-end case seeds plain history first to avoid it. This may be an equipment-ID-less session being skipped by `comparableSessions`, and it is worth a check.

---

# Reps follow-up (commits a8402b4..32a72fa)

**Verdict: CHANGES NEEDED**

The rep range now follows Ben's last session on every new-workout path, and the shrugs case is fixed: 30 × 15 now plans 32.5 kg × 12 (range 12–15), not 8. Two problems block it. First, the broadened "Ben asked" gate turns plain statements into applied changes. Second, the builder's planned reps stop progressing after the first load step.

## Checks run

- `npm run typecheck`: exit 0. `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: exit 0.
- `npx vitest run --maxWorkers=2`, per package:
  - domain: 155 files, 3252 passed.
  - coach: 39 files, 2190 passed.
  - mobile: 198 files, 2218 passed, 1 todo.
- Probes:
  - A throwaway domain test (deleted, not committed) ran `slotLoads` → `makeSlot` and `nextTargetsFor` on these histories: high-rep, low-rep, mixed, two-set, 200-day gap, deload after heavy, 30 reps, equipment max at 15 and 20 reps, pain flag, a barbell row as main and as secondary at 12 and 20 reps, and assisted at 12 and 6.
  - It also ran an 8-week loop in which Ben does exactly what the builder plans.
  - A throwaway coach test called `quoteAsks` / `verifyAsked` / `liftTargetAsked` on realistic statements.

## Blocking

**B1. The correction cue makes plain statements count as "Ben asked", for every today tool and for `set_lift_target`.**
- Where: `packages/coach/src/intent.ts:82` and `:98`.
- What's wrong: `CORRECTION_CUE` matches bare `last time`, `wrong`, `mistake` and `i did|got|hit`. It's checked inside `quoteAsks`, which `verifyAsked` uses for all tools: `edit_today` with structural ops (`setsOnly: false`), and `liftTargetAsked` (`lift-target.ts:72`).
- Probe results: each of these is now `asked: true`, and each was a statement before this branch.
  - "Squats felt heavy last time"
  - "Done, I did all the reps"
  - "My knee felt wrong on squats"
  - "I did 100 kg on bench last time, felt strong", which as `set_lift_target` sets a lasting lift target.
- Failure: Ben says "Done, I did all the reps". The model raises a load increase or a swap on its own and quotes his words. It is applied immediately instead of offered ("Want me to adjust?"). That breaks rule 3, and the review S3 / ADR 0027 statement-vs-request split no longer holds.
- Fix:
  - Scope the cue to `edit_today` calls with `setsOnly === true`, and never `set_lift_target`.
  - Require a real contradiction about a target: a number plus "I did / I got / should be / last time" in a question or objection about a planned value (e.g. `/\b(?:i (?:did|got|hit|do)|should be|supposed to be)\b[^.?!]*\b\d+\b/`). Drop bare `wrong`, `mistake` and `last time`.
  - Add negative tests for the four statements above.
  - Ben still has to approve this rule-3 change (developer's item 3).

**B2. After a load step, the builder's plan never adds reps. Double progression stalls at the Epley rep count.**
- Where: `packages/domain/src/rep-range.ts:116` (`aimReps`: `hold` returns `last`), and the single-count rows in `builder/set-rows.ts:84` / `codec.ts:77`.
- Probe (shrugs, rack, Ben logs exactly what is planned at RPE 8):

  | Week | Decision | Plan |
  |---|---|---|
  | 1 | `increase_load` | 32.5 × 12 |
  | 2 | `increase_load` | 35 × 9 |
  | 3–8 | `hold` | 35 × 9 every week |

- Why it stalls: inside the goal range the rule's decision is `hold` ("work toward 12"), not `increase_reps`. `aim` = last reps, and the builder writes a fixed `{min: 9, max: 9}` target.
- This is the opposite of requirement 1 ("add reps up to the top of the range, then load") and of the developer's claim "double progression then runs on that range". Today (non-builder) shows 8–12, so only the builder, plan-day and Start paths stall, and those are the main new-workout paths.
- Fix:
  - On `hold` where the last session's effort was within the limit (or not recorded) and reps were below the top, plan `min(range.max, last + 1)`.
  - Repeat `last` only when effort was over the limit.
  - Add a multi-session loop test like the probe that asserts reps rise to the top, then the load rises.

## Should fix

**S1. At equipment max, "toward goal" cuts reps while the load can't rise.**
- Where: `packages/domain/src/rep-range.ts:81-84` and `next-target.ts:78`.
- Failure: the short rack has a 30 kg max, and he did 30 × 20. The plan goes 30 × 18, then 16, then 15. Each session is fewer reps at the same load, so he regresses. (At 15 reps it correctly holds 30 × 15.)
- Fix: when the rule's next step is `at_max`, `jump_too_big` or `no_assistance_left`, don't move toward the goal; treat it like bodyweight (`loadable: false`). Add a test.

**S2. A main lift's reps and load still contradict history outside the builder.**
- `ruleRepsFact` returns null for `fixed` (`rep-range.ts:131`). So Today, Summary "Next time" and `get_progression_targets` show a main barbell lift at 3–6 with nothing saying he did 12 or 20. Only the builder's `slotRepsWhy` says it.
- The main-lift loads don't match his reps either. Barbell row as the main lift after 40 × 20 plans a top set of 42.5 × 6 and back-offs of 40 × 8, against an Epley e1RM of about 66 kg. Requirement 1 says the load must match the reps.
- Fix: add a `fixed` fact when last is outside the range (`Last time 12 reps · 3–6`). When last is far above the scheme's reps, derive the top set from the last-session e1RM rather than the rule's +step load (or cap the gap). Test both.

**S3. `get_progression_targets` doesn't show what the builder uses.**
- Where: `apps/mobile/src/coach/coach-service.ts:849-866`, `domain/src/coach/training-view.ts:608`.
- The view carries no `reps.last`, kind or Why? fact. It plans on the latest session's own context with no `accessory` reading, so a barbell row used as a secondary lift reads 3–6 to the coach and 9–12 in the builder.
- Requirement 2 asks for the same numbers. A coach that sees 3–6 can "correct" the builder's 9–12 back down.
- Fix: add `lastReps`, `aim` and the rule fact to the view, and pass `accessory` when the exercise isn't the session's main lift.

**S4. The coach-admits-wrong path is enforced only by instructions, and the test can't fail.**
- Where: `packages/coach/test/target-correction.test.ts:349-372`. The fake model is scripted to call `edit_today`, so the test passes whatever the instructions say.
- The real failure ("Nothing changed · 1 line hidden") is `reply.ts:69`: a change-claim sentence was hidden and nothing was committed. The developer didn't diagnose which happened in Ben's turn (no tool call, or a refused or offered call).
- Given the `claude/coach-fail-21oct` constraint, this isn't blocking.
- Fix: record the root cause from Ben's turn log if it's available. Add a deterministic fallback that doesn't touch tool forcing: when the claim note would say "Nothing changed", Ben's words contradict a planned target for a named today exercise, and the rule's from-history target differs, attach that target as an offer (Apply/Undo). Or hand the case to the coach-fail branch explicitly.

## Nits

- N1. With two working sets, the lower median is the lower set: [15, 8] plans 30 × 8. Consider the upper median, or the best set when there are only two.
- N2. Only the newest session counts. A light deload (15 × 20 after 35 × 10) moves the plan to 15 kg × 18 "toward goal". A 200-day gap still plans an increase (32.5 × 12). Both follow the requirement's wording, but they're worth a Why? or a gap guard (see the spec issues).
- N3. Tests don't cover the pain flag together with history in the builder (the probe shows `halted_pain` correctly holds 30 × 15), the two-set case, the gap, the deload, or a multi-session sequence (B2).
- N4. The lb probe in my throwaway file didn't pick up history (my fixture, probably). The developer's lb test passes. Not a finding, noted for completeness.
- N5. Personalised rules keep the built-in rule's ID and version with a different range and name. Provenance stores name and facts, so Why? stays right. But "rule vN" no longer pins one rep range. Note it in the ADR amendment.

## Product rules

- Rule 2: untouched. The test shows done sets unchanged and Undo restoring 8–10.
- Rule 4: holds on the max-load cases (30 × 15 is never exceeded).
- Rule 5: a stale edit is refused (tested). No write paths changed.
- Rule 9: `halted_pain` holds the load (probed).
- Rule 1: pure local code, offline unaffected.
- Rule 3: broken by B1.
- Rule 6: Epley "same effort" reps are an estimate. They're shown only as a planned count, which is acceptable.
- No secrets, no new logging.

## Spec issues

1. **Plan days now override a plan's prescribed reps with history** (`today-session.test.ts`: the plan says 6–8 and the row plans 9–12). Requirement 2 asks for this. But a coach-built plan Ben applied (e.g. a strength block on 5s) is quietly replaced for every non-main slot. Ben should decide whether an applied plan's reps outrank history the way his own routine rules do.
2. **"Most recent session" versus deloads, gaps and best-of-3** is still open (see N2 and the earlier spec issue 3).
3. **Unapproved rule numbers**: the width of 3, the cap as "wildly outside", the 2-rep step, Epley reps, the lower median, the unbounded bodyweight range, and stale plan loads always yielding. They need a CHANGELOG entry and ADR 0006/0010 amendments before merge (the developer's own list).

## Fixes (reps follow-up)

Commits 2bd2044, 438c0c0, 9ce15c2, 1f4c8d8 on `claude/builder-loads-21oct`.

- **B1 fixed** (`packages/coach/src/intent.ts`). The correction cue is gone from the general request check. `quoteCorrects` counts only for a sets-only `edit_today` (`setsOnly === true`), never a structural edit, `rename_workout` or `set_lift_target`. It needs a number in the quote after "I did / got / hit / should be / supposed to be" ("I did 15", "should be 12"), and an objection in his message: a question mark, "why", "only", "wrong", "mistake", "but", "instead of", "should be", or a second, different number. Bare "last time", "wrong", "mistake" and "I did" no longer count. Negative tests in `packages/coach/test/target-correction.test.ts` cover the four review sentences on `edit_today` (sets-only and structural), `set_lift_target` and `rename_workout`, plus `liftTargetAsked`. A real correction on a structural edit or a lift target is now offered, not applied.
- **B2 fixed** (`packages/domain/src/rep-range.ts`, `progression.ts`, `next-target.ts`). On `hold`, `aimReps` plans last + 1 up to the top of the range when every judged set was within the effort limit or had none recorded (`latestJudgedSession` now returns `effortOk`). Effort over the limit repeats last time's reps. A pain hold (`halted_pain`) never adds reps (rule 9). An eight-week loop test (Ben does exactly what's planned at RPE 8) asserts that every week either adds a rep at the same load or raises the load, that reps reach 12 at 35 kg, and that the load then rises: 32.5 × 12, 35 × 9, 10, 11, 12, then 37.5 × 9 …
- **S1 fixed** (`next-target.ts`). When the toward-goal range would cut reps but the load can't rise (`increase_reps` / `ceiling_reached`, which come from at max, jump too big or no assistance left), the range is re-read as on bodyweight (`history`, `last − 3 … last`), keeping the loaded rep cap. 30 × 20 on a 30 kg rack now holds at 30 × 20 for three sessions (test). The same applies to 20 kg × 25, where 22.5 kg is a jump over 10%: it holds at 25 instead of 23. The rule's existing ceiling message still suggests a substitution.
- **S2, partly fixed.** `ruleRepsFact` now returns `Last time 12 reps · 3–6` for a `fixed` range his last reps were outside. Today, Summary and `get_progression_targets` show it behind Why?. **Not fixed: the main-lift load against his reps.** Deriving the top set from the last-session e1RM means a jump far above the rule's 10% limit (40 × 20 → about 55 kg for 6). Capping it at the rule's 10% gives the same 42.5 kg as today. Both options need a new number from Ben: how big a step is allowed, or whether a main lift with history far above its scheme should run on the compound reading instead. Left for Ben.
- **S3 fixed.** `secondaryMainLifts` (domain, `session/gym-switch.ts`) reads every main barbell block after the workout's first main barbell lift as a secondary lift (`accessory: true`). This applies to the Summary's `Next time` (`summary.ts`) and to `builtInNextTargetsOf` (Start next session, `get_progression_targets`). The builder puts the main lift first, so a row after squats reads 9–12 everywhere. `builtInTargetsView` now carries `lastReps`, `plannedReps` (the builder's count, `RuleReps.aim`) and `why` (the rule's summary plus the reps fact). Tests: domain unit tests for the helper and the view, and a mobile end-to-end read in `coach-reads.test.ts`.
- **S4: handed off.** The fake-model test is retitled to say it checks the code path once the model calls `edit_today`, not the model's behaviour. An `it.todo` records the deterministic fallback (an apology with no tool call offers the rule's from-history target with Apply/Undo) for `claude/coach-fail-21oct`, so `reply.ts` and tool forcing aren't touched here. Root cause of Ben's turn: not diagnosed. No turn log is available in this worktree.

Checks after the fixes:
- `npm run typecheck`: exit 0.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: exit 0.
- `npx vitest run --maxWorkers=2`:
  - domain: 155 files, 3260 passed.
  - coach: 39 files, 2191 passed, 1 todo.
  - mobile: 198 files, 2218 passed, 1 todo.

Still open for Ben (unchanged): spec issues 1–3 above, and the new numbers this follow-up adds. Those are the +1 rep on a hold, the effort gate on it, the first main barbell lift counting as the main lift, and the hold at max on a toward-goal history. All need the CHANGELOG entry and the ADR 0006/0010 amendments before merge. The Summary now reads secondary main barbell lifts the builder's way, which is a visible change to `Next time` that Ben should confirm.
