# Review: coach-builder r3 (workout builder v1.0, fixes for round 2)

**Verdict: PASS**

Branch `claude/coach-builder` (9e21010), diffed against `claude/gracious-knuth-joxqpw` (31f3123). Round 2 was `docs/reviews/coach-builder-r2.md` at 5504de5. This round re-checks the round-2 findings (fix commits f279645 and 9e21010) against `docs/design/workout-builder.md` v1.0, `coach-contract.md`, ADR 0025, CLAUDE.md rules 1–10 and the minimal-copy convention, and looks for regressions the fixes introduced.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run` (default suite) | pass: 265 files, 4975 tests, 1 todo |
| `npm run check:migrations` | pass: 1 to 13, none reserved or empty |
| Migration numbering | `0013-workout-drafts.ts` follows the base's 12. No other local branch has a 0013. There is no local `main` branch; the base is the reference |
| ADR numbering | 0025 is unique |
| Merge with base | `git merge-tree` against 31f3123 is clean |

I ran throwaway probes against `parseRequestedMinutes` from a scratch directory outside the repo. Nothing from them was committed. They back S2 below.

## Round-2 findings

| # | Status | Notes |
|---|---|---|
| B1 "in 45 minutes" ignored | **Fixed** | `in`, `within` and `than` are out of `NOT_LENGTH_BEFORE`. `START_TIME_BEFORE` excludes "in N" only after a leave/train/start verb. All five round-2 phrases are now tested, along with "rest less than 2 min" and "heading to the gym in an hour, 45 min pull session". Probes: "in under 30 minutes" → 30, "no more than 45 minutes" → 45 (this also closes r2 N2's `than` case), "I'm at the gym in 20 minutes, build me a 45 min session" → 45. See S2 for the remaining start-time gap |
| S1 5:00 rest snaps to 1:30 | **Fixed as asked** | The code snaps first and then clamps, so `[90, 360]` keeps 5:00. Widely spaced presets can still pull a long rest a long way down (N1) |
| S2 second Save re-links | **Fixed**, with a regression (S1 below) | `Save to Workouts` is hidden once the draft links to a live workout. `saveFrom` refuses a new save with `already_saved` and shows `Already saved.` A same-opId retry is still a duplicate. After the save's Undo, the draft can be saved again. All of this is tested |
| r2 N3 Goals & schedule length | Closed | ADR 0025's "Built differently" records that Goals & schedule doesn't exist on the base |
| r2 N1, N2 (`use it`/`cut it`), N4–N8 | Open | Still nits; carried over below |

---

## Blocking

None.

---

## Should fix

### S1. A draft revised after Save can never be saved, and its `Saved ›` link opens the older version

`apps/mobile/src/services/workout-services.ts:3135-3138`, `apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:518`, `packages/domain/src/session/coach-draft.ts:722-729`.

Because of ADR 0025, the overview stays on the draft basis after Save, and its `⋯` menu still offers `Ask coach`. `addDraftVersion` keeps `routineId`. Steps:
1. Ben saves "Push · 45 min" (v1).
2. He taps `Ask coach` and says "make it 30 minutes, no barbell". BD16 creates v2, which applies at once.
3. The overview now shows v2, but `Save to Workouts` is gone (`routineId` is still the live v1 workout). `saveFrom` would return `Already saved.` anyway.
4. The card's `Saved · Push · 45 min ›` opens the v1 workout, which has a barbell and runs 45 minutes. Nothing shows that the saved workout and the current draft differ.

The only way to save v2 is to delete the first workout, which Ben has no reason to think of. Before the r2 S2 fix, the second save moved the link. Now it is blocked even when the draft has really changed.

**Fix (pick one):**
- Treat "already saved" per version. Refuse only when `currentVersion` equals the linked routine's `createdFromDraft.version`. Show `Save to Workouts` again when they differ. Choose whether the link moves to the new workout or both stay valid, and record the choice in ADR 0025.
- Alternatively, follow BD16 for saved workouts. Once the draft is linked, `Ask coach` on the draft gives a structural proposal on the saved workout (Apply/Undo), not a new draft version.

Add a test: save, revise to v2, then check that the page and `saveFrom` behave as decided.

### S2. "I'm at the gym in 20 minutes" is read as a 20-minute workout

`packages/domain/src/session/coach-draft.ts:96` (`START_TIME_BEFORE`).

The verb list covers `train`, `leave`, `start`, `be there`, `get there`, `arrive` and `head/go (to the gym)`. It misses the place forms. Probe results:

| Ben says | Result | Expected |
|---|---|---|
| "I'm at the gym in 20 minutes, give me a push workout" | 20 | null (default) |
| "I'll be at the gym in 30 minutes, build me a workout" | 30 | null |
| "build me a workout, I get to the gym in 40 minutes" | 40 | null |
| "build me a workout, gym in 40 min" | 40 | null |

The wrong value is visible (the name is "Push · 20 min" and the tile shows `TIME · FIT 20`), and `Clear fit` or a revision can recover it. That's why this isn't blocking. It is still the BD11 "code reads the length" failure in the other direction, and round 2 named "gym in" and "be there in" as start-time cues.

**Fix:**
- Add `(?:at|to) the gym` and a bare `gym` before `in`.
- Add `be at`, `get to` and `there` (for example `(?:be|get|i'?ll be|i'?m)(?: at| to)? (?:the )?gym in`).
- Add the four phrases above to the `review r2 B1` test block.

---

## Nits

- **N1.** Rest snapping has no tolerance. With presets `[90, 600]`, a coach rest of 5:00 still becomes 1:30 (|300−90| < |300−600|), with the line `Rest 5:00 → 1:30 (your presets)`. That matches "snapped to Ben's presets", and normal preset sets are dense, so this is minor. A tolerance (for example ±25%, else keep the clamped value) would keep the coach's intent.
- **N2.** The r2 S2 check runs outside the write transaction (`liveDraftRoutineId` before `routineFromSource`). Two Save taps with different opIds in the same moment could both pass it and create two workouts. The link stays on the first because `linked()` re-checks. The sheet's `busy` flag makes this unlikely in the UI, but the service doesn't enforce it.
- **N3.** `LIBRARY_COPY.alreadySaved` is shown only by the Save sheet. With the menu item hidden, it is effectively unreachable from the UI. That's fine; just noting it is a service guard, not a UI state.
- **N4.** Carried over from r2 and still open:
  - N1: `classifyBenRequest` misses "make me a harder workout", "build me something for today" and "plan my workout for today".
  - N2: `revisesDraft` treats a bare "use it" or "cut it" as a revision.
  - N4: `threadHasOpenDraft` cost.
  - N5: model-facing `BUILD_ALREADY_LINE` is stored in the `toolLog`.
  - N6: double clamp line for working sets plus a top set.
  - N7: `clearTimeout(capTimer)` is not in a `finally` (`turn.ts`).
  - N8: round-1 N1–N3, N5–N8.

## Tests

The fixes come with focused tests:
- **B1:** eleven parser cases, positive and negative, including a named length beating a start time.
- **S1:** snap-then-clamp, clamping when only out-of-range presets exist, and clamping up from 10 s.
- **S2:** an end-to-end test covering the hidden Save, the refusal, the link staying on the first workout, the same-opId retry, and Undo followed by a re-save.

Missing:
- Save, then revise (S1).
- The "at the gym in N" start-time forms (S2).
- A widely spaced preset case (N1).
- Round 1's "cap fires after a draft was committed" case is still not covered.

## Spec issues

1. **§5.2 `Saved` row (line 264) and the §6 state diagram (line 310) still say the basis switches to the new workout.** The code stays on the draft basis (ADR 0025) until Ben approves §11 item 1. That gap causes S1: the spec never had to say what `Ask coach` on a saved draft does, because the saved draft was never on screen. The spec should state it. Under BD16 this is probably a structural proposal on the saved workout.
2. **BD11 still lists no length phrasings.** A short table of what counts as a length ("in 45 minutes", "under an hour", "I've got 30 min", "45-minute") and what doesn't (rest, start time such as "at the gym in 20", distance) would settle S2 at design time.
3. Round-1 spec issues 2–5 are unchanged:
   - "shorter" and `fitMinutes`.
   - WB29 against §4.4 ordering.
   - WB21 reachability.
   - The §8.2 services that don't exist yet.
