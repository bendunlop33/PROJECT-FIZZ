VERDICT: PASS

# Review: coach v1, final r3 (branch `claude/coach`)

Reviewer, 11 Oct 2026. Range: `git log claude/gracious-knuth-joxqpw..HEAD` (130 files, +21.3k/−98 against main). This round re-checks the fixes for `coach-v1-final-r2.md` (commits `6730efd`, `7866e1d`, `9fb1159`, `c714ff8`; 23 files, +451/−63) and looks for anything new. I checked it against:
- CLAUDE.md rules 1–10 and the minimal-copy convention;
- ADR 0020 and ADR 0019 (gym switch);
- the coach specs;
- the PM decisions: structural honesty, main merged first, clean seams.

## What I ran

- `npm run typecheck`: pass. `npm run lint`: pass.
- `npx vitest run --testTimeout=120000`: **164 files, 3384 passed, 1 todo, 0 failed.**
- `git merge-base --is-ancestor claude/gracious-knuth-joxqpw HEAD`: true. Main is fully merged.
- A probe of `painFlagChoices` (temporary test, deleted; the worktree is clean). The results are in S1 below.
- A scan of the r2→r3 diff:
  - no Reanimated, worklets or Skia added;
  - no `console.*` logging;
  - no secrets;
  - no new provider or paid route;
  - copy is short (`Couldn't undo: gym changed.`, `Only <name>. No change.`).

## Prior findings: status

| Prior | Status |
|---|---|
| **B1** coach Undo after a gym switch (rule 4) | **Fixed by refusing the Undo.** `handleRevertTargetAdjustment` returns `gym_changed` while any gym change made after the adjustment is still in effect (`packages/domain/src/session/reducer.ts:1384`, `coach-undo.ts`). `planned.coach.gymChanges` records how many gym changes the workout had when the coach made the change. A switch and its Undo cancel out. `isSuperseded` treats the adjustment as superseded, so replays are inert. Undo is hidden on the slot banner (`slot-view.ts`), the sheet card (`CoachSheetScreen.tsx`) and `⋯` (`active-view.ts` `coachActionId`). The store maps the refusal to `gym_changed`, and the undo record fails as `gym changed`. Tests: Main→hotel, hotel→Main, a removed set after a split, the switch undone then the coach Undo works again, and the store path. Recorded as Needs Ben in ADR 0020 §5. |
| **S1** in-workout Pain flags the focus row (rule 9) | **Fixed for the reported case.** `painFlagChoices` handles it: a whole name is flagged, a short name is offered as chips with the focus row, and the focus row is used only when nothing is named. Tested in the domain and the app flow. The probe found residual gaps (S1 below); they are not blocking. |
| N1 advice question counted as an ask | Fixed (`REQUEST_QUESTION`), with tests. |
| N2 summary note numbers and aliases | Fixed. A number the saved row doesn't say drops the sentence, and RDL/OHP are recognised. Over-dropping is the safe direction. |
| N3 offer-log race | Open. Cosmetic. |
| N4 migration 6 edited in place | Open. It applies from the first `[ios-build]` of this branch; the ADR notes it. |
| N5 refusal copy | Fixed. |
| N6 `\p{L}` on Hermes, playbook candidates in backups | Open. Device and later work. |

Still in place:
- Structural honesty: a strict reply function, cards only from committed `ActionRecord`s, no model words in the slot, and the claims checker only as a backstop that drops sentences.
- Version-gated, opId-idempotent writes.
- No paid route.
- Your data and Coaching knowledge kept separate.
- Logging works offline, and `Pain` works offline.

## Blocking

None.

## Should fix

### S1. `painFlagChoices` takes the first whole name without checking for negation or other movements, and doesn't know RDL/OHP (rule 9)

The code is in `packages/domain/src/coach/pain-words.ts:539-555`. The UI path is `apps/mobile/src/screens/coach/CoachSheetScreen.tsx` `pain()` → `flag()`.

The function returns early with `pick: false` as soon as one whole name matches. It never looks at loose names elsewhere in the words, or at negation. Probe results, in a workout with Bench press in focus:

| Ben types | Result | What goes wrong |
|---|---|---|
| "back squat felt fine but my shoulder hurts on bench" | `['Back squat'], pick: false` | One tap on `Pain` flags **Back squat** (`Pain noted for Back squat.`). Bench is not flagged, so the built-in rule or coach targets can still increase bench next session. |
| "not the bench press, my knee hurts on squats" | `['Bench press'], pick: false` | The wrong movement is flagged; squat is not. |
| "rdl tweaked my hamstring" | `['Bench press'], pick: false` (focus fallback) | Domain matching has no short forms, although `next-time-view.ts:123` already has `SHORT_FORMS`. |

This isn't silent: the toast names the exercise and main has a pain retraction. That is why it is not blocking. But in this case rule 9's effect lands on the wrong movement.

**Fix:**
- Always compute loose names as well. If the loose set has anything beyond the whole-name set, or the clause holding a whole name is negated ("felt fine", "not the"), return the union with `pick: true`.
- Move `SHORT_FORMS` into the domain and use it in both `exercisesNamedIn`/`exercisesLooselyNamedIn` and `next-time-view.ts`.
- Add the three probe sentences above as tests.

### S2. In a workout, a body-part-only mention flags the focus row with one tap

The code is in `pain-words.ts` `painFlagChoices` (focus fallback, `pick: false`).

**Scenario.** Ben is on Lat pulldown and types "my shoulder's been sore since bench". This case matches loose, so it is fine. With "my shoulder hurts", though, `Pain` flags Lat pulldown at once, even if the shoulder pain came from the press earlier. This is the behaviour r2 asked for, so it is low priority.

**Fix.** Consider `pick: true` with the focus row first whenever a body part is named. One extra tap, and the flag lands on the right movement.

## Nits

- **N1.** `coachUndoRefusal` (`packages/domain/src/session/coach-undo.ts:21`) reads `gymChanges` from the first set that carries the action. All of that action's sets share the same count, so this is correct today. A one-line comment saying so would stop a future per-set edit from breaking it.
- **N2.** The sheet's `undoBlocked` (`CoachSheetScreen.tsx`) reads `loadedWorkout.current`. When the sheet is opened from Today or the Summary with no loaded workout, the card still offers Undo. The store refuses it correctly (`Couldn't undo: gym changed.`), so the only cost is a dead tap.
- **N3.** `targetNumbers` (`apps/mobile/src/coach/next-time-view.ts`) drops sentences that state an increment ("up 2.5 kg to 100"), because 2.5 isn't one of the row's numbers. This is the safe direction. Note it so nobody "fixes" it by loosening the match.
- **N4.** Prior N3, N4 and N6 still stand (see the table).

## Tests

The B1 coverage is thorough:
- the domain reducer, both directions;
- a split row;
- a switch that was undone;
- the cancel-out counting;
- the view-level banner `canUndo`;
- the store `undoCoachAction` path.

S1, N1 and N2 have unit and flow tests. Missing:
- negated or mixed pain sentences, and short forms (S1);
- a body-part-only mention in a workout (S2).

## Spec issues (for Ben and the PM)

1. **ADR 0020 is still `Proposed`.** It has Needs Ben items:
   - the v1 cuts, including path B′ and history reads;
   - `add_playbook_candidate`;
   - the structural `No change made.`;
   - CC4 changed from "replace" to "drop";
   - the new **refuse, not re-fit** rule for coach Undo after a gym change.

   The gym-switch spec (§4) and the coach-adjustments spec (§4.3) should both state that last rule.
2. **Device proof is still outstanding.**
   - C0/S3: there is no strict function-tool round trip on the plan route yet.
   - S4 and S5 haven't run.
   - JWKS hasn't been checked on the iPhone.
   - `\p{L}` regexes haven't been checked on Hermes.
   - `COACH_CHAT_IN_BUILD = true` (`apps/mobile/src/ai/coach-connection-view.ts:49`) is honest, because failures map to statuses. But nothing in the coach counts as working until it runs on Ben's iPhone.
3. **The claim backstop is 1,265 lines** (`packages/coach/src/claims.ts`). Honesty is now structural, so the PM should freeze it: no new phrase rows without a device-observed failure.
4. **Summary chat can't revise next-session targets** (it runs as a `general` turn). The spec should say whether it may.
