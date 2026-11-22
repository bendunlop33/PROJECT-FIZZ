# Review: coach-builder (workout builder v1.0)

**Verdict: CHANGES NEEDED**

Branch `claude/coach-builder` (a7e2d89), diffed against `claude/gracious-knuth-joxqpw` (31f3123). Checked against `docs/design/workout-builder.md` v1.0 (BD1–BD16, WB1–WB30), `coach-contract.md` (CC10, §6.1), ADR 0025, CLAUDE.md rules 1–10 and the minimal-copy convention.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run` (default suite) | pass: 265 files, 4966 tests, 1 todo |
| `npm run check:migrations` | pass: 1 to 13, none reserved or empty |
| Migration numbering | `0013-workout-drafts.ts` is the next number after the base's 12. No other branch uses 13. The `coach_actions` rebuild keeps all of 12's kinds, indexes and the no-delete trigger |
| ADR numbering | 0025 is unique across branches |

I also ran throwaway probes against the branch code; they were deleted afterwards and not committed. Those probes back findings B1, S1, S3, S4 and S5 below.

## What's good

- Structure only: `ProposeWorkoutArgsSchema` is `strictObject` all the way down, and `STRICT_TOOLS` fails a call with a smuggled `load` or `minutes` field instead of dropping it (WB3, tested).
- Loads come only from each exercise's own history (`substituteTargets`), then go through the planner and `snapPlanToGym`. With no history there is no load (B6). The overview dry run, Today's row and Start all use the one `planCoachDraft` path. Tests cover kg, lb, per-hand, stack, assisted and the equipment max (Hotel dumbbells capped at 20 kg).
- Pain-flagged exercises are left out and never substituted. Flagged exercises are also kept out of the usable list. A flag added after the build is `HELD` on the overview.
- The fenced Start pins the `workout_drafts` row, and the session's create transaction marks the draft `started`. A double tap creates one session. A new version, a discard or an expiry after the page loaded makes Start create nothing.
- Drafts are Your data (`YOUR_DATA_TABLES`, backup and restore, Delete my data). Expiry runs at launch and on every read.
- The claim check hides "saved / started" claims and keeps "built" claims only when a draft was committed in the turn. `Needs the coach` never shows a stand-in plan.

---

## Blocking

### B1. The new `build` request kind steals `change` from ordinary mid-workout requests (rule 3 regression)

`packages/coach/src/request.ts:580-581` (`BUILD_VERB`, `BUILD_DIRECT`) and `:644-647`.

`BUILD_VERB` includes `make`, `give`, `get`, `sort` and `plan`. `BUILD_NOUN` includes `session`, `workout` and `day`. Line 647 then removes `change` from any clause that matched `build`. This runs for **every** turn kind, including the workout sheet. I compared base and branch on the same phrases:

| Ben says (workout sheet) | base | branch |
|---|---|---|
| "make the session easier" | `change` | `build` |
| "can you make the session lighter?" | `change` | `build` |
| "make the rest of the session lighter" | `change` | `build` |
| "make the workout easier" | `change` | `build` |
| "give me a lighter session" | `change` | `build` |

`adjust_pending_sets` opens only on `change` or `difficulty` (`REQUEST_KINDS_BY_TOOL`). `propose_workout` is general-only. So in a workout turn none of these phrases opens any tool. Ben asks mid-workout to make it easier, and the coach can't apply it. That breaks rule 3 ("when Ben asks, changes to today's remaining sets apply immediately").

It also produces false positives in general turns. "give me a summary of my last session", "can you get my last session numbers?", "I want a rest day", "give me some tips for leg day" and "sort out my session from yesterday, I logged it wrong" all become `build`. Each of these offers `propose_workout` with `BUILD_INSTRUCTIONS` ("call `propose_workout` once"), so an unrequested draft is likely.

**Fix:**
- Make `buildIn` require a new-workout reading: the noun has an article or adjective that isn't `the`, `my` or `this`, and there is no `easier`, `lighter`, `harder`, `rest of`, `summary`, `numbers` or `tips` object.
- Drop `get`, `sort` and `sort out` from the verbs.
- Only suppress `change` when the turn kind is `general`, or keep both kinds and let the turn's registry decide.
- Add regression tests that pin the base classification of these phrases in workout turns.

---

## Should fix

### S1. A rest preset over 5:00 crashes the whole build turn

`packages/domain/src/session/coach-draft.ts:376` and `packages/schemas/src/workout-draft.ts:94`.

The requested rest is clamped to 30–300 and then snapped to Ben's nearest preset. Presets are `DurationSecondsSchema`, which allows up to 4 h. With presets `[90, 360]` and `restSeconds: 300`, the probe gives `restS = 360`, and `DraftPlanSchema` rejects it. The executor's `store.commit` then throws in `checkWrite`, so `runCoachTurn` throws:
- No record is written.
- The turn is left `running` until `recover()` marks it interrupted.
- The capped timer isn't cleared.

**Fix:** snap only to presets inside 30–300, or clamp after snapping. Add a test with a preset above 300.

### S2. A second `propose_workout` call in the same turn creates a second draft, or a misleading stale record

`packages/coach/src/build.ts:108-109`.

`deps.draft` is captured when the turn starts. Nothing limits the tool to one call per turn. For a new build, a second call with different exercises gets a new opId, a new `coachDraftIdFor(opId)` and a second open draft. One request then shows two draft cards with two `Open` buttons, and the picker lists two `FROM COACH` rows. For a revision, the second call is checked against the old `deps.draft.version`, so it records `stale` ("Out of date. Nothing built.") right under a version that did land.

**Fix:** track the draft committed in this turn inside the executor. Either make later calls the next version of that draft, or refuse them with a tool output ("already built; reply now"). Add a test.

### S3. The length parser misreads common phrasing (BD11: code reads the length, so it must read it right)

`coach-draft.ts:99-103`.

| Ben says | Parsed |
|---|---|
| "build me a 45 min push workout, I train in 2 hours" | 120 (hours are checked before minutes) |
| "make me a workout, rest 2 min between sets, about 45 minutes" | 15 (the first `min` wins, then clamped up) |
| "build a 400m sprint session" | 180 (`m` counts as minutes) |

The wrong number becomes `fitMinutes`, the draft's name ("Workout · 15 min") and the fit. That trims the workout to 15 minutes without warning.

**Fix:**
- Drop the bare `m` and `h` units.
- Ignore numbers attached to `rest`, `in`, `after` or `between`.
- Prefer a length next to `workout`, `session` or `long`. Otherwise take the longest plausible length.
- Add these cases to the parser test.

### S4. BD15's fixed line swallows replies that aren't about the draft

`coach-draft.ts:779`, used at `turn.ts` (`draftInThread || draftInContext`), with `threadHasDraft` at `apps/mobile/src/coach/coach-service.ts:740`.

`asksToStartOrSave` matches bare "keep it", "add it", "save that", "start" and "add". The general thread is reused for 6 h (`resolveThread`), and `threadHasDraft` stays true while any committed build is in it, including started or discarded drafts. Two failure cases:
- After a build, the coach suggests a memory. Ben's "save that" gets "Tap Start workout when you're ready." and the memory is never offered.
- With the draft in context (Ask coach), the coach mentions face pulls. Ben's "add it" is a BD16 revision, but it gets the fixed line and no model call.

**Fix:** limit the pattern to explicit start or save words (`start`, `begin`, `save … to my workouts`). Drop `keep` and `add`. Apply it only while the thread's newest draft is still open, and not when the coach's last message had an offer or a memory suggestion.

### S5. `revisesDraft` treats refusals as change requests

`request.ts:597` (`DRAFT_REVISION`).

`^(?:no|…|change|more|less|only)\b` matches "no", "no thanks" and "change nothing". With the draft in context, each of these adds `build`, attaches the build context and tells the model to call `propose_workout`. A reply of "no thanks" can make a new version Ben didn't ask for (rule 3).

**Fix:** require an object after `no` or `without` that names equipment, an exercise or a body part. Exclude `no thanks`, a bare `no` and `nothing`. Add negative tests.

### S6. Saving the draft switches the page to a never-done routine, so the loads disappear

`apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:220`.

§5.2 says the rows don't change after Save (WB16). That depends on §11 item 1, which isn't approved, and ADR 0025 records WB16 as not built. In the meantime the code still switches the basis to `{kind: 'routine'}`. Every row with history then turns to `—` (a never-done `Auto` loses its loads), right after Ben taps Save. The draft also leaves `FROM COACH`, because it is now linked to the routine. So the version with loads is only reachable from the coach card.

**Fix:** until §11 item 1 is approved, stay on the `coach_draft` basis after Save. Show the toast and Undo, and keep the draft listed until it is started.

### S7. The set `Why?` provenance line isn't built (WB25, §6.3)

`From a coach workout · 12 Oct` doesn't appear anywhere in `apps/` or `packages/`. The session stores `coachDraft`, but nothing reads it. WB25's second clause fails.

**Fix:** add the line to the set `Why?` view when `session.coachDraft` is present, and add a test.

### S8. Saving to Workouts and linking the draft are two separate writes, and the replay path skips the link

`apps/mobile/src/services/workout-services.ts:3106-3114`.

The routine is created in one transaction. `linkDraftRoutine` runs afterwards, and its failure is swallowed (`.catch(() => null)`). If the link fails, or the app is closed between the two writes:
- The draft stays under `FROM COACH`.
- The card doesn't read `Saved`.
- A retry with the same opId returns early through `existing` and never links.

`linkDraftRoutine` (`coach-draft.ts:721`) also ignores the draft's status and `expectedVersion`.

**Fix:** link inside the same `db.write` as the routine create, or run the link on the replay path too.

### S9. The top set is clamped silently and isn't counted against the set limit

`coach-draft.ts:388-395`.

- `topSet.reps` of 0–80 becomes 1–50 with no check line. WB13 says every clamp has its code-written line.
- `workingSets: 10` plus a top set gives 11 sets. That is past the §8.3 limit of 10 working sets, with no note.
- On a timed exercise the top set is dropped with no note.

**Fix:** add `clamped` or `shape` notes for each case, and count the top set inside `maxWorkingSets`.

---

## Nits

- **N1.** `parseRequestedFocus` (`coach-draft.ts:117-118`) returns null when the exercise name contains the focus word. "build a legs workout but no leg press" and "a pull workout with pull-ups" both become `Coach picks` and the name "Workout · 60 min".
- **N2.** A substitute that duplicates an exercise already in the plan gets "left out · nothing similar here" (`coach-draft.ts:290`). The text should say `listed twice`.
- **N3.** `ruleReps` ignores its `workingSets` argument and always plans with 3 sets (`coach-service.ts`, `checkContext`).
- **N4.** `threadHasDraft` reads every message and every turn's actions on each `send` (N+1 queries). Cache it, or query `coach_actions` by thread once.
- **N5.** Spec items not built and not listed in ADR 0025:
  - `New with coach` on the Workouts `＋` (§3).
  - `FROM COACH` showing up to 3, then `Show all (n)` (§4.4).
  - `NOT USED` hidden lines and `Done` in `Why this workout` (§4.5).
  - The context chip's `· Main gym` (§7).
  - `⋯ → Ask coach` shown disabled offline: the code shows a toast instead (§5.2).

  Either build them or add them to the ADR's "Built differently" list.
- **N6.** "Make it shorter" keeps the parent's `fitMinutes` (`coach-service.ts:785`). A version that is still over the length is trimmed back to the same 45 minutes, so "shorter" may not show up as shorter. See Spec issues.
- **N7.** WB21 (airplane mode → `Needs the coach · Offline` before any provider call) depends on `lastNetworkFailureMs`. The first build attempt offline still sends and then fails with `Couldn't reach the coach`. This is the app's existing pattern, and it is honest, but WB21 as written isn't met.
- **N8.** An `Ask coach` question that isn't a revision ("why bench first?") gets no `build.draft` context, so the coach can't see the draft it's being asked about.
- **N9.** `clearTimeout(capTimer)` and the abort-listener cleanup in `runCoachTurn` are skipped when an executor throws. Move them into a `finally`.

## Tests

The coverage is broad and real: a fake model with real SQLite, preview == Start set for set, every load convention, expiry, restore, force-close and the start fence. Missing:
- Mid-workout classification regressions (B1).
- A rest preset above 300 (S1).
- Two `propose_workout` calls in one turn (S2).
- Parser misreads (S3).
- BD15 and BD16 negative phrases (S4, S5).
- The cap timer firing after a draft was committed. The card should show with the interrupted note, not "Nothing changed".
- The set `Why?` provenance line (S7).

## Spec issues

1. **§5.2 "Saved" versus §11 item 1.** The spec has Save switch the basis to the new workout with "rows don't change (WB16)". That can't hold until the never-done `Auto` rule is approved. Until Ben decides, the spec should say "stay on the draft basis after Save".
2. **BD16 doesn't say how "make it shorter" affects the length.** It should state whether a "shorter" or "longer" revision moves `fitMinutes` (for example, one 15-minute step) or leaves the length to the coach's structure.
3. **WB29 conflicts with §4.4.** WB29 says a draft is "first in Today's SESSIONS". §4.4 and session-picker order put it after Up next. Pick one.
4. **WB21 (airplane mode) assumes a reachability check.** The app doesn't have one; offline is only known after a failed request. Either specify a reachability probe or relax WB21 to "after the first failed request".
5. **§8.2's `getCompatibleExercises`, `Busy today` and `resolveTrainingContext` don't exist on main.** ADR 0025 records this. The spec should mark them as later.
