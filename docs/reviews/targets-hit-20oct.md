# Review: Targets hit on main lifts only, behind a setting (targets-hit-20oct)

Branch `claude/targets-hit-20oct`, diff from merge-base `1e48041` (claude/gracious-knuth-joxqpw), 4 commits.
Ben, 20 Oct: "Let's only show targets hit on main lift if turned on in settings".

## Verdict: PASS

No blocking issues. The setting exists, is off by default and persists in device prefs. Every place that renders `Targets hit` is gated. The per-workout target vs actual rows stay. The main-lift rule is a pure, tested domain helper, and the plan day and Progress use the same rule. The should-fix items below are about the main-lift definition being wider than Ben's wording, plus one ordering inconsistency.

## Checks run

- `npm run typecheck`: clean.
- `npm run lint`: clean.
- Targeted vitest (`--maxWorkers=2`): targets-hit, domain plan-overview, device-prefs, mobile plan-overview, coach-plans: 5 files, 48 tests passed.
- Full suite (`--maxWorkers=2`): 370 files, 7205 passed, 1 todo.

## Gating coverage (grep `Targets hit` / `hitText` / `targetsHit`)

| Surface | Source | Gated |
|---|---|---|
| Plan day lines (planned run) | `plan-overview.ts:315` via `plan-services.ts:390-396` | yes |
| Plan day lines (templates, no gym) | `plan-overview.ts:377` | yes |
| Progress › Exercises tab header line | `ExercisesTab.tsx:381` ← `progress-service.ts:342` → `targetsFor` | yes |
| Exercise detail HISTORY line | `ExerciseDetailScreen.tsx:512` ← `progress-service.ts:399-403` | yes |
| Per-workout target vs actual (Exercises tab rows, detail rows) | `targets.rows` | unchanged, as intended |

No other renderer of `hitText` exists, and the coach context doesn't read it. The default is Off at every layer: `DEFAULT_PREFS.targetsHit: false`, `parsePrefs` accepts only `=== true`, `planDay` defaults to `{ targetsHit: false }`, and the progress service defaults to `req.targetsHit === true`.

## Blocking

None.

## Should fix

**S1. The main-lift set is global. An exercise marked `Main` in any live workout counts as a main lift everywhere, including on a plan day where it is an accessory.**
`packages/domain/src/progress/targets-hit.ts:20-28`, `apps/mobile/src/services/training-service.ts:102-111`, `apps/mobile/src/services/plan-services.ts:390-392`.
Scenario: Ben's old library workout "Push A" has Bench press first (Main by the WL9 rule). The applied plan's Upper day lists Bench press third as an accessory, after Squat and Row. With the setting on, the Upper day screen shows `Targets hit` on Bench press, though it isn't that day's main lift. The fallback rule makes this worse: any routine with no compound in its first two slots makes its first exercise Main (for example Curl on an arm day). Routines taken out of rotation, and routines left from an ended plan that are still live, also add to the set. In practice "main lift only" becomes "most compounds plus some first exercises", which is not what the mockup shows.
Fix: on the plan day screen, use that day's own `mainFlags(routine.exercises sorted by order)`, together with the split-day main lift if wanted. Keep the global set only for Progress (exercise-level), or limit it to in-rotation and applied-plan routines. Add a test where an exercise is Main in another routine but not on this plan day.

**S2. `mainLiftIds` applies the positional fallback rule to `r.exercises` in stored array order, not sorted by `order`.**
`packages/domain/src/progress/targets-hit.ts:24`.
The rest of the codebase sorts by `order` before any positional logic (`today-edits.ts:1237`, `create.ts:237`, `library.ts:289`). For a routine saved before `Main` was stored, if the array isn't in `order` sequence, "compounds in the first two places / else the first" picks the wrong exercises. So `Targets hit` would show on a non-main lift and be hidden on the real one.
Fix: include `order` in the `Pick` type and sort a copy by `order` before `mainFlags`, as `today-edits.ts` does. Add a test with an unsorted array.

**S3. `mainLiftIds()` runs the whole training `snapshot()` on every load with the setting on.**
`apps/mobile/src/services/training-service.ts:102-111`.
That snapshot reads 180 days of finished sessions, builds lift history, works out main-lift options for every exercise and runs `buildDayFor`. The Exercises tab reloads on every period, measure or series change, so each tap repeats all of this. It is fine for a few hundred sessions, but it is wasted work on the Progress hot path.
Fix: add a lighter path that gets only the per-day `mainLiftFor` results (it still needs history for the recommended lift), or cache the result per data version.

## Nits

- **N1.** The screens pass `prefs.targetsHit` into `useScreenData`, but the focus effect only depends on `[services, version, tick]` (`shell/context.tsx:98-112`). A screen that loads before `device-prefs.json` finishes loading at launch shows Off until its next focus. Navigation doesn't restore into these screens, so the real-world risk is low. A `useEffect(reload, [prefs.targetsHit])` would close the gap.
- **N2.** No test covers that `update({ targetsHit: true })` writes the field to the prefs file. The holder test only carries `targetsHit: false` through. Generic merging covers it, but one assertion would make persistence explicit.
- **N3.** There is no service-level test where the split day's main lift (and not a routine flag) is the only reason `Targets hit` shows. The domain test covers this; the SQLite path doesn't.
- **N4.** `isMainLift` accepts either `MainLiftSources` or a `Set`, using an `in` check. That works, but two small functions would be clearer.
- **N5.** Profile row subtitle "Main lifts": minimal copy, OK. The switch has an accessibility label. Not yet checked on a device (developer open item 3).

## Product rules

- Rule 1, 6: display only. No invented data, and the per-workout target vs actual stays.
- Rule 10: the setting is a device pref (not Your data, not in backup). Delete my data clears it through `holder.clear()`. Main lifts are read from Your data (training profile, routines), and nothing is written.
- Rules 2, 3, 5: no writes, proposals or targets are touched.
- No secrets, and no new logging.
- CHANGELOG: one entry, "Ben approved 20 Oct", quoting him. The earlier open item is marked resolved.

## Spec issues

- **SP1. The spec's main-lift definition is wider than Ben's words.** Ben said "main lift" (singular, as in the mockup). The PM spec added "or flagged main in a routine/plan day (RoutineExercise.main / mainFlags)". Under the WL9 default rule, both compounds in the first two places are Main, so the coach-built Push day shows `Targets hit` on Bench press and Incline dumbbell press (confirmed by `apps/mobile/test/plan-overview.test.ts`, setting-on assertion). This is developer open item 1. Ben should choose one of:
  - (a) only the split day's main lift;
  - (b) the day's Main flags, per day (see S1);
  - (c) the current global set.
  Recommendation: (a) or (b).
- **SP2.** The spec doesn't say whether "main" is judged per day (plan day screen) or per exercise (Progress). The implementation uses one global set for both (see S1).
