VERDICT: CHANGES NEEDED

# Review: core finish (branch `claude/core`)

Range: `claude/gracious-knuth-joxqpw...claude/core` (14 commits, `7357bb8`..`2d24fce`), 42 files. The two-dot range also lists guide and figure files, but those changes are on the base branch only, not this one.
Reviewer: independent reviewer agent, 10 Oct 2026.

## What I checked

- `npm run check` in `/home/user/wt-core`: typecheck, lint, 95 test files / 1286 tests, catalogue validation (133 valid, 0 errors) and guide check all pass (exit 0).
- **Fresh install to a first logged set**, traced through the services and screens: Setup (the commercial preset is preselected; Skip now saves a typical gym) → Today `First workout` → `Start workout` (creates the typical gym if none) → check-in gate → empty workout → the picker opens on its own → common lifts → Bench press planned as 3 × 3–6 with no load → `Enter load` focuses the field → `Log 60 kg × 6` → rest. There is no dead end on that path, and `apps/mobile/test/first-run-flow.test.ts` covers it at the service level, including a force-close during rest and Finish cancelling the alert.
- **D mockups** (D-Today, D-ActiveSet, D-Rest) against the tokens and screens: 88/300 rest numeral, 38/500 load tiles on borderless 20pt `bg.surface` tiles, 30pt exercise title, 12pt tracked caps labels, 60pt pill primary, outline-pill −30 s/+30 s/Skip, text-only caps tab bar, week dot strip, lift highlight with sparkline, `Next ›` row pinned to the bottom. These match closely. The extra top-bar controls (minimise, workout menu) are functional additions and acceptable. There's no Talk button because voice doesn't exist yet, which is correct under rule 1.
- CLAUDE.md rules 1–10, below.
- I reproduced both blocking findings with a throwaway vitest file on the real app harness, then deleted it. No source was edited.

## Blocking

### B1. `Enter load` does nothing during rest, on the main first-workout path
`apps/mobile/src/screens/workout/WorkoutScreen.tsx:484-492` with `:865-877`

When a value is missing, the primary button only calls `loadRef.current?.focus()`. While rest is running, the set editor isn't rendered: it is folded behind `Edit <exercise>` until `showNextSet` is true. So `loadRef.current` is `null`, and the button silently does nothing. The domain still returns `{ kind: 'enter', field: 'load' }` while resting, because `buildActiveSetView` doesn't look at the phase.

**Failure scenario (reproduced):** First workout, open-ended. Ben logs 3 bench sets. The new reducer rule starts a rest after the last set so far. He taps `Add exercise` and picks Triceps pushdown, which has no history, so no load. He comes back to the workout: phase `resting`, rest `running`, focus on Triceps pushdown set 1, primary `Enter load`. Tapping it does nothing. This is the dead primary button that audit F2 was meant to remove, and Ben hits it on his second exercise of his first workout.

**Fix:** In the `enter` handler, call `setShowNextSet(true)` and focus the field after the editor mounts (an effect keyed on a "focus requested" flag, or `requestAnimationFrame`). Or, while resting with a missing value, show `Edit <exercise>` as the primary. Add a test that the `enter` action always has a reachable field (for example, an `enter` primary while resting opens the editor).

### B2. "Start next session" raises loads after Ben reports pain in today's check-in (rule 9)
`apps/mobile/src/services/workout-services.ts:358-361`, used at `:422` and `:692`

`nextTargetsOf` only uses the **source** workout's check-in for `sessionPain`. It ignores the check-in Ben just answered for the workout he's starting. `planFor` (`:348`) uses `now.active ? now : then`, so the two paths disagree.

**Failure scenario (reproduced):** Last workout: bench 60 kg × 6, 6, 6 at RPE 7–8. Two days later Ben taps `Start workout` on the Up next card. In the check-in he picks reason `pain` and taps `Not now` on the movement step, so there's no per-exercise flag. The workout starts with `Target (built-in rule) 62.5 kg · 3–6 reps`, an increase, despite the pain he just reported. If he had started an empty workout and added bench, `planFor` would have held the load.

**Fix:** Pass the start's check-in into `nextTargetsOf` (resolve `req.checkIn` when it's `answered`) and use `unspecifiedPain(today).active ? today : source`, matching `planFor`. Add a first-run-flow test: a pain check-in plus `nextOf` gives held targets with the pain reason.

## Should fix (not blocking)

1. **`Start <title> again` applies progression, not a repeat.** `apps/mobile/src/screens/TodayScreen.tsx:254`. On the Done-today hero this calls `start(next.sourceSessionId)`, which uses `nextOf` with built-in-rule targets. "Again" suggests a repeat of today's actuals, and a second session the same day gets progressed twice. Either label it `Start next session` or use `repeatOf` here.
2. **Target failure silently becomes a repeat.** `workout-services.ts:422`. `nextTargetsOf(...).catch(() => new Map())` falls back to last time's actuals (labelled `repeat`), but the Today card promised "with next targets (built-in rule)". At minimum, return a warning so the workout screen can say targets weren't worked out.
3. **A derived name is stored as if it were a routine name.** `workout-services.ts:423` (start `nextOf`) and `repeat.ts` `name`. `Push` from `deriveWorkoutTitle` is persisted as `session.routineName`. From then on it can't be told apart from a name Ben chose, and `isOpenEndedWorkout` treats it as planned. Consider a separate `derivedTitle` field, or recompute it at read time as the other screens already do.
4. **Picker can get stuck on "Loading exercises…".** `ExercisePickerScreen.tsx:134` and the effect above it. If the first (saved-list) read rejects, `withCatalogue` never becomes true and the empty state says `Loading exercises…` forever. With an empty query and no rows after the catalogue loads, it shows `No exercise matches “”`. Set `withCatalogue` (or an error state) in the `catch`.
5. **Archived typical gym (latent).** `app-services.ts:236`. The ID is `deriveId('typical-gym:'+owner)`, and archived gyms are filtered out. Once archiving exists, `Start` with only an archived typical gym re-creates the same ID: the write fails and `gyms.get` returns the archived gym, so the workout starts at an archived gym (or `Start` fails every time). Check `archivedAtUtc` on the fallback `get`, or derive with a generation suffix.
6. **No UI-level test for the rest/editor fold.** Nothing exercises the screen-only logic (`showNextSet`, `enter` focus, the open-ended `Then add a set…` line). B1 slipped through because of this.

## Nits

- `app-services.ts:370`: catalogue rows get a hard-coded `createdAt` of `2026-10-10T00:00:00.000Z`. Use the bundle's version date or `deps.now()` when the row is first saved.
- The open-ended rest after the last set fires a `Rest done` notification with the body `Ready when you are.`. That's fine, but a line like `Add a set or your next exercise` would match the in-app text.
- Code comments cite "first-run audit B1/B2/B4/F2–F9", but no audit document is in the repo (`docs/reviews/` has none), so the references can't be traced.
- `LiftCard`'s `up from 97.5` has no unit. It matches the mockup but is ambiguous for an lb user. Consider `up from 97.5 kg`.

## CLAUDE.md rules

| Rule | Status |
|---|---|
| 1 Offline / no AI, honest status | OK. Everything is local, the built-in rule is labelled `(built-in rule)`, and there's no fake Talk control. |
| 2 Completed sets never silently changed | OK. No new path edits completed sets. |
| 3 Coach / deterministic targets | OK for the no-AI fallback: next-session targets come from the built-in rule, labelled, and snapped to equipment. |
| 4 Achievable loads | OK with a caveat: the typical gym is preset equipment marked "not checked" and disclosed under Start and in Setup (see Spec issues). |
| 5 Idempotent, versioned writes | OK. Start keeps its opId per intent, `useTypicalGym` uses a derived ID (test covers a double tap), and the catalogue save is idempotent. |
| 6 No invented data | OK. No first load is guessed, the lift highlight uses logged sets only with imports excluded, and the week strip only shows trained days. Nit 3 is a mild naming concern. |
| 7 Credentials / paid route | Not touched. |
| 8 Imports as data | Not touched. |
| 9 Pain stops progression | **Violated on the next-session path (B2).** |
| 10 Your data vs Coaching knowledge | OK. Catalogue rows are saved with no owner (Coaching knowledge), and the typical gym is owner-scoped. |

## Spec issues (for the PM / Ben, not the developer)

1. **rest-state.md #14 / §2 table** says "after the workout's final set, no rest timer starts". The branch deliberately starts a rest after the last set of an *open-ended* workout (`reducer.ts:336`). The behaviour is reasonable for a build-as-you-go workout, but the spec needs amending and Ben's approval recorded.
2. **onboarding.md** (`Skip for now: loads won't be checked`) and its first-gym flow don't describe the "typical gym" fallback. The branch replaces Skip with `Skip: use a typical gym for now` and creates a gym silently from Today's Start. That is a product decision that touches rule 4, since loads are snapped to equipment Ben hasn't confirmed. Needs Ben's approval and a CHANGELOG entry.
3. **design-system.md** D values (type sizes, radius, card borders, secondary button, link affordance) no longer match the code. `tokens.ts` says the mockups win and "design-system.md still needs updating". The doc should be updated so future reviews have one source of truth.
4. **today.md** has no "Up next" card built from the last workout with built-in-rule targets, and no lift highlight. Both are new behaviour here (the mockup shows a named routine, `Push A`, from a plan that doesn't exist yet). The spec should describe the no-routine "next session" card and the "Workout" / derived-name rules.
