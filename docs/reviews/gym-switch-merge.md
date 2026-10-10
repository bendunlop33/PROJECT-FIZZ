# Review: merge of main (active-set follow-ups, failure pack, premium-feel) into gym switch

Commit: `cbca1ff` on `claude/gym-switch` (parents `45d655a` gym switch, `45174cf` main).
Reviewer: independent reviewer. Date: 10 Oct 2026.

## Verdict: **PASS**

No blocking findings. Rules 2, 4 and 5 hold on every path I checked. Main's
migration 4 is byte-identical to main. I found no lost feature from either side.
Two should-fix items (S1, S2) are gaps in how the new shared fit and main's
routine start fit together. Neither one plans an impossible load on a reachable
path today. Fix them before routines and gym switch are used together on the phone.

## What I ran

- `npm run check` in `/home/user/wt-gym-switch` (typecheck, lint, tests, catalogue validate, guide check, guide motion) exited 0. Results: 137 test files, 1915 tests passed, 1 todo (main's open "logged with no equipment" question, see Spec issues).
- `git show --cc cbca1ff`: I read every hand-resolved hunk (33 files).
- A mechanical "lost line" sweep. For every file both sides touched, I listed every line either side added since the merge base (`18a3698`) and checked whether it survives in the merge. Every missing line is either a superseded variant that the merge combined (for example the import list, `buildActiveSetView` args, `sessionRecords` args, `withExclusionWords` plus `compact`), or deliberately moved code (`pickEquipment` / `fitLoadHere` / `droppedNotes` / `warningNotes` to `routines.ts`, `knownEquipment` lookup to `routineEquipment`). No feature code was dropped.
- Two throwaway probes, run outside the repo against the merged sources and not committed. They back S1 and S2.

## Checks

| Check | Result |
|---|---|
| Main's `0004-active-set.ts` unchanged | Same blob `c9616fd` in `45174cf` and `cbca1ff`. |
| Gym-switch SQL unchanged by the renumber | `0005-gym-switch.ts` differs from the old `0004-gym-switch.ts` only in the doc comment and the export name. |
| Schema-4 database (build 91) → 5 | `migrations.test.ts` checks that every prior version reaches the fresh schema. `pain-retract.test.ts` migrates populated v3 → 4 → 5. Migration 5 only adds nullable columns, so existing rows are untouched. |
| Schema-4 backup → 5 | New `backup.test.ts` case: build-91-shaped backup (exclusion, Finish by, no gym columns) restores with `needsMigration`, ends at user_version 5, and reads back equal. Schema-5 round-trip of a switched workout with exclusions and Finish by also passes. The schema-1 restore test strips v4 and v5 columns. |
| Rule 2 (completed sets) | `change_gym` and its Undo touch only pending sets in the binding. The failure pack's new test asserts that every completed set is `toEqual` after switching to each failure-pack gym. Exclusions are written only by `correct_set`. |
| Rule 4 (achievable loads) | `startWorkout` and Repeat now both go through `snapPlanToGym`, which rounds toward easier from the achievable list and drops a target rather than making it harder. `planRoutineStart` pre-fits, then `startWorkout` fits again. Failure-pack (g) gym-switch test is now live. |
| Assisted over-assistance: drop instead of cap | **Safe direction, agreed.** Capping 50 kg assistance to a machine's 40 kg max gives Ben less help than planned, which is a harder set he didn't ask for. Dropping keeps the reps and states it: `No load target: plan was Assist 50 kg, more assistance than this machine gives.` Less assistance than the minimum still goes to the minimum (easier), tested. Repeat (`fitOn` `lightest_is_harder`) and routine start (`fitLoadHere` `harderDropped`) behave the same way. |
| Rule 5 (versioned/idempotent) | Provenance is rewritten inside the same versioned `change_gym` / continuation write. Undo restores `before.sets[].planned` (provenance included) exactly, and this is tested. `rename_session` / `set_finish_by` and `change_gym` / `undo_change_gym` both survive in the dispatch and in `isSuperseded`. |
| Why? after a switch | `refitProvenance` replaces only equipment guard notes (every `guardNotes` producer is an equipment note). It keeps source, basis and rule, keeps a step only while it still describes the load, and absent stays absent. `explainTarget`, records, `targetSummaryLines` and record context use `equipmentOfRow`. Tested in `gym-switch-why.test.ts` (10 cases). |
| Features kept, Workout screen | Why? link and panel, pain flag from the panel, exclusion tag and a11y text, gym caption and part divider, gym chip, switch slot, switcher sheet, review sheet, snap note, rename sheet, Time left sheet, discard confirmation, 52 pt secondary buttons, rest-skip haptic. Log stays blocked while a switch card needs review. |
| Features kept, Repeat screen | Gym chip and switcher, with a new start opId per gym, plus Save as routine with Undo. |
| Features kept, Summary | Exclusion words and per-part `compact`, per-part gym names, records naming each part's gym. |

## Findings

### Blocking

None.

### Should fix

**S1. A routine started with `planRoutineStart` loses the plan the gym switch needs to restore it, so switching to a gym that has the equipment never brings the load or the equipment back.**
`packages/domain/src/session/routines.ts:268-275, 304, 315`

- **What happens:** when the routine's item (and anything of its kind) isn't at this gym, the pre-fit sets `targetLoad` to null and `equipmentId` to null before calling `startWorkout`. `startWorkout` then sees an unequipped slot with no intended load, so `planned.snap` is never written. The direct `startWorkout` path does write it (`reason: not_here`, `intended: 100 kg`). The `lightest_is_harder` case (`fitLoadHere` `harderDropped`) loses the intended load the same way.
- **Failure scenario (probe-verified):** Ben starts `Push A` from Up next at the hotel (dumbbells only). Bench gets reps and no load (correct). He then moves to Main and switches gym.
  - Routine start: bench stays `equipmentId: null` with no load target.
  - Plain Start or Repeat: bench gets the Olympic bar and 100 kg back.
  - After the switch, sets he logs on the bar aren't tied to it (no plate line, no snapping, records not per item). That breaks gym-switch GS2 ("switching back restores the plan") for the main way routines are now started.
- **Rules:** no impossible load is planned, so rules 2, 4 and 5 are not broken.
- **Fix:** keep the routine's own `equipmentId` and the unfitted `targetLoad` on the template, so that `startWorkout`'s `snapPlanToGym` does the mapping and dropping and records `planned.snap` (pass `routineEquipment: knownEquipment`, `gymName`, `lastUsedHere`). Keep only the notes and rule provenance in `planRoutineStart`. This is the "fold into the shared fit" follow-up the merge message mentions.
- **Test:** `planRoutineStart` at a gym without the bar, then `change_gym` to a gym with it. Expect the bar and 100 kg to be restored.

**S2. `startWorkout` keeps an unchecked load when the routine's pinned item can't be resolved and the exercise lists no equipment kinds. Main dropped it.**
`packages/domain/src/session/create.ts:224-231`

- **What happens:** `pinned` is null, `kind = exercise.compatibleEquipment[0]` is `undefined`, so `source` stays null. `mapEquipment` then returns `none_needed`, and `fitWithoutEquipment` keeps the load as long as the unit matches.
- **Failure scenario (probe-verified):**
  - **Input:** a routine pins equipment `id(4242)`, which is in no gym and not in `routineEquipment`, on an exercise with `compatibleEquipment: []` and convention `total`, with a target of 137.3 kg.
  - **Merge result:** `planned.load` is 137.3 kg. The warning `equipment_not_in_gym, substituteId: null` says nothing stands in, which contradicts the kept load. The row has no equipment.
  - **Main result:** dropped (`equipmentMissing`).
  - **Reachability:** not reachable through today's UI (equipment is never deleted, and the picker never attaches equipment to an exercise with no kinds). It is reachable through hand-edited or restored data.
- **Fix:** when `rex.equipmentId !== null` and nothing resolves, pass a source whose mapping lands on `not_here`. For example, build the placeholder source even with no kind, and let `mapEquipment` return `not_here` when `kinds` is empty and `source.id` isn't here. That drops the load with a note.
- **Test:** add this exact case to `start-normalisation.test.ts`.

### Nits

**N1. `warningNotes` wording for `lightest_is_harder` is wrong on an assisted machine.**
`packages/domain/src/session/routines.ts:448`: "the lightest here is heavier than Assist 50 kg". That code path is mostly pre-empted by `fitLoadHere`, but where it does fire, it should use `startWarningNote`'s wording ("more assistance than this machine gives") or "the easiest here is …".

**N2. `planRoutineStart` doesn't pass `gymName` or `lastUsedHere` to `startWorkout`.**
`routines.ts:322-332`. As a result, snap notes and `planned.snap` say "this gym", and GS3 step 2 (last item used here) is skipped for routine starts. This goes away with S1.

**N3. Why? gives no reason for a dropped routine-template load.**
For a routine-template set (no rule targets) whose load was pre-dropped for missing equipment, Why? shows the plan with no equipment note: the warning is null because the load was already null. This is main's behaviour, unchanged by the merge, and S1's fix would give it the `not_here` note for free.

**N4. No test migrates a populated schema-4 database in place.**
None of the tests opens a populated schema-4 database (rows with exclusions and Finish by, made with `MIGRATIONS.slice(0, 4)`) and migrates it to 5 without going through backup or restore. The schema-dump test and the backup test together cover this, but one direct test would mirror build 91 on the phone exactly.

**N5. Confirm no gym-switch build ever reached Ben's phone.**
A backup made by such a build would say `schemaVersion: 4` while holding the gym-switch columns and none of the active-set ones. I found no device-test note of one (`docs/device-tests/`), so this is only a confirmation for the PM.

## Test coverage of the new merge code

- **Covered:**
  - `refitProvenance` and `refitNote`: kept, replaced, step kept or removed, pain-held, rule wording.
  - Undo restoring provenance.
  - Add-set continuation note.
  - Repeat basis naming each part's gym.
  - Records naming a part's gym.
  - Assisted drop and assisted easier-minimum at start.
  - Failure-pack gym-switch invariant.
  - Schema-4 → 5 backup restore, and schema-5 round-trip.
  - `planRoutineStart` note tones.
  - Next-session at a gym without the bar, keeping `built_in_rule`.
- **Missing:**
  - The S1 routine-start then switch sequence.
  - The S2 unresolvable pin.
  - A switch made after an exclusion is set on a completed set. Generic `toEqual` covers it, but the failure-pack fixture has no exclusions.

## Spec issues

- **Unchecked loads on exercises logged with no equipment.** Main's open `it.todo` (`apps/mobile/test/competitor-failures.test.ts:324`) asks whether a load on an exercise logged with no equipment should stay unchecked when repeated. That now also applies to the gym switch: `snapPlanToGym` maps a slot with no source equipment to `none_needed` and keeps its load at every gym. So switching to a gym whose leg press stops at 100 kg leaves a 140 kg target unchecked. This conflicts with routines.md §2.4 ("a load is never planned without equipment to check it on"). Ben or the PM needs to decide it once for Start, Repeat and the switch.
- **Different equipment fallbacks.** ADR 0019 GS3 lets Start, Repeat and the switch map to "another kind the exercise lists". Routine start (`pickEquipment`) only accepts the same kind. Until S1 is fixed, the same routine maps to different equipment depending on whether it is started from Up next or repeated. The spec should name one rule.
