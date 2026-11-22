# Review: competitor-failure acceptance pack, round 2 (fixes for B1, M1, M2, M3)

**Verdict: PASS** (2026-10-10). The second-pass blocker (B1) and all three should-fix findings (M1–M3) from `docs/reviews/failure-tests.md` are fixed in the domain, and each fix has a test. `npm run check` is clean. Nothing blocks this round. Two new should-fix findings come from the M2 fix: the text it produces for a logged 0 with no equipment is misleading, and a 0 history still steps up to "2.5 kg" on a barbell. The first pass's nits N1–N3 and spec issues SP1–SP3 are still open and are carried forward below. SP1 still needs Ben's decision before the first real workout.

Reviewed: `claude/gracious-knuth-joxqpw..claude/failure-tests`. The new commits since the round-1 review (`5257228`) are:
- `f2089f5`: with no equipment profile, the built-in rule doesn't plan a logged 0 as "0 kg each", "0 kg stack" or "assist 0 kg" (M2).
- `7061022`: the (b) next-targets matrix is split into one test per equipment item, each with a 30 s timeout (B1).
- `62b34b7`: the no-equipment check now starts from 0 too (M2).
- `7f340ff`: a routine started at another gym falls back to that gym's equipment of the same kind and caps its targets there (M1).
- `53152ee`: the `discard` command carries `confirmedLoggedSets`, and the reducer refuses a mismatch (M3).

Read for this review: CLAUDE.md rules 2–6, 9 and 10; the previous review; `routines.md` §2.2; `active-workout.md` §4.9; `playbook-v1.md` item 6; and `competitor-landscape.md` opportunity 2 (LiftTrack's "0 lb set" and its one-tap discard).

## What I ran

| Check | Result |
|---|---|
| `npm run check` in `/home/user/wt-failure-tests` | **Clean.** Typecheck, lint, 91 test files (1280 passed, 2 todo), catalogue validate, guide check 10/10 |
| Scratch probe: `calculateNextTargets` with no equipment, history at 0 kg, for every convention × top of range / inside range / miss × pain on and off. The probe file was temporary and deleted; nothing was committed | No target is 0 any more, except `added`, where 0 is a real setting. Loads are `null` for hold, hold-after-miss and pain. But **top of range from 0 gives `increase_load` to 2.5 kg** for `total`, `per_hand` and `stack` (S2). The text reads "Stay at no load…", "Use no load for 6–8 reps." and, for assisted, "Add a rep: aim for 9 at no load, because there is no assistance left to remove", with the fact "Last load was assist 0 kg, which isn't a load to plan; enter your load." (S1) |
| Read the M1 path end to end: `session-service.ts:95-100` → `create.ts:185-191` → `planTemplateLoad` | The named item is loaded from any of the owner's gyms. The substitute is this gym's first *available* item of the same kind, and that kind must be compatible with the exercise. This matches `repeat.ts:57-63` `pickEquipment`. The warning names `substituteId`, and the drop only happens when there is no substitute |
| Read the M3 path: `discardCommand`, the reducer at `reducer.ts:1047-1055`, every `discard` caller in `apps/` and `packages/` | Every app path builds the command through `discardCommand`, or through a hand-built `{ required: false, loggedSets: 0 }` for Today's "nothing logged" card. `sessions.discard` now takes the confirmation. No coach or other package dispatches `discard` |
| Diff check for forbidden files (design-system, guides v2, `figure/*`, `guide/*`, FitNotes import), `console.*` and secrets | None found |

## What is solid

- **B1 is fixed properly.** `it.each(EQUIPMENT)` (`packages/domain/test/competitor-failures.test.ts:187-213`) gives one test per equipment item, each with a 30 s budget, so a failure names the equipment. The `checked > 5_000` assertion is kept in a follow-on test (:215-217).
- **M1 now matches the spec.** At Hotel Gym, 27.5 kg each is capped to 20 kg each on the hotel's dumbbells, and a `target_rounded … bounded: 'max'` warning is shown. The bench, with no barbell at the hotel, is still dropped rather than kept unchecked (:804-822). A second test goes through the real session service and memory repositories (:825-838), so the lookup wiring is covered and not only the pure function.
- **M3 moves the guard into the domain, as the previous review recommended.** A discard whose confirmed count doesn't match the logged count is refused with `discard_unconfirmed`, and the state is untouched (domain :603-615; app, through both `workout.dispatch` and `sessions.discard`, :228-245). The order of checks is right: a duplicate `opId` is caught first (`reducer.ts:1237-1249`), then `stale_version`, then the count. A retried discard therefore stays idempotent (rule 5). The UI maps `discard_unconfirmed` to the same "The workout changed" message plus a reload as `stale_version` (`TodayScreen.tsx:132`, `:379`; `WorkoutScreen.tsx:417`).
- **Rule 2:** a refused discard leaves every set row unchanged. A successful discard still changes only the session status.

## Blocking

None.

## Should fix

### S1. A logged 0 with no equipment now gives "no load" text that reads as advice, and an unassisted (assist 0) set is told to "enter your load"

- **Where:** `packages/domain/src/progression.ts:323-331` (`feasibleHold`), which feeds the summaries at `:546`, `:612` and `:624`.
- **What happens:**
  - `feasibleHold` returns `null` for 0 without changing the decision. The summary templates then format `null` as `no load`, which gives "Stay at no load and work toward 8 reps on every set." and "Use no load for 6–8 reps.".
  - For an assisted exercise, 0 means unassisted, which is a real and plannable state. Logging assisted pull-ups at `assist 0 kg × 8` gives "Add a rep: aim for 9 at no load, because there is no assistance left to remove", alongside the fact "Last load was assist 0 kg, which isn't a load to plan; enter your load."
- **Failure path:** Ben logs bench press with no barbell profile at 0 kg (a mistaken entry). His Summary or Next-time card then says "Stay at no load". Rule 3 requires every target to be shown with its reason, and that reason must be honest and readable. "No load" on a barbell exercise reads like "do it with no weight". The assisted case contradicts itself: the reason says there is nothing to plan, while the decision says to add a rep at the current (unassisted) setting.
- **Fix:**
  - When `feasibleHold` returns `null` from a 0 reference, use the existing "no reference load" summary (`Pick a load you can do for 6–8 reps.`, the shape `noReference` already uses). Don't use the hold or hold-after-miss templates.
  - For `assistance`, treat a logged 0 as a real "unassisted" hold: plan `assist 0` labelled as unassisted, or `null` with the text "Unassisted last time; keep it unassisted". The previous review's M2 suggested "Hold assist 0 only when the history really is unassisted, and say so".
  - Add assertions on `t.explanation.summary` to the 0-probe test at `competitor-failures.test.ts:232-249`: no `no load` for `total`, `per_hand` or `stack`.

### S2. From a 0 history with no equipment, the rule still increases to "2.5 kg" total or stack

- **Where:** `packages/domain/src/progression.ts:357-362` (`nextHarderLoad`, `eq === null` branch).
- **What happens:** the scratch probe with `total` 0 kg × 8, 8, 8 at RPE 7 gives `increase_load`, "Increase to 2.5 kg for 6–8 reps." The same happens for `per_hand` (2.5 kg each) and `stack`. So the hold path treats 0 as "not a load to plan", but the increase path plans 0 + 2.5 kg on a barbell. That is below any bar, which is the LiftTrack-style result the pack exists to prevent. The 0-probe test only asserts `> 0`, so it passes.
- **Failure path:** the same mistaken 0 kg bench entry, but at the top of the range, plans a 2.5 kg "barbell" next time.
- **Fix:** in `nextHarderLoad` with `eq === null`, for a convention without a real zero (`total`, `per_hand`, `stack`), treat a reference of `<= 0` as having no reference load. That gives the same `null` plus "Pick a load…" result as S1. Extend the test to assert that every non-null load comes from a non-zero reference, or simply that a 0 reference gives `load === null` for those conventions.

## Nits

- **R2-N1.** The reducer's `discard_unconfirmed` check proves only that the caller computed the logged count, not that Ben saw a prompt. A caller can still do `discardCommand(discardConfirmation(s), …)` without an `Alert`. That residual risk is covered only by the screens grep (`apps/mobile/test/competitor-failures.test.ts` around :250). This is acceptable for a single-user app, but say so in the `DiscardCommandSchema` doc comment (`packages/schemas/src/commands.ts:254-261`), which currently claims "no caller can discard logged sets without going through the confirmation".
- **R2-N2.** `reducer.ts:1049` duplicates the `completed` filter from `discardConfirmation` (`discard.ts:26`). Call `discardConfirmation(state).loggedSets` so the two can't drift. For example, if SP3 later decides that a running work interval needs confirming, it would only have to change in one place.
- **R2-N3.** The `checked > 5_000` test (`competitor-failures.test.ts:215-217`) depends on the `it.each` tests running before it in the same file. Running it alone with `-t` fails with `checked = 0`, and so would a future `sequence.shuffle`. Assert a minimum per equipment item inside each `it.each` instead, or move the sum into an `afterAll`.
- **R2-N4.** `TodayScreen.tsx:128` builds the confirmation literal by hand. Today's stale card only offers Discard when `loggedSets === 0`, so this is correct. Using `discardConfirmation` on the aggregate would keep the "one rule for every Discard" claim literally true.
- **Carried over from round 1, not addressed:**
  - **N1:** `competitor-failures.test.ts:324` is still titled "(a) an import never changes planned or pending sets", but the block has no import.
  - **N2:** `playbook-v1.md:422` and `:465` still say "move one assistance step", with no mention of the no-profile hold before 0.
  - **N3:** `discardConfirmation` ignores a running work interval, a check-in or drafts.

## Spec issues (carried over; still open)

- **SP1** (needs Ben's decision before the first real workout): Repeat of an exercise logged with no equipment still plans that load unchecked at any gym. For example, Leg press `140 kg added` and Assisted pull-up `assist 20 kg` are planned at a dumbbells-only gym. The open `it.todo` at `apps/mobile/test/competitor-failures.test.ts` (end of the (g) block) still records it. My recommendation is unchanged: at a different gym, drop the load with a note; at the same gym, keep it.
- **SP2:** `routines.md` §2.2 / §4 should now record the rule that the code implements: "resolved like Repeat: the same item, else the first available item of the same compatible kind, else the load is dropped". The code is ahead of the spec.
- **SP3:** the Discard rules still differ across specs: `active-workout.md` §4.9 and `today.md` §4 (no prompt with 0 sets), `workout-summary.md:136` (always confirm), and opportunity 2(e) ("confirmation or Undo"). With the guard now in the reducer, whatever Ben decides needs changing in one place (see R2-N2).
