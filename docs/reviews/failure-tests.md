# Review: competitor-failure acceptance pack (opportunity 2) and its fixes

**Verdict: CHANGES NEEDED** (second pass, 2026-10-10). One blocker: the new (b) matrix test exceeds Vitest's 5 s default timeout during a full `npm run check`, so the gate fails in most runs (B1). The three should-fix findings, three nits and three spec issues from the first pass still stand and have been re-verified. Spec issue SP1 needs Ben's decision before the first real workout.

The first pass (commit `195f1c5`) said PASS with a clean `npm run check`. That run must have been on a quieter machine. The second-pass results are below.

Reviewed: `claude/gracious-knuth-joxqpw..claude/failure-tests` (6 commits, `8edd4ee`..`3cd0aad`):
- `8edd4ee`: with no machine profile, the built-in rule no longer cuts assistance to 0.
- `bb2a5f3`: routine Start drops the load target when the routine's equipment isn't at this gym.
- `88a0196`: `discardConfirmation(state)` in the domain, used by the workout menu and the finish sheet.
- `ba101a3`, `bc622e1`, `3cd0aad`: `packages/domain/test/competitor-failures.test.ts` and `apps/mobile/test/competitor-failures.test.ts`.

Specs read: CLAUDE.md (rules 2–6, 9, 10), the brief ("Validation before claiming it is better", §10 additional scenarios, §12 targets), `competitor-landscape.md` opportunity 2 and its evidence (LiftTrack, Fitbod, MacroFactor, Hevy, JuggernautAI), `active-workout.md` §2.11, §4.8, §4.9, `today.md` §4, `routines.md` §2.2, §2.4, `workout-summary.md` §3, `exercise-library.md` §4.2, `equipment-aware-progression.md` EQ7, `playbook-v1.md`, and `slice-3-and-s1.md` B1.

## What I ran (second pass)

| Check | Result |
|---|---|
| `npm run check` in the worktree, 3 runs, plus 1 full `vitest run --reporter=verbose` (load average 6–14; other agents share the 4 cores) | **Failed in 3 of 4 runs.** `(b) next targets (built-in rule): every decision…` timed out each time (measured 5.96 s and 6.89 s against the 5 s default). The one clean run was at load average 7. `catalogue/test/definition.test.ts` D11 also timed out once. D11 isn't in this diff, so it's a pre-existing flake (noted, not counted against this branch) |
| The same (b) test run alone | Passes in 2.8 s, which is already more than half the budget |
| Scratch probe (temporary test file, deleted afterwards, never committed): 0 kg history, no equipment, `doubleProgression()` | Confirms M2: `hold 0 kg`, `hold_after_miss 0 kg each`, `0 kg stack`, `assist 0 kg` (from every shape) |
| Re-read M1 and M3 against the code | Both still apply as written. `startWorkout` matches routine equipment only by `rex.equipmentId` (`create.ts:154-161`), while `repeat.ts:56-63` `pickEquipment` falls back to the same kind. `app-services.ts:291-292` `sessions.discard` still has no confirmation |

## What I ran (first pass)

| Check | Result |
|---|---|
| `npm run check` in the worktree | Clean: typecheck, lint, 91 test files, 1259 passing, 2 todo, catalogue validate, guide check 10/10 |
| Revert `8edd4ee` in a scratch copy, then run the pack | 2 tests fail (the `(b)` regression and the no-equipment matrix). The test catches the bug |
| Revert `bb2a5f3` in a scratch copy, then run both packs | 1 test fails (routine Start at five gyms). The test catches the bug |
| Scratch probe: no-equipment history at 0 kg through `calculateNextTargets` | `Stay at 0 kg`, `0 kg each`, `0 kg stack`, `assist 0 kg` (finding M2) |
| Scratch probe: real-SQLite Repeat of Leg press 140 kg and Assisted pull-up assist 20 kg (both logged with no equipment) at a `home_dumbbells` gym | Planned `140 kg added` and `assist 20 kg`, with `equipmentId: null` (spec issue SP1) |
| Diff check: forbidden files (design-system, guides v2, `figure/*`, `guide/*`, FitNotes import) | None touched. The CSVs are synthetic. There's no `console.*` and no secrets |

All scratch copies were outside the repo and have been deleted.

## What is solid

- **Fixes go in the domain, with tests that fail without them.** The assisted zero guard sits in `nextHarderLoad` and keeps a reason (`the next step would leave no assistance`, rule 3). The routine-Start drop reuses the `target_dropped` warning, so the template value stays visible. `discardConfirmation` replaces two hand-written counts in the UI.
- **The `(b)` matrix is a real one.** It covers every equipment kind in kg and lb, gaps, add-ons, maxima and a single horn. It runs every decision shape, four rules plus top set and back-off, with and without pain, from loads on, between, below and above the steps. It also checks starting loads, `planTemplateLoad` and the keypad steps. More than 5,000 loads are checked, and the count is asserted.
- **Durability is exercised on real SQLite.** Force-close and relaunch are covered for (a), (d), (e) and (f). A pending rest alert keeps its fire time through corrections, a delete and a relaunch. A Discard confirmation shown before a lock-screen log is refused as `stale_version`, and the rows survive the relaunch. A repeated delete with the same `opId` is a no-op.
- **Rule 5:** the confirmation's `expectedVersion` is the version it was shown for (`WorkoutScreen.tsx:413-415`, `TodayScreen.tsx:371-373`). A log made while the alert is open makes the discard fail as stale, not succeed.
- **Rule 2:** a confirmed discard changes only the session status. Every row and the audit are kept (domain test :589-601, app test :216-223).
- **Honest gaps.** Both `it.todo`s (mid-workout gym switch; Repeat of a load logged with no equipment) name the conflicting documents instead of quietly picking one.

## Blocking

### B1. The (b) matrix test exceeds the default 5 s timeout in a full run, so `npm run check` fails in most runs

- **Where:** `packages/domain/test/competitor-failures.test.ts:179-207`. The test has no `timeout` option, and `vitest.config.ts` sets no `testTimeout`.
- **What happens:**
  - The test is one `it` covering 17 equipment kinds × about 20 probe values × 6 history shapes × up to 4 rules × 2 pain states, with more than 5,000 loads checked.
  - Run alone it takes 2.8 s. In a full run (91 files on parallel workers) it took 5.96 s and 6.89 s, and timed out in 3 of 4 runs.
- **Failure path:** every slice must pass `npm run check` before it is handed off, and the GitHub Actions `.ipa` build (ADR 0004) runs on runners with 2–4 vCPUs. The new pack makes the gate red more often than not. People then learn to re-run until it's green, which hides real failures in the same file. That undercuts the pack's purpose: a test that catches competitor regressions.
- **Fix (any one; test-only, no domain change):**
  - Split the matrix with `describe.each(EQUIPMENT)` / `it.each`, one test per equipment item. Each test is then about 0.2 s, and a failure names the equipment.
  - Or give the test an explicit `{ timeout: 30_000 }`, as `definition.test.ts:252` D6 already does.
  - Keep the `checked > 5_000` assertion: sum the count across the split tests in an `afterAll`, or assert a per-equipment minimum.
- Separately (not this branch): D11 in `packages/catalogue/test/definition.test.ts` hit the same timeout once. Raise it with whoever owns the guide work.

## Should fix

### M1. Routine Start drops the load target even when this gym has the same kind of equipment. This contradicts routines.md and isn't "the same rule as Repeat"

- **Where:** `packages/domain/src/session/create.ts:153-162` and `:183-188`; locked in by `packages/domain/test/competitor-failures.test.ts:759-775`.
- **What happens:**
  - `startWorkout` matches a routine's equipment by instance ID only. Any other gym's bar or rack counts as "not in gym", so every load target is dropped and the session exercise gets `equipmentId: null`.
  - Repeat resolves equipment by kind first (`repeat.ts:57-63` `pickEquipment`: same item, else the first available of the same kind) and caps to it.
  - `routines.md:116` says the same for routines: `Incline DB press: Hotel Gym's dumbbells stop at 25 kg each. Targets will be capped.`
- **Failure scenario:** once routines are wired, Ben starts Push A at Hotel Gym, which has dumbbells to 20 kg.
  - Repeat of the same workout would plan `20 kg each`. Routine Start shows `no load target`.
  - The exercise has no equipment attached, so there are no feasible step keys, no off-profile warning and no history prefill. `lastComparableSession` filters on `equipmentId`, so the main-gym history no longer matches.
  - The new test asserts a dropped load at the hotel and at the smaller gym, the two places where the spec expects a capped one.
- **Impact today:** none. No app path passes a `routineId` (`workout-services.ts:329-353`). So this is should-fix, not blocking. The previous behaviour (load kept unchecked) was worse for rule 4.
- **Fix:**
  - Move `pickEquipment` into `create.ts` and use it for routine exercises. Drop the load only when no available equipment of a compatible kind exists.
  - Report the substitution as a warning, e.g. `equipment_substituted`, so the gym note can say so.
  - Change the hotel and smaller-gym cases in the test to expect capped loads.
  - Correct the commit's "same rule as Repeat" claim in a later commit message or ADR note.

### M2. The no-equipment "never 0" check doesn't probe 0, and the rule plans 0 kg targets from a 0 kg history

- **Where:**
  - The test: `packages/domain/test/competitor-failures.test.ts:221-238`. Its probe values are `[1, 2.5, 5, 10, 20, 45, 100]`.
  - The code: `packages/domain/src/progression.ts:322`. `feasibleHold` returns the raw value when `eq === null`.
- **What happens:** the test title says "with no equipment profile, a planned load is never 0 unless the convention has a real zero". A scratch probe with one session logged at 0 kg and no equipment gives:
  - `total` and `per_hand`: `hold 0 kg` and `hold_after_miss 0 kg` (`0 kg each`);
  - `stack`: `0 kg stack`;
  - `assistance`: `assist 0 kg`, from any shape.
- **Failure scenario:**
  - Ben adds Bench press at a gym with no barbell profile (exercise-library §4.2: no equipment, no load target) and logs `0 kg × 8`. This is valid: `LoadSchema` is non-negative.
  - The next session's built-in target reads `Stay at 0 kg and work toward 8 reps`, which is the shape of LiftTrack's "0 lb set".
  - Imported history is excluded from progression (`progression.ts:258`), so this only comes from manual logs. That makes it unlikely, but the pack claims it can't happen.
- **Fix:** add `0` (and a value below one increment) to the no-equipment probes. Then do one of these:
  - (preferred) With `eq === null` and a convention without a real zero (`total`, `per_hand`, `stack`), treat a 0 reference load as "no load target" (`Pick a load you can do for 6–8 reps`). Hold `assist 0` only when the history really is unassisted, and say so.
  - Narrow the test's claim to "never generated from a non-zero history".

### M3. The (e) "every screen asks discardConfirmation" check is a substring grep, and an unconfirmed discard helper stays in the services

- **Where:**
  - `apps/mobile/test/competitor-failures.test.ts:228-239`;
  - `apps/mobile/src/services/app-services.ts:291-292` (`sessions.discard`);
  - `apps/mobile/src/screens/TodayScreen.tsx:125-135` (`discardEmpty`).
- **What happens:**
  - The check passes if a file under `src/screens` that contains `type: 'discard'` also contains `discardConfirmation(` anywhere. `TodayScreen` passes because of its finish-sheet path. Its `discardEmpty` dispatch doesn't call `discardConfirmation`; that path is covered separately by the domain test at :562-587.
  - `services.sessions.discard(aggregate, opId)` dispatches a discard with no confirmation. A screen or component that calls it contains neither literal, so the check can't see it. It's unused in `src` and only called by `app-services.test.ts:242`.
- **Failure scenario:** a later screen (Summary's `Discard workout`, `workout-summary.md:136`, or a coach tool) calls `services.sessions.discard(...)`. The check stays green, and a workout with logged sets is discarded in one tap, which is LiftTrack's "no second step".
- **Fix:** remove `sessions.discard`, or make it take the `DiscardConfirmation` it acts on. Better still, put the guard in the domain:
  - `discard` carries `confirmedLoggedSets: number`;
  - the reducer refuses it when that number doesn't match the completed-set count;
  - a pure test covers it, so no source grep is needed.

## Nits

- **N1.** `packages/domain/test/competitor-failures.test.ts:312` is titled "(a) an import never changes planned or pending sets", but the block has no import. It checks that no session command re-plans a target, and the import half lives in the app test. Rename it, e.g. "(a, domain) no session command re-plans an existing target".
  - Fitbod's failure was replacing edits made before Start. Add an `it.todo` for when pre-Start edits exist: Repeat-screen edits, and coach-applied Next-time targets (rule 3).
- **N2.** The assisted zero guard (`progression.ts:350-352`) changes the deterministic fallback. `equipment-aware-progression.md` EQ7 and `playbook-v1.md` item 6 still say "move one assistance step". Add one line to the playbook or ADR 0006: with no machine profile, a step that would reach 0 holds and adds reps, and going unassisted is a variant change, so it's a proposal (rule 3).
- **N3.** `discardConfirmation` (`packages/domain/src/session/discard.ts:20-30`) counts only completed rows. A workout with nothing logged but a running or paused work interval, or a saved draft, is discarded at once and the elapsed time is lost. This matches `active-workout.md` §4.9 as written. Consider whether `workInterval !== null` should also confirm (see SP3).

## Spec issues

### SP1. Repeat of an exercise logged with no equipment plans that load unchecked at any gym. This needs Ben's decision before the first real workout

- **Evidence:** a real-SQLite probe, and the open `it.todo` at `apps/mobile/test/competitor-failures.test.ts:304-306`.
  - Leg press `140 kg added` and Assisted pull-up `assist 20 kg` are planned at a `home_dumbbells` gym, which has only dumbbells.
  - This is reachable with the shipped presets: `commercial` leaves the assisted and plate-loaded machines unticked (`packages/domain/src/gym-presets.ts:172-173`). Unless Ben ticks them, those exercises are logged with no equipment at his main gym.
- **The documents disagree:**
  - `slice-3-and-s1.md:109` says "an exercise whose source had no equipment correctly mirrors that (unchecked as before). That case is fine."
  - CLAUDE.md rule 4, the brief's §10 scenario ("Home gym has only dumbbells up to 30 kg: no unavailable dumbbell or cable prescriptions", line 435), `routines.md:272` ("A load is never planned without equipment to check it on") and `exercise-library.md` §4.2 point the other way.
  - The test pack's own (g) claim is therefore not met for this case.
- **Options for Ben:**
  - (a) At a different gym, drop the load with a note (`No load target: last time 140 kg on a leg press that isn't in Home's profile`), and keep it at the same gym. This is my recommendation.
  - (b) Attach this gym's compatible equipment and snap. This is ambiguous when there are several.
  - (c) Always drop.
- Also record it in `docs/design/open-decisions.md`.

### SP2. `routines.md` doesn't say how a routine's named equipment maps to another gym

§2.2 (line 116) promises capped targets at Hotel Gym. The routine's equipment field is instance-specific (`Main Gym · Olympic bar`, line 218), and §4.x doesn't specify resolving by kind. Add "resolved like Repeat: the same item, else the first available item of the same compatible kind, else the load is dropped" so that M1 has a spec to build against.

### SP3. The Discard rules differ across specs

- `active-workout.md` §4.9 and `today.md` §4: with 0 sets, discard at once with no Undo.
- `workout-summary.md:136`: Summary's `Discard workout` requires a confirmation even for a short or empty workout.
- `discardConfirmation` is documented as the one rule for every Discard, and it would skip the confirmation there.
- Opportunity 2(e) says "confirmation or Undo".

Decide whether a finished workout, or one with a work interval, check-in or drafts but no completed set, needs the confirmation. Then make `discardConfirmation` the single home for that rule.
