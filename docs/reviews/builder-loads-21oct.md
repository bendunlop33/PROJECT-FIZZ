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
