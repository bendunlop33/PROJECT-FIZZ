# Review: coach-builder r2 (workout builder v1.0, fixes for round 1)

**Verdict: CHANGES NEEDED**

Branch `claude/coach-builder` (29306c7), diffed against `claude/gracious-knuth-joxqpw` (31f3123). Round 1 was `docs/reviews/coach-builder.md` at a7e2d89. This round re-checks every round-1 finding against `docs/design/workout-builder.md` v1.0, `coach-contract.md`, ADR 0025, CLAUDE.md rules 1–10 and the minimal-copy convention, and looks for regressions the fixes introduced.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run` (default suite) | pass: 265 files, 4974 tests, 1 todo |
| `npm run check:migrations` | pass: 1 to 13, none reserved or empty |
| Migration numbering | `0013-workout-drafts.ts` follows the base's 12. No other local branch has a 0013 |
| ADR numbering | 0025 is unique across branches |
| Merge with base | `git merge-tree` against 31f3123 is clean (the base's extra commit only touches `docs/device-tests/`) |

I also ran throwaway probes against `parseRequestedMinutes`, `classifyBenRequest`, `revisesDraft` and `asksToStartOrSave` from a scratch directory outside the repo. Nothing from them was committed. They back B1 and the nits below.

## Round-1 findings

| # | Status | Notes |
|---|---|---|
| B1 build steals `change` mid-workout | **Fixed** | `classifyBenRequest(text, turnKind)` drops `change` only in a general turn. `BUILD_NOT` and the narrower verbs and determiners mean the round-1 phrases classify as `change` in both turn kinds. There are regression tests through `buildTurnRegistry` |
| S1 rest preset over 5:00 crashes | Fixed, see S1 below | Presets outside 30–300 are filtered out, so the schema can no longer fail. The chosen fix snaps to a far-off preset |
| S2 second `propose_workout` | **Fixed** | `landedOpId` refuses a second build in the turn with a `refused` result. Tested for both a new build and a revision |
| S3 length parser | Fixed, **regressed**: see B1 below | The three round-1 cases now parse correctly. The new `NOT_LENGTH_BEFORE` list breaks the most common phrasing |
| S4 BD15 fixed line too broad | **Fixed** | The match now needs explicit start or save words. It applies only while the thread's newest build is still open, and not after an offer or a proposed card. Tested |
| S5 refusals read as revisions | **Fixed** | `no` and `without` need a thing to leave out. Negative tests added |
| S6 Save blanks the loads | **Fixed** | The page stays on the `coach_draft` basis, and the draft stays in `FROM COACH` until started. ADR 0025 records why |
| S7 `From a coach workout` line | **Fixed** | `explainTarget` adds the `coach_workout` row. It falls back to the start date when the draft is gone. Tested end to end |
| S8 Save link on replay | **Fixed** | `linked()` runs on the replay path and checks the draft is open and on the saved version. A force-close test covers it |
| S9 top set clamps | **Fixed** | Clamps now produce lines, the top set counts against the limit, and a timed top set is noted. Tested |
| N1–N8 | Open | Not addressed. They are still nits; see the carried-over list below |
| N9 cap timer not in `finally` | Open | `turn.ts:556` |

---

## Blocking

### B1. The new length parser ignores "in 45 minutes", so Ben gets a 60-minute workout (BD11 regression)

`packages/domain/src/session/coach-draft.ts:89` (`NOT_LENGTH_BEFORE`), used at `apps/mobile/src/coach/coach-service.ts:792`.

The review-S3 fix treats any time that follows `in`, `within` or `than` as "not the length". That covers "I train **in** 2 hours", but it also covers the commonest way to ask for a length. Probe results on the branch (base results in brackets):

| Ben says | Branch | Base |
|---|---|---|
| "build me a workout I can do in 45 minutes" | `null` | 45 |
| "plan a push workout in 30 mins" | `null` | 30 |
| "can you build me a workout that fits in an hour" | `null` | 60 |
| "build me a workout within 40 minutes" | `null` | 40 |
| "build a workout in less than 40 minutes" | `null` | 40 |

When the result is `null`, `buildTurn` falls back to `parent?.fitMinutes ?? resolveBuildMinutes(null, null)`, which is **60**. That value then sets several things:
- the set budget the coach is given
- the draft's `fitMinutes`
- its name ("Workout · 60 min")
- the overview's `TIME · FIT 60`

So Ben asks for 30 minutes and is shown a 60-minute workout. Nothing tells him his length was ignored. BD11 requires that code reads the length. The same applies to a revision: "make it fit in 30 minutes" keeps the parent's length.

The new parser test checks the three round-1 phrases but none of the `in N minutes` forms, so the suite stays green.

**Fix:**
- Remove `in`, `within` and `than` from `NOT_LENGTH_BEFORE`.
- Exclude "in N" only when it reads as a start time. That means it is preceded by a subject and verb about leaving or training ("I train in", "gym in", "leave in", "start in", "be there in") or followed by `from now`, which `NOT_LENGTH_AFTER` already handles.
- As an alternative, keep `in` lengths but rank them below a length that names the workout, the way `LENGTH_NAMES_WORKOUT` already ranks.
- Add the five phrases above to `coach-draft.test.ts` next to the review-S3 cases. Also add "in under 30 minutes" and "I'm at the gym in 20 minutes, build me a 45 min session" (expected 45).

---

## Should fix

### S1. A 5:00 rest can snap to a 1:30 preset

`coach-draft.ts:396-399`.

The review-S1 fix removes out-of-range presets before snapping. If Ben's presets are `[90, 360]`, a coach rest of 5:00 for a heavy compound becomes **1:30**, a third of what was asked for. The new test pins this: `'Rest 5:00 → 1:30 (your presets)'`. The line is honest, but this is a worse plan than clamping. The other option round 1 suggested, snapping and then clamping (360 → 300), keeps the coach's intent and still fits the schema. Snapping to the nearest preset also has no tolerance, so this happens whenever Ben has only a few presets.

**Fix:**
- Snap to the nearest preset first, then clamp to `L.minRestS`–`L.maxRestS`.
- Alternatively, snap only when a preset is within a tolerance (for example ±30 s or ±25%), and otherwise keep the clamped value.
- Update the test.

### S2. After Save, the overview still offers `Save to Workouts`, and a second Save re-links the draft to a second copy

`apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:518` and `apps/mobile/src/services/workout-services.ts:3106-3123`.

The page no longer switches to the routine (review S6), so the `⋯` menu still lists `Save to Workouts` on the same draft. A second tap creates a second routine with a new opId. `linkDraftRoutine` then sees a different `routineId` and moves the draft's link from the first workout to the copy. The coach card's `Saved · … ›` now opens the copy, and the first workout is orphaned from the draft. The spec has one save per draft (§5.2 `Saved` state, card `Saved · Push · 45 min ›`).

**Fix:** when `page.coachDraft.routineId` is set and that routine is live, either replace `Save to Workouts` with an item that opens the saved workout, or make `linkDraftRoutine` refuse to re-link an open draft that is already linked to a live routine. Add a test.

---

## Nits

- **N1.** `classifyBenRequest` probes. With BD16, the draft revision path still covers most of these, but each one gives the model no `propose_workout` on a fresh request:
  - "make me a harder workout" → `null`. `BUILD_NOT` blocks `harder` and `heavier` even with "a" plus a new noun.
  - "build me something for today" and "make me something for legs" → no `build`. `BUILD_NOUN` has no `something`.
  - "plan my workout for today" → `change`, not `build`.
- **N2.** `revisesDraft` probes:
  - "use it" and "cut it" → `true`. A bare `it` has no object, so these are ambiguous.
  - "no more than 45 minutes" → `false`, so a real length revision is missed. This is the same `than` family as B1.
- **N3.** `resolveBuildMinutes(null, null)` at `coach-service.ts:792` never passes the session length from Goals & schedule, but the spec's default (§3, line 107) is "today's session length from Goals & schedule, else 60". B1 makes this matter more.
- **N4.** `threadHasOpenDraft` (`coach-service.ts:743`) still reads every message and every turn's actions on each send. It now also does a draft read. This is round-1 N4.
- **N5.** `BUILD_ALREADY_LINE` ("Already built this turn. Reply now.") is aimed at the model. It also goes into the stored `toolLog`. If the tool log ever shows up in the UI, it needs Ben-facing copy.
- **N6.** In `shapeOf`, a `workingSets: 12` plus a top set gives two clamp lines: the existing working-set clamp, then "sets 11 → 10 with the top set". The first line's "after" number is then not what is built. Merge them into one line.
- **N7.** `clearTimeout(capTimer)` and `removeEventListener` are still outside a `finally` (`turn.ts:556`). This is round-1 N9.
- **N8.** Carried over from round 1 and still open: N1 (focus word inside an exercise name), N2 (`listed twice` text), N3 (`ruleReps` ignores `workingSets`), N5 (unbuilt spec items missing from ADR 0025's "Built differently" list), N6 ("make it shorter" keeps `fitMinutes`), N7 (WB21 offline before the first call), N8 (`Ask coach` questions get no draft context).

## Tests

The new tests are specific and meaningful:
- B1 phrases are run through the registry.
- S2 is driven by a scripted model for both a build and a revision.
- S4 has a memory-suggestion case.
- S8 corrupts the link on disk and relaunches.
- The S7 `Why?` row is checked end to end.

Missing:
- The `in / within / less than N minutes` length forms (B1).
- A second Save on the same draft (S2).
- A rest-preset tolerance case (S1).
- Round 1's "cap fires after a draft was committed" case is still not covered.

## Spec issues

1. **§5.2 `Saved` row (line 264) and the §6 state diagram (line 310) still say the basis switches to the routine.** The code and ADR 0025 now stay on the draft until §11 item 1 is approved. The spec should say so, or Ben should approve §11 item 1. This is round-1 spec issue 1, still open.
2. **BD11 doesn't list the length phrasings code must read.** A short table of required phrasings, including "in 45 minutes", "under an hour", "I've got 30 min" and "45-minute", plus the ones that are not a length (rest, start time, distance), would have caught B1 at design time.
3. Round-1 spec issues 2–5 are unchanged: "shorter" and `fitMinutes`, WB29 against §4.4 ordering, WB21 reachability, and the §8.2 services that don't exist yet.
