# 0025: Coach-built workout drafts on the shared overview

**Status:** Proposed, 12 Oct 2026 (developer, for the PM and Ben). Design: [workout-builder.md](../design/workout-builder.md) v1.0. Records the ADR notes the spec asks for in §11 item 3 (ADR 0020, 0021, 0022 amendments) and the choices made while building it.

## Context

Ben can ask the coach for a workout ("build me a 45-minute push session for this gym"). The spec reuses what main has: the coach's structured replies and tool registry, the Workout overview with its fenced Start (ADR 0021), today's edits in the pre-start draft (ADR 0022), the shared fit, fit-to-time and the library save. The model proposes structure only; code decides loads, minutes, what this gym can do and what pain flags stop.

## Decision

1. **One typed tool, `propose_workout`** (ADR 0020 amendment). `effect: 'propose'`, writes `workout_draft`, needs a Ben request of the new kind `build` (`classifyBenRequest`; the Build card's own words classify the same way), general turns only. A coach draft in context (`Ask coach` on its overview) also opens it when Ben's words change the draft (`revisesDraft`: "make it shorter", "no barbell"), as BD16 asks. The argument schema has no load, minutes, gym or equipment field, and unlike every other tool an unknown field **fails the call** instead of being dropped (`STRICT_TOOLS` in `tool-call.ts`). Optional values are `null`, not absent, for strict function calling (the repo's convention); `targetRpe` is nullable so "missing" can be filled by the rule (BD7). Number bounds in the schema are only parse bounds: values outside §8.3 are clamped by `checkWorkoutProposal` with a check line (WB13); more than 10 exercises fails the schema.
2. **Checks are pure domain code** (`checkWorkoutProposal`): unknown key, duplicate, pain flag (left out, never substituted), not usable here (top same-pattern substitute, else left out), sets/reps/time/RPE/rest clamped, rest snapped to Ben's presets, superset 2–4 in a row. The executor stores the draft and its `build_workout` record in one transaction, idempotent on the op ID (`CoachWrite` kind `workout_draft`).
3. **Storage** (migration 13): table `workout_drafts` (Your data, validated JSON document), `coach_actions.kind` gains `build_workout` (table rebuilt as in 7, 11, 12), `sessions.coach_draft` (provenance). Ben's writes (Undo a version, Discard and its Undo, the save link) are versioned document writes with op IDs. Expiry after 14 days runs at launch and on every read. Backups carry the table; a restore keeps open drafts open on their own clock.
4. **The overview plans a draft as a transient routine** (`draftAsRoutine`, never stored), through the unchanged planner: `planCoachDraft` gives each slot `substituteTargets` on the exercise's own history (B6: none → no load), then `planWithTodayEdits`. Session service `startCoachDraft` is the one path for the dry run and Start. The session names the draft (`routineName`, `coachDraft`) and **no routine** (`routineId: null`), so the rotation is untouched.
5. **ADR 0022 amendment:** `DraftBasis` gains `{kind: 'coach_draft', draftId}`; today's edits on a draft follow the normal pre-start rules. `TodayEdit` `fit` gains `minutes: null` ("no fit today"): the draft's `fitMinutes` acts as a built-in fit edit unless a fit edit is live, so `Clear fit` on a coach draft writes `minutes: null`.
6. **ADR 0021 amendment:** `previewKey` includes the coach draft's ID and document version, and the start fence pins its `workout_drafts` row (`status = 'open'`). A new version, a discard, an expiry or another start after the page loaded makes Start create nothing. The session's create transaction marks the draft `started`.
7. **Claim check:** "I've built you a push workout" stands only with a committed `build_workout` in the turn; "saved to your workouts" / "started the workout" are always hidden (no tool can do either). "Start it" / "save it" in a general turn whose thread holds a coach draft (or with one in context) gets the fixed line `Tap Start workout when you're ready.` with no model call; elsewhere those words go to the coach as before ("save that" may be about a memory).
8. **Save to Workouts** is the library's `saveFrom` with a `coach_draft` preview: `source: 'coach'`, `createdFromDraft`, loads `Auto`, the coach's working-set RPE kept (`keepTargetRpe`). The draft names the workout and stays open; a tombstoned workout puts it back under `FROM COACH`.
9. **Timeouts:** a build turn has a 60 s whole-turn cap (`COACH_BUILD_TIMEOUT_MS`) on top of the first-event and stall timeouts, enforced by a timer that stops the running step (no wall clock in the package).

## Built differently from the spec (for the PM)

- **Goals & schedule doesn't exist on main** (`resolveTrainingContext`, session length, goal). The build uses Ben's words or chips, else 60 minutes, and the context keeps saying `Goals and training schedule: not set in this app yet` (rule 6). Nothing asks for a goal (BD3).
- **`getCompatibleExercises` and `Busy today` don't exist.** The usable list is Ben's exercises plus the catalogue, filtered by `doableHere` at the selected gym (the same check the Swap sheet uses); `busyToday` is always empty. Active pain-flagged exercises are also left out of the list sent (the check still leaves them out if named).
- **The selected gym** for a build is the default gym (`gymInContext`, as the coach's read tools use), else the typical gym's items.
- **`propose_workout` is general-turn only** (§8.2). A build from the coach sheet during a workout works from Today's sheet (a general turn) and the card reads `After this workout` (BD14); the workout's own sheet doesn't offer the tool.
- **Failure lines** use the coach sheet's existing outcome copy (`No answer in time. Nothing changed.` etc.), not the builder-specific lines in §5.1.

## Consequences

- One planner path (OV3) covers routines, next sessions and coach drafts; the existing overview tests plus `workout-builder.test.ts` check preview == Start for drafts.
- WB16 (a saved coach workout keeps its loads before it is done) still depends on §11 item 1 (never-done `Auto` rule), which Ben hasn't approved; not built.
